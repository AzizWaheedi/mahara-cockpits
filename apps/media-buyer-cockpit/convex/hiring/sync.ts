import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { rest, upsertMerge } from "../ceo/sbWrite";
import { type Any, ghl, ghlOk, hiringConfigured, hiringLocation } from "./ghl";
import { readFields, readPipelines } from "./setup";
import {
  EXIT_STAGES,
  FIELDS,
  ROLES,
  type RoleKey,
  type StageKey,
  stageKeyOnBoard,
  stageName,
} from "./spec";

/**
 * Bring the GoHighLevel hiring board into Supabase, and notice what moved.
 *
 * GoHighLevel is where Aziz drags a card. This sync is what turns that drag
 * into a number, a timestamp and a trigger: every candidate becomes a row in
 * cockpit_hiring_candidates, every move becomes a row in
 * cockpit_hiring_events, and the engine reads those events to decide what to
 * send. Nothing here sends anything.
 *
 * It is a poll, not a webhook, on purpose: a poll catches up after an outage
 * and cannot silently stop, which is the failure Aziz already had with
 * workflow automations.
 */

// --- The ids the rest of the module needs ------------------------------------

export type Meta = {
  location: string;
  /** Pipeline id per role. */
  pipelines: Record<string, string>;
  /** Stage key per GoHighLevel stage id, and the reverse per pipeline. */
  stageKeyById: Record<string, StageKey>;
  stageIdByKey: Record<string, Record<string, string>>;
  /** Custom field id per spec key. */
  fields: Record<string, string>;
  /** Roles whose pipeline is missing, so a screen can say so. */
  missing: string[];
  at: number;
};

const META_KEY = "ghl-ids";

/** Read the ids straight from GoHighLevel and cache them. */
export async function refreshMeta(): Promise<Meta> {
  const location = hiringLocation();
  const [pipelines, fields] = await Promise.all([
    readPipelines(location),
    readFields(location),
  ]);
  const meta: Meta = {
    location,
    pipelines: {},
    stageKeyById: {},
    stageIdByKey: {},
    fields: {},
    missing: [],
    at: Date.now(),
  };
  for (const role of ROLES) {
    const p = pipelines.find(
      x => x.name.trim().toLowerCase() === role.pipeline.trim().toLowerCase(),
    );
    if (!p) {
      meta.missing.push(role.label);
      continue;
    }
    meta.pipelines[role.key] = p.id;
    meta.stageIdByKey[role.key] = {};
    for (const s of p.stages) {
      const key = stageKeyOnBoard(role.key, s.name);
      if (!key) continue;
      meta.stageKeyById[s.id] = key;
      meta.stageIdByKey[role.key][key] = s.id;
    }
  }
  for (const f of FIELDS) {
    const found = fields.find(
      x => x.name.trim().toLowerCase() === f.name.trim().toLowerCase(),
    );
    if (found) meta.fields[f.key] = found.id;
  }
  await upsertMerge(
    "cockpit_hiring_meta",
    [{ key: META_KEY, value: meta, updated_at: new Date().toISOString() }],
    "key",
  );
  // The roles as the spec describes them, published so the recruiting agent on
  // the VPS scores against the same scorecard the cockpit shows, without a
  // second copy of it to drift (Aziz, 2026-09-22: the VPS makes the agent).
  await upsertMerge(
    "cockpit_hiring_meta",
    [
      {
        key: "roles",
        value: {
          at: Date.now(),
          roles: ROLES.map(r => ({
            key: r.key,
            label: r.label,
            compensation: r.compensation,
            scorecard: r.scorecard,
            dailyResponsibilities: r.dailyResponsibilities,
            postOn: r.postOn,
            rampTime: r.rampTime,
            testProject: r.testProject,
          })),
        },
        updated_at: new Date().toISOString(),
      },
    ],
    "key",
  ).catch(() => null);
  return meta;
}

/** The cached ids, refreshed when they are missing or older than an hour. */
export async function meta(force = false): Promise<Meta> {
  if (!force) {
    const rows = await rest(
      `cockpit_hiring_meta?key=eq.${META_KEY}&select=value&limit=1`,
    );
    const cached = rows?.[0]?.value as Meta | undefined;
    if (cached?.at && Date.now() - cached.at < 60 * 60_000) return cached;
  }
  return refreshMeta();
}

// --- Reading the board -------------------------------------------------------

type Opp = {
  id: string;
  contactId: string;
  name: string;
  stageId: string;
  createdAt: string | null;
  updatedAt: string | null;
};

/** Every opportunity in one pipeline, all statuses, oldest first. */
async function opportunities(
  location: string,
  pipelineId: string,
): Promise<Opp[]> {
  const out: Opp[] = [];
  for (let page = 1; page <= 20; page++) {
    const r = await ghl(
      "GET",
      `/opportunities/search?location_id=${location}&pipeline_id=${pipelineId}&limit=100&page=${page}`,
    );
    if (r.status !== 200) break;
    const rows: Any[] = r.body?.opportunities ?? [];
    for (const o of rows)
      out.push({
        id: String(o.id),
        contactId: String(o.contact?.id ?? o.contactId ?? ""),
        name: String(o.contact?.name ?? o.name ?? "").trim(),
        stageId: String(o.pipelineStageId ?? ""),
        createdAt: o.createdAt ? String(o.createdAt) : null,
        updatedAt: o.updatedAt ? String(o.updatedAt) : null,
      });
    if (rows.length < 100) break;
  }
  return out;
}

/**
 * Every contact in the hiring sub-account, by id, with its custom field
 * values flattened onto the spec keys. One pass, so a board of two hundred
 * candidates is two hundred rows and not two hundred calls.
 */
async function contacts(
  location: string,
  fieldIds: Record<string, string>,
): Promise<Map<string, Record<string, string>>> {
  const byId = new Map<string, Record<string, string>>();
  const keyOf = new Map<string, string>();
  for (const [key, id] of Object.entries(fieldIds)) keyOf.set(id, key);
  //
  // GoHighLevel pages contacts on a pair: the last id and the last
  // `dateAdded` as epoch milliseconds. Passing the ISO string it hands back
  // stalls the cursor at the first page, which quietly left 150 of 253
  // candidates with no fields at all (2026-09-22).
  let startAfterId = "";
  let startAfter = 0;
  const seenIds = new Set<string>();
  for (let page = 0; page < 40; page++) {
    const q = new URLSearchParams({ locationId: location, limit: "100" });
    if (startAfterId) q.set("startAfterId", startAfterId);
    if (startAfter) q.set("startAfter", String(startAfter));
    const r = await ghl("GET", `/contacts/?${q}`);
    if (r.status !== 200) break;
    const rows: Any[] = r.body?.contacts ?? [];
    // A cursor that does not move would page for ever over the same hundred.
    if (rows.length && rows.every(c => seenIds.has(String(c.id)))) break;
    for (const c of rows) seenIds.add(String(c.id));
    for (const c of rows) {
      const flat: Record<string, string> = {
        name: String(c.contactName ?? c.name ?? "").trim(),
        country: String(c.country ?? "").trim(),
        source: String(c.source ?? "").trim(),
      };
      for (const f of c.customFields ?? []) {
        const key = keyOf.get(String(f.id));
        if (!key) continue;
        const value = f.value ?? f.fieldValue ?? "";
        flat[key] = Array.isArray(value) ? value.join(", ") : String(value);
      }
      byId.set(String(c.id), flat);
    }
    if (rows.length < 100) break;
    const last = rows[rows.length - 1];
    startAfterId = String(last?.id ?? "");
    const added = Date.parse(String(last?.dateAdded ?? ""));
    startAfter = Number.isFinite(added) ? added : 0;
    if (!startAfterId) break;
  }
  return byId;
}

const num = (s: unknown): number | null => {
  const n = Number(String(s ?? "").trim());
  return Number.isFinite(n) && String(s ?? "").trim() !== "" ? n : null;
};

const day = (s: unknown): string | null => {
  const t = String(s ?? "").trim();
  if (!t) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

const iso = (s: unknown): string | null => {
  const t = String(s ?? "").trim();
  if (!t) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/** The mean of the scores actually given, to one decimal. Null when none are. */
export function totalScore(scores: (number | null)[]): number | null {
  const given = scores.filter((n): n is number => n !== null);
  if (!given.length) return null;
  return (
    Math.round((given.reduce((t, n) => t + n, 0) / given.length) * 10) / 10
  );
}

// --- The pull ----------------------------------------------------------------

export type PullResult = {
  ok: boolean;
  roles: { role: string; candidates: number }[];
  moved: number;
  added: number;
  missingPipelines: string[];
  error?: string;
};

export async function pullOnce(): Promise<PullResult> {
  if (!hiringConfigured())
    return {
      ok: false,
      roles: [],
      moved: 0,
      added: 0,
      missingPipelines: [],
      error:
        "The hiring sub-account is not connected: set GHL_HIRING_PIT and GHL_HIRING_LOCATION.",
    };
  const m = await meta();
  const location = m.location;
  const byContact = await contacts(location, m.fields);

  // What the mirror already holds, so a move can be told from a first sight.
  const held = new Map<string, { stage: string; stage_since: string | null }>();
  const rows = await rest(
    "cockpit_hiring_candidates?select=id,stage,stage_since&limit=5000",
  );
  for (const r of rows ?? [])
    held.set(String(r.id), {
      stage: String(r.stage),
      stage_since: r.stage_since ? String(r.stage_since) : null,
    });

  const now = new Date().toISOString();
  const candidates: Any[] = [];
  const events: Any[] = [];
  const perRole: { role: string; candidates: number }[] = [];
  let moved = 0;
  let added = 0;

  for (const role of ROLES) {
    const pipelineId = m.pipelines[role.key];
    if (!pipelineId) continue;
    const opps = await opportunities(location, pipelineId);
    perRole.push({ role: role.key, candidates: opps.length });
    for (const o of opps) {
      const stage: StageKey = m.stageKeyById[o.stageId] ?? "application";
      const c = byContact.get(o.contactId) ?? {};
      const scores = {
        application: num(c.scoreApplication),
        loom: num(c.scoreLoom),
        group: num(c.scoreGroup),
        oneToOne: num(c.scoreOneToOne),
        testProject: num(c.scoreTestProject),
      };
      const before = held.get(o.id);
      const isNew = !before;
      const didMove = Boolean(before && before.stage !== stage);
      if (isNew) added += 1;
      if (didMove) moved += 1;
      candidates.push({
        id: o.id,
        contact_id: o.contactId,
        location_id: location,
        role: role.key,
        role_label: role.label,
        pipeline_id: pipelineId,
        stage,
        stage_name: stageName(stage),
        name: o.name || c.name || "",
        country: c.country || null,
        source: c.source || null,
        years_experience: num(c.yearsExperience),
        arabic: c.arabic || null,
        portfolio_url: c.portfolio || null,
        loom_url: c.loomUrl || null,
        test_project_url: c.testProjectUrl || null,
        score_application: scores.application,
        score_loom: scores.loom,
        score_group: scores.group,
        score_one_to_one: scores.oneToOne,
        score_test_project: scores.testProject,
        score_total: totalScore(Object.values(scores)),
        disqualify_reason: c.disqualifyReason || null,
        bench_reason: c.benchReason || null,
        applied_at: iso(o.createdAt),
        // A move resets the clock; an unchanged stage keeps the one it had.
        stage_since: didMove || isNew ? now : (before?.stage_since ?? now),
        offer_sent_on: day(c.offerSentOn),
        start_date: day(c.startDate),
        agreed_comp: c.agreedComp || null,
        notes: c.notes || null,
        exited_at: EXIT_STAGES.includes(stage)
          ? didMove || isNew
            ? now
            : (before?.stage_since ?? now)
          : null,
        ghl_updated_at: iso(o.updatedAt),
        synced_at: now,
      });
      if (isNew)
        events.push({
          candidate_id: o.id,
          role: role.key,
          kind: "stage",
          from_stage: null,
          to_stage: stage,
          detail: "First seen on the board.",
          by_whom: "the sync",
        });
      else if (didMove)
        events.push({
          candidate_id: o.id,
          role: role.key,
          kind: "stage",
          from_stage: before?.stage ?? null,
          to_stage: stage,
          detail: `Moved to ${stageName(stage)}.`,
          by_whom: "the sync",
        });
    }
  }

  if (candidates.length)
    await upsertMerge("cockpit_hiring_candidates", candidates, "id");
  // Events are written after the candidates, so the foreign key always holds.
  if (events.length)
    await rest("cockpit_hiring_events", {
      method: "POST",
      body: events,
      prefer: "return=minimal",
    });

  return {
    ok: true,
    roles: perRole,
    moved,
    added,
    missingPipelines: m.missing,
  };
}

/** The sync, on a schedule and from the CLI. */
export const pull = internalAction({
  args: {},
  returns: v.any(),
  handler: async () => pullOnce(),
});

/** Re-read the GoHighLevel ids, after the setup builder has run. */
export const refreshIds = internalAction({
  args: {},
  returns: v.any(),
  handler: async () => {
    const m = await refreshMeta();
    return {
      location: m.location,
      pipelines: Object.keys(m.pipelines).length,
      stages: Object.keys(m.stageKeyById).length,
      fields: Object.keys(m.fields).length,
      missing: m.missing,
    };
  },
});

// --- Writing back to GoHighLevel ---------------------------------------------

/** Set custom fields on a candidate's contact, by spec key. */
export async function writeContactFields(
  contactId: string,
  values: Record<string, string | number | null>,
): Promise<void> {
  const m = await meta();
  const customFields = Object.entries(values)
    .filter(([key]) => m.fields[key])
    .map(([key, value]) => ({
      id: m.fields[key],
      value: value === null ? "" : String(value),
    }));
  if (!customFields.length) return;
  await ghlOk("PUT", `/contacts/${contactId}`, { body: { customFields } });
}

/** Move a candidate's card to another stage. */
export async function moveStage(
  opportunityId: string,
  role: RoleKey,
  stage: StageKey,
): Promise<void> {
  const m = await meta();
  const stageId = m.stageIdByKey[role]?.[stage];
  if (!stageId)
    throw new Error(
      `No ${stageName(stage)} stage on the ${role} pipeline; run the hiring setup again.`,
    );
  await ghlOk("PUT", `/opportunities/${opportunityId}`, {
    body: { pipelineStageId: stageId },
  });
}
