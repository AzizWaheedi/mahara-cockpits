// bun test supabase/functions/sales-api/stress_security_r3_rooms.test.ts
//
// Security and abuse stress of sales-api's live-call actions, round 3,
// 3 October 2026: text a lead controls reaching Slack as markup, a forged
// room.event of one kind closing a stored event of another, and what one
// seat's create-and-end loop sends one lead. Each `test` held when written;
// each `test.failing` pins a confirmed finding (its key is in its name) and
// goes red when the fix lands, so the fix flips it to `test`. Against
// testfakes.ts; no network, no real row.

import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { DEFAULT_ROOMS_JSON, offerLine } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const MIN = 60_000;
const HOST = "stress-host@stress.invalid";
const LEAD = "stress-lead-1";
const MEET_URL = "https://meet.google.com/abc-defg-hij";

const host: Who = { signed_in: true, seat: true, manager: false, email: HOST, name: "Stress Host", role: "setter", ghl_user_id: "G-host" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };

/**
 * What Slack reads as markup in a message's text (docs.slack.dev, "Formatting
 * text for app surfaces"): a special mention (<!channel>, <!here>,
 * <!everyone>), a user or group mention (<@U…>, <!subteam^…>), or a link with
 * a label of the writer's choosing (<https://…|label>). Any text a lead wrote
 * must reach Slack with its < > & escaped, so none of these survive.
 */
const SLACK_MARKUP = /<[!@#]|<https?:|<mailto:/i;

const ROOMS_ON = {
  ...DEFAULT_ROOMS_JSON,
  enabled: true,
  test_only: false,
  providers: { zoom: true, meet: true },
  send: { whatsapp_text: true, whatsapp_template: true, email: true },
};

function setup(o: { rooms?: Row; firstName?: string } = {}) {
  const w = fakeWorld();
  const audits: Row[] = [];
  const sends: Row[] = [];
  w.db.seed("cockpit_sales_settings", [
    { key: "rooms", value: { ...ROOMS_ON, ...(o.rooms ?? {}) } },
    { key: "live", value: { enabled: false, standby: true } },
    { key: "whatsapp_guard", value: { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z" } },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [{ email: HOST, name: "Stress Host", role: "setter", ghl_user_id: "G-host", active: true }]);
  w.db.seed("cockpit_sales_room_hosts", [{ email: HOST, zoom_user_id: "Z-host", zoom_status: "licensed", google_ok: true }]);
  // The lead wrote to us within the day, so a room's link goes as WhatsApp text.
  w.db.seed("cockpit_sales_inbox", [{ conversation_id: "c0", contact_id: LEAD, inbound_whatsapp_at: new Date(w.clock.now - 3_600_000).toISOString() }]);
  const firstName = o.firstName ?? "Huda";
  w.routes.push((m, p) =>
    m === "GET" && p === `/contacts/${LEAD}`
      ? { contact: { id: LEAD, firstName, name: `${firstName} Ali`, phone: "+96550000000", email: "huda@stress.invalid", tags: ["roas-qualified"], country: "KW" } }
      : (null as unknown as Row),
  );
  const deps: RoomDeps = {
    io: w.io,
    audit: async (who, action, entityType, entityId, before, after, metadata) => {
      audits.push({ who: who.email, action, entityType, entityId, before, after, metadata });
    },
    markAppointment: async () => ({ id: fakeUuid() }),
    sendText: async (who, b, opts) => {
      sends.push({ who: who.email, kind: "text", ...b, ...opts });
      return { message: { id: fakeUuid(), state: "sent", provider_status: "sent" } };
    },
    sendTemplate: async (who, t) => {
      sends.push({ who: who.email, kind: "template", ...t });
      return { message: { id: fakeUuid(), state: "sent", provider_status: "sent" } };
    },
    upcoming: async () => null,
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
  /** The worker's handshake (contract-v2 section 7): claim, store worker.ready, open, tell sales-api. */
  async function workerOpens(id: string): Promise<void> {
    const r = room(id);
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, {
      method: "PATCH",
      body: { state: "creating", claimed_at: w.db.iso(), worker_run: "run-1", version: Number(r.version) + 1 },
    });
    await w.io.db("cockpit_sales_room_events?on_conflict=dedupe_key", {
      method: "POST",
      body: { room_id: id, kind: "worker.ready", source: "worker", dedupe_key: `worker.ready:${id}`, detail: { worker_run: "run-1" }, text: "Room made." },
      prefer: "resolution=ignore-duplicates",
    });
    const cur = room(id);
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.creating&worker_run=eq.run-1`, {
      method: "PATCH",
      body: {
        state: "open",
        join_url: MEET_URL,
        provider_meeting_id: `evt-${id.slice(-6)}`,
        opened_at: w.db.iso(),
        host_by: new Date(w.clock.now + 15 * MIN).toISOString(),
        ends_at: new Date(w.clock.now + 30 * MIN).toISOString(),
        version: Number(cur.version) + 1,
      },
    });
    await rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: { worker_run: "run-1" } });
    await w.flush();
  }
  return { ...w, rooms, audits, sends, room, workerOpens };
}

// ---------------------------------------------------------------------------

describe("security r3: text a lead wrote, on its way to Slack", () => {
  test("slack-markup-from-lead-name: the count's alert to #sales-alerts carries the lead's first name as Slack markup (<!channel>, a labelled link)", async () => {
    // A lead types their own first name on the ad's form. The count's
    // "only a press says the lead came" alert puts it in the alert's words;
    // cockpit_sales_alert_set keeps them as they are and the watchdog posts
    // them to #sales-alerts as {"text": message}, so Slack reads the name as
    // markup: <!channel> pings the whole channel, and <https://…|Check
    // HighLevel> is a link whose words the lead chose, inside an alert the
    // team trusts. Ten seconds on the form; it fires the first time a rep
    // presses "The lead is in" for them with count_on_join on.
    for (const firstName of ["<!channel>", "<https://evil.stress.invalid/login|Check-HighLevel>", "<@U0STRESS>"]) {
      const w = setup({ rooms: { count_on_join: true }, firstName });
      const id = fakeUuid();
      w.db.seed("cockpit_sales_rooms", [
        {
          id,
          request_id: fakeUuid(),
          contact_id: LEAD,
          purpose: "manual",
          call_kind: "intro",
          provider: "meet",
          host_email: HOST,
          made_by: HOST,
          state: "host_in",
          host_in_at: w.db.iso(),
          join_url: MEET_URL,
          provider_meeting_id: "evt-stress",
          opened_at: w.db.iso(),
          host_by: new Date(w.clock.now + 15 * MIN).toISOString(),
          lead_by: new Date(w.clock.now + 10 * MIN).toISOString(),
          ends_at: new Date(w.clock.now + 30 * MIN).toISOString(),
          version: 3,
        },
      ]);
      await w.rooms.actions["room.mark"]!(host, { room_id: id, version: 3, what: "lead_in" });
      await w.flush();
      const alerts = w.db.t("cockpit_sales_alerts");
      // The fixture works: the hand-pressed join raised the count's alert.
      expect(alerts.length).toBeGreaterThan(0);
      for (const a of alerts) expect([firstName, String(a.message)]).toEqual([firstName, expect.not.stringMatching(SLACK_MARKUP)]);
    }
  });

  test("slack-markup-from-lead-name (P2's offer line): the Slack offer a closer gets carries the lead's name, company and the setter's note as markup", () => {
    // roomlogic offerLine is "Slack's offer to a closer"; it is the line P2's
    // live.press posts. Name and company come from the lead's own form.
    const line = offerLine({ kind: "demo", name: "<!here>", company: "<https://evil.stress.invalid|Take it now>", country: "KW", note: "<!channel>" });
    expect(line).not.toMatch(SLACK_MARKUP);
  });
});

describe("security r3: a forged room.event of one kind on a stored event of another (the cron secret, or the desk key)", () => {
  /** An unhandled stored event of a kind that is not Zoom's, as the worker, the claim or the door store them. */
  function seedEvent(w: ReturnType<typeof setup>, row: Row): string {
    const id = fakeUuid();
    w.db.seed("cockpit_sales_room_events", [{ id, at: w.db.iso(), handled_at: null, ...row }]);
    return id;
  }

  test.failing("zoom-kind-handles-non-zoom-event: room.event {kind: zoom.*} with the id of a worker.ready, a live.claimed or a slack.reply closes that event", async () => {
    // room.event's Zoom path takes `event_id` and treats whatever row it
    // names as Zoom's: it never checks the stored row's source or kind. The
    // sweep's replay dispatches by the stored kind, but a direct post (the
    // cron secret is shared with sales-mirror; sales-api takes room.event
    // from it with the public project key, bypassing the door's narrowing)
    // can name any unhandled event: the worker's word that a room is ready
    // (its link then waits for the tick's re-ask), a closer's take of a live
    // lead (its handover room is never made by the replay), or the door's
    // Slack reply (marked handled and its detail, the presser's Slack id,
    // written over, so the VPS poster never sends it).
    const w = setup();
    const out = await w.rooms.actions["room.create"]!(host, { request_id: crypto.randomUUID(), contact_id: LEAD, provider: "meet", call_kind: "intro", purpose: "manual" });
    const roomId = String((out.room as Row).id);
    const ready = seedEvent(w, { room_id: roomId, kind: "worker.ready", source: "worker", dedupe_key: `worker.ready:stress-other-${roomId}`, detail: { worker_run: "run-9" } });
    const claimed = seedEvent(w, { room_id: roomId, kind: "live.claimed", source: "claim", dedupe_key: `live.claimed:${fakeUuid()}:0`, detail: { handover_id: fakeUuid(), claim_room: "none" } });
    const reply = seedEvent(w, { room_id: null, kind: "slack.reply", source: "door", dedupe_key: `slack.reply:${fakeUuid()}`, text: "Someone else took this lead.", detail: { slack_user_id: "U0STRESS", view_id: null } });
    for (const event_id of [ready, claimed, reply]) {
      await w.rooms.desk["room.event"]!(desk, { kind: "zoom.meeting.participant_joined", event_id }).catch(() => null);
      const ev = w.db.t("cockpit_sales_room_events").find(e => e.id === event_id) as Row;
      expect([String(ev.kind), ev.handled_at ?? null]).toEqual([String(ev.kind), null]);
      expect([String(ev.kind), JSON.stringify(ev.detail)]).not.toEqual([String(ev.kind), expect.stringContaining("no_room")]);
    }
  });

  test("the sweep's own replay of the same three dispatches by the stored kind: a worker.ready is the worker's, not Zoom's (the fixture works)", async () => {
    const w = setup();
    const out = await w.rooms.actions["room.create"]!(host, { request_id: crypto.randomUUID(), contact_id: LEAD, provider: "meet", call_kind: "intro", purpose: "manual" });
    const roomId = String((out.room as Row).id);
    await w.workerOpens(roomId);
    expect(w.sends.length).toBe(1);
    const ev = w.db.t("cockpit_sales_room_events").find(e => e.dedupe_key === `worker.ready:${roomId}`) as Row;
    expect(ev.handled_at).toBeTruthy();
    expect(JSON.stringify(ev.detail)).not.toContain("no_room");
  });
});

describe("security r3: what the shared cron secret opens at sales-api", () => {
  test.failing("cron-secret-presses-as-any-slack-user: live.press (whose body names the Slack user who pressed) is not taken on the cron secret every scheduled job shares", () => {
    // index.ts lets any caller holding CRON_SECRET (vault cockpit_sync_secret,
    // also held by sales-mirror and pg_cron) with the public project key run
    // every action in rooms.cron. The door narrows what IT passes on, but
    // sales-api does not know who called: live.press takes its Slack user id
    // from the body, so once P2 builds it, that secret is a key to Take a
    // live lead or set Available as any rep. The door should press with a
    // key only the door holds (or sign the press it rebuilt from Slack's
    // signed body), and room.event should take only the kinds the door and
    // the sweep send.
    const w = setup();
    expect(w.rooms.cron).not.toContain("live.press");
  });
});

describe("security r3: what one seat's presses send one lead", () => {
  test.failing("room-link-loop-floods-lead: making a room, ending it and making another sends the same lead a new link every time", async () => {
    // Every room's link is keyed on its own room id (mahara-room/link/{room}/
    // {channel}), and nothing counts the links one lead has had: one room per
    // lead at a time, but a new room the moment the last one ends. A stuck
    // page or a rep who presses "Make a room" and "End" in turn (or a script
    // on a leaked session) sends one lead a link a room, about one every ten
    // seconds; only the sender's 30-in-ten-minutes ceiling ends it. Each room
    // is also a new Zoom or Google meeting on the host's own account.
    const w = setup();
    for (let i = 0; i < 12; i++) {
      const out = await w.rooms.actions["room.create"]!(host, { request_id: crypto.randomUUID(), contact_id: LEAD, provider: "meet", call_kind: "intro", purpose: "manual" });
      const id = String((out.room as Row).id);
      await w.workerOpens(id);
      await w.rooms.actions["room.end"]!(host, { room_id: id, version: Number(w.room(id).version), reason: "cancel" });
      await w.flush();
      w.clock.now += 5_000;
    }
    const toLead = w.sends.filter(s => (s.contact_id ?? s.contactId) === LEAD);
    // The fixture works: every room made sent its link.
    expect(w.db.t("cockpit_sales_rooms").length).toBe(12);
    // At most a few links a lead an hour, however the rooms are made.
    expect(toLead.length).toBeLessThanOrEqual(3);
  });
});
