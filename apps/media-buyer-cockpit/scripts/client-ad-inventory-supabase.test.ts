import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  new URL(
    "../../../supabase/migrations/20261106125912_client_ad_inventory_coverage.sql",
    import.meta.url,
  ),
  "utf8",
);
let db: PGlite;
const status = async () => {
  const result = await db.query<{
    s: { state: string; [key: string]: unknown };
  }>(
    "select cockpit_budget_inventory_private.coverage_status('example-client') as s",
  );
  return result.rows[0].s;
};
const setup = async () => {
  await db.exec(`
    insert into cockpit_budget_inventory_private.scopes(client_key) values ('example-client');
    insert into cockpit_budget_inventory_private.accounts(client_key, platform, account_key, owner_verified, owner_verifier_kind, owner_evidence_ref, owner_verified_at, owner_verified_until)
      values ('example-client','meta','123456',true,'human','example-owner-review',now(),now()+interval '1 day'),
             ('example-client','tiktok','789012',true,'human','example-owner-review',now(),now()+interval '1 day');
    update cockpit_budget_inventory_private.accounts a set owner_revision=g.revision
      from cockpit_budget_inventory_private.account_generations g
      where a.platform=g.platform and a.account_key=g.account_key;
    insert into cockpit_budget_inventory_private.coverage(client_key, platform, account_key, provider_read_complete, provider_source, read_evidence_ref, observed_at, account_revision)
      select a.client_key,a.platform,a.account_key,true,a.platform,'example-read',now(),g.revision
      from cockpit_budget_inventory_private.accounts a join cockpit_budget_inventory_private.account_generations g using(platform,account_key);
    update cockpit_budget_inventory_private.scopes set all_relevant_platforms_attested=true,
      attested_accounts=(select jsonb_agg(jsonb_build_array(a.platform,a.account_key,g.revision) order by a.platform,a.account_key)
        from cockpit_budget_inventory_private.accounts a join cockpit_budget_inventory_private.account_generations g using(platform,account_key) where a.client_key='example-client'),
      attested_by_kind='human', attested_at=now(), valid_until=now()+interval '1 day', evidence_ref='example-review'
      where client_key='example-client';
  `);
};
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    "create role anon; create role authenticated; create role service_role;",
  );
  await db.exec(migration);
});
beforeEach(async () => {
  await db.exec(
    "truncate cockpit_budget_inventory_private.scopes cascade; truncate cockpit_budget_inventory_private.account_generations; update cockpit_budget_inventory_private.gate set enabled=false;",
  );
});
afterAll(async () => {
  await db.close();
});

test("disabled even with complete fictional evidence; no runtime grants", async () => {
  await setup();
  expect(await status()).toEqual({ state: "disabled" });
  const result = await db.query<{
    role_name: string;
    schema_access: boolean;
    function_access: boolean;
    table_access: boolean;
    generation_access: boolean;
    generation_trigger_access: boolean;
  }>(`
    select role_name, has_schema_privilege(role_name,'cockpit_budget_inventory_private','usage') as schema_access,
      has_function_privilege(role_name,'cockpit_budget_inventory_private.coverage_status(text)','execute') as function_access,
      has_table_privilege(role_name,'cockpit_budget_inventory_private.accounts','select') as table_access,
      has_table_privilege(role_name,'cockpit_budget_inventory_private.account_generations','insert,update,delete,truncate') as generation_access,
      has_function_privilege(role_name,'cockpit_budget_inventory_private.bump_membership_generation()','execute') as generation_trigger_access
    from (values ('anon'), ('authenticated'), ('service_role')) as roles(role_name) order by role_name
  `);
  for (const row of result.rows) {
    expect(row).toMatchObject({
      schema_access: false,
      function_access: false,
      table_access: false,
      generation_access: false,
      generation_trigger_access: false,
    });
  }
  for (const role of ["anon", "authenticated", "service_role"]) {
    await db.exec(`set role ${role}`);
    try {
      await expect(
        db.query(
          "select cockpit_budget_inventory_private.coverage_status('example-client')",
        ),
      ).rejects.toThrow();
    } finally {
      await db.exec("reset role");
    }
  }
});
test("unverified, missing, expired, future and overlong scope are unknown", async () => {
  await db.exec(
    "update cockpit_budget_inventory_private.gate set enabled=true",
  );
  expect((await status()).state).toBe("unknown");
  await setup();
  await db.exec(
    "update cockpit_budget_inventory_private.scopes set all_relevant_platforms_attested=false",
  );
  expect((await status()).state).toBe("unknown");
  await db.exec(
    "update cockpit_budget_inventory_private.scopes set all_relevant_platforms_attested=true, valid_until=now()-interval '1 second'",
  );
  expect((await status()).state).toBe("unknown");
  await db.exec(
    "update cockpit_budget_inventory_private.scopes set attested_at=now()+interval '1 hour', valid_until=now()+interval '2 hours'",
  );
  expect((await status()).state).toBe("unknown");
  await db.exec(
    "update cockpit_budget_inventory_private.scopes set attested_at=now(), valid_until=now()+interval '31 days'",
  );
  expect((await status()).state).toBe("unknown");
});
test("only explicit fresh attested scope can be ready, with a permanent scope warning", async () => {
  await setup();
  await db.exec(
    "update cockpit_budget_inventory_private.gate set enabled=true",
  );
  const s = await status();
  expect(s.state).toBe("ready_for_attested_scope");
  expect(s.accounts).toBe(2);
  expect(s.warning).toContain("omitted accounts or platforms may exist");
  expect(JSON.stringify(s)).not.toContain("123456");
});
test("add, remove or change accounts invalidates the attested scope", async () => {
  await setup();
  await db.exec(
    "update cockpit_budget_inventory_private.gate set enabled=true; insert into cockpit_budget_inventory_private.accounts(client_key,platform,account_key) values ('example-client','google','9876543210')",
  );
  expect((await status()).state).toBe("unknown");
  await db.exec(
    "delete from cockpit_budget_inventory_private.accounts where platform='google'; delete from cockpit_budget_inventory_private.accounts where platform='meta'",
  );
  expect((await status()).state).toBe("unknown");
});
test("unknown ownership, stale and missing provider reads are incomplete", async () => {
  await setup();
  await db.exec(
    "update cockpit_budget_inventory_private.gate set enabled=true; update cockpit_budget_inventory_private.accounts set owner_verified=false where platform='meta'; update cockpit_budget_inventory_private.coverage set observed_at=now()-interval '6 minutes' where platform='tiktok'",
  );
  expect(await status()).toMatchObject({
    state: "incomplete",
    ownership_unverified: 1,
    unread_or_stale: 1,
  });
  await db.exec(
    "delete from cockpit_budget_inventory_private.coverage where platform='meta'; update cockpit_budget_inventory_private.coverage set observed_at=now()+interval '1 minute' where platform='tiktok'",
  );
  expect(await status()).toMatchObject({
    state: "incomplete",
    unread_or_stale: 2,
  });
});
test("incomplete provider response and expired ownership never become complete", async () => {
  await setup();
  await db.exec(
    "update cockpit_budget_inventory_private.gate set enabled=true; update cockpit_budget_inventory_private.coverage set provider_read_complete=false where platform='meta'; update cockpit_budget_inventory_private.accounts set owner_verified_until=now()-interval '1 second' where platform='tiktok'",
  );
  expect(await status()).toMatchObject({
    state: "incomplete",
    ownership_unverified: 1,
    unread_or_stale: 1,
  });
});
test("future and open-ended ownership verification never becomes complete", async () => {
  await setup();
  await db.exec(
    "update cockpit_budget_inventory_private.gate set enabled=true; update cockpit_budget_inventory_private.accounts set owner_verified_at=now()+interval '1 hour' where platform='meta'; update cockpit_budget_inventory_private.accounts set owner_verified_until=now()+interval '31 days' where platform='tiktok'",
  );
  expect(await status()).toMatchObject({
    state: "incomplete",
    ownership_unverified: 2,
  });
});
test("Meta account aliases cannot be stored as a second account", async () => {
  await setup();
  await expect(
    db.exec(
      "insert into cockpit_budget_inventory_private.accounts(client_key,platform,account_key) values ('example-client','meta','act_123456')",
    ),
  ).rejects.toThrow();
  await expect(
    db.exec(
      "insert into cockpit_budget_inventory_private.accounts(client_key,platform,account_key) values ('example-client','meta','0123456')",
    ),
  ).rejects.toThrow();
  await expect(
    db.exec(
      "insert into cockpit_budget_inventory_private.accounts(client_key,platform,account_key) values ('example-client','meta','123456')",
    ),
  ).rejects.toThrow();
});
test("verification flags without account and read evidence remain incomplete", async () => {
  await setup();
  await db.exec(
    "update cockpit_budget_inventory_private.gate set enabled=true; update cockpit_budget_inventory_private.accounts set owner_evidence_ref=null where platform='meta'; update cockpit_budget_inventory_private.coverage set read_evidence_ref=null where platform='tiktok'",
  );
  expect(await status()).toMatchObject({
    state: "incomplete",
    ownership_unverified: 1,
    unread_or_stale: 1,
  });
});
test("an account also attributed to another client is never accepted as exclusive", async () => {
  await setup();
  await db.exec(
    "update cockpit_budget_inventory_private.gate set enabled=true; insert into cockpit_budget_inventory_private.scopes(client_key) values ('another-example'); insert into cockpit_budget_inventory_private.accounts(client_key,platform,account_key) values ('another-example','meta','123456')",
  );
  expect((await status()).state).toBe("unknown");
  await db.exec(`update cockpit_budget_inventory_private.scopes set attested_accounts=(
    select jsonb_agg(jsonb_build_array(a.platform,a.account_key,g.revision) order by a.platform,a.account_key)
    from cockpit_budget_inventory_private.accounts a join cockpit_budget_inventory_private.account_generations g using(platform,account_key)
    where a.client_key='example-client') where client_key='example-client'`);
  expect(await status()).toMatchObject({
    state: "incomplete",
    shared_or_conflicted: 1,
  });
  const index = await db.query<{ indexdef: string }>(
    "select indexdef from pg_indexes where schemaname='cockpit_budget_inventory_private' and indexname='accounts_platform_account_client_idx'",
  );
  expect(index.rows[0].indexdef).toContain("(platform, account_key, client_key)");
});
test("a mismatched provider and an unsupported platform cannot be ready", async () => {
  await setup();
  await db.exec(
    "update cockpit_budget_inventory_private.gate set enabled=true; update cockpit_budget_inventory_private.coverage set provider_source='google' where platform='meta'",
  );
  expect(await status()).toMatchObject({
    state: "incomplete",
    unread_or_stale: 1,
  });
  await db.exec(`update cockpit_budget_inventory_private.coverage set provider_source='meta' where platform='meta';
    insert into cockpit_budget_inventory_private.accounts(client_key,platform,account_key,owner_verified,owner_verifier_kind,owner_evidence_ref,owner_verified_at,owner_verified_until)
      values ('example-client','other','example-other',true,'human','example-owner-review',now(),now()+interval '1 day');
    update cockpit_budget_inventory_private.accounts a set owner_revision=g.revision from cockpit_budget_inventory_private.account_generations g
      where a.platform=g.platform and a.account_key=g.account_key and a.platform='other';
    insert into cockpit_budget_inventory_private.coverage(client_key,platform,account_key,provider_read_complete,provider_source,read_evidence_ref,observed_at,account_revision)
      select a.client_key,a.platform,a.account_key,true,a.platform,'example-read',now(),g.revision
      from cockpit_budget_inventory_private.accounts a join cockpit_budget_inventory_private.account_generations g using(platform,account_key) where a.platform='other';
    update cockpit_budget_inventory_private.scopes set attested_accounts=(
      select jsonb_agg(jsonb_build_array(a.platform,a.account_key,g.revision) order by a.platform,a.account_key)
      from cockpit_budget_inventory_private.accounts a join cockpit_budget_inventory_private.account_generations g using(platform,account_key)
      where a.client_key='example-client') where client_key='example-client';`);
  expect(await status()).toMatchObject({
    state: "incomplete",
    unsupported_platforms: 1,
  });
});
test("evidence pointers reject URLs rather than storing credentials in links", async () => {
  await setup();
  await expect(
    db.exec(
      "update cockpit_budget_inventory_private.scopes set evidence_ref='https://example.invalid/?token=example' where client_key='example-client'",
    ),
  ).rejects.toThrow();
});

test("deleting and recreating an identical account cannot revive the old scope attestation", async () => {
  await setup();
  await db.exec(`update cockpit_budget_inventory_private.gate set enabled=true;
    delete from cockpit_budget_inventory_private.accounts where client_key='example-client' and platform='meta';
    insert into cockpit_budget_inventory_private.accounts(client_key,platform,account_key,owner_verified,owner_verifier_kind,owner_evidence_ref,owner_verified_at,owner_verified_until)
      values ('example-client','meta','123456',true,'human','example-review',now(),now()+interval '1 day');
    update cockpit_budget_inventory_private.accounts a set owner_revision=g.revision from cockpit_budget_inventory_private.account_generations g
      where a.platform=g.platform and a.account_key=g.account_key and a.platform='meta';
    insert into cockpit_budget_inventory_private.coverage(client_key,platform,account_key,provider_read_complete,provider_source,read_evidence_ref,observed_at,account_revision)
      select a.client_key,a.platform,a.account_key,true,a.platform,'example-read',now(),g.revision
      from cockpit_budget_inventory_private.accounts a join cockpit_budget_inventory_private.account_generations g using(platform,account_key) where a.platform='meta';`);
  expect((await status()).state).toBe("unknown");
});

test("conflicts invalidate old attestations and reads even after they resolve or recur", async () => {
  await setup();
  await db.exec(`update cockpit_budget_inventory_private.gate set enabled=true;
    insert into cockpit_budget_inventory_private.scopes(client_key) values ('another-example');
    insert into cockpit_budget_inventory_private.accounts(client_key,platform,account_key) values ('another-example','meta','123456');`);
  expect((await status()).state).toBe("unknown");
  await db.exec("delete from cockpit_budget_inventory_private.accounts where client_key='another-example'");
  expect((await status()).state).toBe("unknown");
  await db.exec(`update cockpit_budget_inventory_private.scopes set attested_accounts=(
    select jsonb_agg(jsonb_build_array(a.platform,a.account_key,g.revision) order by a.platform,a.account_key)
    from cockpit_budget_inventory_private.accounts a join cockpit_budget_inventory_private.account_generations g using(platform,account_key)
    where a.client_key='example-client') where client_key='example-client'`);
  expect(await status()).toMatchObject({state:"incomplete", ownership_unverified:1, unread_or_stale:1});
  await db.exec(`update cockpit_budget_inventory_private.accounts a set owner_revision=g.revision,owner_verified_at=now(),owner_verified_until=now()+interval '1 day'
      from cockpit_budget_inventory_private.account_generations g where a.platform=g.platform and a.account_key=g.account_key and a.platform='meta';
    update cockpit_budget_inventory_private.coverage c set account_revision=g.revision,observed_at=now()
      from cockpit_budget_inventory_private.account_generations g where c.platform=g.platform and c.account_key=g.account_key and c.platform='meta';`);
  expect((await status()).state).toBe("ready_for_attested_scope");
  await db.exec("insert into cockpit_budget_inventory_private.accounts(client_key,platform,account_key) values ('another-example','meta','123456')");
  expect((await status()).state).toBe("unknown");
  await db.exec("delete from cockpit_budget_inventory_private.accounts where client_key='another-example'");
  expect((await status()).state).toBe("unknown");
});

test("a provider read older than ownership verification is incomplete", async () => {
  await setup();
  await db.exec(`update cockpit_budget_inventory_private.gate set enabled=true;
    update cockpit_budget_inventory_private.accounts set owner_verified_at=now() where platform='meta';
    update cockpit_budget_inventory_private.coverage set observed_at=now()-interval '1 minute' where platform='meta'`);
  expect(await status()).toMatchObject({state:"incomplete", unread_or_stale:1});
});

test("rolling back a conflicting membership also rolls back the generation", async () => {
  await setup();
  await db.exec("update cockpit_budget_inventory_private.gate set enabled=true; insert into cockpit_budget_inventory_private.scopes(client_key) values ('another-example')");
  await db.exec("begin; insert into cockpit_budget_inventory_private.accounts(client_key,platform,account_key) values ('another-example','meta','123456'); rollback");
  expect((await status()).state).toBe("ready_for_attested_scope");
});
