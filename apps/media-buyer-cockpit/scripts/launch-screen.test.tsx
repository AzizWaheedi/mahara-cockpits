import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import {
  LaunchClientRow,
  LaunchLane,
} from "../src/components/launch/LaunchLane";
import {
  JustLaunched,
  LaunchNothingRunning,
} from "../src/components/launch/LaunchLinks";
import { launchFixture } from "../src/dev/launchFixture";
import { LANES, laneClients } from "../src/lib/launchModel";

import { LaunchSetup } from "../src/components/launch/LaunchSetup";

const render = (node: React.ReactNode) =>
  renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);
test("each client row has exactly one next action, stopped rows stay readonly", () => {
  for (const c of launchFixture().clients) {
    const html = render(<LaunchClientRow client={c} />);
    expect((html.match(/<a /g) ?? []).length).toBe(1);
    expect(html).not.toContain("bg-primary");
    if (c.readOnly) expect(html).toContain("View history");
  }
});
test("all lane empty states use the agreed words", () => {
  for (const l of LANES.filter(l => l.id !== "ads"))
    expect(render(<LaunchLane lane={l.id} clients={[]} />)).toContain(
      l.empty.replaceAll("&", "&amp;"),
    );
});
test("Ads nothing-running clients are the same shared rows and errors are actionable", () => {
  const p = launchFixture();
  const html = render(
    <LaunchNothingRunning data={p} error="" refresh={() => {}} />,
  );
  for (const c of laneClients(p, "nothing")) expect(html).toContain(c.name);
  expect(
    render(
      <LaunchNothingRunning data={null} error="No source" refresh={() => {}} />,
    ),
  ).toContain("Refresh");
});
test("Just launched needs impressions and disappears when sync catches up", () => {
  expect(render(<JustLaunched data={launchFixture("waiting-fresh")} />)).toBe(
    "",
  );
  const p = launchFixture("just-launched");
  expect(render(<JustLaunched data={p} />)).toContain("Just launched");
  p.clients[0].launches[0].inAds = true;
  expect(render(<JustLaunched data={p} />)).toBe("");
});

test("a pending build shows the actual campaign to activate, not an older source picker", () => {
 const html=render(<LaunchSetup client={{}} c={launchFixture().clients[0]} account="111111" route="switchOn" source="old-campaign" ready={{}} value={{}} onChange={()=>{}} onSource={()=>{}} rehearse={false} builtCampaignName="Harbour |MAHARA| New build" />);
 expect(html).toContain("Harbour |MAHARA| New build");expect(html).toContain("saved paused build");expect(html).not.toContain("Source campaign");
});
