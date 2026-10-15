// R6: the SQL in scripts/ops/cockpit-feedback-scan.SKILL.md (the scheduled scan's prompt) runs as written.
// Made-up rows; PGlite only.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { cockpitTestDb, migration, owner } from "../apps/media-buyer-cockpit/scripts/lib/cockpitTestDb";

const skill = readFileSync(new URL("./ops/cockpit-feedback-scan.SKILL.md", import.meta.url), "utf8");
const blocks = [...skill.matchAll(/```sql\n([\s\S]*?)```/g)].map(m => m[1]);

test("the prompt has no Convex door left", () => {
  expect(skill).not.toMatch(/npx convex run|ceo\/migrate|tsc --noEmit -p convex/);
  expect(skill).toContain("composio execute SUPABASE_BETA_RUN_SQL_QUERY -d @");
  expect(skill).toContain("< /dev/null");
  expect(blocks.length).toBe(2);
});

test("the read and the state change run; each change leaves one audit row with before and after", async () => {
  const db = await cockpitTestDb();
  try {
    await db.exec(migration("20260921f_cockpit_feedback.sql"));
    await owner(db);
    await db.exec("insert into public.cockpit_feedback(kind,text,status,created_by) values ('bug','The Money tab crashes','queued','aziz@maharamedia.com'),('change','Rename a tile','dispatched','aziz@maharamedia.com'),('change','Later','done','aziz@maharamedia.com')");
    const open = (await db.query<{ id: number; status: string }>(blocks[0])).rows;
    expect(open.map(r => r.status)).toEqual(["queued", "dispatched"]);

    const change = (id: number, status: string, note: string) =>
      blocks[1].replaceAll("ID", String(id)).replaceAll("NEW_STATUS", status).replaceAll("NOTE", note.replaceAll("'", "''"));
    await db.exec(change(open[0].id, "in_progress", "Reproducing it on the harness"));
    await db.exec(change(open[0].id, "done", "Fixed: the card's error is a note now (abc1234). Aziz's tab loads."));
    const row = (await db.query<{ status: string; note: string; done_at: string | null; text: string }>("select status, note, done_at, text from public.cockpit_feedback where id=$1", [open[0].id])).rows[0];
    expect(row.status).toBe("done");
    expect(row.note).toBe("Fixed: the card's error is a note now (abc1234). Aziz's tab loads.");
    expect(row.done_at).not.toBeNull();
    expect(row.text).toBe("The Money tab crashes");
    const audit = (await db.query<{ before: any; after: any; actor_email: string }>("select before, after, actor_email from public.cockpit_audit_log where action='feedback.scan' and entity_id=$1 order by created_at, (after->>'status')='done'", [String(open[0].id)])).rows;
    expect(audit.map(a => [a.before.status, a.after.status])).toEqual([["queued", "in_progress"], ["in_progress", "done"]]);
    expect(audit.every(a => a.actor_email === "claude:cockpit-feedback-scan")).toBe(true);

    // A row that does not exist changes nothing and writes no audit row.
    await db.exec(change(999999, "done", "nothing"));
    expect((await db.query<{ n: number }>("select count(*)::int n from public.cockpit_audit_log where entity_id='999999'")).rows[0].n).toBe(0);
  } finally {
    await db.close();
  }
}, 30_000);
