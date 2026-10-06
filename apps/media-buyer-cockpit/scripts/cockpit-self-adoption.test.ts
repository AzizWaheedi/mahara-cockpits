import { describe, expect, test } from "bun:test";
import type { User } from "@supabase/supabase-js";
import {
  actor,
  member,
  owner,
} from "./lib/cockpitTestDb";
import {
  accessFromSupabaseMember,
  type SupabaseMember,
} from "../src/auth/supabaseAccess";

import { cockpitIdentityTestDb as setupDb } from "./lib/cockpitIdentityTestDb";

describe("Cockpit staff identity self-adoption and gates", () => {
  test("allowed self-adoption links confirmed member and creates audit log exactly once", async () => {
    const db = await setupDb();
    try {
      const userId = "11111111-1111-4111-8111-111111111111";
      const email = "nada@maharamedia.com";
      await db.query(
        "INSERT INTO auth.users (id, email, email_confirmed_at) VALUES ($1, $2, $3)",
        [userId, email, "2026-09-20T00:00:00Z"],
      );
      await db.query(
        "INSERT INTO public.cockpit_members (email, roles, clients, active) VALUES ($1, $2, $3, true)",
        [email, ["media_buyer"], ["Client A"]],
      );
      const before = (await db.query("SELECT to_jsonb(m) AS row FROM public.cockpit_members m WHERE email=$1", [email])).rows[0].row;
      const baseline = (await db.query("SELECT * FROM public.cockpit_audit_log ORDER BY id")).rows;

      await actor(db, userId);
      const result = await db.query<{ cockpit_adopt_member: boolean }>(
        "SELECT public.cockpit_adopt_member() as cockpit_adopt_member",
      );
      expect(result.rows[0].cockpit_adopt_member).toBe(true);

      await owner(db);
      const after = (await db.query("SELECT to_jsonb(m) AS row FROM public.cockpit_members m WHERE email=$1", [email])).rows[0].row;
      expect(after).toMatchObject({ auth_user_id: userId, active: true, roles: ["media_buyer"], clients: ["Client A"] });
      const ledger = (await db.query("SELECT * FROM public.cockpit_audit_log ORDER BY id")).rows;
      const added = ledger.filter(row => !baseline.some(seed => seed.id === row.id));
      expect(added).toHaveLength(1);
      expect(added[0]).toMatchObject({
        action: "UPDATE", entity_type: "cockpit_members", actor_email: email,
        before, after,
      });
    } finally {
      await db.close();
    }
  });

  test("repeated adoption causes no additional mutation or audit logging", async () => {
    const db = await setupDb();
    try {
      const userId = "11111111-1111-4111-8111-111111111111";
      const email = "nada@maharamedia.com";
      await db.query(
        "INSERT INTO auth.users (id, email, email_confirmed_at) VALUES ($1, $2, $3)",
        [userId, email, "2026-09-20T00:00:00Z"],
      );
      await db.query(
        "INSERT INTO public.cockpit_members (email, roles, active) VALUES ($1, $2, $3)",
        [email, ["media_buyer"], true],
      );
      const baseline = (await db.query("SELECT * FROM public.cockpit_audit_log ORDER BY id")).rows;
      await actor(db, userId);
      const res1 = await db.query<{ cockpit_adopt_member: boolean }>(
        "SELECT public.cockpit_adopt_member() as cockpit_adopt_member",
      );
      expect(res1.rows[0].cockpit_adopt_member).toBe(true);
      await owner(db);
      const linked = (await db.query("SELECT * FROM public.cockpit_members WHERE email=$1", [email])).rows;
      const firstLedger = (await db.query("SELECT * FROM public.cockpit_audit_log ORDER BY id")).rows;
      expect(firstLedger).toHaveLength(baseline.length + 1);
      await actor(db, userId);

      const res2 = await db.query<{ cockpit_adopt_member: boolean }>(
        "SELECT public.cockpit_adopt_member() as cockpit_adopt_member",
      );
      expect(res2.rows[0].cockpit_adopt_member).toBe(true);

      await owner(db);
      expect((await db.query("SELECT * FROM public.cockpit_audit_log ORDER BY id")).rows).toEqual(firstLedger);
      expect((await db.query("SELECT * FROM public.cockpit_members WHERE email=$1", [email])).rows).toEqual(linked);
    } finally {
      await db.close();
    }
  });

  test("anonymous caller is rejected", async () => {
    const db = await setupDb();
    try {
      await actor(db, null);
      await expect(db.query("SELECT public.cockpit_adopt_member()")).rejects.toThrow(/permission denied/i);
    } finally {
      await db.close();
    }
  });

  test("unverified auth user cannot adopt membership", async () => {
    const db = await setupDb();
    try {
      const userId = "22222222-2222-4222-8222-222222222222";
      const email = "karim@maharamedia.com";
      await db.query(
        "INSERT INTO auth.users (id, email, email_confirmed_at) VALUES ($1, $2, NULL)",
        [userId, email],
      );
      await db.query(
        "INSERT INTO public.cockpit_members (email, roles, active) VALUES ($1, $2, $3)",
        [email, ["editor"], true],
      );

      await actor(db, userId);
      const res = await db.query<{ cockpit_adopt_member: boolean }>(
        "SELECT public.cockpit_adopt_member() as cockpit_adopt_member",
      );
      expect(res.rows[0].cockpit_adopt_member).toBe(false);

      await owner(db);
      const memberRow = await db.query<{ auth_user_id: string | null }>(
        "SELECT auth_user_id FROM public.cockpit_members WHERE email = $1",
        [email],
      );
      expect(memberRow.rows[0].auth_user_id).toBeNull();
    } finally {
      await db.close();
    }
  });

  test("confirmed user without directory seat is rejected", async () => {
    const db = await setupDb();
    try {
      const userId = "33333333-3333-4333-8333-333333333333";
      const email = "stranger@maharamedia.com";
      await db.query(
        "INSERT INTO auth.users (id, email, email_confirmed_at) VALUES ($1, $2, $3)",
        [userId, email, "2026-09-20T00:00:00Z"],
      );

      await actor(db, userId);
      const res = await db.query<{ cockpit_adopt_member: boolean }>(
        "SELECT public.cockpit_adopt_member() as cockpit_adopt_member",
      );
      expect(res.rows[0].cockpit_adopt_member).toBe(false);
    } finally {
      await db.close();
    }
  });

  test("revoked seat cannot be adopted or reactivated", async () => {
    const db = await setupDb();
    try {
      const userId = "44444444-4444-4444-8444-444444444444";
      const email = "revoked@maharamedia.com";
      await db.query(
        "INSERT INTO auth.users (id, email, email_confirmed_at) VALUES ($1, $2, $3)",
        [userId, email, "2026-09-20T00:00:00Z"],
      );
      await db.query(
        "INSERT INTO public.cockpit_members (email, roles, active) VALUES ($1, $2, false)",
        [email, ["csm"]],
      );

      await actor(db, userId);
      const res = await db.query<{ cockpit_adopt_member: boolean }>(
        "SELECT public.cockpit_adopt_member() as cockpit_adopt_member",
      );
      expect(res.rows[0].cockpit_adopt_member).toBe(false);

      await owner(db);
      const memberRow = await db.query<{
        auth_user_id: string | null;
        active: boolean;
      }>("SELECT auth_user_id, active FROM public.cockpit_members WHERE email = $1", [
        email,
      ]);
      expect(memberRow.rows[0].auth_user_id).toBeNull();
      expect(memberRow.rows[0].active).toBe(false);
    } finally {
      await db.close();
    }
  });

  test("conflicting link to another auth_user_id fails closed", async () => {
    const db = await setupDb();
    try {
      const existingUserId = "55555555-5555-4555-8555-555555555555";
      const attackerUserId = "66666666-6666-4666-8666-666666666666";
      const email = "abdulelah@maharamedia.com";

      await db.query(
        "INSERT INTO auth.users (id, email, email_confirmed_at) VALUES ($1, 'previous@maharamedia.com', $3), ($4, $2, $3)",
        [existingUserId, email, "2026-09-01T00:00:00Z", attackerUserId],
      );
      await db.query(
        "INSERT INTO public.cockpit_members (auth_user_id, email, roles, active) VALUES ($1, $2, $3, true)",
        [existingUserId, email, ["csm"]],
      );

      await actor(db, attackerUserId);
      const res = await db.query<{ cockpit_adopt_member: boolean }>(
        "SELECT public.cockpit_adopt_member() as cockpit_adopt_member",
      );
      expect(res.rows[0].cockpit_adopt_member).toBe(false);

      await owner(db);
      const memberRow = await db.query<{ auth_user_id: string }>(
        "SELECT auth_user_id FROM public.cockpit_members WHERE email = $1",
        [email],
      );
      expect(memberRow.rows[0].auth_user_id).toBe(existingUserId);
    } finally {
      await db.close();
    }
  });

  test("arbitrary-other-user helper is denied to authenticated callers", async () => {
    const db = await setupDb();
    try {
      const userId = "77777777-7777-4777-8777-777777777777";
      const otherUserId = "88888888-8888-4888-8888-888888888888";
      await db.query(
        "INSERT INTO auth.users (id, email, email_confirmed_at) VALUES ($1, $2, $3), ($4, $5, $3)",
        [
          userId,
          "user@maharamedia.com",
          "2026-09-01T00:00:00Z",
          otherUserId,
          "victim@maharamedia.com",
        ],
      );

      await actor(db, userId);
      await expect(
        db.query("SELECT public.cockpit_link_confirmed_member($1)", [otherUserId]),
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await db.close();
    }
  });

  test("founder email vs spoofed CEO role distinction in SQL and client access", async () => {
    const db = await setupDb();
    try {
      const founderId = "99999999-9999-4999-8999-999999999999";
      const impostorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      const founderEmail = "aziz@maharamedia.com";
      const impostorEmail = "nada@maharamedia.com";

      await member(db, founderId, founderEmail, ["admin"], true, true);
      await member(db, impostorId, impostorEmail, ["admin", "ceo"], true, true);

      await actor(db, founderId);
      const founderSql = await db.query<{ is_ceo: boolean }>(
        "SELECT public.cockpit_is_ceo() as is_ceo",
      );
      expect(founderSql.rows[0].is_ceo).toBe(true);

      await actor(db, impostorId);
      const impostorSql = await db.query<{ is_ceo: boolean }>(
        "SELECT public.cockpit_is_ceo() as is_ceo",
      );
      expect(impostorSql.rows[0].is_ceo).toBe(false);

      const founderUser = {
        id: founderId,
        email: founderEmail,
        email_confirmed_at: "2026-09-01T00:00:00Z",
      } as User;
      const founderMember: SupabaseMember = {
        auth_user_id: founderId,
        email: founderEmail,
        name: "Aziz",
        roles: ["admin"],
        clients: [],
        active: true,
      };
      const founderAccess = accessFromSupabaseMember(founderUser, founderMember);
      expect(founderAccess?.isCeo).toBe(true);
      expect(founderAccess?.home).toBe("/ceo");

      const impostorUser = {
        id: impostorId,
        email: impostorEmail,
        email_confirmed_at: "2026-09-01T00:00:00Z",
      } as User;
      const impostorMember: SupabaseMember = {
        auth_user_id: impostorId,
        email: impostorEmail,
        name: "Nada",
        roles: ["admin", "ceo"],
        clients: [],
        active: true,
      };
      const impostorAccess = accessFromSupabaseMember(impostorUser, impostorMember);
      expect(impostorAccess?.isCeo).toBe(false);
      expect(impostorAccess?.isAdmin).toBe(true);
      expect(impostorAccess?.home).toBe("/admin");
    } finally {
      await db.close();
    }
  });

  test("sales home and cockpit visibility preserved in media-buyer access", () => {
    const salesUser = {
      id: "sales-uid-1",
      email: "salesrep@maharamedia.com",
      email_confirmed_at: "2026-09-01T00:00:00Z",
    } as User;
    const salesMember: SupabaseMember = {
      auth_user_id: "sales-uid-1",
      email: "salesrep@maharamedia.com",
      name: "Sales Rep",
      roles: ["sales"],
      clients: [],
      active: true,
    };
    const access = accessFromSupabaseMember(salesUser, salesMember);
    expect(access).not.toBeNull();
    expect(access?.roles).toEqual(["sales"]);
    expect(access?.cockpits).toContain("sales");
    expect(access?.home).toBe("/go/sales");

    const csmUser = {
      id: "csm-uid-1",
      email: "csm@maharamedia.com",
      email_confirmed_at: "2026-09-01T00:00:00Z",
    } as User;
    const csmMember: SupabaseMember = {
      auth_user_id: "csm-uid-1",
      email: "csm@maharamedia.com",
      name: "CSM",
      roles: ["csm"],
      clients: [],
      active: true,
    };
    const csmAccess = accessFromSupabaseMember(csmUser, csmMember);
    expect(csmAccess?.home).toBe("/go/csm");
    expect(csmAccess?.cockpits).toContain("csm");
  });
  test("normalized self-only adoption ignores forged JWT identity and does not change another seat", async () => {
    const db = await setupDb();
    try {
      const id = "11111111-1111-4111-8111-111111111111";
      await db.query("INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,'  Sales@MaharaMedia.com  ',now())", [id]);
      await db.exec("INSERT INTO public.cockpit_members(email,roles,clients) VALUES('sales@maharamedia.com',ARRAY['sales'],ARRAY['Client A']),('aziz@maharamedia.com',ARRAY['admin'],ARRAY['Client B'])");
      const before = (await db.query("SELECT * FROM public.cockpit_members WHERE email='aziz@maharamedia.com'")).rows;
      await actor(db, id);
      await db.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: id, email: "aziz@maharamedia.com", role: "authenticated" })]);
      expect((await db.query<{ adopted: boolean }>("SELECT public.cockpit_adopt_member() AS adopted")).rows[0].adopted).toBe(true);
      const access = (await db.query<{ value: { email: string; roles: string[]; is_ceo: boolean } }>("SELECT public.cockpit_get_my_access() AS value")).rows[0].value;
      expect(access).toMatchObject({ email: "sales@maharamedia.com", roles: ["sales"], is_ceo: false });
      await owner(db);
      expect((await db.query("SELECT * FROM public.cockpit_members WHERE email='aziz@maharamedia.com'")).rows).toEqual(before);
    } finally { await db.close(); }
  });

  test("service helper links once and leaves the identical link and audit ledger unchanged", async () => {
    const db = await setupDb();
    try {
      const id = "11111111-1111-4111-8111-111111111111";
      await db.query("INSERT INTO auth.users(id,email,email_confirmed_at) VALUES($1,'sales@maharamedia.com',now())", [id]);
      await db.exec("INSERT INTO public.cockpit_members(email,roles,clients) VALUES('sales@maharamedia.com',ARRAY['sales'],ARRAY['Client A'])");
      await db.exec("SET ROLE service_role");
      expect((await db.query<{ linked: boolean }>("SELECT public.cockpit_link_confirmed_member($1) AS linked", [id])).rows[0].linked).toBe(true);
      await owner(db);
      const ledger = (await db.query("SELECT * FROM public.cockpit_audit_log ORDER BY id")).rows;
      const seat = (await db.query("SELECT * FROM public.cockpit_members")).rows;
      await db.exec("SET ROLE service_role");
      expect((await db.query<{ linked: boolean }>("SELECT public.cockpit_link_confirmed_member($1) AS linked", [id])).rows[0].linked).toBe(true);
      await owner(db);
      expect((await db.query("SELECT * FROM public.cockpit_audit_log ORDER BY id")).rows).toEqual(ledger);
      expect((await db.query("SELECT * FROM public.cockpit_members")).rows).toEqual(seat);
    } finally { await db.close(); }
  });
  test("first-signin cannot enumerate the private directory before Auth confirmation", async () => {
    const db = await setupDb();
    try {
      await db.exec("INSERT INTO public.cockpit_members(email,roles) VALUES('legacy@maharamedia.com',ARRAY['sales'])");
      await actor(db, null);
      await expect(db.query("SELECT email,active FROM public.cockpit_members")).rejects.toThrow(/permission denied/i);
    } finally { await db.close(); }
  });
});
