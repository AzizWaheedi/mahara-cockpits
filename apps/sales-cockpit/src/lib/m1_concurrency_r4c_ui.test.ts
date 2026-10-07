// bun test apps/sales-cockpit/src/lib/m1_concurrency_r4c_ui.test.ts
//
// Milestone 1 (the video link when a call fails), video-link round 4 (third
// pass), angle: concurrency and idempotency, the cockpit's half. The room
// panel's "Use Meet" (and "Try {other}") is one press made of two calls to
// sales-api in turn (components/RoomPanel.tsx retry): room.end (cancel) on
// the room on show, then room.create on the other provider. Nothing makes
// the two one step: the cancel lands first, whatever the create answers.
//
// The pilot's settings (m1-scope.md section 3): rooms on, both providers,
// short_link off (a Zoom link cannot be read out), the WhatsApp gate locked
// (the link goes by email), live handover off.
//
// A failing test is a finding. Every lead and seat is invented.
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { ApiError } from "./apiErrors";
import type { RoomView } from "./rooms";

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

/** 14:12:00 in Kuwait on 8 October 2026. */
const NOW = Date.parse("2026-10-08T11:12:00.000Z");
const S = 1000;
const MIN = 60 * S;
const iso = (ms: number) => new Date(ms).toISOString();

beforeEach(() => {
  calls.length = 0;
  answer = async () => ({ ok: true });
  R.forgetRequests();
});
afterEach(() => R.forgetRequests());

/** A closer's Zoom video link (lead page, manual), its Zoom link not sayable (short_link off). */
const zoomRoom = (over: Partial<RoomView> = {}) =>
  F.baseRoom(NOW, {
    id: "room-zm1",
    code: "ZM4C11",
    contact_id: "stress-m1c4c-lead",
    contact_first_name: "Huda",
    purpose: "manual",
    call_kind: "demo",
    provider: "zoom",
    host_email: "stress-m1c4c-closer@stress.invalid",
    state: "open",
    version: 3,
    short_url: null,
    join_url: "https://us06web.zoom.us/j/85012349999?pwd=c3RyZXNz",
    opened_at: iso(NOW - 4 * MIN),
    link_claimed_at: iso(NOW - 4 * MIN),
    ...over,
  } as Partial<RoomView>);

const offers = (
  room: RoomView,
  ctx: Partial<Parameters<typeof R.roomActions>[1]> = {},
) => {
  const a = R.roomActions(room, { now: NOW, ...ctx });
  return [a.primary, ...a.quiet]
    .filter(Boolean)
    .map(x => `${x?.key}:${x?.label}`);
};
const say = (room: RoomView) =>
  R.sentenceText(R.roomSentence(room, { now: NOW }));

describe("m1 concurrency r4c (cockpit): Use Meet on a Zoom room whose link went", () => {
  test("control: a Zoom link that never went (a final Not sent) offers Use Meet: the lead holds nothing, so a new room loses nothing", () => {
    const r = zoomRoom({
      refusal: "Not sent: this lead has no email address in HighLevel",
    });
    expect(offers(r)).toContain("retry:Use Meet");
  });

  test("m1-conc-r4c-use-meet-cancels-room-whose-link-went: the template nobody saw was backed up by email (the link reached the lead by email, as the panel itself says); the panel still offers Use Meet, whose press cancels this room first (the worker closes its Zoom meeting) and sends a second link: the lead's email link is dead", () => {
    const r = zoomRoom({
      link_sent_at: iso(NOW - 3 * MIN),
      link_channels: ["whatsapp_template", "email"],
      link_unconfirmed_at: iso(NOW - 2 * MIN),
    });
    // The panel itself says the link reached the lead by email.
    expect(say(r)).toMatch(/by email/i);
    // What should hold: a room whose link went (by email here) never offers
    // the press that cancels it for a new room; the comment beside it in
    // lib/rooms.ts says "a Zoom link nobody can say, and nothing sent it".
    expect(offers(r)).not.toContain("retry:Use Meet");
  });

  test("m1-conc-r4c-use-meet-cancels-room-whose-link-went (the pilot's email lane): the link went by email and HighLevel still holds it as pending (sales-api's own line: HighLevel has not sent the email yet): the panel offers Use Meet, which cancels the room the queued email leads to", () => {
    const r = zoomRoom({
      link_sent_at: iso(NOW - 3 * MIN),
      link_channels: ["email"],
      link_unconfirmed_at: iso(NOW - MIN),
    });
    expect(offers(r)).not.toContain("retry:Use Meet");
  });

  test("m1-conc-r4c-use-meet-ignores-other-ok: Meet is not usable for this seat now (room.status other_ok false: the worker's Google sign-in is down); Try Meet on a failed room is hidden, but Use Meet on an open Zoom room is still offered, and its press cancels the room before sales-api refuses the Meet room", () => {
    const failed = zoomRoom({
      state: "failed",
      error: "Zoom did not answer.",
      result: "failed",
      ended_at: iso(NOW - MIN),
    });
    expect(offers(failed, { otherOk: false })).not.toContain("retry:Try Meet");
    const late = zoomRoom({
      link_claimed_at: iso(NOW - 3 * MIN),
      opened_at: iso(NOW - 3 * MIN),
    });
    expect(offers(late, { otherOk: false })).not.toContain("retry:Use Meet");
  });

  test("m1-conc-r4c-email-pending-said-as-template-unconfirmed: the pilot's link went by email only and HighLevel still holds it as pending (sales-api marks the room unconfirmed and says 'HighLevel has not sent the email yet. Read the link out.'); the panel must not say a WhatsApp message went unconfirmed and that the link went by email", () => {
    const said: Record<string, string> = {};
    for (const [name, over] of [
      [
        "setter's missed-call room (Meet)",
        {
          purpose: "fallback",
          provider: "meet",
          call_kind: "intro",
          join_url: "https://meet.google.com/abc-defg-hij",
        },
      ],
      ["closer's lead-page room (Zoom)", {}],
    ] as const) {
      const r = zoomRoom({
        ...(over as Partial<RoomView>),
        link_sent_at: iso(NOW - 3 * MIN),
        link_channels: ["email"],
        link_unconfirmed_at: iso(NOW - MIN),
      });
      said[name] = say(r);
    }
    const wrong = Object.fromEntries(
      Object.entries(said).map(([k, w]) => [
        k,
        {
          mentions_whatsapp: /whatsapp|template/i.test(w),
          says_it_went: /(went|sent) by email/i.test(w),
          words: w,
        },
      ]),
    );
    for (const v of Object.values(wrong))
      expect({
        mentions_whatsapp: v.mentions_whatsapp,
        says_it_went: v.says_it_went,
      }).toEqual({ mentions_whatsapp: false, says_it_went: false });
  });
});

describe("m1 concurrency r4c (cockpit): Use Meet's two calls", () => {
  test("m1-conc-r4c-use-meet-cancel-then-create-refused-loses-room: the press as RoomPanel.retry makes it (room.end cancel, then room.create on Meet); sales-api refuses the Meet room (the lead's three call links this hour, the room caps, Meet down): the lead's Zoom room is already cancelled and no room is in its place", async () => {
    const zoom = zoomRoom({
      link_sent_at: iso(NOW - 3 * MIN),
      link_channels: ["whatsapp_template", "email"],
      link_unconfirmed_at: iso(NOW - 2 * MIN),
    });
    let state = zoom.state;
    answer = async c => {
      if (c.action === "room.end") {
        state = "cancelled";
        return {
          ok: true,
          room: {
            ...zoom,
            state,
            result: "cancelled",
            version: zoom.version + 1,
            ended_at: iso(NOW),
          },
        };
      }
      if (c.action === "room.create") {
        // sales-api checks the Meet room before it cancels the Zoom room it
        // replaces: refused, the Zoom room stays open.
        if (c.body.replaces !== zoom.id) state = "cancelled";
        throw new ApiError(
          "This lead has had three call links this hour, so no new room was made. Call them again later.",
          "refused",
          429,
          "link_flood",
        );
      }
      return { ok: true };
    };
    // RoomPanel.retry, line for line since the fix: one room.create naming
    // the room it replaces (before it, room.end cancel went first).
    let refused: string | null = null;
    try {
      await R.roomsApi.create(R.retryRequest(zoom, null, "meet"));
    } catch (e) {
      refused = (e as Error).message;
    }
    expect(calls.map(c => c.action)).toEqual(["room.create"]);
    // What should hold: a Meet room that would be refused leaves the lead's
    // Zoom room open (as "I can't let them in" checks the replacement before
    // it closes the room: m1 round 1), so the link the lead holds still works.
    expect({ refused: Boolean(refused), zoom_room: state }).toEqual({
      refused: true,
      zoom_room: "open",
    });
  });
});

const D = await import("./dialerUi");

describe("m1 concurrency r4c (cockpit): Send a video link and WhatsApp them, pressed together after a missed call", () => {
  const step = (video: RoomView | null, videoPending: number | null = null) =>
    D.afterMiss({
      videoPending,
      moment: "missed_call",
      whatsapp: {
        on: true,
        dnd: false,
        reachable: true,
        window: { open: true },
      },
      email: { on: true, dnd: false, reachable: true },
      templatesLive: false,
      messageReady: true,
      video: video as never,
      now: NOW,
    });

  test("control: once the dialer knows the room (requested, its link on its way), the step offers no missed-call message", () => {
    const made = F.baseRoom(NOW, {
      state: "requested",
      contact_id: "stress-m1c4c-lead",
      created_at: iso(NOW - 2 * S),
    } as Partial<RoomView>);
    expect(step(made).send).toBeNull();
  });

  test("m1-conc-r4c-missed-call-message-offered-while-video-link-press-on-its-way: the setter presses Send a video link (the picker waits for room.create, up to the worker's 15 s, and live.status is read every 4 s), and in that wait the after-miss step still offers WhatsApp them with the ready missed-call message (DialerPage passes useLeadRoom's room, null until the press answers or live.status lists it): the lead gets 'I tried to call you' twice, once with the link", () => {
    // What the dialer passes while the press is on its way: no room yet, and
    // since the fix the press itself (VideoPicker's onPending). A plain miss
    // with no press keeps its missed-call message (control below).
    const waiting = step(null, NOW - 3 * S);
    expect(waiting.send).toBeNull();
    expect(step(null).send).toBe("whatsapp");
  });
});
