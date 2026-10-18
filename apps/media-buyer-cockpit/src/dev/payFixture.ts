/**
 * The layout harness's pay plans and money ties (PAY-PLANS.md section 7,
 * MONEY-ATTRIBUTION.md section 2): made-up answers for every
 * `cockpit_ceo_pay_*` and `cockpit_ceo_payment_*` RPC, served by
 * hoursHarness.ts to the real clients (ceoPayClient, ceoMoneyClient,
 * ceoCostsClient). The people are the hours harness's invented roster
 * (hoursHarness.ts people()); every client, deal, payment and figure is
 * invented. Never imported by the production app.
 *
 * September 2026 is closed (today 18 Oct, settle day 3 Oct): one agent is
 * approved and has drifted since, one agent and the closer are approved, one
 * agent is ready. October is open: a role plan of each kind, an own plan, a
 * missing input, a guard not met, a close waiting for confirmation, a setter
 * waiting, and the closer's measured lines with a paid-in-full bonus.
 *
 * `?pay=full|empty|broken` picks the scenario (default full): empty has no
 * plans and nobody approved; broken refuses every pay read and write.
 */
import {
  checkPlan,
  type PayEntry,
  type PayMonth,
  type PayPartResult,
  type PayPerson,
  type PayPlanRow,
  type PayPlansList,
  ROLE_PLANS_2026_10,
} from "../types/ceo/payPlan";

export type PayScenario = "full" | "empty" | "broken";

export function payScenario(): PayScenario {
  const raw =
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("pay");
  return raw === "empty" || raw === "broken" ? raw : "full";
}

const CEO = "ceo@example.test";
const TODAY = "2026-10-18";
const hash = (n: number) => n.toString(16).padStart(32, "0");

// ---------------------------------------------------------------------------
// The stored plans (cockpit_ceo_pay_plans_list), held in memory so a saved
// plan shows on the next read.

const ROLE_ORDER = [
  "Media buyer",
  "Creative strategist",
  "Client success manager",
  "Systems manager",
  "Call centre agent",
  "Closer",
] as const;

function seedPlans(): PayPlanRow[] {
  const roleRows: PayPlanRow[] = ROLE_ORDER.map((role, i) => ({
    id: i + 1,
    role,
    personId: null,
    fromMonth: "2026-10-01",
    plan: structuredClone(ROLE_PLANS_2026_10[role]),
    note: "Seeded from the contracts, October 2026",
    setBy: CEO,
    setAt: "2026-10-01T06:00:00Z",
  }));
  return [
    ...roleRows,
    // An own plan: the systems manager's two rates plus a made-up audit.
    {
      id: 7,
      role: null,
      personId: 107,
      fromMonth: "2026-10-01",
      plan: {
        version: 1,
        parts: [
          ...(ROLE_PLANS_2026_10["Systems manager"]?.parts ?? []),
          {
            key: "audits",
            kind: "per_event",
            label: "Automation audits",
            event: "custom",
            eventLabel: "Automation audit",
            amount: 100,
          },
        ],
      },
      note: "Made-up own plan",
      setBy: CEO,
      setAt: "2026-10-02T08:30:00Z",
    },
    // Back on the role plan from December.
    {
      id: 8,
      role: null,
      personId: 107,
      fromMonth: "2026-12-01",
      plan: null,
      note: "Follows the role plan from December",
      setBy: CEO,
      setAt: "2026-10-16T12:00:00Z",
    },
  ];
}
let plans: PayPlanRow[] = seedPlans();

const PEOPLE = [
  { id: 1, name: "The CEO", role: "CEO", active: true },
  { id: 101, name: "Hala Mansour", role: "Call centre agent", active: true },
  { id: 102, name: "Omar Fayed", role: "Call centre agent", active: true },
  { id: 103, name: "Sara Kanaan", role: "Media buyer", active: true },
  { id: 104, name: "Yousef Darwish", role: "Closer", active: true },
  {
    id: 105,
    name: "Mona Haddad",
    role: "Client success manager",
    active: true,
  },
  { id: 106, name: "Tala Odeh", role: "Call centre agent", active: true },
  { id: 107, name: "Fadi Nassar", role: "Systems manager", active: true },
  { id: 108, name: "Jad Salem", role: "Creative strategist", active: true },
  { id: 110, name: "Dina Samir", role: null, active: true },
  { id: 111, name: "Lina Haddad", role: "B2B setter", active: true },
  { id: 109, name: "Rana Saeed", role: "Call centre agent", active: false },
].sort((a, b) => a.name.localeCompare(b.name));

export function payPlansFixture(scenario: PayScenario): PayPlansList {
  const rows = scenario === "empty" ? [] : plans;
  const roles = [
    ...new Set([
      ...PEOPLE.map(p => p.role).filter((r): r is string => Boolean(r)),
      ...rows.map(r => r.role).filter((r): r is string => Boolean(r)),
    ]),
  ].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  return {
    plans: structuredClone(rows),
    roles,
    people: PEOPLE.map(p => ({ ...p })),
    lastApproved:
      scenario === "empty"
        ? []
        : [101, 104, 106].map(personId => ({
            personId,
            month: "2026-09-01",
          })),
    // September's approvals followed no plan (the plans start in October).
    approvedPlanIds: [],
  };
}

/** cockpit_ceo_pay_plan_save: the server's check, then the row replaced or added. */
export function savePlanFixture(p: Record<string, unknown>): {
  ok: true;
  id: number;
} {
  const role = typeof p.role === "string" ? p.role.trim() : null;
  const personId = typeof p.personId === "number" ? p.personId : null;
  if ((role === null) === (personId === null))
    throw new Error("Choose a role or one person.");
  const fromMonth = `${String(p.fromMonth ?? "").slice(0, 7)}-01`;
  if (!/^\d{4}-\d{2}-01$/.test(fromMonth))
    throw new Error("Choose the month the plan applies from.");
  if (
    fromMonth <= "2026-09-01" &&
    personId !== null &&
    [101, 104, 106].includes(personId)
  )
    throw new Error(
      "September is approved for this person. Plans can change from October.",
    );
  const plan = (p.plan ?? null) as PayPlanRow["plan"];
  if (role !== null && plan === null)
    throw new Error("A role plan needs its parts.");
  if (plan !== null) {
    const fault = checkPlan(plan, { isRole: role !== null });
    if (fault) throw new Error(fault);
  }
  const same = plans.find(
    r =>
      r.fromMonth === fromMonth &&
      (role !== null
        ? r.role?.toLowerCase() === role.toLowerCase()
        : r.personId === personId),
  );
  const row: PayPlanRow = {
    id: same?.id ?? Math.max(0, ...plans.map(r => r.id)) + 1,
    role,
    personId,
    fromMonth,
    plan,
    note: typeof p.note === "string" ? p.note : null,
    setBy: CEO,
    setAt: new Date().toISOString(),
  };
  plans = [...plans.filter(r => r.id !== row.id), row];
  return { ok: true, id: row.id };
}

// ---------------------------------------------------------------------------
// The month (cockpit_ceo_pay_month)

type Base = PayPerson["base"];
const roster = (usd: number, amount = usd, currency = "USD"): Base => ({
  usd,
  amount,
  currency,
  source: "roster",
});
const rolePlan = (planId: number, role: string): PayPerson["plan"] => ({
  source: "role",
  planId,
  fromMonth: "2026-10-01",
  role,
  follows: false,
});
const noPlan = (role: string | null): PayPerson["plan"] => ({
  source: "none",
  planId: null,
  fromMonth: null,
  role,
  follows: false,
});

function person(
  o: Partial<PayPerson> & Pick<PayPerson, "personId" | "name" | "role">,
): PayPerson {
  return {
    active: true,
    endedOn: null,
    currency: "USD",
    base: roster(910),
    plan: noPlan(o.role),
    roleCommission: null,
    commission: [],
    parts: [],
    entries: [],
    reviewsToCheck: [],
    knownUsd: 0,
    lowestUsd: 0,
    totalUsd: null,
    commissionUsd: null,
    partsUsd: 0,
    missing: [],
    notPriced: [],
    note: null,
    status: "in_progress",
    approval: null,
    sinceApproval: null,
    resultHash: hash(o.personId),
    ...o,
  };
}

const NOT_HERE = "Not worked out here; Costs prices it from the plan.";
const shows = (n: number, prefix: string, unmarked = 0) => ({
  line: 1,
  basis: "per_client_appt_shown",
  rate: 5,
  quantity: n,
  baseUsd: null,
  amountUsd: n * 5,
  state: "measured" as const,
  note: unmarked
    ? `${n} shows credited to them; ${unmarked} meetings not marked yet, not counted.`
    : `${n} shows credited to them.`,
  unmarked,
  evidence: Array.from({ length: n }, (_, i) => `appt-${prefix}${i + 1}`),
});
const otherLine = (line: number) => ({
  line,
  basis: "other",
  rate: null,
  quantity: null,
  baseUsd: null,
  amountUsd: null,
  state: "not_here" as const,
  note: NOT_HERE,
  evidence: [],
});
const typed = (
  key: string,
  label: string,
  value: number,
  amountUsd: number,
  ids: number[],
  unit: "count" | "cash" = "count",
  month = "October",
): PayPartResult => ({
  key,
  kind: unit === "cash" ? "share" : "per_event",
  label,
  input: {
    value,
    unit,
    state: "typed",
    source: "cockpit_pay_entries",
    note:
      unit === "cash"
        ? `$${value.toLocaleString("en-US")} typed for ${month}.`
        : `${value} typed for ${month}.`,
  },
  band: null,
  amountUsd,
  state: "known",
  evidence: ids,
});
const waitingFor = (
  key: string,
  label: string,
  kind: "per_event" | "share" = "per_event",
): PayPartResult => ({
  key,
  kind,
  label,
  input: {
    value: null,
    unit: kind === "share" ? "cash" : "count",
    state: "missing",
    source: "cockpit_pay_entries",
    note:
      kind === "share"
        ? "Waiting for the month's cash."
        : "Waiting for your count.",
  },
  band: null,
  amountUsd: null,
  state: "missing",
  evidence: [],
});
const entry = (
  id: number,
  partKey: string,
  o: Partial<PayEntry>,
): PayEntry => ({
  id,
  partKey,
  quantity: null,
  cashUsd: null,
  amountUsd: null,
  engagementMonth: null,
  client: null,
  product: null,
  clearedOn: null,
  postedOn: null,
  cancelledOn: null,
  evidenceRef: null,
  evidence: null,
  note: null,
  fromMonth: null,
  enteredBy: CEO,
  enteredAt: "2026-10-12T10:00:00Z",
  ...o,
});

function september(scenario: PayScenario): PayMonth {
  const lina = person({
    personId: 111,
    name: "Lina Haddad",
    role: "B2B setter",
    base: roster(500),
    commission: [
      { ...otherLine(1), basis: "per_qualified_intro_shown", rate: 10 },
      { ...otherLine(2), basis: "per_closed_deal", rate: 50 },
    ],
    knownUsd: 500,
    lowestUsd: 500,
    totalUsd: 500,
    notPriced: ["per_qualified_intro_shown", "per_closed_deal"],
    note: "None of their commission lines is worked out here, so this month is not approved here; their base is paid through Hours and pay.",
  });
  const omar = person({
    personId: 102,
    name: "Omar Fayed",
    role: "Call centre agent",
    commission: [
      shows(19, "o"),
      {
        line: 2,
        basis: "per_client_deal_closed",
        rate: 20,
        quantity: 0,
        baseUsd: null,
        amountUsd: 0,
        state: "measured",
        note: "0 confirmed client closes.",
        evidence: [],
      },
    ],
    knownUsd: 1005,
    lowestUsd: 1005,
    totalUsd: 1005,
    commissionUsd: 95,
    status: "ready",
  });
  if (scenario === "empty")
    return month("2026-09-01", [lina, omar], notOnAPlanSeptember);
  // Approved on 5 Oct with 27 shows; 4 more were marked since (+$20).
  const halaFrozen = person({
    personId: 101,
    name: "Hala Mansour",
    role: "Call centre agent",
    commission: [
      shows(27, "h"),
      {
        line: 2,
        basis: "per_client_deal_closed",
        rate: 20,
        quantity: 0,
        baseUsd: null,
        amountUsd: 0,
        state: "measured",
        note: "0 confirmed client closes.",
        evidence: [],
      },
    ],
    knownUsd: 1045,
    lowestUsd: 1045,
    totalUsd: 1045,
    commissionUsd: 135,
    status: "ready",
  });
  const hala: PayPerson = {
    ...halaFrozen,
    status: "approved",
    approval: {
      id: 11,
      approvedAt: "2026-10-05T09:12:00Z",
      approvedBy: CEO,
      totalUsd: 1045,
      frozen: { ...halaFrozen, planJson: null },
    },
    sinceApproval: {
      deltaUsd: 20,
      changes: [
        {
          what: "per_client_appt_shown",
          kind: "line",
          line: 1,
          frozen: { quantity: 27, amountUsd: 135, state: "measured" },
          now: { quantity: 31, amountUsd: 155, state: "measured" },
          items: {
            added: ["appt-h28", "appt-h29", "appt-h30", "appt-h31"],
            removed: [],
          },
        },
      ],
    },
  };
  // Approved with a line the month does not work out: named on Costs.
  const talaFrozen = person({
    personId: 106,
    name: "Tala Odeh",
    role: "Call centre agent",
    commission: [shows(12, "t"), otherLine(2)],
    knownUsd: 970,
    lowestUsd: 970,
    totalUsd: 970,
    commissionUsd: 60,
    notPriced: ["other"],
    status: "ready",
  });
  const tala: PayPerson = {
    ...talaFrozen,
    status: "approved",
    approval: {
      id: 12,
      approvedAt: "2026-10-05T09:12:00Z",
      approvedBy: CEO,
      totalUsd: 970,
      frozen: { ...talaFrozen, planJson: null },
    },
  };
  const yousefFrozen = person({
    personId: 104,
    name: "Yousef Darwish",
    role: "Closer",
    base: roster(1500),
    commission: [
      {
        line: 1,
        basis: "closed_cash",
        rate: 0.1,
        quantity: null,
        baseUsd: 5500,
        amountUsd: 550,
        state: "measured",
        note: "$5,500 cleared in September on deals they closed.",
        evidence: ["resp-fx-d01"],
        payments: ["whop:pay_fx011"],
      },
      {
        line: 2,
        basis: "set_cash",
        rate: 0.05,
        quantity: null,
        baseUsd: 0,
        amountUsd: 0,
        state: "measured",
        note: "$0 cleared in September on deals they set.",
        evidence: [],
        payments: [],
      },
    ],
    knownUsd: 2050,
    lowestUsd: 2050,
    totalUsd: 2050,
    commissionUsd: 550,
    status: "ready",
  });
  const yousef: PayPerson = {
    ...yousefFrozen,
    status: "approved",
    approval: {
      id: 13,
      approvedAt: "2026-10-05T09:13:00Z",
      approvedBy: CEO,
      totalUsd: 2050,
      frozen: { ...yousefFrozen, planJson: null },
    },
  };
  return month(
    "2026-09-01",
    [hala, lina, omar, tala, yousef],
    notOnAPlanSeptember,
  );
}
const notOnAPlanSeptember = [
  {
    personId: 110,
    name: "Dina Samir",
    role: null,
    why: "No role on the roster",
  },
  {
    personId: 107,
    name: "Fadi Nassar",
    role: "Systems manager",
    why: 'No pay plan for the role "Systems manager"',
  },
  {
    personId: 108,
    name: "Jad Salem",
    role: "Creative strategist",
    why: 'No pay plan for the role "Creative strategist"',
  },
  {
    personId: 105,
    name: "Mona Haddad",
    role: "Client success manager",
    why: 'No pay plan for the role "Client success manager"',
  },
  {
    personId: 103,
    name: "Sara Kanaan",
    role: "Media buyer",
    why: 'No pay plan for the role "Media buyer"',
  },
];

function october(scenario: PayScenario): PayMonth {
  const agentPlan = rolePlan(5, "Call centre agent");
  const closeLine = {
    line: 2,
    basis: "per_client_deal_closed",
    rate: 20,
    baseUsd: null,
  };
  const omar = person({
    personId: 102,
    name: "Omar Fayed",
    role: "Call centre agent",
    plan: scenario === "empty" ? noPlan("Call centre agent") : agentPlan,
    roleCommission: scenario === "empty" ? null : { matches: true },
    commission: [
      shows(9, "o"),
      {
        ...closeLine,
        quantity: 1,
        amountUsd: 20,
        state: "measured",
        note: "1 confirmed client close.",
        evidence: ["appt-o-c1"],
      },
    ],
    knownUsd: 975,
    lowestUsd: 975,
    totalUsd: 975,
    commissionUsd: 65,
  });
  const lina = person({
    personId: 111,
    name: "Lina Haddad",
    role: "B2B setter",
    base: roster(500),
    commission: [
      { ...otherLine(1), basis: "per_qualified_intro_shown", rate: 10 },
      { ...otherLine(2), basis: "per_closed_deal", rate: 50 },
    ],
    knownUsd: 500,
    lowestUsd: 500,
    totalUsd: 500,
    notPriced: ["per_qualified_intro_shown", "per_closed_deal"],
    note: "None of their commission lines is worked out here, so this month is not approved here; their base is paid through Hours and pay.",
  });
  if (scenario === "empty")
    return month(
      "2026-10-01",
      [lina, omar],
      [
        {
          personId: 110,
          name: "Dina Samir",
          role: null,
          why: "No role on the roster",
        },
      ],
    );

  // A close seen only on a client sheet waits for the CEO.
  const hala = person({
    personId: 101,
    name: "Hala Mansour",
    role: "Call centre agent",
    plan: agentPlan,
    roleCommission: { matches: true },
    commission: [
      shows(14, "h", 2),
      {
        ...closeLine,
        quantity: 0,
        amountUsd: 0,
        state: "waiting",
        note: "1 close on the client sheet only waits for your confirmation.",
        waiting: [
          {
            appointmentId: "appt-h-c1",
            client: "Client A",
            meetingAt: "2026-10-12T17:00:00+03:00",
          },
        ],
        evidence: [],
      },
    ],
    knownUsd: 980,
    lowestUsd: 980,
    commissionUsd: 70,
    missing: ["Closed client deals: 1 close waits for your confirmation."],
    status: "waiting",
  });
  // Lines that differ from the role plan's: "Apply the role's commission".
  const roleSentence =
    "The Call centre agent plan pays $5 per client appointment shown and $20 per closed client deal; Tala Odeh's commission lines differ.";
  const tala = person({
    personId: 106,
    name: "Tala Odeh",
    role: "Call centre agent",
    plan: agentPlan,
    roleCommission: {
      matches: false,
      sentence: roleSentence,
      lines: [
        { basis: "per_client_appt_shown", rate: 5 },
        { basis: "per_client_deal_closed", rate: 20 },
      ],
    },
    commission: [shows(6, "t"), otherLine(2)],
    knownUsd: 940,
    lowestUsd: 940,
    commissionUsd: 30,
    missing: [roleSentence],
    notPriced: ["other"],
  });
  // A role plan with a band: cost per lead $12.45, the $200 band.
  const sara = person({
    personId: 103,
    name: "Sara Kanaan",
    role: "Media buyer",
    base: roster(1200),
    plan: rolePlan(1, "Media buyer"),
    parts: [
      {
        key: "cpl_bonus",
        kind: "band",
        label: "Bonus by cost per lead",
        input: {
          value: 12.45,
          unit: "usd",
          state: "measured",
          source: "cockpit_pay_facts_ads",
          note: "Lead-campaign spend $1,245 / 100 Meta leads over 2 clients; $300 spent outside lead campaigns, not counted.",
          alsoTracked: {
            metric: "cpb",
            over: "every_client",
            value: 103,
            state: "measured",
            note: null,
          },
          clients: ["cu-fx-a", "cu-fx-b"],
          out: [
            {
              clickupId: "cu-fx-c",
              name: "Client C",
              why: "1 unpriced spend row",
            },
          ],
          nonLeadSpendUsd: 300,
        },
        band: { index: 2 },
        amountUsd: 200,
        state: "known",
        evidence: ["cu-fx-a", "cu-fx-b"],
      },
    ],
    knownUsd: 1400,
    lowestUsd: 1400,
    totalUsd: 1400,
    partsUsd: 200,
  });
  // Paused since 1 Oct (the hours harness's roster): the base is held back, as the roster says.
  // Churn confirmed (the $1,200 band); the owned-creative bonus not met; SMM missing.
  const jad = person({
    personId: 108,
    name: "Jad Salem",
    role: "Creative strategist",
    base: {
      usd: 0,
      amount: 0,
      currency: "USD",
      source: "roster",
      paused: {
        days: 31,
        of: 31,
        from: "2026-10-01",
        to: "2026-10-31",
        fullUsd: 1100,
        heldUsd: 1100,
      },
    },
    plan: rolePlan(2, "Creative strategist"),
    parts: [
      {
        key: "churn_bonus",
        kind: "band",
        label: "Bonus by last month's churn",
        input: {
          value: 4.55,
          unit: "pct",
          state: "confirmed",
          source: "logo_churn",
          note: "1 of 22 clients lost in September (confirmed).",
          clients: ["cu-fx-l1"],
          confirmed: { lost: 1, activeAtStart: 22, clients: ["cu-fx-l1"] },
        },
        band: { index: 0 },
        amountUsd: 1200,
        state: "known",
        evidence: ["cu-fx-l1"],
      },
      {
        key: "cpl_bonus",
        kind: "band",
        label: "Bonus by cost per lead",
        input: {
          value: null,
          unit: "usd",
          state: "not_met",
          source: "owned_creative:108",
          note: "3 clients left after the guard; the bonus needs 5.",
          confirmed: {
            clients: ["cu-fx-a", "cu-fx-b", "cu-fx-c", "cu-fx-d", "cu-fx-e"],
          },
          alsoTracked: {
            metric: "cpb",
            over: "same",
            value: null,
            state: "not_met",
            note: "3 clients left after the guard; the bonus needs 5.",
          },
          clients: ["cu-fx-a", "cu-fx-b", "cu-fx-e"],
          out: [
            {
              clickupId: "cu-fx-d",
              name: "Client D",
              why: "spent $320 in the month, under $500",
            },
            {
              clickupId: "cu-fx-c",
              name: "Client C",
              why: "1 unpriced spend row",
            },
          ],
        },
        band: null,
        amountUsd: 0,
        state: "not_met",
        evidence: ["cu-fx-a", "cu-fx-b", "cu-fx-e"],
      },
      waitingFor("smm", "Social media management commission", "share"),
    ],
    knownUsd: 1200,
    lowestUsd: 1200,
    partsUsd: 1200,
    missing: [
      "Social media management commission: Waiting for the month's cash.",
    ],
  });
  // KWD base, the ramp guarantee topping up, churn to confirm, counts typed.
  const monaEntries = [
    entry(301, "renewals", {
      quantity: 1,
      client: "Client E",
      clearedOn: "2026-10-07",
      evidenceRef: "whop:pay_fx301",
    }),
    entry(302, "upsells", {
      cashUsd: 2000,
      engagementMonth: 1,
      client: "Client F",
      product: "Made-up add-on",
      clearedOn: "2026-10-10",
      evidenceRef: "tap:chg_fx302",
    }),
    entry(303, "google_reviews", {
      quantity: 1,
      evidence: "https://example.test/review/303",
      postedOn: "2026-10-09",
    }),
  ];
  const mona = person({
    personId: 105,
    name: "Mona Haddad",
    role: "Client success manager",
    currency: "KWD",
    base: roster(978, 300, "KWD"),
    plan: rolePlan(3, "Client success manager"),
    parts: [
      {
        key: "over_20",
        kind: "per_above",
        label: "Per qualifying client over 20",
        input: {
          value: 18,
          unit: "count",
          state: "measured",
          source: "cockpit_pay_facts_clients",
          note: "At most 18 clients qualify, so none over 20.",
          proposal: {
            upperBound: 18,
            clients: ["cu-fx-a", "cu-fx-b"],
            paymentNotChecked: ["cu-fx-g"],
            checkedFrom: "2026-09-19",
            checkedTo: "2026-10-18",
            paymentCheckedOn: "2026-10-18",
          },
        },
        band: null,
        amountUsd: 0,
        state: "known",
        evidence: ["cu-fx-a", "cu-fx-b"],
      },
      {
        key: "retention",
        kind: "band",
        label: "Retention bonus by churn",
        input: {
          value: null,
          unit: "pct",
          state: "missing",
          source: "csm_churn:105",
          note: "Confirm October's churn for Mona Haddad's book.",
          proposal: {
            personId: 105,
            name: "Mona Haddad",
            startSet: ["cu-fx-a", "cu-fx-b", "cu-fx-e", "cu-fx-g"],
            lost: [
              {
                clickupId: "cu-fx-g",
                name: "Client G",
                startStatus: "Active",
                termStart: "2026-08-20",
                dayOfTerm: 52,
                midProgramme: true,
                cardChurnType: null,
                csm: "Mona Haddad",
                why: "marked lost on 14 Oct",
              },
            ],
            candidates: [],
            proposal: { lost: 1, activeAtStart: 18, pct: 5.56 },
          },
        },
        band: null,
        amountUsd: null,
        state: "missing",
        evidence: [],
      },
      typed("renewals", "Renewals", 1, 300, [301]),
      waitingFor("reactivations", "Reactivations"),
      typed("upsells", "Backend upsells", 2000, 200, [302], "cash"),
      waitingFor("recurring", "Recurring services", "share"),
      waitingFor("referrals", "Referrals"),
      waitingFor("video_testimonials", "Video testimonials"),
      typed("google_reviews", "Google reviews", 1, 75, [303]),
      waitingFor("podcasts", "Podcast case studies"),
      {
        key: "ramp",
        kind: "floor",
        label: "Ramp guarantee",
        input: {
          value: 978,
          unit: "usd",
          state: "confirmed",
          source: "ramp_start:105",
          start: "2026-10-02",
          end: "2026-11-30",
          note: "Base $978 + over-20 $0 against the $1,200 guarantee (2 Oct to 30 Nov 2026).",
        },
        band: null,
        amountUsd: 222,
        state: "known",
        evidence: [],
      },
    ],
    entries: monaEntries,
    reviewsToCheck: [
      {
        entryId: 303,
        postedOn: "2026-10-09",
        checkBy: "2026-11-08",
        due: false,
      },
    ],
    // 978 base + 300 + 200 + 75 + 222; at least: the −$250 band if churn is over 15%.
    knownUsd: 1775,
    lowestUsd: 1525,
    partsUsd: 797,
    missing: [
      "Retention bonus by churn: Confirm October's churn for Mona Haddad's book.",
      "Reactivations: Waiting for your count.",
      "Recurring services: Waiting for the month's cash.",
      "Referrals: Waiting for your count.",
      "Video testimonials: Waiting for your count.",
      "Podcast case studies: Waiting for your count.",
    ],
  });
  // The closer: cash from every rail, a setter to confirm, one paid in full.
  const yousef = person({
    personId: 104,
    name: "Yousef Darwish",
    role: "Closer",
    base: roster(1500),
    plan: rolePlan(6, "Closer"),
    roleCommission: { matches: true },
    commission: [
      {
        line: 1,
        basis: "closed_cash",
        rate: 0.1,
        quantity: null,
        baseUsd: 8750,
        amountUsd: 875,
        state: "measured",
        note: "$8,750 cleared in October on deals they closed.",
        evidence: ["resp-fx-d02", "resp-fx-d03"],
        payments: ["bank:9031", "tap:chg_fx022", "whop:pay_fx021"],
      },
      {
        line: 2,
        basis: "set_cash",
        rate: 0.05,
        quantity: null,
        baseUsd: 6000,
        amountUsd: 300,
        state: "waiting",
        note: "1 deal waits for you to confirm who set it.",
        waiting: [
          {
            responseId: "resp-fx-d03",
            business: "Client H",
            state: "waiting",
            form: "Setter Nine",
            intro: "Yousef Darwish",
          },
        ],
        evidence: ["resp-fx-d02"],
        payments: ["whop:pay_fx021"],
      },
    ],
    parts: [
      {
        key: "pif",
        kind: "per_event",
        label: "Paid-in-full bonus",
        input: {
          value: 1,
          unit: "count",
          state: "measured",
          source: "cockpit_pay_facts_sales",
          note: "1 deal they closed reached paid in full in October.",
        },
        band: null,
        amountUsd: 250,
        state: "known",
        evidence: ["resp-fx-d02"],
      },
    ],
    knownUsd: 2925,
    lowestUsd: 2925,
    commissionUsd: 1175,
    partsUsd: 250,
    missing: ["Set cash: 1 deal waits for you to confirm who set it."],
    status: "waiting",
  });
  // An own plan: counts typed, one set to none.
  const fadi = person({
    personId: 107,
    name: "Fadi Nassar",
    role: "Systems manager",
    base: roster(1800),
    plan: {
      source: "own",
      planId: 7,
      fromMonth: "2026-10-01",
      role: "Systems manager",
      follows: false,
    },
    parts: [
      typed("systems", "Fully built-out systems", 2, 400, [311]),
      typed("systems_large", "Huge built-out systems", 0, 0, [312]),
      typed("audits", "Automation audits", 1, 100, [313]),
    ],
    entries: [
      entry(311, "systems", {
        quantity: 2,
        note: "Made-up: two client dashboards",
      }),
      entry(312, "systems_large", {
        quantity: 0,
        note: "Nothing else for October",
      }),
      entry(313, "audits", { quantity: 1 }),
    ],
    knownUsd: 2300,
    lowestUsd: 2300,
    totalUsd: 2300,
    partsUsd: 500,
  });
  return month(
    "2026-10-01",
    [fadi, hala, jad, lina, mona, omar, sara, tala, yousef],
    [
      {
        personId: 110,
        name: "Dina Samir",
        role: null,
        why: "No role on the roster",
      },
    ],
  );
}

/** What the month read, made up and short, for "Where these numbers come from". */
function facts(m: string): Record<string, unknown> {
  if (m !== "2026-10-01")
    return {
      ads: null,
      calls: null,
      clients: null,
      clientsPrior: null,
      sales: null,
      adsGuarded: {},
      errors: {},
    };
  const client = (
    id: string,
    name: string,
    spendUsd: number,
    leadSpendUsd: number,
    leads: number,
    bookings: number,
    notCpl: string | null = null,
  ) => ({
    clickupId: id,
    locationId: `loc-${id}`,
    name,
    serviceMode: "DFY",
    activeDays: 18,
    creativeStart: "2026-09-02",
    spendUsd,
    leadSpendUsd,
    nonLeadSpendUsd: spendUsd - leadSpendUsd,
    leads,
    bookings,
    cpl:
      leads && !notCpl ? Math.round((leadSpendUsd / leads) * 100) / 100 : null,
    cpb: bookings ? Math.round((spendUsd / bookings) * 100) / 100 : null,
    unpricedRows: notCpl ? 1 : 0,
    nullBookingDays: 0,
    after: { spendUsd, leadSpendUsd, leads, bookings },
    notMeasured: { cpl: notCpl, cpb: null },
  });
  return {
    ads: {
      from: "2026-10-01",
      to: "2026-10-31",
      adThrough: "2026-10-17",
      excludeDays: 0,
      clients: [
        client("cu-fx-a", "Client A", 900, 800, 60, 10),
        client("cu-fx-b", "Client B", 600, 445, 40, 5),
        client("cu-fx-c", "Client C", 45, 0, 0, 0, "1 unpriced spend row"),
      ],
      pooled: {
        clients: 2,
        leadSpendUsd: 1245,
        nonLeadSpendUsd: 300,
        leads: 100,
        cpl: 12.45,
        spendUsd: 1545,
        bookings: 15,
        cpb: 103,
        cpbClients: 3,
        outOfCpl: [
          {
            clickupId: "cu-fx-c",
            name: "Client C",
            why: "1 unpriced spend row",
          },
        ],
        outOfCpb: [],
      },
      note: [
        "Clients: the cards Active on at least one roster snapshot in the range.",
        "Cost per lead is lead-campaign spend / Meta form leads; cost per booking is all spend / confirmed bookings; both pooled as ratios of sums.",
        "A client left out of a pool is named with why, never counted as 0.",
      ],
    },
    adsGuarded: {},
    calls: {
      from: "2026-10-01",
      to: "2026-10-31",
      agents: [
        {
          email: "hala.mansour@example.test",
          personId: 101,
          name: "Hala Mansour",
          due: 18,
          shows: 14,
          noShows: 2,
          unmarked: 2,
          booked: 22,
          showsBy: { console: 10, central: 3, sheet: 1 },
          closes: [
            {
              appointmentId: "appt-h-c1",
              locationId: "loc-cu-fx-a",
              client: "Client A",
              contactId: "ct-fx-1",
              meetingAt: "2026-10-12T17:00:00+03:00",
              evidence: "sheet",
              value: null,
              currency: null,
            },
          ],
        },
        {
          email: "omar.fayed@example.test",
          personId: 102,
          name: "Omar Fayed",
          due: 11,
          shows: 9,
          noShows: 2,
          unmarked: 0,
          booked: 13,
          showsBy: { console: 9, central: 0, sheet: 0 },
          closes: [
            {
              appointmentId: "appt-o-c1",
              locationId: "loc-cu-fx-b",
              client: "Client B",
              contactId: "ct-fx-2",
              meetingAt: "2026-10-09T15:00:00+03:00",
              evidence: "portal",
              value: 1800,
              currency: "USD",
            },
          ],
        },
        {
          email: "tala.odeh@example.test",
          personId: 106,
          name: "Tala Odeh",
          due: 8,
          shows: 6,
          noShows: 2,
          unmarked: 0,
          booked: 9,
          showsBy: { console: 6, central: 0, sheet: 0 },
          closes: [],
        },
      ],
      unattributed: {
        due: 2,
        shows: 1,
        items: [
          {
            appointmentId: "appt-u1",
            client: "Client B",
            meetingAt: "2026-10-06T12:00:00+03:00",
            why: "The booker is CONFLICT on the central sheet",
          },
        ],
      },
      scorecard: {
        to: TODAY,
        callers: [
          {
            name: "Hala Mansour",
            email: "hala.mansour@example.test",
            shows: 15,
            closed: 1,
          },
          {
            name: "Omar Fayed",
            email: "omar.fayed@example.test",
            shows: 9,
            closed: 1,
          },
        ],
      },
      scorecardNote:
        "The shared report's figures, shown beside the count; never paid on.",
    },
    clients: {
      month: "2026-10-01",
      snapshots: { first: "2026-10-01", last: TODAY, startFrom: "2026-09-30" },
      logo: {
        startSet: ["cu-fx-a", "cu-fx-b", "cu-fx-e", "cu-fx-g"],
        lost: [],
        candidates: [],
        notInStart: [],
        proposal: { lost: 1, activeAtStart: 18, pct: 5.56 },
      },
      byCsm: [],
      ownedCreative: [
        {
          personId: 108,
          name: "Jad Salem",
          clients: [{ clickupId: "cu-fx-a", name: "Client A" }],
          others: [],
        },
      ],
      note: [
        "No roster snapshot before 1 Oct: the start count is the first snapshot of the month.",
        "Script task names that match nobody on the team list are left out of owned creative.",
      ],
    },
    clientsPrior: {
      month: "2026-09-01",
      logo: {
        startSet: ["cu-fx-a", "cu-fx-b", "cu-fx-e", "cu-fx-l1"],
        lost: [
          {
            clickupId: "cu-fx-l1",
            name: "Client L1",
            why: "marked lost on 20 Sep",
          },
        ],
        candidates: [],
        notInStart: [],
        proposal: { lost: 1, activeAtStart: 22, pct: 4.55 },
      },
    },
    sales: {
      from: "2026-10-01",
      to: "2026-10-31",
      cashThrough: TODAY,
      ledgerReady: true,
      deals: [
        {
          responseId: "resp-fx-d02",
          signedDay: "2026-10-03",
          business: "Client J",
          plan: "Made-up plan",
          contracted: 5000,
          depositTyped: 1000,
          closer: { name: "Yousef Darwish", personId: 104 },
          setter: {
            name: "Yousef Darwish",
            personId: 104,
            source: "form",
            disagree: false,
          },
          payments: [
            {
              paymentId: "whop:pay_fx021",
              rail: "whop",
              day: "2026-10-03",
              usd: 5000,
              matchedBy: "Whop's link to the deal",
            },
          ],
          cashInMonth: 5000,
          cashToDate: 5000,
          pif: { state: "earned", day: "2026-10-03", shortUsd: 0 },
        },
        {
          responseId: "resp-fx-d03",
          signedDay: "2026-10-08",
          business: "Client H",
          plan: "Made-up plan",
          contracted: 9000,
          depositTyped: 2000,
          closer: { name: "Yousef Darwish", personId: 104 },
          setter: {
            name: "Setter Nine",
            personId: null,
            source: "form",
            disagree: true,
          },
          payments: [
            {
              paymentId: "tap:chg_fx022",
              rail: "tap",
              day: "2026-10-08",
              usd: 2000,
              matchedBy: "payer email",
            },
            {
              paymentId: "bank:9031",
              rail: "bank",
              day: "2026-10-15",
              usd: 1750,
              matchedBy: "your tie",
            },
          ],
          cashInMonth: 3750,
          cashToDate: 3750,
          pif: { state: "no", day: null, shortUsd: 5250 },
        },
      ],
      people: [
        {
          personId: 104,
          closedCashUsd: 8750,
          setCashUsd: 5000,
          setWaiting: ["resp-fx-d03"],
          pifDeals: ["resp-fx-d02"],
          pifWaiting: [],
        },
      ],
      unkeyed: [
        { responseId: "resp-fx-d03", name: "Setter Nine", role: "setter" },
      ],
      unattributed: {
        count: 1,
        usd: 1500,
        items: [
          {
            paymentId: "whop:pay_fx099",
            day: "2026-10-16",
            usd: 1500,
            payer: "Payer Nine",
            rail: "whop",
          },
        ],
      },
      note: [
        "Cash is each payment the money refresh tied to a signed deal, from every rail, by the Kuwait day it cleared.",
        "Money not tied to a deal is listed under unattributed and never counted.",
        "The money refresh last ran 18 Oct 06:40 Kuwait time: payments since then are not counted yet.",
      ],
    },
    errors: {},
  };
}

/** "October", and the month after it, and the day it can be approved from. */
function monthWords(m: string) {
  const [y, mo] = m.split("-").map(Number);
  const name = (d: Date) =>
    d.toLocaleString("en-GB", { month: "long", timeZone: "UTC" });
  return {
    mname: name(new Date(Date.UTC(y, mo - 1, 1))),
    nname: name(new Date(Date.UTC(y, mo, 1))),
    settle: new Date(Date.UTC(y, mo, 3)).toISOString().slice(0, 10),
  };
}

function month(
  m: string,
  people: PayPerson[],
  notOnAPlan: PayMonth["notOnAPlan"],
): PayMonth {
  const { mname, nname, settle } = monthWords(m);
  const closed = TODAY >= settle;
  const notes = [`Earned in ${mname}, paid with ${nname}'s payroll.`];
  if (!closed) notes.push(`Approve ${mname} from 3 ${nname}.`);
  return {
    month: m,
    today: TODAY,
    closed,
    settleDay: settle,
    facts: facts(m),
    people: people.map(p =>
      // A month not closed is never ready.
      !closed && p.status === "ready" ? { ...p, status: "in_progress" } : p,
    ),
    notOnAPlan,
    notes,
  };
}

/** cockpit_ceo_pay_month(p_month): September and October in full; any other month is empty. */
export function payMonthFixture(
  scenario: PayScenario,
  pMonth: string,
): PayMonth {
  const m = `${pMonth.slice(0, 7)}-01`;
  if (m === "2026-09-01") return september(scenario);
  if (m === "2026-10-01") return october(scenario);
  return month(m, [], []);
}

/** cockpit_ceo_pay_costs: September's approved commission and parts. */
export function payCostsFixture(scenario: PayScenario) {
  if (scenario === "empty") return { months: [] };
  return {
    months: [
      {
        personId: 101,
        month: "2026-09-01",
        commissionUsd: 135,
        partsUsd: 0,
        notPriced: [],
      },
      {
        personId: 104,
        month: "2026-09-01",
        commissionUsd: 550,
        partsUsd: 0,
        notPriced: [],
      },
      {
        personId: 106,
        month: "2026-09-01",
        commissionUsd: 60,
        partsUsd: 0,
        notPriced: ["other"],
      },
    ],
  };
}

/** cockpit_ceo_pay_month_approve: ready people with the figures shown are approved; the rest say why. */
export function approveFixture(
  scenario: PayScenario,
  p: Record<string, unknown>,
) {
  const m = String(p.month ?? "");
  const shown = payMonthFixture(scenario, m);
  const { mname, nname } = monthWords(shown.month);
  let approved = 0;
  let existing = 0;
  const refused: { personId: number; sentence: string }[] = [];
  for (const it of (p.people ?? []) as {
    personId: number;
    totalUsd: number;
    resultHash: string;
  }[]) {
    const x = shown.people.find(q => q.personId === it.personId);
    if (!x) {
      refused.push({
        personId: it.personId,
        sentence: `They have no pay plan or commission for ${mname}.`,
      });
    } else if (x.status === "approved") {
      if (x.resultHash === it.resultHash) existing += 1;
      else
        refused.push({
          personId: it.personId,
          sentence: `${mname} is already approved for ${x.name} with other figures. Withdraw it first.`,
        });
    } else if (!shown.closed) {
      refused.push({
        personId: it.personId,
        sentence: `Approve ${mname} from 3 ${nname}.`,
      });
    } else if (x.status !== "ready") {
      refused.push({
        personId: it.personId,
        sentence: `${x.name} is not ready for ${mname}: ${x.missing[0] ?? x.note ?? "something is still open."}`,
      });
    } else if (x.resultHash !== it.resultHash || x.totalUsd !== it.totalUsd) {
      refused.push({
        personId: it.personId,
        sentence:
          "The figures changed since you opened the month. Reload and check again.",
      });
    } else approved += 1;
  }
  return { ok: true, approved, existing, refused };
}

/** The pay and money RPCs this file answers, for the harness's switch. */
export const PAY_RPCS = [
  "cockpit_ceo_pay_plans_list",
  "cockpit_ceo_pay_plan_save",
  "cockpit_ceo_pay_entry_save",
  "cockpit_ceo_pay_entry_void",
  "cockpit_ceo_pay_none_rest",
  "cockpit_ceo_pay_confirm",
  "cockpit_ceo_pay_month",
  "cockpit_ceo_pay_month_approve",
  "cockpit_ceo_pay_month_withdraw",
  "cockpit_ceo_pay_costs",
  "cockpit_ceo_payment_tie",
  "cockpit_ceo_payment_untie",
] as const;

let lastId = 400;
const nextId = () => {
  lastId += 1;
  return lastId;
};
/**
 * One pay or money RPC, answered from the fixtures: the data, or the
 * server's kind of sentence as the error. Writes answer as the server does
 * and change nothing but a saved plan.
 */
export function payRpc(
  name: string,
  args: Record<string, unknown>,
): { data: unknown; error: { message: string } | null } {
  const scenario = payScenario();
  const ok = (data: unknown) => ({ data, error: null });
  if (scenario === "broken")
    return {
      data: null,
      error: { message: "The pay figures could not be read: made-up outage." },
    };
  const p = (args.p ?? {}) as Record<string, unknown>;
  try {
    switch (name) {
      case "cockpit_ceo_pay_plans_list":
        return ok(payPlansFixture(scenario));
      case "cockpit_ceo_pay_month":
        return ok(payMonthFixture(scenario, String(args.p_month ?? "")));
      case "cockpit_ceo_pay_costs":
        return ok(payCostsFixture(scenario));
      case "cockpit_ceo_pay_plan_save":
        return ok(savePlanFixture(p));
      case "cockpit_ceo_pay_entry_save":
        if (
          String(p.month ?? "").startsWith("2026-09") &&
          [101, 104, 106].includes(Number(p.personId))
        )
          throw new Error(
            "September is approved. Add it to October as an adjustment.",
          );
        return ok({ ok: true, id: nextId() });
      case "cockpit_ceo_pay_entry_void":
        return ok({ ok: true });
      case "cockpit_ceo_pay_none_rest":
        return ok({ ok: true, parts: Number(p.personId) === 105 ? 5 : 0 });
      case "cockpit_ceo_pay_confirm":
        return ok({
          ok: true,
          id: p.value === null ? null : nextId(),
          removed: p.value === null,
        });
      case "cockpit_ceo_pay_month_approve":
        return ok(approveFixture(scenario, p));
      case "cockpit_ceo_pay_month_withdraw":
        return ok({ ok: true });
      case "cockpit_ceo_payment_tie":
        return ok({ ok: true, id: nextId() });
      case "cockpit_ceo_payment_untie":
        return ok({ ok: true, id: Number(p.id) });
      default:
        return {
          data: null,
          error: { message: `The harness has no fixture for ${name}.` },
        };
    }
  } catch (e) {
    return {
      data: null,
      error: { message: e instanceof Error ? e.message : String(e) },
    };
  }
}
