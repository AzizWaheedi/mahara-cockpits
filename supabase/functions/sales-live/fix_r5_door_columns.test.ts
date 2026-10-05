// bun test supabase/functions/sales-live/fix_r5_door_columns.test.ts
//
// Fix round 5: the door reads cockpit_sales_rooms.taken_back_join_at
// (20261004a), so a lead's own join a few seconds before "That was not the
// lead" stands. A door deployed before that migration is applied must still
// open every link: its room read is refused with "column ... does not exist",
// and it reads the rooms again without the column. Synthetic only.
import { describe, expect, test } from "bun:test";
import { RateLimiter } from "./door.ts";
import { makeHandler } from "./handler.ts";

const BASE = "https://proj.supabase.co";
const SECRETS: Record<string, string> = {
  SUPABASE_URL: BASE,
  SUPABASE_SERVICE_ROLE_KEY: "svc-key-fixr5-never-printed",
  IP_SALT: "salt-fixr5-never-printed",
};
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const NOW = Date.parse("2026-10-11T11:00:00+03:00");
type Row = Record<string, unknown>;

function world(hasColumn: boolean) {
  const room: Row = {
    id: "00000000-0000-4000-8000-0000000000aa",
    code: "K7Q2MX",
    state: "open",
    provider: "zoom",
    join_url: "https://us06web.zoom.us/j/85077700001?pwd=live",
    host_email: "stress-fixr5-setter@stress.invalid",
    replaced_by: null,
    ends_at: new Date(NOW + 30 * 60_000).toISOString(),
    first_open_at: null,
    purpose: "fallback",
    contact_id: "stress-fixr5-lead",
    requested_at: new Date(NOW - 60_000).toISOString(),
  };
  const reads: string[] = [];
  const logs: string[] = [];
  const fetcher = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    const table = url.pathname.replace("/rest/v1/", "");
    if (table === "cockpit_sales_rooms" && method === "GET") {
      reads.push(url.search);
      const cols = url.searchParams.get("select") ?? "";
      if (!hasColumn && cols.includes("taken_back_join_at"))
        return Response.json({ code: "42703", message: "column cockpit_sales_rooms.taken_back_join_at does not exist" }, { status: 400 });
      return Response.json(url.searchParams.get("code") === "eq.K7Q2MX" ? [room] : []);
    }
    if (table === "cockpit_sales_people") return Response.json([{ name: "Tara Setter", name_ar: null }]);
    if (method === "GET") return Response.json([]);
    return Response.json([], { status: 201 });
  };
  const handler = makeHandler({
    env: n => SECRETS[n] ?? "",
    fetch: fetcher as typeof fetch,
    now: () => NOW,
    background: () => {},
    limiter: new RateLimiter(30, 60_000, 10_000),
    wideLimiter: new RateLimiter(120, 60_000, 10_000),
    log: line => logs.push(line),
  });
  return { handler, reads, logs };
}

const open = (code: string) =>
  new Request(`${BASE}/functions/v1/sales-live/open/${code}?d=fixr5dev`, {
    headers: { "user-agent": IPHONE, "cf-connecting-ip": "198.51.100.7", origin: "https://call.maharamedia.com" },
  });

describe("fix round 5: the door before and after 20261004a's taken_back_join_at", () => {
  test("with the column: one read, the link opens", async () => {
    const w = world(true);
    const res = await w.handler(open("K7Q2MX"));
    expect(res.status).toBe(200);
    expect(w.reads.length).toBe(1);
    expect(w.reads[0]).toContain("taken_back_join_at");
  });

  test("without it: the read is made again without the column, the link still opens, and later reads skip it", async () => {
    const w = world(false);
    const res = await w.handler(open("K7Q2MX"));
    expect(res.status).toBe(200);
    expect((await res.json()) as Row).toMatchObject({ state: "open", join_url: expect.stringContaining("zoom.us") });
    expect(w.logs.some(l => /apply 20261004a/.test(l))).toBe(true);
    const before = w.reads.length;
    expect((await w.handler(open("K7Q2MX"))).status).toBe(200);
    expect(w.reads.slice(before).every(q => !q.includes("taken_back_join_at"))).toBe(true);
  });
});
