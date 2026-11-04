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
const { StartedTodayList } = await import("../src/components/StartedToday");

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

test("StartedTodayList shows each started campaign and its figures", () => {
  const read = parseStartedToday(fixture);
  const html = renderToStaticMarkup(
    <StartedTodayList read={read} error={null} />,
  );
  for (const text of [
    "Started today",
    ">2<",
    "Monshaat_Leads_4/11",
    "$15.87 (SAR 59.53)",
    "1 lead",
    "2 ads",
    "ClickUp card · Live",
    "at 16:07",
    "Test account",
    "0 leads",
    "1 ad",
    "No card on the ads board yet",
  ])
    expect(html).toContain(text);
  expect(html).not.toContain("(USD");
});

test("StartedTodayList shows nothing without rows and says so when the read fails", () => {
  expect(
    renderToStaticMarkup(
      <StartedTodayList
        read={{ day: "2026-11-04", feedAt: null, rows: [] }}
        error={null}
      />,
    ),
  ).toBe("");
  expect(
    renderToStaticMarkup(
      <StartedTodayList read={undefined} error={new Error("denied")} />,
    ),
  ).toContain("could not be read");
});
