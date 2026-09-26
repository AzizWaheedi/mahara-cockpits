import { describe, expect, test } from "bun:test";
import { type QueueItem, urgentEvents } from "./dialer";
import {
  afterMiss,
  countsShown,
  lateSentence,
  liveSkips,
  type Reach,
  SKIP_MS,
  shortCountdown,
  skipFor,
  skipHolds,
  undialableLine,
} from "./dialerUi";

const item = (over: Partial<QueueItem>): QueueItem => ({
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
