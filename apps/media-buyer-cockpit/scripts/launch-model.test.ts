import { expect, test } from "bun:test";
import { launchFixture } from "../src/dev/launchFixture";
import {
  accountStatus,
  agreedBudget,
  briefBudgetWords,
  budgetHold,
  budgetUsd,
  clientAgreedBudget,
  contractedBudget,
  defaultAccount,
  deskBudgetSources,
  justLaunched,
  type KickoffBudget,
  laneClients,
  nextAction,
  SALE_GUARD_USD,
  usdWords,
} from "../src/lib/launchModel";

test("missing status remains unknown, not healthy", () => {
  expect(accountStatus(null)).toContain("hourly read");
  expect(accountStatus(3)).toBe("Unpaid balance");
});
test("all five counts and readonly search agree with the lane filter", () => {
  const p = launchFixture();
  for (const lane of [
    "onboarding",
    "ready",
    "nothing",
    "waiting",
    "ads",
  ] as const)
    expect(laneClients(p, lane).length).toBe(p.lanes[lane]);
  const stopped = p.clients.find(c => c.readOnly)!;
  expect(nextAction(stopped)).toBe("View history");
});
test("only confirmed delivery reaches Just launched and native rows remove it", () => {
  const p = launchFixture("waiting-fresh");
  expect(justLaunched(p)).toHaveLength(0);
  const l = p.clients.flatMap(c => c.launches)[0];
  l.hasImpressions = true;
  expect(justLaunched(p)).toHaveLength(1);
  l.inAds = true;
  expect(justLaunched(p)).toHaveLength(0);
});

// ---------------------------------------------------------------------------
// The agreed daily budget (20261103e). The SQL chain is held equal to this one
// in launch-agreed-budget-supabase.test.ts.

const kickoff = (k: Partial<KickoffBudget>): KickoffBudget => ({
  amount: null,
  currency: null,
  usd: null,
  fromText: false,
  said: null,
  at: "2026-11-03T08:00:00Z",
  ...k,
});
const SENT = "2026-11-02T09:00:00Z";

test("budget source order and healthy account default", () => {
  const c = launchFixture().clients[0];
  c.agreedBudget = undefined;
  c.cards = [{ taskId: "card1", dailyAdSpend: 20 }];
  // Blueprint part 1 stores {usd, said}; the old test passed a bare 30, so the
  // object shape that never matched went unseen.
  c.brief = {
    answers: { daily_budget: { usd: 30, said: "30" } },
    sentAt: SENT,
    sentBudget: { usd: 30, said: "30" },
  };
  c.kickoffBudget = kickoff({ amount: 150, currency: "SAR", usd: 39.99 });
  c.handover = { daily_budget: 40 };
  expect(contractedBudget(c)).toEqual({ value: 20, source: "Ads card" });
  c.cards = [];
  expect(contractedBudget(c)).toEqual({
    value: 30,
    source: "Blueprint part 1",
  });
  c.brief = null;
  expect(contractedBudget(c)).toEqual({
    value: 39.99,
    source: "Kickoff, 150 SAR",
  });
  c.kickoffBudget = null;
  // The sale's figure was labelled "Kickoff"; it is the sale's.
  expect(contractedBudget(c)).toEqual({
    value: 40,
    source: "Sale (card Daily Budget)",
  });
  c.accounts = [
    { id: "bad", status: 3 } as any,
    { id: "good", status: 1 } as any,
  ];
  expect(defaultAccount(c)?.id).toBe("good");
});

test("every source found is listed, the default marked, with mid-sentence names", () => {
  const a = agreedBudget({
    cards: [],
    brief: {
      answers: { daily_budget: { usd: 45, said: "45" } },
      sentAt: SENT,
      sentBudget: { usd: 45, said: "45" },
    },
    kickoffBudget: kickoff({ amount: 60, currency: "USD", usd: 60 }),
    handover: { daily_budget: 30 },
  });
  expect(a.sources).toEqual([
    {
      key: "blueprint",
      label: "Blueprint part 1",
      from: "Blueprint part 1",
      usd: 45,
      used: true,
      note: null,
    },
    {
      key: "kickoff",
      label: "Kickoff",
      from: "kickoff",
      usd: 60,
      used: false,
      note: null,
    },
    {
      key: "sale",
      label: "Sale (card Daily Budget)",
      from: "the sale",
      usd: 30,
      used: false,
      note: null,
    },
  ]);
  expect(a.notes).toEqual([]);
});

test("a sale figure of $1,000 or more is never the default", () => {
  const a = agreedBudget({
    cards: [],
    brief: null,
    kickoffBudget: null,
    handover: { daily_budget: 1500 },
  });
  expect(a.usd).toBeNull();
  expect(a.source).toBeNull();
  expect(a.notes).toEqual([
    "The sale's figure, $1,500 a day, looks like a month or another currency, so it is not the default. Ask the CSM.",
  ]);
  expect(SALE_GUARD_USD).toBe(1000);
  // Under the guard the sale is still the default.
  expect(
    agreedBudget({
      cards: [],
      brief: null,
      kickoffBudget: null,
      handover: { daily_budget: 999 },
    }).usd,
  ).toBe(999);
});

test("the kickoff absent, in dollars, in SAR, typed in Typeform, or with no rate", () => {
  const base = { cards: [], brief: null, handover: { daily_budget: 30 } };
  expect(agreedBudget({ ...base, kickoffBudget: undefined }).key).toBe("sale");
  expect(
    agreedBudget({
      ...base,
      kickoffBudget: kickoff({ amount: 37.5, currency: "SAR", usd: 10 }),
    }).source,
  ).toBe("Kickoff, 37.5 SAR");
  expect(
    agreedBudget({
      ...base,
      kickoffBudget: kickoff({
        amount: 60,
        currency: "USD",
        usd: 60,
        fromText: true,
        said: "$60",
      }),
    }),
  ).toMatchObject({ usd: 60, source: "Kickoff, as typed: $60" });
  const bhd = agreedBudget({
    ...base,
    kickoffBudget: kickoff({ amount: 20, currency: "BHD", usd: null }),
  });
  expect(bhd).toMatchObject({ usd: 30, key: "sale" });
  expect(bhd.notes).toEqual([
    "No fixed rate for BHD yet, so the kickoff's 20 BHD is not the default.",
  ]);
});

test("Blueprint part 1 counts once sent; nothing agreed is null, never 0", () => {
  const draft = agreedBudget({
    cards: [],
    brief: { answers: { daily_budget: { usd: 80 } }, sentAt: null },
    kickoffBudget: null,
    handover: {},
  });
  expect(draft.usd).toBeNull();
  expect(draft.notes[0]).toContain("not sent yet");
  expect(
    agreedBudget({
      cards: [],
      brief: null,
      kickoffBudget: null,
      handover: undefined,
    }),
  ).toEqual({
    usd: null,
    key: null,
    source: null,
    from: null,
    sources: [],
    notes: [],
  });
  const c = launchFixture().clients[0];
  Object.assign(c, {
    agreedBudget: undefined,
    cards: [],
    brief: null,
    kickoffBudget: null,
    handover: {},
  });
  expect(contractedBudget(c)).toBeNull();
});

test("the server's chain is used when the pipeline sends it", () => {
  const c = launchFixture().clients[0];
  c.agreedBudget = {
    usd: 52,
    key: "kickoff",
    source: "Kickoff",
    from: "kickoff",
    sources: [
      {
        key: "kickoff",
        label: "Kickoff",
        from: "kickoff",
        usd: 52,
        used: true,
        note: null,
      },
    ],
    notes: [],
  };
  expect(clientAgreedBudget(c).usd).toBe(52);
  expect(contractedBudget(c)).toEqual({ value: 52, source: "Kickoff" });
});

test("the Ads card's figure from cockpit-sync's copy (adsCards) is the default", () => {
  const a = agreedBudget({
    cards: [{ taskId: "card-a", name: "Mirror card" }],
    adsCards: [{ taskId: "card-a", dailyAdSpend: 50 }],
    brief: null,
    kickoffBudget: null,
    handover: { daily_budget: 30 },
  });
  expect(a).toMatchObject({ usd: 50, key: "adsCard", from: "the Ads card" });
  // Without it the sale is the default, as before.
  expect(
    agreedBudget({
      cards: [{ taskId: "card-a" }],
      brief: null,
      kickoffBudget: null,
      handover: { daily_budget: 30 },
    }).key,
  ).toBe("sale");
});

test("Blueprint part 1 is the figure sent; a draft changed after is held", () => {
  const a = agreedBudget({
    cards: [],
    brief: {
      answers: { daily_budget: { usd: 150 } },
      sentAt: SENT,
      sentBudget: { usd: 45 },
    },
    kickoffBudget: null,
    handover: {},
  });
  expect(a).toMatchObject({ usd: 45, key: "blueprint" });
  expect(a.sources[1]).toEqual({
    key: "blueprintDraft",
    label: "Blueprint part 1, change not sent",
    from: "the unsent Blueprint change",
    usd: 150,
    used: false,
    note: "Blueprint part 1 now says $150 a day but the change is not sent yet, so it is not the default.",
  });
  // A brief with no sent figure (an older server's) gives no Blueprint default.
  expect(
    agreedBudget({
      cards: [],
      brief: { answers: { daily_budget: { usd: 45 } }, sentAt: SENT },
      kickoffBudget: null,
      handover: {},
    }).usd,
  ).toBeNull();
});

test("the holds: under $2.50 for any source, $1,000 or more for the Blueprint, kickoff and sale", () => {
  expect(budgetHold("The kickoff's", 2, "CSM")).toBe(
    "The kickoff's $2 a day is too low: twice it is under the desk's $5 floor, so it is not the default.",
  );
  expect(budgetHold("The kickoff's", 2.5, "CSM")).toBeNull();
  expect(budgetHold("Blueprint part 1's", 1200, "creative director")).toBe(
    "Blueprint part 1's $1,200 a day looks like a month or another currency, so it is not the default. Ask the creative director.",
  );
  expect(budgetHold("The Ads card's", 1200, null)).toBeNull();
  expect(budgetHold("The Ads card's", null, null)).toBeNull();
  const a = agreedBudget({
    cards: [],
    brief: {
      answers: { daily_budget: { usd: 1200 } },
      sentAt: SENT,
      sentBudget: { usd: 1200 },
    },
    kickoffBudget: kickoff({ amount: 2, currency: "USD", usd: 2 }),
    handover: { daily_budget: 1200 },
  });
  expect(a.usd).toBeNull();
  expect(a.notes).toHaveLength(3);
});

test("the live Ads card the desk read goes first when the mirror lacks it", () => {
  const a = agreedBudget({
    cards: [],
    brief: null,
    kickoffBudget: kickoff({ amount: 60, currency: "USD", usd: 60 }),
    handover: { daily_budget: 30 },
  });
  expect(deskBudgetSources(a, { contractedUsd: 60, source: "Kickoff" })).toBe(
    a.sources,
  );
  const live = deskBudgetSources(a, { contractedUsd: 70, source: "Ads card" });
  expect(live.map(s => [s.key, s.usd, s.used])).toEqual([
    ["adsCard", 70, true],
    ["kickoff", 60, false],
    ["sale", 30, false],
  ]);
  // The chain's own list is left as it was.
  expect(a.sources.find(s => s.used)?.key).toBe("kickoff");
});

test("the live Ads card takes the place of cockpit-sync's copy when they differ", () => {
  const a = agreedBudget({
    cards: [],
    adsCards: [{ taskId: "card-a", dailyAdSpend: 50 }],
    brief: null,
    kickoffBudget: null,
    handover: { daily_budget: 30 },
  });
  // The same figure: the chain's list as it is.
  expect(deskBudgetSources(a, { contractedUsd: 50, source: "Ads card" })).toBe(
    a.sources,
  );
  // The card changed since the sync: the live figure, once, as the default.
  expect(
    deskBudgetSources(a, { contractedUsd: 60, source: "Ads card" }).map(s => [
      s.key,
      s.usd,
      s.used,
    ]),
  ).toEqual([
    ["adsCard", 60, true],
    ["sale", 30, false],
  ]);
});

test("dollar words and figures as the database writes them", () => {
  expect(usdWords(39.99)).toBe("$39.99");
  expect(usdWords(40)).toBe("$40");
  expect(usdWords(1200)).toBe("$1,200");
  expect(usdWords(150.5)).toBe("$151");
  expect(budgetUsd("30")).toBe(30);
  expect(budgetUsd(" 12.5 ")).toBe(12.5);
  expect(budgetUsd(1.005)).toBe(1.01);
  for (const bad of [0, -5, "a lot", "$30", null, undefined, {}, 1e9, 0.004])
    expect(budgetUsd(bad)).toBeNull();
  expect(briefBudgetWords({ usd: 45, said: "45 a day" })).toBe("$45 a day");
  expect(briefBudgetWords(30)).toBe("$30 a day");
  expect(briefBudgetWords({ said: "a lot" })).toBeNull();
});
