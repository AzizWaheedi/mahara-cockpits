// bun test supabase/functions/hiring-sync
// The hiring migration on an isolated PGlite engine: no live database. pg_cron,
// pg_net and the vault are stubbed so the schedule statements can be counted.
import { expect, test } from "bun:test";
import { cockpitTestDb, migration, owner } from "../../../apps/media-buyer-cockpit/scripts/lib/cockpitTestDb";

const STUBS = `
  CREATE SCHEMA cron; CREATE SCHEMA net; CREATE SCHEMA vault;
  CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text);
  CREATE FUNCTION cron.schedule(n text, s text, c text) RETURNS bigint LANGUAGE sql AS
    $$ INSERT INTO cron.job(jobname, schedule, command) VALUES (n, s, c) RETURNING jobid $$;
  CREATE FUNCTION cron.unschedule(id bigint) RETURNS boolean LANGUAGE sql AS
    $$ DELETE FROM cron.job WHERE jobid = id RETURNING true $$;
`;

async function hiringDb() {
  const db = await cockpitTestDb();
  await db.exec(STUBS);
  await db.exec(migration("20260921e_tap_charges.sql"));
  await db.exec(migration("20260922a_cockpit_hiring.sql"));
  await db.exec(migration("20260922b_hiring_agent.sql"));
  await db.exec(migration("20261009c_hiring_native.sql"));
  return db;
}

test("the run lock admits one run per job and frees an expired lease", async () => {
  const db = await hiringDb();
  try {
    const claim = async (job: string) =>
      (await db.query<{ id: string | null }>(`SELECT public.cockpit_hiring_claim_run($1,'schedule',null,false) AS id`, [job])).rows[0].id;
    const first = await claim("mirror");
    expect(first).toBeTruthy();
    expect(await claim("mirror")).toBeNull();
    expect(await claim("engine")).toBeTruthy();
    await db.query(`UPDATE public.cockpit_hiring_runs SET lease_expires_at = now() - interval '1 minute' WHERE id = $1`, [first]);
    expect(await claim("mirror")).toBeTruthy();
    expect((await db.query<{ status: string }>(`SELECT status FROM public.cockpit_hiring_runs WHERE id = $1`, [first])).rows[0].status).toBe("expired");
    await expect(db.query(`SELECT public.cockpit_hiring_claim_run('send','schedule',null,false)`)).rejects.toThrow("Unknown hiring job");
  } finally {
    await db.close();
  }
});

test("a draft can be claimed for sending once; refusals and failures do not hold it", async () => {
  const db = await hiringDb();
  try {
    await db.exec(`
      INSERT INTO public.cockpit_hiring_candidates(id, contact_id, location_id, role, role_label, pipeline_id, stage, stage_name)
      VALUES ('opp-1','c-1','loc','media-buyer','Media buyer','p','loom','Loom request');
      INSERT INTO public.cockpit_hiring_events(candidate_id, role, kind, action, detail, ok)
      VALUES ('opp-1','media-buyer','action','loom_request','Drafted, not sent (x).', false);
    `);
    const send = (status: string) =>
      db.query(`INSERT INTO public.cockpit_hiring_sends(event_id, candidate_id, actor_email, status) VALUES (1,'opp-1','aziz@maharamedia.com',$1)`, [status]);
    await send("refused");
    await send("failed");
    await send("claimed");
    await expect(send("claimed")).rejects.toThrow();
    await expect(send("sent")).rejects.toThrow();
    await send("refused");
  } finally {
    await db.close();
  }
});

test("only the service role reaches the new tables", async () => {
  const db = await hiringDb();
  try {
    await db.exec("SET ROLE authenticated");
    for (const t of ["cockpit_hiring_runs", "cockpit_hiring_provider_health", "cockpit_hiring_sends"])
      await expect(db.query(`SELECT * FROM public.${t}`)).rejects.toThrow("permission");
    await expect(db.query(`SELECT public.cockpit_hiring_claim_run('mirror','schedule',null,false)`)).rejects.toThrow("permission");
    await owner(db);
    await db.exec("SET ROLE service_role");
    await db.query(`SELECT public.cockpit_hiring_claim_run('mirror','schedule',null,false)`);
    await db.query(`INSERT INTO public.cockpit_hiring_provider_health(provider, method, resource, phase) VALUES ('gohighlevel','GET','/contacts/','intent')`);
    await db.query(`INSERT INTO public.cockpit_sync_state(key, ok) VALUES ('hiring-sync:mirror', true)`);
    await db.query(`INSERT INTO public.cockpit_audit_log(action, entity_type) VALUES ('hiring.setEngine','cockpit_hiring_meta')`);
    await owner(db);
  } finally {
    await db.close();
  }
});

test("the schedule is the Convex one, and running the migration again does not double it", async () => {
  const db = await hiringDb();
  try {
    await db.exec(migration("20261009c_hiring_native.sql"));
    const jobs = (await db.query<{ jobname: string; schedule: string; command: string }>(
      `SELECT jobname, schedule, command FROM cron.job ORDER BY jobname`,
    )).rows;
    expect(jobs.map(j => [j.jobname, j.schedule])).toEqual([
      ["mahara-hiring-engine", "6-59/10 * * * *"],
      ["mahara-hiring-intake", "8,38 * * * *"],
      ["mahara-hiring-mirror", "1-59/10 * * * *"],
    ]);
    for (const j of jobs) {
      expect(j.command).toContain("functions/v1/hiring-sync");
      expect(j.command).toContain("cockpit_sync_secret");
      expect(j.command).toContain(`'job','${j.jobname.replace("mahara-hiring-", "")}'`);
    }
  } finally {
    await db.close();
  }
});
