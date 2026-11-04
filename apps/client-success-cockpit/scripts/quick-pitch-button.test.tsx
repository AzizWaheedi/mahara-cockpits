import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import { ALL_CATALOG } from "../src/dev/offer/allFixtures";
import type { OfferClient } from "../src/present/offer/sources";

test("late catalogue answers cannot open a deck for the previous client or offer", async () => {
  const win = new Window({ url: "https://localhost/client-success/" });
  const names = [
    "window",
    "document",
    "navigator",
    "HTMLElement",
    "Element",
    "Node",
    "Event",
    "MouseEvent",
    "DocumentFragment",
    "Text",
  ];
  const old = new Map(
    names.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]),
  );
  for (const k of names)
    Object.defineProperty(globalThis, k, {
      configurable: true,
      writable: true,
      value:
        k === "window" ? win : (win as unknown as Record<string, unknown>)[k],
    });
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot } = await import("react-dom/client"),
    { act } = await import("react");
  const { QuickPitchButton } = await import(
    "../src/present/offer/QuickPitchButton"
  );
  let finish!: (v: unknown) => void;
  const pending = new Promise(resolve => {
    finish = resolve;
  });
  const calls: string[] = [];
  const client = {
    rpc: async (name: string) => {
      calls.push(name);
      return pending;
    },
    functions: {
      invoke: () => {
        throw Error("No Edge call in quick pitch");
      },
    },
  } as unknown as OfferClient;
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  try {
    await act(async () =>
      root.render(
        <QuickPitchButton taskId="client-a" offer="website" client={client} />,
      ),
    );
    await act(async () => {
      host.querySelector("button")!.click();
    });
    expect(calls).toEqual(["cockpit_upsell_catalog_read"]);
    await act(async () =>
      root.render(
        <QuickPitchButton taskId="client-b" offer="ugc" client={client} />,
      ),
    );
    await act(async () => {
      finish({
        data: {
          rows: Object.values(ALL_CATALOG),
          settings: { whatsappNumber: null, validDays: 30, doorLive: false },
          videos: [],
          isCeo: false,
          at: "2026-10-27",
        },
        error: null,
      });
      await pending;
    });
    expect(win.document.querySelector('[role="dialog"]')).toBeNull();
    expect(host.textContent).toContain("Quick pitch");
    expect(calls).toEqual(["cockpit_upsell_catalog_read"]);
    await act(async () =>
      root.render(
        <QuickPitchButton
          taskId="client-b"
          offer="ugc"
          row={{ ...ALL_CATALOG.ugc, copy: {} }}
        />,
      ),
    );
    await act(async () => {
      host.querySelector("button")!.click();
    });
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "approved copy is unavailable",
    );
    expect(win.document.querySelector('[role="dialog"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    await win.happyDOM.abort();
    for (const k of names) {
      const v = old.get(k);
      if (v) Object.defineProperty(globalThis, k, v);
      else Reflect.deleteProperty(globalThis, k);
    }
  }
});
