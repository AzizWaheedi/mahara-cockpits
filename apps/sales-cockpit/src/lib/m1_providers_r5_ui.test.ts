// Milestone 1, video-link round 5, the PROVIDER QUIRKS angle, through the
// panel's own words (lib/rooms.ts) over sales-api's real room actions
// (rooms.ts with testfakes.ts).
//
// bun test src/lib/m1_providers_r5_ui.test.ts   (from apps/sales-cockpit)
//
// What HighLevel and Meta do to a link after it went: an email bounces
// minutes after "delivered", Meta fails a free text late (131026, not on
// WhatsApp), HighLevel holds an email at "pending" and never hands it on.
// sales-api reads each of these (rooms.ts recheckLink, emailBounced,
// whatsappFailedLate, pendingEmail, backupFailed), sets link_unconfirmed_at,
// sends the backup on the other lane where it can, and writes one timeline
// line. The panel's headline is the rep's one glance ("the rep always knows
// what went"; the timeline is folded away behind "Show the timeline",
// RoomPanel.tsx). Its "not_confirmed" sentence was written for a WhatsApp
// template nobody saw (the template lane is off in the pilot: short_link
// false) and reads link_channels only.
//
// The message service is faked the way index.ts convoSend runs a send: a
// request id's earlier row answers a repeat; a WhatsApp free text needs the
// lead's 24-hour window; the row is written, the caller's last check runs,
// HighLevel's POST answers 200 with a message id, and the read-back's status
// is stored through lib.ts stateOf as convoSend stores it. HighLevel's GET
// /conversations/messages/{id} answers what each test sets later.
//
// Pilot settings (m1-scope.md section 3): rooms on, both providers, every
// send lane on, test_only with the test leads listed, short_link off,
// count_on_join, settle, wrap, auto_on_miss and live off. A failing
// expectation is a finding; its message says what the rep reads instead.
// Every lead is invented (stress-...); nothing leaves this process.

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
const { ApiRefusal, GhlError } = await import(`${SA}/liveio.ts`);
const { stateOf, toThread } = await import(`${SA}/lib.ts`);
const { matchSent } = await import(`${SA}/sendrules.ts`);
const R = await import("./rooms");
const { afterMiss } = await import("./dialerUi");

const S = 1000;
const MIN = 60 * S;
const HOUR = 60 * MIN;
const SETTER = "stress-m1p5-setter@stress.invalid";
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const ZOOM_URL =
  "https://us06web.zoom.us/j/81234567890?pwd=Zx8aB3stressPasscode1";
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
const iso = (t: number) => new Date(t).toISOString();

/** HighLevel's answer to one POST: a 200 whose read-back statuses come in this order (the last stands). */
type Post = { reads?: string[]; meta?: Row };

interface Lead {
  id: string;
  /** The lead's last WhatsApp message this long ago; null: none (the window is shut). */
  inboundAgoMs: number | null;
  email?: string | null;
  text?: Post[];
  email_out?: Post[];
}

function world(o: { waGate: boolean }) {
  // 10:00 in Kuwait on a Tuesday: inside every hour rule.
  const w = fakeWorld(Date.parse("2026-10-06T10:00:00+03:00"));
  const leads = new Map<string, Lead>();
  const roomsJson: Row = {
    ...DEFAULT_ROOMS_JSON,
    enabled: true,
    test_only: true,
    test_contacts: [] as string[],
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
    { key: "rooms", value: roomsJson },
    { key: "live", value: { enabled: false, slack: false } },
    {
      key: "whatsapp_guard",
      value: o.waGate
        ? {
            connector_off: true,
            single_copy_ok_at: "2026-10-01T00:00:00Z",
            templates_per_day: 250,
          }
        : { connector_off: false, single_copy_ok_at: null },
    },
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
      at: iso(w.clock.now - 5 * S),
    },
  ]);
  w.db.seed("cockpit_sales_wa_templates", [
    { key: "call_link_ar", active: true, workflow_id: "wf-call-link" },
    { key: "call_link_en", active: true, workflow_id: "wf-call-link-en" },
  ]);
  /** HighLevel's message as GET /conversations/messages/{id} reads it now. */
  const later = new Map<string, Row>();
  /** The lead's conversation as HighLevel keeps it. */
  const conversation: {
    lead: string;
    body: string;
    status: string;
    at: number;
    id: string;
    channel: "whatsapp" | "email";
    meta?: Row;
  }[] = [];
  w.routes.push(async (m: string, p: string) => {
    const one = /^\/contacts\/([^/?]+)$/.exec(p);
    if (m === "GET" && one) {
      const id = decodeURIComponent(one[1] as string);
      const l = leads.get(id);
      if (!l)
        throw new GhlError("HighLevel said 400: Contact not found", 400, true);
      const email = l.email === undefined ? `${id}@example.invalid` : l.email;
      return {
        contact: {
          id,
          firstName: "Huda",
          name: "Huda Ali",
          phone: "+96550000000",
          ...(email ? { email } : {}),
          tags: ["roas-qualified"],
          country: "KW",
        },
      };
    }
    if (m === "GET" && /^\/contacts\/[^/]+\/appointments$/.test(p))
      return { events: [] };
    const msg = /^\/conversations\/messages\/([^/?]+)$/.exec(p);
    if (m === "GET" && msg) {
      const id = decodeURIComponent(msg[1] as string);
      const now = later.get(id);
      if (now) return { message: { id, direction: "outbound", ...now } };
    }
    return null as unknown as Row;
  });
  function leadWrote(id: string, agoMs = 0): void {
    const at = iso(w.clock.now - agoMs);
    const row = w.db
      .t("cockpit_sales_inbox")
      .find((r: Row) => r.contact_id === id);
    if (row) row.inbound_whatsapp_at = at;
    else
      w.db.seed("cockpit_sales_inbox", [
        { conversation_id: `c-${id}`, contact_id: id, inbound_whatsapp_at: at },
      ]);
  }
  function addLead(l: Lead): void {
    leads.set(l.id, l);
    (roomsJson.test_contacts as string[]).push(l.id);
    w.db.seed("cockpit_sales_leads", [
      { contact_id: l.id, country: "KW", assigned_to: "G-setter" },
    ]);
    if (l.inboundAgoMs !== null) leadWrote(l.id, l.inboundAgoMs);
  }
  const used = new Map<string, number>();
  function next(contactId: string, lane: "text" | "email"): Post {
    const l = leads.get(contactId);
    const list = (lane === "email" ? l?.email_out : l?.text) ?? [{}];
    const k = `${contactId}:${lane}`;
    const n = used.get(k) ?? 0;
    used.set(k, n + 1);
    return list[Math.min(n, list.length - 1)] as Post;
  }
  const posts: { lead: string; lane: "text" | "email" }[] = [];
  async function send(
    requestId: string,
    contactId: string,
    channel: "whatsapp" | "email",
    body: string,
    subject: string | null,
    beforeSend?: () => Promise<boolean>,
  ) {
    const again = w.db
      .t("cockpit_sales_messages")
      .find((r: Row) => r.request_id === requestId);
    if (again) {
      if (
        String(again.body).trim() !== body.trim() ||
        again.channel !== channel
      )
        throw new ApiRefusal(
          "That send was already used for other words. Press Send again.",
          409,
        );
      return { message: { ...again }, repeated: true };
    }
    if (channel === "whatsapp") {
      const inbound = w.db
        .t("cockpit_sales_inbox")
        .find((r: Row) => r.contact_id === contactId)?.inbound_whatsapp_at;
      const t = inbound ? Date.parse(String(inbound)) : Number.NaN;
      if (!Number.isFinite(t) || w.clock.now >= t + 24 * HOUR)
        throw new ApiRefusal(
          "WhatsApp only takes a free message within 24 hours of the lead's own last message. Email them instead, or wait for them to write.",
          409,
        );
    }
    const row: Row = {
      id: fakeUuid(),
      request_id: requestId,
      contact_id: contactId,
      channel,
      subject,
      body,
      source: "room",
      state: "sending",
      created_at: iso(w.clock.now),
    };
    w.db.t("cockpit_sales_messages").push(row);
    if (beforeSend && !(await beforeSend().catch(() => false))) {
      const i = w.db.t("cockpit_sales_messages").indexOf(row);
      if (i >= 0) w.db.t("cockpit_sales_messages").splice(i, 1);
      throw new ApiRefusal(
        "Not sent: the room closed before the link went.",
        409,
        { code: "stopped", certain: true },
      );
    }
    row.ghl_asked_at = iso(w.clock.now);
    const lane = channel === "email" ? "email" : "text";
    const plan = next(contactId, lane);
    posts.push({ lead: contactId, lane });
    const ghlId = `msg-${String(row.id).slice(-8)}`;
    const reads = plan.reads?.length ? plan.reads : ["sent"];
    let status = "pending";
    let error: string | null = null;
    for (const st of reads) {
      status = st;
      const [shaped] = toThread(
        [
          {
            id: ghlId,
            direction: "outbound",
            status: st,
            messageType: channel === "email" ? "TYPE_EMAIL" : "TYPE_WHATSAPP",
            ...(plan.meta ? { meta: plan.meta } : {}),
          },
        ],
        `c-${contactId}`,
      );
      error = shaped?.error ?? null;
      if (["delivered", "read", "failed", "undelivered", "opened"].includes(st))
        break;
    }
    const state = stateOf(status === "pending" && !error ? "sent" : status);
    conversation.push({
      lead: contactId,
      body,
      status,
      at: w.clock.now,
      id: ghlId,
      channel,
    });
    later.set(ghlId, {
      status,
      messageType: channel === "email" ? "TYPE_EMAIL" : "TYPE_WHATSAPP",
    });
    Object.assign(row, {
      state,
      provider_status: status,
      error:
        state === "failed"
          ? (error ?? "HighLevel marked it failed without a reason")
          : null,
      ghl_message_id: ghlId,
      ghl_conversation_id: `c-${contactId}`,
    });
    return { message: { ...row } };
  }
  async function sentSince(
    contactId: string,
    since: number,
    text: string | null | undefined,
    channel?: "whatsapp" | "email",
  ) {
    if (!text) return null;
    const ch = channel ?? "whatsapp";
    const raw = conversation
      .filter(c => c.lead === contactId)
      .map(c => ({
        id: c.id,
        direction: "outbound",
        messageType: c.channel === "email" ? "TYPE_EMAIL" : "TYPE_WHATSAPP",
        status: c.status,
        dateAdded: iso(c.at),
        body: c.body,
        ...(c.meta ? { meta: c.meta } : {}),
      }))
      .reverse();
    const list = toThread(raw, `c-${contactId}`);
    const hit = matchSent(list, since, text, { went: true, channel: ch });
    if (hit) return { id: hit.id, status: hit.status };
    const failed = matchSent(list, since, text, { channel: ch });
    if (failed)
      return {
        id: failed.id,
        status: failed.status ?? "failed",
        failed: true,
        error: failed.error ?? null,
      };
    return false;
  }
  const rooms = makeRooms({
    io: w.io,
    audit: async () => {},
    markAppointment: async () => ({ crm: "written" }),
    sendText: (
      _who: unknown,
      b: Row,
      opts?: { beforeSend?: () => Promise<boolean> },
    ) =>
      send(
        String(b.request_id),
        String(b.contact_id),
        b.channel as "whatsapp" | "email",
        String(b.body),
        (b.subject as string | null) ?? null,
        opts?.beforeSend,
      ),
    sendTemplate: async () => {
      throw new Error(
        "the template lane is off for the pilot (short_link off): no template is ever sent",
      );
    },
    upcoming: async () => null,
    sentSince,
  });
  const room = (id: string) =>
    w.db.t("cockpit_sales_rooms").find((r: Row) => r.id === id) as Row;
  /** The lead page's Send a video link (purpose manual) on Meet, made by the worker and handed to sales-api. */
  async function opened(
    contactId: string,
    provider: "meet" | "zoom" = "meet",
  ): Promise<string> {
    const out = (await rooms.actions["room.create"]!(setter, {
      request_id: crypto.randomUUID(),
      contact_id: contactId,
      provider,
      call_kind: "intro",
      purpose: "manual",
    })) as Row;
    const id = String((out.room as Row).id);
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, {
      method: "PATCH",
      body: {
        state: "creating",
        claimed_at: w.db.iso(),
        worker_run: "run-1",
        version: Number(room(id).version) + 1,
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
        text: "Room made.",
      },
      prefer: "resolution=ignore-duplicates",
    });
    await w.io.db(
      `cockpit_sales_rooms?id=eq.${id}&state=eq.creating&worker_run=eq.run-1`,
      {
        method: "PATCH",
        body: {
          state: "open",
          join_url: provider === "zoom" ? ZOOM_URL : MEET_URL,
          provider_meeting_id:
            provider === "zoom" ? "81234567890" : `evt-${id.slice(-4)}`,
          opened_at: w.db.iso(),
          host_by: iso(w.clock.now + 15 * MIN),
          ends_at: iso(w.clock.now + 30 * MIN),
          version: Number(room(id).version) + 1,
        },
      },
    );
    await rooms.desk["room.event"]!(desk, {
      kind: "worker.ready",
      room_id: id,
      payload: { provider },
    });
    await w.flush();
    return id;
  }
  async function minutes(id: string, n: number) {
    for (let i = 0; i < n; i++) {
      w.clock.now += MIN;
      await rooms.desk["room.event"]!(desk, {
        kind: "tick",
        payload: { room_ids: [id] },
      });
      await w.flush();
    }
  }
  /** HighLevel's status for a message changes (Meta's status webhook, a bounce). */
  function becomes(ghlId: string, now: Row) {
    later.set(ghlId, now);
    const c = conversation.find(x => x.id === ghlId);
    if (c) c.status = String(now.status);
  }
  function lines(id: string): string[] {
    return w.db
      .t("cockpit_sales_room_events")
      .filter((e: Row) => e.room_id === id && typeof e.text === "string")
      .map((e: Row) => String(e.text));
  }
  function msgs(lead: string, channel?: string): Row[] {
    return w.db
      .t("cockpit_sales_messages")
      .filter(
        (m: Row) =>
          m.contact_id === lead && (!channel || m.channel === channel),
      );
  }
  /** What the panel's headline says now (RoomPanel's status line), and its buttons. */
  async function panel(
    id: string,
    extra: Row = {},
  ): Promise<{ moment: string; said: string; keys: string[] }> {
    const st = (await rooms.actions["room.status"]!(setter, {
      room_id: id,
    })) as Row;
    const view = R.normalizeRoom(st.room)!;
    const now = w.clock.now + 2 * S;
    const ctx = { now, ...extra };
    const acts = R.roomActions(view, ctx);
    return {
      moment: R.roomMoment(view, now),
      said: R.sentenceText(R.roomSentence(view, ctx)),
      keys: [acts.primary, ...acts.quiet]
        .filter(Boolean)
        .map((a: Row) => String(a.key)),
    };
  }
  /** The dialer's step after the miss for this room (DialerPage's AfterMissStep over dialerUi afterMiss). */
  async function step(id: string): Promise<{ title: string; text: string }> {
    const st = (await rooms.actions["room.status"]!(setter, {
      room_id: id,
    })) as Row;
    const out = afterMiss({
      now: w.clock.now + 2 * S,
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
      video: st.room as never,
    }) as Row;
    return { title: String(out.title ?? ""), text: String(out.text ?? "") };
  }
  /** The SQL sweep's R4 close (the lead did not join by lead_by), as 20261004a writes it. */
  function sweepExpires(id: string) {
    Object.assign(room(id), {
      state: "expired",
      end_reason: "lead_no_show",
      result: "no_join",
      error: "Closed: the lead did not join in 10 minutes.",
      ended_at: w.db.iso(),
      version: Number(room(id).version) + 1,
    });
  }
  return {
    ...w,
    rooms,
    room,
    addLead,
    leadWrote,
    opened,
    minutes,
    becomes,
    lines,
    msgs,
    panel,
    posts,
    sweepExpires,
    step,
  };
}

const META_131026 = {
  status: "failed",
  messageType: "TYPE_WHATSAPP",
  meta: { error: "Message Undeliverable. (131026)" },
};

// ---------------------------------------------------------------------------
// 1. Neither way reached the lead. The free text went (window open); Meta
//    fails it late (131026, not on WhatsApp); sales-api emails the link as
//    the backup; then the email bounces. backupFailed writes "The email
//    bounced too, so neither way reached the lead. Read the link out." on the
//    timeline. The panel's headline (link_channels [whatsapp_text, email],
//    link_unconfirmed_at set) is the template sentence: "Not confirmed on
//    WhatsApp. Sent by email too." The rep reads that the lead has the link
//    by email; the lead has it on no channel, and nobody reads it out.
// ---------------------------------------------------------------------------

describe("m1 providers r5 (panel): neither way reached the lead", () => {
  test("HELD (control): the late 131026 backed up by email that arrives reads as a link that went by email", async () => {
    const w = world({ waGate: true });
    const LEAD = "stress-m1p5-neither-ctl";
    w.addLead({
      id: LEAD,
      inboundAgoMs: 2 * HOUR,
      text: [{ reads: ["sent"] }],
      email_out: [{ reads: ["delivered"] }],
    });
    const id = await w.opened(LEAD);
    expect(w.room(id).link_channels).toEqual(["whatsapp_text"]);
    const text = w.msgs(LEAD, "whatsapp")[0] as Row;
    w.becomes(String(text.ghl_message_id), META_131026);
    await w.minutes(id, 2);
    expect(w.room(id).link_channels).toEqual(["whatsapp_text", "email"]);
    const p = await w.panel(id);
    expect(p.said).toMatch(/email/i);
  });

  test("neither-way-said-as-sent-by-email (late 131026, then the backup email bounces): the panel says the link went by email", async () => {
    const w = world({ waGate: true });
    const LEAD = "stress-m1p5-neither-bounce";
    w.addLead({
      id: LEAD,
      inboundAgoMs: 2 * HOUR,
      text: [{ reads: ["sent"] }],
      email_out: [{ reads: ["delivered"] }],
    });
    const id = await w.opened(LEAD);
    const text = w.msgs(LEAD, "whatsapp")[0] as Row;
    w.becomes(String(text.ghl_message_id), META_131026);
    await w.minutes(id, 2);
    const mail = w.msgs(LEAD, "email")[0] as Row;
    expect(mail?.state).toBe("delivered");
    w.becomes(String(mail.ghl_message_id), {
      status: "bounced",
      messageType: "TYPE_EMAIL",
    });
    await w.minutes(id, 2);
    const timeline = w.lines(id);
    expect(timeline).toContain(
      "The email bounced too, so neither way reached the lead. Read the link out.",
    );
    const p = await w.panel(id);
    expect(
      p.said,
      `Meta failed the free text (131026) and the backup email bounced; sales-api's timeline says "neither way reached the lead. Read the link out." ` +
        `The panel's headline (moment ${p.moment}) reads: ${JSON.stringify(p.said)}`,
    ).not.toMatch(/sent by email|went by email/i);
  });

  test("neither-way-said-as-sent-by-email (the bounce first, then Meta fails the WhatsApp backup): the panel says the link went by email", async () => {
    const w = world({ waGate: true });
    const LEAD = "stress-m1p5-neither-text";
    // The window is shut at the press (email only); the lead writes on WhatsApp a minute later.
    w.addLead({
      id: LEAD,
      inboundAgoMs: null,
      text: [{ reads: ["sent"] }],
      email_out: [{ reads: ["delivered"] }],
    });
    const id = await w.opened(LEAD);
    expect(w.room(id).link_channels).toEqual(["email"]);
    w.leadWrote(LEAD);
    const mail = w.msgs(LEAD, "email")[0] as Row;
    w.becomes(String(mail.ghl_message_id), {
      status: "bounced",
      messageType: "TYPE_EMAIL",
    });
    await w.minutes(id, 2);
    expect(w.lines(id)).toContain(
      "The email bounced, so the link went on WhatsApp.",
    );
    const text = w.msgs(LEAD, "whatsapp")[0] as Row;
    w.becomes(String(text.ghl_message_id), META_131026);
    await w.minutes(id, 2);
    const timeline = w.lines(id);
    expect(timeline).toContain(
      "WhatsApp failed the link too, so neither way reached the lead. Read the link out.",
    );
    const p = await w.panel(id);
    expect(
      p.said,
      `The email bounced and Meta failed the WhatsApp backup (131026); sales-api's timeline says "neither way reached the lead". ` +
        `The panel's headline (moment ${p.moment}) reads: ${JSON.stringify(p.said)}`,
    ).not.toMatch(/sent by email|went by email/i);
  });
});

describe("m1 providers r5 (panel): the room closes after neither way reached the lead", () => {
  test("neither-way-expiry-offers-noshow: a Zoom room whose link reached the lead on no channel closes as 'nobody joined' with a No-show press", async () => {
    const w = world({ waGate: true });
    const LEAD = "stress-m1p5-neither-noshow";
    w.addLead({
      id: LEAD,
      inboundAgoMs: 2 * HOUR,
      text: [{ reads: ["sent"] }],
      email_out: [{ reads: ["delivered"] }],
    });
    const id = await w.opened(LEAD, "zoom");
    const text = w.msgs(LEAD, "whatsapp")[0] as Row;
    w.becomes(String(text.ghl_message_id), META_131026);
    await w.minutes(id, 2);
    const mail = w.msgs(LEAD, "email")[0] as Row;
    w.becomes(String(mail.ghl_message_id), {
      status: "bounced",
      messageType: "TYPE_EMAIL",
    });
    await w.minutes(id, 2);
    expect(w.lines(id)).toContain(
      "The email bounced too, so neither way reached the lead. Read the link out.",
    );
    await w.minutes(id, 7);
    w.sweepExpires(id);
    // The dialer, with the lead's booked intro to mark (DialerPage's onMarkIntro).
    const p = await w.panel(id, { canMarkIntro: true, talkBelow: true });
    expect(
      { moment: p.moment, said: p.said, noshow: p.keys.includes("noshow") },
      `Meta failed the free text (131026) and the backup email bounced: the link reached the lead on no channel. ` +
        `When the room closed the panel said ${JSON.stringify(p.said)} (moment ${p.moment}) with the buttons ${JSON.stringify(p.keys)}; ` +
        "a No-show here runs HighLevel's no-show automation on a lead who never had the link",
    ).toEqual({
      moment: "expired_unsent",
      said: expect.anything(),
      noshow: false,
    });
  });
});

// ---------------------------------------------------------------------------
// 1b. The dialer's step after the miss (the setter's main path: the call did
//     not connect, Send a video link, then this step). dialerUi afterMiss
//     reads link_sent_at and link_channels only: once the link went, the
//     step is "The video link went on WhatsApp at 10:00. Wait for them here,
//     or go to the next lead." whatever sales-api learnt since. Meta's late
//     failure with no email to back it up, or both lanes failing, leaves the
//     lead with no link while the step sends the setter to the next lead.
// ---------------------------------------------------------------------------

describe("m1 providers r5 (dialer step): the link failed after it went", () => {
  test("late-failure-step-says-link-went-next-lead (131026, no email): the step tells the setter the link went on WhatsApp and to go to the next lead", async () => {
    const w = world({ waGate: true });
    const LEAD = "stress-m1p5-step-131026";
    w.addLead({
      id: LEAD,
      inboundAgoMs: 2 * HOUR,
      email: null,
      text: [{ reads: ["sent"] }],
    });
    const id = await w.opened(LEAD);
    const text = w.msgs(LEAD, "whatsapp")[0] as Row;
    w.becomes(String(text.ghl_message_id), META_131026);
    await w.minutes(id, 2);
    expect(w.lines(id)).toContain(
      "WhatsApp failed the link after it was sent, and no email could go. Read the link out.",
    );
    const s = await w.step(id);
    expect(
      s,
      `Meta failed the free text (131026, not on WhatsApp) and the lead has no email: sales-api says "no email could go. Read the link out." ` +
        `The dialer's step reads ${JSON.stringify(s)}`,
    ).toEqual({
      title: expect.not.stringMatching(/^The video link went$/),
      text: expect.not.stringMatching(/went on WhatsApp|next lead/i),
    });
  });

  test("late-failure-step-says-link-went-next-lead (neither way): the backup email bounced too, and the step tells the setter to go to the next lead", async () => {
    const w = world({ waGate: true });
    const LEAD = "stress-m1p5-step-neither";
    w.addLead({
      id: LEAD,
      inboundAgoMs: 2 * HOUR,
      text: [{ reads: ["sent"] }],
      email_out: [{ reads: ["delivered"] }],
    });
    const id = await w.opened(LEAD);
    const text = w.msgs(LEAD, "whatsapp")[0] as Row;
    w.becomes(String(text.ghl_message_id), META_131026);
    await w.minutes(id, 2);
    const mail = w.msgs(LEAD, "email")[0] as Row;
    w.becomes(String(mail.ghl_message_id), {
      status: "bounced",
      messageType: "TYPE_EMAIL",
    });
    await w.minutes(id, 2);
    expect(w.lines(id)).toContain(
      "The email bounced too, so neither way reached the lead. Read the link out.",
    );
    const s = await w.step(id);
    expect(
      s,
      `Neither way reached the lead (sales-api's timeline). The dialer's step reads ${JSON.stringify(s)}`,
    ).toEqual({
      title: expect.not.stringMatching(/^The video link went$/),
      text: expect.not.stringMatching(/next lead/i),
    });
  });
});

// ---------------------------------------------------------------------------
// 2. The email failed and WhatsApp went. The window was shut at the press, so
//    the link went by email only; the lead writes on WhatsApp; the email
//    bounces (or HighLevel holds it at "pending" for good) and sales-api
//    sends the free text, which Meta delivers. link_channels is [email,
//    whatsapp_text] with link_unconfirmed_at set, and the panel's template
//    sentence says the opposite of what happened: "Not confirmed on
//    WhatsApp. Sent by email too."
// ---------------------------------------------------------------------------

describe("m1 providers r5 (panel): the email failed, WhatsApp went", () => {
  test("bounce-then-whatsapp-said-as-sent-by-email: the email bounced, the free text was delivered, and the panel says WhatsApp did not confirm and the email went", async () => {
    const w = world({ waGate: true });
    const LEAD = "stress-m1p5-bounce-wa";
    w.addLead({
      id: LEAD,
      inboundAgoMs: null,
      text: [{ reads: ["delivered"] }],
      email_out: [{ reads: ["delivered"] }],
    });
    const id = await w.opened(LEAD);
    w.leadWrote(LEAD);
    const mail = w.msgs(LEAD, "email")[0] as Row;
    w.becomes(String(mail.ghl_message_id), {
      status: "bounced",
      messageType: "TYPE_EMAIL",
    });
    await w.minutes(id, 2);
    expect(w.lines(id)).toContain(
      "The email bounced, so the link went on WhatsApp.",
    );
    expect(w.msgs(LEAD, "whatsapp")[0]?.state).toBe("delivered");
    const p = await w.panel(id);
    expect(
      p.said,
      `The email bounced and the free text was delivered (the timeline: "The email bounced, so the link went on WhatsApp."). ` +
        `The panel's headline (moment ${p.moment}) reads: ${JSON.stringify(p.said)}`,
    ).not.toMatch(/not confirmed on whatsapp|sent by email|went by email/i);
  });

  test("email-pending-then-whatsapp-said-as-sent-by-email: HighLevel never sent the email, the free text went, and the panel says the email went", async () => {
    const w = world({ waGate: true });
    const LEAD = "stress-m1p5-pending-wa";
    w.addLead({
      id: LEAD,
      inboundAgoMs: null,
      text: [{ reads: ["delivered"] }],
      email_out: [{ reads: ["pending"] }],
    });
    const id = await w.opened(LEAD);
    expect(w.room(id).link_channels).toEqual(["email"]);
    w.leadWrote(LEAD);
    await w.minutes(id, 3);
    expect(w.room(id).link_channels).toEqual(["email", "whatsapp_text"]);
    const p = await w.panel(id);
    expect(
      { timeline: w.lines(id).slice(-2), said: p.said },
      `HighLevel held the email at "pending" (never sent) and the free text went; the panel's headline (moment ${p.moment}) reads: ${JSON.stringify(p.said)}`,
    ).toEqual({
      timeline: expect.anything(),
      said: expect.not.stringMatching(
        /not confirmed on whatsapp|sent by email/i,
      ),
    });
  });
});

// ---------------------------------------------------------------------------
// 3. The pilot's own path (m1-scope.md section 3: the WhatsApp gate is still
//    closed, so the link goes by email). The email bounces; no free text can
//    go, and sales-api says the bounce and asks the rep to read the link out.
//    The panel's headline is the pending-email sentence: "HighLevel has not
//    sent the email yet." HighLevel sent it, and it bounced: a rep who reads
//    "not sent yet" waits for it, or checks HighLevel's queue, while the
//    lead's address is wrong.
// ---------------------------------------------------------------------------

describe("m1 providers r5 (panel): the pilot's email link bounces", () => {
  test("email-bounce-said-as-highlevel-not-sent-yet: the panel says HighLevel has not sent the email yet", async () => {
    const w = world({ waGate: false });
    const LEAD = "stress-m1p5-bounce-only";
    w.addLead({
      id: LEAD,
      inboundAgoMs: 2 * HOUR,
      email_out: [{ reads: ["delivered"] }],
    });
    const id = await w.opened(LEAD);
    expect(w.room(id).link_channels).toEqual(["email"]);
    const mail = w.msgs(LEAD, "email")[0] as Row;
    w.becomes(String(mail.ghl_message_id), {
      status: "bounced",
      messageType: "TYPE_EMAIL",
    });
    await w.minutes(id, 2);
    const timeline = w.lines(id);
    expect(timeline.some(t => /bounced/i.test(t))).toBe(true);
    const p = await w.panel(id);
    expect(
      p.said,
      `The email went and bounced (the timeline: ${JSON.stringify(timeline.filter(t => /bounced/i.test(t)))}); ` +
        `the panel's headline (moment ${p.moment}) reads: ${JSON.stringify(p.said)}`,
    ).not.toMatch(/has not sent the email yet/i);
  });

  test("free-text-failure-said-as-template-unconfirmed: Meta failed the free text (131026), the lead has no email, and the panel says WhatsApp did not confirm the template", async () => {
    const w = world({ waGate: true });
    const LEAD = "stress-m1p5-131026-noemail";
    w.addLead({
      id: LEAD,
      inboundAgoMs: 2 * HOUR,
      email: null,
      text: [{ reads: ["sent"] }],
    });
    const id = await w.opened(LEAD);
    expect(w.room(id).link_channels).toEqual(["whatsapp_text"]);
    const text = w.msgs(LEAD, "whatsapp")[0] as Row;
    w.becomes(String(text.ghl_message_id), META_131026);
    await w.minutes(id, 2);
    const p = await w.panel(id);
    expect(
      p.said,
      `Meta failed the free text (131026: the number is not on WhatsApp) and no template exists in the pilot (short_link off); ` +
        `the panel's headline (moment ${p.moment}) reads: ${JSON.stringify(p.said)}`,
    ).not.toMatch(/template/i);
  });
});
