/**
 * A fetch that answers from routes and records every call, and a fake Graph
 * built on it. Nothing here touches a network. Test-only: index.ts never
 * imports it.
 */
import type { Row } from "./graph.ts";

export type Call = { url: URL; method: string; headers: Record<string, string>; body: string | null };
export type Route = (call: Call) => Response | null | Promise<Response | null>;

export function fakeFetch(routes: Route[]) {
  const calls: Call[] = [];
  const request = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, val]) => [k.toLowerCase(), String(val)]));
    const raw = init?.body;
    const call = { url, method: init?.method ?? "GET", headers, body: raw === undefined || raw === null ? null : String(raw) };
    calls.push(call);
    for (const route of routes) {
      const answer = await route(call);
      if (answer) return answer;
    }
    return new Response(JSON.stringify({ error: { message: "unrouted", code: 999 } }), { status: 599 });
  }) as typeof fetch;
  return { calls, request };
}

export const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
export const metaError = (code: number, message: string, status = 400, subcode?: number) =>
  ok({ error: { message, type: "OAuthException", code, ...(subcode ? { error_subcode: subcode } : {}), fbtrace_id: "Afixture" } }, status);

/** The path of a Graph call after the version ("act_1/insights"). */
export const graphPath = (c: Call) => c.url.pathname.replace(/^\/v[0-9.]+\//, "");

/**
 * Meta's ad-level insights for an account, from a function of the asked
 * span, paged by `pageSize` with cursors the way Graph pages them.
 */
export function insightsRoute(accountId: string, rowsFor: (since: string, until: string) => Row[] | Response, pageSize = 500): Route {
  return call => {
    if (graphPath(call) !== `act_${accountId}/insights` || call.url.searchParams.get("level") !== "ad") return null;
    const range = JSON.parse(call.url.searchParams.get("time_range") ?? "{}");
    const all = rowsFor(range.since, range.until);
    if (all instanceof Response) return all;
    const start = Number(call.url.searchParams.get("after") ?? "0");
    const page = all.slice(start, start + pageSize);
    const more = start + pageSize < all.length;
    return ok({
      data: page,
      paging: { cursors: { before: String(start), after: String(start + pageSize) }, ...(more ? { next: "https://graph.facebook.com/v25.0/next?access_token=SHOULD-NOT-BE-FOLLOWED" } : {}) },
    });
  };
}

/** Each day from since to until. */
export function eachDay(since: string, until: string): string[] {
  const out: string[] = [];
  for (let d = since; d <= until; d = new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) out.push(d);
  return out;
}
