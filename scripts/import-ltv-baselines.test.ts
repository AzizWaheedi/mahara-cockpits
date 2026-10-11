// R4: the SQL that import-ltv-baselines.py --apply sends, run on PGlite (made-up cards; nothing reaches production).
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cockpitTestDb, migration, owner } from "../apps/media-buyer-cockpit/scripts/lib/cockpitTestDb";

function applySql(): string {
  const dir = mkdtempSync(join(tmpdir(), "ltv-import-"));
  try {
    const id = (n: number) => `sh${String(n).padStart(30, "0")}`;
    const ltv = Array.from({ length: 26 }, (_, i) => ({ _id: id(i), at: 1789812249685, date: i === 25 ? "2026-10-07" : "2026-09-19", metric: "money.ltv.card", scope: `client:86card${String(i).padStart(4, "0")}`, value: 1000 + i }));
    const book = [
      { _id: id(900), at: 1790525158774, date: "2026-09-01", metric: "money.book.projected", scope: "company", value: 14332 },
      { _id: id(901), at: 1790525158774, date: "2026-09-01", metric: "money.book.collected", scope: "company", value: 4068 },
    ];
    const src = join(dir, "source.json");
    writeFileSync(src, JSON.stringify({ deployment: "adorable-seahorse-418", ltv, book }));
    const code = `import importlib.util,json,sys
spec=importlib.util.spec_from_file_location('m',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
rows=m.plan_rows(m.validate(json.load(open(sys.argv[2]))))
print(m.apply_sql(rows,m.plan_sha(rows),'source-sha','28 of 28 equal the mirror'))`;
    const run = spawnSync("python3", ["-I", "-c", code, new URL("./import-ltv-baselines.py", import.meta.url).pathname, src], { encoding: "utf8" });
    if (run.status !== 0) throw new Error(run.stderr);
    return run.stdout;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("--apply inserts the 28 points with provenance and one audit row; a second run inserts nothing and adds no audit row", async () => {
  const db = await cockpitTestDb();
  try {
    const core = migration("20260919_cockpit_core.sql");
    await db.exec(core.match(/create table if not exists public\.cockpit_metric_days \([\s\S]*?\n\);/i)![0]);
    await db.exec(`alter table public.cockpit_metric_days add column source_deployment text, add column source_id text, add column source_record jsonb;
      create unique index cockpit_metric_days_source_identity on public.cockpit_metric_days(source_deployment, source_id) where source_id is not null;`);
    await owner(db);
    // A point the worker wrote already stays as it was.
    await db.exec("insert into public.cockpit_metric_days(day,metric,scope,value) values('2026-09-19','money.ltv.card','client:86card0000',777)");
    const sql = applySql();
    await db.exec(sql);
    const n = (await db.query<{ n: number }>("select count(*)::int n from public.cockpit_metric_days where source_deployment='adorable-seahorse-418'")).rows[0].n;
    expect(n).toBe(27);
    expect((await db.query<{ v: number }>("select value v from public.cockpit_metric_days where scope='client:86card0000'")).rows[0].v).toBe(777);
    const book = (await db.query<{ metric: string; value: number; captured_at: Date }>("select metric, value, captured_at from public.cockpit_metric_days where scope='company' order by metric")).rows;
    expect(book.map(b => [b.metric, b.value])).toEqual([["money.book.collected", 4068], ["money.book.projected", 14332]]);
    expect(new Date(book[0].captured_at).toISOString()).toBe("2026-09-27T16:05:58.774Z");
    const record = (await db.query<{ r: any }>("select source_record r from public.cockpit_metric_days where scope='client:86card0025'")).rows[0].r;
    expect(record).toMatchObject({ date: "2026-10-07", value: 1025 });
    const audit = (await db.query<{ after: any; metadata: any; actor_email: string }>("select after, metadata, actor_email from public.cockpit_audit_log where action='ltv.baseline.import'")).rows;
    expect(audit.length).toBe(1);
    expect(audit[0].after.inserted).toBe(27);
    expect(audit[0].actor_email).toBe("claude-for:aziz@maharamedia.com");
    expect(audit[0].metadata).toMatchObject({ script: "scripts/import-ltv-baselines.py", source_deployment: "adorable-seahorse-418", planned: 28, cross_check: "28 of 28 equal the mirror" });

    await db.exec(sql);
    expect((await db.query<{ n: number }>("select count(*)::int n from public.cockpit_metric_days")).rows[0].n).toBe(28);
    expect((await db.query<{ n: number }>("select count(*)::int n from public.cockpit_audit_log where action='ltv.baseline.import'")).rows[0].n).toBe(1);
  } finally {
    await db.close();
  }
}, 30_000);
