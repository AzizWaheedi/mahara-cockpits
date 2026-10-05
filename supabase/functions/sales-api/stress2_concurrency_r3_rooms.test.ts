// bun test supabase/functions/sales-api/stress2_concurrency_r3_rooms.test.ts
//
// Second series, round 3, dimension: concurrency and idempotency. rooms.ts on
// testfakes.ts, with the message service modelled as index.ts convoSend and
// sendTemplate behave (the row first, then HighLevel, then the row's
// outcome), as stress_chaos_r4.test.ts models it. Each test names the race it
// stages.
//
//   - link-lease-runs-out-mid-cascade: the room's link is sent under one
//     lease (link.send:{room}, SEND_BUDGET_MS = 90 s, chaos round 4's fix
//     for reask-replans-while-first-send-cascades). The lease covers one
//     send's budget, but the cascade under it makes up to three sends one
//     after another (the free text, the template, the email), each with its
//     own HighLevel reads. When HighLevel is slow, the first run is still
//     between channels when its lease runs out, and the next minute's re-ask
//     takes the lease, plans afresh and sends the free text on its next id
//     while the first run's template goes too: two links to one lead.
//     Then the first run's `finally` releases the lease the second run holds
//     (releaseEvent clears lease_until whoever holds it).
//
// A failing test is a finding for the fix agent; once fixed it stays as a
// regression test. Nothing here reaches HighLevel, Zoom, Google or Slack.
import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { ApiRefusal, type LiveIO } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { matchSent, type SeenMessage } from "./sendrules.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const HOUR = 60 * MIN;
const LEAD = "stress2-c3-lead-0000001";
const SETTER = "setter@stress.invalid";
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };

type Mode = "ok" | "refused_429";
type Lane = "text" | "template" | "email";

const realSleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function world(o: { inboundAgoMs?: number } = {}) {
  const w = fakeWorld();
  const audits: Row[] = [];
  const rows = new Map<string, Row>();
  const delivered: Row[] = [];
  const convo: (SeenMessage & { at: string })[] = [];
  const modes: Record<Lane, Mode[]> = { text: [], template: [], email: [] };
  /**
   * Held before index.ts writes the message row (its setup reads: the
   * template's route, guard, queued templates, HighLevel's contact read; or
   * convoSend's contact read and conversation search), per lane.
   */
  const gate: Record<Lane, Promise<void> | null> = { text: null, template: null, email: null };
  const jobs: Promise<unknown>[] = [];
  w.db.seed("cockpit_sales_settings", [
    {
      key: "rooms",
      value: {
        ...DEFAULT_ROOMS_JSON,
        enabled: true,
        test_only: false,
        providers: { zoom: true, meet: true },
        send: { whatsapp_text: true, whatsapp_template: true, email: true },
        short_link: true,
        fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: "any" },
      },
    },
    { key: "live", value: { enabled: false } },
    { key: "whatsapp_guard", value: { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z", templates_per_day: 250 } },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [{ email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true }]);
  w.db.seed("cockpit_sales_room_hosts", [{ email: SETTER, zoom_user_id: null, zoom_status: "pending", google_ok: true }]);
  w.db.seed("cockpit_sales_worker_status", [{ worker: "sales-desk", job: "rooms", ok: true, detail: "Working.", at: new Date(w.clock.now - 5 * S).toISOString() }]);
  w.db.seed("cockpit_sales_inbox", [
    { conversation_id: "c0", contact_id: LEAD, inbound_whatsapp_at: new Date(w.clock.now - (o.inboundAgoMs ?? HOUR)).toISOString() },
  ]);
  w.db.seed("cockpit_sales_wa_templates", [
    { key: "call_link_ar", active: true, workflow_id: "wf-call-link" },
    { key: "call_link_en", active: true, workflow_id: "wf-call-link-en" },
  ]);
  const introStart = w.clock.now + 5 * MIN;
  w.db.seed("cockpit_sales_appointments", [
    {
      appointment_id: "appt-c3",
      contact_id: LEAD,
      calendar_id: "cal-intro",
      call_type: "intro",
      start_at: new Date(introStart).toISOString(),
      status: "confirmed",
      assigned_user_id: "G-setter",
    },
  ]);
  const contact = { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", email: "huda@example.com", tags: ["roas-qualified"], country: "KW" };
  w.routes.push((m, p) => (m === "GET" && p === `/contacts/${LEAD}` ? { contact } : (null as unknown as Row)));

  const io: LiveIO = {
    ...w.io,
    background: p => {
      jobs.push(p.catch(e => w.logs.push(`background: ${String((e as Error)?.message ?? e)}`)));
    },
  };
  async function drain(): Promise<void> {
    for (let i = 0; i < 8; i++) {
      // A macrotask first, so a press's background job is registered before it is waited for.
      await realSleep(1);
      await Promise.race([Promise.allSettled(jobs.slice()), realSleep(40)]);
    }
  }
  const at = () => new Date(w.clock.now).toISOString();

  async function send(lane: Lane, requestId: string, channel: "whatsapp" | "email", body: string, extra: Row): Promise<{ message: Row; repeated?: boolean }> {
    const again = rows.get(requestId);
    if (again) return { message: { ...again }, repeated: true };
    if (gate[lane]) await gate[lane];
    const twice = rows.get(requestId);
    if (twice) return { message: { ...twice }, repeated: true };
    const row: Row = { id: fakeUuid(), request_id: requestId, channel, body, state: "sending", created_at: at(), ...extra };
    rows.set(requestId, row);
    w.db.t("cockpit_sales_messages").push(row);
    const mode = modes[lane].shift() ?? "ok";
    if (mode === "refused_429") {
      row.state = "failed";
      row.error = "HighLevel said 429: Too many requests";
      throw new ApiRefusal("HighLevel did not send it: HighLevel said 429: Too many requests", 502, { certain: true });
    }
    delivered.push({ lane, requestId, body, at: at() });
    if (channel === "whatsapp") convo.push({ id: fakeUuid(), direction: "outbound", channel: "whatsapp", body, at: at(), status: "delivered" });
    row.state = "sent";
    row.provider_status = lane === "template" ? "delivered" : "sent";
    return { message: { ...row } };
  }

  const deps: RoomDeps = {
    io,
    audit: async (who, action, entityType, entityId, before, after, metadata) => {
      audits.push({ who: who.email, action, entityType, entityId, before, after, metadata });
    },
    markAppointment: async () => ({}),
    sendText: (_who, b) => send(b.channel === "email" ? "email" : "text", b.request_id, b.channel, b.body, { contact_id: b.contact_id }),
    sendTemplate: async (_who, t) =>
      await send("template", t.requestId, "whatsapp", `Your Mahara call is ready. Join here: https://call.maharamedia.com/${t.buttonVariable?.join_code ?? ""}`, {
        template_key: t.key,
        via: "workflow",
        contact_id: t.contactId,
      }),
    upcoming: async () => null,
    sentSince: async (_contactId, since, text) => Boolean(matchSent(convo, since, text)),
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
  const whatsappDelivered = () => delivered.filter(d => d.lane === "text" || d.lane === "template");

  async function workerOpens(id: string) {
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
        provider_meeting_id: `evt-${id.slice(-4)}`,
        opened_at: w.db.iso(),
        host_by: new Date(w.clock.now + 15 * MIN).toISOString(),
        ends_at: new Date(w.clock.now + 30 * MIN).toISOString(),
        version: Number(cur.version) + 1,
      },
    });
  }
  async function make(): Promise<string> {
    const out = await rooms.actions["room.create"]!(setter, {
      request_id: crypto.randomUUID(),
      contact_id: LEAD,
      provider: "meet",
      call_kind: "intro",
      purpose: "fallback",
      appointment_id: "appt-c3",
    });
    return String((out.room as Row).id);
  }
  const readyEvent = (id: string) => rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: {} });
  const tick = (id: string) => rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } });
  const linkLease = () => w.db.t("cockpit_sales_room_events").find(e => String(e.dedupe_key).startsWith("link.send:")) as Row | undefined;
  return { ...w, io, rooms, audits, rows, delivered, convo, modes, gate, room, whatsappDelivered, workerOpens, make, readyEvent, tick, drain, linkLease };
}

function hold(): { p: Promise<void>; open: () => void } {
  let open: () => void = () => undefined;
  const p = new Promise<void>(r => {
    open = r;
  });
  return { p, open };
}

describe("link-lease-runs-out-mid-cascade: the minute's re-ask after the link's lease ran out", () => {
  test("control (chaos round 4, held): the re-ask a minute after the claim finds the lease held and sends nothing", async () => {
    const w = world();
    const id = await w.make();
    await w.workerOpens(id);
    w.modes.text = ["refused_429", "ok"];
    const tpl = hold();
    w.gate.template = tpl.p;
    void w.readyEvent(id);
    await w.drain();
    expect(w.rows.size).toBe(1); // the text, refused; the template still in its setup
    w.clock.now += 61 * S;
    await w.tick(id);
    await w.drain();
    w.gate.template = null;
    tpl.open();
    await w.drain();
    expect(w.whatsappDelivered()).toHaveLength(1);
  });

  test("link-lease-runs-out-mid-cascade: HighLevel refuses the free text (429) after its slow reads, and the template's setup reads (HighLevel's contact read, the database) take the first run past its 90 s lease; the re-ask two minutes after the claim must not send a second link beside the template still on its way", async () => {
    const w = world();
    const id = await w.make();
    await w.workerOpens(id);
    w.modes.text = ["refused_429", "ok"];
    const tpl = hold();
    w.gate.template = tpl.p;
    void w.readyEvent(id);
    await w.drain();
    expect(w.rows.size).toBe(1);
    // The first minute's re-ask: the lease is held (control above).
    w.clock.now += 61 * S;
    await w.tick(id);
    await w.drain();
    expect(w.delivered).toHaveLength(0);
    // The next minute's re-ask, 121 s after the claim: the first run (still
    // in the template's setup) took its lease for SEND_BUDGET_MS, 90 s.
    w.clock.now += 60 * S;
    await w.tick(id);
    await w.drain();
    // The first run's template now goes on.
    w.gate.template = null;
    tpl.open();
    await w.drain();
    // Today: the re-ask reads only a refused text, plans afresh, sends the
    // text on its next request id, and the template goes as well.
    expect(w.whatsappDelivered().map(d => d.lane)).toHaveLength(1);
  });

  test("link-lease-runs-out-mid-cascade (email step): both WhatsApp lanes refused, the email's setup reads slow; the re-ask after the lease ran out must not send the free text again while the email goes", async () => {
    const w = world();
    const id = await w.make();
    await w.workerOpens(id);
    w.modes.text = ["refused_429", "ok"];
    w.modes.template = ["refused_429"];
    const mail = hold();
    w.gate.email = mail.p;
    void w.readyEvent(id);
    await w.drain();
    expect(w.rows.size).toBe(2); // text and template refused; the email in its setup
    w.clock.now += 61 * S;
    await w.tick(id);
    await w.drain();
    w.clock.now += 60 * S;
    await w.tick(id);
    await w.drain();
    w.gate.email = null;
    mail.open();
    await w.drain();
    // One link to the lead: either the email or a retried text, never both.
    expect(w.delivered).toHaveLength(1);
  });

  test("the lease of the run that took over is not released by the run whose lease ran out", async () => {
    const w = world();
    const id = await w.make();
    await w.workerOpens(id);
    w.modes.text = ["refused_429", "ok"];
    const tpl = hold();
    w.gate.template = tpl.p;
    void w.readyEvent(id);
    await w.drain();
    // Past the link's lease (fix round 3: renewed for LINK_STEP_S, 180 s,
    // before each step; one SEND_BUDGET_MS, 90 s, when this was found), so
    // the re-ask does take it over from the first run, still stuck in its step.
    w.clock.now += 181 * S;
    // The re-ask that takes the lease over is itself slow (its text's setup reads).
    const txt = hold();
    w.gate.text = txt.p;
    void w.tick(id);
    await w.drain();
    const held = w.linkLease();
    expect(held?.lease_until ?? null).not.toBeNull();
    // The first run's template ends (it goes); its finally releases the lease.
    w.gate.template = null;
    tpl.open();
    await w.drain();
    // The re-ask still sending holds its lease until it is done.
    expect(w.linkLease()?.lease_until ?? null).not.toBeNull();
    w.gate.text = null;
    txt.open();
    await w.drain();
  });
});
