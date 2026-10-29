/**
 * The two pg_cron moves for ClickUp Business
 * (supabase/migrations/20261029q_clickup_cron_spread.sql,
 * docs/requests/CLICKUP-DOWNGRADE.md section 1.5) on an isolated PostgreSQL.
 *
 * PGlite has no pg_cron, so a stand-in cron.job and cron.alter_job (the live
 * signature, pg_cron 1.6) hold the two jobs as they were read live on
 * 2026-10-29, beside jobs the file must never touch. Nothing here reaches
 * ClickUp or the live database.
 */
import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { migration } from "./lib/cockpitTestDb";

setDefaultTimeout(120_000);

const Q = "20261029q_clickup_cron_spread.sql";

const WATCH = "mahara-comment-watch";
const KPI = "mahara-clickup-writeback-kpi";
const WATCH_CMD =
  "select net.http_post(url := 'https://example.invalid/functions/v1/comment-watch', body := '{}'::jsonb)";
const KPI_CMD =
  "select net.http_post(url := 'https://example.invalid/functions/v1/clickup-writeback', body := jsonb_build_object('job','kpi'))";

/** pg_cron, only as far as the file touches it (alter_job as pg_cron 1.6.4 has it live). */
const CRON = `
CREATE SCHEMA cron;
CREATE TABLE cron.job(jobid bigint PRIMARY KEY, jobname text, schedule text NOT NULL, command text NOT NULL,
  nodename text DEFAULT 'localhost', database text DEFAULT 'postgres', username text DEFAULT 'postgres',
  active boolean DEFAULT true);
CREATE TABLE cron.alter_calls(job_id bigint, schedule text, command text, database text, username text, active boolean);
CREATE FUNCTION cron.alter_job(job_id bigint, schedule text DEFAULT NULL, command text DEFAULT NULL,
  database text DEFAULT NULL, username text DEFAULT NULL, active boolean DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO cron.alter_calls VALUES (job_id, schedule, command, database, username, active);
  UPDATE cron.job j SET schedule = coalesce(alter_job.schedule, j.schedule), command = coalesce(alter_job.command, j.command),
    database = coalesce(alter_job.database, j.database), username = coalesce(alter_job.username, j.username),
    active = coalesce(alter_job.active, j.active)
   WHERE j.jobid = alter_job.job_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Could not find valid entry for job %', job_id; END IF;
END $$;`;

type Job = {
  jobid: number;
  jobname: string;
  schedule: string;
  command: string;
  database: string;
  username: string;
  active: boolean;
};

const LIVE: Array<[number, string, string, string]> = [
  [464, WATCH, "7-59/15 * * * *", WATCH_CMD],
  [459, KPI, "5 3-18 * * *", KPI_CMD],
  // Jobs the file must never touch.
  [
    470,
    "mahara-clickup-writeback-dosdonts",
    "35 3-18 * * *",
    "select 'dosdonts'",
  ],
  [471, "mahara-task-mirror", "*/2 * * * *", "select 'delta'"],
];

let db: PGlite | null = null;
afterEach(async () => {
  await db?.close();
  db = null;
});

async function fresh(withCron = true, jobs = LIVE): Promise<PGlite> {
  db = new PGlite();
  if (withCron) {
    await db.exec(CRON);
    for (const [id, name, schedule, command] of jobs)
      await db.query(
        "INSERT INTO cron.job(jobid, jobname, schedule, command) VALUES ($1,$2,$3,$4)",
        [id, name, schedule, command],
      );
  }
  return db;
}
const jobs = async (d: PGlite) =>
  (
    await d.query<Job>(
      "SELECT jobid::int jobid, jobname, schedule, command, database, username, active FROM cron.job ORDER BY jobid",
    )
  ).rows;
const calls = async (d: PGlite) =>
  (
    await d.query<Record<string, unknown>>(
      "SELECT job_id::int job_id, schedule, command, database, username, active FROM cron.alter_calls",
    )
  ).rows;

/**
 * Applies the file as the deploy does; a refusal rolls its transaction back.
 * Only RAISE NOTICE lines are kept (PGlite also reports to_regclass's DEBUG
 * line for a relation that is not there).
 */
async function apply(
  d: PGlite,
): Promise<{ error: string | null; notices: string[] }> {
  const notices: string[] = [];
  try {
    await d.exec(migration(Q), {
      onNotice: n => {
        if (n.severity === "NOTICE") notices.push(String(n.message));
      },
    });
    return { error: null, notices };
  } catch (e) {
    await d.exec("ROLLBACK");
    return { error: (e as Error).message, notices };
  }
}

describe("20261029q on the jobs as read live", () => {
  test("moves the two schedules and nothing else: commands, users, databases and other jobs untouched", async () => {
    const d = await fresh();
    const before = await jobs(d);
    const { error, notices } = await apply(d);
    expect(error).toBeNull();
    const after = await jobs(d);
    const byName = (rows: Job[], name: string) =>
      rows.find(r => r.jobname === name) as Job;
    expect(byName(after, WATCH).schedule).toBe("13,29,43,59 * * * *");
    expect(byName(after, KPI).schedule).toBe("23 3-18 * * *");
    for (const name of [WATCH, KPI])
      expect({ ...byName(after, name), schedule: "" }).toEqual({
        ...byName(before, name),
        schedule: "",
      });
    expect(after.filter(r => r.jobname !== WATCH && r.jobname !== KPI)).toEqual(
      before.filter(r => r.jobname !== WATCH && r.jobname !== KPI),
    );
    // alter_job by id, the schedule only.
    expect(await calls(d)).toEqual([
      {
        job_id: 464,
        schedule: "13,29,43,59 * * * *",
        command: null,
        database: null,
        username: null,
        active: null,
      },
      {
        job_id: 459,
        schedule: "23 3-18 * * *",
        command: null,
        database: null,
        username: null,
        active: null,
      },
    ]);
    expect(notices).toEqual([
      `${WATCH} moved from "7-59/15 * * * *" to "13,29,43,59 * * * *".`,
      `${KPI} moved from "5 3-18 * * *" to "23 3-18 * * *".`,
    ]);
  });

  test("a second run changes nothing", async () => {
    const d = await fresh();
    expect((await apply(d)).error).toBeNull();
    const once = await jobs(d);
    const second = await apply(d);
    expect(second.error).toBeNull();
    expect(second.notices).toEqual([]);
    expect(await jobs(d)).toEqual(once);
    expect((await calls(d)).length).toBe(2);
  });

  test("one job already moved: only the other moves", async () => {
    const d = await fresh(
      true,
      LIVE.map(j =>
        j[1] === WATCH
          ? ([j[0], j[1], "13,29,43,59 * * * *", j[3]] as typeof j)
          : j,
      ),
    );
    expect((await apply(d)).error).toBeNull();
    expect((await calls(d)).map(c => c.job_id)).toEqual([459]);
    expect((await jobs(d)).find(r => r.jobname === KPI)?.schedule).toBe(
      "23 3-18 * * *",
    );
  });

  test("the minutes stay out of the native cycle's runs and off every */2, */3 and */5 job", () => {
    const watch = [13, 29, 43, 59];
    const kpi = 23;
    // A native run's calls fall anywhere from its start (:00, :15, :30, :45) to
    // its publish 5 to 7 minutes later; its receipts carry only the publish
    // time, so the whole run counts, not the publish minute alone.
    const runs = [0, 15, 30, 45].flatMap(start =>
      Array.from({ length: 8 }, (_, i) => start + i),
    );
    for (const m of [...watch, kpi]) {
      expect(m % 2).toBe(1);
      // The VPS editor desk's ClickUp requests run is */3 and in no ledger.
      expect(m % 3).not.toBe(0);
      expect(m % 5).not.toBe(0);
      expect(runs).not.toContain(m);
    }
    // The editor desk's meetings run is :27, the task mirror's seats read :11.
    for (const m of [27, 11]) expect([...watch, kpi]).not.toContain(m);
    // The old minutes were inside a run: the comment watch at :07, :22, :37 and
    // :52, the kpi at :05.
    for (const m of [7, 22, 37, 52, 5]) expect(runs).toContain(m);
    // The guardian's native-jobs check allows 45 minutes between comment-watch runs.
    const gaps = watch.map((m, i) => (watch[(i + 1) % 4] - m + 60) % 60);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(16);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(14);
  });
});

describe("20261029q refuses and changes nothing", () => {
  test("a schedule that is neither the one read live nor the new one", async () => {
    const d = await fresh(
      true,
      LIVE.map(j =>
        j[1] === KPI ? ([j[0], j[1], "15 3-18 * * *", j[3]] as typeof j) : j,
      ),
    );
    const before = await jobs(d);
    const { error } = await apply(d);
    expect(error).toBe(
      `${KPI} runs at "15 3-18 * * *", not "5 3-18 * * *" as read on 2026-10-29. Nothing was moved; check why it changed and rebase this file`,
    );
    // The comment watch, checked first and movable, did not move either.
    expect(await jobs(d)).toEqual(before);
    expect(await calls(d)).toEqual([]);
  });

  test("a job that is missing, or named twice", async () => {
    let d = await fresh(
      true,
      LIVE.filter(j => j[1] !== KPI),
    );
    let before = await jobs(d);
    expect((await apply(d)).error).toBe(
      `pg_cron has 0 jobs named ${KPI}, not one. Nothing was moved; check cron.job and rebase this file`,
    );
    expect(await jobs(d)).toEqual(before);
    await d.close();
    d = await fresh(true, [
      ...LIVE,
      [480, WATCH, "7-59/15 * * * *", WATCH_CMD],
    ]);
    before = await jobs(d);
    expect((await apply(d)).error).toBe(
      `pg_cron has 2 jobs named ${WATCH}, not one. Nothing was moved; check cron.job and rebase this file`,
    );
    expect(await jobs(d)).toEqual(before);
    expect(await calls(d)).toEqual([]);
  });

  test("no cron schema at all: a notice, nothing else", async () => {
    const d = await fresh(false);
    const { error, notices } = await apply(d);
    expect(error).toBeNull();
    expect(notices).toEqual([
      "No pg_cron here (cron.job is missing), so no ClickUp job was moved.",
    ]);
    expect(
      (
        await d.query<{ n: string | null }>(
          "SELECT to_regnamespace('cron')::text n",
        )
      ).rows[0].n,
    ).toBeNull();
  });
});

describe("the file itself", () => {
  test("one transaction, alter_job by id with the schedule alone, and the header names what was read live", () => {
    const sql = migration(Q);
    expect(sql.trimStart().startsWith("--")).toBe(true);
    expect(sql).toContain("\nBEGIN;\n");
    expect(sql.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(sql).toContain(
      "PERFORM cron.alter_job(job_id := v_id, schedule := m->>'to');",
    );
    expect(sql).not.toMatch(/command\s*:=/);
    expect(sql).not.toMatch(/cron\.(schedule|unschedule)\(/);
    const header = sql.slice(0, sql.indexOf("BEGIN;"));
    expect(header).toContain(
      "jobid 464 mahara-comment-watch          7-59/15 * * * *  command md5 49e2a52769dd3ddfceab803c43e03060",
    );
    expect(header).toContain(
      "jobid 459 mahara-clickup-writeback-kpi  5 3-18 * * *     command md5 39c110fd69f26fd5b58543e63a1ef9ea",
    );
  });
});
