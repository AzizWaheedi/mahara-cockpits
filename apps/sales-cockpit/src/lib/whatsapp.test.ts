import { describe, expect, test } from "bun:test";
import {
  arabicDigits,
  callWords,
  fillSnippet,
  leadLanguage,
  renderTemplate,
  snippetLine,
} from "./whatsapp";

// Thursday 24 September 2026, 14:00 in Kuwait.
const NOW = Date.parse("2026-09-24T11:00:00Z");

describe("a booked call in a rep's words", () => {
  test("tomorrow afternoon, in Arabic and English", () => {
    expect(callWords("2026-09-25T12:00:00Z", "ar", NOW)).toEqual({
      day: "باجر",
      time: "٣ العصر",
    });
    expect(callWords("2026-09-25T12:30:00Z", "en", NOW)).toEqual({
      day: "tomorrow",
      time: "3:30 pm",
    });
  });
  test("today in the morning, and a later day by name", () => {
    expect(callWords("2026-09-24T06:00:00Z", "ar", NOW)).toEqual({
      day: "اليوم",
      time: "٩ الصبح",
    });
    expect(callWords("2026-09-27T17:00:00Z", "ar", NOW).day).toBe("يوم الأحد");
    expect(callWords("2026-09-27T17:00:00Z", "en", NOW)).toEqual({
      day: "Sunday",
      time: "8 pm",
    });
  });
  test("digits are Arabic-Indic in Arabic", () => {
    expect(arabicDigits("10:45")).toBe("١٠:٤٥");
  });
});

describe("ready-made messages", () => {
  test("what is known goes in, the rest stays marked", () => {
    expect(
      fillSnippet("هلا {name}، موعدنا {day} الساعة {time}", {
        name: "سارة",
        day: "باجر",
      }),
    ).toBe("هلا سارة، موعدنا باجر الساعة {time}");
  });
  test("as a template's line: no greeting, no who-I-am, one line", () => {
    expect(
      snippetLine(
        "هلا {name}، معاك {rep} من مهارة ميديا. وصلنا طلبك وحبيت أتواصل معاك بنفسي.. متى يناسبك نتكلم ١٠ دقايق؟",
      ),
    ).toBe("وصلنا طلبك وحبيت أتواصل معاك بنفسي.. متى يناسبك نتكلم ١٠ دقايق؟");
    expect(
      snippetLine(
        "Hi {name}, {rep} here from Mahara Media. Thanks for reaching out.\nWhen suits you?",
      ),
    ).toBe("Thanks for reaching out. When suits you?");
    expect(snippetLine("هلا {name}، توني اتصلت عليك")).toBe("توني اتصلت عليك");
  });
  test("a template reads with its values, a missing one stays visible", () => {
    const t = {
      preview:
        "Hi {{1}}, it's {{2}} from Mahara Media.\n{{3}}\nJust reply here.",
      variables: ["first_name", "rep_name", "line"] as (
        | "first_name"
        | "rep_name"
        | "line"
      )[],
    };
    expect(
      renderTemplate(t, { first_name: "Omar", line: "A quick one." }),
    ).toBe(
      "Hi Omar, it's {{2}} from Mahara Media.\nA quick one.\nJust reply here.",
    );
  });
  test("a lead's language is the one they write in", () => {
    expect(leadLanguage(["Hello, is this still open?"])).toBe("en");
    expect(leadLanguage(["Hello", "مرحبا"])).toBe("ar");
    expect(leadLanguage([])).toBe("ar");
  });
});
