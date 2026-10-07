import { describe, expect, test } from "bun:test";
import { createRepository } from "./repository.ts";
import type { Row } from "./runtime.ts";

function createFakeReader(bookingEventDataList: Row[] = []) {
  const now = Date.now();
  const today = new Date(now + 3 * 60 * 60_000).toISOString().slice(0, 10);
  const snapshotDate = new Date(now).toISOString();

  return async (_project: string, query: string): Promise<Row[]> => {
    if (query.includes("cockpit_campaigns")) {
      return [
        {
          data: JSON.stringify({
            campaignName: "Camp A",
            onBoard: true,
            internal: false,
            spend7d: 100,
            leads7d: 10,
          }),
          stamp_ms: now,
        },
      ];
    }
    if (query.includes("cockpit_csm_sources") || query.includes("cockpit_csm_source_state")) {
      return [{ ready: true, row_count: 0, actual_count: 0, source_snapshot_at: snapshotDate, stamp_ms: now, rows: [] }];
    }
    if (query.includes("cockpit_media_sources") || query.includes("cockpit_media_source_state")) {
      return [{ ready: true, row_count: 0, actual_count: 0, source_snapshot_at: snapshotDate, stamp_ms: now, rows: [] }];
    }
    if (query.includes("cockpit_media_feed_state")) {
      const isDaily = query.includes("dailyStats");
      return [
        {
          feed: isDaily ? "dailyStats" : "bookingEvents",
          ready: true,
          source_snapshot_at: snapshotDate,
          source_rows: isDaily ? 1 : bookingEventDataList.length,
          actual_rows: isDaily ? 1 : bookingEventDataList.length,
        },
      ];
    }
    if (query.includes("cockpit_media_daily_stats")) {
      return [{ data: JSON.stringify({ date: today, campaignName: "Camp A", spend: 50, leads: 5 }) }];
    }
    if (query.includes("cockpit_media_booking_events")) {
      return bookingEventDataList.map(data => ({ data: JSON.stringify(data) }));
    }
    return [];
  };
}

describe("CEO Refresh Repository delivery() canonical booking handling", () => {
  test("legacy shape: handles repeated snapshots by keeping max batch multiplicity and counting removed copies", async () => {
    const rawEvents = [
      // Sync 1000: 1 event
      { _id: "legacy_1", campaignName: "Camp A", date: "2026-09-01", client: "Client1", appointmentDate: "2026-09-02", status: "confirmed", adId: "ad_1", syncedAt: 1000 },
      // Sync 2000: same group repeated
      { _id: "legacy_2", campaignName: "Camp A", date: "2026-09-01", client: "Client1", appointmentDate: "2026-09-02", status: "confirmed", adId: "ad_1", syncedAt: 2000 },
      // Sync 3000: same group repeated
      { _id: "legacy_3", campaignName: "Camp A", date: "2026-09-01", client: "Client1", appointmentDate: "2026-09-02", status: "confirmed", adId: "ad_1", syncedAt: 3000 },
    ];

    const repo = createRepository(createFakeReader(rawEvents));
    const result = (await repo.delivery()) as { bookings: Row[]; bookingsSyncedAt?: number };

    expect(result.bookings).toHaveLength(1);
    expect(result.bookings[0].count).toBe(1);
    expect(result.bookings[0].copies).toBe(2);
    expect(result.bookings[0].campaignName).toBe("Camp A");
    expect(result.bookings[0].date).toBe("2026-09-01");
    expect(result.bookings[0].kind).toBe("confirmed");
  });

  test("legacy shape: retains max batch multiplicity when multiple distinct appointments exist in one sync batch", async () => {
    const rawEvents = [
      // Sync 1000: 2 distinct appointments under the same group key
      { _id: "batch1_a", campaignName: "Camp A", date: "2026-09-01", client: "Client1", appointmentDate: "2026-09-02", status: "confirmed", adId: "ad_1", syncedAt: 1000 },
      { _id: "batch1_b", campaignName: "Camp A", date: "2026-09-01", client: "Client1", appointmentDate: "2026-09-02", status: "confirmed", adId: "ad_1", syncedAt: 1000 },
      // Sync 2000: repeated snapshot of both
      { _id: "batch2_a", campaignName: "Camp A", date: "2026-09-01", client: "Client1", appointmentDate: "2026-09-02", status: "confirmed", adId: "ad_1", syncedAt: 2000 },
      { _id: "batch2_b", campaignName: "Camp A", date: "2026-09-01", client: "Client1", appointmentDate: "2026-09-02", status: "confirmed", adId: "ad_1", syncedAt: 2000 },
    ];

    const repo = createRepository(createFakeReader(rawEvents));
    const result = (await repo.delivery()) as { bookings: Row[] };

    expect(result.bookings).toHaveLength(1);
    expect(result.bookings[0].count).toBe(2);
    expect(result.bookings[0].copies).toBe(2);
  });

  test("legacy shape: historical confirmed, showed, and noshow count as confirmed bookings", async () => {
    const rawEvents = [
      { _id: "ev_1", campaignName: "Camp A", date: "2026-09-01", client: "Client1", appointmentDate: "2026-09-01", status: "confirmed", syncedAt: 1000 },
      { _id: "ev_2", campaignName: "Camp A", date: "2026-09-02", client: "Client1", appointmentDate: "2026-09-02", status: "showed", syncedAt: 1000 },
      { _id: "ev_3", campaignName: "Camp A", date: "2026-09-03", client: "Client1", appointmentDate: "2026-09-03", status: "noshow", syncedAt: 1000 },
    ];

    const repo = createRepository(createFakeReader(rawEvents));
    const result = (await repo.delivery()) as { bookings: Row[] };

    expect(result.bookings).toHaveLength(3);
    for (const b of result.bookings) {
      expect(b.count).toBe(1);
      expect(b.kind).toBe("confirmed");
    }
  });

  test("legacy shape: provisional vs confirmed separation on the same date", async () => {
    const rawEvents = [
      { _id: "prov_1", campaignName: "Camp A", date: "2026-09-01", client: "Client1", appointmentDate: "2026-09-01", status: "provisional", syncedAt: 1000 },
      { _id: "prov_2", campaignName: "Camp A", date: "2026-09-01", client: "Client2", appointmentDate: "2026-09-01", status: "not confirmed", syncedAt: 1000 },
      { _id: "conf_1", campaignName: "Camp A", date: "2026-09-01", client: "Client3", appointmentDate: "2026-09-01", status: "confirmed", syncedAt: 1000 },
    ];

    const repo = createRepository(createFakeReader(rawEvents));
    const result = (await repo.delivery()) as { bookings: Row[] };

    expect(result.bookings).toHaveLength(2);
    const prov = result.bookings.find(b => b.kind === "provisional");
    const conf = result.bookings.find(b => b.kind === "confirmed");
    expect(prov).toBeDefined();
    expect(prov?.count).toBe(2);
    expect(prov?.date).toBe("2026-09-01");

    expect(conf).toBeDefined();
    expect(conf?.count).toBe(1);
    expect(conf?.date).toBe("2026-09-01");
  });

  test("legacy shape: no false group merge across distinct attributes", async () => {
    const rawEvents = [
      // Same date, same appointmentDate, but different client
      { _id: "ev_c1", campaignName: "Camp A", date: "2026-09-01", client: "ClientA", appointmentDate: "2026-09-02", status: "confirmed", adId: "ad1", syncedAt: 1000 },
      { _id: "ev_c2", campaignName: "Camp A", date: "2026-09-01", client: "ClientB", appointmentDate: "2026-09-02", status: "confirmed", adId: "ad1", syncedAt: 1000 },
      // Same date, but different adId
      { _id: "ev_ad2", campaignName: "Camp A", date: "2026-09-01", client: "ClientA", appointmentDate: "2026-09-02", status: "confirmed", adId: "ad2", syncedAt: 1000 },
      // Same date, but different appointmentDate
      { _id: "ev_ap3", campaignName: "Camp A", date: "2026-09-01", client: "ClientA", appointmentDate: "2026-09-03", status: "confirmed", adId: "ad1", syncedAt: 1000 },
    ];

    const repo = createRepository(createFakeReader(rawEvents));
    const result = (await repo.delivery()) as { bookings: Row[] };

    // All 4 are distinct groups on date 2026-09-01, none should overwrite or merge into copies
    expect(result.bookings).toHaveLength(1);
    expect(result.bookings[0].count).toBe(4);
    expect(result.bookings[0].copies).toBe(0);
  });

  test("legacy shape: missing or non-positive syncedAt is rejected", async () => {
    const missingSync = createRepository(createFakeReader([
      { campaignName: "Camp A", date: "2026-09-01", appointmentDate: "2026-09-01", status: "confirmed" },
    ]));
    await expect(missingSync.delivery()).rejects.toThrow("Canonical legacy booking event has no verified syncedAt timestamp");

    const zeroSync = createRepository(createFakeReader([
      { campaignName: "Camp A", date: "2026-09-01", appointmentDate: "2026-09-01", status: "confirmed", syncedAt: 0 },
    ]));
    await expect(zeroSync.delivery()).rejects.toThrow("Canonical legacy booking event has no verified syncedAt timestamp");

    const negativeSync = createRepository(createFakeReader([
      { campaignName: "Camp A", date: "2026-09-01", appointmentDate: "2026-09-01", status: "confirmed", syncedAt: -100 },
    ]));
    await expect(negativeSync.delivery()).rejects.toThrow("Canonical legacy booking event has no verified syncedAt timestamp");
  });

  test("legacy shape: rejects unconfirmed and arbitrary substrings", async () => {
    // "unconfirmed" contains "confirmed" as substring, but is not allowed
    const unconfirmedRepo = createRepository(createFakeReader([
      { campaignName: "Camp A", date: "2026-09-01", appointmentDate: "2026-09-01", status: "unconfirmed", syncedAt: 1000 },
    ]));
    await expect(unconfirmedRepo.delivery()).rejects.toThrow("Canonical booking event has no verified calendar classification");

    // Arbitrary substring like "provisional_maybe"
    const substringRepo = createRepository(createFakeReader([
      { campaignName: "Camp A", date: "2026-09-01", appointmentDate: "2026-09-01", status: "provisional_maybe", syncedAt: 1000 },
    ]));
    await expect(substringRepo.delivery()).rejects.toThrow("Canonical booking event has no verified calendar classification");
  });

  test("modern event shape: exact event deduplication by stable event identity", async () => {
    const rawEvents = [
      {
        campaignName: "Camp A",
        date: "2026-09-10",
        eventId: "evt_123",
        startTime: "2026-09-10T10:00:00Z",
        locationId: "loc_1",
        kind: "confirmed",
        syncedAt: 1000,
      },
      // Duplicate event row
      {
        campaignName: "Camp A",
        date: "2026-09-10",
        eventId: "evt_123",
        startTime: "2026-09-10T10:00:00Z",
        locationId: "loc_1",
        kind: "confirmed",
        syncedAt: 2000,
      },
      // Distinct event
      {
        campaignName: "Camp A",
        date: "2026-09-10",
        eventId: "evt_456",
        startTime: "2026-09-10T11:00:00Z",
        locationId: "loc_1",
        kind: "confirmed",
        syncedAt: 1000,
      },
    ];

    const repo = createRepository(createFakeReader(rawEvents));
    const result = (await repo.delivery()) as { bookings: Row[] };

    expect(result.bookings).toHaveLength(2);
    const evt123 = result.bookings.find(b => b.eventId === "evt_123");
    expect(evt123).toBeDefined();
    expect(evt123?.count).toBe(1);
    expect(evt123?.copies).toBe(1);

    const evt456 = result.bookings.find(b => b.eventId === "evt_456");
    expect(evt456).toBeDefined();
    expect(evt456?.count).toBe(1);
    expect(evt456?.copies).toBe(0);
  });

  test("source immutability: read callbacks receive queries without mutations", async () => {
    const queried: string[] = [];
    const baseReader = createFakeReader([
      { _id: "legacy_1", campaignName: "Camp A", date: "2026-09-01", client: "Client1", appointmentDate: "2026-09-02", status: "confirmed", syncedAt: 1000 },
    ]);
    const reader = async (proj: string, query: string) => {
      queried.push(query);
      return baseReader(proj, query);
    };

    const repo = createRepository(reader);
    await repo.delivery();

    expect(queried.length).toBeGreaterThan(0);
    for (const q of queried) {
      expect(q).toMatch(/SELECT /i);
      expect(q).not.toMatch(/INSERT |UPDATE |DELETE |DROP |ALTER /i);
    }
  });

  test("invalid or missing shapes are denied", async () => {
    // Missing date
    const repoMissingDate = createRepository(createFakeReader([
      { campaignName: "Camp A", status: "confirmed", syncedAt: 1000 } as Row,
    ]));
    await expect(repoMissingDate.delivery()).rejects.toThrow("Canonical booking event has no stable campaign, date, or event identity");

    // Missing campaignName
    const repoMissingCampaign = createRepository(createFakeReader([
      { date: "2026-09-01", status: "confirmed", syncedAt: 1000 } as Row,
    ]));
    await expect(repoMissingCampaign.delivery()).rejects.toThrow("Canonical booking event has no stable campaign, date, or event identity");

    // Unrecognized calendar/status
    const repoInvalidStatus = createRepository(createFakeReader([
      { campaignName: "Camp A", date: "2026-09-01", appointmentDate: "2026-09-01", status: "unknown_arbitrary", syncedAt: 1000 },
    ]));
    await expect(repoInvalidStatus.delivery()).rejects.toThrow("Canonical booking event has no verified calendar classification");
  });
});
