import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { ApiError } from "./apiErrors";
import type {
  Health,
  LiveStatus,
  Offer,
  Presence,
  RoomView,
  StripLine,
} from "./rooms";

// sales-api is replaced before rooms.ts loads: the real client needs the
// Supabase settings and the network, and these tests use neither.
type Call = { action: string; body: Record<string, unknown> };
const calls: Call[] = [];
let answer: (c: Call) => Promise<unknown> = async () => ({ ok: true });
mock.module("./api", () => ({
  api: (action: string, body: Record<string, unknown> = {}) => {
    const c = { action, body };
    calls.push(c);
    return answer(c);
  },
}));

const R = await import("./rooms");
const F = await import("../dev/roomFixtures");

/** 14:12:00 in Kuwait on 3 October 2026. */
const NOW = Date.parse("2026-10-03T11:12:00.000Z");
const S = 1000;
const MIN = 60 * S;
const iso = (ms: number) => new Date(ms).toISOString();

const room = (over: Partial<RoomView> = {}) => F.baseRoom(NOW, over);
/** Sent at 14:11:12 on WhatsApp; the lead has until 14:21:12 (9:12 left). */
const sentRoom = (over: Partial<RoomView> = {}) =>
  room({
    link_channels: ["whatsapp_text"],
    link_sent_at: iso(NOW - 48 * S),
    lead_by: iso(NOW + 552 * S),
    ...over,
  });
const say = (
  r: RoomView,
  extra: Partial<Parameters<typeof R.roomSentence>[1]> = {},
) => R.sentenceText(R.roomSentence(r, { now: NOW, ...extra }));

const me = (over: Partial<Presence> = {}): Presence => ({
  email: "omar@example.com",
  state: "away",
  until: null,
  room_id: null,
  zoom_status: "licensed",
  default_provider: "zoom",
  ...over,
});
const working: Health = {
  worker_ok: true,
  last_run_at: iso(NOW - 2 * S),
  rooms_today: 6,
  failed_today: 0,
  line: "Rooms: working. Last run 14:11:58. 6 rooms today, 0 failed.",
};
const down: Health = {
  worker_ok: false,
  last_run_at: iso(NOW - 20 * MIN),
  rooms_today: 6,
  failed_today: 1,
  line: "Rooms are down. The room worker last ran at 13:52. Call the lead on the phone, or send your own Zoom or Meet link.",
};
const strip = (over: Partial<Parameters<typeof R.stripLine>[0]> = {}) =>
  R.stripLine({
    me: me(),
    rooms: [],
    offers: [],
    health: working,
    now: NOW,
    flash: null,
    ...over,
  });
const text = (l: StripLine) => R.sentenceText(l.sentence);

beforeEach(() => {
  calls.length = 0;
  answer = async () => ({ ok: true });
  R.forgetRequests();
});
afterEach(() => R.forgetRequests());

// ---------------------------------------------------------------------------

describe("small helpers", () => {
  test("mmss counts down and never goes below 0:00", () => {
    expect(R.mmss(552_000)).toBe("9:12");
    expect(R.mmss(107_000)).toBe("1:47");
    expect(R.mmss(999)).toBe("0:01");
    expect(R.mmss(0)).toBe("0:00");
    expect(R.mmss(-5000)).toBe("0:00");
    expect(R.mmss(3_600_000)).toBe("60:00");
  });

  test("the read-out drops the scheme and falls back to the room's own link, then the code", () => {
    expect(R.readOut(room())).toBe("call.maharamedia.com/K7Q2MX");
    expect(R.readOut(room({ short_url: null }))).toBe(
      "meet.google.com/abc-defg-hij",
    );
    expect(R.readOut(room({ short_url: null, join_url: null }))).toBe("K7Q2MX");
  });

  test("channels read as words, once each, in the glossary's names", () => {
    expect(R.channelWords(["whatsapp_text"])).toBe("WhatsApp");
    expect(R.channelWords(["whatsapp_template"])).toBe("WhatsApp");
    expect(R.channelWords(["email"])).toBe("email");
    expect(R.channelWords(["whatsapp_text", "email"])).toBe(
      "WhatsApp and email",
    );
    expect(R.channelWords(["whatsapp_template", "email"])).toBe(
      "WhatsApp and email",
    );
    expect(R.channelWords(["whatsapp_text", "whatsapp_template"])).toBe(
      "WhatsApp",
    );
    // Contract v2: only the glossary's three. A bare "whatsapp" or
    // "read_out" is not a channel the database or sales-api allows.
    expect(R.channelWords(["whatsapp"])).toBeNull();
    expect(R.channelWords(["read_out"])).toBeNull();
    // A key on Object's prototype is not a channel either.
    expect(R.channelWords(["constructor", "toString"])).toBeNull();
    expect(R.channelWords([])).toBeNull();
    // Names nothing serves say nothing.
    expect(R.channelWords(["template", "template_unconfirmed"])).toBeNull();
  });

  test("devices", () => {
    expect(R.deviceWords("phone")).toBe("phone");
    expect(R.deviceWords("iOS")).toBe("phone");
    expect(R.deviceWords("iPad")).toBe("tablet");
    expect(R.deviceWords("desktop")).toBe("computer");
    expect(R.deviceWords(null)).toBeNull();
    expect(R.deviceWords("bot")).toBeNull();
  });

  test("a reason after a colon loses its full stop and capital, but not a name's", () => {
    expect(R.reasonWords("No message can reach this lead.")).toBe(
      "no message can reach this lead",
    );
    expect(R.reasonWords("WhatsApp is closed for this lead.")).toBe(
      "WhatsApp is closed for this lead",
    );
    expect(R.reasonWords("Zoom answered 429")).toBe("Zoom answered 429");
    expect(R.reasonWords("HighLevel refused the template.")).toBe(
      "HighLevel refused the template",
    );
    expect(R.reasonWords(null)).toBe("");
  });

  test("the spoken sentence leaves the ticking countdown out", () => {
    const s = R.roomSentence(sentRoom(), { now: NOW });
    expect(R.sentenceText(s)).toBe(
      "Link sent on WhatsApp at 14:11. Waiting for Faisal (9:12 left).",
    );
    expect(R.sentenceText(s, true)).toBe(
      "Link sent on WhatsApp at 14:11. Waiting for Faisal.",
    );
    const offer = R.offerSentence(F.offerFixture(NOW), NOW);
    expect(R.sentenceText(offer, true)).toBe(
      "Live lead: demo, Saudi Arabia, on the line with the setter. Note: Runs 3 fit-out crews and wants more villa projects.",
    );
  });

  test("request ids are v4 UUIDs and never repeat", () => {
    const a = R.newRequestId();
    const b = R.newRequestId();
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------

describe("which moment a room is in", () => {
  const cases: [string, Partial<RoomView>, ReturnType<typeof R.roomMoment>][] =
    [
      ["requested", { state: "requested" }, "making"],
      ["creating", { state: "creating" }, "making"],
      ["failed", { state: "failed" }, "failed"],
      ["open, nothing sent", {}, "ready"],
      [
        "sent",
        { link_sent_at: iso(NOW), link_channels: ["whatsapp_text"] },
        "sent",
      ],
      [
        "not confirmed",
        {
          link_sent_at: iso(NOW),
          link_channels: ["whatsapp_template", "email"],
          link_unconfirmed_at: iso(NOW),
        },
        "not_confirmed",
      ],
      ["not sent", { refusal: "No message can reach this lead." }, "not_sent"],
      ["opened", { link_sent_at: iso(NOW), first_open_at: iso(NOW) }, "opened"],
      [
        "waiting room beats everything open",
        {
          state: "host_in",
          link_sent_at: iso(NOW),
          first_open_at: iso(NOW),
          lead_waiting_at: iso(NOW),
        },
        "waiting_room",
      ],
      [
        "host in beats opened",
        { state: "host_in", link_sent_at: iso(NOW), first_open_at: iso(NOW) },
        "host_in",
      ],
      [
        "not sent stays said when the host is in (the code is read out)",
        { state: "host_in", refusal: "No message can reach this lead." },
        "not_sent",
      ],
      ["lead in", { state: "lead_in", lead_in_at: iso(NOW) }, "joined"],
      [
        "lead in past the end",
        { state: "lead_in", ends_at: iso(NOW - S) },
        "still_on_call",
      ],
      ["expired", { state: "expired" }, "expired"],
      [
        "ended with nobody joining",
        { state: "ended", result: "no_join" },
        "expired",
      ],
      ["ended", { state: "ended", result: "joined" }, "closed"],
      ["cancelled", { state: "cancelled" }, "closed"],
      [
        "standby, open",
        { purpose: "standby", contact_id: null },
        "standby_open",
      ],
      [
        "standby, host in",
        { purpose: "standby", contact_id: null, state: "host_in" },
        "standby_in",
      ],
      [
        "standby, expired is closed (no lead was waited for)",
        { purpose: "standby", contact_id: null, state: "expired" },
        "closed",
      ],
    ];
  for (const [name, over, want] of cases)
    test(name, () => expect(R.roomMoment(room(over), NOW)).toBe(want));
});

// ---------------------------------------------------------------------------

describe("the room panel's words, as the specs write them", () => {
  test("making", () => {
    expect(say(room({ state: "creating" }))).toBe("Making your Meet room...");
    expect(say(room({ state: "requested", provider: "zoom" }))).toBe(
      "Making your Zoom room...",
    );
  });

  test("ready", () => {
    expect(say(room())).toBe("Room ready.");
  });

  test("link sent: P1's line with the lead's name and the wait, the foundation's otherwise", () => {
    expect(say(sentRoom())).toBe(
      "Link sent on WhatsApp at 14:11. Waiting for Faisal (9:12 left).",
    );
    expect(say(sentRoom({ purpose: "manual" }))).toBe(
      "Link sent on WhatsApp at 14:11.",
    );
    expect(say(sentRoom({ contact_first_name: null }))).toBe(
      "Link sent on WhatsApp at 14:11.",
    );
    expect(say(sentRoom({ link_channels: ["email"] }))).toBe(
      "Link sent on email at 14:11. Waiting for Faisal (9:12 left).",
    );
  });

  test("not confirmed", () => {
    const r = sentRoom({
      link_channels: ["whatsapp_template", "email"],
      link_unconfirmed_at: iso(NOW - 20 * S),
    });
    expect(say(r)).toBe(
      "HighLevel did not confirm the WhatsApp template. The link went by email.",
    );
    expect(say({ ...r, purpose: "manual" })).toBe(
      "Not confirmed on WhatsApp. Sent by email too.",
    );
  });

  test("not sent: the reason, then the link to read out", () => {
    expect(say(room({ refusal: "No message can reach this lead." }))).toBe(
      "Not sent: no message can reach this lead. Read it out: call.maharamedia.com/K7Q2MX",
    );
  });

  test("opened", () => {
    const r = sentRoom({
      first_open_at: iso(NOW - 20 * S),
      open_device: "phone",
    });
    expect(say(r)).toBe("Faisal opened the link at 14:11. Join now.");
    expect(say({ ...r, purpose: "manual" })).toBe(
      "The lead opened the link at 14:11 on a phone.",
    );
    expect(say({ ...r, purpose: "manual", open_device: null })).toBe(
      "The lead opened the link at 14:11.",
    );
  });

  test("waiting room, in each voice", () => {
    const r = sentRoom({ provider: "zoom", lead_waiting_at: iso(NOW) });
    expect(say(r)).toBe("Faisal is in the waiting room. Admit them in Zoom.");
    expect(say({ ...r, purpose: "handover" })).toBe(
      "Faisal is in your waiting room. Admit them in Zoom.",
    );
    expect(say({ ...r, purpose: "manual" })).toBe(
      "The lead is in the waiting room. Admit them in Zoom.",
    );
  });

  test("host in", () => {
    const r = sentRoom({ state: "host_in", host_in_at: iso(NOW - 30 * S) });
    expect(say(r)).toBe("You are in. Waiting for Faisal (9:12 left).");
    expect(say({ ...r, purpose: "manual" })).toBe(
      "You are in. Waiting for the lead (9:12 left).",
    );
    expect(say({ ...r, purpose: "manual", lead_by: null })).toBe(
      "You are in. Waiting for the lead.",
    );
  });

  test("joined, counted or not", () => {
    const r = sentRoom({
      state: "lead_in",
      lead_in_at: iso(NOW - 25 * S),
      count_result: "booked",
    });
    expect(say(r)).toBe(
      "Faisal joined. Booked as a live intro and marked shown.",
    );
    expect(say({ ...r, purpose: "manual" })).toBe(
      "The lead joined at 14:11. Booked and marked shown in HighLevel.",
    );
    expect(say({ ...r, call_kind: "demo" })).toBe(
      "The lead joined at 14:11. Booked and marked shown in HighLevel.",
    );
    expect(say({ ...r, count_result: "not_a_lead" })).toBe(
      "Faisal joined. Not booked: this contact is not a tagged lead.",
    );
    expect(say({ ...r, purpose: "manual", count_result: "not_a_lead" })).toBe(
      "The lead joined at 14:11. Not counted: this contact is not a tagged lead.",
    );
    expect(say({ ...r, purpose: "manual", count_result: "failed" })).toBe(
      "The lead joined at 14:11. Not in HighLevel: book and mark it by hand.",
    );
    // Counting is off: nothing is claimed about HighLevel.
    expect(say({ ...r, purpose: "manual", count_result: null })).toBe(
      "The lead joined at 14:11.",
    );
  });

  test("still on the call at the end time", () => {
    expect(say(room({ state: "lead_in", ends_at: iso(NOW - S) }))).toBe(
      "Still on the call?",
    );
  });

  test("nobody joined: P1 asks for the intro's mark, the foundation says what next", () => {
    const r = room({ state: "expired", result: "no_join" });
    expect(say(r, { canMarkIntro: true })).toBe(
      "Nobody joined in 10 minutes. The room is closed. Mark the intro:",
    );
    expect(say(r)).toBe(
      "The lead did not join in 10 minutes. Room closed. Call again or send a message.",
    );
  });

  test("failed: the provider's reason, or the server's whole sentence as it is", () => {
    const z = room({ provider: "zoom", state: "failed" });
    expect(say({ ...z, error: "the host's Zoom user was not found" })).toBe(
      "Zoom did not make the room: the host's Zoom user was not found. Try Meet, or call again.",
    );
    expect(
      say({
        ...z,
        error: "Your Zoom is in another meeting. End it or use Meet.",
      }),
    ).toBe("Your Zoom is in another meeting. End it or use Meet.");
    expect(
      say({
        ...z,
        error:
          "Your Zoom seat is not active yet. Accept Zoom's email invite. Meet works now.",
      }),
    ).toBe(
      "Your Zoom seat is not active yet. Accept Zoom's email invite. Meet works now.",
    );
    expect(
      say({
        ...room({ state: "failed" }),
        error: "Google did not make the Meet link. Try Zoom.",
      }),
    ).toBe("Google did not make the Meet link. Try Zoom.");
    expect(say({ ...z, purpose: "handover", error: "Zoom answered 429" })).toBe(
      "Zoom did not open your room: Zoom answered 429. Use Meet.",
    );
    expect(say({ ...z, error: null })).toBe(
      "Zoom did not make the room. Try Meet, or call again.",
    );
  });

  test("standby", () => {
    expect(say(room({ purpose: "standby", contact_id: null }))).toBe(
      "Your room is open. Join it so live leads can come straight to you.",
    );
    expect(
      say(room({ purpose: "standby", contact_id: null, state: "host_in" }), {
        until: iso(NOW + 138 * MIN),
      }),
    ).toBe("You are in your room. Ready until 16:30.");
  });

  test("a closed room reads as P1's lead page line", () => {
    const r = room({
      state: "ended",
      result: "joined",
      link_sent_at: iso(NOW - 9 * MIN),
      first_open_at: iso(NOW - 7 * MIN),
      lead_in_at: iso(NOW - 6 * MIN),
      ended_at: iso(NOW),
    });
    expect(say(r)).toBe(
      "Video room on Meet: sent 14:03, opened 14:05, joined 14:06.",
    );
    expect(say(room({ state: "cancelled", ended_at: iso(NOW) }))).toBe(
      "Video room on Meet: closed at 14:12.",
    );
  });

  test("Zoom's quiet hint appears 30 s after the link, never on Meet", () => {
    const z = sentRoom({ provider: "zoom" });
    expect(
      R.roomHint({ ...z, link_sent_at: iso(NOW - 10 * S) }, NOW),
    ).toBeNull();
    expect(R.sentenceText(R.roomHint(z, NOW) ?? [])).toBe(
      "Zoom has not told us yet. Press when it happens.",
    );
    expect(R.roomHint(sentRoom(), NOW)).toBeNull();
    expect(R.roomHint({ ...z, state: "host_in" }, NOW)).toBeNull();
    // Zoom reported the waiting room: its events are arriving.
    expect(R.roomHint({ ...z, lead_waiting_at: iso(NOW) }, NOW)).toBeNull();
  });

  test("tones: joined is won, nobody joined is owed, failed is the error colour", () => {
    expect(R.roomTone("joined")).toBe("good");
    expect(R.roomTone("expired")).toBe("owed");
    expect(R.roomTone("not_confirmed")).toBe("owed");
    expect(R.roomTone("failed")).toBe("bad");
    expect(R.roomTone("sent")).toBe("now");
    expect(R.roomTone("closed")).toBe("quiet");
  });
});

// ---------------------------------------------------------------------------

describe("countdowns", () => {
  test("an open room counts to the first of its deadlines", () => {
    expect(R.roomLeft(sentRoom(), NOW)).toBe(552_000);
    expect(R.roomLeft(sentRoom({ host_by: iso(NOW + 60 * S) }), NOW)).toBe(
      60_000,
    );
    expect(R.roomLeft(room(), NOW)).toBe(14 * MIN);
  });

  test("a room with the host in counts the lead's wait only", () => {
    expect(R.roomLeft(sentRoom({ state: "host_in" }), NOW)).toBe(552_000);
    expect(
      R.roomLeft(
        room({ purpose: "standby", contact_id: null, state: "host_in" }),
        NOW,
      ),
    ).toBeNull();
  });

  test("no countdown while making, with the lead in, or after the end; never negative", () => {
    expect(R.roomLeft(room({ state: "creating" }), NOW)).toBeNull();
    expect(R.roomLeft(room({ state: "lead_in" }), NOW)).toBeNull();
    expect(R.roomLeft(room({ state: "expired" }), NOW)).toBeNull();
    expect(R.roomLeft(sentRoom({ lead_by: iso(NOW - 5 * S) }), NOW)).toBe(0);
  });

  test("an offer's bar drains from full to empty over two minutes", () => {
    const o = F.offerFixture(NOW, { offer_until: iso(NOW + 120 * S) });
    expect(R.offerFraction(o, NOW)).toBe(1);
    expect(R.offerFraction(o, NOW + 60 * S)).toBe(0.5);
    expect(R.offerFraction(o, NOW + 200 * S)).toBe(0);
    // A clock behind the server's never draws more than a full bar.
    expect(R.offerFraction(o, NOW - 30 * S)).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe("the room line's steps", () => {
  const steps = (r: RoomView) =>
    R.roomSteps(r).map(
      s => `${s.key}:${s.done ? "done" : s.current ? "now" : "-"}`,
    );

  test("the labels, in order", () => {
    expect(R.roomSteps(room()).map(s => s.label)).toEqual([
      "Link sent",
      "Opened",
      "You're in",
      "Lead in",
    ]);
  });

  test("making waits on the link", () => {
    expect(steps(room({ state: "creating" }))).toEqual([
      "sent:now",
      "opened:-",
      "in:-",
      "lead:-",
    ]);
  });

  test("sent waits on the lead opening it", () => {
    expect(steps(sentRoom())).toEqual([
      "sent:done",
      "opened:now",
      "in:-",
      "lead:-",
    ]);
  });

  test("opened with the host out waits on the host", () => {
    expect(steps(sentRoom({ first_open_at: iso(NOW) }))).toEqual([
      "sent:done",
      "opened:done",
      "in:now",
      "lead:-",
    ]);
  });

  test("a read-out link is noted and the line moves on to the open", () => {
    const s = R.roomSteps(room({ refusal: "No message can reach this lead." }));
    expect(s[0]).toMatchObject({
      done: false,
      current: false,
      note: "read out",
    });
    expect(s[1].current).toBe(true);
  });

  test("a host who left before the lead came is out again", () => {
    expect(
      steps(
        sentRoom({
          state: "open",
          first_open_at: iso(NOW - 2 * MIN),
          host_in_at: iso(NOW - MIN),
        }),
      )[2],
    ).toBe("in:now");
  });

  test("lead in: every step done, even an open the short link never saw", () => {
    expect(
      steps(
        sentRoom({
          state: "lead_in",
          host_in_at: iso(NOW),
          lead_in_at: iso(NOW),
        }),
      ),
    ).toEqual(["sent:done", "opened:done", "in:done", "lead:done"]);
  });

  test("a final room has no current step", () => {
    const s = R.roomSteps(
      sentRoom({ state: "expired", host_in_at: iso(NOW - MIN) }),
    );
    expect(s.some(x => x.current)).toBe(false);
    expect(s.map(x => x.done)).toEqual([true, false, true, false]);
  });
});

// ---------------------------------------------------------------------------

describe("the one right button", () => {
  const acts = (
    r: RoomView,
    extra: { now?: number; canMarkIntro?: boolean } = {},
  ) => {
    const a = R.roomActions(r, {
      now: extra.now ?? NOW,
      canMarkIntro: extra.canMarkIntro,
    });
    return {
      primary: a.primary?.label ?? null,
      quiet: a.quiet.map(q => q.label),
    };
  };

  test("making: nothing to press but End room", () => {
    expect(acts(room({ state: "creating" }))).toEqual({
      primary: null,
      quiet: ["End room"],
    });
  });

  test("open on Meet: get in the room", () => {
    expect(acts(sentRoom())).toEqual({
      primary: "Open my room",
      quiet: [
        "I'm in the room",
        "Copy link",
        "Also send by email",
        "We are on the phone",
        "I can't let them in",
        "End room",
      ],
    });
  });

  test("The lead is in waits for the host: only someone in the room can admit", () => {
    expect(acts(sentRoom({ first_open_at: iso(NOW) })).quiet).not.toContain(
      "The lead is in",
    );
    expect(
      acts(sentRoom({ provider: "zoom", lead_waiting_at: iso(NOW) })).quiet,
    ).not.toContain("The lead is in");
  });

  test("Zoom: the rep's own buttons wait 30 s for Zoom's events", () => {
    const fresh = sentRoom({
      provider: "zoom",
      link_sent_at: iso(NOW - 10 * S),
      first_open_at: iso(NOW),
    });
    expect(acts(fresh).quiet).not.toContain("I'm in");
    const quiet = acts({ ...fresh, link_sent_at: iso(NOW - 31 * S) }).quiet;
    expect(quiet).toContain("I'm in");
  });

  test("host in: The lead is in", () => {
    const a = acts(sentRoom({ state: "host_in" }));
    expect(a.primary).toBe("The lead is in");
    expect(a.quiet[0]).toBe("Open my room");
  });

  test("lead in: That was not the lead while a press still lands inside 300 s, then only Finished", () => {
    // The last press: 300 s, less the 5 s Undo, less 15 s for the trip.
    const r = sentRoom({ state: "lead_in", lead_in_at: iso(NOW - 280 * S) });
    expect(acts(r)).toEqual({
      primary: null,
      quiet: ["That was not the lead", "Finished"],
    });
    expect(acts({ ...r, lead_in_at: iso(NOW - 281 * S) })).toEqual({
      primary: null,
      quiet: ["Finished"],
    });
  });

  test("still on the call: Finished, or Still on it", () => {
    const r = room({
      state: "lead_in",
      ends_at: iso(NOW - S),
      lead_in_at: iso(NOW - 40 * MIN),
    });
    expect(acts(r)).toEqual({
      primary: "Finished",
      quiet: ["Still on it"],
    });
    // Answered "Still on it": the question goes and Finished is quiet again.
    const a = R.roomActions(r, { now: NOW, stillOn: true });
    expect(a.primary).toBeNull();
    expect(a.quiet.map(q => q.label)).toEqual(["Finished"]);
    expect(
      R.sentenceText(R.roomSentence(r, { now: NOW, stillOn: true })),
    ).not.toBe("Still on the call?");
  });

  test("failed: try the other provider", () => {
    expect(acts(room({ state: "failed" })).primary).toBe("Try Zoom");
    expect(acts(room({ state: "failed", provider: "zoom" })).primary).toBe(
      "Try Meet",
    );
    expect(
      acts(room({ state: "failed", purpose: "booked" })).primary,
    ).toBeNull();
    expect(
      acts(room({ state: "failed", purpose: "standby", contact_id: null }))
        .primary,
    ).toBeNull();
  });

  test("expired: the intro's mark when the page can make it, else nothing", () => {
    const r = room({ state: "expired" });
    expect(acts(r, { canMarkIntro: true }).quiet).toEqual([
      "No-show",
      "We spoke on the phone",
    ]);
    expect(acts(r)).toEqual({ primary: null, quiet: [] });
  });

  test("a closed room has no buttons", () => {
    expect(acts(room({ state: "ended" }))).toEqual({
      primary: null,
      quiet: [],
    });
  });

  test("email is offered until the link went by email", () => {
    expect(
      acts(sentRoom({ link_channels: ["whatsapp_text", "email"] })).quiet,
    ).not.toContain("Also send by email");
  });

  test("a closer's handover has no 'We are on the phone'", () => {
    expect(acts(sentRoom({ purpose: "handover" })).quiet).not.toContain(
      "We are on the phone",
    );
  });

  test("a booked call's room is HighLevel's meeting: no End room, no email", () => {
    const q = acts(sentRoom({ purpose: "booked" })).quiet;
    expect(q).not.toContain("End room");
    expect(q).not.toContain("Also send by email");
  });

  test("no Copy link before the room has a link", () => {
    expect(acts(room({ short_url: null, join_url: null })).quiet).not.toContain(
      "Copy link",
    );
  });

  test("the presses behind an Undo", () => {
    expect(R.needsUndo("lead_in")).toBe(true);
    expect(R.needsUndo("not_lead")).toBe(true);
    expect(R.needsUndo("noshow")).toBe(true);
    expect(R.needsUndo("showed")).toBe(true);
    // Ending a call in progress and moving the lead to Zoom wait too.
    expect(R.needsUndo("finished")).toBe(true);
    expect(R.needsUndo("admit_blocked")).toBe(true);
    expect(R.needsUndo("open")).toBe(false);
    expect(R.needsUndo("end")).toBe(false);
    expect(R.needsUndo("still_on")).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe("the availability strip", () => {
  const standby = (over: Partial<RoomView> = {}) => F.standbyFixture(NOW, over);
  const until = iso(NOW + 138 * MIN); // 16:30

  test("Away", () => {
    const l = strip();
    expect(text(l)).toBe("Away");
    expect(l.primary?.label).toBe("I'm available");
    expect(l.urgent).toBe(false);
  });

  test("Available, with the room to join", () => {
    const l = strip({
      me: me({ state: "available", until }),
      rooms: [standby()],
    });
    expect(text(l)).toBe(
      "Available until 16:30. Join your room to get leads first.",
    );
    expect(l.primary).toEqual({ key: "join", label: "Join my room" });
  });

  test("Available while the room is still being made: Join waits", () => {
    const l = strip({
      me: me({ state: "available", until }),
      rooms: [standby({ state: "creating" })],
    });
    expect(l.primary).toEqual({
      key: "join",
      label: "Join my room",
      disabled: true,
    });
  });

  test("Available with the worker down and no room: the health line, not a promise", () => {
    const l = strip({
      me: me({ state: "available", until }),
      rooms: [standby({ state: "requested" })],
      health: down,
    });
    expect(l.moment).toBe("down");
    expect(text(l)).toBe(
      "Rooms are down. The room worker last ran at 13:52. Call the lead on the phone, or send your own Zoom or Meet link.",
    );
  });

  test("Ready", () => {
    const l = strip({
      me: me({ state: "ready", until }),
      rooms: [standby({ state: "host_in", host_in_at: iso(NOW - MIN) })],
    });
    expect(text(l)).toBe(
      "In your room until 16:30. The next live lead comes to you.",
    );
    expect(l.primary).toBeNull();
    expect(l.quiet.map(a => a.label)).toEqual(["Go away"]);
  });

  test("an offer, with its countdown", () => {
    const l = strip({
      me: me({ state: "ready", until }),
      offers: [F.offerFixture(NOW, { note: "Wants a demo today" })],
    });
    expect(l.moment).toBe("offer");
    expect(l.urgent).toBe(true);
    expect(text(l)).toBe(
      "Live lead: demo, Saudi Arabia, on the line with the setter. Note: Wants a demo today. 1:47 left.",
    );
    expect(l.primary?.label).toBe("Take it");
    expect(l.quiet.map(a => a.label)).toEqual(["Not now"]);
  });

  test("an offer without a country, a reason or a note leaves them out", () => {
    const l = strip({
      offers: [
        F.offerFixture(NOW, { country: null, reason: "manual", note: "  " }),
      ],
    });
    expect(text(l)).toBe("Live lead: demo. 1:47 left.");
    const q = strip({
      offers: [
        F.offerFixture(NOW, { reason: "replied", note: "Is today ok?" }),
      ],
    });
    expect(text(q)).toBe(
      "Live lead: demo, Saudi Arabia, just replied on WhatsApp. Note: Is today ok? 1:47 left.",
    );
  });

  test("the offer ending first shows first; a declined one is hidden", () => {
    const a = F.offerFixture(NOW, { id: "a", offer_until: iso(NOW + 90 * S) });
    const b = F.offerFixture(NOW, { id: "b", offer_until: iso(NOW + 30 * S) });
    expect(strip({ offers: [a, b] }).offer?.id).toBe("b");
    expect(strip({ offers: [a, b], hidden: ["b"] }).offer?.id).toBe("a");
    expect(strip({ offers: [a, b], hidden: ["a", "b"] }).moment).toBe("away");
  });

  test("taken, lost and closed", () => {
    expect(text(strip({ flash: { kind: "taken", at: NOW } }))).toBe(
      "Taken. Sending the link...",
    );
    expect(
      text(strip({ flash: { kind: "lost", at: NOW, by: "Omar", text: null } })),
    ).toBe("Omar took this one.");
    expect(
      text(
        strip({
          flash: {
            kind: "lost",
            at: NOW,
            by: null,
            text: "Someone else took this lead.",
          },
        }),
      ),
    ).toBe("Someone else took this lead.");
    expect(text(strip({ flash: { kind: "closed", at: NOW - 5 * MIN } }))).toBe(
      "This offer closed at 14:07. Nothing to do.",
    );
  });

  test("missed: said while Away, with the way back", () => {
    const flash = {
      kind: "missed" as const,
      at: NOW,
      missedAt: iso(NOW - 8 * MIN),
    };
    const l = strip({ flash });
    expect(text(l)).toBe("You missed a live lead at 14:04 and are now Away.");
    expect(l.primary?.label).toBe("I'm available");
    expect(strip({ flash, me: me({ state: "available" }) }).moment).toBe(
      "available",
    );
  });

  test("refresh: Zoom's 40-minute rule, five minutes ahead of the swap", () => {
    const at = (mins: number) =>
      strip({
        me: me({ state: "ready", until }),
        rooms: [
          standby({ state: "host_in", host_in_at: iso(NOW - mins * MIN) }),
        ],
      });
    expect(at(29).moment).toBe("ready");
    const l = at(30);
    expect(text(l)).toBe(
      "Zoom closes a room 40 minutes after only one person is left. Stay available?",
    );
    expect(l.primary?.label).toBe("Keep me available");
    expect(l.quiet.map(a => a.label)).toEqual(["Stop"]);
    // Kept: not asked again for this room.
    expect(
      strip({
        me: me({ state: "ready", until }),
        rooms: [standby({ state: "host_in", host_in_at: iso(NOW - 31 * MIN) })],
        kept: ["room-standby"],
      }).moment,
    ).toBe("ready");
  });

  test("booked call", () => {
    const l = strip({
      me: me({ reason: "booked_call", booked_at: iso(NOW + 168 * MIN) }),
    });
    expect(text(l)).toBe(
      "Your booked demo starts at 17:00, so your room is closed. Press I'm available after it.",
    );
  });

  test("on a call", () => {
    expect(text(strip({ me: me({ state: "on_call" }) }))).toBe("On a call.");
  });

  test("an error after a press says what to do, under the offer while one is open", () => {
    const flash = { kind: "error" as const, at: NOW, text: "Sign in again." };
    const withOffer = strip({ flash, offers: [F.offerFixture(NOW)] });
    expect(withOffer.moment).toBe("offer");
    expect(withOffer.primary?.key).toBe("take");
    expect(withOffer.note).toBe("Sign in again.");
    const alone = strip({ flash });
    expect(alone.moment).toBe("error");
    expect(text(alone)).toBe("Sign in again.");
    expect(alone.note).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("offers that leave the strip", () => {
  const o = F.offerFixture(NOW, { offer_until: iso(NOW - 2 * S) });

  test("gone while this seat went Away: missed, at the offer's end", () => {
    expect(R.offerGone([o], [], me(), new Set(), NOW)).toEqual({
      kind: "missed",
      at: NOW,
      missedAt: o.offer_until,
    });
  });

  test("gone early while still available: closed, nothing to do", () => {
    const early = F.offerFixture(NOW);
    expect(
      R.offerGone([early], [], me({ state: "ready" }), new Set(), NOW),
    ).toEqual({ kind: "closed", at: NOW });
  });

  test("gone after this seat answered it, or still there: no news", () => {
    expect(R.offerGone([o], [], me(), new Set([o.id]), NOW)).toBeNull();
    expect(R.offerGone([o], [o], me(), new Set(), NOW)).toBeNull();
    expect(R.offerGone([], [o], me(), new Set(), NOW)).toBeNull();
  });

  test("flashes run their course", () => {
    const live = F.liveFixture("ready", NOW).live;
    expect(
      R.activeFlash(
        { kind: "lost", at: NOW, by: null, text: null },
        live,
        NOW + 7 * S,
      ),
    ).not.toBeNull();
    expect(
      R.activeFlash(
        { kind: "lost", at: NOW, by: null, text: null },
        live,
        NOW + 9 * S,
      ),
    ).toBeNull();
    // Taken gives way to the room it made.
    const withRoom = F.liveFixture("ready", NOW, "sent").live;
    expect(R.activeFlash({ kind: "taken", at: NOW }, live, NOW)).not.toBeNull();
    expect(R.activeFlash({ kind: "taken", at: NOW }, withRoom, NOW)).toBeNull();
    // Missed lasts while the seat stays Away.
    const missed = { kind: "missed" as const, at: NOW, missedAt: iso(NOW) };
    expect(
      R.activeFlash(missed, F.liveFixture("away", NOW).live, NOW + 10 * MIN),
    ).toEqual(missed);
    expect(R.activeFlash(missed, live, NOW)).toBeNull();
    expect(R.activeFlash(null, live, NOW)).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("the banner", () => {
  const offerLine = strip({ offers: [F.offerFixture(NOW)] });
  const awayLine = strip();
  const r = sentRoom();

  test("one thing, in order: offer, my room, handover, reply, then the strip", () => {
    expect(
      R.bannerSlot({ strip: offerLine, room: r, handover: true, reply: true }),
    ).toBe("offer");
    expect(
      R.bannerSlot({ strip: awayLine, room: r, handover: true, reply: true }),
    ).toBe("room");
    expect(
      R.bannerSlot({
        strip: awayLine,
        room: null,
        handover: true,
        reply: true,
      }),
    ).toBe("handover");
    expect(
      R.bannerSlot({
        strip: awayLine,
        room: null,
        handover: false,
        reply: true,
      }),
    ).toBe("reply");
    expect(
      R.bannerSlot({
        strip: awayLine,
        room: null,
        handover: false,
        reply: false,
      }),
    ).toBe("presence");
    expect(
      R.bannerSlot({ strip: null, room: null, handover: false, reply: false }),
    ).toBeNull();
  });

  test("the room line in the banner", () => {
    const b = (x: RoomView) => R.sentenceText(R.bannerRoomSentence(x, NOW));
    expect(b(r)).toBe("Video room: Faisal, 9:12 left.");
    expect(b({ ...r, contact_first_name: null })).toBe(
      "Video room: K7Q2MX, 9:12 left.",
    );
    expect(b({ ...r, first_open_at: iso(NOW) })).toBe(
      "Faisal opened the link.",
    );
    expect(b({ ...r, state: "lead_in", lead_in_at: iso(NOW) })).toBe(
      "Faisal joined.",
    );
    expect(b({ ...r, provider: "zoom", lead_waiting_at: iso(NOW) })).toBe(
      "Faisal is in the waiting room. Admit them in Zoom.",
    );
    expect(b(room({ state: "creating" }))).toBe("Making your Meet room...");
    expect(b(room({ refusal: "No message can reach this lead." }))).toBe(
      "Not sent: no message can reach this lead. Read it out: call.maharamedia.com/K7Q2MX",
    );
  });

  test("its button: get in while the room waits for the host, then go to the lead", () => {
    expect(R.bannerRoomAction(r)).toEqual({
      key: "open_room",
      label: "Open my room",
    });
    expect(R.bannerRoomAction({ ...r, state: "host_in" })).toEqual({
      key: "open_lead",
      label: "Open",
    });
  });

  test("which room it shows: the one that needs the rep most, never a standby or final one", () => {
    const a = sentRoom({ id: "a", created_at: iso(NOW - MIN) });
    const b = sentRoom({
      id: "b",
      provider: "zoom",
      lead_waiting_at: iso(NOW),
      created_at: iso(NOW - 5 * MIN),
    });
    const c = sentRoom({ id: "c", created_at: iso(NOW) });
    expect(R.myRoom([a, b, c], NOW)?.id).toBe("b");
    expect(R.myRoom([a, c], NOW)?.id).toBe("c");
    expect(R.myRoom([F.standbyFixture(NOW)], NOW)).toBeNull();
    expect(R.myRoom([sentRoom({ state: "expired" })], NOW)).toBeNull();
  });

  test("the reply alert", () => {
    const a = F.replyFixture(NOW);
    expect(R.sentenceText(R.replySentence(a, NOW))).toBe(
      "Mona wrote 3 minutes ago. Answer now.",
    );
    expect(
      R.sentenceText(R.replySentence({ ...a, at: iso(NOW - 70 * S) }, NOW)),
    ).toBe("Mona wrote 1 minute ago. Answer now.");
    expect(
      R.sentenceText(R.replySentence({ ...a, at: iso(NOW), name: null }, NOW)),
    ).toBe("A lead wrote just now. Answer now.");
  });
});

// ---------------------------------------------------------------------------

describe("the health line", () => {
  test("the server's sentence, with its tone", () => {
    expect(R.healthSentence(working)).toBe(working.line);
    expect(R.healthTone(working)).toBe("good");
    expect(R.healthTone(down)).toBe("bad");
    expect(
      R.healthTone({
        ...working,
        line: "Zoom and the cockpit disagree on 1 room today. Open its timeline.",
      }),
    ).toBe("owed");
  });

  test("the foundation's wording when the server sends none", () => {
    expect(R.healthSentence({ ...working, line: "" })).toBe(
      "Rooms: working. Last run 14:11:58. 6 rooms today, 0 failed.",
    );
    expect(R.healthSentence({ ...down, line: "" })).toBe(
      "Rooms are down. The room worker last ran at 13:52. Call the lead on the phone, or send your own Zoom or Meet link.",
    );
    expect(R.healthSentence({ ...down, line: "", last_run_at: null })).toBe(
      "Rooms are down. The room worker has not run yet. Call the lead on the phone, or send your own Zoom or Meet link.",
    );
  });
});

// ---------------------------------------------------------------------------

describe("a press's answer is not undone by a late poll", () => {
  test("the higher version wins", () => {
    const a = sentRoom({ version: 5, state: "host_in" });
    const b = sentRoom({ version: 4 });
    expect(R.newer(a, b)).toBe(a);
    expect(R.newer(b, a)).toBe(a);
    expect(R.newer(null, b)).toBe(b);
    // A different room is never kept over the one asked for.
    expect(R.newer({ ...a, id: "other" }, b)).toBe(b);
  });

  test("room feed: events and health come from the read, the room from the newer copy", () => {
    const pressed = {
      room: sentRoom({ version: 6, state: "host_in" }),
      events: [],
      health: null,
    };
    const late = {
      room: sentRoom({ version: 5 }),
      events: [{ at: iso(NOW), kind: "x", source: "y", text: "z" }],
      health: working,
    };
    const merged = R.mergeRoomFeed(pressed, late);
    expect(merged.room.version).toBe(6);
    expect(merged.events).toHaveLength(1);
    expect(merged.health).toBe(working);
    const fresh = { ...late, room: sentRoom({ version: 7 }) };
    expect(R.mergeRoomFeed(pressed, fresh)).toBe(fresh);
  });

  test("live status: rooms merge by version; a room the server dropped is dropped", () => {
    const prev = F.liveFixture("ready", NOW, "host_in").live;
    const ownPrev = prev.rooms[0];
    const next: LiveStatus = {
      ...prev,
      rooms: [{ ...ownPrev, version: ownPrev.version - 1, state: "open" }],
    };
    const merged = R.mergeLive(prev, next);
    expect(merged.rooms).toHaveLength(1);
    expect(merged.rooms[0].state).toBe("host_in");
    expect(R.mergeLive(null, next)).toBe(next);
  });

  test("withRoom puts a press's room in, and takes a final one out", () => {
    const live = F.liveFixture("away", NOW).live;
    const r1 = sentRoom();
    const added = R.withRoom(live, r1);
    expect(added.rooms.map(x => x.id)).toEqual([r1.id]);
    const ended = R.withRoom(added, {
      ...r1,
      version: r1.version + 1,
      state: "ended",
    });
    expect(ended.rooms).toHaveLength(0);
    // An older copy does not replace a newer one.
    const older = R.withRoom(added, {
      ...r1,
      version: r1.version - 1,
      state: "creating",
    });
    expect(older.rooms[0].state).toBe("open");
  });
});

// ---------------------------------------------------------------------------

describe("polling waits", () => {
  const timeout = new ApiError("timeout", "timeout");
  const refused = new ApiError("Live calls are switched off.", "refused", 403);

  test("backoff doubles from the base to at most 30 s", () => {
    expect(R.backoff(4000, 0)).toBe(4000);
    expect(R.backoff(4000, 1)).toBe(8000);
    expect(R.backoff(4000, 2)).toBe(16000);
    expect(R.backoff(4000, 5)).toBe(30000);
    expect(R.backoff(30000, 3)).toBe(30000);
    expect(R.backoff(60000, 1)).toBe(60000);
  });

  test("the strip: 4 s, 30 s when Away and quiet, a minute when refused, stop when signed out", () => {
    const away = F.liveFixture("away", NOW).live;
    expect(R.liveDelay(away, 0, null)).toBe(30_000);
    expect(R.liveDelay(F.liveFixture("ready", NOW).live, 0, null)).toBe(4000);
    // An Away setter with a room of their own reads every 4 s.
    expect(R.liveDelay(F.liveFixture("away", NOW, "sent").live, 0, null)).toBe(
      4000,
    );
    expect(R.liveDelay(null, 0, null)).toBe(4000);
    expect(R.liveDelay(away, 1, timeout)).toBe(30_000);
    expect(R.liveDelay(null, 2, timeout)).toBe(16_000);
    expect(R.liveDelay(away, 1, refused)).toBe(60_000);
    expect(R.liveDelay(away, 1, new ApiError("Sign in again.", "signin"))).toBe(
      0,
    );
  });

  test("a room: 2 s while it is made, 4 s after, stop when final, gone or not this rep's", () => {
    const feed = (r: RoomView) => ({ room: r, events: [], health: null });
    expect(R.roomDelay(feed(room({ state: "creating" })), 0, null)).toBe(2000);
    expect(R.roomDelay(feed(sentRoom()), 0, null)).toBe(4000);
    expect(R.roomDelay(feed(room({ state: "ended" })), 0, null)).toBe(0);
    expect(R.roomDelay(null, 0, null)).toBe(2000);
    expect(R.roomDelay(feed(sentRoom()), 2, timeout)).toBe(16000);
    expect(
      R.roomDelay(
        feed(sentRoom()),
        1,
        new ApiError("No such room.", "refused", 404),
      ),
    ).toBe(0);
    expect(
      R.roomDelay(
        feed(sentRoom()),
        1,
        new ApiError("This room belongs to Sara.", "refused", 403),
      ),
    ).toBe(0);
    // A failed read keeps trying even when the last good copy was final.
    expect(R.roomDelay(feed(room({ state: "ended" })), 1, timeout)).toBe(8000);
  });
});

// ---------------------------------------------------------------------------

describe("request ids: a retry is the same request", () => {
  const ids: string[] = [];
  const sendOk = async (id: string) => {
    ids.push(id);
    return id;
  };
  beforeEach(() => {
    ids.length = 0;
  });

  test("two presses while the first is on its way send once", async () => {
    let release: (v: string) => void = () => undefined;
    const slow = (id: string) => {
      ids.push(id);
      return new Promise<string>(res => {
        release = res;
      });
    };
    const a = R.once("k", slow, NOW);
    const b = R.once("k", slow, NOW);
    await Promise.resolve();
    await Promise.resolve();
    release("done");
    expect(await a).toBe("done");
    expect(await b).toBe("done");
    expect(ids).toHaveLength(1);
  });

  test("fifty presses at once send once", async () => {
    let n = 0;
    const all = await Promise.all(
      Array.from({ length: 50 }, () =>
        R.once(
          "fifty",
          async id => {
            n += 1;
            return id;
          },
          NOW,
        ),
      ),
    );
    expect(n).toBe(1);
    expect(new Set(all).size).toBe(1);
  });

  test("after an answer that may have landed, the retry carries the same id", async () => {
    const fail =
      (kind: "timeout" | "network" | "cut" | "server") =>
      async (id: string) => {
        ids.push(id);
        throw new ApiError("maybe", kind, kind === "server" ? 502 : null);
      };
    for (const kind of ["timeout", "network", "cut", "server"] as const) {
      ids.length = 0;
      R.forgetRequests();
      await expect(R.once(kind, fail(kind), NOW)).rejects.toThrow("maybe");
      await R.once(kind, sendOk, NOW + 5 * S);
      expect(ids[0]).toBe(ids[1]);
    }
  });

  test("a clear no starts a fresh id", async () => {
    await expect(
      R.once(
        "no",
        async id => {
          ids.push(id);
          throw new ApiError(
            "This lead already has a room open. Open it.",
            "refused",
            409,
          );
        },
        NOW,
      ),
    ).rejects.toThrow("already has a room");
    await R.once("no", sendOk, NOW);
    expect(ids[0]).not.toBe(ids[1]);
  });

  test("a clear yes starts a fresh id for the next room", async () => {
    await R.once("yes", sendOk, NOW);
    await R.once("yes", sendOk, NOW);
    expect(ids[0]).not.toBe(ids[1]);
  });

  test("a retry more than two minutes later is a new request", async () => {
    await expect(
      R.once(
        "late",
        async id => {
          ids.push(id);
          throw new ApiError("timeout", "timeout");
        },
        NOW,
      ),
    ).rejects.toThrow();
    expect(R.heldRequestId("late")).toBe(ids[0]);
    await R.once("late", sendOk, NOW + R.RETRY_WINDOW_MS + 1);
    expect(ids[1]).not.toBe(ids[0]);
  });

  test("a send that throws at once does not leave the key stuck", async () => {
    await expect(
      R.once(
        "sync",
        () => {
          throw new ApiError("Sign in again.", "signin");
        },
        NOW,
      ),
    ).rejects.toThrow("Sign in again.");
    expect(await R.once("sync", async () => "ok", NOW)).toBe("ok");
  });
});

// ---------------------------------------------------------------------------

describe("the calls sales-api gets", () => {
  test("room.create carries a request id, and a retry after a timeout carries the same one", async () => {
    let first = true;
    answer = async c => {
      if (c.action === "room.create" && first) {
        first = false;
        throw new ApiError(
          "The cockpit did not answer within 45 seconds.",
          "timeout",
        );
      }
      return { ok: true, room: sentRoom() };
    };
    const input = {
      contact_id: "lead-1",
      provider: "meet" as const,
      call_kind: "intro" as const,
      purpose: "fallback" as const,
      trigger: "no_answer",
    };
    await expect(R.roomsApi.create(input)).rejects.toThrow("did not answer");
    const out = await R.roomsApi.create(input);
    expect(out.room.code).toBe("K7Q2MX");
    expect(calls).toHaveLength(2);
    expect(calls[0].body).toMatchObject({ ...input });
    expect(typeof calls[0].body.request_id).toBe("string");
    expect(calls[1].body.request_id).toBe(calls[0].body.request_id);
    // The next room is a new request.
    await R.roomsApi.create(input);
    expect(calls[2].body.request_id).not.toBe(calls[0].body.request_id);
  });

  test("Meet and Zoom for the same lead are different requests", async () => {
    answer = async () => {
      throw new ApiError("timeout", "timeout");
    };
    const base = {
      contact_id: "lead-1",
      call_kind: "intro" as const,
      purpose: "fallback" as const,
    };
    await expect(
      R.roomsApi.create({ ...base, provider: "meet" }),
    ).rejects.toThrow();
    await expect(
      R.roomsApi.create({ ...base, provider: "zoom" }),
    ).rejects.toThrow();
    expect(calls[0].body.request_id).not.toBe(calls[1].body.request_id);
  });

  test("marks and ends carry the version they saw", async () => {
    answer = async () => ({ ok: true, room: sentRoom({ version: 8 }) });
    const r = sentRoom({ version: 7 });
    await R.roomsApi.mark(r, "lead_in");
    await R.roomsApi.end(r, "end");
    await R.roomsApi.end(r, "finished", true);
    expect(calls.map(c => c.action)).toEqual([
      "room.mark",
      "room.end",
      "room.end",
    ]);
    expect(calls[0].body).toEqual({
      room_id: r.id,
      version: 7,
      what: "lead_in",
    });
    expect(calls[1].body).toEqual({ room_id: r.id, version: 7, reason: "end" });
    expect(calls[2].body).toEqual({
      room_id: r.id,
      version: 7,
      reason: "finished",
      confirm: true,
    });
  });

  test("email, status, open, availability, take and decline", async () => {
    answer = async c =>
      c.action === "room.open"
        ? { ok: true, start_url: "https://example.com/s" }
        : c.action === "live.availability"
          ? { ok: true, me: me({ state: "available" }) }
          : c.action === "live.status"
            ? { ok: true, ...F.liveFixture("away", NOW).live }
            : c.action === "room.status"
              ? { ok: true, room: sentRoom({ id: "room-1" }) }
              : { ok: true, room: sentRoom() };
    await R.roomsApi.sendEmail("room-1");
    await R.roomsApi.status("room-1");
    await R.roomsApi.open("room-1");
    await R.roomsApi.availability("available");
    await R.roomsApi.liveStatus();
    await R.roomsApi.take({ id: "live-1", version: 2 });
    await R.roomsApi.decline({ id: "live-1", version: 2 });
    await R.roomsApi.wrap("appt-1");
    expect(calls.map(c => c.action)).toEqual([
      "room.send",
      "room.status",
      "room.open",
      "live.availability",
      "live.status",
      "live.take",
      "live.decline",
      "room.wrap",
    ]);
    expect(calls[0].body).toMatchObject({
      room_id: "room-1",
      channel: "email",
    });
    expect(typeof calls[0].body.request_id).toBe("string");
    expect(calls[3].body).toEqual({ state: "available" });
    // The claim carries no version: a stale one would refuse a live offer.
    expect(Object.keys(calls[5].body).sort()).toEqual([
      "live_id",
      "request_id",
    ]);
    expect(calls[5].body.live_id).toBe("live-1");
    expect(typeof calls[5].body.request_id).toBe("string");
    // Not now is retried as the same request too.
    expect(Object.keys(calls[6].body).sort()).toEqual([
      "live_id",
      "request_id",
    ]);
    expect(calls[7].body).toMatchObject({ appointment_id: "appt-1" });
  });

  test("a new room, a wrapped call or a taken lead tells the strip to read now", async () => {
    const seen: string[] = [];
    const g = globalThis as { window?: unknown };
    const had = g.window;
    g.window = { dispatchEvent: (e: Event) => seen.push(e.type) };
    try {
      answer = async () => ({ ok: true, room: sentRoom() });
      await R.roomsApi.create({
        contact_id: "lead-1",
        provider: "meet",
        call_kind: "intro",
        purpose: "fallback",
      });
      await R.roomsApi.wrap("appt-2");
      await R.roomsApi.take({ id: "live-3", version: 1 });
      expect(seen).toEqual([
        "mahara:rooms-changed",
        "mahara:rooms-changed",
        "mahara:rooms-changed",
      ]);
      // A refused create says nothing to the strip.
      seen.length = 0;
      answer = async () => {
        throw new ApiError(
          "This lead already has a room open. Open it.",
          "refused",
          409,
        );
      };
      await expect(
        R.roomsApi.create({
          contact_id: "lead-2",
          provider: "meet",
          call_kind: "intro",
          purpose: "fallback",
        }),
      ).rejects.toThrow("already has a room");
      expect(seen).toEqual([]);
    } finally {
      g.window = had;
    }
  });

  test("two Take presses on one offer send one claim", async () => {
    let release: () => void = () => undefined;
    answer = () =>
      new Promise(res => {
        release = () => res({ ok: true });
      });
    const a = R.roomsApi.take({ id: "live-9", version: 1 });
    const b = R.roomsApi.take({ id: "live-9", version: 1 });
    await Promise.resolve();
    await Promise.resolve();
    release();
    await Promise.all([a, b]);
    expect(calls.filter(c => c.action === "live.take")).toHaveLength(1);
  });

  test("the server's refusals are recognised by their sentences", () => {
    expect(
      R.isStale(new ApiError("This changed a moment ago.", "refused", 409)),
    ).toBe(true);
    expect(
      R.needsEndConfirm(
        new ApiError(
          "The lead is still in this room. End it anyway?",
          "refused",
          409,
        ),
      ),
    ).toBe(true);
    expect(R.isStale(new Error("This changed a moment ago."))).toBe(false);
    expect(R.errorText(new Error(""))).toBe("That did not work. Try again.");
    expect(R.errorText(new ApiError("Sign in again.", "signin"))).toBe(
      "Sign in again.",
    );
  });
});

// ---------------------------------------------------------------------------

describe("the fixtures cover every state in the copy tables", () => {
  const roomWant: Record<string, ReturnType<typeof R.roomMoment>> = {
    making: "making",
    ready: "ready",
    sent: "sent",
    not_sent: "not_sent",
    not_sent_zoom: "not_sent",
    not_confirmed: "not_confirmed",
    opened: "opened",
    waiting: "waiting_room",
    host_in: "host_in",
    joined: "joined",
    joined_marked: "joined",
    joined_not_lead: "joined",
    still_on_call: "still_on_call",
    expired: "expired",
    failed: "failed",
    failed_handover: "failed",
    down: "making",
    pending_zoom: "failed",
    booked: "sent",
  };
  for (const knob of F.ROOM_KNOBS)
    test(`room=${knob}`, () => {
      const { feed, canMarkIntro } = F.roomFixture(knob, NOW);
      expect(R.roomMoment(feed.room, NOW)).toBe(roomWant[knob]);
      // Every fixture says a sentence and never a placeholder.
      const s = R.sentenceText(
        R.roomSentence(feed.room, { now: NOW, canMarkIntro }),
      );
      expect(s.length).toBeGreaterThan(5);
      expect(s).not.toMatch(/undefined|null|NaN|\{|--:--/);
    });

  test("the two fixtures the specs call out by name", () => {
    expect(R.healthTone(F.roomFixture("down", NOW).feed.health as Health)).toBe(
      "bad",
    );
    expect(
      R.sentenceText(
        R.roomSentence(F.roomFixture("pending_zoom", NOW).feed.room, {
          now: NOW,
        }),
      ),
    ).toBe(
      "Your Zoom seat is not active yet. Accept Zoom's email invite. Meet works now.",
    );
    expect(
      R.sentenceText(
        R.roomSentence(F.roomFixture("joined", NOW).feed.room, { now: NOW }),
      ),
    ).toBe("Faisal joined. Booked as a live intro and marked shown.");
    expect(
      R.sentenceText(
        R.roomSentence(F.roomFixture("joined_not_lead", NOW).feed.room, {
          now: NOW,
        }),
      ),
    ).toBe("Faisal joined. Not booked: this contact is not a tagged lead.");
  });

  const offerWant: Record<string, string> = {
    incoming: "offer",
    taken: "taken",
    lost: "lost",
    missed: "missed",
    expired: "missed",
    refresh: "refresh",
    standby: "available",
    making: "making",
    standby_failed: "standby_failed",
    away: "away",
    available: "available",
    ready: "ready",
    booked: "booked_call",
    on_call: "on_call",
    down: "down",
    // Live calls off: the strip's own line is the Away one (the banner hides it).
    live_off: "away",
  };
  for (const knob of F.OFFER_KNOBS)
    test(`offer=${knob}`, () => {
      const { live, flash } = F.liveFixture(knob, NOW);
      const l = R.stripLine({
        ...live,
        now: NOW,
        flash,
        standbyError: live.standby_error ?? null,
      });
      expect(l.moment).toBe(offerWant[knob] as StripLine["moment"]);
      expect(R.sentenceText(l.sentence)).not.toMatch(
        /undefined|null|NaN|\{|--:--/,
      );
    });

  test("knob guards", () => {
    expect(F.isRoomKnob("sent")).toBe(true);
    expect(F.isRoomKnob("nope")).toBe(false);
    expect(F.isOfferKnob("incoming")).toBe(true);
    expect(F.isOfferKnob(null)).toBe(false);
  });
});

describe("the harness's answers", () => {
  test("every room and live action answers ok, and others are left alone", () => {
    const actions = [
      ["room.create", {}],
      ["room.wrap", {}],
      ["room.status", {}],
      ["room.open", {}],
      ["room.mark", { what: "host_in" }],
      ["room.mark", { what: "lead_in" }],
      ["room.mark", { what: "not_lead" }],
      ["room.end", { reason: "end" }],
      ["room.end", { reason: "cancel" }],
      ["room.send", {}],
      ["live.status", {}],
      ["live.availability", { state: "available" }],
      ["live.take", {}],
      ["live.decline", {}],
    ] as const;
    for (const [action, body] of actions) {
      const out = F.answerRoomsAction(
        action,
        { ...body },
        { room: "sent", offer: "incoming" },
        NOW,
      );
      expect(out?.ok).toBe(true);
    }
    expect(F.answerRoomsAction("dial.call", {}, {}, NOW)).toBeNull();
    expect(F.answerRoomsAction("room.mark", { what: "x" }, {}, NOW)?.ok).toBe(
      false,
    );
  });

  test("a press moves the state and the version up", () => {
    const out = F.answerRoomsAction(
      "room.mark",
      { what: "lead_in" },
      { room: "host_in" },
      NOW,
    ) as {
      room: RoomView;
    };
    expect(out.room.state).toBe("lead_in");
    expect(out.room.version).toBe(
      F.roomFixture("host_in", NOW).feed.room.version + 1,
    );
    const ended = F.answerRoomsAction(
      "room.end",
      { reason: "on_phone" },
      { room: "sent" },
      NOW,
    ) as {
      room: RoomView;
    };
    // "We are on the phone" cancels the room (roomlogic: on_phone → cancelled).
    expect(ended.room).toMatchObject({
      state: "cancelled",
      result: "moved_to_phone",
    });
  });

  test("live.status with my room puts it first; a final one stays out", () => {
    const live = F.answerRoomsAction(
      "live.status",
      {},
      { room: "opened", offer: "ready" },
      NOW,
    ) as unknown as LiveStatus;
    expect(live.rooms[0].code).toBe("K7Q2MX");
    const gone = F.liveFixture("ready", NOW, "expired").live;
    expect(gone.rooms.every(x => x.purpose === "standby")).toBe(true);
  });

  test("offers in a fixture are typed as the strip expects", () => {
    const o: Offer = F.offerFixture(NOW);
    expect(R.offerLeft(o, NOW)).toBe(107_000);
  });
});

// Stress round 2 (self-reported-join-has-no-confirm-path): a join only a
// hand press reported is not counted until a manager says so; the manager
// sees the button, the press is the audited room.count_confirm, and the line
// says what waits.
describe("a join marked by hand waits for a manager to count it", () => {
  const handPressed = () =>
    sentRoom({
      state: "ended",
      result: "joined",
      lead_in_at: iso(NOW - 5 * MIN),
      ended_at: iso(NOW - MIN),
      count_result: "self_reported",
    });

  test("a manager sees Count this join; a rep does not", () => {
    const r = handPressed();
    expect(
      R.roomActions(r, { now: NOW, manager: true }).quiet.map(a => a.key),
    ).toContain("count_confirm");
    expect(R.roomActions(r, { now: NOW }).quiet.map(a => a.key)).not.toContain(
      "count_confirm",
    );
    expect(
      R.roomActions(sentRoom(), { now: NOW, manager: true }).quiet.map(
        a => a.key,
      ),
    ).not.toContain("count_confirm");
  });

  test("the press is room.count_confirm with the room's id", async () => {
    const r = handPressed();
    answer = async () => ({ ok: true, room: { ...r, count_result: "booked" } });
    await R.roomsApi.countConfirm(r.id);
    expect(calls.at(-1)).toEqual({
      action: "room.count_confirm",
      body: { room_id: r.id },
    });
  });
});
