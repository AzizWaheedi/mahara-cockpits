/**
 * hermes/forms-relay: the Stage 4 relay (docs/forms/WAVE56-CONTRACT.md 3.8, 4.14.4, 6.1; X19).
 *
 * The native onboarding's two effects that leave Supabase are written here, on the VPS, through the
 * same Google service account the client-messages worker uses and a GitHub token read by name:
 *
 * - client_data_row: the card's row on the Client Data sheet. The sheet is read first; a row whose
 *   card column already holds the card is "sent, already there" and nothing is written. Otherwise one
 *   row is appended with the columns of CLIENT_DATA_COLUMNS (read from the saved Make 13 blueprint at
 *   D-S4.0) and the sheet is read again: found, sent; not found, unknown (never written again).
 * - github_dispatch: the repository_dispatch Make 13 [25] sends (event market_intel, the client name
 *   and the card id under the keys the blueprint names).
 *
 * The database decides what is claimed (cockpit_form_relay_claim asks the owner gate, so nothing runs
 * while Make owns the effect) and records every outcome (cockpit_form_relay_done): sent, failed (tried
 * again under three attempts), unknown (never tried again; a person checks) or skipped. The internal
 * test card 86eywg1cq is never written to the sheet or dispatched: its sheet row is the one people
 * made, and its dispatch would queue real market research.
 *
 * Switches: FORMS_RELAY_APPLY=true in ~/.forms-relay/switches.env, read only there. Off (the default),
 * a run claims nothing and prints what waits, in counts and keys, never a value. Every provider call
 * goes through the ledger (ledger.ts) into cockpit_csm_provider_health; each run writes one health row
 * (cockpit_sync_state forms-relay).
 */

export type Row = Record<string, any>;

export const TEST_CARD = "86eywg1cq";
export const HEALTH_KEY = "forms-relay";
export const CLAIM_LIMIT = 5;

export type Config = {
  sheetId: string;
  tab: string;
  /** The column letter that holds the card id (Make 13 [31]: C). */
  cardColumn: string;
  /** Column letter to source: task, client, submittedAt, kuwaitDay, answer:<typeform ref> or const:<text>. */
  columns: Record<string, string>;
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
  effectKey: "client_data_row" | "github_dispatch";
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
  already: "already there",
  canarySheet: "Canary on the test card: the Client Data row is not written.",
  canaryDispatch: "Canary on the test card: market intel is not dispatched.",
  notBack:
    "Google answered, but the row is not on Client Data yet. Check the sheet; it is not written again.",
  sheetUnsure:
    "Google did not answer the write clearly, so the row may be on the sheet. Check Client Data; it is not written again.",
  sheetRefused: (status: number) =>
    `Google refused the Client Data write (${status}).`,
  dispatched: "Dispatched.",
  dispatchRefused: (status: number) =>
    `GitHub refused the dispatch (${status}).`,
  dispatchUnsure:
    "GitHub did not answer the dispatch clearly, so it may have queued. Check the market intel runs; it is not sent again.",
  sheetUnread:
    "Client Data could not be read, so nothing was written; the next run tries again.",
} as const;

const LETTER = /^[A-Z]{1,2}$/;

/** A column letter's index from 0 (A = 0, Z = 25, AA = 26). */
export function columnIndex(letter: string): number {
  let n = 0;
  for (const c of letter) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

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
  const sheetId = need("CLIENT_DATA_SHEET_ID");
  const tab = need("CLIENT_DATA_TAB");
  const cardColumn = need("CLIENT_DATA_CARD_COLUMN").toUpperCase();
  const rawColumns = need("CLIENT_DATA_COLUMNS");
  const dispatchOwner = need("DISPATCH_OWNER");
  const dispatchRepo = need("DISPATCH_REPO");
  const dispatchEvent =
    String(values.DISPATCH_EVENT ?? "market_intel").trim() || "market_intel";
  const dispatchNameKey = need("DISPATCH_NAME_KEY");
  const dispatchIdKey = need("DISPATCH_ID_KEY");
  let columns: Record<string, string> = {};
  if (rawColumns) {
    try {
      const parsed = JSON.parse(rawColumns);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error("not an object");
      columns = Object.fromEntries(
        Object.entries(parsed).map(([k, v]) => [k.toUpperCase(), String(v)]),
      );
    } catch {
      problems.push(
        "CLIENT_DATA_COLUMNS is not a JSON object of column letters.",
      );
    }
  }
  if (cardColumn && !LETTER.test(cardColumn))
    problems.push("CLIENT_DATA_CARD_COLUMN is not a column letter.");
  for (const [letter, source] of Object.entries(columns)) {
    if (!LETTER.test(letter))
      problems.push(
        `CLIENT_DATA_COLUMNS names ${letter.slice(0, 4)}, which is not a column letter.`,
      );
    else if (
      !/^(task|client|submittedAt|kuwaitDay|answer:[0-9a-zA-Z-]{8,60}|const:.{0,200})$/.test(
        source,
      )
    )
      problems.push(
        `CLIENT_DATA_COLUMNS gives column ${letter} a source the relay does not know.`,
      );
  }
  if (
    cardColumn &&
    Object.keys(columns).length &&
    columns[cardColumn] !== "task"
  )
    problems.push(
      "CLIENT_DATA_COLUMNS must put the card id (task) in CLIENT_DATA_CARD_COLUMN.",
    );
  if (problems.length) return { config: null, problems };
  return {
    config: {
      sheetId,
      tab,
      cardColumn,
      columns,
      dispatchOwner,
      dispatchRepo,
      dispatchEvent,
      dispatchNameKey,
      dispatchIdKey,
    },
    problems,
  };
}

/** The Kuwait calendar day of a time, YYYY-MM-DD. */
export function kuwaitDay(at: string | undefined): string {
  const t = Date.parse(String(at ?? ""));
  return Number.isFinite(t)
    ? new Date(t + 3 * 3_600_000).toISOString().slice(0, 10)
    : "";
}

/** The Client Data row for one answer, from A to the last mapped column; unmapped columns stay empty. */
export function rowValues(config: Config, payload: Row): string[] {
  const letters = Object.keys(config.columns);
  const width = Math.max(...letters.map(columnIndex)) + 1;
  const out: string[] = Array.from({ length: width }, () => "");
  const answers: Row =
    payload?.answers && typeof payload.answers === "object"
      ? payload.answers
      : {};
  for (const letter of letters) {
    const source = config.columns[letter];
    const value =
      source === "task"
        ? payload?.taskId
        : source === "client"
          ? payload?.client
          : source === "submittedAt"
            ? payload?.submittedAt
            : source === "kuwaitDay"
              ? kuwaitDay(payload?.submittedAt)
              : source.startsWith("answer:")
                ? answers[source.slice(7)]
                : source.startsWith("const:")
                  ? source.slice(6)
                  : "";
    out[columnIndex(letter)] =
      value === undefined || value === null ? "" : String(value);
  }
  return out;
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

/** Whether Client Data already holds a row for the card in its card column. */
export function hasCardRow(
  values: unknown[][],
  cardColumn: string,
  taskId: string,
): boolean {
  const i = columnIndex(cardColumn);
  return values.some(
    r => Array.isArray(r) && String(r[i] ?? "").trim() === taskId,
  );
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
  sheet: {
    read: () => Promise<unknown[][]>;
    append: (row: string[]) => Promise<Answer>;
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

/** One run: claim, write each row once, settle it, one health row. */
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
    const keys = [
      deps.config
        ? `Client Data columns ${Object.keys(deps.config.columns).join(", ")}`
        : "Client Data columns not set",
      deps.config
        ? `dispatch keys ${deps.config.dispatchNameKey}, ${deps.config.dispatchIdKey}`
        : "dispatch keys not set",
    ].join("; ");
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
  let sheet: unknown[][] | null = null;
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
    if (row.effectKey === "github_dispatch") {
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
      continue;
    }
    // client_data_row: the sheet is read first, every time a run meets a row.
    try {
      sheet ??= await deps.sheet.read();
    } catch {
      await done(row, "failed", SAY.sheetUnread);
      continue;
    }
    if (hasCardRow(sheet, config.cardColumn, row.taskId)) {
      await done(row, "sent", SAY.already, { already: true });
      continue;
    }
    if (row.taskId === TEST_CARD) {
      await done(row, "skipped", SAY.canarySheet);
      continue;
    }
    const a = await deps.sheet.append(rowValues(config, row.payload));
    if (!a.ok) {
      if (a.definite)
        await done(row, "failed", SAY.sheetRefused(a.status), {
          status: a.status,
        });
      else await done(row, "unknown", SAY.sheetUnsure, { status: a.status });
      continue;
    }
    try {
      sheet = await deps.sheet.read();
    } catch {
      sheet = null;
    }
    if (sheet && hasCardRow(sheet, config.cardColumn, row.taskId))
      await done(row, "sent", "Written.", { status: a.status });
    else await done(row, "unknown", SAY.notBack, { status: a.status });
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
