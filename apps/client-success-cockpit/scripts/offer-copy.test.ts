import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
// The offer page's own words: a plain module the page, the preview and
// these tests share.
import { STRINGS } from "../../../sites/offer/strings.js";
import { OFFER_CHROME } from "../src/present/offer/content/shared";
import {
  WEBSITE_DECK,
  WEBSITE_GET_KEYS,
  WEBSITE_KEY_SLIDES,
  WEBSITE_NEED_KEYS,
  WEBSITE_SLIDES,
  WEBSITE_STOPS,
} from "../src/present/offer/content/website";
import { WEBSITE_VIDEO } from "../src/present/offer/content/websiteVideo";

/**
 * The structure and form of every client line the upsell studio adds
 * (docs/upsell-studio/CONTENT.md): the seven offers' catalog copy in
 * 20261026x, the website deck (canvas and talk track), the website video,
 * the decks' shared chrome and the offer page's strings. The copy rules
 * themselves (no promise, outcome, lead, money or upsell word) run in the
 * database's own check, apps/media-buyer-cockpit/scripts/
 * upsell-copy-supabase.test.ts; this file pins the shapes the deck, the
 * proposal and the video build on, and the form rules that check does not
 * cover (Arabic digits, dialect words, lengths).
 */

const root = new URL("../../../", import.meta.url);
const read = (p: string) =>
  readFileSync(new URL(p, root), "utf8").replace(/\r\n/g, "\n");
const SQL = read("supabase/migrations/20261026x_upsell_catalog_copy.sql");
const APPROVAL = read("docs/upsell-studio/ARABIC-FOR-APPROVAL.md");

type Copy = Record<string, any>;
const CATALOG: Record<string, { en: Copy; ar: Copy }> = JSON.parse(
  SQL.match(/\$json\$([\s\S]*?)\$json\$/)?.[1] ?? "{}",
);

/** The seed's parts per offer (20261026u), in the written order. */
const PARTS: Record<string, string[]> = {
  website: ["build", "care"],
  second_campaign: ["monthly"],
  seo_geo: ["program"],
  smm: ["monthly"],
  cameraman: ["day"],
  ugc: ["package"],
  closer: ["placement", "management"],
};
const KEYS = [
  "name",
  "deckTitle",
  "line",
  "parts",
  "terms",
  "timing",
  "get",
  "need",
  "steps",
  "why",
  "button",
  "cta",
  "close",
  "work",
];
const CAPS: Record<string, number> = {
  name: 40,
  deckTitle: 40,
  line: 200,
  terms: 200,
  timing: 160,
  button: 40,
  cta: 80,
  close: 120,
};
const LISTS: Record<string, [number, number, number]> = {
  get: [1, 8, 200],
  need: [0, 4, 80],
  steps: [1, 6, 160],
  why: [1, 3, 400],
};

type Kind = "canvas" | "written" | "spoken";
type Leaf = {
  path: string;
  lang: "en" | "ar";
  kind: Kind;
  dialect?: "kw" | "sa";
  text: string;
};

/** Every string with its language, where it shows, and its dialect. */
function leaves(): Leaf[] {
  const out: Leaf[] = [];
  const pairs = (v: unknown, path: string, kind: Kind) => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) {
      v.forEach((x, i) => {
        pairs(x, `${path}[${i}]`, kind);
      });
      return;
    }
    const o = v as Record<string, unknown>;
    if (typeof o.en === "string" && typeof o.ar === "string") {
      out.push({ path: `${path}.en`, lang: "en", kind, text: o.en });
      out.push({ path: `${path}.ar`, lang: "ar", kind, text: o.ar });
      return;
    }
    for (const [k, x] of Object.entries(o)) pairs(x, `${path}.${k}`, kind);
  };
  const notes = (n: Record<string, string[] | undefined>, path: string) => {
    for (const [k, lines] of Object.entries(n))
      for (const [i, text] of (lines ?? []).entries()) {
        const dialect = /Kw$/.test(k) ? "kw" : /Sa$/.test(k) ? "sa" : undefined;
        out.push({
          path: `${path}.${k}[${i}]`,
          lang: dialect ? "ar" : "en",
          kind: "spoken",
          dialect,
          text,
        });
      }
  };
  // The catalog: the proposal page and the deck show these as written.
  for (const [offer, c] of Object.entries(CATALOG))
    for (const lang of ["en", "ar"] as const) {
      const walk = (v: unknown, path: string) => {
        if (typeof v === "string") {
          if (!/\.key$/.test(path))
            out.push({ path, lang, kind: "written", text: v });
        } else if (Array.isArray(v))
          v.forEach((x, i) => {
            walk(x, `${path}[${i}]`);
          });
        else if (v && typeof v === "object")
          for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
      };
      walk(c[lang], `catalog.${offer}.${lang}`);
    }
  // The website deck: the canvas, then the notes.
  pairs(WEBSITE_DECK.name, "deck.name", "canvas");
  pairs(WEBSITE_DECK.tab, "deck.tab", "canvas");
  for (const [id, s] of Object.entries(WEBSITE_DECK.slides)) {
    pairs(s.title, `deck.${id}.title`, "canvas");
    pairs(s.stops, `deck.${id}.stops`, "canvas");
    pairs(s.lines ?? {}, `deck.${id}.lines`, "canvas");
    notes(s.notes as never, `deck.${id}.notes`);
  }
  for (const group of ["branches", "objections", "price"] as const)
    for (const [k, n] of Object.entries(WEBSITE_DECK[group]))
      notes(n as never, `deck.${group}.${k}`);
  out.push({
    path: "deck.whatsapp.en",
    lang: "en",
    kind: "spoken",
    text: WEBSITE_DECK.whatsapp.en,
  });
  for (const d of ["kw", "sa"] as const)
    out.push({
      path: `deck.whatsapp.${d}`,
      lang: "ar",
      kind: "spoken",
      dialect: d,
      text: WEBSITE_DECK.whatsapp[d],
    });
  for (const [i, f] of WEBSITE_DECK.facts.entries())
    out.push({
      path: `deck.facts[${i}]`,
      lang: "en",
      kind: "spoken",
      text: f.text,
    });
  pairs(OFFER_CHROME, "chrome", "canvas");
  // The video: the narrator speaks, the labels are on screen.
  for (const b of WEBSITE_VIDEO.beats) {
    out.push({
      path: `video.${b.id}.vo.en`,
      lang: "en",
      kind: "spoken",
      text: b.vo.en,
    });
    out.push({
      path: `video.${b.id}.vo.ar`,
      lang: "ar",
      kind: "spoken",
      text: b.vo.ar,
    });
    for (const lang of ["en", "ar"] as const)
      for (const [i, text] of b.labels[lang].entries())
        out.push({
          path: `video.${b.id}.labels.${lang}[${i}]`,
          lang,
          kind: "canvas",
          text,
        });
  }
  pairs(WEBSITE_VIDEO.closing, "video.closing", "spoken");
  pairs(WEBSITE_VIDEO.poster, "video.poster", "canvas");
  // The offer page.
  for (const lang of ["en", "ar"] as const) {
    const walk = (v: unknown, path: string) => {
      if (typeof v === "string")
        out.push({ path, lang, kind: "written", text: v });
      else if (v && typeof v === "object")
        for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
    };
    walk(STRINGS[lang], `strings.${lang}`);
  }
  return out;
}

const ALL = leaves();
const EN = ALL.filter(l => l.lang === "en");
const AR = ALL.filter(l => l.lang === "ar");
const ARABIC = /[؀-ۿ]/;
const offenders = (list: Leaf[], re: RegExp) =>
  list.filter(l => re.test(l.text)).map(l => `${l.path}: ${l.text}`);
/** Arabic lines without the English stage directions in brackets. */
const said = (l: Leaf) => l.text.replace(/\([^)]*[A-Za-z][^)]*\)\s*/g, "");

describe("the catalog copy in 20261026x", () => {
  test("seven offers, each in English and Arabic, with every key and nothing else", () => {
    expect(Object.keys(CATALOG)).toEqual([
      "website",
      "second_campaign",
      "seo_geo",
      "smm",
      "cameraman",
      "ugc",
      "closer",
    ]);
    for (const [offer, c] of Object.entries(CATALOG)) {
      expect(Object.keys(c).sort()).toEqual(["ar", "en"]);
      const want = offer === "smm" ? [...KEYS, "platforms"] : KEYS;
      for (const lang of ["en", "ar"] as const)
        expect(Object.keys(c[lang]).sort()).toEqual([...want].sort());
    }
  });

  test("every text within its cap, the bill's names matching the seed's parts", () => {
    for (const [offer, c] of Object.entries(CATALOG))
      for (const lang of ["en", "ar"] as const) {
        const x = c[lang];
        for (const [k, cap] of Object.entries(CAPS)) {
          expect(typeof x[k]).toBe("string");
          expect(x[k].trim().length).toBeGreaterThan(0);
          expect([offer, lang, k, x[k].length <= cap]).toEqual([
            offer,
            lang,
            k,
            true,
          ]);
        }
        expect(Object.keys(x.parts)).toEqual(PARTS[offer]);
        for (const v of Object.values(x.parts) as string[])
          expect(v.length).toBeLessThanOrEqual(120);
        for (const [list, [lo, hi, cap]] of Object.entries(LISTS)) {
          expect(x[list].length).toBeGreaterThanOrEqual(lo);
          expect(x[list].length).toBeLessThanOrEqual(hi);
          for (const e of x[list]) {
            expect(e.key).toMatch(/^[a-z0-9_]{1,30}$/);
            expect(e.text.length).toBeLessThanOrEqual(cap);
            if (list === "why") expect(e.label.length).toBeLessThanOrEqual(60);
          }
        }
        // No site we built is cleared to show yet (CONTRACT decision 7).
        expect(x.work).toEqual([]);
        // A new proposal joins the steps a line each, within 400 characters.
        expect(
          x.steps.map((s: { text: string }) => s.text).join("\n").length,
        ).toBeLessThan(400);
      }
  });

  test("get, need, steps and why carry the same keys in the same order in both languages", () => {
    for (const c of Object.values(CATALOG))
      for (const list of ["get", "need", "steps", "why"]) {
        const keys = (lang: "en" | "ar") =>
          c[lang][list].map((e: { key: string }) => e.key);
        expect(keys("ar")).toEqual(keys("en"));
        expect(new Set(keys("en")).size).toBe(keys("en").length);
      }
  });

  test("social media names its four platforms in both languages", () => {
    for (const lang of ["en", "ar"] as const)
      expect(Object.keys(CATALOG.smm[lang].platforms).sort()).toEqual([
        "facebook",
        "instagram",
        "snapchat",
        "tiktok",
      ]);
  });

  test("the website deck's stops are the catalog's own website lines", () => {
    const keys = (list: string) =>
      CATALOG.website.en[list].map((e: { key: string }) => e.key);
    expect(keys("get")).toEqual([...WEBSITE_GET_KEYS]);
    expect(keys("need")).toEqual([...WEBSITE_NEED_KEYS]);
    // The closing question on slide 5 is the catalog's close.
    expect(WEBSITE_DECK.slides.next.stops.close).toEqual({
      en: CATALOG.website.en.close,
      ar: CATALOG.website.ar.close,
    });
  });

  test("the file creates and grants nothing, and guards its own writes", () => {
    const body = SQL.replace(/\$json\$[\s\S]*?\$json\$/, "");
    expect(body).not.toMatch(/\b(?:CREATE|GRANT|REVOKE|ALTER|DROP)\b/);
    expect(body).toMatch(/^BEGIN;$/m);
    expect(body).toMatch(/^COMMIT;$/m);
    expect(body).toContain("cockpit_client_copy_problems(s.t, false)");
    expect(body).toContain("was changed after this file was written");
  });
});

describe("the website deck", () => {
  test("the slide ids and their stops, in the contract's order", () => {
    expect([...WEBSITE_SLIDES]).toEqual([
      "saw",
      "matters",
      "get",
      "investment",
      "next",
    ]);
    expect(WEBSITE_KEY_SLIDES).toEqual({ runs: "h", proof: "p", video: "v" });
    expect(Object.keys(WEBSITE_DECK.slides)).toEqual([
      ...WEBSITE_SLIDES,
      ...Object.keys(WEBSITE_KEY_SLIDES),
    ]);
    expect(WEBSITE_STOPS.saw).toEqual(["capture", "cloud", "ask"]);
    expect(WEBSITE_STOPS.matters).toEqual(["words", "tie"]);
    expect(WEBSITE_STOPS.get).toEqual([
      "drawn",
      "pages",
      "portfolio",
      "whatsapp",
      "form",
      "tracking",
      "care",
      "need",
    ]);
    expect(WEBSITE_STOPS.investment).toEqual(["bill", "beside", "ask"]);
    expect(WEBSITE_STOPS.next).toEqual(["commit", "close"]);
    for (const [id, s] of Object.entries(WEBSITE_DECK.slides))
      expect([id, Object.keys(s.stops)]).toEqual([
        id,
        [...WEBSITE_STOPS[id as keyof typeof WEBSITE_STOPS]],
      ]);
  });

  test("titles fit in 40 characters; canvas lines in 90 (English) and 110 (Arabic)", () => {
    for (const s of Object.values(WEBSITE_DECK.slides)) {
      expect(s.title.en.length).toBeLessThanOrEqual(40);
      expect(s.title.ar.length).toBeLessThanOrEqual(40);
    }
    const long = ALL.filter(l => l.kind === "canvas").filter(
      l => l.text.length > (l.lang === "en" ? 90 : 110),
    );
    expect(long.map(l => `${l.path}: ${l.text}`)).toEqual([]);
  });

  test("every slide, branch, objection and price step speaks English, Kuwaiti and Saudi", () => {
    const all = [
      ...Object.entries(WEBSITE_DECK.slides).map(([k, s]) => [k, s.notes]),
      ...Object.entries(WEBSITE_DECK.branches),
      ...Object.entries(WEBSITE_DECK.objections),
      ...Object.entries(WEBSITE_DECK.price),
    ] as [string, { say: string[]; sayKw: string[]; saySa: string[] }][];
    for (const [k, n] of all) {
      expect([k, n.say.length > 0]).toEqual([k, true]);
      expect([k, n.sayKw.length > 0]).toEqual([k, true]);
      expect([k, n.saySa.length > 0]).toEqual([k, true]);
    }
    expect(Object.keys(WEBSITE_DECK.branches)).toEqual([
      "no_site",
      "broken",
      "working_on_it",
    ]);
    expect(Object.keys(WEBSITE_DECK.objections)).toEqual([
      "busy",
      "burned",
      "expensive",
    ]);
    expect(Object.keys(WEBSITE_DECK.price)).toEqual(["hold", "lower", "split"]);
  });

  test("the WhatsApp message carries the video, the next step and the name in all three", () => {
    for (const t of Object.values(WEBSITE_DECK.whatsapp)) {
      expect(t).toContain("{video}");
      expect(t).toContain("{next}");
      expect(t).toContain("{name}");
    }
  });

  test("every outside fact says where and when it was measured", () => {
    expect(WEBSITE_DECK.facts.length).toBeGreaterThan(0);
    for (const f of WEBSITE_DECK.facts) {
      expect(f.source.length).toBeGreaterThan(5);
      expect(f.year).toBeGreaterThan(1990);
      expect(["any", "KW", "SA", "AE", "QA", "BH"]).toContain(f.country);
    }
  });

  test("a lower price is said in the notes only, after full price is held", () => {
    const canvas = ALL.filter(
      l => l.path.startsWith("deck.") && l.kind === "canvas",
    );
    expect(offenders(canvas, /\{(?:final|build|care|project)\}/)).toEqual([]);
    expect(WEBSITE_DECK.price.lower.say.join(" ")).toContain("Held full price");
  });
});

describe("the website video", () => {
  test("five beats tile 0 to 60 seconds with no gap", () => {
    const b = WEBSITE_VIDEO.beats;
    expect(b.map(x => x.id)).toEqual(["hook", "gap", "what", "need", "return"]);
    expect(b[0].start).toBe(0);
    expect(b[b.length - 1].end).toBe(60);
    for (let i = 1; i < b.length; i++) expect(b[i].start).toBe(b[i - 1].end);
    expect(b.map(x => [x.start, x.end])).toEqual([
      [0, 5],
      [5, 15],
      [15, 35],
      [35, 45],
      [45, 60],
    ]);
    for (const x of b) {
      expect(x.vo.en.length).toBeGreaterThan(0);
      expect(x.vo.ar.length).toBeGreaterThan(0);
      expect(x.labels.ar.length).toBe(x.labels.en.length);
    }
    expect(WEBSITE_VIDEO.closing.en).toBe(
      "Your account manager will walk you through it.",
    );
  });

  test("the narration matches the lines the film was voiced from", () => {
    const film = JSON.parse(
      read("tools/offer-video/film/lines.json"),
    ) as Record<"en" | "ar", { beat: string; text: string }[]>;
    const norm = (s: string) =>
      s.replace(/…/g, "..").replace(/\s+/g, " ").trim();
    for (const lang of ["en", "ar"] as const)
      for (const b of WEBSITE_VIDEO.beats)
        expect([b.id, norm(b.vo[lang])]).toEqual([
          b.id,
          norm(
            film[lang]
              .filter(l => l.beat === b.id)
              .map(l => l.text)
              .join(" "),
          ),
        ]);
  });

  test("the return beat shows the deck's own words, and the film no figure", () => {
    const r = WEBSITE_VIDEO.beats[4];
    for (const lang of ["en", "ar"] as const)
      for (const k of ["item", "description", "typicalProject"] as const)
        expect(r.labels[lang]).toContain(OFFER_CHROME[k][lang]);
    // The card's "This" has no year and no figure beside it in the film.
    expect(r.labels.en).toContain("This");
    expect(OFFER_CHROME.thisFirstYear.en.startsWith("This")).toBe(true);
    // The only digits in the film: the two weeks and the thirty seconds,
    // both said in the narration too. Never a price, a count or a result.
    expect(
      offenders(
        ALL.filter(l => l.path.startsWith("video.")),
        /[0-9٠-٩]/,
      ).filter(
        x => !/: (?:2 weeks from your content|30 seconds|٣٠ ثانية)$/.test(x),
      ),
    ).toEqual([]);
  });

  test("every beat opens on the Example tag, and the poster names no client", () => {
    for (const b of WEBSITE_VIDEO.beats.slice(0, 4)) {
      expect(b.labels.en[0]).toBe("Example");
      expect(b.labels.ar[0]).toBe("مثال");
    }
    expect(WEBSITE_VIDEO.beats[4].labels.en[0]).toBe("Example");
    expect(WEBSITE_VIDEO.poster.en).not.toMatch(/\{/);
    expect(WEBSITE_VIDEO.poster.ar).not.toMatch(/\{/);
  });
});

describe("the chrome and the offer page's strings", () => {
  test("every chrome key the contract names", () => {
    expect(Object.keys(OFFER_CHROME).sort()).toEqual(
      [
        "revA",
        "revB",
        "captured",
        "searchedAs",
        "example",
        "yourFigure",
        "fromAnswer",
        "fromSheet",
        "item",
        "description",
        "terms",
        "dollars",
        "paidInFull",
        "typicalProject",
        "thisFirstYear",
        "howMany",
        "weNeed",
        "commitTitle",
        "fromMainProgramme",
        "oneTime",
        "monthly",
        "perDay",
        "per90",
      ].sort(),
    );
    // The revision letters stay Latin in Arabic, as Gulf drawings write them.
    expect(OFFER_CHROME.revA.ar).toBe("Rev A");
    expect(OFFER_CHROME.howMany).toEqual(
      WEBSITE_DECK.slides.investment.stops.ask,
    );
  });

  test("the page's strings: the contract's keys, the same in both languages", () => {
    const shape = (o: object): unknown =>
      Object.fromEntries(
        Object.entries(o).map(([k, v]) => [
          k,
          v && typeof v === "object" ? shape(v) : typeof v,
        ]),
      );
    expect(shape(STRINGS.ar)).toEqual(shape(STRINGS.en));
    expect(Object.keys(STRINGS.en).sort()).toEqual(
      [
        "proposalFor",
        "preparedBy",
        "validUntil",
        "found",
        "why",
        "get",
        "work",
        "runs",
        "investment",
        "dollars",
        "split",
        "paidInFull",
        "oneTime",
        "monthly",
        "perDay",
        "per90",
        "example",
        "captured",
        "searchedAs",
        "play",
        "playNote",
        "printLink",
        "states",
        "messageUs",
      ].sort(),
    );
    expect(Object.keys(STRINGS.en.states).sort()).toEqual(
      [
        "archived",
        "busy",
        "error",
        "expired",
        "loading",
        "unknown",
        "videoGone",
      ].sort(),
    );
    // An ended video link (the door's ?gone=1) has its own sentence, and the
    // error line fits a video link as well as a proposal (EDGE.md item 5).
    expect(STRINGS.en.states.videoGone).toBe(
      "This video link has ended. Message your account manager for a new one.",
    );
    expect(STRINGS.en.states.error).not.toMatch(/proposal/i);
    expect(STRINGS.ar.states.error).not.toContain("عرض السعر");
    expect(STRINGS.ar.states.videoGone).toContain("رابط الفيديو");
    // The plan's own words for a closed link.
    expect(STRINGS.en.states.expired).toBe(
      "This proposal has expired. Message your account manager for a new one.",
    );
    expect(STRINGS.en.states.archived).toBe(
      "This proposal is no longer active. Message your account manager.",
    );
  });

  test("slots are the documented ones, the same in both languages", () => {
    const SLOTS = new Set([
      "name",
      "date",
      "city",
      "build",
      "care",
      "final",
      "project",
      "video",
      "next",
      "url",
    ]);
    const used = ALL.flatMap(l =>
      [...l.text.matchAll(/\{([a-zA-Z0-9_.]+)\}/g)].map(
        m => `${l.path}: ${m[1]}`,
      ),
    );
    expect(used.filter(u => !SLOTS.has(u.split(": ")[1]))).toEqual([]);
    const slots = (s: string) =>
      [...s.matchAll(/\{([a-z]+)\}/g)].map(m => m[1]).sort();
    for (const [k, v] of Object.entries(STRINGS.en))
      if (typeof v === "string")
        expect([
          k,
          slots(STRINGS.ar[k as keyof typeof STRINGS.ar] as string),
        ]).toEqual([k, slots(v)]);
  });
});

describe("form, every line", () => {
  test("read whole: both languages, the notes and the video included", () => {
    expect(EN.length).toBeGreaterThan(300);
    expect(AR.length).toBeGreaterThan(300);
    expect(ALL.some(l => l.dialect === "kw")).toBe(true);
    expect(ALL.some(l => l.dialect === "sa")).toBe(true);
  });

  test("no em or en dash, no exclamation mark, plain quotes, no guillemets", () => {
    expect(offenders(ALL, /[—–―]|[!！]|[“”‘’]|[«»]/)).toEqual([]);
  });

  test("none of the humanizer's banned words", () => {
    expect(
      offenders(
        EN,
        /\b(?:unlock\w*|seamless\w*|elevat\w*|leverag\w*|journey|game[- ]changer|delve|empower\w*|supercharg\w*|unleash\w*|cutting[- ]edge|tapestry|testament)\b/i,
      ),
    ).toEqual([]);
  });

  test("never lead, upsell, renewal, CSM, a budget, a discount or a guarantee", () => {
    expect(
      offenders(
        EN,
        /\bleads?\b|\bup-?sell|\brenew|\bCSMs?\b|\bCPL\b|cost per lead|\bbudget|discount|guarant|money[- ]back|\bcontractors?\b/i,
      ),
    ).toEqual([]);
    expect(
      offenders(
        AR,
        /ليد|أب\s?سيل|تجديد|ميزانية|خصم|ضمان|نضمن|مضمون|مقاول|زيارة/,
      ),
    ).toEqual([]);
  });

  test("no call centre or appointment line, so done-with-you clients hear nothing that isn't theirs", () => {
    // The deck, the video, the offer page and every offer's catalog copy go
    // to every client the offer is pitched to, done-with-you clients
    // included. Cameraman day alone is left out: it books a filming day,
    // which is not an appointment.
    const shared = ALL.filter(
      l =>
        /^(?:deck|video|strings|catalog)\./.test(l.path) &&
        !l.path.startsWith("catalog.cameraman."),
    );
    expect(shared.some(l => l.path.startsWith("catalog.ugc."))).toBe(true);
    const en =
      /call cent(?:re|er)|appointments?|\bbook(?:ing|ed|s)?\b|\b(?:turn|show)(?:s|ed|ing)? up\b|\b(?:come|comes|coming|came) to (?:the|a|your) meeting\b/i;
    const ar =
      /كول سنتر|مركز الاتصال|موعد|مواعيد|حجز|(?:يجي|بيجي|يجون|بيجون|يحضر|بيحضر|يحضرون|بيحضرون)\s+(?:لل|ال|ل)?(?:اجتماع|موعد)/;
    // The lines this rule rewrote on 26 Oct would fail it.
    for (const old of [
      "decides whether they come to the meeting, or quietly go cold.",
      "Two videos to send people after they enquire or book",
    ])
      expect(en.test(old)).toBe(true);
    for (const old of [
      "هو اللي يقرر إذا بيجي للاجتماع ولا بيختفي بهدوء.",
      "بعد ما يستفسرون أو يحجزون",
    ])
      expect(ar.test(old)).toBe(true);
    // A first meeting the client holds with their own customer is theirs.
    expect(en.test("Send the link before a first meeting")).toBe(false);
    expect(offenders(shared, en)).toEqual([]);
    expect(offenders(shared, ar)).toEqual([]);
  });

  test("the client page and the video say your account manager, never a name or a title in its place", () => {
    const en = ALL.filter(
      l =>
        l.lang === "en" &&
        (l.path.startsWith("strings.") || l.path.startsWith("video.")),
    );
    expect(en.some(l => /your account manager/.test(l.text))).toBe(true);
    expect(offenders(en, /client success manager|\bCSM\b/i)).toEqual([]);
    // The Arabic title for one person is gendered: the page names the team.
    expect(
      ALL.filter(l => l.path.startsWith("strings.ar")).some(l =>
        l.text.includes("فريق نجاح العملاء"),
      ),
    ).toBe(true);
  });
});

describe("the Arabic", () => {
  test("every Arabic line is Arabic (the revision letters stay Latin)", () => {
    const bare = AR.filter(l => !ARABIC.test(said(l)));
    expect(bare.map(l => `${l.path}: ${l.text}`)).toEqual([
      "chrome.revA.ar: Rev A",
      "chrome.revB.ar: Rev B",
    ]);
  });

  test("Arabic-Indic digits only, never ٬, never a lone ٠, no digit glued to بـ or لـ", () => {
    expect(
      offenders(
        AR.map(l => ({ ...l, text: said(l) })),
        /[0-9]/,
      ),
    ).toEqual([]);
    expect(offenders(AR, /٬/)).toEqual([]);
    expect(offenders(AR, /(?<![٠-٩])٠(?![٠-٩])/)).toEqual([]);
    expect(offenders(AR, /(?:^|[\s،])[بل]ـ?[٠-٩]/)).toEqual([]);
    expect(offenders(AR, /[بل]ـ(?:\{|ال)/)).toEqual([]);
  });

  test("no quote marks around Arabic words, no middle dot", () => {
    expect(offenders(AR, /["'][^"']*[؀-ۿ][^"']*["']/)).toEqual([]);
    expect(offenders(AR, /·/)).toEqual([]);
  });

  test("white Gulf on screen and on the page: no dialect-only words", () => {
    const shown = AR.filter(l => l.kind !== "spoken");
    expect(
      offenders(
        shown,
        /(?:^|[\s،.])(?:شنو|شلون|ماكو|وايد|عيل|هني|جذي|باجر|وش|أبشر|إيش|طيب|زي)(?=$|[\s،.؟])/,
      ),
    ).toEqual([]);
  });

  test("Saudi lines never use Kuwaiti-only words, Kuwaiti lines never Saudi-only ones", () => {
    const sa = AR.filter(l => l.dialect === "sa").map(l => ({
      ...l,
      text: said(l),
    }));
    const kw = AR.filter(l => l.dialect === "kw").map(l => ({
      ...l,
      text: said(l),
    }));
    const word = (w: string) =>
      new RegExp(`(?:^|[\\s،.؟])(?:${w})(?=$|[\\s،.؟])`);
    expect(
      offenders(
        sa,
        word("شنو|شلون|ماكو|وايد|عيل|هني|جذي|باجر|معاي|معاكم|يديد|بيي"),
      ),
    ).toEqual([]);
    expect(offenders(kw, word("وش|إيش|ايش|أبشر|زي|كذا"))).toEqual([]);
  });

  test("the voice skill's rules: تمام never طيب, never مقاول", () => {
    expect(offenders(AR, /(?:^|[\s،.])طيب(?=$|[\s،.؟])/)).toEqual([]);
    expect(offenders(AR, /مقاول/)).toEqual([]);
  });

  test("every Arabic line is on the CEO's approval sheet, as written", () => {
    const missing = AR.filter(l => !APPROVAL.includes(l.text));
    expect(missing.map(l => `${l.path}: ${l.text}`)).toEqual([]);
  });
});
