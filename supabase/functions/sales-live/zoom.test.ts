// bun test supabase/functions/sales-live
import { describe, expect, test } from "bun:test";
import {
  cleanZoom,
  codeFromTopic,
  pickZoomRoom,
  ZOOM_EVENTS,
  zoomDedupeKey,
  zoomKind,
  zoomLookup,
  zoomRoomQuery,
  zoomText,
} from "./zoom.ts";

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
    expect(d?.payload.object.id).toBe("85023456789");
    expect(d?.payload.object.topic).toBe("Mahara call K7Q2MX");
    expect(d?.payload.object.participant?.email).toBe("lead@example.com");
    expect(d?.payload.object.participant?.join_time).toBe("2026-10-03T11:02:10Z");
    const text = JSON.stringify(d);
    for (const gone of ["+96550000000", "203.0.113.9", "customer_key", "registrant_id", "reg", "timezone"])
      expect(text).not.toContain(gone);
    // Empty strings are not kept as values.
    expect(d?.payload.object.participant?.participant_user_id).toBeUndefined();
  });

  test("the kept event has Zoom's own shape, for sales-api's zoomEffect", () => {
    const d = cleanZoom(joined());
    expect(Object.keys(d ?? {})).toEqual(["event", "event_ts", "payload"]);
    expect(d?.payload.account_id).toBe("AAAA");
    expect(d?.payload.object.host_id).toBe("z8yAAAAA8bbbQ");
    expect(d?.payload.object.participant?.participant_uuid).toBe("pu-1");
  });

  test("a body with no event is not an event", () => {
    expect(cleanZoom({})).toBeNull();
    expect(cleanZoom(null)).toBeNull();
    expect(cleanZoom([1, 2])).toBeNull();
    expect(cleanZoom({ event: "meeting.started" })?.payload).toEqual({ object: {} });
  });

  test("control characters and long strings are cut", () => {
    const d = cleanZoom(joined({}, { user_name: `a\u0000b${"x".repeat(500)}` }));
    expect(d?.payload.object.participant?.user_name?.includes("\u0000")).toBe(false);
    expect(d?.payload.object.participant?.user_name?.length).toBeLessThanOrEqual(120);
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

  test("meeting.started and meeting.ended key on the meeting instance (each start is a new uuid)", async () => {
    const started = (uuid: string, ts: number) => ({
      event: "meeting.started",
      event_ts: ts,
      payload: { object: { id: "85023456789", uuid, start_time: "2026-10-03T11:00:00Z" } },
    });
    expect(await key(started("u1", 5))).toBe(await key(started("u1", 9)));
    expect(await key(started("u1", 5))).not.toBe(await key(started("u2", 5)));
    const ended = { event: "meeting.ended", payload: { object: { id: "85023456789", uuid: "u1", end_time: "2026-10-03T11:40:00Z" } } };
    expect(await key(ended)).toBe("zoom:meeting.ended:u1");
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

  test("the key is the room logic's own form, so both lanes name one event the same", async () => {
    // roomlogic.ts zoomDedupeKey on this event (scratchpad/review-door/keys.ts):
    const evt = {
      event: "meeting.participant_joined",
      event_ts: 1759489200123,
      payload: {
        account_id: "acc",
        object: {
          id: "85023456789",
          uuid: "abc==",
          host_id: "h1",
          topic: "Mahara call K7Q2MX",
          participant: { user_id: "16778240", participant_uuid: "pu-1", user_name: "Lead", join_time: "2026-10-03T11:00:00Z" },
        },
      },
    };
    expect(await key(evt)).toBe("zoom:meeting.participant_joined:abc==:pu-1:2026-10-03T11:00:00Z");
    expect(await key(joined())).toBe("zoom:meeting.participant_joined:4444AAAiAAAAAiAiAiiAii==:pu-1:2026-10-03T11:02:10Z");
    const noPerson = { event: "meeting.started", payload: { object: { id: 85023456789 } } };
    expect(await key(noPerson)).toBe("zoom:meeting.started:85023456789");
  });

  test("keys stay inside the table's 300 characters, whatever Zoom sends", async () => {
    const long = joined(
      { event_ts: 9 },
      { participant_uuid: "p".repeat(500), join_time: "t".repeat(500), user_name: "x".repeat(500) },
    );
    (long.payload.object as Record<string, unknown>).uuid = "u".repeat(500);
    expect((await key(long)).length).toBeLessThanOrEqual(300);
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

  test("exactly the seven subscribed events, and meeting.deleted (stress2, round 2)", () => {
    expect([...ZOOM_EVENTS].sort()).toEqual([
      "meeting.deleted",
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

describe("zoomText", () => {
  test("a plain line per event, with the display name when there is one", () => {
    const d = cleanZoom(joined());
    if (!d) throw new Error("no detail");
    expect(zoomText(d)).toBe("Zoom: Lead Person joined.");
    expect(zoomText({ ...d, event: "meeting.participant_joined_waiting_room" })).toBe(
      "Zoom: Lead Person is in the waiting room.",
    );
    expect(zoomText({ event: "meeting.started", payload: { object: {} } })).toBe("Zoom: the meeting started.");
    expect(zoomText({ event: "meeting.participant_left", payload: { object: { participant: {} } } })).toBe(
      "Zoom: Someone left.",
    );
    for (const e of ZOOM_EVENTS) expect(zoomText({ event: e, payload: { object: {} } }).length).toBeLessThanOrEqual(500);
  });
});

describe("which room a Zoom event is about", () => {
  const d = (object: Record<string, unknown>) => {
    const out = cleanZoom({ event: "meeting.participant_joined", payload: { object } });
    if (!out) throw new Error("no detail");
    return out;
  };
  const row = (id: string, state: string, code: string, provider_meeting_id: string | null = "85023456789") => ({
    id,
    state,
    code,
    provider_meeting_id,
  });

  test("an event is looked up by its meeting id and its topic's code, in one query", () => {
    const look = zoomLookup(d({ id: 85023456789, topic: "Mahara call K7Q2MX" }));
    expect(look).toEqual({ meetingId: "85023456789", code: "K7Q2MX" });
    expect(zoomRoomQuery(look)).toBe(
      "cockpit_sales_rooms?or=(provider_meeting_id.eq.85023456789,code.eq.K7Q2MX)&select=id,state,code,provider_meeting_id&order=created_at.desc&limit=10",
    );
    expect(zoomRoomQuery(zoomLookup(d({ id: 85023456789, topic: "Weekly sync" })))).toContain(
      "or=(provider_meeting_id.eq.85023456789)",
    );
  });

  test("an event with neither (or a meeting id that is not Zoom's digits) needs no query: it is no room", () => {
    expect(zoomRoomQuery(zoomLookup(d({ topic: "Interview" })))).toBeNull();
    expect(zoomLookup(d({ id: "1,code.eq.K7Q2MX", topic: "x" })).meetingId).toBeNull();
  });

  test("no row: not a cockpit room (the webinar, a client call)", () => {
    expect(pickZoomRoom([], { meetingId: "81234567890", code: null })).toEqual({ room: false });
    expect(pickZoomRoom(null, { meetingId: "81234567890", code: null })).toEqual({ room: false });
  });

  test("the topic's code decides first, then the one live room on the meeting, then the only room", () => {
    const rows = [row("a", "open", "AAAAAA"), row("b", "open", "K7Q2MX")];
    expect(pickZoomRoom(rows, { meetingId: "85023456789", code: "K7Q2MX" })).toEqual({ room: true, room_id: "b" });
    expect(pickZoomRoom([row("old", "ended", "AAAAAA"), row("now", "host_in", "BBBBBB")], { meetingId: "85023456789", code: null })).toEqual({
      room: true,
      room_id: "now",
    });
    expect(pickZoomRoom([row("only", "ended", "AAAAAA")], { meetingId: "85023456789", code: null })).toEqual({
      room: true,
      room_id: "only",
    });
  });

  test("two live rooms on one meeting and no code: a room's meeting, which room left to sales-api", () => {
    expect(pickZoomRoom([row("a", "open", "AAAAAA"), row("b", "open", "BBBBBB")], { meetingId: "85023456789", code: null })).toEqual({
      room: true,
      room_id: null,
    });
  });

  test("a room found by its code whose meeting id is not saved yet", () => {
    expect(pickZoomRoom([row("r", "creating", "K7Q2MX", null)], { meetingId: "85023456789", code: "K7Q2MX" })).toEqual({
      room: true,
      room_id: "r",
    });
  });
});
