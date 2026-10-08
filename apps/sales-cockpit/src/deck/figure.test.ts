import { describe, expect, test } from "bun:test";
import { digits, sayCount, sayMoney, sayMoneyRange } from "../lib/funnel";
import { figureAt, GROUP, hold, type Part, parse, tally } from "./figure";

/** A figure's parts as "kind:text", a space before a part as "_". */
const said = (text: string) =>
  parse(text).map((p: Part) => `${p.space ? "_" : ""}${p.kind}:${p.text}`);

const NB = String.fromCharCode(0xa0);

describe("parse: what each piece of a figure is", () => {
  test("money with its scale and a plus", () => {
    expect(said("$1.32M+")).toEqual(["num:$1.32", "unit:M", "sign:+"]);
    expect(said("+١٫٣٢ مليون دولار")).toEqual([
      "sign:+",
      "num:١٫٣٢",
      "_unit:مليون دولار",
    ]);
    expect(said("$12.4M")).toEqual(["num:$12.4", "unit:M"]);
    expect(said("$72.3M")).toEqual(["num:$72.3", "unit:M"]);
    expect(said("٧٢٫٣ مليون دولار")).toEqual(["num:٧٢٫٣", "_unit:مليون دولار"]);
    expect(said("$800K")).toEqual(["num:$800", "unit:K"]);
  });

  test("areas: the square of م٢ is not a number", () => {
    expect(said("5,000 m²")).toEqual(["num:5,000", "_unit:m²"]);
    expect(said("٥٠٠٠ م٢")).toEqual(["num:٥٠٠٠", "_unit:م٢"]);
  });

  test("ranges: to and لـ join two numbers", () => {
    expect(said("3 to 4x")).toEqual(["num:3", "_link:to", "_num:4", "sign:×"]);
    expect(said("٣ لـ٤ أضعاف")).toEqual([
      "num:٣",
      "_link:لـ",
      "num:٤",
      "_unit:أضعاف",
    ]);
    expect(said("$30 to $50")).toEqual(["num:$30", "_link:to", "_num:$50"]);
    expect(said("٣٠ لـ٥٠ دولار")).toEqual([
      "num:٣٠",
      "_link:لـ",
      "num:٥٠",
      "_unit:دولار",
    ]);
  });

  test("signs touch the number on either side", () => {
    expect(said("~$400")).toEqual(["sign:~", "num:$400"]);
    expect(said("21×")).toEqual(["num:21", "sign:×"]);
    expect(said("٢١×")).toEqual(["num:٢١", "sign:×"]);
    expect(said("2x")).toEqual(["num:2", "sign:×"]);
    expect(said("70+")).toEqual(["num:70", "sign:+"]);
    expect(said("+٧٠")).toEqual(["sign:+", "num:٧٠"]);
    expect(said("10+")).toEqual(["num:10", "sign:+"]);
    expect(said("+١٠")).toEqual(["sign:+", "num:١٠"]);
  });

  test("units before and after, touching or spaced", () => {
    expect(said("20%")).toEqual(["num:20", "unit:%"]);
    expect(said("٢٠٪")).toEqual(["num:٢٠", "unit:٪"]);
    expect(said("1 year")).toEqual(["num:1", "_unit:year"]);
    expect(said("1 → team")).toEqual(["num:1", "_unit:→ team"]);
    expect(said("من ١ لفريق")).toEqual(["unit:من", "_num:١", "_unit:لفريق"]);
    expect(said("75,000 KWD")).toEqual(["num:75,000", "_unit:KWD"]);
  });

  test("a value with no digit is one word", () => {
    expect(said("الضعف")).toEqual(["word:الضعف"]);
    expect(said("سنة وحدة")).toEqual(["word:سنة وحدة"]);
    expect(said("ولا عميل")).toEqual(["word:ولا عميل"]);
    expect(said("—")).toEqual(["word:—"]);
    expect(said("")).toEqual([]);
  });

  test("a held line parses the same as a spaced one", () => {
    expect(said(hold("١٢٫٤ مليون دولار"))).toEqual([
      "num:١٢٫٤",
      `_unit:مليون${NB}دولار`,
    ]);
    expect(said(hold("٣ لـ٤ أضعاف"))).toEqual(said("٣ لـ٤ أضعاف"));
  });

  test("a grouped Arabic number is one number", () => {
    expect(said(`٦٢${GROUP}٣٤٦`)).toEqual([`num:٦٢${GROUP}٣٤٦`]);
  });
});

describe("tally: where a count starts and how it moves", () => {
  test("k whole digits start at 10^(k-1)", () => {
    expect(tally("2,855").start).toBe("1,000");
    expect(tally("٢٨٥٥").start).toBe("١٠٠٠");
    expect(tally("158").start).toBe("100");
    expect(tally("١٥٨").start).toBe("١٠٠");
  });

  test("one whole digit starts at 1 with the same places", () => {
    expect(tally("+١٫٣٢".replace("+", "")).start).toBe("١٫٠٠");
    expect(tally("$1.32").start).toBe("$1.00");
    expect(tally("4.7").start).toBe("1.0");
    expect(tally("٤٫٧").start).toBe("١٫٠");
    expect(tally("5").start).toBe("1");
    expect(tally("٥").start).toBe("١");
  });

  test("a number ending in zeros counts in steps of them", () => {
    const seventy = tally("70");
    expect(seventy.start).toBe("10");
    const seen = new Set<string>();
    for (let s = 0; s <= 1; s += 0.01) seen.add(seventy.at(s));
    expect([...seen].every(v => /^[1-7]0$/.test(v))).toBe(true);
    const twenty = tally("٢٠");
    for (let s = 0; s <= 1; s += 0.05)
      expect(["١٠", "٢٠"]).toContain(twenty.at(s));
  });

  test("nothing to count: 0, 1 and round numbers stand still", () => {
    expect(tally("0").moves).toBe(false);
    expect(tally("٠").at(0)).toBe("٠");
    expect(tally("1").moves).toBe(false);
    expect(tally("1,000").moves).toBe(false);
    expect(tally("999").moves).toBe(true);
  });

  test("every frame has the final's digit count and no lone zero", () => {
    for (const num of [
      "2,855",
      "٢٨٥٥",
      "$1.32",
      "١٫٣٢",
      "70",
      "٧٠",
      "4.7",
      "999",
    ]) {
      const t = tally(num);
      for (let s = 0; s <= 1.0001; s += 0.02) {
        const v = t.at(s);
        expect(v.length).toBe(num.length);
        expect(v).not.toMatch(/^[$]?[0٠]/);
      }
      expect(t.at(1)).toBe(num);
    }
  });

  test("the last frame is the figure exactly as written", () => {
    for (const text of [
      "$1.32M+",
      "+١٫٣٢ مليون دولار",
      "70+",
      "+٧٠",
      "٤٫٧",
      "2,855",
      "٢٨٥٥",
      "3 to 4x",
    ]) {
      expect(figureAt(text, 1)).toBe(text);
      expect(figureAt(text, 1.2)).toBe(text);
    }
  });

  test("a figure counts only its numbers; its words stay", () => {
    expect(figureAt("$1.32M+", 0)).toBe("$1.00M+");
    expect(figureAt("+١٫٣٢ مليون دولار", 0)).toBe("+١٫٠٠ مليون دولار");
    expect(figureAt("+٧٠", 0)).toBe("+١٠");
    expect(figureAt("٢٨٥٥", 0)).toBe("١٠٠٠");
    expect(figureAt("Free", 0.5)).toBe("Free");
  });
});

describe("the formatter: separator, digits and units in both languages", () => {
  test("Arabic thousands: no mark to 9,999, a narrow space from 10,000", () => {
    expect(digits("0", "ar")).toBe("٠");
    expect(digits("999", "ar")).toBe("٩٩٩");
    expect(digits("1,000", "ar")).toBe("١٠٠٠");
    expect(digits("2,855", "ar")).toBe("٢٨٥٥");
    expect(digits(62_346, "ar")).toBe(`٦٢${GROUP}٣٤٦`);
    expect(GROUP).toBe("\u202F");
    expect(digits("72.3", "ar")).toBe("٧٢٫٣");
  });

  test("English keeps its comma and point", () => {
    expect(sayCount(0, "en")).toBe("0");
    expect(sayCount(999, "en")).toBe("999");
    expect(sayCount(1_000, "en")).toBe("1,000");
    expect(sayCount(2_855, "en")).toBe("2,855");
    expect(sayCount(4.7, "en")).toBe("4.7");
  });

  test("counts in Arabic", () => {
    expect(sayCount(0, "ar")).toBe("٠");
    expect(sayCount(999, "ar")).toBe("٩٩٩");
    expect(sayCount(1_000, "ar")).toBe("١٠٠٠");
    expect(sayCount(2_855, "ar")).toBe("٢٨٥٥");
    expect(sayCount(4.7, "ar")).toBe("٤٫٧");
  });

  test("money: 72.3M, thousands as digits, ranges with the currency once", () => {
    expect(sayMoney(72_300_000, "USD", "en")).toBe("$72.3 million");
    expect(sayMoney(72_300_000, "USD", "ar")).toBe("٧٢٫٣ مليون دولار");
    expect(sayMoney(1_200, "USD", "ar")).toBe("١٢٠٠ دولار");
    expect(sayMoney(6_000, "USD", "ar")).toBe("٦٠٠٠ دولار");
    expect(sayMoney(75_000, "USD", "ar")).toBe("٧٥ ألف دولار");
    expect(sayMoney(6_000, "USD", "en")).toBe("$6,000");
    expect(sayMoneyRange(30, 50, "USD", "ar")).toBe("٣٠ لـ٥٠ دولار");
    expect(sayMoneyRange(30, 50, "USD", "en")).toBe("$30 to $50");
    expect(said(sayMoneyRange(900, 1_500, "USD", "ar"))).toEqual([
      "num:٩٠٠",
      "_link:لـ",
      "num:١٥٠٠",
      "_unit:دولار",
    ]);
  });

  test("percentages", () => {
    expect(said("٢٥٪")).toEqual(["num:٢٥", "unit:٪"]);
    expect(said("4.5%")).toEqual(["num:4.5", "unit:%"]);
  });

  test("no Arabic number carries ٬ from 0 to 10^7", () => {
    for (let n = 0; n <= 10_000_000; n = Math.floor(n * 1.37) + 1) {
      for (const s of [
        sayCount(n, "ar"),
        sayMoney(n, "USD", "ar"),
        sayMoneyRange(n, n * 2, "KWD", "ar"),
      ])
        expect(s).not.toContain("٬");
    }
  });
});

describe("hold: a number stays on the line of what it counts", () => {
  test("no breakable space in a figure's words", () => {
    expect(hold("١٢٫٤ مليون دولار")).toBe(`١٢٫٤${NB}مليون${NB}دولار`);
    expect(hold("١٢٫٤ مليون دولار")).not.toMatch(/ /);
    expect(hold("بتكلفة ٤٠٠ دولار للعميل")).toBe(`بتكلفة ٤٠٠${NB}دولار للعميل`);
    expect(hold("٣٠ يوم")).toBe(`٣٠${NB}يوم`);
    expect(hold("٢٠٪ من")).toBe(`٢٠٪${NB}من`);
    expect(hold("75% of")).toBe(`75%${NB}of`);
  });

  test("a word before the number may still break", () => {
    expect(hold("خلال ٥ دقايق")).toBe(`خلال ٥${NB}دقايق`);
    expect(hold("no numbers here")).toBe("no numbers here");
  });
});
