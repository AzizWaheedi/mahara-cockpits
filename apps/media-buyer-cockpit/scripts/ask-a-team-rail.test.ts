/**
 * Every seat on the portal rail reaches Ask a team. The Raise a ticket SOP
 * (TEAM_GUIDES.ticket) says it is in every cockpit's sidebar, and the phone
 * bar sends the media buyer to it through More, which opens this rail. The
 * row went missing once when the rail was regrouped (2 Nov 2026).
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const sidebar = readFileSync(
  new URL("../src/components/AppSidebar.tsx", import.meta.url),
  "utf8",
);

const fn = (name: string) => {
  const start = sidebar.indexOf(`function ${name}(`);
  const next = sidebar.indexOf("\nfunction ", start + 1);
  return sidebar.slice(start, next < 0 ? undefined : next);
};

const asksATeam = (src: string) =>
  /href="\/requests"\s+label="Ask a team"/.test(src) ||
  /label: "Ask a team",\s+href: "\/requests"/.test(src);

test("the rail every seat outside /ceo sees has Ask a team", () => {
  expect(asksATeam(fn("SidebarNav"))).toBe(true);
});

test("the CEO's rail keeps it too", () => {
  expect(asksATeam(fn("CeoRail"))).toBe(true);
});
