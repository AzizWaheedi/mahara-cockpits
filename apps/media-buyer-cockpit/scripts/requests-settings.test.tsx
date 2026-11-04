/**
 * /requests/settings (docs/requests/CONTRACT.md 6.4, PLAN D17) in happy-dom,
 * over the cockpit's own client with the requests and alert-rule functions
 * answered by the made-up store in src/dev/requestsHarness.ts: an editor
 * gets Request types, People in ClickUp and Alerts, anyone else only their
 * own Alerts; the type editor saves only what changed with the version it
 * read, refuses a named owner nobody picked, shows a version clash with
 * Reload, lists versions and goes back to one, and keeps questions as they
 * are until the read carries their ClickUp ids; seat links are set by hand
 * and cleared; alert switches save at once, a failed request stays on, the
 * shift is set and given back. Every person, seat and id is made up.
 */
import {
  afterAll,
  afterEach,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from "bun:test";

// These screens run on real timers (the form's 250 ms debounce, the 3 s and
// 5 s re-reads), in one process with the database suites as ship.sh runs
// them, on a laptop several sessions share. A test that waits longer than
// bun's 5 s default under that load is slow, not wrong: it may take 20 s.
setDefaultTimeout(20_000);


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
  throw new Error("The requests settings test makes no network calls.");
}) as typeof fetch;

// --- The cockpit's client: the CEO signed in, the requests store behind rpc.
const { getCockpitSupabaseClient } = await import(
  "../src/auth/SupabaseAuthProvider"
);
const db = getCockpitSupabaseClient() as any;
const real = {
  rpc: db.rpc,
  getSession: db.auth.getSession,
  getUser: db.auth.getUser,
  onAuthStateChange: db.auth.onAuthStateChange,
};
const USER = {
  id: "auth-ceo-test",
  email: "ceo@example.test",
  email_confirmed_at: "2026-10-26T00:00:00Z",
  app_metadata: {},
  user_metadata: {},
};
db.auth.getSession = async () => ({
  data: { session: { access_token: "test-token", user: USER } },
  error: null,
});
db.auth.getUser = async () => ({ data: { user: USER }, error: null });
db.auth.onAuthStateChange = () => ({
  data: { subscription: { unsubscribe: () => {} } },
});

const { createRequestsFake } = await import("../src/dev/requestsHarness");
type Fake = ReturnType<typeof createRequestsFake>;
type Answer = {
  data: unknown;
  error: { message: string; code?: string } | null;
};
const NOW = Date.parse("2026-10-26T08:00:00Z"); // Monday 11:00 in Kuwait
let fake: Fake = createRequestsFake({ seat: "ceo", now: () => NOW });
/** Answers a call before the store does, once per name; null passes it on. */
let before: (name: string, args: any) => Answer | null = () => null;
db.rpc = async (name: string, args: any = {}) => {
  if (name === "cockpit_adopt_member") return { data: true, error: null };
  if (name === "cockpit_get_my_access")
    return {
      data: {
        email: USER.email,
        name: "The CEO",
        is_admin: true,
        is_ceo: true,
        home: "/ceo",
        cockpits: ["csm", "creative", "editor", "sales"],
        roles: [],
        clients: [],
      },
      error: null,
    };
  const first = before(name, args);
  if (first) return first;
  if (fake.handles(name)) return fake.call(name, args);
  return { data: null, error: { message: `No answer for ${name}` } };
};

// --- A DOM. ------------------------------------------------------------------
const { Window } = await import("happy-dom");
const win = new Window({ url: "https://cockpit.test/requests" });
const DOM: string[] = [
  "window",
  "document",
  "navigator",
  "localStorage",
  "HTMLElement",
  "HTMLAnchorElement",
  "HTMLButtonElement",
  "HTMLInputElement",
  "HTMLTextAreaElement",
  "HTMLSelectElement",
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
  if (typeof args[0] === "string" && args[0].includes("not wrapped in act"))
    return;
  realError(...args);
};

const { createRoot } = await import("react-dom/client");
const { act, createElement: h } = await import("react");
const { MemoryRouter } = await import("react-router");
const { SupabaseAuthProvider } = await import(
  "../src/auth/SupabaseAuthProvider"
);
const { RequestsSettings } = await import(
  "../src/pages/requests/RequestsSettings"
);
const { useLocation } = await import("react-router");

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
const squash = (s: string) => s.replace(/\s+/g, " ").trim();
const page = () => text(container);
const dialog = () => win.document.querySelector('[role="dialog"]') as any;
const buttonIn = (scope: any, label: string) =>
  [...(scope ?? container).querySelectorAll("button")].find(
    (b: any) =>
      text(b).trim() === label ||
      (!text(b).trim() && b.getAttribute("aria-label") === label),
  ) as any;
const chips = () =>
  [...container.querySelectorAll("[data-chip]")].map((c: any) =>
    squash(text(c)),
  );
async function click(el: any) {
  expect(el).toBeTruthy();
  await act(async () => {
    el.click();
  });
  await flush(4);
}
async function setValue(el: any, value: string) {
  expect(el).toBeTruthy();
  const proto =
    el.tagName === "TEXTAREA"
      ? win.HTMLTextAreaElement.prototype
      : el.tagName === "SELECT"
        ? win.HTMLSelectElement.prototype
        : win.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  await act(async () => {
    setter?.call(el, value);
    el.dispatchEvent(
      new win.Event(el.tagName === "SELECT" ? "change" : "input", {
        bubbles: true,
      }),
    );
  });
  await flush(3);
}
/** A switch by the first line of its label (the label holds two lines). */
const switchFor = (name: string) => {
  const l = [...container.querySelectorAll("label")].find(
    (x: any) => squash(text(x.querySelector("span"))) === name,
  ) as any;
  const id = l?.getAttribute("for");
  return id ? (win.document.getElementById(id) as any) : null;
};
const labelled = (scope: any, label: string) => {
  const l = [...(scope ?? container).querySelectorAll("label")].find(
    (x: any) => squash(text(x)) === label,
  ) as any;
  const id = l?.getAttribute("for");
  return id ? (win.document.getElementById(id) as any) : null;
};
let where = "";
function Where() {
  const l = useLocation();
  where = `${l.pathname}${l.search}`;
  return null;
}

async function render(path = "/requests/settings") {
  await act(async () => {
    root.render(
      h(
        SupabaseAuthProvider,
        null,
        h(
          MemoryRouter,
          { initialEntries: [path] },
          h(Where),
          h(RequestsSettings),
        ),
      ),
    );
  });
  await flush(8);
}
const typeRow = (label: string) =>
  [...container.querySelectorAll("li > button")].find((b: any) =>
    squash(text(b)).startsWith(label),
  ) as any;
const saves = () =>
  fake.calls.filter(c => c.name === "cockpit_request_type_save");

afterEach(async () => {
  await act(async () => root.render(null));
  await flush(2);
  fake = createRequestsFake({ seat: "ceo", now: () => NOW });
  before = () => null;
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

describe("/requests/settings, the tabs by seat", () => {
  test("an editor gets the three tabs and the Slack notices link", async () => {
    await render();
    expect(chips()).toEqual(["Request types", "People in ClickUp", "Alerts"]);
    const slack = [...container.querySelectorAll("a")].find(
      (a: any) => text(a) === "Slack notices",
    ) as any;
    expect(slack?.getAttribute("href")).toBe("/client-success/notices");
    expect(page()).toContain("The 12 kinds of request the team can raise.");
    // A pill is an address, so a link can open the tab (the bell's
    // "Alert settings" opens ?tab=alerts).
    await click(container.querySelector('[data-chip="people"]'));
    expect(where).toBe("/requests/settings?tab=people");
    expect(page()).toContain("Each seat's ClickUp user");
  });

  test("a seat that is not an editor sees only its own alerts", async () => {
    fake = createRequestsFake({ seat: "csm", now: () => NOW });
    await render("/requests/settings?tab=types");
    expect(chips()).toEqual([]);
    expect(page()).toContain("Your alerts");
    expect(page()).not.toContain("Request types");
    expect(fake.calls.some(c => c.name === "cockpit_member_clickup_read")).toBe(
      false,
    );
    // A client success seat may read the Slack notices page.
    const slack = [...container.querySelectorAll("a")].find(
      (a: any) => text(a) === "Slack notices",
    ) as any;
    expect(slack?.getAttribute("href")).toBe("/client-success/notices");
  });

  test("Slack notices is linked only for a seat its page lets in", async () => {
    // The notices page reads for an editor, a client success or a creative
    // seat (cockpit_slack_notice_viewer); a sales seat would land on its
    // refusal, which links back here.
    fake = createRequestsFake({ seat: "sales", now: () => NOW });
    await render();
    expect(page()).toContain("Your alerts");
    expect(
      [...container.querySelectorAll("a")].some(
        (a: any) => text(a) === "Slack notices",
      ),
    ).toBe(false);
    expect(page()).not.toContain("Slack notices");
  });

  test("while the seat is read, no Slack notices link shows yet", async () => {
    let release: (() => void) | null = null;
    const held = new Promise<void>(r => {
      release = r;
    });
    const realRpc = db.rpc;
    db.rpc = async (name: string, args: any = {}) => {
      if (name === "cockpit_request_types_read") await held;
      return realRpc(name, args);
    };
    try {
      await render();
      expect(page()).toContain("Reading your seat");
      expect(page()).not.toContain("Slack notices");
      (release as unknown as () => void)();
      await flush(6);
      expect(page()).toContain("Slack notices");
    } finally {
      db.rpc = realRpc;
    }
  });
});

describe("request types", () => {
  /** A ClickUp option id (uuid) anywhere in some words. */
  const OPTION_ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

  test("one row a type: where each task goes, its owner, its SOP and the due rule", async () => {
    // The editor's read as cockpit_request_types_read sends it (2.5, I1):
    // fieldSpecs, where a choice kept in a ClickUp field has no options.
    await render();
    const read = fake.call("cockpit_request_types_read").data as any;
    const spec = read.types
      .find((t: any) => t.key === "low_schedule_rate")
      .fieldSpecs.find((f: any) => f.key === "schedule_rate_issue");
    expect(spec.options).toBeNull();
    const pause = squash(text(typeRow("Client pause")));
    expect(pause).toContain("Operations / Tech, the systems manager");
    expect(pause).toContain("Marketing / ADs, the media buyer of record");
    expect(pause).toContain("Template");
    // Each task names its template, so two parts never read the same (D11).
    expect(pause).toContain("Client Pause ⏸️ (Tech)");
    expect(pause).toContain("Client Pause ⏸️ (Media)");
    expect(pause).toContain("Due in 2 days");
    // Parts that differ by their "runs when" say it, with the choices'
    // names from the field catalog, never their ClickUp ids.
    const low = squash(text(typeRow("Low schedule rate")));
    expect(low).toContain(
      'Call Center, the client\'s CSM, when "Where is the problem?" is Call Center Issue or Both',
    );
    expect(low).toContain(
      'Marketing / ADs, the media buyer of record, when "Where is the problem?" is Ads issue or Both',
    );
    const ads = squash(text(typeRow("Create an ad account")));
    for (const platform of ["Facebook/Meta", "Tiktok", "Snapchat"])
      expect(ads).toContain(
        `Marketing / ADs, the media buyer of record, when "Ad platform" is ${platform}`,
      );
    expect(low).not.toMatch(OPTION_ID);
    expect(ads).not.toMatch(OPTION_ID);
    expect(squash(text(typeRow("General tech request")))).toContain(
      "5 draft steps",
    );
  });

  test("on a database from before I1 (no fieldSpecs) the rows name the choices too", async () => {
    fake = createRequestsFake({ seat: "ceo", now: () => NOW, specs: false });
    await render();
    const low = squash(text(typeRow("Low schedule rate")));
    expect(low).toContain(
      'when "Where is the problem?" is Call Center Issue or Both',
    );
    expect(squash(text(typeRow("Create an ad account")))).toContain(
      'when "Ad platform" is Facebook/Meta',
    );
  });

  test("runs-when words: the form's choices, then the spec's, then the catalog; an unknown answer is never its id", async () => {
    const { partWhenWords } = await import(
      "../src/pages/requests/TypeEditor"
    );
    const read = fake.call("cockpit_request_types_read").data as any;
    const ads = read.types.find((t: any) => t.key === "create_ad_account");
    // The question's own choices came back empty (its ClickUp field went
    // missing in the hourly read): the catalog the editor read still names
    // the platform.
    const missing = {
      ...ads,
      fields: ads.fields.map((f: any) =>
        f.key === "ads_platform" ? { ...f, options: [] } : f,
      ),
    };
    expect(partWhenWords(missing, "meta", read.catalog)).toBe(
      'when "Ad platform" is Facebook/Meta',
    );
    // Nothing names it: said as a choice that could not be read.
    expect(partWhenWords(missing, "meta", null)).toBe(
      'when "Ad platform" is a choice that could not be read from ClickUp',
    );
    // A cockpit-only choice keeps its own options in the stored spec.
    const own = {
      ...ads,
      fields: ads.fields.map((f: any) =>
        f.key === "ads_platform" ? { ...f, options: [] } : f,
      ),
      fieldSpecs: ads.fieldSpecs.map((f: any) =>
        f.key === "ads_platform"
          ? {
              ...f,
              clickup_field_id: null,
              options: [
                { id: "88d55b4b-f296-4a0b-abc6-3b228889444a", name: "Meta" },
              ],
            }
          : f,
      ),
    };
    expect(partWhenWords(own, "meta", null)).toBe('when "Ad platform" is Meta');
    // A part that always runs says nothing.
    const pause = read.types.find((t: any) => t.key === "client_pause");
    expect(partWhenWords(pause, "tech", read.catalog)).toBeNull();
  });

  test("Create an ad account saves a due change: its three platform tasks share a board and a name, never one request (C3)", async () => {
    await render();
    await click(typeRow("Create an ad account"));
    expect(cards()).toHaveLength(3);
    await setValue(labelled(dialog(), "Due in, working days"), "4");
    await click(buttonIn(dialog(), "Save"));
    expect(text(dialog())).not.toContain("two tasks would have the same name");
    expect(saves()).toHaveLength(1);
    expect(saves()[0].args).toEqual({
      p_key: "create_ad_account",
      p_patch: { due_days: 4 },
      p_expected_version: 1,
    });
    // Naming the media buyer of record on one platform's task saves too.
    await setValue(labelled(cards()[0], "Named person"), "120000001");
    await click(buttonIn(dialog(), "Save"));
    expect(saves()).toHaveLength(2);
    expect(saves()[1].args.p_patch.targets[0]).toMatchObject({
      part: "meta",
      owner_clickup_id: 120000001,
    });
    // One request could make two of them once Meta also runs for TikTok:
    // two tasks named the same on one board, refused before the save.
    const tiktok = [...cards()[0].querySelectorAll("label")].find(
      (l: any) => squash(text(l)) === "Tiktok",
    ) as any;
    await click(tiktok.querySelector("input"));
    await click(buttonIn(dialog(), "Save"));
    expect(text(dialog())).toContain(
      "Marketing / ADs: two tasks would have the same name. Give one a different name ending.",
    );
    expect(saves()).toHaveLength(2);
  });

  test("two tasks clash only when one request can make both", async () => {
    const { bothRun } = await import("../src/pages/requests/TypeEditor");
    const on = (field_key: string, ...options: string[]) => ({
      field_key,
      options,
    });
    expect(bothRun(on("ads_platform", "meta"), on("ads_platform", "tiktok"))).toBe(
      false,
    );
    expect(
      bothRun(on("ads_platform", "meta", "tiktok"), on("ads_platform", "tiktok")),
    ).toBe(true);
    expect(bothRun(on("ads_platform", "meta"), null)).toBe(true);
    expect(bothRun(null, null)).toBe(true);
    expect(bothRun(on("ads_platform", "meta"), on("other", "meta"))).toBe(true);
  });

  test("a type whose steps came from the template's source task explains them once (D14)", async () => {
    await render();
    await click(typeRow("WhatsApp connection issue"));
    const all = squash(text(dialog()));
    expect(all).toContain(
      "From the template's source task. Added as a checklist to a task made without a template, or when the template has no checklist.",
    );
    expect(all.split("Added as a checklist").length).toBe(2);
    expect(all).not.toContain("Added only when the template brings no checklist.");
  });

  test("the On/Off switch saves at once with the version it read", async () => {
    await render();
    const sw = [...container.querySelectorAll('[role="switch"]')].find(
      (s: any) => s.getAttribute("aria-label")?.startsWith("Client pause"),
    ) as any;
    expect(sw.getAttribute("aria-checked")).toBe("true");
    await click(sw);
    expect(saves()[0].args).toEqual({
      p_key: "client_pause",
      p_patch: { enabled: false },
      p_expected_version: 1,
    });
    const after = [...container.querySelectorAll('[role="switch"]')].find(
      (s: any) => s.getAttribute("aria-label")?.startsWith("Client pause"),
    ) as any;
    expect(after.getAttribute("aria-checked")).toBe("false");
  });

  test("the editor saves only what changed, then reads the new version", async () => {
    await render();
    await click(typeRow("General tech request"));
    const d = dialog();
    expect(squash(text(d))).toContain("version 1");
    expect(squash(text(d))).toContain("Draft: check with the systems manager.");
    await setValue(labelled(d, "Name in the cockpit"), "General tech ask");
    await setValue(labelled(d, "Due in, working days"), "3");
    await click(buttonIn(d, "Add a step"));
    const steps = [
      ...d.querySelectorAll('input[aria-label^="Step "]'),
    ] as any[];
    await setValue(steps[steps.length - 1], "Tell the requester it is done.");
    await click(buttonIn(d, "Save"));
    const sent = saves()[0].args;
    expect(Object.keys(sent.p_patch).sort()).toEqual([
      "due_days",
      "label",
      "sop_steps",
    ]);
    expect(sent.p_patch.label).toBe("General tech ask");
    expect(sent.p_patch.due_days).toBe(3);
    expect(sent.p_patch.sop_steps.at(-1)).toBe(
      "Tell the requester it is done.",
    );
    expect(sent.p_expected_version).toBe(1);
    expect(squash(text(dialog()))).toContain("version 2");
    expect(buttonIn(dialog(), "Saved")).toBeTruthy();
  });

  test("a named owner must be picked before the save goes", async () => {
    await render();
    await click(typeRow("General tech request"));
    const d = dialog();
    await setValue(labelled(d, "Who owns it"), "person");
    await setValue(labelled(d, "The person"), "");
    await click(buttonIn(d, "Save"));
    expect(text(dialog())).toContain(
      "Operations / Tech: pick the person who owns it.",
    );
    expect(saves()).toEqual([]);
    await setValue(labelled(dialog(), "The person"), "120000001");
    await click(buttonIn(dialog(), "Save"));
    expect(saves()[0].args.p_patch.targets[0]).toMatchObject({
      owner_rule: "person",
      owner_clickup_id: 120000001,
    });
  });

  test("a version clash says so and offers Reload", async () => {
    await render();
    await click(typeRow("General tech request"));
    before = name =>
      name === "cockpit_request_type_save"
        ? {
            data: null,
            error: {
              message:
                "Someone saved this type since you opened it. Reload to see their change.",
              code: "40001",
            },
          }
        : null;
    await setValue(labelled(dialog(), "Due in, working days"), "4");
    await click(buttonIn(dialog(), "Save"));
    expect(text(dialog())).toContain(
      "Someone saved this type since you opened it. Reload to see their change.",
    );
    const reads = fake.calls.filter(
      c => c.name === "cockpit_request_types_read",
    ).length;
    await click(buttonIn(dialog(), "Reload"));
    expect(
      fake.calls.filter(c => c.name === "cockpit_request_types_read").length,
    ).toBe(reads + 1);
  });

  test("Versions lists each save and goes back to one", async () => {
    await render();
    await click(typeRow("General tech request"));
    await setValue(labelled(dialog(), "Due in, working days"), "5");
    await click(buttonIn(dialog(), "Save"));
    await click(buttonIn(dialog(), "Versions"));
    expect(squash(text(dialog()))).toContain("Version 2 (this one)");
    expect(squash(text(dialog()))).toContain(
      "Seeded 2026-10-26 from docs/requests/request-types.json",
    );
    await click(buttonIn(dialog(), "Go back to version 1"));
    const restore = fake.calls.find(
      c => c.name === "cockpit_request_type_restore",
    );
    expect(restore?.args).toEqual({
      p_key: "general_tech",
      p_version: 1,
      p_expected_version: 2,
    });
    expect(squash(text(dialog()))).toContain("version 3");
    expect((labelled(dialog(), "Due in, working days") as any).value).toBe("2");
  });

  test("going back to a version never turns Set Request Type back on, and the toast says why (review round 2)", async () => {
    const { toast } = await import("sonner");
    const said: string[] = [];
    const realSuccess = toast.success;
    toast.success = ((m: unknown) => {
      said.push(String(m));
      return 0;
    }) as typeof toast.success;
    try {
      await render();
      await click(typeRow("General tech request"));
      const rt = () => {
        const l = [...dialog().querySelectorAll("label")].find(
          (x: any) =>
            squash(text(x.querySelector("span"))) ===
            "Set Request Type in ClickUp",
        ) as any;
        return win.document.getElementById(l?.getAttribute("for")) as any;
      };
      // Version 2 turns it on, version 3 (a 2-minute check, or an editor) off.
      expect(rt().getAttribute("data-state")).toBe("unchecked");
      await click(rt());
      await click(buttonIn(dialog(), "Save"));
      expect(saves().at(-1)?.args.p_patch).toEqual({ set_request_type: true });
      await click(rt());
      await click(buttonIn(dialog(), "Save"));
      expect(saves().at(-1)?.args.p_patch).toEqual({ set_request_type: false });
      await click(buttonIn(dialog(), "Versions"));
      await click(buttonIn(dialog(), "Go back to version 2"));
      expect(said.at(-1)).toBe(
        "Back to version 2. Request Type stays off. Version 2 had it on, but it is off now; turn it on with its switch once the rehearsal ticket shows ClickUp keeps the task where it is.",
      );
      expect(rt().getAttribute("data-state")).toBe("unchecked");
      // A version that had it off says the usual.
      await click(buttonIn(dialog(), "Versions"));
      await click(buttonIn(dialog(), "Go back to version 1"));
      expect(said.at(-1)).toBe("Back to version 1. The next request uses it.");
    } finally {
      toast.success = realSuccess;
    }
  });

  // The task cards in the type editor ("Where it goes"), each with its own
  // List, owner, name ending and Runs fields.
  const cards = () =>
    [...dialog().querySelectorAll("li")].filter((li: any) =>
      text(li).includes("Who owns it"),
    ) as any[];

  test("a task can be added to a type and taken off again (ask 3, round 2)", async () => {
    await render();
    await click(typeRow("General tech request"));
    expect(squash(text(dialog()))).toContain("Where it goes");
    // One task: nothing to take off.
    expect(buttonIn(dialog(), "Remove this task")).toBeUndefined();
    await click(buttonIn(dialog(), "Add a task"));
    expect(squash(text(dialog()))).toContain("Where its 2 tasks go");
    expect(cards()).toHaveLength(2);
    // The first board the type does not use yet, with that board's owner.
    expect(squash(text(cards()[1]))).toContain(
      "Client Success (Client Success task)",
    );
    expect(labelled(cards()[1], "Who owns it").value).toBe("csm_of_card");
    // Moved to another board, its untouched name ending and owner follow.
    await setValue(labelled(cards()[1], "List"), "901816723196");
    expect(squash(text(cards()[1]))).toContain("Marketing / ADs (Ads task)");
    expect(labelled(cards()[1], "Name ending").value).toBe(" (Ads)");
    expect(labelled(cards()[1], "Who owns it").value).toBe(
      "media_buyer_of_record",
    );
    await click(buttonIn(dialog(), "Save"));
    const sent = saves()[0].args;
    expect(Object.keys(sent.p_patch)).toEqual(["targets"]);
    expect(sent.p_expected_version).toBe(1);
    expect(sent.p_patch.targets.map((t: any) => t.part)).toEqual([
      "main",
      "ads",
    ]);
    // Saved under its board's name, a short name the guard accepts.
    expect(sent.p_patch.targets[1]).toEqual({
      part: "ads",
      name_suffix: " (Ads)",
      list_id: "901816723196",
      team: "ads",
      template_id: null,
      template_name: null,
      owner_rule: "media_buyer_of_record",
      owner_clickup_id: null,
      when: null,
    });
    expect(squash(text(dialog()))).toContain("version 2");
    expect(squash(text(dialog()))).toContain("Where its 2 tasks go");
    // The type's row names both tasks.
    expect(squash(text(typeRow("General tech request")))).toContain(
      "Marketing / ADs, the media buyer of record",
    );
    // Taken off again, with the version it read.
    await click(buttonIn(cards()[1], "Remove this task"));
    expect(cards()).toHaveLength(1);
    expect(buttonIn(dialog(), "Remove this task")).toBeUndefined();
    await click(buttonIn(dialog(), "Save"));
    expect(saves()[1].args.p_patch.targets.map((t: any) => t.part)).toEqual([
      "main",
    ]);
    expect(saves()[1].args.p_expected_version).toBe(2);
  });

  test("three tasks at most, and two tasks never share one name on one board", async () => {
    await render();
    await click(typeRow("Low schedule rate"));
    expect(cards()).toHaveLength(2);
    await click(buttonIn(dialog(), "Add a task"));
    expect(cards()).toHaveLength(3);
    expect(buttonIn(dialog(), "Add a task")).toBeUndefined();
    expect(text(dialog())).toContain(
      "A request makes 1 to 3 tasks, each on a team's board.",
    );
    // The third on the Call Center board with the first one's name ending.
    await setValue(labelled(cards()[2], "List"), "901816723206");
    await setValue(labelled(cards()[2], "Name ending"), " (Call Center)");
    await click(buttonIn(dialog(), "Save"));
    expect(text(dialog())).toContain(
      "Call Center: two tasks would have the same name. Give one a different name ending.",
    );
    expect(saves()).toEqual([]);
  });

  test("a task's Runs choice: every time, or when a choice question is picked", async () => {
    await render();
    await click(typeRow("Low schedule rate"));
    const runs = (i: number) => labelled(cards()[i], "Runs");
    expect(runs(0).value).toBe("schedule_rate_issue");
    expect(
      [...runs(0).querySelectorAll("option")].map((o: any) => text(o)),
    ).toEqual(["Every time", 'Depending on "Where is the problem?"']);
    // The answers it runs for, by name, under the question in quotes.
    expect(squash(text(cards()[0]))).toContain(
      'Runs when "Where is the problem?" is',
    );
    // Each Remove names its task to a screen reader.
    const remove = buttonIn(cards()[1], "Remove this task");
    expect(
      win.document.getElementById(remove.getAttribute("aria-describedby"))
        ?.textContent,
    ).toBe("Marketing / ADs (Ads task)");
    // Every time: the answers it ran for go.
    await setValue(runs(0), "");
    expect(text(cards()[0])).not.toContain("Runs when");
    // Back to a choice: it needs at least one answer before the save goes.
    await setValue(runs(0), "schedule_rate_issue");
    await click(buttonIn(dialog(), "Save"));
    expect(text(dialog())).toContain(
      "Call Center: pick at least one answer it runs for.",
    );
    expect(saves()).toEqual([]);
    await setValue(runs(0), "");
    await click(buttonIn(dialog(), "Save"));
    const targets = saves()[0].args.p_patch.targets;
    expect(targets[0].when).toBeNull();
    expect(targets[1].when.field_key).toBe("schedule_rate_issue");
    expect(targets.map((t: any) => t.part)).toEqual(["call_center", "ads"]);
  });

  test("questions stay as they are until the read carries their ClickUp ids", async () => {
    // A database from before I1: no fieldSpecs in the editor's read.
    fake = createRequestsFake({ seat: "ceo", now: () => NOW, specs: false });
    await render();
    await click(typeRow("Low schedule rate"));
    expect(text(dialog())).toContain(
      "Questions can be reworded, reordered or added here once the database sends each question's ClickUp link with this read.",
    );
    expect(dialog().querySelector('input[aria-label="Question 1"]')).toBeNull();
  });

  test("with the ClickUp ids, a reworded question keeps its ClickUp field", async () => {
    fake = createRequestsFake({ seat: "ceo", now: () => NOW, specs: true });
    await render();
    await click(typeRow("Low schedule rate"));
    const q = [
      ...dialog().querySelectorAll('input[aria-label^="Question "]'),
    ].find((i: any) => i.value === "Notes") as any;
    await setValue(q, "Anything else?");
    // The question a task's "runs when" reads cannot be removed.
    expect(text(dialog())).toContain("Decides which tasks run, so it stays.");
    await click(buttonIn(dialog(), "Save"));
    const fields = saves()[0].args.p_patch.fields;
    expect(fields.find((f: any) => f.key === "additional_notes")).toEqual({
      key: "additional_notes",
      label: "Anything else?",
      kind: "text",
      clickup_field_id: "6742edfb-9b6f-4615-933d-7ebd74f9542b",
      required: false,
      options: null,
      help: null,
    });
  });
});

describe("people in ClickUp", () => {
  test("each seat's link, how it was made, set by hand and cleared", async () => {
    await render("/requests/settings?tab=people");
    expect(page()).toContain("People in ClickUp");
    expect(page()).toContain("2 seats are not linked.");
    const row = (label: string) =>
      [...container.querySelectorAll("li")].find((li: any) =>
        text(li).startsWith(label),
      ) as any;
    expect(squash(text(row("Sara, CSM")))).toContain("Sara, matched by email");
    // One line a seat, never the same fact twice (D10).
    const faris = squash(text(row("Faris, closer")));
    expect(faris).toContain("No ClickUp member has this seat's email.");
    expect(faris).not.toContain("No match by email");
    const callers = squash(text(row("Call centre")));
    expect(callers).toContain("Two ClickUp members have this seat's email.");
    expect(callers).not.toContain("Two matches by email");
    const yousef = squash(text(row("Yousef, media buyer")));
    expect(yousef).toContain("set by hand");
    expect(yousef).not.toContain("Set by an editor.");
    // Clear on every row that holds a link or a match result (round 2): an
    // email match too, since one ClickUp user holds one seat and clearing
    // is how it moves; on an unlinked seat it records "no ClickUp user".
    expect(buttonIn(row("Yousef, media buyer"), "Clear")).toBeTruthy();
    expect(buttonIn(row("Sara, CSM"), "Clear")).toBeTruthy();
    expect(buttonIn(row("Faris, closer"), "Clear")).toBeTruthy();
    expect(buttonIn(row("Call centre"), "Clear")).toBeTruthy();
    await setValue(row("Faris, closer").querySelector("select"), "120000002");
    const set = fake.calls.find(c => c.name === "cockpit_member_clickup_set");
    expect(set?.args).toEqual({
      p_member_id: "m-sales",
      p_clickup_user_id: 120000002,
    });
    expect(squash(text(row("Faris, closer")))).toContain("Huda, set by hand");
    await click(buttonIn(row("Faris, closer"), "Clear"));
    const cleared = fake.calls.filter(
      c => c.name === "cockpit_member_clickup_set",
    );
    expect(cleared.at(-1)?.args).toEqual({
      p_member_id: "m-sales",
      p_clickup_user_id: null,
    });
    expect(squash(text(row("Faris, closer")))).toContain("Cleared by hand");
    expect(buttonIn(row("Faris, closer"), "Clear")).toBeUndefined();
  });

  test("a ClickUp person already linked to another seat names that seat", async () => {
    await render("/requests/settings?tab=people");
    const row = (label: string) =>
      [...container.querySelectorAll("li")].find((li: any) =>
        text(li).startsWith(label),
      ) as any;
    // Sara's ClickUp user, picked for Faris: refused with 23505.
    await setValue(row("Faris, closer").querySelector("select"), "113688800");
    const refusal = squash(text(row("Faris, closer")));
    expect(refusal).toContain(
      "That ClickUp person is already linked to Sara, CSM. Clear that link first.",
    );
    expect(refusal).not.toContain("duplicate key");
  });

  test("an email-matched link can be cleared, and its ClickUp user then linked to another seat", async () => {
    await render("/requests/settings?tab=people");
    const row = (label: string) =>
      [...container.querySelectorAll("li")].find((li: any) =>
        text(li).startsWith(label),
      ) as any;
    expect(squash(text(row("Sara, CSM")))).toContain("Sara, matched by email");
    // The sentence the refusal gives can be followed on this screen.
    await setValue(row("Faris, closer").querySelector("select"), "113688800");
    expect(text(row("Faris, closer"))).toContain("Clear that link first.");
    await click(buttonIn(row("Sara, CSM"), "Clear"));
    const sets = () =>
      fake.calls.filter(c => c.name === "cockpit_member_clickup_set");
    expect(sets().at(-1)?.args).toEqual({
      p_member_id: "m-csm",
      p_clickup_user_id: null,
    });
    expect(squash(text(row("Sara, CSM")))).toContain("Cleared by hand");
    await setValue(row("Faris, closer").querySelector("select"), "113688800");
    expect(sets().at(-1)?.args).toEqual({
      p_member_id: "m-sales",
      p_clickup_user_id: 113688800,
    });
    const faris = squash(text(row("Faris, closer")));
    expect(faris).toContain("Sara, set by hand");
    expect(faris).not.toContain("Clear that link first.");
  });
});

describe("alerts", () => {
  test("the eight kinds, a failed request always on, a switch saves at once", async () => {
    fake = createRequestsFake({ seat: "csm", now: () => NOW });
    await render();
    const switches = [
      ...container.querySelectorAll('[role="switch"]'),
    ] as any[];
    expect(switches.length).toBe(8);
    const failed = switchFor("A failed request");
    expect(failed?.getAttribute("aria-checked")).toBe("true");
    expect(failed?.disabled).toBe(true);
    expect(squash(text(failed?.closest("li")))).toContain("Always on.");
    const comment = switchFor("A comment on your task");
    await click(comment);
    const set = fake.calls.find(c => c.name === "cockpit_task_alert_rules_set");
    expect(set?.args.p_member_id).toBe("m-csm");
    expect(set?.args.p_patch.kinds).toEqual([
      "assigned",
      "due_today",
      "overdue",
      "mention",
      "status",
      "request_done",
      "request_failed",
    ]);
    expect(comment.getAttribute("aria-checked")).toBe("false");
    expect(page()).toContain(
      "Slack: new assignments already post in your team's channel. Slack messages for these alerts are not switched on yet.",
    );
    // ClickUp names nobody as the mover, so a seat's own move there alerts
    // it too (contract 3.2, F9): the hint says so, never "someone else".
    expect(squash(text(switchFor("Your task moved")?.closest("li")))).toContain(
      "When its status changes, also when you move it in ClickUp yourself.",
    );
    expect(page()).not.toContain("someone else changes its status");
  });

  test("the shift: from the schedule, then set here, then back", async () => {
    fake = createRequestsFake({ seat: "csm", now: () => NOW });
    await render();
    expect(squash(page())).toContain(
      "09:00 to 17:00, Sunday to Thursday. From your schedule.",
    );
    await click(buttonIn(container, "Set the hours here"));
    await setValue(labelled(container, "Starts"), "18:00");
    await setValue(labelled(container, "Ends"), "09:00");
    await click(buttonIn(container, "Save the hours"));
    expect(page()).toContain("Shift: the end comes after the start.");
    await setValue(labelled(container, "Starts"), "08:30");
    await setValue(labelled(container, "Ends"), "16:30");
    await click(buttonIn(container, "Save the hours"));
    expect(squash(page())).toContain(
      "08:30 to 16:30, Sunday to Thursday. Set here.",
    );
    await click(buttonIn(container, "Use the schedule"));
    const last = fake.calls
      .filter(c => c.name === "cockpit_task_alert_rules_set")
      .at(-1);
    expect(last?.args.p_patch).toEqual({ shiftStart: null, shiftEnd: null });
    expect(squash(page())).toContain("From your schedule.");
  });

  test("an editor can open another seat's alerts", async () => {
    await render("/requests/settings?tab=alerts");
    expect(page()).toContain("Your alerts");
    await setValue(labelled(container, "Seat"), "m-buyer");
    await flush(4);
    const read = fake.calls
      .filter(c => c.name === "cockpit_task_alert_rules_read")
      .at(-1);
    expect(read?.args).toEqual({ p_member_id: "m-buyer" });
    expect(page()).toContain("Alerts for Yousef, media buyer");
  });

  test("before the alert functions are on the database, it says so", async () => {
    fake = createRequestsFake({ seat: "csm", now: () => NOW });
    before = name =>
      name === "cockpit_task_alert_rules_read"
        ? {
            data: null,
            error: { message: "Could not find the function", code: "PGRST202" },
          }
        : null;
    await render();
    expect(page()).toContain(
      "Task alerts are not on the database yet. They switch on with the next release.",
    );
  });
});
