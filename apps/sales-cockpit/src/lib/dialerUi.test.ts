import { describe, expect, test } from "bun:test";
import { urgentEvents } from "./dialer";
import {
  afterMiss,
  afterSave,
  countsShown,
  type DialItem,
  isNextLeadKey,
  lateSentence,
  liveSkips,
  missedCallAt,
  missedCallLine,
  openAfterRead,
  outcomeWords,
  plainError,
  type Reach,
  readyLine,
  rowTime,
  type SavedWork,
  SKIP_MS,
  savedWorkTitle,
  savedWorkWhy,
  shortAgo,
  shortCountdown,
  skipFor,
  skipHolds,
  undialableLine,
  urgentFor,
} from "./dialerUi";

const item = (over: Partial<DialItem>): DialItem => ({
  contact_id: "c1",
  name: "Lead",
  phone: "96550012345",
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

describe("skips", () => {
  const now = Date.parse("2026-09-26T07:00:00Z");
  const lead = item({ tier: 1, why: "New lead, never called" });
  const skip = skipFor(lead, now);

  test("hold for the same tier and reason, under half an hour", () => {
    expect(skipHolds(skip, lead, now + 60_000)).toBe(true);
    expect(skipHolds(skip, lead, now + SKIP_MS - 1)).toBe(true);
    expect(skipHolds(skip, lead, now + SKIP_MS)).toBe(false);
  });

  test("drop when the tier or the reason changes", () => {
    expect(skipHolds(skip, { ...lead, tier: 0 }, now + 60_000)).toBe(false);
    expect(
      skipHolds(skip, { ...lead, why: "Wrote back today" }, now + 60_000),
    ).toBe(false);
  });

  test("a new message or a new call-back is a new reason", () => {
    const replied = item({
      why: "Wrote back minutes ago",
      inbound_at: "2026-09-26T06:58:00Z",
    });
    const s = skipFor(replied, now);
    expect(skipHolds(s, replied, now + 60_000)).toBe(true);
    expect(
      skipHolds(s, { ...replied, inbound_at: "2026-09-26T07:03:00Z" }, now),
    ).toBe(false);
    expect(
      skipHolds(s, { ...replied, callback_at: "2026-09-26T08:00:00Z" }, now),
    ).toBe(false);
  });

  test("a lead skipped in the morning who writes back later shows again", () => {
    const morning = skipFor(lead, now);
    const later = item({
      tier: 0,
      why: "Wrote back minutes ago",
      inbound_at: "2026-09-26T07:10:00Z",
    });
    const skips = { c1: morning };
    expect(liveSkips(skips, [later], now + 10 * 60_000)).toEqual({});
  });

  test("the list keeps the skips that hold, and is the same object when none lapsed", () => {
    const other = item({ contact_id: "c2", tier: 3, why: "Never called" });
    const skips = { c1: skip, c2: skipFor(other, now) };
    expect(liveSkips(skips, [lead, other], now + 60_000)).toBe(skips);
    // c1 left the queue: its skip goes; c2's stays.
    expect(Object.keys(liveSkips(skips, [other], now + 60_000))).toEqual([
      "c2",
    ]);
    // After half an hour both go.
    expect(liveSkips(skips, [lead, other], now + SKIP_MS)).toEqual({});
  });
});

describe("the queue's chips", () => {
  test("count only the leads the list shows", () => {
    const a = item({ contact_id: "a", tier: 0 });
    const b = item({ contact_id: "b", tier: 1 });
    const c = item({ contact_id: "c", tier: 1 });
    expect(countsShown([1, 2, 0, 40], [a, b, c], [b])).toEqual([0, 1, 0, 40]);
    expect(countsShown([1, 2, 0, 40], [a, b, c], [a, b, c])).toEqual([
      1, 2, 0, 40,
    ]);
  });
});

describe("the short countdown", () => {
  const now = Date.parse("2026-09-26T07:00:00Z");
  const [fresh] = urgentEvents(
    [item({ created_at: new Date(now - 30_000).toISOString() })],
    now,
  );

  test("counts down, then says how late against the two-minute target", () => {
    expect(shortCountdown(fresh, now)).toBe("Dial within 1:30");
    expect(shortCountdown(fresh, now + 90_000)).toBe("Dial now");
    // Waiting 12 minutes is 10 past the two-minute target.
    const twelve = now - 30_000 + 12 * 60_000;
    expect(shortCountdown(fresh, twelve)).toBe("10 min late");
    expect(lateSentence(fresh, twelve)).toBe(
      "Two-minute target passed, waiting 12 min.",
    );
    expect(lateSentence(fresh, now)).toBeNull();
  });

  test("stays short enough for a phone", () => {
    for (const ms of [0, 60_000, 5 * 60_000, 95 * 60_000])
      expect(shortCountdown(fresh, now + ms).length).toBeLessThanOrEqual(16);
  });

  test("a call-back keeps its own words", () => {
    const [cb] = urgentEvents(
      [item({ callback_at: new Date(now + 4 * 60_000).toISOString() })],
      now,
    );
    expect(shortCountdown(cb, now)).toBe("Due in 4 min");
    expect(shortCountdown(cb, now + 7 * 60_000)).toBe("3 min overdue");
    expect(lateSentence(cb, now + 7 * 60_000)).toBeNull();
  });
});

describe("leads the dialer cannot call", () => {
  test("nothing to say when there are none", () => {
    expect(undialableLine(null)).toBeNull();
    expect(undialableLine({ no_phone: 0, other: 0 })).toBeNull();
  });
  test("one kind, one or many", () => {
    expect(undialableLine({ no_phone: 1, other: 0 })).toBe(
      "1 recent lead has no phone number, so the dialer can't call them.",
    );
    expect(undialableLine({ no_phone: 4, other: 0 })).toBe(
      "4 recent leads have no phone number, so the dialer can't call them.",
    );
    expect(undialableLine({ no_phone: 0, other: 1 })).toBe(
      "1 recent lead has a number the dialer has no line for. Call it from the Maqsam softphone.",
    );
    expect(undialableLine({ no_phone: 0, other: 3 })).toBe(
      "3 recent leads have numbers the dialer has no line for. Call them from the Maqsam softphone.",
    );
  });
  test("both kinds", () => {
    expect(undialableLine({ no_phone: 2, other: 1 })).toBe(
      "3 recent leads can't be dialed here: 2 have no phone number, 1 has a number the dialer has no line for. Call that one from the Maqsam softphone.",
    );
    expect(undialableLine({ no_phone: 1, other: 2 })).toBe(
      "3 recent leads can't be dialed here: 1 has no phone number, 2 have numbers the dialer has no line for. Call those from the Maqsam softphone.",
    );
  });
});

describe("after a no-answer", () => {
  const open: Reach = {
    on: true,
    dnd: false,
    reachable: true,
    window: { open: true },
  };
  const closed: Reach = { ...open, window: { open: false } };
  const email: Reach = { on: true, dnd: false, reachable: true };
  const noEmail: Reach = { ...email, reachable: false };

  test("inside the 24 hours the ready message goes on WhatsApp", () => {
    const s = afterMiss({
      moment: "missed_call",
      whatsapp: open,
      email,
      templatesLive: false,
      messageReady: true,
    });
    expect(s.send).toBe("whatsapp");
    expect(s.text).toContain(
      "The missed-call message is ready in the box; read it, then send.",
    );
    expect(
      afterMiss({
        moment: "missed_call",
        whatsapp: open,
        email,
        templatesLive: false,
        messageReady: false,
      }).text,
    ).toContain("Write it in the box, then send.");
  });

  test("outside them it goes as a template when one is set up", () => {
    const s = afterMiss({
      moment: "missed_call",
      whatsapp: closed,
      email,
      templatesLive: true,
      messageReady: true,
    });
    expect(s.send).toBe("whatsapp");
    expect(s.text).toContain("approved template");
    expect(s.text).not.toContain("email instead");
  });

  test("with no template, it says only email can go, and who sets templates up", () => {
    const s = afterMiss({
      moment: "missed_call",
      whatsapp: closed,
      email,
      templatesLive: false,
      messageReady: true,
    });
    expect(s).toEqual({
      title: "No answer. Send them an email?",
      text: "They have not written in the last 24 hours, so WhatsApp takes only an approved template, and none is set up yet: send an email instead. A manager connects the templates under Follow-ups, WhatsApp library.",
      send: "email",
    });
    expect(s.text).not.toContain("ready in the box");
  });

  test("with no template and no email address, nothing is offered", () => {
    const s = afterMiss({
      moment: "confirm",
      whatsapp: closed,
      email: noEmail,
      templatesLive: false,
      messageReady: true,
    });
    expect(s.send).toBeNull();
    expect(s.text).toBe(
      "They have not written in the last 24 hours, so WhatsApp takes only an approved template, and none is set up yet. Email is out too: they have no email address in HighLevel. A manager connects the templates under Follow-ups, WhatsApp library. The dialer tries the call again in two hours.",
    );
  });

  test("a lead who asked for no WhatsApp gets the email box", () => {
    const s = afterMiss({
      moment: "missed_call",
      whatsapp: { ...open, dnd: true },
      email,
      templatesLive: true,
      messageReady: true,
    });
    expect(s.send).toBe("email");
    expect(s.text).toBe(
      "They asked not to be contacted on WhatsApp: send an email instead.",
    );
  });

  test("while the conversation is read, WhatsApp is offered without promises", () => {
    const s = afterMiss({
      moment: "confirm",
      whatsapp: null,
      email: null,
      templatesLive: null,
      messageReady: null,
    });
    expect(s.send).toBe("whatsapp");
    expect(s.text).toBe(
      "A short WhatsApp asking them to confirm often gets the answer a call did not. The dialer tries the call again in two hours.",
    );
  });
});

describe("missed calls", () => {
  // 11:00 Kuwait on Saturday 26 September.
  const now = Date.parse("2026-09-26T08:00:00Z");
  const called = new Date(now - 90_000).toISOString();

  test("count while nobody has called them back, for a day", () => {
    expect(missedCallAt(item({ inbound_call_at: called }), now)).toBe(
      now - 90_000,
    );
    expect(
      missedCallAt(
        item({
          inbound_call_at: called,
          last_dial_at: new Date(now - 30_000).toISOString(),
        }),
        now,
      ),
    ).toBeNull();
    expect(
      missedCallAt(
        item({ inbound_call_at: new Date(now - 25 * 3_600_000).toISOString() }),
        now,
      ),
    ).toBeNull();
    expect(missedCallAt(item({ inbound_call_at: null }), now)).toBeNull();
  });

  test("the banner says when, on the Kuwait clock", () => {
    expect(missedCallLine(item({ inbound_call_at: called }), now)).toBe(
      "Missed their call at 10:58. Call them back.",
    );
    // 22:30 Kuwait the evening before.
    expect(
      missedCallLine(item({ inbound_call_at: "2026-09-25T19:30:00Z" }), now),
    ).toBe("Missed their call yesterday at 22:30. Call them back.");
    expect(missedCallLine(item({}), now)).toBeNull();
  });

  test("the strip counts two minutes from their call, not from when they came in", () => {
    const [e] = urgentFor(
      [
        item({
          why: "Called us, missed it",
          created_at: new Date(now - 5 * 3_600_000).toISOString(),
          inbound_call_at: called,
        }),
      ],
      now,
    );
    expect(e.title).toBe("Missed their call");
    expect(shortCountdown(e, now)).toBe("Dial within 0:30");
    // urgentEvents alone read it as a new lead five hours late.
    const [old] = urgentEvents(
      [item({ created_at: new Date(now - 5 * 3_600_000).toISOString() })],
      now,
    );
    expect(shortCountdown(old, now)).toBe("298 min late");
  });

  test("a later reply, a close call-back or a booked call keeps its own event", () => {
    const reply = urgentFor(
      [
        item({
          inbound_call_at: called,
          inbound_at: new Date(now - 10_000).toISOString(),
        }),
      ],
      now,
    );
    expect(reply.map(e => e.title)).toEqual(["Wrote back"]);
    const callback = urgentFor(
      [
        item({
          inbound_call_at: called,
          callback_at: new Date(now + 3 * 60_000).toISOString(),
        }),
      ],
      now,
    );
    expect(callback.map(e => e.title)).toEqual(["Call back, as agreed"]);
    expect(
      urgentFor([item({ tier: 1, inbound_call_at: called })], now),
    ).toEqual([]);
  });

  test("the strip is still ordered by deadline", () => {
    const e = urgentFor(
      [
        item({
          contact_id: "new",
          created_at: new Date(now - 20_000).toISOString(),
        }),
        item({ contact_id: "missed", inbound_call_at: called }),
      ],
      now,
    );
    expect(e.map(x => x.contact_id)).toEqual(["missed", "new"]);
  });
});

describe("a call-back five minutes early", () => {
  const now = Date.parse("2026-09-26T08:00:00Z");
  const early = item({
    why: "Call back at 11:04, as agreed",
    callback_at: new Date(now + 4 * 60_000).toISOString(),
    created_at: new Date(now - 10 * 3_600_000).toISOString(),
  });

  test("is due, never late, and its row shows the agreed time", () => {
    const [e] = urgentFor([early], now);
    expect(e.callback).toBe(true);
    expect(shortCountdown(e, now)).toBe("Due in 4 min");
    expect(lateSentence(e, now)).toBeNull();
    expect(e.deadline > now).toBe(true);
    expect(rowTime(early, now)).toBe("11:04");
  });
});

describe("queue rows and the ready line", () => {
  const now = Date.parse("2026-09-26T08:00:00Z");
  test("rows show the booked call, the missed call or how long ago", () => {
    expect(
      rowTime(
        item({
          kind: "confirm",
          appointment: {
            id: "a",
            type: "demo",
            start_at: "2026-09-26T15:00:00Z",
            booked_at: null,
            assigned_user_id: null,
            confirmed: false,
          },
        }),
        now,
      ),
    ).toBe("18:00");
    expect(
      rowTime(
        item({
          tier: 1,
          inbound_call_at: new Date(now - 3 * 3_600_000).toISOString(),
          created_at: new Date(now - 5 * 86_400_000).toISOString(),
        }),
        now,
      ),
    ).toBe("3h");
    expect(
      rowTime(
        item({ created_at: new Date(now - 40 * 60_000).toISOString() }),
        now,
      ),
    ).toBe("40m");
    expect(shortAgo(new Date(now + 20 * 60_000).toISOString(), now)).toBe(
      "in 20m",
    );
  });

  test("never says never called twice", () => {
    expect(readyLine(item({ tier: 3, why: "Never called" }), now)).toBe(
      "Never called",
    );
    expect(readyLine(item({ why: "Wrote back today" }), now)).toBe(
      "Wrote back today · never called",
    );
    expect(
      readyLine(
        item({
          why: "Next try is due",
          step: 2,
          last_dial_at: new Date(now - 2 * 3_600_000).toISOString(),
        }),
        now,
      ),
    ).toBe("Next try is due · 2 unanswered tries so far · last called 2 h ago");
  });
});

describe("after a save", () => {
  test("the next lead opens at once, the call centre's way", () => {
    for (const o of [
      "no_answer",
      "callback",
      "not_interested",
      "disqualified",
      "wrong_number",
      "handled",
    ])
      expect(afterSave("lead", o, false)).toBe("next");
    expect(afterSave("confirm", "confirmed", false)).toBe("next");
    expect(afterSave("confirm", "no_answer", false)).toBe("next");
    expect(afterSave("intro", "noshow", false)).toBe("next");
  });

  test("a held intro and a no-answer to message stay on the lead", () => {
    expect(afterSave("intro", "showed", false)).toBe("held");
    expect(afterSave("lead", "no_answer", true)).toBe("message");
    expect(afterSave("confirm", "no_answer", true)).toBe("message");
    // Only a no-answer has the message step.
    expect(afterSave("lead", "callback", true)).toBe("next");
  });

  test("Alt+→ moves on, but not while typing or with other keys held", () => {
    const k = {
      key: "ArrowRight",
      altKey: true,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    };
    expect(isNextLeadKey(k, false)).toBe(true);
    expect(isNextLeadKey(k, true)).toBe(false);
    expect(isNextLeadKey({ ...k, shiftKey: true }, false)).toBe(false);
    expect(isNextLeadKey({ ...k, altKey: false }, false)).toBe(false);
    expect(isNextLeadKey({ ...k, key: "ArrowLeft" }, false)).toBe(false);
  });
});

describe("a late read of the queue", () => {
  const call = { id: "att-7" };
  test("never ends a call it could not know about", () => {
    // Asked at 100, the call placed at 150: the read says no call.
    expect(openAfterRead(null, { attempt: call, at: 150 }, 100)).toBe(call);
  });
  test("a read asked after the call is believed", () => {
    expect(openAfterRead(null, { attempt: call, at: 150 }, 200)).toBeNull();
    const other = { id: "att-8" };
    expect(openAfterRead(other, { attempt: call, at: 150 }, 100)).toBe(other);
    expect(openAfterRead(null, null, 100)).toBeNull();
  });
});

describe("saved work", () => {
  const w = (over: Partial<SavedWork>): SavedWork => ({
    attempt_id: "a1",
    contact_id: "c1",
    name: "Lead",
    outcome: "callback",
    saved_at: "2026-09-26T07:00:00Z",
    crm_note: "failed",
    error: null,
    ...over,
  });
  test("says how many, once", () => {
    expect(savedWorkTitle(1)).toBe("1 save is not in HighLevel yet");
    expect(savedWorkTitle(3)).toBe("3 saves are not in HighLevel yet");
  });
  test("says why in a few words", () => {
    expect(savedWorkWhy(w({}))).toBe("HighLevel did not take it.");
    expect(savedWorkWhy(w({ crm_note: "pending" }))).toBe(
      "Still not in HighLevel after two minutes.",
    );
    expect(savedWorkWhy(w({ error: "HighLevel said 422: merged" }))).toBe(
      "HighLevel said 422: merged",
    );
    expect(savedWorkWhy(w({ error: "x".repeat(300) })).length).toBe(140);
  });
  test("names outcomes as the screen does", () => {
    expect(outcomeWords("not_interested")).toBe("Not interested");
    expect(outcomeWords("showed")).toBe("Intro held");
    expect(outcomeWords("something_new")).toBe("something new");
  });
});

describe("server sentences on screen", () => {
  test("a JSON blob becomes its message", () => {
    expect(
      plainError(
        'The call did not go through: Maqsam did not accept the call: {"message":"agent is busy"}',
      ),
    ).toBe(
      "The call did not go through: Maqsam did not accept the call: agent is busy",
    );
    expect(plainError('Maqsam said: {"code":7}')).toBe("Maqsam said");
    expect(plainError("Fill in {name} first.")).toBe("Fill in {name} first.");
    expect(plainError(null)).toBe("");
  });
});
