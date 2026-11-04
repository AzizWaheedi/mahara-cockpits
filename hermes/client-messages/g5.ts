/**
 * G5, the WhatsApp phone check (docs/forms/STAGE2B-CONTRACT.md 4.16, Z29):
 * does the guard's WhatsApp token send from the same number Make 07 uses for
 * 1-1 recaps? For each card and time given, it finds Make 07's recap in the
 * card's group (the message whose text holds Make's booking block, read
 * within 3 minutes of the time) and reads `from_me` through the guard's token.
 * Every pair found and from_me is `same number`; any pair from another number
 * is `different number` (with both numbers as their last four digits only,
 * for the CEO's B5 sentence); a group it cannot read or a recap it cannot find
 * is `not proven`, which counts as failed. Read only: receipts under run_key
 * client-messages:g5, one health row, no full number printed or stored.
 *
 *   run.sh g5 --task <card> --at <iso> [--task <card> --at <iso> ...]
 */
import { groupOf, last4 } from "./core.ts";
import { type Db, makeDb } from "./db.ts";
import { ledgerFetch } from "./ledger.ts";
import { makeWhapi, readMessage, type WaMessage } from "./whapi.ts";

/** Make 07's booking block: its link id and its first words (recapRules.ts BOOKING_BLOCK, verbatim). */
export const BOOKING_ID = "SHjlq0UjeR11maltYNyh";
export const BOOKING_WORDS = "إذا ما حجزت مكالمة المتابعة";
export const WINDOW_S = 180;

export type Pair = { task: string; at: string };
export type Checked = {
  task: string;
  at: string;
  found: boolean;
  fromMe: boolean | null;
  fromLast4: string | null;
};
export type G5 = {
  verdict: "same number" | "different number" | "not proven";
  checked: Checked[];
  channelLast4: string | null;
};
export type G5Deps = {
  sheet: () => Promise<unknown[][]>;
  /** One page of a group's messages in a time window (epoch seconds), at an offset. */
  page: (
    group: string,
    from: number,
    to: number,
    offset: number,
  ) => Promise<WaMessage[]>;
  health: () => Promise<{ channelLast4: string | null }>;
};

/** --task and --at, in pairs, in order. */
export function readPairs(argv: string[]): Pair[] | string {
  const pairs: Pair[] = [];
  for (let i = 0; i < argv.length; i += 4) {
    if (argv[i] !== "--task" || argv[i + 2] !== "--at")
      return "Give pairs of --task <card> --at <iso time>.";
    const task = String(argv[i + 1] ?? "");
    const at = String(argv[i + 3] ?? "");
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(task))
      return `${task || "A card"} is not a ClickUp card id.`;
    if (!Number.isFinite(Date.parse(at)))
      return `${at || "A time"} is not a time.`;
    pairs.push({ task, at });
  }
  return pairs.length
    ? pairs
    : "Give at least one --task <card> --at <iso time>.";
}

const isRecap = (m: WaMessage) =>
  m.body.includes(BOOKING_ID) && m.body.includes(BOOKING_WORDS);

export async function checkG5(deps: G5Deps, pairs: Pair[]): Promise<G5> {
  const checked: Checked[] = [];
  let values: unknown[][] | null = null;
  try {
    values = await deps.sheet();
  } catch {
    values = null;
  }
  for (const p of pairs) {
    const row: Checked = {
      task: p.task,
      at: p.at,
      found: false,
      fromMe: null,
      fromLast4: null,
    };
    checked.push(row);
    const g = values ? groupOf(values, p.task) : null;
    if (!g?.ok) continue;
    const at = Math.floor(Date.parse(p.at) / 1000);
    const from = at - WINDOW_S;
    const to = at + WINDOW_S;
    try {
      let hit: WaMessage | undefined;
      // The window filter first, keeping only messages within 3 minutes; a full page (the
      // filter ignored) pages on by offset, to 500 messages.
      for (let offset = 0; offset < 500; offset += 100) {
        const page = await deps.page(g.group, from, to, offset);
        hit = page.find(
          m => m.at !== null && m.at >= from && m.at <= to && isRecap(m),
        );
        if (hit || page.length < 100) break;
      }
      if (!hit) continue;
      row.found = true;
      row.fromMe = hit.fromMe;
      row.fromLast4 = last4(hit.from);
    } catch {
      // An unreadable group proves nothing.
    }
  }
  let verdict: G5["verdict"];
  if (checked.some(c => c.found && c.fromMe === false))
    verdict = "different number";
  else if (checked.length && checked.every(c => c.found && c.fromMe === true))
    verdict = "same number";
  else verdict = "not proven";
  let channelLast4: string | null = null;
  if (verdict === "different number") {
    try {
      channelLast4 = (await deps.health()).channelLast4;
    } catch {
      channelLast4 = null;
    }
  }
  return { verdict, checked, channelLast4 };
}

const NOTE: Record<G5["verdict"], string> = {
  "same number": "same number",
  "different number": "different number",
  "not proven": "not proven",
};

/** The command: read only, one health row (ok only for same number), the answer printed with last fours only. */
export async function g5Main(
  read: { env: Record<string, string | undefined> },
  argv: string[],
  db: Db | null = null,
): Promise<number> {
  const pairs = readPairs(argv);
  if (typeof pairs === "string") {
    console.log(JSON.stringify({ ok: false, note: pairs }));
    return 2;
  }
  const store = db ?? makeDb(read.env);
  // One ledger for the whole check: its count of receipts lost after a call left goes in the row.
  const ledger = ledgerFetch({
    insert: store.receipt,
    runKey: "client-messages:g5",
  });
  const whapi = makeWhapi(read.env, ledger.fetch);
  const answer = await checkG5(
    {
      sheet: () => whapi.sheet(),
      page: async (group, from, to, offset) => {
        const q = new URLSearchParams({
          count: "100",
          offset: String(offset),
          time_from: String(from),
          time_to: String(to),
        });
        const data = await whapi.transport.json(
          "Whapi",
          `https://gate.whapi.cloud/messages/list/${group}?${q}`,
          {
            headers: {
              Authorization: `Bearer ${whapi.transport.needed("AD_BILLING_WHAPI_TOKEN")}`,
            },
          },
          true,
        );
        return (Array.isArray(data?.messages) ? data.messages : [])
          .map(readMessage)
          .filter((m: WaMessage | null): m is WaMessage => !!m);
      },
      health: () => whapi.health(),
    },
    pairs,
  );
  // The note stays the verdict alone (the guardian reads it exactly); the lost receipts go in the detail.
  const detail = { ...answer, receiptsMissing: ledger.state.failures };
  await store.health({
    key: "client-messages-g5",
    ok: answer.verdict === "same number",
    note: NOTE[answer.verdict],
    detail,
  });
  console.log(JSON.stringify(detail, null, 2));
  return answer.verdict === "same number" ? 0 : 1;
}
