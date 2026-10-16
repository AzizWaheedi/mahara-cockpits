// EOD Radar (2026-10-15): supabase/migrations/20261015210000_eod_radar.sql
// against PGlite, on top of the roster, the hours tables and the EOD outbox.
// Made-up times; the people carry the roster's names so the migration's Slack
// id seed can be checked. No provider is called.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { migration } from "./lib/cockpitTestDb";
import {
  ADMIN,
  actor,
  CEO,
  call,
  hoursTestDb,
  MEMBER,
  owner,
  service,
} from "./lib/hoursTestDb";

let db: PGlite;
const ids: Record<string, number> = {};

const TABLES = [
  "cockpit_eod_channels",
  "cockpit_eod_radar",
  "cockpit_eod_radar_settings",
  "cockpit_eod_radar_slack_ids",
  "cockpit_eod_radar_digests",
  "cockpit_eod_radar_receipts",
];
const SERVICE = [
  "cockpit_eod_radar_inputs(jsonb)",
  "cockpit_eod_radar_apply(jsonb)",
  "cockpit_eod_radar_digest_claim(jsonb)",
  "cockpit_eod_radar_digest_result(jsonb)",
];
const INTERNAL = [
  "cockpit_eod_radar_require_service()",
  "cockpit_eod_radar_now()",
  "cockpit_eod_radar_day(timestamptz)",
  "cockpit_eod_radar_try_date(text)",
  "cockpit_eod_radar_window(text,text,integer)",
  "cockpit_eod_radar_settings_json()",
  "cockpit_eod_radar_channel_of(text)",
  "cockpit_eod_radar_people(date,date)",
  "cockpit_eod_radar_kick()",
];

/** Stand the radar's clock at a Kuwait wall-clock time. */
async function at(kuwait: string) {
  await owner(db);
  await db.query("SELECT set_config('test.now',$1,false)", [
    `${kuwait.replace(" ", "T")}:00+03:00`,
  ]);
}
async function person(
  name: string,
  role: string,
  extra: {
    email?: string;
    endedOn?: string;
    pausedOn?: string;
    engagement?: string;
    active?: boolean;
  } = {},
) {
  await owner(db);
  const r = await db.query<{ id: number }>(
    "insert into cockpit_people(name,email,role,engagement,active,started_on,ended_on,paused_on,added_by) values($1,$2,$3,$4,$5,'2026-01-01',$6,$7,'tests') returning id",
    [
      name,
      extra.email ?? null,
      role,
      extra.engagement ?? "staff",
      extra.active ?? true,
      extra.endedOn ?? null,
      extra.pausedOn ?? null,
    ],
  );
  ids[name] = Number(r.rows[0].id);
  return ids[name];
}
async function svc(fn: string, p: unknown) {
  await service(db);
  return call(db, fn, p) as Promise<Record<string, any>>;
}
async function refused(fn: () => Promise<unknown>, code: string) {
  let caught: { code?: string; message?: string } | null = null;
  try {
    await fn();
  } catch (e) {
    caught = e as { code?: string };
  }
  expect(caught?.code).toBe(code);
  return caught?.message ?? "";
}
async function read(who: string, from = "2026-10-12", to = "2026-10-14") {
  await actor(db, who);
  return (
    await db.query<{ r: Record<string, any> }>(
      "select public.cockpit_eod_radar_read($1::date,$2::date) r",
      [from, to],
    )
  ).rows[0].r;
}
async function auditCount(action: string) {
  await owner(db);
  return Number(
    (
      await db.query<{ n: number }>(
        "select count(*)::int n from cockpit_audit_log where action=$1",
        [action],
      )
    ).rows[0].n,
  );
}
const row = (
  personId: number,
  day: string,
  status: string,
  extra: Record<string, unknown> = {},
) => ({ personId, day, status, channel: "C09R4QJCZ5Y", posts: 0, ...extra });

beforeAll(async () => {
  db = await hoursTestDb();
  await owner(db);
  await db.exec(migration("20260922a_eod_outbox.sql"));
  await db.exec(migration("20260927b_eod_delivery_claims.sql"));
  // On the roster before the radar arrives, so the Slack id seed finds them.
  await person("Lama Harb", "Call centre agent", {
    email: "lama@tests.invalid",
  });
  await person("Ali", "Video editor");
  await person("Nada Al Saed", "Media buyer", { email: "nada@tests.invalid" });
  await owner(db);
  await db.exec(migration("20261015210000_eod_radar.sql"));
  // The clock seam: the tests stand at a fixed moment.
  await db.exec(`CREATE OR REPLACE FUNCTION public.cockpit_eod_radar_now() RETURNS timestamptz LANGUAGE sql STABLE SET search_path='' AS
    $$ SELECT current_setting('test.now')::timestamptz $$;`);
  await person("Muhammed Burhan", "Systems manager", {
    email: "muhammed@tests.invalid",
  });
  await person("The CEO", "CEO", { email: "ceo@tests.invalid" });
  await person("Info MM", "Bot", { engagement: "bot" });
  await person("Ops Lead", "Operations lead");
  await person("Gone Closer", "Closer", {
    endedOn: "2026-10-12",
    active: false,
  });
  await person("Paused Setter", "B2B setter", { pausedOn: "2026-10-13" });
  await person("Leave Editor", "Video editor");
  await owner(db);
  await db.query(
    "insert into cockpit_time_accounts(provider,external_id,status,person_id,link_method) values('timetastic','tt-1','active',$1,'manual')",
    [ids["Leave Editor"]],
  );
  await db.query(`insert into cockpit_timetastic_bookings(booking_id,tt_user_id,leave_type_id,leave_type_name,status,start_at,start_type,end_at,end_type,booking_unit) values
    ('b-full','tt-1','lt','Annual leave','Approved','2026-10-12T00:00:00','Morning','2026-10-12T00:00:00','Afternoon','Days'),
    ('b-half','tt-1','lt','Annual leave','Approved','2026-10-13T00:00:00','Afternoon','2026-10-13T00:00:00','Afternoon','Days'),
    ('b-pending','tt-1','lt','Sick leave','Pending','2026-10-14T00:00:00','Morning','2026-10-14T00:00:00','Afternoon','Days')`);
  await db.query(`insert into eod_outbox(role,day,person,slack_id,channel,body,status,slack_ts,sent_at) values
    ('media_buyer','2026-10-13','Nada','U0AJQ8P1ACF','C0AQ2LD0PL1','x','sent','1791970614.176209',now()),
    ('media_buyer','2026-10-14','Nada','U0AJQ8P1ACF','C0AQ2LD0PL1','x','failed',null,null)`);
  await at("2026-10-14 21:00");
});

afterAll(async () => {
  await db?.close();
});

describe("tables and grants", () => {
  test("row security on; browsers get nothing; the service key reads, and writes only its receipts", async () => {
    await owner(db);
    for (const t of TABLES) {
      const r = await db.query<{ rls: boolean }>(
        "select relrowsecurity rls from pg_class where oid=$1::regclass",
        [`public.${t}`],
      );
      expect(r.rows[0].rls).toBe(true);
      for (const role of ["anon", "authenticated"])
        for (const priv of ["SELECT", "INSERT", "UPDATE", "DELETE"])
          expect(
            (
              await db.query<{ ok: boolean }>(
                "select has_table_privilege($1,$2,$3) ok",
                [role, `public.${t}`, priv],
              )
            ).rows[0].ok,
          ).toBe(false);
      expect(
        (
          await db.query<{ ok: boolean }>(
            "select has_table_privilege('service_role',$1,'SELECT') ok",
            [`public.${t}`],
          )
        ).rows[0].ok,
      ).toBe(true);
      for (const priv of ["UPDATE", "DELETE"])
        expect(
          (
            await db.query<{ ok: boolean }>(
              "select has_table_privilege('service_role',$1,$2) ok",
              [`public.${t}`, priv],
            )
          ).rows[0].ok,
        ).toBe(false);
      const insert = (
        await db.query<{ ok: boolean }>(
          "select has_table_privilege('service_role',$1,'INSERT') ok",
          [`public.${t}`],
        )
      ).rows[0].ok;
      expect(insert).toBe(t === "cockpit_eod_radar_receipts");
    }
  });

  test("every function: exactly one role, or none", async () => {
    await owner(db);
    const can = async (role: string, fn: string) =>
      (
        await db.query<{ ok: boolean }>(
          "select has_function_privilege($1,$2,'EXECUTE') ok",
          [role, `public.${fn}`],
        )
      ).rows[0].ok;
    for (const fn of SERVICE) {
      expect(await can("service_role", fn)).toBe(true);
      for (const role of ["anon", "authenticated"])
        expect(await can(role, fn)).toBe(false);
    }
    for (const fn of INTERNAL)
      for (const role of ["anon", "authenticated", "service_role"])
        expect(await can(role, fn)).toBe(false);
    expect(
      await can("authenticated", "cockpit_eod_radar_read(date,date)"),
    ).toBe(true);
    expect(await can("anon", "cockpit_eod_radar_read(date,date)")).toBe(false);
    expect(await can("service_role", "cockpit_eod_radar_read(date,date)")).toBe(
      false,
    );
  });

  test("a browser session cannot call the service RPCs", async () => {
    await actor(db, CEO);
    await refused(
      () => db.query("select public.cockpit_eod_radar_inputs('{}'::jsonb)"),
      "42501",
    );
  });

  test("reminders and strikes cannot be switched on", async () => {
    await owner(db);
    await refused(
      () => db.query("update cockpit_eod_radar_settings set reminders_on=true"),
      "23514",
    );
    await refused(
      () => db.query("update cockpit_eod_radar_settings set strikes_on=true"),
      "23514",
    );
    const s = (
      await db.query<Record<string, unknown>>(
        "select digest_on, reminders_on, strikes_on, to_char(late_at,'HH24:MI') late, to_char(closeout_at,'HH24:MI') closeout, lookback_days from cockpit_eod_radar_settings",
      )
    ).rows[0];
    expect(s).toEqual({
      digest_on: true,
      reminders_on: false,
      strikes_on: false,
      late: "22:00",
      closeout: "23:00",
      lookback_days: 2,
    });
  });

  test("seeds: nine role patterns; Slack ids for the people already on the roster, matched by name", async () => {
    await owner(db);
    expect(
      Number(
        (
          await db.query<{ n: number }>(
            "select count(*)::int n from cockpit_eod_channels",
          )
        ).rows[0].n,
      ),
    ).toBe(9);
    const seeded = (
      await db.query<{ person_id: number; slack_user_id: string }>(
        "select person_id, slack_user_id from cockpit_eod_radar_slack_ids order by person_id",
      )
    ).rows;
    expect(seeded).toEqual([
      { person_id: ids["Lama Harb"], slack_user_id: "U09SF7GUEHY" },
      { person_id: ids.Ali, slack_user_id: "U0C69400F1U" },
      { person_id: ids["Nada Al Saed"], slack_user_id: "U0AJQ8P1ACF" },
    ]);
  });
});

describe("the CEO's read", () => {
  test("refused to signed-out and ordinary members, open to the CEO and admins", async () => {
    await refused(() => read(null as unknown as string), "42501");
    await refused(() => read(MEMBER), "42501");
    expect((await read(CEO)).settings).toMatchObject({
      remindersOn: false,
      strikesOn: false,
      digestOn: true,
    });
    expect((await read(ADMIN)).people.length).toBeGreaterThan(0);
  });

  test("who is on the radar, and who has no EOD channel", async () => {
    const r = await read(CEO);
    const names = r.people.map((p: { name: string }) => p.name);
    expect(names).toContain("Lama Harb");
    expect(names).not.toContain("The CEO");
    expect(names).not.toContain("Info MM");
    expect(names).not.toContain("Gone Closer");
    expect(r.notTracked.map((p: { name: string }) => p.name)).toEqual([
      "Ops Lead",
    ]);
    expect(
      r.people.find((p: { name: string }) => p.name === "Nada Al Saed"),
    ).toMatchObject({
      channel: "C0AQ2LD0PL1",
      channelName: "media-eods",
      slackLinked: true,
    });
  });

  test("a window is real days, in order, at most 62, never in the future", async () => {
    await refused(() => read(CEO, "2026-10-14", "2026-10-12"), "22023");
    await refused(() => read(CEO, "2026-07-01", "2026-10-14"), "22023");
    await refused(() => read(CEO, "2026-10-14", "2026-10-16"), "22023");
  });
});

describe("a run's inputs", () => {
  test("the default window is today's working day and the lookback before it", async () => {
    await at("2026-10-15 02:00");
    const i = await svc("cockpit_eod_radar_inputs", {});
    expect([i.today, i.from, i.to]).toEqual([
      "2026-10-14",
      "2026-10-12",
      "2026-10-14",
    ]);
    await at("2026-10-14 21:00");
  });

  test("off days, leave and the cockpit's sent EODs", async () => {
    const i = await svc("cockpit_eod_radar_inputs", {
      from: "2026-10-09",
      to: "2026-10-14",
    });
    const days = (name: string) =>
      Object.fromEntries(
        i.people
          .find((p: { name: string }) => p.name === name)
          .days.map(
            (d: { day: string; off: string | null; leave: string | null }) => [
              d.day,
              d.off ?? d.leave,
            ],
          ),
      );
    expect(days("Lama Harb")["2026-10-09"]).toBe("friday");
    expect(days("Lama Harb")["2026-10-10"]).toBeNull();
    expect(days("Gone Closer")["2026-10-12"]).toBeNull();
    expect(days("Gone Closer")["2026-10-13"]).toBe("ended");
    expect(days("Paused Setter")["2026-10-13"]).toBe("paused");
    const leave = days("Leave Editor");
    expect(leave["2026-10-12"]).toBe("Annual leave");
    expect(leave["2026-10-13"]).toBeNull(); // an afternoon only still owes an EOD
    expect(leave["2026-10-14"]).toBe("Sick leave (pending approval)");
    expect(i.people.map((p: { name: string }) => p.name)).not.toContain(
      "Ops Lead",
    );
    expect(i.outbox).toEqual([
      expect.objectContaining({
        day: "2026-10-13",
        person: "Nada",
        slackTs: "1791970614.176209",
      }),
    ]);
    expect(i.channels).toHaveLength(5);
  });
});

describe("a run's inputs: the CSM's outbox channel", () => {
  test("a row that names its channel (#eods-csms) comes back as the channel's id", async () => {
    await owner(db);
    await db.query(`insert into eod_outbox(role,day,person,slack_id,channel,body,status,slack_ts,sent_at) values
      ('csm','2026-10-12','Rasem Abdel All','U0C5JHUCTPG','#eods-csms','x','sent','1791826200.000100',now())`);
    const i = await svc("cockpit_eod_radar_inputs", {
      from: "2026-10-12",
      to: "2026-10-12",
    });
    expect(i.outbox).toEqual([
      expect.objectContaining({
        role: "csm",
        channel: "C09RQS2TFST",
        slackTs: "1791826200.000100",
      }),
    ]);
    await owner(db);
    await db.query("delete from eod_outbox where role='csm'");
  });
});

describe("writing a run", () => {
  test("rows are upserted once; a second identical run changes nothing; each run leaves one audit row", async () => {
    const before = await auditCount("eod_radar.run");
    const p = {
      from: "2026-10-12",
      to: "2026-10-14",
      ok: true,
      note: "Read 5 of 5",
      channels: [{ id: "C09R4QJCZ5Y", name: "eods-csr", ok: true }],
      rows: [
        row(ids["Lama Harb"], "2026-10-13", "late", {
          postedAt: "2026-10-13T19:30:00Z",
          creditedBy: "submitted_by",
          lateMinutes: 30,
          slackTs: "1791925800.000100",
        }),
        row(ids["Lama Harb"], "2026-10-14", "pending"),
      ],
    };
    expect(await svc("cockpit_eod_radar_apply", p)).toMatchObject({
      ok: true,
      rows: 2,
      changed: 2,
    });
    expect(await svc("cockpit_eod_radar_apply", p)).toMatchObject({
      ok: true,
      rows: 2,
      changed: 0,
    });
    expect(await auditCount("eod_radar.run")).toBe(before + 2);
    await owner(db);
    const sync = (
      await db.query<{
        ok: boolean;
        note: string;
        detail: Record<string, any>;
      }>(
        "select ok, note, detail from cockpit_sync_state where key='eod-radar'",
      )
    ).rows[0];
    expect(sync).toMatchObject({ ok: true, note: "Read 5 of 5" });
    expect(sync.detail.counts).toEqual({ late: 1, pending: 1 });
    const r = await read(CEO);
    const lama = r.people.find((x: { name: string }) => x.name === "Lama Harb");
    expect(
      lama.days.map((d: { day: string; status: string }) => [d.day, d.status]),
    ).toEqual([
      ["2026-10-13", "late"],
      ["2026-10-14", "pending"],
    ]);
    expect(r.sync).toMatchObject({ ok: true });
  });

  test("nobody is missed while a channel was not read, or before the closeout", async () => {
    await at("2026-10-14 23:30");
    const unread = {
      from: "2026-10-12",
      to: "2026-10-14",
      ok: false,
      channels: [
        {
          id: "C09R4QJCZ5Y",
          name: "eods-csr",
          ok: false,
          error: "missing_scope",
        },
      ],
      rows: [row(ids["Lama Harb"], "2026-10-14", "missed")],
    };
    expect(
      await refused(() => svc("cockpit_eod_radar_apply", unread), "22023"),
    ).toContain("not read");
    await at("2026-10-14 22:30");
    const early = {
      from: "2026-10-12",
      to: "2026-10-14",
      ok: true,
      channels: [],
      rows: [row(ids["Lama Harb"], "2026-10-14", "missed")],
    };
    expect(
      await refused(() => svc("cockpit_eod_radar_apply", early), "22023"),
    ).toContain("closeout");
    await at("2026-10-14 23:30");
    expect(await svc("cockpit_eod_radar_apply", early)).toMatchObject({
      ok: true,
      changed: 1,
    });
    await at("2026-10-14 21:00");
  });

  test("a row outside the window, for a stranger, twice for one day, or on time with no post is refused", async () => {
    const base = {
      from: "2026-10-13",
      to: "2026-10-14",
      ok: true,
      channels: [],
    };
    await refused(
      () =>
        svc("cockpit_eod_radar_apply", {
          ...base,
          rows: [row(ids["Lama Harb"], "2026-10-12", "pending")],
        }),
      "22023",
    );
    await refused(
      () =>
        svc("cockpit_eod_radar_apply", {
          ...base,
          rows: [row(999999, "2026-10-13", "pending")],
        }),
      "22023",
    );
    await refused(
      () =>
        svc("cockpit_eod_radar_apply", {
          ...base,
          rows: [
            row(ids["Lama Harb"], "2026-10-13", "pending"),
            row(ids["Lama Harb"], "2026-10-13", "off"),
          ],
        }),
      "22023",
    );
    await refused(
      () =>
        svc("cockpit_eod_radar_apply", {
          ...base,
          rows: [row(ids["Lama Harb"], "2026-10-13", "on_time")],
        }),
      "23514",
    );
  });

  test("a found Slack id replaces the old one; a refused lookup keeps it", async () => {
    await svc("cockpit_eod_radar_apply", {
      from: "2026-10-14",
      to: "2026-10-14",
      ok: true,
      channels: [],
      rows: [],
      slackIds: [
        {
          personId: ids["Muhammed Burhan"],
          slackUserId: "U0AS90SHMH8",
          state: "ok",
        },
        {
          personId: ids["Lama Harb"],
          slackUserId: null,
          state: "refused",
          note: "missing_scope",
        },
      ],
    });
    await owner(db);
    const got = (
      await db.query<{
        person_id: number;
        slack_user_id: string;
        source: string;
        state: string;
      }>(
        "select person_id, slack_user_id, source, state from cockpit_eod_radar_slack_ids where person_id = any($1) order by person_id",
        [[ids["Lama Harb"], ids["Muhammed Burhan"]]],
      )
    ).rows;
    expect(got).toEqual([
      {
        person_id: ids["Lama Harb"],
        slack_user_id: "U09SF7GUEHY",
        source: "migration",
        state: "refused",
      },
      {
        person_id: ids["Muhammed Burhan"],
        slack_user_id: "U0AS90SHMH8",
        source: "lookup",
        state: "ok",
      },
    ]);
  });
});

describe("the closeout post, once a day", () => {
  test("not before the closeout, not with the digest off", async () => {
    await at("2026-10-14 22:59");
    expect(
      await svc("cockpit_eod_radar_digest_claim", {
        day: "2026-10-14",
        text: "EOD Radar",
      }),
    ).toEqual({ claimed: false, reason: "early" });
    await at("2026-10-14 23:01");
    await owner(db);
    await db.query("update cockpit_eod_radar_settings set digest_on=false");
    expect(
      await svc("cockpit_eod_radar_digest_claim", {
        day: "2026-10-14",
        text: "EOD Radar",
      }),
    ).toEqual({ claimed: false, reason: "off" });
    await owner(db);
    await db.query("update cockpit_eod_radar_settings set digest_on=true");
  });

  test("claimed once; a second run is told it is done; posted is recorded with its ts", async () => {
    await at("2026-10-14 23:01");
    const first = await svc("cockpit_eod_radar_digest_claim", {
      day: "2026-10-14",
      text: "EOD Radar, Wed 14 Oct: 1 on time",
    });
    expect(first).toMatchObject({
      claimed: true,
      channel: "C0B5TL9H370",
      attempt: 1,
    });
    expect(
      await svc("cockpit_eod_radar_digest_claim", {
        day: "2026-10-14",
        text: "again",
      }),
    ).toEqual({ claimed: false, reason: "done", state: "sending" });
    await refused(
      () =>
        svc("cockpit_eod_radar_digest_result", {
          day: "2026-10-14",
          state: "posted",
        }),
      "22023",
    );
    expect(
      await svc("cockpit_eod_radar_digest_result", {
        day: "2026-10-14",
        state: "posted",
        ts: "1791997503.000100",
      }),
    ).toEqual({ ok: true });
    expect(
      await svc("cockpit_eod_radar_digest_claim", {
        day: "2026-10-14",
        text: "again",
      }),
    ).toEqual({ claimed: false, reason: "done", state: "posted" });
    expect(
      await svc("cockpit_eod_radar_digest_result", {
        day: "2026-10-14",
        state: "failed",
      }),
    ).toMatchObject({ ok: false });
    expect(await auditCount("eod_radar.digest_claim")).toBe(1);
    expect((await read(CEO)).digests[0]).toMatchObject({
      day: "2026-10-14",
      state: "posted",
      slackTs: "1791997503.000100",
    });
  });

  test("a refused post may be tried again, three times in all; an unknown one never", async () => {
    await at("2026-10-14 23:30");
    for (let i = 1; i <= 3; i++) {
      expect(
        await svc("cockpit_eod_radar_digest_claim", {
          day: "2026-10-13",
          text: "EOD Radar, Tue 13 Oct",
        }),
      ).toMatchObject({ claimed: true, attempt: i });
      await svc("cockpit_eod_radar_digest_result", {
        day: "2026-10-13",
        state: "failed",
        error: "not_in_channel",
      });
    }
    expect(
      await svc("cockpit_eod_radar_digest_claim", {
        day: "2026-10-13",
        text: "x",
      }),
    ).toEqual({ claimed: false, reason: "done", state: "failed" });
    await at("2026-10-15 23:30");
    expect(
      await svc("cockpit_eod_radar_digest_claim", {
        day: "2026-10-15",
        text: "x",
      }),
    ).toMatchObject({ claimed: true });
    await svc("cockpit_eod_radar_digest_result", {
      day: "2026-10-15",
      state: "unknown",
      error: "no answer",
    });
    expect(
      await svc("cockpit_eod_radar_digest_claim", {
        day: "2026-10-15",
        text: "x",
      }),
    ).toEqual({ claimed: false, reason: "done", state: "unknown" });
  });

  test("a claim left sending for 10 minutes turns unknown and is never sent again", async () => {
    await at("2026-10-16 23:30");
    expect(
      await svc("cockpit_eod_radar_digest_claim", {
        day: "2026-10-16",
        text: "x",
      }),
    ).toMatchObject({ claimed: true });
    await owner(db);
    await db.query(
      "update cockpit_eod_radar_digests set claimed_at = now() - interval '11 minutes' where day='2026-10-16'",
    );
    expect(
      await svc("cockpit_eod_radar_digest_claim", {
        day: "2026-10-16",
        text: "x",
      }),
    ).toEqual({ claimed: false, reason: "done", state: "unknown" });
  });

  test("an old day is not posted", async () => {
    await at("2026-10-17 23:30");
    expect(
      await svc("cockpit_eod_radar_digest_claim", {
        day: "2026-10-10",
        text: "x",
      }),
    ).toEqual({ claimed: false, reason: "stale" });
    await at("2026-10-14 21:00");
  });
});

describe("the half-hour kick", () => {
  test("without the vault secret it starts nothing and says why", async () => {
    await owner(db);
    expect(
      (
        await db.query<{ r: number | null }>(
          "select public.cockpit_eod_radar_kick() r",
        )
      ).rows[0].r,
    ).toBeNull();
    const s = (
      await db.query<{ ok: boolean; note: string }>(
        "select ok, note from cockpit_sync_state where key='eod-radar-kick'",
      )
    ).rows[0];
    expect(s).toEqual({
      ok: false,
      note: "The vault has no cockpit_sync_secret, so EOD Radar was not started. Add it to the vault.",
    });
  });

  test("applying the file twice is safe", async () => {
    await owner(db);
    await db.exec(migration("20261015210000_eod_radar.sql"));
    expect(
      Number(
        (
          await db.query<{ n: number }>(
            "select count(*)::int n from cockpit_eod_channels",
          )
        ).rows[0].n,
      ),
    ).toBe(9);
    expect(
      Number(
        (
          await db.query<{ n: number }>(
            "select count(*)::int n from cockpit_eod_radar_settings",
          )
        ).rows[0].n,
      ),
    ).toBe(1);
  });
});
