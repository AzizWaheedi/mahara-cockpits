/** Synthetic PostgreSQL compatibility experiment, not a production migration test. */
import { expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

test("old type JSON falls back to legacy and an enabled version stays frozen", async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE types (key text, version int, fields jsonb);
      CREATE TABLE versions (key text, version int, row jsonb);
      INSERT INTO types VALUES ('fictional', 1, '[]');
      INSERT INTO versions SELECT key, version, to_jsonb(types) FROM types;
      ALTER TABLE types ADD COLUMN policy text NOT NULL DEFAULT 'legacy'
        CHECK (policy IN ('legacy','retained_v1'));`);
    const before = await db.query<{ policy: string }>(`SELECT coalesce((jsonb_populate_record(NULL::types,row)).policy,'legacy') policy FROM versions WHERE version=1`);
    expect(before.rows[0].policy).toBe("legacy");
    await db.exec(`UPDATE types SET version=2,policy='retained_v1';
      INSERT INTO versions SELECT key, version, to_jsonb(types) FROM types;
      UPDATE types SET version=3,policy='legacy';`);
    const after = await db.query<{ version: number; policy: string }>(`SELECT version,coalesce((jsonb_populate_record(NULL::types,row)).policy,'legacy') policy FROM versions ORDER BY version`);
    expect(after.rows).toEqual([{ version: 1, policy: "legacy" }, { version: 2, policy: "retained_v1" }]);
  } finally {
    await db.close();
  }
});
