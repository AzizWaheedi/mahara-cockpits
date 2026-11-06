/**
 * The agreed daily budget on screen (20261103e): the launch desk's list of
 * sources under the budget field (src/components/launch/BudgetSources.tsx)
 * and the client page's agreed-against-now line
 * (src/pages/performance/AgreedBudget.tsx). Rendered to static markup; every
 * figure is invented.
 */
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BudgetScopeNote,
  BudgetSources,
  budgetLimitWords,
  waitingBudgetWords,
} from "../src/components/launch/BudgetSources";
import { launchFixture } from "../src/dev/launchFixture";
import { agreedBudget, clientAgreedBudget } from "../src/lib/launchModel";
import {
  AgreedAgainstNow,
  AgreedSubline,
  agreedHelp,
  agreedOf,
} from "../src/pages/performance/AgreedBudget";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);
const text = (h: string) =>
  h
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

const chain = agreedBudget({
  cards: [],
  brief: null,
  kickoffBudget: {
    amount: 150,
    currency: "SAR",
    usd: 39.99,
    fromText: false,
    said: null,
    at: "2026-11-03T08:00:00Z",
  },
  handover: { daily_budget: 30 },
});

test("the desk lists every source, the default on the teal spine, and lets a source within the limit fill the field", () => {
  const h = html(<BudgetSources agreed={chain} cap={79.98} onUse={() => {}} />);
  expect(text(h)).toContain("Agreed budget");
  expect(text(h)).toContain("Kickoff, 150 SAR $39.99 Default");
  expect(text(h)).toContain("Sale (card Daily Budget) $30 Use $30");
  expect(h).toContain('class="is-default" data-budget-source="kickoff"');
  expect(h).toContain('data-budget-source="sale"');
  expect(h).toContain('role="group"');
  expect(h).toContain('aria-labelledby="launch-agreed-title"');
  // Over the limit, or without a way to fill the field: no button.
  expect(
    html(<BudgetSources agreed={chain} cap={25} onUse={() => {}} />),
  ).not.toContain("Use $30");
  expect(html(<BudgetSources agreed={chain} cap={79.98} />)).not.toContain(
    "<button",
  );
});

test("a guarded sale and an unconverted kickoff say why, with no button", () => {
  const held = agreedBudget({
    cards: [],
    brief: null,
    kickoffBudget: {
      amount: 20,
      currency: "BHD",
      usd: null,
      fromText: false,
      said: null,
      at: null,
    },
    handover: { daily_budget: 1200 },
  });
  const h = html(<BudgetSources agreed={held} cap={100} onUse={() => {}} />);
  expect(h).not.toContain("<button");
  expect(h).not.toContain("Default");
  expect(text(h)).toContain("Kickoff, 20 BHD Not in dollars");
  expect(text(h)).toContain(
    "No fixed rate for BHD yet, so the kickoff's 20 BHD is not the default.",
  );
  expect(text(h)).toContain(
    "The sale's figure, $1,200 a day, looks like a month or another currency, so it is not the default. Ask the CSM.",
  );
  expect(h).toContain('class="launch-dot warn"');
});

test("nothing agreed says what happens next, never $0", () => {
  const none = agreedBudget({
    cards: [],
    brief: null,
    kickoffBudget: null,
    handover: {},
  });
  const h = html(<BudgetSources agreed={none} cap={100} />);
  expect(text(h)).toBe(
    "No agreed budget yet. The CSM records it at the kickoff; until then a media buyer seat can set up to $100 a day.",
  );
  expect(h).not.toContain("$0");
});

test("the live Ads card the desk read is listed first and is the default", () => {
  const h = html(
    <BudgetSources
      agreed={chain}
      live={{ contractedUsd: 70, source: "Ads card" }}
      cap={140}
      onUse={() => {}}
    />,
  );
  expect(text(h)).toMatch(/^Agreed budget Ads card \$70 Default Kickoff/);
  expect(text(h)).toContain("Kickoff, 150 SAR $39.99 Use $39.99");
});

test("a Blueprint draft changed after the send and a kickoff under the floor say why, with no button", () => {
  const held = agreedBudget({
    cards: [],
    brief: {
      answers: { daily_budget: { usd: 150 } },
      sentAt: "2026-11-02T09:00:00Z",
      sentBudget: { usd: 45 },
    },
    kickoffBudget: {
      amount: 2,
      currency: "USD",
      usd: 2,
      fromText: false,
      said: null,
      at: null,
    },
    handover: {},
  });
  const h = html(<BudgetSources agreed={held} cap={90} onUse={() => {}} />);
  expect(text(h)).toContain("Blueprint part 1 $45 Default");
  expect(h).toContain('data-budget-source="blueprintDraft"');
  expect(text(h)).toContain(
    "Blueprint part 1, change not sent $150 Blueprint part 1 now says $150 a day but the change is not sent yet, so it is not the default.",
  );
  expect(text(h)).toContain(
    "Kickoff $2 The kickoff's $2 a day is too low: twice it is under the desk's $5 floor, so it is not the default.",
  );
  expect(h).not.toContain("<button");
});

test("the limit is said with its reason", () => {
  expect(budgetLimitWords(79.98, 39.99)).toBe(
    "Campaign limit $79.98 a day, twice the agreed budget.",
  );
  expect(budgetLimitWords(100, null)).toBe(
    "Campaign limit $100 a day until a budget is agreed.",
  );
  // The $5,000 ceiling can also be the founder limit, so do not attribute it
  // to twice the agreement even when those numbers happen to match.
  for (const agreed of [40, 2500, 3000]) {
    expect(budgetLimitWords(5000, agreed)).toBe("Campaign limit $5,000 a day.");
  }
  expect(budgetLimitWords(undefined, 40)).toBeNull();
});

test("the all-ads kickoff budget is distinguished from the campaign-only limit", () => {
  const h = html(<BudgetScopeNote />);
  expect(text(h)).toContain("The kickoff budget is for all the client's ads.");
  expect(text(h)).toContain("This limit checks this campaign only.");
  expect(text(h)).toContain("across the client's accounts and ad platforms");
  expect(h).toContain("data-budget-scope");
});

test("unknown or unsupported budget values do not claim an ad-set budget", () => {
  expect(waitingBudgetWords(25)).toBe("$25.00 a day");
  for (const value of [null, undefined, NaN, 0, -1]) {
    expect(waitingBudgetWords(value)).toBe("Budget not shown. Check Meta");
  }
});

test("the harness fixture's client reads its Blueprint, kickoff and sale", () => {
  const c = launchFixture().clients[0];
  const a = clientAgreedBudget(c);
  expect(a.sources.map(s => [s.label, s.usd, s.used])).toEqual([
    ["Blueprint part 1", 30, true],
    ["Kickoff, 150 SAR", 39.99, false],
    ["Sale (card Daily Budget)", 25, false],
  ]);
});

// ---------------------------------------------------------------------------
// The client page.

const cell = (agreed: unknown) => ({ v: 25, status: null, agreed }) as any;
const note = {
  usd: 39.99,
  key: "kickoff",
  from: "kickoff, 150 SAR",
  head: "Agreed $39.99 a day (kickoff, 150 SAR).",
  now: "Set now: $25 a day.",
  words: "Agreed $39.99 a day (kickoff, 150 SAR). Set now: $25 a day.",
  notes: [],
  sources: [],
};

test("the client page says the agreed figure against the budget now, not judged", () => {
  const h = html(<AgreedAgainstNow cell={cell(note)} />);
  expect(text(h)).toBe(
    "Agreed $39.99 a day (kickoff, 150 SAR). Set now: $25 a day. Based on available Meta data. Other accounts or platforms may be missing.",
  );
  expect(h).toContain("data-agreed-now");
  // Display only: no status dot, no warning colour.
  expect(h).not.toContain("data-status");
  expect(h).not.toMatch(/ceo-(warning|critical)|text-red|text-amber/);
  const sub = html(<AgreedSubline cell={cell(note)} />);
  expect(text(sub)).toBe("Agreed $39.99 a day (kickoff, 150 SAR).");
  expect(agreedHelp(cell(note))).toBe(`${note.words} Based on available Meta data. Other accounts or platforms may be missing.`);
});

test("why a source is not the default reaches the help and the line", () => {
  const month = {
    ...note,
    usd: null,
    key: null,
    from: null,
    head: "No agreed budget yet.",
    now: "Set now: at least $80 a day.",
    words: "No agreed budget yet. Set now: at least $80 a day.",
    notes: [
      "The sale's figure, $1,200 a day, looks like a month or another currency, so it is not the default. Ask the CSM.",
    ],
  };
  expect(text(html(<AgreedAgainstNow cell={cell(month)} />))).toBe(
    "No agreed budget yet. Set now: at least $80 a day. Based on available Meta data. Other accounts or platforms may be missing. The sale's figure, $1,200 a day, looks like a month or another currency, so it is not the default. Ask the CSM.",
  );
  expect(agreedHelp(cell(month))).toContain("Ask the CSM.");
});

test("an unread note says so; before 20261103e nothing shows", () => {
  const down = {
    words:
      "The agreed budget could not be read just now. Reload the page; if it stays, the tech lead checks the launch desk's budget chain.",
  };
  expect(text(html(<AgreedAgainstNow cell={cell(down)} />))).toBe(down.words);
  expect(html(<AgreedSubline cell={cell(down)} />)).toBe("");
  for (const before of [undefined, null, { usd: 40 }, "Agreed"]) {
    expect(agreedOf(cell(before))).toBeNull();
    expect(html(<AgreedAgainstNow cell={cell(before)} />)).toBe("");
    expect(html(<AgreedSubline cell={cell(before)} />)).toBe("");
  }
  expect(agreedOf(undefined)).toBeNull();
});
