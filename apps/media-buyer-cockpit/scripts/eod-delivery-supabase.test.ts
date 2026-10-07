import { describe, expect, test } from "bun:test";
import { cockpitTestDb, migration } from "./lib/cockpitTestDb";

describe("EOD delivery claims and receipts in PostgreSQL (in-memory PGlite)", () => {
  async function setupDb() {
    const db = await cockpitTestDb();
    await db.exec(migration("20260922a_eod_outbox.sql"));
    await db.exec(migration("20260927b_eod_delivery_claims.sql"));
    return db;
  }

  test("real producer retries cannot replace claims; receipts, retries and audits are enforced", async () => {
    const db = await setupDb();
    try {
      await db.exec(migration("20260927b_eod_delivery_claims.sql"));
      await db.exec("set role service_role");
      await db.exec(`insert into eod_outbox(role,day,person,channel,body,tab,row_values)
        values('csm','2026-09-27','Fixture','CHANNEL','Original','CSM','["27-09-2026"]')`);
      const claim = (await db.query<any>("select * from cockpit_claim_eod_outbox('worker',300,1)")).rows[0];
      const receipt = (extras: string) => db.query(`select cockpit_record_eod_receipt($1,'worker',$2::uuid,${extras})`, [claim.id,claim.claim_token]);
      await expect(receipt("p_status=>'sent'")).rejects.toThrow(/Both required/);
      await expect(receipt("p_slack_ts=>'123'")).rejects.toThrow(/send-start/);
      await expect(db.exec(`insert into eod_outbox(role,day,person,channel,body)
        values('csm','2026-09-27','Fixture','OTHER','Overwrite')
        on conflict(role,day,person) do update set body=excluded.body,channel=excluded.channel,status='queued',attempts=0`))
        .rejects.toThrow(/Cannot overwrite/);
      expect((await db.query<any>("select body from eod_outbox")).rows[0].body).toBe("Original");
      await db.query("select cockpit_start_eod_send($1,'worker',$2::uuid,'slack')", [claim.id,claim.claim_token]);
      await expect(db.query("select cockpit_start_eod_send($1,'worker',$2::uuid,'slack')", [claim.id,claim.claim_token]))
        .rejects.toThrow(/already sent or in progress/);
      await expect(receipt("p_status=>'queued'")).rejects.toThrow(/Uncertain delivery/);
      await receipt("p_slack_error=>'Explicit provider rejection',p_status=>'queued'");
      const retried = (await db.query<any>("select * from cockpit_claim_eod_outbox('worker',300,1)")).rows[0];
      expect(retried.claim_token).not.toBe(claim.claim_token);
      expect(retried.slack_started_at).toBeNull();
      await expect(receipt("p_slack_ts=>'late'")).rejects.toThrow(/Fenced/);
      await db.query("select cockpit_start_eod_send($1,'worker',$2::uuid,'sheet')", [retried.id,retried.claim_token]);
      await db.query("select cockpit_record_eod_receipt($1,'worker',$2::uuid,p_sheet_at=>now())", [retried.id,retried.claim_token]);
      await expect(db.query("select cockpit_record_eod_receipt($1,'worker',$2::uuid,p_status=>'sent')", [retried.id,retried.claim_token]))
        .rejects.toThrow(/Both required/);
      await db.query("select cockpit_start_eod_send($1,'worker',$2::uuid,'slack')", [retried.id,retried.claim_token]);
      await db.query("select cockpit_record_eod_receipt($1,'worker',$2::uuid,p_slack_ts=>'123.45',p_status=>'sent')", [retried.id,retried.claim_token]);
      await expect(db.exec("update eod_outbox set slack_ts=null")).rejects.toThrow(/immutable/);
      await expect(db.exec("update eod_outbox set status='queued'")).rejects.toThrow(/Cannot requeue/);
      await db.exec("reset role");
      const audit = (await db.query<any>("select * from cockpit_audit_log where entity_type='eod_outbox'")).rows;
      expect(audit.length).toBeGreaterThan(6);
      expect(audit.every(r => !Object.hasOwn(r.after, "claim_token"))).toBe(true);
      await db.exec("set role authenticated");
      await expect(db.exec("select * from eod_outbox")).rejects.toThrow(/permission denied/);
    } finally { await db.close(); }
  });

  test("claim exclusivity: only one worker claims queued row, concurrent claims return 0", async () => {
    const db = await setupDb();
    try {
      await db.query(`
        insert into public.eod_outbox (role, day, person, channel, body, tab, row_values, status)
        values ('media_buyer', '2026-09-27', 'Sarah Al-Mutawa', 'C123', 'EOD body', 'Media Buyers', '{"date": "2026-09-27"}'::jsonb, 'queued')
      `);

      // Worker 1 claims
      const w1 = await db.query<{ id: number; claim_token: string; status: string }>(
        "select id, claim_token, status from public.cockpit_claim_eod_outbox($1, 300, 10)",
        ["worker-1"]
      );
      expect(w1.rows).toHaveLength(1);
      expect(w1.rows[0].status).toBe("processing");
      expect(w1.rows[0].claim_token).toBeTruthy();

      // Worker 2 attempts concurrent claim
      const w2 = await db.query(
        "select id from public.cockpit_claim_eod_outbox($1, 300, 10)",
        ["worker-2"]
      );
      expect(w2.rows).toHaveLength(0);
    } finally {
      await db.close();
    }
  });

  test("expired receipt rejection: stale lease, wrong worker, or wrong claim token throws", async () => {
    const db = await setupDb();
    try {
      await db.query(`
        insert into public.eod_outbox (role, day, person, channel, body, status)
        values ('csm', '2026-09-27', 'Dina Ezzat', 'C456', 'CSM body', 'queued')
      `);

      const claim = (
        await db.query<{ id: number; claim_token: string }>(
          "select id, claim_token from public.cockpit_claim_eod_outbox('worker-valid', 300, 10)"
        )
      ).rows[0];

      // Wrong worker
      await expect(
        db.query(
          "select public.cockpit_record_eod_receipt($1, 'worker-imposter', $2::uuid, 'ts_123')",
          [claim.id, claim.claim_token]
        )
      ).rejects.toThrow(/Fenced receipt write rejected/);

      // Wrong token
      await expect(
        db.query(
          "select public.cockpit_record_eod_receipt($1, 'worker-valid', gen_random_uuid(), 'ts_123')",
          [claim.id]
        )
      ).rejects.toThrow(/Fenced receipt write rejected/);

      // Expired lease
      await db.query(
        "update public.eod_outbox set lease_expires_at = now() - interval '1 second' where id = $1",
        [claim.id]
      );
      await expect(
        db.query(
          "select public.cockpit_record_eod_receipt($1, 'worker-valid', $2::uuid, 'ts_123')",
          [claim.id, claim.claim_token]
        )
      ).rejects.toThrow(/Fenced receipt write rejected/);
    } finally {
      await db.close();
    }
  });

  test("durable send intent and crash-recovery: interrupted send triggers reconciliation_needed", async () => {
    const db = await setupDb();
    try {
      await db.query(`
        insert into public.eod_outbox (role, day, person, channel, body, status)
        values ('video_editor', '2026-09-27', 'Karim Abdelrahman', 'C789', 'VE body', 'queued')
      `);

      const claim = (
        await db.query<{ id: number; claim_token: string }>(
          "select id, claim_token from public.cockpit_claim_eod_outbox('worker-crash', 10, 10)"
        )
      ).rows[0];

      // Durable send-start intent recorded before external send
      await db.query(
        "select public.cockpit_start_eod_send($1, 'worker-crash', $2::uuid, 'slack')",
        [claim.id, claim.claim_token]
      );

      // Process dies, lease expires
      await db.query(
        "update public.eod_outbox set lease_expires_at = now() - interval '5 seconds' where id = $1",
        [claim.id]
      );

      // Next worker runs claim -> row must NOT be auto-resent; must become reconciliation_needed
      const nextClaim = await db.query(
        "select id from public.cockpit_claim_eod_outbox('worker-next', 300, 10)"
      );
      expect(nextClaim.rows).toHaveLength(0);

      const row = (
        await db.query<{ status: string; reconciliation_needed: boolean; reconcile_reason: string }>(
          "select status, reconciliation_needed, reconcile_reason from public.eod_outbox where id = $1",
          [claim.id]
        )
      ).rows[0];
      expect(row.reconciliation_needed).toBe(true);
      expect(row.status).toBe("failed");
      expect(row.reconcile_reason).toContain("Interrupted send");
    } finally {
      await db.close();
    }
  });

  test("clean crash before send can be reclaimed cleanly after lease expiry", async () => {
    const db = await setupDb();
    try {
      await db.query(`
        insert into public.eod_outbox (role, day, person, channel, body, status)
        values ('csm', '2026-09-27', 'Clean Crash', 'C456', 'Clean body', 'queued')
      `);

      const claim = (
        await db.query<{ id: number }>(
          "select id from public.cockpit_claim_eod_outbox('worker-clean-crash', 10, 10)"
        )
      ).rows[0];

      // Process dies BEFORE calling cockpit_start_eod_send (no external side effects started)
      await db.query(
        "update public.eod_outbox set lease_expires_at = now() - interval '5 seconds' where id = $1",
        [claim.id]
      );

      // Next worker can reclaim cleanly
      const nextClaim = await db.query<{ id: number; attempts: number }>(
        "select id, attempts from public.cockpit_claim_eod_outbox('worker-next', 300, 10)"
      );
      expect(nextClaim.rows).toHaveLength(1);
      expect(nextClaim.rows[0].id).toBe(claim.id);
      expect(nextClaim.rows[0].attempts).toBe(2);
    } finally {
      await db.close();
    }
  });

  test("exhausted retries terminalize as failed", async () => {
    const db = await setupDb();
    try {
      await db.query(`
        insert into public.eod_outbox (role, day, person, channel, body, status, attempts)
        values ('editor', '2026-09-27', 'Exhausted Person', 'C000', 'Body', 'queued', 4)
      `);

      // 5th attempt claimed
      const claim = (
        await db.query<{ id: number; attempts: number }>(
          "select id, attempts from public.cockpit_claim_eod_outbox('worker-5', 10, 10)"
        )
      ).rows[0];
      expect(claim.attempts).toBe(5);

      // Lease expires
      await db.query(
        "update public.eod_outbox set lease_expires_at = now() - interval '5 seconds' where id = $1",
        [claim.id]
      );

      // Next claim should not pick it up; row terminalizes as failed
      const nextClaim = await db.query(
        "select id from public.cockpit_claim_eod_outbox('worker-next', 300, 10)"
      );
      expect(nextClaim.rows).toHaveLength(0);

      const status = (
        await db.query<{ status: string }>("select status from public.eod_outbox where id = $1", [claim.id])
      ).rows[0].status;
      expect(status).toBe("failed");
    } finally {
      await db.close();
    }
  });

  test("partial receipts: sheet_at preserved, only marks sent when both receipts confirmed", async () => {
    const db = await setupDb();
    try {
      await db.query(`
        insert into public.eod_outbox (role, day, person, channel, body, tab, row_values, status)
        values ('media_buyer', '2026-09-27', 'Partial Test', 'C111', 'Body', 'Media Buyers', '{"date": "2026-09-27"}'::jsonb, 'queued')
      `);

      const claim = (
        await db.query<{ id: number; claim_token: string }>(
          "select id, claim_token from public.cockpit_claim_eod_outbox('worker-partial', 300, 10)"
        )
      ).rows[0];

      // Sheet append succeeds
      await db.query("select public.cockpit_start_eod_send($1, 'worker-partial', $2::uuid, 'sheet')", [claim.id, claim.claim_token]);
      await db.query(
        "select public.cockpit_record_eod_receipt($1, 'worker-partial', $2::uuid, null, null, now(), null, 'processing')",
        [claim.id, claim.claim_token]
      );

      // Still in processing because Slack is not sent yet
      let row = (await db.query<{ status: string; sheet_at: string; slack_ts: string | null }>(
        "select status, sheet_at, slack_ts from public.eod_outbox where id = $1",
        [claim.id]
      )).rows[0];
      expect(row.status).toBe("processing");
      expect(row.sheet_at).toBeTruthy();
      expect(row.slack_ts).toBeNull();

      // Slack send succeeds
      await db.query("select public.cockpit_start_eod_send($1, 'worker-partial', $2::uuid, 'slack')", [claim.id, claim.claim_token]);
      await db.query(
        "select public.cockpit_record_eod_receipt($1, 'worker-partial', $2::uuid, 'ts_9999', null, null, null, 'sent')",
        [claim.id, claim.claim_token]
      );

      row = (await db.query<{ status: string; sheet_at: string; slack_ts: string }>(
        "select status, sheet_at, slack_ts from public.eod_outbox where id = $1",
        [claim.id]
      )).rows[0];
      expect(row.status).toBe("sent");
      expect(row.slack_ts).toBe("ts_9999");
      expect(row.sheet_at).toBeTruthy();
    } finally {
      await db.close();
    }
  });

  test("audit logging and producer protection trigger", async () => {
    const db = await setupDb();
    try {
      await db.query(`
        insert into public.eod_outbox (role, day, person, channel, body, status)
        values ('editor', '2026-09-27', 'Audit Person', 'C999', 'Body', 'queued')
      `);

      const claim = (
        await db.query<{ id: number; claim_token: string }>(
          "select id, claim_token from public.cockpit_claim_eod_outbox('worker-audit', 300, 10)"
        )
      ).rows[0];

      // Verify cockpit_audit_log recorded the claim
      const auditRows = await db.query<{ action: string; entity_id: string }>(
        "select action, entity_id from public.cockpit_audit_log where entity_type = 'eod_outbox' and entity_id = $1",
        [String(claim.id)]
      );
      expect(auditRows.rows.length).toBeGreaterThan(0);
      expect(auditRows.rows.some(r => r.action === "insert")).toBe(true);
      expect(auditRows.rows.some(r => r.action === "update")).toBe(true);

      // Producer upsert protection: cannot re-queue while processing
      await expect(
        db.query("update public.eod_outbox set status = 'queued', claimed_by = null where id = $1", [claim.id])
      ).rejects.toThrow(/Cannot requeue an in-flight EOD/);
    } finally {
      await db.close();
    }
  });

  test("security: anon and authenticated cannot execute claim RPCs", async () => {
    const db = await setupDb();
    try {
      for (const role of ["anon", "authenticated"]) {
        await db.exec(`set role ${role}`);
        await expect(
          db.query("select * from public.cockpit_claim_eod_outbox('hack', 300, 1)")
        ).rejects.toThrow(/permission denied/);
        await db.exec("reset role");
      }
    } finally {
      await db.close();
    }
  });
});
