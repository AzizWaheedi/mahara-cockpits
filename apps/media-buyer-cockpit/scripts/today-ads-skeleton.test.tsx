import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ADS_SKELETON_PATHS,
  AdsSkeleton,
} from "../src/components/skeletons/AdsSkeleton";
import {
  TODAY_SKELETON_PATHS,
  TodaySkeleton,
  WhatsAppStatusSkeleton,
} from "../src/components/skeletons/TodaySkeleton";
import { readWaDeskShape, writeWaDeskShape } from "../src/lib/waDeskShape";

const page = readFileSync(
  new URL("../src/pages/CockpitPage.tsx", import.meta.url),
  "utf8",
);
const exceptionAlerts = readFileSync(
  new URL("../src/components/ExceptionAlerts.tsx", import.meta.url),
  "utf8",
);
const whatsappDesk = readFileSync(
  new URL("../src/components/WhatsAppDesk.tsx", import.meta.url),
  "utf8",
);

const stored = new Map<string, string>();
if (typeof globalThis.localStorage === "undefined") {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      clear: () => stored.clear(),
      getItem: (k: string) => stored.get(k) ?? null,
      key: (i: number) => [...stored.keys()][i] ?? null,
      get length() {
        return stored.size;
      },
      removeItem: (k: string) => void stored.delete(k),
      setItem: (k: string, v: string) => void stored.set(k, v),
    },
  });
} else {
  globalThis.localStorage.clear();
}

function expectPageSkeleton(html: string, name: string) {
  const root = html.slice(0, html.indexOf(">") + 1);
  expect(root).toContain(`data-page-skeleton="${name}"`);
  expect(root).toContain('aria-hidden="true"');
  expect(html).not.toContain('role="status"');
  expect(html).not.toContain("<button");
  expect(html).not.toContain("<a ");
  expect(html).not.toContain("<input");
}

function expectSectionOrder(html: string, names: string[]) {
  let last = -1;
  for (const name of names) {
    const at = html.indexOf(`data-section="${name}"`);
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeGreaterThan(last);
    last = at;
  }
}

describe("TodaySkeleton", () => {
  const html = renderToStaticMarkup(<TodaySkeleton />);

  test("is one hidden page placeholder", () => {
    expectPageSkeleton(html, "today");
  });

  test("keeps the fixed Today titles as real text", () => {
    for (const title of [
      "Today",
      "Exception alerts",
      "Your tasks",
      "Morning sprint",
    ]) {
      expect(html).toContain(title);
    }
  });

  test("names its sections in page order", () => {
    expectSectionOrder(html, [
      "today-header",
      "whatsapp",
      "exception-alerts",
      "your-tasks",
      "morning-sprint",
    ]);
  });

  test("the page tags its own sections and draws the skeleton", () => {
    expect(page).toContain("data-section={");
    expect(page).toContain('"today-header"');
    expect(page).toContain('data-section="morning-sprint"');
    expect(page).toContain("<TodaySkeleton />");
    expect(page).toContain("<AdsSkeleton />");
  });

  test("exports the Today route path", () => {
    expect(TODAY_SKELETON_PATHS).toEqual(["/dashboard"]);
  });
});

describe("AdsSkeleton", () => {
  const html = renderToStaticMarkup(<AdsSkeleton />);

  test("is one hidden page placeholder", () => {
    expectPageSkeleton(html, "ads");
  });

  test("keeps the fixed Ads titles as real text", () => {
    for (const title of [
      "Ads",
      "Client spend, 7 days",
      "Client leads, 7 days",
      "Blended CPL",
      "Under the $30/day floor",
      "Not on the board",
      "Tracking backlog",
      "Middle of the day: the sweep",
      "Campaign",
      "Spend",
      "Leads",
      "CPL",
      "Bookings",
      "Cost / booking",
      "Budget / spend",
      "Call",
    ]) {
      expect(html).toContain(title);
    }
  });

  test("names its sections in page order", () => {
    expectSectionOrder(html, [
      "ads-header",
      "stat-tiles",
      "tracking-backlog",
      "sweep",
      "campaign-board",
    ]);
  });

  test("the page tags its own sections and draws the skeleton", () => {
    expect(page).toContain("data-section={");
    expect(page).toContain('"ads-header"');
    for (const name of ["stat-tiles", "sweep", "campaign-board"]) {
      expect(page).toContain(`data-section="${name}"`);
    }
    expect(page).toContain("<AdsSkeleton />");
  });

  test("exports the Ads route path", () => {
    expect(ADS_SKELETON_PATHS).toEqual(["/ads"]);
  });
});

describe("WhatsApp shape", () => {
  test("defaults to the line when nothing is stored", () => {
    expect(readWaDeskShape("no-such-desk")).toBe("line");
  });

  test("reads back what was written", () => {
    writeWaDeskShape("csm", "list");
    expect(readWaDeskShape("csm")).toBe("list");
    writeWaDeskShape("csm", "line");
    expect(readWaDeskShape("csm")).toBe("line");
  });

  test("the skeleton draws the quiet line by default", () => {
    const html = renderToStaticMarkup(<WhatsAppStatusSkeleton />);
    expect(html).toContain('data-section="whatsapp"');
    expect(html).toContain("h-5 w-72");
    expect(html).not.toContain("<h2");
  });

  test("the skeleton draws the heading and rows for a list desk", () => {
    writeWaDeskShape("creative", "list");
    const html = renderToStaticMarkup(
      <WhatsAppStatusSkeleton desk="creative" />,
    );
    expect(html).toContain('data-section="whatsapp"');
    expect(html).toContain("WhatsApp");
    expect(html).toContain("<h2");
    expect(html.match(/<li/g)?.length).toBe(4);
  });

  test("the sources render their own skeleton in place", () => {
    expect(exceptionAlerts).toContain("<ExceptionAlertsSkeleton />");
    expect(exceptionAlerts).toContain('data-section="exception-alerts"');
    expect(whatsappDesk).toContain("<WhatsAppStatusSkeleton desk={desk} />");
    expect(whatsappDesk).toContain('data-section="whatsapp"');
  });
});
