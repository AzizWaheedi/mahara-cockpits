/**
 * Fakes for the Hubstaff watch tests: Kuwait clock helpers, people, and a
 * fetch that answers Hubstaff, the vision models, Slack and Storage from
 * made-up data. Nothing here touches a network. Test-only: index.ts never
 * imports it.
 */
import type { WatchPerson } from "./inputs.ts";
import type { WatchReceiptRow } from "./ledger.ts";

export const DAY = "2026-10-13";
/** A Kuwait wall-clock time today as a UTC ISO instant ("10:12" -> 07:12Z). */
export const kw = (hhmm: string, day = DAY) => new Date(Date.parse(`${day}T${hhmm}:00Z`) - 3 * 3600_000).toISOString();

export function person(over: Partial<WatchPerson> = {}): WatchPerson {
  return {
    personId: 1, name: "Lama Harb", role: "Call Centre Agent", hubstaffUserId: "3616851", accountStatus: "active",
    shift: { start: kw("10:00"), end: kw("18:00") }, offReason: null, screenshotsOn: true, leave: [], ...over,
  };
}

/** A tiny valid JPEG header followed by filler. */
export const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);

export type Call = { url: URL; method: string; headers: Record<string, string>; body: string | null };
export type Route = (call: Call) => Response | null | Promise<Response | null>;

/** A fetch that records every call and answers from the routes, in order; anything unrouted is a 599 the test will see. */
export function fakeFetch(routes: Route[]) {
  const calls: Call[] = [];
  const request = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), String(v)]));
    const raw = init?.body;
    const body = raw === undefined || raw === null ? null : typeof raw === "string" ? raw : "[binary]";
    const call = { url, method: init?.method ?? "GET", headers, body };
    calls.push(call);
    for (const route of routes) {
      const answer = await route(call);
      if (answer) return answer;
    }
    return new Response(JSON.stringify({ error: "unrouted" }), { status: 599 });
  }) as typeof fetch;
  return { calls, request };
}

export const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export type HubstaffData = {
  lastActivities?: Record<string, unknown>[];
  activities?: Record<string, unknown>[];
  screenshots?: Record<string, unknown>[];
  toolUsages?: Record<string, unknown>[];
  settings?: Record<string, unknown>[];
  /** Split last_activities into pages of this size, to exercise next_page_start_id. */
  pageSize?: number;
};

/** Hubstaff's API, the screenshot images on S3, and nothing else. */
export function hubstaffRoute(data: HubstaffData): Route {
  return call => {
    if (call.url.host === "hubstaff-production.s3.amazonaws.com") return new Response(JPEG.slice(), { status: 200, headers: { "Content-Type": "image/jpeg" } });
    if (call.url.host !== "api.hubstaff.com") return null;
    const path = call.url.pathname.replace(/^\/v2\/organizations\/\d+\//, "");
    if (path === "last_activities") {
      const all = data.lastActivities ?? [];
      const size = data.pageSize ?? 500;
      const start = Number(call.url.searchParams.get("page_start_id") ?? "0");
      const page = all.slice(start, start + size);
      return ok({ last_activities: page, ...(start + size < all.length ? { pagination: { next_page_start_id: start + size } } : {}) });
    }
    if (path === "activities") return ok({ activities: data.activities ?? [] });
    if (path === "screenshots") return ok({ screenshots: data.screenshots ?? [] });
    if (path === "tool_usages") return ok({ tool_usages: (data.toolUsages ?? []).filter(t => t.tool_type === call.url.searchParams.get("tool_type")) });
    if (path === "screenshot_settings") return ok({ screenshot_settings: data.settings ?? [] });
    return null;
  };
}

export function receiptsRecorder() {
  const rows: WatchReceiptRow[] = [];
  return { rows, insert: async (row: WatchReceiptRow) => { rows.push(row); } };
}
