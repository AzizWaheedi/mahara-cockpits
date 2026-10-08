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

  test("modern bookings preserve verified showed and noshow classification", async () => {
    const rawEvents = ["showed", "noshow"].map((status, index) => ({
      campaignName: "Camp A", date: "2026-09-10", eventId: `event_${index}`,
      startTime: "2026-09-10T10:00:00Z", locationId: "loc_1", status,
    }));
    const result = await createRepository(createFakeReader(rawEvents)).delivery() as { bookings: Row[] };
    expect(result.bookings).toHaveLength(2);
    expect(result.bookings.every(row => row.kind === "confirmed")).toBe(true);
    expect(rawEvents.map(row => row.status)).toEqual(["showed", "noshow"]);
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

describe("CEO Refresh Repository team() canonical EOD query handling with PGlite", () => {
  const SCHEMA_SQL = `
    CREATE TABLE public.cockpit_members (
      id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      auth_user_id text,
      email text,
      name text,
      roles text[],
      active boolean DEFAULT true,
      last_seen_at timestamptz,
      created_at timestamptz DEFAULT now()
    );

    CREATE TABLE public.cockpit_people (
      id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      name text NOT NULL,
      email text,
      role text,
      active boolean DEFAULT true,
      engagement text,
      added_at timestamptz DEFAULT now()
    );

    CREATE TABLE public.cockpit_eod_reports (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      role text NOT NULL,
      day date NOT NULL,
      submitted_at timestamptz NOT NULL,
      energy numeric,
      answers jsonb,
      computed jsonb,
      slack_ts text,
      source_system text,
      source_deployment text,
      source_id text,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now(),
      owner_user_id text,
      owner_email text,
      body text,
      stress numeric,
      source_row jsonb
    );
  `;

  test("PGlite execution verifies actual columns, identity priorities, deduplication, and fallbacks", async () => {
    const { PGlite } = await import("../../apps/media-buyer-cockpit/node_modules/@electric-sql/pglite");
    const db = new PGlite();
    await db.exec(SCHEMA_SQL);

    // Seed cockpit_members
    await db.exec(`
      INSERT INTO public.cockpit_members (id, auth_user_id, email, name, roles) VALUES
        (1, 'user-101', 'primary@mahara.co', 'Member User-ID Name', ARRAY['media_buyer']),
        (2, 'user-102', 'dupe@mahara.co', 'Member Dupe 1', ARRAY['csm']),
        (3, 'user-103', 'dupe@mahara.co', 'Member Dupe 2', ARRAY['csm']),
        (4, 'user-104', 'blank-member@mahara.co', '   ', ARRAY['media_buyer']),
        (5, 'user-diff', 'conflict@mahara.co', 'Member Correct Auth User', ARRAY['media_buyer']),
        (6, 'user-email-match', 'other@mahara.co', 'Member Wrong Email Person', ARRAY['csm']);
    `);

    // Seed cockpit_people
    await db.exec(`
      INSERT INTO public.cockpit_people (id, name, email, role, active) VALUES
        (1, 'People Sarah', 'sarah.people@mahara.co', 'Copywriter', true),
        (2, 'People Dupe 1', 'dupe-people@mahara.co', 'Designer', true),
        (3, 'People Dupe 2', 'dupe-people@mahara.co', 'Designer', true),
        (4, '   ', 'blank-people@mahara.co', 'Developer', true);
    `);

    // Seed cockpit_eod_reports
    // 1. owner_user_id takes priority over different owner_email
    // 2. normalized owner_email matches member
    // 3. normalized owner_email matches people fallback
    // 4. duplicate directory email returns deterministic one report one row
    // 5. blank member/people name falls back to source_row
    // 6. source_row.name fallback
    // 7. source_row.person fallback
    // 8. completely unresolved identity remains null
    await db.exec(`
      INSERT INTO public.cockpit_eod_reports (
        id, role, day, submitted_at, energy, owner_user_id, owner_email, source_row
      ) VALUES
        ('00000000-0000-0000-0000-000000000001', 'media_buyer', (now() AT TIME ZONE 'Asia/Kuwait')::date, now(), 5,
         'user-diff', 'other@mahara.co', '{"name": "Source Name"}'::jsonb),
        ('00000000-0000-0000-0000-000000000002', 'media_buyer', (now() AT TIME ZONE 'Asia/Kuwait')::date, now() - interval '1 minute', 4,
         NULL, '  PRIMARY@MAHARA.CO  ', '{"name": "Source Name"}'::jsonb),
        ('00000000-0000-0000-0000-000000000003', 'csm', (now() AT TIME ZONE 'Asia/Kuwait')::date, now() - interval '2 minutes', 3,
         NULL, ' SARAH.PEOPLE@MAHARA.CO ', '{"name": "Source Name"}'::jsonb),
        ('00000000-0000-0000-0000-000000000004', 'csm', (now() AT TIME ZONE 'Asia/Kuwait')::date, now() - interval '3 minutes', 3,
         NULL, 'dupe@mahara.co', '{"name": "Source Name"}'::jsonb),
        ('00000000-0000-0000-0000-000000000005', 'csm', (now() AT TIME ZONE 'Asia/Kuwait')::date, now() - interval '4 minutes', 4,
         NULL, 'dupe-people@mahara.co', '{"name": "Source Name"}'::jsonb),
        ('00000000-0000-0000-0000-000000000006', 'designer', (now() AT TIME ZONE 'Asia/Kuwait')::date, now() - interval '5 minutes', 2,
         NULL, 'blank-member@mahara.co', '{"name": "Source Name For Blank Member"}'::jsonb),
        ('00000000-0000-0000-0000-000000000007', 'designer', (now() AT TIME ZONE 'Asia/Kuwait')::date, now() - interval '6 minutes', 2,
         NULL, 'blank-people@mahara.co', '{"person": "Source Person For Blank People"}'::jsonb),
        ('00000000-0000-0000-0000-000000000008', 'developer', (now() AT TIME ZONE 'Asia/Kuwait')::date, now() - interval '7 minutes', 1,
         NULL, 'unregistered@mahara.co', '{"name": "Fallback Via Name"}'::jsonb),
        ('00000000-0000-0000-0000-000000000009', 'developer', (now() AT TIME ZONE 'Asia/Kuwait')::date, now() - interval '8 minutes', 1,
         NULL, NULL, '{"person": "Fallback Via Person"}'::jsonb),
        ('00000000-0000-0000-0000-000000000010', 'developer', (now() AT TIME ZONE 'Asia/Kuwait')::date, now() - interval '9 minutes', 1,
         NULL, 'unknown@mahara.co', '{}'::jsonb);
    `);

    let capturedEodQuery = "";
    const repo = createRepository(async (_proj, query) => {
      if (query.includes("cockpit_eod_reports")) {
        capturedEodQuery = query;
        const res = await db.query(query);
        return res.rows as Row[];
      }
      if (query.includes("cockpit_media_sources") || query.includes("cockpit_csm_sources")) {
        return [{ready:true,row_count:0,actual_count:0,source_snapshot_at:new Date().toISOString(),stamp_ms:Date.now(),rows:[]}];
      }
      return [];
    });

    const result = (await repo.team()) as { eods: Row[] };

    expect(capturedEodQuery).toBeDefined();
    expect(result.eods).toHaveLength(10);

    // 1. owner_user_id priority over owner_email
    expect(result.eods[0].name).toBe("Member Correct Auth User");
    // 2. normalized owner_email matched member
    expect(result.eods[1].name).toBe("Member User-ID Name");
    // 3. normalized owner_email matched people
    expect(result.eods[2].name).toBe("People Sarah");
    // 4. duplicate member email returns deterministic single row
    expect(result.eods[3].name).toBe("Member Dupe 1");
    // 5. duplicate people email returns deterministic single row
    expect(result.eods[4].name).toBe("People Dupe 1");
    // 6. blank member name falls back to source_row.name
    expect(result.eods[5].name).toBe("Source Name For Blank Member");
    // 7. blank people name falls back to source_row.person
    expect(result.eods[6].name).toBe("Source Person For Blank People");
    // 8. source_row.name fallback when email not in directory
    expect(result.eods[7].name).toBe("Fallback Via Name");
    // 9. source_row.person fallback when email is null
    expect(result.eods[8].name).toBe("Fallback Via Person");
    // 10. missing identity remains null
    expect(result.eods[9].name).toBeNull();

    // Verify row preservation
    for (const row of result.eods) {
      expect(row.day).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof row.at).toBe("number");
      expect(typeof row.role).toBe("string");
    }
    await db.close();
  });
});

describe("CEO Refresh Repository team() adChanges and comments handling", () => {
  function createTeamTestReader(opts: {
    adChanges?: Row[];
    adChangesCount?: number;
    comments?: Row[];
  }) {
    const snapshotDate = new Date().toISOString();
    const now = Date.now();

    return async (_project: string, query: string): Promise<Row[]> => {
      if (query.includes("cockpit_media_sources") || query.includes("cockpit_media_source_state")) {
        let rows: Row[] = [];
        let count = 0;
        if (query.includes("adChanges")) {
          rows = opts.adChanges ?? [];
          count = opts.adChangesCount ?? rows.length;
        } else if (query.includes("clientComments")) {
          rows = opts.comments ?? [];
          count = rows.length;
        }
        return [{
          ready: true,
          row_count: count,
          actual_count: count,
          source_snapshot_at: snapshotDate,
          stamp_ms: now,
          rows: JSON.stringify(rows),
        }];
      }
      if (query.includes("cockpit_csm_sources") || query.includes("cockpit_csm_source_state")) {
        return [{ ready: true, row_count: 0, actual_count: 0, source_snapshot_at: snapshotDate, stamp_ms: now, rows: "[]" }];
      }
      return [];
    };
  }

  test("adChanges: repeated copies of one Meta event across campaigns are deduplicated and capped at three campaigns", async () => {
    const now = Date.now();
    const eventTime = now - 100_000;
    const rawAdChanges = [
      {
        at: eventTime,
        actor: "Sarah MediaBuyer",
        eventType: "budget updated",
        objectName: "AdSet 1",
        campaignName: "Campaign Alpha",
        activityHash: "hash-evt-1",
      },
      {
        at: eventTime,
        actor: "Sarah MediaBuyer",
        eventType: "budget updated",
        objectName: "AdSet 1",
        campaignName: "Campaign Beta",
        activityHash: "hash-evt-1",
      },
      {
        at: eventTime,
        actor: "Sarah MediaBuyer",
        eventType: "budget updated",
        objectName: "AdSet 1",
        campaignName: "Campaign Gamma",
        activityHash: "hash-evt-1",
      },
      {
        at: eventTime,
        actor: "Sarah MediaBuyer",
        eventType: "budget updated",
        objectName: "AdSet 1",
        campaignName: "Campaign Delta", // 4th campaign, should be capped at 3
        activityHash: "hash-evt-1",
      },
      // Distinct event
      {
        at: eventTime + 1000,
        actor: "John Specialist",
        eventType: "targeting changed",
        objectName: "AdSet 2",
        campaignName: "Campaign Epsilon",
        activityHash: "hash-evt-2",
      },
    ];

    const repo = createRepository(createTeamTestReader({ adChanges: rawAdChanges, adChangesCount: 5 }));
    const result = (await repo.team()) as {
      adChanges: { at: number; actor: string; eventType: string; objectName: string | null; campaigns: string[] }[];
      adChangesRows: number;
    };

    expect(result.adChangesRows).toBe(5);
    expect(result.adChanges).toHaveLength(2);

    const firstEvent = result.adChanges.find(e => e.actor === "Sarah");
    expect(firstEvent).toBeDefined();
    expect(firstEvent?.eventType).toBe("budget updated");
    expect(firstEvent?.objectName).toBe("AdSet 1");
    expect(firstEvent?.campaigns).toEqual(["Campaign Alpha", "Campaign Beta", "Campaign Gamma"]);
    expect(firstEvent?.campaigns).toHaveLength(3);

    const secondEvent = result.adChanges.find(e => e.actor === "John");
    expect(secondEvent).toBeDefined();
    expect(secondEvent?.actor).toBe("John");
    expect(secondEvent?.campaigns).toEqual(["Campaign Epsilon"]);
  });

  test("adChanges: missing activityHash falls back to legacy composite key, and missing actor/Meta events are ignored", async () => {
    const now = Date.now();
    const eventTime = now - 200_000;
    const rawAdChanges = [
      // Legacy fallback: no activityHash
      {
        at: eventTime,
        actor: "Amr Marketer",
        eventType: "ad updated",
        objectName: "Creative 99",
        campaignName: "Camp 1",
      },
      // Duplicate of legacy fallback across campaign
      {
        at: eventTime,
        actor: "Amr Marketer",
        eventType: "ad updated",
        objectName: "Creative 99",
        campaignName: "Camp 2",
      },
      // Ignored: actor is Meta
      {
        at: eventTime,
        actor: "Meta",
        eventType: "ad updated",
        objectName: "Creative 99",
        campaignName: "Camp 3",
      },
      // Ignored: actor is missing
      {
        at: eventTime,
        actor: "",
        eventType: "ad updated",
        objectName: "Creative 99",
        campaignName: "Camp 4",
      },
      // Ignored: non-meaningful event
      {
        at: eventTime,
        actor: "Amr Marketer",
        eventType: "name updated",
        objectName: "Creative 99",
        campaignName: "Camp 5",
      },
    ];

    const repo = createRepository(createTeamTestReader({ adChanges: rawAdChanges }));
    const result = (await repo.team()) as {
      adChanges: { at: number; actor: string; eventType: string; objectName: string | null; campaigns: string[] }[];
    };

    expect(result.adChanges).toHaveLength(1);
    expect(result.adChanges[0].actor).toBe("Amr");
    expect(result.adChanges[0].campaigns).toEqual(["Camp 1", "Camp 2"]);
  });

  test("commentsToday: correctly partitions comments immediately either side of Kuwait midnight and excludes tomorrow", async () => {
    const kuwaitMidnightEpoch = (() => {
      const today = new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
      return new Date(`${today}T00:00:00Z`).getTime() - 3 * 3600_000;
    })();

    const justBeforeMidnight = kuwaitMidnightEpoch - 1000; // Yesterday in Kuwait
    const exactlyMidnight = kuwaitMidnightEpoch; // Today start in Kuwait
    const middayToday = kuwaitMidnightEpoch + 12 * 3600_000; // Today midday
    const endOfToday = kuwaitMidnightEpoch + 86_400_000 - 1; // 23:59:59.999 today
    const tomorrowStart = kuwaitMidnightEpoch + 86_400_000; // Tomorrow midnight in Kuwait
    const justAfterTomorrowStart = kuwaitMidnightEpoch + 86_400_000 + 1000; // Tomorrow in Kuwait

    const comments = [
      { by: "Yesterday@mahara.co", at: justBeforeMidnight, kind: "note", clientName: "Client A" },
      { by: "Ahmed@mahara.co", at: exactlyMidnight, kind: "brief", clientName: "Client B" },
      { by: "Khaled@mahara.co", at: middayToday, kind: "call", clientName: "Client C" },
      { by: "Zaid@mahara.co", at: endOfToday, kind: "note", clientName: "Client D" },
      { by: "Skipped@mahara.co", at: middayToday, kind: "skip", clientName: "Client E" },
      { by: "Tomorrow@mahara.co", at: tomorrowStart, kind: "note", clientName: "Client F" },
      { by: "Future@mahara.co", at: justAfterTomorrowStart, kind: "note", clientName: "Client G" },
    ];

    const repo = createRepository(createTeamTestReader({ comments }));
    const result = (await repo.team()) as {
      commentsToday: { by: string | null; at: number }[];
    };

    expect(result.commentsToday).toHaveLength(3);
    expect(result.commentsToday.map(c => c.by)).toEqual(["Ahmed", "Khaled", "Zaid"]);
    expect(result.commentsToday.find(c => c.at === justBeforeMidnight)).toBeUndefined();
    expect(result.commentsToday.find(c => c.at === tomorrowStart)).toBeUndefined();
    expect(result.commentsToday.find(c => c.at === justAfterTomorrowStart)).toBeUndefined();
  });

  test("commentsToday: rejects null, undefined, boolean, blank, nonfinite, and nonpositive timestamps", async () => {
    const invalidCases: unknown[] = [null, undefined, true, false, "", "   ", "abc", NaN, Infinity, -Infinity, 0, -100];

    for (const invalidAt of invalidCases) {
      const repo = createRepository(createTeamTestReader({
        comments: [{ by: "Sarah@mahara.co", at: invalidAt as number, kind: "note" }],
      }));
      await expect(repo.team()).rejects.toThrow("Canonical client comment has invalid timestamp");
    }
  });

  test("adChanges: rejects null, undefined, boolean, blank, nonfinite, and nonpositive timestamps instead of silently skipping", async () => {
    const invalidCases: unknown[] = [null, undefined, true, false, "", "   ", "invalid", NaN, Infinity, -Infinity, 0, -500];

    for (const invalidAt of invalidCases) {
      const repo = createRepository(createTeamTestReader({
        adChanges: [{
          at: invalidAt as number,
          actor: "Sarah MediaBuyer",
          eventType: "budget updated",
          objectName: "AdSet 1",
          campaignName: "Campaign Alpha",
        }],
      }));
      await expect(repo.team()).rejects.toThrow("Canonical Meta ad change has invalid timestamp");
    }
  });
});

