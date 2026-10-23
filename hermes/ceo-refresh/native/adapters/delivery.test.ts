import { describe, expect, test } from "bun:test";
import { type Runtime, withRuntime } from "../../runtime";
import { extractDelivery } from "../metrics";
import { BOARD_STALE_MS, delivery } from "./delivery.js";

/**
 * The Delivery section end to end over stubbed reads (2026-10-22 review of
 * build 2): the board's counts that are stale, unfinished or missing are said
 * and never read as zero; the cross-check compares like with like; only lost
 * clients that spent this month are named; each row says when it is judged
 * on cost per lead alone; and a refresh that fell back to the media sync
 * writes no booking value under the board's metric names.
 */
const KW = 3 * 3600_000;
const now = Date.now();
const kuwaitDay = (ms: number) => new Date(ms + KW).toISOString().slice(0, 10);
const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const today = kuwaitDay(now);
const yesterday = addDays(today, -1);
/** Kuwait midnight at the start of today, in ms. */
const todayStart = Date.parse(`${today}T00:00:00Z`) - KW;

type BoardRow = {
  location_id: string;
  clickup_id: string;
  client_name: string;
  status: string;
  service_mode: string;
  date: string;
  confirmed: number | null;
  provisional: number | null;
  computed_ms: number;
};
type Tie = {
  client_id: string;
  account: string;
  name: string;
  clickup_id: string | null;
  service_mode: string | null;
  status: string | null;
  location_id: string | null;
  on_board: boolean;
};
type Day = { client_id: string; day: string; spend_usd: number; leads: number };

const alphaTie: Tie = {
  client_id: "acc-a",
  account: "Alpha account",
  name: "Alpha",
  clickup_id: "task-a",
  service_mode: "DFY",
  status: "Active",
  location_id: "loc-a",
  on_board: true,
};
const board = (date: string, confirmed: number | null, provisional: number | null, computed = now, loc = "loc-a", mode = "DFY"): BoardRow => ({
  location_id: loc,
  clickup_id: loc === "loc-a" ? "task-a" : `task-${loc}`,
  client_name: loc === "loc-a" ? "Alpha" : loc,
  status: "Active",
  service_mode: mode,
  date,
  confirmed,
  provisional,
  computed_ms: computed,
});

async function run(o: {
  boardRows?: BoardRow[];
  ties?: Tie[];
  days?: Day[];
  /** The media sync's own booking events for campaign A. */
  syncBookings?: { date: string; campaignName: string; count: number; copies: number }[];
  /** cockpit_board_targets cpl rows, or "fail" for a read that fails. */
  targets?: { scope_key: string; good: number }[] | "fail";
}) {
  const days = o.days ?? [{ client_id: "acc-a", day: yesterday, spend_usd: 400, leads: 40 }];
  const answer = (query: string): unknown[] => {
    if (query.includes("cockpit_client_days")) return o.boardRows ?? [board(yesterday, 4, 1)];
    if (query.includes("cockpit_media_feed_state"))
      return [{ ready: true, source_rows: 2, actual_rows: 2, snapshot_ms: now, first_day: addDays(today, -90), last_day: yesterday }];
    if (query.includes("board_rows"))
      return (o.ties ?? [alphaTie]).map(t => ({ ...t, hidden: false, currency: "USD", ad_account: null, matched_by: "board ad account", board_rows: 1 }));
    if (query.includes("round(sum(l.spend), 2)")) return [];
    if (query.includes("client_opportunities")) return [];
    if (query.includes("appointment_outcomes o") && query.includes("outcome_rows")) return [{}];
    if (query.includes("ap.tie as client_id")) return [];
    if (query.includes("spend_usd, leads, campaigns"))
      return days.map(d => ({ ...d, campaigns: ["A"], currency: "USD", source: "media" }));
    if (query.includes("cockpit_board_targets")) {
      if (o.targets === "fail") throw new Error("permission denied for table cockpit_board_targets");
      return o.targets ?? [];
    }
    throw new Error(`Unexpected database read: ${query.slice(0, 80)}`);
  };
  const spend7d = days.filter(d => d.day >= addDays(today, -7) && d.day < today).reduce((n, d) => n + d.spend_usd, 0);
  const repository = {
    delivery: async () => ({
      campaigns: [{ campaignName: "A", clientName: "Alpha", spend7d, leads7d: 40, bookings7d: 0, bookingsTracked: true, syncedAt: now }],
      daily: [{ date: yesterday, campaignName: "A", spend: spend7d, leads: 40 }],
      bookings: o.syncBookings ?? [],
      clients: [],
      launches: [],
      tree: [],
      offBoard: [],
      health: {},
    }),
  } as unknown as Runtime["repository"];
  const read: Runtime["read"] = async (_p, q) => answer(q) as never;
  const result = await withRuntime({ env: () => undefined, read, repository, tools: {} as Runtime["tools"] }, () =>
    delivery.compute({ repository } as never),
  );
  const payload = result.payload as any;
  const notes: string[] = payload.notes.map((n: { text: string }) => n.text);
  const bookingsSource = result.sources.find(s => s.name.startsWith("Client bookings (Client Performance board"));
  return { result, payload, notes, bookingsSource };
}

describe("how current the board's counts are", () => {
  test("fresh counts, yesterday counted after it ended: no warning and the source is ok", async () => {
    const { payload, notes, bookingsSource } = await run({});
    expect(bookingsSource?.ok).toBe(true);
    expect(notes.some(t => /last counted bookings|before it ended|no booking count for yesterday/.test(t))).toBe(false);
    expect(payload.yesterday).toMatchObject({ confirmed: 4, provisional: 1, bookings: 5, cpbConfirmed: 100 });
  });

  test("counts over 2 hours old still publish as the board stores them, but the tab says so and the source is not ok", async () => {
    const old = now - BOARD_STALE_MS - 3600_000;
    const { payload, notes, bookingsSource } = await run({ boardRows: [board(yesterday, 4, 1, old)] });
    expect(notes.some(t => t.includes("last counted bookings 3 hours ago"))).toBe(true);
    expect(bookingsSource?.ok).toBe(false);
    expect(bookingsSource?.note).toContain("may read low");
    // The stored count is what the board holds: published, never zeroed.
    expect(payload.last7.confirmed).toBe(4);
  });

  test("yesterday counted before it ended: said, and the source is not ok", async () => {
    const { notes, bookingsSource } = await run({
      boardRows: [board(yesterday, 4, 1, todayStart - 28 * 60_000), board(today, 1, 0, now)],
    });
    expect(notes.some(t => t.includes("before it ended"))).toBe(true);
    expect(notes.some(t => t.includes("last counted bookings"))).toBe(false);
    expect(bookingsSource?.ok).toBe(false);
  });

  test("no stored count for yesterday: yesterday reads n/a (null), never zero bookings", async () => {
    const { payload, notes, bookingsSource } = await run({
      boardRows: [board(addDays(today, -2), 3, 0), board(today, 1, 0)],
      days: [
        { client_id: "acc-a", day: addDays(today, -2), spend_usd: 150, leads: 10 },
        { client_id: "acc-a", day: yesterday, spend_usd: 250, leads: 30 },
      ],
    });
    expect(payload.yesterday).toMatchObject({ spend: 250, confirmed: null, provisional: null, bookings: null, cpbConfirmed: null, cpb: null, spendMeasured: 0 });
    expect(payload.yesterday.notMeasured).toEqual([{ client: "Alpha", spend: 250, why: "The board stores no booking days for this client in these days." }]);
    expect(notes.some(t => t.includes(`no booking count for yesterday (${yesterday})`))).toBe(true);
    expect(bookingsSource?.ok).toBe(false);
    // The 7 days still divide what is stored: $150 over 3.
    expect(payload.last7).toMatchObject({ confirmed: 3, spendMeasured: 150, cpbConfirmed: 50 });
    // The daily series has the gap as null, not 0.
    expect(payload.daily.find((r: { date: string }) => r.date === yesterday)).toMatchObject({ confirmed: null, spendMeasured: null });
  });
});

describe("the cross-check against the media sync", () => {
  test("compares the board's confirmed bookings with the sync's events, which carry no provisional", async () => {
    // 2 confirmed and 3 provisional on the board, 2 events in the sync:
    // confirmed for confirmed, there is no gap to report.
    const { notes } = await run({
      boardRows: [board(yesterday, 2, 3)],
      syncBookings: [{ date: yesterday, campaignName: "A", count: 2, copies: 0 }],
    });
    expect(notes.some(t => t.startsWith("Cross-check"))).toBe(false);
  });

  test("a real gap in confirmed bookings is still reported, as confirmed bookings", async () => {
    const { notes } = await run({
      boardRows: [board(yesterday, 6, 0)],
      syncBookings: [{ date: yesterday, campaignName: "A", count: 2, copies: 0 }],
    });
    const note = notes.find(t => t.startsWith("Cross-check"));
    expect(note).toContain("6 confirmed bookings made on the same days");
  });
});

describe("money on lost clients", () => {
  test("only lost clients whose accounts spent this month are named", async () => {
    const { notes, payload } = await run({
      ties: [
        alphaTie,
        { ...alphaTie, client_id: "acc-p", account: "Pidco", name: "Pidco", clickup_id: "11", status: "Cancelled", location_id: "loc-p" },
        { ...alphaTie, client_id: "acc-o", account: "Old", name: "Old client", clickup_id: "12", status: "Stopped", location_id: "loc-o" },
      ],
      days: [
        { client_id: "acc-a", day: yesterday, spend_usd: 400, leads: 40 },
        { client_id: "acc-p", day: today, spend_usd: 87.5, leads: 2 },
        { client_id: "acc-o", day: addDays(today, -60), spend_usd: 300, leads: 9 },
      ],
    });
    const note = notes.find(t => t.includes("(cancelled, stopped or churned)"));
    expect(note).toContain("on 1 lost client (cancelled, stopped or churned)");
    expect(note).toContain("Pidco (cancelled)");
    expect(note).toContain("this client is not in the clients table. Without it the month reads");
    expect(note).not.toContain("Old client");
    // A lost client is not a client row to judge.
    expect(payload.clients.map((c: { client: string }) => c.client)).toEqual(["Alpha"]);
  });
});

describe("which rule judged a row", () => {
  test("cost per booking decides, a Done With You client with no booking is cost per lead alone, and so is one the board stores nothing for", async () => {
    const { payload } = await run({
      ties: [
        alphaTie,
        { ...alphaTie, client_id: "acc-d", account: "DWY account", name: "Nuhood", clickup_id: "task-d", service_mode: "DWY", location_id: "loc-d" },
        { ...alphaTie, client_id: "acc-t", account: "Art Vision", name: "Art Vision", clickup_id: null, service_mode: null, location_id: null, on_board: false },
      ],
      boardRows: [board(yesterday, 4, 1), board(yesterday, 0, 0, now, "loc-d", "DWY")],
      days: [
        { client_id: "acc-a", day: yesterday, spend_usd: 400, leads: 40 },
        { client_id: "acc-d", day: yesterday, spend_usd: 192.33, leads: 16 },
        { client_id: "acc-t", day: yesterday, spend_usd: 14.62, leads: 2 },
      ],
    });
    const row = (name: string) => payload.clients.find((c: { client: string }) => c.client === name);
    expect(row("Alpha")).toMatchObject({ cplOnly: null, status: "bad", cpbConfirmed7d: 100 });
    // Cost per lead $12.02, within $15: on track on the rule that judged it.
    expect(row("Nuhood")).toMatchObject({ cplOnly: "dwy", status: "good" });
    // No card says whether we book for it, and no booking is stored: cost
    // per lead alone, as for a Done With You client, and the row says why.
    expect(row("Art Vision")).toMatchObject({ cplOnly: "no service mode", status: "good", confirmed7d: null });
  });

  // Decision 2 (the CEO, 23 Oct 2026): "No keep the CPL but ignore CPB".
  test("a Done With You client with stored bookings is still never judged on bookings, and its spend leaves the company cost per booking", async () => {
    const { payload, notes } = await run({
      ties: [
        alphaTie,
        { ...alphaTie, client_id: "acc-d", account: "DWY account", name: "Nuhood", clickup_id: "task-loc-d", service_mode: "DWY", location_id: "loc-d" },
      ],
      boardRows: [board(yesterday, 4, 1), board(yesterday, 2, 1, now, "loc-d", "DWY")],
      days: [
        { client_id: "acc-a", day: yesterday, spend_usd: 400, leads: 40 },
        { client_id: "acc-d", day: yesterday, spend_usd: 205.05, leads: 17 },
      ],
    });
    const nuhood = payload.clients.find((c: { client: string }) => c.client === "Nuhood");
    expect(nuhood).toMatchObject({
      cplOnly: "dwy",
      status: "good",
      cpl7d: 12.06,
      bookings7d: null,
      provisional7d: null,
      confirmed7d: null,
      cpb7d: null,
      cpbConfirmed7d: null,
      costPerShownAt60: null,
      tooEarly: false,
      bookingsWhy: "Done with you: the client books its own meetings, so its cost per booking and booking rate are not judged.",
    });
    expect(nuhood.rates30).toMatchObject({ bookRate: null, bookRateConfirmed: null, bookRateProvisional: null });
    // Company: spend, leads and cost per lead keep it; the cost per booking
    // divides Alpha's $400 by Alpha's 4 and names the left-out spend.
    expect(payload.last7).toMatchObject({ spend: 605.05, leads: 57, cpl: 10.61, confirmed: 4, provisional: 1, spendMeasured: 400, cpbConfirmed: 100 });
    expect(payload.last7.doneWithYou).toEqual([{ client: "Nuhood", spend: 205.05 }]);
    expect(payload.last7.notMeasured).toEqual([]);
    const day1 = payload.daily.find((r: { date: string }) => r.date === yesterday);
    expect(day1).toMatchObject({ confirmed: 4, provisional: 1, spendMeasured: 400, spendDoneWithYou: 205.05 });
    const cost = notes.find(t => t.startsWith("Cost per confirmed booking for the last 7 days"));
    expect(cost).toContain("leaves out $205.05 of done-with-you spend: Nuhood $205.05 (the client books its own meetings");
    // Nothing unmeasured, so no "over all" figure that could add it back.
    expect(cost).not.toContain("Over all");
    expect(notes.some(t => t.includes("1 Done With You client books its own meetings") && t.includes("Nuhood"))).toBe(true);
    // Its per-client booking values are not written; spend and cost per lead are.
    const metrics = extractDelivery(payload).filter(m => m.scope === "client:task-loc-d");
    expect(metrics.find(m => m.metric === "delivery.cpl")?.value).toBe(12.06);
    for (const n of ["delivery.bookings", "delivery.bookings_confirmed", "delivery.cpb", "delivery.cpb_confirmed", "delivery.book_rate", "delivery.book_rate_confirmed"])
      expect(metrics.find(m => m.metric === n)?.value ?? null).toBeNull();
  });

  test("the over-all aside adds back only unmeasured spend, never done-with-you spend", async () => {
    const { notes } = await run({
      ties: [
        alphaTie,
        { ...alphaTie, client_id: "acc-d", account: "DWY account", name: "Nuhood", clickup_id: "task-loc-d", service_mode: "DWY", location_id: "loc-d" },
        { ...alphaTie, client_id: "acc-p", account: "Pidco", name: "Pidco Group", clickup_id: "11", status: "Cancelled", location_id: null, on_board: false },
      ],
      boardRows: [board(yesterday, 4, 1), board(yesterday, 0, 0, now, "loc-d", "DWY")],
      days: [
        { client_id: "acc-a", day: yesterday, spend_usd: 400, leads: 40 },
        { client_id: "acc-d", day: yesterday, spend_usd: 205.05, leads: 17 },
        { client_id: "acc-p", day: yesterday, spend_usd: 201.64, leads: 4 },
      ],
    });
    const cost = notes.find(t => t.startsWith("Cost per confirmed booking for the last 7 days")) ?? "";
    expect(cost).toContain("leaves out $201.64 of spend whose bookings the board does not store: Pidco Group $201.64");
    expect(cost).toContain("; and $205.05 of done-with-you spend: Nuhood $205.05");
    // (400 + 201.64) / 4, never (400 + 201.64 + 205.05) / 4.
    expect(cost).toContain("Over all $601.64 of spend, done-with-you spend still left out, it would read $150.41.");
  });

  // Decision 5 (the CEO, 23 Oct 2026): "triple edge is a old churned client".
  test("a churned client's account is no client row and no status; its spend is named as a churned client's, never as untied", async () => {
    const { payload, notes } = await run({
      ties: [
        alphaTie,
        // clientTiesSql gives the list's name and the status "Churned" when no live tie exists.
        { ...alphaTie, client_id: "acc-t", account: "Triple Edge", name: "Triple Edge Building Construction", clickup_id: null, service_mode: null, status: "Churned", location_id: null, on_board: false },
        { ...alphaTie, client_id: "acc-v", account: "Art Vision", name: "Art Vision", clickup_id: null, service_mode: null, status: null, location_id: null, on_board: false },
      ],
      days: [
        { client_id: "acc-a", day: yesterday, spend_usd: 400, leads: 40 },
        { client_id: "acc-t", day: yesterday, spend_usd: 9.74, leads: 2 },
        { client_id: "acc-v", day: yesterday, spend_usd: 5, leads: 1 },
      ],
    });
    expect(payload.clients.map((c: { client: string }) => c.client).sort()).toEqual(["Alpha", "Art Vision"]);
    // Spend and leads keep it; the cost per booking does not divide it.
    expect(payload.last7).toMatchObject({ spend: 414.74, leads: 43, spendMeasured: 400, cpbConfirmed: 100 });
    expect(payload.last7.notMeasured).toContainEqual({
      client: "Triple Edge Building Construction",
      spend: 9.74,
      why: "This is a churned client's ad account, so its bookings are not read.",
    });
    const untied = notes.find(t => t.includes("tied to no client card, so"));
    expect(untied).toContain("Art Vision");
    expect(untied).not.toContain("Triple Edge");
    const lost = notes.find(t => t.includes("(cancelled, stopped or churned)"));
    expect(lost).toContain("Triple Edge Building Construction (churned)");
  });

  // Decision 4 (the CEO, 23 Oct 2026): "Depends on how much spend if 2x target cpl then yes bad if below that then not enough data".
  test("no lead under 2 x the client's line is too few, a watch; at the line it is off track", async () => {
    const tie = (id: string, name: string) => ({ ...alphaTie, client_id: `acc-${id}`, account: name, name, clickup_id: `task-${id}`, location_id: `loc-${id}` });
    const { payload, notes } = await run({
      ties: [alphaTie, tie("m", "Madana"), tie("k", "Khalida"), tie("o", "Own line")],
      boardRows: [board(yesterday, 4, 1), board(yesterday, 0, 0, now, "loc-m"), board(yesterday, 0, 0, now, "loc-k"), board(yesterday, 0, 0, now, "loc-o")],
      days: [
        { client_id: "acc-a", day: yesterday, spend_usd: 400, leads: 40 },
        { client_id: "acc-m", day: yesterday, spend_usd: 11.09, leads: 0 },
        { client_id: "acc-k", day: yesterday, spend_usd: 30, leads: 0 },
        { client_id: "acc-o", day: yesterday, spend_usd: 39.99, leads: 0 },
      ],
      // Own line's card has a $20 cost per lead line on the board.
      targets: [{ scope_key: "client:task-o", good: 20 }],
    });
    const row = (name: string) => payload.clients.find((c: { client: string }) => c.client === name);
    expect(row("Madana")).toMatchObject({ status: "watch", tooEarly: true, tooFew: true, noLeadLine: 30 });
    expect(row("Khalida")).toMatchObject({ status: "bad", tooEarly: false, tooFew: false, noLeadLine: 30 });
    expect(row("Own line")).toMatchObject({ status: "watch", tooFew: true, noLeadLine: 40 });
    expect(row("Alpha")).toMatchObject({ tooFew: false, noLeadLine: 30 });
    expect(notes.some(t => t.includes("Spend with no lead (Aziz, 23 Oct 2026) is off track once it reaches 2 x the client's cost per lead line"))).toBe(true);
    expect(notes.some(t => t.includes("cockpit_board_targets) could not be read"))).toBe(false);
  });

  test("a board default line moves every client without its own; a failed read falls back to 2 x the gate and says so", async () => {
    const madana = { ...alphaTie, client_id: "acc-m", account: "Madana", name: "Madana", clickup_id: "task-m", location_id: "loc-m" };
    const days = [
      { client_id: "acc-a", day: yesterday, spend_usd: 400, leads: 40 },
      { client_id: "acc-m", day: yesterday, spend_usd: 35, leads: 0 },
    ];
    const boardRows = [board(yesterday, 4, 1), board(yesterday, 0, 0, now, "loc-m")];
    const withDefault = await run({ ties: [alphaTie, madana], boardRows, days, targets: [{ scope_key: "defaults", good: 18 }] });
    expect(withDefault.payload.clients.find((c: { client: string }) => c.client === "Madana")).toMatchObject({ status: "watch", tooFew: true, noLeadLine: 36 });
    const failed = await run({ ties: [alphaTie, madana], boardRows, days, targets: "fail" });
    expect(failed.payload.clients.find((c: { client: string }) => c.client === "Madana")).toMatchObject({ status: "bad", tooFew: false, noLeadLine: 30 });
    expect(failed.notes.some(t => t.includes("could not be read this run, so spend with no lead is judged against $30 (2 x the $15 gate) for every client"))).toBe(true);
  });

  test("a client we book for whose bookings the board does not store is a watch at best", async () => {
    const { payload } = await run({
      ties: [alphaTie, { ...alphaTie, client_id: "acc-m", account: "Mass", name: "Mass Design", clickup_id: "task-m", location_id: null, on_board: false }],
      boardRows: [board(yesterday, 4, 1)],
      days: [
        { client_id: "acc-a", day: yesterday, spend_usd: 400, leads: 40 },
        { client_id: "acc-m", day: yesterday, spend_usd: 50, leads: 10 },
      ],
    });
    const mass = payload.clients.find((c: { client: string }) => c.client === "Mass Design");
    // Cost per lead $5, but bookings not measured: never on track.
    expect(mass).toMatchObject({ cplOnly: "not measured", status: "watch", confirmed7d: null, bookings7d: null });
  });
});

describe("the metric history keeps one rule per name", () => {
  test("a refresh that fell back to the media sync writes spend and leads, and no booking value under the board's names", async () => {
    const { payload } = await run({});
    const all = extractDelivery(payload);
    expect(all.some(m => m.metric === "delivery.cpb_confirmed" && m.scope === "company")).toBe(true);
    const fallback = extractDelivery({ ...payload, bookingSource: "media sync" });
    const names = new Set(fallback.map(m => m.metric));
    expect(names.has("delivery.spend")).toBe(true);
    expect(names.has("delivery.cpl")).toBe(true);
    for (const n of ["delivery.bookings", "delivery.bookings_confirmed", "delivery.bookings_provisional", "delivery.cpb", "delivery.cpb_confirmed", "delivery.book_rate", "delivery.book_rate_confirmed"])
      expect(names.has(n)).toBe(false);
    // A payload stored before the board's counts (no bookingSource) is the same.
    const { bookingSource: _drop, ...old } = payload;
    expect(extractDelivery(old).some(m => m.metric === "delivery.cpb")).toBe(false);
  });
});
