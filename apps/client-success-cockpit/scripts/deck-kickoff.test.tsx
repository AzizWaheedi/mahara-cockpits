import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";

/**
 * The kickoff form on the onboarding deck's last slide (CEO, 2026-10-22;
 * docs/csm-decks/DESIGN.md 23, CONTENT O8): the kickoff window's own
 * FormPanel state with the KICKOFF config, on the canvas in a frame, the
 * card ID from the record, the same guard (a kickoff on record shows
 * "Kickoff on record" with what was filled, never a fresh form), the same
 * one note per response, the side panel's facts and the trail in the notes
 * window only, and the checklist's third item ticked by the Submit (as
 * "Kickoff sent" until the Blueprint call is booked).
 * Typeform's SDK is a stand-in that captures its options: nothing loads and
 * nothing is submitted.
 *
 * Run: bun test scripts/deck-kickoff.test.tsx
 */

const win = new Window({
  url: "https://localhost/client-success/clients/fixture-sparse/present/onboarding#kickoff",
  width: 1920,
  height: 1080,
  settings: {
    disableIframePageLoading: true,
    disableJavaScriptFileLoading: true,
    disableCSSFileLoading: true,
  },
});
for (const k of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLIFrameElement",
  "HTMLDetailsElement",
  "Element",
  "Node",
  "Event",
  "CustomEvent",
  "KeyboardEvent",
  "MouseEvent",
  "FocusEvent",
  "MessageEvent",
  "DocumentFragment",
  "Text",
  "NodeFilter",
  "MutationObserver",
  "getComputedStyle",
  "sessionStorage",
  "localStorage",
])
  (globalThis as Record<string, unknown>)[k] =
    k === "window" ? win : (win as unknown as Record<string, unknown>)[k];
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/** The windows' channel, in memory: every other open channel of the name hears a post. */
class Channel {
  static open = new Map<string, Set<Channel>>();
  static heard: { name: string; data: unknown }[] = [];
  onmessage: ((e: { data: unknown }) => void) | null = null;
  constructor(readonly name: string) {
    const set = Channel.open.get(name) ?? new Set<Channel>();
    set.add(this);
    Channel.open.set(name, set);
  }
  postMessage(data: unknown) {
    const copy = JSON.parse(JSON.stringify(data));
    Channel.heard.push({ name: this.name, data: copy });
    for (const c of Channel.open.get(this.name) ?? [])
      if (c !== this) c.onmessage?.({ data: copy });
  }
  close() {
    Channel.open.get(this.name)?.delete(this);
  }
}
(globalThis as Record<string, unknown>).BroadcastChannel = Channel;

mock.module("@/auth/SupabaseAuthProvider", () => ({
  getCockpitSupabaseClient: () => null,
  useCockpitAuth: () => ({ client: null, name: "Sara", email: "" }),
}));

const { createRoot } = await import("react-dom/client");
const { act } = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");
const { FIXTURES } = await import("../src/practice/fixtures/fixtures");
const { emptyLive, DeckHub, channelName } = await import(
  "../src/present/channel"
);
const { deckData } = await import("../src/present/deckData");
const { nextStops, onboardingSlides } = await import(
  "../src/present/onboardingDeck"
);
const { PresentApp } = await import("../src/present/PresentApp");
const { KickoffNotes } = await import("../src/present/KickoffSlide");
const { recordRows, emptyView } = await import("../src/present/kickoffStop");
const fx = await import("../src/dev/formFixtures");

type Loaded = import("../src/present/useDeckModel").Loaded;
type DeckData = import("../src/present/deckData").DeckData;
type KickoffView = import("../src/present/kickoffStop").KickoffView;
type Lang = "en" | "ar";
type Options = Record<string, any>;

const NOW = new Date("2026-10-19T09:00:00Z");
const TASK = "fixture-sparse";

// ------------------------------------------------------------ helpers

function data(
  loaded: Loaded,
  lang: Lang = "en",
  kickoffSent: string | null = null,
): DeckData {
  return deckData({
    taskId: TASK,
    deck: "onboarding",
    lang,
    sources: loaded.sources,
    kit: loaded.kit,
    prep: loaded.prep,
    ads: loaded.ads,
    publicUrl: (_b, p) => p,
    kickoffSent,
    now: NOW,
  });
}

/** The full client before its kickoff: no kickoff on record, the Blueprint not booked. */
function beforeKickoff(): Loaded {
  const f = FIXTURES.full("onboarding");
  const forms = { ...(f.kit?.forms ?? {}) };
  delete forms.kickoff;
  return {
    ...f,
    kit: f.kit ? { ...f.kit, clickup_task_id: TASK, forms } : null,
    sources: f.sources
      ? {
          ...f.sources,
          calls: { last: {}, next: {} },
        }
      : null,
  };
}

function withKickoff(): Loaded {
  const f = FIXTURES.full("onboarding");
  return {
    ...f,
    kit: f.kit ? { ...f.kit, clickup_task_id: TASK } : null,
  };
}

const slide = (id: string) => {
  const s = onboardingSlides().find(x => x.id === id);
  if (!s) throw Error(`no slide ${id}`);
  return s;
};

function still(d: DeckData, id = "kickoff", tour = 0) {
  return renderToStaticMarkup(
    slide(id).render({
      d,
      lang: d.lang,
      deck: "onboarding",
      prep: {},
      prepOf: () => ({}),
      save: () => {},
      saveTo: () => {},
      live: emptyLive(),
      setLive: () => {},
      still: true,
      presenting: true,
      tour,
      setTour: () => {},
    }),
  );
}

/** Words that never reach a client's screen from the kickoff (CONTENT rule 3, DESIGN 12.2). */
const NEVER_ON_CANVAS =
  /budget|payment|\$|recording|contract|close rate|leads?\b|clickup|make\b|slack|sends to|still missing|fixture-/i;

function stand() {
  const mounted: { options: Options; unmounted: boolean }[] = [];
  const embed = async () => (_formId: string, options: Options) => {
    const m = { options, unmounted: false };
    mounted.push(m);
    queueMicrotask(() => options.onReady?.({ formId: _formId }));
    return {
      unmount: () => {
        m.unmounted = true;
      },
    };
  };
  return { mounted, embed };
}

function port(loaded: Loaded) {
  const calls = { record: [] as any[], refresh: 0, timeline: 0 };
  let sends: any[] = [];
  const s = stand();
  const p = {
    reads: {
      kits: async () => ({
        rows: loaded.kit ? [loaded.kit] : [],
        now: NOW.toISOString(),
      }),
      deck: async () => {
        if (!loaded.sources) throw Error("no sources");
        return loaded.sources;
      },
      timeline: async () => {
        calls.timeline++;
        return fx.fixtureTimeline();
      },
      sends: async () => ({ sends }),
      record: async (input: any) => {
        calls.record.push(input);
        const send = fx.fixtureSend({
          responseId: input.responseId,
          taskId: TASK,
          sentAt: NOW.toISOString(),
        });
        sends = [send, ...sends];
        return { send };
      },
      refresh: async () => {
        calls.refresh++;
        return {
          rows: loaded.kit ? [loaded.kit] : [],
          now: NOW.toISOString(),
          problem: null,
        };
      },
      announce: () => {},
    },
    me: { email: "sara@example.invalid", firstName: "Sara" },
    rehearse: false,
    embed: s.embed,
  };
  return { port: p, calls, mounted: s.mounted };
}

const roots: { unmount: () => void }[] = [];
const flush = () =>
  act(async () => {
    for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 0));
  });

async function present(loaded: Loaded, kickoff: ReturnType<typeof port>) {
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  roots.push(root);
  await act(async () => {
    root.render(
      <PresentApp
        taskId={TASK}
        deck="onboarding"
        view="present"
        io={{
          load: async () => loaded,
          savePrep: async (deck, overrides) => ({
            deck,
            overrides,
            revision: 1,
            changed: true,
          }),
          now: () => NOW,
        }}
        urls={{ deck: "", notes: "", prep: "", client: "", other: "" }}
        kickoff={kickoff.port}
      />,
    );
  });
  await flush();
  return host;
}

/** What the notes window hears: the newest kickoff view. */
const lastView = (): KickoffView | null => {
  const v = Channel.heard
    .filter(h => (h.data as any)?.type === "kickoff")
    .at(-1)?.data as { view: KickoffView } | undefined;
  return v?.view ?? null;
};
const canvasText = () =>
  win.document.querySelector(".dk-canvas")?.textContent ?? "";
const press = async (key: string) => {
  await act(async () => {
    win.dispatchEvent(new win.KeyboardEvent("keydown", { key, bubbles: true }));
  });
  await flush();
};

// The deck opens in the language asked for: English here (the full client's
// HighLevel language is Arabic).
win.localStorage.setItem("csm_deck_lang", "en");

afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  win.document.body.innerHTML = "";
  Channel.heard = [];
  win.location.hash = "#kickoff";
  // A test that pressed L chose Arabic for the next deck: back to English.
  win.localStorage.setItem("csm_deck_lang", "en");
});
afterAll(async () => {
  await win.happyDOM.close();
});

// ------------------------------------------------------------ the slide

describe("the last slide", () => {
  test("the deck ends on the kickoff: one stop, its notes in both languages", () => {
    const slides = onboardingSlides();
    expect(slides.at(-1)?.id).toBe("kickoff");
    const k = slide("kickoff");
    expect(k.stops).toBeUndefined();
    expect(k.title.en).toBe("Your kickoff form");
    expect(k.title.ar).toBe("نموذج بداية الشغل");
    expect(k.notes.say.length).toBeGreaterThan(3);
    expect(k.notes.sayAr.length).toBeGreaterThan(1);
  });

  test("before the kickoff: the frame waits for the form, the checklist's third item is the slide's own and open", () => {
    for (const lang of ["en", "ar"] as Lang[]) {
      const d = data(beforeKickoff(), lang);
      expect(d.kickoff.from).toBeNull();
      expect(d.today.blueprint).toBe(false);
      const html = still(d);
      expect(html).toContain(
        lang === "en"
          ? "Before we hang up: your kickoff form"
          : "قبل لا نسكر المكالمة: نموذج بداية الشغل",
      );
      expect(html).toContain(
        lang === "en"
          ? "Your details are already in, from your onboarding form."
          : "تفاصيلكم موجودة فيه من نموذج التعريف بالنشاط.",
      );
      expect(html).toContain(
        lang === "en"
          ? "Your kickoff form opens here."
          : "نموذج بداية الشغل ينفتح هنا.",
      );
      expect(html).toContain('data-variant="foot"');
      const items = html.match(/<li[^>]*style="--i:\d[^"]*"[^>]*>/g) ?? [];
      expect(items).toHaveLength(3);
      expect(items[2]).toContain("data-own");
      expect(items[2]).not.toContain("data-done");
      expect(html).not.toContain("data-form-frame");
      expect(html.replace(/<[^>]+>/g, " ")).not.toMatch(NEVER_ON_CANVAS);
    }
  });

  test("with no onboarding answers, it says they fill it together, and prep says why", () => {
    const sparse = FIXTURES.sparse("onboarding");
    const d = data(sparse);
    expect(d.kickoff.prefilled).toBe(false);
    expect(still(d)).toContain("We fill it in together, now.");
    expect(slide("kickoff").missing?.(d).join(" ")).toContain(
      "opens with their name and card only",
    );
  });

  test("a kickoff on record: Kickoff on record with what was filled, never a fresh form, never the money", () => {
    for (const lang of ["en", "ar"] as Lang[]) {
      const d = data(withKickoff(), lang);
      expect(d.kickoff.from).toBe("record");
      expect(d.today.blueprint).toBe(true);
      const html = still(d);
      expect(html).toContain(
        lang === "en" ? "Kickoff on record" : "نموذج بداية الشغل عندنا",
      );
      expect(html).toContain(lang === "en" ? "Interior design" : "تصميم داخلي");
      expect(html).toContain("Noor Studio");
      expect(html).toContain(
        lang === "en" ? "You see them first" : "تشوفونها أول",
      );
      expect(html).toMatch(
        lang === "en" ? /Filled on 19.October/ : /تعبّى يوم ١٩.أكتوبر/,
      );
      expect(html).not.toContain("data-form-frame");
      expect(html).not.toContain("opens here");
      expect(html.replace(/<[^>]+>/g, " ")).not.toMatch(NEVER_ON_CANVAS);
    }
    expect(slide("kickoff").todo?.(data(withKickoff()))).toEqual([
      "The kickoff is on record, so this slide shows what was filled, never a fresh form.",
    ]);
  });

  test("the record's read-back keeps to the client's own answers about their ads", () => {
    const rows = recordRows({
      form_id: "tG7dnxBn",
      response_id: "r",
      submitted_at: "2026-10-19T08:00:00Z",
      answers: [
        ["Which service are we advertising?", "Fit out and renovation"],
        ["What is the name of the Facebook page?", "Reem Interiors"],
        ["Templated Ads Status", "Approved"],
        ["Daily budget", "40"],
        ["Payment Amount", "1000"],
        ["Call Recording Link", "https://fathom.example/x"],
        ["Contract status", "Signed"],
        ["What is their close rate on cold leads?", "10%"],
        ["Do they have pre-existing leads?", "Yes"],
      ].map(([title, value]) => ({ ref: title, title, value })),
    });
    expect(rows.map(r => r.key)).toEqual(["service", "page", "starter"]);
    expect(rows.map(r => r.value)).toEqual([
      "fitout",
      "Reem Interiors",
      "approved",
    ]);
    // A Page name still open is not a name.
    expect(
      recordRows({
        form_id: "tG7dnxBn",
        response_id: "r",
        submitted_at: "2026-10-19T08:00:00Z",
        answers: [
          {
            ref: "p",
            title: "What is the name of the Facebook page?",
            value: "Pending",
          },
        ],
      }),
    ).toEqual([]);
  });

  test("sent on this call: the checklist ticks the kickoff as sent, the frame says when and what is next, and O7's card picks the time", () => {
    for (const lang of ["en", "ar"] as Lang[]) {
      const d = data(beforeKickoff(), lang, "2026-10-19T09:12:00Z");
      expect(d.kickoff.from).toBe("call");
      expect(d.today.blueprint).toBe(true);
      // Ticked by the Submit, not booked: the item says what was done.
      expect(d.blueprintBooked).toBe(false);
      const html = still(d).replace(/&#x27;/g, "'");
      expect(html).toContain(
        lang === "en"
          ? "Done. Your answers are with our team."
          : "تمام، أجوبتكم وصلت لفريقنا.",
      );
      // "Sent" once (the frame's head, with the time); the card says what is next.
      expect(html).toMatch(
        lang === "en" ? /Sent at 12:12.pm/ : /انرسل الساعة ١٢:١٢.ظهراً/,
      );
      expect(html).toContain(
        lang === "en"
          ? "Next: we pick the time for your Brand Blueprint call"
          : "الخطوة الجاية: نختار وقت مكالمة بناء الهوية والعرض",
      );
      expect(
        html.split(
          lang === "en"
            ? "Our team starts on your setup"
            : "فريقنا يبدي بتجهيز",
        ).length - 1,
      ).toBe(1);
      expect(html).toContain(
        lang === "en" ? "Kickoff sent" : "انرسل نموذج بداية الشغل",
      );
      const items = html.match(/<li[^>]*style="--i:\d[^"]*"[^>]*>/g) ?? [];
      expect(items[2]).toContain("data-done");
      const close = still(d, "next", nextStops(d) - 1);
      expect(close).toContain(
        lang === "en" ? "We pick the time now" : "نختار الوقت الحين",
      );
      expect(close).not.toContain(
        lang === "en"
          ? "We book it before we hang up"
          : "نحجزها قبل لا نسكر المكالمة",
      );
    }
  });
});

// ------------------------------------------------------------ on the call

describe("on the call", () => {
  test("the form opens on the canvas with the record's card ID, and nothing of the side panel is drawn there", async () => {
    const k = port(beforeKickoff());
    await present(beforeKickoff(), k);
    expect(k.mounted).toHaveLength(1);
    const o = k.mounted[0]?.options ?? {};
    expect(o.hidden.onboarding_client_id).toBe(TASK);
    expect(o.hidden.legal_name).toBeTruthy();
    expect(o.redirectTarget).toBe("_blank");
    expect(typeof o.onEndingButtonClick).toBe("function");
    expect(o.enableSandbox).toBeUndefined();
    const frame = win.document.querySelector(
      ".dkc-kick-layer [data-form-frame]",
    );
    expect(frame).toBeTruthy();
    expect(frame?.getAttribute("dir")).toBe("ltr");
    expect(canvasText()).not.toMatch(NEVER_ON_CANVAS);
    // The notes window hears the call sheet, the seal's ID with it.
    const v = lastView();
    expect(v?.status).toBe("ready");
    expect(v?.taskId).toBe(TASK);
    expect(v?.phase).toBe("open");
    expect(v?.parts.map(p => p.id)).toContain("missing");
  });

  test("Submit notes the response once, ticks the checklist as Kickoff sent and says Sent on the frame; the trail goes to the notes window", async () => {
    const k = port(beforeKickoff());
    const host = await present(beforeKickoff(), k);
    const o = k.mounted[0]?.options ?? {};
    await act(async () => {
      o.onSubmit({ responseId: "resp00000001" });
      o.onSubmit({ responseId: "resp00000001" });
    });
    await flush();
    expect(k.calls.record).toHaveLength(1);
    expect(k.calls.record[0]).toMatchObject({
      taskId: TASK,
      formKey: "kickoff",
      responseId: "resp00000001",
      carriedId: TASK,
    });
    const items = host.querySelectorAll(".dkc-today li");
    expect(items[2]?.hasAttribute("data-done")).toBe(true);
    expect(
      host.querySelector(".dkc-kick-frame")?.hasAttribute("data-sent"),
    ).toBe(true);
    expect(canvasText()).toContain("Sent at");
    expect(canvasText()).toContain("Done. Your answers are with our team.");
    expect(canvasText()).toContain("Next: we pick the time");
    expect(canvasText()).toContain("Kickoff sent");
    expect(canvasText()).not.toMatch(NEVER_ON_CANVAS);
    expect(
      Channel.heard.some(h => (h.data as any)?.type === "kickoff-sent"),
    ).toBe(true);
    const v = lastView();
    expect(v?.phase).toBe("sent");
    expect(v?.sent?.responseId).toBe("resp00000001");
    // The deck window is on the client's screen: its trail never has the
    // Slack stop (docs/forms/STAGE1-CONTRACT.md 6.1).
    expect(v?.trail?.stops.map(s => s.key)).toEqual([
      "sent",
      "typeform",
      "card",
      "link",
    ]);
    // The form's ending asks for the booking: the notes window opens it.
    await act(async () => o.onEndingButtonClick());
    await flush();
    expect(lastView()?.autoBook).toBe(true);
  });

  test("a press in the notes window runs on the deck: Check now reads the card again", async () => {
    const k = port(beforeKickoff());
    await present(beforeKickoff(), k);
    await act(async () =>
      k.mounted[0]?.options.onSubmit({ responseId: "resp00000002" }),
    );
    await flush();
    const notes = new DeckHub(channelName(TASK, "onboarding"));
    await act(async () =>
      notes.post({ type: "kickoff-act", act: { act: "check" } }),
    );
    await flush();
    expect(k.calls.refresh).toBe(1);
    notes.close();
  });

  test("the half-filled form survives a step back, a language switch and coming back", async () => {
    const k = port(beforeKickoff());
    const host = await present(beforeKickoff(), k);
    await act(async () => k.mounted[0]?.options.onStarted?.({}));
    await press("ArrowLeft");
    expect(host.querySelector(".dk-slide")?.getAttribute("data-slide")).toBe(
      "next",
    );
    expect(host.querySelector(".dkc-kick-layer")?.hasAttribute("data-on")).toBe(
      false,
    );
    await press("l");
    await press("ArrowRight");
    expect(host.querySelector(".dk-slide")?.getAttribute("data-slide")).toBe(
      "kickoff",
    );
    expect(k.mounted).toHaveLength(1);
    expect(k.mounted[0]?.unmounted).toBe(false);
  });

  test("a kickoff on record: Kickoff on record with what was filled, and no form is ever created", async () => {
    const k = port(withKickoff());
    await present(withKickoff(), k);
    expect(k.mounted).toHaveLength(0);
    expect(canvasText()).toContain("Kickoff on record");
    expect(canvasText()).toContain("We already have it");
    expect(canvasText()).not.toMatch(NEVER_ON_CANVAS);
    const v = lastView();
    expect(v?.phase).toBe("held");
    expect(v?.already?.from).toBe("record");
  });
});

// ------------------------------------------------------------ the notes window

describe("the notes window's kickoff part", () => {
  const base = emptyView({
    taskId: TASK,
    clientName: "Noor Studio Interiors",
    stage: "Onboarding Booked",
    rehearse: false,
  });

  test("before the send: the seal and the call sheet, and nothing here sends", () => {
    const html = renderToStaticMarkup(
      <KickoffNotes
        view={{
          ...base,
          status: "ready",
          phase: "open",
          parts: [
            {
              id: "missing",
              title: "Still missing",
              tone: "warn",
              rows: [
                {
                  id: "m-payment",
                  label: "Payment amount",
                  value: null,
                  source: null,
                  missing: "Not on the card.",
                  anchor: "payment",
                },
              ],
            },
          ],
        }}
        post={() => {}}
      />,
    );
    expect(html).toContain("Sends to");
    expect(html).toContain(TASK);
    expect(html).toContain("Still missing");
    expect(html).toContain("Payment amount");
    expect(html).toContain("Nothing here sends anything.");
  });

  test("held: the record's answers to read and the kickoff window, never a second form here", () => {
    const html = renderToStaticMarkup(
      <KickoffNotes
        view={{
          ...base,
          status: "ready",
          phase: "held",
          already: {
            at: "2026-10-15T09:20:00Z",
            by: null,
            from: "record",
            entry: fx.onboardingEntry(),
          },
        }}
        post={() => {}}
      />,
    );
    expect(html).toContain("Already sent");
    expect(html).toContain("Read what was filled");
    expect(html).toContain("Open the kickoff window");
    expect(html).toContain("never a fresh form");
    expect(html).not.toContain("second kickoff anyway");
  });

  test("after the send: the trail's own sentences and the booking, opened by the form's ending", () => {
    const asked: any[] = [];
    const html = renderToStaticMarkup(
      <KickoffNotes
        view={{
          ...base,
          status: "ready",
          phase: "sent",
          sent: {
            responseId: "resp00000001",
            at: "2026-10-19T09:12:00Z",
            send: null,
            error: null,
            busy: false,
          },
          trail: {
            stops: [
              {
                key: "sent",
                label: "Sent",
                done: true,
                line: "Sent from the cockpit at 12:12.",
              },
              {
                key: "typeform",
                label: "Typeform lists it",
                done: false,
                line: "Usually within a minute.",
              },
              {
                key: "card",
                label: "Make updates the card",
                done: false,
                line: null,
              },
              {
                key: "link",
                label: "Make adds the Blueprint link",
                done: false,
                line: null,
              },
            ],
            current: "typeform",
            late: null,
            lateLine: null,
          },
          autoBook: true,
        }}
        post={() => {}}
        book={o => {
          asked.push(o);
          return <span>Book the Brand Blueprint call</span>;
        }}
      />,
    );
    expect(html).toContain(
      "Kickoff sent. Make is updating the card. Book the Brand Blueprint call below.",
    );
    expect(html).toContain("Typeform lists it");
    expect(html).toContain("Book the Brand Blueprint call");
    expect(asked[0]?.autoOpen).toBe(true);
    expect(html).not.toContain("Still missing");
  });
});

describe("the deck never reads the Slack notices", () => {
  test("its reads carry no notices, so its trail has no Slack stop", async () => {
    const { formReads } = await import("../src/forms/useLiveForm");
    expect(formReads(null, TASK, "kickoff").notices).toBeUndefined();
    expect(
      typeof formReads(null, TASK, "kickoff", { notices: true }).notices,
    ).toBe("function");
    const { readFileSync } = await import("node:fs");
    const page = readFileSync(
      new URL("../src/present/PresentPage.tsx", import.meta.url),
      "utf8",
    );
    expect(page).toContain('formReads(client, key, "kickoff")');
    expect(page).not.toContain("notices: true");
  });
});
