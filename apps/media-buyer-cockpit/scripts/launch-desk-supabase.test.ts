import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import {
  actor,
  cockpitTestDb,
  member,
  migration,
  owner,
} from "./lib/cockpitTestDb";

let db: Awaited<ReturnType<typeof cockpitTestDb>>;
const BUYER = "00000000-0000-4000-8000-000000000001",
  OTHER = "00000000-0000-4000-8000-000000000002",
  CSM = "00000000-0000-4000-8000-000000000003";
const file = "20261024b_media_launch_desk.sql";
function table(file: string, name: string) {
  const sql = migration(file),
    start = sql.search(
      new RegExp(`CREATE TABLE(?: IF NOT EXISTS)? public\\.${name}\\s*\\(`),
    );
  if (start < 0) throw Error(name);
  return sql.slice(start, sql.indexOf("\n);", start) + 3);
}
async function pipeline(id?: string) {
  await actor(db, BUYER);
  try {
    return (
      await db.query<any>("select cockpit_launch_pipeline($1) r", [id ?? null])
    ).rows[0].r;
  } finally {
    await owner(db);
  }
}
beforeAll(async () => {
  db = await cockpitTestDb({ supabaseDefaultPrivileges: true });
  await db.exec("CREATE TABLE public.clients(id uuid PRIMARY KEY)");
  await db.exec(
    table("20260923o_cockpit_domain_tables.sql", "cockpit_campaigns"),
  );
  await db.exec(
    `ALTER TABLE cockpit_campaigns ADD COLUMN IF NOT EXISTS source_deleted boolean DEFAULT false;`,
  );
  await db.exec(migration("20260927g_cockpit_media_actions.sql"));
  await db.exec(
    `CREATE TABLE cockpit_ad_drafts(id bigint PRIMARY KEY,status text,launch_action_id uuid,meta_campaign_id text,meta_adset_id text,meta_ad_ids text[],launched_at timestamptz,error text); CREATE TABLE cockpit_campaign_action_messages(id uuid PRIMARY KEY,campaign_name text,actor_id uuid,text text,at timestamptz,learning_started_at timestamptz);`,
  );
  for (const [f, n] of [
    ["20260927w_media_read_models.sql", "cockpit_media_source_state"],
    ["20260927w_media_read_models.sql", "cockpit_media_sources"],
    ["20261016111157_board_facts.sql", "cockpit_board_clients"],
    ["20261016210000_board_facts_checked.sql", "cockpit_board_account_ties"],
    ["20261016121700_meta_ad_days.sql", "cockpit_meta_ad_days"],
    ["20261017100000_meta_budgets.sql", "cockpit_meta_account_state"],
    ["20261011c_csm_call_store.sql", "cockpit_csm_meta_activities"],
    ["20261024a_brand_blueprints.sql", "cockpit_blueprints"],
    ["20261024a_brand_blueprints.sql", "cockpit_blueprint_settings"],
  ])
    await db.exec(table(f, n));
  await db.exec(
    `ALTER TABLE cockpit_board_clients ADD COLUMN registry_status text, ADD COLUMN card_stage text; CREATE TABLE cockpit_client_onboarding(clickup_task_id text PRIMARY KEY,in_onboarding boolean,handover jsonb,links jsonb); CREATE TABLE cockpit_excluded_ads(ad_id text,account_id text);`,
  );
  await db.exec(
    table("20261004d_media_native_surface.sql", "cockpit_media_native_records"),
  );
  await db.exec(
    migration("20261024a_brand_blueprints.sql").match(
      /CREATE OR REPLACE FUNCTION public.cockpit_blueprint_part_answers[\s\S]*?END \$\$;/,
    )![0],
  );
  await db.exec(migration(file));
  await db.exec(migration(file));
  await db.exec(migration("20261024125012_media_clients_workspace.sql"));
  await db.exec(migration("20261024125012_media_clients_workspace.sql"));
  await db.exec(
    migration("20261024131543_launch_creative_imports.sql").match(
      /CREATE OR REPLACE FUNCTION public.cockpit_media_clients\([\s\S]*?END \$\$;/,
    )![0],
  );
  await db.exec(
    migration("20261024131543_launch_creative_imports.sql").match(
      /CREATE OR REPLACE FUNCTION public.cockpit_media_client_notices\(\)[\s\S]*?END \$\$;/,
    )![0],
  );
  await db.exec(
    `CREATE TRIGGER cockpit_media_confirmed_effects AFTER UPDATE OF state ON cockpit_media_actions FOR EACH ROW EXECUTE FUNCTION cockpit_media_action_effects();`,
  );
  await member(db, BUYER, "buyer@tests.invalid", ["media_buyer"]);
  await member(db, OTHER, "other@tests.invalid", ["media_buyer"]);
  await member(db, CSM, "csm@tests.invalid", ["csm"]);
  await db.exec(
    `UPDATE cockpit_members SET clients=ARRAY['Ready'] WHERE auth_user_id='${OTHER}';`,
  );
  const fixtures = [
    ["ready", "Ready", "Active", "111111"],
    ["onboarding", "Onboarding", "Launching", "222222"],
    ["nothing", "Nothing", "Paused", "333333"],
    ["stopped", "Stopped", "Stopped", "444444"],
    ["cancelled", "Cancelled", "Cancelled", "555555"],
    ["ads", "Ads", "Active", "666666"],
  ];
  for (const [id, name, status, account] of fixtures)
    await db.query(
      `INSERT INTO cockpit_board_clients(location_id,clickup_id,client_name,status,service_mode,ad_account_ids) VALUES($1,$1,$2,$3,'DFY',ARRAY[$4])`,
      [id, name, status, account],
    );
  await db.exec(
    `INSERT INTO cockpit_blueprints(task_id,client_name,answers,parts,updated_by) VALUES('ready','Ready','{"daily_budget":30,"red_lines":"No invented offers","best_client":"PRIVATE PART TWO"}','{"1":{"lastAt":"2026-10-24T12:00:00Z"},"2":{"secret":"NO"}}','test'); INSERT INTO cockpit_meta_account_state(account_id,account_status,currency,fetched_at,run_id) VALUES('111111',1,'SAR',now(),'00000000-0000-4000-8000-000000000099'),('333333',3,'USD',now(),'00000000-0000-4000-8000-000000000099'); INSERT INTO cockpit_campaigns(client_name,meta_account_id,meta_campaign_id,raw_data) VALUES('Ads','666666','777777','{"campaignName":"In Ads","clientName":"Ads"}');`,
  );
}, 30000);
afterEach(async () => owner(db));
afterAll(async () => db?.close());
test("migration is repeatable and grants expose only authorized RPCs", async () => {
  for (const role of ["anon", "authenticated"])
    for (const table of ["cockpit_launches", "cockpit_meta_people"])
      expect(
        (
          await db.query<any>("select has_table_privilege($1,$2,'SELECT') ok", [
            role,
            table,
          ])
        ).rows[0].ok,
      ).toBe(false);
  for (const fn of [
    "cockpit_launch_pipeline(text)",
    "cockpit_launch_action(text,jsonb)",
    "cockpit_media_account_scope(text,text,text,uuid)",
  ]) {
    expect(
      (
        await db.query<any>(
          "select has_function_privilege('authenticated',$1,'EXECUTE') ok",
          [fn],
        )
      ).rows[0].ok,
    ).toBe(true);
    expect(
      (
        await db.query<any>(
          "select has_function_privilege('anon',$1,'EXECUTE') ok",
          [fn],
        )
      ).rows[0].ok,
    ).toBe(false);
  }
});
test("client universe, lane rules, unknown status and Blueprint boundary", async () => {
  const p = await pipeline();
  expect(p.clients).toHaveLength(5);
  expect(p.lanes).toEqual({
    onboarding: 1,
    ready: 1,
    nothing: 1,
    waiting: 0,
    ads: 1,
  });
  const s = p.clients.find((x: any) => x.id === "stopped");
  expect(s.readOnly).toBe(true);
  expect(s.lane).toBe("search");
  expect(s.accounts[0].status).toBe(null);
  expect(JSON.stringify(p)).not.toContain("PRIVATE PART TWO");
  expect(p.clients.find((x: any) => x.id === "ready").caller).toBe(null);
});
test("membership and seat restrictions", async () => {
  await actor(db, OTHER);
  expect(
    (await db.query<any>("select cockpit_launch_pipeline() r")).rows[0].r
      .clients,
  ).toHaveLength(1);
  await expect(
    db.query("select cockpit_launch_pipeline('nothing')"),
  ).rejects.toThrow("access list");
  await actor(db, CSM);
  await expect(db.query("select cockpit_launch_pipeline()")).rejects.toThrow(
    "Media buyer",
  );
  await actor(db, null);
  await expect(db.query("select cockpit_launch_pipeline()")).rejects.toThrow(
    "permission denied",
  );
  await owner(db);
});
test("scopes reject unpaid, wrong account, stopped and alien launch", async () => {
  await actor(db, BUYER);
  await expect(
    db.query(
      "select cockpit_media_account_scope('launch.copy','nothing','333333')",
    ),
  ).rejects.toThrow("This ad account owes Meta a payment.");
  await expect(
    db.query(
      "select cockpit_media_account_scope('launch.copy','ready','333333')",
    ),
  ).rejects.toThrow("not linked");
  await expect(
    db.query(
      "select cockpit_media_account_scope('launch.copy','stopped','444444')",
    ),
  ).rejects.toThrow("read-only");
  await expect(
    db.query(
      "select cockpit_media_account_scope('launch.copy','ready','111111','00000000-0000-4000-8000-000000000099')",
    ),
  ).rejects.toThrow("unavailable");
  const s = (
    await db.query<any>(
      "select cockpit_media_account_scope('launch.copy','ready','111111') r",
    )
  ).rows[0].r;
  expect(s.contractedUsd).toBe(30);
  await owner(db);
});
test("attach requires the matching pending intent", async () => {
  await expect(
    db.query(
      "select cockpit_launch_attach('00000000-0000-4000-8000-000000000099','ready','999999','Test account evidence')",
    ),
  ).rejects.toThrow("pending");
});
test("only confirmed receipt IDs create a build; invalid IDs cannot finalize", async () => {
  const id = "10000000-0000-4000-8000-000000000001";
  const result = {
    clickupId: "ready",
    locationId: "ready",
    clientName: "Ready",
    accountId: "111111",
    budgetUsd: 30,
    budgetLevel: "campaign",
    metaCampaignId: "888888",
    metaAdsetIds: ["888889"],
    metaAdIds: ["888890"],
  };
  await db.query(
    "INSERT INTO cockpit_media_actions(id,actor_id,operation,campaign_name,request) VALUES($1,$2,'launch.copy','Launch copy',$3)",
    [
      id,
      BUYER,
      { args: { clickupId: "ready", accountId: "111111" }, plan: { result } },
    ],
  );
  expect(
    (await db.query<any>("select count(*)::int n from cockpit_launches"))
      .rows[0].n,
  ).toBe(0);
  await expect(
    db.query("select cockpit_finish_media_action($1,$2,'{}')", [
      id,
      { ...result, ok: true, metaAdIds: ["bad"] },
    ]),
  ).rejects.toThrow("receipts required");
  await db.query("select cockpit_finish_media_action($1,$2,'{}')", [
    id,
    { ...result, ok: true },
  ]);
  const l = (await db.query<any>("select * from cockpit_launches")).rows[0];
  expect(l.meta_campaign_id).toBe("888888");
  expect(l.state).toBe("built");
  expect(
    (
      await db.query<any>(
        "select count(*)::int n from cockpit_audit_log where action='launch.copy'",
      )
    ).rows[0].n,
  ).toBe(1);
  expect(
    (await db.query<any>("select text from cockpit_campaign_action_messages"))
      .rows[0].text,
  ).toContain("paused");
  await actor(db, BUYER);
  expect(
    (
      await db.query<any>(
        "select cockpit_media_scope('control.setStatus','Launch copy') r",
      )
    ).rows[0].r.campaign,
  ).toBe("888888");
  await owner(db);
  const p = await pipeline("ready");
  expect(p.clients[0].waiting).toBe(true);
});
test("a client already in Ads also keeps a second waiting launch", async () => {
  await db.query(
    `INSERT INTO cockpit_launches(clickup_id,location_id,client_name,account_id,kind,campaign_name,state,created_by) VALUES('ads','ads','Ads','666666','copy','Second campaign','built',$1)`,
    [BUYER],
  );
  const p = await pipeline();
  expect(p.clients.find((c: any) => c.id === "ads").lane).toBe("ads");
  expect(p.clients.find((c: any) => c.id === "ads").waiting).toBe(true);
  expect(p.lanes.ads).toBe(1);
});
test("discard is local, audited, and does not remove campaign identifiers", async () => {
  const l = (
    await db.query<any>(
      `select * from cockpit_launches where campaign_name='Launch copy'`,
    )
  ).rows[0];
  await actor(db, BUYER);
  await db.query("select cockpit_launch_action('discard',$1)", [{ id: l.id }]);
  await owner(db);
  const after = (
    await db.query<any>("select * from cockpit_launches where id=$1", [l.id])
  ).rows[0];
  expect(after.state).toBe("discarded");
  expect(after.meta_campaign_id).toBe(l.meta_campaign_id);
  expect(
    (
      await db.query<any>(
        "select count(*)::int n from cockpit_audit_log where action='launch.discard'",
      )
    ).rows[0].n,
  ).toBe(1);
});
test("account chooser refuses known accounts and unknown clients", async () => {
  await actor(db, BUYER);
  expect(
    (
      await db.query<any>(
        "select cockpit_launch_available_accounts('ready',ARRAY['111111','666666','999999']) r",
      )
    ).rows[0].r,
  ).toEqual(["999999"]);
  await expect(
    db.query("select cockpit_media_account_scope('launch.copy','ready',null)"),
  ).rejects.toThrow("valid ad account");
  await expect(
    db.query(
      "select cockpit_launch_available_accounts('unknown',ARRAY['999999'])",
    ),
  ).rejects.toThrow("access list");
});

test("old same-day impressions do not mark a relaunch live", async () => {
  await owner(db);
  await db.exec(
    `INSERT INTO cockpit_launches(clickup_id,location_id,client_name,account_id,kind,campaign_name,state,meta_campaign_id,created_by,switched_on_at,impression_day,impressions_at_switch) VALUES('ready','ready','Ready','111111','switch_on','Baseline test','switched_on','912345','${BUYER}',now(),current_date,42); INSERT INTO cockpit_meta_ad_days(account_id,day,campaign_id,ad_id,impressions,fetched_at) VALUES('111111',current_date,'912345','912346',42,now())`,
  );
  const before = (await pipeline("ready")).clients[0].launches.find(
    (l: any) => l.meta_campaign_id === "912345",
  );
  expect(before.hasImpressions).toBe(false);
  expect(before.firstImpressionAt).toBe(null);
  await db.exec(
    "UPDATE cockpit_meta_ad_days SET impressions=43 WHERE ad_id='912346'",
  );
  const after = (await pipeline("ready")).clients[0].launches.find(
    (l: any) => l.meta_campaign_id === "912345",
  );
  expect(after.hasImpressions).toBe(true);
  expect(after.firstImpressionAt).not.toBe(null);
});

async function notices(who = BUYER) {
  await actor(db, who);
  try {
    return (await db.query<any>("select cockpit_media_client_notices() r"))
      .rows[0].r;
  } finally {
    await owner(db);
  }
}
test("client notices include inactive-spend clients but never stopped or another seat's clients", async () => {
  const all = await notices();
  expect(all.notices.some((n: any) => n.clientId === "nothing")).toBe(true);
  expect(
    all.notices.some((n: any) => ["stopped", "cancelled"].includes(n.clientId)),
  ).toBe(false);
  const limited = await notices(OTHER);
  expect(limited.notices.every((n: any) => n.clientId === "ready")).toBe(true);
  await actor(db, CSM);
  await expect(
    db.query("select cockpit_media_client_notices()"),
  ).rejects.toThrow();
});
test("task notices match only exact client identity and never leak unmatched work to a scoped seat", async () => {
  await db.exec(`INSERT INTO cockpit_media_source_state(table_name,ready,row_count,source_snapshot_at) VALUES('inbox',true,3,'2026-10-24T12:00:00Z') ON CONFLICT(table_name) DO UPDATE SET ready=true,row_count=3,source_snapshot_at='2026-10-24T12:00:00Z';
 INSERT INTO cockpit_media_sources(table_name,source_id,client_names,data,source_snapshot_at) VALUES
 ('inbox','task-ready',ARRAY['Ready'],'{"_id":"task-ready","taskId":"abc-ready","title":"Review Ready","reason":"assigned to you","status":"open"}','2026-10-24T12:00:00Z'),
 ('inbox','task-other',ARRAY['Nothing'],'{"_id":"task-other","taskId":"abc-other","title":"Other client work","status":"open"}','2026-10-24T12:00:00Z'),
 ('inbox','task-unknown',ARRAY[]::text[],'{"_id":"task-unknown","taskId":"abc-team","title":"Team work","status":"open"}','2026-10-24T12:00:00Z') ON CONFLICT DO NOTHING;`);
  const mine = await notices(OTHER);
  expect(
    mine.notices.filter((n: any) => n.kind === "task").map((n: any) => n.id),
  ).toEqual(["task:task-ready"]);
  const all = await notices();
  expect(all.notices.filter((n: any) => n.kind === "task")).toHaveLength(3);
  await actor(db, OTHER);
  const p = (await db.query<any>("select cockpit_media_clients('ready') r"))
    .rows[0].r;
  expect(p.clients[0].mediaTasks.map((n: any) => n.title)).toEqual([
    "Review Ready",
  ]);
  expect(p.clients[0].actionHistory).toBeArray();
  await expect(
    db.query("select cockpit_media_clients('nothing')"),
  ).rejects.toThrow();
});
test("read state belongs to the current user and a changed task becomes unread again", async () => {
  const p = await notices(OTHER);
  const n = p.notices.find((n: any) => n.id === "task:task-ready");
  expect(n).toBeTruthy();
  await actor(db, OTHER);
  await db.query("select cockpit_media_notices_seen($1::jsonb)", [
    JSON.stringify([
      { id: n.id, version: n.version },
      { id: "task:task-other", version: "forged" },
    ]),
  ]);
  await owner(db);
  expect(
    (await notices(OTHER)).notices.find((x: any) => x.id === n.id)?.read,
  ).toBe(true);
  expect(
    (await notices()).notices.find((x: any) => x.id === n.id)?.read,
  ).not.toBe(true);
  expect(
    (
      await db.query<any>(
        "select count(*)::int n from cockpit_media_notice_reads where actor_id=$1",
        [OTHER],
      )
    ).rows[0].n,
  ).toBe(1);
  await db.exec(
    `UPDATE cockpit_media_sources SET data=data||'{"title":"Updated task"}'::jsonb WHERE source_id='task-ready';`,
  );
  expect(
    (await notices(OTHER)).notices.find((x: any) => x.id === n.id)?.read,
  ).not.toBe(true);
});
test("unavailable task feed is explicit and direct notice storage stays closed", async () => {
  await db.exec(
    "UPDATE cockpit_media_source_state SET ready=false WHERE table_name='inbox'",
  );
  const p = await notices();
  expect(p.tasksReady).toBe(false);
  expect(p.notices.filter((n: any) => n.kind === "task")).toHaveLength(0);
  for (const role of ["anon", "authenticated"])
    expect(
      (
        await db.query<any>(
          "select has_table_privilege($1,'cockpit_media_notice_reads','SELECT') ok",
          [role],
        )
      ).rows[0].ok,
    ).toBe(false);
  expect(
    (
      await db.query<any>(
        "select has_function_privilege('anon','cockpit_media_client_notices()','EXECUTE') ok",
      )
    ).rows[0].ok,
  ).toBe(false);
  expect(
    (
      await db.query<any>(
        "select relrowsecurity ok from pg_class where relname='cockpit_media_notice_reads'",
      )
    ).rows[0].ok,
  ).toBe(true);
});

test("activity respects explicit client IDs and refuses ambiguous campaign names", async () => {
  await db.exec(`INSERT INTO cockpit_campaigns(client_name,meta_account_id,meta_campaign_id,raw_data) VALUES
    ('Ready','111111','991101','{"campaignName":"Duplicate"}'),
    ('Nothing','333333','991102','{"campaignName":"Duplicate"}'),
    ('Ready','111111','991103','{"campaignName":"Unique"}');`);
  for (const [suffix, name, args] of [
    ["11", "Duplicate", {}],
    ["12", "Unique", { clickupId: "nothing" }],
    ["13", "Unique", {}],
    ["14", "Duplicate", { clickupId: "ready" }],
  ] as const)
    await db.query(
      `INSERT INTO cockpit_media_actions(id,actor_id,operation,campaign_name,request) VALUES($1,$2,'control.setStatus',$3,$4)`,
      [`20000000-0000-4000-8000-0000000000${suffix}`, BUYER, name, { args }],
    );
  await actor(db, OTHER);
  const rows = (await db.query<any>("select cockpit_media_clients('ready') r"))
    .rows[0].r.clients[0].actionHistory;
  const ids = rows.map((x: any) => x.id);
  expect(ids).not.toContain("20000000-0000-4000-8000-000000000011");
  expect(ids).not.toContain("20000000-0000-4000-8000-000000000012");
  expect(ids).toContain("20000000-0000-4000-8000-000000000013");
  expect(ids).toContain("20000000-0000-4000-8000-000000000014");
  expect(
    rows.some(
      (x: any) => x.operation === "launch.discard" && x.state === "recorded",
    ),
  ).toBe(true);
  expect(JSON.stringify(rows)).not.toContain('"request"');
});
test("partial task snapshots never appear complete", async () => {
  await db.exec(
    "UPDATE cockpit_media_source_state SET ready=true,row_count=4 WHERE table_name='inbox'",
  );
  const p = await notices();
  expect(p.tasksReady).toBe(false);
  expect(p.notices.filter((n: any) => n.kind === "task")).toHaveLength(0);
});

test("ambiguous tasks are never assigned to the first matching client", async () => {
  await owner(db);
  await db.exec(
    "INSERT INTO cockpit_media_source_state(table_name,ready,row_count,source_snapshot_at) VALUES('inbox',true,1,'2026-10-24T12:00:00Z') ON CONFLICT(table_name) DO UPDATE SET ready=true,row_count=1,source_snapshot_at=excluded.source_snapshot_at; DELETE FROM cockpit_media_sources WHERE table_name='inbox'; INSERT INTO cockpit_media_sources(table_name,source_id,data,client_names,source_snapshot_at) VALUES('inbox','ambiguous-task','{\"_id\":\"ambiguous-task\",\"taskId\":\"ready\",\"title\":\"Check client identity\"}',ARRAY['Onboarding'],'2026-10-24T12:00:00Z');",
  );
  await actor(db, BUYER);
  const result = (
    await db.query<any>("select cockpit_media_client_notices() r")
  ).rows[0].r;
  const task = result.notices.find((n: any) => n.id === "task:ambiguous-task");
  expect(task.clientId).toBeNull();
  await actor(db, OTHER);
  const scoped = (
    await db.query<any>("select cockpit_media_client_notices() r")
  ).rows[0].r;
  // Ambiguity is checked across the full universe, even for a restricted seat.
  expect(scoped.notices.some((n: any) => n.id === "task:ambiguous-task")).toBe(
    false,
  );
});

test("client service holds fence launches and workers; offboarding needs all recorded checks", async () => {
  await owner(db);
  // The older worker/import migrations are covered by their own complete worker suite.
  // These stubs isolate this migration's wrapper fencing from unrelated queue fixtures.
  await db.exec(`CREATE FUNCTION public.cockpit_media_native_guard(uuid,uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"record":{"client_name":"Stopped"},"campaign":{"meta_account_id":"444444"}}'::jsonb $$;
  CREATE FUNCTION public.cockpit_launch_import_scope(uuid,text,text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"client":"Stopped","account":"444444"}'::jsonb $$;`);
  const sql = migration("20261024172848_media_client_lifecycle.sql");
  await db.exec(sql);
  await db.exec(sql);
  const hardening = migration(
    "20261024175515_media_client_lifecycle_revision_guard.sql",
  );
  await db.exec(hardening);
  await db.exec(hardening);
  for (const role of ["anon", "authenticated"]) {
    expect(
      (
        await db.query<any>(
          "select has_table_privilege($1,'cockpit_client_holds','SELECT') ok",
          [role],
        )
      ).rows[0].ok,
    ).toBe(false);
    expect(
      (
        await db.query<any>(
          "select has_function_privilege($1,'cockpit_client_stop_begin(uuid,uuid,text,jsonb,jsonb)','EXECUTE') ok",
          [role],
        )
      ).rows[0].ok,
    ).toBe(false);
    expect(
      (
        await db.query<any>(
          "select has_function_privilege($1,'cockpit_media_account_scope_before_client_hold(text,text,text,uuid)','EXECUTE') ok",
          [role],
        )
      ).rows[0].ok,
    ).toBe(false);
  }
  await actor(db, OTHER);
  await expect(
    db.query("select cockpit_client_lifecycle_scope('stopped')"),
  ).rejects.toThrow("access list");
  await actor(db, CSM);
  await expect(
    db.query("select cockpit_client_lifecycle_scope('stopped')"),
  ).rejects.toThrow("membership");
  await actor(db, BUYER);
  const s = (
    await db.query<any>("select cockpit_client_lifecycle_scope('stopped') r")
  ).rows[0].r;
  expect(s.accounts).toEqual(["444444"]); // stopping a stopped client is permitted
  await owner(db);
  await db.exec("SET ROLE service_role");
  const id = crypto.randomUUID(),
    args = {
      clickupId: "stopped",
      reason: "Approved full offboarding",
      fingerprint: "test",
    };
  const begin = () =>
    db.query<any>("select cockpit_client_stop_begin($1,$2,$3,$4,$5) r", [
      BUYER,
      id,
      "client.offboard",
      JSON.stringify(args),
      JSON.stringify(s),
    ]);
  await begin();
  await expect(begin()).rejects.toThrow("already has an intent");
  await expect(
    db.query("select cockpit_media_native_guard($1,$2)", [
      crypto.randomUUID(),
      crypto.randomUUID(),
    ]),
  ).rejects.toThrow("hold");
  await expect(
    db.query("select cockpit_launch_import_scope($1,'stopped','444444')", [
      BUYER,
    ]),
  ).rejects.toThrow("hold");
  await db.query("select cockpit_client_stop_finish($1,$2)", [
    id,
    JSON.stringify({
      ok: true,
      checkedAt: new Date().toISOString(),
      taskId: "task1",
      unverified: [],
    }),
  ]);
  expect((await begin()).rows[0].r.reused).toBe(true);
  await actor(db, BUYER);
  let h = (
    await db.query<any>("select cockpit_client_lifecycle_scope('stopped') r")
  ).rows[0].r.lifecycle;
  await expect(
    db.query(
      "select cockpit_client_lifecycle_action('stopped',$1,'complete',null,'All checked by the team')",
      [h.revision],
    ),
  ).rejects.toThrow("every offboarding step");
  await expect(
    db.query(
      "select cockpit_client_lifecycle_action('stopped',$1,'release',null,'Release this client hold')",
      [h.revision],
    ),
  ).rejects.toThrow("admin");
  await expect(
    db.query(
      "select cockpit_client_lifecycle_action('stopped',null,'check','client_access','Confirmed with a missing revision')",
    ),
  ).rejects.toThrow("record changed");
  const afterMissingRevision = (
    await db.query<any>("select cockpit_client_lifecycle_scope('stopped') r")
  ).rows[0].r.lifecycle;
  expect(afterMissingRevision.revision).toBe(h.revision);
  expect(afterMissingRevision.checks).toEqual(h.checks);
  for (const step of [
    "campaigns",
    "client_access",
    "agency_access",
    "connections",
  ]) {
    const r = await db.query<any>(
      "select cockpit_client_lifecycle_action('stopped',$1,'check',$2,'Checked in source, evidence https://example.test/receipt') r",
      [h.revision, step],
    );
    h = r.rows[0].r.lifecycle;
  }
  const stale = h.revision;
  h = (
    await db.query<any>(
      "select cockpit_client_lifecycle_action('stopped',$1,'complete',null,'Confirmed all four source checks') r",
      [h.revision],
    )
  ).rows[0].r.lifecycle;
  expect(h.state).toBe("complete");
  expect(h.checks.agency_access.confirmation).toBe("team");
  await expect(
    db.query(
      "select cockpit_client_lifecycle_action('stopped',$1,'check','client_access','Another valid confirmation')",
      [stale],
    ),
  ).rejects.toThrow("record changed");
  await owner(db);
  await db.exec(
    `UPDATE cockpit_members SET roles=ARRAY['media_buyer','admin'] WHERE auth_user_id='${BUYER}'`,
  );
  await actor(db, BUYER);
  await db.query(
    "select cockpit_client_lifecycle_action('stopped',$1,'release',null,'Client approved the planned relaunch')",
    [h.revision],
  );
  await owner(db);
  await db.exec("SET ROLE service_role");
  await db.query("select cockpit_media_native_guard($1,$2)", [
    crypto.randomUUID(),
    crypto.randomUUID(),
  ]);
  await owner(db);
}, 30000);
