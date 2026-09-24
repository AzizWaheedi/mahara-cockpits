import { describe, expect, test } from "bun:test";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  accessFromSupabaseMember,
  loadSupabaseAccess,
  type SupabaseMember,
} from "../src/auth/supabaseAccess";

const user = {
  id: "auth-1",
  email: "nada@maharamedia.com",
  email_confirmed_at: "2026-09-23T00:00:00Z",
} as User;
const member: SupabaseMember = {
  auth_user_id: "auth-1",
  email: "nada@maharamedia.com",
  name: "Nada",
  roles: ["media_buyer"],
  clients: ["Client A"],
  active: true,
};

describe("Supabase cockpit access", () => {
  test("only a confirmed, exact active Auth link grants access", () => {
    expect(accessFromSupabaseMember(user, member)?.home).toBe("/dashboard");
    expect(
      accessFromSupabaseMember(
        { ...user, email_confirmed_at: undefined },
        member,
      ),
    ).toBeNull();
    expect(
      accessFromSupabaseMember(user, { ...member, active: false }),
    ).toBeNull();
    expect(
      accessFromSupabaseMember(user, { ...member, auth_user_id: "other" }),
    ).toBeNull();
    expect(
      accessFromSupabaseMember(user, { ...member, email: "other@example.com" }),
    ).toBeNull();
    expect(accessFromSupabaseMember(user, null)).toBeNull();
  });

  test("an admin cannot acquire CEO access by adding a role", () => {
    const access = accessFromSupabaseMember(user, {
      ...member,
      roles: ["media_buyer", "admin", "ceo"],
    });
    expect(access?.isAdmin).toBe(true);
    expect(access?.isCeo).toBe(false);
    expect(access?.home).toBe("/admin");
    expect(access?.cockpits).toHaveLength(5);
  });

  test("a linked founder gets CEO access without a delegated CEO role", () => {
    const founder = {
      ...user,
      email: "aziz@maharamedia.com",
    };
    const access = accessFromSupabaseMember(founder, {
      ...member,
      email: "aziz@maharamedia.com",
      roles: [],
    });
    expect(access?.isCeo).toBe(true);
    expect(access?.home).toBe("/ceo");
  });

  test("the lookup verifies Auth and asks only for the active matching link", async () => {
    const filters: Array<[string, unknown]> = [];
    const query = {
      select: (_columns: string) => query,
      eq: (column: string, value: unknown) => {
        filters.push([column, value]);
        return query;
      },
      maybeSingle: async () => ({ data: member, error: null }),
    };
    const client = {
      auth: { getUser: async () => ({ data: { user }, error: null }) },
      from: (table: string) => {
        expect(table).toBe("cockpit_members");
        return query;
      },
    } as unknown as SupabaseClient;
    expect((await loadSupabaseAccess(client))?.email).toBe(member.email);
    expect(filters).toEqual([
      ["auth_user_id", user.id],
      ["active", true],
    ]);
  });
});
