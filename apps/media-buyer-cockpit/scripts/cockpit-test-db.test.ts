import { expect, test } from "bun:test";
import { actor, cockpitTestDb, member, owner } from "./lib/cockpitTestDb";

test("real founder gate rejects role spoofing, unconfirmed users and revoked seats", async () => {
  const db = await cockpitTestDb();
  const founder = "00000000-0000-4000-8000-000000000001";
  const admin = "00000000-0000-4000-8000-000000000002";
  const unconfirmed = "00000000-0000-4000-8000-000000000003";
  try {
    await member(db, founder, "aziz@maharamedia.com", []);
    await member(db, admin, "admin@tests.invalid", ["admin", "ceo"]);
    await member(db, unconfirmed, "awaheedi2008@gmail.com", ["ceo"], true, false);
    for (const [id, expected] of [[founder, true], [admin, false], [unconfirmed, false]] as const) {
      await actor(db, id);
      expect((await db.query<{ok:boolean}>("SELECT public.cockpit_is_ceo() AS ok")).rows[0].ok).toBe(expected);
    }
    await owner(db);
    await db.query("UPDATE public.cockpit_members SET active=false WHERE auth_user_id=$1", [founder]);
    await actor(db, founder);
    expect((await db.query<{ok:boolean}>("SELECT public.cockpit_is_ceo() AS ok")).rows[0].ok).toBe(false);
    await actor(db, null);
    await expect(db.query("SELECT public.cockpit_is_ceo()")).rejects.toThrow();
  } finally { await db.close(); }
});
