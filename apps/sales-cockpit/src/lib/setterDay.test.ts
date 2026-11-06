import { describe, expect, test } from "bun:test";
import type { QueueItem, SpeedToday, UrgentEvent } from "./dialer";
import {
  alertCrossings,
  callNowCount,
  callNowTitle,
  dayAt,
  dayLine,
  itemWords,
  labelSaysMore,
  messagesLine,
  minutesWords,
  missStepWords,
  segsText,
  speedGaps,
  speedSegs,
  waitClock,
} from "./setterDay";

const item = (over: Partial<QueueItem>): QueueItem => ({
  contact_id: "c1",
  name: "Lead",
  phone: "+96550012345",
  stage: null,
  lead_class: "qualified",
  tier: 0,
  why: "New lead, call now",
  created_at: null,
  last_dial_at: null,
  due_at: null,
  inbound_at: null,
  callback_at: null,
  demo_at: null,
  step: 0,
  last_outcome: null,
  ...over,
});

describe("each item's label and its one primary action", () => {
  test("the new items carry Aziz's words", () => {
    const label = (code: string) => itemWords(item({ code }))?.label;
    expect(label("just_booked")).toBe("Just booked, call now");
    expect(label("second_try")).toBe("Second try now");
    expect(label("confirm")).toBe("Confirm, 2.5 h before");
    expect(label("confirm_last")).toBe("Confirm, 60 min before");
    expect(label("reply_waiting")).toBe("Still waiting on you");
    expect(label("intro_cancelled")).toBe("Cancelled the intro, rebook it");
    expect(label("intro_now")).toBe("Your intro, now");
  });

  test("a voice-note item's action is the voice note, a mark item's is the mark, the rest call", () => {
    expect(itemWords(item({ code: "voice_note" }))?.action).toBe("voice");
    expect(itemWords(item({ code: "mark_call" }))?.action).toBe("mark");
    for (const code of [
      "intro_now",
      "new_lead",
      "just_booked",
      "second_try",
      "confirm",
      "confirm_last",
      "reply_waiting",
      "intro_cancelled",
    ])
      expect(itemWords(item({ code }))?.action).toBe("call");
  });

  test("a closer's call to mark is the demo", () => {
    expect(
      itemWords(item({ code: "mark_call", mark_call: { call_type: "demo" } }))
        ?.label,
    ).toBe("Mark the demo");
    expect(
      itemWords(item({ code: "mark_call", mark_call: { call_type: "intro" } }))
        ?.label,
    ).toBe("Mark the intro");
  });

  test("an item from an older server (no code), or a code this page does not know, shows as before", () => {
    expect(itemWords(item({}))).toBeNull();
    expect(itemWords(item({ code: "something_new" }))).toBeNull();
    expect(itemWords(null)).toBeNull();
  });
});

describe("the tab title", () => {
  test("counts the call-now items, the open call's lead left out", () => {
    const items = [
      item({ contact_id: "a", tier: 0 }),
      item({ contact_id: "b", tier: 0 }),
      item({ contact_id: "c", tier: 1 }),
    ];
    expect(callNowCount(items, null)).toBe(2);
    expect(callNowCount(items, "a")).toBe(1);
    expect(callNowTitle("Sales · Mahara", 2)).toBe(
      "(2) call now · Sales · Mahara",
    );
    expect(callNowTitle("Sales · Mahara", 0)).toBe("Sales · Mahara");
  });
});

describe("the re-alerts", () => {
  const ev = (key: string, deadline: number): UrgentEvent => ({
    key,
    contact_id: key,
    name: null,
    title: "New lead",
    at: deadline - 120_000,
    deadline,
    callback: false,
  });

  test("30 seconds before the deadline, and when it passes, each once", () => {
    const e = [ev("a", 100_000)];
    expect(alertCrossings(e, 60_000, 69_000)).toEqual([]);
    expect(alertCrossings(e, 69_000, 70_000)).toEqual([
      { key: "a", stage: "30s" },
    ]);
    expect(alertCrossings(e, 70_000, 71_000)).toEqual([]);
    expect(alertCrossings(e, 99_000, 100_000)).toEqual([
      { key: "a", stage: "late" },
    ]);
    expect(alertCrossings(e, 100_000, 101_000)).toEqual([]);
  });

  test("a long gap (a sleeping laptop) owes both, once", () => {
    expect(alertCrossings([ev("a", 100_000)], 0, 200_000)).toEqual([
      { key: "a", stage: "30s" },
      { key: "a", stage: "late" },
    ]);
  });

  test("an item already late when the page opens owes no re-alert", () => {
    expect(alertCrossings([ev("a", 100_000)], 150_000, 151_000)).toEqual([]);
    expect(alertCrossings([ev("a", 100_000)], 151_000, 151_000)).toEqual([]);
  });
});

describe("the day strip", () => {
  const speed = (over: Partial<SpeedToday> = {}): SpeedToday => ({
    leads: 7,
    called: 5,
    within5: 3,
    median_min: 4.5,
    not_called: 2,
    oldest_waiting: { contact_id: "c9", name: "Huda", minutes: 38 },
    calls_as_of: null,
    not_known: [],
    ...over,
  });

  test("today's speed to lead in one sentence", () => {
    expect(segsText(speedSegs(speed()))).toBe(
      "7 new leads today · 3 of 7 called inside 5 min · median 4.5 min to the first call · 2 not called yet",
    );
  });

  test("missing is never zero: no read, no new leads, nobody called", () => {
    expect(speedSegs(undefined)).toBeNull();
    expect(segsText(speedSegs(null))).toBe(
      "not known right now: today's leads or calls could not be read.",
    );
    expect(segsText(speedSegs(speed({ leads: 0 })))).toBe(
      "No new leads yet today.",
    );
    expect(
      segsText(
        speedSegs(
          speed({
            leads: 2,
            called: 0,
            within5: 0,
            median_min: null,
            not_called: 2,
          }),
        ),
      ),
    ).toBe(
      "2 new leads today · 0 of 2 called inside 5 min · none called yet · 2 not called yet",
    );
    expect(segsText(speedSegs(speed({ not_called: 0 })))).toContain(
      "every one called",
    );
  });

  test("what could not be read is named", () => {
    expect(speedGaps(speed())).toBeNull();
    expect(
      speedGaps(speed({ not_known: ["the dialer's own calls today"] })),
    ).toBe("Not read just now: the dialer's own calls today.");
    expect(speedGaps(null)).toBeNull();
  });

  test("minutes in a few words", () => {
    expect(minutesWords(0.4)).toBe("under 1 min");
    expect(minutesWords(4.5)).toBe("4.5 min");
    expect(minutesWords(4)).toBe("4 min");
    expect(minutesWords(38.2)).toBe("38 min");
    expect(minutesWords(125)).toBe("2 h 5 min");
    expect(minutesWords(1637.8)).toBe("1 d 3 h");
    expect(minutesWords(Number.NaN)).toBe("not known");
  });

  test("the oldest wait as a live clock from the read", () => {
    expect(waitClock(38, 1_000_000, 1_000_000)).toBe("38:00");
    expect(waitClock(38, 1_000_000, 1_012_500)).toBe("38:12");
    expect(waitClock(65, 0, 12_000)).toBe("1:05:12");
    // A clock behind the read never goes backwards.
    expect(waitClock(3, 5_000, 1_000)).toBe("3:00");
  });

  test("replies only Messages can answer", () => {
    const now = Date.parse("2026-11-05T12:00:00Z");
    expect(messagesLine(undefined, now)).toBeNull();
    expect(messagesLine({ count: 0 }, now)).toBeNull();
    expect(
      messagesLine(
        { count: 3, oldest_at: new Date(now - 5 * 3_600_000).toISOString() },
        now,
      ),
    ).toBe(
      "3 people wrote where only Messages can answer, the oldest 5 h ago.",
    );
    expect(
      messagesLine(
        { count: 1, oldest_at: new Date(now - 20 * 60_000).toISOString() },
        now,
      ),
    ).toBe("1 person wrote where only Messages can answer, 20 min ago.");
  });
});

describe("the rep's own day", () => {
  test("one line, and no '0 of 0' before the first call", () => {
    expect(dayLine({ saved: 23, calls: 19, answered: 15, booked: 3 }, 22)).toBe(
      "23 saved · 15 of 19 answered · 3 booked · 22 in the queue",
    );
    expect(dayLine({ saved: 0, calls: 0, answered: 0, booked: 0 }, null)).toBe(
      "0 saved · no calls through the dialer yet · 0 booked",
    );
    expect(dayLine(null, 4)).toBeNull();
  });
});

describe("small words", () => {
  const now = Date.parse("2026-11-05T12:00:00Z"); // 15:00 Kuwait, Thursday
  test("a time in the middle of a sentence", () => {
    expect(dayAt("2026-11-05T15:00:00Z", now)).toBe("today at 18:00");
    expect(dayAt("2026-11-06T06:00:00Z", now)).toBe("tomorrow at 09:00");
    expect(dayAt("2026-11-09T07:20:00Z", now)).toBe("on Mon 9 Nov at 10:20");
    expect(dayAt(null, now)).toBeNull();
  });
  test("a label that repeats the item's own words is left out", () => {
    const w = itemWords(item({ code: "second_try" }));
    expect(labelSaysMore(w, "Second try now")).toBe(false);
    expect(
      labelSaysMore(
        itemWords(item({ code: "new_lead" })),
        "New lead, call now",
      ),
    ).toBe(false);
    expect(
      labelSaysMore(
        itemWords(item({ code: "just_booked" })),
        "Booked an intro for tomorrow at 15:00, call now",
      ),
    ).toBe(true);
    expect(labelSaysMore(null, "x")).toBe(false);
  });
});

describe("2026-11-06 review: the words after a voice note went, and one message, not two", () => {
  const facts = {
    step: "new" as const,
    first_name: "Faisal",
    company: null,
    country: null,
    services: null,
    revenue: null,
    goal: null,
    challenge: null,
    projects_12m: null,
    ready_to_invest: null,
    decision_maker: null,
    call: null,
    language: null,
    rep: { first_name: null, first_name_ar: null },
    missing: [],
  };

  test("a second try once the voice note went does not ask for it again", () => {
    const due = itemWords(
      item({ code: "second_try", voice_note: { ...facts, due: true } }),
    );
    expect(due?.detail).toBe(
      "The first call rang out. Call once more; if nobody picks up, send the voice note.",
    );
    const sent = itemWords(
      item({ code: "second_try", voice_note: { ...facts, due: false } }),
    );
    expect(sent?.detail).toBe(
      "The first call rang out and the voice note went. Call once more.",
    );
    // Before the database update "not due" says nothing about whether it went.
    const unknown = itemWords(
      item({
        code: "second_try",
        voice_note: { ...facts, due: false, known: false },
      }),
    );
    expect(unknown?.detail).toBe("The first call rang out. Call once more.");
    expect(sent?.label).toBe("Second try now");
  });

  test("with the voice note card above, the WhatsApp is the other way, not a second message", () => {
    const step = {
      title: "No answer. Send them a WhatsApp?",
      text: "A WhatsApp right after a missed call gets answered far more often than an email. The missed-call message is ready in the box; read it, then send.",
      send: "whatsapp",
    };
    const w = missStepWords(step, true);
    expect(w.title).toBe("Or write from the official line");
    expect(w.text).toContain("Not both.");
    expect(w.text).not.toContain("ready in the box");
    // Without the card, and for any step that is not the WhatsApp offer, the words stay.
    expect(missStepWords(step, false)).toEqual({
      title: step.title,
      text: step.text,
    });
    expect(missStepWords({ ...step, send: "email" }, true).title).toBe(
      step.title,
    );
    expect(missStepWords({ ...step, callNow: true }, true).title).toBe(
      step.title,
    );
  });
});
