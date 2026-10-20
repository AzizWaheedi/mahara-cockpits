import { describe, expect, test } from "bun:test";
import {
  ASK,
  bandFor,
  CONFIRMATION,
  LANDS_NOTES,
  PLACE_SAID,
  PLACE_WRITTEN,
  TO_GIVE,
  TURNS,
} from "../src/present/callScript";

/**
 * The example call's copy rules (docs/csm-decks/CONTENT.md copy rules and
 * Appendix A, EXAMPLE-CALL.md "Left out of the script on purpose"). The
 * call speaks a dialect and names the fictional customer's budget band on
 * purpose, so it has its own test beside deck-copy.test.ts: every line of
 * both dialects, the English subtitles, the pain variants, the
 * confirmation, the appointment card's notes and the "To give us" chips.
 */

type Line = { where: string; text: string; lang: "ar" | "en" };

function lines(): Line[] {
  const out: Line[] = [];
  for (const t of TURNS) {
    out.push({ where: `${t.at} kw`, text: t.kw, lang: "ar" });
    out.push({ where: `${t.at} sa`, text: t.sa, lang: "ar" });
    out.push({ where: `${t.at} en`, text: t.en, lang: "en" });
    for (const [k, v] of Object.entries(t.pain ?? {})) {
      out.push({ where: `${t.at} ${k} kw`, text: v.kw, lang: "ar" });
      out.push({ where: `${t.at} ${k} sa`, text: v.sa, lang: "ar" });
      out.push({ where: `${t.at} ${k} en`, text: v.en, lang: "en" });
    }
  }
  const pairs = [
    ...Object.values(CONFIRMATION),
    ...Object.values(PLACE_WRITTEN),
    LANDS_NOTES.planning,
    LANDS_NOTES.budget,
    LANDS_NOTES.customer,
    ...Object.values(LANDS_NOTES.pain),
    ...Object.values(ASK),
    TO_GIVE,
  ];
  for (const p of pairs) {
    out.push({ where: "card", text: p.en, lang: "en" });
    out.push({ where: "card", text: p.ar, lang: "ar" });
  }
  for (const p of Object.values(PLACE_SAID)) {
    out.push({ where: "place", text: p.en, lang: "en" });
    out.push({ where: "place", text: p.kw, lang: "ar" });
    out.push({ where: "place", text: p.sa, lang: "ar" });
  }
  for (const c of ["SA", "KW", "QA", "AE", "BH", null])
    for (const s of ["works", "build"] as const) {
      const b = bandFor(c, s, "kw");
      for (const p of [b.band, b.answer, b.note]) {
        out.push({ where: `band ${c} ${s}`, text: p.en, lang: "en" });
        out.push({ where: `band ${c} ${s}`, text: p.ar, lang: "ar" });
      }
    }
  return out;
}

const ALL = lines();
const bad = (re: RegExp, only?: "ar" | "en") =>
  ALL.filter(l => (!only || l.lang === only) && re.test(l.text)).map(
    l => `${l.where}: ${l.text}`,
  );

describe("the example call's copy", () => {
  test("the script is read whole: 39 turns in two dialects", () => {
    expect(TURNS.length).toBe(39);
    expect(ALL.length).toBeGreaterThan(150);
  });

  // The 5 minutes is said on the slides, with the working hours (CEO,
  // 2026-10-20); the call itself never promises "instantly", "same day",
  // the 21x or 100x figures, or a result.
  test("no instant or same-day promise, no 21x or 100x, no results promise", () => {
    expect(
      bad(
        /within minutes|\binstantly\b|\bsame[- ]day\b|21\s?[x×]|100\s?[x×]|\bROI\b/i,
        "en",
      ),
    ).toEqual([]);
    expect(
      bad(/فوراً|بنفس اليوم|(?:٢١|١٠٠|21|100)\s?(?:[x×]|ضعف|مرة)/, "ar"),
    ).toEqual([]);
  });

  test("no guarantee made for the client, no deposit, no hundreds of families", () => {
    expect(bad(/guarant|refund|deposit|hundreds of/i, "en")).toEqual([]);
    expect(bad(/نضمن|ضمان|مضمون|عربون|مئات العائلات|خريطة طريق/, "ar")).toEqual(
      [],
    );
  });

  test("no leads, never مقاول, never ليد", () => {
    expect(bad(/\bleads?\b|contractor/i, "en")).toEqual([]);
    expect(bad(/مقاول|ليد/, "ar")).toEqual([]);
  });

  test("the caller is never named; the customer is the fictional Abu Fahad", () => {
    expect(bad(/\[اسمك\]|\{caller\}/)).toEqual([]);
    const names = ALL.filter(l => /Abu|أبو/.test(l.text));
    expect(names.length).toBeGreaterThan(0);
    for (const l of names) expect(l.text).toMatch(/Abu Fahad|أبو فهد/);
  });

  test("form: no exclamation marks, no em or en dashes, plain quotes, no guillemets", () => {
    expect(bad(/[!！]|[—–]|[“”‘’]|[«»]/)).toEqual([]);
  });

  test("the slots are the dialer's own tokens, and every one is known", () => {
    const AR = /\[([^\]]+)\]/g;
    const known = new Set([
      "اسم الشركة",
      "اسم الخدمة",
      "المشروع",
      "اسم المهندس",
      "نوع الاستشارة",
      "المكان",
      "اللي يميزكم",
      "حساب إنستقرام",
      "اليوم",
      "الوقت",
      "الميزانية",
      "جواب الميزانية",
    ]);
    for (const l of ALL.filter(x => x.lang === "ar"))
      for (const m of l.text.matchAll(AR)) expect(known.has(m[1])).toBe(true);
  });

  test("the call's Arabic speaks only in the dialect's own words, numbers as words", () => {
    // Spoken numbers are words; the clock and the stop 8 note carry digits.
    const spoken = ALL.filter(
      l => l.lang === "ar" && /\d \d|^\d/.test(l.text) && l.where !== "card",
    );
    expect(spoken).toEqual([]);
    expect(bad(/[0-9]/, "ar").filter(x => !x.startsWith("card"))).toEqual([]);
  });

  test("money appears only in the fictional customer's band", () => {
    const money = /riyal|dinar|dirham|ريال|دينار|درهم/i;
    for (const l of ALL)
      if (money.test(l.text)) expect(l.where.startsWith("band")).toBe(true);
  });
});

describe("the script is EXAMPLE-CALL.md's, word for word", () => {
  const doc = require("node:fs").readFileSync(
    require("node:path").resolve(
      import.meta.dir,
      "../../../docs/csm-decks/EXAMPLE-CALL.md",
    ),
    "utf8",
  ) as string;
  /** The rows of the table under a heading: cells split on " | ". */
  const table = (heading: string) => {
    const at = doc.indexOf(heading);
    const rows: string[][] = [];
    for (const line of doc.slice(at).split("\n").slice(1)) {
      if (line.startsWith("## ") || line.startsWith("**"))
        if (rows.length) break;
      if (!line.startsWith("| ")) continue;
      const cells = line.slice(2, -2).split(" | ");
      if (/^\d:\d\d$/.test(cells[0])) rows.push(cells);
    }
    return rows;
  };

  test("both dialects and the English subtitles", () => {
    const kw = table("## Variant 1: Kuwaiti");
    const sa = table("## Variant 2: Saudi");
    const turns = TURNS.map(t => [t.at, t.kw, t.sa, t.en]);
    expect(kw.length).toBe(TURNS.length + 1);
    for (const [at, k, s, en] of turns) {
      const a = kw.find(r => r[0] === at);
      const b = sa.find(r => r[0] === at);
      expect(a?.[3]).toBe(k);
      expect(b?.[3]).toBe(s);
      expect(a?.[4]).toBe(en);
    }
  });

  test("the pain variants", () => {
    for (const [heading, key] of [
      ["**Design**", "design"],
      ["**Cost**", "cost"],
    ] as const) {
      const at = doc.indexOf(heading);
      const rows = doc
        .slice(at)
        .split("\n")
        .filter(l => /^\| \d:\d\d \|/.test(l))
        .slice(0, 4)
        .map(l => l.slice(2, -2).split(" | "));
      for (const [time, kw, sa, en] of rows) {
        const t = TURNS.find(x => x.at === time);
        expect(t?.pain?.[key]).toEqual({ kw, sa, en });
      }
    }
  });
});
