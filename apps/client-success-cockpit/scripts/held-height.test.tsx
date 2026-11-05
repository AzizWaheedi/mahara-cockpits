import { afterEach, describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HeldHeight, readHeldHeight } from "../src/components/HeldHeight";

/**
 * The held-height wrapper: it keeps the height a block of self-loading bands
 * settled at, and releases the hold once that height is remembered. These
 * checks render static markup against a stubbed browser storage, so no DOM
 * and no network are used.
 *
 * Run: bun test scripts/held-height.test.tsx
 */

const store = new Map<string, string>();

type StubbedWindow = {
  localStorage: {
    getItem: (key: string) => string | null;
    setItem: (key: string, value: string) => void;
  };
};

let restore: (() => void) | null = null;

const installWindow = () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  const window: StubbedWindow = {
    localStorage: {
      getItem: key => store.get(key) ?? null,
      setItem: (key, value) => {
        store.set(key, value);
      },
    },
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: window,
  });
  restore = () => {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else Reflect.deleteProperty(globalThis, "window");
  };
};

afterEach(() => {
  restore?.();
  restore = null;
  store.clear();
});

describe("readHeldHeight", () => {
  test("it is 0 when nothing is stored", () => {
    installWindow();
    expect(readHeldHeight("cs-today-bands")).toBe(0);
  });

  test("it reads the stored height", () => {
    installWindow();
    store.set("mahara-held-height:cs-today-bands", "480");
    expect(readHeldHeight("cs-today-bands")).toBe(480);
  });

  test("a bad stored value falls back to 0", () => {
    installWindow();
    store.set("mahara-held-height:bad", "not a number");
    expect(readHeldHeight("bad")).toBe(0);
    store.set("mahara-held-height:bad", "-5");
    expect(readHeldHeight("bad")).toBe(0);
    store.set("mahara-held-height:bad", "0");
    expect(readHeldHeight("bad")).toBe(0);
  });
});

describe("HeldHeight", () => {
  test("it renders the stored height as the hold", () => {
    installWindow();
    store.set("mahara-held-height:cs-today-bands", "480");
    const html = renderToStaticMarkup(
      createElement(
        HeldHeight,
        { id: "cs-today-bands", section: "today-bands" },
        createElement("p", null, "Bands"),
      ),
    );
    expect(html).toContain('data-held="cs-today-bands"');
    expect(html).toContain('data-section="today-bands"');
    expect(html).toContain("min-height:480px");
    expect(html).toContain("Bands");
  });

  test("it draws no hold when nothing is stored", () => {
    installWindow();
    const html = renderToStaticMarkup(
      createElement(HeldHeight, { id: "empty" }, "Nothing yet"),
    );
    expect(html).toContain('data-held="empty"');
    expect(html).toContain("min-height:0");
    expect(html).toContain("Nothing yet");
  });
});
