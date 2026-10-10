import { describe, expect, test } from "bun:test";
import {
  arDigits,
  callWhen,
  cleanInvite,
  greetName,
  groupInvite,
  groupName,
  groupWelcome,
  repName,
  vcard,
  waBlocked,
  waDigits,
  waLink,
  zoomMessage,
} from "./zoomLink";

const LINK = "https://us06web.zoom.us/j/81234567890?pwd=EnCrYpTeD.1";
const INVITE = "https://chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv";
// Sunday 11 October 2026, 18:00 in Kuwait (15:00 UTC).
const SUN6PM = "2026-10-11T15:00:00Z";

/** Arabic text with its links taken out: what the voice rules apply to. */
const words = (s: string) => s.replace(/https:\/\/\S+/g, "");

function arabicRules(s: string) {
  const w = words(s);
  expect(w).not.toContain("—");
  expect(w).not.toContain("«");
  expect(w).not.toContain("»");
  expect(w).not.toMatch(/[0-9]/);
  expect(w).not.toMatch(/[٬,]\d|[٠-٩][٬,][٠-٩]/);
}

describe("WhatsApp numbers and links", () => {
  test("only an international number opens WhatsApp", () => {
    expect(waDigits("+965 5000 0000")).toBe("96550000000");
    expect(waDigits("+96550000000")).toBe("96550000000");
    expect(waDigits("50000000")).toBeNull();
    expect(waDigits("0096550000000")).toBeNull();
    expect(waDigits("+1234567")).toBeNull();
    expect(waDigits(null)).toBeNull();
  });
  test("wa.me carries the message encoded, line breaks and Arabic included", () => {
    expect(
      waLink("96550000000", "هلا سارة،\nادخل: https://x.y/j/1?pwd=a&b"),
    ).toBe(
      "https://wa.me/96550000000?text=%D9%87%D9%84%D8%A7%20%D8%B3%D8%A7%D8%B1%D8%A9%D8%8C%0A%D8%A7%D8%AF%D8%AE%D9%84%3A%20https%3A%2F%2Fx.y%2Fj%2F1%3Fpwd%3Da%26b",
    );
  });
  test("why WhatsApp is not offered: do not disturb, no number, no country code", () => {
    expect(waBlocked({ dnd: true, phone: "+96550000000" })).toMatch(
      /^Do not disturb/,
    );
    expect(waBlocked({ dnd: false, phone: "" })).toMatch(/no phone number/);
    expect(waBlocked({ dnd: false, phone: "50000000" })).toMatch(
      /no country code/,
    );
    expect(waBlocked({ dnd: null, phone: "+96550000000" })).toBeNull();
  });
});

describe("Arabic digits", () => {
  test("every digit, no thousands mark", () => {
    expect(arDigits("12 Oct 2026, 1500")).toBe("١٢ Oct ٢٠٢٦, ١٥٠٠");
  });
});

describe("callWhen: the lead's own clock", () => {
  test("Kuwait, both languages", () => {
    expect(callWhen(SUN6PM, "KW", "en").text).toBe(
      "Sun 11 Oct at 6:00 pm Kuwait time",
    );
    expect(callWhen(SUN6PM, "KW", "ar").text).toBe(
      "الأحد ١١ أكتوبر الساعة ٦ المغرب بتوقيت الكويت",
    );
  });
  test("minutes only when not on the hour, and the morning", () => {
    const ar = callWhen("2026-10-11T06:30:00Z", "KW", "ar");
    expect(ar.time).toBe("٩:٣٠ الصبح");
    expect(callWhen("2026-10-11T06:30:00Z", "KW", "en").time).toBe("9:30 am");
  });
  test("the UAE clock, by a +971 number even when the CRM says Kuwait", () => {
    expect(callWhen(SUN6PM, "KW", "en", "+971500000000").text).toBe(
      "Sun 11 Oct at 7:00 pm UAE time",
    );
    expect(callWhen(SUN6PM, "AE", "ar").text).toBe(
      "الأحد ١١ أكتوبر الساعة ٧ المغرب بتوقيت الإمارات",
    );
  });
  test("Saudi, and no country at all is Kuwait", () => {
    expect(callWhen(SUN6PM, "SA", "en").zone).toBe("Saudi time");
    expect(callWhen(SUN6PM, null, "en").zone).toBe("Kuwait time");
  });
  test("outside the Gulf: the city in English, Kuwait's clock in Arabic", () => {
    expect(callWhen(SUN6PM, "GB", "en").text).toBe(
      "Sun 11 Oct at 4:00 pm London time",
    );
    expect(callWhen(SUN6PM, "GB", "ar").text).toBe(
      "الأحد ١١ أكتوبر الساعة ٦ المغرب بتوقيت الكويت",
    );
  });
  test("a day that crosses midnight on the lead's clock", () => {
    expect(callWhen("2026-10-11T21:30:00Z", "KW", "en").text).toBe(
      "Mon 12 Oct at 12:30 am Kuwait time",
    );
    expect(callWhen("2026-10-11T21:30:00Z", "KW", "ar").text).toBe(
      "الاثنين ١٢ أكتوبر الساعة ١٢:٣٠ الصبح بتوقيت الكويت",
    );
    expect(callWhen("2026-10-11T20:30:00Z", "KW", "ar").time).toBe(
      "١١:٣٠ بالليل",
    );
  });
});

describe("the Zoom message", () => {
  test("exact words, both languages", () => {
    expect(
      zoomMessage("en", { first: "Sara", rep: "Tahreer", link: LINK }),
    ).toBe(
      `Hi Sara, your call with Tahreer from Mahara Media is ready. Join here:\n${LINK}`,
    );
    const ar = zoomMessage("ar", { first: "سارة", rep: "تحرير", link: LINK });
    expect(ar).toBe(
      `هلا سارة، مكالمتك مع تحرير من مهارة ميديا جاهزة. ادخل من هني:\n${LINK}`,
    );
    arabicRules(ar);
  });
  test("no first name: no gap", () => {
    expect(
      zoomMessage("en", { first: "", rep: "Tahreer", link: LINK }),
    ).toStartWith("Hi, your call");
    expect(
      zoomMessage("ar", { first: "", rep: "تحرير", link: LINK }),
    ).toStartWith("هلا، مكالمتك");
  });
  test("the rep's name: Arabic name in Arabic when set, else the English first name", () => {
    expect(repName("ar", { name: "Tahreer Ali", name_ar: "تحرير" })).toBe(
      "تحرير",
    );
    expect(repName("ar", { name: "Tahreer Ali", name_ar: null })).toBe(
      "Tahreer",
    );
    expect(repName("en", { name: "Tahreer Ali", name_ar: "تحرير" })).toBe(
      "Tahreer",
    );
  });
});

describe("the group's words", () => {
  const when = (lang: "ar" | "en") => callWhen(SUN6PM, "KW", lang);
  test("the invite, exact", () => {
    expect(
      groupInvite("en", {
        first: "Sara",
        closer: "Ahmed",
        when: when("en"),
        invite: INVITE,
      }),
    ).toBe(
      `Hi Sara, I've made a WhatsApp group with Ahmed for your demo on Sun 11 Oct at 6:00 pm Kuwait time. Join here:\n${INVITE}`,
    );
    const ar = groupInvite("ar", {
      first: "سارة",
      closer: "أحمد",
      when: when("ar"),
      invite: INVITE,
    });
    expect(ar).toBe(
      `هلا سارة، سويت قروب واتساب مع أحمد عشان الديمو الأحد ١١ أكتوبر الساعة ٦ المغرب بتوقيت الكويت. ادخل من هني:\n${INVITE}`,
    );
    arabicRules(ar);
  });
  test("the welcome, exact, with and without the Zoom line", () => {
    expect(
      groupWelcome("en", { first: "Sara", closer: "Ahmed", when: when("en") }),
    ).toBe(
      "Welcome, Sara. Ahmed is here too and will take your demo on Sun 11 Oct at 6:00 pm Kuwait time. Any question before then, ask here.",
    );
    const ar = groupWelcome("ar", {
      first: "سارة",
      closer: "أحمد",
      when: when("ar"),
      zoom: LINK,
    });
    expect(ar).toBe(
      `هلا والله سارة. معانا هني أحمد، اللي بيكون معاك بالديمو الأحد ١١ أكتوبر الساعة ٦ المغرب بتوقيت الكويت. أي سؤال قبلها، اكتبه هني.\nلينك الزوم: ${LINK}`,
    );
    arabicRules(ar);
    expect(
      groupWelcome("en", {
        first: "Sara",
        closer: "Ahmed",
        when: when("en"),
        zoom: LINK,
      }),
    ).toEndWith(`\nZoom link: ${LINK}`);
  });
  test("no time known: the sentence still reads", () => {
    expect(
      groupInvite("en", {
        first: "Sara",
        closer: "Ahmed",
        when: null,
        invite: INVITE,
      }),
    ).toContain("for your demo. Join here:");
    expect(
      groupWelcome("ar", { first: "سارة", closer: "أحمد", when: null }),
    ).toContain("بالديمو. أي سؤال");
  });
  test("the group's name: the company, else the name, 100 characters at most", () => {
    expect(groupName({ company: "Al Noor Interiors", name: "Sara" })).toBe(
      "Al Noor Interiors | Mahara Media",
    );
    expect(groupName({ company: " ", name: "Sara Al Ali" })).toBe(
      "Sara Al Ali | Mahara Media",
    );
    const long = groupName({ company: "A".repeat(150) });
    expect([...long].length).toBe(100);
    expect(long).toEndWith(" | Mahara Media");
    expect([...groupName({ company: "ش".repeat(120) })].length).toBe(100);
  });
});

describe("the contact card", () => {
  test("vCard 3.0 with escaping and CRLF", () => {
    const v = vcard("Sara, Al; Ali\\x", "+965 5000-0000");
    expect(v).toBe(
      "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Sara\\, Al\\; Ali\\\\x\r\nN:Sara\\, Al\\; Ali\\\\x;;;;\r\nTEL;TYPE=CELL:+96550000000\r\nEND:VCARD\r\n",
    );
  });
});

describe("the invite link, as sales-api cleans it", () => {
  test("query removed, scheme added, anything else refused", () => {
    expect(cleanInvite(`${INVITE}?mode=ems_copy_t`)).toBe(INVITE);
    expect(cleanInvite("chat.whatsapp.com/AbCdEfGhIjKlMnOpQrStUv")).toBe(
      INVITE,
    );
    expect(cleanInvite("")).toBeNull();
    expect(cleanInvite("https://wa.me/1")).toBeUndefined();
    expect(
      cleanInvite("https://chat.whatsapp.com.evil.io/AbCdEfGhIjKlMnOp"),
    ).toBeUndefined();
  });
});

describe("greetName", () => {
  test("a person's first name", () => {
    expect(
      greetName({ name: "Sara Al Ali", company: "Al Ali Interiors" }),
    ).toBe("Sara");
    expect(greetName({ name: "  فيصل المطيري " })).toBe("فيصل");
  });

  test('a business\'s name greets no one by name, never "هلا شركة"', () => {
    expect(greetName({ name: "شركة الريم للتصميم الداخلي" })).toBe("");
    expect(greetName({ name: "مؤسسة البناء الحديث" })).toBe("");
    expect(greetName({ name: "Studio Nine", company: null })).toBe("");
    expect(
      greetName({
        name: "Al Mutairi Contracting",
        company: "al mutairi contracting",
      }),
    ).toBe("");
    expect(greetName({ name: null })).toBe("");
  });

  test("the messages read well without a name", () => {
    expect(
      zoomMessage("ar", { first: "", rep: "تحرير", link: LINK }),
    ).toStartWith("هلا، مكالمتك");
    expect(
      groupWelcome("en", { first: "", closer: "Omar", when: null }),
    ).toStartWith("Welcome. Omar is here too");
  });
});
