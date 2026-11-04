import { afterAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";

const win = new Window({
  url: "https://example.test/client-success/clients/example/research",
});
for (const k of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLButtonElement",
  "HTMLTextAreaElement",
  "Element",
  "Node",
  "Event",
  "CustomEvent",
  "MouseEvent",
  "DocumentFragment",
  "Text",
  "NodeFilter",
  "MutationObserver",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
])
  Object.defineProperty(globalThis, k, {
    configurable: true,
    writable: true,
    value:
      k === "window"
        ? win
        : typeof (win as any)[k] === "function" && /^[a-z]/.test(k)
          ? (win as any)[k].bind(win)
          : (win as any)[k],
  });
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const { createElement, act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MemoryRouter } = await import("react-router");
const { MarketResearchCard, ResearchDetail } = await import(
  "../src/components/MarketResearch"
);
const { readResearch, researchView, safeResearchUrl } = await import(
  "../src/lib/marketResearch"
);

const competitor = {
  cid: "C1",
  reserve: false,
  name: "Example Studio",
  placeUrl: null,
  website: "javascript:alert(1)",
  rating: null,
  reviewsN: 0,
  adsActiveN: 2,
  longestAdDays: 30,
  flagged: false,
};
const result = {
  state: "done",
  on: true,
  canRerun: true,
  sentence: "Research complete.",
  run: {
    id: "00000000-0000-4000-8000-000000000001",
    mode: "shadow",
    requestedAt: "2026-11-01T12:00:00Z",
    finishedAt: null,
    sourcesN: 4,
    competitorsN: 1,
    usd: 0.42,
    docUrl: null,
  },
  competitors: [competitor],
};
const makeClient = (
  data: unknown,
  options?: { actorChange?: boolean; err?: boolean },
) => {
  let reads = 0;
  const calls: unknown[] = [];
  const client = {
    auth: {
      getSession: async () => ({
        data: {
          session: {
            user: { id: options?.actorChange && reads++ ? "other" : "actor" },
          },
        },
        error: null,
      }),
    },
    functions: {
      invoke: async (_name: string, payload: any) => {
        calls.push(payload);
        return {
          data:
            payload.body.operation === "marketIntel.view" ? data : { ok: true },
          error: options?.err
            ? {
                context: new Response(
                  JSON.stringify({ error: "Access denied." }),
                  { status: 403 },
                ),
              }
            : null,
        };
      },
    },
  };
  return { client: client as any, calls };
};
const roots: ReturnType<typeof createRoot>[] = [];
async function mount(data: unknown) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  roots.push(root);
  await act(async () => {
    root.render(
      createElement(
        MemoryRouter,
        {},
        createElement(MarketResearchCard, {
          client: makeClient(data).client,
          taskId: "fixture01",
        }),
      ),
    );
  });
  return el;
}
async function mountDetail(data: unknown) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  roots.push(root);
  const mockClient = makeClient(data);
  await act(async () => {
    root.render(
      createElement(
        MemoryRouter,
        {},
        createElement(ResearchDetail, {
          client: mockClient.client,
          taskId: "fixture01",
        }),
      ),
    );
  });
  return { el, calls: mockClient.calls };
}
afterAll(async () => {
  for (const root of roots) await act(async () => root.unmount());
  win.happyDOM.abort();
});

describe("market research", () => {
  test("a signed-in read uses the role-gated API and refuses an account change", async () => {
    const ok = makeClient(result);
    expect((await readResearch(ok.client, "fixture01")).state).toBe("done");
    expect(ok.calls).toEqual([
      {
        body: { operation: "marketIntel.view", args: { taskId: "fixture01" } },
      },
    ]);
    await expect(
      readResearch(
        makeClient(result, { actorChange: true }).client,
        "fixture01",
      ),
    ).rejects.toThrow("account changed");
    await expect(
      readResearch(makeClient(null, { err: true }).client, "fixture01"),
    ).rejects.toThrow("Access denied");
  });
  test("rejects malformed data and untrusted links", () => {
    expect(
      researchView.safeParse({ ...result, state: "invented" }).success,
    ).toBe(false);
    expect(safeResearchUrl("javascript:alert(1)")).toBeNull();
    expect(safeResearchUrl("https://user:pass@example.test/")).toBeNull();
    expect(safeResearchUrl("https://example.test/source")).toBe(
      "https://example.test/source",
    );
  });
  test("off state shows the actual explanation without a fake result", async () => {
    const el = await mount({
      state: "none",
      on: false,
      canRerun: false,
      sentence: "Market research is off.",
    });
    expect(el.textContent).toContain("Automatic research is off.");
    expect(el.textContent).toContain(
      "A previous report may be in Their links.",
    );
    expect(el.textContent).not.toContain("Sources");
  });
  test("a completed shadow run is labeled and missing metrics never become zero", async () => {
    const el = await mount({
      ...result,
      run: {
        ...result.run,
        docUrl: "https://docs.google.com/document/d/example/edit",
      },
    });
    expect(el.textContent).toContain("Internal preview");
    expect(el.textContent).toContain("30 days");
    expect(el.textContent).not.toContain("Open report");
  });
  test("an unfinished run never displays provisional competitor counts", async () => {
    const el = await mount({
      ...result,
      state: "pulling",
      sentence: "Researching.",
    });
    expect(el.textContent).toContain("In progress");
    expect(el.textContent).not.toContain("Competitors found");
  });
  test("completed research shows candidates and honest missing values; unsafe websites are not links", async () => {
    const { el } = await mountDetail({
      ...result,
      run: {
        ...result.run,
        docUrl: "https://docs.google.com/document/d/example/edit",
      },
    });
    expect(el.textContent).toContain("Research candidate");
    expect(el.textContent).toContain("Not checked");
    expect(el.textContent).toContain("0");
    expect(el.textContent).toContain("Internal preview");
    expect(
      Array.from(el.querySelectorAll("a")).some(a =>
        a.href.startsWith("javascript:"),
      ),
    ).toBe(false);
    expect(el.textContent).toContain("A report has not been published");
    expect(el.textContent).not.toContain("Open report");
  });
  test("a CSM without action permission sees no controls to change research", async () => {
    const { el } = await mountDetail({ ...result, canRerun: false });
    expect(el.textContent).not.toContain("Not a competitor");
    expect(el.textContent).not.toContain("Run research again");
  });
  test("marking a candidate requires a reason and calls the gated action", async () => {
    const { el, calls } = await mountDetail(result);
    const choose = Array.from(el.querySelectorAll("button")).find(
      b => b.textContent === "Not a competitor",
    );
    expect(choose).toBeDefined();
    await act(async () => choose?.click());
    const save = Array.from(el.querySelectorAll("button")).find(
      b => b.textContent === "Save",
    )!;
    expect(save.disabled).toBe(true);
    const input = el.querySelector("textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        win.HTMLTextAreaElement.prototype,
        "value",
      )?.set?.call(input, "A supplier");
      input.dispatchEvent(new win.Event("input", { bubbles: true }));
    });
    expect(save.disabled).toBe(false);
    await act(async () => save.click());
    expect(calls).toContainEqual({
      body: {
        operation: "marketIntel.flag",
        args: { runId: result.run.id, cid: "C1", reason: "A supplier" },
      },
    });
  });
});
