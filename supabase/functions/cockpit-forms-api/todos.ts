/**
 * We owe / They owe from Fathom's action items, with no model
 * (docs/forms/STAGE2-CONTRACT.md 6.1 and the todos row of 6.5). This is the one
 * copy of the rule: drafts.ts calls it with sideOfName from transcript.ts, and the
 * shadow replay (apps/media-buyer-cockpit/scripts/checkin-replay.ts) imports it
 * and calls it without one, so it imports nothing but the ActionItem type.
 *
 * A completed item is dropped. An assignee at maharamedia.com, or one in a Fathom
 * team, is ours, and the owner is that email's role on the staff list; any other
 * email is the client's; with no email the transcript's speaker side decides, else
 * the line is ours and marked unsure for the CSM to check. Each line fits the 1-1
 * form's to-do item (3.1): one line of 300 characters at most, an owner of 80 at
 * most, a time inside the call, and a link only into this call's Fathom page.
 */
import type { ActionItem } from "../../../hermes/csm-calls/fathomRules.ts";

const OURS = /@maharamedia\.com$/i;
const MAX_TEXT = 300;
const MAX_OWNER = 80;
const MAX_SECONDS = 86_400;

export function todoItems(items: ActionItem[], ctx: { shareUrl: string | null;
  staff: { name: string; email: string | null; role: string | null }[];
  sideOfName?: (name: string) => "we" | "they" | null }):
  { side: "we" | "they"; text: string; owner: string | null; at: number | null; href: string | null; unsure: boolean }[] {
  const roles = new Map<string, string | null>();
  for (const s of ctx.staff ?? []) {
    const e = email(s?.email);
    if (e && !roles.has(e)) roles.set(e, s.role ?? null);
  }
  const share = fathomPage(ctx.shareUrl);
  const out: ReturnType<typeof todoItems> = [];
  for (const item of items ?? []) {
    if (!item || item.completed) continue;
    const text = fit(item.description, MAX_TEXT);
    if (!text) continue;
    const mail = email(item.assigneeEmail);
    const at = seconds(item.seconds);
    let side: "we" | "they" = "we";
    let owner: string | null = null;
    let unsure = false;
    if (OURS.test(mail) || String(item.assigneeTeam ?? "").trim()) owner = mail ? (roles.get(mail) ?? null) : null;
    else if (mail) side = "they";
    else {
      const name = String(item.assigneeName ?? "").trim();
      const said = name && ctx.sideOfName ? ctx.sideOfName(name) : null;
      if (said === "we" || said === "they") side = said;
      else unsure = true;
    }
    out.push({
      side,
      text,
      owner: owner ? fit(owner, MAX_OWNER) || null : null,
      at,
      href: share && at !== null ? `${share}?tab=summary&timestamp=${at}` : null,
      unsure,
    });
  }
  return out;
}

const email = (s: unknown) => String(s ?? "").trim().toLowerCase();

/** Whole seconds into the call, or null when unknown or outside a day. */
function seconds(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= MAX_SECONDS ? Math.floor(v) : null;
}

/** The call's Fathom page without query, fragment or trailing slash; null for any other link. */
function fathomPage(url: string | null): string | null {
  const m = /^https:\/\/fathom\.video(\/[^?#\s]*)/i.exec(String(url ?? "").trim());
  const path = m ? m[1].replace(/\/+$/, "") : "";
  return path ? `https://fathom.video${path}` : null;
}

/** One line, cut at a word to the limit when longer (never inside a character). */
function fit(s: unknown, limit: number): string {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= limit) return t;
  let cut = "";
  for (const ch of t) {
    if (cut.length + ch.length > limit) break;
    cut += ch;
  }
  const space = cut.lastIndexOf(" ");
  return (space >= cut.length - 60 ? cut.slice(0, space) : cut).trim();
}
