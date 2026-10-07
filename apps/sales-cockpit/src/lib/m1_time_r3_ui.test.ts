// Milestone 1, video-link round 3, the TIME angle, through the panel's own
// words (lib/rooms.ts) over sales-api's real room actions (testfakes.ts).
//
// bun test src/lib/m1_time_r3_ui.test.ts   (from apps/sales-cockpit)
//
// The link's deadline on the panel, one second either side. A room may open
// up to two minutes after its press and still be on time: the sweep fails a
// room still being made only at its claim + 120 s (R2), and the panel itself
// says "taking too long" only at MAKING_LATE_MS (150 s). The server asks
// again for a link never claimed a minute after the room OPENED (roomlogic
// reaskPlan, opened_at + 60 s). The panel's "The link has not gone yet"
// (LINK_LATE_MS, 90 s) counts from the room's creation instead. A failing
// expectation is a finding; its comment says what the rep sees instead.
// Pilot settings (m1-scope.md section 3); every lead is invented.

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
const R = await import("./rooms");

const S = 1000;
const CLOSER = "closer-m1t3-ui@stress.invalid";
const closer = {
  signed_in: true,
  seat: true,
  manager: false,
  email: CLOSER,
  name: "Omar Closer",
  role: "closer",
  ghl_user_id: "G-closer",
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

function setup(now: number) {
  const w = fakeWorld(now);
  const LEAD = `stress-m1t3-ui-${fakeUuid().slice(-8)}`;
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
        short_link: false,
        fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: "intro" },
      },
    },
    { key: "live", value: { enabled: false, slack: false } },
    {
      key: "whatsapp_guard",
      value: { connector_off: false, single_copy_ok_at: null },
    },
    { key: "messaging", value: { whatsapp: true, email: true } },
  ]);
  w.db.seed("cockpit_sales_people", [
    {
      email: CLOSER,
      name: "Omar Closer",
      role: "closer",
      ghl_user_id: "G-closer",
      active: true,
    },
  ]);
  w.db.seed("cockpit_sales_room_hosts", [
    {
      email: CLOSER,
      zoom_user_id: "Z-closer",
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
    { contact_id: LEAD, country: "KW", assigned_to: "G-closer" },
  ]);
  w.routes.push(async (m: string, p: string) =>
    m === "GET" && p === `/contacts/${LEAD}`
      ? {
          contact: {
            id: LEAD,
            firstName: "Huda",
            name: "Huda Ali",
            phone: "+96550000000",
            email: "huda@example.invalid",
            tags: ["roas-qualified"],
            country: "KW",
          },
        }
      : (null as unknown as Row),
  );
  // HighLevel's answer to the email send is on its way (inside its 25 s):
  // the send has been asked and has not answered yet.
  let answer: (() => void) | null = null;
  const asked: number[] = [];
  const rooms = makeRooms({
    io: w.io,
    audit: async () => {},
    markAppointment: async () => ({ crm: "written" }),
    sendText: async (_who: unknown, b: Row) => {
      asked.push(w.clock.now);
      await new Promise<void>(r => {
        answer = r;
      });
      const row: Row = {
        id: fakeUuid(),
        request_id: b.request_id,
        contact_id: b.contact_id,
        channel: b.channel,
        body: b.body,
        source: "room",
        state: "sent",
        created_at: iso(w.clock.now),
      };
      w.db.t("cockpit_sales_messages").push(row);
      return { message: { ...row } };
    },
    sendTemplate: async () => {
      throw new Error("no template in this test");
    },
    upcoming: async () => null,
    sentSince: async () => false,
  });
  const room = (id: string) =>
    w.db.t("cockpit_sales_rooms").find((r: Row) => r.id === id) as Row;
  function heartbeat(at: number) {
    for (const r of w.db.t("cockpit_sales_worker_status"))
      if (r.job === "rooms") r.at = iso(at - 5 * S);
  }
  /** The worker claims at `claimAt` and opens at `openAt` (contract v2 section 7). */
  async function worker(id: string, claimAt: number, openAt: number) {
    w.clock.now = claimAt;
    heartbeat(claimAt);
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, {
      method: "PATCH",
      body: {
        state: "creating",
        claimed_at: iso(claimAt),
        worker_run: "run-1",
        version: Number(room(id).version) + 1,
      },
    });
    w.clock.now = openAt;
    heartbeat(openAt);
    await w.io.db("cockpit_sales_room_events?on_conflict=dedupe_key", {
      method: "POST",
      body: {
        room_id: id,
        kind: "worker.ready",
        source: "worker",
        dedupe_key: `worker.ready:${id}`,
        detail: { worker_run: "run-1" },
        text: "Room made on Zoom in 95.0 s.",
      },
      prefer: "resolution=ignore-duplicates",
    });
    await w.io.db(
      `cockpit_sales_rooms?id=eq.${id}&state=eq.creating&worker_run=eq.run-1`,
      {
        method: "PATCH",
        body: {
          state: "open",
          join_url: "https://us06web.zoom.us/j/81234567890?pwd=stress",
          provider_meeting_id: "81234567890",
          opened_at: iso(openAt),
          host_by: iso(openAt + 15 * 60 * S),
          ends_at: iso(openAt + 30 * 60 * S),
          version: Number(room(id).version) + 1,
        },
      },
    );
    await rooms.desk["room.event"]!(desk, {
      kind: "worker.ready",
      room_id: id,
      payload: {
        provider: "zoom",
        provider_meeting_id: "81234567890",
        worker_run: "run-1",
      },
    });
    for (let i = 0; i < 20 && !asked.length; i++) await realSleep(2);
  }
  async function panel(id: string, at: number) {
    w.clock.now = at;
    heartbeat(at);
    const out = (await rooms.actions["room.status"]!(closer, {
      room_id: id,
    })) as Row;
    const view = R.normalizeRoom(out.room);
    if (!view) throw new Error("no view");
    const moment = R.roomMoment(view, at);
    const said = R.sentenceText(R.roomSentence(view, { now: at }));
    const acts = R.roomActions(view, { now: at });
    const keys = [acts.primary?.key, ...acts.quiet.map(a => a.key)].filter(
      Boolean,
    );
    return { moment, said, keys, view };
  }
  return {
    ...w,
    rooms,
    room,
    worker,
    panel,
    LEAD,
    asked,
    release: () => answer?.(),
  };
}

async function make(w: ReturnType<typeof setup>, at: number): Promise<string> {
  w.clock.now = at;
  const made = (await w.rooms.actions["room.create"]!(closer, {
    request_id: crypto.randomUUID(),
    contact_id: w.LEAD,
    purpose: "manual",
    provider: "zoom",
    call_kind: "intro",
    trigger: "manual",
  })) as Row;
  return String((made.room as Row).id);
}

describe("Tuesday 6 October, 14:00:00: the closer's Zoom room from the lead page; Zoom's create answers slowly and the room opens at 14:01:35 (claim 14:00:02, the sweep's R2 waits to 14:02:02)", () => {
  test("setup: on time by the server's own rules (the panel says 'taking too long' only at 150 s)", () => {
    expect(R.MAKING_LATE_MS).toBeGreaterThan(95 * S);
    expect(R.LINK_LATE_MS).toBe(90 * S);
  });

  test("control: a room that opened at 14:00:20 says nothing late one second after it opened", async () => {
    const t0 = kw("2026-10-06T14:00:00");
    const w = setup(t0);
    const id = await make(w, t0);
    await w.worker(id, t0 + 2 * S, t0 + 20 * S);
    expect(w.asked.length).toBe(1);
    const p = await w.panel(id, t0 + 21 * S);
    expect(p.moment).not.toBe("link_late");
    w.release();
  });

  test("one second after the 14:01:35 open, with the email's send asked of HighLevel and not yet answered, the panel does not say the link has not gone nor offer Use Meet", async () => {
    const t0 = kw("2026-10-06T14:00:00");
    const w = setup(t0);
    const id = await make(w, t0);
    await w.worker(id, t0 + 2 * S, t0 + 95 * S);
    // The server's own send is under way this second.
    expect(w.asked).toEqual([t0 + 95 * S]);
    expect(w.room(id).link_claimed_at).toBe(iso(t0 + 95 * S));
    const p = await w.panel(id, t0 + 96 * S);
    // Found when it fails: lib/rooms.ts roomMoment counts LINK_LATE_MS from
    // room.created_at (the press), never from the open (the view carries no
    // opened_at), so a room that opened late but on time says, the second it
    // opens: "The link has not gone yet. Copy it and send it another way, or
    // end this room and use Meet, whose link can be read out." with a Use
    // Meet button (retry: cancels this Zoom room and makes a Meet room),
    // while the server's own email with the Zoom link is in HighLevel's hands.
    expect({
      moment: p.moment,
      said: p.said,
      use_meet: p.keys.includes("retry"),
    }).toEqual({
      moment: "ready",
      said: "Room ready.",
      use_meet: false,
    });
    w.release();
  });

  test("one second either side of the panel's 90 s: a room opened at 14:01:29 is 'Room ready.' at 14:01:29.5 and 'The link has not gone yet' at 14:01:30.5, with the same send in flight", async () => {
    const t0 = kw("2026-10-06T14:00:00");
    const w = setup(t0);
    const id = await make(w, t0);
    await w.worker(id, t0 + 2 * S, t0 + 89 * S);
    const before = await w.panel(id, t0 + 89.5 * S);
    const after = await w.panel(id, t0 + 90.5 * S);
    expect(before.moment).toBe("ready");
    // Found when it fails: 1.5 s after the open, with nothing changed but the
    // clock, the panel turns to "send it another way".
    expect(after.moment).toBe("ready");
    w.release();
  });
});
