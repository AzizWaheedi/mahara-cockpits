import { describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { actor, cockpitTestDb, member, migration } from "./lib/cockpitTestDb";
import { buildProjections } from "../src/lib/projectionsModel";
import { projectionSourceSchema } from "../src/lib/projectionsSchema";
import {
  bookTeamProjectionCall,
  readTeamProjections,
  editTeamProjections,
} from "../src/lib/teamProjectionsClient";
import type { SupabaseClient } from "@supabase/supabase-js";

function projectionClient(db: PGlite): SupabaseClient {
  return {
    auth: {
      async getSession() {
        const { rows } = await db.query<{ id: string | null }>("SELECT auth.uid() AS id");
        return { data: { session: rows[0].id ? { user: { id: rows[0].id } } : null }, error: null };
      },
    },
    async rpc(name: string, args: Record<string, unknown>) {
      try {
        const result = name === "cockpit_csm_projection_read"
          ? await db.query<{ result: unknown }>("SELECT public.cockpit_csm_projection_read($1,$2) AS result", [args.p_for_email, args.p_meeting_id])
          : name === "cockpit_csm_projection_edit"
            ? await db.query<{ result: unknown }>("SELECT public.cockpit_csm_projection_edit($1::jsonb,$2) AS result", [JSON.stringify(args.p_edit), args.p_meeting_id])
            : null;
        if (!result) throw new Error(`Unexpected RPC ${name}`);
        return { data: result.rows[0].result, error: null };
      } catch (error) {
        return { data: null, error };
      }
    },
  } as unknown as SupabaseClient;
}

async function getServerDates(db: PGlite) {
  const res = await db.query<{
    current_sunday: string;
    renewal_alpha: string;
    renewal_beta: string;
    today: string;
  }>(`
    SELECT
      to_char((now() AT TIME ZONE 'Asia/Kuwait')::date - extract(dow from (now() AT TIME ZONE 'Asia/Kuwait'))::integer, 'YYYY-MM-DD') AS current_sunday,
      to_char((now() AT TIME ZONE 'Asia/Kuwait')::date + 21, 'YYYY-MM-DD') AS renewal_alpha,
      to_char((now() AT TIME ZONE 'Asia/Kuwait')::date + 28, 'YYYY-MM-DD') AS renewal_beta,
      to_char((now() AT TIME ZONE 'Asia/Kuwait')::date, 'YYYY-MM-DD') AS today
  `);
  return res.rows[0];
}

async function setupPrerequisiteSchema(db: PGlite) {
  async function canonical(name: string, pattern: RegExp) {
    const definition = migration(name).match(pattern)?.[0];
    if (!definition) throw new Error(`Canonical definition missing: ${name}: ${pattern}`);
    await db.exec(definition);
  }
  async function table(name: string, relation: string) {
    await canonical(name, new RegExp(`create table if not exists public\\.${relation}\\s*\\([\\s\\S]*?\\n\\);`, "i"));
    await db.exec(`ALTER TABLE public.${relation} ENABLE ROW LEVEL SECURITY`);
  }
  // The pre-existing Triage clients relation is outside cockpit migrations;
  // this unused FK target needs only its actual UUID identity in isolation.
  await db.exec("CREATE TABLE public.clients(id uuid PRIMARY KEY)");
  for (const relation of ["cockpit_campaigns", "cockpit_ads", "cockpit_client_profiles", "cockpit_decisions"]) {
    await table("20260923o_cockpit_domain_tables.sql", relation);
  }
  await db.exec(migration("20260926a_cockpit_decision_details.sql"));
  await table("20260923p_cockpit_actions_and_rpcs.sql", "cockpit_plan_items");
  await table("20260921c_bank_statements.sql", "cockpit_client_payments");
  await table("20260923a_client_billing.sql", "cockpit_billing_accounts");
  await table("20260927i_cockpit_finance_refresh.sql", "cockpit_finance_refreshes");
  await canonical("20260927i_cockpit_finance_refresh.sql", /ALTER TABLE public\.cockpit_client_payments ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;/);
  for (const relation of ["team_people", "team_meetings", "team_meeting_people"]) {
    await table("20260922b_team_meetings.sql", relation);
  }
  await table("20260923d_team_meetings_screen.sql", "team_changes");
  await canonical("20260923d_team_meetings_screen.sql", /alter table public\.team_meeting_people\s+add column[\s\S]*?;/i);
  await canonical("20260927d_team_meetings_v5.sql", /alter table public\.team_meetings\s+add column[\s\S]*?;[ \t]*\r?$/im);
  await canonical("20260927g_renewals_projections_meeting.sql", /alter table public\.team_meetings add column if not exists embed text;/i);
  await canonical("20260927g_renewals_projections_meeting.sql", /alter table public\.team_meetings\s+add constraint team_meetings_embed_check[\s\S]*?;/i);
  for (const relation of ["cockpit_churn_departures", "cockpit_churn_months", "cockpit_churn_log"]) {
    await table("20261001a_churn_tracker.sql", relation);
  }
  await table("20260922a_eod_outbox.sql", "eod_outbox");
  await table("20260920b_wa_inbox.sql", "wa_threads");
  await db.exec(migration("20260926m_cockpit_csm_state.sql"));
  await db.exec(migration("20260927v_csm_read_models.sql"));
  await db.exec(migration("20261004a_csm_churn_projections.sql"));
  await db.exec(migration("20261004b_csm_providers.sql"));
}

async function seedTestMeeting(
  db: PGlite,
  meetingId: string,
  personId: string,
  email: string,
  embed: "cs-projections" | "cs-daily" | null = "cs-projections",
  active = true,
  removed = false,
) {
  await db.exec("RESET ROLE");
  await db.query(
    `INSERT INTO public.team_meetings(id, title, embed, active)
     VALUES($1, 'Sunday Projections', $2, $3)
     ON CONFLICT(id) DO UPDATE SET embed = EXCLUDED.embed, active = EXCLUDED.active`,
    [meetingId, embed, active],
  );
  await db.query(
    `INSERT INTO public.team_people(id, name, email, active)
     VALUES($1, 'Team Member', $2, true)
     ON CONFLICT(id) DO UPDATE SET email = EXCLUDED.email, active = EXCLUDED.active`,
    [personId, email],
  );
  await db.query(
    `INSERT INTO public.team_meeting_people(meeting_id, person_id, part, removed)
     VALUES($1, $2, 'required', $3)
     ON CONFLICT(meeting_id, person_id) DO UPDATE SET removed = EXCLUDED.removed`,
    [meetingId, personId, removed],
  );
}

async function seedCanonicalSourceState(
  db: PGlite,
  dates: { renewal_alpha: string; renewal_beta: string },
) {
  await db.exec("RESET ROLE");

  const snapRes = await db.query<{ snap_at: string; epoch_ms: number }>(
    "SELECT now()::text AS snap_at, (extract(epoch from now()) * 1000)::bigint AS epoch_ms",
  );
  const { snap_at, epoch_ms } = snapRes.rows[0];

  const clientAlpha = {
    _id: "client-alpha-1",
    taskId: "task-alpha-1",
    name: "Client Alpha",
    stage: "Active",
    liveDays: 25,
    firstWin: true,
    renewalDate: dates.renewal_alpha,
    renewalTracked: true,
    bucket: "management",
    syncedAt: epoch_ms,
  };
  const clientBeta = {
    _id: "client-beta-2",
    taskId: "task-beta-2",
    name: "Client Beta",
    stage: "Active",
    liveDays: 45,
    firstWin: true,
    renewalDate: dates.renewal_beta,
    renewalTracked: true,
    bucket: "management",
    syncedAt: epoch_ms,
  };

  // Seed source records adhering to CHECK(data ? '_id' AND data->>'_id'=source_id)
  await db.query(
    `INSERT INTO public.cockpit_csm_sources(table_name, source_id, client_names, data, source_snapshot_at)
     VALUES ('clients', 'client-alpha-1', ARRAY['Client Alpha'], $1::jsonb, $3::timestamptz),
            ('clients', 'client-beta-2', ARRAY['Client Beta'], $2::jsonb, $3::timestamptz)
     ON CONFLICT (table_name, source_id) DO UPDATE SET
       client_names = EXCLUDED.client_names,
       data = EXCLUDED.data,
       source_snapshot_at = EXCLUDED.source_snapshot_at`,
    [JSON.stringify(clientAlpha), JSON.stringify(clientBeta), snap_at],
  );

  // Set all source_state tables to ready with exact matching snapshot and row counts
  await db.query(
    `UPDATE public.cockpit_csm_source_state
     SET ready = true,
         source_snapshot_at = $1::timestamptz,
         row_count = CASE WHEN table_name = 'clients' THEN 2 ELSE 0 END`,
    [snap_at],
  );

  // Client profile mirror rows
  await db.query(`
    INSERT INTO public.cockpit_client_profiles(client_name, notes, kpi, overview)
    VALUES ('Client Alpha', '[]'::jsonb, '{"month":{"leads":23,"booked":7,"closes":2}}'::jsonb, '{"language":"en"}'::jsonb),
           ('Client Beta', '[]'::jsonb, '{}'::jsonb, '{"language":"en"}'::jsonb)
    ON CONFLICT (client_name) DO NOTHING
  `);
}

describe("CSM Growth & Projections Supabase Contracts", () => {
  test("meeting access control: active confirmed participant vs forbidden/unverified/revoked/nonparticipant", async () => {
    const db = await cockpitTestDb();
    try {
      await setupPrerequisiteSchema(db);
      const dates = await getServerDates(db);
      await seedCanonicalSourceState(db, dates);

      const csmId = "11111111-1111-4111-8111-111111111111";
      const csmEmail = "csm@maharamedia.com";
      await member(db, csmId, csmEmail, ["csm"], true, true);
      await seedTestMeeting(db, "meeting-sunday", "person-csm-1", csmEmail, "cs-projections", true, false);

      // 1. Confirmed active participant succeeds
      await actor(db, csmId);
      const res = await db.query<{ cockpit_csm_projection_read: unknown }>(
        "SELECT public.cockpit_csm_projection_read(NULL, 'meeting-sunday')",
      );
      expect(res.rows.length).toBe(1);
      const parsed = projectionSourceSchema.parse(res.rows[0].cockpit_csm_projection_read);
      expect(parsed.email).toBe(csmEmail);

      // 2. Forbidden unverified user
      const unverifiedId = "22222222-2222-4222-8222-222222222222";
      const unverifiedEmail = "unverified@maharamedia.com";
      await member(db, unverifiedId, unverifiedEmail, ["csm"], true, false);
      await seedTestMeeting(db, "meeting-sunday", "person-unv-2", unverifiedEmail, "cs-projections", true, false);
      await actor(db, unverifiedId);
      await expect(
        db.query("SELECT public.cockpit_csm_projection_read(NULL, 'meeting-sunday')"),
      ).rejects.toThrow(/Active verified membership required/);

      // 3. Revoked / inactive member
      const revokedId = "33333333-3333-4333-8333-333333333333";
      const revokedEmail = "revoked@maharamedia.com";
      await member(db, revokedId, revokedEmail, ["csm"], false, true);
      await seedTestMeeting(db, "meeting-sunday", "person-rev-3", revokedEmail, "cs-projections", true, false);
      await actor(db, revokedId);
      await expect(
        db.query("SELECT public.cockpit_csm_projection_read(NULL, 'meeting-sunday')"),
      ).rejects.toThrow(/Active verified membership required/);

      // 4. Nonparticipant active member
      const strangerId = "44444444-4444-4444-8444-444444444444";
      const strangerEmail = "stranger@maharamedia.com";
      await member(db, strangerId, strangerEmail, ["csm"], true, true);
      await actor(db, strangerId);
      await expect(
        db.query("SELECT public.cockpit_csm_projection_read(NULL, 'meeting-sunday')"),
      ).rejects.toThrow(/The projections are for this meeting's participants/);

      // 5. Removed participant (mp.removed = true)
      await seedTestMeeting(db, "meeting-sunday", "person-stranger-4", strangerEmail, "cs-projections", true, true);
      await expect(
        db.query("SELECT public.cockpit_csm_projection_read(NULL, 'meeting-sunday')"),
      ).rejects.toThrow(/The projections are for this meeting's participants/);

      // 6. Meeting with non-projection embed
      await seedTestMeeting(db, "meeting-general", "person-csm-1", csmEmail, null, true, false);
      await actor(db, csmId);
      await expect(
        db.query("SELECT public.cockpit_csm_projection_read(NULL, 'meeting-general')"),
      ).rejects.toThrow(/This meeting does not show client success projections/);
    } finally {
      await db.close();
    }
  });

  test("cross-client isolation: scoped participant sees only assigned clients and cannot touch others", async () => {
    const db = await cockpitTestDb();
    try {
      await setupPrerequisiteSchema(db);
      const dates = await getServerDates(db);
      await seedCanonicalSourceState(db, dates);

      const scopedId = "55555555-5555-4555-8555-555555555555";
      const scopedEmail = "scoped@maharamedia.com";
      await db.exec("RESET ROLE");
      await db.query(
        "INSERT INTO auth.users(id, email, email_confirmed_at) VALUES($1, $2, '2026-09-01T00:00:00Z')",
        [scopedId, scopedEmail],
      );
      await db.query(
        "INSERT INTO public.cockpit_members(auth_user_id, email, roles, clients, active) VALUES($1, $2, ARRAY['csm'], ARRAY['Client Alpha'], true)",
        [scopedId, scopedEmail],
      );
      await seedTestMeeting(db, "meeting-scoped", "person-scoped-5", scopedEmail, "cs-projections", true, false);

      await actor(db, scopedId);

      // Read projections: returns Client Alpha, excludes Client Beta
      const readRes = await db.query<{ cockpit_csm_projection_read: unknown }>(
        "SELECT public.cockpit_csm_projection_read(NULL, 'meeting-scoped')",
      );
      const parsed = projectionSourceSchema.parse(readRes.rows[0].cockpit_csm_projection_read);
      expect(parsed.clients.map(c => c.name)).toEqual(["Client Alpha"]);

      // Attempting to edit renewal plan for Client Beta fails client isolation
      await expect(
        db.query(
          "SELECT public.cockpit_csm_projection_edit($1, 'meeting-scoped')",
          [JSON.stringify({ kind: "plan", taskId: "task-beta-2", patch: { likelihood: "high" } })],
        ),
      ).rejects.toThrow(/Choose an assigned client/);

      // Attempting to fetch booking context for Client Beta fails client isolation
      await expect(
        db.query(
          "SELECT public.cockpit_csm_projection_booking_context('task-beta-2', 'meeting-scoped')",
        ),
      ).rejects.toThrow(/Choose an assigned client/);

      // Scoped client edit succeeds
      const editRes = await db.query<{ cockpit_csm_projection_edit: unknown }>(
        "SELECT public.cockpit_csm_projection_edit($1, 'meeting-scoped')",
        [JSON.stringify({ kind: "plan", taskId: "task-alpha-1", patch: { likelihood: "high" } })],
      );
      expect(editRes.rows[0].cockpit_csm_projection_edit).toEqual({ ok: true });
      const plan = await projectionClient(db).rpc("cockpit_csm_projection_read", { p_for_email: null, p_meeting_id: "meeting-scoped" });
      const savedFacts = projectionSourceSchema.parse(plan.data).plans.find(row => row.taskId === "task-alpha-1")?.whereTheyAre;
      expect(savedFacts?.map(fact => fact.value)).toEqual(expect.arrayContaining(["23", "7", "2"]));
    } finally {
      await db.close();
    }
  });

  test("founder-only impersonation and options: verified CEO vs regular participant", async () => {
    const db = await cockpitTestDb();
    try {
      await setupPrerequisiteSchema(db);
      const dates = await getServerDates(db);
      await seedCanonicalSourceState(db, dates);

      const csmId = "66666666-6666-4666-8666-666666666666";
      const csmEmail = "csm-bob@maharamedia.com";
      await member(db, csmId, csmEmail, ["csm"], true, true);
      await seedTestMeeting(db, "meeting-impersonation", "person-bob-6", csmEmail, "cs-projections", true, false);

      const ceoId = "77777777-7777-4777-8777-777777777777";
      const ceoEmail = "aziz@maharamedia.com";
      await member(db, ceoId, ceoEmail, ["csm"], true, true);

      // 1. Regular participant cannot open another person's projections
      await actor(db, csmId);
      await expect(
        db.query("SELECT public.cockpit_csm_projection_read('other@maharamedia.com', 'meeting-impersonation')"),
      ).rejects.toThrow(/Only the CEO or an admin opens another person's projections/);

      // 2. Founder can open another person's projections
      await actor(db, ceoId);
      const readRes = await db.query<{ cockpit_csm_projection_read: unknown }>(
        "SELECT public.cockpit_csm_projection_read($1, 'meeting-impersonation')",
        [csmEmail],
      );
      const parsed = projectionSourceSchema.parse(readRes.rows[0].cockpit_csm_projection_read);
      expect(parsed.owner).toBe(csmEmail);
      expect(parsed.canGold).toBe(true);
      expect(parsed.canEditOthers).toBe(true);

      // 3. Regular participant cannot edit another person's projections
      await actor(db, csmId);
      await expect(
        db.query(
          "SELECT public.cockpit_csm_projection_edit($1, 'meeting-impersonation')",
          [JSON.stringify({
            kind: "projection",
            weekStart: dates.current_sunday,
            metric: "resell",
            blood: 2,
            stretch: 4,
            forEmail: "other@maharamedia.com",
          })],
        ),
      ).rejects.toThrow(/Only the CEO or an admin edits another person's projection/);

      // 4. Founder can edit another person's projections
      await actor(db, ceoId);
      const ceoEditRes = await db.query<{ cockpit_csm_projection_edit: unknown }>(
        "SELECT public.cockpit_csm_projection_edit($1, 'meeting-impersonation')",
        [JSON.stringify({
          kind: "projection",
          weekStart: dates.current_sunday,
          metric: "resell",
          blood: 2,
          stretch: 4,
          forEmail: csmEmail,
        })],
      );
      expect(ceoEditRes.rows[0].cockpit_csm_projection_edit).toEqual({ ok: true });

      // 5. Gold standard: regular participant fails, founder succeeds
      await db.exec("RESET ROLE");
      const planRes = await db.query<{ id: string }>(
        `INSERT INTO public.cockpit_csm_renewal_plans(task_id, client_name, renewal_date, data)
         VALUES('task-alpha-1', 'Client Alpha', $1::date, '{"callRecordingUrl":"https://recordings.example.com/1"}')
         RETURNING id`,
        [dates.renewal_alpha],
      );
      const planId = planRes.rows[0].id;

      await actor(db, csmId);
      await expect(
        db.query(
          "SELECT public.cockpit_csm_projection_edit($1, 'meeting-impersonation')",
          [JSON.stringify({ kind: "gold", planId, on: true })],
        ),
      ).rejects.toThrow(/Only the CEO marks gold-standard calls/);

      await actor(db, ceoId);
      const goldRes = await db.query<{ cockpit_csm_projection_edit: unknown }>(
        "SELECT public.cockpit_csm_projection_edit($1, 'meeting-impersonation')",
        [JSON.stringify({ kind: "gold", planId, on: true })],
      );
      expect(goldRes.rows[0].cockpit_csm_projection_edit).toEqual({ ok: true });
    } finally {
      await db.close();
    }
  });

  test("persisted audited projection edit and readback with meeting team changes", async () => {
    const db = await cockpitTestDb();
    try {
      await setupPrerequisiteSchema(db);
      const dates = await getServerDates(db);
      await seedCanonicalSourceState(db, dates);

      const csmId = "88888888-8888-4888-8888-888888888888";
      const csmEmail = "csm-audit@maharamedia.com";
      await member(db, csmId, csmEmail, ["csm"], true, true);
      await seedTestMeeting(db, "meeting-audited", "person-audit-8", csmEmail, "cs-projections", true, false);

      await actor(db, csmId);

      const client = projectionClient(db);
      const saved = await editTeamProjections(client, {
        meetingId: "meeting-audited",
        edit: {
          kind: "projection",
          weekStart: dates.current_sunday,
          metric: "renewal",
          blood: 3,
          stretch: 6,
        },
      });
      expect(saved.thisWeek.rows.find(row => row.metric === "renewal")).toMatchObject({ blood: 3, stretch: 6 });

      // Verify audit row exists in cockpit_audit_log
      await db.exec("RESET ROLE");
      const auditLog = await db.query<{ entity_type: string; actor_email: string; action: string }>(
        "SELECT entity_type, actor_email, action FROM public.cockpit_audit_log WHERE entity_type = 'cockpit_csm_projections'",
      );
      expect(auditLog.rows).toEqual([{ entity_type: "cockpit_csm_projections", actor_email: csmEmail, action: "insert" }]);

      // Verify meeting change recorded in team_changes
      const teamChanges = await db.query<{ meeting_id: string; by_whom: string; what: string }>(
        "SELECT meeting_id, by_whom, what FROM public.team_changes WHERE meeting_id = 'meeting-audited'",
      );
      expect(teamChanges.rows.length).toBe(1);
      expect(teamChanges.rows[0].by_whom).toBe(csmEmail);
      expect(teamChanges.rows[0].what).toContain("projection");

      await actor(db, csmId);
      const refreshed = await readTeamProjections(client, { meetingId: "meeting-audited" });
      expect(refreshed.thisWeek.rows.find(row => row.metric === "renewal")).toMatchObject({ blood: 3, stretch: 6 });
    } finally {
      await db.close();
    }
  });

  test("exact empty/missing ledger semantics: disclosures preserved with no fake zeroes or timestamps", async () => {
    const db = await cockpitTestDb();
    try {
      await setupPrerequisiteSchema(db);
      const dates = await getServerDates(db);
      await seedCanonicalSourceState(db, dates);

      const csmId = "99999999-9999-4999-8999-999999999999";
      const csmEmail = "csm-ledger@maharamedia.com";
      await member(db, csmId, csmEmail, ["csm"], true, true);
      await seedTestMeeting(db, "meeting-ledger", "person-ledger-9", csmEmail, "cs-projections", true, false);

      // No rows in cockpit_finance_refreshes
      await actor(db, csmId);
      const readRes = await db.query<{ cockpit_csm_projection_read: unknown }>(
        "SELECT public.cockpit_csm_projection_read(NULL, 'meeting-ledger')",
      );
      const source = projectionSourceSchema.parse(readRes.rows[0].cockpit_csm_projection_read);

      // Feed semantics
      expect(source.feed.okAt).toBeNull();
      expect(source.feed.ledgerSyncedAt).toBeNull();
      expect(source.feed.error).toBe("The billing ledger has not completed a native refresh");
      expect(source.feed.payments).toEqual([]);

      // Model calculation semantics
      const page = buildProjections(source);
      expect(page.billing.okAt).toBeNull();
      expect(page.billing.ledgerSyncedAt).toBeNull();
      expect(page.billing.error).toBe("The billing ledger has not completed a native refresh");

      const cashStripRow = page.thisWeek.rows.find(r => r.metric === "cash");
      expect(cashStripRow).toBeDefined();
      expect(cashStripRow?.actual).toBeNull();
      expect(cashStripRow?.actualFrom).toBe("missing");
      expect(cashStripRow?.manualAllowed).toBe(true);
      expect(cashStripRow?.note).toContain("The billing ledger could not be read");
    } finally {
      await db.close();
    }
  });

  test("teamProjectionsClient: canonical booking requestId idempotency and account switch guard", async () => {
    let callCount = 0;
    const recordedRequestIds: string[] = [];
    let currentUserId = "user-alice";

    const mockClient = {
      auth: {
        getSession: async () => ({
          data: { session: { user: { id: currentUserId } } },
          error: null,
        }),
      },
      functions: {
        invoke: async (fn: string, options: { body: { requestId: string; operation: string } }) => {
          callCount++;
          recordedRequestIds.push(options.body.requestId);
          if (callCount === 1) {
            // First call fails with transient error
            return {
              data: { ok: false, error: "Network timeout" },
              error: new Error("Network timeout"),
            };
          }
          // Second call succeeds
          return {
            data: {
              ok: true,
              when: "2026-10-10T14:00:00+03:00",
              title: "Results and strategy review: Client Alpha",
              eventId: "ghl-evt-123",
              receiptId: "rcpt-123",
            },
            error: null,
          };
        },
      },
    } as unknown as SupabaseClient;

    const bookingArgs = {
      meetingId: "meeting-1",
      taskId: "task-alpha-1",
      day: "2026-10-10",
      time: "14:00",
      minutes: 30,
    };

    // 1. Initial attempt fails
    await expect(bookTeamProjectionCall(mockClient, bookingArgs)).rejects.toThrow(/Network timeout/);
    expect(callCount).toBe(1);

    // 2. Retry with same arguments reuses same canonical requestId
    const confirmed = await bookTeamProjectionCall(mockClient, bookingArgs);
    expect(confirmed.ok).toBe(true);
    expect(callCount).toBe(2);
    expect(recordedRequestIds[1]).toBe(recordedRequestIds[0]);

    // 3. Late response after account switch is rejected
    const delayedClient = {
      auth: {
        getSession: async () => ({
          data: { session: { user: { id: currentUserId } } },
          error: null,
        }),
      },
      functions: {
        invoke: async () => {
          // Account switches while request is in flight
          currentUserId = "user-bob";
          return {
            data: {
              ok: true,
              when: "2026-10-10T14:00:00+03:00",
              title: "Results and strategy review: Client Alpha",
              eventId: "ghl-evt-456",
              receiptId: "rcpt-456",
            },
            error: null,
          };
        },
      },
    } as unknown as SupabaseClient;

    await expect(
      bookTeamProjectionCall(delayedClient, {
        meetingId: "meeting-1",
        taskId: "task-alpha-1",
        day: "2026-10-10",
        time: "15:00",
      }),
    ).rejects.toThrow(/User session changed; prior response discarded/);
  });

  test("read response from a prior account is discarded", async () => {
    let currentUserId = "user-alice";
    const sampleSourceData = {
      today: "2026-10-04",
      owner: "alice@maharamedia.com",
      email: "alice@maharamedia.com",
      canGold: false,
      canEditOthers: false,
      clients: [],
      plans: [],
      projections: [],
      appointments: [],
      profiles: [],
      decisions: [],
      feed: { okAt: null, ledgerSyncedAt: null, error: null, payments: [], accounts: [] },
    };

    // Account switch guard on read
    const switchingClient = {
      auth: {
        getSession: async () => {
          const id = currentUserId;
          currentUserId = "user-charlie";
          return {
            data: { session: { user: { id } } },
            error: null,
          };
        },
      },
      rpc: async () => ({ data: sampleSourceData, error: null }),
    } as unknown as SupabaseClient;

    await expect(
      readTeamProjections(switchingClient, { meetingId: "meeting-1" }),
    ).rejects.toThrow(/User session changed; prior response discarded/);
  });
});
