/**
 * The Payments strip on Today and Ads (Aziz, 2026-10-13: "make it foldable,
 * cleaner, or less messy, so we can focus on the ads"), the board's payment
 * chips and filter, and the cost colours from Muhammed's grid. Every figure
 * here is made up.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  accountIssueFlag,
  type BillingPanel,
  billingStrip,
  chipAccounts,
  chipNeedsAll,
  FIRST_ROWS,
  hasPaymentProblem,
  metaBillingUrl,
  OVERDUE_MS,
  PAYMENT_FILTER,
  readFold,
  receiptsLine,
  reviewLabel,
  STOPPED_DAYS,
  STRIP_KEY,
  stoppedLine,
  stripChips,
  unmappedLine,
  writeFold,
} from "../src/lib/adBillingStrip";
import { cpbTone, cplTone } from "../src/lib/costTone";
import { CPB_BAD, CPB_GATE, CPL_BAD, CPL_GATE, gridCell } from "../src/lib/kpi";
import { normalizeDecisions } from "../src/lib/useMediaBuyerSnapshot";

const root = join(import.meta.dir, "..");
const source = (path: string) => readFileSync(join(root, path), "utf8");

// 16:30 in Kuwait on 13 October 2026.
const NOW = Date.parse("2026-10-13T13:30:00Z");
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

type B = BillingPanel["bindings"][number];
const binding = (over: Partial<B> & Pick<B, "id">): B => ({
  client: `Client ${over.id}`,
  clientTaskId: `task-${over.id}`,
  accountId: `act_10000${over.id}`,
  signal: "healthy",
  enabled: true,
  ready: true,
  checkedAt: minutesAgo(2),
  lastGoodAt: minutesAgo(2),
  error: null,
  deliveries: [],
  review: null,
  ...over,
});
const pending = { state: "pending", reason: null, decidedAt: null };
const sent = (channel: string) => ({
  channel,
  state: "accepted",
  error: null,
  providerId: "x",
});
const panel = (over: Partial<BillingPanel> = {}): BillingPanel => {
  const bindings = over.bindings ?? [
    binding({ id: "1" }),
    binding({ id: "2" }),
  ];
  return {
    apply: true,
    finishedAt: minutesAgo(3),
    error: null,
    roster: bindings.map(b => ({
      client: b.client,
      clientTaskId: b.clientTaskId,
      enrolled: true,
    })),
    ...over,
    bindings,
  };
};

describe("when the strip shows", () => {
  test("nothing at all when every check is fresh and every account is fine", () => {
    const s = billingStrip(panel(), { now: NOW });
    expect(s.hidden).toBe(true);
    expect(s.sentence).toBeNull();
    expect(s.accounts).toEqual([]);
  });

  test("a waiting client message, a failed message or an unmapped client each keep it", () => {
    const review = billingStrip(
      panel({ bindings: [binding({ id: "1", review: pending })] }),
      { now: NOW },
    );
    expect(review.hidden).toBe(false);
    expect(review.pending).toBe(1);

    const failed = billingStrip(
      panel({
        bindings: [
          binding({
            id: "1",
            deliveries: [
              sent("slack"),
              {
                channel: "whatsapp",
                state: "failed",
                error: "Number not on WhatsApp",
                providerId: null,
              },
            ],
          }),
        ],
      }),
      { now: NOW },
    );
    expect(failed.hidden).toBe(false);
    expect(failed.failed).toBe(1);
    expect(failed.accounts[0].label).toBe("Message failed");
    expect(stripChips(failed)).toEqual([
      {
        key: "failed",
        label: "1 message to check",
        tone: "warning",
        action: "panel",
      },
    ]);
    expect(failed.accounts[0].failures).toEqual([
      {
        label: "Client WhatsApp",
        state: "failed",
        error: "Number not on WhatsApp",
      },
    ]);

    const data = panel();
    data.roster.push({
      client: "Brillant Touch",
      clientTaskId: "bt",
      enrolled: false,
    });
    const unmapped = billingStrip(data, { now: NOW });
    expect(unmapped.hidden).toBe(false);
    expect(unmapped.unmapped).toEqual([
      { client: "Brillant Touch", clientTaskId: "bt" },
    ]);
  });

  test("a skipped Slack post (the 72-hour cap) and a provider receipt are not problems", () => {
    const s = billingStrip(
      panel({
        bindings: [
          binding({
            id: "1",
            deliveries: [
              sent("slack"),
              {
                channel: "slack",
                state: "skipped",
                error: null,
                providerId: null,
              },
            ],
          }),
        ],
      }),
      { now: NOW },
    );
    expect(s.hidden).toBe(true);
  });
});

describe("the row", () => {
  const flagged = panel({
    bindings: [
      binding({ id: "1", signal: "unsettled", review: pending }),
      binding({ id: "2", signal: "unsettled", review: pending }),
      binding({ id: "3", signal: "restricted" }),
      binding({ id: "4", signal: "payment_grace", review: pending }),
      binding({ id: "5" }),
    ],
  });

  // The board's own rows: accounts 1, 2 and 4 have a running campaign that
  // Meta flags; the restricted account 3 has none (Marble and more, 13 Oct).
  const board = [
    { metaAccountId: "act_100001", accountIssue: "Ad account unsettled: x" },
    { metaAccountId: "100002", accountIssue: "Ad account unsettled: x" },
    { metaAccountId: "100004", accountIssue: "Ad account in grace period." },
    { metaAccountId: "100005" },
  ];

  test("counts each signal, critical before warning, and leaves out zero counts", () => {
    const s = billingStrip(flagged, { now: NOW, campaigns: board });
    expect(s.counts).toEqual({ unpaid: 2, restricted: 1, grace: 1, other: 0 });
    expect(stripChips(s)).toEqual([
      { key: "unpaid", label: "2 unpaid", tone: "critical", action: "board" },
      // Its account has no campaign on the board: the filter would show
      // nothing for it, so the chip opens the panel instead.
      {
        key: "restricted",
        label: "1 restricted",
        tone: "critical",
        action: "panel",
      },
      {
        key: "grace",
        label: "1 in grace period",
        tone: "warning",
        action: "board",
      },
    ]);
    expect(s.pending).toBe(3);
    expect(reviewLabel(s.pending)).toBe("Review 3 client messages");
    expect(reviewLabel(1)).toBe("Review 1 client message");
  });

  test("a count turns on the board only when the board shows every account it counts", () => {
    // No campaigns at all: every count opens the panel.
    const bare = billingStrip(flagged, { now: NOW });
    expect(stripChips(bare).map(c => c.action)).toEqual([
      "panel",
      "panel",
      "panel",
    ]);
    // One of the two unpaid accounts is only on the Off tab (parked), the
    // other has a campaign Meta does not flag yet: neither shows under the
    // filter.
    const half = billingStrip(flagged, {
      now: NOW,
      campaigns: [
        { metaAccountId: "100001", accountIssue: "Ad account unsettled: x" },
        {
          metaAccountId: "100002",
          accountIssue: "Ad account unsettled: x",
          parked: true,
        },
        { metaAccountId: "100002" },
      ],
    });
    expect(half.accounts.find(a => a.id === "1")?.onBoard).toBe(true);
    expect(half.accounts.find(a => a.id === "2")?.onBoard).toBe(false);
    expect(stripChips(half).find(c => c.key === "unpaid")?.action).toBe(
      "panel",
    );
  });

  test("a chip that opens the panel shows every row when its account is past the first five", () => {
    const many = panel({
      bindings: [
        ...["a", "b", "c", "d", "e", "f"].map(id =>
          binding({ id, client: `Unpaid ${id}`, signal: "unsettled" }),
        ),
        binding({ id: "r", client: "Marble", signal: "restricted" }),
      ],
    });
    const s = billingStrip(many, { now: NOW });
    expect(s.accounts.map(a => a.client).indexOf("Marble")).toBe(6);
    expect(chipAccounts(s, "restricted").map(a => a.client)).toEqual([
      "Marble",
    ]);
    expect(chipAccounts(s, "unpaid")).toHaveLength(6);
    expect(chipAccounts(s, "unmapped")).toEqual([]);
    expect(chipNeedsAll(s, "restricted")).toBe(true);
    expect(chipNeedsAll(s, "unpaid")).toBe(true);
    const few = billingStrip(flagged, { now: NOW });
    expect(chipNeedsAll(few, "restricted")).toBe(false);
    // The panel chip shows them all; it never opens the panel by itself.
    const watch = source("src/components/AdBillingWatch.tsx");
    expect(watch).toContain("if (chipNeedsAll(s, c.key)) setAll(true);");
  });

  test("the mapping line and the receipts read in plain words, with the right plural", () => {
    expect(unmappedLine(1)).toBe("1 active client has no ad account mapped");
    expect(unmappedLine(2)).toBe("2 active clients have no ad account mapped");
    const s = billingStrip(
      panel({
        bindings: [
          binding({
            id: "1",
            signal: "unsettled",
            deliveries: [
              sent("slack"),
              sent("slack"),
              sent("clickup"),
              sent("clickup"),
            ],
          }),
        ],
      }),
      { now: NOW },
    );
    expect(receiptsLine(s.accounts[0])).toBe("4 sent");
    expect(s.accounts[0].failures).toEqual([]);
  });

  test("overdue checks replace the counts with one sentence, and missing is never zero", () => {
    expect(OVERDUE_MS).toBe(30 * 60_000);
    const fresh = billingStrip(
      { ...flagged, finishedAt: minutesAgo(29) },
      { now: NOW },
    );
    expect(fresh.sentence).toBeNull();

    const late = billingStrip(
      {
        ...flagged,
        finishedAt: minutesAgo(31),
        bindings: flagged.bindings.map(b => ({
          ...b,
          lastGoodAt: minutesAgo(31),
        })),
      },
      { now: NOW },
    );
    expect(late.hidden).toBe(false);
    // The time is when the last check finished, and the sentence says what
    // to do next.
    expect(late.sentence).toBe(
      "No billing check has finished since 15:59, so these may be old. Refresh, and tell technical operations if this stays.",
    );
    expect(stripChips(late)).toEqual([]);
    // Said once for the run: the healthy account does not become a row.
    expect(late.accounts.map(a => a.id)).toEqual(["1", "2", "3", "4"]);

    const never = billingStrip({ ...flagged, finishedAt: null }, { now: NOW });
    expect(never.sentence).toBe(
      "No billing check has finished yet, so nothing here is confirmed. Ask technical operations to check the billing worker.",
    );

    const failed = billingStrip(
      { ...panel(), error: "Meta read timed out" },
      { now: NOW },
    );
    expect(failed.hidden).toBe(false);
    expect(failed.sentence).toBe(
      "The last billing check failed (16:27). Treat these as old until the next one passes.",
    );

    const nobody = billingStrip(panel({ bindings: [], roster: [] }), {
      now: NOW,
    });
    expect(nobody.hidden).toBe(false);
    expect(nobody.sentence).toBe(
      "No client is covered by the billing check yet. Ask technical operations to enrol the active clients.",
    );
  });

  test("one account whose own check is late is a row, not 16", () => {
    const s = billingStrip(
      panel({
        bindings: [
          binding({ id: "1", lastGoodAt: minutesAgo(45) }),
          binding({ id: "2" }),
        ],
      }),
      { now: NOW },
    );
    expect(s.sentence).toBeNull();
    expect(s.accounts.map(a => [a.id, a.label, a.fault])).toEqual([
      ["1", "Check overdue", "Not checked since 15:45."],
    ]);
    expect(stripChips(s).map(c => c.label)).toEqual(["1 account to check"]);
  });

  test("every check in the strip uses the one 30-minute line", () => {
    const strip = source("src/lib/adBillingStrip.ts");
    const watch = source("src/components/AdBillingWatch.tsx");
    expect(strip.match(/60_000/g)).toHaveLength(1);
    expect(strip).toContain("export const OVERDUE_MS = 30 * 60_000;");
    expect(watch).not.toMatch(/\d+ \* 60_000/);
    // Polls no faster than once a minute.
    expect(watch).toContain("}, 60_000);");
  });
});

describe("accounts that stopped spending", () => {
  const data = panel({
    bindings: [
      binding({ id: "1", signal: "unsettled", accountId: "act_111" }),
      binding({ id: "2", signal: "unsettled", accountId: "222" }),
      binding({ id: "3", signal: "unsettled", accountId: "333" }),
      binding({ id: "4", signal: "payment_grace", accountId: "444" }),
      binding({ id: "5", signal: "unsettled", accountId: "555" }),
      binding({ id: "6", accountId: "666" }),
    ],
  });
  const campaigns = [
    { metaAccountId: "111", dataThrough: "2026-10-09" },
    { metaAccountId: "act_222", dataThrough: "2026-10-10" },
    { metaAccountId: "333", dataThrough: "2026-10-11" },
    { metaAccountId: "444", dataThrough: "2026-10-12" },
    // 555 has no campaign on the board: unknown, so it is not counted.
    { metaAccountId: "666", dataThrough: "2026-10-12" },
    { metaAccountId: "777", dataThrough: "2026-10-12", internal: true },
  ];

  test("count only flagged accounts at least two days behind the newest day, and say since when", () => {
    expect(STOPPED_DAYS).toBe(2);
    const s = billingStrip(data, { now: NOW, campaigns });
    expect(s.accounts.filter(a => a.stopped).map(a => a.id)).toEqual([
      "1",
      "2",
    ]);
    expect(s.stopped).toEqual({ count: 2, since: "2026-10-10" });
    expect(stoppedLine(s)).toBe("2 accounts have not spent since 10 Oct");
    const one = billingStrip(data, { now: NOW, campaigns: campaigns.slice(1) });
    expect(stoppedLine(one)).toBe("1 account has not spent since 10 Oct");
  });

  test("say nothing when no campaign tells", () => {
    const s = billingStrip(data, { now: NOW });
    expect(s.stopped).toBeNull();
    expect(stoppedLine(s)).toBeNull();
    expect(s.accounts.every(a => a.lastSpend === null && !a.stopped)).toBe(
      true,
    );
  });

  test("most urgent first: the signal, then stopped (longest first), then a waiting message", () => {
    const urgent = panel({
      bindings: [
        binding({ id: "g", client: "Grace", signal: "payment_grace" }),
        binding({ id: "f", client: "Fault", error: "Account mapping changed" }),
        binding({ id: "r", client: "Restricted", signal: "restricted" }),
        binding({
          id: "w",
          client: "Waiting",
          signal: "unsettled",
          review: pending,
        }),
        binding({ id: "q", client: "Quiet", signal: "unsettled" }),
        binding({
          id: "o",
          client: "Old stop",
          signal: "unsettled",
          accountId: "900",
        }),
        binding({
          id: "n",
          client: "New stop",
          signal: "unsettled",
          accountId: "901",
        }),
      ],
    });
    const s = billingStrip(urgent, {
      now: NOW,
      campaigns: [
        { metaAccountId: "900", dataThrough: "2026-10-08" },
        { metaAccountId: "901", dataThrough: "2026-10-10" },
        { metaAccountId: "999", dataThrough: "2026-10-12" },
      ],
    });
    expect(s.accounts.map(a => a.client)).toEqual([
      "Old stop",
      "New stop",
      "Waiting",
      "Quiet",
      "Restricted",
      "Grace",
      "Fault",
    ]);
    expect(s.accounts.map(a => a.tone)).toEqual([
      "critical",
      "critical",
      "critical",
      "critical",
      "critical",
      "warning",
      "warning",
    ]);
    expect(s.accounts.at(-1)?.fault).toBe(
      "The last check of this account failed: Account mapping changed",
    );
    expect(FIRST_ROWS).toBe(5);
  });

  test("Meta billing links name the bare account id", () => {
    expect(metaBillingUrl("act_123")).toBe(
      "https://business.facebook.com/billing_hub/accounts/details/?asset_id=123",
    );
  });
});

describe("the fold", () => {
  const memory = () => {
    const items = new Map<string, string>();
    return {
      items,
      getItem: (k: string) => items.get(k) ?? null,
      setItem: (k: string, v: string) => void items.set(k, v),
    };
  };

  test("starts folded, is remembered under one key that Today and Ads share", () => {
    const store = memory();
    expect(readFold(store)).toBe(false);
    writeFold(true, store);
    expect(STRIP_KEY).toBe("mahara-buyer-billing-strip");
    expect(store.items.get(STRIP_KEY)).toBe('{"open":true}');
    expect(readFold(store)).toBe(true);
    writeFold(false, store);
    expect(readFold(store)).toBe(false);
    store.items.set(STRIP_KEY, "not json");
    expect(readFold(store)).toBe(false);
  });

  test("a storage that throws leaves it folded and never breaks the page", () => {
    const broken = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(readFold(broken)).toBe(false);
    expect(() => writeFold(true, broken)).not.toThrow();
  });

  test("never opens by itself", () => {
    const watch = source("src/components/AdBillingWatch.tsx");
    expect(watch).toContain("useState(() => readFold())");
    expect(watch).not.toMatch(/setOpen\(true\)|fold\(true\)/);
  });
});

describe("the board's payment chips and filter", () => {
  // The exact sentences hermes/cockpit-sync/calculator.ts writes from Meta's
  // account_status (3, 9, 7/8, 2, 100/101).
  const ISSUES = {
    unsettled:
      "Ad account unsettled: an unpaid Meta balance. Meta refuses pauses, budget changes and new ads until it is paid.",
    grace: "Ad account in payment grace period.",
    review: "Ad account pending review or settlement at Meta.",
    disabled:
      "Ad account disabled by Meta. Nothing can be changed until it is reinstated.",
    closed: "Ad account closed or closing.",
  };

  test("the sentences still match what the sync writes", () => {
    const calculator = readFileSync(
      join(root, "../../hermes/cockpit-sync/calculator.ts"),
      "utf8",
    );
    for (const text of Object.values(ISSUES))
      expect(calculator).toContain(text);
  });

  test("a grace period or a review is a warning, never Account blocked in red", () => {
    expect(accountIssueFlag(ISSUES.unsettled)).toEqual({
      label: "Unpaid balance",
      tone: "critical",
    });
    expect(accountIssueFlag(ISSUES.grace)).toEqual({
      label: "Payment grace period",
      tone: "warning",
    });
    expect(accountIssueFlag(ISSUES.review)).toEqual({
      label: "Payment under review",
      tone: "warning",
    });
    expect(accountIssueFlag(ISSUES.disabled)).toEqual({
      label: "Account disabled",
      tone: "critical",
    });
    expect(accountIssueFlag(ISSUES.closed)).toEqual({
      label: "Account closed",
      tone: "critical",
    });
    expect(accountIssueFlag(undefined)).toBeNull();
    expect(accountIssueFlag("")).toBeNull();
  });

  test("the Payment problem filter takes every flagged campaign and nothing else", () => {
    expect(PAYMENT_FILTER).toBe("Payment problem");
    for (const text of Object.values(ISSUES))
      expect(hasPaymentProblem({ accountIssue: text })).toBe(true);
    expect(hasPaymentProblem({})).toBe(false);
    const page = source("src/pages/CockpitPage.tsx");
    // The Ads filters live in adsFilters.ts since 2026-10-21.
    expect(source("src/lib/adsFilters.ts")).toContain(
      "{ label: PAYMENT_FILTER, test: c => hasPaymentProblem(c) }",
    );
    expect(page).toContain("const issue = accountIssueFlag(c.accountIssue);");
    expect(page).not.toContain('"Account blocked"');
    // The opened panel's dot agrees with the row chip: a grace period is
    // orange, not red.
    expect(page).toContain(
      'accountIssueFlag(c.accountIssue)?.tone === "warning"',
    );
    expect(page).not.toMatch(
      /backgroundColor: TONE_DOT\.bad,\s*\}\}\s*\/>\s*\{c\.accountIssue\}/,
    );
    // The strip learns which accounts the filter shows.
    expect(page).toContain("parked: isParked(c),");
    expect(page).not.toContain('"Card declined"');
    // Today's chips open Ads on this filter.
    expect(page).toContain('navigate("/ads?filter=payment")');
    expect(page).toContain(
      'params.get("filter") === "payment" ? PAYMENT_FILTER',
    );
  });
});

describe("cost colours follow the grid", () => {
  test("cost per lead: good to $15, a warning to $22.50, bad above", () => {
    expect([CPL_GATE, CPL_BAD]).toEqual([15, 22.5]);
    expect(cplTone(14.99)).toBe("good");
    expect(cplTone(15)).toBe("good");
    expect(cplTone(15.01)).toBe("warn");
    expect(cplTone(22.5)).toBe("warn");
    expect(cplTone(22.51)).toBe("bad");
    expect(cplTone(undefined)).toBeUndefined();
    expect(cplTone(null)).toBeUndefined();
    expect(cplTone(Number.NaN)).toBeUndefined();
  });

  test("cost per booking: good to $60, a warning to $80, bad above", () => {
    expect([CPB_GATE, CPB_BAD]).toEqual([60, 80]);
    expect(cpbTone(60)).toBe("good");
    expect(cpbTone(60.5)).toBe("warn");
    expect(cpbTone(80)).toBe("warn");
    expect(cpbTone(80.01)).toBe("bad");
    expect(cpbTone(undefined)).toBeUndefined();
  });

  test("the lead colour is the grid's own column", () => {
    for (const cpl of [5, 15, 15.5, 22.5, 23, 60]) {
      const column = gridCell(cpl * 10, 10, 1).column;
      expect(cplTone(cpl)).toBe((["good", "warn", "bad"] as const)[column]);
    }
  });

  test("the board, the tile and a client's page use the grid, not the old single gates", () => {
    const page = source("src/pages/CockpitPage.tsx");
    expect(page).toContain("costText(cplTone(ok?.cpl))");
    expect(page).toContain("costText(cpbTone(ok?.costPerBooking))");
    expect(page).toContain("tone: cplTone(t.blendedCpl)");
    expect(page).not.toMatch(/ok\.cpl > CPL_GATE|costPerBooking > 80/);
    const account = source("src/components/AccountView.tsx");
    expect(account).toContain("gate(cpl, cplTone(cpl), CPL_GATE, CPL_BAD)");
    expect(account).toContain("gate(cpb, cpbTone(cpb), CPB_GATE, CPB_BAD)");
    expect(account).not.toMatch(/> CPL_GATE|> CPB_GATE/);
    // The campaign panel under each board row and inside a client's page.
    const range = source("src/components/CampaignRange.tsx");
    expect(range).toContain("costText(cplTone(data.total.cpl))");
    expect(range).toContain("costText(cpbTone(data.total.costPerBooking))");
    expect(range).toContain("costText(cplTone(r.cpl))");
    expect(range).toContain("costText(cpbTone(cost(r).value))");
    expect(range).not.toMatch(/> CPL_GATE|> CPB_GATE|bookingCostTone\(/);
  });
});

describe("the words around the numbers", () => {
  test("the EOD says 7-day where it reads 7 days, and no leads is not $0", () => {
    const page = source("src/pages/CockpitPage.tsx");
    expect(page).not.toContain("CPL_GATE} today");
    expect(page).toContain("Any client with a 7-day CPL above");
    expect(page).toContain("Any client with a 7-day CPL over");
    expect(page).toContain(
      'cpl: leads > 0 ? (spend / leads).toFixed(0) : "no leads"',
    );
    expect(page).toContain(
      "Average CPL (7d): $" +
        '{leads > 0 ? money(spend / leads, 2) : "no leads"}',
    );
  });

  test("a client's page shows n/a with a reason when a read fails, never $0.00 and 0", () => {
    const account = source("src/components/AccountView.tsx");
    expect(account).toContain('const quiet = card.failed ? "n/a" : undefined;');
    expect(account).toContain("The numbers could not be read");
    // Said once above the ad wall, not on every tile; the tile keeps the
    // reason on hover.
    expect(account).toContain("show n/a: their numbers could not be read.");
    expect(account).toContain("title={card.failed ? FAILED_READ : undefined}");
    expect(
      account.match(/numbers could not be read\. Reload to try/g),
    ).toHaveLength(1);
  });

  test("the change log keeps the ClickUp link and says posting is off", () => {
    const [row] = normalizeDecisions([
      {
        id: 7,
        subject: "Villa | Leads",
        action: "Paused Ad-2",
        logged_at: "2026-10-13T13:19:49Z",
        clickup_task_url: "https://app.clickup.com/t/86exabc",
      },
    ]);
    expect(row.loggedAt).toBe(Date.parse("2026-10-13T13:19:49Z"));
    expect(row.clickupTaskUrl).toBe("https://app.clickup.com/t/86exabc");
    const [bare] = normalizeDecisions([
      {
        id: 8,
        subject: "x",
        action: "y",
        clickup_task_url: "javascript:alert(1)",
      },
    ]);
    expect(bare.clickupTaskUrl).toBeUndefined();
    expect(bare.loggedAt).toBeUndefined();
    const page = source("src/pages/CockpitPage.tsx");
    expect(page).not.toContain("Logging to ClickUp");
    expect(page).toContain("Saved in the cockpit");
    expect(page).toContain("Posting decisions to ClickUp is off for now");
  });

  test("the refresh banner says one true sentence", () => {
    const banner = source("src/components/ViktorStatus.tsx");
    expect(banner).toContain(
      "The last refresh did not finish. These numbers are from $" +
        "{dateTime(a.lastSyncAt)}.",
    );
    expect(banner).not.toContain(
      "Part of this screen is not showing everything",
    );
    const tracking = source("src/components/TrackingIssues.tsx");
    expect(tracking).not.toContain("refreshed weekly");
    expect(tracking).toContain("A daily check against Meta finds them.");
  });
});
