/**
 * Everything the hiring jobs read and write in Creative Triage
 * (bldgtotkfmhoxmlzowdx), behind one interface so the tests can hand in a
 * fake. The real one talks to PostgREST with the service role key, which is
 * the only door to these tables.
 */

import { type HealthRow, redact } from "./providers.ts";

// deno-lint-ignore no-explicit-any
export type Row = Record<string, any>;

export type Job = "mirror" | "intake" | "engine";
export type Trigger = "schedule" | "refreshNow";

export type AuditRow = {
  action: string;
  entity_type: string;
  entity_id: string | null;
  actor_email: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: Row;
};

export type SendRow = {
  event_id: number;
  candidate_id: string;
  actor_email: string;
  status: "refused" | "claimed" | "sent" | "failed";
  rails?: string[];
  detail?: string | null;
};

export interface Store {
  getMeta(key: string): Promise<unknown | null>;
  putMeta(key: string, value: unknown): Promise<void>;
  /** Every candidate, every page, with the columns the mirror merges. */
  candidates(): Promise<Row[]>;
  candidate(id: string): Promise<Row | null>;
  candidatesByIds(ids: string[]): Promise<Row[]>;
  upsertCandidates(rows: Row[]): Promise<void>;
  patchCandidate(id: string, patch: Row): Promise<void>;
  insertEvents(rows: Row[]): Promise<void>;
  /** The newest real moves (a stage event with a from_stage). */
  stageMoves(limit: number): Promise<Row[]>;
  /** candidate_id and action of every message already sent or drafted. */
  actedOrDrafted(): Promise<Row[]>;
  /** Drafts not yet sent, newest first. */
  drafts(limit: number): Promise<Row[]>;
  event(id: number): Promise<Row | null>;
  patchEvent(id: number, patch: Row): Promise<void>;
  upsertApplication(row: Row): Promise<void>;
  /** The run lock: a run id, or null when this job is already running. */
  claimRun(job: Job, trigger: Trigger, actor: string | null, apply: boolean): Promise<string | null>;
  finishRun(id: string, status: "ok" | "failed", result: unknown, error: string | null): Promise<void>;
  syncState(key: string, patch: Row): Promise<void>;
  health(row: HealthRow & { run_id: string | null; actor_email: string | null }): Promise<void>;
  audit(row: AuditRow): Promise<void>;
  /** Draft ids that have a send claimed or done. */
  liveSends(eventIds: number[]): Promise<number[]>;
  /** The send lock: a send id, or null when this draft is already claimed or sent. */
  claimSend(row: SendRow): Promise<number | null>;
  recordSend(row: SendRow): Promise<void>;
  finishSend(id: number, patch: Row): Promise<void>;
}

export class StoreError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** The columns the mirror reads back so a merge can keep what people wrote. */
export const HELD_COLUMNS = [
  "id",
  "stage",
  "stage_since",
  "exited_at",
  "name",
  "country",
  "source",
  "years_experience",
  "arabic",
  "portfolio_url",
  "loom_url",
  "test_project_url",
  "score_application",
  "score_loom",
  "score_group",
  "score_one_to_one",
  "score_test_project",
  "disqualify_reason",
  "bench_reason",
  "offer_sent_on",
  "start_date",
  "agreed_comp",
  "notes",
];

const enc = encodeURIComponent;
const PAGE = 1000;

export function restStore(o: { url: string; key: string; fetch?: typeof fetch }): Store {
  const base = o.url.replace(/\/+$/, "");
  const doFetch = o.fetch ?? fetch;

  async function rest(
    path: string,
    init: { method?: string; body?: unknown; prefer?: string } = {},
  ): Promise<Row[] | Row | null> {
    const res = await doFetch(`${base}/rest/v1/${path}`, {
      method: init.method ?? "GET",
      headers: {
        apikey: o.key,
        Authorization: `Bearer ${o.key}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(init.prefer ? { Prefer: init.prefer } : {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const text = await res.text();
    if (!res.ok)
      throw new StoreError(
        res.status,
        `Supabase ${res.status} on ${path.split("?")[0]}: ${redact(text).slice(0, 200)}`,
      );
    return text ? JSON.parse(text) : null;
  }
  const rows = async (path: string) => ((await rest(path)) ?? []) as Row[];
  /** Every page, so a table past PostgREST's row cap is read whole. */
  async function paged(path: string, cap = 50_000): Promise<Row[]> {
    const out: Row[] = [];
    for (let offset = 0; offset < cap; offset += PAGE) {
      const batch = await rows(`${path}&limit=${PAGE}&offset=${offset}`);
      out.push(...batch);
      if (batch.length < PAGE) return out;
    }
    throw new Error(`More than ${cap} rows in ${path.split("?")[0]}; the read stopped rather than guess.`);
  }
  const minimal = "return=minimal";
  const merge = "resolution=merge-duplicates,return=minimal";
  const chunks = <T>(xs: T[], n = 200): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
    return out;
  };
  const inList = (ids: (string | number)[]) =>
    `(${ids.map(i => `"${String(i).replace(/"/g, "")}"`).join(",")})`;

  return {
    async getMeta(key) {
      const r = await rows(`cockpit_hiring_meta?key=eq.${enc(key)}&select=value&limit=1`);
      return r[0]?.value ?? null;
    },
    async putMeta(key, value) {
      await rest("cockpit_hiring_meta?on_conflict=key", {
        method: "POST",
        body: [{ key, value, updated_at: new Date().toISOString() }],
        prefer: merge,
      });
    },
    candidates: () =>
      paged(`cockpit_hiring_candidates?select=${HELD_COLUMNS.join(",")}&order=id`),
    async candidate(id) {
      const r = await rows(`cockpit_hiring_candidates?id=eq.${enc(id)}&select=*&limit=1`);
      return r[0] ?? null;
    },
    async candidatesByIds(ids) {
      if (!ids.length) return [];
      const out: Row[] = [];
      for (const part of chunks(ids, 100))
        out.push(
          ...(await rows(
            `cockpit_hiring_candidates?id=in.${enc(inList(part))}&select=id,contact_id,name,role,stage,stage_name`,
          )),
        );
      return out;
    },
    async upsertCandidates(list) {
      for (const part of chunks(list))
        await rest("cockpit_hiring_candidates?on_conflict=id", {
          method: "POST",
          body: part,
          prefer: merge,
        });
    },
    async patchCandidate(id, patch) {
      await rest(`cockpit_hiring_candidates?id=eq.${enc(id)}`, {
        method: "PATCH",
        body: patch,
        prefer: minimal,
      });
    },
    async insertEvents(list) {
      for (const part of chunks(list))
        await rest("cockpit_hiring_events", { method: "POST", body: part, prefer: minimal });
    },
    stageMoves: limit =>
      rows(
        `cockpit_hiring_events?kind=eq.stage&from_stage=not.is.null&select=candidate_id,role,to_stage,at&order=at.desc&limit=${limit}`,
      ),
    actedOrDrafted: () =>
      paged(
        `cockpit_hiring_events?kind=eq.action&or=${enc("(ok.is.true,detail.like.Drafted*)")}&select=candidate_id,action&order=id`,
      ),
    drafts: limit =>
      rows(
        `cockpit_hiring_events?kind=eq.action&ok=is.false&detail=like.${enc("Drafted*")}&select=id,candidate_id,role,action,to_stage,detail,at&order=at.desc&limit=${limit}`,
      ),
    async event(id) {
      const r = await rows(
        `cockpit_hiring_events?id=eq.${Number(id)}&select=id,candidate_id,role,kind,action,to_stage,detail,ok&limit=1`,
      );
      return r[0] ?? null;
    },
    async patchEvent(id, patch) {
      await rest(`cockpit_hiring_events?id=eq.${Number(id)}`, {
        method: "PATCH",
        body: patch,
        prefer: minimal,
      });
    },
    async upsertApplication(row) {
      await rest("cockpit_hiring_applications?on_conflict=contact_id", {
        method: "POST",
        body: [row],
        prefer: merge,
      });
    },
    async claimRun(job, trigger, actor, apply) {
      const id = await rest("rpc/cockpit_hiring_claim_run", {
        method: "POST",
        body: { p_job: job, p_trigger: trigger, p_actor: actor, p_apply: apply },
      });
      return typeof id === "string" && id ? id : null;
    },
    async finishRun(id, status, result, error) {
      await rest(`cockpit_hiring_runs?id=eq.${enc(id)}&status=eq.running`, {
        method: "PATCH",
        body: { status, result: result ?? null, error, finished_at: new Date().toISOString() },
        prefer: minimal,
      });
    },
    async syncState(key, patch) {
      const now = new Date().toISOString();
      await rest("cockpit_sync_state?on_conflict=key", {
        method: "POST",
        body: [{ key, updated_at: now, ...patch }],
        prefer: merge,
      });
    },
    async health(row) {
      await rest("cockpit_hiring_provider_health", { method: "POST", body: [row], prefer: minimal });
    },
    async audit(row) {
      await rest("cockpit_audit_log", {
        method: "POST",
        body: [
          {
            action: row.action,
            entity_type: row.entity_type,
            entity_id: row.entity_id,
            actor_email: row.actor_email,
            source_app: "ceo",
            source_system: "supabase-edge:hiring",
            before: row.before ?? null,
            after: row.after ?? null,
            metadata: row.metadata ?? {},
          },
        ],
        prefer: minimal,
      });
    },
    async liveSends(eventIds) {
      if (!eventIds.length) return [];
      const r = await rows(
        `cockpit_hiring_sends?event_id=in.${enc(inList(eventIds))}&status=in.(claimed,sent)&select=event_id`,
      );
      return r.map(x => Number(x.event_id));
    },
    async claimSend(row) {
      try {
        const r = (await rest("cockpit_hiring_sends", {
          method: "POST",
          body: [row],
          prefer: "return=representation",
        })) as Row[];
        return Number(r?.[0]?.id) || null;
      } catch (e) {
        // The partial unique index says this draft is already claimed or sent.
        if (e instanceof StoreError && e.status === 409) return null;
        throw e;
      }
    },
    async recordSend(row) {
      await rest("cockpit_hiring_sends", { method: "POST", body: [row], prefer: minimal });
    },
    async finishSend(id, patch) {
      await rest(`cockpit_hiring_sends?id=eq.${Number(id)}&status=eq.claimed`, {
        method: "PATCH",
        body: { ...patch, finished_at: new Date().toISOString() },
        prefer: minimal,
      });
    },
  };
}
