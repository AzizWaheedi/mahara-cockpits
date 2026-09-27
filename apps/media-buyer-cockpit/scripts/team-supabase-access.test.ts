import { describe, expect, it } from "bun:test";
import { actor, cockpitTestDb, member, migration, owner } from "./lib/cockpitTestDb";

describe("Team meetings Supabase RLS and access gates", () => {
  it("enforces cockpit_has_active_seat() strictly across team_* tables", async () => {
    const db = await cockpitTestDb();
    try {
      await db.exec("CREATE FUNCTION public.is_editor() RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;");
      await db.exec(migration("20260922b_team_meetings.sql"));
      await db.exec(migration("20260923d_team_meetings_screen.sql"));
      await db.exec(migration("20260927d_team_meetings_v5.sql"));
      await db.exec(migration("20260927e_team_meeting_series.sql"));
      await db.exec(migration("20260927x_team_meetings_access.sql"));

      // 2. Insert fixture meeting as owner (service_role / postgres)
      await owner(db);
      await db.exec(`
        INSERT INTO public.team_people(id, name, email, active)
        VALUES('tester-1', 'Tester One', 'tester@maharamedia.com', true);

        INSERT INTO public.team_meetings(id, title, purpose, cadence, active, managed)
        VALUES('weekly-sync', 'Weekly Sync', 'Align the team on goals and week priorities', 'weekly', true, 'cockpit');
      `);

      // 3. Anonymous user is denied
      await actor(db, null);
      await expect(db.query("SELECT * FROM public.team_meetings")).rejects.toThrow();

      // 4. User without cockpit membership is denied
      const strangerId = "00000000-0000-4000-8000-000000000099";
      await owner(db);
      await db.query("INSERT INTO auth.users(id, email, email_confirmed_at) VALUES($1, $2, now())", [
        strangerId,
        "stranger@outside.invalid",
      ]);
      await actor(db, strangerId);
      const strangerRows = await db.query("SELECT * FROM public.team_meetings");
      expect(strangerRows.rows.length).toBe(0);

      // 5. Inactive cockpit member is denied
      const inactiveId = "00000000-0000-4000-8000-000000000098";
      await member(db, inactiveId, "inactive@maharamedia.com", ["media_buyer"], false, true);
      await actor(db, inactiveId);
      const inactiveRows = await db.query("SELECT * FROM public.team_meetings");
      expect(inactiveRows.rows.length).toBe(0);

      // 6. Confirmed, active cockpit member CAN read team meetings
      const activeMemberId = "00000000-0000-4000-8000-000000000001";
      await member(db, activeMemberId, "tester@maharamedia.com", ["media_buyer"], true, true);
      await actor(db, activeMemberId);
      const memberRows = await db.query<{ id: string; title: string }>("SELECT id, title FROM public.team_meetings");
      expect(memberRows.rows.length).toBeGreaterThanOrEqual(1);
      expect(memberRows.rows.some(r => r.id === "weekly-sync" && r.title === "Weekly Sync")).toBe(true);

      // 7. Confirmed, active member can write to team_changes
      await db.query(
        "INSERT INTO public.team_changes(meeting_id, by_whom, what) VALUES($1, $2, $3)",
        ["weekly-sync", "tester@maharamedia.com", "tested team access"]
      );
      const changeRows = await db.query("SELECT what FROM public.team_changes WHERE meeting_id='weekly-sync'");
      expect(changeRows.rows.length).toBe(1);
      expect(changeRows.rows[0].what).toBe("tested team access");
    } finally {
      await db.close();
    }
  });
});
