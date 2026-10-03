// bun test supabase/functions/sales-live
import { describe, expect, test } from "bun:test";
import { cleanZoom, codeFromTopic, ZOOM_EVENTS, zoomDedupeKey, zoomKind } from "./zoom.ts";

/** A participant_joined body shaped like Zoom's reference. */
function joined(over: Record<string, unknown> = {}, participant: Record<string, unknown> = {}) {
  return {
    event: "meeting.participant_joined",
    event_ts: 1696320000123,
    payload: {
      account_id: "AAAA",
      object: {
        id: 85023456789,
        uuid: "4444AAAiAAAAAiAiAiiAii==",
        host_id: "z8yAAAAA8bbbQ",
        topic: "Mahara call K7Q2MX",
        type: 2,
        start_time: "2026-10-03T11:00:00Z",
        duration: 30,
        timezone: "Asia/Kuwait",
        participant: {
          user_id: "16778240",
          user_name: "Lead Person",
          participant_user_id: "",
          participant_uuid: "pu-1",
          id: "",
          email: "Lead@Example.com",
          join_time: "2026-10-03T11:02:10Z",
          phone_number: "+96550000000",
          customer_key: "ck",
          registrant_id: "reg",
          public_ip: "203.0.113.9",
          ...participant,
        },
      },
    },
    ...over,
  };
}

describe("cleanZoom", () => {
  test("keeps what the room logic needs and nothing personal beyond it", () => {
    const d = cleanZoom(joined());
    expect(d).not.toBeNull();
    expect(d?.event).toBe("meeting.participant_joined");
    expect(d?.meeting.id).toBe("85023456789");
    expect(d?.meeting.topic).toBe("Mahara call K7Q2MX");
    expect(d?.participant?.email).toBe("lead@example.com");
    expect(d?.participant?.join_time).toBe("2026-10-03T11:02:10Z");
    const text = JSON.stringify(d);
    for (const gone of ["+96550000000", "203.0.113.9", "customer_key", "registrant_id", "reg", "timezone"])
      expect(text).not.toContain(gone);
    // Empty strings are not kept as values.
    expect(d?.participant?.participant_user_id).toBeUndefined();
  });

  test("a body with no event is not an event", () => {
    expect(cleanZoom({})).toBeNull();
    expect(cleanZoom(null)).toBeNull();
    expect(cleanZoom([1, 2])).toBeNull();
    expect(cleanZoom({ event: "meeting.started" })?.meeting).toEqual({});
  });

  test("control characters and long strings are cut", () => {
    const d = cleanZoom(joined({}, { user_name: `a\u0000b${"x".repeat(500)}` }));
    expect(d?.participant?.user_name?.includes("\u0000")).toBe(false);
    expect(d?.participant?.user_name?.length).toBeLessThanOrEqual(120);
  });
});

describe("zoomDedupeKey", () => {
  const key = async (b: unknown) => {
    const d = cleanZoom(b);
    if (!d) throw new Error("no detail");
    return zoomDedupeKey(d);
  };

  test("a Zoom retry of the same event gets the same key", async () => {
    expect(await key(joined())).toBe(await key(joined()));
  });

  test("the key ignores the delivery time when the event has its own", async () => {
    expect(await key(joined({ event_ts: 1 }))).toBe(await key(joined({ event_ts: 2 })));
  });

  test("the same person joining again later is a second event", async () => {
    const again = joined({}, { join_time: "2026-10-03T11:09:00Z" });
    expect(await key(joined())).not.toBe(await key(again));
  });

  test("joined and left are different events", async () => {
    const left = joined({ event: "meeting.participant_left" }, { leave_time: "2026-10-03T11:20:00Z" });
    expect(await key(joined())).not.toBe(await key(left));
  });

  test("two people joining in the same second are two events", async () => {
    const other = joined({}, { participant_uuid: "pu-2" });
    expect(await key(joined())).not.toBe(await key(other));
  });

  test("another instance of the same meeting id is another event", async () => {
    const b = joined();
    (b.payload.object as Record<string, unknown>).uuid = "other-instance==";
    expect(await key(joined())).not.toBe(await key(b));
  });

  test("meeting.started and meeting.ended key on their own times", async () => {
    const started = (t: string) => ({
      event: "meeting.started",
      event_ts: 5,
      payload: { object: { id: "85023456789", uuid: "u1", start_time: t } },
    });
    expect(await key(started("2026-10-03T11:00:00Z"))).toBe(await key({ ...started("2026-10-03T11:00:00Z"), event_ts: 9 }));
    expect(await key(started("2026-10-03T11:00:00Z"))).not.toBe(await key(started("2026-10-03T12:00:00Z")));
    const ended = { event: "meeting.ended", payload: { object: { id: "85023456789", uuid: "u1", end_time: "2026-10-03T11:40:00Z" } } };
    expect(await key(ended)).toMatch(/^zoom:meeting\.ended:[0-9a-f]{40}$/);
  });

  test("the join-before-host events, which carry no time, fall back to event_ts", async () => {
    const jbh = (ts: number) => ({
      event: "meeting.participant_jbh_waiting",
      event_ts: ts,
      payload: { object: { id: "85023456789", uuid: "u1", participant: { id: "p", user_name: "Lead" } } },
    });
    expect(await key(jbh(1))).toBe(await key(jbh(1)));
    expect(await key(jbh(1))).not.toBe(await key(jbh(2)));
  });

  test("keys are short and start with the event name", async () => {
    const k = await key(joined());
    expect(k).toMatch(/^zoom:meeting\.participant_joined:[0-9a-f]{40}$/);
    expect(k.length).toBeLessThan(120);
  });
});

describe("topics, kinds and the subscribed set", () => {
  test("the room code comes out of the worker's topic", () => {
    expect(codeFromTopic("Mahara call K7Q2MX")).toBe("K7Q2MX");
    expect(codeFromTopic("Mahara call k7q2mx")).toBeNull();
    expect(codeFromTopic("Mahara call K7Q2M0")).toBeNull();
    expect(codeFromTopic("Weekly sync")).toBeNull();
    expect(codeFromTopic(undefined)).toBeNull();
  });

  test("kinds are zoom. plus Zoom's own name", () => {
    expect(zoomKind("meeting.participant_joined")).toBe("zoom.meeting.participant_joined");
  });

  test("exactly the seven subscribed events", () => {
    expect([...ZOOM_EVENTS].sort()).toEqual([
      "meeting.ended",
      "meeting.participant_jbh_joined",
      "meeting.participant_jbh_waiting",
      "meeting.participant_joined",
      "meeting.participant_joined_waiting_room",
      "meeting.participant_left",
      "meeting.started",
    ]);
  });
});
