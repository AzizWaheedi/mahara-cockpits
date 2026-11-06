import { afterAll, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { rememberedSkeleton } from "../src/components/RememberedSkeleton";
import {
  contentHeight,
  currentPageKey,
  LAYOUT_INDEX,
  LAYOUT_MAX_AGE_MS,
  LAYOUT_MAX_PAGES,
  type LayoutItem,
  layoutKey,
  placeLayout,
  type RememberedLayout,
  readLayout,
  sessionUserId,
  snapshotLayout,
  visibleItems,
  writeLayout,
} from "../src/lib/rememberedLayout";

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  const storage = {
    get length() {
      return map.size;
    },
    key(index: number) {
      return Array.from(map.keys())[index] ?? null;
    },
    getItem(key: string) {
      return map.has(key) ? (map.get(key) as string) : null;
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
    removeItem(key: string) {
      map.delete(key);
    },
    clear() {
      map.clear();
    },
  };
  return storage as unknown as Storage;
}

function signIn(storage: Storage, id: string) {
  storage.setItem("sb-test-auth-token", JSON.stringify({ user: { id } }));
}

function sampleLayout(at: number = Date.now()): RememberedLayout {
  return {
    v: 1,
    at,
    vw: 1000,
    dark: false,
    mainX: 0,
    mainW: 1000,
    h: 100,
    items: [[0, 0, 0, 100, 100, 8, "rgb(1, 2, 3)", "transparent", "0 0 0 0"]],
  };
}

describe("currentPageKey", () => {
  test("is a string", () => {
    expect(typeof currentPageKey()).toBe("string");
  });
});

describe("sessionUserId", () => {
  test("finds the user id in a supabase auth key", () => {
    const storage = fakeStorage();
    signIn(storage, "user-1");
    expect(sessionUserId(storage)).toBe("user-1");
  });

  test("returns null when there is no auth key", () => {
    expect(sessionUserId(fakeStorage())).toBeNull();
  });

  test("returns null for bad JSON and never throws", () => {
    const storage = fakeStorage();
    storage.setItem("sb-test-auth-token", "{not json");
    expect(sessionUserId(storage)).toBeNull();
  });
});

describe("layout storage", () => {
  test("write then read round trips the record", () => {
    const storage = fakeStorage();
    signIn(storage, "u1");
    const layout = sampleLayout();
    writeLayout("/ads", layout, storage);
    expect(readLayout("/ads", Date.now(), storage)).toEqual(layout);
  });

  test("another user id reads null", () => {
    const first = fakeStorage();
    signIn(first, "u1");
    writeLayout("/ads", sampleLayout(), first);

    const second = fakeStorage();
    signIn(second, "u2");
    expect(readLayout("/ads", Date.now(), second)).toBeNull();
  });

  test("a record older than 14 days reads null", () => {
    const storage = fakeStorage();
    signIn(storage, "u1");
    writeLayout(
      "/ads",
      sampleLayout(Date.now() - LAYOUT_MAX_AGE_MS - 1000),
      storage,
    );
    expect(readLayout("/ads", Date.now(), storage)).toBeNull();
  });

  test("a version 2 record reads null", () => {
    const storage = fakeStorage();
    signIn(storage, "u1");
    storage.setItem(
      layoutKey("u1", "/ads"),
      JSON.stringify({ ...sampleLayout(), v: 2 }),
    );
    expect(readLayout("/ads", Date.now(), storage)).toBeNull();
  });

  test("writing 41 paths keeps 40 records and drops the first", () => {
    const storage = fakeStorage();
    signIn(storage, "u1");
    for (let i = 0; i <= LAYOUT_MAX_PAGES; i += 1) {
      writeLayout(`/page-${i}`, sampleLayout(Date.now() + i), storage);
    }
    expect(readLayout("/page-0", Date.now() + 100, storage)).toBeNull();
    expect(
      readLayout(`/page-${LAYOUT_MAX_PAGES}`, Date.now() + 100, storage),
    ).not.toBeNull();
    const index = JSON.parse(storage.getItem(LAYOUT_INDEX) as string);
    expect(index.length).toBe(LAYOUT_MAX_PAGES);
  });

  test("keeps 24 pages for every empty cockpit", () => {
    expect(LAYOUT_MAX_PAGES).toBe(24);
    const storage = fakeStorage();
    signIn(storage, "u1");
    for (let i = 0; i < 25; i += 1) {
      writeLayout(`/cap-${i}`, sampleLayout(Date.now() + i), storage);
    }
    const index = JSON.parse(storage.getItem(LAYOUT_INDEX) as string);
    expect(index.length).toBe(24);
    expect(readLayout("/cap-0", Date.now() + 100, storage)).toBeNull();
    expect(readLayout("/cap-24", Date.now() + 100, storage)).not.toBeNull();
  });
});

const dom = new Window({ url: "https://cockpit.test/dashboard" });

function rectFrom(raw: string | null): DOMRect {
  const [left, top, width, height] = (raw ?? "0,0,0,0").split(",").map(Number);
  return {
    x: left,
    y: top,
    width,
    height,
    top,
    left,
    right: left + width,
    bottom: top + height,
    toJSON() {},
  } as unknown as DOMRect;
}

const elementProto = dom.Element.prototype as unknown as {
  getBoundingClientRect: () => DOMRect;
};
const originalElementRect = elementProto.getBoundingClientRect;
elementProto.getBoundingClientRect = function (this: Element): DOMRect {
  return rectFrom(this.getAttribute("data-rect"));
};

const rangeProto = (
  dom as unknown as {
    Range: { prototype: { getClientRects: () => DOMRectList } };
  }
).Range.prototype;
const originalRangeRects = rangeProto.getClientRects;
rangeProto.getClientRects = function (this: {
  startContainer: Node;
}): DOMRectList {
  const node = this.startContainer;
  const element =
    node.nodeType === 3
      ? node.parentElement
      : (node as unknown as Element | null);
  if (!element) return [] as unknown as DOMRectList;
  const raw =
    element.getAttribute("data-text-rect") ?? element.getAttribute("data-rect");
  return [rectFrom(raw)] as unknown as DOMRectList;
};

const styleWindow = dom as unknown as {
  getComputedStyle: (el: Element) => CSSStyleDeclaration;
};
const originalComputedStyle = styleWindow.getComputedStyle.bind(styleWindow);
styleWindow.getComputedStyle = (el: Element): CSSStyleDeclaration => {
  const base = originalComputedStyle(el);
  const background = el.getAttribute("data-bg");
  if (!background) return base;
  return new Proxy(base, {
    get(target, prop) {
      if (prop === "backgroundColor") return background;
      const value = Reflect.get(target, prop);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as CSSStyleDeclaration;
};

afterAll(() => {
  elementProto.getBoundingClientRect = originalElementRect;
  rangeProto.getClientRects = originalRangeRects;
  styleWindow.getComputedStyle = originalComputedStyle;
});

const SNAPSHOT_HTML = `
  <div data-section="today" data-rect="0,20,1000,120"></div>
  <div data-rect="10,10,300,200" style="background-color: rgb(11, 22, 33); border: 1px solid rgb(44, 55, 66); border-radius: 8px"></div>
  <button data-rect="10,250,120,40" style="background-color: rgb(1, 2, 3)">Save</button>
  <p data-rect="10,320,400,20">Hello there</p>
  <span class="sr-only" data-rect="10,360,100,20">hidden</span>
  <div data-rect="10,400,100,20" style="position: fixed"></div>
  <div data-rect="10,3000,100,20" style="background-color: rgb(9, 9, 9)"></div>
`;

function snapshotFixture(): RememberedLayout | null {
  dom.document.body.innerHTML = `<main data-rect="0,0,1000,800">${SNAPSHOT_HTML}</main>`;
  const main = dom.document.querySelector("main") as unknown as HTMLElement;
  return snapshotLayout(main, dom as unknown as Window);
}

describe("snapshotLayout", () => {
  test("records the settled shape and skips what it should", () => {
    const layout = snapshotFixture();
    expect(layout).not.toBeNull();
    const items = layout?.items ?? [];
    const kinds = items.map(item => item[0]);

    expect(kinds).toContain(3);
    expect(kinds).toContain(0);
    expect(kinds).toContain(1);
    expect(kinds).toContain(2);

    const section = items.find(item => item[0] === 3);
    expect(section?.[5]).toBe("today");

    const card = items.find(item => item[0] === 0);
    expect(card?.[5]).toBe(8);
    expect(card?.[6]).toBe("rgb(11, 22, 33)");
    expect(card?.[7]).toBe("rgb(44, 55, 66)");
    expect(card?.[8]).toBe("1 1 1 1");

    const block = items.find(item => item[0] === 1);
    expect(block).toEqual([1, 10, 250, 120, 40, 0]);

    const texts = items.filter(item => item[0] === 2);
    expect(texts.length).toBe(1);
    expect(texts[0]).toEqual([2, 10, 320, 400, 20]);

    expect(items.some(item => item[2] === 400)).toBe(false);
    expect(items.some(item => item[2] === 3000)).toBe(false);
  });

  test("clips a text rectangle to an overflow hidden box", () => {
    dom.document.body.innerHTML = `
      <main data-rect="0,0,1000,800">
        <div data-rect="10,10,100,20" data-text-rect="10,10,300,20" style="overflow-x: hidden; overflow-y: hidden">A very long client name</div>
      </main>
    `;
    const main = dom.document.querySelector("main") as unknown as HTMLElement;
    const layout = snapshotLayout(main, dom as unknown as Window);
    const texts = (layout?.items ?? []).filter(item => item[0] === 2);
    expect(texts.length).toBe(1);
    expect(texts[0][3]).toBeLessThanOrEqual(100);
  });

  test("drops content below an overflow auto container", () => {
    dom.document.body.innerHTML = `
      <main data-rect="0,0,1000,800">
        <div data-rect="10,10,300,100" style="overflow-x: auto; overflow-y: auto">
          <div data-rect="20,200,100,30" style="background-color: rgb(1, 2, 3)"></div>
        </div>
      </main>
    `;
    const main = dom.document.querySelector("main") as unknown as HTMLElement;
    const layout = snapshotLayout(main, dom as unknown as Window);
    const items = layout?.items ?? [];
    expect(items.some(item => item[2] === 200)).toBe(false);
    expect(items.some(item => item[0] === 0)).toBe(false);
  });

  test("skips an oklch background with zero alpha", () => {
    dom.document.body.innerHTML = `
      <main data-rect="0,0,1000,800">
        <div data-rect="10,10,200,100" data-bg="oklch(0.2 0.03 260 / 0)"></div>
      </main>
    `;
    const main = dom.document.querySelector("main") as unknown as HTMLElement;
    const layout = snapshotLayout(main, dom as unknown as Window);
    expect((layout?.items ?? []).some(item => item[0] === 0)).toBe(false);
  });

  test("records an oklab background with half alpha", () => {
    dom.document.body.innerHTML = `
      <main data-rect="0,0,1000,800">
        <div data-rect="10,10,200,100" data-bg="oklab(0.98 0 0 / 0.5)"></div>
      </main>
    `;
    const main = dom.document.querySelector("main") as unknown as HTMLElement;
    const layout = snapshotLayout(main, dom as unknown as Window);
    const card = (layout?.items ?? []).find(item => item[0] === 0);
    expect(card).toBeDefined();
    expect(card?.[6]).toBe("oklab(0.98 0 0 / 0.5)");
  });
});

const PLACE_LAYOUT: RememberedLayout = {
  v: 1,
  at: 0,
  vw: 1000,
  dark: false,
  mainX: 100,
  mainW: 800,
  h: 200,
  items: [[2, 0, 0, 100, 20]],
};

function goodEnv() {
  return {
    main: { left: 100, top: 50, width: 800 },
    root: { left: 120, top: 70, width: 800 },
    vw: 1000,
    dark: false,
  };
}

describe("placeLayout", () => {
  test("returns the root offset inside a matching main", () => {
    expect(placeLayout(PLACE_LAYOUT, goodEnv())).toEqual({ x: 20, y: 20 });
  });

  test("returns null for a different theme", () => {
    expect(placeLayout(PLACE_LAYOUT, { ...goodEnv(), dark: true })).toBeNull();
  });

  test("returns null for a different viewport width", () => {
    expect(placeLayout(PLACE_LAYOUT, { ...goodEnv(), vw: 999 })).toBeNull();
  });

  test("returns null when main sits at another left", () => {
    const env = goodEnv();
    env.main.left = 103;
    expect(placeLayout(PLACE_LAYOUT, env)).toBeNull();
  });

  test("returns null when main has another width", () => {
    const env = goodEnv();
    env.main.width = 803;
    expect(placeLayout(PLACE_LAYOUT, env)).toBeNull();
  });

  test("without main, a matching root stands at the origin", () => {
    const env = {
      main: null,
      root: { left: 101, top: 5, width: 800 },
      vw: 1000,
      dark: false,
    };
    expect(placeLayout(PLACE_LAYOUT, env)).toEqual({ x: 0, y: 0 });
  });

  test("without main, another root width returns null", () => {
    const env = {
      main: null,
      root: { left: 100, top: 5, width: 810 },
      vw: 1000,
      dark: false,
    };
    expect(placeLayout(PLACE_LAYOUT, env)).toBeNull();
  });
});

const OFFSET_ITEMS: LayoutItem[] = [
  [2, 0, 10, 100, 10],
  [2, 0, 60, 100, 20],
  [0, 0, 100, 100, 30, 4, "rgb(0, 0, 0)", "transparent", "0 0 0 0"],
];

describe("visibleItems and contentHeight", () => {
  const layout: RememberedLayout = { ...PLACE_LAYOUT, items: OFFSET_ITEMS };
  const off = { x: 0, y: 50 };

  test("drops items above the root", () => {
    expect(visibleItems(layout, off)).toEqual([
      OFFSET_ITEMS[1],
      OFFSET_ITEMS[2],
    ]);
  });

  test("measures the lowest visible edge", () => {
    expect(contentHeight(layout, off)).toBe(80);
  });
});

describe("visibleItems across a lower root", () => {
  const STRADDLE_ITEMS: LayoutItem[] = [
    [2, 0, 96, 100, 20],
    [2, 0, 60, 100, 30],
    [2, 0, 80, 100, 21],
  ];
  const layout: RememberedLayout = { ...PLACE_LAYOUT, items: STRADDLE_ITEMS };
  const off = { x: 0, y: 100 };

  test("clips an item that straddles the root top", () => {
    const visible = visibleItems(layout, off);
    expect(visible).toContainEqual([2, 0, 100, 100, 16]);
    expect(STRADDLE_ITEMS[0]).toEqual([2, 0, 96, 100, 20]);
  });

  test("drops an item fully above the root", () => {
    expect(visibleItems(layout, off)).not.toContain(STRADDLE_ITEMS[1]);
  });

  test("drops an item that ends within 2px of the root top", () => {
    expect(visibleItems(layout, off)).not.toContain(STRADDLE_ITEMS[2]);
  });

  test("measures the lowest edge from the straddling item", () => {
    expect(contentHeight(layout, off)).toBe(16);
  });
});

describe("rememberedSkeleton", () => {
  test("a first visit renders the static skeleton", () => {
    const Static = () => <div data-static="today" />;
    const Page = rememberedSkeleton("today", Static);
    const html = renderToStaticMarkup(<Page />);
    expect(html).toContain('data-static="today"');
  });

  test("a replay root carries the option className", () => {
    const storage = fakeStorage();
    signIn(storage, "u1");
    const host = globalThis as unknown as { window?: unknown };
    const previous = host.window;
    host.window = {
      location: { pathname: "/today", search: "" },
      localStorage: storage,
    };
    try {
      writeLayout(currentPageKey(), sampleLayout(), storage);
      const Static = () => <div data-static="today" />;
      const Page = rememberedSkeleton("today", Static, {
        className: "page-box",
      });
      const html = renderToStaticMarkup(<Page />);
      expect(html).toContain('class="page-box"');
      expect(html).toContain('data-remembered=""');
    } finally {
      if (previous === undefined) delete host.window;
      else host.window = previous;
    }
  });
});
