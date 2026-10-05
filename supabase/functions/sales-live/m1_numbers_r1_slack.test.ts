// bun test supabase/functions/sales-live/m1_numbers_r1_slack.test.ts
//
// Milestone 1, video-link round 1, NUMBERS AND RECORDS: the health rows and
// alerts the door writes, with Slack fenced off as the pilot runs it
// (live.enabled and live.slack false, so SLACK_SIGNING_SECRET is not set on
// sales-live: m1-scope.md "POST /slack ... Answers 503 while
// SLACK_SIGNING_SECRET is not set").
//
// What must hold: the health line and the alerts read the truth. A part
// Milestone 1 switched off (Slack) is never reported as a failing part, and
// nobody is asked to set up Slack, because of a request nobody signed
// (verify_jwt is off: anyone on the internet can POST /slack).
//
// A test that fails here is a finding; tests named "control" pass.
// No network: an in-memory PostgREST that keeps the status rows and alerts.
import { describe, expect, test } from "bun:test";
import { RateLimiter } from "./door.ts";
import { makeHandler } from "./handler.ts";

type Row = Record<string, any>;
const BASE = "https://proj.supabase.co";
const KEY = "service-key-value-never-printed";
const NOW = Date.UTC(2026, 9, 5, 8, 0, 0);

function door(env: Record<string, string>) {
  const status = new Map<string, Row>();
  const alerts = new Map<string, Row>();
  const pending: Promise<unknown>[] = [];
  const settings: Row[] = [
    { key: "rooms", value: { enabled: true, test_only: true, short_link: false } },
    { key: "live", value: { enabled: false, slack: false } },
  ];
  const fetchFake = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const table = url.pathname.replace("/rest/v1/", "");
    if (table === "cockpit_sales_worker_status" && method === "POST") {
      status.set(`${body.worker}/${body.job}`, body);
      return new Response(null, { status: 201 });
    }
    if (table === "rpc/cockpit_sales_alert_set" && method === "POST") {
      if (body.p_on) alerts.set(body.p_key, { kind: body.p_kind, message: body.p_message, open: true });
      else if (alerts.has(body.p_key)) alerts.get(body.p_key)!.open = false;
      return Response.json(1);
    }
    if (table === "cockpit_sales_settings" && method === "GET") return Response.json(settings);
    return Response.json([]);
  };
  const h = makeHandler({
    env: n => env[n] ?? "",
    fetch: fetchFake as typeof fetch,
    now: () => NOW,
    background: p => {
      pending.push(p);
    },
    limiter: new RateLimiter(30, 60_000),
    wideLimiter: new RateLimiter(120, 60_000),
    log: () => {},
  });
  const settle = async () => {
    while (pending.length) await Promise.allSettled(pending.splice(0));
  };
  return { h, status, alerts, settle };
}

const PILOT_ENV = {
  SUPABASE_URL: BASE,
  SUPABASE_SERVICE_ROLE_KEY: KEY,
  ZOOM_WEBHOOK_SECRET: "zoom-secret-value-never-printed",
  IP_SALT: "salt-value-never-printed",
  CRON_SECRET: "cron-secret-value-never-printed",
  // SLACK_SIGNING_SECRET: not set, Slack is fenced off in Milestone 1.
};

function strayPost(): Request {
  return new Request("http://localhost/sales-live/slack", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "command=%2Favailable&user_id=U0SCANNER",
  });
}

describe("Slack fenced off: a stray POST /slack is no failing part and no alert", () => {
  test("control: the route still refuses it with 503 and touches nothing else", async () => {
    const d = door(PILOT_ENV);
    const res = await d.h(strayPost());
    expect(res.status).toBe(503);
  });

  test("the door writes no failing sales-live/slack row while live.enabled and live.slack are off", async () => {
    const d = door(PILOT_ENV);
    await d.h(strayPost());
    await d.settle();
    const row = d.status.get("sales-live/slack");
    expect(row?.ok === false ? `failing row: ${row.detail}` : "no failing row").toBe("no failing row");
  });

  test("the door raises no config alert asking a person to set SLACK_SIGNING_SECRET while Slack is switched off", async () => {
    const d = door(PILOT_ENV);
    await d.h(strayPost());
    await d.settle();
    const open = [...d.alerts.entries()].filter(([, a]) => a.open).map(([k, a]) => `${k}: ${a.message}`);
    expect(open).toEqual([]);
  });
});
