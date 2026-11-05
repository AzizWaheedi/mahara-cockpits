import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  INBOX_SKELETON_PATHS,
  InboxSkeleton,
} from "../src/components/skeletons/InboxSkeleton";

/**
 * The Inbox skeleton is the loaded page with its data held back. It keeps the
 * header, the WhatsApp desk, the two folds and the footer where the page puts
 * them, with no live region and no controls of its own. The page source and
 * the desk source are read from disk to check that the same section names are
 * on the loaded page.
 *
 * Run: bun test scripts/inbox-skeleton.test.tsx
 */

const html = renderToStaticMarkup(createElement(InboxSkeleton));
const page = readFileSync(
  new URL("../src/pages/InboxPage.tsx", import.meta.url),
  "utf8",
);
const desk = readFileSync(
  new URL("../src/components/WhatsAppDesk.tsx", import.meta.url),
  "utf8",
);

const SECTIONS = [
  "page-header",
  "whatsapp-desk",
  "more-from-whatsapp",
  "send-for-review",
  "footer",
];

describe("Inbox skeleton", () => {
  test("draws the page root and nothing that speaks or acts", () => {
    expect(
      html.startsWith('<div aria-hidden="true" data-page-skeleton="inbox"'),
    ).toBe(true);
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("<input");
  });

  test("keeps the fixed titles as real text", () => {
    expect(html).toContain("Inbox");
    expect(html).toContain("WhatsApp");
    expect(html).toContain("More from WhatsApp");
    expect(html).toContain("Send something for review");
  });

  test("draws the sections in the loaded order", () => {
    const at = SECTIONS.map(name => html.indexOf(`data-section="${name}"`));
    expect(at.every(index => index >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  test("the loaded page carries the same section names", () => {
    for (const name of SECTIONS) {
      const source = name === "whatsapp-desk" ? desk : page;
      expect(source).toContain(`data-section="${name}"`);
    }
  });

  test("the desk loading state draws the desk skeleton", () => {
    expect(desk).toContain("<WhatsAppDeskSkeleton");
    expect(desk).toContain("Reading WhatsApp");
  });

  test("the route path is exported", () => {
    expect(INBOX_SKELETON_PATHS).toEqual(["/inbox"]);
  });
});
