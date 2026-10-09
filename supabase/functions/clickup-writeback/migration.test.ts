import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

// Static checks on 20261009f_clickup_writeback_native.sql: the contract between
// the Edge Functions and the database, and the tables it must not write.
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const SQL = read("../../migrations/20261009f_clickup_writeback_native.sql");
const ORIGINAL_SOURCE = read("../../migrations/20261004d_media_native_surface.sql");
const CALLERS = ["./run.ts", "./index.ts", "../tracking-audit/audit.ts", "../tracking-audit/index.ts"].map(read).join("\n");

describe("migration 20261009f", () => {
  it("gives every new table row security, no browser grant and a service-role grant", () => {
    const tables = [...SQL.matchAll(/CREATE TABLE IF NOT EXISTS public\.(\w+)/g)].map(m => m[1]);
    expect(tables.sort()).toEqual([
      "cockpit_clickup_writeback_config",
      "cockpit_clickup_writeback_queue",
      "cockpit_clickup_writeback_runs",
      "cockpit_media_tracking_issues",
      "cockpit_media_tracking_runs",
    ]);
    for (const t of tables) {
      expect(SQL).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
      expect(new RegExp(`REVOKE ALL ON [^;]*public\\.${t}\\b[^;]*FROM PUBLIC,anon,authenticated;`).test(SQL)).toBe(true);
      expect(new RegExp(`GRANT [A-Z,]+ ON [^;]*public\\.${t}\\b[^;]*TO service_role;`).test(SQL)).toBe(true);
    }
  });

  it("defines, locks down and grants to the service role every RPC the functions call", () => {
    const called = [...new Set([...CALLERS.matchAll(/rpc\(\s*"(\w+)"/g)].map(m => m[1]))];
    expect(called.length).toBeGreaterThan(10);
    const revoked = /REVOKE ALL ON FUNCTION([\s\S]*?)FROM PUBLIC,anon,authenticated;/g;
    const revokeText = [...SQL.matchAll(revoked)].map(m => m[1]).join(",");
    const grantText = /GRANT EXECUTE ON FUNCTION([\s\S]*?)TO service_role;/.exec(SQL)?.[1] ?? "";
    for (const name of called) {
      expect(SQL).toContain(`FUNCTION public.${name}(`);
      expect(revokeText).toContain(`public.${name}(`);
      expect(grantText).toContain(`public.${name}(`);
    }
    expect(/GRANT [^;]* TO (anon|authenticated)/.test(SQL)).toBe(false);
  });

  it("never writes a table the native media publication fingerprints", () => {
    // cockpit_native_manifest() hashes these; a write between its read and its publish would fail a cockpit-sync run.
    const manifest = ["cockpit_media_source_state", "cockpit_media_sources", "cockpit_csm_source_state", "cockpit_csm_sources", "cockpit_creative_source_state", "cockpit_creative_sources", "cockpit_campaigns", "cockpit_ads", "cockpit_media_feed_state", "cockpit_media_daily_stats", "cockpit_media_booking_events", "cockpit_offboard_dismissals", "cockpit_client_profiles", "cockpit_csm_client_overrides", "cockpit_native_stills", "cockpit_native_mirror_owners", "cockpit_daily_checks", "cockpit_decisions", "cockpit_media_call_briefs", "cockpit_media_calendar_config"];
    for (const t of manifest) expect(new RegExp(`(INSERT INTO|UPDATE|DELETE FROM|ALTER TABLE)\\s+public\\.${t}\\b`).test(SQL)).toBe(false);
  });

  it("keeps cockpit_media_native_source identical apart from the native tracking branch", () => {
    const fn = (sql: string) => /CREATE OR REPLACE FUNCTION public\.cockpit_media_native_source\([\s\S]*?END \$\$;/.exec(sql)?.[0] ?? "";
    const strip = (s: string) =>
      s
        .replace(/ IF p_table='trackingIssues' AND p_campaign IS NULL THEN[\s\S]*?\n END IF;\n/, "")
        .replace("; native_at timestamptz", "")
        .replace(/\s+/g, " ")
        .trim();
    const mine = fn(SQL);
    expect(mine).toContain("cockpit_media_tracking_issues");
    expect(strip(mine)).toBe(strip(fn(ORIGINAL_SOURCE)));
  });

  it("schedules the four jobs at the Convex times with the vault secret", () => {
    const jobs = [...SQL.matchAll(/cron\.schedule\('([\w-]+)','([^']+)',\$job\$([\s\S]*?)\$job\$\)/g)].map(m => ({ name: m[1], cron: m[2], body: m[3] }));
    expect(jobs.map(j => [j.name, j.cron])).toEqual([
      ["mahara-clickup-writeback-kpi", "5 3-18 * * *"],
      ["mahara-clickup-writeback-log", "*/2 * * * *"],
      ["mahara-clickup-writeback-dosdonts", "35 3-18 * * *"],
      ["mahara-tracking-audit", "30 2 * * *"],
    ]);
    for (const j of jobs) {
      expect(j.body).toContain("name='cockpit_sync_secret'");
      expect(j.body).toContain("timeout_milliseconds := 150000");
    }
    expect(jobs[0].body).toContain("functions/v1/clickup-writeback");
    expect(jobs[3].body).toContain("functions/v1/tracking-audit");
    expect(jobs.map(j => /'job','(\w+)'/.exec(j.body)?.[1])).toEqual(["kpi", "log", "dosdonts", "audit"]);
    // Idempotent: each job is removed before it is scheduled again.
    for (const j of jobs) expect(SQL).toContain(`'${j.name}'`);
    expect(SQL).toMatch(/SELECT cron\.unschedule\(j\.jobid\) FROM cron\.job AS j WHERE j\.jobname IN\(/);
  });

  it("queues only native media buyer decisions and never fails the save", () => {
    expect(SQL).toContain("WHEN (NEW.role='media_buyer' AND NEW.source_system='supabase')");
    expect(SQL).toContain("WHEN (NEW.kind='manual')");
    expect(/EXCEPTION WHEN OTHERS THEN\s+-- Never fail the cockpit save/.test(SQL)).toBe(true);
  });
});
