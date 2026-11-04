/**
 * A Sales seat saved from Admin (20261104a_admin_sales_seat.sql) on an isolated
 * PostgreSQL. The CEO, 2026-11-04: adding a setter read "Give them at least one
 * cockpit role or admin". It stands on the real seat directory, the Admin save
 * and remove of 20261017b, and the sales cockpit's own seat table and gate.
 * Every person is invented.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { cockpitIdentityTestDb } from "./lib/cockpitIdentityTestDb";
import { actor, member, migration } from "./lib/cockpitTestDb";

const FILE = "20261104a_admin_sales_seat.sql";
const ADMIN = "00000000-0000-4000-8000-0000000000a1";
const CSM = "00000000-0000-4000-8000-0000000000c2";
const REP = "00000000-0000-4000-8000-0000000000e1";
const REP_EMAIL = "rep.one@tests.invalid";

type Row = Record<string, any>;
let db: PGlite;

function cut(sql: string, pattern: RegExp): string {
  const hit = sql.match(pattern);
  if (!hit) throw new Error(`Canonical definition missing: ${pattern}`);
  return hit[0];
}

async function asOwner() {
  await db.exec("RESET ROLE");
  await db.query("SELECT set_config('request.jwt.claim.sub','',false)");
  await db.query("SELECT set_config('request.jwt.claims','',false)");
}
async function as<T = Row>(who: string, text: string, params: unknown[] = []) {
  await actor(db, who);
  try {
    return (await db.query<T>(text, params)).rows;
  } finally {
    await asOwner();
  }
}
async function refused(who: string, text: string, params: unknown[] = []) {
  await actor(db, who);
  try {
    await db.query(text, params);
  } catch (e) {
    await asOwner();
    return (e as Error).message;
  }
  await asOwner();
  throw new Error(`Expected a refusal for ${text}`);
}

const SAVE5 =
  "SELECT public.cockpit_admin_upsert_member(p_email => $1, p_name => $2, p_roles => $3, p_clients => $4, p_sales_role => $5)";
const SAVE4 =
  "SELECT public.cockpit_admin_upsert_member(p_email => $1, p_name => $2, p_roles => $3, p_clients => $4)";
const save = (
  email: string,
  roles: string[],
  salesRole: string | null = null,
  name = "Test Person",
) => as(ADMIN, SAVE5, [email, name, roles, [], salesRole]);
const seat = async (email: string) =>
  (
    await db.query<Row>(
      "SELECT name, role, via_portal, active, updated_by FROM public.cockpit_sales_people WHERE email = $1",
      [email],
    )
  ).rows[0];
const row = async (email: string) =>
  (
    await db.query<Row>(
      "SELECT roles, clients, active, sales_role FROM public.cockpit_members WHERE email = $1",
      [email],
    )
  ).rows[0];
const audits = async (email: string) =>
  Number(
    (
      await db.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM public.cockpit_audit_log WHERE entity_type = 'cockpit_sales_people' AND entity_id = $1",
        [email],
      )
    ).rows[0].n,
  );

beforeAll(async () => {
  db = await cockpitIdentityTestDb();
  await db.exec(
    "ALTER TABLE public.cockpit_members ADD COLUMN IF NOT EXISTS sales_role text",
  );
  const sales = migration("20260924a_sales_cockpit.sql");
  await db.exec(
    cut(
      sales,
      /create table if not exists public\.cockpit_sales_people \([\s\S]*?\n\);/,
    ),
  );
  await db.exec(
    "ALTER TABLE public.cockpit_sales_people ADD COLUMN IF NOT EXISTS updated_by text",
  );
  await db.exec(
    cut(
      sales,
      /create or replace function public\.cockpit_sales_email\(\)[\s\S]*?\n\$\$;/,
    ),
  );
  await db.exec(
    cut(
      migration("20260926m_sales_hardening.sql"),
      /create or replace function public\.cockpit_sales_seat\(\)[\s\S]*?\n\$\$;/,
    ),
  );
  await db.exec(
    "GRANT EXECUTE ON FUNCTION public.cockpit_sales_email() TO authenticated",
  );
  await db.exec(
    "GRANT EXECUTE ON FUNCTION public.cockpit_sales_seat() TO authenticated",
  );
  await db.exec(
    migration("20261017b_team_only_seats.sql").match(
      /CREATE OR REPLACE FUNCTION public\.cockpit_admin_upsert_member\([\s\S]*?\n\$function\$;/,
    )![0],
  );
  await db.exec(
    migration("20261017b_team_only_seats.sql").match(
      /CREATE OR REPLACE FUNCTION public\.cockpit_admin_remove_member\([\s\S]*?\n\$function\$;/,
    )![0],
  );
  await db.exec(
    `INSERT INTO public.cockpit_members (email, name, roles, clients, active, auth_user_id) VALUES ('closer.old@tests.invalid', 'Old Closer', ARRAY['sales'], '{}', true, NULL)`,
  );
  await db.exec(
    `INSERT INTO public.cockpit_sales_people (email, name, role, via_portal, active) VALUES ('closer.old@tests.invalid', 'Old Closer', 'closer', true, true)`,
  );
  // A manager's seat that never showed in Admin, and the CEO's own row.
  await db.exec(
    `INSERT INTO public.cockpit_members (email, name, roles, clients, active) VALUES
       ('open.manager@tests.invalid', 'Open Manager', ARRAY['admin','csm'], '{}', true),
       ('founder@tests.invalid', 'Founder', ARRAY['admin','ceo'], '{}', true)`,
  );
  await db.exec(
    `INSERT INTO public.cockpit_sales_people (email, name, role, via_portal, active) VALUES
       ('open.manager@tests.invalid', 'Open Manager', 'manager', true, true),
       ('founder@tests.invalid', 'Founder', 'manager', true, true)`,
  );
  await member(db, ADMIN, "admin@tests.invalid", ["admin"]);
  await member(db, CSM, "csm@tests.invalid", ["csm"]);
  await db.exec(migration(FILE));
});

afterAll(async () => {
  await db.close();
});

describe("the migration", () => {
  test("gives a member holding Sales the seat's role, so a save cannot demote a closer", async () => {
    expect((await row("closer.old@tests.invalid")).sales_role).toBe("closer");
  });

  test("shows a manager's open seat in Admin, so unticking can close it; the CEO's row stays as it was", async () => {
    expect(await row("open.manager@tests.invalid")).toMatchObject({
      roles: ["admin", "csm", "sales"],
      sales_role: "manager",
    });
    expect(await row("founder@tests.invalid")).toMatchObject({
      roles: ["admin", "ceo"],
      sales_role: null,
    });
    await save("open.manager@tests.invalid", ["admin", "csm"]);
    expect(await seat("open.manager@tests.invalid")).toMatchObject({
      via_portal: false,
      active: false,
    });
  });

  test("the guard refuses a remove body changed since this file read it", async () => {
    const other = await cockpitIdentityTestDb();
    try {
      await other.exec(
        "ALTER TABLE public.cockpit_members ADD COLUMN IF NOT EXISTS sales_role text",
      );
      const sales = migration("20260924a_sales_cockpit.sql");
      await other.exec(
        cut(
          sales,
          /create table if not exists public\.cockpit_sales_people \([\s\S]*?\n\);/,
        ),
      );
      await other.exec(
        "ALTER TABLE public.cockpit_sales_people ADD COLUMN IF NOT EXISTS updated_by text",
      );
      const old = migration("20261017b_team_only_seats.sql");
      await other.exec(
        old.match(
          /CREATE OR REPLACE FUNCTION public\.cockpit_admin_upsert_member\([\s\S]*?\n\$function\$;/,
        )![0],
      );
      await other.exec(
        "CREATE OR REPLACE FUNCTION public.cockpit_admin_remove_member(p_email text) RETURNS void LANGUAGE sql AS 'SELECT 1'",
      );
      await expect(other.exec(migration(FILE))).rejects.toThrow(
        "cockpit_admin_remove_member changed",
      );
    } finally {
      await other.close();
    }
  });

  test("applies twice", async () => {
    await db.exec(migration(FILE));
    expect(
      (
        await db.query(
          "SELECT 1 FROM pg_proc WHERE proname = 'cockpit_admin_upsert_member'",
        )
      ).rows,
    ).toHaveLength(1);
  });

  test("keeps the same doors", async () => {
    const r = (
      await db.query<Row>(`SELECT
        has_function_privilege('authenticated', 'public.cockpit_admin_upsert_member(text,text,text[],text[],text)', 'EXECUTE') AS auth,
        has_function_privilege('anon', 'public.cockpit_admin_upsert_member(text,text,text[],text[],text)', 'EXECUTE') AS anon,
        has_function_privilege('anon', 'public.cockpit_admin_remove_member(text)', 'EXECUTE') AS anon_remove`)
    ).rows[0];
    expect(r).toEqual({ auth: true, anon: false, anon_remove: false });
    expect(
      await refused(CSM, SAVE5, [
        "x@tests.invalid",
        "X",
        ["sales"],
        [],
        "setter",
      ]),
    ).toContain("Admins only");
  });
});

describe("saving a Sales seat", () => {
  test("Sales alone saves, on every client, and opens a setter seat", async () => {
    await save("New.Setter@tests.invalid", ["sales"], "setter", "New Setter");
    expect(await row("new.setter@tests.invalid")).toEqual({
      roles: ["sales"],
      clients: [],
      active: true,
      sales_role: "setter",
    });
    expect(await seat("new.setter@tests.invalid")).toEqual({
      name: "New Setter",
      role: "setter",
      via_portal: true,
      active: true,
      updated_by: "admin@tests.invalid",
    });
    expect(await audits("new.setter@tests.invalid")).toBe(1);
  });

  test("Sales beside another seat is kept, not dropped", async () => {
    await save("two.seats@tests.invalid", ["csm", "sales"], "closer");
    expect((await row("two.seats@tests.invalid")).roles).toEqual([
      "csm",
      "sales",
    ]);
    expect((await seat("two.seats@tests.invalid")).role).toBe("closer");
  });

  test("a saved seat opens the sales gate for that person, and for nobody else", async () => {
    await member(db, REP, REP_EMAIL, ["csm"]);
    expect(
      (
        await as<{ r: boolean }>(REP, "SELECT public.cockpit_sales_seat() AS r")
      )[0].r,
    ).toBe(false);
    await save(REP_EMAIL, ["sales"], "setter");
    expect(
      (
        await as<{ r: boolean }>(REP, "SELECT public.cockpit_sales_seat() AS r")
      )[0].r,
    ).toBe(true);
    expect(
      (
        await as<{ r: boolean }>(CSM, "SELECT public.cockpit_sales_seat() AS r")
      )[0].r,
    ).toBe(false);
  });

  test("the choice moves the role, and no choice keeps it", async () => {
    await save("mover@tests.invalid", ["sales"], "setter");
    await save("mover@tests.invalid", ["sales"], "both");
    expect((await seat("mover@tests.invalid")).role).toBe("both");
    expect((await row("mover@tests.invalid")).sales_role).toBe("both");
    // The page live before this ships sends four arguments.
    await as(ADMIN, SAVE4, [
      "mover@tests.invalid",
      "Test Person",
      ["sales"],
      [],
    ]);
    expect((await seat("mover@tests.invalid")).role).toBe("both");
    await as(ADMIN, SAVE4, [
      "fresh.four@tests.invalid",
      "Test Person",
      ["sales"],
      [],
    ]);
    expect((await seat("fresh.four@tests.invalid")).role).toBe("setter");
    await as(ADMIN, SAVE4, [
      "fresh.admin@tests.invalid",
      "Test Person",
      ["admin", "sales"],
      [],
    ]);
    expect((await seat("fresh.admin@tests.invalid")).role).toBe("manager");
  });

  test("a save that changes nothing writes no second audit row", async () => {
    await save("quiet@tests.invalid", ["sales"], "setter");
    await save("quiet@tests.invalid", ["sales"], "setter");
    expect(await audits("quiet@tests.invalid")).toBe(1);
  });

  test("refuses a role that does not exist, and writes nothing", async () => {
    expect(
      await refused(ADMIN, SAVE5, [
        "bad.role@tests.invalid",
        "Bad",
        ["sales"],
        [],
        "owner",
      ]),
    ).toContain("Sales role must be");
    expect(await row("bad.role@tests.invalid")).toBeUndefined();
    expect(await seat("bad.role@tests.invalid")).toBeUndefined();
  });

  test("still refuses no seat at all, and Sales beside Call center", async () => {
    expect(
      await refused(ADMIN, SAVE5, ["none@tests.invalid", "None", [], [], null]),
    ).toContain("Give them at least one cockpit role or admin");
    expect(
      await refused(ADMIN, SAVE5, [
        "mix@tests.invalid",
        "Mix",
        ["call_center", "sales"],
        ["Alpha"],
        "setter",
      ]),
    ).toContain("Call center is a seat on its own");
  });

  test("a manager's pause stands while the person keeps the seat; giving it back reopens it", async () => {
    await save("paused@tests.invalid", ["sales"], "setter");
    await db.exec(
      "UPDATE public.cockpit_sales_people SET active = false WHERE email = 'paused@tests.invalid'",
    );
    await save("paused@tests.invalid", ["sales"], "setter");
    expect((await seat("paused@tests.invalid")).active).toBe(false);
    await save("paused@tests.invalid", ["csm"]);
    await save("paused@tests.invalid", ["sales"], "setter");
    expect(await seat("paused@tests.invalid")).toMatchObject({
      via_portal: true,
      active: true,
    });
  });
});

describe("taking the seat away", () => {
  test("a removed manager re-added with no role sent comes back a setter, not a manager", async () => {
    await save("old.manager@tests.invalid", ["sales"], "manager");
    await as(ADMIN, "SELECT public.cockpit_admin_remove_member($1)", [
      "old.manager@tests.invalid",
    ]);
    await as(ADMIN, SAVE4, [
      "old.manager@tests.invalid",
      "Test Person",
      ["sales"],
      [],
    ]);
    expect(await seat("old.manager@tests.invalid")).toMatchObject({
      role: "setter",
      via_portal: true,
      active: true,
    });
    expect((await row("old.manager@tests.invalid")).sales_role).toBe("setter");
  });

  test("re-added with a role chosen, the choice stands", async () => {
    await save("back.closer@tests.invalid", ["sales"], "closer");
    await as(ADMIN, "SELECT public.cockpit_admin_remove_member($1)", [
      "back.closer@tests.invalid",
    ]);
    await save("back.closer@tests.invalid", ["sales"], "closer");
    expect(await seat("back.closer@tests.invalid")).toMatchObject({
      role: "closer",
      via_portal: true,
      active: true,
    });
  });

  test("unticking Sales closes the seat and clears the role, audited", async () => {
    await save("untick@tests.invalid", ["csm", "sales"], "setter");
    await save("untick@tests.invalid", ["csm"]);
    expect(await seat("untick@tests.invalid")).toMatchObject({
      via_portal: false,
      active: false,
      role: "setter",
    });
    expect((await row("untick@tests.invalid")).sales_role).toBeNull();
    expect(await audits("untick@tests.invalid")).toBe(2);
  });

  test("editing a member whose seat came from elsewhere, with Sales not ticked, leaves the seat", async () => {
    // A manager like this one has a seat row and no 'sales' in their roles.
    await db.exec(
      `INSERT INTO public.cockpit_sales_people (email, name, role, via_portal, active) VALUES ('manager.only@tests.invalid', 'Manager', 'manager', true, true)`,
    );
    await save("manager.only@tests.invalid", ["admin", "csm"]);
    expect(await seat("manager.only@tests.invalid")).toMatchObject({
      via_portal: true,
      active: true,
      role: "manager",
    });
    expect(await audits("manager.only@tests.invalid")).toBe(0);
  });

  test("removing the person closes the seat, so the gate shuts", async () => {
    const id = "00000000-0000-4000-8000-0000000000e9";
    await member(db, id, "leaving@tests.invalid", ["csm"]);
    await save("leaving@tests.invalid", ["sales"], "setter");
    expect(
      (
        await as<{ r: boolean }>(id, "SELECT public.cockpit_sales_seat() AS r")
      )[0].r,
    ).toBe(true);
    await as(ADMIN, "SELECT public.cockpit_admin_remove_member($1)", [
      "leaving@tests.invalid",
    ]);
    expect(await seat("leaving@tests.invalid")).toMatchObject({
      via_portal: false,
      active: false,
    });
    expect(await row("leaving@tests.invalid")).toMatchObject({
      roles: [],
      active: false,
      sales_role: null,
    });
    expect(
      (
        await as<{ r: boolean }>(id, "SELECT public.cockpit_sales_seat() AS r")
      )[0].r,
    ).toBe(false);
  });
});
