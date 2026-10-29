/**
 * The creative director's key links (docs/requests/CLICKUP-DOWNGRADE.md
 * 4.3): the old ClickUp ticket form 1178 is gone, and the client ticket is
 * the cockpit's own "Ask a team", the portal's Requests page the sidebar
 * opens. Key links and the command palette (Ctrl-K) both draw every row
 * with a url from LINK_GROUPS, so the palette shows it too.
 *
 * Run: bun test scripts/key-links.test.ts
 */

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { LINK_GROUPS } from "../src/lib/creativeLinks";
import { portalUrl } from "../src/lib/portal";

const rows = LINK_GROUPS.flatMap(g => g.rows.map(r => ({ ...r, g: g.title })));

test("no key link is a ClickUp ticket form", () => {
  for (const r of rows)
    expect({ label: r.label, url: r.url ?? "" }).toEqual({
      label: r.label,
      url: expect.not.stringContaining("2kzmr1ky-1178"),
    });
  expect(rows.some(r => /ticketing form/i.test(r.label))).toBe(false);
});

test('the client ticket is "Ask a team", the portal\'s Requests page', () => {
  const ask = rows.filter(r => r.label === "Ask a team");
  expect(ask.length).toBe(1);
  expect(ask[0].url).toBe(`${portalUrl()}/requests`);
  // Outside a browser, with no VITE_PORTAL_URL, the portal is production's.
  if (!process.env.VITE_PORTAL_URL?.trim())
    expect(ask[0].url).toBe("https://cockpit.maharamedia.com/requests");
  expect(ask[0].note).toBe(
    "Anything a client needs from tech, ads, client success, the call center or media. One request each; the cockpit files it in ClickUp for you.",
  );
  expect(ask[0].g).toBe("The two places you file work");
  const group = LINK_GROUPS.find(g => g.title === ask[0].g);
  expect(group?.blurb).toBe("If it is not filed, it did not happen.");
  // The video request form stays beside it.
  expect(group?.rows.map(r => r.label)).toEqual([
    "Video request form",
    "Ask a team",
  ]);
});

test("the sidebar opens the same page", () => {
  const sidebar = readFileSync(
    new URL("../src/components/AppSidebar.tsx", import.meta.url),
    "utf8",
  );
  expect(sidebar).toMatch(
    /label: "Ask a team", href: `\$\{portal\}\/requests`/,
  );
});

test("the command palette lists it: every LINK_GROUPS row with a url", () => {
  const palette = readFileSync(
    new URL("../src/components/CommandPalette.tsx", import.meta.url),
    "utf8",
  );
  // The palette's links are LINK_GROUPS' rows that have a url, no other list.
  expect(palette).toContain(
    'import { LINK_GROUPS } from "@/lib/creativeLinks";',
  );
  expect(palette).toMatch(
    /const LINKS: Hit\[\] = LINK_GROUPS\.flatMap\(g =>\s*g\.rows\s*\.flatMap\(r => \(r\.url \? \[\{ \.\.\.r, url: r\.url \}\] : \[\]\)\)/,
  );
  expect(palette).not.toContain("forms.clickup.com");
  // The same rule, applied here, takes "Ask a team" with its url.
  const links = LINK_GROUPS.flatMap(g =>
    g.rows.flatMap(r => (r.url ? [{ label: r.label, href: r.url }] : [])),
  );
  expect(links).toContainEqual({
    label: "Ask a team",
    href: `${portalUrl()}/requests`,
  });
  expect(links.some(l => l.href.includes("2kzmr1ky-1178"))).toBe(false);
});

test("the Key links page draws every row with a url as a link", () => {
  const page = readFileSync(
    new URL("../src/pages/KeyLinksPage.tsx", import.meta.url),
    "utf8",
  );
  expect(page).toContain("LINK_GROUPS.map(g =>");
  expect(page).toContain("href={url}");
});
