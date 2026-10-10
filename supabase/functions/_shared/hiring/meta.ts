/**
 * The GoHighLevel ids every hiring job needs: the pipeline per role, the
 * stage key per stage id, and the custom field id per spec key. Read from
 * GoHighLevel (reads only) and cached in cockpit_hiring_meta "ghl-ids" for an
 * hour, the same cache the Convex sync kept.
 */

import type { Ctx } from "./context.ts";
import { type Any, GateError } from "./providers.ts";
import { FIELDS, ROLES, type StageKey, stageKeyOnBoard } from "./spec.ts";

export type Meta = {
  location: string;
  pipelines: Record<string, string>;
  stageKeyById: Record<string, StageKey>;
  stageIdByKey: Record<string, Record<string, string>>;
  fields: Record<string, string>;
  /** Role labels whose pipeline is missing, so a screen can say so. */
  missing: string[];
  at: number;
};

export const META_KEY = "ghl-ids";
const MAX_AGE_MS = 60 * 60_000;

type Pipeline = { id: string; name: string; stages: { id: string; name: string }[] };

export const parsePipelines = (body: Any): Pipeline[] =>
  (body?.pipelines ?? []).map((p: Any) => ({
    id: String(p.id),
    name: String(p.name ?? ""),
    stages: (p.stages ?? []).map((s: Any) => ({ id: String(s.id), name: String(s.name ?? "") })),
  }));

export const parseFields = (body: Any): { id: string; name: string }[] =>
  (body?.customFields ?? []).map((f: Any) => ({ id: String(f.id), name: String(f.name ?? "") }));

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Match the board to the spec by name. Pure. */
export function buildMeta(
  location: string,
  pipelines: Pipeline[],
  fields: { id: string; name: string }[],
  at: number,
): Meta {
  const meta: Meta = {
    location,
    pipelines: {},
    stageKeyById: {},
    stageIdByKey: {},
    fields: {},
    missing: [],
    at,
  };
  for (const role of ROLES) {
    const p = pipelines.find(x => same(x.name, role.pipeline));
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
    const found = fields.find(x => same(x.name, f.name));
    if (found) meta.fields[f.key] = found.id;
  }
  return meta;
}

export function requireGhl(ctx: Ctx) {
  if (!ctx.ghl)
    throw new GateError(
      "The hiring sub-account is not connected: set GHL_HIRING_PIT and GHL_HIRING_LOCATION as Edge Function secrets.",
    );
  return ctx.ghl;
}

/** The cached ids, re-read when missing, older than an hour, or for another location. */
export async function loadMeta(ctx: Ctx, force = false): Promise<Meta> {
  const ghl = requireGhl(ctx);
  const now = ctx.now().getTime();
  if (!force) {
    const cached = (await ctx.store.getMeta(META_KEY)) as Meta | null;
    if (cached?.at && cached.location === ghl.location && now - cached.at < MAX_AGE_MS)
      return cached;
  }
  const loc = encodeURIComponent(ghl.location);
  const [p, f] = await Promise.all([
    ghl.readOk(`/opportunities/pipelines?locationId=${loc}`),
    ghl.readOk(`/locations/${loc}/customFields?model=contact`),
  ]);
  const meta = buildMeta(ghl.location, parsePipelines(p), parseFields(f), now);
  await ctx.store.putMeta(META_KEY, meta);
  // The roles as the spec describes them, for the recruiting agent on the
  // VPS (ideation-radar radar/hiring.py), so it scores against the same
  // scorecard the cockpit shows.
  await ctx.store.putMeta("roles", {
    at: now,
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
  });
  return meta;
}
