/**
 * One LTV writer and the agent's own login on the CEO cockpit (docs/forms/
 * WAVE56-CONTRACT.md 5.5, 5.7, section 8): the Lifetime value card's four
 * tiles, its state words and the held release; the Money tab's Apply while
 * cockpit_form_doors().ltv is false, replaced by one line when it is true;
 * the agent card's lines, the not-separated warning and Revoke; every door
 * closed says why and reads nothing. Stand-in apis only.
 *
 * Run: bun test scripts/ltv-card.test.tsx
 */
import { afterAll, describe, expect, test } from "bun:test";

// Nothing here may outlive this file: bun runs every test file in one
// process, so no module mocks, and every global and the env are put back.
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
globalThis.fetch = (async () => {
  throw new Error("This screen test makes no network calls.");
}) as typeof fetch;

const { Window } = await import("happy-dom");
const win = new Window({ url: "https://cockpit.test/ceo?tab=billing" });
const DOM: string[] = [
  "window",
  "document",
  "navigator",
  "localStorage",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLButtonElement",
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
  "matchMedia",
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
const { MotionGlobalConfig } = await import("framer-motion");
const skipBefore = MotionGlobalConfig.skipAnimations;
MotionGlobalConfig.skipAnimations = true;

const { createRoot } = await import("react-dom/client");
const { act, createElement: h } = await import("react");
const container = win.document.createElement("div");
win.document.body.appendChild(container);
const root = createRoot(container as any);
afterAll(async () => {
  await act(async () => root.unmount());
  MotionGlobalConfig.skipAnimations = skipBefore;
  console.error = realError;
  globalThis.fetch = realFetch;
  for (const [k, d] of globalsBefore)
    if (d) Object.defineProperty(globalThis, k, d);
    else delete (globalThis as any)[k];
  for (const [i, e] of envs.entries()) Object.assign(e, envBefore[i]);
  await win.happyDOM.close();
});
async function flush(times = 8) {
  for (let i = 0; i < times; i++)
    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });
}
async function render(el: any) {
  await act(async () => root.render(el));
  await flush();
}
const page = () =>
  String(win.document.body.textContent ?? "")
    .replace(/\s+/g, " ")
    .trim();
const button = (label: string, scope: any = win.document) =>
  [...scope.querySelectorAll("button")].find(
    (b: any) => String(b.textContent ?? "").trim() === label,
  ) as any;
async function click(el: any) {
  if (!el) throw new Error("Nothing to click");
  await act(async () => el.click());
  await flush();
}
async function type(input: any, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    win.HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new win.Event("input", { bubbles: true }));
  });
  await flush();
}

const billing = await import("../src/pages/ceo/BillingTab");
const money = await import("../src/pages/ceo/moneyImport");
const refusal = await import("../src/pages/ceo/ltvRefusal");

const OPEN = { open: true, why: null } as const;
const OFF = { open: false, why: "off" } as const;
const MISSING = { open: false, why: "missing" } as const;

const READ = {
  on: true,
  maxDeltaUsd: 5000,
  lastRun: {
    at: "2026-11-02T05:10:00Z",
    note: "LTV: 2 written, 1 held for the CEO, 4 missing a baseline.",
  },
  rows: [
    {
      taskId: "t1",
      client: "شركة العلا",
      card: 4000,
      target: 4021.2,
      delta: 21.2,
      state: "write",
      why: null,
    },
    {
      taskId: "t2",
      client: "Ardon Interiors",
      card: 2000,
      target: 2000,
      delta: 0,
      state: "same",
      why: null,
    },
    {
      taskId: "t3",
      client: "Dusk Arch",
      card: null,
      target: null,
      delta: null,
      state: "missing",
      why: "No starting value",
    },
    {
      taskId: "t4",
      client: "Out",
      card: 1,
      target: 1,
      delta: 0,
      state: "out_of_scope",
      why: null,
    },
  ],
  held: [
    {
      taskId: "t5",
      client: "Imperium Studio",
      target: 14000,
      card: 6000,
      delta: 8000,
      heldOn: "2026-11-02",
    },
  ],
  loggedWaiting: 2,
  secondSource: { differ: 0 },
};

function ltvApiOf(read: unknown = READ) {
  const calls: { name: string; args: any }[] = [];
  return {
    calls,
    api: {
      read: async () => {
        calls.push({ name: "read", args: null });
        return billing.toLtvRead(read);
      },
      release: async (p: any) => {
        calls.push({ name: "release", args: p });
        return "Written. It reaches the card within a few minutes.";
      },
    },
  };
}

describe("Lifetime value (5.5)", () => {
  test("the source line, the independent check, the four tiles and the state words", async () => {
    const { api } = ltvApiOf();
    await render(h(billing.LtvCard, { api, door: OPEN }));
    const t = page();
    expect(t).toContain(
      "The card's starting value plus every checked payment tied to the client since. Written to ClickUp each morning.",
    );
    expect(t).toContain("Matches the payments tied to each card.");
    expect(t).toContain("Cards up to date1");
    expect(t).toContain("Written today2");
    expect(t).toContain("Waiting for you1");
    expect(t).toContain("No starting value1");
    expect(t).toContain(
      "2 logged payments wait on a check and are not counted yet.",
    );
    expect(
      String(win.document.querySelector('[data-ltv-row="t1"]')?.textContent),
    ).toContain("· card $4,000 · cockpit $4,021 · +$21.20");
    expect(
      String(win.document.querySelector('[data-ltv-row="t1"]')?.textContent),
    ).toContain("Writes tomorrow morning");
    expect(
      String(win.document.querySelector('[data-ltv-row="t2"]')?.textContent),
    ).toContain("Same");
    expect(
      String(win.document.querySelector('[data-ltv-row="t3"]')?.textContent),
    ).toContain("card not known");
    expect(win.document.querySelector('[data-ltv-row="t4"]')).toBeNull();
    expect(
      String(win.document.querySelector('[data-ltv-held="t5"]')?.textContent),
    ).toContain("Held: over a $5,000 change");
    await render(h("div"));
  });

  test("Write it releases the held jump with its target, then says it is written", async () => {
    const { api, calls } = ltvApiOf();
    await render(h(billing.LtvCard, { api, door: OPEN }));
    await click(
      button("Write it", win.document.querySelector('[data-ltv-held="t5"]')),
    );
    expect(calls.find(c => c.name === "release")?.args).toMatchObject({
      taskId: "t5",
      target: 14000,
    });
    expect(page()).toContain(
      "Written. It reaches the card within a few minutes.",
    );
    await render(h("div"));
  });

  test("the writer off says so; differing cards are counted; a closed door reads nothing", async () => {
    const { api } = ltvApiOf({
      ...READ,
      on: false,
      secondSource: { differ: 3 },
    });
    await render(h(billing.LtvCard, { api, door: OPEN }));
    expect(page()).toContain(
      "The morning writer is off. Nothing is written to the card.",
    );
    expect(page()).toContain("3 cards differ from the payments tied to them.");
    await render(h("div"));
    for (const [door, line] of [
      [MISSING, "Opens after the next cockpit update."],
      [OFF, "Not switched on yet."],
    ] as const) {
      const closed = ltvApiOf();
      await render(h(billing.LtvCard, { api: closed.api, door }));
      expect(
        String(win.document.querySelector("[data-door-closed]")?.textContent),
      ).toBe(line);
      expect(closed.calls).toHaveLength(0);
      await render(h("div"));
    }
  });
});

describe("the Money tab's Apply follows cockpit_form_doors().ltv (5.5, X25)", () => {
  test("true: the Apply gives way to one line", async () => {
    await render(h(money.LtvApplyDoor, { ltvOpen: true }));
    expect(
      String(win.document.querySelector("[data-ltv-retired]")?.textContent),
    ).toBe(
      "Lifetime value is written by the cockpit every morning now. See the Billing tab.",
    );
    expect(refusal.LTV_RETIRED).toBe(
      "Lifetime value is written by the cockpit every morning now. See the Billing tab.",
    );
    expect(page()).not.toContain("Write cards to ClickUp");
    await render(h("div"));
  });
  test("false: the existing card and its Apply show as today", async () => {
    await render(h(money.LtvApplyDoor, { ltvOpen: false }));
    expect(win.document.querySelector("[data-ltv-retired]")).toBeNull();
    expect(page()).toContain("Lifetime value on the cards");
    await render(h("div"));
    // Not yet read: nothing shows, so neither writer flickers on screen.
    await render(h(money.LtvApplyDoor, { ltvOpen: null }));
    expect(page()).toBe("");
    await render(h("div"));
  });
  test("the Apply's action stays in the api map while it shows", async () => {
    const { readFileSync } = await import("node:fs");
    const api = readFileSync(
      new URL("../src/lib/cockpitApi.ts", import.meta.url),
      "utf8",
    );
    expect(api).toContain('"ceo.ltv.apply"');
    const tab = readFileSync(
      new URL("../src/pages/ceo/MoneyTab.tsx", import.meta.url),
      "utf8",
    );
    expect(tab).toContain("<LtvApplyDoor order={11} />");
    expect(tab).not.toContain("<LtvWriteCard");
  });
});

describe("the billing agent's login (5.7)", () => {
  const key = {
    id: 3,
    agent: "billing_agent",
    note: null,
    addedAt: "2026-11-05T09:00:00Z",
    revokedAt: null,
    revokedReason: null,
    lastCallAt: "2026-11-06T07:42:00Z",
    callsToday: 12,
  };
  const agentOf = (keys: unknown[], separated: boolean) => {
    const calls: { name: string; args: any }[] = [];
    return {
      calls,
      api: {
        read: async () => {
          calls.push({ name: "read", args: null });
          return { keys: keys as any, separated };
        },
        revoke: async (id: number, reason: string) => {
          calls.push({ name: "revoke", args: { id, reason } });
          return "Revoked. The agent cannot write until a new key is set on the server.";
        },
      },
    };
  };
  test("signed in with its own key, the not-separated warning, and Revoke asks why", async () => {
    const { api, calls } = agentOf([key], false);
    await render(h(billing.AgentCard, { api, door: OPEN }));
    expect(page()).toContain(
      "Signed in with its own key since 5 Nov · last call 10:42 on 6 Nov · 12 calls today",
    );
    expect(
      String(win.document.querySelector("[data-not-separated]")?.textContent),
    ).toBe(
      "The agent writes through its own key, but it can still read the old key on the server. A separate server user fixes this.",
    );
    await click(button("Revoke"));
    expect(page()).toContain("Why?");
    const form = win.document.querySelector("[data-agent-card] form") as any;
    await type(form.querySelector("input"), "The key leaked in a log.");
    await click(button("Revoke", form));
    expect(calls.find(c => c.name === "revoke")?.args).toEqual({
      id: 3,
      reason: "The key leaked in a log.",
    });
    expect(page()).toContain(
      "Revoked. The agent cannot write until a new key is set on the server.",
    );
    expect(page()).not.toMatch(/mak_|[0-9a-f]{64}/);
    await render(h("div"));
  });
  test("separated: no warning; no key yet: the old-access line; closed door: why", async () => {
    const sep = agentOf([key], true);
    await render(h(billing.AgentCard, { api: sep.api, door: OPEN }));
    expect(win.document.querySelector("[data-not-separated]")).toBeNull();
    await render(h("div"));
    const none = agentOf([], false);
    await render(h(billing.AgentCard, { api: none.api, door: OPEN }));
    expect(page()).toContain(
      "No key yet. The agent still uses the old access until the next deploy step.",
    );
    await render(h("div"));
    // After Revoke: the card says so and why, never "No key yet".
    const gone = agentOf(
      [
        {
          ...key,
          revokedAt: "2026-11-06T09:00:00Z",
          revokedReason: "The key leaked in a log",
          callsToday: 0,
        },
      ],
      true,
    );
    await render(h(billing.AgentCard, { api: gone.api, door: OPEN }));
    expect(
      String(win.document.querySelector("[data-agent-revoked]")?.textContent),
    ).toBe(
      "Revoked on 6 Nov: The key leaked in a log. The agent cannot write until a new key is set on the server.",
    );
    expect(page()).not.toContain("No key yet");
    await render(h("div"));
    // One call today reads "1 call".
    const one = agentOf([{ ...key, callsToday: 1 }], true);
    await render(h(billing.AgentCard, { api: one.api, door: OPEN }));
    expect(page()).toContain("· 1 call today");
    await render(h("div"));
    const shut = agentOf([key], false);
    await render(h(billing.AgentCard, { api: shut.api, door: MISSING }));
    expect(page()).toContain("Opens after the next cockpit update.");
    expect(shut.calls).toHaveLength(0);
    await render(h("div"));
  });
});
