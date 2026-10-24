import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import {
  ClientActivity,
  ClientDirectory,
  ClientTasks,
  filterClients,
} from "../src/components/launch/ClientDirectory";
import { launchFixture } from "../src/dev/launchFixture";

const render = (node: React.ReactNode) =>
  renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);
test("default client book shows running, onboarding and inactive clients together", () => {
  const p = launchFixture();
  const html = render(<ClientDirectory data={p} refresh={() => {}} />);
  for (const c of p.clients)
    expect(html).toContain(c.name.replaceAll("&", "&amp;"));
  expect(html).toContain("All clients");
  expect(html).toContain("/clients?client=");
  expect(
    filterClients(p.clients, "running").every(c => c.inAds && !c.readOnly),
  ).toBe(true);
  expect(filterClients(p.clients, "inactive").every(c => c.readOnly)).toBe(
    true,
  );
  expect(filterClients(p.clients, "attention").some(c => c.readOnly)).toBe(
    false,
  );
});
test("search reaches account IDs and inactive clients without requiring the old launch lanes", () => {
  const p = launchFixture();
  const stopped = p.clients.find(c => c.readOnly)!;
  expect(filterClients(p.clients, "all", stopped.name)).toEqual([stopped]);
  const c = p.clients[0];
  expect(
    filterClients(p.clients, "all", c.accounts[0].id).some(x => x.id === c.id),
  ).toBe(true);
  expect(filterClients(p.clients, "all", "no-such-client")).toEqual([]);
});
test("task source failure never looks like no tasks, and action log distinguishes reconcile", () => {
  const c = launchFixture().clients[0];
  c.tasksReady = false;
  expect(render(<ClientTasks c={c} />)).toContain(
    "Task updates are unavailable",
  );
  c.actionHistory = [
    {
      id: "a",
      operation: "launch.copy",
      state: "reconcile",
      at: new Date().toISOString(),
      actor: "Buyer",
    },
  ];
  const html = render(<ClientActivity c={c} />);
  expect(html).toContain("Needs reconciliation");
  expect(html).not.toContain("Confirmed by provider");
});
