import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SyncHealth } from "../src/components/SyncHealth";

// 8 Oct 2026: the strip said "Feed freshness is not verified yet" on every
// load, fresh or not, because it never read the publish time.
const noonKuwait = Date.parse("2026-10-08T12:00:00+03:00");
const source = (iso: string) => ({
  tables: {
    blueprints: { rows: 0, snapshotAt: "2026-10-07T13:52:22+03:00" },
    creativeTasks: { rows: 111, snapshotAt: iso },
  },
});
const html = (s: unknown) =>
  renderToStaticMarkup(
    createElement(SyncHealth, { source: s as never, now: noonKuwait }),
  );

test("silent while the creative feed published within 50 minutes", () => {
  expect(html(source("2026-10-08T11:30:00+03:00"))).toBe("");
});

test("says when the feed last refreshed once it is stale", () => {
  const out = html(source("2026-10-08T10:00:00+03:00"));
  expect(out).toContain("last refreshed at 10:00 Kuwait time (120 min ago)");
  expect(out).toContain('role="status"');
});

test("says nothing is recorded when no table has a publish time", () => {
  expect(html({ tables: {} })).toContain(
    "No creative refresh has been recorded yet",
  );
});

test("stays silent while the snapshot is still loading", () => {
  expect(html(undefined)).toBe("");
});
