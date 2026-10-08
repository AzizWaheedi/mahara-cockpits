import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "bun:test";
import type { PGlite as Db } from "../apps/media-buyer-cockpit/node_modules/@electric-sql/pglite";
import { migration } from "../apps/media-buyer-cockpit/scripts/lib/cockpitTestDb";
import { nativeFeedDb } from "./lib/nativeFeedDb";

test("native run audits reference immutable plans without copying payloads or lease tokens", async () => {
  const db = await nativeFeedDb();
  try {
    const humanRows = ["human", "import", "financial"].map(source_system => ({
      action: "audit.preserve", entity_type: "client", entity_id: `preserve:${source_system}`,
      actor_email: "reviewer@example.test", source_app: "media-buyer", source_system,
      before: { note: "before" }, after: { note: "retain this row" },
    }));
    for (const row of humanRows) await db.query(
      "INSERT INTO cockpit_audit_log(action,entity_type,entity_id,actor_email,source_app,source_system,before,after) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [row.action, row.entity_type, row.entity_id, row.actor_email, row.source_app, row.source_system, row.before, row.after],
    );
    const preserved = await db.query("SELECT id,action,entity_type,entity_id,actor_email,source_app,source_system,before,after FROM cockpit_audit_log WHERE entity_id LIKE 'preserve:%' ORDER BY id");
    const next = new URL("../supabase/migrations/20261008d_native_audit_payloads.sql", import.meta.url);
    if (existsSync(fileURLToPath(next))) await db.exec(readFileSync(next, "utf8"));
    expect((await db.query("SELECT id,action,entity_type,entity_id,actor_email,source_app,source_system,before,after FROM cockpit_audit_log WHERE entity_id LIKE 'preserve:%' ORDER BY id")).rows).toEqual(preserved.rows);

    const runId = randomUUID();
    const leaseToken = randomUUID();
    const plan = { producer: "media-core", version: 1, payload: "x".repeat(512_000) };
    const planSha = createHash("sha256").update(JSON.stringify(plan)).digest("hex");
    await db.query("INSERT INTO cockpit_native_media_runs(run_id,lease_token,status,lease_expires_at) VALUES($1,$2,'claimed',now()+interval '2 minutes')", [runId, leaseToken]);
    await db.query("UPDATE cockpit_native_media_runs SET status='published',published_at=now(),plan_sha=$2,plan=$3,receipt=$4,updated_at=now() WHERE run_id=$1", [runId, planSha, plan, { status: "published", run_id: runId, plan_sha: planSha }]);

    const ledger = (await db.query<{ plan: typeof plan; plan_sha: string }>("SELECT plan,plan_sha FROM cockpit_native_media_runs WHERE run_id=$1", [runId])).rows[0];
    expect(ledger).toEqual({ plan, plan_sha: planSha });

    const audits = (await db.query<{ action: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null }>("SELECT action,before,after FROM cockpit_audit_log WHERE entity_type='cockpit_native_media_runs' AND entity_id=$1 ORDER BY id", [runId])).rows;
    expect(audits.map(row => row.action).sort()).toEqual(["insert", "update"]);
    const encoded = JSON.stringify(audits);
    expect(encoded.length).toBeLessThan(8_000);
    expect(encoded).not.toContain("x".repeat(100));
    expect(encoded).not.toContain(leaseToken);
    const publishedAudit = audits.find(row => row.action === "update")!;
    expect(publishedAudit.before?.status).toBe("claimed");
    expect(publishedAudit.after?.status).toBe("published");
    expect(publishedAudit.after?.run_id).toBe(runId);
    expect(publishedAudit.after?.plan_sha).toBe(planSha);
    expect(publishedAudit.after?.plan_ref).toEqual({ schema: "public", table: "cockpit_native_media_runs", column: "plan", run_id: runId, plan_sha: planSha });
    expect(publishedAudit.after?.receipt_ref).toEqual({ schema: "public", table: "cockpit_native_media_runs", column: "receipt", run_id: runId, plan_sha: planSha });
    expect(publishedAudit.after?.published_at).toBeDefined();
    expect(publishedAudit.after?.lease_expires_at).toBeDefined();
    expect(publishedAudit.after?.error).toBeNull();

    const failedRun = randomUUID();
    const failedLease = randomUUID();
    await db.query("INSERT INTO cockpit_native_media_runs(run_id,lease_token,status,lease_expires_at) VALUES($1,$2,'claimed',now()+interval '2 minutes')", [failedRun, failedLease]);
    await db.query("UPDATE cockpit_native_media_runs SET status='failed',error='Sanitized failure',updated_at=now() WHERE run_id=$1", [failedRun]);
    const failedAudit = (await db.query<{ before: Record<string, unknown>; after: Record<string, unknown> }>("SELECT before,after FROM cockpit_audit_log WHERE entity_type='cockpit_native_media_runs' AND entity_id=$1 AND action='update'", [failedRun])).rows[0];
    expect(failedAudit.before.status).toBe("claimed");
    expect(failedAudit.after.status).toBe("failed");
    expect(failedAudit.after.error).toBe("Sanitized failure");
    expect(failedAudit.after.lease_expires_at).toBeDefined();
    expect(JSON.stringify(failedAudit)).not.toContain(failedLease);

    const still = { key: "audit-test", payload: "keep full non-run audit" };
    await db.query("INSERT INTO cockpit_native_stills(key,data) VALUES($1,$2)", [still.key, still]);
    const stillAudit = (await db.query<{ after: unknown }>("SELECT after FROM cockpit_audit_log WHERE entity_type='cockpit_native_stills' AND entity_id=$1", [still.key])).rows[0];
    expect(stillAudit.after).toEqual({ key: still.key, data: still, updated_at: expect.any(String) });

  } finally {
    await db.close();
  }
});
