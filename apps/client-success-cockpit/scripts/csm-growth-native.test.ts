import { describe, expect, test } from "bun:test";
import { buildChurnPage } from "../src/lib/churnClient";
import { buildProjections } from "../src/lib/projectionsModel";
import { projectionSourceSchema } from "../src/lib/projectionsSchema";

const source = () =>
  projectionSourceSchema.parse({
    today: "2026-10-04",
    owner: "csm@example.test",
    email: "csm@example.test",
    canGold: false,
    canEditOthers: false,
    clients: [
      {
        taskId: "client-1",
        name: "Assigned client",
        stage: "Active",
        liveDays: 45,
        firstWin: true,
        renewalDate: "2026-10-20",
        renewalTracked: true,
        bucket: "management",
      },
    ],
    plans: [],
    projections: [],
    appointments: [],
    profiles: [],
    decisions: [],
    feed: {
      okAt: null,
      ledgerSyncedAt: null,
      error: "Ledger has not completed a native refresh",
      payments: [],
      accounts: [],
    },
  });

describe("native CSM projections", () => {
  test("missing billing is unknown, not zero cash", () => {
    const page = buildProjections(source());
    const cash = page.thisWeek.rows.find(row => row.metric === "cash");
    expect(cash?.actual).toBeNull();
    expect(cash?.actualFrom).toBe("missing");
    expect(cash?.manualAllowed).toBe(true);
    expect(page.window.rows[0].state).toBe("red");
  });
  test("confirmed wins and reversals feed the retained weekly strip", () => {
    const data = source();
    data.decisions = [
      {
        role: "csm",
        day: "2026-10-04",
        kind: "won",
        subject: "Assigned client",
        action: "Won: renewal",
      },
      {
        role: "csm",
        day: "2026-10-04",
        kind: "unwon",
        subject: "Assigned client",
        action: "Won undone: renewal",
      },
    ];
    data.projections = [
      {
        weekStart: "2026-10-04",
        byEmail: "csm@example.test",
        metric: "renewal",
        blood: 2,
        stretch: 3,
        at: 1,
      },
    ];
    const row = buildProjections(data).thisWeek.rows.find(
      row => row.metric === "renewal",
    );
    expect(row?.actual).toBe(0);
    expect(row?.blood).toBe(2);
    expect(row?.actualFrom).toBe("source");
  });
  test("manual cash persists while source is unavailable", () => {
    const data = source();
    data.projections = [
      {
        weekStart: "2026-10-04",
        byEmail: "csm@example.test",
        metric: "cash",
        blood: 500,
        stretch: 900,
        actual: 600,
        at: 1,
      },
    ];
    const row = buildProjections(data).thisWeek.rows.find(
      row => row.metric === "cash",
    );
    expect(row?.actual).toBe(600);
    expect(row?.actualFrom).toBe("manual");
  });
  test("a receipt logged by hand and not checked is said apart, never counted as collected", () => {
    const now = Date.now();
    const data = projectionSourceSchema.parse({
      ...source(),
      feed: {
        okAt: now,
        ledgerSyncedAt: now,
        error: null,
        payments: [
          {
            id: "whop:1",
            taskId: "client-1",
            clientName: "Assigned client",
            day: "2026-10-04",
            usd: 1000,
            side: "back_end",
            kind: "client",
          },
        ],
        logged: [
          {
            id: "manual:2",
            taskId: "client-1",
            clientName: "Assigned client",
            day: "2026-10-04",
            usd: 1500,
            side: "back_end",
            kind: "client",
            note: "Receipt in, not checked",
          },
        ],
        accounts: [],
      },
    });
    const page = buildProjections(data);
    const cash = page.thisWeek.rows.find(row => row.metric === "cash");
    expect(cash?.actual).toBe(1000);
    expect(cash?.note).toContain(
      "Receipt in, not checked: $1,500 in 1 payment this week, waiting on finance's check and not counted here.",
    );
    const facts = page.window.rows[0].facts;
    expect(facts.map(f => f.label)).toEqual(
      expect.arrayContaining(["Paid so far", "Receipt in, not checked"]),
    );
    expect(facts.find(f => f.label === "Paid so far")?.value).toBe("$1,000");
    expect(facts.find(f => f.label === "Receipt in, not checked")?.value).toBe(
      "$1,500",
    );
    // A read from before the check rule has no logged list and still parses.
    expect(projectionSourceSchema.parse(source()).feed.logged).toEqual([]);
  });
  test("malformed native source is refused before rendering", () => {
    expect(() =>
      projectionSourceSchema.parse({ ...source(), feed: { payments: [] } }),
    ).toThrow();
  });
});

describe("native churn register", () => {
  test("scoped month without an organization denominator stays unknown", () => {
    const page = buildChurnPage({
      today: "2026-10-04",
      month: "2026-10",
      me: { email: "csm@example.test", isCeo: false, isAdmin: false },
      deps: [],
      monthRows: [],
      cards: [],
      log: [],
      roster: {
        cards: [],
        left: [],
        starts: [{ month: "2026-10", day: null, paying: null }],
      },
    });
    expect(page.months[0].activeAtStart).toBeNull();
    expect(page.months[0].churnPct).toBeNull();
    expect(page.me.canRemove).toBe(false);
  });
  test("incomplete RPC payload is not a success-shaped empty register", () => {
    expect(() => buildChurnPage({ today: "2026-10-04", deps: [] })).toThrow();
  });
});
