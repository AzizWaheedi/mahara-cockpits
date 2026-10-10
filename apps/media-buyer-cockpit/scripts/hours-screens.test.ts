/**
 * Hours and pay, the screen side: the words and numbers the card prints, the
 * address it keeps, how the browser calls the server, and last month's base
 * pay on Costs. The pay rule itself is tested in hours-model.test.ts.
 * Every figure here is made up.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ceoHoursAction, parseStatus } from "../src/lib/ceoHoursClient";
import {
  approveItems,
  chipReason,
  SOURCE_CHIP,
  sentenceAway,
  sortPeople,
  sourceSentence,
  statusChip,
  undecidedDays,
} from "../src/pages/ceo/hours/hoursCopy";
import {
  dayShares,
  hm,
  hoursDec,
  parseHours,
  pay,
  signedHm,
  signedPay,
} from "../src/pages/ceo/hours/hoursFormat";
import { hoursHash, parseHoursHash } from "../src/pages/ceo/hours/useHoursHash";
import { closedMonthPay } from "../src/types/ceo/costsModel";
import type {
  DayView,
  PersonMonth,
  StatusKind,
} from "../src/types/ceo/hoursContract";
import { computeMonth } from "../src/types/ceo/hoursModel";
import {
  fullDays,
  adj as fxAdj,
  inputs as fxInputs,
  person as fxPerson,
} from "./lib/hoursFixtures";

const H = 3600;

describe("hours and pay read as one system", () => {
  test("time is hours and minutes, never days", () => {
    expect(hm(182 * H)).toBe("182 h");
    expect(hm(3 * H + 38 * 60 + 24)).toBe("3 h 38 min");
    expect(hm(45 * 60)).toBe("45 min");
    expect(hm(0)).toBe("0 h");
    expect(hm(null)).toBe("n/a");
    expect(signedHm(1.5 * H)).toBe("+1 h 30 min");
    expect(signedHm(-45 * 60)).toBe("−45 min");
    expect(hoursDec(170.5 * H)).toBe("170.5 h");
    expect(hoursDec(1092 * H)).toBe("1,092 h");
  });

  test("pay is exact to the currency's minor unit", () => {
    expect(pay(853.2, "USD")).toBe("$853.20");
    expect(pay(281.275, "KWD")).toBe("KWD 281.275");
    expect(pay(-40, "USD")).toBe("−$40.00");
    expect(pay(1001, "usd")).toBe("$1,001.00");
    expect(signedPay(7.5, "USD")).toBe("+$7.50");
    expect(pay(null, "USD")).toBe("n/a");
  });

  test("entered hours accept the ways people type them", () => {
    expect(parseHours("7")).toBe(7 * H);
    expect(parseHours("7:30")).toBe(7.5 * H);
    expect(parseHours("7.5")).toBe(7.5 * H);
    expect(parseHours("7 h 30")).toBe(7.5 * H);
    expect(parseHours("7:75")).toBeNull();
    expect(parseHours("30")).toBeNull();
    expect(parseHours("seven")).toBeNull();
  });

  test("a day's fill: work, paid leave and unpaid, against its expected time", () => {
    const day = (over: Partial<DayView>): DayView => ({
      day: "2026-10-14",
      kind: "worked",
      expected: 7 * H,
      counted: 7 * H,
      tracked: 7 * H,
      paidLeave: 0,
      unpaid: 0,
      holiday: null,
      leave: [],
      adjustmentIds: [],
      label: "",
      ...over,
    });
    expect(dayShares(day({}), 7 * H)).toEqual({
      work: 1,
      paid: 0,
      unpaid: 0,
      extra: false,
    });
    const half = dayShares(
      day({ counted: 7 * H, tracked: 3.5 * H, paidLeave: 3.5 * H }),
      7 * H,
    );
    expect(half.work).toBeCloseTo(0.5);
    expect(half.paid).toBeCloseTo(0.5);
    expect(dayShares(day({ counted: 9 * H }), 7 * H).extra).toBe(true);
    // Day-off work rises against the longest day, not against zero.
    expect(
      dayShares(
        day({ kind: "worked_day_off", expected: 0, counted: 3.5 * H }),
        7 * H,
      ).work,
    ).toBeCloseTo(0.5);
  });
});

describe("the address keeps the month, the view and the person", () => {
  test("round trip", () => {
    const place = { month: "2026-10", view: "month" as const, person: 12 };
    expect(hoursHash(place)).toBe("#team/hours/2026-10/month/12");
    expect(parseHoursHash(hoursHash(place))).toEqual(place);
    expect(parseHoursHash("#team/hours/2026-09/people")).toEqual({
      month: "2026-09",
      view: "people",
      person: null,
    });
  });
  test("anything else is ignored", () => {
    expect(parseHoursHash("#team/hours/2026-13/month")).toBeNull();
    expect(parseHoursHash("#team/hours/2026-10/payroll")).toBeNull();
    expect(parseHoursHash("")).toBeNull();
  });
});

function person(
  name: string,
  kind: StatusKind,
  over: Partial<PersonMonth> = {},
): PersonMonth {
  return {
    personId: name.length,
    name,
    role: "Call centre agent",
    currency: "USD",
    tracking: { value: "required", from: "role_default" },
    payBasis: { value: "hours", from: "role_default" },
    paysOnHours: true,
    shadow: false,
    hours: {} as PersonMonth["hours"],
    segments: [],
    pay: {} as PersonMonth["pay"],
    status: { kind, reasons: [] },
    lookAt: [],
    days: [],
    activity: { share: null, inputSeconds: 0 },
    leaveLeft: null,
    now: null,
    approval: null,
    changedSinceApproval: null,
    inputsHash: "",
    ...over,
  };
}

describe("status", () => {
  test("rows sort not ready, then decisions, then ready, then approved", () => {
    const order = sortPeople([
      person("Paid", "paid"),
      person("Ready", "ready"),
      person("Blocked", "not_ready"),
      person("Approved", "approved"),
      person("Asks", "needs_review"),
    ]).map(p => p.name);
    expect(order).toEqual(["Blocked", "Asks", "Ready", "Approved", "Paid"]);
  });

  test("the chip names the first blocking reason in a few words", () => {
    const p = person("A", "not_ready", {
      status: {
        kind: "not_ready",
        reasons: [
          {
            code: "no_data_days",
            severity: "blocks",
            text: "2 days with no Hubstaff data (14 and 15 Oct).",
            days: ["2026-10-14", "2026-10-15"],
          },
        ],
      },
    });
    expect(statusChip(p)).toEqual({
      tone: "serious",
      label: "Not ready: 2 days no data",
    });
    expect(
      statusChip(
        person("B", "not_ready", {
          status: {
            kind: "not_ready",
            reasons: [
              { code: "hubstaff_not_linked", severity: "blocks", text: "x" },
            ],
          },
        }),
      ).label,
    ).toBe("Not linked");
    expect(
      chipReason({ code: "timetastic_not_read", severity: "blocks", text: "" }),
    ).toBe("leave not read");
  });

  test("ready, shadow, decisions and changes after approval", () => {
    expect(statusChip(person("R", "ready")).label).toBe("Ready to approve");
    expect(statusChip(person("S", "ready", { shadow: true })).label).toBe(
      "Shadow · Ready",
    );
    expect(
      statusChip(
        person("D", "needs_review", {
          status: {
            kind: "needs_review",
            reasons: [
              {
                code: "absent_no_leave",
                severity: "decide",
                text: "",
                days: ["2026-10-06"],
              },
            ],
          },
        }),
      ).label,
    ).toBe("Needs 1 decision");
    expect(
      statusChip(
        person("C", "approved", {
          changedSinceApproval: {
            seconds: 5400,
            amount: 7.5,
            alreadyCarried: 0,
          },
        }),
      ),
    ).toEqual({ tone: "warning", label: "Changed since approved" });
  });
});

describe("connections say what to do next", () => {
  test("the exact sentences of design 2.7", () => {
    expect(
      sourceSentence({
        provider: "hubstaff",
        state: "missing_key",
        note: null,
      }),
    ).toBe(
      "Hubstaff isn't connected, so hours show as no data. As the Hubstaff owner, open Settings, Organization, API tokens, make an organisation token (it starts hsoat_), and paste it here.",
    );
    expect(
      sourceSentence({ provider: "timetastic", state: "refused", note: null }),
    ).toBe(
      "Timetastic refused the saved key. An admin can renew it at app.timetastic.co.uk/api. Paste the new one here.",
    );
    expect(
      sourceSentence(
        { provider: "hubstaff", state: "stale", note: null },
        { ago: "3 h ago" },
      ),
    ).toBe(
      "Hubstaff was last read 3 h ago. Press Sync now. If it fails, this card says why.",
    );
    // The server's own sentence wins.
    expect(
      sourceSentence({
        provider: "hubstaff",
        state: "refused",
        note: "Said by the server.",
      }),
    ).toBe("Said by the server.");
    expect(
      sourceSentence({ provider: "hubstaff", state: "connected", note: null }),
    ).toBeNull();
  });
  test("every state has a chip", () => {
    for (const s of Object.values(SOURCE_CHIP))
      expect(s.label.length).toBeGreaterThan(0);
  });
  test("above the month, a sentence points to Connections, not 'here'", () => {
    // The browser's sentences for every state, and the server's own (the
    // note CASE in the migration), as the line above the tiles shows them.
    const client = (Object.keys(SOURCE_CHIP) as (keyof typeof SOURCE_CHIP)[])
      .flatMap(state =>
        (["hubstaff", "timetastic"] as const).map(provider =>
          sourceSentence(
            { provider, state, note: null },
            { ago: "3 h ago", expires: "7 Jan" },
          ),
        ),
      )
      .filter((t): t is string => Boolean(t));
    const sql = readFileSync(
      new URL(
        "../../../supabase/migrations/20261009a_cockpit_team_hours.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const block = sql.slice(
      sql.indexOf("note:=CASE"),
      sql.indexOf("ELSE NULL END;", sql.indexOf("note:=CASE")),
    );
    const server = [...block.matchAll(/'((?:[^']|'')+)'/g)]
      .map(m => m[1].replace(/''/g, "'"))
      .filter(t => t.length > 40);
    expect(server.length).toBeGreaterThan(8);
    for (const text of [...client, ...server]) {
      const away = sentenceAway(text);
      expect(away).not.toMatch(/\bhere\b/);
      expect(away).not.toContain("this card");
    }
    expect(
      sentenceAway(
        "Hubstaff refused the saved key. It may have expired or been revoked. Paste a new one here.",
      ),
    ).toBe(
      "Hubstaff refused the saved key. It may have expired or been revoked. Paste a new one in Connections.",
    );
  });
});

/** A client that records what it was asked, for the routing tests. */
function recorder(answer: (name: string, args: unknown) => unknown) {
  const calls: { kind: "rpc" | "fn"; name: string; args: unknown }[] = [];
  const client = {
    rpc: async (name: string, args: unknown) => {
      calls.push({ kind: "rpc", name, args });
      return { data: answer(name, args), error: null };
    },
    functions: {
      invoke: async (name: string, opts: { body: unknown }) => {
        calls.push({ kind: "fn", name, args: opts.body });
        return { data: answer(name, opts.body), error: null };
      },
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

describe("the browser calls the server as section 6 says", () => {
  test("writes go to their RPC as one p object; the server fills the snapshot", async () => {
    const { client, calls } = recorder(() => ({ ok: true, id: 5 }));
    const out = await ceoHoursAction(client, "adjust", {
      personId: 3,
      kind: "absent_unpaid",
      month: "2026-10",
      day: "2026-10-06",
      seconds: null,
      mode: null,
      paidShare: null,
      decision: null,
      bookingId: null,
      amount: null,
      currency: null,
      fromMonth: null,
      reason: "No time tracked and no leave booked",
      snapshot: null,
    });
    expect(out).toEqual({ ok: true, id: 5 });
    expect(calls[0].name).toBe("cockpit_ceo_hours_adjust");
    const p = (calls[0].args as { p: Record<string, unknown> }).p;
    expect(p.personId).toBe(3);
    expect("snapshot" in p).toBe(false);
  });

  test("the month reads cockpit_ceo_hours_inputs with the first of the month", async () => {
    const { client, calls } = recorder(() => {
      throw new Error("stop after the call");
    });
    await expect(
      ceoHoursAction(client, "month", { month: "2026-10" }),
    ).rejects.toThrow();
    expect(calls[0]).toEqual({
      kind: "rpc",
      name: "cockpit_ceo_hours_inputs",
      args: { p_month: "2026-10-01" },
    });
  });

  test("keys, reads and approval go to cockpit-hours-api with {op, ...args}", async () => {
    const { client, calls } = recorder((_name, body) => {
      const op = (body as { op: string }).op;
      if (op === "saveKey")
        return {
          ok: true,
          state: "connected",
          text: "Connected.",
          last4: "Ab12",
        };
      if (op === "syncNow")
        return { ok: false, busy: true, since: "2026-10-09T07:00:00Z" };
      return { results: [] };
    });
    const saved = await ceoHoursAction(client, "saveKey", {
      provider: "hubstaff",
      key: "hsoat_made_up_token_value",
    });
    expect(saved).toMatchObject({ ok: true, last4: "Ab12" });
    expect(await ceoHoursAction(client, "syncNow", { mode: "recent" })).toEqual(
      {
        ok: false,
        busy: true,
        since: "2026-10-09T07:00:00Z",
      },
    );
    await ceoHoursAction(client, "approveMany", {
      month: "2026-09",
      items: [
        {
          personId: 1,
          inputsHash: "h",
          amount: 910,
          payableS: 655200,
          ruleVersion: "hours-1",
        },
      ],
    });
    expect(calls.map(c => [c.name, (c.args as { op: string }).op])).toEqual([
      ["cockpit-hours-api", "saveKey"],
      ["cockpit-hours-api", "syncNow"],
      ["cockpit-hours-api", "approveMany"],
    ]);
  });

  test("bad input is refused in the browser, before any call", async () => {
    const { client, calls } = recorder(() => ({ ok: true }));
    await expect(
      ceoHoursAction(client, "saveKey", {
        provider: "hubstaff",
        key: "has spaces in it",
      }),
    ).rejects.toThrow("no spaces");
    await expect(
      ceoHoursAction(client, "month", { month: "2026-13" }),
    ).rejects.toThrow("YYYY-MM");
    await expect(
      ceoHoursAction(client, "approveMany", { month: "2026-09", items: [] }),
    ).rejects.toThrow("at least one");
    await expect(
      ceoHoursAction(client, "setLeaveType", {
        externalId: "4",
        payRule: "part",
        paidShare: 1.5,
      }),
    ).rejects.toThrow("share");
    expect(calls).toEqual([]);
  });

  test("status keeps the accounts list, or says it is missing", () => {
    expect(parseStatus({ sources: [] }).accounts).toBeNull();
    expect(
      parseStatus({ sources: [], accounts: [], cronScheduled: true }),
    ).toEqual({
      sources: [],
      lastRun: null,
      cronScheduled: true,
      accounts: [],
    });
  });

  test("approve sends the figure the CEO saw", () => {
    const p = person("A", "ready", {
      pay: { total: 853.2 } as PersonMonth["pay"],
      hours: { payable: 600000 } as PersonMonth["hours"],
      inputsHash: "abc",
    });
    expect(approveItems([p], "hours-1")).toEqual([
      {
        personId: 1,
        inputsHash: "abc",
        amount: 853.2,
        payableS: 600000,
        ruleVersion: "hours-1",
      },
    ]);
  });
});

describe("Costs: last month's base pay", () => {
  test("approved figure where there is one, roster pay for the rest", () => {
    const out = closedMonthPay(
      [
        {
          id: 1,
          name: "A",
          monthlyUsd: 910,
          approved: { month: "2026-09", amountUsd: 853.2, shadow: false },
        },
        { id: 2, name: "B", monthlyUsd: 1200, approved: null },
        {
          id: 3,
          name: "C",
          monthlyUsd: null,
          approved: { month: "2026-09", amountUsd: 978, shadow: true },
        },
        {
          id: 4,
          name: "D",
          monthlyUsd: 500,
          approved: { month: "2026-09", amountUsd: null, shadow: false },
        },
        { id: 5, name: "E", monthlyUsd: null, approved: null },
        {
          id: 6,
          name: "F",
          monthlyUsd: 700,
          approved: { month: "2026-08", amountUsd: 650, shadow: false },
        },
      ],
      "2026-09",
    );
    expect(out).toEqual({
      month: "2026-09",
      total: 853.2 + 1200 + 978 + 500 + 700,
      approved: 2,
      roster: 3,
      noRate: ["D"],
      noPay: ["E"],
    });
  });
});

describe("the harness fixtures stay made up", () => {
  test("no company address and no real roster file in the hours fixtures", () => {
    for (const f of [
      "../src/dev/hoursFixture.ts",
      "../src/dev/hoursHarness.ts",
      "../src/dev/authHarness.ts",
    ]) {
      const text = readFileSync(new URL(f, import.meta.url), "utf8");
      expect(text).not.toContain("@maharamedia.com");
      expect(text).not.toContain("tmp/harness");
    }
  });
});

describe("a figure that rests on undecided days says so", () => {
  // The real rule over made-up inputs: three October days with nothing tracked.
  const blank = ["2026-10-10", "2026-10-11", "2026-10-12"];
  const one = (over: Parameters<typeof fxPerson>[0] = {}) => {
    const p = computeMonth(
      fxInputs([fxPerson({ hubstaffDays: fullDays(blank), ...over })]),
    ).people[0];
    if (!p) throw new Error("missing person");
    return p;
  };
  test("undecided days are counted, in hours, until the CEO decides", () => {
    const asked = one();
    expect(asked.status.kind).toBe("needs_review");
    expect(undecidedDays(asked)).toEqual({ days: 3, seconds: 21 * H });
    const decided = one({
      adjustments: blank.map(day => fxAdj("absent_unpaid", { day })),
    });
    expect(undecidedDays(decided)).toEqual({ days: 0, seconds: 0 });
  });
  test("fixed pay and shadow months never show it", () => {
    expect(
      undecidedDays(one({ terms: { ...fxPerson().terms, hoursPayFrom: null } }))
        .days,
    ).toBe(0);
    expect(
      undecidedDays(
        one({
          role: "Closer",
          terms: { ...fxPerson().terms, hoursPayFrom: null },
        }),
      ).days,
    ).toBe(0);
  });
});
