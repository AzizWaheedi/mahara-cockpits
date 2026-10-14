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
    "123456, SAR",
  ])
    expect(accountId(value)).toBeNull();
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

test("when every finish call fails, the run's own error still goes up", async () => {
  const run = crashingRun(99);
  await expect(poll(run.t, [0, 0, 0, 0])).rejects.toThrow("Database request failed (network).");
  expect(run.finishes()).toBe(4);
});
