/**
 * Job "mirror": the GoHighLevel hiring board into Supabase, every 10 minutes.
 *
 * Ported from apps/media-buyer-cockpit/convex/hiring/sync.ts (pullOnce). It
 * only reads GoHighLevel. Every candidate becomes a row in
 * cockpit_hiring_candidates and every move a row in cockpit_hiring_events,
 * which is what the engine reads.
 *
 * Two changes from Convex, both to keep what people wrote:
 * - A contact that was not read this run (a failed page) keeps the mirror's
 *   values. Convex wrote nulls over them.
 * - A score, note or reason that the mirror holds is not replaced by an
 *   empty GoHighLevel field. The count of such fields is reported as "kept",
 *   so drift between the two shows up instead of hiding.
 * Rows are never deleted, agent_* columns are never written, and events are
 * only ever added.
 */

import type { Ctx } from "./context.ts";
import { loadMeta, requireGhl } from "./meta.ts";
import type { Any, Ghl } from "./providers.ts";
import { EXIT_STAGES, ROLES, type Role, type StageKey, stageName } from "./spec.ts";
import type { Row } from "./store.ts";

export type Opp = {
  id: string;
  contactId: string;
  name: string;
  stageId: string;
  createdAt: string | null;
  updatedAt: string | null;
};

export const num = (s: unknown): number | null => {
  const t = String(s ?? "").trim();
  const n = Number(t);
  return t !== "" && Number.isFinite(n) ? n : null;
};
const text = (s: unknown): string | null => {
  const t = String(s ?? "").trim();
  return t ? t : null;
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
export function totalScore(scores: (number | null | undefined)[]): number | null {
  const given = scores.filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  if (!given.length) return null;
  return Math.round((given.reduce((t, n) => t + n, 0) / given.length) * 10) / 10;
}

/** One GoHighLevel opportunity, as the mirror needs it. */
export const parseOpp = (o: Any): Opp => ({
  id: String(o.id),
  contactId: String(o.contact?.id ?? o.contactId ?? ""),
  name: String(o.contact?.name ?? o.name ?? "").trim(),
  stageId: String(o.pipelineStageId ?? ""),
  createdAt: o.createdAt ? String(o.createdAt) : null,
  updatedAt: o.updatedAt ? String(o.updatedAt) : null,
});

/** One contact, with its custom field values flattened onto the spec keys. */
export function contactFlat(c: Any, keyOf: Map<string, string>): Record<string, string> {
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
  return flat;
}

/** Candidate columns that come from the contact: what people write and grade. */
const FROM_CONTACT: [string, (c: Record<string, string>) => string | number | null][] = [
  ["country", c => text(c.country)],
  ["source", c => text(c.source)],
  ["years_experience", c => num(c.yearsExperience)],
  ["arabic", c => text(c.arabic)],
  ["portfolio_url", c => text(c.portfolio)],
  ["loom_url", c => text(c.loomUrl)],
  ["test_project_url", c => text(c.testProjectUrl)],
  ["score_application", c => num(c.scoreApplication)],
  ["score_loom", c => num(c.scoreLoom)],
  ["score_group", c => num(c.scoreGroup)],
  ["score_one_to_one", c => num(c.scoreOneToOne)],
  ["score_test_project", c => num(c.scoreTestProject)],
  ["disqualify_reason", c => text(c.disqualifyReason)],
  ["bench_reason", c => text(c.benchReason)],
  ["offer_sent_on", c => day(c.offerSentOn)],
  ["start_date", c => day(c.startDate)],
  ["agreed_comp", c => text(c.agreedComp)],
  ["notes", c => text(c.notes)],
];

const present = (v: unknown) => v !== null && v !== undefined && String(v).trim() !== "";

/**
 * The row the mirror writes for one card, merged over what it already holds.
 * Pure: the whole merge rule is here and in the tests.
 */
export function mergeCandidate(input: {
  opp: Opp;
  role: Role;
  location: string;
  pipelineId: string;
  stage: StageKey;
  /** Undefined when this contact was not read this run. */
  contact: Record<string, string> | undefined;
  prev: Row | undefined;
  now: string;
}): { row: Row; isNew: boolean; moved: boolean; kept: string[] } {
  const { opp, role, contact, prev, stage, now } = input;
  const isNew = !prev;
  const moved = Boolean(prev && String(prev.stage) !== stage);
  const kept: string[] = [];
  const human: Row = {};
  for (const [col, read] of FROM_CONTACT) {
    const fromGhl = contact ? read(contact) : null;
    const held = prev?.[col];
    if (present(fromGhl)) human[col] = fromGhl;
    else {
      human[col] = present(held) ? held : null;
      if (contact && present(held)) kept.push(col);
    }
  }
  const since = moved || isNew ? now : (prev?.stage_since ?? now);
  const row: Row = {
    id: opp.id,
    contact_id: opp.contactId,
    location_id: input.location,
    role: role.key,
    role_label: role.label,
    pipeline_id: input.pipelineId,
    stage,
    stage_name: stageName(stage),
    name: opp.name || contact?.name || String(prev?.name ?? ""),
    ...human,
    score_total: totalScore([
      human.score_application,
      human.score_loom,
      human.score_group,
      human.score_one_to_one,
      human.score_test_project,
    ].map(x => (x === null || x === undefined ? null : Number(x)))),
    applied_at: iso(opp.createdAt),
    // A move resets the clock; an unchanged stage keeps the one it had.
    stage_since: since,
    exited_at: EXIT_STAGES.includes(stage)
      ? (moved || isNew ? now : (prev?.exited_at ?? since))
      : null,
    ghl_updated_at: iso(opp.updatedAt),
    synced_at: now,
  };
  return { row, isNew, moved, kept };
}

/** The history rows one card's merge adds. */
export function eventsFor(
  r: { row: Row; isNew: boolean; moved: boolean },
  prevStage: string | null,
): Row[] {
  if (r.isNew)
    return [{
      candidate_id: r.row.id,
      role: r.row.role,
      kind: "stage",
      from_stage: null,
      to_stage: r.row.stage,
      detail: "First seen on the board.",
      by_whom: "the sync",
    }];
  if (r.moved)
    return [{
      candidate_id: r.row.id,
      role: r.row.role,
      kind: "stage",
      from_stage: prevStage,
      to_stage: r.row.stage,
      detail: `Moved to ${stageName(r.row.stage)}.`,
      by_whom: "the sync",
    }];
  return [];
}

/** Every opportunity in one pipeline, all statuses. A failed first page is an error. */
async function opportunities(
  ghl: Ghl,
  pipelineId: string,
): Promise<{ opps: Opp[]; complete: boolean }> {
  const out: Opp[] = [];
  const loc = encodeURIComponent(ghl.location);
  for (let page = 1; page <= 20; page++) {
    const r = await ghl.read(
      `/opportunities/search?location_id=${loc}&pipeline_id=${encodeURIComponent(pipelineId)}&limit=100&page=${page}`,
    );
    if (r.status !== 200) {
      if (page === 1)
        throw new Error(`GoHighLevel answered ${r.status} for the board's first page.`);
      return { opps: out, complete: false };
    }
    const rows: Any[] = r.body?.opportunities ?? [];
    out.push(...rows.map(parseOpp));
    if (rows.length < 100) return { opps: out, complete: true };
  }
  return { opps: out, complete: false };
}

/**
 * Every contact in the hiring sub-account. GoHighLevel pages contacts on the
 * last id plus the last dateAdded in epoch milliseconds; the ISO string it
 * hands back stalls the cursor (Convex, 2026-09-22).
 */
async function contacts(
  ghl: Ghl,
  fieldIds: Record<string, string>,
): Promise<{ byId: Map<string, Record<string, string>>; complete: boolean }> {
  const byId = new Map<string, Record<string, string>>();
  const keyOf = new Map<string, string>();
  for (const [key, id] of Object.entries(fieldIds)) keyOf.set(id, key);
  let startAfterId = "";
  let startAfter = 0;
  const seen = new Set<string>();
  for (let page = 0; page < 40; page++) {
    const q = new URLSearchParams({ locationId: ghl.location, limit: "100" });
    if (startAfterId) q.set("startAfterId", startAfterId);
    if (startAfter) q.set("startAfter", String(startAfter));
    const r = await ghl.read(`/contacts/?${q}`);
    if (r.status !== 200) return { byId, complete: false };
    const rows: Any[] = r.body?.contacts ?? [];
    // A cursor that does not move would page for ever over the same hundred.
    if (rows.length && rows.every(c => seen.has(String(c.id)))) return { byId, complete: false };
    for (const c of rows) {
      seen.add(String(c.id));
      byId.set(String(c.id), contactFlat(c, keyOf));
    }
    if (rows.length < 100) return { byId, complete: true };
    const last = rows[rows.length - 1];
    startAfterId = String(last?.id ?? "");
    const added = Date.parse(String(last?.dateAdded ?? ""));
    startAfter = Number.isFinite(added) ? added : 0;
    if (!startAfterId) return { byId, complete: false };
  }
  return { byId, complete: false };
}

export type PullResult = {
  ok: boolean;
  roles: { role: string; candidates: number | null; complete?: boolean; error?: string }[];
  added: number;
  moved: number;
  kept: number;
  contactsComplete: boolean;
  missingPipelines: string[];
  error?: string;
};

export async function runMirror(ctx: Ctx): Promise<PullResult> {
  const ghl = requireGhl(ctx);
  const m = await loadMeta(ctx);
  const { byId, complete } = await contacts(ghl, m.fields);
  const held = new Map<string, Row>();
  for (const r of await ctx.store.candidates()) held.set(String(r.id), r);

  const now = ctx.now().toISOString();
  const rows: Row[] = [];
  const events: Row[] = [];
  const result: PullResult = {
    ok: true,
    roles: [],
    added: 0,
    moved: 0,
    kept: 0,
    contactsComplete: complete,
    missingPipelines: m.missing,
  };
  for (const role of ROLES) {
    const pipelineId = m.pipelines[role.key];
    if (!pipelineId) continue;
    let opps: Opp[];
    try {
      const read = await opportunities(ghl, pipelineId);
      opps = read.opps;
      result.roles.push({ role: role.key, candidates: opps.length, complete: read.complete });
    } catch (e) {
      // Missing is never zero: this role's count is unknown, not nought.
      result.roles.push({ role: role.key, candidates: null, error: (e as Error).message });
      result.ok = false;
      continue;
    }
    for (const opp of opps) {
      const prev = held.get(opp.id);
      const merged = mergeCandidate({
        opp,
        role,
        location: ghl.location,
        pipelineId,
        stage: m.stageKeyById[opp.stageId] ?? "application",
        contact: byId.get(opp.contactId),
        prev,
        now,
      });
      if (merged.isNew) result.added += 1;
      if (merged.moved) result.moved += 1;
      result.kept += merged.kept.length;
      rows.push(merged.row);
      events.push(...eventsFor(merged, prev ? String(prev.stage) : null));
      // A card read twice in one run (two pipelines) is merged once.
      held.set(opp.id, { ...merged.row });
    }
  }
  // Last write wins inside one batch, so a card is upserted once.
  const unique = [...new Map(rows.map(r => [r.id, r])).values()];
  if (unique.length) await ctx.store.upsertCandidates(unique);
  // Events after candidates, so the foreign key always holds.
  if (events.length) await ctx.store.insertEvents(events);
  if (!result.ok)
    result.error = result.roles
      .filter(r => r.error)
      .map(r => `${r.role}: ${r.error}`)
      .join("; ");
  return result;
}
