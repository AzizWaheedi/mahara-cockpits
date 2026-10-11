// bun test src/lib/tellThem.test.ts (in apps/sales-cockpit)
//
// Tell them's messages (2026-10-11): the design's copy table in both
// languages, the lead's own clock, the library first, and the Kuwaiti
// voice rules for every Arabic message.
import { describe, expect, test } from "bun:test";
import {
  builtIn,
  librarySnippet,
  rowMoment,
  type TellInput,
  type TellMoment,
  tellMessage,
  tellWhen,
} from "./tellThem";
import type { Snippet } from "./whatsapp";

/** Sun 11 Oct 2026, 14:43 in Kuwait. */
const NOW = Date.parse("2026-10-11T14:43:00+03:00");
const kw = (s: string) => new Date(`${s}+03:00`).toISOString();

const mona = {
  contact_id: "c-mona",
  name: "منى الحربي",
  company: "Harbi Interiors",
  country: "AE",
  phone: "+971504127781",
};
const monaEn = { ...mona, name: "Mona Al Harbi" };
const faisal = {
  contact_id: "c-faisal",
  name: "فيصل المطيري",
  company: "Mutairi Contracting",
  country: "KW",
  phone: "+96599812240",
};

const base = (over: Partial<TellInput>): TellInput => ({
  moment: "rescheduled",
  lang: "ar",
  lead: mona,
  kind: "demo",
  start: kw("2026-10-13T17:00:00"),
  host: { en: "Ahmad", ar: "أحمد" },
  rep: { en: "Sara", ar: "سارة" },
  now: NOW,
  ...over,
});

describe("the design's messages, word for word", () => {
  test("Rescheduled", () => {
    expect(builtIn(base({}))).toBe(
      "هلا منى، غيرنا موعد الديمو مع أحمد. صار الثلاثاء ١٣ أكتوبر الساعة ٦ المغرب بتوقيت الإمارات. إذا ما يناسبك الوقت، اكتب لي هني.",
    );
    expect(builtIn(base({ lang: "en", lead: monaEn }))).toBe(
      "Hi Mona, your demo with Ahmad is now on Tue 13 Oct at 6:00 pm UAE time. If that time doesn't suit you, reply here.",
    );
  });

  test("Just booked", () => {
    expect(builtIn(base({ moment: "booked" }))).toBe(
      "هلا منى، حجزت لك الديمو مع أحمد الثلاثاء ١٣ أكتوبر الساعة ٦ المغرب بتوقيت الإمارات. أي سؤال قبلها، اكتبه هني.",
    );
    expect(builtIn(base({ moment: "booked", lang: "en", lead: monaEn }))).toBe(
      "Hi Mona, your demo with Ahmad is booked for Tue 13 Oct at 6:00 pm UAE time. Any question before then, write it here.",
    );
  });

  test("Confirm the call, tomorrow on the lead's clock", () => {
    const start = kw("2026-10-12T16:30:00");
    expect(builtIn(base({ moment: "confirm", start }))).toBe(
      "هلا منى، نذكرك بالديمو مع أحمد باجر الاثنين الساعة ٥:٣٠ العصر بتوقيت الإمارات. إذا تبي تغير الوقت، اكتب لي هني.",
    );
    expect(
      builtIn(base({ moment: "confirm", start, lang: "en", lead: monaEn })),
    ).toBe(
      "Hi Mona, a reminder of your demo with Ahmad tomorrow, Mon, at 5:30 pm UAE time. If you need another time, reply here.",
    );
  });

  test("Missed, booked again", () => {
    const i = base({
      moment: "missed_booked",
      lead: faisal,
      kind: "intro",
      start: kw("2026-10-11T17:00:00"),
      host: { en: "Sara", ar: "سارة" },
    });
    expect(builtIn(i)).toBe(
      "هلا فيصل، معاك سارة من مهارة ميديا.\nشكله صار عندك شي وقت المكالمة، فحجزت لك موعد ثاني اليوم الساعة ٥ العصر بتوقيت الكويت.\nإذا حاب نكمل، رد علي هني.",
    );
    expect(
      builtIn({
        ...i,
        lang: "en",
        lead: { ...faisal, name: "Faisal Al Mutairi" },
      }),
    ).toBe(
      "Hi Faisal, it's Sara from Mahara Media. Looks like something came up at call time, so I booked you again for today at 5:00 pm Kuwait time. If you'd like to go ahead, reply here.",
    );
  });

  test("Missed, not booked yet", () => {
    const i = base({ moment: "missed_open", lead: faisal, start: null });
    expect(builtIn(i)).toBe(
      "هلا فيصل، شكله صار عندك شي وقت المكالمة. متى يناسبك نحجز موعد ثاني؟",
    );
    expect(
      builtIn({ ...i, lang: "en", lead: { ...faisal, name: "Faisal" } }),
    ).toBe(
      "Hi Faisal, looks like something came up at call time. When suits you for another one?",
    );
  });

  test("Pick a time carries the link and says اختار", () => {
    const link =
      "https://api.leadconnectorhq.com/widget/booking/abc?event_id=a1";
    const ar = builtIn(base({ moment: "pick_time", kind: "intro", link }));
    expect(ar).toBe(
      `هلا منى، إذا تبي تغير موعد مكالمة التعارف، اختار الوقت اللي يناسبك من هني:\n${link}`,
    );
    expect(ar).not.toContain("اختر ");
    expect(
      builtIn(
        base({
          moment: "pick_time",
          kind: "intro",
          link,
          lang: "en",
          lead: monaEn,
        }),
      ),
    ).toBe(
      `Hi Mona, if you'd like another time for your intro call, pick the one that suits you here:\n${link}`,
    );
  });

  test("a business's name greets no one, never هلا شركة", () => {
    const lead = { ...mona, name: "شركة الريم للتصميم", company: "الريم" };
    expect(builtIn(base({ lead }))).toMatch(/^هلا، غيرنا موعد/);
    expect(builtIn(base({ lead, lang: "en" }))).toMatch(/^Hi, your demo/);
  });
});

describe("the Zoom link", () => {
  const zoom = "https://us06web.zoom.us/j/84455667788";
  test("goes under a message about a booked call", () => {
    for (const m of [
      "rescheduled",
      "booked",
      "confirm",
      "missed_booked",
    ] as TellMoment[]) {
      expect(builtIn(base({ moment: m, zoom }))).toEndWith(
        `\nلينك الزوم: ${zoom}`,
      );
      expect(builtIn(base({ moment: m, zoom, lang: "en" }))).toEndWith(
        `\nZoom link: ${zoom}`,
      );
    }
  });
  test("never under a miss with nothing booked, nor the pick-a-time link", () => {
    expect(builtIn(base({ moment: "missed_open", zoom }))).not.toContain(zoom);
    expect(
      builtIn(base({ moment: "pick_time", zoom, link: "https://x.example/l" })),
    ).not.toContain(zoom);
  });
});

describe("the day and time on the lead's clock", () => {
  test("today, tomorrow and a date", () => {
    expect(tellWhen(kw("2026-10-11T17:00:00"), mona, "en", NOW)).toEqual({
      text: "today at 6:00 pm UAE time",
      dated: false,
    });
    expect(tellWhen(kw("2026-10-12T16:30:00"), mona, "ar", NOW).text).toBe(
      "باجر الاثنين الساعة ٥:٣٠ العصر بتوقيت الإمارات",
    );
    expect(tellWhen(kw("2026-10-13T17:00:00"), faisal, "ar", NOW)).toEqual({
      text: "الثلاثاء ١٣ أكتوبر الساعة ٥ العصر بتوقيت الكويت",
      dated: true,
    });
  });
  test("late in Kuwait can be tomorrow in the UAE", () => {
    // 23:30 Kuwait on Sunday is 00:30 on Monday in the UAE.
    expect(tellWhen(kw("2026-10-11T23:30:00"), mona, "en", NOW).text).toBe(
      "tomorrow, Mon, at 12:30 am UAE time",
    );
  });
});

describe("the team's library first", () => {
  const snippets: Snippet[] = [
    {
      id: "s2",
      moment: "rescheduled",
      language: "ar",
      body: "هلا {name}، الموعد صار {day} الساعة {time}.",
      sort: 20,
    },
    { id: "s1", moment: "rescheduled", language: "ar", body: "  ", sort: 10 },
    {
      id: "s3",
      moment: "rescheduled",
      language: "en",
      body: "Hi {name}, moved to {day} at {time}. {rep}",
      sort: 10,
    },
    {
      id: "s4",
      moment: "no_show",
      language: "en",
      body: "Hi {name}, we missed you. When suits you?",
      sort: 10,
    },
  ];
  test("the first non-empty message for the moment and language, filled on the lead's clock", () => {
    expect(librarySnippet(snippets, "rescheduled", "ar")?.id).toBe("s2");
    expect(tellMessage(base({ snippets }))).toEqual({
      text: "هلا منى، الموعد صار يوم الثلاثاء الساعة ٦ المغرب.",
      from: "library",
    });
    expect(
      tellMessage(
        base({
          snippets,
          lang: "en",
          lead: monaEn,
          zoom: "https://z.example/j/1",
        }),
      ),
    ).toEqual({
      text: "Hi Mona, moved to Tuesday at 6 pm. Sara\nZoom link: https://z.example/j/1",
      from: "library",
    });
  });
  test("a missed call with nothing booked reads the no-show moment; booked again has none", () => {
    expect(
      tellMessage(
        base({ snippets, moment: "missed_open", lang: "en", lead: monaEn }),
      ).text,
    ).toBe("Hi Mona, we missed you. When suits you?");
    expect(tellMessage(base({ snippets, moment: "missed_booked" })).from).toBe(
      "built_in",
    );
  });
  test("no library message: the built-in one", () => {
    expect(tellMessage(base({ snippets: [] })).from).toBe("built_in");
    expect(tellMessage(base({ snippets: null })).text).toBe(builtIn(base({})));
  });
});

describe("every Arabic message keeps the voice rules", () => {
  const moments: TellMoment[] = [
    "rescheduled",
    "booked",
    "confirm",
    "missed_booked",
    "missed_open",
    "pick_time",
  ];
  const starts = [
    kw("2026-10-11T17:00:00"),
    kw("2026-10-12T10:20:00"),
    kw("2026-10-13T20:45:00"),
    kw("2026-10-20T12:00:00"),
  ];
  test("no em or en dash, no guillemets, Arabic-Indic digits only (links aside), no thousands mark", () => {
    for (const moment of moments)
      for (const start of starts)
        for (const kind of ["intro", "demo", "follow_up"] as const) {
          const text = builtIn(
            base({
              moment,
              start,
              kind,
              zoom: "https://us06web.zoom.us/j/81234567890",
              link: "https://api.leadconnectorhq.com/widget/booking/x1",
            }),
          );
          const words = text.replace(/https?:\/\/\S+/g, "");
          expect(words).not.toMatch(/[—–«»]/);
          expect(words).not.toMatch(/[0-9]/);
          expect(words).not.toMatch(/[٬,]/);
          expect(words).not.toMatch(/اختر\s/);
        }
  });
});

describe("which message a row opens on", () => {
  test("missed, moved, booked, else confirm", () => {
    expect(
      rowMoment({
        status: "noshow",
        movedRecently: false,
        bookedRecently: false,
        missed: "open",
      }),
    ).toBe("missed_open");
    expect(
      rowMoment({
        status: "noshow",
        movedRecently: false,
        bookedRecently: false,
        missed: "booked",
      }),
    ).toBe("missed_booked");
    expect(
      rowMoment({
        status: "confirmed",
        movedRecently: true,
        bookedRecently: true,
      }),
    ).toBe("rescheduled");
    expect(
      rowMoment({ status: "new", movedRecently: false, bookedRecently: true }),
    ).toBe("booked");
    expect(
      rowMoment({
        status: "confirmed",
        movedRecently: false,
        bookedRecently: false,
      }),
    ).toBe("confirm");
  });
});
