import { beforeEach, expect, mock, test } from "bun:test";
import { getFunctionName } from "convex/server";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router";

const NOW = Date.parse("2026-09-16T12:00:00Z");
let visible = true,
  now = NOW;
const calls: { name: string; args: unknown }[] = [];
const values: Record<string, unknown> = {
  "roles:me": { email: "admin@example.com" },
  "portal:members": [],
  "portal:adminHealth": [],
  "portal:adminSources": [],
  "portal:adminJobs": [],
  "portal:adminActivity": {
    lastSync: { at: NOW - 60000, ok: true, problems: [] },
    alerts: [],
  },
  "portal:adminActions": [
    { at: NOW - 86400000 + 1000, note: "Recent action", ok: true },
  ],
  "portal:adminCounts": {
    campaigns: 3,
    liveCampaigns: 2,
    clients: 5,
    members: 1,
    admins: 1,
  },
  "portal:adminHermes": {
    queued: 2,
    claimed: 1,
    recentDone: [NOW - 86400000 + 1000],
    lastDone: NOW - 1000,
  },
};
mock.module("convex/react", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => {
    const name = getFunctionName(ref);
    calls.push({ name, args });
    return args === "skip" ? undefined : values[name];
  },
  useMutation: () => () => Promise.resolve(),
}));
mock.module("../../src/lib/useNow", () => ({ useNow: () => now }));
mock.module("../../src/lib/usePageVisible", () => ({
  usePageVisible: () => visible,
}));
mock.module("../../src/pages/PortalHome", () => ({ COCKPIT_META: {} }));
const { AdminPage } = await import("../../src/pages/AdminPage");
beforeEach(() => {
  visible = true;
  now = NOW;
  calls.length = 0;
});
const render = () =>
  renderToString(
    <MemoryRouter>
      <AdminPage />
    </MemoryRouter>,
  );
test("visible page uses split cards and leaves the unused client picker unsubscribed", () => {
  expect(render()).toContain("1 done today");
  expect(calls.find(c => c.name === "portal:overview")).toBeUndefined();
  expect(calls.find(c => c.name === "portal:clientNames")?.args).toBe("skip");
  expect(
    calls.filter(c => c.name.startsWith("portal:admin") && c.args !== "skip"),
  ).toHaveLength(7);
});
test("hidden page pauses every admin data subscription", () => {
  visible = false;
  render();
  expect(
    calls
      .filter(c => c.name.startsWith("portal:"))
      .every(c => c.args === "skip"),
  ).toBe(true);
});
test("local clock expires rolling-day counts and actions without a database write", () => {
  expect(render()).toContain("Recent action");
  now += 30000;
  const html = render();
  expect(html).toContain("0 done today");
  expect(html).not.toContain("Recent action");
});
