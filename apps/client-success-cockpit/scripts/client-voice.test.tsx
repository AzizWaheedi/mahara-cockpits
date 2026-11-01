import {
  afterAll,
  describe,
  expect,
  mock,
  setDefaultTimeout,
  test,
} from "bun:test";
import { Window } from "happy-dom";

/**
 * The client's voice (docs/forms/WAVE34-CONTRACT.md 3.3, 5.3, 5.4): the card
 * empty and full, every score the client's own with nothing missing read as
 * 0, the source sentence word for word, a low score in words as well as
 * colour, the brief's line only for an answer under 30 days old (and "Low
 * score: call them." at or under the line), and the low-score rows Today
 * reads. Stand-in reads only.
 *
 * Run: bun test scripts/client-voice.test.tsx
 */

setDefaultTimeout(30_000);

const win = new Window({
  url: "https://localhost/client-success/clients/86exfix01?tab=overview",
  width: 1280,
  height: 900,
});
const DOM = [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "Element",
  "Node",
  "Event",
  "MouseEvent",
  "DocumentFragment",
  "Text",
  "MutationObserver",
  "getComputedStyle",
];
for (const k of DOM)
  Object.defineProperty(globalThis, k, {
    configurable: true,
    writable: true,
    value:
      k === "window"
        ? win
        : typeof (win as any)[k] === "function" && /^[a-z]/.test(k)
          ? (win as any)[k].bind(win)
          : (win as any)[k],
  });
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
mock.module("sonner", () => ({ toast: () => {}, Toaster: () => null }));

const { createRoot } = await import("react-dom/client");
const { act, createElement } = await import("react");
const voice = await import("../src/lib/clientVoice");
const card = await import("../src/components/ClientVoice");
const brief = await import("../src/lib/clientBrief");
const fx = await import("../src/dev/clientFormsFixtures");

const roots: ReturnType<typeof createRoot>[] = [];
afterAll(async () => {
  for (const r of roots) await act(async () => r.unmount());
  await win.happyDOM.close();
});
const flush = () =>
  act(async () => {
    for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 0));
  });
async function draw(el: any) {
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  roots.push(root);
  await act(async () => root.render(el));
  await flush();
  return host as any;
}
const text = (el: any) =>
  String(el?.textContent ?? "")
    .replace(/\s+/g, " ")
    .trim();

describe("the read (3.3)", () => {
  test("a full answer reads as given; missing stays null, never 0", () => {
    const v = voice.voiceRead({
      nps: {
        latest: { score: 9, at: "2026-10-31T07:30:00Z", round: 2 },
        history: [{ score: 9, at: "x" }, { score: null }],
      },
      csat: {},
      feedback: [{ kind: "idea", rating: null }],
    });
    expect(v?.nps.latest).toEqual({
      score: 9,
      results: null,
      communication: null,
      startStop: null,
      at: "2026-10-31T07:30:00Z",
      round: 2,
    });
    expect(v?.nps.history).toEqual([{ score: 9, at: "x" }]);
    expect(v?.csat.score).toBeNull();
    expect(v?.feedback[0].rating).toBeNull();
    // The source sentence, as the database words it, when it sends none.
    expect(v?.source).toBe(fx.VOICE_SOURCE_TEXT);
    expect(v?.lowScoreMax).toBe(6);
    expect(voice.voiceRead(null)).toBeNull();
  });

  test("low scores: only well-formed rows, the line and the ticket's details", () => {
    const rows = voice.lowScores([
      ...fx.LOW_SCORES.map(r => ({ ...r, kind: "low_score" })),
      { kind: "low_score", responseId: "x" },
      { kind: "other", responseId: "y", taskId: "t", score: 2 },
    ]);
    expect(rows).toEqual(fx.LOW_SCORES);
    expect(voice.lowScoreLine(rows[0])).toBe(
      "Low score: Castello Industries gave 4/10 on the NPS survey",
    );
    expect(voice.lowScoreLine({ ...rows[0], formKey: "csat" })).toBe(
      "Low score: Castello Industries gave 4/10 on the onboarding survey",
    );
  });
});

describe("the card (5.4)", () => {
  test("empty: says what to do next, with the source sentence", async () => {
    const host = await draw(
      createElement(card.ClientVoiceCard, {
        state: { status: "ready", voice: fx.VOICE_NONE },
      }),
    );
    expect(text(host.querySelector("[data-empty]"))).toBe(
      "No answers yet. Send the NPS survey from Send a form.",
    );
    expect(text(host.querySelector("[data-source]"))).toBe(
      "From the client's own answers in the portal or by link. The 2 old Typeform answers could not be matched to a client, so they are left out.",
    );
  });

  test("full: NPS with its side scores and words, the history in order, onboarding and feedback", async () => {
    const host = await draw(
      createElement(card.ClientVoiceCard, {
        state: { status: "ready", voice: fx.VOICE_FULL },
      }),
    );
    const nps = text(host.querySelector("[data-nps]"));
    expect(nps).toContain("NPS 9/10 would recommend · 31 Oct");
    expect(nps).toContain("Results so far 8/10 · Communication 10/10");
    expect(nps).toContain("ابدوا ترسلون تقرير أسبوعي أقصر");
    expect(host.querySelector("[data-nps] bdi")?.getAttribute("dir")).toBe(
      "auto",
    );
    // Oldest first, the 6 in red ink as a low score.
    expect(
      host.querySelector("[data-history]")?.getAttribute("aria-label"),
    ).toBe("NPS history: 6 on 2 Aug, 9 on 31 Oct");
    const csat = [...host.querySelectorAll("[data-csat] p")].map(text);
    expect(csat).toEqual([
      "Onboarding 8/10 · 20 Aug",
      "Liked: The kickoff call was clear",
      "Could be better: Waiting for the ad account",
    ]);
    expect(text(host.querySelector("[data-feedback]"))).toContain(
      "Idea about reports · 12 Oct · 4/5",
    );
    expect(text(host)).not.toMatch(/(^|[^0-9])0\/10/);
  });

  test("a low score says so in words, not colour alone", async () => {
    const low = {
      ...fx.VOICE_FULL,
      nps: {
        ...fx.VOICE_FULL.nps,
        latest: { ...fx.VOICE_FULL.nps.latest!, score: 5 },
      },
    };
    const host = await draw(
      createElement(card.ClientVoiceCard, {
        state: { status: "ready", voice: low },
      }),
    );
    expect(text(host.querySelector("[data-nps]"))).toContain(
      "low score: call them",
    );
  });

  test("a failed read is said; nothing is shown as a score", async () => {
    const host = await draw(
      createElement(card.ClientVoiceCard, {
        state: { status: "failed", error: "x" },
      }),
    );
    expect(text(host)).toContain(voice.VOICE_FAILED);
    expect(host.querySelector("[data-nps]")).toBeNull();
  });

  test("closed door: no read at all", async () => {
    let calls = 0;
    function Probe() {
      const s = card.useClientVoice(
        async () => {
          calls++;
          return fx.VOICE_FULL;
        },
        fx.TASK,
        false,
      );
      return createElement(card.ClientVoiceCard, { state: s });
    }
    const host = await draw(createElement(Probe));
    expect(calls).toBe(0);
    expect(host.querySelector("[data-client-voice]")).toBeNull();
  });
});

describe("the brief's line (5.4)", () => {
  const now = Date.parse("2026-11-01T09:00:00Z");
  const at = (daysAgo: number) =>
    new Date(now - daysAgo * 86_400_000).toISOString();
  test("an answer under 30 days old is said; an older one is not", () => {
    expect(
      brief.voiceBriefLine(
        [{ formKey: "nps", score: 9, at: at(2), max: 6 }],
        now,
      ),
    ).toEqual({
      text: "Said 9/10 on the NPS survey on 30 Oct.",
      source: "The client's answer",
      day: "30 Oct",
      risk: undefined,
    });
    expect(
      brief.voiceBriefLine(
        [{ formKey: "nps", score: 9, at: at(31), max: 6 }],
        now,
      ),
    ).toBeNull();
    expect(brief.voiceBriefLine(null, now)).toBeNull();
  });

  test("at or under the line it adds Low score: call them; the newest answer wins", () => {
    const line = brief.voiceBriefLine(
      [
        { formKey: "nps", score: 9, at: at(20), max: 6 },
        { formKey: "csat", score: 6, at: at(3), max: 6 },
      ],
      now,
    );
    expect(line?.text).toBe(
      "Said 6/10 on the onboarding survey on 29 Oct. Low score: call them.",
    );
    expect(line?.risk).toBe(true);
  });

  test("the brief raises it from the row the client page hands in", () => {
    const b = brief.buildBrief({
      now,
      client: {
        taskId: fx.TASK,
        name: fx.NAME,
        stage: "Active",
        voice: [{ formKey: "nps", score: 4, at: at(1), max: 6 }],
      },
      timeline: {
        clientName: fx.NAME,
        calls: [],
        forms: [],
        eods: [],
        health: [],
      } as any,
      digests: [],
    });
    expect(b.raise.map(r => r.text)).toContain(
      "Said 4/10 on the NPS survey on 31 Oct. Low score: call them.",
    );
  });

  test("voiceForBrief takes the newest NPS and the onboarding score with the line", () => {
    expect(voice.voiceForBrief(fx.VOICE_FULL)).toEqual([
      { formKey: "nps", score: 9, at: fx.VOICE_FULL.nps.latest!.at!, max: 6 },
      { formKey: "csat", score: 8, at: fx.VOICE_FULL.csat.at!, max: 6 },
    ]);
    expect(voice.voiceForBrief(fx.VOICE_NONE)).toEqual([]);
  });
});
