import { describe, expect, test } from "bun:test";
import {
  callbackPicks,
  countdown,
  kuwaitAt,
  type QueueItem,
  urgentEvents,
} from "./dialer";

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

describe("the urgent strip", () => {
  const now = Date.parse("2026-09-26T07:00:00Z"); // 10:00 Kuwait, a Saturday
  test("a new lead has two minutes from arriving; a reply from writing", () => {
    const e = urgentEvents(
      [
        item({
          contact_id: "new",
          created_at: new Date(now - 30_000).toISOString(),
        }),
        item({
          contact_id: "reply",
          created_at: new Date(now - 86_400_000).toISOString(),
          inbound_at: new Date(now - 100_000).toISOString(),
        }),
        item({
          contact_id: "later",
          tier: 1,
          created_at: new Date(now).toISOString(),
        }),
      ],
      now,
    );
    expect(e.map(x => x.contact_id)).toEqual(["reply", "new"]);
    expect(countdown(e[1], now)).toBe("Dial within 1:30");
    expect(countdown(e[0], now)).toBe("Dial within 0:20");
    expect(countdown(e[0], now + 5 * 60_000)).toBe(
      "Two-minute target passed, waiting 6 min",
    );
  });
  test("a call-back counts down to its time and then says how late it is", () => {
    const [e] = urgentEvents(
      [item({ callback_at: new Date(now + 4 * 60_000).toISOString() })],
      now,
    );
    expect(e.callback).toBe(true);
    expect(countdown(e, now)).toBe("Due in 4 min");
    expect(countdown(e, now + 4 * 60_000 + 30_000)).toBe("Due now");
    expect(countdown(e, now + 7 * 60_000)).toBe("3 min overdue");
  });
});

describe("call-back times", () => {
  test("on a working morning: an hour, this evening, tomorrow", () => {
    const now = Date.parse("2026-09-26T07:05:00Z"); // Sat 10:05 Kuwait
    const p = callbackPicks(now);
    expect(p.map(x => x.label)).toEqual([
      "In an hour",
      "Today 17:00",
      "Tomorrow 10:00",
      "Tomorrow 14:00",
    ]);
    expect(p[1].at).toBe(kuwaitAt(now, 17));
    expect(p[0].at).toBe(Date.parse("2026-09-26T08:15:00Z"));
  });
  test("on Thursday afternoon the next working day is Saturday", () => {
    const now = Date.parse("2026-09-24T13:00:00Z"); // Thu 16:00 Kuwait
    const p = callbackPicks(now);
    expect(p.map(x => x.label)).toEqual([
      "In an hour",
      "Saturday 10:00",
      "Saturday 14:00",
    ]);
    expect(p[1].at).toBe(kuwaitAt(now, 10, 0, 2));
  });
});
