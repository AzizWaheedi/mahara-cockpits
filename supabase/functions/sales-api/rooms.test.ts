// bun test supabase/functions/sales-api/rooms.test.ts
// rooms.ts against testfakes.ts: every action, the room.event kinds, the
// message service, the count, and the two defects the merge found (the
// lead's link never sent; booked intros never settled).
import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { ApiRefusal } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON, LANE_COPY, ROOM_COPY, ROOM_VIEW_KEYS } from "./roomlogic.ts";
import { eventText, LIVE_OFF, leadText, makeRooms, OFFER_GONE, type RoomDeps } from "./rooms.ts";
import { fakeWorld, fakeUuid } from "./testfakes.ts";

type Row = Record<string, unknown>;

const S = 1000;
const MIN = 60 * S;
const CLOSER = "closer@maharamedia.com";
const SETTER = "setter@maharamedia.com";
const LEAD = "VjPfR4Cc1Y0OFvaqeor5";
const OTHER_LEAD = "otherLead0000000001";
const ZOOM_URL = "https://us06web.zoom.us/j/81234567890?pwd=abc";
const MEET_URL = "https://meet.google.com/abc-defg-hij";
const START_URL = "https://us06web.zoom.us/s/81234567890?zak=HOSTTOKEN";

const closer: Who = { signed_in: true, seat: true, manager: false, email: CLOSER, name: "Sami Closer", role: "closer", ghl_user_id: "G-closer" };
const setter: Who = { signed_in: true, seat: true, manager: false, email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter" };
const boss: Who = { signed_in: true, seat: true, manager: true, email: "boss@maharamedia.com", name: "Boss", role: "manager", ghl_user_id: "G-boss" };
const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk" };

const ROOMS_ON = {
  ...DEFAULT_ROOMS_JSON,
  enabled: true,
  providers: { zoom: true, meet: true },
  send: { whatsapp_text: true, whatsapp_template: true, email: true },
  fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: "any" },
};
const GUARD_OPEN = { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z", templates_per_day: 250 };

interface Opts {
  rooms?: Row;
  live?: Row;
  guard?: Row;
  contact?: Row | null;
}

function setup(o: Opts = {}) {
  const w = fakeWorld();
  const audits: Row[] = [];
  const marks: Row[] = [];
  const texts: Row[] = [];
  const templates: Row[] = [];
  const knobs = {
    text: (_b: Row): Row | Error => ({ id: fakeUuid(), state: "sent", provider_status: "sent" }),
    template: (_o: Row): Row | Error => ({ id: fakeUuid(), state: "sent", provider_status: "sent" }),
    mark: (_s: string): Row | Error => ({}),
    upcoming: null as { id: string; start: number } | null,
  };
  const seenRequest = new Map<string, Row>();
  w.db.seed("cockpit_sales_settings", [
    { key: "rooms", value: { ...ROOMS_ON, ...(o.rooms ?? {}) } },
    { key: "live", value: { enabled: false, standby: true, ...(o.live ?? {}) } },
    { key: "whatsapp_guard", value: { ...GUARD_OPEN, ...(o.guard ?? {}) } },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [
    { email: CLOSER, name: "Sami Closer", role: "closer", ghl_user_id: "G-closer", active: true },
    { email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true },
  ]);
  w.db.seed("cockpit_sales_room_hosts", [
    { email: CLOSER, zoom_user_id: "Z-closer", zoom_status: "licensed", google_ok: true },
    { email: SETTER, zoom_user_id: null, zoom_status: "pending", google_ok: true },
  ]);
  // The lead wrote an hour ago: the WhatsApp window is open unless a test closes it.
  w.db.seed("cockpit_sales_inbox", [{ conversation_id: "c0", contact_id: LEAD, inbound_whatsapp_at: new Date(w.clock.now - 3_600_000).toISOString() }]);
  const contact =
    o.contact === undefined
      ? { id: LEAD, firstName: "Huda", name: "Huda Ali", phone: "+96550000000", email: "huda@example.com", tags: ["cockpit-test"], country: "KW" }
      : o.contact;
  w.routes.push((m, p) => (m === "GET" && (p === `/contacts/${LEAD}` || p === `/contacts/${OTHER_LEAD}`) && contact ? { contact: { ...contact, id: p.split("/")[2] } } : (null as unknown as Row)));
  const deps: RoomDeps = {
    io: w.io,
    audit: async (who, action, entityType, entityId, before, after, metadata) => {
      audits.push({ who: who.email, action, entityType, entityId, before, after, metadata });
    },
    markAppointment: async (who, id, status, opts) => {
      marks.push({ who: who.email, id, status, ...opts });
      const r = knobs.mark(status);
      if (r instanceof Error) throw r;
      return r;
    },
    sendText: async (who, b, opts) => {
      const again = seenRequest.get(b.request_id);
      if (again) return { message: again, repeated: true };
      texts.push({ who: who.email, ...b, ...opts });
      const r = knobs.text(b as unknown as Row);
      if (r instanceof Error) throw r;
      seenRequest.set(b.request_id, r);
      return { message: r };
    },
    sendTemplate: async (who, t) => {
      const again = seenRequest.get(t.requestId);
      if (again) return { message: again, repeated: true };
      templates.push({ who: who.email, ...t });
      const r = knobs.template(t as unknown as Row);
      if (r instanceof Error) throw r;
      seenRequest.set(t.requestId, r);
      return { message: r };
    },
    upcoming: async () => knobs.upcoming,
  };
  const rooms = makeRooms(deps);
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
  const events = (id?: string) => w.db.t("cockpit_sales_room_events").filter(e => !id || e.room_id === id);
  /** The worker: claim, store worker.ready, open the room as lc-worker does (contract v2 section 7). */
  async function workerOpens(id: string, url = MEET_URL, opts: { store?: boolean } = {}) {
    const r = room(id);
    const t = w.db.iso();
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, { method: "PATCH", body: { state: "creating", claimed_at: t, worker_run: "run-1", version: Number(r.version) + 1 } });
    if (opts.store !== false)
      await w.io.db("cockpit_sales_room_events?on_conflict=dedupe_key", {
        method: "POST",
        body: { room_id: id, kind: "worker.ready", source: "worker", dedupe_key: `worker.ready:${id}`, detail: { worker_run: "run-1" } },
        prefer: "resolution=ignore-duplicates",
      });
    const cur = room(id);
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.creating&worker_run=eq.run-1`, {
      method: "PATCH",
      body: {
        state: "open",
        join_url: url,
        provider_meeting_id: url === ZOOM_URL ? "81234567890" : `evt-${id.slice(-4)}`,
        opened_at: w.db.iso(),
        host_by: new Date(w.clock.now + 15 * MIN).toISOString(),
        ends_at: new Date(w.clock.now + 30 * MIN).toISOString(),
        version: Number(cur.version) + 1,
      },
    });
  }
  async function make(who: Who = setter, b: Row = {}): Promise<Row> {
    const out = await rooms.actions["room.create"]!(who, {
      request_id: crypto.randomUUID(),
      contact_id: LEAD,
      provider: "meet",
      call_kind: "intro",
      purpose: "manual",
      ...b,
    });
    return out.room as Row;
  }
  return { ...w, rooms, audits, marks, texts, templates, knobs, room, events, workerOpens, make };
}

async function refused(p: Promise<unknown>): Promise<ApiRefusal> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ApiRefusal) return e;
    throw e;
  }
  throw new Error("expected a refusal");
}

// ---------------------------------------------------------------------------

describe("room.create", () => {
  test("refused with a code and a sentence while rooms are off; nothing is written", async () => {
    const w = setup({ rooms: { enabled: false } });
    const r = await refused(w.make());
    expect([r.status, r.extra.code, r.message]).toEqual([409, "disabled", LANE_COPY.disabled]);
    expect(w.db.t("cockpit_sales_rooms")).toHaveLength(0);
  });

  test("makes a requested room, leaves the code to the database, waits 15 s for the worker, audits it", async () => {
    const w = setup();
    const t0 = w.clock.now;
    const v = await w.make();
    expect(v.state).toBe("requested");
    expect(String(v.code)).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(w.clock.now - t0).toBeGreaterThanOrEqual(15 * S);
    const insert = w.db.calls.find(c => c.method === "POST" && c.path === "cockpit_sales_rooms");
    expect(insert?.body).not.toHaveProperty("code");
    // A column a later migration adds is never named while it is null.
    expect(insert?.body).not.toHaveProperty("link_claimed_at");
    expect(w.audits.map(a => a.action)).toContain("room.create");
    expect(Object.keys(v).sort()).toEqual([...ROOM_VIEW_KEYS].sort());
    expect(JSON.stringify(v)).not.toContain("start_url");
  });

  test("the same request id twice is one room (a double press, a retry)", async () => {
    const w = setup();
    const request_id = crypto.randomUUID();
    const a = await w.rooms.actions["room.create"]!(setter, { request_id, contact_id: LEAD, provider: "meet", call_kind: "intro", purpose: "manual" });
    const b = await w.rooms.actions["room.create"]!(setter, { request_id, contact_id: LEAD, provider: "meet", call_kind: "intro", purpose: "manual" });
    expect((a.room as Row).id).toBe((b.room as Row).id);
    expect(w.db.t("cockpit_sales_rooms")).toHaveLength(1);
  });

  test("returns the room open when the worker opens it inside the wait", async () => {
    const w = setup();
    const before = w.db.t("cockpit_sales_rooms").length;
    const p = w.make();
    // The worker acts while room.create polls.
    const origSleep = w.io.sleep;
    let opened = false;
    w.io.sleep = async ms => {
      await origSleep(ms);
      const r = w.db.t("cockpit_sales_rooms")[before];
      if (r && !opened) {
        opened = true;
        await w.workerOpens(String(r.id));
      }
    };
    const v = await p;
    expect(v.state).toBe("open");
    expect(v.join_url).toBe(MEET_URL);
  });

  test("the lead checks come first: not a test contact while testing, a client, unread HighLevel", async () => {
    const notTest = setup({ contact: { firstName: "Ali", tags: ["roas-qualified"], phone: "+96551111111" } });
    expect((await refused(notTest.make(setter, { contact_id: OTHER_LEAD }))).extra.code).toBe("test_only");
    const client = setup({ rooms: { test_only: false }, contact: { firstName: "Ali", tags: ["client"] } });
    expect((await refused(client.make())).extra.code).toBe("client");
    const unread = setup({ contact: null });
    const r = await refused(unread.make());
    expect([r.status, r.extra.code, r.extra.retry]).toEqual([503, "contact_unread", true]);
  });

  test("one room per lead and per host: the database's index names the refusal", async () => {
    const w = setup();
    await w.make();
    const r = await refused(w.make(closer, { provider: "zoom", call_kind: "demo" }));
    expect([r.extra.code, r.message]).toEqual(["lead_has_room", ROOM_COPY.refusals.lead_has_room]);
    const host = await refused(w.make(setter, { contact_id: OTHER_LEAD }));
    expect(host.extra.code).toBe("host_has_room");
  });

  test("a handover room only for a lead this seat holds live; a booked room only through room.wrap", async () => {
    const w = setup();
    const r = await refused(w.make(closer, { purpose: "handover", provider: "zoom" }));
    expect(r.status).toBe(409);
    expect((await refused(w.make(closer, { purpose: "booked" }))).extra.code).toBe("bad_input");
  });

  test("a pending Zoom seat is refused with the Meet advice; a request id that is not a UUID is refused", async () => {
    const w = setup();
    const r = await refused(w.make(setter, { provider: "zoom" }));
    expect([r.extra.code, r.message]).toEqual(["zoom_pending", ROOM_COPY.refusals.zoom_pending]);
    const bad = await refused(w.rooms.actions["room.create"]!(setter, { request_id: "x", contact_id: LEAD, provider: "meet", call_kind: "intro", purpose: "manual" }));
    expect(bad.status).toBe(400);
  });
});

describe("defect 1: worker.ready on a room the worker opened sends the lead's link", () => {
  test("the worker opens, room.event claims the link with the missing deadline, and the link goes once", async () => {
    const w = setup();
    const v = await w.make();
    const id = String(v.id);
    await w.workerOpens(id);
    expect(w.room(id).opened_at).toBeTruthy();
    const out = await w.rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: { worker_run: "run-1" } });
    expect(out.handled).toBe(true);
    const r = w.room(id);
    expect(r.link_claimed_at).toBeTruthy();
    expect(r.lead_by).toBeTruthy();
    await w.flush();
    expect(w.texts).toHaveLength(1);
    expect(w.texts[0]).toMatchObject({ who: SETTER, contact_id: LEAD, channel: "whatsapp", source: "room", readBackMs: 20 * S });
    expect(String(w.texts[0]?.body)).toContain(MEET_URL);
    const after = w.room(id);
    expect(after.link_sent_at).toBeTruthy();
    expect(after.link_channels).toEqual(["whatsapp_text"]);
    expect(Object.keys(after.link_message_ids as Row)).toEqual(["whatsapp_text"]);
    expect(w.events(id).find(e => e.kind === "worker.ready")?.handled_at).toBeTruthy();
    expect(w.events(id).find(e => e.kind === "link.sent")?.text).toBe("Link sent on WhatsApp.");
    // The room's link write leaves its own audit row (the send's own row is index.ts's).
    expect(w.audits.filter(a => a.action === "room.link").map(a => [a.entityId, (a.after as Row).link_channels])).toEqual([
      [id, ["whatsapp_text"]],
    ]);
    // A second call (the sweep's replay of a lost answer) finds the event handled and sends nothing.
    const again = await w.rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: {} });
    await w.flush();
    expect(again.handled).toBe(false);
    expect(w.texts).toHaveLength(1);
  });

  test("two worker.ready calls at once: one lease wins, one message", async () => {
    const w = setup();
    const id = String((await w.make()).id);
    await w.workerOpens(id);
    const outs = await Promise.all([
      w.rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: {} }),
      w.rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: {} }),
    ]);
    await w.flush();
    expect(outs.filter(o => o.handled).length).toBe(1);
    expect(w.texts).toHaveLength(1);
  });

  test("while the room is still creating, the event is left for the sweep (lease released, not handled)", async () => {
    const w = setup();
    const id = String((await w.make()).id);
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}`, { method: "PATCH", body: { state: "creating", version: 2 } });
    await w.io.db("cockpit_sales_room_events", { method: "POST", body: { room_id: id, kind: "worker.ready", source: "worker", dedupe_key: `worker.ready:${id}` } });
    const out = await w.rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: {} });
    expect(out.handled).toBe(false);
    const ev = w.events(id).find(e => e.kind === "worker.ready") as Row;
    expect([ev.handled_at, ev.lease_until]).toEqual([null, null]);
  });

  test("a final room: handled, nothing sent; a run that differs is recorded, not refused", async () => {
    const w = setup();
    const id = String((await w.make()).id);
    await w.workerOpens(id);
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}`, { method: "PATCH", body: { state: "cancelled", result: "cancelled", ended_at: w.db.iso() } });
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}`, { method: "PATCH", body: { worker_run: "run-2" } });
    const out = await w.rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: { worker_run: "run-1" } });
    await w.flush();
    expect(out.handled).toBe(true);
    expect(w.texts).toHaveLength(0);
    expect((w.events(id).find(e => e.kind === "worker.ready")?.detail as Row | undefined)?.worker_run_mismatch).toBeTruthy();
  });

  test("worker.failed is handled only once the room is failed", async () => {
    const w = setup();
    const id = String((await w.make()).id);
    await w.io.db("cockpit_sales_room_events", { method: "POST", body: { room_id: id, kind: "worker.failed", source: "worker", dedupe_key: `worker.failed:${id}` } });
    expect((await w.rooms.desk["room.event"]!(desk, { kind: "worker.failed", room_id: id, payload: {} })).handled).toBe(false);
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}`, { method: "PATCH", body: { state: "failed", error: "Zoom said no. Try Meet.", result: "failed" } });
    expect((await w.rooms.desk["room.event"]!(desk, { kind: "worker.failed", room_id: id, payload: {} })).handled).toBe(true);
    expect(w.events(id).find(e => e.kind === "worker.failed")?.text).toBe("The room could not be made.");
  });
});

describe("the message service", () => {
  test("a free text HighLevel refuses (the window closed meanwhile) falls to the template, signed as the host, with the room code", async () => {
    const w = setup({ rooms: { short_link: true } });
    w.knobs.text = b => (b.channel === "whatsapp" ? new ApiRefusal("WhatsApp only takes a free message within 24 hours.", 409) : { id: "m-e", state: "sent" });
    const id = String((await w.make()).id);
    await w.workerOpens(id);
    w.db.seed("cockpit_sales_wa_templates", [{ key: "call_link_ar", active: true, workflow_id: "c5467d7f-0692-4fef-b0c0-f286011db66b" }]);
    await w.rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: {} });
    await w.flush();
    expect(w.templates).toHaveLength(1);
    expect(w.templates[0]).toMatchObject({ key: "call_link_ar", source: "room", signAs: SETTER, buttonVariable: { join_code: w.room(id).code } });
    expect(w.room(id).link_channels).toEqual(["whatsapp_template"]);
  });

  test("a template not seen in 20 s is followed by email and link_unconfirmed_at", async () => {
    const w = setup({ rooms: { send: { whatsapp_text: false, whatsapp_template: true, email: true }, short_link: true } });
    w.knobs.template = () => ({ id: "m-t", state: "sent", provider_status: "enrolled" });
    w.db.seed("cockpit_sales_wa_templates", [{ key: "call_link_ar", active: true, workflow_id: "wf" }]);
    const id = String((await w.make()).id);
    await w.workerOpens(id);
    await w.rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: {} });
    await w.flush();
    const r = w.room(id);
    expect(r.link_channels).toEqual(["whatsapp_template", "email"]);
    expect(r.link_unconfirmed_at).toBeTruthy();
    expect(w.texts[0]).toMatchObject({ channel: "email" });
    expect(String(w.texts[0]?.body)).toContain(`https://call.maharamedia.com/${r.code}`);
  });

  test("nothing can go: the reason is saved for the panel and nothing is sent", async () => {
    const w = setup({ rooms: { send: { whatsapp_text: false, whatsapp_template: false, email: false } } });
    const id = String((await w.make()).id);
    await w.workerOpens(id);
    await w.rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: {} });
    await w.flush();
    expect(w.texts.length + w.templates.length).toBe(0);
    expect(w.room(id).refusal).toBe(`${LANE_COPY.why_wa_off.charAt(0).toUpperCase()}${LANE_COPY.why_wa_off.slice(1)} and ${LANE_COPY.why_email_off}.`);
    expect(w.room(id).link_sent_at).toBeUndefined();
    expect(w.audits.filter(a => a.action === "room.link.not_sent").map(a => a.entityId)).toEqual([id]);
  });

  test("every channel fails: the failures are saved, and the tick's re-ask a minute later sends once with the same request ids", async () => {
    const w = setup({ rooms: { send: { whatsapp_text: true, whatsapp_template: false, email: false } } });
    let fail = true;
    // A refusal that is certain (HighLevel said no): the cascade goes on. A lost answer or a 5xx is not certain (stress_chaos_rooms).
    w.knobs.text = () => (fail ? new ApiRefusal("HighLevel said 400: the number is not on WhatsApp", 400) : { id: "m-ok", state: "sent" });
    const id = String((await w.make()).id);
    await w.workerOpens(id);
    await w.rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: {} });
    await w.flush();
    expect(String(w.room(id).refusal)).toContain("the number is not on WhatsApp");
    fail = false;
    w.clock.now += 61 * S;
    const t = await w.rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } });
    await w.flush();
    expect((t.results as Row[])[0]?.effects).toEqual(["send_link"]);
    expect(w.room(id).link_sent_at).toBeTruthy();
    expect(w.room(id).refusal).toBeNull();
    const ids = w.texts.map(x => x.request_id);
    expect(new Set(ids).size).toBe(1);
  });

  test("a client gets nothing, and the panel says why", async () => {
    const w = setup({ contact: { firstName: "Ali", tags: ["cockpit-test"], phone: "+96551111111" } });
    const id = String((await w.make()).id);
    await w.workerOpens(id);
    w.routes.unshift((m, p) => (m === "GET" && p === `/contacts/${LEAD}` ? { contact: { firstName: "Ali", tags: ["cockpit-test", "client"] } } : (null as unknown as Row)));
    await w.rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: {} });
    await w.flush();
    expect(w.texts).toHaveLength(0);
    expect(w.room(id).refusal).toBe(ROOM_COPY.refusals.client);
  });

  test("the lead's words per purpose say Mahara Media and carry the link", () => {
    const v = { first_name: "Huda", rep: "Sami", link: "https://call.maharamedia.com/K7Q2MX" };
    const fb = leadText({ purpose: "fallback", provider: "zoom", appointment_id: "a1" }, "whatsapp_text", v);
    expect(fb.body).toContain("Mahara Media");
    expect(fb.body).toContain(v.link);
    const ho = leadText({ purpose: "handover", provider: "meet", appointment_id: null }, "email", v);
    expect(ho.subject).toBe("Your call with Sami is ready");
    expect(leadText({ purpose: "manual", provider: "meet", appointment_id: null }, "whatsapp_text", { ...v, first_name: "" }).body).toStartWith("Hi there, your call");
  });

  test("room.send: the host's Also send by email, keyed on the press's request id", async () => {
    const w = setup();
    const id = String((await w.make()).id);
    await w.workerOpens(id);
    const request_id = crypto.randomUUID();
    await w.rooms.actions["room.send"]!(setter, { room_id: id, request_id, channel: "email" });
    await w.rooms.actions["room.send"]!(setter, { room_id: id, request_id, channel: "email" });
    expect(w.texts.filter(t => t.channel === "email")).toHaveLength(1);
    expect(w.room(id).link_channels).toContain("email");
    const other = await refused(w.rooms.actions["room.send"]!(closer, { room_id: id, request_id: crypto.randomUUID(), channel: "email" }));
    expect([other.status, other.extra.code, other.message]).toEqual([403, "not_host", "This room belongs to Tara."]);
  });
});

describe("presses: room.mark, room.end, room.open, room.status", () => {
  async function openRoom(w: ReturnType<typeof setup>, who: Who = setter, contact = LEAD) {
    const id = String((await w.make(who, { contact_id: contact })).id);
    await w.workerOpens(id);
    await w.rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: {} });
    await w.flush();
    return id;
  }

  test("I'm in, then The lead is in: each moves the version once, with an audit row and a timeline line", async () => {
    const w = setup();
    const id = await openRoom(w);
    const v1 = Number(w.room(id).version);
    const a = await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: v1, what: "host_in" });
    expect((a.room as Row).state).toBe("host_in");
    const b = await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: v1 + 1, what: "lead_in" });
    expect((b.room as Row).state).toBe("lead_in");
    expect(w.audits.map(x => x.action)).toEqual(expect.arrayContaining(["room.mark.host_in", "room.mark.lead_in"]));
    expect(w.events(id).map(e => e.text)).toEqual(expect.arrayContaining(["Marked by hand: the host is in.", "Marked by hand: the lead is in."]));
  });

  test("a press that saw an older room is stale; another rep's press names the host", async () => {
    const w = setup();
    const id = await openRoom(w);
    const v = Number(w.room(id).version);
    const stale = await refused(w.rooms.actions["room.mark"]!(setter, { room_id: id, version: v - 1, what: "host_in" }));
    expect([stale.status, stale.extra.code, stale.message]).toEqual([409, "stale", "This changed a moment ago."]);
    const other = await refused(w.rooms.actions["room.mark"]!(closer, { room_id: id, version: v, what: "host_in" }));
    expect([other.status, other.message]).toEqual([403, "This room belongs to Tara."]);
    // A manager may.
    const m = await w.rooms.actions["room.mark"]!(boss, { room_id: id, version: v, what: "host_in" });
    expect((m.room as Row).state).toBe("host_in");
  });

  test("a guarded write another writer beat is read again: the press lands on the new row or is stale", async () => {
    const w = setup();
    const id = await openRoom(w);
    const v = Number(w.room(id).version);
    // The door's open lands between the read and the write (no version move).
    w.db.beforePatch = (table, rows) => {
      if (table === "cockpit_sales_rooms") for (const r of rows) r.first_open_at = w.db.iso();
    };
    const out = await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: v, what: "host_in" });
    expect((out.room as Row).state).toBe("host_in");
  });

  test("ending a room with the lead in it asks first; finished does not", async () => {
    const w = setup();
    const id = await openRoom(w);
    let v = Number(w.room(id).version);
    await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: v, what: "lead_in" });
    v = Number(w.room(id).version);
    const ask = await refused(w.rooms.actions["room.end"]!(setter, { room_id: id, version: v, reason: "end" }));
    expect([ask.extra.code, ask.message]).toEqual(["confirm_end", "The lead is still in this room. End it anyway?"]);
    const done = await w.rooms.actions["room.end"]!(setter, { room_id: id, version: v, reason: "end", confirm: true });
    expect((done.room as Row).state).toBe("ended");
    // A second End on the closed room is a no-op, not an error.
    const again = await w.rooms.actions["room.end"]!(setter, { room_id: id, version: v, reason: "end" });
    expect((again.room as Row).state).toBe("ended");
  });

  test("cancel while the worker has only claimed the room: one version behind is still accepted", async () => {
    const w = setup();
    const v = await w.make();
    const id = String(v.id);
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}`, { method: "PATCH", body: { state: "creating", version: 2 } });
    const out = await w.rooms.actions["room.end"]!(setter, { room_id: id, version: 1, reason: "cancel" });
    expect((out.room as Row).state).toBe("cancelled");
  });

  test("I can't let them in: the room closes admit_blocked and the replacement is made on the other provider in the same request", async () => {
    const w = setup();
    const id = await openRoom(w, closer);
    const v = Number(w.room(id).version);
    const out = await w.rooms.actions["room.end"]!(closer, { room_id: id, version: v, reason: "admit_blocked" });
    expect((out.room as Row).result).toBe("admit_blocked");
    expect((out.replacement as Row).provider).toBe("zoom");
    expect((out.replacement as Row).contact_id).toBe(LEAD);
    // A setter whose Zoom seat is pending gets the refusal sentence instead.
    const w2 = setup();
    const id2 = await openRoom(w2);
    const out2 = await w2.rooms.actions["room.end"]!(setter, { room_id: id2, version: Number(w2.room(id2).version), reason: "admit_blocked" });
    expect(out2.replacement_refusal).toBe(ROOM_COPY.refusals.zoom_pending);
  });

  test("room.open: the start link to the host only; Meet's host gets the meeting link; never before the room is made", async () => {
    const w = setup();
    const id = String((await w.make(closer, { provider: "zoom", call_kind: "demo" })).id);
    expect((await refused(w.rooms.actions["room.open"]!(closer, { room_id: id }))).extra.code).toBe("too_early");
    await w.workerOpens(id, ZOOM_URL);
    w.db.seed("cockpit_sales_room_secrets", [{ room_id: id, start_url: START_URL, expires_at: null }]);
    expect((await w.rooms.actions["room.open"]!(closer, { room_id: id })).start_url).toBe(START_URL);
    const not = await refused(w.rooms.actions["room.open"]!(setter, { room_id: id }));
    expect([not.status, not.message]).toEqual([403, "This room belongs to Sami."]);
    const meet = await openRoom(w, setter, OTHER_LEAD);
    expect((await w.rooms.actions["room.open"]!(setter, { room_id: meet })).start_url).toBe(MEET_URL);
    expect(JSON.stringify(w.audits)).not.toContain("HOSTTOKEN");
  });

  test("room.status: the last 20 events, each with words (a stored event without text gets one), health, now", async () => {
    const w = setup();
    const id = await openRoom(w);
    w.db.seed("cockpit_sales_worker_status", [{ worker: "sales-desk", job: "rooms", ok: true, at: w.db.iso() }]);
    const out = await w.rooms.actions["room.status"]!(closer, { room_id: id });
    const events = out.events as Row[];
    expect(events.length).toBeGreaterThan(0);
    expect(events.every(e => typeof e.text === "string" && (e.text as string).length > 0)).toBe(true);
    expect(events.find(e => e.kind === "worker.ready")?.text).toBe("The room was made.");
    expect((out.health as Row).worker_ok).toBe(true);
    expect((out.health as Row).rooms_today).toBe(1);
    expect(out.now).toBe(w.db.iso());
  });

  test("health says so when the worker's row cannot be read, and a count it could not read is null, never 0", async () => {
    const w = setup();
    const id = await openRoom(w);
    w.db.faults.push({ prefix: "cockpit_sales_worker_status", error: new Error("timeout"), times: 1 });
    w.db.faults.push({ prefix: "cockpit_sales_rooms?requested_at", error: new Error("timeout"), times: 2 });
    const out = await w.rooms.actions["room.status"]!(closer, { room_id: id });
    expect(out.health).toMatchObject({ worker_ok: false, rooms_today: null, failed_today: null });
    expect(String((out.health as Row).line)).toContain("could not be read");
  });

  test("eventText never shows a raw kind or a host link", () => {
    expect(eventText({ kind: "zoom.meeting.something_new" })).toBe("Zoom sent an event for this room.");
    expect(eventText({ kind: "x", text: "Bearer abc.def" })).toBe("Bearer [key]");
  });
});

describe("defect 2: booked intros are settled as no-shows (room.event sweep.settle)", () => {
  async function bookedExpired(w: ReturnType<typeof setup>, over: Row = {}) {
    const start = w.clock.now - 25 * MIN;
    w.db.seed("cockpit_sales_appointments", [{ appointment_id: "appt-1", contact_id: LEAD, call_type: "intro", start_at: new Date(start).toISOString(), status: "confirmed", assigned_user_id: "G-setter" }]);
    const id = fakeUuid();
    // A Zoom room whose join events were all read: the evidence a no-show needs (Meet sends no join signal).
    w.db.seed("cockpit_sales_rooms", [
      {
        id,
        request_id: fakeUuid(),
        contact_id: LEAD,
        purpose: "booked",
        call_kind: "intro",
        provider: "zoom",
        host_email: SETTER,
        made_by: SETTER,
        appointment_id: "appt-1",
        appointment_start_at: new Date(start).toISOString(),
        // Asked for at the intro's time, and its link went (round 3: a room
        // outside the intro's window, or whose link never went, is no evidence).
        requested_at: new Date(start - 2 * MIN).toISOString(),
        link_sent_at: new Date(start - MIN).toISOString(),
        state: "expired",
        result: "no_join",
        ended_at: w.db.iso(),
        join_url: "https://us06web.zoom.us/j/81234567890?pwd=abc",
        ...over,
      },
    ]);
    // Zoom reported the meeting (its start, read by room.event), so its silence about the lead is evidence.
    w.db.seed("cockpit_sales_room_events", [
      { room_id: id, kind: "zoom.meeting.started", source: "zoom", dedupe_key: `zoom:meeting.started:${id}`, at: new Date(start).toISOString(), handled_at: new Date(start).toISOString() },
      { room_id: id, kind: "sweep.settle", source: "settle", dedupe_key: `sweep.settle:${id}` },
    ]);
    return id;
  }

  test("an expired booked intro becomes a no-show through the dialer's mark, once", async () => {
    const w = setup();
    const id = await bookedExpired(w);
    const out = await w.rooms.desk["room.event"]!(desk, { kind: "sweep.settle", payload: { room_ids: [id] } });
    expect(out.handled).toBe(1);
    expect(w.marks).toEqual([expect.objectContaining({ who: SETTER, id: "appt-1", status: "noshow", anyRep: true })]);
    expect(w.room(id).settled_mark).toBe("noshow");
    expect(w.events(id).find(e => e.kind === "sweep.settle")?.handled_at).toBeTruthy();
    const again = await w.rooms.desk["room.event"]!(desk, { kind: "sweep.settle", payload: { room_ids: [id] } });
    expect(again.handled).toBe(0);
    expect(w.marks).toHaveLength(1);
  });

  test("a fallback room for a booked intro that closed with nobody in it is settled too", async () => {
    const w = setup();
    const id = await bookedExpired(w, { purpose: "fallback" });
    await w.rooms.desk["room.event"]!(desk, { kind: "sweep.settle", payload: { room_ids: [id] } });
    expect(w.marks.map(m => m.status)).toEqual(["noshow"]);
  });

  test("never settled: a knock that could not be let in, a call a rep already marked, a call not yet due", async () => {
    const w = setup();
    const blocked = await bookedExpired(w, { result: "admit_blocked" });
    await w.rooms.desk["room.event"]!(desk, { kind: "sweep.settle", payload: { room_ids: [blocked] } });
    expect(w.marks).toHaveLength(0);
    const w2 = setup();
    const marked = await bookedExpired(w2);
    w2.db.seed("cockpit_sales_dispositions", [{ appointment_id: "appt-1", status: "showed", superseded_at: null }]);
    const out = await w2.rooms.desk["room.event"]!(desk, { kind: "sweep.settle", payload: { room_ids: [marked] } });
    expect(w2.marks).toHaveLength(0);
    expect(((out.results as Row[])[0] as Row).skipped).toBe("the call was already marked");
    expect(w2.room(marked).settled_mark).toBe("none");
    expect(w2.audits.filter(a => a.action === "room.settle").map(a => (a.after as Row).settled_mark)).toEqual(["none"]);
  });

  test("a mark the dialer refuses is recorded and handled, never retried forever", async () => {
    const w = setup();
    const id = await bookedExpired(w);
    w.knobs.mark = () => new ApiRefusal("Your seat is not linked to your HighLevel user yet.", 403);
    const out = await w.rooms.desk["room.event"]!(desk, { kind: "sweep.settle", payload: { room_ids: [id] } });
    expect(((out.results as Row[])[0] as Row).refused).toContain("not linked");
    expect(w.events(id).find(e => e.kind === "sweep.settle")?.handled_at).toBeTruthy();
    // The no-show was not written: the room says so and a person is told which intro to mark.
    expect(w.room(id).settled_mark).toBe("none");
    expect(w.db.t("cockpit_sales_alerts").filter(a => a.dedupe_key === `room:${id}:mark_intro` && !a.resolved_at)).toHaveLength(1);
  });

  test("a database fault mid-settle releases the lease for the next sweep", async () => {
    const w = setup();
    const id = await bookedExpired(w);
    w.db.faults.push({ prefix: "cockpit_sales_appointments", error: new Error("database 503"), times: 1 });
    const out = await w.rooms.desk["room.event"]!(desk, { kind: "sweep.settle", payload: { room_ids: [id] } });
    expect(out.handled).toBe(0);
    const ev = w.events(id).find(e => e.kind === "sweep.settle") as Row;
    expect([ev.handled_at, ev.lease_until]).toEqual([null, null]);
  });

  test("the list is checked: 1 to 50 UUIDs", async () => {
    const w = setup();
    expect((await refused(w.rooms.desk["room.event"]!(desk, { kind: "sweep.settle", payload: { room_ids: [] } }))).status).toBe(400);
    expect((await refused(w.rooms.desk["room.event"]!(desk, { kind: "sweep.settle", payload: { room_ids: ["nope"] } }))).status).toBe(400);
    const many = Array.from({ length: 51 }, () => crypto.randomUUID());
    expect((await refused(w.rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: many } }))).status).toBe(400);
  });
});

describe("tick (S1: the SQL sweep owns every timer)", () => {
  test("a room past every deadline is not moved here; SQL closes it", async () => {
    const w = setup();
    const id = String((await w.make()).id);
    await w.workerOpens(id);
    w.clock.now += 2 * 3_600_000;
    const out = await w.rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } });
    expect(w.room(id).state).toBe("open");
    expect(out.handled).toBe(1);
  });

  test("a lead in a room as the host's booked call nears raises one alert", async () => {
    const w = setup();
    const id = String((await w.make()).id);
    await w.workerOpens(id);
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}`, { method: "PATCH", body: { state: "lead_in", lead_in_at: w.db.iso(), version: 4 } });
    w.db.seed("cockpit_sales_appointments", [{ appointment_id: "x", assigned_user_id: "G-setter", start_at: new Date(w.clock.now + 5 * MIN).toISOString(), status: "confirmed", call_type: "intro" }]);
    await w.rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } });
    await w.rooms.desk["room.event"]!(desk, { kind: "tick", payload: { room_ids: [id] } });
    await w.flush();
    expect(w.db.t("cockpit_sales_alerts").filter(a => a.kind === "room_booked_guard")).toHaveLength(1);
  });
});

describe("Zoom events and the replay", () => {
  async function zoomRoom(w: ReturnType<typeof setup>) {
    const id = String((await w.make(closer, { provider: "zoom", call_kind: "demo" })).id);
    await w.workerOpens(id, ZOOM_URL);
    await w.rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: {} });
    await w.flush();
    return id;
  }
  function storeZoom(w: ReturnType<typeof setup>, event: string, participant: Row | null, roomId: string | null = null) {
    const id = fakeUuid();
    w.db.seed("cockpit_sales_room_events", [
      {
        id,
        room_id: roomId,
        kind: `zoom.${event}`,
        source: "zoom",
        dedupe_key: `zoom:${event}:${id}`,
        detail: { event, event_ts: w.clock.now, payload: { object: { id: "81234567890", host_id: "Z-closer", topic: "Mahara call X", ...(participant ? { participant } : {}) } } },
      },
    ]);
    return id;
  }

  test("the lead's join, found by meeting id, moves the room to lead_in and writes the room id on the event", async () => {
    const w = setup();
    const id = await zoomRoom(w);
    const ev = storeZoom(w, "meeting.participant_joined", { user_name: "Huda", email: "huda@example.com", join_time: new Date(w.clock.now).toISOString() });
    const out = await w.rooms.desk["room.event"]!(desk, { kind: "zoom.meeting.participant_joined", event_id: ev, room_id: null, payload: { forged: true } });
    expect(out.handled).toBe(true);
    expect(w.room(id).state).toBe("lead_in");
    const stored = w.db.t("cockpit_sales_room_events").find(e => e.id === ev) as Row;
    expect([stored.room_id, Boolean(stored.handled_at)]).toEqual([id, true]);
  });

  test("staff joining changes nothing; the host's own join is host_in", async () => {
    const w = setup();
    const id = await zoomRoom(w);
    const staff = storeZoom(w, "meeting.participant_joined", { email: SETTER, user_name: "Tara" }, id);
    expect((await w.rooms.desk["room.event"]!(desk, { kind: "zoom.meeting.participant_joined", event_id: staff, payload: {} })).skipped).toBe("staff joined");
    const host = storeZoom(w, "meeting.participant_joined", { id: "Z-closer", user_name: "Sami" }, id);
    await w.rooms.desk["room.event"]!(desk, { kind: "zoom.meeting.participant_joined", event_id: host, payload: {} });
    expect(w.room(id).state).toBe("host_in");
  });

  test("an early event (the room is still being made) is left for the replay, with retry", async () => {
    const w = setup();
    const id = String((await w.make(closer, { provider: "zoom", call_kind: "demo" })).id);
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}`, { method: "PATCH", body: { state: "creating", version: 2 } });
    const ev = storeZoom(w, "meeting.participant_joined", { email: "huda@example.com" }, id);
    const r = await refused(w.rooms.desk["room.event"]!(desk, { kind: "zoom.meeting.participant_joined", event_id: ev, payload: {} }));
    expect([r.extra.code, r.extra.retry]).toEqual(["too_early", true]);
    const stored = w.db.t("cockpit_sales_room_events").find(e => e.id === ev) as Row;
    expect([stored.handled_at, stored.lease_until]).toEqual([null, null]);
  });

  test("sweep.replay dispatches each stored event by its kind and skips one already handled or held", async () => {
    const w = setup();
    const id = await zoomRoom(w);
    const join = storeZoom(w, "meeting.participant_joined", { email: "huda@example.com" }, id);
    const held = storeZoom(w, "meeting.participant_left", { email: "huda@example.com" }, id);
    (w.db.t("cockpit_sales_room_events").find(e => e.id === held) as Row).lease_until = new Date(w.clock.now + 30 * S).toISOString();
    const out = await w.rooms.desk["room.event"]!(desk, { kind: "sweep.replay", payload: { event_ids: [join, held] } });
    expect(out.handled).toBe(1);
    expect(w.room(id).state).toBe("lead_in");
    expect(((out.results as Row[])[1] as Row).skipped).toBe("handled or held");
  });

  test("an event for no cockpit room is handled, never retried", async () => {
    const w = setup();
    const ev = storeZoom(w, "meeting.started", null);
    (w.db.t("cockpit_sales_room_events").find(e => e.id === ev) as Row).detail = { event: "meeting.started", payload: { object: { id: "999", topic: "Webinar" } } };
    const out = await w.rooms.desk["room.event"]!(desk, { kind: "zoom.meeting.started", event_id: ev, payload: {} });
    expect([out.handled, out.skipped]).toEqual([true, "no room"]);
  });

  test("an unknown kind is refused", async () => {
    const w = setup();
    expect((await refused(w.rooms.desk["room.event"]!(desk, { kind: "slack.press", payload: {} }))).extra.code).toBe("bad_input");
  });
});

describe("the live booking (count_on_join) and That was not the lead", () => {
  test("a test contact joining is booked only on the test calendar, quietly marked shown, and the undo deletes it", async () => {
    const w = setup({ rooms: { count_on_join: true, test_calendar_id: "TESTCAL" } });
    const posts: Row[] = [];
    w.routes.push((m, p, body) => {
      if (m === "POST" && p === "/calendars/events/appointments") {
        posts.push(body as Row);
        return { id: "live-appt-1" };
      }
      if (m === "PUT" || m === "DELETE") return { ok: true };
      return null as unknown as Row;
    });
    const id = String((await w.make()).id);
    await w.workerOpens(id);
    const v = Number(w.room(id).version);
    await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: v, what: "lead_in" });
    await w.flush();
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ calendarId: "TESTCAL", contactId: LEAD, toNotify: false });
    expect(w.ghlCalls.find(c => c.method === "PUT")?.body).toEqual({ appointmentStatus: "showed", toNotify: false });
    expect([w.room(id).count_result, w.room(id).count_appointment_id]).toEqual(["booked", "live-appt-1"]);
    // That was not the lead, within 5 minutes: the booking is deleted, never marked invalid.
    const v2 = Number(w.room(id).version);
    await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: v2, what: "not_lead" });
    await w.flush();
    expect(w.ghlCalls.some(c => c.method === "DELETE" && c.path === "/calendars/events/live-appt-1")).toBe(true);
    expect(w.room(id).count_result).toBe("undone");
    expect(JSON.stringify(w.ghlCalls)).not.toContain("invalid");
  });

  test("with count_on_join off nothing is booked", async () => {
    const w = setup();
    const id = String((await w.make()).id);
    await w.workerOpens(id);
    await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "lead_in" });
    await w.flush();
    expect(w.ghlCalls.filter(c => c.method !== "GET")).toHaveLength(0);
    expect(w.room(id).count_claimed_at).toBeUndefined();
  });

  test("a test contact with no test calendar is never booked anywhere", async () => {
    const w = setup({ rooms: { count_on_join: true, test_calendar_id: null } });
    const id = String((await w.make()).id);
    await w.workerOpens(id);
    await w.rooms.actions["room.mark"]!(setter, { room_id: id, version: Number(w.room(id).version), what: "lead_in" });
    await w.flush();
    expect(w.ghlCalls.filter(c => c.method === "POST")).toHaveLength(0);
    expect(w.room(id).count_result).toBe("not_a_lead");
  });
});

describe("room.wrap", () => {
  function appt(w: ReturnType<typeof setup>, address: string, assigned = "G-closer", start = w.clock.now + 10 * MIN) {
    w.db.seed("cockpit_sales_appointments", [{ appointment_id: "demo-1", contact_id: LEAD, call_type: "demo", start_at: new Date(start).toISOString(), status: "confirmed", assigned_user_id: assigned }]);
    w.routes.push((m, p) =>
      m === "GET" && p === "/calendars/events/appointments/demo-1"
        ? { appointment: { id: "demo-1", contactId: LEAD, startTime: new Date(start).toISOString(), endTime: new Date(start + 45 * MIN).toISOString(), address, assignedUserId: assigned } }
        : (null as unknown as Row),
    );
  }

  test("a booked demo's own Zoom link goes in an open room with the booked deadlines; no worker, nothing sent", async () => {
    const w = setup();
    appt(w, `Join: ${ZOOM_URL}`);
    const out = await w.rooms.actions["room.wrap"]!(closer, { appointment_id: "demo-1", request_id: crypto.randomUUID() });
    const v = out.room as Row;
    expect([v.state, v.purpose, v.provider, v.join_url, v.appointment_id]).toEqual(["open", "booked", "zoom", ZOOM_URL, "demo-1"]);
    expect(v.starts_at).toBeTruthy();
    await w.flush();
    expect(w.texts.length + w.templates.length).toBe(0);
    // Another tab's wrap of the same call gets the same room.
    const again = await w.rooms.actions["room.wrap"]!(closer, { appointment_id: "demo-1", request_id: crypto.randomUUID() });
    expect((again.room as Row).id).toBe(v.id);
  });

  test("a host start link is refused, a phone call has no link, another rep's call is not theirs", async () => {
    const w = setup();
    appt(w, START_URL);
    expect((await refused(w.rooms.actions["room.wrap"]!(closer, { appointment_id: "demo-1", request_id: crypto.randomUUID() }))).extra.code).toBe("host_link");
    const phone = setup();
    appt(phone, "+965 5000 0000");
    expect((await refused(phone.rooms.actions["room.wrap"]!(closer, { appointment_id: "demo-1", request_id: crypto.randomUUID() }))).extra.code).toBe("phone_call");
    const theirs = setup();
    appt(theirs, ZOOM_URL, "G-other");
    expect((await refused(theirs.rooms.actions["room.wrap"]!(closer, { appointment_id: "demo-1", request_id: crypto.randomUUID() }))).status).toBe(403);
  });

  test("more than 30 minutes early is refused with the time it opens", async () => {
    const w = setup();
    appt(w, ZOOM_URL, "G-closer", w.clock.now + 3 * 3_600_000);
    const r = await refused(w.rooms.actions["room.wrap"]!(closer, { appointment_id: "demo-1", request_id: crypto.randomUUID() }));
    expect(r.extra.code).toBe("wrap_too_early");
  });
});

describe("live.status and live.availability", () => {
  test("live.status is a disabled refusal while rooms and live calls are both off", async () => {
    const w = setup({ rooms: { enabled: false } });
    const r = await refused(w.rooms.actions["live.status"]!(closer, {}));
    expect([r.status, r.extra.code]).toEqual([409, "disabled"]);
  });

  test("presence from the view, my rooms, no offers while live calls are off, health and the clock", async () => {
    const w = setup();
    w.db.seed("cockpit_sales_presence", [{ email: CLOSER, state: "away", until: null, room_id: null, zoom_status: "licensed", default_provider: "zoom", availability: "away", availability_reason: "missed_offer" }]);
    await w.make(closer, { provider: "zoom", call_kind: "demo" });
    const out = await w.rooms.actions["live.status"]!(closer, {});
    expect(out.me).toMatchObject({ email: CLOSER, state: "away", default_provider: "zoom", reason: "missed_offer" });
    expect((out.rooms as Row[]).length).toBe(1);
    expect([out.offers, out.live_enabled, out.standby_error]).toEqual([[], false, null]);
    expect(out.now).toBe(w.db.iso());
  });

  test("the view's own reason, booked_at and booked_kind win over the stand-in reads (S5)", async () => {
    const w = setup();
    w.db.seed("cockpit_sales_presence", [
      {
        email: CLOSER,
        state: "available",
        until: w.db.iso(),
        room_id: null,
        zoom_status: "licensed",
        default_provider: "zoom",
        why: "available",
        reason: "booked_call_soon",
        booked_at: "2026-10-03T12:00:00.000Z",
        booked_kind: "demo",
        availability: "available",
        availability_reason: "missed_offer",
      },
    ]);
    const out = await w.rooms.actions["live.status"]!(closer, {});
    expect(out.me).toMatchObject({ reason: "booked_call_soon", booked_at: "2026-10-03T12:00:00.000Z", booked_kind: "demo" });
    w.db.t("cockpit_sales_presence").splice(0);
    w.db.seed("cockpit_sales_presence", [
      { email: CLOSER, state: "away", until: null, room_id: null, zoom_status: null, default_provider: "zoom", reason: null, booked_at: "2026-10-03T12:00:00.000Z", booked_kind: "demo", availability: "away", availability_reason: "missed_offer" },
    ]);
    const again = await w.rooms.actions["live.status"]!(closer, {});
    expect(again.me).toMatchObject({ reason: null, booked_at: null, booked_kind: null });
  });

  test("a seat the view does not know is Away, never an error or a guess", async () => {
    const w = setup();
    const out = await w.rooms.actions["live.status"]!(setter, {});
    expect((out.me as Row).state).toBe("away");
  });

  test("Available records two hours and asks for a standby room when live calls are on; Away ends the empty one", async () => {
    const w = setup({ live: { enabled: true } });
    const out = await w.rooms.actions["live.availability"]!(closer, { state: "available" });
    const a = w.db.t("cockpit_sales_availability").find(r => r.email === CLOSER) as Row;
    expect(a.state).toBe("available");
    expect(Date.parse(String(a.until)) - w.clock.now).toBeGreaterThan(115 * MIN);
    const standby = w.db.t("cockpit_sales_rooms").find(r => r.purpose === "standby") as Row;
    expect([standby.host_email, standby.contact_id ?? null, standby.provider]).toEqual([CLOSER, null, "zoom"]);
    expect(out.standby_error).toBeUndefined();
    await w.rooms.actions["live.availability"]!(closer, { state: "away" });
    // Never opened by the worker, so it is cancelled (an open one would end).
    expect((w.db.t("cockpit_sales_rooms").find(r => r.purpose === "standby") as Row).state).toBe("cancelled");
  });

  test("a standby room that cannot be made comes back as standby_error, and Available still stands", async () => {
    const w = setup({ live: { enabled: true }, rooms: { providers: { zoom: false, meet: false } } });
    const out = await w.rooms.actions["live.availability"]!(closer, { state: "available" });
    expect(out.standby_error).toBe(LANE_COPY.disabled);
    expect((w.db.t("cockpit_sales_availability")[0] as Row).state).toBe("available");
  });
});

describe("live.take and live.decline", () => {
  test("while live.enabled is false both answer the Offer refusal", async () => {
    const w = setup();
    const b = { live_id: crypto.randomUUID(), request_id: crypto.randomUUID() };
    const t = await refused(w.rooms.actions["live.take"]!(closer, b));
    const d = await refused(w.rooms.actions["live.decline"]!(closer, b));
    expect([t.message, t.extra.code, d.message]).toEqual([LIVE_OFF, "disabled", LIVE_OFF]);
    expect(LIVE_OFF).toBe("Live handover is not switched on yet.");
  });

  function offer(w: ReturnType<typeof setup>) {
    const id = fakeUuid();
    w.db.seed("cockpit_sales_live", [
      { id, request_id: fakeUuid(), contact_id: LEAD, asked_by: SETTER, kind: "demo", reason: "on_call", state: "offered", offered_to: [CLOSER], offer_until: new Date(w.clock.now + 2 * MIN).toISOString() },
    ]);
    return id;
  }

  test("Take on a standby room the closer is in: the room is adopted, the link goes, live.claimed is handled", async () => {
    const w = setup({ live: { enabled: true } });
    const sb = fakeUuid();
    w.db.seed("cockpit_sales_rooms", [
      { id: sb, request_id: fakeUuid(), purpose: "standby", call_kind: "demo", provider: "zoom", host_email: CLOSER, made_by: CLOSER, state: "host_in", join_url: ZOOM_URL, opened_at: w.db.iso(), host_in_at: w.db.iso(), version: 3 },
    ]);
    const id = offer(w);
    const out = await w.rooms.actions["live.take"]!(closer, { live_id: id, request_id: crypto.randomUUID() });
    await w.flush();
    expect(out.claim_room).toBe("standby");
    expect((out.room as Row).contact_id).toBe(LEAD);
    expect(w.texts).toHaveLength(1);
    expect(w.db.t("cockpit_sales_room_events").find(e => e.kind === "live.claimed")?.handled_at).toBeTruthy();
    expect(w.audits.map(a => a.action)).toContain("live.take");
    // The adopted room's link claim is its own write, so it leaves its own audit row.
    expect(w.audits.filter(a => a.action === "live.room.ready").map(a => [a.entityId, (a.after as Row).link_claimed])).toEqual([[sb, true]]);
  });

  test("no standby room: the taker's handover room is made with the live id as its request id", async () => {
    const w = setup({ live: { enabled: true } });
    const id = offer(w);
    const out = await w.rooms.actions["live.take"]!(closer, { live_id: id, request_id: crypto.randomUUID() });
    expect(out.claim_room).toBe("none");
    const room = w.db.t("cockpit_sales_rooms").find(r => r.handover_id === id) as Row;
    expect([room.request_id, room.purpose, room.send_on]).toEqual([id, "handover", "host_in"]);
  });

  test("an offer someone else took, or one that ended", async () => {
    const w = setup({ live: { enabled: true } });
    const id = offer(w);
    (w.db.t("cockpit_sales_live")[0] as Row).offered_to = ["someone@maharamedia.com"];
    const r = await refused(w.rooms.actions["live.take"]!(closer, { live_id: id, request_id: crypto.randomUUID() }));
    expect([r.status, r.message]).toEqual([409, "Someone else took this lead."]);
    const gone = await refused(w.rooms.actions["live.take"]!(closer, { live_id: crypto.randomUUID(), request_id: crypto.randomUUID() }));
    expect(gone.message).toBe(OFFER_GONE);
  });

  test("Not now adds the seat to declined_by once; the version does not move", async () => {
    const w = setup({ live: { enabled: true } });
    const id = offer(w);
    await w.rooms.actions["live.decline"]!(closer, { live_id: id, request_id: crypto.randomUUID() });
    await w.rooms.actions["live.decline"]!(closer, { live_id: id, request_id: crypto.randomUUID() });
    const l = w.db.t("cockpit_sales_live")[0] as Row;
    expect([l.declined_by, l.version]).toEqual([[CLOSER], 1]);
    w.clock.now += 3 * MIN;
    expect((await refused(w.rooms.actions["live.decline"]!(closer, { live_id: id, request_id: crypto.randomUUID() }))).message).toBe(OFFER_GONE);
  });
});

describe("the dialer's queue hold", () => {
  test("a lead whose room is open and before its deadline is held; a booked room holds nobody; a final room holds nobody", async () => {
    const w = setup();
    const id = String((await w.make()).id);
    await w.workerOpens(id);
    await w.rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: {} });
    expect([...(await w.rooms.held(w.clock.now))]).toEqual([LEAD]);
    w.db.seed("cockpit_sales_rooms", [
      { id: fakeUuid(), request_id: fakeUuid(), contact_id: OTHER_LEAD, purpose: "booked", call_kind: "demo", provider: "zoom", host_email: CLOSER, made_by: CLOSER, state: "open", appointment_id: "d", join_url: ZOOM_URL, host_by: new Date(w.clock.now + MIN).toISOString(), lead_by: new Date(w.clock.now + MIN).toISOString(), ends_at: new Date(w.clock.now + MIN).toISOString() },
    ]);
    expect((await w.rooms.held(w.clock.now)).has(OTHER_LEAD)).toBe(false);
    w.clock.now += 3 * 3_600_000;
    expect((await w.rooms.held(w.clock.now)).size).toBe(0);
  });
});

describe("not built yet, switched off", () => {
  test("live.ask and live.cancel say live calls are off, then that asking is not built yet, never Unknown action", async () => {
    const off = setup();
    for (const a of ["live.ask", "live.cancel"]) {
      const r = await refused(off.rooms.actions[a]!(setter, { request_id: crypto.randomUUID(), contact_id: LEAD, kind: "demo", host: "closer", note: "Wants pricing" }));
      expect([a, r.message, r.extra.code]).toEqual([a, LIVE_OFF, "disabled"]);
    }
    const on = setup({ live: { enabled: true } });
    const r = await refused(on.rooms.actions["live.ask"]!(setter, { request_id: crypto.randomUUID(), contact_id: LEAD }));
    expect([r.status, r.extra.code]).toEqual([409, "disabled"]);
    expect(r.message).not.toContain("Unknown");
    expect(on.audits).toHaveLength(0);
  });

  test("live.press says live calls are off; thread.tick and reply.seen answer quietly", async () => {
    const w = setup();
    expect((await refused(w.rooms.desk["live.press"]!(desk, {}))).message).toBe(LIVE_OFF);
    expect(await w.rooms.desk["thread.tick"]!(desk, {})).toMatchObject({ handled: false });
    expect(await w.rooms.desk["reply.seen"]!(desk, {})).toMatchObject({ handled: false });
    // The shared cron secret runs only what the cron door passes on (final review).
    expect(w.rooms.cron).toEqual(["room.event", "thread.tick"]);
  });
});

describe("the handover room the claim reserves (20261003d, fix round 3)", () => {
  test("a re-offer's request id is the one the claim works out in SQL (pinned in the rooms checks, D)", async () => {
    const { uuidFrom } = await import("./liveio.ts");
    expect(await uuidFrom("mahara-live/00000000-0000-4000-8000-00000000d014/1")).toBe("5f3c75fe-140c-544a-85d2-1c2fe98ad064");
  });
});
