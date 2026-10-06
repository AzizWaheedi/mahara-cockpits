// bun test supabase/functions/sales-api/m1_concurrency_r3b_unclear.test.ts
//
// Milestone 1, video-link round 3 (second pass), angle: concurrency and
// idempotency, with the pilot's settings (m1-scope.md section 3; the
// WhatsApp gate locked, so the link goes by email).
//
// A press that closes the room in the minute after the room's email went
// out with HighLevel's answer lost (its call timed out after 25 s, and
// HighLevel took the email anyway). The send's first check of the lead's
// conversation reads from the moment the timeout came back, so it cannot
// see the email HighLevel filed when it was asked; the room says the link
// may have gone, and the minute's re-ask (which reads from the send's own
// row) settles it, but only for a room still open. Found by
// m1_concurrency_r3b_meet_fuzz.test.ts (seed 447).
//
// A failing test is a finding; tests named "control" pass. Nothing here
// reaches HighLevel; every lead and seat is invented.
import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { ApiRefusal, type LiveIO } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const SETTER = "stress-m1c3bu-setter@stress.invalid";
const LEAD = "stress-m1c3bu-lead";

const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };

const turn = () => new Promise<void>(r => setTimeout(r, 0));

/**
 * `indexLag`: how long HighLevel's conversation search takes to show a
 * message it filed. Fix round (m1 round 3b): the send's first check now
 * reads from when HighLevel was asked, so with no lag it finds the email at
 * once and the room never says "may have gone"; the tests of a room closed
 * while the link may have gone give the search 30 s of lag, so the first
 * check (25 s after the ask) still cannot see it.
 */
function world(o: { indexLag?: number } = {}) {
  const lag = o.indexLag ?? 0;
  const w = fakeWorld();
  const rows = new Map<string, Row>();
  /** What HighLevel filed in the lead's conversation (the lead has these). */
  const conversation: { body: string; at: number }[] = [];
  const audits: Row[] = [];
  /** The next sends' outcomes: "ok", or "hung" (HighLevel files it, its answer never comes; the call times out after 25 s). */
  const plan: ("ok" | "hung")[] = [];
  w.db.seed("cockpit_sales_settings", [
    {
      key: "rooms",
      value: {
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
        fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: "any", auto_on_miss: false },
      },
    },
    { key: "live", value: { enabled: false, slack: false, standby: true } },
    { key: "whatsapp_guard", value: { connector_off: false, single_copy_ok_at: null, templates_per_day: 250 } },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [{ email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true }]);
  w.db.seed("cockpit_sales_room_hosts", [{ email: SETTER, zoom_user_id: "Z-setter", zoom_status: "licensed", google_ok: true }]);
  w.db.seed("cockpit_sales_leads", [{ contact_id: LEAD, name: "Huda Ali", country: "KW" }]);
  const contact = { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", email: "huda@example.com", tags: ["roas-qualified"], country: "KW" };
  w.routes.push((m, p) => {
    if (m === "GET" && p === `/contacts/${LEAD}`) return { contact };
    if (m === "GET" && /^\/contacts\/[^/]+\/appointments$/.test(p)) return { events: [] };
    if (m === "GET" && p.startsWith("/conversations/messages/")) return { message: { id: p.split("/").pop(), status: "delivered" } };
    return null as unknown as Row;
  });
  const at = () => new Date(w.clock.now).toISOString();
  async function send(requestId: string, contactId: string, channel: "whatsapp" | "email", body: string, extra: Row, beforeSend?: () => Promise<boolean>) {
    const again = rows.get(requestId);
    if (again) return { message: { ...again }, repeated: true };
    const row: Row = { id: fakeUuid(), request_id: requestId, contact_id: contactId, channel, body, source: "room", state: "sending", created_at: at(), ...extra };
    rows.set(requestId, row);
    w.db.t("cockpit_sales_messages").push(row);
    if (beforeSend && !(await beforeSend())) {
      rows.delete(requestId);
      w.db.t("cockpit_sales_messages").splice(w.db.t("cockpit_sales_messages").indexOf(row), 1);
      throw new ApiRefusal("Not sent: the room closed before the link went.", 409, { code: "stopped", certain: true });
    }
    row.ghl_asked_at = at();
    const outcome = plan.shift() ?? "ok";
    // HighLevel files the email the moment it is asked.
    conversation.push({ body, at: w.clock.now });
    if (outcome === "hung") {
      // index.ts: HighLevel's call gives up after 25 s; the row is unclear.
      w.clock.now += 25 * S;
      Object.assign(row, { state: "unclear", error: "HighLevel did not answer within 25 s", updated_at: at() });
      throw new ApiRefusal("It may have gone (HighLevel did not answer within 25 s)", 502, { unclear: true });
    }
    Object.assign(row, { state: "sent", provider_status: "sent", ghl_message_id: `msg-${String(row.id).slice(-6)}` });
    return { message: { ...row } };
  }
  const io: LiveIO = {
    ...w.io,
    sleep: async ms => {
      w.clock.now += ms;
      await turn();
    },
  };
  const deps: RoomDeps = {
    io,
    audit: async (who, action, entityType, entityId, before, after, metadata) => {
      audits.push({ who: who.email, action, entityType, entityId, before, after, metadata });
    },
    markAppointment: async () => ({ crm: "written" }),
    sendText: (_who, b, opts) => send(b.request_id, b.contact_id, b.channel, b.body, { subject: b.subject ?? null }, opts?.beforeSend),
    sendTemplate: (_who, t) => send(t.requestId, t.contactId, "whatsapp", `Join here: ${t.buttonVariable?.join_code ?? ""}`, { template_key: t.key, via: "workflow" }, t.beforeSend),
    upcoming: async () => null,
    // index.ts sentSince over whatsappSentSince and sendrules.ts matchSent:
    // an outbound message with these words filed at or after since - 15 s.
    sentSince: async (_contactId, since, text) => {
      const hit = conversation.find(m => m.body === text && m.at >= since - 15 * S && w.clock.now - m.at >= lag);
      return hit ? { id: "conv-msg-1", status: "delivered" } : false;
    },
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
  async function drain() {
    for (let i = 0; i < 8; i++) {
      await turn();
      await w.flush();
    }
  }
  async function made(): Promise<string> {
    let stop = false;
    const worker = (async () => {
      for (let i = 0; i < 400 && !stop; i++) {
        await turn();
        const r = w.db.t("cockpit_sales_rooms").find(x => x.state === "requested");
        if (!r) continue;
        const id = String(r.id);
        await w.db.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, {
          method: "PATCH",
          body: { state: "creating", claimed_at: w.db.iso(), worker_run: "run-1", version: Number(r.version) + 1 },
        });
        await w.db.db("cockpit_sales_room_events?on_conflict=dedupe_key", {
          method: "POST",
          body: { room_id: id, kind: "worker.ready", source: "worker", dedupe_key: `worker.ready:${id}`, detail: { worker_run: "run-1" }, text: "Room made." },
          prefer: "resolution=ignore-duplicates",
        });
        const code = String(r.code).toLowerCase();
        await w.db.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.creating&worker_run=eq.run-1`, {
          method: "PATCH",
          body: {
            state: "open",
            join_url: `https://meet.google.com/m1c-${code}`,
            provider_meeting_id: `evt-${code}`,
            opened_at: w.db.iso(),
            host_by: new Date(w.clock.now + 15 * MIN).toISOString(),
            ends_at: new Date(w.clock.now + 30 * MIN).toISOString(),
            version: Number(room(id).version) + 1,
          },
        });
        await rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: { worker_run: "run-1" } });
      }
    })();
    const out = await rooms.actions["room.create"]!(setter, { contact_id: LEAD, provider: "meet", call_kind: "intro", purpose: "manual", request_id: crypto.randomUUID() });
    stop = true;
    await worker;
    await drain();
    return String((out.room as Row).id);
  }
  async function tick(ids: string[]) {
    await rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: ids } });
    await drain();
  }
  return { ...w, rooms, room, audits, plan, conversation, made, tick, drain };
}

describe("m1 concurrency r3b: the room's email went with HighLevel's answer lost, and a press closes the room within the minute", () => {
  test("control: the room stays open: the minute's re-ask reads the email in the lead's conversation and the room says its link went", async () => {
    const w = world({ indexLag: 30 * S });
    w.plan.push("hung");
    const id = await w.made();
    expect(w.room(id).link_sent_at ?? null).toBe(null);
    expect(String(w.room(id).refusal ?? "")).toMatch(/may have gone/i);
    w.clock.now += 61 * S;
    await w.tick([id]);
    expect({ emails_to_lead: w.conversation.length, link_sent: Boolean(w.room(id).link_sent_at) }).toEqual({ emails_to_lead: 1, link_sent: true });
  });

  test("m1-conc-r3b-unclear-link-never-settled-after-room-closes: the setter sends the lead a video link; HighLevel files the email but its answer times out (25 s), so the room says the link may have gone; within the minute the lead calls back and the setter presses We are on the phone: the email the lead has must still be recorded on the room (link_sent_at, one room.link row), as a link that went before such a press is", async () => {
    const w = world({ indexLag: 30 * S });
    w.plan.push("hung");
    const id = await w.made();
    expect(String(w.room(id).refusal ?? "")).toMatch(/may have gone/i);
    // 20 s later the lead calls back; the setter presses We are on the phone.
    w.clock.now += 20 * S;
    await w.rooms.actions["room.end"]!(setter, { room_id: id, version: Number(w.room(id).version), reason: "on_phone" });
    // The sweep's minute ticks it for the next fifteen minutes.
    for (let i = 0; i < 15; i++) {
      w.clock.now += 61 * S;
      await w.tick([id]);
    }
    expect({
      emails_to_lead: w.conversation.length,
      state: w.room(id).state,
      link_sent: Boolean(w.room(id).link_sent_at),
      link_rows: w.audits.filter(a => a.action === "room.link" && a.entityId === id).length,
    }).toEqual({ emails_to_lead: 1, state: "cancelled", link_sent: true, link_rows: 1 });
  });

  test("m1-conc-r3b-unclear-link-never-settled-after-room-closes (the lead's three links an hour): that email is one of the lead's call links this hour; after two more rooms' links, a fourth room's link must not go", async () => {
    const w = world({ indexLag: 30 * S });
    w.plan.push("hung");
    const a = await w.made();
    w.clock.now += 20 * S;
    await w.rooms.actions["room.end"]!(setter, { room_id: a, version: Number(w.room(a).version), reason: "on_phone" });
    for (let n = 0; n < 3; n++) {
      w.clock.now += 3 * MIN;
      const id = await w.made();
      await w.tick([id]);
      await w.rooms.actions["room.end"]!(setter, { room_id: id, version: Number(w.room(id).version), reason: "on_phone" });
    }
    const emails = w.conversation.length;
    const refusals = w.db.t("cockpit_sales_rooms").map(r => String(r.refusal ?? ""));
    expect({ emails_to_lead_this_hour: emails, a_room_said_three_links: refusals.some(r => /three|3 /i.test(r)) }).toEqual({
      emails_to_lead_this_hour: 3,
      a_room_said_three_links: true,
    });
  });

  test("m1-conc-r3b-unclear-link-never-settled-after-room-closes (the first check): HighLevel files the email when asked and its answer times out; the search shows it at once: the send's first check reads from when HighLevel was asked, so the room says its link went at once, never may have gone", async () => {
    const w = world();
    w.plan.push("hung");
    const id = await w.made();
    expect({
      emails_to_lead: w.conversation.length,
      link_sent: Boolean(w.room(id).link_sent_at),
      refusal: w.room(id).refusal ?? null,
      link_rows: w.audits.filter(a => a.action === "room.link" && a.entityId === id).length,
    }).toEqual({ emails_to_lead: 1, link_sent: true, refusal: null, link_rows: 1 });
  });
});
