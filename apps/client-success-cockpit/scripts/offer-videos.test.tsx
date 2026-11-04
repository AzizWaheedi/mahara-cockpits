import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { OfferClient } from "../src/present/offer/sources";

test("a completed save for the previous offer cannot overwrite the current video panel", async () => {
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
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const { OfferVideos } = await import("../src/pages/money/offers/OfferVideos");
  let finish!: (r: unknown) => void;
  const pending = new Promise(resolve => {
    finish = resolve;
  });
  const reads: string[] = [];
  const row = (deck: string) => ({
    deck,
    slotKey: "demo",
    lang: "en",
    provider: "wistia",
    url: `https://fast.wistia.net/embed/iframe/${deck === "offer_ugc" ? "qlwysqfu2g" : "btp2dokvjr"}`,
    embedUrl: `https://fast.wistia.net/embed/iframe/${deck === "offer_ugc" ? "qlwysqfu2g" : "btp2dokvjr"}`,
    title: deck,
    durationSeconds: 30,
    revision: deck === "offer_ugc" ? 9 : 2,
    updatedBy: "fixture@example.test",
    updatedAt: "2026-10-27",
  });
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "cockpit_csm_deck_videos_read") {
        reads.push(String(args.p_deck));
        return {
          data: {
            rows: [row(String(args.p_deck))],
            slots: [`${args.p_deck}:demo`],
          },
          error: null,
        };
      }
      if (name === "cockpit_csm_deck_video_clear") {
        expect(args.p_deck).toBe("offer_website");
        expect(args.p_revision).toBe(2);
        return pending;
      }
      throw Error(name);
    },
  } as unknown as OfferClient;
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  try {
    await act(async () => {
      root.render(<OfferVideos client={client} isCeo />);
    });
    expect(
      host.querySelector('input[type="url"]')?.getAttribute("value"),
    ).toContain("btp2dokvjr");
    await act(async () => {
      [...host.querySelectorAll("button")]
        .find(b => b.textContent === "Clear")!
        .click();
    });
    await act(async () => {
      const select = host.querySelector("select")!;
      select.value = "ugc";
      select.dispatchEvent(new win.Event("change", { bubbles: true }));
    });
    expect(
      (host.querySelector('input[type="url"]') as unknown as HTMLInputElement)
        .value,
    ).toContain("qlwysqfu2g");
    await act(async () => {
      finish({ data: { cleared: true, revision: 3 }, error: null });
      await pending;
    });
    expect(reads).toEqual(["offer_website", "offer_ugc"]);
    expect(
      (host.querySelector('input[type="url"]') as unknown as HTMLInputElement)
        .value,
    ).toContain("qlwysqfu2g");
  } finally {
    await act(async () => root.unmount());
    await win.happyDOM.abort();
    for (const k of names) {
      const d = old.get(k);
      if (d) Object.defineProperty(globalThis, k, d);
      else Reflect.deleteProperty(globalThis, k);
    }
  }
});
