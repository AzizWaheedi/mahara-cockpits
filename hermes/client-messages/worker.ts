/**
 * hermes/client-messages: the only WhatsApp sender of client recaps
 * (docs/forms/STAGE2B-CONTRACT.md 4.3, 3b; Z26, Z27, Z59, Z60, Z66, Z67).
 *
 *   bun hermes/client-messages/worker.ts doctor [--task <card>]
 *   bun hermes/client-messages/worker.ts run [--report <path>]
 *   bun hermes/client-messages/worker.ts g5 --task <card> --at <iso> [--task ... --at ...]
 *
 * A person approves the exact text in the cockpit (recap.approve); this worker
 * claims it, checks the client's group on Client Data and on the card, waits
 * 30 to 120 seconds, asks the database again just before the one POST (the
 * owner gate, Z66), sends it once, records WhatsApp's answer and reads it back.
 * An `unknown` is never sent again: a later run looks for it in the group by
 * its fingerprint, and a person settles what is not found.
 *
 * Two switches must both be on to send: the checkin registry's recap owner
 * (the database refuses every approval and claim while Make owns it) and
 * CLIENT_MESSAGES_APPLY=true in ~/.client-messages/switches.env, read only
 * there (Z60). Keys come by name, first file wins, from
 * CLIENT_MESSAGES_ENV_FILES; a switch in a key file is never read, nor is
 * AD_BILLING_APPLY. Dry mode (the default) runs the message sweep and writes
 * nothing else but its health row (Z67).
 *
 * The cron gives a run 300 seconds: it claims only while at least 200 remain,
 * the reconcile and read-back steps stop after 90 (Z59), and the intent and
 * the one POST start only while at least 80 seconds remain (the intent's 30,
 * the POST's 20 and the result's 30, each at its own limit), so the cron's kill
 * never lands mid-send and turns a delivered recap into `unknown`; the 30 to
 * 120 second wait is cut to fit, or the claim is released for the next run.
 *
 * ClickUp is read at most once a run, so at most one card a minute on the
 * shared token (each read is the guard's Transport.task, which tries a 429 or
 * a 5xx up to 3 times): in apply mode the card of the one recap claimed, read
 * fresh before any send; in dry mode one approved recap's card whose verdict
 * is not in the 10-minute cache (~/.client-messages/card-verdicts.json, keyed
 * by card and a fingerprint of the group, never a group id), the others shown
 * as read on a later run.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import {
  cardGroup,
  groupOf,
  groupVerdict,
  jitterMs,
  last4,
  normalise,
  sha256,
  sheetShape,
  type Verdict,
} from "./core.ts";
import { type Db, makeDb, SUPABASE } from "./db.ts";
import { type LedgerState, ledgerFetch } from "./ledger.ts";
import { type OldSenders, oldSenders } from "./oldSenders.ts";
import { makeWhapi, type WaMessage, type Whapi } from "./whapi.ts";

/** The keys this worker reads, by name; nothing else is taken from a key file. */
export const ENV_KEYS = [
  "AD_BILLING_WHAPI_TOKEN",
  "CLICKUP_API_TOKEN",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "TYPEFORM_TOKEN",
  "MAKE_API_KEY",
  "MAKE_ZONE",
] as const;
export const SWITCH_KEYS = [
  "CLIENT_MESSAGES_APPLY",
  "CLIENT_MESSAGES_KINDS",
  "CLIENT_MESSAGES_ONLY_CARDS",
] as const;
/** The one kind 2b sends. */
export const KINDS_2B = ["recap_checkin"];

export const RUN_SECONDS = 300;
/** A run claims only while at least 200 of its 300 seconds remain. */
export const CLAIM_BY_MS = (RUN_SECONDS - 200) * 1000;
/** The reconcile and read-back steps stop after 90 seconds together. */
export const STEPS_2_3_MS = 90_000;
export const READ_BACK_WAIT_MS = 10_000;
/** The intent and the one POST start only while this much of the run remains: the intent's 30 s (db.ts), the POST's 20 s and the result's 30 s (db.ts). */
export const SEND_MARGIN_MS = 80_000;
/** The latest moment of a run at which the intent (and so the POST) may start. */
export const SEND_BY_MS = RUN_SECONDS * 1000 - SEND_MARGIN_MS;
/** The shortest wait between the claim and the send (core.jitterMs). */
export const WAIT_MIN_MS = 30_000;
/** A real timer runs a little late: the cut wait ends this much before SEND_BY_MS. */
export const WAIT_SLACK_MS = 2_000;
/** Dry mode keeps a card's verdict this long, so it reads at most one card a run. */
export const CARD_CACHE_MS = 10 * 60_000;
/** The plan's card for a row whose card waits for a later run (one ClickUp read a run). */
export const CARD_LATER = "read on a later run";

export const NOTHING = "Nothing approved to send.";
export const DRY_NOTHING =
  "Nothing approved to send. Sending is off until the switch-over.";
export const NO_GROUP =
  "No WhatsApp group on Client Data for this card. Add it to Client Data column F, then try again.";
export const MANY_GROUPS =
  "Client Data has more than one row for this card. Keep one row with its WhatsApp group, then try again.";
export const BAD_GROUP =
  "The WhatsApp group on Client Data for this card is not a group id. Fix it in column F, then try again.";
export const GROUP_DIFFERS =
  "The WhatsApp group on the card differs from Client Data. Fix the group on Client Data or on the card, then try again.";
export const COLUMN_MOVED =
  "Client Data's WA GROUP ID column moved. The tech lead checks the sheet before any recap goes.";
export const CLICKUP_UNREAD =
  "ClickUp could not be read, so the recap was not sent unchecked. The next run tries again.";
export const TOO_LATE =
  "Too little of this run was left to send safely; the next run sends it.";
/** The note's added sentence when the ledger lost receipts after their calls had left (detail.receiptsMissing). */
export const RECEIPTS_LOST = (n: number) =>
  `The health ledger is missing the answer to ${n} provider call${n === 1 ? "" : "s"} that had already left. Check that the database takes provider receipts (RUNBOOK, Client messages).`;

export type Env = Record<string, string | undefined>;
export type EnvRead = { env: Env; from: Record<string, string> };
export type Switches = {
  apply: boolean;
  kinds: string[];
  onlyCards: string[];
  from: string | null;
  error: string | null;
};

function parseFile(path: string): Record<string, string> {
  const text = readFileSync(path, "utf8");
  if (path.endsWith(".json")) {
    const j = JSON.parse(text);
    const out: Record<string, string> = {};
    if (j && typeof j === "object")
      for (const [k, v] of Object.entries(j))
        if (typeof v === "string") out[k] = v;
    return out;
  }
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && out[m[1]] === undefined)
      out[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, "");
  }
  return out;
}

/** The named keys, first file wins; never a value printed, never a switch read. */
export function readEnv(files: string[]): EnvRead {
  const env: Env = {};
  const from: Record<string, string> = {};
  for (const file of files.filter(Boolean)) {
    let values: Record<string, string>;
    try {
      values = parseFile(file);
    } catch {
      continue;
    }
    for (const key of ENV_KEYS) {
      if (env[key] === undefined && values[key]) {
        env[key] = values[key];
        from[key] = file;
      }
    }
  }
  return { env, from };
}

const list = (v: string | undefined) =>
  String(v ?? "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

/** A ClickUp card id, as CLIENT_MESSAGES_ONLY_CARDS must list them. */
const CARD_ID = /^[A-Za-z0-9_-]{1,40}$/;
export const NOT_A_CARD =
  "CLIENT_MESSAGES_ONLY_CARDS names something that is not a card id. Write card ids separated by commas, nothing else.";
/** A switch on two lines: neither line is trusted, so the run stops with sending off. */
export const SWITCH_TWICE = (keys: string[]) =>
  `${keys.join(" and ")} ${keys.length === 1 ? "is" : "are"} written more than once in switches.env, so nothing is sent. Keep one line for each switch and edit that line; never add another below it.`;

/** A line that is no switch, named by its number and never by what is on it: it may hold a pasted value. */
export const SWITCH_UNKNOWN = (lines: number[]) =>
  `${
    lines.length === 1
      ? `Line ${lines[0]} of switches.env is not one of`
      : `Lines ${lines.slice(0, 5).join(" and ")} of switches.env are not among`
  } the three switches, so nothing is sent. Correct ${lines.length === 1 ? "it" : "them"} or delete ${lines.length === 1 ? "it" : "them"}: the file holds only ${SWITCH_KEYS[0]}, ${SWITCH_KEYS[1]} and ${SWITCH_KEYS[2]}.`;

/**
 * switches.env line by line, every line of a switch kept. Its own parse, not
 * parseFile's first-wins: a kill switch appended below an old `true` must
 * never leave sending on, so a switch written twice is an error (off). Any
 * other line but a comment or a blank is kept by number and is an error too: a
 * misspelt CLIENT_MESSAGES_ONLY_CARDS must never read as every card.
 */
function switchLines(path: string): {
  values: Record<string, string[]>;
  unknown: number[];
} {
  const values: Record<string, string[]> = {};
  const unknown: number[] = [];
  readFileSync(path, "utf8")
    .split(/\r?\n/)
    .forEach((line, i) => {
      if (!line.trim() || line.trim().startsWith("#")) return;
      const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!m || !(SWITCH_KEYS as readonly string[]).includes(m[1])) {
        unknown.push(i + 1);
        return;
      }
      values[m[1]] ??= [];
      values[m[1]].push(m[2].trim().replace(/^['"]|['"]$/g, ""));
    });
  return { values, unknown };
}

/**
 * The three switches, from their own file only; a missing or unreadable file
 * is the defaults (off). A switch the worker cannot read for certain (written
 * twice, a line that is no switch, a kind 2b does not send, a card list with
 * anything but card ids, separators alone included) sets `error` and reads as
 * off: the run sweeps and stops, and never widens a card list to every client.
 */
export function readSwitches(path: string): Switches {
  let lines: Record<string, string[]>;
  let unknown: number[];
  try {
    ({ values: lines, unknown } = switchLines(path));
  } catch {
    return {
      apply: false,
      kinds: [...KINDS_2B],
      onlyCards: [],
      from: null,
      error: null,
    };
  }
  const value = (key: (typeof SWITCH_KEYS)[number]) => lines[key]?.[0];
  const twice = SWITCH_KEYS.filter(k => (lines[k]?.length ?? 0) > 1);
  const kinds =
    value("CLIENT_MESSAGES_KINDS") === undefined
      ? [...KINDS_2B]
      : list(value("CLIENT_MESSAGES_KINDS"));
  const bad = kinds.filter(k => !KINDS_2B.includes(k));
  const rawCards = value("CLIENT_MESSAGES_ONLY_CARDS") ?? "";
  const cards = list(rawCards);
  const error = twice.length
    ? SWITCH_TWICE(twice)
    : unknown.length
      ? SWITCH_UNKNOWN(unknown)
      : bad.length || !kinds.length
        ? `CLIENT_MESSAGES_KINDS names ${bad.length ? `a kind 2b does not send (${bad.join(", ").slice(0, 60)})` : "no kind"}. Set it to recap_checkin.`
        : cards.some(c => !CARD_ID.test(c)) ||
            (rawCards.trim() !== "" && cards.length === 0)
          ? NOT_A_CARD
          : null;
  return {
    apply: error === null && value("CLIENT_MESSAGES_APPLY") === "true",
    kinds,
    onlyCards: cards.filter(c => CARD_ID.test(c)),
    from: path,
    error,
  };
}

// ------------------------------------------------------------------ one run

export type Providers = (
  runKey: string,
) => Pick<Whapi, "sendText" | "listMessages" | "sheet" | "task">;
/** Dry mode's card verdicts, keyed by card and a fingerprint of the Client Data group. */
export type CardCache = {
  get: (key: string) => Verdict | null;
  put: (key: string, verdict: Verdict) => void;
};
export type RunDeps = {
  db: Db;
  providers: Providers;
  oldSenders: () => Promise<OldSenders>;
  switches: Switches;
  envFrom: Record<string, string>;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  /** Milliseconds since the run started (the cron's timeout counts from there). */
  elapsedMs: () => number;
  random?: () => number;
  /** Dry mode's 10-minute card verdicts; without it dry mode still reads one card a run, in turn. */
  cardCache?: CardCache;
  /** The one count every ledger of this run shares: receipts lost after their call had left. */
  ledger: LedgerState;
};

const VERDICTS: readonly Verdict[] = ["same", "empty", "differs"];

/** The cache key: the card and the first 16 hex of the group's fingerprint (a changed group reads again). */
export const cardKey = (taskId: string, group: string) =>
  `${taskId}:${sha256(group).slice(0, 16)}`;

/** Card verdicts in one private file, each kept CARD_CACHE_MS; an unreadable or unwritable file only means more reads. */
export function fileCardCache(path: string, now: () => Date): CardCache {
  type Entry = { verdict: Verdict; at: string };
  const fresh = (e: unknown): e is Entry => {
    const x = e as Entry | null;
    if (!x || typeof x !== "object" || !VERDICTS.includes(x.verdict))
      return false;
    const age = now().getTime() - Date.parse(String(x.at));
    return Number.isFinite(age) && age >= 0 && age < CARD_CACHE_MS;
  };
  const load = (): Record<string, Entry> => {
    try {
      const v = JSON.parse(readFileSync(path, "utf8"));
      if (!v || typeof v !== "object" || Array.isArray(v)) return {};
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).filter(([, e]) =>
          fresh(e),
        ),
      ) as Record<string, Entry>;
    } catch {
      return {};
    }
  };
  return {
    get: key => load()[key]?.verdict ?? null,
    put: (key, verdict) => {
      const all = load();
      all[key] = { verdict, at: now().toISOString() };
      try {
        writeFileSync(path, JSON.stringify(all), { mode: 0o600 });
      } catch {
        // An unwritable cache only means the card is read again on a later run.
      }
    },
  };
}

type WorkRow = {
  id: string;
  claimToken: string;
  taskId: string;
  kind: string;
  body: string;
  bodySha256: string;
  providerId?: string;
  claimedAt?: string;
  sentAt?: string;
};
type Approved = {
  id: string;
  taskId: string;
  clientName: string | null;
  kind: string;
  approvedAt: string;
  expiresAt: string;
};
export type Plan = {
  id: string;
  taskId: string;
  group: string;
  card: string;
  oldSenders: string;
  wouldSend: boolean;
  why: string;
};
export type RunReport = {
  ok: boolean;
  note: string;
  detail: {
    mode: "dry" | "apply";
    kinds: string[];
    onlyCards: string[];
    approved: number;
    sent: number;
    refused: number;
    failed: number;
    unknown: number;
    unread: number;
    held: string | null;
    /** Provider calls that left without their answer saved in the health ledger. */
    receiptsMissing: number;
    envFrom: Record<string, string>;
  };
  swept: Record<string, number> | null;
  reconciled: number;
  readBack: number;
  plan: Plan[];
  steps: string[];
};

const epoch = (iso: string | undefined | null, fallback: Date) => {
  const ms = Date.parse(String(iso ?? ""));
  return Math.floor((Number.isFinite(ms) ? ms : fallback.getTime()) / 1000);
};
const say = (e: unknown, fallback: string) => {
  const m = (e instanceof Error && e.message ? e.message : fallback)
    .trim()
    .slice(0, 200);
  return /[.!?]$/.test(m) ? m : `${m}.`;
};
const same = (a: string, b: string) =>
  sha256(normalise(a)) === sha256(normalise(b));

/** The note of a run that threw part way. Its health row is still written; the sweep settles what it held. */
export const STOPPED = (reason: string) =>
  `The run stopped early: ${reason} The next run's sweep puts back any recap it held, or marks it unknown if its send had started; none is sent twice.`;

type Finish = (ok: boolean, note: string) => Promise<RunReport>;

/** One run. It always writes the client-messages health row, a run that throws part way included. */
export async function runOnce(deps: RunDeps): Promise<RunReport> {
  const { db, switches } = deps;
  const report: RunReport = {
    ok: true,
    note: "",
    detail: {
      mode: switches.apply ? "apply" : "dry",
      kinds: switches.kinds,
      onlyCards: switches.onlyCards,
      approved: 0,
      sent: 0,
      refused: 0,
      failed: 0,
      unknown: 0,
      unread: 0,
      held: null,
      receiptsMissing: 0,
      envFrom: deps.envFrom,
    },
    swept: null,
    reconciled: 0,
    readBack: 0,
    plan: [],
    steps: [],
  };
  const finish: Finish = async (ok, said) => {
    // Every provider call of the run is over by now: a receipt lost after its call left is counted and said.
    const lost = deps.ledger.failures;
    report.detail.receiptsMissing = lost;
    const note = lost > 0 ? `${said} ${RECEIPTS_LOST(lost)}` : said;
    report.ok = ok;
    report.note = note;
    try {
      await db.health(
        { key: "client-messages", ok, note, detail: report.detail },
        deps.now(),
      );
    } catch (e) {
      report.ok = false;
      report.note = `${note} The health row could not be written: ${say(e, "no answer")}`;
    }
    return report;
  };
  try {
    return await steps(deps, report, finish);
  } catch (e) {
    // No result is written here: a claimed row goes back, a started send becomes unknown, at the next sweep.
    report.steps.push("stopped");
    return finish(false, STOPPED(say(e, "no answer")));
  }
}

async function steps(
  deps: RunDeps,
  report: RunReport,
  finish: Finish,
): Promise<RunReport> {
  const { db, switches } = deps;
  // A switch the worker cannot read for certain stops the run with sending off. The sweep still
  // runs first, as in dry mode (database only, it sends nothing), so a stopped send reaches unknown (Z67).
  if (switches.error) {
    try {
      report.swept = await db.rpc("cockpit_client_message_sweep", {});
      report.steps.push("sweep");
    } catch (e) {
      return finish(
        false,
        `${switches.error} The message sweep failed too: ${say(e, "no answer")}`,
      );
    }
    return finish(false, switches.error);
  }

  // 1. The sweep: a stopped send becomes unknown, a stale claim goes back, an old approval is a draft again.
  try {
    report.swept = await db.rpc("cockpit_client_message_sweep", {});
    report.steps.push("sweep");
  } catch (e) {
    return finish(false, `The message sweep failed: ${say(e, "no answer")}`);
  }
  let work: { unknowns: WorkRow[]; unread: WorkRow[]; approved: Approved[] };
  try {
    work = await db.rpc("cockpit_client_message_work", { p_limit: 5 });
    report.steps.push("work");
  } catch (e) {
    return finish(
      false,
      `The messages could not be read: ${say(e, "no answer")}`,
    );
  }
  const allowed = (r: { kind: string; taskId: string }) =>
    switches.kinds.includes(r.kind) &&
    (switches.onlyCards.length === 0 || switches.onlyCards.includes(r.taskId));
  const approved = (work.approved ?? []).filter(allowed);
  report.detail.approved = approved.length;
  report.detail.unknown = (work.unknowns ?? []).length;
  report.detail.unread = (work.unread ?? []).length;

  // Client Data, read once a run and only when needed.
  let sheetRead: Promise<unknown[][]> | null = null;
  const sheet = () =>
    (sheetRead ??= deps.providers("client-messages:run").sheet());

  if (!switches.apply) return dryRun(deps, report, approved, sheet, finish);

  // 2. Unknowns: looked for in the group by their fingerprint; never sent again.
  const stepsEnd = deps.elapsedMs() + STEPS_2_3_MS;
  for (const u of (work.unknowns ?? []).slice(0, 5)) {
    if (deps.elapsedMs() > stepsEnd) break;
    try {
      const g = groupOf(await sheet(), u.taskId);
      if (!g.ok) continue;
      const found = (
        await deps
          .providers(`client-messages:${u.id}`)
          .listMessages(g.group, epoch(u.claimedAt, deps.now()) - 60)
      ).find((m: WaMessage) => m.fromMe && same(m.body, u.body));
      if (!found) continue;
      await db.rpc("cockpit_client_message_result", {
        p_id: u.id,
        p_claim: u.claimToken,
        p_outcome: "reconciled",
        p_provider_id: found.id,
        p_reason: null,
        p_read_back: { by: "body_sha256" },
      });
      report.reconciled += 1;
      report.detail.unknown -= 1;
    } catch (e) {
      report.steps.push(`unknown not read: ${say(e, "no answer")}`);
    }
  }
  report.steps.push("unknowns");

  // 3. Sent messages with no read-back yet: by WhatsApp's id, else by the fingerprint (24 hours).
  for (const s of (work.unread ?? []).slice(0, 5)) {
    if (deps.elapsedMs() > stepsEnd) break;
    try {
      if (await readBack(deps, sheet, s)) {
        report.readBack += 1;
        report.detail.unread -= 1;
      }
    } catch (e) {
      report.steps.push(`read-back not done: ${say(e, "no answer")}`);
    }
  }
  report.steps.push("read-backs");

  // 4. Anything approved to send?
  if (!approved.length) return finish(true, NOTHING);

  // 5. The old senders: on or unread holds every recap.
  let old: OldSenders;
  try {
    old = await deps.oldSenders();
  } catch (e) {
    old = {
      at: deps.now().toISOString(),
      typeform: "unread",
      scenarios: {},
      held: true,
      sentence: `The old senders could not be read (${say(e, "no answer").replace(/\.$/, "")}), so the recaps wait.`,
    };
  }
  report.steps.push("old senders");
  if (old.held) {
    report.detail.held = old.sentence;
    return finish(
      false,
      old.sentence ?? "The recaps wait for the old senders.",
    );
  }

  // 6. Client Data keeps the group in column F.
  let values: unknown[][];
  try {
    values = await sheet();
  } catch (e) {
    return finish(
      false,
      `Client Data could not be read, so nothing was sent: ${say(e, "no answer")}`,
    );
  }
  if (!sheetShape(values).ok) {
    report.detail.held = COLUMN_MOVED;
    return finish(false, COLUMN_MOVED);
  }

  // 7. Claim one, while at least 200 seconds of the run remain.
  if (deps.elapsedMs() > CLAIM_BY_MS) return finish(true, TOO_LATE);
  let claim: {
    busy: boolean;
    rows: (WorkRow & { claimedAt: string; clientName: string | null })[];
  };
  try {
    claim = await db.rpc("cockpit_client_message_claim", {
      p_kinds: switches.kinds,
      p_only_cards: switches.onlyCards.length ? switches.onlyCards : null,
      p_limit: 1,
    });
  } catch (e) {
    return finish(false, `The claim failed: ${say(e, "no answer")}`);
  }
  report.steps.push("claim");
  if (claim.busy)
    return finish(true, "Another run holds the messages; this one stopped.");
  const row = claim.rows?.[0];
  if (!row)
    return finish(
      true,
      "No approved recap could be claimed: an approval ran out, Make owns the recap again, or the approver lost the client. The Messages card says which.",
    );
  const result = (outcome: string, extra: Record<string, unknown> = {}) =>
    db.rpc("cockpit_client_message_result", {
      p_id: row.id,
      p_claim: row.claimToken,
      p_outcome: outcome,
      p_provider_id: null,
      p_reason: null,
      p_read_back: null,
      ...extra,
    });
  const provider = deps.providers(`client-messages:${row.id}`);

  // The text is the approved one, byte for byte.
  if (sha256(row.body) !== row.bodySha256) {
    await result("release");
    return finish(
      false,
      "The claimed text did not match its fingerprint, so nothing was sent. Tell the tech lead.",
    );
  }

  // 8. The group on Client Data.
  const g = groupOf(values, row.taskId);
  if (!g.ok) {
    const reason =
      g.why === "many"
        ? MANY_GROUPS
        : g.why === "invalid"
          ? BAD_GROUP
          : NO_GROUP;
    await result("refused", { p_reason: reason });
    report.detail.refused += 1;
    return finish(true, reason);
  }

  // 9. The card agrees (empty or the same group); never sent unchecked.
  let task: unknown;
  try {
    task = await provider.task(row.taskId);
  } catch {
    await result("release");
    return finish(false, CLICKUP_UNREAD);
  }
  if (groupVerdict(g.group, cardGroup(task)) === "differs") {
    await result("refused", { p_reason: GROUP_DIFFERS });
    report.detail.refused += 1;
    return finish(true, GROUP_DIFFERS);
  }

  // 10. Wait 30 to 120 seconds, cut so the intent still starts by SEND_BY_MS;
  // with too little left for even 30 seconds, the claim goes back for the next run.
  const waitUpTo = SEND_BY_MS - WAIT_SLACK_MS - deps.elapsedMs();
  if (waitUpTo < WAIT_MIN_MS) {
    await result("release");
    return finish(true, TOO_LATE);
  }
  await deps.sleep(Math.min(jitterMs(deps.random), waitUpTo));

  // The POST and the database calls around it must end before the cron's kill (Z59).
  if (deps.elapsedMs() > SEND_BY_MS) {
    await result("release");
    return finish(true, TOO_LATE);
  }

  // 11. The owner gate again, just before the POST (Z66).
  const intent: { ok: boolean; reason?: string } = await db.rpc(
    "cockpit_client_message_intent",
    { p_id: row.id, p_claim: row.claimToken },
  );
  report.steps.push("intent");
  if (!intent?.ok)
    return finish(
      true,
      intent?.reason ??
        "The database said not to send it, so nothing was sent.",
    );

  // 12. The one POST.
  const out = await provider.sendText(g.group, row.body);
  report.steps.push(`send ${out.state}`);

  // 13. What WhatsApp answered.
  if (out.state === "sent") {
    await result("sent", { p_provider_id: out.providerId });
    report.detail.sent += 1;
  } else if (out.state === "failed") {
    await result("failed", { p_reason: out.reason });
    report.detail.failed += 1;
    return finish(false, out.reason);
  } else {
    await result("unknown", { p_reason: out.reason });
    report.detail.unknown += 1;
    return finish(false, out.reason);
  }

  // 14. Read it back after 10 seconds; a later run tries again for 24 hours.
  await deps.sleep(READ_BACK_WAIT_MS);
  try {
    const done = await readBack(deps, () => Promise.resolve(values), {
      ...row,
      providerId: out.providerId,
      sentAt: deps.now().toISOString(),
    });
    if (done) report.readBack += 1;
    else report.detail.unread += 1;
  } catch {
    report.detail.unread += 1;
  }
  return finish(
    true,
    `Sent one recap to the client's group (WhatsApp group ending ${last4(g.group) ?? "unknown"}).`,
  );
}

/** One read-back: the message WhatsApp gave the send, else one of ours with the same fingerprint. */
async function readBack(
  deps: RunDeps,
  sheet: () => Promise<unknown[][]>,
  s: WorkRow,
): Promise<boolean> {
  const g = groupOf(await sheet(), s.taskId);
  if (!g.ok) return false;
  const since = epoch(s.claimedAt ?? s.sentAt, deps.now()) - 60;
  const messages = await deps
    .providers(`client-messages:${s.id}`)
    .listMessages(g.group, since);
  const byId = messages.find(m => m.id === s.providerId);
  const byHash = byId
    ? null
    : messages.find(m => m.fromMe && same(m.body, s.body));
  const found = byId ?? byHash;
  if (!found) return false;
  await deps.db.rpc("cockpit_client_message_result", {
    p_id: s.id,
    p_claim: s.claimToken,
    p_outcome: "read_back",
    p_provider_id: null,
    p_reason: null,
    p_read_back: {
      by: byId ? "message_id" : "body_sha256",
      providerId: found.id,
    },
  });
  return true;
}

/**
 * Dry mode: the sweep already ran; a plan per approved row, and nothing
 * written but the health row. At most one ClickUp card a run: a verdict read
 * in the last 10 minutes comes from the cache, and of the rest one card is
 * read, in turn by the minute; the others are read on a later run.
 */
async function dryRun(
  deps: RunDeps,
  report: RunReport,
  approved: Approved[],
  sheet: () => Promise<unknown[][]>,
  finish: Finish,
): Promise<RunReport> {
  if (!approved.length) return finish(true, DRY_NOTHING);
  let old: OldSenders | null = null;
  try {
    old = await deps.oldSenders();
  } catch {
    old = null;
  }
  const rows = approved.slice(0, 5).map(a => {
    const plan: Plan = {
      id: a.id,
      taskId: a.taskId,
      group: "unread",
      card: "unread",
      oldSenders: old ? (old.held ? "on or unread" : "off") : "unread",
      wouldSend: false,
      why: "",
    };
    return { a, plan, group: null as string | null };
  });
  for (const r of rows) {
    try {
      const g = groupOf(await sheet(), r.a.taskId);
      r.plan.group = g.ok ? `present, ${last4(g.group) ?? "?"}` : "none";
      if (g.ok) r.group = g.group;
    } catch {
      r.plan.group = "unread";
    }
  }
  // The card verdicts: cached ones first; then one ClickUp read for this run.
  const toRead: typeof rows = [];
  for (const r of rows) {
    if (!r.group) continue;
    const cached = deps.cardCache?.get(cardKey(r.a.taskId, r.group)) ?? null;
    if (cached) r.plan.card = cached;
    else toRead.push(r);
  }
  if (toRead.length) {
    const turn = Math.floor(deps.now().getTime() / 60_000) % toRead.length;
    const pick = toRead[turn];
    for (const r of toRead) if (r !== pick) r.plan.card = CARD_LATER;
    try {
      const verdict = groupVerdict(
        pick.group as string,
        cardGroup(
          await deps
            .providers(`client-messages:${pick.a.id}`)
            .task(pick.a.taskId),
        ),
      );
      pick.plan.card = verdict;
      deps.cardCache?.put(
        cardKey(pick.a.taskId, pick.group as string),
        verdict,
      );
    } catch {
      pick.plan.card = "unread";
    }
  }
  for (const { plan } of rows) {
    plan.wouldSend =
      plan.group.startsWith("present") &&
      (plan.card === "same" || plan.card === "empty") &&
      plan.oldSenders === "off";
    plan.why = plan.wouldSend
      ? "Would send once sending is on."
      : plan.oldSenders !== "off"
        ? (old?.sentence ?? "The old senders could not be read.")
        : plan.group === "none"
          ? NO_GROUP
          : plan.card === "differs"
            ? GROUP_DIFFERS
            : plan.card === CARD_LATER
              ? "Its card is read on a later run (one ClickUp read a run)."
              : "Client Data or the card could not be read.";
    report.plan.push(plan);
  }
  return finish(
    true,
    `${approved.length} approved to send. Sending is off until the switch-over.`,
  );
}

// ------------------------------------------------------------------ the doctor

export type DoctorDeps = {
  read: EnvRead;
  switches: Switches;
  db: () => Db;
  providers: Providers;
  health: () => Promise<{ status: string | null; channelLast4: string | null }>;
  oldSenders: () => Promise<OldSenders>;
  task?: string | null;
  /** The count the doctor's ledgers share; absent when nothing could be called (no database). */
  ledger?: LedgerState | null;
};

/** Every key and switch with the file it came from (never a value), the project, and read-only checks. */
export async function doctor(deps: DoctorDeps): Promise<Record<string, any>> {
  const { read, switches } = deps;
  const keys = Object.fromEntries(
    ENV_KEYS.map(k => [k, { set: !!read.env[k], from: read.from[k] ?? null }]),
  );
  const url = String(read.env.SUPABASE_URL ?? "").replace(/\/$/, "");
  const project = !url
    ? "missing"
    : url === SUPABASE
      ? "this project"
      : "another project";
  const out: Record<string, any> = {
    ok: false,
    keys,
    supabaseUrl: project,
    switches: Object.fromEntries(
      SWITCH_KEYS.map(k => [k, { from: switches.from }]),
    ),
    mode: switches.apply ? "apply" : "dry",
    kinds: switches.kinds,
    onlyCards: switches.onlyCards,
    checks: {} as Record<string, string>,
  };
  const missing = ENV_KEYS.filter(k => !read.env[k]);
  if (project !== "this project") {
    out.note =
      "SUPABASE_URL must be the Creative Triage project (bldgtotkfmhoxmlzowdx). Another project's never wins.";
    return out;
  }
  if (switches.error) out.checks.switches = switches.error;
  const probe = async (name: string, f: () => Promise<string>) => {
    try {
      out.checks[name] = await f();
    } catch (e) {
      out.checks[name] = `failed: ${say(e, "no answer")}`;
    }
  };
  await probe("supabase", async () => {
    await deps.db().rpc("cockpit_client_message_work", { p_limit: 1 });
    return "ok";
  });
  await probe("whatsapp", async () => {
    const h = await deps.health();
    return `ok, channel ending ${h.channelLast4 ?? "unknown"}`;
  });
  let values: unknown[][] | null = null;
  await probe("client data", async () => {
    values = await deps.providers("client-messages:doctor").sheet();
    const shape = sheetShape(values);
    return shape.ok
      ? "ok, WA GROUP ID in column F"
      : `failed: WA GROUP ID is in column ${shape.column ?? "none"}, not F`;
  });
  await probe("old senders", async () => {
    const o = await deps.oldSenders();
    const scenarios = Object.entries(o.scenarios)
      .map(([id, s]) => `scenario ${id} ${s}`)
      .join(", ");
    const said = `typeform webhook ${o.typeform}, ${scenarios}`;
    // Read is what the doctor needs; on is expected until the switch-over, and holds the recaps.
    if (
      o.typeform === "unread" ||
      Object.values(o.scenarios).includes("unread")
    )
      return `failed: ${said}. ${o.sentence ?? ""}`.trim();
    return `ok: ${said}${o.held ? ". Recaps wait until all are off." : ""}`;
  });
  if (deps.task) {
    const task = deps.task;
    out.task = { card: task, clientData: "unread", cardField: "unread" };
    if (values) {
      const g = groupOf(values, task);
      out.task.clientData = g.ok ? `present, ${last4(g.group) ?? "?"}` : "none";
      if (g.ok) {
        try {
          out.task.cardField = groupVerdict(
            g.group,
            cardGroup(
              await deps.providers("client-messages:doctor").task(task),
            ),
          );
        } catch (e) {
          out.task.cardField = `unread: ${say(e, "no answer")}`;
        }
      } else {
        try {
          const field = cardGroup(
            await deps.providers("client-messages:doctor").task(task),
          );
          out.task.cardField = field
            ? `present, ${last4(field) ?? "?"}`
            : "empty";
        } catch (e) {
          out.task.cardField = `unread: ${say(e, "no answer")}`;
        }
      }
    }
  }
  // Read last, after every call: a lost receipt fails the doctor. Without a ledger nothing was called.
  if (deps.ledger) {
    out.receiptsMissing = deps.ledger.failures;
    if (deps.ledger.failures > 0)
      out.checks.ledger = `failed: ${RECEIPTS_LOST(deps.ledger.failures)}`;
  }
  out.missing = missing;
  out.ok =
    missing.length === 0 &&
    !switches.error &&
    Object.values(out.checks).every(v => String(v).startsWith("ok"));
  return out;
}

// ------------------------------------------------------------------ wiring

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};

/**
 * The real dependencies: the database, a ledger-receipted provider set per run
 * key, the old senders' cache, and the one LedgerState every ledger of this
 * process shares, so the health row reports the run's lost receipts.
 */
export function wire(read: EnvRead, home = homedir()) {
  const db = makeDb(read.env);
  const ledger: LedgerState = { failures: 0 };
  const receipted = (runKey: string) =>
    ledgerFetch({ insert: db.receipt, runKey, state: ledger }).fetch;
  const providers: Providers = runKey => makeWhapi(read.env, receipted(runKey));
  const cachePath = `${home}/.client-messages/old-senders.json`;
  const cardCache = fileCardCache(
    `${home}/.client-messages/card-verdicts.json`,
    () => new Date(),
  );
  const senders = (runKey: string, fresh = false) =>
    oldSenders(
      {
        env: read.env,
        fetch: receipted(runKey),
        now: () => new Date(),
        cachePath,
      },
      { fresh },
    );
  return { db, providers, senders, cardCache, ledger, receipted };
}

async function main() {
  const started = Date.now();
  const cmd = process.argv[2] ?? "run";
  const home = homedir();
  const read = readEnv(
    String(process.env.CLIENT_MESSAGES_ENV_FILES ?? "").split(":"),
  );
  const switches = readSwitches(`${home}/.client-messages/switches.env`);
  if (cmd === "g5") {
    const { g5Main } = await import("./g5.ts");
    process.exit(await g5Main(read, process.argv.slice(3)));
  }
  if (cmd === "doctor") {
    const url = String(read.env.SUPABASE_URL ?? "").replace(/\/$/, "");
    const wired =
      url === SUPABASE && read.env.SUPABASE_SERVICE_ROLE_KEY
        ? wire(read, home)
        : null;
    const r = await doctor({
      read,
      switches,
      db: () => {
        if (!wired)
          throw new Error(
            "No database: SUPABASE_URL or the service key is missing.",
          );
        return wired.db;
      },
      providers: runKey => {
        if (!wired)
          throw new Error(
            "No database for the ledger, so no provider is called.",
          );
        return wired.providers(runKey);
      },
      health: () => {
        if (!wired)
          throw new Error(
            "No database for the ledger, so WhatsApp is not called.",
          );
        return makeWhapi(
          read.env,
          wired.receipted("client-messages:doctor"),
        ).health();
      },
      oldSenders: () => {
        if (!wired)
          throw new Error(
            "No database for the ledger, so the old senders are not read.",
          );
        return wired.senders("client-messages:doctor", true);
      },
      task: arg("--task") ?? null,
      ledger: wired?.ledger ?? null,
    });
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.ok ? 0 : 1);
  }
  if (cmd !== "run") {
    console.log(
      "Use doctor [--task <card>], run [--report <path>] or g5 --task <card> --at <iso>.",
    );
    process.exit(2);
  }
  let wired: ReturnType<typeof wire>;
  try {
    wired = wire(read, home);
  } catch (e) {
    // No database, so no health row: the guardian reads the row as stale after 10 minutes.
    console.log(
      JSON.stringify({
        ok: false,
        note: `The run could not reach the database, so no health row was written: ${say(e, "no answer")} Run the doctor (RUNBOOK, Client messages).`,
      }),
    );
    process.exit(1);
  }
  const { db, providers, senders, cardCache, ledger } = wired;
  const report = await runOnce({
    db,
    providers,
    oldSenders: () => senders("client-messages:run"),
    switches,
    envFrom: read.from,
    now: () => new Date(),
    sleep: ms => new Promise(r => setTimeout(r, ms)),
    elapsedMs: () => Date.now() - started,
    cardCache,
    ledger,
  });
  const path = arg("--report");
  if (path) writeFileSync(path, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      ok: report.ok,
      note: report.note,
      detail: { ...report.detail, envFrom: undefined },
      steps: report.steps,
    }),
  );
  process.exit(report.ok ? 0 : 1);
}

if (import.meta.main)
  main().catch(e => {
    console.log(
      JSON.stringify({
        ok: false,
        note: `The worker stopped: ${say(e, "no answer")}`,
      }),
    );
    process.exit(1);
  });
