import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { type Any, ghlOk, hiringLocation } from "./ghl";
import { allValues, FIELDS, ROLES, STAGES, type ValueSpec } from "./spec";

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

async function createPipeline(location: string, name: string): Promise<string> {
  const body = await ghlOk("POST", "/opportunities/pipelines", {
    body: {
      locationId: location,
      name,
      stages: STAGES.map((s, i) => ({ name: s.name, position: i })),
    },
  });
  return String(body?.pipeline?.id ?? body?.id ?? "");
}

/** Add the stages a pipeline is missing, keeping the ones already there. */
async function repairStages(
  location: string,
  pipe: Pipeline,
): Promise<string[]> {
  const have = pipe.stages;
  const stages = STAGES.map((s, i) => {
    const found = have.find(h => same(h.name, s.name));
    return found
      ? { id: found.id, name: s.name, position: i }
      : { name: s.name, position: i };
  });
  // Anything the account has that the spec does not is kept, at the end.
  const extras = have
    .filter(h => !STAGES.some(s => same(s.name, h.name)))
    .map((h, i) => ({ id: h.id, name: h.name, position: STAGES.length + i }));
  await ghlOk("PUT", `/opportunities/pipelines/${pipe.id}`, {
    body: {
      locationId: location,
      name: pipe.name,
      stages: [...stages, ...extras],
    },
  });
  return stages.filter(s => !("id" in s)).map(s => s.name);
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

    const pipelines = await readPipelines(location);
    for (const role of ROLES) {
      const found = pipelines.find(p => same(p.name, role.pipeline));
      if (!found)
        await attempt(`pipeline ${role.pipeline}`, () =>
          createPipeline(location, role.pipeline),
        );
      else {
        const missing = STAGES.filter(
          s => !found.stages.some(h => same(h.name, s.name)),
        );
        if (missing.length)
          await attempt(`stages on ${role.pipeline}`, () =>
            repairStages(location, found),
          );
      }
    }

    const fields = await readFields(location);
    for (const f of FIELDS)
      if (!fields.some(x => same(x.name, f.name)))
        await attempt(`field ${f.name}`, () => createField(location, f));

    const values = await readValues(location);
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
