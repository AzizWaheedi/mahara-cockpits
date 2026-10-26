import { describe, expect, test } from "bun:test";
import { addDays, kuwaitDay, kuwaitDayStart } from "./rules";
import { countToday, ownersFor, runExceptions } from "./worker";

type Row = Record<string, any>;

const TODAY = "2026-10-26";
const T0 = kuwaitDayStart(TODAY) + 10 * 3_600_000; // 10:00 Kuwait
const HOUR = 3_600_000;

/** An in-memory stand-in for the PostgREST tables and Slack, enough to drive whole runs. */
function fake(seed: Record<string, Row[]>, opts: { slackDown?: string; slackThrows?: boolean; history?: Row[] } = {}) {
  const tables: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  const posts: Row[] = [];
  const clock = { now: T0 };
  let id = 0;
  const unq = (v: string) => v.replace(/^"|"$/g, "");
  const match = (r: Row, q: string) =>
    q.split("&").every(p => {
      const [k, ...rest] = p.split("=");
      const v = rest.join("=");
      if (["select", "order", "or", "limit", "on_conflict"].includes(k)) return true;
      const [op, ...vv] = v.split(".");
      const val = vv.join(".");
      if (op === "eq") return String(r[k]) === unq(val);
      if (op === "neq") return String(r[k]) !== unq(val);
      if (op === "gte") return String(r[k]) >= val;
      if (op === "is") return val === "true" ? r[k] === true : val === "false" ? r[k] === false : r[k] == null;
      if (op === "in") return val.replace(/^\(|\)$/g, "").split(",").map(unq).includes(String(r[k]));
      return true;
    });
  const db = {
    async all(t: string, q: string) {
      return (tables[t] ?? []).filter(r => match(r, q)).map(r => ({ ...r }));
    },
    async upsert(t: string, rows: Row[], key: string) {
      tables[t] ??= [];
      const keys = key.split(",");
      for (const row of rows) {
        const i = tables[t].findIndex(r => keys.every(k => r[k] === row[k]));
        if (i >= 0) tables[t][i] = { ...tables[t][i], ...row };
        else tables[t].push({ ...row });
      }
    },
    async claim(t: string, row: Row, onConflict: string) {
      tables[t] ??= [];
      const keys = onConflict.split(",");
      if (tables[t].some(r => keys.every(k => r[k] === row[k]))) return null;
      const r = { id: `a${++id}`, attempts: 0, channel: null, created_at: new Date(clock.now).toISOString(), ...row };
      tables[t].push(r);
      return { ...r };
    },
    async patch(t: string, filter: string, values: Row) {
      for (const r of tables[t] ?? []) if (match(r, filter)) Object.assign(r, values);
    },
  };
  const slack = async (method: string, params: Row) => {
    if (opts.slackDown) throw Object.assign(new Error(`slack ${method}: ${opts.slackDown}`), { slackError: opts.slackDown });
    if (method === "users.lookupByEmail") return { ok: true, user: { id: `U_${String(params.email).split("@")[0]}` } };
    if (method === "conversations.open") return { ok: true, channel: { id: `D_${params.users}` } };
    if (method === "conversations.history") return { ok: true, messages: opts.history ?? [] };
    if (method === "chat.postMessage") {
      if (opts.slackThrows) throw new Error("socket hang up");
      const ts = `${1000 + posts.length}.1`;
      posts.push({ ...params, ts });
      return { ok: true, ts };
    }
    throw new Error(method);
  };
  return { tables, posts, clock, io: { db, slack } as any };
}

const MEMBERS = [
  { email: "buyer.one@example.test", name: "Buyer One", roles: ["media_buyer"], clients: [], active: true },
  { email: "buyer.two@example.test", name: "Buyer Two", roles: ["media_buyer"], clients: [], active: true },
  { email: "csm@example.test", name: "Casey Success", roles: ["csm"], clients: [], active: true },
  { email: "boss@example.test", name: "Boss", roles: ["admin", "media_buyer"], clients: [], active: true },
];

/**
 * `n` active clients. Clients listed in `broken` spend $20 a day with no lead for the last
 * 3 days; everyone else gets 2 leads a day. 62 days of history.
 */
function world(n = 6, broken: number[] = [1], members = MEMBERS): Record<string, Row[]> {
  const t: Record<string, Row[]> = {
    cockpit_board_clients: [],
    cockpit_meta_ad_days: [],
    cockpit_meta_ad_day_tasks: [],
    cockpit_excluded_ads: [],
    cockpit_campaigns: [],
    cockpit_client_days: [],
    cockpit_meta_budgets: [],
    cockpit_meta_account_state: [],
    cockpit_ad_billing_bindings: [],
    cockpit_board_targets: [],
    cockpit_lead_sync_status: [],
    cockpit_lead_sync_alerts: [],
    cockpit_members: members,
    cockpit_csm_sources: [],
    cockpit_sync_state: [],
    cockpit_exception_state: [],
    cockpit_exception_alerts: [],
  };
  for (let i = 1; i <= n; i++) {
    const acct = `10000${i}`;
    t.cockpit_board_clients.push({ location_id: `loc${i}`, clickup_id: `cu${i}`, client_name: `Client ${i}`, service_mode: "DFY", ad_account_ids: [acct], status: "Active" });
    t.cockpit_campaigns.push({ meta_account_id: acct, meta_campaign_id: `cmp${i}`, task_id: `t${i}`, campaign_name: `Campaign ${i}`, internal: "false" });
    t.cockpit_meta_ad_day_tasks.push({ account_id: acct, until: TODAY, kind: "days", state: "done", updated_at: new Date(T0 - HOUR).toISOString() });
    t.cockpit_meta_budgets.push({ object_id: `cmp${i}`, account_id: acct, name: `Campaign ${i}`, level: "campaign", switched_on: true, delivering: true, why_not: "", start_time: new Date(T0 - 80 * 24 * HOUR).toISOString(), fetched_at: new Date(T0 - 30 * 60_000).toISOString() });
    t.cockpit_meta_account_state.push({ account_id: acct, account_status: 1 });
    t.cockpit_lead_sync_status.push({ client_key: `loc${i}`, location_id: `loc${i}`, client_name: `Client ${i}`, state: "ok", reason: "", episode_id: null });
    t.cockpit_csm_sources.push({ table_name: "clients", task: `cu${i}`, csm: "Casey Success", source_snapshot_at: "2026-10-26T06:00:00Z" });
    for (let back = 62; back >= 0; back--) {
      const day = addDays(TODAY, -back);
      const bad = broken.includes(i) && back <= 2;
      t.cockpit_meta_ad_days.push({ account_id: acct, day, campaign_id: `cmp${i}`, campaign_name: `Campaign ${i}`, ad_id: `ad${i}`, spend_usd: bad ? 20 : 10, leads: bad ? 0 : 2 });
      t.cockpit_client_days.push({ location_id: `loc${i}`, day, crm_ad_leads: bad ? 0 : 2, confirmed_bookings: back % 3 === 0 ? 1 : 0 });
    }
  }
  return t;
}

const DRY = {};
const LIVE = { EXCEPTION_ALERTS_DELIVERY: "live", SLACK_BOT_TOKEN: "x" };
const alerts = (f: ReturnType<typeof fake>) => f.tables.cockpit_exception_alerts;
const health = (f: ReturnType<typeof fake>) => f.tables.cockpit_sync_state.find(r => r.key === "exception-alerts");

async function twoRuns(f: ReturnType<typeof fake>, env: Row) {
  await runExceptions(f.io, env, { apply: true, nowMs: T0 });
  return runExceptions(f.io, env, { apply: true, nowMs: T0 + HOUR });
}

describe("owners", () => {
  test("media buyers on the client, not admins; the CSM joins for cost per booking; lead sync is mirrored", () => {
    const c = { name: "Client 1", csm: "Casey Success" };
    expect(ownersFor("zero_leads", c, MEMBERS).map(o => o.name)).toEqual(["Buyer One", "Buyer Two"]);
    expect(ownersFor("cpb_over_line", c, MEMBERS).map(o => o.name)).toEqual(["Buyer One", "Buyer Two", "Casey Success"]);
    expect(ownersFor("lead_sync", c, MEMBERS)).toEqual([]);
  });
  test("a media buyer limited to other clients is not an owner", () => {
    const m = [{ ...MEMBERS[0], clients: ["Client 9"] }];
    expect(ownersFor("zero_leads", { name: "Client 1", csm: null }, m)).toEqual([]);
  });
});

describe("a run", () => {
  test("first sighting writes the state and sends nothing; the second run an hour later alerts", async () => {
    const f = fake(world());
    const a = await runExceptions(f.io, DRY, { apply: true, nowMs: T0 });
    expect(a.verdicts.find(v => v.rule === "zero_leads" && v.client_key === "loc1")?.state).toBe("watch");
    expect(alerts(f)).toHaveLength(0);
    await runExceptions(f.io, DRY, { apply: true, nowMs: T0 + HOUR });
    expect(alerts(f).map(r => [r.rule, r.client_key, r.recipient, r.status])).toEqual([
      ["zero_leads", "loc1", "person:buyer.one@example.test", "dry"],
      ["zero_leads", "loc1", "person:buyer.two@example.test", "dry"],
    ]);
    expect(f.posts).toHaveLength(0);
    expect(health(f)).toMatchObject({ ok: true });
    expect(health(f)?.note).toContain("Delivery dry run");
  });

  test("a run inside 55 minutes is skipped unless forced", async () => {
    const f = fake(world());
    await runExceptions(f.io, DRY, { apply: true, nowMs: T0 });
    expect((await runExceptions(f.io, DRY, { apply: true, nowMs: T0 + 10 * 60_000 })).skipped).toBe("not due");
  });

  test("a forced duplicate run writes one ledger row per person", async () => {
    const f = fake(world());
    await twoRuns(f, DRY);
    await runExceptions(f.io, DRY, { apply: true, force: true, nowMs: T0 + HOUR + 60_000 });
    await runExceptions(f.io, DRY, { apply: true, force: true, nowMs: T0 + HOUR + 120_000 });
    expect(alerts(f)).toHaveLength(2);
  });

  test("an unchanged run writes no state row", async () => {
    const f = fake(world());
    await twoRuns(f, DRY);
    const r = await runExceptions(f.io, DRY, { apply: true, force: true, nowMs: T0 + HOUR + 60_000 });
    expect(health(f)?.detail.written).toBe(0);
    expect(r.ok).toBe(true);
  });

  test("a read-only run writes nothing at all", async () => {
    const f = fake(world());
    await runExceptions(f.io, DRY, { apply: false, nowMs: T0 });
    expect(f.tables.cockpit_exception_state).toHaveLength(0);
    expect(f.tables.cockpit_sync_state).toHaveLength(0);
  });
});

describe("delivery", () => {
  test("live: one DM per owner with the deep link and the reference tag", async () => {
    const f = fake(world());
    await twoRuns(f, LIVE);
    expect(f.posts.map(p => p.channel)).toEqual(["D_U_buyer.one", "D_U_buyer.two"]);
    expect(f.posts[0].text).toContain("<https://cockpit.maharamedia.com/ads?account=Client%201|Open Client 1 in the cockpit>");
    expect(f.posts[0].text).toContain("spent with no lead since");
    expect(f.posts[0].text).toMatch(/_ref exa:a\d+_$/);
    expect(alerts(f).every(r => r.status === "sent")).toBe(true);
  });

  test("delivery stopped: the send ends failed and the health row turns red", async () => {
    const f = fake(world(), { slackDown: "invalid_auth" });
    const r = await twoRuns(f, LIVE);
    expect(alerts(f).map(a => a.status)).toEqual(["failed", "failed"]);
    expect(alerts(f)[0].error).toContain("invalid_auth");
    expect(r.ok).toBe(false);
    expect(health(f)).toMatchObject({ ok: false });
    expect(health(f)?.last_ok_at).toBe(new Date(T0).toISOString());
    expect(health(f)?.note).toContain("sends failed or unknown");
  });

  test("a failed send is tried again on later runs, 3 tries at most", async () => {
    const f = fake(world(), { slackDown: "invalid_auth" });
    await twoRuns(f, LIVE);
    for (let i = 2; i <= 5; i++) await runExceptions(f.io, LIVE, { apply: true, nowMs: T0 + i * HOUR });
    expect(alerts(f)[0]).toMatchObject({ status: "failed", attempts: 3 });
  });

  test("an interrupted send found in Slack history is recorded, not posted again", async () => {
    const f = fake(world(), { slackThrows: true });
    await twoRuns(f, LIVE);
    expect(alerts(f)[0].status).toBe("unknown");
    const id = alerts(f)[0].id;
    const g = fake(f.tables, { history: [{ ts: "77.7", text: `... _ref exa:${id}_` }] });
    await runExceptions(g.io, LIVE, { apply: true, nowMs: T0 + 2 * HOUR });
    expect(g.tables.cockpit_exception_alerts.find(r => r.id === id)).toMatchObject({ status: "sent", slack_ts: "77.7" });
    expect(g.posts.filter(p => p.text.includes(`exa:${id}`))).toHaveLength(0);
  });
});

describe("5 a person a day, then one digest", () => {
  test("the sixth alert waits for the digest at 16:00 Kuwait", async () => {
    const f = fake(world(7, [1, 2, 3, 4, 5, 6]));
    await twoRuns(f, LIVE);
    const one = alerts(f).filter(r => r.recipient === "person:buyer.one@example.test");
    expect(one.filter(r => r.status === "sent")).toHaveLength(5);
    expect(one.filter(r => r.status === "queued")).toHaveLength(1);
    expect(countToday(alerts(f), "person:buyer.one@example.test", TODAY)).toBe(5);
    await runExceptions(f.io, LIVE, { apply: true, nowMs: kuwaitDayStart(TODAY) + 16 * HOUR + 60_000 });
    const digest = alerts(f).filter(r => r.kind === "digest");
    expect(digest.map(d => [d.recipient, d.status])).toEqual([
      ["person:buyer.one@example.test", "sent"],
      ["person:buyer.two@example.test", "sent"],
    ]);
    expect(one.find(r => r.status === "queued")).toBeUndefined();
    expect(alerts(f).filter(r => r.kind === "alert" && r.status === "queued")).toHaveLength(0);
    expect(f.posts.at(-1)?.text).toContain("Your other exception alerts");
    // No second digest the same day.
    await runExceptions(f.io, LIVE, { apply: true, nowMs: kuwaitDayStart(TODAY) + 17 * HOUR + 60_000 });
    expect(alerts(f).filter(r => r.kind === "digest")).toHaveLength(2);
  });

  test("no owner: the alert goes to the fallback digest, never dropped", async () => {
    const f = fake(world(6, [1], [MEMBERS[2]]));
    await twoRuns(f, LIVE);
    expect(alerts(f).map(r => [r.recipient, r.status])).toEqual([["channel:C0AS2JLMJCB", "queued"]]);
    await runExceptions(f.io, LIVE, { apply: true, nowMs: kuwaitDayStart(TODAY) + 16 * HOUR + 60_000 });
    expect(f.posts.map(p => p.channel)).toEqual(["C0AS2JLMJCB"]);
    expect(f.posts[0].text).toContain("with no owner");
  });

  test("going live does not send what was queued during the dry run", async () => {
    const f = fake(world(6, [1], [MEMBERS[2]]));
    await twoRuns(f, DRY);
    const env = { ...LIVE, EXCEPTION_ALERTS_LIVE_SINCE: new Date(T0 + 2 * HOUR).toISOString() };
    f.clock.now = T0 + 3 * HOUR;
    await runExceptions(f.io, env, { apply: true, nowMs: kuwaitDayStart(TODAY) + 16 * HOUR + 60_000 });
    expect(f.posts).toHaveLength(0);
    expect(alerts(f).find(r => r.kind === "alert")?.status).toBe("dry");
  });
});

describe("the lead sync gap", () => {
  test("is mirrored from the lead sync watch's ledger, not sent again", async () => {
    const seed = world(6, []);
    Object.assign(seed.cockpit_lead_sync_status[2], { state: "gap", reason: "Meta 5, CRM 0", episode_id: "lsw-ep-1" });
    seed.cockpit_lead_sync_alerts.push({ episode_id: "lsw-ep-1", kind: "alert", status: "sent", slack_ts: "55.5", channel: "C0AS2JLMJCB", created_at: new Date(T0 - HOUR).toISOString() });
    const f = fake(seed);
    await runExceptions(f.io, LIVE, { apply: true, nowMs: T0 });
    expect(alerts(f).map(r => [r.rule, r.kind, r.status, r.slack_ts])).toEqual([["lead_sync", "mirror", "sent", "55.5"]]);
    expect(f.posts).toHaveLength(0);
    expect(f.tables.cockpit_exception_state.find(r => r.rule === "lead_sync" && r.client_key === "loc3")).toMatchObject({ state: "open" });
  });
});

describe("missing is never zero", () => {
  test("an account the Meta store has not read makes the rule unknown, not an alert", async () => {
    const seed = world(6, [1]);
    seed.cockpit_meta_ad_day_tasks = seed.cockpit_meta_ad_day_tasks.filter(t => t.account_id !== "100001");
    const f = fake(seed);
    await twoRuns(f, LIVE);
    expect(f.tables.cockpit_exception_state.find(r => r.rule === "zero_leads" && r.client_key === "loc1")?.state).toBe("unknown");
    expect(alerts(f)).toHaveLength(0);
  });
  test("the Kuwait day is used for the cap", () => {
    expect(kuwaitDay(kuwaitDayStart(TODAY) + 23 * HOUR)).toBe(TODAY);
  });
});
