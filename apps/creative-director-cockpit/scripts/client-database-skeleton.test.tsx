import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  CLIENTS_SKELETON_PATHS,
  ClientDatabaseSkeleton,
  ScriptDatabaseSkeleton,
} from "../src/components/skeletons/ClientDatabaseSkeleton";

/**
 * The client database skeletons. Each is the loaded page with the data held
 * back: no controls, no status text of its own, and the same fixed titles and
 * sections in the same order.
 *
 * Run: bun test scripts/client-database-skeleton.test.tsx
 */

const render = (element: Parameters<typeof renderToStaticMarkup>[0]) =>
  renderToStaticMarkup(element);

const page = readFileSync(
  new URL("../src/pages/ClientDatabasePage.tsx", import.meta.url),
  "utf8",
);

function expectOrder(html: string, names: string[]) {
  let last = -1;
  for (const name of names) {
    const at = html.indexOf(`data-section="${name}"`);
    expect(at).toBeGreaterThan(last);
    last = at;
  }
}

describe("ClientDatabaseSkeleton", () => {
  const html = render(createElement(ClientDatabaseSkeleton));

  test("marks itself as the hidden clients page", () => {
    expect(html).toContain('data-page-skeleton="clients"');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("mx-auto w-full max-w-6xl");
  });

  test("has no spoken status and no controls or links", () => {
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain("sr-only");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<select");
  });

  test("keeps the fixed titles as real text", () => {
    expect(html).toContain("Clients");
    expect(html).toContain("All clients");
    expect(html).toContain("Worst first");
  });

  test("keeps its sections in the loaded order", () => {
    expectOrder(html, ["page-header", "view-switcher", "client-list"]);
  });
});

describe("ScriptDatabaseSkeleton", () => {
  const html = render(createElement(ScriptDatabaseSkeleton));

  test("marks itself as the hidden scripting page", () => {
    expect(html).toContain('data-page-skeleton="scripting-database"');
    expect(html).toContain('aria-hidden="true"');
  });

  test("has no spoken status and no controls or links", () => {
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain("sr-only");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<select");
  });

  test("keeps the fixed titles as real text", () => {
    expect(html).toContain("Scripting database");
    expect(html).toContain("Only ads still live");
    expect(html).toContain("About this list");
    expect(html).toContain("Or start from a client");
  });

  test("keeps its sections in the loaded order", () => {
    expectOrder(html, [
      "page-header",
      "intro",
      "filters",
      "filter-chips",
      "scripting-table",
      "client-links",
    ]);
  });
});

describe("ClientDatabasePage wires the skeletons in", () => {
  test("the clients route uses its page skeleton", () => {
    expect(CLIENTS_SKELETON_PATHS).toEqual(["/clients"]);
    expect(page).toContain("<ClientDatabaseSkeleton />");
    expect(page).toContain("<ScriptDatabaseSkeleton />");
  });

  test("the loaded pages carry the section names", () => {
    for (const name of [
      "page-header",
      "view-switcher",
      "client-list",
      "intro",
      "filters",
      "filter-chips",
      "scripting-table",
      "client-links",
    ]) {
      expect(page).toContain(`data-section="${name}"`);
    }
  });

  test("keeps the spoken loading labels", () => {
    expect(page).toContain("Loading clients");
    expect(page).toContain("Loading the scripting database");
    expect(page).toContain('aria-busy="true"');
    expect(page).toContain('aria-live="polite"');
  });
});
