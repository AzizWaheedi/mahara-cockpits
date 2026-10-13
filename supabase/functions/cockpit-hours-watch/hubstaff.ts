/**
 * What Hubstaff watch reads from Hubstaff on one run (SPEC.md "Edge
 * Function"), all through hubstaffGet (GET only, the path allowlist, intent
 * and response receipts, pay fields dropped), every list read to its last
 * page through next_page_start_id.
 *
 *   last_activities      who has the timer running, and when it last ran
 *   activities           today's 10-minute blocks (tracked, keyboard and mouse)
 *   screenshots          the last 40 minutes
 *   tool_usages          the last 40 minutes, applications and sites
 *   screenshot_settings  screenshots per 10 minutes, per person
 *
 * The first three decide alerts: when any of them fails, the whole read
 * fails and the run opens the source incident instead of guessing. Tool usage
 * and screenshot settings only add context, so their failure is a note.
 * Screenshot images come from Hubstaff's signed S3 links (2 hours), checked
 * to be on Hubstaff's storage and to be a JPEG of at most 3 MB.
 */
import { HoursProviderError, type HoursHealth, hubstaffGet } from "../cockpit-ceo-api/tools.ts";
import type { Rpc } from "../cockpit-hours-sync/db.ts";
import { normaliseLastActivities } from "../cockpit-hours-sync/normalise.ts";
import { isObj } from "./inputs.ts";
import { hubstaffAccess } from "./keys.ts";
import type { WatchHealth } from "./ledger.ts";
import { type ActivityRecord, type LastActivity, slotOf } from "./rules.ts";
import type { AppUse } from "./classify.ts";

export const SHOT_LOOKBACK_MS = 40 * 60_000;
const MAX_PAGES = 20;
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

export type Screenshot = { id: number; userId: string; recordedAt: string; slotStart: string; fullUrl: string | null; thumbUrl: string | null };
export type ToolUse = { userId: string; slotStart: string; app: AppUse };
export type HubstaffRead =
  | {
    ok: true;
    org: string;
    lastActivities: Map<string, LastActivity>;
    activities: ActivityRecord[];
    screenshots: Screenshot[];
    toolUsages: ToolUse[];
    screenshotsOn: Map<string, boolean> | null;
    /** The instant the read was made: blocks after readAt - 20 min may not be in yet. */
    readAt: string;
    notes: string[];
  }
  | { ok: false; state: string; note: string };

export type HubstaffDeps = { rpc: Rpc; hubstaff: HoursHealth; fetch: typeof fetch; now: () => Date; sleep: (ms: number) => Promise<void> };

/** An ISO instant to the second, as Hubstaff's time_slot filters take it. */
const stamp = (ms: number) => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(".000Z", "Z");
const instant = (v: unknown): string | null => (typeof v === "string" && Number.isFinite(Date.parse(v)) ? new Date(Date.parse(v)).toISOString() : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : 0);
/** A web address up to its first ? or #: query strings and fragments (tokens, a lead's phone or email) never leave the read. */
export const cutUrl = (v: string): string => v.split(/[?#]/, 1)[0];
const listOf = (page: unknown, key: string): Record<string, unknown>[] => (isObj(page) && Array.isArray(page[key]) ? page[key].filter(isObj) : []);

export class ReadError extends Error {}

/**
 * Read everything for one run. `from` is the earliest instant today's
 * activity read must cover (00:00 Kuwait, or an earlier shift start).
 */
export async function readHubstaff(deps: HubstaffDeps, p: { from: Date; shots: boolean }): Promise<HubstaffRead> {
  const now = deps.now().getTime();
  let access: Awaited<ReturnType<typeof hubstaffAccess>>;
  try {
    access = await hubstaffAccess(deps.rpc, deps.hubstaff, deps.fetch, deps.now);
  } catch (e) {
    return { ok: false, state: "failed", note: e instanceof HoursProviderError ? e.message : "The Hubstaff key could not be read." };
  }
  if (!access.ok) return { ok: false, state: access.state, note: access.note };
  const token = access.token;
  const org = `organizations/${access.accountId}`;
  const pages = async (path: string, params: Record<string, string | number>) => {
    const out: unknown[] = [];
    let start: string | null = null;
    for (let i = 0; i < MAX_PAGES; i++) {
      const page = await hubstaffGet(token, deps.hubstaff, deps.fetch, path, { ...params, page_limit: 500, ...(start ? { page_start_id: start } : {}) }, { sleep: deps.sleep });
      out.push(page);
      const next = (page.pagination as Record<string, unknown> | undefined)?.next_page_start_id;
      if (next === undefined || next === null || next === "") return out;
      start = String(next);
    }
    throw new ReadError(`Hubstaff had more than ${MAX_PAGES} pages for one read.`);
  };
  const stop = stamp(Math.floor(now / 60_000) * 60_000);
  const shotFrom = stamp(Date.parse(slotOf(now - SHOT_LOOKBACK_MS)));
  const notes: string[] = [];
  try {
    const last = normaliseLastActivities(await pages(`${org}/last_activities`, {}));
    const lastActivities = new Map<string, LastActivity>();
    for (const [userId, l] of last) lastActivities.set(userId, { online: l.online, lastClientActivity: instant(l.lastActivityAt) });

    const activities: ActivityRecord[] = [];
    for (const page of await pages(`${org}/activities`, { "time_slot[start]": stamp(p.from.getTime()), "time_slot[stop]": stop })) {
      for (const a of listOf(page, "activities")) {
        const slot = instant(a.time_slot);
        if (a.user_id === undefined || a.user_id === null || !slot) continue;
        // input_tracked: time tracked with keyboard and mouse; absent counts as none, so it never proves idle.
        activities.push({ userId: String(a.user_id), slotStart: slot, tracked: num(a.tracked), inputTracked: num(a.input_tracked), overall: num(a.overall), idle: a.time_type === "idle" });
      }
    }

    const screenshots: Screenshot[] = [];
    if (p.shots) {
      for (const page of await pages(`${org}/screenshots`, { "time_slot[start]": shotFrom, "time_slot[stop]": stop })) {
        for (const s of listOf(page, "screenshots")) {
          const id = Number(s.id);
          const recordedAt = instant(s.recorded_at) ?? instant(s.time_slot);
          const slot = instant(s.time_slot) ?? (recordedAt ? slotOf(Date.parse(recordedAt)) : null);
          if (!Number.isSafeInteger(id) || id <= 0 || s.user_id === undefined || s.user_id === null || !recordedAt || !slot) continue;
          screenshots.push({ id, userId: String(s.user_id), recordedAt, slotStart: slot,
            fullUrl: typeof s.full_url === "string" ? s.full_url : null, thumbUrl: typeof s.thumb_url === "string" ? s.thumb_url : null });
        }
      }
    }

    const toolUsages: ToolUse[] = [];
    if (p.shots && screenshots.length) {
      for (const type of ["application", "url"] as const) {
        try {
          for (const page of await pages(`${org}/tool_usages`, { "time_slot[start]": shotFrom, "time_slot[stop]": stop, tool_type: type })) {
            for (const t of listOf(page, "tool_usages")) {
              const slot = instant(t.time_slot);
              if (t.user_id === undefined || t.user_id === null || !slot || typeof t.name !== "string") continue;
              const kind = t.tool_type === "url" ? "url" : type;
              const titles = (Array.isArray(t.details) ? t.details.filter(isObj) : []).map(d => (typeof d.title === "string" ? d.title : typeof d.url === "string" ? cutUrl(d.url) : "")).filter(Boolean);
              toolUsages.push({ userId: String(t.user_id), slotStart: slot, app: { name: kind === "url" ? cutUrl(t.name) : t.name, type: kind, titles } });
            }
          }
        } catch (e) {
          if (e instanceof HoursProviderError && e.kind === "firewall_blocked") throw e;
          notes.push(`Apps and sites (${type}) could not be read: ${e instanceof Error ? e.message.slice(0, 120) : "no answer"}`);
        }
      }
    }

    let screenshotsOn: Map<string, boolean> | null = null;
    try {
      const found = new Map<string, boolean>();
      for (const page of await pages(`${org}/screenshot_settings`, {})) {
        const rows = isObj(page) ? Object.values(page).filter(Array.isArray).flat().filter(isObj) : [];
        for (const r of rows) if (r.user_id !== undefined && r.user_id !== null && r.screenshot_frequency !== undefined) found.set(String(r.user_id), num(r.screenshot_frequency) > 0);
      }
      screenshotsOn = found;
    } catch (e) {
      if (e instanceof HoursProviderError && e.kind === "firewall_blocked") throw e;
      notes.push(`Screenshot settings could not be read: ${e instanceof Error ? e.message.slice(0, 120) : "no answer"}`);
    }
    return { ok: true, org: access.accountId, lastActivities, activities, screenshots, toolUsages, screenshotsOn, readAt: new Date(now).toISOString(), notes };
  } catch (e) {
    const note = e instanceof HoursProviderError || e instanceof ReadError ? e.message : "The Hubstaff read stopped unexpectedly.";
    return { ok: false, state: e instanceof HoursProviderError ? e.kind : "failed", note };
  }
}

/** The apps and sites logged in one person's 10-minute slot, most first. */
export function appsFor(toolUsages: ToolUse[], userId: string, slotStart: string): AppUse[] {
  const merged = new Map<string, AppUse>();
  for (const t of toolUsages) {
    if (t.userId !== userId || t.slotStart !== slotStart) continue;
    const key = `${t.app.type}:${t.app.name}`;
    const had = merged.get(key);
    merged.set(key, had ? { ...had, titles: [...new Set([...had.titles, ...t.app.titles])] } : t.app);
  }
  return [...merged.values()];
}

const IMAGE_HOST = /(^|\.)amazonaws\.com$|(^|\.)hubstaff\.com$/;

/**
 * One screenshot image from Hubstaff's signed link, receipted as a Hubstaff
 * call (the resource is the host and a template, never the signed query).
 */
export const DOWNLOAD_TIMEOUT_MS = 15_000;

export async function downloadImage(deps: { health: WatchHealth; fetch: typeof fetch }, link: string, which: "full" | "thumb", timeoutMs = DOWNLOAD_TIMEOUT_MS): Promise<Uint8Array> {
  let url: URL;
  try { url = new URL(link); } catch { throw new ReadError("Hubstaff gave a screenshot link this can't read."); }
  if (url.protocol !== "https:" || !IMAGE_HOST.test(url.hostname) || url.username || url.password) throw new ReadError("Hubstaff gave a screenshot link to another host; nothing was fetched.");
  const receipt = { provider: "hubstaff" as const, method: "GET" as const, resource: `${url.host}/{screenshot-${which}}` };
  await deps.health({ ...receipt, phase: "intent" });
  let response: Response;
  try {
    response = await deps.fetch(url.toString(), { method: "GET", redirect: "error", signal: AbortSignal.timeout(Math.max(1, Math.min(timeoutMs, DOWNLOAD_TIMEOUT_MS))) });
  } catch {
    await deps.health({ ...receipt, phase: "unknown", error: "No answer from Hubstaff's storage" });
    throw new ReadError("Hubstaff's screenshot storage did not answer.");
  }
  await deps.health({ ...receipt, phase: "response", http_status: response.status, error: response.ok ? undefined : `HTTP ${response.status}` });
  if (!response.ok) throw new ReadError(`Hubstaff's screenshot storage answered ${response.status}; the link may have expired.`);
  const size = Number(response.headers.get("content-length") ?? "0");
  if (size > MAX_IMAGE_BYTES) throw new ReadError("The screenshot is larger than 3 MB.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > MAX_IMAGE_BYTES) throw new ReadError("The screenshot is larger than 3 MB.");
  if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) throw new ReadError("The screenshot is not a JPEG.");
  return bytes;
}
