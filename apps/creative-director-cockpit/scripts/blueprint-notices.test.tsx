/**
 * The Blueprint card's Slack stops move on their own (docs/forms/
 * STAGE1-CONTRACT.md 6.2): a close's notices are queued in the same moment
 * the press settles and post about a minute later, after which no outbox
 * state changes. The card reads them again while one waits (every minute,
 * shortened here) and with every read of the record, until it says "Posted".
 * Mounted in happy-dom, borrowed from the client success cockpit's tests,
 * which carry it. Synthetic records only.
 *
 * Run: bun test scripts/blueprint-notices.test.tsx
 */
import { afterAll, expect, test } from "bun:test";
import { createRequire } from "node:module";

const fromCsm = createRequire(
  new URL("../../client-success-cockpit/package.json", import.meta.url),
);
const { Window } = (await import(
  fromCsm.resolve("happy-dom")
)) as typeof import("happy-dom");

const win = new Window({ url: "https://localhost/creative/clients/86exmpl01" });
const g = globalThis as Record<string, unknown>;
// Put back after the file: a later file in the same `bun test` run (the
// server-rendered blueprint-call tests) must not find a document.
const before = new Map<string, unknown>();
for (const k of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "Element",
  "Node",
  "Event",
  "CustomEvent",
  "MutationObserver",
  "getComputedStyle",
  "sessionStorage",
  "localStorage",
  "IS_REACT_ACT_ENVIRONMENT",
]) {
  before.set(k, Object.hasOwn(g, k) ? g[k] : undefined);
  g[k] =
    k === "IS_REACT_ACT_ENVIRONMENT"
      ? true
      : k === "window"
        ? win
        : (win as unknown as Record<string, unknown>)[k];
}

const { createRoot } = await import("react-dom/client");
const { act, createElement } = await import("react");
const { MemoryRouter } = await import("react-router");
const { BlueprintCard } = await import("../src/components/BlueprintCard");
const fx = await import("../src/dev/blueprintFixtures");

afterAll(async () => {
  await win.happyDOM.abort();
  for (const [k, v] of before) {
    if (v === undefined) delete g[k];
    else g[k] = v;
  }
});

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

async function mount(
  answers: () => ReturnType<typeof fx.noticesFor>,
  everyMs = 25,
) {
  let reads = 0;
  const io = {
    ...fx.fakeBlueprintIO(fx.rowFor("posted")),
    notices: async () => {
      reads += 1;
      return answers();
    },
  };
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      createElement(
        MemoryRouter,
        null,
        createElement(BlueprintCard, {
          taskId: fx.TASK,
          clientName: fx.NAME,
          status: "Launch Booked",
          offerSheet: fx.OFFER_SHEET,
          io,
          noticeEveryMs: everyMs,
        }),
      ),
    );
    await wait(20);
  });
  return {
    host,
    reads: () => reads,
    unmount: () => act(async () => root.unmount()),
  };
}

test("a queued close notice is read again until it posts; then the card stops reading", async () => {
  let posted = false;
  const card = await mount(() => fx.noticesFor(posted ? "posted" : "queued"));
  expect(card.host.textContent).toContain("Waiting to post in #csm-general.");
  expect(card.host.textContent).toContain("Waiting to post in #media-general.");
  // The sender's minute comes: the next read finds both posted.
  posted = true;
  await act(async () => {
    await wait(80);
  });
  expect(card.host.textContent).toMatch(/Posted in #csm-general (at|on) /);
  expect(card.host.textContent).toMatch(/Posted in #media-general (at|on) /);
  expect(card.host.textContent).not.toContain("Waiting to post");
  // Nothing waits any more: no further reads.
  const after = card.reads();
  await act(async () => {
    await wait(80);
  });
  expect(card.reads()).toBe(after);
  await card.unmount();
});

test("a failed read is tried again, and says so meanwhile", async () => {
  let fail = true;
  const card = await mount(() => {
    if (fail) throw new Error("Failed to fetch");
    return fx.noticesFor("posted");
  });
  expect(card.host.textContent).toContain(
    "The cockpit could not read the Slack notices just now. It reads them again within a minute.",
  );
  fail = false;
  await act(async () => {
    await wait(80);
  });
  expect(card.host.textContent).toMatch(/Posted in #csm-general (at|on) /);
  await card.unmount();
});

test("a read of the record (the tab back in view) reads the notices too", async () => {
  let n = 0;
  const card = await mount(() => {
    n += 1;
    // Posted already on the second read; the first one found it queued.
    return fx.noticesFor(n > 1 ? "posted" : "queued");
  }, 60_000); // no timer within the test: only the focus reads again
  expect(card.reads()).toBe(1);
  await act(async () => {
    window.dispatchEvent(new win.Event("focus") as unknown as Event);
    await wait(10);
  });
  expect(card.reads()).toBeGreaterThanOrEqual(2);
  expect(card.host.textContent).toMatch(/Posted in #csm-general (at|on) /);
  await card.unmount();
});
