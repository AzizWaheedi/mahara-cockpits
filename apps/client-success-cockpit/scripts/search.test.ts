import { describe, expect, test } from "bun:test";
import { blanksIn, draftsFor, PLACEHOLDER } from "../src/lib/csmTemplates";
import { clientMatcher, fold, matchScore } from "../src/lib/search";

/**
 * The search box (Aziz, 2026-10-06: "a really good search feature"): one
 * forgiving rule for typed English and Arabic, and the test that puts client
 * WhatsApp groups ahead of everything else in the Inbox.
 */

describe("what counts as the same letters", () => {
  test("Arabic letter forms, short vowels and tatweel fold to one spelling", () => {
    expect(fold("أركتوروس")).toBe(fold("اركتوروس"));
    expect(fold("إدارة")).toBe(fold("اداره"));
    expect(fold("مُهَارَة")).toBe("مهاره");
    expect(fold("مستشفى")).toBe(fold("مستشفي"));
    expect(fold("عـلاء")).toBe("علاء");
    expect(fold("  Café   Déco ")).toBe("cafe deco");
  });
});

describe("what a search finds", () => {
  test("the start of a name, or of any of its words, ranks first", () => {
    expect(matchScore("Arcturus Construction", "arc")).toBe(1);
    expect(matchScore("Greystone Contracting", "grey cont")).toBeGreaterThan(
      0.5,
    );
    expect(matchScore("أركتوروس للتشييد", "ارك")).toBe(1);
  });

  test("every typed word has to be there, and one typo in a long word is forgiven", () => {
    expect(matchScore("Arcturus Construction", "acturus")).toBeGreaterThan(0);
    expect(matchScore("Arcturus Construction", "arcturus marble")).toBe(0);
    expect(matchScore("Key links", "eod")).toBe(0);
    // A near miss ranks below a real match.
    expect(matchScore("Arcturus Construction", "acturus")).toBeLessThan(
      matchScore("Arcturus Construction", "arcturus"),
    );
  });

  test("nothing typed matches everything", () => {
    expect(matchScore("anything", "   ")).toBe(1);
  });
});

describe("which conversations are a client's", () => {
  const isClient = clientMatcher([
    "Arcturus Construction",
    "Marble and more",
    "ocean home",
    "شركة العلا",
    "نهوض نجد",
    "Safad Consultant Engineering",
  ]);

  test("client groups match by the words that pick out the client", () => {
    expect(isClient("Mahara | Acturus Construction [ 📢📢📢 ]")).toBe(true);
    expect(isClient("Mahara | Marble And More [ 📢📢📢 ]")).toBe(true);
    expect(isClient("Mahara | Ocean Home [ 📢📢📢 ]")).toBe(true);
    expect(isClient("Mahara | شركة العلا [ 📢📢📢 ]")).toBe(true);
    expect(isClient("مهاره - نهوض نجد [ 📢📢📢 ]")).toBe(true);
    expect(isClient("Safad | Mahara [ 📢📢📢 ]")).toBe(true);
  });

  test("team chats and other groups do not, on a generic word alone", () => {
    expect(isClient("Whatsapp Group [ 📢📢📢 ]")).toBe(false);
    expect(isClient("Karim@maharamedia")).toBe(false);
    expect(isClient("Muhammed | Maharamedia")).toBe(false);
    expect(isClient("مجموعة الاسرة [ 📢📢📢 ]")).toBe(false);
    expect(isClient("Construction Jobs Lebanon")).toBe(false);
    expect(isClient("D")).toBe(false);
  });
});

describe("the monthly report message", () => {
  const client = {
    name: "Ola Interiors",
    stage: "Active",
    bucket: "management",
    reportDue: true,
    sheetLink: "https://docs.google.com/spreadsheets/d/tracking",
  };
  const report = (c: Record<string, unknown>, lang: "en" | "ar") =>
    draftsFor(c, lang).find(d => d.id === "monthly_report")?.message ?? "";

  test("links the report the cockpit wrote, never the tracking sheet", () => {
    const en = report(
      { ...client, reportUrl: "https://docs.google.com/document/d/report" },
      "en",
    );
    expect(en).toContain("https://docs.google.com/document/d/report");
    expect(en).not.toContain("spreadsheets/d/tracking");
    expect(PLACEHOLDER.test(en)).toBe(false);
  });

  test("without a report it holds the placeholder, which blocks sending", () => {
    expect(PLACEHOLDER.test(report(client, "en"))).toBe(true);
    expect(PLACEHOLDER.test(report(client, "ar"))).toBe(true);
  });

  test("every blank a draft can carry is caught and named once", () => {
    expect(
      blanksIn("Done so far: [list]. On track for DATE at TIME, [list]."),
    ).toEqual(["[list]", "DATE", "TIME"]);
    expect(blanksIn("ما تم: [القائمة]")).toEqual(["[القائمة]"]);
    // Ordinary words are not blanks.
    expect(blanksIn("Your update date is set, time to launch.")).toEqual([]);
  });
});
