/**
 * The morning hours note (A372). The CEO, 2026-10-09: "so now build it and i
 * need to make sure everyone uses them now". Once a day the cron posts
 * {"op":"nudge"}; this reads yesterday's list from cockpit_hours_nudge_list
 * (people required to track who did not, by the Hours tab's rule) and, only
 * when the CEO has switched it on, sends him one Slack message. Nobody else is
 * ever messaged. Every run writes one sync-state row and one audit row
 * through cockpit_hours_nudge_finish, switched on or off.
 *
 * Both Slack calls are receipted in cockpit_hours_provider_health (intent,
 * then response or unknown). The token is read by name and never written
 * anywhere.
 */
import type { InsertReceipt, Rpc, SlackReceipt } from "./db.ts";

export type NudgeReason = "no_hubstaff_account" | "nothing_tracked";
export type NudgePerson = { personId: number; name: string; role: string | null; reason: NudgeReason };
export type NudgeList = {
  day: string;
  on: boolean;
  ready: boolean;
  hubstaffReadAt: string | null;
  required: number;
  people: NudgePerson[];
  note: string | null;
};
export type NudgeResult = { ok: boolean; sent: boolean; day: string; listed: number | null; note: string; text?: string; people?: NudgePerson[] };
export type NudgeDeps = {
  rpc: Rpc;
  insertReceipt: InsertReceipt;
  fetch: typeof fetch;
  now: () => Date;
  /** SLACK_BOT_TOKEN, read by name. Empty when it is not set. */
  slackToken: () => string;
  /** The one person the note goes to. */
  ceoEmail: string;
  /** Where Hours and pay lives (the Team & payroll tab), for the link in the note. */
  hoursUrl: string;
};

const KUWAIT_MS = 3 * 3600_000;

/** The Kuwait day before `now`, YYYY-MM-DD (Kuwait is UTC+3 all year). */
export function kuwaitYesterday(now: Date): string {
  return new Date(now.getTime() + KUWAIT_MS - 86_400_000).toISOString().slice(0, 10);
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function dayLabel(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return `${DAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH_NAMES[d.getUTCMonth()]}`;
}

const REASON_TEXT: Record<NudgeReason, string> = {
  nothing_tracked: "nothing tracked in Hubstaff",
  no_hubstaff_account: "no Hubstaff account linked",
};

const who = (p: NudgePerson) => `${p.role?.trim() || "No role"} (${p.name})`;

/** The Slack text: plain, one line per person, the link to Hours and pay at the end. */
export function nudgeText(list: NudgeList, hoursUrl: string): string {
  const n = list.people.length;
  return [
    `Hours check for ${dayLabel(list.day)}: ${n} ${n === 1 ? "person" : "people"} who should have tracked did not.`,
    ...list.people.map(p => `• ${who(p)}: ${REASON_TEXT[p.reason]}.`),
    `Open Team & payroll, Hours and pay, to decide each day: ${hoursUrl}`,
  ].join("\n");
}

function names(people: NudgePerson[]): string {
  return people.map(who).join(", ");
}

export function parseList(value: unknown): NudgeList {
  const v = (value ?? {}) as Record<string, unknown>;
  if (typeof v.day !== "string" || typeof v.on !== "boolean" || typeof v.ready !== "boolean" || !Array.isArray(v.people))
    throw new Error("The hours list came back in a shape this does not read; nothing was sent.");
  const people = v.people.map(raw => {
    const p = (raw ?? {}) as Record<string, unknown>;
    if (typeof p.personId !== "number" || typeof p.name !== "string" || (p.reason !== "no_hubstaff_account" && p.reason !== "nothing_tracked"))
      throw new Error("The hours list has a person this does not read; nothing was sent.");
    return { personId: p.personId, name: p.name, role: typeof p.role === "string" ? p.role : null, reason: p.reason } as NudgePerson;
  });
  return {
    day: v.day,
    on: v.on,
    ready: v.ready,
    hubstaffReadAt: typeof v.hubstaffReadAt === "string" ? v.hubstaffReadAt : null,
    required: typeof v.required === "number" ? v.required : 0,
    people,
    note: typeof v.note === "string" ? v.note : null,
  };
}

class SlackError extends Error {}

/** One Slack Web API call with its receipts. Slack answers 200 with ok:false on refusals, so both are checked. */
export async function slackCall(
  deps: Pick<NudgeDeps, "insertReceipt" | "fetch">,
  token: string,
  method: "GET" | "POST",
  resource: "users.lookupByEmail" | "chat.postMessage",
  input: Record<string, string>,
): Promise<Record<string, unknown>> {
  const receipt: SlackReceipt = { provider: "slack", method, resource, phase: "intent" };
  const save = (row: SlackReceipt) => deps.insertReceipt({ ...row, run_id: null, receipt_index: null });
  await save(receipt);
  let response: Response;
  try {
    const url = `https://slack.com/api/${resource}${method === "GET" ? `?${new URLSearchParams(input)}` : ""}`;
    response = await deps.fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(method === "POST" ? { "Content-Type": "application/json; charset=utf-8" } : {}) },
      body: method === "POST" ? JSON.stringify(input) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    await save({ ...receipt, phase: "unknown", error: "No answer from Slack" });
    throw new SlackError("Slack did not answer");
  }
  let body: Record<string, unknown> = {};
  try { body = (await response.json()) as Record<string, unknown>; } catch { body = {}; }
  const code = typeof body.error === "string" ? body.error.replace(/[^a-z0-9_]/gi, "").slice(0, 60) : null;
  await save({ ...receipt, phase: "response", http_status: response.status, error: response.ok && body.ok === true ? undefined : code ?? `HTTP ${response.status}` });
  if (!response.ok || body.ok !== true) throw new SlackError(`Slack refused ${resource} (${code ?? `HTTP ${response.status}`})`);
  return body;
}

/**
 * Read yesterday's list and, when the switch is on and someone is listed,
 * send the CEO one message. A dry run reads and returns the text, sends
 * nothing and writes nothing.
 */
export async function runNudge(deps: NudgeDeps, opts: { day?: string; dryRun?: boolean } = {}): Promise<NudgeResult> {
  const day = opts.day ?? kuwaitYesterday(deps.now());
  let result: NudgeResult;
  try {
    const list = parseList(await deps.rpc("cockpit_hours_nudge_list", { p_day: day }));
    const n = list.people.length;
    const text = n ? nudgeText(list, deps.hoursUrl) : undefined;
    const notRead = list.note ?? "Hubstaff has not been read for that day, so nobody is listed.";
    if (opts.dryRun) {
      return list.ready
        ? { ok: true, sent: false, day, listed: n, note: `Dry run: nothing sent. ${n ? `It would list ${n}: ${names(list.people)}.` : "Nobody would be listed."}`, text, people: list.people }
        : { ok: false, sent: false, day, listed: null, note: `Dry run: ${notRead}` };
    }
    if (!list.ready) {
      result = { ok: false, sent: false, day, listed: null, note: notRead };
    } else if (!list.on) {
      result = { ok: true, sent: false, day, listed: n, note: `Switched off, so nothing was sent. ${n ? `It would have listed ${n}: ${names(list.people)}.` : `Everyone required to track did on ${dayLabel(day)}.`}`, people: list.people };
    } else if (!n) {
      result = { ok: true, sent: false, day, listed: 0, note: `Everyone required to track did on ${dayLabel(day)}, so nothing was sent.`, people: [] };
    } else {
      const token = deps.slackToken().trim();
      if (!token) {
        result = { ok: false, sent: false, day, listed: n, note: "SLACK_BOT_TOKEN is not set on cockpit-hours-sync, so nothing was sent. Set it in the function's secrets.", people: list.people };
      } else {
        try {
          const found = await slackCall(deps, token, "GET", "users.lookupByEmail", { email: deps.ceoEmail });
          const user = (found.user ?? {}) as Record<string, unknown>;
          if (typeof user.id !== "string" || !user.id) throw new SlackError("Slack did not return the CEO's user");
          await slackCall(deps, token, "POST", "chat.postMessage", { channel: user.id, text: text! });
          result = { ok: true, sent: true, day, listed: n, note: `Sent to the CEO on Slack: ${n} listed (${names(list.people)}).`, people: list.people };
        } catch (e) {
          const why = e instanceof SlackError ? e.message : "Slack could not be reached";
          result = { ok: false, sent: false, day, listed: n, note: `${why}; nothing was sent. The provider receipts are in cockpit_hours_provider_health.`, people: list.people };
        }
      }
    }
  } catch (e) {
    if (opts.dryRun) throw e;
    const message = e instanceof Error ? e.message.slice(0, 200) : "The hours list could not be read";
    result = { ok: false, sent: false, day, listed: null, note: `The hours list could not be read (${message}); nothing was sent.` };
  }
  await deps.rpc("cockpit_hours_nudge_finish", {
    p: { day, ok: result.ok, sent: result.sent, listed: result.listed, note: result.note.slice(0, 500), people: (result.people ?? []).map(p => ({ personId: p.personId, reason: p.reason })) },
  });
  return result;
}
