import { afterEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import { act, createElement, type ReactNode } from "react";
import type { Root } from "react-dom/client";
import { MemoryRouter } from "react-router";

const win = new Window({
  url: "https://cockpit.maharamedia.com/client-success/settings",
});
Object.assign(globalThis, {
  window: win,
  document: win.document,
  navigator: win.navigator,
  HTMLElement: win.HTMLElement,
  FormData: win.FormData,
  IS_REACT_ACT_ENVIRONMENT: true,
});
const user = {
  id: "staff",
  email: "staff@tests.invalid",
  email_confirmed_at: "2026-10-01",
};
const authListeners = new Set<
  (event: string, session: { user: typeof user } | null) => void
>();
const client = {
  auth: {
    onAuthStateChange: (
      listener: (event: string, session: { user: typeof user } | null) => void,
    ) => {
      authListeners.add(listener);
      return {
        data: {
          subscription: { unsubscribe: () => authListeners.delete(listener) },
        },
      };
    },
    getUser: mock(async () => ({ data: { user }, error: null })),
    getSession: mock(async () => ({
      data: { session: { user } },
      error: null,
    })),
    resetPasswordForEmail: mock(async (_email: string) => ({ error: null })),
    signInWithOtp: mock(async (_args: unknown) => ({ error: null })),
    setSession: mock(async (_args: unknown) => ({ error: null })),
    verifyOtp: mock(async (_args: unknown) => ({
      data: { user, session: { user } },
      error: null,
    })),
    updateUser: mock(async (_args: unknown) => ({ error: null })),
    stopAutoRefresh: mock(async () => {}),
  },
  rpc: mock(async (name: string) => ({
    data:
      name === "cockpit_adopt_member"
        ? true
        : {
            email: user.email,
            name: "Staff",
            is_admin: false,
            is_ceo: false,
            roles: ["csm"],
            clients: [],
            cockpits: ["csm"],
            home: "/go/csm",
          },
    error: null,
  })),
};
process.env.VITE_SUPABASE_URL = "https://bldgtotkfmhoxmlzowdx.supabase.co";
process.env.VITE_SUPABASE_ANON_KEY = "local-fixture";
mock.module("@supabase/supabase-js", () => ({ createClient: () => client }));
mock.module("../src/auth/SupabaseAuthProvider", () => ({
  getCockpitSupabaseClient: () => client,
  useCockpitAuth: () => ({
    client,
    session: { user },
    email: user.email,
    name: "Staff",
    refreshAccess: async () => {},
    signOut: async () => {},
  }),
}));
mock.module("../src/contexts/ThemeContext", () => ({
  useTheme: () => ({ theme: "dark", switchable: false, toggleTheme() {} }),
}));
const block = ({ children }: { children?: ReactNode }) =>
  createElement("div", null, children);
mock.module("../src/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? block({ children }) : null,
  DialogContent: block,
  DialogHeader: block,
  DialogTitle: block,
  DialogDescription: block,
  DialogFooter: block,
}));
const { SettingsPage } = await import("../src/pages/SettingsPage");
const { FirstSignInPage } = await import("../src/pages/FirstSignInPage");
let root: Root | null = null;
let host: HTMLElement;
const tick = async () => {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
  });
};
async function click(text: string) {
  const button = [...host.querySelectorAll("button")].find(element =>
    element.textContent?.trim().startsWith(text),
  );
  expect(button).toBeDefined();
  await act(async () =>
    button!.dispatchEvent(new win.MouseEvent("click", { bubbles: true })),
  );
  await tick();
}
async function submit() {
  const form = host.querySelector("form");
  expect(form).not.toBeNull();
  await act(async () =>
    form!.dispatchEvent(
      new win.Event("submit", { bubbles: true, cancelable: true }),
    ),
  );
  await tick();
}
async function open() {
  client.auth.resetPasswordForEmail.mockReset();
  client.auth.resetPasswordForEmail.mockImplementation(async () => ({
    error: null,
  }));
  client.auth.verifyOtp.mockReset();
  client.auth.verifyOtp.mockImplementation(async () => ({
    data: { user, session: { user } },
    error: null,
  }));
  client.auth.updateUser.mockClear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(createElement(SettingsPage)));
  await click("Change password");
}
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = null;
  host?.remove();
});

test("the real Settings form advances to code entry and verifies recovery before saving", async () => {
  await open();
  await submit();
  expect(client.auth.resetPasswordForEmail).toHaveBeenCalledWith(user.email);
  expect(
    host.querySelector<HTMLInputElement>("input[name=code]"),
  ).not.toBeNull();
  host.querySelector<HTMLInputElement>("input[name=code]")!.value = "1234 5678";
  host.querySelector<HTMLInputElement>("input[name=newPassword]")!.value =
    "strong-password";
  await submit();
  expect(client.auth.verifyOtp).toHaveBeenCalledWith({
    email: user.email,
    token: "12345678",
    type: "recovery",
  });
  expect(client.auth.updateUser).toHaveBeenCalledWith({
    password: "strong-password",
  });
  expect(host.textContent).toContain("Password changed successfully.");
});

test("a wrong code leaves the form open and never changes a password", async () => {
  await open();
  await submit();
  client.auth.verifyOtp.mockImplementation(async () => ({
    data: { user, session: { user } },
    error: { code: "otp_expired", message: "Token invalid" } as never,
  }));
  host.querySelector<HTMLInputElement>("input[name=code]")!.value = "123456";
  host.querySelector<HTMLInputElement>("input[name=newPassword]")!.value =
    "strong-password";
  await submit();
  expect(client.auth.updateUser).not.toHaveBeenCalled();
  expect(host.textContent).toContain("fresh code");
});

test("returning to code request cancels a password save awaiting verification", async () => {
  await open();
  await submit();
  let resolve!: (result: {
    data: { user: typeof user; session: { user: typeof user } };
    error: null;
  }) => void;
  client.auth.verifyOtp.mockImplementation(
    () =>
      new Promise(done => {
        resolve = done;
      }),
  );
  host.querySelector<HTMLInputElement>("input[name=code]")!.value = "123456";
  host.querySelector<HTMLInputElement>("input[name=newPassword]")!.value =
    "strong-password";
  await submit();
  await click("Back");
  await act(async () =>
    resolve({ data: { user, session: { user } }, error: null }),
  );
  await tick();
  expect(client.auth.updateUser).not.toHaveBeenCalled();
  const send = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    button => button.textContent?.trim() === "Send code",
  );
  expect(send?.disabled).toBe(false);
});
const { createRoot } = await import("react-dom/client");

test("an Auth actor switch cancels verification before React receives new context", async () => {
  await open();
  await submit();
  let resolve!: (result: {
    data: { user: typeof user; session: { user: typeof user } };
    error: null;
  }) => void;
  client.auth.verifyOtp.mockImplementation(
    () =>
      new Promise(done => {
        resolve = done;
      }),
  );
  host.querySelector<HTMLInputElement>("input[name=code]")!.value = "123456";
  host.querySelector<HTMLInputElement>("input[name=newPassword]")!.value =
    "strong-password";
  await submit();
  await act(async () => {
    for (const listener of authListeners)
      listener("SIGNED_IN", {
        user: { ...user, id: "other", email: "other@tests.invalid" },
      });
  });
  await act(async () =>
    resolve({ data: { user, session: { user } }, error: null }),
  );
  await tick();
  expect(client.auth.updateUser).not.toHaveBeenCalled();
});

test("Cancel discards a delayed code request before the dialog is reopened", async () => {
  await open();
  let resolve!: (value: { error: null }) => void;
  client.auth.resetPasswordForEmail.mockImplementation(
    () =>
      new Promise(done => {
        resolve = done;
      }),
  );
  await submit();
  await click("Cancel");
  await act(async () => resolve({ error: null }));
  await tick();
  await click("Change password");
  expect(host.querySelector("input[name=code]")).toBeNull();
  const send = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
    button => button.textContent?.trim() === "Send code",
  );
  expect(send?.disabled).toBe(false);
});

async function input(selector: string, value: string) {
  const field = host.querySelector<HTMLInputElement>(selector)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      win.HTMLInputElement.prototype,
      "value",
    )!.set!.call(field, value);
    field.dispatchEvent(new win.Event("input", { bubbles: true }));
  });
  await tick();
}
async function openSetup() {
  client.auth.verifyOtp.mockReset();
  client.auth.verifyOtp.mockImplementation(async () => ({
    data: { user, session: { user } },
    error: null,
  }));
  client.auth.updateUser.mockClear();
  client.auth.setSession.mockClear();
  client.rpc.mockClear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      createElement(MemoryRouter, null, createElement(FirstSignInPage)),
    ),
  );
  await input("#setup-email", user.email);
  await submit();
  expect(host.querySelector("#setup-code")).not.toBeNull();
  await input("#setup-code", "123456");
  await input("#setup-password", "strong-password");
}

test("Change email cancels delayed setup before adoption or password writes", async () => {
  await openSetup();
  let resolve!: (value: {
    data: { user: typeof user; session: { user: typeof user } };
    error: null;
  }) => void;
  client.auth.verifyOtp.mockImplementation(
    () =>
      new Promise(done => {
        resolve = done;
      }),
  );
  await submit();
  await click("Change email or resend code");
  await act(async () =>
    resolve({ data: { user, session: { user } }, error: null }),
  );
  await tick();
  expect(client.rpc).not.toHaveBeenCalled();
  expect(client.auth.updateUser).not.toHaveBeenCalled();
  expect(client.auth.setSession).not.toHaveBeenCalled();
  expect(host.querySelector("#setup-email")).not.toBeNull();
});

test("completed setup offers explicit sign-in without a delayed session handoff", async () => {
  await openSetup();
  await submit();
  expect(client.auth.updateUser).toHaveBeenCalledWith({
    password: "strong-password",
  });
  expect(client.auth.setSession).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Password ready");
  expect(
    [...host.querySelectorAll("button")].some(
      button => button.textContent?.trim() === "Sign in",
    ),
  ).toBe(true);
});
