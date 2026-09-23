import { describe, expect, test } from "bun:test";
import {
  merge,
  onesBurst,
  phoneKey,
  roomOf,
  type ZoomAttendance,
  type ZoomEngagement,
  type ZoomSession,
} from "../convex/ceo/webinarRoom";

// The webinar room (convex/ceo/webinarRoom.ts): what Zoom's join and leave
// rows become on the Frontend tab. Wrong here is a pitch that looks like it
// lost the room when it did not, or a show rate that counts the team.

const MIN = 60_000;
const T0 = Date.parse("2026-09-30T17:00:00Z");
const at = (m: number) => T0 + m * MIN;

const session = (over: Partial<ZoomSession> = {}): ZoomSession => ({
  uuid: "s1",
  startedAt: T0,
  endedAt: at(60),
  pitch1At: null,
  pitch2At: null,
  complete: true,
  ...over,
});

const seg = (
  person: string,
  join: number,
  leave: number | null,
  over: Partial<ZoomAttendance> = {},
): ZoomAttendance => ({
  sessionUuid: "s1",
  personKey: person,
  email: null,
  contactId: null,
  internal: false,
  joinAt: at(join),
  leaveAt: leave === null ? null : at(leave),
  ...over,
});

const line = (
  person: string,
  minute: number,
  one = false,
  over: Partial<ZoomEngagement> = {},
): ZoomEngagement => ({
  sessionUuid: "s1",
  kind: "chat",
  at: at(minute),
  personKey: person,
  one,
  private: false,
  ...over,
});

const opts = { scheduledAt: T0, pollsReadable: true };

describe("people in the room", () => {
  test("a rejoin is one person, and the team is left out", () => {
    const room = roomOf(
      [session()],
      [
        seg("name:a", 0, 20),
        seg("name:a", 25, 60),
        seg("name:b", 10, 60),
        seg("email:aziz@maharamedia.com", 0, 60, { internal: true }),
      ],
      [],
      opts,
    );
    expect(room?.attendees).toBe(2);
    // a: 20 + 35 minutes; b: 50 minutes.
    expect(room?.watchAvgMin).toBe(52.5);
    expect(room?.watchMedianMin).toBe(52.5);
  });

  test("two devices at once do not double the watch time", () => {
    expect(
      merge([
        [0, 10],
        [5, 20],
        [30, 40],
      ]),
    ).toEqual([
      [0, 20],
      [30, 40],
    ]);
  });

  test("on time is within three minutes of the scheduled start", () => {
    const room = roomOf(
      [session()],
      [seg("name:a", 2, 60), seg("name:b", 4, 60), seg("name:c", 0, 60)],
      [],
      opts,
    );
    expect(room?.onTime).toBe(0.667);
  });

  test("a false start with only the host does not stretch the room", () => {
    const room = roomOf(
      [
        session({ uuid: "false", startedAt: at(-30), endedAt: at(-29) }),
        session(),
      ],
      [
        seg("zoom:host", -30, -29, { sessionUuid: "false", internal: true }),
        seg("name:a", 0, 60),
      ],
      [],
      opts,
    );
    expect(room?.startAt).toBe(T0);
    expect(room?.sessions).toBe(1);
  });
});

describe("the curve", () => {
  const people = [
    ...Array.from({ length: 10 }, (_, i) => seg(`name:p${i}`, 0, 60)),
    ...Array.from({ length: 6 }, (_, i) => seg(`name:q${i}`, 0, 30)),
    ...Array.from({ length: 4 }, (_, i) => seg(`name:r${i}`, 5, 45)),
  ];
  const room = roomOf([session()], people, [], opts);

  test("people present at the middle of each minute", () => {
    expect(room?.curve.length).toBe(60);
    expect(room?.curve[0]).toBe(16);
    expect(room?.curve[10]).toBe(20);
    expect(room?.curve[30]).toBe(14);
    expect(room?.curve[50]).toBe(10);
    expect(room?.peak).toBe(20);
    expect(room?.peakMinute).toBe(5);
  });

  test("the biggest drop-offs, largest first", () => {
    expect(room?.drops).toEqual([
      { minute: 30, lost: 6 },
      { minute: 45, lost: 4 },
    ]);
  });

  test("stay to end counts who is there two minutes before it ends", () => {
    expect(room?.stayToEnd).toBe(0.5);
  });

  test("the curve ends with the last minute anybody was in the room", () => {
    const hostStays = roomOf(
      [session({ endedAt: at(75) })],
      [
        seg("name:a", 0, 50),
        seg("email:aziz@maharamedia.com", 0, 75, { internal: true }),
      ],
      [],
      opts,
    );
    expect(hostStays?.curve.length).toBe(50);
    expect(hostStays?.curve.at(-1)).toBe(1);
  });
});

describe("pitches", () => {
  const people = [
    ...Array.from({ length: 10 }, (_, i) => seg(`name:p${i}`, 0, 60)),
    ...Array.from({ length: 10 }, (_, i) => seg(`name:q${i}`, 0, 35)),
  ];

  test("pitch 1 is found from the burst of 1s in the chat", () => {
    const chat = [
      line("name:p0", 12),
      line("name:p1", 40, true),
      line("name:p2", 40, true),
      line("name:p3", 41, true),
      line("name:p4", 42, true),
      line("name:p5", 20, true),
    ];
    const room = roomOf([session()], people, chat, opts);
    const p1 = room?.pitches.find(p => p.n === 1);
    expect(p1?.source).toBe("chat");
    expect(p1?.minute).toBe(40);
    expect(p1?.present).toBe(10);
    expect(p1?.retention).toBe(0.5);
    expect(room?.chat.onesAtPitch1).toBe(4);
    expect(room?.chat.messages).toBe(6);
  });

  test("two stray 1s are not a pitch", () => {
    expect(onesBurst([at(5), at(30)])).toBeNull();
    expect(onesBurst([at(5), at(6), at(7)])).toBe(at(5));
    expect(onesBurst([at(5), at(6), at(9)])).toBeNull();
  });

  test("a time set in the cockpit wins over the chat", () => {
    const room = roomOf(
      [session({ pitch1At: at(25), pitch2At: at(50) })],
      people,
      [
        line("name:p1", 40, true),
        line("name:p2", 40, true),
        line("name:p3", 41, true),
      ],
      opts,
    );
    expect(
      room?.pitches.map(p => [p.n, p.minute, p.source, p.retention]),
    ).toEqual([
      [1, 25, "set", 1],
      [2, 50, "set", 0.5],
    ]);
  });

  test("the team's chat and direct messages are not the room's", () => {
    const room = roomOf(
      [session()],
      [...people, seg("email:nada@maharamedia.com", 0, 60, { internal: true })],
      [
        line("email:nada@maharamedia.com", 3),
        line("name:p1", 4, false, { private: true }),
        line("name:p2", 5),
      ],
      opts,
    );
    expect(room?.chat.messages).toBe(1);
    expect(room?.chat.people).toBe(1);
  });
});

describe("what Zoom cannot say", () => {
  test("polls and Q&A are unknown, not zero, when they cannot be read", () => {
    const room = roomOf([session()], [seg("name:a", 0, 60)], [], {
      scheduledAt: T0,
      pollsReadable: false,
    });
    expect(room?.polls).toBeNull();
    expect(room?.qa).toBeNull();
  });

  test("only emails and contact ids leave the room for matching, never names", () => {
    const room = roomOf(
      [session()],
      [
        seg("email:k@firm.com", 0, 60, { email: "k@firm.com" }),
        seg("name:guest", 0, 60),
        seg("reg:r1", 0, 60, {
          contactId: "abc123def456ghi789jk",
          email: "x@y.com",
        }),
      ],
      [],
      opts,
    );
    expect(room?.emails.sort()).toEqual(["k@firm.com", "x@y.com"]);
    expect(room?.contactIds).toEqual(["abc123def456ghi789jk"]);
  });

  test("no session, no room", () => {
    expect(roomOf([], [], [], opts)).toBeNull();
  });
});

describe("phones", () => {
  test("compared on the last eight digits", () => {
    expect(phoneKey("+965 9999 1234")).toBe("99991234");
    expect(phoneKey("99991234")).toBe("99991234");
    expect(phoneKey("1234")).toBeNull();
    expect(phoneKey(null)).toBeNull();
  });
});
