// Stress series 2, round 6: the setter's journey through a missed call, a
// video link the lead joins, and the dialer's joined step ("{name} joined the
// video call. How did the intro go?", DialerPage.tsx CallPane), whose
// buttons are Book the demo, Save how it went and Next lead; then what the
// queue does with the lead afterwards (dialer.ts afterOutcome, nextTry,
// rankForSetter; index.ts saveOutcome writes queue_state from afterOutcome).
//
// bun test supabase/functions/sales-api/stress2_journeys_r6_dialer.test.ts
//
// Walked in the cockpit harness too (/sales/harness.html?path=/dialer&
// call=noanswer): Call, Maqsam's record saves No answer, Send a video link,
// I'm in, The lead is in, Finished, then Next lead on the joined step: the
// page sent no dial.save, book.create or any other save for the lead
// (window.harnessLog), and the next lead opened.
//
// Each test's last expectations are what should hold; a failing one is a
// finding, and its comment says what the rep and the queue get instead.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { spokeCallbackAt } from "../../../apps/sales-cockpit/src/lib/dialer.ts";
import { afterOutcome, afterTalk, type Candidate, nextWorkingNine, rankForSetter } from "./dialer.ts";

const MIN = 60_000;
/** Kuwait wall time on Thursday 8 October 2026. */
const kw = (hhmm: string, day = "08") => Date.parse(`2026-10-${day}T${hhmm}:00+03:00`);

const SETTER = "setter@stress.invalid";

function lead(over: Partial<Candidate>): Candidate {
  return {
    contact_id: "stress-r6-huda",
    name: "Huda",
    phone: "+96550000000",
    created_at: kw("09:00", "06"),
    stage: null,
    lead_class: null,
    dnd: false,
    last_dial_at: null,
    reached: false,
    inbound_at: null,
    booked_at: null,
    last_call_status: null,
    last_call_type: null,
    last_call_at: null,
    due_at: null,
    callback_at: null,
    closed: null,
    claimed_by: null,
    sales_lead: true,
    stage_role: null,
    revenue: null,
    readiness: null,
    misses: 0,
    hot: false,
    hot_owner: null,
    hot_next_at: null,
    appt: null,
    owner: null,
    inbound_call_at: null,
    ...over,
  };
}

/** The joined step's JSX in DialerPage.tsx, as written. */
function joinedStep(): string {
  const src = readFileSync(new URL("../../../apps/sales-cockpit/src/pages/DialerPage.tsx", import.meta.url), "utf8");
  const at = src.indexOf(') : mode === "unanswered" && joinedAt ? (');
  const end = src.indexOf(') : mode === "unanswered" && spoke ? (', at);
  expect(at).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(at);
  return src.slice(at, end);
}

/** The pane's toNext as written: what Next lead does. */
function toNextBody(): string {
  const src = readFileSync(new URL("../../../apps/sales-cockpit/src/pages/DialerPage.tsx", import.meta.url), "utf8");
  const at = src.indexOf("const toNext = () => {");
  return src.slice(at, src.indexOf("};", at) + 2);
}

describe("journey: the fourth unanswered call, a Meet link, Huda joins and talks with the setter for 15 minutes, the setter presses Next lead on the joined step", () => {
  test("the lead is not closed as unreachable and dropped from the queue after a video conversation", () => {
    // Three unanswered tries on Monday to Wednesday (queue_state.step 3).
    // Thursday 11:00 the fourth call rings out: Maqsam's record saves No
    // answer by itself (index.ts saveOutcome, extra.auto), and the ladder
    // closes the lead as unreachable (nextTry: step >= 3).
    const now = kw("11:00");
    const st = afterOutcome("no_answer", 3, now, null);
    expect(st.closed).toBe("unreachable");
    // The setter sends a Meet link from the after-miss step; Huda opens it,
    // joins, they talk until 11:17, the setter presses Finished. The dialer
    // shows "Huda joined the video call. How did the intro go?" with Book
    // the demo, Save how it went and Next lead. Huda wants to think it over,
    // so the setter presses Next lead: toNext() only opens the next lead.
    const step = joinedStep();
    expect(step).toContain("<NextLeadButton onNext={toNext} />");
    // Fix round 6: toNext saves the talk through saveSpoke (a dial.save call-back).
    const nextSaves = /save\(|api\(|saveSpoke\(/.test(toNextBody());
    // So queue_state keeps the auto save's closed = unreachable: the lead is
    // out of every setter's queue for good (rankForSetter: closed), though
    // they just spoke for 15 minutes on video. Nothing about a room touches
    // queue_state (rooms.ts, roomlogic.ts), and the room's join is never
    // read for a lead item (index.ts candidates reads joins only for rooms
    // that carry an appointment).
    const standing = nextSaves ? null : st.closed;
    const ranked = rankForSetter(
      [lead({ closed: standing, last_dial_at: now, misses: 4, due_at: st.due })],
      SETTER,
      kw("09:30", "11"),
    );
    expect({ closed: standing, inQueueOrDecided: nextSaves || ranked.length > 0 }).toEqual({
      closed: expect.not.stringMatching(/^unreachable$/),
      inQueueOrDecided: true,
    });
  });

  test("an earlier try: the lead who spoke on video is not called back as 'not reached yet' with one more unanswered try", () => {
    // The first try, Thursday 11:00: No answer by Maqsam's record moves the
    // ladder to step 1, due at 17:00 (nextTry). The video conversation and
    // Next lead leave it there.
    const now = kw("11:00");
    const st = afterOutcome("no_answer", 0, now, null);
    expect(st.step).toBe(1);
    // Fix round 6: Next lead on the joined step saves the talk first, as a
    // call-back the next working morning (DialerPage saveSpoke), over the
    // automatic No answer's 17:00 retry; and sales-api's queue reads a
    // standing video join after that No answer as the lead reached, its
    // retry moved to the next working morning (index.ts candidates). The
    // queue as the save leaves it (the fixture alone, as first written,
    // could never tell a lead who talked on video from one nobody reached):
    const src = readFileSync(new URL("../../../apps/sales-cockpit/src/pages/DialerPage.tsx", import.meta.url), "utf8");
    const saveSpoke = src.slice(src.indexOf("async function saveSpoke()"), src.indexOf("const toNext = () => {"));
    expect(saveSpoke).toMatch(/outcome: "callback"/);
    const talked = kw("11:17");
    const back = spokeCallbackAt(talked);
    const after = afterOutcome("callback", st.step, talked, back, { due: st.due, callback: null });
    const at = kw("17:05");
    const ranked = rankForSetter(
      [lead({ created_at: kw("10:50"), due_at: after.due, callback_at: after.callback, last_dial_at: talked, misses: 1 })],
      SETTER,
      at,
    );
    const item = ranked.find(r => r.contact_id === "stress-r6-huda");
    // At 17:05 Huda is back at the top of the setter's queue as a lead the
    // dialer never reached, an hour after a 15-minute video intro.
    // Not in the queue before the call-back is due, or there as a call-back.
    expect(item?.why ?? "").not.toMatch(/not reached yet|Next try is due|never called/i);
  });
});

describe("fix round 6: the queue reads a video talk after Maqsam's No answer as the lead reached (index.ts candidates, dialer.ts afterTalk)", () => {
  test("the fourth try's 'unreachable' is lifted and the lead comes back the next working morning, reached", () => {
    const now = kw("11:00");
    const st = afterOutcome("no_answer", 3, now, null);
    const talked = kw("11:05");
    const t = afterTalk({ lastOutcome: "no_answer", lastOutcomeAt: now, closed: st.closed, due: st.due, talkedAt: talked });
    expect(t).toEqual({ talked: true, closed: null, due: nextWorkingNine(talked) });
    // The next working morning: a reached lead with a retry due, never "not reached yet".
    const ranked = rankForSetter(
      [lead({ reached: true, closed: t.closed, due_at: t.due, last_dial_at: now, misses: 4 })],
      SETTER,
      (t.due as number) + 5 * MIN,
    );
    expect(ranked[0]?.why ?? "").not.toMatch(/not reached yet|never called/i);
  });

  test("control: a save after the talk (the joined step's own) stands as it is", () => {
    const t = afterTalk({ lastOutcome: "callback", lastOutcomeAt: kw("11:20"), closed: null, due: kw("10:00", "10"), talkedAt: kw("11:05") });
    expect(t).toEqual({ talked: false, closed: null, due: kw("10:00", "10") });
    const before = afterTalk({ lastOutcome: "no_answer", lastOutcomeAt: kw("11:30"), closed: "unreachable", due: null, talkedAt: kw("11:05") });
    expect(before.closed).toBe("unreachable");
  });
});
