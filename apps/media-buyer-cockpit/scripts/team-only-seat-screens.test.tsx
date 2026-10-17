/**
 * The call center seat on the portal's screens (docs/access/TEAM-ONLY-SEATS.md,
 * 2026-10-17): a seat whose only role is call_center has no cockpit, so the
 * front door (src/pages/PortalHome.tsx) sends it to Team meetings instead of
 * "No cockpit on your account yet"; and the Admin form
 * (src/pages/AdminPage.tsx) offers "Call center" as a seat on its own, with
 * its clients required, and saves it through cockpit_admin_upsert_member.
 * Rendered in happy-dom, this app's own dev dependency. The sign-in runs the
 * real access code over the cockpit's own client, with its Auth and two
 * reads answered here. Every name and address is invented.
 */
import { afterAll, afterEach, describe, expect, test } from "bun:test";

// Nothing here may outlive this file: bun runs every test file in one
// process, so no module mocks (they leak into other files), and every global
// and the env are put back in afterAll.
const g = globalThis as any;
const ENV = {
  VITE_SUPABASE_URL: "https://bldgtotkfmhoxmlzowdx.supabase.co",
  VITE_SUPABASE_ANON_KEY: "test-placeholder-key",
};
const envs = [process.env, (import.meta as any).env].filter(Boolean);
const envBefore = envs.map(e =>
  Object.fromEntries(Object.keys(ENV).map(k => [k, e[k]])),
);
for (const e of envs) Object.assign(e, ENV);

const realFetch = globalThis.fetch;
const strayFetches: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL) => {
  strayFetches.push(String(input));
  throw new Error("The seat screens test makes no network calls.");
}) as typeof fetch;

// --- The sign-in: the cockpit's own client, Auth and two reads answered. ---
// Built before any DOM exists, so its sign-in never starts a refresh timer.
const { supabase } = await import("../src/lib/supabase");
const db = supabase as any;
const real = {
  rpc: db.rpc,
  getSession: db.auth.getSession,
  getUser: db.auth.getUser,
  onAuthStateChange: db.auth.onAuthStateChange,
};
const USER = {
  id: "auth-agent-1",
  email: "agent@example.com",
  email_confirmed_at: "2026-10-17T00:00:00Z",
  app_metadata: {},
  user_metadata: {},
};
let seatRoles: string[] = [];
db.auth.getSession = async () => ({
  data: { session: { access_token: "test-token", user: USER } },
  error: null,
});
db.auth.getUser = async () => ({ data: { user: USER }, error: null });
db.auth.onAuthStateChange = () => ({
  data: { subscription: { unsubscribe: () => {} } },
});
db.rpc = async (name: string) => {
  if (name === "cockpit_adopt_member") return { data: true, error: null };
  if (name === "cockpit_get_my_access")
    return {
      data: {
        email: USER.email,
        name: "Agent One",
        is_admin: false,
        is_ceo: false,
        // The page decides home from the roles, whatever the row says.
        home: null,
        cockpits: [],
        roles: seatRoles,
        clients: ["Harbor Dental"],
      },
      error: null,
    };
  return { data: null, error: { message: `No answer for ${name}` } };
};

// --- A DOM. ------------------------------------------------------------------
const { Window } = await import("happy-dom");
const win = new Window({ url: "https://cockpit.test/" });
const DOM: string[] = [
  "window",
  "document",
  "navigator",
  "localStorage",
  "HTMLElement",
  "HTMLAnchorElement",
  "HTMLButtonElement",
  "HTMLInputElement",
  "Element",
  "Node",
  "Event",
  "InputEvent",
  "MouseEvent",
  "KeyboardEvent",
  "PointerEvent",
  "FocusEvent",
  "MutationObserver",
  "ResizeObserver",
  "DocumentFragment",
  "Text",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "IS_REACT_ACT_ENVIRONMENT",
  // Radix reads these by name (a dialog, a switch) while it renders.
  ...Object.getOwnPropertyNames(win).filter(k =>
    /^(HTML|SVG)\w*Element$|^(CustomEvent|DOMRect|NodeFilter|Range)$/.test(k),
  ),
];
const globalsBefore = new Map(
  DOM.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]),
);
for (const k of DOM)
  Object.defineProperty(globalThis, k, {
    configurable: true,
    writable: true,
    value:
      k === "window"
        ? win
        : k === "IS_REACT_ACT_ENVIRONMENT"
          ? true
          : typeof (win as any)[k] === "function" && /^[a-z]/.test(k)
            ? (win as any)[k].bind(win)
            : (win as any)[k],
  });
const realError = console.error;
console.error = (...args: unknown[]) => {
  if (
    typeof args[0] === "string" &&
    (args[0].includes("not wrapped in act") ||
      args[0].includes("DialogContent") ||
      // The seat rows draw a Checkbox (a button) inside a button, as before.
      args[0].includes("cannot be a descendant of") ||
      args[0].includes("cannot contain a nested"))
  )
    return;
  realError(...args);
};

const { createRoot } = await import("react-dom/client");
const { act, createElement: h } = await import("react");
const { MemoryRouter, Route, Routes } = await import("react-router");
const { SupabaseAuthProvider } = await import(
  "../src/auth/SupabaseAuthProvider"
);
const { PortalHome } = await import("../src/pages/PortalHome");
const { MemberDialog, memberPayload, pickSeat, TEAM_ONLY_ROLE } = await import(
  "../src/pages/AdminPage"
);

const container = win.document.createElement("div");
win.document.body.appendChild(container);
const root = createRoot(container as any);

async function flush(times = 6) {
  for (let i = 0; i < times; i++)
    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });
}
const text = (el: any) => String(el?.textContent ?? "");
const page = () => text(win.document.body);
const button = (label: string) =>
  [...win.document.querySelectorAll("button")].find(
    b =>
      text(b).trim().startsWith(label) ||
      b.getAttribute("aria-label") === label,
  ) as any;
async function click(el: any) {
  expect(el).toBeTruthy();
  await act(async () => {
    el.click();
  });
  await flush(2);
}

afterEach(async () => {
  await act(async () => root.render(null));
  await flush(2);
});

afterAll(async () => {
  await act(async () => root.unmount());
  globalThis.fetch = realFetch;
  console.error = realError;
  db.rpc = real.rpc;
  db.auth.getSession = real.getSession;
  db.auth.getUser = real.getUser;
  db.auth.onAuthStateChange = real.onAuthStateChange;
  for (const [k, d] of globalsBefore)
    if (d) Object.defineProperty(globalThis, k, d);
    else delete g[k];
  envs.forEach((e, i) => {
    for (const [k, v] of Object.entries(envBefore[i]))
      if (v === undefined) delete e[k];
      else e[k] = v;
  });
  await win.happyDOM.close();
  expect(strayFetches).toEqual([]);
});

// ---------------------------------------------------------------------------

describe("the front door", () => {
  async function land(roles: string[]) {
    seatRoles = roles;
    await act(async () => {
      root.render(
        h(
          SupabaseAuthProvider,
          null,
          h(
            MemoryRouter,
            { initialEntries: ["/"] },
            h(
              Routes,
              null,
              h(Route, { path: "/", element: h(PortalHome) }),
              h(Route, { path: "/team", element: h("p", null, "TEAM PAGE") }),
              h(Route, {
                path: "/go/editor",
                element: h("p", null, "EDITOR DESK"),
              }),
            ),
          ),
        ),
      );
    });
    await flush();
  }

  test("a call center seat lands on Team meetings", async () => {
    await land(["call_center"]);
    expect(page()).toContain("TEAM PAGE");
    expect(page()).not.toContain("No cockpit on your account yet");
  });

  test("a seat with no role at all still says it has no cockpit", async () => {
    await land([]);
    expect(page()).toContain("No cockpit on your account yet");
    expect(page()).not.toContain("TEAM PAGE");
  });

  test("an editor still goes to the editor desk", async () => {
    await land(["editor"]);
    expect(page()).toContain("EDITOR DESK");
  });
});

describe("the Admin seat choice", () => {
  test("call center stands alone: it clears the cockpits and the reverse", () => {
    expect(pickSeat(["editor", "csm"], TEAM_ONLY_ROLE)).toEqual([
      "call_center",
    ]);
    expect(pickSeat(["call_center"], "editor")).toEqual(["editor"]);
    expect(pickSeat(["call_center"], "admin")).toEqual(["admin"]);
    expect(pickSeat(["call_center"], "call_center")).toEqual([]);
    expect(pickSeat(["editor"], "csm")).toEqual(["editor", "csm"]);
    expect(pickSeat(["editor", "csm"], "csm")).toEqual(["editor"]);
  });

  test("the payload never turns a call center seat's clients into all", () => {
    expect(
      memberPayload({
        email: " Agent@Example.com ",
        name: " Agent One ",
        roles: ["call_center"],
        allClients: true,
        clients: ["Harbor Dental"],
      }),
    ).toEqual({
      p_email: "agent@example.com",
      p_name: "Agent One",
      p_roles: ["call_center"],
      p_clients: ["Harbor Dental"],
    });
    expect(
      memberPayload({
        email: "editor@example.com",
        name: "Ed",
        roles: ["editor"],
        allClients: true,
        clients: ["Harbor Dental"],
      }).p_clients,
    ).toEqual([]);
  });

  test("the form saves a call center seat with its clients", async () => {
    const calls: { name: string; args: any }[] = [];
    let saved = 0;
    const fake = {
      rpc: async (name: string, args: any) => {
        calls.push({ name, args });
        return { data: null, error: null };
      },
    };
    await act(async () => {
      root.render(
        h(MemberDialog, {
          member: null,
          clientNames: ["Harbor Dental", "Cedar Clinic", "Oak Realty"],
          supabase: fake,
          onSaved: () => {
            saved += 1;
          },
          onClose: () => {},
        }),
      );
    });
    await flush();
    const email = win.document.querySelector("#m-email") as any;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(email),
        "value",
      )?.set;
      set?.call(email, "agent@example.com");
      email.dispatchEvent(new win.Event("input", { bubbles: true }) as any);
    });
    await flush(2);

    // A cockpit first, then Call center: the cockpit goes.
    await click(button("Editor desk"));
    expect(button("Editor desk").getAttribute("aria-pressed")).toBe("true");
    await click(button("Call center"));
    expect(button("Call center").getAttribute("aria-pressed")).toBe("true");
    expect(button("Editor desk").getAttribute("aria-pressed")).toBe("false");
    expect(page()).toContain(
      "Team meetings and the client performance table, for their own clients.",
    );

    // Its clients are required: no "All clients" switch, and no save yet.
    expect(page()).toContain("Clients (required)");
    expect(page()).toContain("Tick at least one to save.");
    expect(button("All clients")).toBeUndefined();
    expect(button("Add").disabled).toBe(true);

    await click(button("Cedar Clinic"));
    expect(button("Add").disabled).toBe(false);
    await click(button("Add"));
    await flush();
    expect(calls).toEqual([
      {
        name: "cockpit_admin_upsert_member",
        args: {
          p_email: "agent@example.com",
          p_name: "",
          p_roles: ["call_center"],
          p_clients: ["Cedar Clinic"],
        },
      },
    ]);
    expect(saved).toBe(1);
  });

  test("choosing a cockpit after Call center brings the All clients switch back", async () => {
    await act(async () => {
      root.render(
        h(MemberDialog, {
          member: {
            email: "agent@example.com",
            name: "Agent One",
            roles: ["call_center"],
            clients: [],
          },
          clientNames: ["Harbor Dental"],
          supabase: { rpc: async () => ({ data: null, error: null }) },
          onSaved: () => {},
          onClose: () => {},
        }),
      );
    });
    await flush();
    // An existing call center seat with no clients cannot be saved as is.
    expect(button("Save").disabled).toBe(true);
    expect(button("All clients")).toBeUndefined();
    await click(button("Creative director"));
    expect(button("Call center").getAttribute("aria-pressed")).toBe("false");
    expect(button("All clients")).toBeTruthy();
    expect(page()).toContain("Client access");
    expect(button("Save").disabled).toBe(false);
  });
});
