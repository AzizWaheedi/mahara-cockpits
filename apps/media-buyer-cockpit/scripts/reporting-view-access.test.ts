import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

test("internal reporting views deny browser roles while service and token panel continue", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      "create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon, authenticated, service_role; create table public.source_rows(n integer); insert into public.source_rows values(1);",
    );
    const views = [
      "recent_sync_calls",
      "recent_cron_runs",
      "v_panel_spend",
      "v_panel_appointments",
      "v_panel_leads",
      "media_buyer_changes",
    ];
    for (const name of views)
      await db.exec(
        `create view public.${name} as select * from public.source_rows; grant select on public.${name} to anon,authenticated,service_role;`,
      );
    await db.exec(
      "create function public.test_panel(token text) returns integer language sql security definer set search_path='' as $$select case when token='synthetic-token' then (select count(*)::int from public.v_panel_leads) else -1 end$$;",
    );
    await db.exec(
      readFileSync(
        new URL(
          "../../../supabase/migrations/20260926081714_restrict_reporting_view_access.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      for (const name of views)
        await expect(db.query(`select * from public.${name}`)).rejects.toThrow(
          /permission denied/,
        );
      expect(
        (
          await db.query<{ n: number }>(
            "select public.test_panel('synthetic-token') n",
          )
        ).rows[0].n,
      ).toBe(1);
      expect(
        (await db.query<{ n: number }>("select public.test_panel('wrong') n"))
          .rows[0].n,
      ).toBe(-1);
      await db.exec("reset role");
    }
    await db.exec("set role service_role");
    for (const name of views)
      expect(
        (await db.query(`select * from public.${name}`)).rows,
      ).toHaveLength(1);
  } finally {
    await db.close();
  }
});
