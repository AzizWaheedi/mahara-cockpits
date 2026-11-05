import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readYourTasksShape } from "../src/components/tasks/YourTasks";

/**
 * The reading state of the shared Your tasks card remembers the shape the
 * last load drew, so it can draw those same rows while it reads. The five
 * copies of the card must stay byte for byte identical.
 *
 * Run: bun test scripts/your-tasks-reading.test.tsx
 */

const APPS = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const CARD = "src/components/tasks/YourTasks.tsx";

const MASTER = join(APPS, "client-success-cockpit", CARD);

const COPIES = [
  "client-success-cockpit",
  "media-buyer-cockpit",
  "creative-director-cockpit",
  "video-editor-cockpit",
  "sales-cockpit",
].map(app => join(APPS, app, CARD));

const SHAPE_KEY = "mahara-your-tasks-shape:";
const DEFAULT_SHAPE = { rows: 5, more: false };

const DESCRIPTOR = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

type Store = Map<string, string>;

const storageWith = (store: Store) => ({
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => {
    store.set(key, String(value));
  },
  removeItem: (key: string) => {
    store.delete(key);
  },
  clear: () => {
    store.clear();
  },
  key: (index: number) => [...store.keys()][index] ?? null,
  get length() {
    return store.size;
  },
});

function stubStorage(store: Store = new Map()): Store {
  Object.defineProperty(globalThis, "localStorage", {
    value: storageWith(store),
    configurable: true,
    writable: true,
  });
  return store;
}

afterEach(() => {
  if (DESCRIPTOR) {
    Object.defineProperty(globalThis, "localStorage", DESCRIPTOR);
  } else {
    Reflect.deleteProperty(globalThis, "localStorage");
  }
});

describe("readYourTasksShape", () => {
  test("a storage with nothing remembered gives the default shape", () => {
    const store = stubStorage();
    expect(readYourTasksShape("csm", "auth-csm")).toEqual(DEFAULT_SHAPE);
    expect(store.size).toBe(0);
  });

  test("a seat with no id reads nothing and remembers nothing", () => {
    const store = stubStorage();
    store.set(`${SHAPE_KEY}csm:`, JSON.stringify({ rows: 1, more: true }));
    store.set(`${SHAPE_KEY}csm:null`, JSON.stringify({ rows: 2, more: true }));
    expect(readYourTasksShape("csm", null)).toEqual(DEFAULT_SHAPE);
    expect(store.size).toBe(2);
  });

  test("a stored shape is read back for its own seat and cockpit", () => {
    const store = stubStorage();
    store.set(
      `${SHAPE_KEY}csm:auth-csm`,
      JSON.stringify({ rows: 3, more: true }),
    );
    expect(readYourTasksShape("csm", "auth-csm")).toEqual({
      rows: 3,
      more: true,
    });
    // Another seat on the same tab, and the same name in another cockpit,
    // never sees this seat's shape.
    expect(readYourTasksShape("csm", "auth-agent")).toEqual(DEFAULT_SHAPE);
    expect(readYourTasksShape("sales", "auth-csm")).toEqual(DEFAULT_SHAPE);
  });

  test("remembered rows are clamped to 0..5", () => {
    const store = stubStorage();
    const read = (rows: unknown) => {
      store.set(
        `${SHAPE_KEY}csm:auth-csm`,
        JSON.stringify({ rows, more: false }),
      );
      return readYourTasksShape("csm", "auth-csm").rows;
    };
    expect(read(-3)).toBe(0);
    expect(read(0)).toBe(0);
    expect(read(2.7)).toBe(2);
    expect(read("4")).toBe(4);
    expect(read(9)).toBe(5);
    expect(read(null)).toBe(5);
    expect(read(undefined)).toBe(5);
  });

  test("unreadable storage and unreadable text give the default shape", () => {
    const store = stubStorage();
    store.set(`${SHAPE_KEY}csm:auth-csm`, "not json");
    expect(readYourTasksShape("csm", "auth-csm")).toEqual(DEFAULT_SHAPE);
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: () => {
          throw new Error("blocked");
        },
      },
      configurable: true,
      writable: true,
    });
    expect(readYourTasksShape("csm", "auth-csm")).toEqual(DEFAULT_SHAPE);
  });
});

describe("the five copies of the card", () => {
  test("are byte for byte identical", () => {
    const master = readFileSync(MASTER, "utf8");
    for (const copy of COPIES) {
      expect(readFileSync(copy, "utf8")).toBe(master);
    }
  });
});
