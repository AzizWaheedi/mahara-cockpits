/**
 * The foot of the desk's rail (src/components/Sidebar.tsx). Aziz,
 * 2026-10-17: editors see the team meetings from the desk, so Team meetings
 * sits at the foot (the portal's /team, the same doc everyone edits), above
 * Client performance, with the icon every cockpit uses for it
 * (docs/access/TEAM-ONLY-SEATS.md). Rendered on the server: nothing here
 * signs in or reaches the network.
 */
import { afterAll, expect, test } from "bun:test";

const ENV = {
  VITE_SUPABASE_URL: "https://bldgtotkfmhoxmlzowdx.supabase.co",
  VITE_SUPABASE_ANON_KEY: "test-placeholder-key",
};
const envs = [process.env, (import.meta as any).env].filter(Boolean);
const envBefore = envs.map(e =>
  Object.fromEntries(Object.keys(ENV).map(k => [k, e[k]])),
);
for (const e of envs) Object.assign(e, ENV);

const { createElement: h } = await import("react");
const { renderToString } = await import("react-dom/server");
const { MemoryRouter } = await import("react-router");
const { default: Sidebar, footLinks } = await import(
  "../src/components/Sidebar"
);
const { COCKPIT_ICON } = await import("../src/lib/cockpits");

afterAll(() => {
  envs.forEach((e, i) => {
    for (const [k, v] of Object.entries(envBefore[i]))
      if (v === undefined) delete e[k];
      else e[k] = v;
  });
});

const PORTAL = "https://cockpit.maharamedia.com";

test("Team meetings sits at the foot, above Client performance", () => {
  const foot = footLinks([], false);
  expect(foot.map(d => d.key)).toEqual(["sop", "team", "performance"]);
  expect(foot[1]).toEqual({
    key: "team",
    label: "Team meetings",
    href: `${PORTAL}/team`,
  });
  expect(foot[2].href).toBe(`${PORTAL}/performance`);
  // The shared icon, the same one the other cockpits draw beside it.
  expect(COCKPIT_ICON.team).toBeTruthy();
});

test("the other cockpits still follow, after the board", () => {
  const keys = footLinks(["editor", "csm"], false).map(d => d.key);
  expect(keys).toEqual(["sop", "team", "performance", "csm"]);
  const admin = footLinks(["editor"], true).map(d => d.key);
  expect(admin.slice(0, 4)).toEqual(["sop", "team", "performance", "admin"]);
});

test("the rail draws the link in the same tab, with its icon", () => {
  const html = renderToString(
    h(
      MemoryRouter,
      null,
      h(Sidebar, { name: "Editor One", isAdmin: false, counts: {} }),
    ),
  );
  const team = html.indexOf(`href="${PORTAL}/team"`);
  const board = html.indexOf(`href="${PORTAL}/performance"`);
  expect(team).toBeGreaterThan(-1);
  expect(board).toBeGreaterThan(team);
  const link = html.slice(team, html.indexOf("</a>", team));
  expect(link).toContain("Team meetings");
  expect(link).toContain("lucide-users-round");
  expect(link).not.toContain("_blank");
});
