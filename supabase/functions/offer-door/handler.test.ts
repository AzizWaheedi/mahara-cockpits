import { describe, expect, test } from "bun:test";
import { RateLimiter } from "../sales-live/door.ts";
import { sha256Hex } from "../sales-live/sign.ts";
import { makeHandler } from "./handler.ts";

// offer-door end to end against a mocked database and Storage: no network.

const BASE = "https://db.test";
const KEY = "sb_secret_service_key_value";
const SALT = "salt-value-never-shown";
const SITE = "https://offer.maharamedia.com";
const CODE = "k7q2mxab3cde";
const VCODE = "k7q2mxab3c";
const PHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const DEVICE = "dev-0123456789abcdef";

const PROPOSAL = {
  lang: "en",
  offer: "website",
  title: "Your website",
  clientName: "Acme Interiors",
  logo: { bucket: "cockpit-client-logos", path: "acme-interiors/logo.png", alt: "Acme Interiors" },
  csmFirstName: "Sara",
  date: "2026-10-26",
  validUntil: "2026-11-25",
  video: { provider: "youtube", embedUrl: "https://www.youtube-nocookie.com/embed/abcdefghijk?rel=0", posterUrl: "https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg", title: "Your website" },
  found: [
    { bucket: "cockpit-upsell-files", path: "taskA1/11111111-2222-4333-8444-555555555555.png", caption: "Your site today", capturedOn: "2026-10-26", searchedAs: null },
    { bucket: "cockpit-upsell-files", path: "taskA1/22222222-2222-4333-8444-555555555555.webp", caption: "Searching your name", capturedOn: "2026-10-25", searchedAs: "Kuwait City" },
  ],
  why: "Clients look you up before they call.",
  get: ["Six pages in Arabic and English"],
  platforms: null,
  work: [],
  steps: "We build it.\nYou check it.",
  timing: "Live two weeks after we have your content.",
  investment: { parts: [{ label: "Website build", amountUsd: 2000, cadence: "one_time" }], terms: "Paid in full.", split: null },
  button: { text: "Start this week", whatsapp: "https://wa.me/96500000000?text=Yes" },
};

type DbAnswer = { status?: number; body?: unknown } | Error;
function door(options: { env?: Record<string, string>; db?: Record<string, (body: Record<string, unknown>) => DbAnswer>; limiter?: RateLimiter; wideLimiter?: RateLimiter; now?: () => number } = {}) {
  const env: Record<string, string> = { SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: KEY, OFFER_IP_SALT: SALT, ...(options.env ?? {}) };
  const calls: { path: string; body: Record<string, unknown>; headers: Record<string, string> }[] = [];
  const logs: string[] = [];
  const pending: Promise<unknown>[] = [];
  const fetcher = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const path = url.startsWith(BASE) ? url.slice(BASE.length + 1) : url;
    const body = init.body ? JSON.parse(String(init.body)) : {};
    calls.push({ path, body, headers: init.headers as Record<string, string> });
    const h = options.db?.[path];
    if (!h) return new Response(JSON.stringify({ message: "not found" }), { status: 404 });
    const a = h(body);
    if (a instanceof Error) throw a;
    return new Response(a.body === undefined ? "" : JSON.stringify(a.body), { status: a.status ?? 200 });
  }) as typeof fetch;
  let clock = Date.parse("2026-10-26T10:00:00Z");
  const handler = makeHandler({
    env: n => env[n] ?? "",
    fetch: fetcher,
    now: options.now ?? (() => clock),
    background: p => {
      pending.push(p);
    },
    limiter: options.limiter ?? new RateLimiter(30, 60_000, 10_000),
    wideLimiter: options.wideLimiter ?? new RateLimiter(120, 60_000, 10_000),
    log: line => logs.push(line),
    budget: { open: 200, sign: 200, event: 200, video: 200, status: 200 },
  });
  const ask = (path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) =>
    handler(new Request(`${BASE}/functions/v1/offer-door${path}`, { method: init.method ?? "GET", headers: { "user-agent": PHONE, "cf-connecting-ip": "203.0.113.9", ...(init.headers ?? {}) }, body: init.body }));
  const settle = async () => {
    await Promise.all(pending.splice(0));
  };
  return { ask, calls, logs, settle, tick: (ms: number) => (clock += ms) };
}
const fromPage = { origin: SITE };
const opened = () => ({ body: { state: "open", proposal: PROPOSAL, contact: { whatsapp: "96500000000" } } });
const signer = (body: Record<string, unknown>) => ({
  body: (body.paths as string[]).map(path => ({ path, signedURL: `/object/sign/cockpit-upsell-files/${path}?token=signed`, error: null })),
});
const statusCalls = (d: ReturnType<typeof door>) => d.calls.filter(c => c.path === "rest/v1/rpc/cockpit_upsell_door_status_set").map(c => c.body);

describe("GET /p/{code}", () => {
  test("the page's own origin only; preflight answered for it", async () => {
    const d = door({ db: { "rest/v1/rpc/cockpit_upsell_door_open": opened } });
    for (const origin of [undefined, "https://evil.com", "http://offer.maharamedia.com"]) {
      const res = await d.ask(`/p/${CODE}`, { headers: origin ? { origin } : {} });
      expect([origin, res.status]).toEqual([origin, 403]);
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
    }
    expect(d.calls).toEqual([]);
    const pre = await d.ask(`/p/${CODE}`, { method: "OPTIONS", headers: fromPage });
    expect([pre.status, pre.headers.get("access-control-allow-origin"), pre.headers.get("access-control-allow-methods")]).toEqual([204, SITE, "GET"]);
    const local = await d.ask(`/p/${CODE}`, { headers: { origin: "http://localhost:5421" } });
    expect(local.status).toBe(200);
  });

  test("open: the proposal with every picture as a ten-minute link, the verified logo by its public address", async () => {
    const d = door({ db: { "rest/v1/rpc/cockpit_upsell_door_open": opened, "storage/v1/object/sign/cockpit-upsell-files": signer } });
    const res = await d.ask(`/p/${CODE}?d=${DEVICE}`, { headers: fromPage });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(SITE);
    const body = (await res.json()) as { state: string; contact: unknown; proposal: { logo: unknown; found: { url: string }[] } };
    expect(body.state).toBe("open");
    expect(body.contact).toEqual({ whatsapp: "96500000000" });
    expect(body.proposal.logo).toEqual({ url: `${BASE}/storage/v1/object/public/cockpit-client-logos/acme-interiors/logo.png`, alt: "Acme Interiors" });
    expect(body.proposal.found.map(f => f.url)).toEqual([
      `${BASE}/storage/v1/object/sign/cockpit-upsell-files/taskA1/11111111-2222-4333-8444-555555555555.png?token=signed`,
      `${BASE}/storage/v1/object/sign/cockpit-upsell-files/taskA1/22222222-2222-4333-8444-555555555555.webp?token=signed`,
    ]);
    expect(JSON.stringify(body)).not.toMatch(/"bucket"|"path"/);
    const sign = d.calls.find(c => c.path === "storage/v1/object/sign/cockpit-upsell-files");
    expect(sign?.body.expiresIn).toBe(600);
    // The database got the code, the device, a salted 64-hex address and the device kind; never the address itself.
    const open = d.calls.find(c => c.path === "rest/v1/rpc/cockpit_upsell_door_open");
    expect(open?.body).toMatchObject({ p_code: CODE, p_device: DEVICE, p_device_kind: "phone", p_preview: null });
    expect(String(open?.body.p_ip_hash)).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(d.calls)).not.toContain("203.0.113.9");
    expect(JSON.stringify(d.calls.map(c => c.body))).not.toContain(SALT);
  });

  test("expired, archived and unknown pass through with no proposal", async () => {
    for (const state of ["expired", "archived", "unknown"]) {
      const d = door({ db: { "rest/v1/rpc/cockpit_upsell_door_open": () => ({ body: { state, proposal: null, contact: { whatsapp: null } } }) } });
      const body = (await (await d.ask(`/p/${CODE}`, { headers: fromPage })).json()) as Record<string, unknown>;
      expect(body).toEqual({ state, proposal: null, contact: { whatsapp: null } });
    }
  });

  test("a code that cannot be a code is unknown without a database read", async () => {
    const d = door({ db: { "rest/v1/rpc/cockpit_upsell_door_open": opened } });
    for (const code of ["k7q2mxab3cd1", "short", "K7Q2MXAB3CDEX", "%E0%A4"]) {
      const body = await (await d.ask(`/p/${code}`, { headers: fromPage })).json();
      expect(body).toEqual({ state: "unknown", proposal: null, contact: null });
    }
    expect(d.calls).toEqual([]);
  });

  test("link previews, crawlers and HEAD requests are told nothing and counted nowhere", async () => {
    const d = door({ db: { "rest/v1/rpc/cockpit_upsell_door_open": opened } });
    for (const ua of ["WhatsApp/2.23.20.0 A", "facebookexternalhit/1.1", "TelegramBot (like TwitterBot)", "Slackbot-LinkExpanding 1.0", "curl/8.4.0", ""]) {
      const res = await d.ask(`/p/${CODE}`, { headers: { ...fromPage, "user-agent": ua } });
      expect([ua, await res.json()]).toEqual([ua, { state: "unknown", proposal: null, contact: null }]);
    }
    expect((await d.ask(`/p/${CODE}`, { method: "HEAD", headers: fromPage })).status).toBe(200);
    expect(d.calls).toEqual([]);
  });

  test("a preview token goes to the database, which does not count it; a token of the wrong shape goes nowhere", async () => {
    const d = door({ db: { "rest/v1/rpc/cockpit_upsell_door_open": opened, "storage/v1/object/sign/cockpit-upsell-files": signer } });
    await d.ask(`/p/${CODE}?pv=K7Q2MXAB3CDEK7Q2MXAB3CDE`, { headers: fromPage });
    await d.ask(`/p/${CODE}?pv=nope`, { headers: fromPage });
    const opens = d.calls.filter(c => c.path === "rest/v1/rpc/cockpit_upsell_door_open").map(c => c.body.p_preview);
    expect(opens).toEqual(["k7q2mxab3cdek7q2mxab3cde", null]);
  });

  test("rate limits: 30 a minute per address and device, 120 per address", async () => {
    const d = door({ db: { "rest/v1/rpc/cockpit_upsell_door_open": () => ({ body: { state: "unknown", proposal: null, contact: { whatsapp: null } } }) } });
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) statuses.push((await d.ask(`/p/${CODE}?d=${DEVICE}`, { headers: fromPage })).status);
    expect(statuses.slice(0, 30).every(s => s === 200)).toBe(true);
    const busy = await d.ask(`/p/${CODE}?d=${DEVICE}`, { headers: fromPage });
    expect([busy.status, await busy.json(), busy.headers.get("retry-after")]).toEqual([429, { state: "busy", proposal: null, contact: null }, "60"]);
    // Another device on the same address still gets in, up to the address's 120.
    expect((await d.ask(`/p/${CODE}?d=dev-other-0000000000`, { headers: fromPage })).status).toBe(200);
    const wide = door({ wideLimiter: new RateLimiter(3, 60_000, 100), db: { "rest/v1/rpc/cockpit_upsell_door_open": () => ({ body: { state: "unknown", proposal: null, contact: null } }) } });
    const w: number[] = [];
    for (let i = 0; i < 4; i++) w.push((await wide.ask(`/p/${CODE}?d=dev-${i}-00000000000`, { headers: fromPage })).status);
    expect(w).toEqual([200, 200, 200, 429]);
  });

  test("a database that fails: an error state, and the route's status row says so", async () => {
    const d = door({ db: { "rest/v1/rpc/cockpit_upsell_door_open": () => ({ status: 500, body: { message: `boom with key ${KEY}` } }), "rest/v1/rpc/cockpit_upsell_door_status_set": () => ({ status: 204 }) } });
    const res = await d.ask(`/p/${CODE}`, { headers: fromPage });
    expect([res.status, await res.json()]).toEqual([502, { state: "error", proposal: null, contact: null }]);
    await d.settle();
    const rows = statusCalls(d);
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({ p_route: "p", p_ok: false });
    expect(String(rows[0].p_sentence)).not.toContain(KEY);
    expect(d.logs.join(" ")).not.toContain(KEY);
  });
});

describe("status rows", () => {
  test("written on a change, else at most once a minute", async () => {
    let fail = false;
    const d = door({
      db: {
        "rest/v1/rpc/cockpit_upsell_door_open": () => (fail ? { status: 503, body: {} } : { body: { state: "unknown", proposal: null, contact: null } }),
        "rest/v1/rpc/cockpit_upsell_door_status_set": () => ({ status: 204 }),
      },
    });
    for (let i = 0; i < 3; i++) await d.ask(`/p/${CODE}?d=dev-${i}-00000000000`, { headers: fromPage });
    await d.settle();
    expect(statusCalls(d)).toEqual([{ p_route: "p", p_ok: true, p_sentence: null }]);
    fail = true;
    await d.ask(`/p/${CODE}`, { headers: fromPage });
    await d.ask(`/p/${CODE}`, { headers: fromPage });
    await d.settle();
    expect(statusCalls(d).map(r => r.p_ok)).toEqual([true, false]);
    d.tick(61_000);
    await d.ask(`/p/${CODE}`, { headers: fromPage });
    await d.settle();
    expect(statusCalls(d).map(r => r.p_ok)).toEqual([true, false, false]);
  });
});

describe("missing secrets", () => {
  test("offer hashes use only the dedicated salt and ignore the project sales-live salt", async () => {
    const hashes: unknown[] = [];
    for (const sharedSalt of ["sales-live-original", "sales-live-unrelated-value"]) {
      const d = door({
        env: { IP_SALT: sharedSalt },
        db: { "rest/v1/rpc/cockpit_upsell_door_open": opened },
      });
      const res = await d.ask(`/p/${CODE}`, { headers: fromPage });
      expect(res.status).toBe(200);
      hashes.push(d.calls.find(c => c.path === "rest/v1/rpc/cockpit_upsell_door_open")?.body.p_ip_hash);
      expect(JSON.stringify(d.calls)).not.toContain(sharedSalt);
    }
    const expected = await sha256Hex(`${SALT}:offer-door:203.0.113.9`);
    expect(hashes).toEqual([expected, expected]);
  });

  test("each route closes; the secret's name goes to the status row and the log, never to the client's browser or screen, and never its value", async () => {
    const d = door({ env: { OFFER_IP_SALT: "", IP_SALT: "sales-live-salt-must-not-unlock-offer-door" }, db: { "rest/v1/rpc/cockpit_upsell_door_status_set": () => ({ status: 204 }) } });
    const p = await d.ask(`/p/${CODE}`, { headers: fromPage });
    // The page's own error shape, exactly: no secret names, no function name, readable across origins.
    expect([p.status, p.headers.get("access-control-allow-origin"), await p.json()]).toEqual([503, SITE, { state: "error", proposal: null, contact: null }]);
    const v = await d.ask(`/v/${VCODE}`);
    expect([v.status, v.headers.get("location"), await v.text()]).toEqual([302, `${SITE}/?error=1`, ""]);
    const e = await d.ask(`/p/${CODE}/event`, { method: "POST", headers: fromPage, body: '{"kind":"play"}' });
    expect([e.status, await e.json()]).toEqual([503, { error: "Not recorded." }]);
    await d.settle();
    expect(statusCalls(d).map(r => r.p_route)).toEqual(["p", "v", "event"]);
    expect(statusCalls(d).find(r => r.p_route === "p")?.p_sentence).toBe("Proposal pages cannot open: OFFER_IP_SALT is missing on offer-door. Add it to the function's secrets.");
    expect(statusCalls(d).find(r => r.p_route === "v")?.p_sentence).toBe("Video links cannot open: OFFER_IP_SALT is missing on offer-door. Add it to the function's secrets.");
    expect(d.logs).toContain("offer-door p: Proposal pages cannot open: OFFER_IP_SALT is missing on offer-door. Add it to the function's secrets.");
    expect(JSON.stringify(d.calls)).not.toContain("salt-value");
    const none = door({ env: { SUPABASE_SERVICE_ROLE_KEY: "", SUPABASE_URL: "" } });
    const res = await none.ask(`/p/${CODE}`, { headers: fromPage });
    expect([res.status, await res.json()]).toEqual([503, { state: "error", proposal: null, contact: null }]);
    expect(none.logs.join("\n")).toContain("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are missing");
    expect(none.calls).toEqual([]);
  });

  test("anything that throws on /p or an event still answers the page's own shape, readable from its origin", async () => {
    const thrown = door({ limiter: { hit: () => { throw new Error("limiter broke"); } } as unknown as RateLimiter });
    const p = await thrown.ask(`/p/${CODE}`, { headers: fromPage });
    expect([p.status, p.headers.get("access-control-allow-origin"), await p.json()]).toEqual([500, SITE, { state: "error", proposal: null, contact: null }]);
    const e = await thrown.ask(`/p/${CODE}/event`, { method: "POST", headers: fromPage, body: '{"kind":"play"}' });
    expect([e.status, e.headers.get("access-control-allow-origin"), await e.json()]).toEqual([500, SITE, { error: "Not recorded." }]);
    expect(thrown.logs.filter(l => l.includes("limiter broke"))).toEqual(["offer-door p failed: limiter broke", "offer-door event failed: limiter broke"]);
  });

  test("the health route names what is missing", async () => {
    const ok = await door().ask("/health");
    expect([ok.status, await ok.json()]).toEqual([200, { ok: true, site: SITE, routes: { p: { ok: true, missing: [] }, event: { ok: true, missing: [] }, v: { ok: true, missing: [] } } }]);
    const bad = await door({ env: { OFFER_IP_SALT: "", OFFER_SITE_URL: "https://offer-preview.maharamedia.com" } }).ask("/health");
    const body = (await bad.json()) as { ok: boolean; site: string; routes: Record<string, unknown> };
    expect([bad.status, body.ok, body.site, body.routes.v]).toEqual([503, false, "https://offer-preview.maharamedia.com", { ok: false, missing: ["OFFER_IP_SALT"] }]);
    expect(JSON.stringify(body)).not.toContain(KEY);
  });
});

describe("POST /p/{code}/event", () => {
  test("play and Yes presses are recorded; 204", async () => {
    const d = door({ db: { "rest/v1/rpc/cockpit_upsell_door_event": () => ({ status: 204 }) } });
    for (const kind of ["play", "cta"]) {
      const res = await d.ask(`/p/${CODE}/event`, { method: "POST", headers: { ...fromPage, "content-type": "text/plain" }, body: JSON.stringify({ kind, d: DEVICE }) });
      expect(res.status).toBe(204);
    }
    expect(d.calls.filter(c => c.path === "rest/v1/rpc/cockpit_upsell_door_event").map(c => [c.body.p_code, c.body.p_kind, c.body.p_device, c.body.p_device_kind])).toEqual([
      [CODE, "play", DEVICE, "phone"],
      [CODE, "cta", DEVICE, "phone"],
    ]);
  });

  test("a live preview's plays and Yes presses are not counted; a token of the wrong shape is", async () => {
    const d = door({ db: { "rest/v1/rpc/cockpit_upsell_door_event": () => ({ status: 204 }) } });
    for (const kind of ["play", "cta"]) {
      const res = await d.ask(`/p/${CODE}/event`, { method: "POST", headers: fromPage, body: JSON.stringify({ kind, d: DEVICE, pv: "K7Q2MXAB3CDEK7Q2MXAB3CDE" }) });
      expect(res.status).toBe(204);
    }
    expect(d.calls).toEqual([]);
    await d.ask(`/p/${CODE}/event`, { method: "POST", headers: fromPage, body: JSON.stringify({ kind: "play", d: DEVICE, pv: "nope" }) });
    expect(d.calls.filter(c => c.path === "rest/v1/rpc/cockpit_upsell_door_event").length).toBe(1);
  });

  test("a body over 1 KB, another kind, or not JSON is refused; another origin is refused; a bad code or a bot is ignored", async () => {
    const d = door({ db: { "rest/v1/rpc/cockpit_upsell_door_event": () => ({ status: 204 }) } });
    const post = (path: string, body: string, headers: Record<string, string> = fromPage) => d.ask(path, { method: "POST", headers, body });
    expect((await post(`/p/${CODE}/event`, JSON.stringify({ kind: "play", d: "x".repeat(1100) }))).status).toBe(413);
    expect((await post(`/p/${CODE}/event`, '{"kind":"open"}')).status).toBe(400);
    expect((await post(`/p/${CODE}/event`, "kind=play")).status).toBe(400);
    expect((await post(`/p/${CODE}/event`, '{"kind":"play"}', { origin: "https://evil.com" })).status).toBe(403);
    expect((await post("/p/nope/event", '{"kind":"play"}')).status).toBe(204);
    expect((await post(`/p/${CODE}/event`, '{"kind":"cta"}', { ...fromPage, "user-agent": "facebookexternalhit/1.1" })).status).toBe(204);
    expect((await d.ask(`/p/${CODE}/event`, { headers: fromPage })).status).toBe(405);
    expect(d.calls).toEqual([]);
  });
});

describe("GET /v/{code}", () => {
  test("302 to the video's own page, recorded; the address carries no client data", async () => {
    const d = door({ db: { "rest/v1/rpc/cockpit_upsell_door_video": () => ({ body: { state: "open", url: "https://www.youtube.com/watch?v=abcdefghijk" } }) } });
    const res = await d.ask(`/v/${VCODE}`);
    expect([res.status, res.headers.get("location")]).toEqual([302, "https://www.youtube.com/watch?v=abcdefghijk"]);
    expect(d.calls[0].body).toMatchObject({ p_code: VCODE, p_device: null, p_device_kind: "phone" });
  });

  test("unknown, a bad row, a bad code, a bot and a busy address go to the offer site with nothing about the client", async () => {
    const cases: [string, Record<string, string>, string, unknown][] = [
      [`/v/${VCODE}`, {}, `${SITE}/?gone=1`, { state: "unknown", url: null }],
      [`/v/${VCODE}`, {}, `${SITE}/?gone=1`, { state: "open", url: "https://evil.com/phish" }],
      ["/v/not-a-code", {}, `${SITE}/?gone=1`, null],
      [`/v/${VCODE}`, { "user-agent": "WhatsApp/2.23.20.0 A" }, `${SITE}/`, null],
    ];
    for (const [path, headers, location, answer] of cases) {
      const d = door({ db: { "rest/v1/rpc/cockpit_upsell_door_video": () => ({ body: answer }) } });
      const res = await d.ask(path, { headers });
      expect([path, res.status, res.headers.get("location")]).toEqual([path, 302, location]);
      if (!answer) expect(d.calls).toEqual([]);
    }
    const busy = door({ limiter: new RateLimiter(1, 60_000, 100), db: { "rest/v1/rpc/cockpit_upsell_door_video": () => ({ body: { state: "unknown", url: null } }) } });
    await busy.ask(`/v/${VCODE}`);
    expect((await busy.ask(`/v/${VCODE}`)).headers.get("location")).toBe(`${SITE}/?busy=1`);
    const broken = door({ db: { "rest/v1/rpc/cockpit_upsell_door_video": () => new TypeError("connection reset") } });
    expect((await broken.ask(`/v/${VCODE}`)).headers.get("location")).toBe(`${SITE}/?error=1`);
    // Anything that throws on the way is the same branded page, never raw JSON on the client's phone.
    const thrown = door({ limiter: { hit: () => { throw new Error("limiter broke"); } } as unknown as RateLimiter });
    const res = await thrown.ask(`/v/${VCODE}`);
    expect([res.status, res.headers.get("location")]).toEqual([302, `${SITE}/?error=1`]);
  });
});

describe("headers on every answer", () => {
  test("nothing may run, frame or be indexed, and nothing is cached", async () => {
    const d = door({ db: { "rest/v1/rpc/cockpit_upsell_door_open": opened, "storage/v1/object/sign/cockpit-upsell-files": signer, "rest/v1/rpc/cockpit_upsell_door_video": () => ({ body: { state: "unknown" } }) } });
    for (const res of [await d.ask(`/p/${CODE}`, { headers: fromPage }), await d.ask(`/v/${VCODE}`), await d.ask("/health"), await d.ask("/nope"), await d.ask(`/p/${CODE}`)]) {
      expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
      expect(res.headers.get("x-robots-tag")).toContain("noindex");
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    }
  });
});
