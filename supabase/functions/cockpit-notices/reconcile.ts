/**
 * The reconcile (contract 4.4): a notice left `unknown` (the request left and
 * no receipt came back) is looked for in Slack by its marker `Ref CN-xxxxxxxx`
 * and never sent again. A reply is looked for in its thread, a top-level post
 * in its channel's history, from a minute before it was claimed, 200 messages
 * a page and up to 20 pages. Only a bot's message counts. Found: it is
 * `posted` with that ts. Not found: nothing changes, so it stays for a person
 * (the database hands it out again after 10 minutes, for 24 hours). A row with
 * no channel to read (a direct message whose receipt never came) is left alone.
 */
import type { SlackTools } from "../cockpit-csm-api/tools.ts";
import { type NoticeDeps, slackFor } from "./send.ts";

export type Unknown = { id: string; ref: string; kind: string; target: string | null; channel: string | null; threadTs: string | null; oldest: string | null };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const MAX_PAGES = 20;

export function readUnknown(v: unknown): Unknown | null {
  if (!isObj(v) || !str(v.id) || !str(v.ref)) return null;
  return { id: String(v.id), ref: String(v.ref), kind: str(v.kind) ?? "", target: str(v.target), channel: str(v.channel), threadTs: str(v.threadTs), oldest: str(v.oldest) };
}

/** The ts of the bot's message carrying `Ref {ref}`, or null when it is not there (or Slack would not say). */
export async function findRef(slack: SlackTools, channel: string, threadTs: string | null, oldest: string | null, ref: string): Promise<string | null> {
  const marker = `Ref ${ref}`;
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const opts = { oldest: oldest ?? undefined, limit: 200, cursor };
    const answer = threadTs ? await slack.replies(channel, threadTs, opts) : await slack.history(channel, opts);
    if (answer.kind !== "ok") return null;
    const messages = Array.isArray(answer.body.messages) ? answer.body.messages.filter(isObj) : [];
    for (const m of messages) {
      const fromBot = (typeof m.bot_id === "string" && m.bot_id !== "") || m.subtype === "bot_message";
      if (fromBot && typeof m.text === "string" && m.text.includes(marker) && typeof m.ts === "string" && /^\d+\.\d+$/.test(m.ts)) return m.ts;
    }
    const meta = isObj(answer.body.response_metadata) ? answer.body.response_metadata : {};
    cursor = typeof meta.next_cursor === "string" && meta.next_cursor ? meta.next_cursor : undefined;
    if (!cursor) return null;
  }
  return null;
}

export type ReconcileResult = { checked: number; found: number };

/** Up to 10 unknowns a run. Never posts. */
export async function reconcileUnknowns(deps: NoticeDeps, token: string, rows: Unknown[]): Promise<ReconcileResult> {
  let checked = 0;
  let found = 0;
  for (const row of rows) {
    if (!row.channel || !/^[CGD][A-Z0-9]{8,12}$/.test(row.channel)) continue;
    checked += 1;
    try {
      const slack = slackFor(deps, token, row.id);
      const ts = await findRef(slack, row.channel, row.threadTs, row.oldest, row.ref);
      if (!ts) continue;
      const permalink = await slack.permalink(row.channel, ts);
      await deps.rpc("cockpit_slack_notice_result", { p_id: row.id, p_outcome: "posted", p_ts: ts, p_channel: row.channel, p_error: null, p_detail: permalink ? { permalink } : {} });
      found += 1;
    } catch {
      // A receipt or the result could not be saved: it stays unknown and comes back in 10 minutes.
    }
  }
  return { checked, found };
}
