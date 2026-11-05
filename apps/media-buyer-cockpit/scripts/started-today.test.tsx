import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// The cockpit's Supabase client is built when the API module loads, so the
// two public values are set before the modules that use it are imported.
const ENV = {
  VITE_SUPABASE_URL: "https://bldgtotkfmhoxmlzowdx.supabase.co",
  VITE_SUPABASE_ANON_KEY: "test-placeholder-key",
};
const envs = [process.env, (import.meta as any).env].filter(Boolean);
for (const e of envs) Object.assign(e, ENV);

const { parseStartedToday, readStartedToday } = await import(
  "../src/lib/startedToday"
);
const {
  StartedTodayCells,
  StartedTodayError,
  startedLabel,
  startedTodayCampaigns,
} = await import("../src/components/StartedToday");

const FEED_AT = "2026-11-04T13:07:26.570Z";

const fixture = {
  day: "2026-11-04",
  feedAt: FEED_AT,
  rows: [
    {
      campaignId: "120253046528170064",
      campaignName: "Monshaat_Leads_4/11",
      accountId: "1137359195352328",
      accountName: "Khalida new",
      clientName: "Khalida",
      currency: "SAR",
      spend: "59.53",
      spendUsd: 15.87,
      leads: 1,
      impressions: 632,
      linkClicks: 4,
      ads: 2,
      fetchedAt: FEED_AT,
      card: {
        taskId: "z8xmdvn0jc",
        url: "https://app.clickup.com/t/z8xmdvn0jc",
        adStatus: "Live",
      },
    },
    {
      campaignId: "1",
      campaignName: "Leads_Test_4/11",
      accountId: "2325233444877544",
      accountName: "Test account",
      clientName: null,
      currency: "USD",
      spend: 5.51,
      spendUsd: 5.51,
      leads: 0,
      impressions: 100,
      linkClicks: 1,
      ads: 1,
      fetchedAt: null,
      card: null,
    },
  ],
};

test("parseStartedToday coerces numeric strings and keeps a missing card null", () => {
  const read = parseStartedToday(fixture);
  expect(read.day).toBe("2026-11-04");
  expect(read.rows).toHaveLength(2);
  expect(read.rows[0].spend).toBe(59.53);
  expect(read.rows[1].spend).toBe(5.51);
  expect(read.rows[0].card?.taskId).toBe("z8xmdvn0jc");
  expect(read.rows[1].card).toBeNull();
});

test("parseStartedToday keeps startedOn and gives null when it is missing", () => {
  const read = parseStartedToday({
    ...fixture,
    rows: [{ ...fixture.rows[0], startedOn: "2026-11-04" }, fixture.rows[1]],
  });
  expect(read.rows[0].startedOn).toBe("2026-11-04");
  expect(read.rows[1].startedOn).toBeNull();
});

test("startedLabel names the day a campaign started", () => {
  expect(startedLabel("2026-11-05", "2026-11-05")).toBe("Started today");
  expect(startedLabel(null, "2026-11-05")).toBe("Started today");
  expect(startedLabel("2026-11-04", undefined)).toBe("Started today");
  expect(startedLabel("2026-11-04", "2026-11-05")).toBe("Started 4 Nov");
  expect(startedLabel("2026-10-30", "2026-10-31")).toBe("Started 30 Oct");
});

test("parseStartedToday throws for a shape it cannot read", () => {
  expect(() => parseStartedToday(null)).toThrow();
  expect(() => parseStartedToday({ day: "x" })).toThrow();
  expect(() =>
    parseStartedToday({ day: "x", rows: [{ campaignId: "1" }] }),
  ).toThrow();
});

test("readStartedToday calls the RPC with no arguments and returns the parsed read", async () => {
  const calls: unknown[][] = [];
  const client = {
    async rpc(...args: unknown[]) {
      calls.push(args);
      return { data: fixture, error: null };
    },
  } as any;
  const read = await readStartedToday(client);
  expect(calls).toEqual([["cockpit_media_started_today"]]);
  expect(read.rows[0].spend).toBe(59.53);
});

test("readStartedToday throws the RPC's error message", async () => {
  const client = {
    async rpc() {
      return { data: null, error: { message: "denied" } };
    },
  } as any;
  await expect(readStartedToday(client)).rejects.toThrow("denied");
});

const cells = (row: unknown, feedAt: string | null = FEED_AT, day?: string) =>
  renderToStaticMarkup(
    <table>
      <tbody>
        <tr>
          <StartedTodayCells row={row as any} feedAt={feedAt} day={day} />
        </tr>
      </tbody>
    </table>,
  );

test("a started-today row fills the board's eight columns with today's figures", () => {
  const read = parseStartedToday(fixture);
  const html = cells(read.rows[0]);
  expect(html.match(/<td/g)?.length).toBe(8);
  for (const text of [
    "Monshaat_Leads_4/11",
    "Started today",
    "from Meta at 16:07",
    "ClickUp card",
    "$16",
    "SAR 59.53",
    ">1<",
    "$15.87",
    "Too early to call",
  ])
    expect(html).toContain(text);
  expect(html).not.toContain("No card on the ads board yet");
});

test("a row with no lead and no card says so", () => {
  const read = parseStartedToday(fixture);
  const html = cells(read.rows[1], null);
  expect(html).toContain("No card on the ads board yet");
  expect(html).toContain("No lead yet today.");
  expect(html).not.toContain("from Meta at");
  expect(html).not.toContain("USD ");
});

test("a row that started yesterday says when it started and shows figures since then", () => {
  const read = parseStartedToday(fixture);
  const html = cells(
    { ...read.rows[0], startedOn: "2026-11-04" },
    FEED_AT,
    "2026-11-05",
  );
  expect(html).toContain("Started 4 Nov");
  expect(html).toContain("figures since then from Meta at");
  expect(html).not.toContain("Started today");
});

test("startedTodayCampaigns joins the client group the list already uses", () => {
  const read = parseStartedToday({
    ...fixture,
    rows: [
      { ...fixture.rows[0], clientName: "khalida" },
      { ...fixture.rows[1], accountId: "999", clientName: "arcwani" },
      { ...fixture.rows[1], campaignId: "2", campaignName: "Already_Listed" },
    ],
  });
  const campaigns = [
    { campaignName: "Old_Khalida", clientName: "Khalida", metaAccountId: "1" },
    {
      campaignName: "Leads_24/10",
      clientName: "ARCWANI",
      clientTag: "arcwani",
    },
    { campaignName: "already_listed", clientName: "Other" },
  ];
  const rows = startedTodayCampaigns(read, campaigns);
  expect(rows.map(r => [r.campaignName, r.clientName])).toEqual([
    ["Monshaat_Leads_4/11", "Khalida"],
    ["Leads_Test_4/11", "ARCWANI"],
  ]);
  expect(rows[1].clientTag).toBe("arcwani");
  expect(rows[0]._id).toBe("started-today-120253046528170064");
  expect(rows[0].startedToday.campaignName).toBe("Monshaat_Leads_4/11");
  expect(rows[0].feedAt).toBe(FEED_AT);
});

test("startedTodayCampaigns puts the read's day on each row", () => {
  const read = parseStartedToday(fixture);
  const rows = startedTodayCampaigns(read, []);
  expect(rows[0].day).toBe("2026-11-04");
});

test("startedTodayCampaigns keeps the read's client name when the list has none", () => {
  const read = parseStartedToday(fixture);
  const rows = startedTodayCampaigns(read, []);
  expect(rows.map(r => r.clientName)).toEqual(["Khalida", "Test account"]);
  expect(startedTodayCampaigns(undefined, [])).toEqual([]);
});

test("StartedTodayError says so only when the read fails", () => {
  expect(renderToStaticMarkup(<StartedTodayError error={null} />)).toBe("");
  expect(
    renderToStaticMarkup(<StartedTodayError error={new Error("denied")} />),
  ).toContain("could not be read");
});
