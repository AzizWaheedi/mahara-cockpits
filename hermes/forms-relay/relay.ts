/**
 * hermes/forms-relay: the Stage 4 relay (docs/forms/WAVE56-CONTRACT.md 3.8, 4.14.4, 6.1; X19).
 *
 * The native onboarding's one effect that leaves Supabase is sent here, on the VPS, with a GitHub token
 * read by name:
 *
 * - github_dispatch: the repository_dispatch Make 13 [25] sends (event market_intel, the client name
 *   and the card id under the keys the blueprint names).
 *
 * Nothing here writes Client Data. D-S4.0 read the saved Make 13 blueprint: its module [31] only searches
 * Client Data for the card's row, and no Make scenario writes one, so 20261102l took client_data_row out
 * of the native onboarding and the outbox takes only github_dispatch. A claimed row of any other effect
 * is skipped with a sentence and sent nowhere.
 *
 * The database decides what is claimed (cockpit_form_relay_claim asks the owner gate, so nothing runs
 * while Make owns the effect) and records every outcome (cockpit_form_relay_done): sent, failed (tried
 * again under three attempts), unknown (never tried again; a person checks) or skipped. The internal
 * test card 86eywg1cq is never dispatched: its dispatch would queue real market research.
 *
 * Switches: FORMS_RELAY_APPLY=true in ~/.forms-relay/switches.env, read only there. Off (the default),
 * a run claims nothing and prints what waits, in counts and keys, never a value. Every provider call
 * goes through the ledger (providers.ts) into cockpit_csm_provider_health; each run writes one health
 * row (cockpit_sync_state forms-relay).
 */

export type Row = Record<string, any>;

export const TEST_CARD = "86eywg1cq";
export const HEALTH_KEY = "forms-relay";
export const CLAIM_LIMIT = 5;
/** The one effect the relay sends (the outbox's CHECK takes no other since 20261102l). */
export const DISPATCH = "github_dispatch";

export type Config = {
  dispatchOwner: string;
  dispatchRepo: string;
  dispatchEvent: string;
  /** The client_payload keys Make 13 [25] sends, for the client name and the card id. */
  dispatchNameKey: string;
  dispatchIdKey: string;
};

export type RelayRow = {
  id: number;
  claim: string;
  /** github_dispatch; anything else is skipped and sent nowhere. */
  effectKey: string;
  taskId: string;
  responseId: string;
  payload: Row;
  attempts: number;
};

export type Outcome = "sent" | "failed" | "unknown" | "skipped";

export const SAY = {
  nothing: "Nothing to relay.",
  dry: (n: number, keys: string) =>
    `Dry run: ${n} ${n === 1 ? "row waits" : "rows wait"} (${keys}). Nothing was sent: FORMS_RELAY_APPLY is not true.`,
  uncounted:
    "The relay outbox could not be counted, so it is not reported as empty.",
  config: (problems: string[]) =>
    `The relay is not set up: ${problems.join(" ")} Nothing was claimed.`,
  notDispatch:
    "This row is not the market intel dispatch, so the relay sent nothing for it. Check why it was queued.",
  canaryDispatch: "Canary on the test card: market intel is not dispatched.",
  dispatched: "Dispatched.",
  dispatchRefused: (status: number) =>
    `GitHub refused the dispatch (${status}).`,
  dispatchUnsure:
    "GitHub did not answer the dispatch clearly, so it may have queued. Check the market intel runs; it is not sent again.",
} as const;

/** ~/.forms-relay/config.env as a Config, or the plain sentences of what is missing (never a value). */
export function readConfig(values: Record<string, string | undefined>): {
  config: Config | null;
  problems: string[];
} {
  const problems: string[] = [];
  const need = (k: string) => {
    const v = String(values[k] ?? "").trim();
    if (!v) problems.push(`${k} is not set in ~/.forms-relay/config.env.`);
    return v;
  };
  const dispatchOwner = need("DISPATCH_OWNER");
  const dispatchRepo = need("DISPATCH_REPO");
  const dispatchEvent =
    String(values.DISPATCH_EVENT ?? "market_intel").trim() || "market_intel";
  const dispatchNameKey = need("DISPATCH_NAME_KEY");
  const dispatchIdKey = need("DISPATCH_ID_KEY");
  if (problems.length) return { config: null, problems };
  return {
    config: {
      dispatchOwner,
      dispatchRepo,
      dispatchEvent,
      dispatchNameKey,
      dispatchIdKey,
    },
    problems,
  };
}

/** The repository_dispatch body (Make 13 [25]): the event and the client name and card id under the blueprint's keys. */
export function dispatchBody(config: Config, payload: Row): Row {
  return {
    event_type: config.dispatchEvent,
    client_payload: {
      [config.dispatchNameKey]: String(payload?.client ?? ""),
      [config.dispatchIdKey]: String(payload?.taskId ?? ""),
    },
  };
}

/** What one provider call answered: ok, a definite refusal (nothing landed), or not clear (it may have landed). */
export type Answer =
  | { ok: true; status: number }
  | { ok: false; status: number; definite: boolean };

export type Deps = {
  apply: boolean;
  config: Config | null;
  configProblems: string[];
  db: {
    rpc: <T = any>(name: string, args?: Row) => Promise<T>;
    health: (h: {
      key: string;
      ok: boolean;
      note: string;
      detail: Row;
    }) => Promise<void>;
  };
  github: { dispatch: (body: Row) => Promise<Answer> };
};

export type Report = {
  ok: boolean;
  note: string;
  counts: Record<Outcome | "claimed", number>;
};

/** A definite refusal is a 4xx other than 408 and 429: nothing landed, so a later try may write. */
export const definite = (status: number) =>
  status >= 400 && status < 500 && status !== 408 && status !== 429;

/** One run: claim, send each dispatch once, settle it, one health row. */
export async function runOnce(deps: Deps): Promise<Report> {
  const counts: Report["counts"] = {
    claimed: 0,
    sent: 0,
    failed: 0,
    unknown: 0,
    skipped: 0,
  };
  const finish = async (
    ok: boolean,
    note: string,
    detail: Row = {},
  ): Promise<Report> => {
    await deps.db
      .health({
        key: HEALTH_KEY,
        ok,
        note: note.slice(0, 500),
        detail: { ...detail, counts, apply: deps.apply },
      })
      .catch(() => {});
    return { ok, note, counts };
  };
  if (!deps.apply) {
    let byState: Row | null = null;
    try {
      byState =
        ((await deps.db.rpc("cockpit_form_relay_counts")) as Row)?.byState ??
        {};
    } catch {
      byState = null;
    }
    if (byState === null) return finish(false, SAY.uncounted);
    const waiting =
      (Number(byState.queued) || 0) + (Number(byState.failed) || 0);
    if (!waiting) return finish(true, SAY.nothing);
    const keys = deps.config
      ? `dispatch keys ${deps.config.dispatchNameKey}, ${deps.config.dispatchIdKey}`
      : "dispatch keys not set";
    return finish(true, SAY.dry(waiting, keys), { waiting });
  }
  if (!deps.config) return finish(false, SAY.config(deps.configProblems));
  const config = deps.config;
  const claimed = (
    (await deps.db.rpc("cockpit_form_relay_claim", {
      p_limit: CLAIM_LIMIT,
    })) as Row
  )?.rows;
  const rows: RelayRow[] = Array.isArray(claimed) ? claimed : [];
  counts.claimed = rows.length;
  if (!rows.length) return finish(true, SAY.nothing);
  const done = async (
    row: RelayRow,
    outcome: Outcome,
    reason: string,
    extra: Row = {},
  ) => {
    counts[outcome] += 1;
    await deps.db.rpc("cockpit_form_relay_done", {
      p_id: row.id,
      p_claim: row.claim,
      p_outcome: outcome,
      p_detail: { reason, ...extra },
    });
  };
  for (const row of rows) {
    if (row.effectKey !== DISPATCH) {
      await done(row, "skipped", SAY.notDispatch);
      continue;
    }
    if (row.taskId === TEST_CARD) {
      await done(row, "skipped", SAY.canaryDispatch);
      continue;
    }
    const a = await deps.github.dispatch(dispatchBody(config, row.payload));
    if (a.ok) await done(row, "sent", SAY.dispatched, { status: a.status });
    else if (a.definite)
      await done(row, "failed", SAY.dispatchRefused(a.status), {
        status: a.status,
      });
    else await done(row, "unknown", SAY.dispatchUnsure, { status: a.status });
  }
  const ok = counts.failed === 0 && counts.unknown === 0;
  const parts = (["sent", "skipped", "failed", "unknown"] as const)
    .filter(k => counts[k])
    .map(k => `${counts[k]} ${k}`);
  return finish(
    ok,
    `Relayed ${rows.length} ${rows.length === 1 ? "row" : "rows"}: ${parts.join(", ")}.`,
  );
}
