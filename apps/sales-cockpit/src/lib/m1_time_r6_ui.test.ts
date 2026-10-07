// Milestone 1, video-link round 6, the TIME angle, through the lead page's
// own picker (lib/videoLink.ts videoLinkGate and linkPlanLine, as
// LeadPage.tsx and the dialer's picker call them with convo.read's
// channels) over sales-api's real room actions (testfakes.ts), with a clock
// only the test moves.
//
// bun test src/lib/m1_time_r6_ui.test.ts   (from apps/sales-cockpit)
//
// The lead's WhatsApp window, one second either side of the two clocks that
// decide it:
//  1. the inbox mirror's run (sales-mirror, pg_cron mahara-sales-mirror
//     every 3 minutes): the picker reads the lead's conversation live
//     (index.ts convo.read: whatsappWindow over HighLevel's thread), while
//     the room's send (rooms.ts linkPlan) reads cockpit_sales_inbox, which
//     knows a reply only from the mirror's next run;
//  2. the window's last 15 minutes (roomlogic LINK_WINDOW_MARGIN_MS), where
//     the room never sends the free text but the picker still says it does.
//
// Pilot settings (m1-scope.md section 3): rooms on, both providers, every
// send lane on, short_link off (so the call_link template lane is off and
// the link's next lane after the free text is email), test_only with the
// lead as the test contact, count_on_join / settle / wrap / auto_on_miss off,
// live off, followups.agent off. The WhatsApp gate is open (the pilot's state
// once a manager confirms the WA Connector is off and the single-copy test
// passed: whatsapp.guard, a Milestone 1 action). A failing expectation is a
// finding; its comment says what the rep and the lead see instead. Every
// lead is invented (stress-m1t6-ui-...), every seat @stress.invalid.

import { describe, expect, mock, test } from "bun:test";

mock.module("./supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null } }) },
  },
  SUPABASE_URL: "https://example.invalid",
  PROPOSALS_BUCKET: "sales-proposals",
}));

type Row = Record<string, unknown>;

const SA = "../../../../supabase/functions/sales-api";
const { makeRooms } = await import(`${SA}/rooms.ts`);
const { fakeWorld, fakeUuid } = await import(`${SA}/testfakes.ts`);
const { DEFAULT_ROOMS_JSON } = await import(`${SA}/roomlogic.ts`);
const { whatsappWindow } = await import(`${SA}/lib.ts`);
const V = await import("./videoLink");

const S = 1000;
const MIN = 60 * S;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const SETTER = "setter-m1t6-ui@stress.invalid";
const setter = {
  signed_in: true,
  seat: true,
  manager: false,
  email: SETTER,
  name: "Tara Setter",
  role: "setter",
  ghl_user_id: "G-setter",
};
const desk = {
  signed_in: true,
  seat: true,
  manager: false,
  email: "sales-desk",
};
const kw = (s: string) => Date.parse(`${s}+03:00`);
const iso = (t: number) => new Date(t).toISOString();
const realSleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const GATE_OPEN = {
  connector_off: true,
  single_copy_ok_at: "2026-10-01T00:00:00Z",
};

/**
 * One lead, the pilot's settings, the WhatsApp gate open.
 * `liveInboundAt`: the lead's last WhatsApp as HighLevel's conversation has
 * it (what convo.read reads for the picker). `mirroredInboundAt`: the same
 * as cockpit_sales_inbox has it after the mirror's last run (what the
 * room's send reads); null: no inbox row (the mirror never saw a WhatsApp).
 */
function setup(
  now: number,
  o: {
    liveInboundAt: number | null;
    mirroredInboundAt: number | null;
    mirroredAt?: number;
    phone?: string;
    noEmail?: boolean;
  },
) {
  const w = fakeWorld(now);
  const LEAD = `stress-m1t6-ui-${fakeUuid().slice(-8)}`;
  const phone = o.phone ?? "+96550123456";
  const rawRooms = {
    ...DEFAULT_ROOMS_JSON,
    enabled: true,
    test_only: true,
    test_contacts: [LEAD],
    providers: { zoom: true, meet: true },
    send: { whatsapp_text: true, whatsapp_template: true, email: true },
    count_on_join: false,
    settle: false,
    wrap: false,
    short_link: false,
    fallback: {
      ...DEFAULT_ROOMS_JSON.fallback,
      scope: "intro",
      auto_on_miss: false,
    },
  };
  w.db.seed("cockpit_sales_settings", [
    { key: "rooms", value: rawRooms },
    { key: "live", value: { enabled: false, slack: false } },
    { key: "followups", value: { enabled: true, agent: false } },
    { key: "whatsapp_guard", value: GATE_OPEN },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [
    {
      email: SETTER,
      name: "Tara Setter",
      role: "setter",
      ghl_user_id: "G-setter",
      active: true,
    },
  ]);
  w.db.seed("cockpit_sales_room_hosts", [
    {
      email: SETTER,
      zoom_user_id: "Z-setter",
      zoom_status: "licensed",
      google_ok: true,
    },
  ]);
  w.db.seed("cockpit_sales_worker_status", [
    {
      worker: "sales-desk",
      job: "rooms",
      ok: true,
      detail: "Working.",
      at: iso(now - 5 * S),
    },
  ]);
  w.db.seed("cockpit_sales_leads", [
    { contact_id: LEAD, country: "KW", phone, assigned_to: "G-setter" },
  ]);
  if (o.mirroredInboundAt !== null)
    w.db.seed("cockpit_sales_inbox", [
      {
        conversation_id: `c-${LEAD}`,
        contact_id: LEAD,
        inbound_whatsapp_at: iso(o.mirroredInboundAt),
        mirrored_at: iso(o.mirroredAt ?? now - 2 * MIN),
      },
    ]);
  const contact = {
    id: LEAD,
    firstName: "Sam",
    name: "Sam Lee",
    phone,
    email: o.noEmail ? "" : `${LEAD}@example.invalid`,
    tags: ["roas-qualified"],
    country: "KW",
  };
  w.routes.push(async (m: string, p: string) => {
    if (m === "GET" && p === `/contacts/${LEAD}`) return { contact };
    if (m === "GET" && /^\/contacts\/[^/]+\/appointments$/.test(p))
      return { events: [] };
    if (m === "GET" && /^\/conversations\/messages\//.test(p))
      return { message: { status: "delivered" } };
    // HighLevel's conversation search: the lead's last WhatsApp as HighLevel
    // has it (convo.read's source), which the room's send reads live since
    // round 6's fix.
    if (m === "GET" && p.startsWith("/conversations/search"))
      return {
        conversations: [
          {
            id: `c-${LEAD}`,
            contactId: LEAD,
            lastInboundWhatsappMessageDate:
              o.liveInboundAt === null ? null : iso(o.liveInboundAt),
          },
        ],
      };
    return null as unknown as Row;
  });
  const jobs: Promise<unknown>[] = [];
  const sent: { channel: string; at: number }[] = [];
  const rooms = makeRooms({
    io: {
      ...w.io,
      background: (p: Promise<unknown>) => {
        jobs.push(p.catch(() => null));
      },
    },
    audit: async () => {},
    markAppointment: async () => ({ crm: "written" }),
    sendText: async (_who: unknown, b: Row) => {
      sent.push({ channel: String(b.channel), at: w.clock.now });
      const row: Row = {
        id: fakeUuid(),
        request_id: b.request_id,
        contact_id: b.contact_id,
        channel: b.channel,
        via: "conversation",
        body: b.body,
        source: "room",
        state: "sent",
        provider_status: "delivered",
        ghl_message_id: `m-${fakeUuid().slice(-8)}`,
        created_at: iso(w.clock.now),
      };
      w.db.t("cockpit_sales_messages").push(row);
      return { message: { ...row } };
    },
    sendTemplate: async () => {
      throw new Error("no template in this test");
    },
    upcoming: async () => null,
    sentSince: async () => null,
  });
  async function drain() {
    for (let i = 0; i < 10; i++) {
      await realSleep(1);
      await Promise.race([Promise.allSettled(jobs.slice()), realSleep(40)]);
    }
  }
  const room = (id: string) =>
    w.db.t("cockpit_sales_rooms").find((r: Row) => r.id === id) as Row;

  /** What the lead page's picker shows at `at` (LeadPage.tsx: videoLinkGate, then linkPlanLine over convo.read's channels). */
  function picker(at: number) {
    const setting = V.readRoomsSetting(rawRooms);
    if (!setting) throw new Error("setting");
    const gate = V.videoLinkGate({
      setting,
      contactId: LEAD,
      seatEmail: SETTER,
      purpose: "manual",
      country: "KW",
      phone,
      now: at,
    });
    // convo.read's channels (index.ts convoRead): the window as HighLevel's
    // conversation has it at the moment the page reads it.
    const window = whatsappWindow(
      o.liveInboundAt === null ? null : iso(o.liveInboundAt),
      at,
    );
    const line = V.linkPlanLine({
      setting,
      whatsapp: { on: true, dnd: false, reachable: true, window },
      email: { on: true, dnd: false, reachable: !o.noEmail },
      guardOpen: V.guardOpen(GATE_OPEN),
      templateLive: false,
      country: "KW",
      phone,
      now: at,
    });
    return { show: gate.show, line };
  }

  /** The press (room.create manual) and the room worker's open six seconds later (contract v2 section 7). */
  async function press(at: number) {
    w.clock.now = at;
    const out = await rooms.actions["room.create"](setter, {
      request_id: crypto.randomUUID(),
      contact_id: LEAD,
      purpose: "manual",
      provider: "meet",
      call_kind: "intro",
      trigger: "manual",
    });
    const id = String((out.room as Row).id);
    w.clock.now = at + 6 * S;
    for (const r of w.db.t("cockpit_sales_worker_status"))
      r.at = iso(w.clock.now - 5 * S);
    const r = room(id);
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, {
      method: "PATCH",
      body: {
        state: "creating",
        claimed_at: w.db.iso(),
        worker_run: "run-1",
        version: Number(r.version) + 1,
      },
    });
    await w.io.db("cockpit_sales_room_events?on_conflict=dedupe_key", {
      method: "POST",
      body: {
        room_id: id,
        kind: "worker.ready",
        source: "worker",
        dedupe_key: `worker.ready:${id}`,
        detail: { worker_run: "run-1" },
        text: "Room made in 4.0 s.",
      },
      prefer: "resolution=ignore-duplicates",
    });
    await w.io.db(
      `cockpit_sales_rooms?id=eq.${id}&state=eq.creating&worker_run=eq.run-1`,
      {
        method: "PATCH",
        body: {
          state: "open",
          join_url: "https://meet.google.com/abc-defg-hij",
          provider_meeting_id: "abc-defg-hij",
          opened_at: w.db.iso(),
          host_by: iso(w.clock.now + 15 * MIN),
          ends_at: iso(w.clock.now + 30 * MIN),
          version: Number(room(id).version) + 1,
        },
      },
    );
    await rooms.desk["room.event"](desk, {
      kind: "worker.ready",
      room_id: id,
      payload: {
        provider: "meet",
        provider_meeting_id: "abc-defg-hij",
        worker_run: "run-1",
      },
    });
    await drain();
    return { id, room: room(id) };
  }

  /** The sweep's minute: the tick's re-ask of a link claimed and never sent (roomlogic reaskPlan). */
  async function tick(at: number) {
    w.clock.now = at;
    for (const r of w.db.t("cockpit_sales_worker_status"))
      r.at = iso(w.clock.now - 5 * S);
    await rooms.desk["room.event"](desk, {
      kind: "tick",
      payload: {
        room_ids: w.db.t("cockpit_sales_rooms").map((r: Row) => r.id),
      },
    });
    await drain();
  }
  /** The mirror's next run: the inbox takes the lead's reply. */
  function mirror(inboundAt: number, at: number) {
    for (const r of w.db.t("cockpit_sales_inbox"))
      Object.assign(r, {
        inbound_whatsapp_at: iso(inboundAt),
        mirrored_at: iso(at),
      });
    if (!w.db.t("cockpit_sales_inbox").length)
      w.db.seed("cockpit_sales_inbox", [
        {
          conversation_id: `c-${LEAD}`,
          contact_id: LEAD,
          inbound_whatsapp_at: iso(inboundAt),
          mirrored_at: iso(at),
        },
      ]);
  }

  return { w, LEAD, sent, picker, press, tick, mirror, room };
}

/** The channel the picker's line names, or null when it names none. */
function named(line: string | null): string | null {
  if (!line) return null;
  if (/on WhatsApp\./.test(line)) return "whatsapp";
  if (/by email\./.test(line)) return "email";
  return null;
}

// ---------------------------------------------------------------------------
// 1. The lead just wrote on WhatsApp; the inbox mirror (every 3 minutes) has
//    not run since. One second either side of the mirror's run.
// ---------------------------------------------------------------------------

describe("Tuesday 6 October, by day, WhatsApp gate open: the lead last wrote on WhatsApp three days ago, then wrote again at 14:58:01; the mirror runs at 14:57:00 and 15:00:00; Send a video link on the lead page", () => {
  const before = kw("2026-10-06T14:57:00"); // the mirror's run before the reply
  const reply = kw("2026-10-06T14:58:01");
  const old = reply - 3 * DAY;

  test("control: pressed at 15:00:01, after the mirror's 15:00:00 run took the reply: the picker says 'on WhatsApp' and the link goes on WhatsApp", async () => {
    const at = kw("2026-10-06T15:00:01");
    const s = setup(at, {
      liveInboundAt: reply,
      mirroredInboundAt: reply,
      mirroredAt: kw("2026-10-06T15:00:00"),
    });
    const p = s.picker(at);
    await s.press(at);
    expect({
      promised: named(p.line),
      went: s.sent.map(x => x.channel),
    }).toEqual({ promised: "whatsapp", went: ["whatsapp"] });
  });

  test("pressed at 14:59:59, one second before that run: the lead who wrote on WhatsApp two minutes ago gets the link on WhatsApp, as the picker says", async () => {
    const at = kw("2026-10-06T14:59:59");
    const s = setup(at, {
      liveInboundAt: reply,
      // What the inbox has since 14:57:00: the reply three days ago.
      mirroredInboundAt: old,
      mirroredAt: before,
    });
    const p = s.picker(at);
    await s.press(at);
    // Found when it fails: rooms.ts linkPlan reads the lead's 24-hour
    // window from cockpit_sales_inbox, which sales-mirror refreshes every
    // three minutes, never from HighLevel (the contact read the send just
    // made, or the conversation convo.read shows the rep). For up to three
    // minutes after a lead writes on WhatsApp (the reply to the missed-call
    // WhatsApp that makes a setter call back), the room reads the window as
    // shut: the free text is skipped, the template lane is off with the
    // short link off, and the link goes by email, while the picker on the
    // same page said "The lead gets the link on WhatsApp." The lead who is
    // on WhatsApp this minute gets an email; the rep tells them to check
    // WhatsApp.
    expect({
      promised: named(p.line),
      went: s.sent.map(x => x.channel),
    }).toEqual({ promised: "whatsapp", went: ["whatsapp"] });
  });

  test("the same for a lead whose first WhatsApp ever came at 14:58:01 (no inbox row yet): pressed at 14:59:59, the link goes on WhatsApp", async () => {
    const at = kw("2026-10-06T14:59:59");
    const s = setup(at, { liveInboundAt: reply, mirroredInboundAt: null });
    const p = s.picker(at);
    await s.press(at);
    expect({
      promised: named(p.line),
      went: s.sent.map(x => x.channel),
    }).toEqual({ promised: "whatsapp", went: ["whatsapp"] });
  });
});

describe("the same lead with no email address in HighLevel (WhatsApp is the only way a message reaches them): pressed at 14:59:59, before the mirror's 15:00:00 run", () => {
  const reply = kw("2026-10-06T14:58:01");
  const at = kw("2026-10-06T14:59:59");

  test("the link reaches the lead on WhatsApp, at the press or at the minute's re-ask once the mirror has the reply; never a final 'not sent' with the lead's window open", async () => {
    const s = setup(at, {
      liveInboundAt: reply,
      mirroredInboundAt: reply - 3 * DAY,
      mirroredAt: kw("2026-10-06T14:57:00"),
      noEmail: true,
    });
    const p = s.picker(at);
    const { id } = await s.press(at);
    const first = {
      refusal: s.room(id).refusal ?? null,
      went: s.sent.map(x => x.channel),
    };
    // The mirror's 15:00:00 run takes the reply; the sweep's minutes re-ask.
    s.mirror(reply, kw("2026-10-06T15:00:00"));
    for (const m of ["15:01:00", "15:02:00", "15:03:00"])
      await s.tick(kw(`2026-10-06T${m}`));
    const r = s.room(id);
    if (process.env.R6_SHOW)
      console.log(
        JSON.stringify({
          line: p.line,
          first,
          refusal: r.refusal,
          lead_by: r.lead_by,
        }),
      );
    // Found when it fails: with the inbox three minutes behind, the room's
    // plan finds no lane (window read as shut, template lane off with the
    // short link off, no email) and says the link final ("No message can
    // reach this lead ... read it out"), which stops the minute's re-ask
    // (roomlogic reaskPlan never re-asks a final refusal), so the link
    // never goes on the WhatsApp the lead wrote on two minutes earlier, while
    // the picker said "The lead gets the link on WhatsApp."; the rep, who
    // just failed to reach them by phone, is left to send it by hand.
    expect({
      promised: named(p.line),
      went: s.sent.map(x => x.channel),
      left_to_rep: r.link_sent_at ? null : (r.refusal ?? null),
    }).toEqual({ promised: "whatsapp", went: ["whatsapp"], left_to_rep: null });
  });
});

// ---------------------------------------------------------------------------
// 2. The window's last 15 minutes, one second either side (the picker vs
//    roomlogic channelPlan's LINK_WINDOW_MARGIN_MS). The mirror is fresh.
// ---------------------------------------------------------------------------

describe("Tuesday 6 October, by day, WhatsApp gate open, the mirror fresh: the lead wrote on WhatsApp almost 24 hours ago; Send a video link at 14:00:00, the room opens at 14:00:06", () => {
  const at = kw("2026-10-06T14:00:00");
  const opens = at + 6 * S;
  // The free text goes only while the window closes more than 15 minutes
  // after the send (the open).
  const edge = opens - 24 * HOUR + 15 * MIN;

  test("control: the lead wrote one second after the edge: the picker says 'on WhatsApp' and the link goes on WhatsApp", async () => {
    const s = setup(at, {
      liveInboundAt: edge + S,
      mirroredInboundAt: edge + S,
    });
    const p = s.picker(at);
    await s.press(at);
    expect({
      promised: named(p.line),
      went: s.sent.map(x => x.channel),
    }).toEqual({ promised: "whatsapp", went: ["whatsapp"] });
  });

  test("the lead wrote one second before the edge (their window shuts in 14:59 at the open): the picker names the channel the link goes on", async () => {
    // Round 6: the picker keeps the same 15 minutes from the moment it is
    // read (the press); it cannot know the worker opens the room 6 s later,
    // so the case sits one second inside the margin at the press as well as
    // at the open (the 6-second band between the two is the room's own).
    const s = setup(at, {
      liveInboundAt: edge - 7 * S,
      mirroredInboundAt: edge - 7 * S,
    });
    const p = s.picker(at);
    await s.press(at);
    // Found when it fails: linkPlanLine reads convo.read's window as it is
    // (open until 24 hours after the lead wrote), while channelPlan never
    // sends the free text in the window's last 15 minutes; with the
    // template lane off (short_link off) the link goes by email while the
    // picker said "The lead gets the link on WhatsApp." (the case
    // m1_time_r4_ui.test.ts kept skipped "for the round that takes it").
    expect({
      promised: named(p.line),
      went: s.sent.map(x => x.channel),
    }).toEqual({ promised: "email", went: ["email"] });
  });
});
