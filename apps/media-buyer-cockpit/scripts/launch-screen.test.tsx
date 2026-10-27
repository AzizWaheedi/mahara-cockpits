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
import {
  cardDetailsMissing,
  LaunchCardForm,
} from "../src/components/launch/LaunchCardDetails";
import { LaunchSetup } from "../src/components/launch/LaunchSetup";
import { LogLaunch } from "../src/components/launch/LogLaunch";
import { launchFixture } from "../src/dev/launchFixture";
import { LANES, laneClients } from "../src/lib/launchModel";

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
  const html = render(
    <LaunchSetup
      client={{}}
      c={launchFixture().clients[0]}
      account="111111"
      route="switchOn"
      source="old-campaign"
      ready={{}}
      value={{}}
      onChange={() => {}}
      onSource={() => {}}
      rehearse={false}
      builtCampaignName="Harbour |MAHARA| New build"
    />,
  );
  expect(html).toContain("Harbour |MAHARA| New build");
  expect(html).toContain("saved paused build");
  expect(html).not.toContain("Source campaign");
});

const cardInfo = {
  options: {
    serviceType: ["Construction", "Renovation/Fit Out"],
    priority: ["High", "Medium", "Low"],
    funnelType: ["Landing Page", "Lead Form"],
  },
  defaults: {},
  sources: { serviceType: "Last ads card", funnelType: "Campaign" },
  fixed: {
    tag: "harbour fitout",
    platform: "Meta",
    metaAccountUrl:
      "https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=111111",
    crmUrl: null,
    cities: [],
  },
  campaign: null,
};
test("the card form asks the launch form's questions and names what the cockpit fills in", () => {
  const html = render(
    <LaunchCardForm
      info={cardInfo}
      value={{ serviceType: "Renovation/Fit Out", funnelType: "Landing Page" }}
      onChange={() => {}}
      mode="switchOn"
      campaignName="Harbour |MAHARA| 26\10"
      spendUsd={30}
    />,
  );
  for (const words of [
    "Service type",
    "Priority",
    "Funnel type",
    "Landing page",
    "Do&#x27;s and don&#x27;ts",
    "harbour fitout",
    "$30 a day, the budget above",
    "No CRM location on the client record",
    "From the last ads card",
    "replace the Launch New Campaign form",
  ])
    expect(html).toContain(words);
  expect(html).not.toContain("launch-card-log-day");
  expect(
    render(
      <LaunchCardForm
        info={cardInfo}
        value={{}}
        onChange={() => {}}
        mode="log"
      />,
    ),
  ).toContain('type="date"');
});
test("a card is not made until every required launch answer is there", () => {
  const full = {
    serviceType: "Construction",
    priority: "Medium",
    funnelType: "Lead Form",
  };
  expect(cardDetailsMissing({}, "switchOn")).toContain("service type");
  expect(cardDetailsMissing(full, "switchOn")).toBe(null);
  expect(
    cardDetailsMissing({ ...full, funnelType: "Landing Page" }, "switchOn"),
  ).toContain("landing page");
  expect(cardDetailsMissing(full, "log")).toContain("daily ad spend");
  expect(
    cardDetailsMissing(
      { ...full, dailyAdSpendUsd: "40", launchDay: "2026-10-26" },
      "log",
    ),
  ).toBe(null);
});
test("Log a launch lists only switched-on campaigns without a card", () => {
  const c = {
    ...launchFixture().clients[0],
    cards: [{ taskId: "x", name: "Has a card" }],
  };
  const ready = {
    candidates: [
      { id: "900001", name: "Has a card", status: "ACTIVE" },
      { id: "900002", name: "Paused one", status: "PAUSED" },
      { id: "900003", name: "Needs a card", status: "ACTIVE" },
    ],
  };
  const html = render(
    <LogLaunch
      client={{}}
      c={c}
      account="111111"
      ready={ready}
      applyEnabled={false}
      rehearse={false}
      refresh={() => {}}
    />,
  );
  expect(html).toContain("Needs a card");
  expect(html).not.toContain("Has a card ·");
  expect(html).not.toContain("Paused one");
  expect(
    render(
      <LogLaunch
        client={{}}
        c={c}
        account="111111"
        ready={{ candidates: [] }}
        applyEnabled={false}
        rehearse={false}
        refresh={() => {}}
      />,
    ),
  ).toContain("already has a card");
});
