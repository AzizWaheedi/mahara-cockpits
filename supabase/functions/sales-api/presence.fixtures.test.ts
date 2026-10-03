// The presence view (cockpit_sales_presence, migration 20261003a) and
// roomlogic.ts presenceOf/defaultProvider read one shared fixture set
// (contract-v2 S5): run_checks.py checks the view on it in a rolled-back run,
// and this file checks roomlogic on the same file, so the two never drift.
//
//   bun test supabase/functions/sales-api
import { describe, expect, test } from "bun:test";
import fx from "../../migrations/tests/presence_fixtures.json";
import { DEFAULT_ROOMS_JSON, defaultProvider, presenceOf, type RoomRow, roomsSetting } from "./roomlogic.ts";

type Row = Record<string, unknown>;
type Fixture = {
  name: string;
  availability: { state: string; until_s?: number | null } | null;
  rooms: { state: string; purpose: string; provider: string; lead: boolean }[];
  open_attempt?: boolean;
  appointment_now?: boolean;
  zoom_live_s?: number | null;
  expect: { state: string; why: string; room: number | null; until: boolean };
};
type ProviderFixture = { name: string; role: string; host: Row; providers: Row; expect: string };

const doc = fx as unknown as { presence: Fixture[]; default_provider: ProviderFixture[] };
const now = Date.parse("2026-10-03T10:00:00Z");
const iso = (s: number) => new Date(now + s * 1000).toISOString();

describe("presence: the view's fixtures agree with presenceOf", () => {
  expect(doc.presence.length).toBeGreaterThan(5);
  doc.presence.forEach((f, i) => {
    test(f.name, () => {
      const email = `p${i}@example.invalid`;
      const rooms = f.rooms.map((r, j) => ({
        id: `r${j}`,
        host_email: email,
        state: r.state,
        purpose: r.purpose,
        provider: r.provider,
        contact_id: r.lead ? `c${i}-${j}` : null,
        call_kind: "intro",
        join_url: "https://zoom.us/j/1",
      })) as unknown as RoomRow[];
      const p = presenceOf({
        email,
        now,
        availability: f.availability
          ? { state: f.availability.state, until: f.availability.until_s == null ? null : iso(f.availability.until_s) }
          : null,
        rooms,
        open_attempt: Boolean(f.open_attempt),
        appointment_now: Boolean(f.appointment_now),
        zoom_live_until: f.zoom_live_s == null ? null : iso(f.zoom_live_s),
        zoom_status: null,
        default_provider: "meet",
      } as unknown as Parameters<typeof presenceOf>[0]);
      expect({ state: p.state, why: p.why, room: p.room_id, until: p.until !== null }).toEqual({
        state: f.expect.state,
        why: f.expect.why,
        room: f.expect.room === null ? null : `r${f.expect.room}`,
        until: f.expect.until,
      });
    });
  });
});

describe("presence: the view's default provider agrees with defaultProvider", () => {
  for (const f of doc.default_provider) {
    test(f.name, () => {
      const setting = roomsSetting({ ...DEFAULT_ROOMS_JSON, providers: f.providers });
      expect(defaultProvider(f.role, f.host as never, setting)).toBe(f.expect);
    });
  }
});
