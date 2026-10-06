import { describe, expect, test } from "bun:test";
import type { Session, SupabaseClient, User } from "@supabase/supabase-js";
import {
  accessFromSupabaseMember,
  loadSupabaseAccess,
  assertSupabaseActor,
  observeSupabaseAccess,
  type SupabaseAccessState,
  type SupabaseMember,
} from "../src/auth/supabaseAccess";
import { cockpitIdentityTestDb } from "./lib/cockpitIdentityTestDb";
import { actor, member as seedMember, owner } from "./lib/cockpitTestDb";
import { cockpitSwitchPath } from "../src/auth/cockpitNavigation";

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

});

const SALES = "11111111-1111-4111-8111-111111111111";
const EDITOR = "22222222-2222-4222-8222-222222222222";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

/** Only the Auth transport is simulated; every permission response runs real SQL. */
async function transport() {
  const db = await cockpitIdentityTestDb();
  await seedMember(db, SALES, "sales@maharamedia.com", ["sales"]);
  await seedMember(db, EDITOR, "editor@maharamedia.com", ["editor"]);
  let current: string | null = SALES;
  let callback: ((event: string, session: Session | null) => void) | undefined;
  let insideCallback = false;
  let transform = (data: unknown): unknown => data;
  let afterAccess: (() => Promise<void>) | undefined;
  async function getUser() {
    if (insideCallback) throw new Error("Auth lock re-entered");
    if (current === null) return null;
    await owner(db);
    const result = await db.query<{ id: string; email: string; email_confirmed_at: string | null }>(
      "SELECT id,email,email_confirmed_at::text FROM auth.users WHERE id=$1", [current],
    );
    return result.rows[0]
      ? { ...result.rows[0], app_metadata: { roles: ["admin", "ceo"], cockpits: ["editor"] }, user_metadata: {} } as User
      : null;
  }
  const client = {
    auth: {
      getUser: async () => ({ data: { user: await getUser() }, error: null }),
      getSession: async () => {
        const user = await getUser();
        return { data: { session: user ? { user } as Session : null }, error: null };
      },
      onAuthStateChange: (cb: typeof callback) => {
        callback = cb;
        return { data: { subscription: { unsubscribe: () => { callback = undefined; } } } };
      },
    },
    rpc: async (name: string) => {
      if (insideCallback) throw new Error("Auth lock re-entered");
      await actor(db, current);
      try {
        const result = await db.query<{ value: unknown }>(`SELECT public.${name}() AS value`);
        const data = result.rows[0].value;
        if (name === "cockpit_get_my_access") await afterAccess?.();
        return { data: transform(data), error: null };
      } catch (error) {
        return { data: null, error };
      }
    },
  } as unknown as SupabaseClient;
  return {
    db, client,
    transform: (fn: typeof transform) => { transform = fn; },
    pauseAccess: (fn: typeof afterAccess) => { afterAccess = fn; },
    async change(id: string | null, event = id ? "SIGNED_IN" : "SIGNED_OUT") {
      current = id;
      const session = id ? { user: await getUser() } as Session : null;
      insideCallback = true;
      try { callback?.(event, session); } finally { insideCallback = false; }
    },
  };
}

describe("Directory bootstrap consumers", () => {
  test("canonical sales access ignores stale privileged metadata and observes revocation", async () => {
    const t = await transport();
    try {
      expect(await loadSupabaseAccess(t.client)).toMatchObject({
        roles: ["sales"], cockpits: ["sales"], isAdmin: false, isCeo: false, home: "/go/sales",
      });
      await owner(t.db);
      await t.db.query("UPDATE public.cockpit_members SET active=false WHERE auth_user_id=$1", [SALES]);
      expect(await loadSupabaseAccess(t.client)).toBeNull();
    } finally { await t.db.close(); }
  });

  test("actual confirmed founder and matching directory decide CEO, not RPC flags", async () => {
    const t = await transport();
    try {
      t.transform(data => typeof data === "object" && data !== null ? { ...data, is_ceo: true, is_admin: true } : data);
      expect(await loadSupabaseAccess(t.client)).toMatchObject({ isCeo: false, isAdmin: false });
      await owner(t.db);
      await t.db.query("UPDATE auth.users SET email='aziz@maharamedia.com' WHERE id=$1", [SALES]);
      await t.db.query("UPDATE public.cockpit_members SET email='aziz@maharamedia.com' WHERE auth_user_id=$1", [SALES]);
      expect(await loadSupabaseAccess(t.client)).toMatchObject({ isCeo: true, home: "/ceo" });
      await owner(t.db);
      await t.db.query("UPDATE auth.users SET email_confirmed_at=NULL WHERE id=$1", [SALES]);
      expect(await loadSupabaseAccess(t.client)).toBeNull();
    } finally { await t.db.close(); }
  });

  for (const operation of ["cockpit_adopt_member", "cockpit_get_my_access"]) {
    test(`${operation} denial is a visible fault, not no seat`, async () => {
      const t = await transport();
      let stop: (() => void) | undefined;
      try {
        await owner(t.db);
        await t.db.exec(`REVOKE EXECUTE ON FUNCTION public.${operation}() FROM authenticated`);
        await expect(loadSupabaseAccess(t.client)).rejects.toThrow(/permission denied/i);
        const settled = deferred<SupabaseAccessState>();
        const observer = observeSupabaseAccess(t.client, state => { if (state.ready) settled.resolve(state); });
        stop = observer.unsubscribe;
        const state = await settled.promise;
        expect(state.access).toBeNull();
        expect(state.error).toMatch(/permission denied/i);
        expect(state.session?.user.id).toBe(SALES);
      } finally { stop?.(); await t.db.close(); }
    });
  }

  test("a missing required RPC fails rather than falling back", async () => {
    const t = await transport();
    try {
      await owner(t.db);
      await t.db.exec("DROP FUNCTION public.cockpit_adopt_member()");
      await expect(loadSupabaseAccess(t.client)).rejects.toThrow(/does not exist/i);
    } finally { await t.db.close(); }
  });

  test("malformed adoption and access responses are rejected", async () => {
    const t = await transport();
    try {
      t.transform(data => typeof data === "boolean" ? "true" : data);
      await expect(loadSupabaseAccess(t.client)).rejects.toThrow(/Malformed/);
      t.transform(data => typeof data === "boolean" ? data : {});
      await expect(loadSupabaseAccess(t.client)).rejects.toThrow(/Malformed/);
      for (const bad of [false, [], { email: "other@example.com" }, { roles: [123] }, { clients: null }, { name: 42 }]) {
        t.transform(data => typeof data === "boolean" ? data : typeof bad === "object" && bad !== null && !Array.isArray(bad) && typeof data === "object" && data !== null ? { ...data, ...bad } : bad);
        await expect(loadSupabaseAccess(t.client)).rejects.toThrow(/Malformed|changed|match/);
      }
    } finally { await t.db.close(); }
  });

  test("account switch clears old access immediately and discards the late response outside auth lock", async () => {
    const t = await transport();
    const firstReady = deferred<SupabaseAccessState>();
    const secondReady = deferred<SupabaseAccessState>();
    const states: SupabaseAccessState[] = [];
    const observer = observeSupabaseAccess(t.client, state => {
      states.push(state);
      if (state.ready && state.session?.user.id === SALES) firstReady.resolve(state);
      if (state.ready && state.session?.user.id === EDITOR) secondReady.resolve(state);
    });
    try {
      expect((await firstReady.promise).access?.roles).toEqual(["sales"]);
      const started = deferred<void>();
      const release = deferred<void>();
      t.pauseAccess(async () => { started.resolve(); await release.promise; });
      const old = observer.refresh();
      await started.promise;
      t.pauseAccess(undefined);
      await t.change(EDITOR);
      expect(states.at(-1)).toMatchObject({ ready: false, access: null, error: null });
      expect((await secondReady.promise).access?.roles).toEqual(["editor"]);
      release.resolve();
      await old;
      expect(states.at(-1)?.access?.roles).toEqual(["editor"]);
      await t.change(null);
      expect(states.at(-1)?.access).toBeNull();
    } finally { observer.unsubscribe(); await t.db.close(); }
  });
  test("canonical directory access switches by ordinary path with no credentials or exchange", async () => {
    const t = await transport();
    try {
      const access = await loadSupabaseAccess(t.client);
      expect(cockpitSwitchPath(access, "sales", "/inbox?tab=unread")).toBe("/sales/inbox?tab=unread");
      expect(() => cockpitSwitchPath(access, "editor")).toThrow();
      for (const next of ["//outside.example/path", "/\\outside.example", "/inbox?access_token=secret", "/inbox?refresh_token=secret", "/?portal_token=secret", "/#access_token=secret"]) {
        expect(() => cockpitSwitchPath(access, "sales", next)).toThrow();
      }
      expect(() => cockpitSwitchPath(access, "constructor")).toThrow();
      await owner(t.db);
      await t.db.query("UPDATE public.cockpit_members SET roles=ARRAY['admin'] WHERE auth_user_id=$1", [SALES]);
      const admin = await loadSupabaseAccess(t.client);
      for (const [cockpit, path] of [["media_buyer", ""], ["csm", "/client-success"], ["creative", "/creative"], ["editor", "/editor"], ["sales", "/sales"]]) {
        expect(cockpitSwitchPath(admin, cockpit)).toBe(`${path}/dashboard`);
      }
    } finally { await t.db.close(); }
  });
  test("unmount discards a late load without publishing ready or error state", async () => {
    const t = await transport();
    const ready = deferred<void>();
    const states: SupabaseAccessState[] = [];
    const observer = observeSupabaseAccess(t.client, state => {
      states.push(state);
      if (state.ready) ready.resolve();
    });
    try {
      await ready.promise;
      const started = deferred<void>();
      const release = deferred<void>();
      t.pauseAccess(async () => { started.resolve(); await release.promise; });
      const request = observer.refresh();
      await started.promise;
      observer.unsubscribe();
      const count = states.length;
      release.resolve();
      await request;
      expect(states).toHaveLength(count);
    } finally { observer.unsubscribe(); await t.db.close(); }
  });
  for (const expected of [undefined, SALES]) {
    test(`direct loader rejects a delayed previous-account result (expected actor ${expected ?? "implicit"})`, async () => {
      const t = await transport();
      const started = deferred<void>();
      const release = deferred<void>();
      try {
        t.pauseAccess(async () => { started.resolve(); await release.promise; });
        const request = loadSupabaseAccess(t.client, expected);
        await started.promise;
        await t.change(EDITOR);
        release.resolve();
        await expect(request).rejects.toThrow();
      } finally { release.resolve(); await t.db.close(); }
    });
  }

  test("direct loader rejects a result after sign-out during its final RPC", async () => {
    const t = await transport();
    const started = deferred<void>();
    const release = deferred<void>();
    try {
      t.pauseAccess(async () => { started.resolve(); await release.promise; });
      const request = loadSupabaseAccess(t.client);
      await started.promise;
      await t.change(null);
      release.resolve();
      await expect(request).rejects.toThrow();
    } finally { release.resolve(); await t.db.close(); }
  });
  test("password actor guard rejects another account and revoked email confirmation", async () => {
    const t = await transport();
    try {
      const { data } = await t.client.auth.getUser();
      if (!data.user) throw new Error("Fixture requires its confirmed sales actor");
      expect((await assertSupabaseActor(t.client, data.user)).id).toBe(SALES);
      await t.change(EDITOR);
      await expect(assertSupabaseActor(t.client, data.user)).rejects.toThrow(/account changed/i);
      await t.change(SALES);
      await owner(t.db);
      await t.db.query("UPDATE auth.users SET email_confirmed_at=NULL WHERE id=$1", [SALES]);
      await expect(assertSupabaseActor(t.client, data.user)).rejects.toThrow(/account changed/i);
    } finally { await t.db.close(); }
  });
});

describe("Same-subject directory revalidation", () => {
  for (const event of ["TOKEN_REFRESHED", "SIGNED_IN"]) {
    test(`${event} keeps verified access ready while pending, then applies directory revocation`, async () => {
      const t = await transport();
      const initial = deferred<void>();
      const denied = deferred<SupabaseAccessState>();
      const refreshed = deferred<void>();
      let awaitingResult = false;
      const states: SupabaseAccessState[] = [];
      const observer = observeSupabaseAccess(t.client, state => {
        states.push(state);
        if (state.ready && state.access) initial.resolve();
        if (awaitingResult && state.ready && state.access) refreshed.resolve();
        if (state.ready && state.session && !state.access && !state.error) denied.resolve(state);
      });
      const release = deferred<void>();
      try {
        await initial.promise;
        const started = deferred<void>();
        t.pauseAccess(async () => { started.resolve(); await release.promise; });
        const baseline = states.length;
        await t.change(SALES, event);
        await started.promise;
        expect(states.length).toBeGreaterThan(baseline);
        expect(states.slice(baseline).every(state => state.ready && state.access?.roles.includes("sales"))).toBe(true);
        expect(states.at(-1)?.access?.isAdmin).toBe(false);
        awaitingResult = true;
        release.resolve();
        t.pauseAccess(undefined);
        await refreshed.promise;
        await owner(t.db);
        await t.db.query("UPDATE public.cockpit_members SET active=false WHERE auth_user_id=$1", [SALES]);
        await t.change(SALES, event);
        expect((await denied.promise).access).toBeNull();
      } finally { release.resolve(); observer.unsubscribe(); await t.db.close(); }
    });
  }
});

test("same-actor revalidation faults clear verified access instead of retaining stale permissions", async () => {
  const t = await transport();
  const initial = deferred<void>();
  let latest: SupabaseAccessState | null = null;
  const observer = observeSupabaseAccess(t.client, state => {
    latest = state;
    if (state.ready && state.access) initial.resolve();
  });
  try {
    await initial.promise;
    await owner(t.db);
    await t.db.exec("REVOKE EXECUTE ON FUNCTION public.cockpit_get_my_access() FROM authenticated");
    await expect(observer.refresh()).rejects.toThrow(/permission denied/i);
    expect(latest).toMatchObject({ ready: true, access: null });
    expect(latest).not.toMatchObject({ error: null });
  } finally { observer.unsubscribe(); await t.db.close(); }
});
