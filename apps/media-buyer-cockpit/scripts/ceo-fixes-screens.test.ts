/**
 * The CEO screens built on 2026-10-11 from the CEO's open asks: the Money
 * tab's LTV card refusal (R3), the feedback queue gate (R6), the timeframe
 * bar on Client success, Today, Management and Recruiting (A127/A170),
 * kickoff cash in front-end cash (A087), two commission lines (A074), the
 * Proposals card (A234), churn from the register (A078), failed sections on
 * Machine (A081) and the morning Slack note switch (A372). Every figure here
 * is made up.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  previousOf,
  startsLate,
  sumIn,
  tabBounds,
  tabWindow,
} from "../src/components/ceo/tabWindow";
import {
  frontEndCashSub,
  KICKOFF_READ_FROM,
  windowFromDaily,
} from "../src/components/ceo/timeframe";
import { parseNudge, setNudge } from "../src/lib/ceoHoursClient";
import { savePerson } from "../src/lib/ceoPeopleClient";
import { peopleRoster } from "../src/lib/ceoPeopleModel";
import { churnView, registerMonths } from "../src/pages/ceo/churnRegister";
import { ltvRefusal } from "../src/pages/ceo/ltvRefusal";
import {
  sectionsFailing,
  sectionsFailingText,
} from "../src/pages/ceo/machineState";
import {
  closerName,
  proposalChip,
  proposalHref,
  proposalRows,
  proposalSummary,
} from "../src/pages/ceo/proposals";
import {
  clientNumbers,
  countIn,
  eodIn,
  extensionsIn,
  NOT_PER_DAY,
  refundsIn,
  registerIn,
  seenIn,
  teamInWindow,
} from "../src/pages/ceo/windowedNumbers";
import {
  COMMISSION_BASES,
  COMMISSION_LABEL,
  COMMISSION_SHORT,
  commissionLines,
} from "../src/types/ceo/commission";
import {
  BASIS_ON,
  type Payee,
  payroll,
  planAmount,
  qualifiedIntroShare,
} from "../src/types/ceo/costsModel";
import type {
  ChurnRegisterMonth,
  FunnelWindow,
  GrowthDay,
} from "../src/types/ceo/payloads";

const say = { money: (v: number) => `$${v}`, count: (v: number) => String(v) };
const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("R3: the LTV card says its refusal instead of blanking the Money tab", () => {
  test("the server's sentence, then that it clears by itself", () => {
    expect(
      ltvRefusal(
        new Error(
          "Finance totals need reconciliation before updating lifetime value",
        ),
      ),
    ).toBe(
      "Finance totals need reconciliation before updating lifetime value. It clears by itself after the next successful Money refresh.",
    );
  });
  test("each of the server's other refusals says what happens next", () => {
    expect(
      ltvRefusal(
        new Error(
          "Money attribution is missing or stale; refresh it before lifetime value",
        ),
      ),
    ).toContain("after the next successful Money refresh.");
    expect(
      ltvRefusal(new Error("Client billing source is missing or stale")),
    ).toBe(
      "Client billing source is missing or stale. It clears by itself after the next billing sync, every half hour in the day.",
    );
    expect(
      ltvRefusal(
        new Error(
          "Some active client billing rows are stale; refresh before lifetime value",
        ),
      ),
    ).toContain("after the next billing sync");
    // An invalid baseline never clears by itself: never promise it does.
    const invalid = ltvRefusal(new Error("Lifetime value baseline is invalid"));
    expect(invalid).not.toContain("clears by itself");
    expect(invalid).toBe(
      "Lifetime value baseline is invalid. It will not clear by itself: queue it as a bug under Changes and bugs on the Machine tab.",
    );
  });
  test("the card reads without throwing", () => {
    const card = src("../src/pages/ceo/moneyImport.tsx");
    const ltv = card.slice(card.indexOf("export function LtvWriteCard"));
    expect(ltv).toContain("useQueryState(");
    expect(ltv).not.toContain("useQuery(api.ceo.ltv.preview");
    expect(src("../src/lib/cockpitApi.ts")).toContain(
      "export function useQueryState",
    );
  });
});

describe("R6: the changes-and-bugs queue shows for the CEO", () => {
  test("gated on the verified seat's isCeo, not the retired isFounder", () => {
    const q = src("../src/pages/ceo/feedbackQueue.tsx");
    expect(q).toContain("const { isCeo } = useCockpitAuth()");
    expect(q).not.toContain("me.isFounder");
  });
});

describe("A127/A170: one timeframe for a tab", () => {
  test("words for a preset, a month and custom days", () => {
    expect(tabWindow("7d", { from: "2026-10-04", to: "2026-10-10" })).toEqual({
      range: "7d",
      from: "2026-10-04",
      to: "2026-10-10",
      label: "4 to 10 Oct",
      short: "7d",
    });
    expect(
      tabWindow("lastMonth", { from: "2026-09-01", to: "2026-09-30" })?.short,
    ).toBe("Sep");
    expect(
      tabWindow("custom", { from: "2026-10-01", to: "2026-10-05" })?.short,
    ).toBe("1–5 Oct");
    expect(tabWindow("30d", null)).toBeNull();
  });
  test("a series not kept is null, never zero", () => {
    const w = { from: "2026-10-01", to: "2026-10-02" };
    expect(sumIn(undefined, w, () => 1)).toBeNull();
    expect(sumIn([], w, () => 1)).toBe(0);
    expect(
      sumIn(
        [
          { date: "2026-09-30", v: 5 },
          { date: "2026-10-01", v: 2 },
          { date: "2026-10-02", v: 3.333 },
        ],
        w,
        r => r.v,
      ),
    ).toBe(5.33);
  });
  test("the run before is the same length", () => {
    expect(previousOf({ from: "2026-10-01", to: "2026-10-10" })).toEqual({
      from: "2026-09-21",
      to: "2026-09-30",
    });
    expect(startsLate("2026-08-13", { from: "2026-08-01" })).toBe(true);
    expect(startsLate("2026-08-13", { from: "2026-09-01" })).toBe(false);
  });
  test("this month runs through today, as the server's month-to-date figures do", () => {
    const tf = (range: "mtd" | "7d") => ({
      range,
      // The shared hook's rule: the preset ends at the day it is given.
      bounds: (last: string) => ({
        from: range === "mtd" ? `${last.slice(0, 7)}-01` : "2026-10-04",
        to: last,
      }),
    });
    // "1 to 11 Oct, compared with 1 to 11 Sep", the same days as the
    // cash pace ("by 11 Sep") and the growth funnel's month to date.
    expect(tabBounds(tf("mtd"), "2026-10-11", null)).toEqual({
      from: "2026-10-01",
      to: "2026-10-11",
    });
    // On the 1st it is the new month, never all of last month.
    expect(tabBounds(tf("mtd"), "2026-11-01", null)).toEqual({
      from: "2026-11-01",
      to: "2026-11-01",
    });
    // Every other preset ends yesterday, the last whole day.
    expect(tabBounds(tf("7d"), "2026-10-11", null)?.to).toBe("2026-10-10");
  });
});

describe("A127: Client success per-client numbers", () => {
  const row = {
    leads7d: 4,
    cpl7d: 12.5,
    bookings7d: 2,
    daily: [
      { date: "2026-10-01", spend: 30, leads: 2, bookings: 1 },
      { date: "2026-10-02", spend: 20, leads: 0, bookings: 0 },
      { date: "2026-10-03", spend: 50, leads: 3, bookings: 1 },
    ],
  };
  const w = (range: string, from: string, to: string) => ({ range, from, to });
  test("7 days keeps the server's own columns", () => {
    const n = clientNumbers(
      row,
      w("7d", "2026-10-04", "2026-10-10"),
      "2026-08-13",
      "x",
    );
    expect(n).toMatchObject({
      leads: 4,
      cpl: 12.5,
      bookings: 2,
      from: "fixed7",
    });
  });
  test("any other window is a sum of the client's days", () => {
    const n = clientNumbers(
      row,
      w("custom", "2026-10-01", "2026-10-03"),
      "2026-08-13",
      "x",
    );
    expect(n).toMatchObject({
      spend: 100,
      leads: 5,
      bookings: 2,
      cpl: 20,
      from: "daily",
    });
  });
  test("no leads is no cost per lead, with the reason", () => {
    const n = clientNumbers(
      row,
      w("custom", "2026-10-02", "2026-10-02"),
      "2026-08-13",
      "x",
    );
    expect(n.cpl).toBeNull();
    expect(n.why).toContain("No leads");
  });
  test("not kept per day, no campaign and an unread history say so", () => {
    const { daily: _d, ...old } = row;
    expect(
      clientNumbers(
        old,
        w("30d", "2026-09-11", "2026-10-10"),
        undefined,
        "no campaign",
      ).why,
    ).toBe(NOT_PER_DAY);
    expect(
      clientNumbers(
        { ...row, daily: null },
        w("30d", "2026-09-11", "2026-10-10"),
        "2026-08-13",
        "no campaign",
      ).why,
    ).toBe("no campaign");
    expect(
      clientNumbers(
        { ...row, daily: null },
        w("30d", "2026-09-11", "2026-10-10"),
        null,
        "no campaign",
      ).why,
    ).toContain("could not be read");
  });
});

describe("A127: extensions, churn register and portal over the window", () => {
  const ext = {
    from: "2026-10-01",
    to: "2026-10-11",
    totalWeeks: 3,
    grants: 2,
    perClient: [
      {
        client: "Acme",
        clickupTaskId: "t1",
        weeks: 2,
        until: "2026-10-20",
        live: true,
      },
    ],
    read: true,
    clickupField: { written: 0, note: "" },
    grantRows: [
      {
        day: "2026-09-10",
        taskId: "t1",
        client: "Acme",
        weeks: 1,
        until: "2026-09-17",
      },
      {
        day: "2026-10-06",
        taskId: "t1",
        client: "Acme",
        weeks: 2,
        until: "2026-10-20",
      },
      {
        day: "2026-10-08",
        taskId: null,
        client: "Typed Co",
        weeks: 1,
        until: "2026-10-15",
      },
    ],
  };
  test("the server's own window stands as it is", () => {
    expect(
      extensionsIn(
        ext,
        { range: "mtd", from: "2026-10-01", to: "2026-10-11" },
        "2026-10-11",
      ).totalWeeks,
    ).toBe(3);
  });
  test("any window is counted from the grant rows, live cover kept", () => {
    const v = extensionsIn(
      ext,
      { range: "custom", from: "2026-09-01", to: "2026-09-30" },
      "2026-10-11",
    );
    expect(v.totalWeeks).toBe(1);
    expect(v.grants).toBe(1);
    // Acme had a grant in the window and cover running today; Typed Co is live today only.
    expect(v.perClient.map(c => [c.client, c.weeks, c.live])).toEqual([
      ["Acme", 1, true],
      ["Typed Co", 0, true],
    ]);
  });
  test("without grant rows, only the server's windows are known", () => {
    const { grantRows: _g, ...old } = ext;
    expect(
      extensionsIn(
        old,
        { range: "7d", from: "2026-10-04", to: "2026-10-10" },
        "2026-10-11",
      ).why,
    ).toBe(NOT_PER_DAY);
  });
  const months: ChurnRegisterMonth[] = [
    {
      month: "2026-08",
      activeAtStart: null,
      newClients: 10,
      churned: 2,
      churnPct: null,
      rolling3Pct: null,
    },
    {
      month: "2026-09",
      activeAtStart: 22,
      newClients: null,
      churned: 1,
      churnPct: 4.5,
      rolling3Pct: 4.5,
      band: { label: "Good", tone: "good" },
    },
    {
      month: "2026-10",
      activeAtStart: null,
      newClients: null,
      churned: 0,
      churnPct: null,
      rolling3Pct: null,
      startCarried: false,
    },
  ];
  test("churn counts every month the window touches", () => {
    expect(
      registerIn(
        { months },
        { range: "custom", from: "2026-09-15", to: "2026-10-10" },
      ),
    ).toEqual({
      months: ["2026-09", "2026-10"],
      churned: 1,
      starts: 22,
      rate: 0.045,
      lostNoStart: 0,
      missing: ["2026-10"],
    });
    // August lost 2 with no start count: said apart, never in the rate (the
    // Churn page's rolling rule), so the rate stays 1 of 22, not 3 of 22.
    expect(
      registerIn(
        { months },
        { range: "90d", from: "2026-07-13", to: "2026-10-10" },
      ),
    ).toEqual({
      months: ["2026-07", "2026-08", "2026-09", "2026-10"],
      churned: 1,
      starts: 22,
      rate: 0.045,
      lostNoStart: 2,
      missing: ["2026-07", "2026-10"],
    });
    expect(
      registerIn(null, { range: "30d", from: "2026-09-11", to: "2026-10-10" }),
    ).toBeNull();
  });
  test("portal seen: a window ending today counts last visits; an earlier end cannot", () => {
    const rows = [
      { portalLastSeenAt: Date.parse("2026-10-05T10:00:00+03:00") },
      { portalLastSeenAt: null },
    ];
    const start = (d: string) => Date.parse(`${d}T00:00:00+03:00`);
    expect(
      seenIn(
        rows,
        { range: "30d", from: "2026-09-11", to: "2026-10-10" },
        "2026-10-10",
        start,
      ),
    ).toEqual({ seen: 1, why: null });
    expect(
      seenIn(
        rows,
        { range: "lastMonth", from: "2026-09-01", to: "2026-09-30" },
        "2026-10-10",
        start,
      )?.why,
    ).toContain("last visit");
  });
});

describe("A078: churn on Backend reads the register", () => {
  const reg = {
    through: "2026-10",
    departures: 0,
    months: [
      {
        month: "2026-09",
        activeAtStart: 22,
        newClients: null,
        churned: 1,
        churnPct: 4.5,
        rolling3Pct: 4.5,
        band: { label: "Good", tone: "good" as const },
      },
      {
        month: "2026-10",
        activeAtStart: null,
        newClients: null,
        churned: 0,
        churnPct: null,
        rolling3Pct: null,
        startCarried: false,
      },
    ],
  };
  test("October not logged says what to do; September and the rolling three months show", () => {
    const v = churnView(reg, "2026-10");
    expect(v?.rate).toBeNull();
    expect(v?.sub).toBe(
      "October is not in the churn register yet; log it on the client success Churn page.",
    );
    expect(v?.last).toBe("1 of 22 (4.5%)");
    expect(v?.rolling).toBe("4.5%, Good (through September)");
  });
  test("a logged month gives the rate", () => {
    const v = churnView(
      {
        months: [
          ...reg.months.slice(0, 1),
          {
            month: "2026-10",
            activeAtStart: 21,
            newClients: 2,
            churned: 1,
            churnPct: 4.8,
            rolling3Pct: 4.7,
            band: { label: "Good", tone: "good" },
          },
        ],
      },
      "2026-10",
    );
    expect(v?.rate).toBeCloseTo(0.048);
    expect(v?.sub).toBe("1 of 21 at the start");
    expect(v?.rolling).toBe("4.7%, Good");
  });
  test("the roll-up or an object around it", () => {
    expect(registerMonths(reg.months)?.length).toBe(2);
    expect(registerMonths(null)).toBeNull();
  });
});

describe("A127: Management EODs and Recruiting counts", () => {
  const p = {
    eod14: { due: 9, filed: 9, late: 0, missed: 0 },
    eodDays: [
      { date: "2026-10-01", due: true, filed: true, late: false },
      { date: "2026-10-02", due: false, filed: false, late: false },
      { date: "2026-10-03", due: true, filed: true, late: true },
      { date: "2026-10-04", due: true, filed: false, late: false },
    ],
  };
  test("due, filed, late and missed in the window", () => {
    expect(
      eodIn(p, { range: "custom", from: "2026-10-01", to: "2026-10-04" }),
    ).toEqual({ due: 3, filed: 2, late: 1, missed: 1 });
  });
  test("the team follows the window; without days it stays on 14 working days", () => {
    const w = { range: "custom", from: "2026-10-03", to: "2026-10-04" };
    expect(teamInWindow([p], w)).toEqual({
      people: [{ ...p, eod14: { due: 2, filed: 1, late: 1, missed: 1 } }],
      kept: true,
    });
    const { eodDays: _e, ...old } = p;
    expect(teamInWindow([old], w)).toEqual({ people: [old], kept: false });
  });
  test("applied and hired by day", () => {
    const s = [
      { date: "2026-10-01", count: 3 },
      { date: "2026-10-09", count: 2 },
    ];
    expect(
      countIn(s, { range: "7d", from: "2026-10-04", to: "2026-10-10" }),
    ).toBe(2);
    expect(
      countIn(undefined, { range: "7d", from: "2026-10-04", to: "2026-10-10" }),
    ).toBeNull();
  });
  test("refunds from the ledger; a window before the ledger cannot be counted", () => {
    const tx = [
      { day: "2026-10-02", kind: "refund" as const, usd: -150 },
      { day: "2026-10-03", kind: "client" as const, usd: 900 },
    ];
    expect(
      refundsIn(tx, "2026-09-01", {
        range: "mtd",
        from: "2026-10-01",
        to: "2026-10-10",
      }),
    ).toBe(150);
    expect(
      refundsIn(tx, "2026-09-01", {
        range: "90d",
        from: "2026-07-13",
        to: "2026-10-10",
      }),
    ).toBeNull();
  });
});

describe("A087: kickoff cash joins front-end cash", () => {
  const day = (
    date: string,
    deposit: number,
    kickoff?: number | null,
    kickoffConfirmed?: number,
  ): GrowthDay => ({
    date,
    spend: 100,
    leads: 1,
    booked: 0,
    closes: 1,
    introsDue: 0,
    deposit,
    kickoff,
    kickoffConfirmed,
  });
  test("a window after 4 Oct adds kickoff to deposit, and to ROAS", () => {
    const w = windowFromDaily(
      [day("2026-10-04", 500, 1500, 0), day("2026-10-05", 0, 0, 0)],
      "2026-10-04",
      "2026-10-05",
    );
    expect(w.frontEndCash).toMatchObject({
      deposit: 500,
      kickoff: 1500,
      total: 2000,
      kickoffConfirmed: 0,
      kickoffConfirmedShare: 0,
    });
    expect(w.roasCash).toBe(10);
  });
  test("a window before the form carried the amount says kickoff is not read, never $0", () => {
    const w = windowFromDaily(
      [day("2026-09-20", 500, null), day("2026-09-21", 0)],
      "2026-09-20",
      "2026-09-21",
    );
    expect(w.frontEndCash.kickoff).toBeNull();
    expect(w.frontEndCash.total).toBe(500);
    expect(frontEndCashSub(w.frontEndCash, w.from)).toBe(
      "deposit $500 · kickoff read from 4 Oct",
    );
  });
  test("the line under the figure", () => {
    const fe: FunnelWindow["frontEndCash"] = {
      deposit: 1000,
      kickoff: 1500,
      total: 2500,
      deals: 2,
      dealsConfirmed: 1,
      confirmed: 1000,
      confirmedShare: 1,
      kickoffConfirmed: 500,
      kickoffConfirmedShare: 0.333,
    };
    expect(frontEndCashSub(fe, "2026-10-05")).toBe(
      "deposit $1,000 + kickoff $1,500, 60% confirmed on a rail",
    );
    expect(frontEndCashSub(fe, "2026-10-01")).toBe(
      "deposit $1,000 + kickoff $1,500, 60% confirmed on a rail · kickoff read from 4 Oct",
    );
    expect(KICKOFF_READ_FROM).toBe("2026-10-04");
  });
});

describe("A074: two commission lines per person", () => {
  test("the setter's two bases exist, with words and what they are paid on", () => {
    for (const b of ["per_qualified_intro_shown", "per_closed_deal"] as const) {
      expect(COMMISSION_BASES).toContain(b);
      expect(COMMISSION_LABEL[b]).toBeTruthy();
      expect(COMMISSION_SHORT[b]).toBeTruthy();
    }
    expect(BASIS_ON.per_qualified_intro_shown).toBe("introsQualifiedShown");
    expect(BASIS_ON.per_closed_deal).toBe("fullCloses");
    expect(
      commissionLines(
        [
          { basis: "per_qualified_intro_shown", rate: 10 },
          { basis: "per_closed_deal", rate: 50 },
        ],
        "USD",
        null,
      ),
    ).toBe(
      "USD 10 per qualified intro call that shows up, plus USD 50 per deal that fully closes (not a deposit and then gone: voided deals are left out)",
    );
  });
  test("the roster reads line 2, and an older roster has none", () => {
    const base = {
      id: 1,
      name: "S",
      active: true,
      monthly_cost: 500,
      currency: "USD",
      commission_basis: "per_qualified_intro_shown",
      commission_rate: "10",
    };
    const [p] = peopleRoster([
      { ...base, commission2_basis: "per_closed_deal", commission2_rate: "50" },
    ]).people;
    expect(p.commission).toEqual({
      basis: "per_qualified_intro_shown",
      rate: 10,
    });
    expect(p.commission2).toEqual({ basis: "per_closed_deal", rate: 50 });
    expect(peopleRoster([base]).people[0].commission2).toEqual({
      basis: "none",
      rate: null,
    });
  });
  test("a non-finite second rate is refused before the server", async () => {
    await expect(
      savePerson({} as SupabaseClient, { id: 1, commission2Rate: Number.NaN }),
    ).rejects.toThrow("finite");
  });
  test("$500 base, $10 per qualified intro shown, $50 per fully closed deal", () => {
    const setter: Payee = {
      id: 7,
      name: "Setter",
      monthlyUsd: 500,
      currency: "USD",
      basis: "per_qualified_intro_shown",
      rate: 10,
      basis2: "per_closed_deal",
      rate2: 50,
    };
    const plan = {
      newCash: 40000,
      contracted: null,
      introsShown: 60,
      demosShown: null,
      closes: 8,
      mrrDue: null,
      qualifiedIntroShare: 0.9,
    };
    const r = payroll([setter], plan, { USD: 1 }, say);
    expect(r.lines[0].commission).toBe(10 * 54 + 50 * 8);
    expect(r.lines[0].total).toBe(500 + 940);
    expect(r.lines[0].on).toBe(
      "$10 × 54 qualified intros held (estimate) + $50 × 8 deals fully closed",
    );
    expect(r.lines[0].parts?.length).toBe(2);
  });
  test("a line the plan cannot price leaves the person's commission unpriced, not half", () => {
    const setter: Payee = {
      id: 7,
      name: "Setter",
      monthlyUsd: 500,
      currency: "USD",
      basis: "per_qualified_intro_shown",
      rate: 10,
      basis2: "per_closed_deal",
      rate2: 50,
    };
    const r = payroll(
      [setter],
      {
        newCash: null,
        contracted: null,
        introsShown: 60,
        demosShown: null,
        closes: 8,
        mrrDue: null,
      },
      { USD: 1 },
      say,
    );
    expect(r.lines[0].commission).toBeNull();
    expect(r.unpriced).toEqual(["Setter"]);
  });
  test("qualified share from the server's windows, each counted once", () => {
    const w = (from: string, to: string, q: number, n: number) => ({
      from,
      to,
      raw: { intros_qualified: q, intros_shown: n },
    });
    expect(
      qualifiedIntroShare([
        w("2026-09-01", "2026-09-30", 35, 40),
        w("2026-10-01", "2026-10-10", 6, 6),
        w("2026-10-01", "2026-10-10", 6, 6),
      ]),
    ).toEqual({
      share: 0.891,
      qualified: 41,
      shown: 46,
      from: "2026-09-01",
      to: "2026-10-10",
    });
    expect(
      planAmount(
        {
          newCash: null,
          contracted: null,
          introsShown: 60,
          demosShown: null,
          closes: 8,
          mrrDue: null,
        },
        "fullCloses",
      ),
    ).toBe(8);
  });
});

describe("A234: proposals in the CEO cockpit", () => {
  const rec = (
    id: string,
    status: string,
    created: string,
    contact: string | null,
  ) => ({
    id,
    status,
    contact_id: contact,
    lang: "ar",
    created_by: "closer@example.test",
    created_at: created,
    updated_at: created,
    sent_at: null,
    sent_by: null,
    error: null,
    fill_count: 2,
  });
  test("rows newest first, a lead's name or its contact id, the sales cockpit's page", () => {
    const rows = proposalRows(
      [
        rec("a", "archived", "2026-09-24T09:32:14Z", "c1"),
        rec("b", "needs_input", "2026-10-10T11:58:29Z", "c2"),
      ],
      new Map([["c2", "Lead Two"]]),
    );
    expect(rows.map(r => [r.id, r.lead, r.closer, r.language, r.href])).toEqual(
      [
        ["b", "Lead Two", "Closer", "Arabic", "/sales/proposal/b"],
        ["a", "Lead c1", "Closer", "Arabic", "/sales/proposal/a"],
      ],
    );
    expect(proposalChip(rows[0])).toEqual({
      tone: "warning",
      label: "Needs figures (2)",
    });
    expect(proposalSummary(rows)).toBe(
      "2 proposals: 1 needs figures, 1 archived",
    );
    expect(proposalSummary([])).toBe("No proposals yet");
    expect(closerName(null)).toBe("Unknown");
    expect(closerName("aziz@maharamedia.com")).toBe("Aziz");
    expect(closerName("sara.ali@example.test")).toBe("Sara Ali");
    expect(proposalHref("x/y")).toBe("/sales/proposal/x%2Fy");
  });
});

describe("A081: Machine counts failed CEO sections", () => {
  test("names every section whose last refresh failed", () => {
    const s = (key: string, label: string, ok: boolean) => ({
      key,
      label,
      ok,
      error: null,
      computedAt: 0,
      lastOkAt: null,
      sources: [],
      payload: null,
    });
    const sections = {
      money: s("money", "Money", false),
      expenses: s("expenses", "Expenses and P&L", false),
      growth: s("growth", "Marketing and sales", true),
    } as never;
    const failing = sectionsFailing(sections);
    expect(failing.map(f => f.key)).toEqual(["money", "expenses"]);
    expect(sectionsFailingText(failing)).toBe(
      "2 CEO sections failing (Money; Expenses and P&L)",
    );
    expect(sectionsFailingText([])).toBeNull();
  });
});

describe("A372: the morning Slack note switch", () => {
  test("reads the state, and refuses anything but on or off", async () => {
    expect(
      parseNudge({
        on: false,
        updatedAt: null,
        updatedBy: null,
        last: {
          runAt: "2026-10-12T06:05:00Z",
          ok: true,
          note: null,
          listed: 2,
        },
      }),
    ).toEqual({
      on: false,
      updatedAt: null,
      updatedBy: null,
      last: {
        runAt: "2026-10-12T06:05:00Z",
        okAt: null,
        ok: true,
        note: null,
        listed: 2,
      },
    });
    expect(() => parseNudge({ ok: true })).toThrow("not confirmed");
    await expect(
      setNudge({} as SupabaseClient, { on: "yes" as never }),
    ).rejects.toThrow("on or off");
  });
  test("calls the CEO-gated switch", async () => {
    const calls: [string, unknown][] = [];
    const client = {
      rpc: async (name: string, args: unknown) => {
        calls.push([name, args]);
        return {
          data: { on: true, updatedAt: null, updatedBy: null, last: null },
          error: null,
        };
      },
    } as unknown as SupabaseClient;
    expect((await setNudge(client, { on: true })).on).toBe(true);
    expect(calls).toEqual([["cockpit_ceo_hours_nudge_set", { p_on: true }]]);
  });
});
