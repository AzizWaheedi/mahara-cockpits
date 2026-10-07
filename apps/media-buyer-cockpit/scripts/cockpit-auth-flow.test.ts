import { describe, expect, mock, test } from "bun:test";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import {
  cockpitAuthError,
  completeCockpitPasswordReset,
  normalizeCockpitCode,
  requestCockpitCode,
  requestCockpitPasswordReset,
  safeCockpitNext,
  signOutCockpitSession,
} from "../src/auth/supabaseAccess";

process.env.VITE_SUPABASE_URL = "https://bldgtotkfmhoxmlzowdx.supabase.co";
process.env.VITE_SUPABASE_ANON_KEY = "local-fixture";
let verificationClient: SupabaseClient;
mock.module("@supabase/supabase-js", () => ({
  createClient: () => verificationClient,
}));

const user = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "staff@tests.invalid",
  email_confirmed_at: "2026-10-01",
} as User;
function fake() {
  const auth = {
    getUser: mock(async () => ({ data: { user }, error: null })),
    getSession: mock(async () => ({
      data: { session: { user } },
      error: null,
    })),
    signInWithOtp: mock(async (_args: unknown) => ({ error: null })),
    resetPasswordForEmail: mock(async (_email: string) => ({ error: null })),
    verifyOtp: mock(async (_args: unknown) => ({
      data: { user, session: { user } },
      error: null,
    })),
    updateUser: mock(async (_args: unknown) => ({ error: null })),
    stopAutoRefresh: mock(async () => {}),
    signOut: mock(async (_options: unknown) => ({ error: null })),
  };
  const client = { auth } as unknown as SupabaseClient;
  verificationClient = client;
  return { auth, client };
}

describe("email authentication boundaries", () => {
  test("ordinary sign-out does not revoke other device sessions", async () => {
    const { client, auth } = fake();
    await signOutCockpitSession(client);
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });
  test("a new directory seat can request its first sign-in code", async () => {
    const { client, auth } = fake();
    await requestCockpitCode(client, " Staff@Tests.Invalid ");
    expect(auth.signInWithOtp).toHaveBeenCalledWith({
      email: "staff@tests.invalid",
      options: { shouldCreateUser: true },
    });
  });
  for (const code of [
    "123456",
    "12345678",
    "1234567890",
    "123 456",
    "1234-5678",
  ]) {
    test(`preserves the full code ${code}`, () => {
      expect(normalizeCockpitCode(code)).toBe(code.replace(/[\s-]/g, ""));
    });
  }
  for (const code of [
    "12345",
    "12345678901",
    "abc123456",
    "123456<script>",
    "",
  ]) {
    test(`rejects malformed code ${JSON.stringify(code)}`, () => {
      expect(() => normalizeCockpitCode(code)).toThrow(/full code/i);
    });
  }
  test("rate-limit errors tell the user to wait instead of repeatedly resending", () => {
    expect(
      cockpitAuthError({
        code: "over_email_send_rate_limit",
        message: "Email rate limit exceeded",
      }),
    ).toMatch(/wait/i);
    expect(
      cockpitAuthError({
        code: "otp_expired",
        message: "Token has expired or is invalid",
      }),
    ).toMatch(/newest|fresh/i);
  });
});

describe("password reset", () => {
  test("sends only to the verified current actor", async () => {
    const { auth, client } = fake();
    await requestCockpitPasswordReset(client, user);
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith(user.email!);
  });
  test("verifies the full recovery code before changing a password", async () => {
    const { auth, client } = fake();
    await completeCockpitPasswordReset(
      client,
      user,
      "1234 5678",
      "strong-password",
    );
    expect(auth.verifyOtp).toHaveBeenCalledWith({
      email: user.email,
      token: "12345678",
      type: "recovery",
    });
    expect(auth.updateUser).toHaveBeenCalledWith({
      password: "strong-password",
    });
  });
  test("a wrong recovery code never changes a password", async () => {
    const { auth, client } = fake();
    auth.verifyOtp.mockImplementation(async () => ({
      data: { user, session: { user } },
      error: { message: "Token invalid" } as never,
    }));
    await expect(
      completeCockpitPasswordReset(client, user, "123456", "strong-password"),
    ).rejects.toThrow();
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
  test("a changed local actor cannot receive another actor's password", async () => {
    const { auth, client } = fake();
    auth.getSession.mockImplementation(async () => ({
      data: { session: { user: { ...user, id: "other" } } },
      error: null,
    }));
    await expect(
      completeCockpitPasswordReset(client, user, "123456", "strong-password"),
    ).rejects.toThrow(/changed/i);
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
  test("a cancelled request cannot update a password after OTP verification", async () => {
    const { auth, client } = fake();
    let current = true;
    auth.verifyOtp.mockImplementation(async () => {
      current = false;
      return { data: { user, session: { user } }, error: null };
    });
    await expect(
      completeCockpitPasswordReset(
        client,
        user,
        "123456",
        "strong-password",
        () => current,
      ),
    ).rejects.toThrow(/changed/i);
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
  test("a recovery token for another user cannot change the requested password", async () => {
    const { auth, client } = fake();
    auth.verifyOtp.mockImplementation(async () => ({
      data: {
        user: { ...user, id: "other" },
        session: { user: { ...user, id: "other" } },
      },
      error: null,
    }));
    await expect(
      completeCockpitPasswordReset(client, user, "123456", "strong-password"),
    ).rejects.toThrow(/changed/i);
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
});

describe("login redirects", () => {
  for (const next of [
    "https://evil.invalid",
    "//evil.invalid",
    "/\\evil.invalid",
    "/%2Fevil.invalid",
    "/%5Cevil.invalid",
    "/dashboard\n",
    "/%0aevil",
    "/%",
    "dashboard",
  ]) {
    test(`rejects unsafe next ${JSON.stringify(next)}`, () =>
      expect(safeCockpitNext(next)).toBe("/"));
  }
  test("preserves a local path and query", () =>
    expect(safeCockpitNext("/ads?range=week#campaign")).toBe(
      "/ads?range=week#campaign",
    ));
});
