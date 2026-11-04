import { beforeAll, afterAll, test, expect } from "bun:test";
import {
  cockpitTestDb,
  migration,
  member,
  actor,
  owner,
} from "./lib/cockpitTestDb";
import {
  accountId,
  activeTask,
  adsTaskMatches,
  maskedLastFour,
  classify,
  clientMessage,
  validateBinding,
  planAccountChange,
  clientAdsTasks,
  IdentityDrift,
  type Task,
  CLIENT_STATUS,
  CLIENT_LIST,
  ADS_LIST,
  ADS_ACCOUNT,
  type Binding,
} from "../../../hermes/ad-billing-guard/core";
import {
  Transport,
  ProviderError,
  type Delivery,
} from "../../../hermes/ad-billing-guard/transport";
import {
  dispatchOne,
  poll,
  reconcileUnknown,
} from "../../../hermes/ad-billing-guard/worker";

let db: Awaited<ReturnType<typeof cockpitTestDb>>;
const lease = "00000000-0000-4000-8000-000000000001",
  claim = "00000000-0000-4000-8000-000000000002";
const uid = "00000000-0000-4000-8000-000000000003";
const client = {
  id: "client1",
  list: { id: CLIENT_LIST },
  custom_fields: [
    {
      id: CLIENT_STATUS,
      value: 0,
      type_config: {
        options: [
          { id: "active", name: "Active", orderindex: 0 },
          { id: "paused", name: "Paused", orderindex: 1 },
        ],
      },
    },
  ],
};
const ad = {
  id: "ads1",
  list: { id: ADS_LIST },
  custom_fields: [
    {
      id: ADS_ACCOUNT,
      value:
        "https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=123456",
    },
  ],
};
const binding: Binding = {
  id: "00000000-0000-4000-8000-000000000004",
  client_task_id: "client1",
  client_name: "Synthetic Client",
  account_id: "123456",
  ads_task_ids: ["ads1"],
  whatsapp_group: "12345@g.us",
  sheet_account_ref: "123456",
  enabled: true,
  revision: 1,
  identity_evidence: "Synthetic test proof only",
  identity_verified_at: "2026-10-11T00:00:00Z",
  manual_cutover_verified: true,
};
const sheet = [
  ["Clickup ID", "WA GROUP ID", "Ad Account - Meta"],
  ["client1", "12345@g.us", "123456"],
];
beforeAll(async () => {
  db = await cockpitTestDb({ supabaseDefaultPrivileges: true });
  await db.exec(migration("20261011174920_ad_billing_guard.sql"));
  await db.exec(migration("20261011192500_ad_billing_roster_safe_update.sql"));
  await db.exec(migration("20261026p_ad_billing_auto_move.sql"));
  await member(db, uid, "buyer@example.test", ["media_buyer"]);
});
afterAll(async () => {
  await db?.close();
});
async function reset() {
  await owner(db);
  await db.exec(
    "TRUNCATE cockpit_ad_billing_deliveries,cockpit_ad_billing_events,cockpit_ad_billing_bindings,cockpit_ad_billing_roster CASCADE",
  );
  await db.query(
    "UPDATE cockpit_ad_billing_config SET apply=false,lease=$1,lease_until=now()+interval '10 minutes'",
    [lease],
  );
  await db.query(
    "INSERT INTO cockpit_ad_billing_bindings(id,client_task_id,client_name,account_id,ads_task_ids,whatsapp_group,identity_evidence,identity_verified_at,enabled,manual_cutover_verified,manual_cutover_evidence,sheet_account_ref) VALUES($1,$2,$3,$4,$5,$6,$7,now(),true,true,$7,$4)",
    [
      binding.id,
      binding.client_task_id,
      binding.client_name,
      binding.account_id,
      binding.ads_task_ids,
      binding.whatsapp_group,
      binding.identity_evidence,
    ],
  );
}
async function observe(signal: string, error: string | null = null) {
  return db.query("SELECT cockpit_ad_billing_observe($1,$2,1,$3,$4,$5,$6,$7)", [
    lease,
    binding.id,
    signal,
    "1234",
    error,
    clientMessage(signal === "healthy" ? "recovered" : (signal as any), "1234"),
    "Verified synthetic Meta billing observation.",
  ]);
}
async function claimOne() {
  return (
    await db.query<{ d: any }>("SELECT cockpit_ad_billing_claim($1) d", [claim])
  ).rows[0].d;
}
async function scalar(sql: string) {
  return Object.values((await db.query(sql)).rows[0])[0];
}

test("account identity accepts exact IDs and trusted Meta URLs only", () => {
  for (const value of [
    "act_123456",
    "123456",
    "https://business.facebook.com/adsmanager?act=123456",
  ])
    expect(accountId(value)).toBe("123456");
  for (const value of [
    "Acme Ads",
    123456,
    "https://evil.test/?act=123456",
    "https://facebook.com.evil.test/?act=123456",
    "123456 SAR extra",
    "123456, SAR extra",
    "123456 SAR",
    "123456, SARS",
    "123456, 12",
  ])
    expect(accountId(value)).toBeNull();
});
test("account identity accepts a number followed by a comma and a currency code", () => {
  for (const value of [
    "1988430024784828, SAR",
    "1988430024784828,SAR",
    " act_1988430024784828 , sar ",
  ])
    expect(accountId(value)).toBe("1988430024784828");
});
test("Active is an exact current option; missing field and wrong list are excluded", () => {
  expect(activeTask(client, "client1")).toBe(true);
  expect(activeTask({ ...client, list: { id: ADS_LIST } }, "client1")).toBe(
    false,
  );
  expect(activeTask({ ...client, archived: true }, "client1")).toBe(false);
  expect(activeTask({ ...client, custom_fields: [] }, "client1")).toBe(false);
  expect(
    activeTask(
      { ...client, custom_fields: [{ ...client.custom_fields[0], value: 1 }] },
      "client1",
    ),
  ).toBe(false);
  expect(activeTask(client, "another")).toBe(false);
});
test("the confirmed internal sandbox is excluded even when marked Active", () => {
  expect(activeTask({ ...client, id: "86ex08t5v" }, "86ex08t5v")).toBe(false);
  expect(activeTask({ ...client, id: "realclient2" }, "realclient2")).toBe(true);
});
test("every destination is validated from the exact binding", () => {
  expect(() => validateBinding(binding, client, [ad], sheet)).not.toThrow();
  expect(() =>
    validateBinding(binding, client, [ad], [...sheet, sheet[1]]),
  ).toThrow("one exact");
  expect(() =>
    validateBinding(
      binding,
      client,
      [ad],
      [sheet[0], ["client1", "99999@g.us", "123456"]],
    ),
  ).toThrow("group changed");
  expect(() =>
    validateBinding(
      binding,
      client,
      [ad],
      [sheet[0], ["client1", "12345@g.us", "777777"]],
    ),
  ).toThrow("account reference changed");
  expect(() =>
    validateBinding({ ...binding, ads_task_ids: [] }, client, [], sheet),
  ).toThrow();
  expect(adsTaskMatches({ ...ad, custom_fields: [] }, "ads1", "123456")).toBe(
    false,
  );
});
test("masked suffix parser never extracts account IDs or full card numbers", () => {
  expect(maskedLastFour("VISA *1234")).toBe("1234");
  expect(maskedLastFour("Account *1234")).toBeNull();
  expect(maskedLastFour("VISA **** 1234")).toBe("1234");
  expect(maskedLastFour("Visa ending in 1234")).toBe("1234");
  for (const value of ["4111111111111234", "act_1234", "1234", "VISA", null])
    expect(maskedLastFour(value)).toBeNull();
});
test.each([
  [1, "healthy"],
  [9, "payment_grace"],
  [3, "unsettled"],
  [2, "restricted"],
  [7, "restricted"],
  [undefined, "unknown"],
  [null, "unknown"],
  [0, "unknown"],
  ["1", "unknown"],
])("Meta status %s -> %s", (status, expected) => {
  expect(
    classify({ id: "act_123456", account_status: status }, "123456").signal,
  ).toBe(expected as any);
});
test("an account response cannot be applied to another client", () =>
  expect(
    classify({ id: "act_999999", account_status: 1 }, "123456").signal,
  ).toBe("unknown"));
test("Arabic messages use Arabic digits and do not invent a retry, dollar debt, or restored delivery", () => {
  const copy = clientMessage("unsettled", "1234")!;
  expect(copy).toContain("١٢٣٤");
  expect(copy).not.toContain("1234");
  expect(copy).not.toContain("$");
  expect(copy).not.toContain("ثلاث");
  expect(clientMessage("unsettled", null)).not.toContain("المنتهية");
  expect(clientMessage("restricted", null)).toBeNull();
  expect(clientMessage("recovered", null)).not.toContain("رجعت شغالة");
});
test("migration denies browser reads and worker RPCs under Supabase default grants", async () => {
  await reset();
  await actor(db, uid);
  await expect(
    db.query("SELECT * FROM cockpit_ad_billing_bindings"),
  ).rejects.toThrow();
  await expect(
    db.query("SELECT cockpit_ad_billing_start($1)", [lease]),
  ).rejects.toThrow();
  expect(
    await scalar(
      "SELECT jsonb_array_length(cockpit_ad_billing_panel()->'bindings')",
    ),
  ).toBe(1);
  await actor(db, null);
  await expect(db.query("SELECT cockpit_ad_billing_panel()")).rejects.toThrow();
});
test("member revocation and client scope apply immediately", async () => {
  await reset();
  await db.query(
    "UPDATE cockpit_members SET clients=ARRAY['Other client'] WHERE auth_user_id=$1",
    [uid],
  );
  await actor(db, uid);
  expect(
    await scalar(
      "SELECT jsonb_array_length(cockpit_ad_billing_panel()->'bindings')",
    ),
  ).toBe(0);
  await owner(db);
  await db.query(
    "UPDATE cockpit_members SET active=false WHERE auth_user_id=$1",
    [uid],
  );
  await actor(db, uid);
  await expect(db.query("SELECT cockpit_ad_billing_panel()")).rejects.toThrow();
  await owner(db);
  await db.query(
    "UPDATE cockpit_members SET active=true,clients='{}' WHERE auth_user_id=$1",
    [uid],
  );
});
test("warning atomically queues WhatsApp, Slack, client comment and ads comment exactly once", async () => {
  await reset();
  await observe("payment_grace");
  await observe("payment_grace");
  expect(await scalar("SELECT count(*) FROM cockpit_ad_billing_events")).toBe(
    1,
  );
  expect(
    await scalar("SELECT count(*) FROM cockpit_ad_billing_deliveries"),
  ).toBe(4);
  expect(
    await scalar(
      "SELECT count(*) FROM cockpit_ad_billing_deliveries WHERE channel='clickup' AND destination IN('client1','ads1')",
    ),
  ).toBe(2);
  expect(await claimOne()).toBeNull(); // default dry run
});
test("unsettled escalation replaces unsent warning; restriction never sends a client decline claim", async () => {
  await reset();
  await observe("payment_grace");
  await observe("unsettled");
  expect(
    await scalar(
      "SELECT count(*) FROM cockpit_ad_billing_deliveries WHERE state='queued'",
    ),
  ).toBe(4);
  expect(
    await scalar(
      "SELECT count(*) FROM cockpit_ad_billing_deliveries WHERE state='skipped'",
    ),
  ).toBe(4);
  await observe("restricted");
  expect(
    await scalar(
      "SELECT count(*) FROM cockpit_ad_billing_deliveries WHERE state='queued' AND channel='whatsapp'",
    ),
  ).toBe(0);
});
test("source outage keeps incident open and blocks delivery", async () => {
  await reset();
  await observe("unsettled");
  await observe("unknown", "Meta unavailable");
  expect(await scalar("SELECT signal FROM cockpit_ad_billing_bindings")).toBe(
    "unsettled",
  );
  await db.exec("UPDATE cockpit_ad_billing_config SET apply=true");
  expect(await claimOne()).toBeNull();
});
test("recovery requires spaced checks and no recovery WhatsApp before an accepted incident message", async () => {
  await reset();
  await observe("unsettled");
  await observe("healthy");
  await observe("healthy");
  expect(await scalar("SELECT signal FROM cockpit_ad_billing_bindings")).toBe(
    "unsettled",
  );
  await db.exec(
    "UPDATE cockpit_ad_billing_bindings SET healthy_since=now()-interval '5 minutes'",
  );
  await observe("healthy");
  expect(await scalar("SELECT signal FROM cockpit_ad_billing_bindings")).toBe(
    "healthy",
  );
  expect(
    await scalar(
      "SELECT count(*) FROM cockpit_ad_billing_deliveries d JOIN cockpit_ad_billing_events e ON e.id=d.event_id WHERE e.signal='recovered' AND d.channel='whatsapp'",
    ),
  ).toBe(0);
});
test("concurrent claims are exclusive; stale sending becomes unknown and is never replayed", async () => {
  await reset();
  await observe("unsettled");
  await db.exec("UPDATE cockpit_ad_billing_config SET apply=true");
  const one = await claimOne(),
    two = await claimOne();
  expect(one.id).not.toBe(two.id);
  await db.query("SELECT cockpit_ad_billing_begin_send($1,$2)", [
    one.id,
    claim,
  ]);
  await db.query(
    "UPDATE cockpit_ad_billing_deliveries SET claimed_at=now()-interval '6 minutes' WHERE id=$1",
    [one.id],
  );
  await claimOne();
  expect(
    await scalar(
      `SELECT state FROM cockpit_ad_billing_deliveries WHERE id='${one.id}'`,
    ),
  ).toBe("unknown");
  await expect(
    db.query("SELECT cockpit_ad_billing_result($1,$2,$3,NULL)", [
      one.id,
      claim,
      "accepted",
    ]),
  ).rejects.toThrow("receipt");
  await db.query("SELECT cockpit_ad_billing_result($1,$2,$3,$4)", [
    one.id,
    claim,
    "accepted",
    "provider123",
  ]);
  expect(
    await scalar(
      `SELECT state FROM cockpit_ad_billing_deliveries WHERE id='${one.id}'`,
    ),
  ).toBe("accepted");
});
test("disable and mapping edits invalidate queued intents and stale leases cannot publish", async () => {
  await reset();
  await observe("unsettled");
  await db.exec("UPDATE cockpit_ad_billing_config SET apply=true");
  const d = await claimOne();
  await db.exec(
    "UPDATE cockpit_ad_billing_bindings SET whatsapp_group='55555@g.us'",
  );
  expect(await scalar("SELECT revision FROM cockpit_ad_billing_bindings")).toBe(
    2,
  );
  expect(
    (
      await db.query<{ b: boolean }>(
        "SELECT cockpit_ad_billing_begin_send($1,$2) b",
        [d.id, claim],
      )
    ).rows[0].b,
  ).toBe(false);
  await expect(observe("unsettled")).rejects.toThrow("Binding changed");
  await db.exec(
    "UPDATE cockpit_ad_billing_config SET lease_until=now()-interval '1 minute'",
  );
  await expect(observe("unsettled")).rejects.toThrow("lease expired");
});

const delivery: Delivery = {
  id: "00000000-0000-4000-8000-000000000005",
  binding_id: binding.id,
  revision: 1,
  channel: "whatsapp",
  destination: "12345@g.us",
  body: "Synthetic test",
  claim,
  state: "claimed",
};
test("ambiguous outbound failures are attempted only once", async () => {
  let calls = 0;
  const t = new Transport({ AD_BILLING_WHAPI_TOKEN: "synthetic" }, async () => {
    calls++;
    throw new Error("timeout");
  });
  await expect(t.send(delivery)).rejects.toBeInstanceOf(ProviderError);
  expect(calls).toBe(1);
});
test("roster replacement uses a safeupdate predicate and rejects stale leases", async () => {
  await reset();
  await db.query("select cockpit_ad_billing_roster_refresh($1,$2)", [lease, JSON.stringify([{id:"old",name:"Old client"}])]);
  await db.query("select cockpit_ad_billing_roster_refresh($1,$2)", [lease, JSON.stringify([{id:"current",name:"Current client"}])]);
  expect((await db.query("select client_task_id from cockpit_ad_billing_roster")).rows).toEqual([{client_task_id:"current"}]);
  await expect(db.query("select cockpit_ad_billing_roster_refresh($1,'[]')", [uid])).rejects.toThrow("lease");
  expect(migration("20261011192500_ad_billing_roster_safe_update.sql")).toContain("WHERE client_task_id IS NOT NULL");
});

test("PostgREST void RPCs accept 204 while gates and provider receipts fail closed", async () => {
  const t = new Transport({
    SUPABASE_URL: "https://bldgtotkfmhoxmlzowdx.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic",
  }, async () => new Response(null, { status: 204 }));
  for (const name of ["roster_refresh", "observe", "finish"])
    expect(await t.rpc(`cockpit_ad_billing_${name}`)).toBeNull();
  for (const name of ["start", "claim", "begin_send", "result"])
    await expect(t.rpc(`cockpit_ad_billing_${name}`)).rejects.toBeInstanceOf(ProviderError);
  await expect(t.json("Whapi", "https://example.test")).rejects.toBeInstanceOf(ProviderError);
  const malformed = new Transport(t.env, async () => new Response(null, { status: 200 }));
  await expect(malformed.rpc("cockpit_ad_billing_finish")).rejects.toBeInstanceOf(ProviderError);
});

test("Whapi needs a sent=true message receipt; an HTTP 200 alone is not success", async () => {
  const t = new Transport(
    { AD_BILLING_WHAPI_TOKEN: "synthetic" },
    async () =>
      new Response(JSON.stringify({ sent: true, message: { id: "wa-123" } })),
  );
  expect(await t.send(delivery)).toBe("wa-123");
  const missing = new Transport(
    { AD_BILLING_WHAPI_TOKEN: "synthetic" },
    async () => new Response("{}"),
  );
  await expect(missing.send(delivery)).rejects.toBeInstanceOf(ProviderError);
});
test("external send is gated by both runtime flag and fresh eligibility", async () => {
  const off = new Transport({});
  expect(await dispatchOne(off)).toBe(false);
  let sent = 0;
  const results: any[] = [];
  const fake = {
    env: { AD_BILLING_APPLY: "true" },
    rpc: async (name: string, args: any) =>
      name.endsWith("_claim") ? delivery : results.push(args),
    rows: async () => [binding],
    preflight: () => {},
    eligibility: async () => {
      throw new Error("Client is not Active");
    },
    send: async () => {
      sent++;
      return "sent";
    },
  } as unknown as Transport;
  expect(await dispatchOne(fake)).toBe(true);
  expect(sent).toBe(0);
  expect(results[0].p_state).toBe("failed");
});

class LocalWorkflow extends Transport {
  sends: Delivery[] = [];
  checks = 0;
  timeoutChannel: string | null = null;
  constructor() {
    super({ AD_BILLING_APPLY: "true" });
  }
  override async rpc<T = any>(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<T> {
    const entries = Object.entries(args);
    return (
      await db.query<{ value: T }>(
        `SELECT ${name}(${entries.map(([k], i) => `${k}=>$${i + 1}`).join(",")}) value`,
        entries.map(([, v]) => v),
      )
    ).rows[0].value;
  }
  override async rows<T = any>(table: string, query = ""): Promise<T[]> {
    const id = query.match(/id=eq\.([\w-]+)/)?.[1],
      state = query.match(/state=eq\.(\w+)/)?.[1];
    return (
      await db.query<T & Record<string, unknown>>(
        `SELECT * FROM ${table}${id ? " WHERE id=$1" : state ? " WHERE state=$1" : ""}`,
        id ? [id] : state ? [state] : [],
      )
    ).rows;
  }
  override async eligibility(b: Binding) {
    this.checks++;
    validateBinding(b, client, [ad], sheet);
  }
  override async meta() {
    return { id: "act_123456", account_status: 3 };
  }
  override preflight() {}
  override async send(d: Delivery) {
    this.sends.push(d);
    if (d.channel === this.timeoutChannel)
      throw new ProviderError("Whapi", 0, true);
    return "receipt-" + d.id;
  }
  override async reconcile(d: Delivery) {
    return this.sends.some(x => x.id === d.id) ? "receipt-" + d.id : null;
  }
}
test("complete synthetic workflow records four receipts with a fresh client check for each destination", async () => {
  await reset();
  await observe("unsettled");
  await db.exec("UPDATE cockpit_ad_billing_config SET apply=true");
  const t = new LocalWorkflow();
  for (let i = 0; i < 4; i++) expect(await dispatchOne(t)).toBe(true);
  expect(await dispatchOne(t)).toBe(false);
  expect(t.checks).toBe(4);
  expect(t.sends.length).toBe(4);
  expect(
    t.sends
      .filter(d => d.channel === "clickup")
      .map(d => d.destination)
      .sort(),
  ).toEqual(["ads1", "client1"]);
  expect(
    await scalar(
      "SELECT count(*) FROM cockpit_ad_billing_deliveries WHERE state='accepted'",
    ),
  ).toBe(4);
});
test("a partial failure preserves other receipts and reconciles without another WhatsApp send", async () => {
  await reset();
  await observe("unsettled");
  await db.exec("UPDATE cockpit_ad_billing_config SET apply=true");
  const t = new LocalWorkflow();
  t.timeoutChannel = "whatsapp";
  for (let i = 0; i < 4; i++) await dispatchOne(t);
  expect(
    await scalar(
      "SELECT count(*) FROM cockpit_ad_billing_deliveries WHERE state='unknown'",
    ),
  ).toBe(1);
  expect(
    await scalar(
      "SELECT count(*) FROM cockpit_ad_billing_deliveries WHERE state='accepted'",
    ),
  ).toBe(3);
  await reconcileUnknown(t);
  expect(t.sends.length).toBe(4);
  expect(
    await scalar(
      "SELECT count(*) FROM cockpit_ad_billing_deliveries WHERE state='accepted'",
    ),
  ).toBe(4);
});
test("recovery WhatsApp is queued only after a received incident notification in the same episode", async () => {
  await reset();
  await observe("unsettled");
  await db.exec("UPDATE cockpit_ad_billing_config SET apply=true");
  const t = new LocalWorkflow();
  for (let i = 0; i < 4; i++) await dispatchOne(t);
  await observe("healthy");
  await db.exec(
    "UPDATE cockpit_ad_billing_bindings SET healthy_since=now()-interval '5 minutes'",
  );
  await observe("healthy");
  expect(
    await scalar(
      "SELECT count(*) FROM cockpit_ad_billing_deliveries d JOIN cockpit_ad_billing_events e ON e.id=d.event_id WHERE e.signal='recovered' AND d.channel='whatsapp'",
    ),
  ).toBe(1);
});
test("explicit rate-limit rejection backs off and stops after five attempts", async () => {
  await reset();
  await observe("unsettled");
  await db.exec("UPDATE cockpit_ad_billing_config SET apply=true");
  const d = await claimOne();
  await db.query("SELECT cockpit_ad_billing_begin_send($1,$2)", [d.id, claim]);
  await db.query(
    "SELECT cockpit_ad_billing_result($1,$2,'retry',NULL,'Rate limit')",
    [d.id, claim],
  );
  expect(
    await scalar(
      `SELECT state FROM cockpit_ad_billing_deliveries WHERE id='${d.id}'`,
    ),
  ).toBe("retry");
  expect(
    await scalar(
      `SELECT next_attempt_at>now() FROM cockpit_ad_billing_deliveries WHERE id='${d.id}'`,
    ),
  ).toBe(true);
  await db.query(
    "UPDATE cockpit_ad_billing_deliveries SET state='sending',attempts=5 WHERE id=$1",
    [d.id],
  );
  await db.query(
    "SELECT cockpit_ad_billing_result($1,$2,'retry',NULL,'Rate limit')",
    [d.id, claim],
  );
  expect(
    await scalar(
      `SELECT state FROM cockpit_ad_billing_deliveries WHERE id='${d.id}'`,
    ),
  ).toBe("failed");
});
test("global emergency stop wins between claim and send", async () => {
  await reset();
  await observe("unsettled");
  await db.exec("UPDATE cockpit_ad_billing_config SET apply=true");
  const d = await claimOne();
  await db.exec("UPDATE cockpit_ad_billing_config SET apply=false");
  expect(
    (
      await db.query<{ v: boolean }>(
        "SELECT cockpit_ad_billing_begin_send($1,$2) v",
        [d.id, claim],
      )
    ).rows[0].v,
  ).toBe(false);
});

test("an unsettled incident that oscillates into grace does not repeat the client notification", async () => {
  await reset(); await observe('unsettled'); await db.exec('UPDATE cockpit_ad_billing_config SET apply=true');
  const t=new LocalWorkflow(); for(let i=0;i<4;i++)await dispatchOne(t);
  await observe('payment_grace'); await observe('unsettled');
  expect(await scalar("SELECT count(*) FROM cockpit_ad_billing_deliveries WHERE channel='whatsapp'")).toBe(1);
});

// 14 Oct 2026: a database network error crashed the 10:10 UTC run and also failed its finish call, so the
// 10-minute lease made the next two runs answer busy. The finish call is now tried again before the error goes up.
function crashingRun(finishFailures: number) {
  const calls: string[] = [];
  const t = {
    env: {},
    rpc: async (name: string) => {
      calls.push(name);
      if (name === "cockpit_ad_billing_start") return true;
      if (name === "cockpit_ad_billing_finish" && calls.filter((c) => c === name).length <= finishFailures)
        throw new ProviderError("Database", 0, true);
      return null;
    },
    tasks: async () => {
      throw new ProviderError("Database", 0, true);
    },
  };
  return { t: t as unknown as Transport, finishes: () => calls.filter((c) => c === "cockpit_ad_billing_finish").length };
}

test("a crashed run frees its lease even when the first finish calls fail", async () => {
  const run = crashingRun(2);
  await expect(poll(run.t, [0, 0, 0, 0])).rejects.toThrow("Database request failed (network).");
  expect(run.finishes()).toBe(3);
});

// 26 Oct 2026: every client re-read the whole Client Data sheet, 17 reads a run. A run now reads it once.
function sheetRun(sheetFails: boolean) {
  const observed: { binding: string; signal: string; error: string | null }[] = [];
  let sheets = 0;
  const t = {
    env: {},
    rpc: async (name: string, args: Record<string, any>) => {
      if (name === "cockpit_ad_billing_observe")
        observed.push({ binding: args.p_binding, signal: args.p_signal, error: args.p_error });
      return name === "cockpit_ad_billing_start" ? true : null;
    },
    tasks: async () => [],
    rows: async () =>
      ["1", "2", "3"].map((n) => ({ id: "b" + n, client_name: "client" + n, account_id: "12345" + n, revision: 1, ads_task_ids: [] })),
    sheet: async () => {
      sheets++;
      if (sheetFails) throw new ProviderError("Google", 0, true);
      return sheet;
    },
    eligibility: async (_b: Binding, rows: Promise<unknown[][]>) => {
      expect(await rows).toBe(sheet);
    },
    meta: async (id: string) => ({ id: "act_" + id, account_status: 1 }),
  };
  return { t: t as unknown as Transport, observed, sheets: () => sheets };
}

test("a poll reads Client Data once and names its slowest client", async () => {
  const run = sheetRun(false);
  const result: any = await poll(run.t, [0]);
  expect(run.sheets()).toBe(1);
  expect(result).toMatchObject({ busy: false, checked: 3, failures: 0 });
  expect(run.observed.map((o) => o.signal)).toEqual(["healthy", "healthy", "healthy"]);
  expect(result.slowest.client).toMatch(/^client[123]$/);
  expect(typeof result.secs).toBe("number");
});

test("a failed Client Data read fails each client's check without crashing the run", async () => {
  const run = sheetRun(true);
  const result: any = await poll(run.t, [0]);
  expect(run.sheets()).toBe(1);
  expect(result).toMatchObject({ busy: false, checked: 3, failures: 3 });
  expect(run.observed.every((o) => o.signal === "unknown" && /Google/.test(o.error ?? ""))).toBe(true);
});

test("when every finish call fails, the run's own error still goes up", async () => {
  const run = crashingRun(99);
  await expect(poll(run.t, [0, 0, 0, 0])).rejects.toThrow("Database request failed (network).");
  expect(run.finishes()).toBe(4);
});

// 26 Oct 2026: an account change applies itself when four proofs hold. Marble (17 Oct) and ARCWANI (26 Oct) each
// needed an agent session. These tests replay both real cases and every missing proof.
const adsTask = (id: string, account: string | null, open = true, tags = ["synthetic client"]): Task => ({
  id,
  list: { id: ADS_LIST },
  tags: tags.map((name) => ({ name })),
  status: { type: open ? "open" : "closed" },
  custom_fields: [
    {
      id: ADS_ACCOUNT,
      value: account ? `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${account}` : null,
    },
  ],
});
const clientData = (ref: string, task = "client1") => [
  ["Clickup ID", "WA GROUP ID", "Ad Account - Meta"],
  [task, "12345@g.us", ref],
];
function plan(
  over: Partial<Binding>,
  ref: string,
  tasks: Task[],
  names: Record<string, string | null>,
  taken: Record<string, string> = {},
) {
  const b = { ...binding, ...over };
  return planAccountChange({
    binding: b,
    sheet: clientData(ref, b.client_task_id),
    tasks: clientAdsTasks(b, b.client_name, tasks),
    names,
    taken,
  });
}
const hint = (p: ReturnType<typeof plan>) => (p.kind === "blocked" ? p.hint : "");

test("only account and ads-task changes are marked for the account change check", () => {
  expect(() => validateBinding(binding, client, [ad], clientData("Other"))).toThrow(IdentityDrift);
  expect(() => validateBinding(binding, client, [], sheet)).toThrow(IdentityDrift);
  let other: unknown;
  try {
    validateBinding({ ...binding, whatsapp_group: "999@g.us" }, client, [ad], sheet);
  } catch (e) {
    other = e;
  }
  expect(other).toBeInstanceOf(Error);
  expect(other).not.toBeInstanceOf(IdentityDrift);
});
test("ARCWANI replay: the new account on the open ads task, named in Client Data, moves the binding", () => {
  const arcwani = {
    client_task_id: "86ey8w5m1",
    client_name: "ARCWANI",
    account_id: "1034584029438250",
    ads_task_ids: ["86eyt006q"],
    sheet_account_ref: "ARCWANI",
  };
  const p = plan(
    arcwani,
    "Arcwani Ad account",
    [
      adsTask("86eyt006q", "1034584029438250", false, ["arcwani"]),
      adsTask("z8xmdvkdhf", "2325233444877544", true, ["arcwani"]),
    ],
    { "1034584029438250": "ARCWANI", "2325233444877544": "Arcwani Ad account" },
  );
  expect(p).toMatchObject({
    kind: "move",
    account: "2325233444877544",
    ref: "Arcwani Ad account",
    adsTasks: ["z8xmdvkdhf"],
  });
  expect(p.kind === "move" && p.notice).toContain("(was 1034584029438250)");
});
test("Marble replay: a blank link on the new ads task blocks the move until the link is there", () => {
  const marble = {
    client_task_id: "86eymcqdq",
    client_name: "Marble and more",
    account_id: "1639470257874847",
    ads_task_ids: ["z8xmdve3h3"],
    sheet_account_ref: "marblemore1",
  };
  const old = adsTask("z8xmdve3h3", "1639470257874847", false, ["marble and more"]);
  const blank = plan(marble, "Marble ad account", [old, adsTask("z8xmdvhntx", null, true, ["marble and more"])], {
    "1639470257874847": "marblemore1",
  });
  expect(hint(blank)).toContain("no open ads task links a different Meta account");
  expect(hint(blank)).toContain("Meta Ad Account field");
  const linked = plan(
    marble,
    "Marble ad account",
    [old, adsTask("z8xmdvhntx", "2631767157271939", true, ["marble and more"])],
    { "1639470257874847": "marblemore1", "2631767157271939": "Marble ad account" },
  );
  expect(linked).toMatchObject({ kind: "move", account: "2631767157271939", adsTasks: ["z8xmdvhntx"] });
});
test("a renamed account keeps its account and ads tasks; spacing and case do not matter", () => {
  const p = plan({ sheet_account_ref: "Madana" }, "Madana Engineering Consulting", [adsTask("ads1", "123456")], {
    "123456": "madana  Engineering Consulting ",
  });
  expect(p).toMatchObject({ kind: "rename", account: "123456", ref: "Madana Engineering Consulting", adsTasks: ["ads1"] });
});
test("Smmim studio replay: a currency added to the Client Data account number plans an automatic rename, not a block", () => {
  const smmim = {
    client_name: "Smmim studio",
    account_id: "1988430024784828",
    ads_task_ids: ["ads1"],
    sheet_account_ref: "1988430024784828",
  };
  const cell = "1988430024784828, SAR";
  const smmimClient = { ...client, name: "Smmim studio" };
  expect(() =>
    validateBinding({ ...binding, ...smmim }, smmimClient, [adsTask("ads1", "1988430024784828")], clientData(cell)),
  ).toThrow(IdentityDrift);
  const p = plan(smmim, cell, [adsTask("ads1", "1988430024784828", true, ["smmim studio"])], {
    "1988430024784828": "1988430024784828",
  });
  expect(p).toMatchObject({
    kind: "rename",
    account: "1988430024784828",
    ref: cell,
    adsTasks: ["ads1"],
  });
  expect(p.kind === "rename" && p.evidence).toContain("its own ID");
});
test("a replaced ads task on the same account swaps in the open task that links it", () => {
  expect(plan({}, "123456", [adsTask("ads2", "123456")], {})).toMatchObject({
    kind: "tasks",
    account: "123456",
    adsTasks: ["ads2"],
  });
  expect(hint(plan({}, "123456", [adsTask("ads2", null)], {}))).toContain(
    "No open ads task for Synthetic Client links Meta account 123456",
  );
});
test("an account the worker's Meta token cannot read is never adopted", () => {
  const p = plan(
    { sheet_account_ref: "Old name" },
    "New name",
    [adsTask("ads1", "123456", false), adsTask("ads2", "654321")],
    { "123456": "Old name", "654321": null },
  );
  expect(hint(p)).toContain("cannot read account 654321");
});
test("an account another client's binding has is never adopted", () => {
  const p = plan(
    { sheet_account_ref: "Old name" },
    "New name",
    [adsTask("ads2", "654321")],
    { "123456": "Old name", "654321": "New name" },
    { "654321": "Other Client" },
  );
  expect(hint(p)).toContain("already belongs to the billing watch for Other Client");
});
test("a linked account with another Meta name, two matches, or another client's tag is not adopted", () => {
  expect(
    hint(plan({ sheet_account_ref: "Old name" }, "New name", [adsTask("ads2", "654321")], { "123456": "Old name", "654321": "Shop" })),
  ).toContain('654321 "Shop"');
  expect(
    hint(
      plan({ sheet_account_ref: "Old name" }, "New name", [adsTask("ads2", "654321"), adsTask("ads3", "765432")], {
        "123456": "Old name",
        "654321": "New name",
        "765432": "New Name",
      }),
    ),
  ).toContain("2 linked accounts match it");
  expect(
    plan({ sheet_account_ref: "Old name" }, "New name", [adsTask("ads9", "654321", true, ["other client"])], {
      "123456": "Old name",
      "654321": "New name",
    }).kind,
  ).toBe("blocked");
});

class MoveWorld extends Transport {
  notices: string[] = [];
  ref = "Arcwani Ad account";
  ads: Task[] = [adsTask("ads1", "123456", false), adsTask("ads2", "654321")];
  names: Record<string, string | null> = { "123456": "ARCWANI", "654321": "Arcwani Ad account " };
  constructor(mode?: string) {
    super(mode ? { AD_BILLING_AUTO_MOVE: mode } : {});
  }
  override async rpc<T = any>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const entries = Object.entries(args).map(([k, v]) => [k, k === "p_rows" ? JSON.stringify(v) : v] as const);
    return (
      await db.query<{ value: T }>(
        `SELECT ${name}(${entries.map(([k], i) => `${k}=>$${i + 1}`).join(",")}) value`,
        entries.map(([, v]) => v),
      )
    ).rows[0].value;
  }
  override async rows<T = any>(table: string, query = ""): Promise<T[]> {
    const id = query.match(/(?:^|&)id=eq\.([\w-]+)/)?.[1];
    return (await db.query<T & Record<string, unknown>>(`SELECT * FROM ${table}${id ? " WHERE id=$1" : ""}`, id ? [id] : []))
      .rows;
  }
  override async task(id: string): Promise<Task> {
    const found = id === "client1" ? { ...client, name: "Synthetic Client" } : this.ads.find((t) => t.id === id);
    if (!found) throw new ProviderError("ClickUp", 404);
    return found;
  }
  override async tasks(list: string): Promise<any[]> {
    return list === CLIENT_LIST ? [{ ...client, name: "Synthetic Client", tags: [] }] : this.ads;
  }
  override async sheet() {
    return clientData(this.ref);
  }
  override async meta(id: string) {
    const name = this.names[id];
    if (typeof name !== "string") throw new ProviderError("Meta", 400);
    return { id: "act_" + id, name, account_status: 1 };
  }
  override async notice(text: string) {
    this.notices.push(text);
    return "1.1";
  }
}
async function movePoll(world: MoveWorld) {
  await owner(db);
  await db.exec("UPDATE cockpit_ad_billing_config SET lease=NULL,lease_until=NULL");
  return (await poll(world, [0])) as any;
}
const moveAudits = () =>
  scalar("SELECT count(*)::int FROM cockpit_audit_log WHERE action LIKE 'billing.account_%'");
const bindingRow = async () =>
  (await db.query<any>("SELECT * FROM cockpit_ad_billing_bindings WHERE id=$1", [binding.id])).rows[0];

test("on: a proven move saves once, audits old and new, posts one Slack line, and checks the new account", async () => {
  await reset();
  const audits = await moveAudits();
  const world = new MoveWorld("on");
  expect(await movePoll(world)).toMatchObject({ checked: 1, failures: 0, auto_move: { mode: "on", moved: 1 } });
  expect(await bindingRow()).toMatchObject({
    account_id: "654321",
    sheet_account_ref: "Arcwani Ad account",
    ads_task_ids: ["ads2"],
    revision: 2,
    signal: "healthy",
    error: null,
  });
  const audit = (await db.query<any>("SELECT * FROM cockpit_audit_log WHERE action='billing.account_move'")).rows.at(-1);
  expect(audit.before).toMatchObject({ account_id: "123456", ads_task_ids: ["ads1"], revision: 1 });
  expect(audit.after).toMatchObject({ account_id: "654321", ads_task_ids: ["ads2"], revision: 2 });
  expect(world.notices).toHaveLength(1);
  expect(world.notices[0]).toContain("moved to Meta account 654321");
  expect(await movePoll(world)).toMatchObject({ failures: 0, auto_move: { moved: 0 } });
  expect(world.notices).toHaveLength(1);
  expect(await moveAudits()).toBe((audits as number) + 1);
});
test("dry, the default: the worker logs the planned move and changes nothing", async () => {
  await reset();
  const audits = await moveAudits();
  const world = new MoveWorld();
  expect(await movePoll(world)).toMatchObject({ failures: 1, auto_move: { mode: "dry", would: 1, moved: 0 } });
  expect(await bindingRow()).toMatchObject({
    account_id: "123456",
    revision: 1,
    error: "Client Data account reference changed; review the binding",
  });
  expect(world.notices).toHaveLength(0);
  expect(await moveAudits()).toBe(audits);
});
test("on: a missing proof changes nothing and the panel error says what to fix", async () => {
  await reset();
  const audits = await moveAudits();
  const world = new MoveWorld("on");
  world.ads = [adsTask("ads1", "123456", false), adsTask("ads2", null)];
  expect(await movePoll(world)).toMatchObject({ failures: 1, auto_move: { blocked: 1, moved: 0 } });
  const row = await bindingRow();
  expect(row).toMatchObject({ account_id: "123456", revision: 1 });
  expect(row.error).toBe(
    'Client Data account reference changed. Client Data shows "Arcwani Ad account" for Synthetic Client, but no open ads task links a different Meta account. Put the new account\'s Ads Manager link in the Meta Ad Account field of the client\'s current ads task.',
  );
  expect(world.notices).toHaveLength(0);
  expect(await moveAudits()).toBe(audits);
});
test("the move function refuses a stale revision, a taken account, a wrong kind, an expired lease and browsers", async () => {
  await reset();
  const move = async (revision: number, kind: string, account: string) =>
    (
      await db.query<{ v: any }>("SELECT cockpit_ad_billing_move($1,$2,$3,$4,$5,$6,$7,$8) v", [
        lease,
        binding.id,
        revision,
        kind,
        account,
        "New name",
        ["ads2"],
        "Synthetic proof for the move function",
      ])
    ).rows[0].v;
  expect(await move(2, "move", "654321")).toEqual({ ok: false, reason: "the binding changed during the check" });
  await expect(move(1, "rename", "654321")).rejects.toThrow("kind does not match");
  await db.query(
    "INSERT INTO cockpit_ad_billing_bindings(client_task_id,client_name,account_id,ads_task_ids,whatsapp_group,identity_evidence,identity_verified_at,sheet_account_ref) VALUES('client2','Other Client','654321',ARRAY['ads9'],'999@g.us','Synthetic test proof only',now(),'x')",
  );
  expect(await move(1, "move", "654321")).toEqual({
    ok: false,
    reason: "Meta account 654321 already belongs to Other Client",
  });
  await actor(db, uid);
  await expect(move(1, "move", "765432")).rejects.toThrow();
  await owner(db);
  await db.exec("UPDATE cockpit_ad_billing_config SET lease_until=now()-interval '1 minute'");
  await expect(move(1, "move", "765432")).rejects.toThrow("Monitor lease expired");
  expect(await bindingRow()).toMatchObject({ account_id: "123456", revision: 1 });
});
