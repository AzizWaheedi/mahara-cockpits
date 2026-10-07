import type { PGlite as Db } from "../apps/media-buyer-cockpit/node_modules/@electric-sql/pglite";
import { describe, expect, it } from "bun:test";
import { nativeFeedDb } from "./lib/nativeFeedDb";
import { migration, owner } from "../apps/media-buyer-cockpit/scripts/lib/cockpitTestDb";
import { createHash, randomUUID } from "node:crypto";

async function fixture() {
  const db = await nativeFeedDb();
  const definition = migration("20260922a_cockpit_identity_audit_issue_reports.sql")
    .match(/CREATE TABLE IF NOT EXISTS public\.cockpit_issue_reports \([\s\S]*?\n\);/)?.[0];
  if (!definition) throw new Error("Canonical issue-report schema missing");
  await db.exec(definition);
  return db;
}

const SCOPES = [
  "cockpit_media_sources",
  "cockpit_media_source_state",
  "cockpit_csm_sources",
  "cockpit_csm_source_state",
  "cockpit_creative_sources",
  "cockpit_creative_source_state",
  "cockpit_runtime_imports",
  "cockpit_campaigns",
  "cockpit_ads",
  "cockpit_media_daily_stats",
  "cockpit_media_booking_events",
  "cockpit_media_feed_state",
  "cockpit_native_stills",
  "cockpit_native_mirror_owners",
  "cockpit_client_profiles",
  "cockpit_csm_client_overrides",
  "cockpit_offboard_dismissals",
  "cockpit_eod_reports",
  "cockpit_decisions",
  "cockpit_daily_checks",
  "cockpit_issue_reports",
  "cockpit_members",
  "cockpit_plan_items",
  "cockpit_team_status",
  "cockpit_team_status_state",
  "cockpit_metric_days",
  "cockpit_client_billing_days",
  "cockpit_csm_client_preferences",
  "cockpit_csm_hot_rows",
  "cockpit_csm_loose_dismissals",
  "cockpit_csm_money_goals",
  "cockpit_csm_projections",
  "cockpit_csm_renewal_plans",
  "cockpit_media_call_briefs",
  "cockpit_wa_thread_captures",
  "cockpit_wa_draft_history",
  "cockpit_audit_log",
];

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function service(db: Db) {
  await db.exec("RESET ROLE; SET ROLE service_role");
}

async function claim(db: Db) {
  return (
    await db.query<{ r: { run_id: string; lease_token: string } }>(
      "SELECT public.cockpit_native_media_claim($1) r",
      [randomUUID()]
    )
  ).rows[0].r;
}

async function getInventory(db: Db) {
  return (
    await db.query<{ r: { tables: Record<string, unknown> } }>(
      "SELECT public.cockpit_native_bootstrap_inventory() r"
    )
  ).rows[0].r;
}

async function getFingerprints(db: Db) {
  return (
    await db.query<{
      r: { version: number; project_ref: string; tables: Record<string, { n: number; sha256: string }> };
    }>("SELECT public.cockpit_native_bootstrap_fingerprints() r")
  ).rows[0].r;
}

async function sendPublish(db: Db, c: { run_id: string; lease_token: string }, p: Record<string, unknown>) {
  const pSha = sha256(JSON.stringify(p));
  return (
    await db.query<{ r: { status: string; run_id: string } }>(
      "SELECT public.cockpit_native_bootstrap_publish($1,$2,$3,$4) r",
      [c.run_id, c.lease_token, p, pSha]
    )
  ).rows[0].r;
}

function makeBillingRow(sourceId: string, clientName = "Client A", ltv = 123.5) {
  const source = {
    _id: sourceId,
    taskId: `task-${sourceId}`,
    name: clientName,
    stage: "Active",
    mrrUsd: 100,
    ltvUsd: ltv,
    currency: "USD",
    paymentPlan: "Monthly",
    churnDate: null,
    syncedAt: 1790298000000,
  };
  const data = {
    ...Object.fromEntries(
      [
        "next_payment_usd",
        "next_payment_date",
        "signup_date",
        "launch_date",
        "paused_on",
        "next_renewal_date",
        "payment_method",
        "contract_status",
        "churn_reason",
        "churn_type",
        "closer",
        "lead_source",
      ].map((field) => [field, null])
    ),
    day: "2026-09-25",
    clickup_task_id: source.taskId,
    client_name: source.name,
    stage: source.stage,
    mrr_usd: source.mrrUsd,
    ltv_usd: source.ltvUsd,
    source_currency: source.currency,
    payment_plan: source.paymentPlan,
    churn_date: null,
    captured_at: "2026-09-25T01:00:00.000000Z",
    source_deployment: "legacy-mb",
    source_id: source._id,
    source_record: source,
  };
  return {
    source,
    row: {
      source_id: source._id,
      data,
      ledger_data: data,
      client_names: [clientName],
      action: "insert",
    },
  };
}

describe("Native bootstrap fingerprints and compact publish", () => {
  it("counts all 37 scopes and validates version, project_ref and SHA256 hashes", async () => {
    const db = await fixture();
    try {
      await db.exec(migration("20261007f_native_bootstrap_fingerprints.sql"));
      await service(db);

      const fp = await getFingerprints(db);
      expect(fp.version).toBe(1);
      expect(fp.project_ref).toBe("bldgtotkfmhoxmlzowdx");

      const tableNames = Object.keys(fp.tables).sort();
      expect(tableNames.length).toBe(37);
      expect(tableNames).toEqual([...SCOPES].sort());

      for (const name of SCOPES) {
        const entry = fp.tables[name];
        expect(typeof entry.n).toBe("number");
        expect(typeof entry.sha256).toBe("string");
        expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
      }
    } finally {
      await db.close();
    }
  });

  it("enforces role permissions with SET ROLE service_role and denied roles", async () => {
    const db = await fixture();
    try {
      await db.exec(migration("20261007f_native_bootstrap_fingerprints.sql"));

      for (const role of ["anon", "authenticated"]) {
        await db.exec(`RESET ROLE; SET ROLE ${role}`);
        await expect(
          db.query("SELECT public.cockpit_native_bootstrap_fingerprints()")
        ).rejects.toMatchObject({ code: "42501" });
      }

      await service(db);
      const fp = await getFingerprints(db);
      expect(fp.version).toBe(1);
    } finally {
      await db.close();
    }
  });

  it("is idempotent when migration is applied repeatedly", async () => {
    const db = await fixture();
    try {
      const migSql = migration("20261007f_native_bootstrap_fingerprints.sql");
      await db.exec(migSql);
      await db.exec(migSql);

      await service(db);
      const fp = await getFingerprints(db);
      expect(fp.version).toBe(1);
    } finally {
      await db.close();
    }
  });

  it("fails fast if any expected relation is missing", async () => {
    const db = await fixture();
    try {
      await db.exec("DROP TABLE public.cockpit_wa_draft_history CASCADE;");
      await db.exec(migration("20261007f_native_bootstrap_fingerprints.sql"));
      await service(db);

      await expect(getFingerprints(db)).rejects.toThrow(/missing from database schema/);
    } finally {
      await db.close();
    }
  });

  it("executes an original full plan successfully", async () => {
    const db = await fixture();
    try {
      await db.exec(migration("20261007f_native_bootstrap_fingerprints.sql"));
      await service(db);

      const inv = await getInventory(db);
      const { row } = makeBillingRow("billing-full");
      const fullPlan = {
        project_ref: "bldgtotkfmhoxmlzowdx",
        created_at: new Date().toISOString(),
        scope: ["media-buyer/ceoClientBilling"],
        scope_complete: true,
        blockers: [],
        expected_tables: inv.tables,
        operations: [
          {
            app: "media-buyer",
            table: "ceoClientBilling",
            kind: "durable",
            target: "cockpit_client_billing_days",
            source_sha256: "a".repeat(64),
            table_sha256: "b".repeat(64),
            deployment: "legacy-mb",
            source_snapshot_at: new Date().toISOString(),
            source_count: 1,
            rows: [row],
            retirements: [],
          },
        ],
      };

      const c = await claim(db);
      const receipt = await sendPublish(db, c, fullPlan);
      expect(receipt.status).toBe("bootstrapped");

      await owner(db);
      const res = await db.query<{ clickup_task_id: string }>(
        "SELECT clickup_task_id FROM cockpit_client_billing_days WHERE source_id='billing-full'"
      );
      expect(res.rows[0].clickup_task_id).toBe("task-billing-full");
    } finally {
      await db.close();
    }
  });

  it("executes compact billing insert/adopt, protects unrelated rows, and supports idempotent retry", async () => {
    const db = await fixture();
    try {
      await db.exec(migration("20261007f_native_bootstrap_fingerprints.sql"));
      await owner(db);

      // Pre-seed an unrelated member and unrelated billing record to verify immutability
      await db.exec(
        "INSERT INTO cockpit_client_billing_days(day,clickup_task_id,client_name,captured_at,source_deployment,source_id,ltv_usd) VALUES('2026-09-01','task-unrelated','Unrelated','2026-09-01T00:00:00Z','unrelated-dept','unrelated-id',999.0)"
      );

      await service(db);
      const fp = await getFingerprints(db);
      const { row } = makeBillingRow("billing-compact", "Client B", 250.0);

      const compactPlan = {
        project_ref: "bldgtotkfmhoxmlzowdx",
        created_at: new Date().toISOString(),
        scope: ["media-buyer/ceoClientBilling"],
        scope_complete: true,
        blockers: [],
        expected_table_fingerprints: fp.tables,
        operations: [
          {
            app: "media-buyer",
            table: "ceoClientBilling",
            kind: "durable",
            target: "cockpit_client_billing_days",
            source_sha256: "a".repeat(64),
            table_sha256: "b".repeat(64),
            deployment: "legacy-mb",
            source_snapshot_at: new Date().toISOString(),
            source_count: 1,
            rows: [row],
            retirements: [],
          },
        ],
      };

      const c = await claim(db);
      const receipt = await sendPublish(db, c, compactPlan);
      expect(receipt.status).toBe("bootstrapped");

      // Verify inserted row
      await owner(db);
      const inserted = await db.query<{ ltv_usd: number }>(
        "SELECT ltv_usd::float8 FROM cockpit_client_billing_days WHERE source_id='billing-compact'"
      );
      expect(inserted.rows[0].ltv_usd).toBe(250.0);

      // Verify unrelated business row remains unchanged
      const unrelated = await db.query<{ ltv_usd: number }>(
        "SELECT ltv_usd::float8 FROM cockpit_client_billing_days WHERE source_id='unrelated-id'"
      );
      expect(unrelated.rows[0].ltv_usd).toBe(999.0);

      // Verify saved plan in run ledger stores expected_table_fingerprints and NOT expected_tables
      const runRecord = await db.query<{ plan: { expected_table_fingerprints?: unknown; expected_tables?: unknown } }>(
        "SELECT plan FROM cockpit_native_media_runs WHERE run_id=$1",
        [c.run_id]
      );
      expect(runRecord.rows[0].plan.expected_table_fingerprints).toBeDefined();
      expect(runRecord.rows[0].plan.expected_tables).toBeUndefined();

      // Idempotent retry with exact plan succeeds
      await service(db);
      const retryReceipt = await sendPublish(db, c, compactPlan);
      expect(retryReceipt).toEqual(receipt);
    } finally {
      await db.close();
    }
  });

  it("rejects same-count row replacement and human changes without writes", async () => {
    const db = await fixture();
    try {
      await db.exec(migration("20261007f_native_bootstrap_fingerprints.sql"));
      await owner(db);

      // Seed 1 client billing row
      await db.exec(
        "INSERT INTO cockpit_client_billing_days(day,clickup_task_id,client_name,captured_at,source_deployment,source_id,ltv_usd) VALUES('2026-09-01','task-1','Client 1','2026-09-01T00:00:00Z','legacy-mb','billing-row-1',100.0)"
      );

      await service(db);
      const initialFp = await getFingerprints(db);

      // Test 1: Human edit changes value (same count, different sha256)
      await owner(db);
      await db.exec("UPDATE cockpit_client_billing_days SET ltv_usd=200.0 WHERE source_id='billing-row-1'");
      await service(db);

      const { row } = makeBillingRow("billing-row-2");
      const plan = {
        project_ref: "bldgtotkfmhoxmlzowdx",
        created_at: new Date().toISOString(),
        scope: ["media-buyer/ceoClientBilling"],
        scope_complete: true,
        blockers: [],
        expected_table_fingerprints: initialFp.tables,
        operations: [
          {
            app: "media-buyer",
            table: "ceoClientBilling",
            kind: "durable",
            target: "cockpit_client_billing_days",
            source_sha256: "a".repeat(64),
            table_sha256: "b".repeat(64),
            deployment: "legacy-mb",
            source_snapshot_at: new Date().toISOString(),
            source_count: 1,
            rows: [row],
            retirements: [],
          },
        ],
      };

      const c1 = await claim(db);
      await expect(sendPublish(db, c1, plan)).rejects.toThrow(/Bootstrap inventory revision conflict/);
      await db.query("SELECT cockpit_native_media_release($1,$2,$3,$4)", [c1.run_id,c1.lease_token,"expected test conflict",[]]);

      // Verify no write occurred
      await owner(db);
      const unwritten = await db.query(
        "SELECT * FROM cockpit_client_billing_days WHERE source_id='billing-row-2'"
      );
      expect(unwritten.rows.length).toBe(0);

      // Test 2: Same-count replacement (delete row-1, insert row-replaced)
      await service(db);
      const currentFp = await getFingerprints(db);
      await owner(db);
      await db.exec("DELETE FROM cockpit_client_billing_days WHERE source_id='billing-row-1'");
      await db.exec(
        "INSERT INTO cockpit_client_billing_days(day,clickup_task_id,client_name,captured_at,source_deployment,source_id,ltv_usd) VALUES('2026-09-01','task-r','Client R','2026-09-01T00:00:00Z','legacy-mb','billing-replaced',300.0)"
      );
      await service(db);

      const c2 = await claim(db);
      plan.expected_table_fingerprints = currentFp.tables;
      await expect(sendPublish(db, c2, plan)).rejects.toThrow(/Bootstrap inventory revision conflict/);
    } finally {
      await db.close();
    }
  });

  it("rejects omitted, extra, both, or missing maps", async () => {
    const db = await fixture();
    try {
      await db.exec(migration("20261007f_native_bootstrap_fingerprints.sql"));
      await service(db);

      const inv = await getInventory(db);
      const fp = await getFingerprints(db);
      const c = await claim(db);

      const basePlan = {
        project_ref: "bldgtotkfmhoxmlzowdx",
        created_at: new Date().toISOString(),
        scope: ["media-buyer/ceoClientBilling"],
        scope_complete: true,
        blockers: [],
        operations: [],
      };

      // 1. Both maps provided (ambiguous)
      const bothPlan = {
        ...basePlan,
        expected_tables: inv.tables,
        expected_table_fingerprints: fp.tables,
      };
      await expect(sendPublish(db, c, bothPlan)).rejects.toThrow(/Ambiguous bootstrap inventory/);

      // 2. Omitted table in fingerprint map
      const omittedMap = { ...fp.tables };
      delete omittedMap.cockpit_audit_log;
      const omittedPlan = {
        ...basePlan,
        expected_table_fingerprints: omittedMap,
      };
      await expect(sendPublish(db, c, omittedPlan)).rejects.toThrow(/Bootstrap inventory revision conflict/);

      // 3. Extra table in fingerprint map
      const extraMap = {
        ...fp.tables,
        cockpit_invented_table: { n: 0, sha256: "00".repeat(32) },
      };
      const extraPlan = {
        ...basePlan,
        expected_table_fingerprints: extraMap,
      };
      await expect(sendPublish(db, c, extraPlan)).rejects.toThrow(/Bootstrap inventory revision conflict/);

      // 4. Missing both maps
      await expect(sendPublish(db, c, basePlan)).rejects.toThrow(/Bootstrap inventory missing/);
    } finally {
      await db.close();
    }
  });
});
