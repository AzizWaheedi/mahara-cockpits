import { beforeEach, describe, expect, test } from "bun:test";
import { RpcError } from "../cockpit-hours-sync/db.ts";
import {
  bullet,
  canonical,
  checkinDrafts,
  FAILED,
  inputOf,
  NO_RECORDING,
  NOT_CLIENT_CALL,
  OFF,
  RECAP_AFTER_SEND,
  sha256,
  summarySections,
  SUMMARY_WAIT,
  TODOS_VERSION,
  TRANSCRIPT_WAIT,
  todosOutput,
} from "./drafts.ts";
import { clearTranscriptCache, MISS_MS, missWait, OUTSIDE_CS, OUTSIDE_CS_LIKELY } from "./fathom.ts";
import { CRITERIA } from "./prompts/grade.ts";
import { BOOKING_BLOCK } from "./recapRules.ts";
import { todoItems } from "./todos.ts";
import { labelLines, parseTranscript } from "./transcript.ts";
import {
  adminActor,
  answer,
  booking,
  CEO_EMAIL,
  ceoActor,
  CLOSER_EMAIL,
  closerActor,
  CSM_EMAIL,
  csmActor,
  fakeDeps,
  fathomApi,
  keyRow,
  matchInputs,
  meeting,
  NOW,
  opOf,
  STAFF,
  storeItem,
  TEAM_EMAIL,
  tiedRpc,
} from "./testkit.ts";

const RESPONSE_ID = "44444444-4444-4444-8444-444444444444";
const TRANSCRIPT = [
  "[00:00:05] Csm Seat: Hello, thanks for joining.",
  "[00:00:12] Omar Testcontact: Thanks. We are happy, but we may pause the ads next month.",
  "[00:01:02] Team Member: I will send the new designs.",
  "[00:02:30] Omar Testcontact: I will send the logo files by Sunday.",
  "[00:03:10] Omar Testcontact: Happy to record a short review for you.",
].join("\n");
const SUMMARY = [
  "## Meeting Purpose",
  "Monthly check-in on the campaign, with 12 bookings.",
  "## Key Takeaways",
  "- **Client happy with the designs** ([01:02](https://fathom.video/share/TESTshareAAA1?tab=summary&timestamp=62))",
  "## Topics",
  "- Ads schedule for next month",
  "## Next Steps",
  "- [Send the logo files](https://fathom.video/share/TESTshareAAA1?tab=summary&timestamp=150)",
].join("\n");
const ACTION_ITEMS = [
  { description: "Send the new designs", assignee: { email: TEAM_EMAIL, name: "Team Member", team: null }, recording_timestamp: "00:01:02", completed: false },
  { description: "Send the logo files", assignee: { email: "owner@citywood.example", name: "Omar Testcontact", team: null }, recording_timestamp: "00:02:30", completed: false },
  { description: "Book the next shoot day", assignee: { email: null, name: "Omar Testcontact", team: null }, recording_timestamp: "00:00:12", completed: false },
  { description: "Check the spend plan", assignee: { email: null, name: "Someone Else", team: null }, recording_timestamp: "00:00:40", completed: false },
  { description: "An old promise", assignee: { email: CSM_EMAIL, name: "Csm Seat", team: "Customer Success" }, recording_timestamp: "00:00:05", completed: true },
];
const GRADE = {
  criteria: CRITERIA.map((name, i) => ({ name, score: (i % 3) + 6, note: `Note on ${name}.` })),
  overall: "A clear, warm call.",
  color: "Green",
};
const NOTES = {
  mood: { label: "happy", lines: [2, 99] },
  promises: [
    { who: "we", text: "Send the new designs", line: 3 },
    { who: "they", text: "Send the logo files", line: 4 },
    { who: "they", text: "A promise with no line", line: 77 },
  ],
  risks: [],
  testimonial: { offered: true, line: 5 },
  other: [],
};
const SUGGEST = { defcon: { value: "Happy", lines: [2], why: "Happy with the designs" }, priority: { value: "Low", lines: [4], why: "Nothing urgent" } };
const RECAP = { skip: false, message: "هلا! شكرًا على المكالمة اليوم.\n\nالمطلوب من جهتكم:\n- ترسلون ملفات الشعار" };

type Attempt = { id: string; kind: string; state: string; attempt: number; provider: string; promptVersion: string; inputSha256: string; model: string | null; reason: string | null; output: unknown; responseId: string | null };

/** The drafts table: begin returns the same input's draft, keeps one grade per call; finish settles; read gives the newest per kind. */
function world(o: {
  call?: unknown;
  state?: string;
  inputs?: Record<string, unknown>;
  /** The store item of the recording as cockpit_fathom_match_inputs lists it (the window's view). */
  item?: Record<string, unknown>;
  match?: Record<string, unknown>;
  keys?: string[];
  anthropic?: (prompt: string) => Response;
  deepseek?: () => Response;
  storage?: boolean;
  theyOwe?: unknown[];
  transcripts?: Record<string, unknown[]>;
  transcriptStatus?: number;
  /** Headers on the refused transcript read (retry-after, ratelimit-reset). */
  transcriptHeaders?: Record<string, string>;
  pages?: Record<string, unknown>[][];
  /** Whose response this is (the CSM's by default): the tie rule's rule 4 reads this seat. */
  seat?: typeof csmActor;
  /** Bookings the database holds that the window's MatchInputs leaves out (older than the window). */
  dbBookings?: Record<string, unknown>[];
} = {}) {
  const attempts: Attempt[] = [];
  const stored = storeItem({ startsAt: "2026-10-28T07:00:00.000Z", ...o.item });
  const matched = matchInputs({ store: [stored], ...o.match });
  const keys = new Set(o.keys ?? ["fathom", "deepseek", "anthropic"]);
  const prompts: { host: string; body: Record<string, any>; headers: Record<string, string> }[] = [];
  const newest = (kind: string, responseId?: string) =>
    attempts.filter(a => a.kind === kind && (kind !== "recap" || a.responseId === responseId)).at(-1);
  const view = (a: Attempt) => ({ kind: a.kind, state: a.state, attempt: a.attempt, provider: a.provider, model: a.model, promptVersion: a.promptVersion, at: "2026-10-28T09:00:00Z", reason: a.reason, output: a.kind === "grade" && a.output ? { score: (a.output as any).score, color: (a.output as any).color } : a.output });
  const fathom = fathomApi({
    pages: o.pages ?? [[meeting()]],
    summaries: { "194756343": SUMMARY },
    transcripts: o.transcripts ?? { "194756343": [{ speaker: { display_name: "Csm Seat" }, text: "Hello.", timestamp: "00:00:05" }] },
  });
  const f = fakeDeps({
    seat: {
      cockpit_form_responses_read: {
        response: {
          id: RESPONSE_ID,
          taskId: "86exCITYW",
          clientName: "City Wood",
          state: o.state ?? "draft",
          answers: { call: o.call ?? { kind: "fathom", recordingId: "194756343", why: "same_room", confirmed: true }, they_owe: o.theyOwe ?? [{ text: "Send the logo files" }] },
        },
        effects: [],
        drafts: [],
        now: "2026-10-28T09:00:00Z",
      },
      cockpit_form_drafts_read: () => ({ recordingId: "194756343", drafts: ["todos", "client_notes", "defcon_priority", "grade", "recap"].map(k => newest(k, RESPONSE_ID)).filter(Boolean).map(a => view(a as Attempt)), now: "x" }),
    },
    rpc: {
      cockpit_form_draft_inputs: {
        recordingId: "194756343",
        class: "candidate",
        gone: false,
        title: "Impromptu Google Meet Meeting",
        startsAt: "2026-10-28T07:00:00Z",
        endsAt: "2026-10-28T07:30:00Z",
        summary: SUMMARY,
        actionItems: ACTION_ITEMS,
        transcriptPath: o.storage === false ? null : "fathom/194756343.txt",
        shareUrl: "https://fathom.video/share/TESTshareAAA1",
        recorderEmail: CSM_EMAIL,
        recorderName: "Csm Seat",
        staff: STAFF,
        client: { taskId: "86exCITYW", name: "City Wood", stage: "Live", happiness: "Happy" },
        lastForm: { defcon: "Neutral", priority: "Medium", notes: "Asked for new designs.", at: "2026-10-14T08:00:00Z" },
        ...o.inputs,
      },
      cockpit_forms_key_get: (a: Record<string, any>) => (keys.has(a.p_provider) ? keyRow(a.p_provider) : null),
      cockpit_form_draft_begin: (a: Record<string, any>) => {
        const p = a.p;
        if (p.kind === "grade") {
          const g = attempts.find(x => x.kind === "grade" && (x.state === "ready" || x.state === "drafting"));
          if (g) return { id: g.id, existing: true, state: g.state, attempt: g.attempt };
        }
        const last = newest(p.kind, p.responseId);
        if (last && !p.again && last.inputSha256 === p.inputSha256 && (last.state === "ready" || last.state === "drafting"))
          return { id: last.id, existing: true, state: last.state, attempt: last.attempt };
        const counted = attempts.filter(x => x.kind === p.kind && (x.state === "ready" || x.state === "failed")).length;
        if (counted >= 5) throw new RpcError("Five drafts is the limit for this call.", "22023");
        const row: Attempt = { id: `draft-${attempts.length + 1}`, kind: p.kind, state: "drafting", attempt: (last?.attempt ?? 0) + 1, provider: p.provider, promptVersion: p.promptVersion, inputSha256: p.inputSha256, model: null, reason: null, output: null, responseId: p.responseId ?? null };
        attempts.push(row);
        return { id: row.id, existing: false, state: "drafting", attempt: row.attempt };
      },
      cockpit_form_draft_finish: (a: Record<string, any>) => {
        const row = attempts.find(x => x.id === a.p_id);
        if (row && row.state === "drafting") Object.assign(row, { state: a.p.state, output: a.p.output ?? null, model: a.p.model ?? null, reason: a.p.reason ?? null });
        return row ? view(row) : null;
      },
      cockpit_fathom_ingest: { ok: true, meetings: 1, calls: [] },
      cockpit_fathom_match_inputs: matched,
      cockpit_form_recordings_tied: tiedRpc({
        store: [stored],
        bookings: [...matched.bookings, ...(o.dbBookings ?? [])],
        formLinks: matched.formLinks,
        responses: { [RESPONSE_ID]: o.seat ?? csmActor },
      }),
      cockpit_csm_client_gate_for_actor: (a: Record<string, any>) => {
        if (a.p_task_id !== "86exCITYW") throw new RpcError("That client is not on your access list", "42501");
        return { taskId: a.p_task_id };
      },
    },
    storage: { "fathom/194756343.txt": TRANSCRIPT },
    routes: [
      (url, init) => {
        if (url.host !== "api.anthropic.com") return null;
        const body = JSON.parse(String(init.body));
        prompts.push({ host: url.host, body, headers: Object.fromEntries(new Headers(init.headers).entries()) });
        const p: string = body.messages[0].content;
        if (o.anthropic) return o.anthropic(p);
        const data = p.includes("Grading cadence") ? GRADE : p.includes("DEFCON, how the client feels") ? SUGGEST : RECAP;
        return answer({ model: "claude-opus-5-5", stop_reason: "end_turn", content: [{ type: "thinking", thinking: "" }, { type: "text", text: JSON.stringify(data) }], usage: { input_tokens: 10, output_tokens: 5 } });
      },
      (url, init) => {
        if (url.host !== "api.deepseek.com") return null;
        prompts.push({ host: url.host, body: JSON.parse(String(init.body)), headers: Object.fromEntries(new Headers(init.headers).entries()) });
        if (o.deepseek) return o.deepseek();
        return answer({ model: "deepseek-flash", choices: [{ finish_reason: "stop", message: { content: JSON.stringify(NOTES) } }], usage: { total_tokens: 9 } });
      },
      (url, init) => {
        if (o.transcriptStatus && url.host === "api.fathom.ai" && url.pathname.endsWith("/transcript")) return answer({}, o.transcriptStatus, o.transcriptHeaders ?? {});
        return fathom(url, init);
      },
    ],
  });
  return {
    f,
    attempts,
    prompts,
    keys,
    run: async (again: Parameters<typeof checkinDrafts>[2] = null, actor?: Parameters<typeof opOf>[1]) => {
      const out = await checkinDrafts(opOf(f.deps, actor), { responseId: RESPONSE_ID }, again);
      await f.drain();
      return out;
    },
    byKind: (kind: string) => attempts.filter(a => a.kind === kind),
    /** Move this world's clock to {minutes} after NOW. */
    at: (minutes: number) => {
      f.deps.now = () => new Date(NOW.getTime() + minutes * 60_000);
    },
    transcriptReads: () => f.sent.filter(r => r.url.includes("/recordings/194756343/transcript")).length,
  };
}

beforeEach(() => clearTranscriptCache());

describe("checkin.drafts: what is never drafted", () => {
  test("a call with no recording: every kind skipped with its sentence, nothing read or begun", async () => {
    for (const call of [{ kind: "booking", callId: 54462, why: "booking" }, { kind: "none", why: "none" }]) {
      const w = world({ call });
      const out = await w.run();
      expect(out.recordingId).toBeNull();
      expect(out.drafts.map(d => [d.kind, d.state, d.reason])).toEqual(["todos", "client_notes", "defcon_priority", "grade", "recap"].map(k => [k, "skipped", NO_RECORDING]));
      expect(w.f.service.calls).toHaveLength(0);
    }
  });

  test("a recording that is not a client call, or gone: every kind skipped", async () => {
    for (const inputs of [{ class: "internal" }, { class: "sales" }, { gone: true }]) {
      const w = world({ inputs });
      const out = await w.run();
      expect(out.drafts.every(d => d.state === "skipped" && d.reason === NOT_CLIENT_CALL)).toBe(true);
      expect(w.f.service.named("cockpit_form_draft_begin")).toHaveLength(0);
    }
  });

  test("the recap of a draft response is answered after-send and never begun; draftAgain of it is refused", async () => {
    const w = world();
    const out = await w.run();
    expect(out.drafts.find(d => d.kind === "recap")).toMatchObject({ state: "skipped", reason: RECAP_AFTER_SEND, attempt: 0 });
    expect(w.byKind("recap")).toHaveLength(0);
    await expect(checkinDrafts(opOf(w.f.deps), { responseId: RESPONSE_ID }, "recap")).rejects.toThrow(RECAP_AFTER_SEND);
  });

  test("no summary yet: the four summary kinds wait (no row), todos does not", async () => {
    const w = world({ inputs: { summary: null } });
    w.f.deps.fetch = (async () => answer({ summary: null })) as typeof fetch;
    const out = await w.run();
    for (const k of ["client_notes", "defcon_priority", "grade"]) expect(out.drafts.find(d => d.kind === k)).toMatchObject({ state: "skipped", reason: SUMMARY_WAIT });
    expect(w.attempts.map(a => a.kind)).toEqual(["todos"]);
    expect(out.drafts.find(d => d.kind === "todos")?.state).toBe("ready");
    expect(out.started).toEqual(["todos"]);
  });

  test("no summary in the store: one heavy summary read, written back through the pull's merge", async () => {
    const w = world({ inputs: { summary: null } });
    const out = await w.run();
    expect(w.f.sent.filter(r => r.url.includes("/recordings/194756343/summary"))).toHaveLength(1);
    const back = w.f.service.named("cockpit_fathom_ingest");
    expect(back).toHaveLength(1);
    expect(back[0].args.p_via).toBe("pull");
    expect((back[0].args.p_items as any[])[0]).toMatchObject({ call: null, meeting: { recording_id: "194756343", summary: SUMMARY } });
    expect(out.drafts.find(d => d.kind === "client_notes")?.state).toBe("ready");
  });
});

describe("checkin.drafts: keys and begin", () => {
  test("no key: off with its sentence, begun once; a second open adds no row", async () => {
    const w = world({ keys: ["fathom"] });
    const first = await w.run();
    expect(first.drafts.find(d => d.kind === "client_notes")).toMatchObject({ state: "off", reason: OFF.deepseek });
    expect(first.drafts.find(d => d.kind === "defcon_priority")).toMatchObject({ state: "off", reason: OFF.anthropic });
    expect(first.drafts.find(d => d.kind === "grade")).toMatchObject({ state: "off", reason: OFF.anthropic });
    expect(w.attempts.filter(a => a.state === "off").map(a => a.kind)).toEqual(["client_notes", "defcon_priority", "grade"]);
    const begins = w.f.service.named("cockpit_form_draft_begin").length;
    await w.run();
    expect(w.f.service.named("cockpit_form_draft_begin").length - begins).toBe(1);
    expect(w.f.service.named("cockpit_form_draft_begin").at(-1)?.args.p.kind).toBe("todos");
    expect(w.prompts).toHaveLength(0);
  });

  test("begin gets the seat's email, the kind's provider and version, the input hash, and the response only for the recap", async () => {
    const w = world();
    await w.run();
    const begins = w.f.service.named("cockpit_form_draft_begin").map(c => c.args.p);
    expect(begins.map(p => [p.kind, p.provider, p.promptVersion])).toEqual([
      ["todos", "none", "checkin.todos.v2"],
      ["client_notes", "deepseek", "checkin.client_notes.v1"],
      ["defcon_priority", "anthropic", "checkin.defcon_priority.v1"],
      ["grade", "anthropic", "checkin.grade.v1"],
    ]);
    for (const p of begins) {
      expect(p).toMatchObject({ formKey: "checkin", taskId: "86exCITYW", recordingId: "194756343", again: false, actorEmail: CSM_EMAIL });
      expect(p.inputSha256).toMatch(/^[0-9a-f]{64}$/);
      expect("responseId" in p).toBe(false);
    }
    const finishes = w.f.service.named("cockpit_form_draft_finish");
    expect(finishes.every(c => c.args.p.actorEmail === CSM_EMAIL)).toBe(true);
  });

  test("the same input returns the drafts already made: no second model call; a changed Client Happiness redrafts the suggestions only", async () => {
    const w = world();
    await w.run();
    const calls = w.prompts.length;
    await w.run();
    expect(w.prompts.length).toBe(calls);
    (w.f.service.handlers.cockpit_form_draft_inputs as Record<string, any>).client.happiness = "At Risk";
    await w.run();
    const again = w.prompts.slice(calls).map(p => (p.host === "api.deepseek.com" ? "client_notes" : p.body.messages[0].content.includes("Grading cadence") ? "grade" : "defcon_priority"));
    expect(again.sort()).toEqual(["client_notes", "defcon_priority"]);
  });

  test("the input hash: canonical, and it moves with the summary, the transcript, the action items and the sent They owe", async () => {
    expect(canonical({ b: 1, a: [{ d: 2, c: 3 }] })).toBe('{"a":[{"c":3,"d":2}],"b":1}');
    const base = { recordingId: "1", taskId: "t", summary: "s", transcript: "x", lines: [], actionItems: [], share: null, staff: [], client: { name: "City Wood", stage: null, happiness: null }, lastForm: null, sections: summarySections(null), theyOwe: ["a"] };
    const h = async (k: Parameters<typeof inputOf>[0], over: Record<string, unknown> = {}) => sha256(canonical(inputOf(k, { ...base, ...over } as any)));
    expect(await h("todos")).toBe(await h("todos"));
    expect(await h("todos", { summary: "t" })).not.toBe(await h("todos"));
    expect(await h("todos", { transcript: "y" })).not.toBe(await h("todos"));
    expect(await h("todos", { actionItems: [{}] })).not.toBe(await h("todos"));
    expect(await h("recap", { theyOwe: ["b"] })).not.toBe(await h("recap"));
    expect(await h("grade", { theyOwe: ["b"] })).toBe(await h("grade"));
    expect(inputOf("recap", base as any).extra).toEqual({ theyOwe: ["a"], client: "City Wood" });
    expect(inputOf("grade", base as any).extra).toEqual({});
  });

  test("a call is graded once: an existing grade (any client) is never asked again, and draftAgain of a grade is refused", async () => {
    const w = world();
    await w.run();
    const grades = w.prompts.filter(p => p.body.messages?.[0]?.content?.includes("Grading cadence")).length;
    expect(grades).toBe(1);
    await w.run("client_notes");
    expect(w.prompts.filter(p => p.body.messages?.[0]?.content?.includes("Grading cadence")).length).toBe(1);
    await expect(checkinDrafts(opOf(w.f.deps), { responseId: RESPONSE_ID }, "grade")).rejects.toThrow("A call is graded once.");
  });

  test("draftAgain starts the next attempt of that kind only", async () => {
    const w = world();
    await w.run();
    await w.run("client_notes");
    expect(w.byKind("client_notes").map(a => a.attempt)).toEqual([1, 2]);
    expect(w.byKind("defcon_priority")).toHaveLength(1);
  });

  test("the five-attempt limit: Draft again says so; an open whose input changed shows it only when no draft stands", async () => {
    const w = world();
    for (let i = 0; i < 5; i++) await w.run("client_notes");
    await expect(w.run("client_notes")).rejects.toThrow("Five drafts is the limit for this call.");
    const failing = world({ deepseek: () => answer({}, 500) });
    for (let i = 0; i < 5; i++) await failing.run("client_notes");
    (failing.f.service.handlers.cockpit_form_draft_inputs as Record<string, any>).summary = `${SUMMARY}\n- one more line`;
    const out = await failing.run();
    expect(out.drafts.find(d => d.kind === "client_notes")).toMatchObject({ state: "skipped", reason: "Five drafts is the limit for this call." });
    expect(out.drafts.find(d => d.kind === "todos")?.state).toBe("ready");
  });
});

describe("checkin.drafts: the model requests", () => {
  test("one provider per draft: the client notes on DeepSeek, the rest on Anthropic; DeepSeek never gets a grade or a recap", async () => {
    const w = world({ state: "submitted" });
    w.f.seat.handlers.cockpit_form_responses_read = { ...(w.f.seat.handlers.cockpit_form_responses_read as object), response: { ...(w.f.seat.handlers.cockpit_form_responses_read as any).response, state: "draft" } };
    await w.run();
    const sent = world({ state: "submitted" });
    await sent.run();
    for (const p of [...w.prompts, ...sent.prompts].filter(x => x.host === "api.deepseek.com")) {
      expect(p.body.messages[1].content).toContain("internal client notes");
      expect(p.body.messages[1].content).not.toContain("Grading cadence");
      expect(p.body.messages[1].content).not.toContain("WhatsApp message");
    }
    expect(w.prompts.filter(p => p.host === "api.deepseek.com")).toHaveLength(1);
    expect(sent.prompts.filter(p => p.host === "api.deepseek.com")).toHaveLength(0);
  });

  test("Anthropic bodies: claude-opus-5-5, effort, fallbacks default with its beta header, no temperature or other sampling field", async () => {
    const w = world({ state: "submitted" });
    await w.run();
    const anthropic = w.prompts.filter(p => p.host === "api.anthropic.com");
    expect(anthropic).toHaveLength(2);
    for (const p of anthropic) {
      expect(p.body.model).toBe("claude-opus-5-5");
      expect(p.body.fallbacks).toBe("default");
      expect(p.headers["anthropic-beta"]).toBe("server-side-fallback-2026-07-01");
      expect(p.body.output_config.effort).toBe("medium");
      expect(p.body.output_config.format.type).toBe("json_schema");
      for (const k of ["temperature", "top_p", "top_k", "thinking"]) expect(k in p.body).toBe(false);
    }
    const draft = world();
    await draft.run();
    const suggestion = draft.prompts.find(p => p.body.messages?.[0]?.content?.includes("DEFCON, how the client feels"));
    expect(suggestion?.body.output_config.effort).toBe("low");
    expect(suggestion?.body.fallbacks).toBe("default");
    expect(suggestion?.headers["anthropic-beta"]).toBe("server-side-fallback-2026-07-01");
    expect("temperature" in (suggestion?.body ?? {})).toBe(false);
  });

  test("DeepSeek: deepseek-flash, max_tokens 4000; every draft's receipts are under draft:{id}", async () => {
    const w = world();
    await w.run();
    const ds = w.prompts.find(p => p.host === "api.deepseek.com");
    expect(ds?.body.model).toBe("deepseek-flash");
    expect(ds?.body.max_tokens).toBe(4000);
    const modelRows = w.f.health.filter(r => r.provider === "deepseek" || r.provider === "anthropic");
    expect(modelRows.length).toBeGreaterThan(0);
    expect(modelRows.every(r => /^draft:draft-\d+$/.test(String(r.run_key)) && r.action_id === null)).toBe(true);
    expect(modelRows.map(r => r.resource)).toContain("api.deepseek.com");
  });

  test("a refusal, a cut-off and a timeout fail with their sentences", async () => {
    const cases: [() => Response, string][] = [
      [() => answer({ model: "claude-opus-5-5", stop_reason: "refusal", stop_details: { type: "refusal", category: null }, content: [] }), FAILED.refused],
      [() => answer({ model: "claude-opus-5-5", stop_reason: "max_tokens", content: [{ type: "text", text: '{"defcon":' }] }), FAILED.cut],
      [
        () => {
          throw new DOMException("The operation timed out.", "TimeoutError");
        },
        FAILED.timeout,
      ],
    ];
    for (const [respond, sentence] of cases) {
      const w = world({ anthropic: respond });
      await w.run();
      expect(w.byKind("defcon_priority")[0]).toMatchObject({ state: "failed", reason: sentence });
    }
    expect(cases.map(c => c[1])).toEqual(["The model declined this call. Fill this by hand.", "The draft was cut off. Draft again.", "The draft took too long. Draft again."]);
  });
});

describe("checkin.drafts: the checks before ready", () => {
  test("DEFCON and priority: the quote, its time and link come from the cited line, never the model", async () => {
    const w = world();
    await w.run();
    const s = w.byKind("defcon_priority")[0].output as Record<string, any>;
    expect(s.defcon).toEqual({ value: "Happy", quote: "Thanks. We are happy, but we may pause the ads next month.", at: 12, href: "https://fathom.video/share/TESTshareAAA1?tab=summary&timestamp=12", why: "Happy with the designs" });
    expect(s.priority).toMatchObject({ value: "Low", quote: "I will send the logo files by Sunday.", at: 150 });
  });

  test("Paused needs the card's pause or a quote that names one; a suggestion with no line becomes null", async () => {
    const respond = (data: unknown) => () => answer({ model: "claude-opus-5-5", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(data) }] });
    const quiet = world({ anthropic: respond({ defcon: { value: "Paused", lines: [3], why: "x" }, priority: { value: "911", lines: [404], why: "y" } }) });
    await quiet.run();
    expect(quiet.byKind("defcon_priority")[0]).toMatchObject({ output: { defcon: null, priority: null }, reason: "No clear quote. Pick it yourself." });
    const named = world({ anthropic: respond({ defcon: { value: "Paused", lines: [2], why: "pause" }, priority: null }) });
    await named.run();
    expect((named.byKind("defcon_priority")[0].output as any).defcon.value).toBe("Paused");
    const card = world({ inputs: { client: { taskId: "86exCITYW", name: "City Wood", stage: "Paused", happiness: null } }, anthropic: respond({ defcon: { value: "Churned", lines: [3], why: "x" }, priority: null }) });
    await card.run();
    expect((card.byKind("defcon_priority")[0].output as any).defcon.value).toBe("Churned");
  });

  test("the grade: twelve criteria exactly once, their mean in code, one decimal; a missing one fails", async () => {
    const w = world();
    await w.run();
    const g = w.byKind("grade")[0];
    const out = g.output as Record<string, any>;
    expect(out.criteria.map((c: any) => c.name)).toEqual([...CRITERIA]);
    expect(out.score).toBe(Math.round((GRADE.criteria.reduce((s, c) => s + c.score, 0) / 12) * 10) / 10);
    expect(out.color).toBe("Green");
    const short = world({ anthropic: p => answer({ model: "claude-opus-5-5", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(p.includes("Grading cadence") ? { ...GRADE, criteria: GRADE.criteria.slice(1) } : SUGGEST) }] }) });
    await short.run();
    expect(short.byKind("grade")[0]).toMatchObject({ state: "failed", reason: "The grade came back without its twelve parts." });
  });

  test("the client notes: lines checked, an uncited promise dropped, risk talk flagged when no risk came back", async () => {
    const w = world();
    await w.run();
    const n = w.byKind("client_notes")[0].output as Record<string, any>;
    expect(n.mood).toEqual({ label: "happy", lines: [2] });
    expect(n.promises.map((p: any) => p.text)).toEqual(["Send the new designs", "Send the logo files"]);
    expect(n.testimonial).toEqual({ offered: true, line: 5 });
    expect(n.other).toEqual(["Possible risk talk at 00:00:12, check it."]);
    expect(n.text).toBe(
      ["Mood: happy.", "We promised: Send the new designs (00:01:02).", "They promised: Send the logo files (00:02:30).", "Testimonial: offered (00:03:10).", "Possible risk talk at 00:00:12, check it."].join("\n"),
    );
    expect(n.text).not.toContain("Omar");
  });

  test("after the send the recap is begun for this response, written from the sent They owe, never Fathom's raw items", async () => {
    const w = world({ state: "submitted", theyOwe: [{ text: "ترسلون ملفات الشعار" }] });
    const out = await w.run();
    const begin = w.f.service.named("cockpit_form_draft_begin").map(c => c.args.p).find(p => p.kind === "recap");
    expect(begin).toMatchObject({ responseId: RESPONSE_ID, provider: "anthropic", promptVersion: "checkin.recap.v1" });
    const recapPrompt = w.prompts.find(p => p.body.messages[0].content.includes("WhatsApp message"))?.body.messages[0].content as string;
    expect(recapPrompt).toContain("ترسلون ملفات الشعار");
    expect(recapPrompt).not.toContain("Send the logo files");
    expect(recapPrompt).not.toContain("Book the next shoot day");
    expect(recapPrompt).not.toContain("12 bookings");
    expect(recapPrompt).not.toContain("Asked for new designs.");
    expect(out.drafts.map(d => d.kind)).toContain("recap");
    const recap = w.byKind("recap")[0];
    expect(recap.state).toBe("ready");
    expect((recap.output as any).checks.every((c: any) => c.ok)).toBe(true);
    const finish = w.f.service.named("cockpit_form_draft_finish").find(c => c.args.p_id === recap.id);
    expect(finish?.args.p.text).toBe(`${RECAP.message}\n\n${BOOKING_BLOCK}`);
    expect(w.byKind("todos")).toHaveLength(0);
  });

  test("a recap that quotes a figure is stored failed with its rule's sentence", async () => {
    const w = world({ state: "submitted", anthropic: p => answer({ model: "claude-opus-5-5", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(p.includes("Grading cadence") ? GRADE : { skip: false, message: "صرفنا ٥٠٠ دولار هالشهر" }) }] }) });
    await w.run();
    expect(w.byKind("recap")[0]).toMatchObject({ state: "failed", reason: "The recap quoted a money figure. Client messages carry no amounts. Draft again." });
  });

  test("a recap the model skips is stored skipped with Nothing worth sending", async () => {
    const w = world({ state: "submitted", anthropic: p => answer({ model: "claude-opus-5-5", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(p.includes("Grading cadence") ? GRADE : { skip: true, message: "" }) }] }) });
    await w.run();
    expect(w.byKind("recap")[0]).toMatchObject({ state: "skipped", reason: "Nothing worth sending from this call." });
  });

  test("the transcript comes from Fathom when none is stored (read once, never stored) and labels keep names out of prompts", async () => {
    const w = world({ storage: false });
    await w.run();
    expect(w.f.sent.filter(r => r.url.includes("/recordings/194756343/transcript"))).toHaveLength(1);
    const prompts = w.prompts.map(p => JSON.stringify(p.body));
    expect(prompts.every(p => !p.includes("Csm Seat"))).toBe(true);
    const stored = world();
    await stored.run();
    expect(stored.f.sent.filter(r => r.url.includes("/transcript"))).toHaveLength(0);
    expect(stored.prompts.map(p => JSON.stringify(p.body)).join("").includes("Omar Testcontact")).toBe(false);
    expect(stored.prompts.map(p => JSON.stringify(p.body)).join("")).toContain("L2 [00:00:12] Client:");
  });
});

describe("We owe / They owe (todos.ts through the drafts)", () => {
  const lines = labelLines(parseTranscript(TRANSCRIPT), { recorderEmail: CSM_EMAIL, recorderName: "Csm Seat", staff: STAFF });
  const bundle = { recordingId: "194756343", taskId: "86exCITYW", summary: SUMMARY, transcript: TRANSCRIPT, lines, actionItems: ACTION_ITEMS, share: "https://fathom.video/share/TESTshareAAA1", staff: STAFF, client: { name: "City Wood", stage: null, happiness: null }, lastForm: null, sections: summarySections(SUMMARY), theyOwe: [] };

  test("sides by email, team and speaker; owner from the staff role; a name off the staff list is theirs, unsure; completed dropped; the href shape", () => {
    const out = todosOutput(bundle as any) as { items: Record<string, unknown>[]; nextSteps: Record<string, unknown>[] };
    expect(out.items).toEqual([
      { side: "we", text: "Send the new designs", owner: "the creative director", at: 62, href: "https://fathom.video/share/TESTshareAAA1?tab=summary&timestamp=62", unsure: false },
      { side: "they", text: "Send the logo files", owner: null, at: 150, href: "https://fathom.video/share/TESTshareAAA1?tab=summary&timestamp=150", unsure: false },
      { side: "they", text: "Book the next shoot day", owner: null, at: 12, href: "https://fathom.video/share/TESTshareAAA1?tab=summary&timestamp=12", unsure: false },
      { side: "they", text: "Check the spend plan", owner: null, at: 40, href: "https://fathom.video/share/TESTshareAAA1?tab=summary&timestamp=40", unsure: true },
    ]);
    expect(out.nextSteps).toEqual([{ text: "Send the logo files", at: 150, href: "https://fathom.video/share/TESTshareAAA1?tab=summary&timestamp=150" }]);
  });

  test("a team assignee is ours whatever the email; the replay's call has no sideOfName", () => {
    const items = todoItems(
      [
        { description: "Fix the landing page", assigneeEmail: null, assigneeName: "Csm Seat", assigneeTeam: "Customer Success", seconds: 5, playbackUrl: null, completed: false },
        { description: "Approve the copy", assigneeEmail: null, assigneeName: "Omar Testcontact", assigneeTeam: null, seconds: null, playbackUrl: null, completed: false },
      ],
      { shareUrl: null, staff: STAFF },
    );
    expect(items.map(i => [i.side, i.unsure, i.href])).toEqual([
      ["we", false, null],
      ["they", true, null],
    ]);
  });

  /** One name-only item (no email, no team) as Fathom lists it. */
  const named = (assigneeName: string | null, description = "Share the stock list") =>
    ({ description, assigneeEmail: null, assigneeName, assigneeTeam: null, seconds: 30, playbackUrl: null, completed: false });

  test("a staff member's full name is ours and sure; the owner stays empty for the CSM to fill", () => {
    const items = todoItems([named("Team Member"), named("csm seat", "Book the shoot")], { shareUrl: null, staff: STAFF });
    expect(items.map(i => [i.text, i.side, i.unsure, i.owner])).toEqual([
      ["Share the stock list", "we", false, null],
      ["Book the shoot", "we", false, null],
    ]);
  });

  test("a staff first name alone is ours; a name sharing only a surname is not", () => {
    const items = todoItems([named("Ceo"), named("Other Seat")], { shareUrl: null, staff: STAFF });
    expect(items.map(i => [i.side, i.unsure])).toEqual([
      ["we", false],
      ["they", true],
    ]);
  });

  test("Fathom's unnamed speaker (Speaker 2) with no transcript is not on the staff list: theirs, unsure, so the window asks", () => {
    const items = todoItems([named("Speaker 2")], { shareUrl: null, staff: STAFF });
    expect(items.map(i => [i.text, i.side, i.unsure])).toEqual([["Share the stock list", "they", true]]);
  });

  test("Fathom's unnamed speaker who speaks in the transcript is still unsure: the drafts' own path asks Who owes this?", () => {
    // The transcript labels every speaker it cannot place Client, and an in-room call can put our staff under
    // "Speaker 2", so a placeholder never takes a firm side from it. A real name the transcript knows still does.
    const transcript = [
      "[00:00:01] Csm Seat: Hello.",
      "[00:00:05] Speaker 2: I will share the stock list.",
      "[00:00:09] Speaker: Thanks.",
      "[00:00:20] Omar Testcontact: And I will approve the copy.",
    ].join("\n");
    const spoken = labelLines(parseTranscript(transcript), { recorderEmail: CSM_EMAIL, recorderName: "Csm Seat", staff: STAFF });
    expect(spoken.map(l => [l.speaker, l.label])).toEqual([["Csm Seat", "CSM"], ["Speaker 2", "Client"], ["Speaker", "Client"], ["Omar Testcontact", "Client"]]);
    const fathom = (description: string, name: string, stamp: string) =>
      ({ description, assignee: { email: null, name, team: null }, recording_timestamp: stamp, completed: false });
    const out = todosOutput({
      ...bundle,
      transcript,
      lines: spoken,
      actionItems: [
        fathom("Share the stock list", "Speaker 2", "00:00:05"),
        fathom("Send the price sheet", "speaker  3", "00:00:07"),
        fathom("Confirm the date", "Speaker", "00:00:09"),
        fathom("Approve the copy", "Omar Testcontact", "00:00:20"),
      ],
    } as any) as { items: Record<string, unknown>[] };
    expect(out.items.map(i => [i.text, i.side, i.unsure])).toEqual([
      ["Share the stock list", "they", true],
      ["Send the price sheet", "they", true],
      ["Confirm the date", "they", true],
      ["Approve the copy", "they", false],
    ]);
    // A name that only starts with the word stays a name: the transcript or the staff list decides it.
    const sideOfName = (name: string) => (name === "Speakerman Two" ? ("we" as const) : null);
    expect(todoItems([named("Speakerman Two"), named("Speaker 2")], { shareUrl: null, staff: STAFF, sideOfName }).map(i => [i.side, i.unsure])).toEqual([
      ["we", false],
      ["they", true],
    ]);
  });

  test("no name at all stays ours and unsure; an empty or blank name counts as none", () => {
    const items = todoItems([named(null), named("   "), named("")], { shareUrl: null, staff: STAFF });
    expect(items.map(i => [i.side, i.unsure])).toEqual([
      ["we", true],
      ["we", true],
      ["we", true],
    ]);
  });

  test("the transcript wins over the staff list, both ways", () => {
    const sideOfName = (name: string) => (name === "Team Member" ? ("they" as const) : name === "Omar Testcontact" ? ("we" as const) : null);
    const items = todoItems([named("Team Member"), named("Omar Testcontact"), named("Someone Else")], { shareUrl: null, staff: STAFF, sideOfName });
    expect(items.map(i => [i.side, i.unsure])).toEqual([
      ["they", false],
      ["we", false],
      ["they", true],
    ]);
  });

  test("nothing invented or dropped: every open item stays one line in Fathom's words, emails and teams as before", () => {
    const items = todoItems(
      [
        { description: "Send the invoice", assigneeEmail: "Seat@MaharaMedia.com", assigneeName: "Somebody New", assigneeTeam: null, seconds: 1, playbackUrl: null, completed: false },
        { description: "Pay the invoice", assigneeEmail: "owner@citywood.example", assigneeName: "Team Member", assigneeTeam: null, seconds: 2, playbackUrl: null, completed: false },
        named("Omar Testcontact", "  Approve   the copy  "),
        { ...named("Omar Testcontact", "Done already"), completed: true },
      ],
      { shareUrl: null, staff: STAFF },
    );
    expect(items.map(i => [i.text, i.side, i.unsure])).toEqual([
      ["Send the invoice", "we", false],
      ["Pay the invoice", "they", false],
      ["Approve the copy", "they", true],
    ]);
  });

  test("the to-dos rule is version 2", () => {
    expect(TODOS_VERSION).toBe("checkin.todos.v2");
  });

  test("summary lines: links become their words, timestamps leave, the section headings in English or Arabic", () => {
    expect(bullet("**Client happy with the designs** ([01:02](https://fathom.video/share/X?tab=summary&timestamp=62))")).toEqual({ text: "Client happy with the designs", at: 62 });
    const ar = summarySections(["## أبرز النقاط", "- العميل مرتاح [00:10](https://fathom.video/share/X?tab=summary&timestamp=10)", "## الخطوات التالية", "- إرسال الملفات"].join("\n"));
    expect(ar.takeaways).toEqual([{ text: "العميل مرتاح", at: 10 }]);
    expect(ar.nextSteps).toEqual([{ text: "إرسال الملفات", at: null }]);
    expect(summarySections(SUMMARY).purpose).toEqual([{ text: "Monthly check-in on the campaign, with 12 bookings.", at: null }]);
  });
});

// ---------------------------------------------------------------- the review's cases (Stage 2a round 2)

describe("checkin.drafts: a recording the notes cannot use is never read", () => {
  /** The CEO's recording, team Sales, read as a client call because the sales desk has not indexed it yet. */
  const sales = { recorderEmail: CEO_EMAIL, recorderTeam: "Sales", class: "client", title: "Pricing call", meetingTitle: "Pricing call", inviteeEmails: [CEO_EMAIL, "buyer@prospect.example"] };

  test("from outside Customer Success with nothing that ties it to this client: every kind skipped, nothing read, begun or sent to a model", async () => {
    const w = world({ inputs: { recorderEmail: CEO_EMAIL, class: "client", summary: null, transcriptPath: null }, item: sales });
    const out = await w.run();
    expect(out.drafts.map(d => [d.kind, d.state, d.reason])).toEqual(["todos", "client_notes", "defcon_priority", "grade", "recap"].map(k => [k, "skipped", OUTSIDE_CS]));
    expect(w.f.service.named("cockpit_form_draft_begin")).toHaveLength(0);
    expect(w.f.service.named("cockpit_forms_key_get")).toHaveLength(0);
    expect(w.f.sent).toHaveLength(0);
    expect(w.prompts).toHaveLength(0);
    // The window's own read: since 00:00 Kuwait yesterday, for this client.
    expect(w.f.service.named("cockpit_fathom_match_inputs")[0].args).toEqual({ p_from: "2026-10-26T21:00:00.000Z", p_to: "2026-10-28T09:00:00.000Z", p_task_id: "86exCITYW" });
  });

  test("a seat that may place it itself (the CEO who recorded it, an admin) drafts the call it pasted on its own notes; the CSM's seat never does", async () => {
    const call = { kind: "fathom", recordingId: "194756343", why: "pasted", confirmed: true };
    for (const actor of [ceoActor, adminActor]) {
      const w = world({ call, inputs: { recorderEmail: CEO_EMAIL, class: "client" }, item: sales, seat: actor });
      const out = await w.run(null, actor);
      expect(out.started).toEqual(["todos", "client_notes", "defcon_priority", "grade"]);
      // Asked about the response's own seat, never the one asking.
      expect(w.f.service.named("cockpit_form_recordings_tied").map(c => c.args)).toEqual([
        { p_recording_ids: ["194756343"], p_task_id: "86exCITYW", p_actor: null, p_response_id: RESPONSE_ID },
      ]);
    }
    const csm = world({ call, inputs: { recorderEmail: CEO_EMAIL, class: "client" }, item: sales });
    const out = await csm.run();
    expect(out.drafts.every(d => d.state === "skipped" && d.reason === OUTSIDE_CS)).toBe(true);
    expect(csm.prompts).toHaveLength(0);
    // The save's own refusals hold for every seat: a recording the sales desk has since indexed is not drafted.
    const indexed = world({ call, inputs: { recorderEmail: CEO_EMAIL, class: "sales" }, item: { ...sales, class: "sales" }, seat: ceoActor });
    expect((await indexed.run(null, ceoActor)).drafts.every(d => d.state === "skipped" && d.reason === NOT_CLIENT_CALL)).toBe(true);
    expect(indexed.f.service.named("cockpit_form_recordings_tied")).toHaveLength(0);
  });

  test("the CEO asking for drafts on the CSM's notes, whose saved call no rule ties for her, is refused with the sentence", async () => {
    const call = { kind: "fathom", recordingId: "194756343", why: "pasted", confirmed: true };
    const w = world({ call, inputs: { recorderEmail: CEO_EMAIL, class: "client" }, item: sales });
    const out = await w.run(null, ceoActor);
    expect(out.drafts.map(d => [d.kind, d.state, d.reason])).toEqual(["todos", "client_notes", "defcon_priority", "grade", "recap"].map(k => [k, "skipped", OUTSIDE_CS]));
    expect(w.f.service.named("cockpit_form_draft_begin")).toHaveLength(0);
    expect(w.prompts).toHaveLength(0);
  });

  test("a title alone never ties it: skipped with the sentence for the CSM, drafted for the CEO and an admin on their own notes; on this client in the store, drafted for the CSM", async () => {
    const titled = { ...sales, title: "City Wood weekly review" };
    const csm = world({ inputs: { recorderEmail: CEO_EMAIL, class: "client" }, item: titled });
    const out = await csm.run();
    expect(out.drafts.map(d => [d.kind, d.state, d.reason])).toEqual(["todos", "client_notes", "defcon_priority", "grade", "recap"].map(k => [k, "skipped", OUTSIDE_CS]));
    expect(csm.prompts.filter(p => p.host === "api.deepseek.com")).toHaveLength(0);
    expect(csm.f.service.named("cockpit_form_draft_begin")).toHaveLength(0);
    for (const actor of [ceoActor, adminActor]) {
      const w = world({ inputs: { recorderEmail: CEO_EMAIL, class: "client" }, item: titled, seat: actor });
      expect((await w.run(null, actor)).started).toEqual(["todos", "client_notes", "defcon_priority", "grade"]);
    }
    const placed = world({ inputs: { recorderEmail: CEO_EMAIL, class: "client" }, item: { ...sales, onTask: "86exCITYW", onTaskMethod: "manual" } });
    expect((await placed.run()).started).toEqual(["todos", "client_notes", "defcon_priority", "grade"]);
    // Its call row settles it (rule 2): the database is not asked.
    expect(placed.f.service.named("cockpit_form_recordings_tied")).toHaveLength(0);
  });

  test("the database's rule sees every booking: an invitee on this client's booking three days before the window drafts for the CSM; one on two clients' bookings ties it for each card and drafts here too (A7.14 rule 3)", async () => {
    const invited = { ...sales, inviteeEmails: [CEO_EMAIL, "owner@citywood.example"] };
    const old = world({ inputs: { recorderEmail: CEO_EMAIL, class: "client" }, item: invited, dbBookings: [booking({ id: 54001, startsAt: "2026-10-23T09:00:00.000Z" })] });
    expect((await old.run()).started).toEqual(["todos", "client_notes", "defcon_priority", "grade"]);
    // The invitee clause has no other-card condition: the same address on Marble 10-12's booking takes nothing from City Wood.
    const both = [
      booking({ id: 54002, startsAt: "2026-10-27T05:00:00.000Z" }),
      booking({ id: 54003, taskId: "86exMARBL", clientName: "Marble 10-12", startsAt: "2026-10-27T06:00:00.000Z" }),
    ];
    const two = world({ inputs: { recorderEmail: CEO_EMAIL, class: "client" }, item: invited, dbBookings: both });
    expect((await two.run()).started).toEqual(["todos", "client_notes", "defcon_priority", "grade"]);
    expect(two.f.service.named("cockpit_form_recordings_tied").map(c => c.args)).toEqual([
      { p_recording_ids: ["194756343"], p_task_id: "86exCITYW", p_actor: null, p_response_id: RESPONSE_ID },
    ]);
    // On the other client's booking alone, the address is no sign for this one: the CSM's notes are not drafted.
    const theirs = world({ inputs: { recorderEmail: CEO_EMAIL, class: "client" }, item: invited, dbBookings: [both[1]] });
    expect((await theirs.run()).drafts.every(d => d.state === "skipped" && d.reason === OUTSIDE_CS)).toBe(true);
    expect(theirs.prompts).toHaveLength(0);
    // With no booking at all, the same CSM's notes are not drafted.
    const none = world({ inputs: { recorderEmail: CEO_EMAIL, class: "client" }, item: invited });
    expect((await none.run()).drafts.every(d => d.state === "skipped" && d.reason === OUTSIDE_CS)).toBe(true);
  });

  test("a closer's call the worker put on this card by a name (0.6) or a company domain (0.8) is held to rules 1, 3 and 4 (round 3): skipped with OUTSIDE_CS_LIKELY for the CSM (round 4), nothing read, begun or sent to a model; drafted for the CEO, an admin and its recorder on their own notes; on no card, OUTSIDE_CS", async () => {
    const kinds = ["todos", "client_notes", "defcon_priority", "grade", "recap"];
    const inputs = { recorderEmail: CLOSER_EMAIL, class: "client" };
    const placed = [
      { onTask: "86exCITYW", onTaskMethod: "name", onTaskConfidence: 0.6, title: "City Wood pricing review" },
      { onTask: "86exCITYW", onTaskMethod: "invitee_email", onTaskConfidence: 0.8, inviteeEmails: [CLOSER_EMAIL, "buyer@citywood.example"] },
    ];
    for (const how of placed) {
      const item = { ...sales, recorderEmail: CLOSER_EMAIL, ...how };
      const csm = world({ inputs, item });
      const out = await csm.run();
      expect([how.onTaskMethod, out.drafts.map(d => [d.kind, d.state, d.reason])]).toEqual([how.onTaskMethod, kinds.map(k => [k, "skipped", OUTSIDE_CS_LIKELY])]);
      expect(out.started).toEqual([]);
      expect(csm.f.service.named("cockpit_form_draft_begin")).toHaveLength(0);
      expect(csm.f.service.named("cockpit_forms_key_get")).toHaveLength(0);
      expect(csm.f.sent).toHaveLength(0);
      expect(csm.prompts).toHaveLength(0);
      // Its row on this card does not settle it (rule 2): the database is asked for the response's own seat.
      expect(csm.f.service.named("cockpit_form_recordings_tied").map(c => c.args)).toEqual([
        { p_recording_ids: ["194756343"], p_task_id: "86exCITYW", p_actor: null, p_response_id: RESPONSE_ID },
      ]);
      for (const actor of [ceoActor, adminActor, closerActor]) {
        const w = world({ inputs, item, seat: actor });
        expect([actor.email, (await w.run(null, actor)).started]).toEqual([actor.email, ["todos", "client_notes", "defcon_priority", "grade"]]);
      }
      // The CEO asking on the CSM's notes reads only what she may: nothing begun, no prompt.
      const hers = world({ inputs, item });
      expect((await hers.run(null, ceoActor)).drafts.every(d => d.state === "skipped" && d.reason === OUTSIDE_CS_LIKELY)).toBe(true);
      expect(hers.f.service.named("cockpit_form_draft_begin")).toHaveLength(0);
      expect(hers.prompts).toHaveLength(0);
    }
    // The same closer's call on no card keeps OUTSIDE_CS for the CSM: nothing read, begun or sent to a model.
    const onNoCard = world({ inputs, item: { ...sales, recorderEmail: CLOSER_EMAIL, title: "City Wood pricing review" } });
    const unplaced = await onNoCard.run();
    expect(unplaced.drafts.map(d => [d.kind, d.state, d.reason])).toEqual(kinds.map(k => [k, "skipped", OUTSIDE_CS]));
    expect(onNoCard.f.service.named("cockpit_form_draft_begin")).toHaveLength(0);
    expect(onNoCard.prompts).toHaveLength(0);
    // A Customer Success recording with a name row still ties (rule 1), without asking the database.
    const csName = world({ item: { title: "City Wood check-in", onTask: "86exCITYW", onTaskMethod: "name", onTaskConfidence: 0.6 } });
    expect((await csName.run()).started).toEqual(["todos", "client_notes", "defcon_priority", "grade"]);
    expect(csName.f.service.named("cockpit_form_recordings_tied")).toHaveLength(0);
    // The client on the invite at 0.9 (a known contact) settles it for the CSM, without asking either.
    const known = world({ inputs, item: { ...sales, recorderEmail: CLOSER_EMAIL, onTask: "86exCITYW", onTaskMethod: "invitee_email", onTaskConfidence: 0.9 } });
    expect((await known.run()).started).toEqual(["todos", "client_notes", "defcon_priority", "grade"]);
    expect(known.f.service.named("cockpit_form_recordings_tied")).toHaveLength(0);
  });

  test("a recording since moved to another client: skipped with the save's sentence, the client named only to a seat that may see it", async () => {
    const item = { onTask: "86exMARBL", onTaskMethod: "manual" };
    const csm = world({ item });
    const out = await csm.run();
    expect(out.drafts.every(d => d.state === "skipped" && d.reason === "That recording is on another client. If that is wrong, ask an admin to move it.")).toBe(true);
    expect(csm.f.service.named("cockpit_form_draft_begin")).toHaveLength(0);
    const admin = world({ item });
    expect((await admin.run(null, adminActor)).drafts[0].reason).toBe("That recording is on Marble 10-12. If that is wrong, ask an admin to move it.");
  });

  test("a saved call older than the window is found in its own hour, with that hour's bookings", async () => {
    const w = world({ inputs: { startsAt: "2026-10-24T07:00:00Z", endsAt: "2026-10-24T07:30:00Z" } });
    w.f.service.handlers.cockpit_fathom_match_inputs = (a: Record<string, any>) =>
      a.p_task_id ? matchInputs() : matchInputs({ store: [storeItem({ startsAt: "2026-10-24T07:00:00.000Z" })], client: null });
    const out = await w.run();
    expect(w.f.service.named("cockpit_fathom_match_inputs").map(c => c.args)).toEqual([
      { p_from: "2026-10-26T21:00:00.000Z", p_to: "2026-10-28T09:00:00.000Z", p_task_id: "86exCITYW" },
      { p_from: "2026-10-24T06:59:00.000Z", p_to: "2026-10-24T07:01:00.000Z", p_task_id: null },
    ]);
    expect(out.started).toContain("todos");
  });

  test("a summary read fresh from a meeting unshared since the store saw it: nothing drafted, nothing written back", async () => {
    const w = world({ inputs: { summary: null }, pages: [[meeting({ shared_with: "no_teams" })]] });
    const out = await w.run();
    expect(out.drafts.every(d => d.state === "skipped" && d.reason === NOT_CLIENT_CALL)).toBe(true);
    expect(w.f.service.named("cockpit_fathom_ingest")).toHaveLength(0);
    expect(w.f.service.named("cockpit_form_draft_begin")).toHaveLength(0);
    expect(w.prompts).toHaveLength(0);
  });
});

describe("checkin.drafts: the transcript is waited for, as the summary is", () => {
  test("none stored and Fathom busy: the three line kinds wait (no row, no model), todos does not, and the window keeps asking", async () => {
    const opts: Parameters<typeof world>[0] = { storage: false, transcriptStatus: 429 };
    const w = world(opts);
    const out = await w.run();
    for (const k of ["client_notes", "defcon_priority", "grade"]) expect(out.drafts.find(d => d.kind === k)).toMatchObject({ state: "skipped", reason: TRANSCRIPT_WAIT, attempt: 0 });
    expect(TRANSCRIPT_WAIT).toMatch(/still writing/i);
    expect(w.attempts.map(a => a.kind)).toEqual(["todos"]);
    expect(out.started).toEqual(["todos"]);
    expect(w.prompts).toHaveLength(0);
    // A poll inside the wait reads nothing; the first poll after it reads the transcript: the grade is made then, once, from the call's lines.
    opts.transcriptStatus = undefined;
    w.at(1);
    expect((await w.run()).started).toEqual([]);
    expect(w.transcriptReads()).toBe(1);
    w.at(MISS_MS / 60_000);
    const next = await w.run();
    expect(w.transcriptReads()).toBe(2);
    expect(next.started).toEqual(["todos", "client_notes", "defcon_priority", "grade"]);
    const grades = w.prompts.filter(p => p.body.messages?.[0]?.content?.includes("Grading cadence"));
    expect(grades).toHaveLength(1);
    expect(grades[0].body.messages[0].content).toContain("L1 [00:00:05] CSM: Hello.");
  });

  test("a 503, or a transcript Fathom answers with no lines, waits the same way; after the send the grade and the recap wait too", async () => {
    for (const opts of [{ storage: false, transcriptStatus: 503 }, { storage: false, transcripts: { "194756343": [] } }]) {
      const w = world(opts);
      const out = await w.run();
      expect(out.drafts.find(d => d.kind === "grade")).toMatchObject({ state: "skipped", reason: TRANSCRIPT_WAIT });
      expect(w.byKind("grade")).toHaveLength(0);
    }
    const sent = world({ state: "submitted", storage: false, transcriptStatus: 503 });
    const out = await sent.run();
    expect(out.drafts.filter(d => d.kind === "grade" || d.kind === "recap").map(d => [d.kind, d.reason])).toEqual([
      ["grade", TRANSCRIPT_WAIT],
      ["recap", TRANSCRIPT_WAIT],
    ]);
    expect(sent.attempts).toHaveLength(0);
  });

  test("a refused read is not repeated every poll: two minutes by default, Fathom's retry-after when it gives one", async () => {
    // Fifteen polls a minute apart, as the window makes while the transcript waits.
    const polls = async (o: Parameters<typeof world>[0]) => {
      const w = world({ storage: false, transcriptStatus: 429, ...o });
      for (let m = 0; m < 15; m++) {
        w.at(m);
        const out = await w.run();
        expect(out.drafts.find(d => d.kind === "grade")).toMatchObject({ state: "skipped", reason: TRANSCRIPT_WAIT });
      }
      return w.transcriptReads();
    };
    expect(await polls({})).toBe(8);
    clearTranscriptCache();
    expect(await polls({ transcriptHeaders: { "retry-after": "300" } })).toBe(3);
    clearTranscriptCache();
    expect(await polls({ transcriptStatus: 503 })).toBe(8);
    clearTranscriptCache();
    // Once the worker stores the transcript, the drafts use it at once, wait or not.
    const w = world({ storage: false, transcriptStatus: 429 });
    await w.run();
    w.f.service.handlers.cockpit_form_draft_inputs = { ...(w.f.service.handlers.cockpit_form_draft_inputs as Record<string, unknown>), transcriptPath: "fathom/194756343.txt" };
    w.at(1);
    expect((await w.run()).started).toEqual(["todos", "client_notes", "defcon_priority", "grade"]);
    expect(w.transcriptReads()).toBe(1);
  });

  test("the wait: retry-after first, then ratelimit-reset on a 429 (seconds, or epoch seconds), else two minutes; between 1 second and 10 minutes", () => {
    const now = NOW.getTime();
    const limit = (reset: number | null) => ({ limit: 10, remaining: 0, reset });
    expect(missWait({ kind: "refused", status: 429, retryAfter: 17, limit: limit(40) }, now)).toBe(17_000);
    expect(missWait({ kind: "refused", status: 429, retryAfter: null, limit: limit(40) }, now)).toBe(40_000);
    expect(missWait({ kind: "refused", status: 429, retryAfter: null, limit: limit(now / 1000 + 90) }, now)).toBe(90_000);
    expect(missWait({ kind: "refused", status: 404, retryAfter: null, limit: limit(40) }, now)).toBe(MISS_MS);
    expect(missWait({ kind: "refused", status: 429, retryAfter: 86_400, limit: limit(null) }, now)).toBe(10 * 60_000);
    expect(missWait({ kind: "unknown" }, now)).toBe(MISS_MS);
    expect(missWait({ kind: "ok", body: {}, limit: limit(null) }, now)).toBe(MISS_MS);
  });

  test("with no model key the kind is still off, not waiting", async () => {
    const w = world({ keys: ["fathom"], storage: false, transcriptStatus: 429 });
    const out = await w.run();
    expect(out.drafts.find(d => d.kind === "grade")).toMatchObject({ state: "off", reason: OFF.anthropic });
  });
});

describe("Fathom's summary shape", () => {
  const REAL = [
    "## Meeting Purpose",
    "Monthly check-in on the campaign.",
    "## Key Takeaways",
    "- **Client happy with the designs** ([01:02](https://fathom.video/share/TESTshareAAA1?tab=summary&timestamp=62))",
    "## Topics",
    "### Ads performance",
    "- Bookings came in steadily ([02:10](https://fathom.video/share/TESTshareAAA1?tab=summary&timestamp=130))",
    "- New creatives next week",
    "### Next month's plan",
    "- A shoot day before the holiday",
    "## Next Steps",
    "- [Send the logo files](https://fathom.video/share/TESTshareAAA1?tab=summary&timestamp=150)",
  ].join("\n");

  test("the topics under their ### sub-headings stay in Topics, each topic's name a line of its own; the next section still starts at ##", () => {
    const s = summarySections(REAL);
    expect(s.topics).toEqual([
      { text: "Ads performance", at: null },
      { text: "Bookings came in steadily", at: 130 },
      { text: "New creatives next week", at: null },
      { text: "Next month's plan", at: null },
      { text: "A shoot day before the holiday", at: null },
    ]);
    expect(s.nextSteps).toEqual([{ text: "Send the logo files", at: 150 }]);
    expect(s.takeaways.map(b => b.text)).toEqual(["Client happy with the designs"]);
    const ar = summarySections(["## المواضيع", "### الإعلانات", "- الحجوزات زادت", "## الخطوات التالية", "- إرسال الملفات"].join("\n"));
    expect(ar.topics.map(b => b.text)).toEqual(["الإعلانات", "الحجوزات زادت"]);
    expect(ar.nextSteps.map(b => b.text)).toEqual(["إرسال الملفات"]);
    // An unknown ## heading still ends a section.
    expect(summarySections(["## Topics", "- one", "## Something else", "- two"].join("\n")).topics.map(b => b.text)).toEqual(["one"]);
  });

  test("the client notes prompt carries Fathom's real topics", async () => {
    const w = world({ inputs: { summary: REAL } });
    await w.run();
    const notes = w.prompts.find(p => p.host === "api.deepseek.com")?.body.messages[1].content as string;
    expect(notes).toContain("- Bookings came in steadily");
    expect(notes).toContain("- Ads performance");
  });
});
