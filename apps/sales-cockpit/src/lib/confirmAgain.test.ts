import { describe, expect, test } from "bun:test";
import { afterMiss, confirmAgainWords, confirmNoAnswerHint } from "./dialerUi";

// The confirmation's No answer said "Tries again in two hours" whatever the
// call's time, while sales-api brings a 2.5-hour try back sixty minutes
// before the call (found filming the setter's video, 2026-11-06). These
// read the words against sales-api's own appointmentWork, so the button
// cannot drift from the queue again.

const SA = "../../../../supabase/functions/sales-api";
const S = await import(`${SA}/dialer.ts`);

const MIN = 60_000;
// A demo at 16:00 Kuwait (13:00 UTC) on Monday 9 November, booked days
// ahead, so the day-before touch runs from 09:00 Kuwait that morning.
const START = Date.parse("2026-11-09T13:00:00Z");
const START_ISO = new Date(START).toISOString();

/** When sales-api brings the confirmation back after a try at `missAt`, or null for never. */
function serverBack(missAt: number): number | null {
  const appt = {
    id: "a1",
    type: "demo" as const,
    start: START,
    booked: START - 3 * 24 * 60 * MIN,
    status: null,
    assigned: null,
    confirmed: false,
    last_try: missAt,
    country: null,
  };
  for (let now = missAt + MIN; now < START; now += MIN) {
    const item = S.appointmentWork(appt, now, "closer", null);
    if (item && item.kind === "confirm") return now;
  }
  return null;
}

describe("when a confirmation nobody answered comes back", () => {
  const cases: [string, number, string][] = [
    // left before the call when it rang out, what the words say
    ["six hours before", 6 * 60, "The dialer tries again in two hours."],
    [
      "four hours before",
      4 * 60,
      "The dialer brings it back two and a half hours before the call.",
    ],
    [
      "two and a half hours before",
      150,
      "The dialer brings it back sixty minutes before the call.",
    ],
    [
      "two hours before",
      120,
      "The dialer brings it back sixty minutes before the call.",
    ],
    [
      "sixty minutes before",
      60,
      "That was the last confirmation try: the call itself is next.",
    ],
    [
      "twenty minutes before",
      20,
      "That was the last confirmation try: the call itself is next.",
    ],
  ];
  for (const [name, left, words] of cases) {
    test(`a try ${name} says what sales-api does`, () => {
      const missAt = START - left * MIN;
      expect(confirmAgainWords(START_ISO, missAt)).toBe(words);
      const back = serverBack(missAt);
      if (words.startsWith("That was the last")) expect(back).toBeNull();
      else if (words.includes("sixty minutes"))
        expect(back).toBe(START - S.CONFIRM_AGAIN);
      else if (words.includes("two and a half hours"))
        expect(back).toBe(START - S.CONFIRM_FROM);
      else expect(back).toBe(missAt + 120 * MIN);
    });
  }

  test("the button never says two hours inside the last two and a half hours", () => {
    for (let left = 150; left > 0; left -= 5) {
      const hint = confirmNoAnswerHint(START_ISO, START - left * MIN);
      expect(hint).not.toContain("two hours");
    }
  });

  test("the hint asks for the voice note where sales-api asks for one", () => {
    expect(confirmNoAnswerHint(START_ISO, START - 120 * MIN)).toBe(
      "The dialer brings it back sixty minutes before the call. Send the voice note.",
    );
    expect(confirmNoAnswerHint(START_ISO, START - 40 * MIN)).toBe(
      "That was the last confirmation try: the call itself is next. Send the voice note.",
    );
    // voiceNoteDue: no voice note for a miss in the call's last five minutes.
    expect(confirmNoAnswerHint(START_ISO, START - 3 * MIN)).toBe(
      "That was the last confirmation try: the call itself is next.",
    );
    // The day-before touch: a message, no voice note (voiceNoteDue reads the 2.5 hours only).
    expect(confirmNoAnswerHint(START_ISO, START - 6 * 60 * MIN)).toBe(
      "The dialer tries again in two hours. Message them too.",
    );
  });

  test("with no call time it promises no wait", () => {
    expect(confirmAgainWords(null, START)).toBe(
      "The dialer brings it back before the call.",
    );
    expect(confirmNoAnswerHint(undefined, START)).toBe(
      "The dialer brings it back before the call. Message them too.",
    );
  });

  test("the step after the miss says the same, by when the try rang out", () => {
    const s = afterMiss({
      moment: "confirm",
      whatsapp: null,
      email: null,
      templatesLive: null,
      messageReady: null,
      now: START - 55 * MIN,
      // Rang out at 65 minutes before; read at 55: still the sixty-minute try.
      confirm: { startAt: START_ISO, missAt: START - 65 * MIN },
    });
    expect(s.text).toBe(
      "A short WhatsApp asking them to confirm often gets the answer a call did not. The dialer brings it back sixty minutes before the call.",
    );
    const missed = afterMiss({
      moment: "missed_call",
      whatsapp: null,
      email: null,
      templatesLive: null,
      messageReady: null,
    });
    expect(missed.text).not.toContain("The dialer");
  });
});
