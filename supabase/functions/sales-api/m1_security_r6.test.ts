// bun test supabase/functions/sales-api/m1_security_r6.test.ts
//
// Milestone 1, video-link round 6, security angle (sales-api): what sales-api
// reads from a rooms setting the database's settings guard (20261004a
// cockpit_sales_settings_guard, cockpit_sales_switches) let through without
// a manager. The guard's own half is proved on the live database, rolled
// back, in supabase/migrations/tests/m1_security_r6.py (F3): a non-manager's
// write of fallback.scope "any " (a trailing space) is taken with no manager
// and no settings.switch row, because cockpit_sales_switches compares the
// scope to 'any' exactly. Here: sales-api trims it and reads "any", so every
// lead on the list gets a missed call's video link without a booked intro.
//
// Pilot settings (m1-scope.md section 3): rooms on for the test contact,
// Meet and Zoom on, every send channel on, count_on_join, settle and wrap
// off, live off, short_link off, fallback.scope as shipped ("intro").
// Against testfakes.ts; no network, every lead and seat invented
// (stress-..., ...@stress.invalid).
//
// A test named "control" passes and proves the rule holds; any other failing
// test is a finding.

import { describe, expect, test } from "bun:test";
import type { Who } from "./lib.ts";
import { ApiRefusal } from "./liveio.ts";
import { DEFAULT_ROOMS_JSON, roomsSetting } from "./roomlogic.ts";
import { makeRooms, type RoomDeps } from "./rooms.ts";
import { fakeUuid, fakeWorld } from "./testfakes.ts";

type Row = Record<string, unknown>;

const SETTER = "stress-m1s6-setter@stress.invalid";
const LEAD = "stress-m1s6-Lead";

const setter: Who = {
  signed_in: true,
  seat: true,
  manager: false,
  email: SETTER,
  name: "Tara Setter",
  role: "setter",
  ghl_user_id: "G-setter",
};

const pilot = (scope: unknown) => ({
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
  fallback: { ...((DEFAULT_ROOMS_JSON as Row).fallback as Row), scope },
});

function setup(scope: unknown, over: { firstName?: string; name?: string } = {}) {
  const w = fakeWorld();
  const audits: Row[] = [];
  const sends: Row[] = [];
  w.db.seed("cockpit_sales_settings", [
    { key: "rooms", value: pilot(scope) },
    { key: "live", value: { enabled: false, slack: false, standby: true } },
    { key: "followups", value: { enabled: true, agent: false } },
    { key: "whatsapp_guard", value: { connector_off: true, single_copy_ok_at: "2026-10-01T00:00:00Z", templates_per_day: 250 } },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [{ email: SETTER, name: "Tara Setter", role: "setter", ghl_user_id: "G-setter", active: true }]);
  w.db.seed("cockpit_sales_room_hosts", [{ email: SETTER, zoom_user_id: "Z-setter", zoom_status: "licensed", google_ok: true }]);
  w.db.seed("cockpit_sales_worker_status", [{ worker: "sales-desk", job: "rooms", ok: true, at: w.db.iso(), detail: "ready" }]);
  w.db.seed("cockpit_sales_leads", [{ contact_id: LEAD, name: "Huda Ali", country: "KW", assigned_to: "G-setter" }]);
  const contact = {
    id: LEAD,
    firstName: over.firstName ?? "Huda",
    name: over.name ?? over.firstName ?? "Huda Ali",
    phone: "+96550000000",
    email: "huda@stress.invalid",
    tags: [],
    country: "KW",
  };
  w.routes.push((m, p) => {
    if (m === "GET" && p.startsWith("/contacts/")) return { contact };
    return null as unknown as Row;
  });
  const deps: RoomDeps = {
    io: w.io,
    audit: async (who, action, entityType, entityId, before, after, metadata) => {
      audits.push({ who: who.email, action, entityType, entityId, before, after, metadata });
    },
    markAppointment: async () => ({}),
    sendText: async (who, b) => {
      sends.push({ who: who.email, kind: "text", ...b });
      return { message: { id: fakeUuid(), state: "sent", provider_status: "sent", created_at: w.db.iso() } };
    },
    sendTemplate: async (who, t) => {
      sends.push({ who: who.email, kind: "template", ...t });
      return { message: { id: fakeUuid(), state: "sent", provider_status: "sent", created_at: w.db.iso() } };
    },
    upcoming: async () => null,
  };
  const room = (id: string) => w.db.t("cockpit_sales_rooms").find(r => r.id === id) as Row;
  return { ...w, rooms: makeRooms(deps), audits, sends, room };
}

/** The dialer's Send a video link after a missed call, for a lead with no booked intro. */
async function missedCallPress(w: ReturnType<typeof setup>): Promise<{ room: Row | null; refusal: ApiRefusal | null }> {
  try {
    const out = await w.rooms.actions["room.create"]!(setter, {
      request_id: crypto.randomUUID(),
      contact_id: LEAD,
      provider: "meet",
      call_kind: "intro",
      purpose: "fallback",
      trigger: "no_answer",
    });
    return { room: out.room as Row, refusal: null };
  } catch (e) {
    if (e instanceof ApiRefusal) return { room: null, refusal: e };
    throw e;
  }
}

/** How the database's guard reads the scope (20261004a cockpit_sales_switches: `#>> '{fallback,scope}' = 'any'`). */
const guardReadsAny = (scope: unknown) => scope === "any";

describe("m1 security r6: fallback.scope as sales-api reads it beside the database's guard", () => {
  test("control: with the shipped scope (intro), a missed call's link for a lead with no booked intro is refused", async () => {
    const w = setup("intro");
    const { room, refusal } = await missedCallPress(w);
    expect(room).toBeNull();
    expect(refusal?.message).toContain("only for booked intros");
  });

  test("control: the exact value 'any' is a widening the guard sees (it needs a manager), and sales-api reads it as any", () => {
    expect(guardReadsAny("any")).toBe(true);
    expect(roomsSetting(pilot("any")).fallback.scope).toBe("any");
  });

  for (const [label, scope] of [
    ["a trailing space", "any "],
    ["a leading space", " any"],
    ["a line break", "any\n"],
    ["a no-break space", "any "],
  ] as const) {
    test(`m1-security-r6-fallback-scope-any-with-space-unguarded: fallback.scope written with ${label} is no widening to the guard (no manager, no settings.switch row), yet sales-api reads "any" and sends a missed call's link to a lead with no booked intro`, async () => {
      // The guard's reading: not "any", so the write needs no manager and leaves no row.
      expect(guardReadsAny(scope)).toBe(false);
      const w = setup(scope);
      const { room, refusal } = await missedCallPress(w);
      // What must hold: sales-api reads the scope as the guard did (narrow),
      // so the press is refused exactly as with "intro".
      expect({ read_as_any: roomsSetting(pilot(scope)).fallback.scope === "any", room_made: Boolean(room) }).toEqual({
        read_as_any: false,
        room_made: false,
      });
      expect(refusal?.message ?? "").toContain("only for booked intros");
    });
  }
});

// ---------------------------------------------------------------------------
// The lead's own first name in Mahara's link message (m1 round 1's rule,
// lib.ts leadFirstName: "a name that is a link or a domain (a scheme, www., a
// dotted host, a path) ... is no name"). A public lead form takes any name
// with anyone's number or email, so the name is the form-filler's words in
// Mahara's message beside the room link.
// ---------------------------------------------------------------------------

const MEET_URL = "https://meet.google.com/abc-defg-hij";

/** The worker makes and opens the room (as desk rooms.py finish does), then its handshake sends the link. */
async function workerOpens(w: ReturnType<typeof setup>, id: string): Promise<void> {
  await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, {
    method: "PATCH",
    body: { state: "creating", claimed_at: w.db.iso(), worker_run: "run-1", version: Number(w.room(id).version) + 1 },
  });
  await w.io.db("cockpit_sales_room_events", {
    method: "POST",
    body: { room_id: id, kind: "worker.ready", source: "worker", dedupe_key: `worker.ready:${id}`, detail: { worker_run: "run-1" } },
  });
  await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.creating&worker_run=eq.run-1`, {
    method: "PATCH",
    body: { state: "open", join_url: MEET_URL, provider_meeting_id: "evt-run-1", opened_at: w.db.iso(), version: Number(w.room(id).version) + 1 },
  });
  const desk: Who = { signed_in: true, seat: true, manager: false, email: "sales-desk", name: "Sales desk" };
  await w.rooms.desk["room.event"]!(desk, { kind: "worker.ready", room_id: id, payload: { worker_run: "run-1" } });
  await w.flush();
}

/** The lead page's Send a video link (manual, Meet), made and sent; the email bodies Mahara sent the lead. */
async function linkEmailFor(firstName: string): Promise<{ sent: boolean; bodies: string[] }> {
  const w = setup("intro", { firstName, name: firstName });
  // Email only: the pilot's WhatsApp gate is shut in production today (m1-scope.md section 3).
  const rooms = w.db.t("cockpit_sales_settings").find(r => r.key === "rooms") as Row;
  rooms.value = { ...(rooms.value as Row), send: { whatsapp_text: false, whatsapp_template: false, email: true } };
  const out = await w.rooms.actions["room.create"]!(setter, {
    request_id: crypto.randomUUID(),
    contact_id: LEAD,
    provider: "meet",
    call_kind: "intro",
    purpose: "manual",
  });
  const id = String((out.room as Row).id);
  await workerOpens(w, id);
  return {
    sent: Boolean(w.room(id).link_sent_at),
    bodies: w.sends.filter(s => s.kind === "text" && s.channel === "email").map(s => String(s.body)),
  };
}

describe("m1 security r6: a lead form's first name that is a host the lead's phone links", () => {
  test("control: a domain with a two-letter label as the first name is no name (Hi there), as round 1 fixed", async () => {
    const { sent, bodies } = await linkEmailFor("mahara-refunds.example");
    expect(sent).toBe(true);
    expect(bodies.length).toBe(1);
    expect(bodies[0]).not.toContain("mahara-refunds.example");
    expect(bodies[0]).toContain("Hi there");
  });

  test("control: initials stay a name (J.R.)", async () => {
    const { bodies } = await linkEmailFor("J.R.");
    expect(bodies[0]).toContain("J.R.");
  });

  for (const [label, name] of [
    ["an IPv4 address (Android's linkifier makes a bare address a link)", "203.0.113.5"],
    ["an IPv4 address and port", "203.0.113.5:8080"],
    ["a one-letter domain with a query", "q.xyz?claim"],
    ["a one-letter domain", "x.co"],
  ] as const) {
    test(`m1-security-r6-lead-name-ip-or-one-letter-domain-in-link-message: a first name that is ${label} (${name}) goes into Mahara's link email beside the room link`, async () => {
      const { sent, bodies } = await linkEmailFor(name);
      expect(sent).toBe(true);
      expect(bodies.length).toBe(1);
      // Only the room's own link may be a link in a message Mahara sends the lead.
      expect(bodies[0]?.includes(name)).toBe(false);
    });
  }
});
