import { expect, mock, test } from "bun:test";
import {
  createClient as sdkCreateClient,
  type User,
} from "@supabase/supabase-js";

// Real SDK behavior, local transport only. No network, mailbox, or credentials.
const actualCreateClient = sdkCreateClient;
process.env.VITE_SUPABASE_URL = "https://bldgtotkfmhoxmlzowdx.supabase.co";
process.env.VITE_SUPABASE_ANON_KEY = "local-fixture";
let localFetch: typeof fetch;
let temporaryOptions: {
  persistSession?: boolean;
  autoRefreshToken?: boolean;
  detectSessionInUrl?: boolean;
  storageKey?: string;
};
mock.module("@supabase/supabase-js", () => ({
  createClient: (
    url: string,
    key: string,
    options: Parameters<typeof sdkCreateClient>[2],
  ) => {
    temporaryOptions = options?.auth ?? {};
    return actualCreateClient(url, key, {
      ...options,
      global: { fetch: localFetch },
    });
  },
}));
const { completeCockpitPasswordReset } = await import(
  "../src/auth/supabaseAccess"
);
const user = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "staff@tests.invalid",
  email_confirmed_at: "2026-10-01",
  aud: "authenticated",
  app_metadata: {},
  user_metadata: {},
  created_at: "2026-10-01",
} as User;
const other = {
  ...user,
  id: "22222222-2222-4222-8222-222222222222",
  email: "other@tests.invalid",
};
const encode = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
const token = (owner: User, kind: string) =>
  [
    encode({ alg: "HS256", typ: "JWT" }),
    encode({
      sub: owner.id,
      jti: kind,
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
    "eA",
  ].join(".");
const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

async function setup() {
  const mainToken = token(user, "main");
  const recoveryToken = token(user, "recovery");
  let finishVerify!: () => void;
  let began!: () => void;
  const started = new Promise<void>(resolve => {
    began = resolve;
  });
  const updates: { authorization: string | null; password: string }[] = [];
  localFetch = (async (input, init) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const authorization = headers.get("Authorization");
    if (url.includes("/verify")) {
      began();
      return new Promise<Response>(resolve => {
        finishVerify = () =>
          resolve(
            json({
              access_token: recoveryToken,
              refresh_token: "fake-recovery",
              token_type: "bearer",
              expires_in: 3600,
              user,
            }),
          );
      });
    }
    if (url.includes("/user")) {
      if (init?.method === "PUT")
        updates.push({
          authorization,
          password: JSON.parse(String(init.body)).password,
        });
      const payload = authorization?.startsWith("Bearer ")
        ? JSON.parse(
            Buffer.from(
              authorization.split(" ")[1].split(".")[1],
              "base64url",
            ).toString(),
          )
        : {};
      return json(payload.sub === other.id ? other : user);
    }
    if (url.includes("/logout")) return json({});
    throw new Error("Unexpected local SDK request");
  }) as typeof fetch;
  const main = actualCreateClient(
    process.env.VITE_SUPABASE_URL!,
    "local-fixture",
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey: `test-main-${crypto.randomUUID()}`,
      },
      global: { fetch: localFetch },
    },
  );
  const result = await main.auth.setSession({
    access_token: mainToken,
    refresh_token: "fake-main",
  });
  if (result.error) throw result.error;
  return {
    main,
    mainToken,
    recoveryToken,
    started,
    updates,
    finishVerify: () => finishVerify(),
  };
}

test("delayed cancelled recovery cannot restore a signed-out main session", async () => {
  const f = await setup();
  let current = true;
  const operation = completeCockpitPasswordReset(
    f.main,
    user,
    "123456",
    "strong-password",
    () => current,
  ).catch(error => error);
  await f.started;
  current = false;
  await f.main.auth.signOut();
  expect((await f.main.auth.getSession()).data.session).toBeNull();
  f.finishVerify();
  expect(await operation).toBeInstanceOf(Error);
  expect((await f.main.auth.getSession()).data.session).toBeNull();
  expect(f.updates).toHaveLength(0);
  await f.main.auth.stopAutoRefresh();
});

test("delayed cancelled recovery cannot replace a newer main account", async () => {
  const f = await setup();
  let current = true;
  const operation = completeCockpitPasswordReset(
    f.main,
    user,
    "123456",
    "strong-password",
    () => current,
  ).catch(error => error);
  await f.started;
  current = false;
  await f.main.auth.setSession({
    access_token: token(other, "other"),
    refresh_token: "fake-other",
  });
  f.finishVerify();
  expect(await operation).toBeInstanceOf(Error);
  expect((await f.main.auth.getSession()).data.session?.user.id).toBe(other.id);
  expect(f.updates).toHaveLength(0);
  await f.main.auth.stopAutoRefresh();
});

test("successful recovery uses its private token and preserves the main login", async () => {
  const f = await setup();
  const operation = completeCockpitPasswordReset(
    f.main,
    user,
    "123456",
    "strong-password",
  );
  await f.started;
  f.finishVerify();
  await operation;
  expect(f.updates).toEqual([
    { authorization: `Bearer ${f.recoveryToken}`, password: "strong-password" },
  ]);
  expect((await f.main.auth.getSession()).data.session?.access_token).toBe(
    f.mainToken,
  );
  expect(temporaryOptions).toMatchObject({
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  });
  expect(temporaryOptions.storageKey).toStartWith("cockpit-verification-");
  await f.main.auth.stopAutoRefresh();
});
