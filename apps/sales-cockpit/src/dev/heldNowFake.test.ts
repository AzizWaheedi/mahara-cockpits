// bun test src/dev/heldNowFake.test.ts   (from apps/sales-cockpit)
//
// The practice cockpit's early-mark rule (heldNowFake.ts) says what
// sales-api says (dialer.ts heldNowCheck and softphoneHeld, lib.ts
// refuseMark), so Did the intro now can be clicked through on
// harness.html?path=/dialer and the refusals look as they do live.
import { describe, expect, test } from "bun:test";
import {
  earlyMarkRefusal,
  type FakeCall,
  HELD_NOW_REFUSALS,
  markOf,
  softphoneRefusal,
} from "./heldNowFake";

const SA = "../../../../supabase/functions/sales-api";
const D = await import(`${SA}/dialer.ts`);

const MIN = 60_000;
const now = Date.parse("2026-11-08T09:00:00Z");
const EARLY =
  "This call has not happened yet. Mark it once its time has passed, or mark it cancelled.";
const call: FakeCall = {
  state: "placed",
  manual: false,
  item_kind: "confirm",
  appointment_id: "a19",
  // Five minutes on the call: long enough for the intro.
  started_at: new Date(now - 5 * MIN).toISOString(),
  plan: "answer",
};
const intro = (aheadMs: number) => ({
  call_type: "intro",
  start_at: new Date(now + aheadMs).toISOString(),
});
const base = {
  kind: "confirm",
  outcome: "showed",
  heldNow: true,
  call,
  appointmentId: "a19",
  appt: intro(2 * 60 * MIN),
  joined: false,
  now,
};

describe("the practice dialer's early mark", () => {
  test("Did the intro now on the confirmation call's own dialer call is accepted", () => {
    expect(earlyMarkRefusal(base)).toBeNull();
  });

  test("without held_now it is refused as sales-api refuses it; on video it passes", () => {
    expect(earlyMarkRefusal({ ...base, heldNow: false })).toBe(EARLY);
    expect(
      earlyMarkRefusal({ ...base, heldNow: false, joined: true }),
    ).toBeNull();
    // The intro's own item or a no-show ahead of time: refused as before.
    expect(earlyMarkRefusal({ ...base, kind: "intro" })).toBe(EARLY);
    expect(
      earlyMarkRefusal({ ...base, kind: "intro", outcome: "noshow" }),
    ).toBe(EARLY);
  });

  test("no dialer call: the softphone knob says what Maqsam has, in sales-api's words", () => {
    // Default talk: a 3-minute answered softphone call with this lead.
    expect(earlyMarkRefusal({ ...base, call: null })).toBeNull();
    expect(
      earlyMarkRefusal({ ...base, call: { ...call, manual: true } }),
    ).toBeNull();
    for (const other of [
      { ...call, item_kind: "lead" },
      { ...call, appointment_id: "a-other" },
    ])
      expect(
        earlyMarkRefusal({ ...base, call: other, softphone: "none" }),
      ).toBe(HELD_NOW_REFUSALS.noCall);
    expect(
      earlyMarkRefusal({ ...base, call: null, softphone: "talk" }),
    ).toBeNull();
    expect(earlyMarkRefusal({ ...base, call: null, softphone: "short" })).toBe(
      HELD_NOW_REFUSALS.short,
    );
    expect(earlyMarkRefusal({ ...base, call: null, softphone: "none" })).toBe(
      "Maqsam shows no call between your seat and this lead in the last two hours. Do the intro on a call with them, then press Did the intro now.",
    );
    expect(earlyMarkRefusal({ ...base, call: null, softphone: "unread" })).toBe(
      "Maqsam could not be read just now, so this call cannot be checked. Try again in a minute.",
    );
    // The dialer's own call is judged on it, whatever the knob.
    expect(earlyMarkRefusal({ ...base, softphone: "none" })).toBeNull();
    // A demo or a day away is said first, with no dialer call too.
    expect(
      earlyMarkRefusal({
        ...base,
        call: null,
        softphone: "none",
        appt: { call_type: "demo", start_at: intro(60 * MIN).start_at },
      }),
    ).toBe(HELD_NOW_REFUSALS.demo);
    expect(
      earlyMarkRefusal({
        ...base,
        call: null,
        softphone: "none",
        appt: intro(25 * 60 * MIN),
      }),
    ).toBe(HELD_NOW_REFUSALS.far);
    expect(softphoneRefusal("talk")).toBeNull();
    expect(softphoneRefusal("anything else")).toBeNull();
  });

  test("a demo, a day away, a call that did not connect: refused in sales-api's words", () => {
    expect(
      earlyMarkRefusal({
        ...base,
        appt: { call_type: "demo", start_at: intro(60 * MIN).start_at },
      }),
    ).toMatch(/^Only an intro can be marked held/);
    expect(earlyMarkRefusal({ ...base, appt: intro(25 * 60 * MIN) })).toMatch(
      /^This intro is more than a day away/,
    );
    expect(
      earlyMarkRefusal({ ...base, call: { ...call, state: "failed" } }),
    ).toMatch(/^Maqsam's record says this call did not connect/);
  });

  test("too short for the intro, let go, or placed hours ago: refused in sales-api's words", () => {
    const at = (msAgo: number) => new Date(now - msAgo).toISOString();
    expect(
      earlyMarkRefusal({ ...base, call: { ...call, started_at: at(MIN) } }),
    ).toBe(HELD_NOW_REFUSALS.short);
    expect(
      earlyMarkRefusal({ ...base, call: { ...call, started_at: at(3 * MIN) } }),
    ).toBeNull();
    expect(
      earlyMarkRefusal({ ...base, call: { ...call, state: "released" } }),
    ).toBe(HELD_NOW_REFUSALS.gone);
    expect(
      earlyMarkRefusal({
        ...base,
        call: { ...call, started_at: at(3 * 60 * MIN) },
      }),
    ).toBe(HELD_NOW_REFUSALS.gone);
  });

  test("the sentences are sales-api's, word for word, the softphone's lines too", () => {
    expect(HELD_NOW_REFUSALS).toEqual(D.HELD_NOW_LINES);
    for (const k of ["noSeat", "noPhone", "unread", "noCall"] as const)
      expect(HELD_NOW_REFUSALS[k]).toBe(D.HELD_NOW_LINES[k]);
  });

  test("ten minutes before the start or after it, and a cancel at any time, pass as today", () => {
    expect(
      earlyMarkRefusal({ ...base, heldNow: false, appt: intro(10 * MIN) }),
    ).toBeNull();
    expect(
      earlyMarkRefusal({ ...base, heldNow: false, appt: intro(-5 * MIN) }),
    ).toBeNull();
    expect(
      earlyMarkRefusal({ ...base, heldNow: false, outcome: "cancelled" }),
    ).toBeNull();
    expect(
      earlyMarkRefusal({ ...base, kind: "lead", outcome: "callback" }),
    ).toBeNull();
  });

  test("the marks follow sales-api's appointmentEffect", () => {
    expect(markOf("confirm", "showed")).toBe("showed");
    expect(markOf("confirm", "confirmed")).toBeNull();
    expect(markOf("confirm", "not_ready")).toBe("cancelled");
    expect(markOf("intro", "not_ready")).toBe("showed");
    expect(markOf("intro", "disqualified")).toBe("invalid");
    expect(markOf("lead", "booked")).toBeNull();
  });
});
