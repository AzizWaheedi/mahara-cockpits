import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { cockpitIdentityTestDb } from "./lib/cockpitIdentityTestDb";
import { actor, member, owner } from "./lib/cockpitTestDb";

const before = readFileSync(
  new URL(
    "./fixtures/cockpit-auth-access-before-20261007.sql",
    import.meta.url,
  ),
  "utf8",
);
const correction = new URL(
  "../../../supabase/migrations/20261007b_cockpit_auth_contract.sql",
  import.meta.url,
);
const uid = "11111111-1111-4111-8111-111111111111";
async function setup(patch = true) {
  const db = await cockpitIdentityTestDb();
  await db.exec(before);
  if (patch) await db.exec(readFileSync(correction, "utf8"));
  return db;
}
async function access(db: Awaited<ReturnType<typeof setup>>) {
  return (
    await db.query<{
      value: {
        cockpits: string[];
        home: string | null;
        is_ceo: boolean;
      } | null;
    }>("select public.cockpit_get_my_access() as value")
  ).rows[0].value;
}

describe("live directory access contract", () => {
  test("the captured live function reproduces the sales routing defect", async () => {
    const db = await setup(false);
    try {
      await member(db, uid, "sales@tests.invalid", ["sales"]);
      await actor(db, uid);
      expect(await access(db)).toMatchObject({ cockpits: [], home: null });
    } finally {
      await db.close();
    }
  });
  test("a confirmed sales member receives only the sales cockpit and its home", async () => {
    const db = await setup();
    try {
      await member(db, uid, "sales@tests.invalid", ["sales"]);
      await actor(db, uid);
      expect(await access(db)).toMatchObject({
        cockpits: ["sales"],
        home: "/go/sales",
        is_ceo: false,
      });
    } finally {
      await db.close();
    }
  });
  test("an ordinary admin can open all five cockpits without becoming CEO", async () => {
    const db = await setup();
    try {
      await member(db, uid, "admin@tests.invalid", ["admin"]);
      await actor(db, uid);
      expect(await access(db)).toMatchObject({
        cockpits: ["media_buyer", "csm", "creative", "editor", "sales"],
        home: "/admin",
        is_ceo: false,
      });
    } finally {
      await db.close();
    }
  });
  test("unconfirmed and revoked members still fail closed", async () => {
    const db = await setup();
    try {
      await member(db, uid, "sales@tests.invalid", ["sales"], true, false);
      await actor(db, uid);
      expect(await access(db)).toBeNull();
      await owner(db);
      await db.query(
        "update auth.users set email_confirmed_at=now() where id=$1",
        [uid],
      );
      await db.query(
        "update public.cockpit_members set active=false where auth_user_id=$1",
        [uid],
      );
      await actor(db, uid);
      expect(await access(db)).toBeNull();
    } finally {
      await db.close();
    }
  });
});
