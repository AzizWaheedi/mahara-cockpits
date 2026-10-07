// Milestone 1, video-link round 1, the PROVIDER QUIRKS angle, through the
// panel's own words (lib/rooms.ts) over sales-api's real room actions
// (testfakes.ts).
//
// bun test src/lib/m1_providers_r1_ui.test.ts   (from apps/sales-cockpit)
//
// HighLevel's gateway answers the link's send with a 502 after HighLevel took
// it: the message service stores the row "unclear" and sales-api says the
// link "may have gone" (rooms.ts maybeSent, ROOMS_COPY.may_have_gone_*), and
// sends nothing more, so the lead never gets two links for one room. The
// room's refusal carries those words with link_sent_at empty, and the panel
// reads every refusal on a room with no link sent as "not_sent". A failing
// expectation is a finding; its message says what the rep sees instead.
// Pilot settings (m1-scope.md section 3: short link off, the WhatsApp gate
// still closed, so the link goes by email); every lead is invented.

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
const { ApiRefusal } = await import(`${SA}/liveio.ts`);
const R = await import("./rooms");

const S = 1000;
const MIN = 60 * S;
const CLOSER = "closer-m1p-ui@stress.invalid";
const ZOOM_URL =
  "https://us06web.zoom.us/j/81234567890?pwd=Zx8aB3stressPasscode1";
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
const iso = (t: number) => new Date(t).toISOString();

function setup(lead: string, provider: "zoom" | "meet") {
  const w = fakeWorld(Date.parse("2026-10-06T10:00:00+03:00"));
  w.db.seed("cockpit_sales_settings", [
    {
      key: "rooms",
      value: {
        ...DEFAULT_ROOMS_JSON,
        enabled: true,
        test_only: true,
        test_contacts: [lead],
        providers: { zoom: true, meet: true },
        send: { whatsapp_text: true, whatsapp_template: true, email: true },
        short_link: false,
        fallback: { ...DEFAULT_ROOMS_JSON.fallback, scope: "intro" },
      },
    },
    { key: "live", value: { enabled: false, slack: false } },
    // Production today: the WhatsApp gate is closed, so the link goes by email.
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
      at: iso(w.clock.now - 5 * S),
    },
  ]);
  w.db.seed("cockpit_sales_leads", [
    { contact_id: lead, country: "KW", assigned_to: "G-closer" },
  ]);
  w.routes.push(async (m: string, p: string) =>
    m === "GET" && p === `/contacts/${lead}`
      ? {
          contact: {
            id: lead,
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
  const sends: Row[] = [];
  const rooms = makeRooms({
    io: w.io,
    audit: async () => {},
    markAppointment: async () => ({ crm: "written" }),
    // index.ts convoSend: HighLevel took the email and its gateway answered 502, so the row is "unclear".
    sendText: async (_who: unknown, b: Row) => {
      const again = w.db
        .t("cockpit_sales_messages")
        .find((m: Row) => m.request_id === b.request_id);
      if (again) return { message: { ...again }, repeated: true };
      const row: Row = {
        id: fakeUuid(),
        request_id: b.request_id,
        contact_id: b.contact_id,
        channel: b.channel,
        body: b.body,
        source: "room",
        state: "unclear",
        error: "HighLevel said 502: Bad Gateway",
        created_at: iso(w.clock.now),
      };
      w.db.t("cockpit_sales_messages").push(row);
      sends.push(row);
      throw new ApiRefusal(
        "The send may have gone; read the conversation in HighLevel before writing to the lead again (HighLevel said 502: Bad Gateway)",
        502,
        { unclear: true },
      );
    },
    sendTemplate: async () => {
      throw new Error("no template in the pilot (short link off)");
    },
    upcoming: async () => null,
    sentSince: async () => false,
  });
  const room = (id: string) =>
    w.db.t("cockpit_sales_rooms").find((r: Row) => r.id === id) as Row;
  async function opened(): Promise<string> {
    const made = (await rooms.actions["room.create"]!(closer, {
      request_id: crypto.randomUUID(),
      contact_id: lead,
      purpose: "manual",
      provider,
      call_kind: "demo",
    })) as Row;
    const id = String((made.room as Row).id);
    await w.io.db(`cockpit_sales_rooms?id=eq.${id}&state=eq.requested`, {
      method: "PATCH",
      body: {
        state: "creating",
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
          join_url:
            provider === "zoom"
              ? ZOOM_URL
              : "https://meet.google.com/abc-defg-hij",
          provider_meeting_id:
            provider === "zoom" ? "81234567890" : "abc-defg-hij",
          opened_at: w.db.iso(),
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
  return { ...w, rooms, room, opened, sends };
}

describe("m1 providers r1 (panel): the link's email may have gone (HighLevel's 502 after it took it)", () => {
  test("may-have-gone-shown-as-not-sent-send-it-another-way: the closer is told Not sent and to send the link another way", async () => {
    const LEAD = "stress-m1p-ui-maybe";
    const w = setup(LEAD, "zoom");
    const id = await w.opened();
    // The minute's re-ask asks again and finds the same answer: nothing more goes.
    w.clock.now += MIN;
    await w.rooms.desk["room.event"]!(desk, {
      kind: "tick",
      payload: { room_ids: [id] },
    });
    await w.flush();
    const r = w.room(id);
    expect([
      w.sends.length,
      r.link_sent_at ?? null,
      String(r.refusal ?? ""),
    ]).toEqual([1, null, expect.stringMatching(/may have gone by email/)]);
    const st = (await w.rooms.actions["room.status"]!(closer, {
      room_id: id,
    })) as Row;
    const view = R.normalizeRoom(st.room)!;
    const now = w.clock.now + 2 * S;
    const said = R.sentenceText(R.roomSentence(view, { now }));
    const timeline = w.db
      .t("cockpit_sales_room_events")
      .filter((e: Row) => e.room_id === id && typeof e.text === "string")
      .map((e: Row) => String(e.text));
    const notSentLine =
      timeline.find((t: string) =>
        /^Not sent: the link may have gone/.test(t),
      ) ?? null;
    expect(
      { moment: R.roomMoment(view, now), said, notSentLine },
      `HighLevel may have sent the email (its answer was lost), and sales-api sends nothing more so the lead never gets two links. ` +
        `The panel reads: ${JSON.stringify(said)}; the timeline: ${JSON.stringify(notSentLine)}. "Not sent" plus "Copy the link and send ` +
        'it another way" asks the closer to send the lead a second copy of a link that may already be in their inbox',
    ).toEqual({
      moment: R.roomMoment(view, now),
      said: expect.not.stringMatching(/^Not sent|send it another way/),
      notSentLine: null,
    });
  });
});
