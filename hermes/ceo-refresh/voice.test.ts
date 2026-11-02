import { describe, expect, test } from "bun:test";
import { type Row, type Runtime, withRuntime } from "./runtime.ts";
import { extract } from "./native/metrics";
import {
  answersOf,
  csatOf,
  npsOf,
  readVoice,
  VOICE_SQL,
  voicePayload,
  voiceSourceNote,
  voiceSummary,
  voiceWindows,
} from "./native/voice.js";

/**
 * The client's voice in the CEO refresh (docs/forms/WAVE34-CONTRACT.md 3.5, 4.6.4, 6.4): the NPS number with its
 * second source, CSAT apart, the windows the metric table keeps, and a failed read said, never 0. Invented cards.
 */
const TODAY = "2026-11-20";
type Answer = { taskId: string; form: string; day: string; at: number; score: number | null; band: string | null; round: number | null };
const band = (s: number) => (s >= 9 ? "promoter" : s >= 7 ? "passive" : "detractor");
let at = 0;
const npsAnswer = (taskId: string, score: number, day = "2026-11-10"): Answer => ({ taskId, form: "nps", day, at: ++at, score, band: band(score), round: 1 });

function fixture() {
  // 3 promoters, 1 passive, 1 detractor; card A answered twice (2 first, then 10), so it counts once with its 10.
  const answers: Answer[] = [
    npsAnswer("A", 2, "2026-11-02"),
    npsAnswer("A", 10, "2026-11-12"),
    npsAnswer("B", 9),
    npsAnswer("C", 9),
    npsAnswer("D", 8),
    npsAnswer("E", 3),
    { taskId: "A", form: "csat", day: "2026-11-05", at: ++at, score: 8, band: null, round: null },
    { taskId: "F", form: "csat", day: "2026-11-06", at: ++at, score: 5, band: null, round: null },
    // A feedback rating never enters NPS or CSAT.
    { taskId: "B", form: "portal_feedback", day: "2026-11-07", at: ++at, score: 1, band: null, round: null },
  ];
  const answered = ["A", "A", "B", "C", "D", "E"].map((taskId, i) => ({ taskId, day: i === 0 ? "2026-11-02" : "2026-11-12" }));
  const daily = [
    { day: "2026-11-01", form: "nps", issued: 6, answered: 0 },
    { day: "2026-11-12", form: "nps", issued: 0, answered: 6 },
    { day: "2026-11-03", form: "csat", issued: 3, answered: 2 },
  ];
  return { answers, answered, daily };
}

describe("the NPS number", () => {
  test("3 promoters, 1 passive, 1 detractor make 40 over 5; a card answering twice counts once on both sides, with no note", () => {
    const f = fixture();
    expect(npsOf(f.answers, f.answered, "2026-11-01", "2026-11-30")).toEqual({
      score: 40, n: 5, promoters: 3, passives: 1, detractors: 1, cardsAnswered: 5, note: "",
    });
  });

  test("no answers in the window: no score and 'No scores yet.', never 0", () => {
    const f = fixture();
    const empty = npsOf(f.answers, f.answered, "2026-01-01", "2026-01-31");
    expect(empty.score).toBeNull();
    expect(empty.n).toBe(0);
    expect(empty.note).toBe("No scores yet.");
  });

  test("an answer with no answered invite behind it is said in the note", () => {
    const f = fixture();
    const out = npsOf([...f.answers, npsAnswer("G", 10)], f.answered, "2026-11-01", "2026-11-30");
    expect(out.n).toBe(6);
    expect(out.note).toBe("Cards with an answered invite 5, cards with an answer 6.");
  });

  test("the onboarding average is apart from NPS and a feedback rating is in neither", () => {
    const f = fixture();
    expect(csatOf(f.answers, "2026-11-01", "2026-11-30")).toEqual({ average: 6.5, n: 2 });
    expect(csatOf(f.answers, "2026-12-01", "2026-12-31")).toEqual({ average: null, n: 0 });
  });

  test("the windows: this month, last month, 30 and 90 days, each summarised with its invite counts", () => {
    expect(voiceWindows(TODAY)).toEqual({
      mtd: ["2026-11-01", TODAY], lastMonth: ["2026-10-01", "2026-10-31"], last30: ["2026-10-22", TODAY], last90: ["2026-08-23", TODAY],
    });
    const p = voicePayload(fixture(), TODAY);
    expect(p.read).toBe(true);
    expect(p.firstDay).toBe("2026-11-02");
    expect(p.windows.mtd.nps.score).toBe(40);
    expect(p.windows.mtd.invites).toEqual({ nps: { sent: 6, answered: 6, cardsAnswered: 5 }, csat: { sent: 3, answered: 2 } });
    expect(p.windows.lastMonth.nps).toMatchObject({ score: null, n: 0, note: "No scores yet." });
    expect(voiceSummary(fixture(), "2026-11-10", "2026-11-12").nps).toMatchObject({ n: 5, score: 40, note: "" });
    // A window holding only card A's first answer reads that one: a detractor.
    expect(voiceSummary(fixture(), "2026-11-02", "2026-11-02").nps).toMatchObject({ n: 1, score: -100, cardsAnswered: 1, note: "" });
    // The payload carries cards, days and scores only.
    expect(Object.keys(p.answers[0]).sort()).toEqual(["at", "band", "day", "form", "score", "taskId"]);
  });

  test("a broken row throws rather than read as none", () => {
    expect(() => answersOf([{ clickup_task_id: "", form_key: "nps", day: "2026-11-01" }])).toThrow("A client voice row has no card, day or form");
    expect(() => answersOf([{ clickup_task_id: "A", form_key: "exit_survey", day: "2026-11-01" }])).toThrow();
  });
});

describe("the metrics and the source note", () => {
  const clients = (voice: unknown) => ({ counts: { active: 15, onboarding: 0, paused: 0, churned: 30, total: 45 }, atRisk: [], rows: [], notes: [], voice });

  test("clients.nps, clients.nps.responses and clients.csat for each window; no answers is NULL, not 0", () => {
    const values = extract("clients", clients(voicePayload(fixture(), TODAY))) as { metric: string; window: string; value: number | null; windowFrom?: string }[];
    const pick = (metric: string, window: string) => values.find(v => v.metric === metric && v.window === window);
    expect(pick("clients.nps", "mtd")).toMatchObject({ value: 40, windowFrom: "2026-11-01" });
    expect(pick("clients.nps.responses", "mtd")?.value).toBe(5);
    expect(pick("clients.csat", "mtd")?.value).toBe(6.5);
    expect(pick("clients.nps", "lastMonth")?.value).toBeNull();
    expect(pick("clients.nps.responses", "lastMonth")?.value).toBe(0);
    expect(pick("clients.csat", "lastMonth")?.value).toBeNull();
  });

  test("a failed read writes no voice metric and says so; never 0", () => {
    const failed = { read: false, error: "permission denied for view cockpit_client_voice_v" };
    const values = extract("clients", clients(failed)) as { metric: string }[];
    expect(values.filter(v => v.metric.startsWith("clients.nps") || v.metric === "clients.csat")).toEqual([]);
    expect(extract("clients", clients(undefined)).filter((v: { metric: string }) => v.metric.startsWith("clients.nps"))).toEqual([]);
    expect(voiceSourceNote(failed)).toBe(
      "Client voice could not be read this run (permission denied for view cockpit_client_voice_v), so NPS and the onboarding survey are missing, not zero.",
    );
    expect(voiceSourceNote(voicePayload(fixture(), TODAY))).toContain("each client counts once per window with their latest answer");
    // The old Typeform answers are counted live: none, no sentence; one, singular.
    expect(voiceSourceNote(voicePayload({ ...fixture(), legacyUnmatched: 0 }, TODAY))).not.toContain("Typeform");
    expect(voiceSourceNote(voicePayload({ ...fixture(), legacyUnmatched: 1 }, TODAY))).toContain("the 1 old Typeform answer could not be matched to a client and is left out");
  });

  test("both registries define the three metrics once, with a source and what each leaves out", async () => {
    const native = await import("./native/metrics");
    const convex = await import("../../apps/media-buyer-cockpit/convex/ceo/metricRegistry");
    for (const metric of ["clients.nps", "clients.nps.responses", "clients.csat"])
      for (const defs of [native.DEFINITIONS, convex.DEFINITIONS]) {
        const hits = defs.filter((d: { metric: string }) => d.metric === metric);
        expect(hits).toHaveLength(1);
        expect(hits[0].source).toContain("cockpit_client_voice_v");
        expect((hits[0].leavesOut ?? "").length).toBeGreaterThan(10);
      }
    const n = native.extract("clients", clients(voicePayload(fixture(), TODAY)));
    const c = convex.extract("clients", clients(voicePayload(fixture(), TODAY)));
    expect(c.filter((v: { metric: string }) => v.metric.startsWith("clients.nps") || v.metric === "clients.csat"))
      .toEqual(n.filter((v: { metric: string }) => v.metric.startsWith("clients.nps") || v.metric === "clients.csat"));
  });
});

describe("readVoice", () => {
  const runtimeWith = (read: Runtime["read"]): Runtime => ({ env: () => undefined, read, repository: {} as Runtime["repository"], tools: {} as Runtime["tools"] });

  test("reads the view, the answered invites and the daily counts through the read path", async () => {
    const seen: string[] = [];
    const read = async (_project: string, query: string): Promise<Row[]> => {
      seen.push(query);
      if (query === VOICE_SQL.answers)
        return [{ response_id: "r1", clickup_task_id: "A", form_key: "nps", day: "2026-11-10", at_ms: 1, score: 9, band: "promoter", round: 1 }];
      if (query === VOICE_SQL.answered) return [{ task_id: "A", day: "2026-11-10" }];
      if (query === VOICE_SQL.daily) return [{ day: "2026-11-09", form_key: "nps", issued: 1, answered: 0 }];
      if (query === VOICE_SQL.legacy) return [{ n: 2 }];
      throw new Error("unexpected query");
    };
    const out = await withRuntime(runtimeWith(read), () => readVoice(TODAY));
    expect(out.ok).toBe(true);
    expect(out.payload.windows.mtd.nps).toMatchObject({ score: 100, n: 1, cardsAnswered: 1, note: "" });
    expect(out.payload.legacyUnmatched).toBe(2);
    expect(voiceSourceNote(out.payload)).toContain("the 2 old Typeform answers could not be matched to a client and are left out");
    expect(seen).toHaveLength(4);
    expect(VOICE_SQL.legacy).toContain("state = 'legacy' and r.task_id is null");
    for (const q of seen) expect(q).not.toMatch(/\blimit\b/i);
    expect(VOICE_SQL.answered).toContain("i.origin <> 'canary'");
  });

  test("a failed read is ok false with the reason, never numbers", async () => {
    const out = await withRuntime(runtimeWith(async () => { throw new Error("permission denied for view cockpit_client_voice_v at https://db.example/x"); }), () => readVoice(TODAY));
    expect(out).toEqual({ ok: false, error: "permission denied for view cockpit_client_voice_v at" });
  });
});
