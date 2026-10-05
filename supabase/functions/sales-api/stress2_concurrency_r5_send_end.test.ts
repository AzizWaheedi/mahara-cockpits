// bun test supabase/functions/sales-api/stress2_concurrency_r5_send_end.test.ts
//
// Second series, round 5, dimension: concurrency and idempotency. "Send by
// email" against the room's close.
//
// The room's own link (sendLinkHeld) asks stillOpen right before each
// message goes: "an End pressed while the link was on its way stops what has
// not gone yet". room.send ("Send by email", "Also send by email") checks
// the room once, at the press (isFinal), then reads HighLevel's contact, the
// host and the lead's room history (sendOn) and sends, with no stillOpen.
// The sweep's R4 closes a room at lead_by when the lead never came (ten
// minutes after the link), which is exactly when a setter tries the last
// channel; a second tab's End lands the same way. The email then goes out
// for a room that is already closed: Huda gets "your call is ready, join
// here" for a call that was given up a second earlier, and her click lands
// on the ended page.
//
// A failing test is a finding for the fix agent. Nothing here reaches
// HighLevel, Zoom, Google or Slack; every lead is invented.
import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import type { LiveIO } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const MIN = 60_000;
const SETTER = "setter@stress.invalid";
const LEAD = "stress-lead-s2c5-000007";
const MEET_URL = "https://meet.google.com/abc-defg-hij";

const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };

function setup() {
  const w = fakeWorld();
  const sent: Row[] = [];
  let onContactRead: (() => Promise<void>) | null = null;
  w.db.seed("cockpit_sales_settings", [
    {
      key: "rooms",
      value: {
        ...DEFAULT_ROOMS_JSON,
        enabled: true,
        test_only: false,
        providers: { zoom: true, meet: true },
        send: { whatsapp_text: true, whatsapp_template: true, email: true },
        fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: "any" },
      },
    },
    { key: "live", value: { enabled: false } },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [{ email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true }]);
  w.db.seed("cockpit_sales_room_hosts", [{ email: SETTER, zoom_user_id: null, zoom_status: "pending", google_ok: true }]);
  const contact = { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", email: "huda@example.com", tags: ["roas-qualified"], country: "KW" };
  w.routes.push(async (m, p) => {
    if (m === "GET" && p === `/contacts/${LEAD}`) {
      if (onContactRead) {
        const f = onContactRead;
        onContactRead = null;
        await f();
      }
      return { contact };
    }
    return null as unknown as Row;
  });
  const io: LiveIO = { ...w.io };
  const deps: RoomDeps = {
    io,
    audit: async () => {},
    markAppointment: async () => ({}),
    sendText: async (_who, b) => {
      sent.push({ channel: b.channel, request_id: b.request_id });
      return { message: { id: fakeUuid(), state: "sent", request_id: b.request_id } };
    },
    sendTemplate: async () => ({ message: { id: fakeUuid(), state: "sent" } }),
    upcoming: async () => null,
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
  return {
    ...w,
    rooms,
    room,
    sent,
    whenContactRead: (f: () => Promise<void>) => {
      onContactRead = f;
    },
  };
}

/** The setter's Meet room, its WhatsApp link gone ten minutes ago, the setter in, the lead not come. */
async function waitingRoom(w: ReturnType<typeof setup>): Promise<string> {
  const out = await w.rooms.actions["room.create"]!(setter, {
    request_id: crypto.randomUUID(),
    contact_id: LEAD,
    provider: "meet",
    call_kind: "intro",
    purpose: "fallback",
  });
  const id = String((out.room as Row).id);
  await w.db.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, {
    method: "PATCH",
    body: { state: "creating", claimed_at: w.db.iso(), worker_run: "run-1", version: Number(w.room(id).version) + 1 },
  });
  await w.db.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.creating`, {
    method: "PATCH",
    body: {
      state: "open",
      join_url: MEET_URL,
      opened_at: w.db.iso(),
      host_by: new Date(w.clock.now + 15 * MIN).toISOString(),
      ends_at: new Date(w.clock.now + 30 * MIN).toISOString(),
      lead_by: new Date(w.clock.now + 10 * MIN).toISOString(),
      version: Number(w.room(id).version) + 1,
    },
  });
  await w.db.db(`cockpit_sales_rooms?id=eq.${id}`, {
    method: "PATCH",
    body: { link_sent_at: w.db.iso(), link_claimed_at: w.db.iso(), link_channels: ["whatsapp_text"] },
  });
  await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "host_in" });
  await w.flush();
  return id;
}

describe("Also send by email while the room closes", () => {
  test("room-send-after-close-emails-dead-link: the sweep's R4 closes the room (lead_by passed, nobody came) while Also send by email reads HighLevel's contact: no email may go for a closed room", async () => {
    const w = setup();
    const id = await waitingRoom(w);
    w.clock.now += 10 * MIN;
    w.whenContactRead(async () => {
      // The sweep's R4, as the SQL writes it: expired, nobody came.
      await w.db.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.host_in`, {
        method: "PATCH",
        body: { state: "expired", result: "no_join", end_reason: "lead_no_show", ended_at: w.db.iso(), version: Number(w.room(id).version) + 1 },
      });
    });
    let told = "sent";
    try {
      await w.rooms.actions["room.send"]!(setter, { room_id: id, channel: "email", request_id: crypto.randomUUID() });
    } catch (e) {
      told = String((e as Error).message);
    }
    expect(w.room(id).state).toBe("expired");
    expect({ emails_for_the_closed_room: w.sent.filter(s => s.channel === "email").length, told }).toEqual({
      emails_for_the_closed_room: 0,
      told: expect.not.stringMatching(/^sent$/) as unknown as string,
    });
  });

  test("control: with no close beside it, Also send by email sends the one email", async () => {
    const w = setup();
    const id = await waitingRoom(w);
    w.clock.now += 9 * MIN;
    await w.rooms.actions["room.send"]!(setter, { room_id: id, channel: "email", request_id: crypto.randomUUID() });
    expect(w.sent.filter(s => s.channel === "email")).toHaveLength(1);
  });
});
