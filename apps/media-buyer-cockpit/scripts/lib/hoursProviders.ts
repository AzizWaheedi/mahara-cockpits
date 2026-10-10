/**
 * A fake Hubstaff and Timetastic for the sync tests, answering from the
 * hand-built fixtures in supabase/functions/cockpit-hours-sync/fixtures
 * (documented shapes, invented values). It filters by the query the sync
 * sends, so chunked reads never see a record twice.
 */
import { readFileSync } from "node:fs";

const DIR = new URL("../../../../supabase/functions/cockpit-hours-sync/fixtures/", import.meta.url);
// biome-ignore lint/suspicious/noExplicitAny: fixture bodies are free-form JSON
export const fixture = (name: string): any => JSON.parse(readFileSync(new URL(name, DIR), "utf8")).body;

export type Call = { method: string; url: URL; at: number };
export type FakeOptions = {
  /** Timetastic user id to the payroll id their contact card holds. */
  payrollIds?: Record<string, string>;
  /** Return a response to replace the default for a request, or null. */
  override?: (url: URL, init: RequestInit | undefined, calls: Call[]) => Response | null;
  /** The clock used to stamp calls (for pacing tests). */
  now?: () => number;
};

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

export function fakeProviders(opts: FakeOptions = {}) {
  const calls: Call[] = [];
  const request = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = String(init?.method ?? "GET");
    calls.push({ method, url, at: opts.now ? opts.now() : Date.now() });
    const replaced = opts.override?.(url, init, calls);
    if (replaced) return replaced;
    const q = url.searchParams;
    if (url.host === "account.hubstaff.com" && url.pathname === "/access_tokens")
      return ok({ access_token: "accessTokenInventedValue", refresh_token: "refreshTokenInventedNext", expires_in: 86400, token_type: "bearer" });
    if (url.host === "api.hubstaff.com") {
      const path = url.pathname.replace(/^\/v2\//, "");
      if (path === "organizations") return ok(fixture("hubstaff-organizations.json"));
      if (path === "users/me") return ok(fixture("hubstaff-users-me.json"));
      if (/^organizations\/\d+\/members$/.test(path)) return ok(fixture("hubstaff-members.json"));
      if (/^organizations\/\d+\/last_activities$/.test(path)) return ok(fixture("hubstaff-last-activities.json"));
      if (/^organizations\/\d+\/activities$/.test(path)) {
        const start = Date.parse(q.get("time_slot[start]") ?? "");
        const stop = Date.parse(q.get("time_slot[stop]") ?? "");
        const all = fixture("hubstaff-activities.json").activities as { time_slot: string }[];
        return ok({ activities: all.filter(a => Date.parse(a.time_slot) >= start && Date.parse(a.time_slot) < stop), pagination: {} });
      }
      if (/^organizations\/\d+\/activities\/daily$/.test(path)) {
        const from = q.get("date[start]") ?? "";
        const to = q.get("date[stop]") ?? "";
        const all = fixture("hubstaff-daily-activities.json").daily_activities as { date: string }[];
        return ok({ daily_activities: all.filter(d => d.date >= from && d.date <= to), pagination: {} });
      }
    }
    if (url.host === "app.timetastic.co.uk") {
      const path = url.pathname.replace(/^\/api\//, "");
      if (path === "users") return ok(fixture("timetastic-users.json"));
      if (/^users\/\d+$/.test(path)) return ok({ ...fixture("timetastic-user-detail.json"), id: Number(path.split("/")[1]) });
      if (/^users\/contact\/\d+$/.test(path)) {
        const id = path.split("/")[2];
        return ok({ ...fixture("timetastic-user-contact.json"), id: Number(id), payrollId: opts.payrollIds?.[id] ?? null });
      }
      if (path === "leavetypes") return ok(fixture("timetastic-leavetypes.json"));
      if (path === "holidays") {
        const start = (q.get("Start") ?? "0000").slice(0, 10);
        const end = (q.get("End") ?? "9999").slice(0, 10);
        const page = fixture("timetastic-holidays.json");
        const holidays = (page.holidays as { startDate: string }[]).filter(h => h.startDate.slice(0, 10) >= start && h.startDate.slice(0, 10) <= end);
        return ok({ ...page, holidays, totalRecords: holidays.length });
      }
      if (path === "absences") {
        const start = (q.get("Start") ?? "0000").slice(0, 10);
        const end = (q.get("End") ?? "9999").slice(0, 10);
        return ok((fixture("timetastic-absences.json") as { date: string }[]).filter(d => d.date.slice(0, 10) >= start && d.date.slice(0, 10) <= end));
      }
    }
    return new Response('{"error":"not_found"}', { status: 404 });
  };
  return { request: request as typeof fetch, calls };
}

/** A clock that only moves when the code under test sleeps. */
export function fakeClock(startIso: string) {
  let t = Date.parse(startIso);
  return {
    now: () => new Date(t),
    nowMs: () => t,
    sleep: async (ms: number) => { t += Math.max(0, ms); },
    advance: (ms: number) => { t += ms; },
  };
}
