import { afterAll, describe, expect, mock, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Window } from "happy-dom";

/**
 * The decks' video slots (the CEO, 2026-10-20; docs/csm-decks/CONTENT.md
 * "Video slots", VIDEOS.md, DESIGN.md 21.2 to 21.6): the registry against
 * the migration's list, which recording a slot uses, the lengths in both
 * languages, the recap, the frame's address for each provider and the
 * refusal of anything else, the players' messages as real frames posted
 * them, the player's states, and on a mounted deck: an empty slot shows
 * nothing, a filled one shows the control, and the overlay opens with V and
 * closes with Esc without ever leaving the deck.
 */

const win = new Window({
  url: "https://localhost/client-success/clients/t1/present/launch",
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
  "Element",
  "Node",
  "Event",
  "KeyboardEvent",
  "MessageEvent",
  "DocumentFragment",
  "Text",
  "sessionStorage",
  "localStorage",
])
  (globalThis as Record<string, unknown>)[k] =
    k === "window" ? win : (win as unknown as Record<string, unknown>)[k];
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
mock.module("@/auth/SupabaseAuthProvider", () => ({
  useCockpitAuth: () => ({ client: null }),
}));

const { createRoot } = await import("react-dom/client");
const { act } = await import("react");
const { FIXTURES, seededVideos } = await import(
  "../src/practice/fixtures/fixtures"
);
const { emptyLive } = await import("../src/present/channel");
const { deckData } = await import("../src/present/deckData");
const { DeckShell } = await import("../src/present/DeckShell");
const { keyCommand, withPlayer } = await import("../src/present/engine");
const { groupLinks } = await import("../src/present/controls");
const { partText } = await import("../src/present/launchControls");
const S = await import("../src/present/sources");
const V = await import("../src/present/videos");

type DeckData = import("../src/present/deckData").DeckData;
type FixtureKey = import("../src/practice/fixtures/fixtures").FixtureKey;
type SlideDef = import("../src/present/deckContext").SlideDef;
type DeckKind = import("../src/present/sources").DeckKind;
type DeckVideos = import("../src/present/sources").DeckVideos;
type VideoRow = import("../src/present/sources").VideoRow;

const NOW = new Date("2026-10-19T09:00:00Z");
const repo = resolve(import.meta.dir, "..", "..", "..");

function data(
  key: FixtureKey,
  deck: DeckKind = "launch",
  lang: "en" | "ar" = "en",
  videos?: DeckVideos | null,
): DeckData {
  const f = FIXTURES[key](deck);
  return deckData({
    taskId: `fixture-${key}`,
    deck,
    lang,
    sources: f.sources,
    kit: f.kit,
    prep: f.prep,
    ads: f.ads,
    publicUrl: (_b, p) => p,
    videos: videos === undefined ? f.videos : videos,
    videosProblem: f.videosProblem,
    now: NOW,
  });
}

const row = (over: Partial<VideoRow>): VideoRow => ({
  deck: "launch",
  slotKey: "testing",
  lang: "any",
  provider: "loom",
  url: "https://www.loom.com/share/0f0e0d0c0b0a09080706050403020100",
  embedUrl:
    "https://www.loom.com/embed/0f0e0d0c0b0a09080706050403020100?hideEmbedTopBar=true",
  title: null,
  durationSeconds: 160,
  revision: 1,
  updatedBy: "csm@maharamedia.com",
  updatedAt: "2026-10-20T12:00:00+00:00",
  ...over,
});
const slot = (deck: DeckKind, key: string) => {
  const s = V.VIDEO_SLOTS.find(x => x.deck === deck && x.key === key);
  if (!s) throw Error(`no slot ${deck}:${key}`);
  return s;
};

describe("the registry", () => {
  test("twelve slots, the same keys and order as the migration's list", () => {
    const keys = V.VIDEO_SLOTS.map(V.slotId);
    expect(keys.length).toBe(12);
    // The SQL file the backend ships, else the contract it is built from.
    const sql = resolve(
      repo,
      "supabase/migrations/20261020120000_csm_deck_videos.sql",
    );
    const source = existsSync(sql)
      ? readFileSync(sql, "utf8")
      : readFileSync(resolve(repo, "docs/csm-decks/VIDEOS.md"), "utf8");
    const body =
      source.match(
        /cockpit_csm_deck_video_slots\(\)[\s\S]*?ARRAY\[([\s\S]*?)\]::text\[\]/,
      )?.[1] ?? "";
    const theirs = [...body.matchAll(/'([a-z0-9-]+:[a-z0-9-]+)'/g)].map(
      m => m[1],
    );
    expect(theirs).toEqual(keys);
  });

  test("each slot sits on a slide of its deck, and has a title in both languages", async () => {
    const { launchSlides } = await import("../src/present/launchDeck");
    const { onboardingSlides } = await import("../src/present/onboardingDeck");
    const ids: Record<DeckKind, string[]> = {
      launch: launchSlides().map(s => s.id),
      onboarding: onboardingSlides().map(s => s.id),
    };
    for (const s of V.VIDEO_SLOTS) {
      expect(ids[s.deck]).toContain(s.slide);
      const t = V.slotTitle(s);
      expect(t.en.length).toBeGreaterThan(3);
      expect(t.ar).toMatch(/[\u0600-\u06FF]/);
      expect(t.en.length).toBeLessThanOrEqual(40);
    }
    // In slide order, deck by deck.
    for (const deck of ["onboarding", "launch"] as DeckKind[]) {
      const order = V.deckSlots(deck).map(s => ids[deck].indexOf(s.slide));
      expect([...order].sort((a, b) => a - b)).toEqual(order);
    }
    // No slot on the slides about this client alone, the covers or training.
    for (const id of [
      "goals",
      "one-service",
      "ads",
      "form",
      "cover",
      "green-light",
      "training",
    ])
      expect(V.VIDEO_SLOTS.some(s => s.slide === id)).toBe(false);
  });
});

describe("which recording a slot uses", () => {
  const read = (rows: VideoRow[], refused: DeckVideos["refused"] = []) => ({
    videos: { rows, refused, slots: [] },
    problem: null,
  });
  const dfy = { dwy: false, os: false };
  test("the deck's language first, then any language; the other only offered", () => {
    const s = slot("launch", "portal-guide");
    const en = row({ slotKey: "portal-guide", lang: "en" });
    const ar = row({ slotKey: "portal-guide", lang: "ar" });
    const any = row({ slotKey: "portal-guide", lang: "any" });
    expect(V.slotState(s, read([en, ar, any]), "ar", dfy)).toEqual({
      kind: "filled",
      row: ar,
    });
    expect(V.slotState(s, read([en, any]), "ar", dfy)).toEqual({
      kind: "filled",
      row: any,
    });
    // Only English recorded, and the deck in Arabic: nothing on the canvas.
    expect(V.slotState(s, read([en]), "ar", dfy)).toEqual({
      kind: "empty",
      other: en,
    });
    expect(V.slotState(s, read([]), "en", dfy)).toEqual({
      kind: "empty",
      other: null,
    });
  });
  test("done with you: done-for-you slots hide, Mahara OS ones wait for approval", () => {
    const rows = read([
      row({ slotKey: "call-team" }),
      row({ slotKey: "portal-guide" }),
    ]);
    expect(
      V.slotState(slot("launch", "call-team"), rows, "en", {
        dwy: true,
        os: true,
      }),
    ).toEqual({ kind: "hidden", why: "dwy" });
    expect(
      V.slotState(slot("launch", "portal-guide"), rows, "en", {
        dwy: true,
        os: false,
      }),
    ).toEqual({ kind: "hidden", why: "os" });
    expect(
      V.slotState(slot("launch", "portal-guide"), rows, "en", {
        dwy: true,
        os: true,
      }).kind,
    ).toBe("filled");
    expect(
      V.slotState(slot("launch", "testing"), read([row({})]), "en", {
        dwy: true,
        os: false,
      }).kind,
    ).toBe("filled");
  });
  test("missing is never zero: unread and refused are not 'not recorded'", () => {
    expect(
      V.slotState(
        slot("launch", "testing"),
        { videos: null, problem: "offline" },
        "en",
        dfy,
      ),
    ).toEqual({ kind: "unread", reason: "offline" });
    expect(
      V.slotState(
        slot("launch", "testing"),
        read([], [{ slotKey: "testing", lang: "any" }]),
        "en",
        dfy,
      ),
    ).toEqual({ kind: "refused", lang: "any" });
  });
  test("the harness fixtures: some filled, some empty, one never read", () => {
    const full = data("full");
    expect(V.filledOn(full, "creative-freedom").length).toBe(1);
    expect(V.filledOn(full, "your-part").length).toBe(1);
    expect(V.filledOn(full, "journey").length).toBe(0);
    expect(V.filledOn(data("full", "onboarding"), "this-week").length).toBe(2);
    // Done with you: the done-for-you guide is hidden until Mahara OS is approved.
    expect(V.slideVideos(data("dwy"), "portal")[0].state.kind).toBe("hidden");
    expect(
      V.slideVideos(data("sparse"), "creative-freedom")[0].state.kind,
    ).toBe("unread");
    expect(
      V.slideVideos(data("starter"), "creative-freedom")[0].state.kind,
    ).toBe("empty");
  });
});

describe("lengths", () => {
  test("English: m:ss; none on file: nothing, never 0:00", () => {
    expect(V.lengthText(160, "en")).toBe("2:40");
    expect(V.lengthText(11, "en")).toBe("0:11");
    expect(V.lengthText(277, "en")).toBe("4:37");
    expect(V.lengthText(null, "en")).toBeNull();
    expect(V.lengthText(0, "en")).toBeNull();
  });
  test("Arabic: in words, rounded to the minute, never m:ss", () => {
    const ar = (s: number) => V.lengthText(s, "ar");
    expect(ar(11)).toBe("أقل من دقيقة");
    expect(ar(94)).toBe("دقيقتين");
    expect(ar(148)).toBe("دقيقتين");
    expect(ar(160)).toBe("٣ دقايق");
    expect(ar(231)).toBe("٤ دقايق");
    expect(ar(277)).toBe("٥ دقايق");
    expect(ar(285)).toBe("٥ دقايق");
    expect(ar(45)).toBe("دقيقة");
    expect(ar(660)).toBe("١١ دقيقة");
    for (const s of [5, 59, 61, 600, 3599, 10800])
      expect(ar(s) ?? "").not.toMatch(/[:0-9]|(?<![٠-٩])٠(?![٠-٩])/);
  });
  test("prep's m:ss field", () => {
    expect(V.parseClock("2:40")).toBe(160);
    expect(V.parseClock(" 1:02:03 ")).toBe(3723);
    expect(V.parseClock("")).toBeNull();
    expect(Number.isNaN(V.parseClock("2.40") as number)).toBe(true);
    expect(Number.isNaN(V.parseClock("2:75") as number)).toBe(true);
  });
});

describe("the recap", () => {
  test("only filled slots shown for this client, in the deck's language, the link people open", () => {
    const recap = V.recapVideos(data("full", "launch", "en")) ?? "";
    expect(recap.split("\n")[0]).toBe("Missed something on the call? Watch:");
    expect(recap).toContain(
      "- Why we test so many ads: https://www.loom.com/share/0f0e0d0c0b0a09080706050403020100",
    );
    expect(recap).toContain(
      "- The Mahara OS guide: https://fast.wistia.net/embed/iframe/lxlse6ckhf",
    );
    expect(recap).not.toContain("hyuxh7skjv");
    expect(recap).not.toContain("?seo=false");
    expect(recap).not.toContain("hideEmbedTopBar");
    // In slide order: testing (slide 3) before the guide (9) before the calendar (10).
    expect(recap.indexOf("test so many")).toBeLessThan(
      recap.indexOf("Mahara OS guide"),
    );
    expect(recap.indexOf("Mahara OS guide")).toBeLessThan(
      recap.indexOf("Blocking hours"),
    );
    const ar = V.recapVideos(data("full", "launch", "ar")) ?? "";
    expect(ar.split("\n")[0]).toBe("فاتكم شي بالمكالمة؟ شوفوا:");
    expect(ar).toContain("hyuxh7skjv");
    expect(ar).not.toContain("lxlse6ckhf");
    // Filled without isolates: each link one clickable run.
    expect(ar).not.toMatch(/[\u2066-\u2069]/);
  });
  test("none recorded, or never read: the block is left out", () => {
    expect(V.recapVideos(data("starter"))).toBeNull();
    expect(V.recapVideos(data("sparse"))).toBeNull();
    expect(partText(data("starter"))).not.toContain("Watch:");
    expect(groupLinks(data("sparse", "onboarding")).text).not.toContain(
      "Watch:",
    );
  });
  test("done with you: a done-for-you slot is left out of the recap too", () => {
    const rows = seededVideos("launch", [
      row({ slotKey: "call-team" }),
      row({ slotKey: "testing" }),
    ]);
    const recap = V.recapVideos(data("dwy", "launch", "en", rows)) ?? "";
    expect(recap).toContain("Why we test so many ads");
    expect(recap).not.toContain("How our call team works");
    expect(recap).not.toContain("Mahara OS guide");
  });
  test("the launch recap: the jobs, how we test, the course, then the videos", () => {
    const text = partText(data("full"));
    const at = (s: string) => text.indexOf(s);
    expect(at("How we test your ads:")).toBeGreaterThan(
      at("Keep your Drive folder fed"),
    );
    expect(at("Before your first meetings:")).toBeGreaterThan(
      at("How we test your ads:"),
    );
    expect(at("Missed something on the call? Watch:")).toBeGreaterThan(
      at("Before your first meetings:"),
    );
    expect(text.trimEnd().split("\n").at(-1)).toMatch(
      /^- Blocking hours in your calendar: https:\/\/www\.loom\.com\/share\//,
    );
  });
  test("who does what stands in for the three unrecorded launch videos, and goes once they are", () => {
    // Day one: start-to-finish, call-team and winning are not recorded.
    const text = partText(data("full"));
    expect(text).toContain(
      "Who does what: we bring the enquiries, call them within 5 minutes during working hours, book and remind them, and rebook anyone who doesn't show. You hold the meeting and win the project.",
    );
    expect(text.indexOf("Who does what:")).toBeLessThan(
      text.indexOf("Before your meetings:"),
    );
    expect(partText(data("dwy"))).toContain(
      "Who does what: we bring the enquiries. Your team calls them within 5 minutes",
    );
    expect(partText(data("full", "launch", "ar"))).toContain(
      "مين يسوي إيش: نجيب لكم الاستفسارات",
    );
    // One still missing keeps it; all three recorded drops it.
    const two = seededVideos("launch", [
      row({ slotKey: "start-to-finish" }),
      row({ slotKey: "call-team" }),
    ]);
    expect(partText(data("full", "launch", "en", two))).toContain(
      "Who does what:",
    );
    const three = seededVideos("launch", [
      row({ slotKey: "start-to-finish" }),
      row({ slotKey: "call-team" }),
      row({ slotKey: "winning" }),
    ]);
    expect(partText(data("full", "launch", "en", three))).not.toContain(
      "Who does what:",
    );
  });
  test("the onboarding links carry O7's testing plant until its video is recorded", () => {
    const line =
      "Your ads are there to bring in business. We test many ads, fast, and small style changes go into the next round. Send your red lines in the group.";
    // Not recorded: the line, after the links and before the videos.
    const seeds = seededVideos("onboarding");
    const text = groupLinks(data("full", "onboarding", "en", seeds)).text;
    expect(text).toContain(line);
    expect(text.indexOf(line)).toBeGreaterThan(
      text.indexOf("Install Mahara OS"),
    );
    expect(text.indexOf(line)).toBeLessThan(text.indexOf("Watch:"));
    expect(groupLinks(data("sparse", "onboarding")).text).toContain(line);
    // Recorded (the full fixture's testing video): the video says it.
    expect(groupLinks(data("full", "onboarding")).text).not.toContain(line);
  });
  test("the onboarding group links end with the onboarding deck's videos", () => {
    const text = groupLinks(data("full", "onboarding")).text;
    expect(text).toContain("Missed something on the call? Watch:");
    expect(text).toContain(
      "- Welcome to Mahara: https://fast.wistia.net/embed/iframe/up0z6n691k",
    );
    expect(text).toContain("- Meta access: https://www.loom.com/share/");
    expect(text).toContain(
      "- WhatsApp and calendar: https://www.loom.com/share/",
    );
    expect(text.indexOf("Watch:")).toBeGreaterThan(
      text.indexOf("Install Mahara OS"),
    );
  });
});

describe("the frame's address (the server builds the embed; the deck adds autoplay)", () => {
  const rows: Record<string, VideoRow> = {
    youtube: row({
      provider: "youtube",
      url: "https://www.youtube.com/watch?v=Hgj_fCJpBd0",
      embedUrl:
        "https://www.youtube-nocookie.com/embed/Hgj_fCJpBd0?rel=0&playsinline=1&enablejsapi=1",
    }),
    vimeo: row({
      provider: "vimeo",
      url: "https://vimeo.com/76979871",
      embedUrl: "https://player.vimeo.com/video/76979871?dnt=1",
    }),
    wistia: row({
      provider: "wistia",
      url: "https://fast.wistia.net/embed/iframe/lxlse6ckhf",
      embedUrl: "https://fast.wistia.net/embed/iframe/lxlse6ckhf?seo=false",
    }),
    loom: row({}),
    drive: row({
      provider: "drive",
      url: "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWx/view",
      embedUrl:
        "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWx/preview",
    }),
  };
  test("each provider, with the deck's autoplay set through URL, never by concatenation", () => {
    const on = (k: string) =>
      V.frameSrc(rows[k], {
        autoplay: true,
        origin: "https://cockpit.maharamedia.com",
      });
    expect(on("youtube")).toBe(
      "https://www.youtube-nocookie.com/embed/Hgj_fCJpBd0?rel=0&playsinline=1&enablejsapi=1&autoplay=1&origin=https%3A%2F%2Fcockpit.maharamedia.com",
    );
    expect(on("vimeo")).toBe(
      "https://player.vimeo.com/video/76979871?dnt=1&autoplay=1",
    );
    expect(on("wistia")).toBe(
      "https://fast.wistia.net/embed/iframe/lxlse6ckhf?seo=false&autoPlay=true",
    );
    // Loom and Drive open on their own play button.
    expect(on("loom")).toBe(rows.loom.embedUrl);
    expect(on("drive")).toBe(rows.drive.embedUrl);
    // Prep's check adds nothing.
    for (const k of Object.keys(rows))
      expect(V.frameSrc(rows[k], { autoplay: false })).toBe(rows[k].embedUrl);
  });
  test("an address off its provider's own host is never framed", () => {
    expect(
      V.frameSrc(
        { provider: "youtube", embedUrl: "https://evil.example.org/embed/x" },
        { autoplay: true },
      ),
    ).toBeNull();
    expect(
      V.frameSrc(
        {
          provider: "loom",
          embedUrl: "https://www.youtube-nocookie.com/embed/x",
        },
        { autoplay: true },
      ),
    ).toBeNull();
    expect(
      V.frameSrc(
        { provider: "wistia", embedUrl: "javascript:alert(1)" },
        { autoplay: true },
      ),
    ).toBeNull();
    expect(
      V.frameSrc(
        {
          provider: "vimeo",
          embedUrl: "https://user@player.vimeo.com/video/1",
        },
        { autoplay: true },
      ),
    ).toBeNull();
  });
  test("the browser's row shape: the five providers' hosts only, https, no user or port", () => {
    for (const r of Object.values(rows))
      expect(S.videoRow.safeParse(r).success).toBe(true);
    const bad = [
      { url: "http://www.loom.com/share/0f0e0d0c0b0a09080706050403020100" },
      { url: "https://www.loom.com.example.org/share/x" },
      { url: "https://evil.org/x" },
      { embedUrl: "https://www.loom.com:8443/embed/x" },
      { embedUrl: "https://user@www.loom.com/embed/x" },
      { embedUrl: "javascript:alert(1)" },
      { embedUrl: "https://fast.wistia.net/embed/iframe/lxlse6ckhf" }, // a Loom row framing Wistia
      { provider: "dropbox" as never },
      { revision: 0 },
    ];
    for (const b of bad)
      expect(S.videoRow.safeParse(row(b)).success).toBe(false);
  });
  test("a poster only from the provider's picture hosts; any other reads as none, and the row still plays", () => {
    const loom =
      "https://cdn.loom.com/sessions/thumbnails/e2d83bffee614d9aa035d898d37d8989-b17bc3f4ce782f9b.jpg";
    expect(S.videoRow.parse(row({ posterUrl: loom })).posterUrl).toBe(loom);
    for (const other of [
      "https://evil.org/x.jpg",
      "http://cdn.loom.com/x.jpg",
      "https://cdn.loom.com.example.org/x.jpg",
    ]) {
      const r = S.videoRow.safeParse(row({ posterUrl: other }));
      expect(r.success).toBe(true);
      expect(r.data?.posterUrl).toBeNull();
    }
    expect(S.videoRow.parse(row({})).posterUrl).toBeUndefined();
  });
  test("a read keeps good rows and sets refused ones apart, never as empty", () => {
    const out = S.videosFrom({
      rows: [
        row({}),
        { ...row({ slotKey: "payments" }), embedUrl: "https://evil.org/x" },
        { junk: 1 },
      ],
      slots: ["launch:testing"],
      at: "2026-10-20T12:00:00+00:00",
    });
    expect(out.rows.length).toBe(1);
    expect(out.refused).toEqual([
      { slotKey: "payments", lang: "any", revision: 1 },
    ]);
    expect(out.slots).toEqual(["launch:testing"]);
  });
  test("a refused row is saved again with its own revision, never 0", () => {
    // The server still holds the row, so revision 0 would conflict (40001)
    // on every try, while the deck tells the CSM to save it again in prep.
    const out = S.videosFrom({
      rows: [
        {
          ...row({ slotKey: "payments", revision: 3 }),
          embedUrl: "https://evil.org/x",
        },
        // A revision the browser cannot read still leaves the row refused.
        { ...row({ slotKey: "winning" }), url: "x", revision: "3" },
      ],
      slots: [],
    });
    expect(out.refused).toEqual([
      { slotKey: "payments", lang: "any", revision: 3 },
      { slotKey: "winning", lang: "any", revision: undefined },
    ]);
    const payments = slot("launch", "payments");
    expect(V.saveRevision(out, payments, "any")).toBe(3);
    expect(V.saveRevision(out, payments, "en")).toBe(0);
    expect(V.saveRevision(out, slot("launch", "winning"), "any")).toBe(0);
    // A good row's own revision comes first.
    expect(
      V.saveRevision(
        {
          rows: [row({ slotKey: "payments", revision: 5 })],
          refused: out.refused,
        },
        payments,
        "any",
      ),
    ).toBe(5);
  });
});

describe("the calls", () => {
  const client = (answer: { data?: unknown; error?: unknown }) => {
    const calls: { fn: string; args: Record<string, unknown> }[] = [];
    return {
      calls,
      c: {
        rpc: (fn: string, args: Record<string, unknown>) => {
          calls.push({ fn, args });
          return Promise.resolve({
            data: answer.data ?? null,
            error: answer.error ?? null,
          });
        },
      } as unknown as import("../src/present/sources").DeckClient,
    };
  };
  test("read: the deck is required; functions not live yet is its own sentence", async () => {
    const ok = client({ data: { rows: [row({})], slots: [] } });
    await S.readDeckVideos(ok.c, "launch");
    expect(ok.calls[0]).toEqual({
      fn: "cockpit_csm_deck_videos_read",
      args: { p_deck: "launch" },
    });
    const missing = client({
      error: { code: "PGRST202", message: "Could not find the function" },
    });
    await expect(S.readDeckVideos(missing.c, "launch")).rejects.toBeInstanceOf(
      S.VideosNotLive,
    );
    await expect(S.readDeckVideos(missing.c, "launch")).rejects.toThrow(
      "The deck's videos are not live yet, so no video shows.",
    );
  });
  test("save: named arguments, the read's revision, and each refusal under its field", async () => {
    const ok = client({ data: { ...row({}), changed: true } });
    await S.saveDeckVideo(ok.c, {
      deck: "launch",
      slotKey: "testing",
      lang: "any",
      url: "https://www.loom.com/share/0f0e0d0c0b0a09080706050403020100",
      revision: 0,
    });
    expect(ok.calls[0].fn).toBe("cockpit_csm_deck_video_save");
    expect(ok.calls[0].args).toEqual({
      p_deck: "launch",
      p_slot_key: "testing",
      p_lang: "any",
      p_url: "https://www.loom.com/share/0f0e0d0c0b0a09080706050403020100",
      p_title: null,
      p_duration_seconds: null,
      p_revision: 0,
    });
    const cases: [string, string, string | null][] = [
      ["22023", "Use the https link.", "link"],
      [
        "22023",
        "Paste a link from Loom, YouTube, Wistia, Vimeo or Google Drive.",
        "link",
      ],
      [
        "22023",
        "That Drive link is a folder. Paste the link to the video file.",
        "link",
      ],
      [
        "22023",
        "That Loom link has no video in it. Copy the video's share link.",
        "link",
      ],
      ["22023", "That link is too long. Copy the video's share link.", "link"],
      ["22023", "Keep the title under 40 characters.", "title"],
      [
        "22023",
        "The title has a character it can't keep. Type it again.",
        "title",
      ],
      ["22023", "The length must be between 1 second and 3 hours.", "length"],
      ["22023", "Choose English, Arabic or any language.", "language"],
      ["22023", "Read the videos again, then save.", null],
      [
        "40001",
        "Someone else changed this video just now. Check it, then save again.",
        null,
      ],
      ["42501", "Active client-success access required", null],
    ];
    for (const [code, message, field] of cases) {
      const bad = client({ error: { code, message } });
      const e = await S.saveDeckVideo(bad.c, {
        deck: "launch",
        slotKey: "testing",
        lang: "any",
        url: "x",
        revision: 0,
      }).catch(x => x);
      expect(e).toBeInstanceOf(S.VideoSaveError);
      expect(e.message).toBe(message);
      expect(e.code).toBe(code);
      expect(e.field).toBe(field);
    }
  });
  test("clear: named arguments and its answer", async () => {
    const ok = client({
      data: {
        deck: "launch",
        slotKey: "testing",
        lang: "any",
        cleared: true,
        revision: 3,
      },
    });
    expect(
      await S.clearDeckVideo(ok.c, {
        deck: "launch",
        slotKey: "testing",
        lang: "any",
        revision: 2,
      }),
    ).toEqual({ cleared: true, revision: 3 });
    expect(ok.calls[0]).toEqual({
      fn: "cockpit_csm_deck_video_clear",
      args: {
        p_deck: "launch",
        p_slot_key: "testing",
        p_lang: "any",
        p_revision: 2,
      },
    });
  });
});

describe("the players' messages, as real frames posted them (2026-10-20)", () => {
  test("YouTube: ready, playing, and only its own block codes", () => {
    const yt = (s: string) => V.readPlayerMessage("youtube", s);
    expect(
      yt('{"event":"onReady","info":null,"channel":"widget","id":1}'),
    ).toBe("ready");
    expect(
      yt('{"event":"onStateChange","info":1,"channel":"widget","id":1}'),
    ).toBe("playing");
    expect(
      yt(
        '{"event":"infoDelivery","info":{"playerState":1,"currentTime":0.01},"channel":"widget","id":1}',
      ),
    ).toBe("playing");
    expect(yt('{"event":"onError","info":150,"channel":"widget","id":1}')).toBe(
      "blocked",
    );
    expect(yt('{"event":"onError","info":101,"channel":"widget","id":1}')).toBe(
      "blocked",
    );
    expect(
      yt('{"event":"onError","info":5,"channel":"widget","id":1}'),
    ).toBeNull();
    expect(
      yt('{"event":"onStateChange","info":2,"channel":"widget","id":1}'),
    ).toBeNull();
    expect(yt('{"event":"initialDelivery","info":{}}')).toBeNull();
    expect(yt("not json")).toBeNull();
  });
  test("Vimeo: ready and play; a playback hiccup is not a block", () => {
    const vm = (s: unknown) => V.readPlayerMessage("vimeo", s);
    expect(vm('{"event":"ready"}')).toBe("ready");
    expect(vm({ event: "play", data: { seconds: 0 } })).toBe("playing");
    expect(
      vm(
        '{"event":"error","data":{"message":"An error occurred during playback.","name":"PlaybackError"}}',
      ),
    ).toBeNull();
    expect(vm('{"event":"error","data":{"name":"PrivacyError"}}')).toBe(
      "blocked",
    );
    expect(vm('{"event":"drminitfailed"}')).toBeNull();
  });
  test("Wistia: its iframe's hello and its play triggers; it never reports a block", () => {
    const w = (s: string) => V.readPlayerMessage("wistia", s);
    expect(w("new-wistia-iframe")).toBe("ready");
    expect(
      w('{"method":"_trigger","args":["play",{"source":"non-user-event"}]}'),
    ).toBe("playing");
    expect(
      w('{"method":"_trigger","args":["statechange","playing","beforeplay"]}'),
    ).toBe("playing");
    expect(
      w('{"method":"_trigger","args":["statechange","beforeplay",null]}'),
    ).toBeNull();
    expect(w('{"method":"_trigger","args":["playpending",{}]}')).toBeNull();
    expect(w('{"method":"_trigger","args":["error"]}')).toBeNull();
  });
  test("Loom and Drive are never read (their ready looks like a video either way)", () => {
    expect(
      V.readPlayerMessage(
        "loom",
        '{"context":"player.js","version":"0.0.11","event":"ready"}',
      ),
    ).toBeNull();
    expect(V.readPlayerMessage("drive", '{"event":"ready"}')).toBeNull();
  });
  test("a message counts only from that player's own frame and its provider's exact origin", () => {
    const frame = {};
    expect(
      V.ownMessage(
        { origin: "https://fast.wistia.net", source: frame },
        "wistia",
        frame,
      ),
    ).toBe(true);
    expect(
      V.ownMessage(
        { origin: "https://fast.wistia.net", source: {} },
        "wistia",
        frame,
      ),
    ).toBe(false);
    expect(
      V.ownMessage(
        { origin: "https://evil.org", source: frame },
        "wistia",
        frame,
      ),
    ).toBe(false);
    expect(
      V.ownMessage(
        { origin: "https://www.youtube.com", source: frame },
        "youtube",
        frame,
      ),
    ).toBe(false);
    expect(
      V.ownMessage(
        { origin: "https://fast.wistia.net", source: null },
        "wistia",
        null,
      ),
    ).toBe(false);
  });
  test("what the deck posts after the load, to the exact origin", () => {
    expect(V.PROVIDER_ORIGIN).toEqual({
      youtube: "https://www.youtube-nocookie.com",
      vimeo: "https://player.vimeo.com",
      wistia: "https://fast.wistia.net",
      loom: "https://www.loom.com",
      drive: "https://drive.google.com",
    });
    expect(JSON.parse(V.handshake("youtube")[0] as string)).toMatchObject({
      event: "listening",
    });
    expect(V.handshake("vimeo")).toEqual([
      { method: "addEventListener", value: "play" },
      { method: "addEventListener", value: "error" },
    ]);
    for (const p of ["wistia", "loom", "drive"] as const)
      expect(V.handshake(p)).toEqual([]);
  });
});

describe("the player's states (DESIGN 21.3)", () => {
  test("a stubbed Wistia frame that loads and sends nothing stays up, never failed or blocked", () => {
    let p = V.playerStep("loading", { type: "load" });
    expect(p).toBe("ready");
    p = V.playerStep(p, { type: "timeout" });
    p = V.playerStep(p, { type: "offline" });
    expect(p).toBe("ready");
  });
  test("only a frame that never loads fails; only the provider's error blocks", () => {
    expect(V.playerStep("loading", { type: "timeout" })).toBe("failed");
    expect(V.playerStep("loading", { type: "offline" })).toBe("failed");
    expect(V.playerStep("ready", { type: "signal", signal: "blocked" })).toBe(
      "blocked",
    );
    expect(V.playerStep("loading", { type: "signal", signal: "ready" })).toBe(
      "ready",
    );
    expect(V.playerStep("ready", { type: "signal", signal: "playing" })).toBe(
      "playing",
    );
    // "Playing" only after the play event; a late load never takes it back.
    expect(V.playerStep("playing", { type: "load" })).toBe("playing");
    expect(V.playerStep("failed", { type: "load" })).toBe("failed");
  });
});

describe("the keys (DESIGN 21.6)", () => {
  test("V plays or closes; Esc closes the player first; a move key only closes it", () => {
    expect(keyCommand({ key: "v" })).toBe("video");
    expect(keyCommand({ key: "V" })).toBe("video");
    expect(keyCommand({ key: "v", tag: "INPUT" })).toBe("none");
    expect(keyCommand({ key: "Escape", panel: true })).toBe("close");
    expect(keyCommand({ key: "Escape" })).toBe("none");
    for (const k of [
      "ArrowRight",
      "ArrowLeft",
      " ",
      "PageDown",
      "PageUp",
      "Home",
      "End",
    ])
      expect(withPlayer(keyCommand({ key: k }))).toBe("close");
    expect(withPlayer("lang")).toBe("lang");
  });
});

// ------------------------------------------------- on a mounted deck

const host = win.document.createElement("div");
win.document.body.append(host);
const root = createRoot(host as unknown as Element);
afterAll(async () => {
  await act(async () => root.unmount());
});

const plain = (id: string): SlideDef => ({
  id,
  title: { en: id, ar: id },
  notes: { say: ["x"], sayAr: ["x"] },
  render: () => <div className="probe">{id}</div>,
});

async function mount(d: DeckData, ids: string[], onBack = () => {}) {
  win.location.hash = "";
  await act(async () => {
    root.render(
      <DeckShell
        slides={ids.map(plain)}
        base={{
          d,
          lang: d.lang,
          deck: d.deck,
          prep: {},
          prepOf: () => ({}),
          save: () => {},
          saveTo: () => {},
          live: emptyLive(),
          setLive: () => {},
          still: true,
          presenting: true,
        }}
        setLang={() => {}}
        onBack={onBack}
      />,
    );
  });
}
const q = (sel: string) => win.document.querySelector(sel);
const press = async (key: string) => {
  await act(async () => {
    win.dispatchEvent(new win.KeyboardEvent("keydown", { key, bubbles: true }));
  });
};

describe("the control and the player on the canvas", () => {
  test("an empty slot shows nothing on the client's canvas", async () => {
    await mount(data("starter"), ["creative-freedom", "form"]);
    expect(q(".dk-slide")?.getAttribute("data-slide")).toBe("creative-freedom");
    expect(q(".dkv-control")).toBeNull();
    expect(win.document.body.textContent).not.toMatch(/Watch|Not recorded/);
    // V with nothing recorded does nothing.
    await press("v");
    expect(q(".dkv-veil")).toBeNull();
  });

  test("never read: nothing on the canvas either", async () => {
    await mount(data("sparse"), ["creative-freedom"]);
    expect(q(".dkv-control")).toBeNull();
  });

  test("a filled slot shows the quiet control, its title and length", async () => {
    await mount(data("full"), ["creative-freedom", "form"]);
    const c = q(".dkv-control");
    expect(c).not.toBeNull();
    // One grammar for one video and for two: "Watch:" unlined, then the item.
    expect(c?.querySelector(".dkv-watch")?.textContent).toBe("Watch:");
    expect(c?.querySelector("button")?.textContent).toBe(
      "Why we test so many ads · 2:40",
    );
    expect(c?.querySelector("button")?.getAttribute("aria-label")).toBe(
      "Watch the video: Why we test so many ads, 2:40",
    );
  });

  test("onboarding slide 6: Watch: once, then its two videos", async () => {
    await mount(data("full", "onboarding"), ["this-week"]);
    const c = q(".dkv-control");
    expect(c?.querySelectorAll("button").length).toBe(2);
    expect((c?.textContent?.match(/Watch:/g) ?? []).length).toBe(1);
    expect(c?.textContent).toContain("Meta access · 1:34");
    expect(c?.textContent).toContain("WhatsApp and calendar · 3:51");
  });

  test("Arabic: شوفوا and the length in words", async () => {
    await mount(data("full", "launch", "ar"), ["portal"]);
    const c = q(".dkv-control");
    expect(c?.textContent).toContain("شوفوا:");
    expect(c?.textContent).toContain("دليل Mahara OS");
    expect(c?.textContent).toContain("٥ دقايق");
    expect(c?.textContent).not.toMatch(/\d:\d/);
  });

  test("V opens the overlay; Esc closes it and never leaves the deck", async () => {
    let left = false;
    await mount(data("full"), ["creative-freedom", "form"], () => {
      left = true;
    });
    await press("v");
    const veil = q(".dkv-veil");
    expect(veil).not.toBeNull();
    expect(q('[role="dialog"]')?.getAttribute("aria-modal")).toBe("true");
    const frame = q(".dkv-frame iframe");
    expect(frame?.getAttribute("src")).toBe(
      "https://www.loom.com/embed/0f0e0d0c0b0a09080706050403020100?hideEmbedTopBar=true",
    );
    expect(frame?.getAttribute("sandbox")).toBe(
      "allow-scripts allow-same-origin allow-presentation",
    );
    expect(frame?.getAttribute("allow")).toBe(
      "autoplay; fullscreen; picture-in-picture; encrypted-media",
    );
    expect(frame?.getAttribute("referrerpolicy")).toBe(
      "strict-origin-when-cross-origin",
    );
    // The slide under it is inert.
    expect(q(".dk-slide")?.hasAttribute("inert")).toBe(true);
    await press("Escape");
    expect(q(".dkv-veil")).toBeNull();
    expect(q(".dk-slide")?.getAttribute("data-slide")).toBe("creative-freedom");
    expect(left).toBe(false);
    // Esc again, with nothing open: still the deck.
    await press("Escape");
    expect(q(".dk-slide")).not.toBeNull();
    expect(left).toBe(false);
  });

  test("a move key with the player open closes it and does nothing else", async () => {
    await mount(data("full"), ["creative-freedom", "form"]);
    await press("V");
    expect(q(".dkv-veil")).not.toBeNull();
    await press("ArrowRight");
    expect(q(".dkv-veil")).toBeNull();
    expect(q(".dk-slide")?.getAttribute("data-slide")).toBe("creative-freedom");
    // The next press moves the deck.
    await press("ArrowRight");
    expect(q(".dk-slide")?.getAttribute("data-slide")).toBe("form");
  });

  test("V toggles; Close closes; the player is a dialog with its title", async () => {
    await mount(data("full"), ["your-part"]);
    await press("v");
    expect(q("#dkv-title")?.textContent).toBe(
      "Blocking hours in your calendar",
    );
    expect(q(".dkv-head")?.textContent).toContain("0:11");
    await press("v");
    expect(q(".dkv-veil")).toBeNull();
    await press("v");
    await act(async () => {
      (q(".dkv-close") as unknown as { click: () => void }).click();
    });
    expect(q(".dkv-veil")).toBeNull();
  });

  test("a done-for-you slot shows nothing on a done-with-you deck", async () => {
    const rows = seededVideos("launch", [row({ slotKey: "call-team" })]);
    await mount(data("dwy", "launch", "en", rows), ["call"]);
    expect(q(".dkv-control")).toBeNull();
    await mount(data("full", "launch", "en", rows), ["call"]);
    expect(q(".dkv-control")).not.toBeNull();
  });
});

describe("score round 3: a Loom row before its picture exists", () => {
  test("prep and the notes draw a designed poster, never the old one-line row", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const { VideoPoster } = await import("../src/present/VideoPoster");
    const loom = row({ posterUrl: null });
    const prep = renderToStaticMarkup(
      createElement(VideoPoster, {
        title: "How we test",
        row: loom,
        size: "prep",
      }),
    );
    expect(prep).toContain('data-video-poster="designed"');
    expect(prep).not.toContain("data-video-row");
    // In prep, the provider and the length over the title, as a title card.
    expect(prep).toContain("Loom · 2:40");
    expect(prep).toContain("How we test");
    const notes = renderToStaticMarkup(
      createElement(VideoPoster, {
        title: "How we test",
        row: loom,
        size: "notes",
      }),
    );
    expect(notes).toContain('data-video-poster="designed"');
    // The notes window's poster carries no words (22.13).
    expect(notes).not.toContain("How we test");
    expect(notes).not.toContain("Loom");
  });
});
