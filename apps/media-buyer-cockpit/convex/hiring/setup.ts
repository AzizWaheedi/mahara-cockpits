import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { type Any, ghl, ghlOk, hiringLocation } from "./ghl";
import {
  allValues,
  CALENDARS,
  FIELDS,
  RENAMES,
  ROLES,
  STAGES,
  type ValueSpec,
  WORKING_DAYS,
  WORKING_FROM,
  WORKING_TO,
} from "./spec";

/**
 * Build the hiring sub-account in GoHighLevel from `spec.ts`, and keep it
 * built.
 *
 * Every step compares what is there with what the spec says and only touches
 * the difference, so this can be run any number of times. It never deletes:
 * a pipeline, field or value that exists but is not in the spec is reported
 * and left alone, because a half-finished funnel is worse than a spare field.
 *
 * `plan` says what it would do. `apply` does it. Both are CLI only.
 */

// --- Reads -------------------------------------------------------------------

type Pipeline = {
  id: string;
  name: string;
  stages: { id: string; name: string }[];
};

export async function readPipelines(location: string): Promise<Pipeline[]> {
  const body = await ghlOk(
    "GET",
    `/opportunities/pipelines?locationId=${location}`,
  );
  return (body?.pipelines ?? []).map((p: Any) => ({
    id: String(p.id),
    name: String(p.name ?? ""),
    stages: (p.stages ?? []).map((s: Any) => ({
      id: String(s.id),
      name: String(s.name ?? ""),
    })),
  }));
}

type Field = { id: string; name: string; key: string; type: string };

export async function readFields(location: string): Promise<Field[]> {
  const body = await ghlOk(
    "GET",
    `/locations/${location}/customFields?model=contact`,
  );
  return (body?.customFields ?? []).map((f: Any) => ({
    id: String(f.id),
    name: String(f.name ?? ""),
    key: String(f.fieldKey ?? ""),
    type: String(f.dataType ?? ""),
  }));
}

type Value = { id: string; name: string; key: string; value: string };

export async function readValues(location: string): Promise<Value[]> {
  const body = await ghlOk("GET", `/locations/${location}/customValues`);
  return (body?.customValues ?? []).map((c: Any) => ({
    id: String(c.id),
    name: String(c.name ?? ""),
    key: String(c.fieldKey ?? ""),
    value: String(c.value ?? ""),
  }));
}

const same = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

// --- The difference between the spec and the account -------------------------

export type Step = { what: string; detail: string };

export type Plan = {
  location: string;
  pipelines: {
    create: Step[];
    fixStages: Step[];
    ok: string[];
    spare: string[];
  };
  fields: { create: Step[]; ok: string[]; spare: string[] };
  values: { create: Step[]; ok: string[]; spare: string[] };
};

export async function buildPlan(location: string): Promise<Plan> {
  const [pipelines, fields, values] = await Promise.all([
    readPipelines(location),
    readFields(location),
    readValues(location),
  ]);
  const wantStages = STAGES.map(s => s.name);

  const plan: Plan = {
    location,
    pipelines: { create: [], fixStages: [], ok: [], spare: [] },
    fields: { create: [], ok: [], spare: [] },
    values: { create: [], ok: [], spare: [] },
  };

  for (const role of ROLES) {
    const found = pipelines.find(p => same(p.name, role.pipeline));
    if (!found) {
      plan.pipelines.create.push({
        what: role.pipeline,
        detail: `${wantStages.length} stages: ${wantStages.join(", ")}`,
      });
      continue;
    }
    const have = found.stages.map(s => s.name);
    const missing = wantStages.filter(n => !have.some(h => same(h, n)));
    if (missing.length)
      plan.pipelines.fixStages.push({
        what: role.pipeline,
        detail: `missing ${missing.join(", ")}`,
      });
    else plan.pipelines.ok.push(role.pipeline);
  }
  for (const p of pipelines)
    if (!ROLES.some(r => same(r.pipeline, p.name)))
      plan.pipelines.spare.push(p.name);

  for (const f of FIELDS) {
    const found = fields.find(x => same(x.name, f.name));
    if (found) plan.fields.ok.push(f.name);
    else plan.fields.create.push({ what: f.name, detail: f.type });
  }
  for (const f of fields)
    if (!FIELDS.some(x => same(x.name, f.name))) plan.fields.spare.push(f.name);

  const want = allValues();
  for (const val of want) {
    const found = values.find(x => same(x.name, val.name));
    if (found) plan.values.ok.push(val.name);
    else
      plan.values.create.push({
        what: val.name,
        detail: val.seed
          ? `seeded, ${val.seed.length} characters`
          : "left empty for Aziz",
      });
  }
  for (const c of values)
    if (!want.some(x => same(x.name, c.name))) plan.values.spare.push(c.name);

  return plan;
}

/** What `apply` would do, without doing it. */
export const plan = internalAction({
  args: { location: v.optional(v.string()) },
  returns: v.any(),
  handler: async (_ctx, { location }) =>
    buildPlan(location ?? hiringLocation()),
});

// --- Writes ------------------------------------------------------------------

/**
 * A stage as GoHighLevel wants it, with the settings that make the board read
 * as a funnel. Stage colours are not in the public API; win probability and
 * the funnel flags are the styling it does expose, so they are set rather
 * than left at the defaults GoHighLevel guesses.
 */
function stageBody(pipe: Pipeline): {
  id?: string;
  name: string;
  position: number;
  showInFunnel: boolean;
  showInPieChart: boolean;
  stageWinProbability: number;
}[] {
  const out = STAGES.map((s, i) => {
    const found = pipe.stages.find(h => same(h.name, s.name));
    return {
      ...(found ? { id: found.id } : {}),
      name: s.name,
      position: i,
      showInFunnel: s.advancing,
      showInPieChart: s.advancing,
      stageWinProbability: s.odds,
    };
  });
  // Anything the account has that the spec does not is kept, at the end.
  const extras = pipe.stages
    .filter(h => !STAGES.some(s => same(s.name, h.name)))
    .map((h, i) => ({
      id: h.id,
      name: h.name,
      position: STAGES.length + i,
      showInFunnel: false,
      showInPieChart: false,
      stageWinProbability: 0,
    }));
  return [...out, ...extras];
}

async function createPipeline(location: string, name: string): Promise<string> {
  const body = await ghlOk("POST", "/opportunities/pipelines", {
    body: {
      locationId: location,
      name,
      stages: STAGES.map((s, i) => ({
        name: s.name,
        position: i,
        showInFunnel: s.advancing,
        showInPieChart: s.advancing,
        stageWinProbability: s.odds,
      })),
    },
  });
  return String(body?.pipeline?.id ?? body?.id ?? "");
}

/**
 * Bring a pipeline's stages up to the spec: add any that are missing, and set
 * the funnel settings on all of them. Never removes a stage.
 */
async function repairStages(pipe: Pipeline): Promise<string[]> {
  const body = stageBody(pipe);
  await ghlOk("PUT", `/opportunities/pipelines/${pipe.id}`, {
    body: { name: pipe.name, stages: body },
  });
  return body.filter(s => !s.id).map(s => s.name);
}

async function createField(
  location: string,
  f: (typeof FIELDS)[number],
): Promise<string> {
  const body = await ghlOk("POST", `/locations/${location}/customFields`, {
    body: {
      name: f.name,
      dataType: f.type,
      model: "contact",
      ...(f.options ? { options: f.options } : {}),
    },
  });
  return String(body?.customField?.id ?? body?.id ?? "");
}

async function createValue(location: string, val: ValueSpec): Promise<string> {
  const body = await ghlOk("POST", `/locations/${location}/customValues`, {
    body: { name: val.name, value: val.seed },
  });
  return String(body?.customValue?.id ?? body?.id ?? "");
}

/**
 * Build everything the plan says is missing. Safe to run again: it reads
 * first, and a failure on one item is reported and the rest still run, so a
 * single refused field never leaves the account half built.
 */
export const apply = internalAction({
  args: { location: v.optional(v.string()) },
  returns: v.any(),
  handler: async (_ctx, args) => {
    const location = args.location ?? hiringLocation();
    const done: string[] = [];
    const failed: string[] = [];
    const attempt = async (what: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
        done.push(what);
      } catch (e) {
        failed.push(`${what}: ${(e as Error).message}`);
      }
    };

    // Renames first, so a pipeline that changed name keeps its cards instead
    // of being rebuilt empty beside the old one.
    let pipelines = await readPipelines(location);
    let values = await readValues(location);
    const renamedTo = new Set<string>();
    let fields = await readFields(location);
    for (const r of RENAMES) {
      if (r.kind === "pipeline") {
        const pipe = pipelines.find(p => same(p.name, r.from));
        if (!pipe || pipelines.some(p => same(p.name, r.to))) continue;
        renamedTo.add(r.to.trim().toLowerCase());
        await attempt(`rename pipeline ${r.from}`, () =>
          // GoHighLevel refuses locationId on a pipeline PUT (422,
          // "property locationId should not exist"), unlike the POST.
          ghlOk("PUT", `/opportunities/pipelines/${pipe.id}`, {
            body: { name: r.to, stages: stageBody(pipe) },
          }),
        );
      } else if (r.kind === "value") {
        const val = values.find(x => same(x.name, r.from));
        if (!val || values.some(x => same(x.name, r.to))) continue;
        await attempt(`rename value ${r.from}`, () =>
          ghlOk("PUT", `/locations/${location}/customValues/${val.id}`, {
            body: { name: r.to, value: val.value },
          }),
        );
      } else {
        const f = fields.find(x => same(x.name, r.from));
        if (!f || fields.some(x => same(x.name, r.to))) continue;
        await attempt(`rename field ${r.from}`, () =>
          ghlOk("PUT", `/locations/${location}/customFields/${f.id}`, {
            body: { name: r.to },
          }),
        );
      }
    }
    if (done.length) {
      pipelines = await readPipelines(location);
      values = await readValues(location);
      fields = await readFields(location);
    }
    for (const role of ROLES) {
      const found = pipelines.find(p => same(p.name, role.pipeline));
      // A pipeline renamed a moment ago can still read under its old name for
      // a beat, so do not try to build a second one on top of it.
      if (!found && renamedTo.has(role.pipeline.trim().toLowerCase())) continue;
      if (!found)
        await attempt(`pipeline ${role.pipeline}`, () =>
          createPipeline(location, role.pipeline),
        );
      else
        await attempt(`stages on ${role.pipeline}`, () => repairStages(found));
    }

    for (const f of FIELDS)
      if (!fields.some(x => same(x.name, f.name)))
        await attempt(`field ${f.name}`, () => createField(location, f));

    for (const val of allValues())
      if (!values.some(x => same(x.name, val.name)))
        await attempt(`value ${val.name}`, () => createValue(location, val));

    return {
      location,
      built: done.length,
      done,
      failed,
      plan: await buildPlan(location),
    };
  },
});

/**
 * Remove stages the spec does not name, so a renamed stage does not leave its
 * old self behind on every board (which is what "One-to-one interview" did
 * when it became "One to one interview", 2026-09-22).
 *
 * It refuses to drop a stage anybody is standing in: those cards are moved to
 * the stage the spec says they belong in first, by hand or by `move`.
 */
export const pruneStages = internalAction({
  args: { location: v.optional(v.string()), dryRun: v.optional(v.boolean()) },
  returns: v.any(),
  handler: async (_ctx, args) => {
    const location = args.location ?? hiringLocation();
    const pipelines = await readPipelines(location);
    const out: Any[] = [];
    for (const pipe of pipelines) {
      const strays = pipe.stages.filter(
        h => !STAGES.some(s => same(s.name, h.name)),
      );
      if (!strays.length) continue;
      const occupied: { name: string; cards: number }[] = [];
      for (const st of strays) {
        const r = await ghl(
          "GET",
          `/opportunities/search?location_id=${location}&pipeline_id=${pipe.id}&pipeline_stage_id=${st.id}&limit=1`,
        );
        const n = Number(
          r.body?.meta?.total ?? (r.body?.opportunities ?? []).length,
        );
        if (n > 0) occupied.push({ name: st.name, cards: n });
      }
      if (occupied.length) {
        out.push({ pipeline: pipe.name, refused: occupied });
        continue;
      }
      if (!args.dryRun)
        await ghlOk("PUT", `/opportunities/pipelines/${pipe.id}`, {
          body: {
            name: pipe.name,
            stages: STAGES.map((s, i) => {
              const found = pipe.stages.find(h => same(h.name, s.name));
              return {
                ...(found ? { id: found.id } : {}),
                name: s.name,
                position: i,
                showInFunnel: s.advancing,
                showInPieChart: s.advancing,
                stageWinProbability: s.odds,
              };
            }),
          },
        });
      out.push({
        pipeline: pipe.name,
        removed: strays.map(st => st.name),
        dryRun: Boolean(args.dryRun),
      });
    }
    return { location, pipelines: pipelines.length, out };
  },
});

/**
 * Build the two booking calendars and point the custom values at them.
 *
 * A GoHighLevel calendar must be hosted by a user of that sub-account, and
 * the hiring sub-account starts with none. The API cannot add one either: it
 * refuses to modify the agency owner ("Agency owner details cannot be
 * modified!", 2026-09-22). So Aziz assigns himself once in the GoHighLevel
 * interface and this builds the rest.
 */
export const calendars = internalAction({
  args: { location: v.optional(v.string()) },
  returns: v.any(),
  handler: async (_ctx, args) => {
    const location = args.location ?? hiringLocation();
    const users = await ghlOk("GET", `/users/?locationId=${location}`);
    const host = (users?.users ?? [])[0];
    if (!host?.id)
      return {
        ok: false,
        needs:
          "Nobody is a user of the hiring sub-account, so no calendar can have a host. In GoHighLevel open the agency view, Settings, My Staff, your own user, and tick the MaharaMedia Hiring sub-account. Then run this again.",
      };

    const openHours = WORKING_DAYS.map(d => ({
      daysOfTheWeek: [d],
      hours: [
        {
          openHour: WORKING_FROM,
          openMinute: 0,
          closeHour: WORKING_TO,
          closeMinute: 0,
        },
      ],
    }));
    const existing = await ghlOk("GET", `/calendars/?locationId=${location}`, {
      version: "2021-04-15",
    });
    const have: Any[] = existing?.calendars ?? [];
    const values = await readValues(location);
    const done: Any[] = [];
    const failed: string[] = [];

    for (const c of CALENDARS) {
      try {
        let found = have.find(x => same(String(x.name ?? ""), c.name));
        if (!found) {
          const made = await ghlOk("POST", "/calendars/", {
            version: "2021-04-15",
            body: {
              locationId: location,
              name: c.name,
              description: c.description,
              calendarType: c.type,
              ...(c.type === "round_robin"
                ? { eventType: "RoundRobin_OptimizeForAvailability" }
                : {}),
              slotDuration: c.minutes,
              slotDurationUnit: "mins",
              slotInterval: c.minutes,
              slotIntervalUnit: "mins",
              appointmentPerSlot: c.perSlot,
              autoConfirm: true,
              isActive: true,
              allowReschedule: true,
              allowCancellation: true,
              eventTitle: `{{contact.name}}, ${c.name}`,
              openHours,
              teamMembers: [{ userId: String(host.id), isPrimary: true }],
            },
          });
          found = made?.calendar ?? made;
        }
        const id = String(found?.id ?? "");
        if (!id) throw new Error("GoHighLevel returned no calendar id");
        const link = `https://api.leadconnectorhq.com/widget/booking/${id}`;
        const val = values.find(x => same(x.name, c.fills));
        if (val && val.value.trim() !== link)
          await ghlOk("PUT", `/locations/${location}/customValues/${val.id}`, {
            body: { name: val.name, value: link },
          });
        done.push({
          calendar: c.name,
          id,
          host: String(host.email ?? host.id),
          link,
          filled: c.fills,
        });
      } catch (e) {
        failed.push(`${c.name}: ${(e as Error).message}`);
      }
    }
    return {
      ok: failed.length === 0,
      location,
      host: String(host.email ?? ""),
      done,
      failed,
    };
  },
});

/** What the account holds now, names and ids, for the cockpit and for a check. */
export const state = internalAction({
  args: { location: v.optional(v.string()) },
  returns: v.any(),
  handler: async (_ctx, args) => {
    const location = args.location ?? hiringLocation();
    const [pipelines, fields, values] = await Promise.all([
      readPipelines(location),
      readFields(location),
      readValues(location),
    ]);
    return {
      location,
      pipelines: pipelines.map(p => ({
        id: p.id,
        name: p.name,
        stages: p.stages.length,
      })),
      fields: fields.length,
      values: values.length,
    };
  },
});
