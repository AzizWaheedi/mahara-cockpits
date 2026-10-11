/**
 * Team end-of-day reports that mention a client, for the client page.
 *
 * Sources, read-only:
 *  - the cockpit's own EODs (cockpit_eod_reports),
 *  - every tab of the EOD Reports sheet (every role's form writes a row there),
 *  - the Slack EOD channels the bot can read (free-form and posted EODs).
 *
 * Only the passages that name the client are stored, with author, role and day.
 * Energy, stress and other personal fields are never copied: a passage is kept
 * only when it names a client. The same report seen in two places is kept once.
 */
import type { Client, Row } from "./match";
import { kuwaitDay } from "./match";
import type { Health } from "./lib";
import type { Ctx } from "./sources";

const DAY = 86_400_000;
/** Slack EOD channels. The bot must be a member; the ones it cannot read are named on the page. */
export const EOD_CHANNELS: Record<string, string> = {
  "eods-csms": "C09RQS2TFST",
  "eods-salesreps": "C0AF5PJEAUX",
  "media-eods": "C0AQ2LD0PL1",
};
export const EOD_CHANNELS_UNREAD = ["tech-eods", "eods-csr"];
/** Sheet tab -> role label shown on the page. */
export const TAB_ROLE: Record<string, string> = {
  "Media Buyer": "media buyer",
  "Account Manager": "account manager",
  "Client Sales Rep": "client sales rep",
  "Systems Manager": "systems manager",
  "Sales Rep": "sales rep",
  Setter: "setter",
  "Creative Director": "creative director",
  "Video Editors": "video editor",
  "Executive Assistant": "executive assistant",
};
/** Answers that are personal or numeric only: never scanned, never stored. */
const PRIVATE_FIELD = /^(energy|stress|focus|biology|submitted at|response id|date for|name)$/i;

/** Lowercase words joined by single spaces, letters and digits only (Arabic kept). */
export function words(s: unknown): string {
  return ` ${String(s ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()} `;
}

/** Every client a passage names, by whole-word name or alias of 4+ letters. Longest name wins an overlap. */
export function clientsNamedIn(text: string, clients: Client[]): Client[] {
  const t = words(text);
  if (t.trim().length < 4) return [];
  const hits: { c: Client; n: string }[] = [];
  for (const c of clients)
    for (const n of new Set([c.name, ...c.aliases].map(words)))
      if (n.trim().replace(/ /g, "").length >= 4 && t.includes(n)) {
        hits.push({ c, n });
        break;
      }
  // "Al Rai" inside "Al Rai Group": keep the longer name only when both point at different clients.
  return hits
    .filter(h => !hits.some(o => o.c.taskId !== h.c.taskId && o.n.length > h.n.length && o.n.includes(h.n)))
    .map(h => h.c);
}

export type Passage = { label?: string; text: string };

/** The passages of one report that name this client, joined, at most 1,500 characters. */
export function excerptFor(passages: Passage[], client: Client): string {
  const keep: string[] = [];
  for (const p of passages) {
    if (p.label && PRIVATE_FIELD.test(p.label.trim())) continue;
    const lines = p.text.split(/\n+/).map(l => l.trim()).filter(Boolean);
    const hit = lines.filter(l => clientsNamedIn(l, [client]).length);
    // A field that names the client in a line keeps that line; a one-line field keeps itself.
    const picked = hit.length ? hit : clientsNamedIn(p.text, [client]).length ? [p.text.trim()] : [];
    for (const l of picked) keep.push(p.label ? `${p.label}: ${l}` : l);
  }
  const out = [...new Set(keep)].join("\n");
  return out.length > 1500 ? `${out.slice(0, 1497)}...` : out;
}

/** The same report copied to the sheet and Slack is one item: same client, day and mostly the same words. */
export function sameReport(a: string, b: string): boolean {
  const A = new Set(words(a).trim().split(" ").filter(w => w.length > 2));
  const B = new Set(words(b).trim().split(" ").filter(w => w.length > 2));
  if (!A.size || !B.size) return false;
  let both = 0;
  for (const w of A) if (B.has(w)) both++;
  return both / Math.min(A.size, B.size) >= 0.6;
}

export type Report = {
  source: "cockpit" | "sheet" | "slack";
  sourceId: string;
  author?: string;
  role?: string;
  where: string;
  at: number;
  day: string;
  link?: string;
  passages: Passage[];
};

/** Mention rows for every client every report names; a lower-ranked copy of the same report is dropped. */
export function mentionRows(reports: Report[], clients: Client[], now: number): Row[] {
  const rank = { cockpit: 0, sheet: 1, slack: 2 } as const;
  const rows: Row[] = [];
  const kept = new Map<string, { excerpt: string; source: string }[]>();
  for (const r of [...reports].sort((a, b) => rank[a.source] - rank[b.source] || a.at - b.at)) {
    const all = r.passages.filter(p => !(p.label && PRIVATE_FIELD.test(p.label.trim())));
    const named = clientsNamedIn(all.map(p => p.text).join("\n"), clients);
    for (const c of named) {
      const excerpt = excerptFor(all, c);
      if (!excerpt) continue;
      const k = `${c.taskId}|${r.day}`;
      const same = kept.get(k) ?? [];
      if (same.some(s => s.source !== r.source && sameReport(s.excerpt, excerpt))) continue;
      same.push({ excerpt, source: r.source });
      kept.set(k, same);
      rows.push({
        source: r.source,
        source_id: r.sourceId.slice(0, 200),
        task_id: c.taskId,
        client_name: c.name,
        day: r.day,
        at: new Date(r.at).toISOString(),
        author: r.author ? String(r.author).slice(0, 120) : null,
        role: r.role ?? null,
        location: r.where.slice(0, 120),
        link: r.link ?? null,
        excerpt,
        updated_at: new Date(now).toISOString(),
      });
    }
  }
  return rows;
}

/** "2026-10-06 20:05:04" in Kuwait time, or "11-10-2026", or an ISO date. */
export function sheetTime(s: unknown): number {
  const v = String(s ?? "").trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(v);
  if (m) return Date.parse(`${m[1]}-${m[2]}-${m[3]}T${(m[4] ?? "12").padStart(2, "0")}:${m[5] ?? "00"}:${m[6] ?? "00"}+03:00`);
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(v);
  if (m) return Date.parse(`${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}T12:00:00+03:00`);
  return Number.NaN;
}

/** Slack mrkdwn to plain text: user and channel tags kept as names, links as their label. */
export function slackText(s: string): string {
  return s
    .replace(/<([^|>]+)\|([^>]+)>/g, "$2")
    .replace(/<[@#!][^>]*>/g, "")
    .replace(/<(https?:[^>]+)>/g, "$1")
    .replace(/[*_~`]/g, "");
}

export async function eodSource(ctx: Ctx, sinceMs: number): Promise<Health> {
  const { t, db } = ctx;
  const reports: Report[] = [];
  const per: Record<string, { read: number; newest?: string }> = {};
  const note = (k: string, at: number) => {
    const p = (per[k] ??= { read: 0 });
    p.read++;
    if (Number.isFinite(at) && (!p.newest || new Date(at).toISOString() > p.newest)) p.newest = new Date(at).toISOString();
  };
  const failed: string[] = [];

  // 1. The cockpit's own EODs.
  try {
    for (const e of await db.all("cockpit_eod_reports", `select=id,role,day,submitted_at,answers,body,owner_email&submitted_at=gte.${new Date(sinceMs).toISOString()}`)) {
      const at = Date.parse(e.submitted_at);
      note("cockpit", at);
      const passages: Passage[] = Object.entries((e.answers ?? {}) as Row)
        .filter(([k, v]) => k !== "body" && typeof v === "string" && v.trim())
        .map(([k, v]) => ({ label: k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " "), text: String(v) }));
      if (e.body) passages.push({ text: String(e.body) });
      reports.push({ source: "cockpit", sourceId: `eod:${e.id}`, author: String(e.owner_email ?? "").split("@")[0], role: String(e.role ?? "").replace(/_/g, " "), where: "cockpit EOD", at, day: String(e.day ?? kuwaitDay(at)), passages });
    }
  } catch (e) {
    failed.push(`cockpit EODs: ${String((e as Error).message).slice(0, 80)}`);
  }

  // 2. Every tab of the EOD Reports sheet, read in full.
  try {
    const meta = await t.sheetTabs();
    const tabs: string[] = (meta.sheets ?? []).map((s: Row) => String(s.properties?.title));
    if (!tabs.length) throw new Error("The EOD sheet returned no tabs");
    for (const tab of tabs) {
      const v = await t.sheet(`'${tab.replace(/'/g, "''")}'!A1:AZ`);
      const rows: string[][] = v.values ?? [];
      const head = rows[0] ?? [];
      const col = (name: string) => head.findIndex(h => String(h).trim().toLowerCase() === name);
      const [cAt, cName, cId, cFor] = ["submitted at", "name", "response id", "date for"].map(col);
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const at = sheetTime(r[cAt]);
        if (!Number.isFinite(at) || at < sinceMs) continue;
        note("sheet", at);
        const forDay = sheetTime(r[cFor]);
        reports.push({
          source: "sheet",
          sourceId: `sheet:${tab}:${r[cId] || `${r[cAt]}:${r[cName]}`}`,
          author: r[cName],
          role: TAB_ROLE[tab] ?? tab.toLowerCase(),
          where: `EOD sheet, ${tab}`,
          at,
          day: kuwaitDay(Number.isFinite(forDay) ? forDay : at),
          passages: head.map((h, j) => ({ label: String(h), text: String(r[j] ?? "") })).filter(p => p.text.trim()),
        });
      }
    }
  } catch (e) {
    failed.push(`EOD sheet: ${String((e as Error).message).slice(0, 100)}`);
  }

  // 3. The Slack EOD channels, every page since the window opened.
  for (const [name, id] of Object.entries(EOD_CHANNELS)) {
    try {
      let cursor = "";
      for (let page = 0; ; page++) {
        if (page > 50) throw new Error("history cursor unfinished after 50 pages");
        const h = await t.slackHistory({ channel: id, oldest: String(Math.floor(sinceMs / 1000)), limit: "200", ...(cursor ? { cursor } : {}) });
        for (const m of h.messages ?? []) {
          if (m.subtype && m.subtype !== "bot_message" && m.subtype !== "thread_broadcast") continue;
          const text = slackText(String(m.text ?? ""));
          if (text.length < 20) continue;
          const at = Number(m.ts) * 1000;
          note(`slack #${name}`, at);
          // A posted EOD carries its author's name on its second line ("*Name - 11-10-2026").
          const author = /^\s*([^\n-]{2,60}?)\s+-\s+\d/m.exec(text.split("\n").slice(1, 3).join("\n"))?.[1];
          reports.push({ source: "slack", sourceId: `slack:${id}:${m.ts}`, author: author ?? m.user_profile?.real_name ?? m.username, role: name.replace(/^eods?-|-eods$/g, ""), where: `#${name}`, at, day: kuwaitDay(at), link: `https://maharamedia.slack.com/archives/${id}/p${String(m.ts).replace(".", "")}`, passages: [{ text }] });
        }
        cursor = h.response_metadata?.next_cursor ?? "";
        if (!cursor) break;
      }
    } catch (e) {
      failed.push(`#${name}: ${String((e as Error).message).slice(0, 80)}`);
    }
  }

  const rows = mentionRows(reports, ctx.clients, ctx.now);
  if (ctx.apply && rows.length) await db.upsert("cockpit_csm_eod_mentions", rows, "source,source_id,task_id");
  const clientsWith = new Set(rows.map(r => r.task_id)).size;
  ctx.plan.eods = { reports: reports.length, mentions: rows.length, clientsWith, per, failed };
  const readSome = Object.keys(per).length > 0;
  return {
    key: "csm-eod-mentions",
    ok: failed.length === 0 && readSome,
    rows: rows.length,
    note:
      `${reports.length} EODs read since ${kuwaitDay(sinceMs)} (${Object.entries(per).map(([k, v]) => `${k} ${v.read}`).join(", ") || "none"}), ${rows.length} client mentions across ${clientsWith} clients.` +
      (failed.length ? ` ${failed.length} sources failed: ${failed.join("; ")}` : "") +
      ` Not read: #${EOD_CHANNELS_UNREAD.join(", #")} (the Slack bot is not a member; their EODs still come in through the sheet).`,
    detail: { reports: reports.length, mentions: rows.length, clientsWith, per, failed, notRead: EOD_CHANNELS_UNREAD },
  };
}

/** Kept for tests: a sinceMs for a window of whole days. */
export const daysAgo = (now: number, days: number) => now - days * DAY;
