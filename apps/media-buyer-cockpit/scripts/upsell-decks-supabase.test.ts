/**
 * Offer decks on the decks' own engine (20261026v_upsell_offer_decks.sql,
 * docs/upsell-studio/BACKEND.md section 2): the md5 and constraint guards,
 * the onboarding and launch decks unchanged, every offer prep key, the price
 * rules, the 12 + 7 video slots, capture files and their read policy, and the
 * site verdict. On an isolated PostgreSQL with Supabase's default privileges
 * on, every upsell file applied twice. Every person and client is invented.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { migration } from "./lib/cockpitTestDb";
import {
  EMAILS,
  type Row,
  SEATS,
  TASKS,
  UPSELL_FILES,
  upsellHelpers,
  upsellTestDb,
  uuid,
} from "./lib/upsellTestDb";

const { CSM_A, CSM_A2, CSM_B, CSM_ALL, BUYER, CEO } = SEATS;
const { A, B } = TASKS;
let db: PGlite;
let h: ReturnType<typeof upsellHelpers>;

const SAVE = "SELECT public.cockpit_csm_deck_prep_save($1,$2,$3::jsonb) r";
const save = (who: string, task: string, deck: string, patch: unknown) =>
  h.one(who, SAVE, [task, deck, JSON.stringify(patch)]);
const refusedSave = (who: string, task: string, deck: string, patch: unknown) =>
  h.failure(who, SAVE, [task, deck, JSON.stringify(patch)]);
/** A day in Kuwait (UTC+3, no daylight saving), as the functions count days. */
const today = (days = 0) =>
  new Date(Date.now() + 3 * 3600_000 + days * 86400_000)
    .toISOString()
    .slice(0, 10);
const LOOM = "e2d83bffee614d9aa035d898d37d8989";
const VSAVE = `SELECT public.cockpit_csm_deck_video_save(p_deck => $1::text, p_slot_key => $2::text, p_lang => $3::text,
  p_url => $4::text, p_title => $5::text, p_duration_seconds => $6::integer, p_revision => $7::integer) r`;
const VCLEAR =
  "SELECT public.cockpit_csm_deck_video_clear(p_deck => $1::text, p_slot_key => $2::text, p_lang => $3::text, p_revision => $4::integer) r";
const VREAD = "SELECT public.cockpit_csm_deck_videos_read($1::text) r";
const CATALOG_SET =
  "SELECT public.cockpit_upsell_catalog_set($1,$2::jsonb,$3) r";
const revisionOf = async (offer: string) =>
  (
    await h.owner<{ revision: number }>(
      "SELECT revision FROM public.cockpit_upsell_catalog WHERE offer_key=$1",
      [offer],
    )
  )[0].revision;
const setList = async (offer: string, parts: Row[], extra: Row = {}) =>
  h.one(CEO, CATALOG_SET, [
    offer,
    JSON.stringify({ parts, ...extra }),
    await revisionOf(offer),
  ]);

beforeAll(async () => {
  db = await upsellTestDb({ through: "v" });
  h = upsellHelpers(db);
}, 60000);
afterAll(async () => {
  await db?.close();
});

describe("the guards", () => {
  test("the guard holds the live md5 and this file's own body md5 with LF and CRLF endings", async () => {
    const sql = migration(UPSELL_FILES.v);
    const fns = await h.owner<{
      n: string;
      lf: string;
      crlf: string;
    }>(`SELECT p.proname n, md5(p.prosrc) lf, md5(replace(p.prosrc, E'\\n', E'\\r\\n')) crlf
      FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN ('cockpit_csm_deck_prep_save','cockpit_csm_deck_video_slots',
      'cockpit_csm_deck_videos_read','cockpit_csm_deck_video_save','cockpit_csm_deck_video_clear')`);
    expect(fns.length).toBe(5);
    for (const f of fns) {
      expect(sql).toContain(f.lf);
      expect(sql).toContain(f.crlf);
    }
    for (const live of [
      "e6b8e4d80bd8dd30498ebc1b5ab92859",
      "9f670ba72f102080504a1a348d5c9309",
      "e645051690f2f32543e4da89beecb890",
      "eeaf74c7b6fd1ec12db44e26d59c6848",
      "df961267904ba26d2bb9e425fae40d92",
    ])
      expect(sql).toContain(live);
  });

  test("a changed body stops the file before it changes anything", async () => {
    await h.asOwner();
    await db.exec(
      `BEGIN; CREATE OR REPLACE FUNCTION public.cockpit_csm_deck_video_slots() RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = '' AS $$ SELECT ARRAY['launch:payments']::text[] $$;`,
    );
    let message = "";
    try {
      await db.exec(migration(UPSELL_FILES.v));
    } catch (e) {
      message = (e as Error).message;
    } finally {
      await db.exec("ROLLBACK");
    }
    expect(message).toMatch(
      /^cockpit_csm_deck_video_slots\(\) is not the definition this file was written against \(prosrc md5 [0-9a-f]{32}\)/,
    );
    expect(
      (
        await h.owner<{ r: string[] }>(
          "SELECT public.cockpit_csm_deck_video_slots() r",
        )
      )[0].r.length,
    ).toBe(19);
  });

  test("a changed deck check stops the file too", async () => {
    await h.asOwner();
    await db.exec(`BEGIN; ALTER TABLE public.cockpit_csm_deck_prep DROP CONSTRAINT cockpit_csm_deck_prep_deck_check;
      ALTER TABLE public.cockpit_csm_deck_prep ADD CONSTRAINT cockpit_csm_deck_prep_deck_check CHECK (deck IN ('onboarding','launch','blueprint'));`);
    let message = "";
    try {
      await db.exec(migration(UPSELL_FILES.v));
    } catch (e) {
      message = (e as Error).message;
    } finally {
      await db.exec("ROLLBACK");
    }
    expect(message).toContain(
      "cockpit_csm_deck_prep_deck_check is not the definition this file was written against",
    );
  });

  test("the widened checks take the seven offer decks and refuse offer_nope", async () => {
    const defs = await h.owner<{
      d: string;
    }>(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint
      WHERE conname IN ('cockpit_csm_deck_prep_deck_check','cockpit_csm_deck_videos_deck_check')`);
    for (const d of defs)
      expect(d.d).toBe(
        "CHECK (((deck = ANY (ARRAY['onboarding'::text, 'launch'::text])) OR (deck ~ '^offer_(website|second_campaign|seo_geo|smm|ugc|closer|cameraman)$'::text)))",
      );
    await h.asOwner();
    let message = "";
    try {
      await db.query(
        "INSERT INTO public.cockpit_csm_deck_prep(task_id,deck,overrides,updated_by) VALUES('taskA1','offer_nope','{}','x')",
      );
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("cockpit_csm_deck_prep_deck_check");
    message = "";
    try {
      await db.query(
        "INSERT INTO public.cockpit_csm_deck_videos(deck,slot_key,lang,updated_by,cleared_at) VALUES('offer_nope','demo','en','x',now())",
      );
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("cockpit_csm_deck_videos_deck_check");
    expect(
      await refusedSave(CSM_A, A, "offer_nope", { language: "en" }),
    ).toEqual({
      code: "P0001",
      message: "Choose the onboarding or the launch deck",
    });
    expect(
      await refusedSave(CSM_A, A, "blueprint", { language: "en" }),
    ).toEqual({
      code: "P0001",
      message: "Choose the onboarding or the launch deck",
    });
  });

  test("grants: replaced functions keep theirs; new tables and functions have theirs", async () => {
    const can = async (role: string, sig: string) =>
      (
        await h.owner<{ ok: boolean }>(
          "SELECT has_function_privilege($1,$2,'EXECUTE') ok",
          [role, sig],
        )
      )[0].ok;
    for (const sig of [
      "public.cockpit_csm_deck_prep_save(text,text,jsonb)",
      "public.cockpit_csm_deck_videos_read(text)",
      "public.cockpit_csm_deck_video_save(text,text,text,text,text,integer,integer)",
      "public.cockpit_csm_deck_video_clear(text,text,text,integer)",
    ])
      expect([
        await can("anon", sig),
        await can("authenticated", sig),
        await can("service_role", sig),
      ]).toEqual([false, true, false]);
    for (const sig of [
      "public.cockpit_csm_deck_video_slots()",
      "public.cockpit_csm_deck_video_slot_ok(text,text)",
    ])
      expect([
        await can("anon", sig),
        await can("authenticated", sig),
        await can("service_role", sig),
      ]).toEqual([false, false, false]);
    expect([
      await can("anon", "public.cockpit_upsell_file_purged(text,uuid[])"),
      await can(
        "authenticated",
        "public.cockpit_upsell_file_purged(text,uuid[])",
      ),
      await can(
        "service_role",
        "public.cockpit_upsell_file_purged(text,uuid[])",
      ),
    ]).toEqual([false, false, true]);
    for (const table of [
      "cockpit_upsell_files",
      "cockpit_upsell_wins",
      "cockpit_client_site_checks",
      "cockpit_upsell_pitches",
    ]) {
      const has = async (role: string, p: string) =>
        (
          await h.owner<{ ok: boolean }>(
            "SELECT has_table_privilege($1,$2,$3) ok",
            [role, `public.${table}`, p],
          )
        )[0].ok;
      for (const role of ["anon", "authenticated"])
        for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE"])
          expect(await has(role, p)).toBe(false);
      for (const p of ["SELECT", "INSERT", "UPDATE"])
        expect(await has("service_role", p)).toBe(true);
      for (const p of ["DELETE", "TRUNCATE"])
        expect(await has("service_role", p)).toBe(false);
      expect(
        (
          await h.owner<{ rls: boolean }>(
            "SELECT relrowsecurity rls FROM pg_class WHERE oid=$1::regclass",
            [`public.${table}`],
          )
        )[0].rls,
      ).toBe(true);
    }
    for (const seq of [
      "cockpit_upsell_wins_id_seq",
      "cockpit_client_site_checks_id_seq",
    ])
      for (const role of ["anon", "authenticated"])
        expect(
          (
            await h.owner<{ ok: boolean }>(
              "SELECT has_sequence_privilege($1,$2,'USAGE') ok",
              [role, `public.${seq}`],
            )
          )[0].ok,
        ).toBe(false);
    const triggers = await h.owner<{
      t: string;
    }>(`SELECT tgrelid::regclass::text || ':' || tgname t FROM pg_trigger WHERE NOT tgisinternal
      AND tgrelid IN ('public.cockpit_upsell_files'::regclass,'public.cockpit_upsell_wins'::regclass,'public.cockpit_upsell_pitches'::regclass,'public.cockpit_client_site_checks'::regclass) ORDER BY 1`);
    expect(triggers.map(t => t.t)).toEqual([
      "cockpit_upsell_files:cockpit_upsell_files_audit",
      "cockpit_upsell_pitches:cockpit_upsell_pitches_audit",
      "cockpit_upsell_wins:cockpit_upsell_wins_audit",
    ]);
  });
});

describe("onboarding and launch are unchanged", () => {
  test("prep: a launch key saves, an unknown key is refused, a stamp keeps its first time", async () => {
    const r = await save(CSM_A, A, "launch", { pain: "cost" });
    expect(r).toMatchObject({
      deck: "launch",
      overrides: { pain: "cost" },
      revision: 1,
      changed: true,
      updatedBy: EMAILS.CSM_A,
    });
    expect(
      await refusedSave(CSM_A, A, "launch", { presented_at: true }),
    ).toEqual({ code: "P0001", message: 'Prep does not keep "presented_at"' });
    expect(await refusedSave(CSM_A, A, "launch", { pain: "money" })).toEqual({
      code: "P0001",
      message: "pain must be one of: delays, design, cost",
    });
    const first = await save(CSM_A, A, "onboarding", {
      onboarding_presented_at: true,
    });
    const again = await save(CSM_A, A, "onboarding", {
      onboarding_presented_at: true,
    });
    expect(again.overrides.onboarding_presented_at).toBe(
      first.overrides.onboarding_presented_at,
    );
    expect(again.changed).toBe(false);
    expect(await refusedSave(CSM_A, A, "launch", {})).toEqual({
      code: "P0001",
      message: "Send the prep changes as named values",
    });
    expect(
      (
        await h.failure(CSM_A, SAVE, [
          B,
          "launch",
          JSON.stringify({ pain: "cost" }),
        ])
      ).message,
    ).toBe("That client is not on your access list");
  });

  test("videos: a CSM still saves and clears a launch slot; the messages are the same", async () => {
    const saved = await h.one(CSM_A, VSAVE, [
      "launch",
      "payments",
      "en",
      `https://www.loom.com/share/${LOOM}`,
      null,
      null,
      0,
    ]);
    expect(saved).toMatchObject({
      deck: "launch",
      slotKey: "payments",
      lang: "en",
      revision: 1,
      changed: true,
    });
    expect(
      await h.one(CSM_B, VCLEAR, ["launch", "payments", "en", 1]),
    ).toMatchObject({ cleared: true, revision: 2 });
    expect(
      await h.failure(CSM_A, VSAVE, [
        "launch",
        "demo",
        "en",
        `https://www.loom.com/share/${LOOM}`,
        null,
        null,
        0,
      ]),
    ).toEqual({
      code: "22023",
      message: "That video slot is not in the launch deck.",
    });
    expect(
      await h.failure(CSM_A, VSAVE, [
        "sales",
        "demo",
        "en",
        `https://www.loom.com/share/${LOOM}`,
        null,
        null,
        0,
      ]),
    ).toEqual({
      code: "22023",
      message: "Choose the onboarding or the launch deck.",
    });
    expect(await h.failure(CSM_A, VREAD, ["offer_nope"])).toEqual({
      code: "22023",
      message: "Choose the onboarding or the launch deck.",
    });
    const launch = await h.one(CSM_A, VREAD, ["launch"]);
    expect(launch.slots).toEqual([
      "launch:start-to-finish",
      "launch:testing",
      "launch:call-team",
      "launch:winning",
      "launch:portal-guide",
      "launch:calendar-hours",
      "launch:first-90-days",
      "launch:payments",
    ]);
  });
});

describe("the video slots", () => {
  test("the twelve in the same order, then one demo per offer in the written order", async () => {
    expect(
      (
        await h.owner<{ r: string[] }>(
          "SELECT public.cockpit_csm_deck_video_slots() r",
        )
      )[0].r,
    ).toEqual([
      "onboarding:welcome",
      "onboarding:meta-access",
      "onboarding:whatsapp-calendar",
      "onboarding:testing",
      "launch:start-to-finish",
      "launch:testing",
      "launch:call-team",
      "launch:winning",
      "launch:portal-guide",
      "launch:calendar-hours",
      "launch:first-90-days",
      "launch:payments",
      "offer_website:demo",
      "offer_second_campaign:demo",
      "offer_seo_geo:demo",
      "offer_smm:demo",
      "offer_cameraman:demo",
      "offer_ugc:demo",
      "offer_closer:demo",
    ]);
  });

  test("an offer's video: every CSM reads it, only the CEO saves or clears it", async () => {
    const empty = await h.one(CSM_A, VREAD, ["offer_website"]);
    expect(empty).toMatchObject({ rows: [], slots: ["offer_website:demo"] });
    const url = "https://fast.wistia.net/embed/iframe/abcdefghij";
    for (const who of [CSM_A, CSM_ALL])
      expect(
        await h.failure(who, VSAVE, [
          "offer_website",
          "demo",
          "en",
          url,
          "Your website",
          60,
          0,
        ]),
      ).toEqual({
        code: "42501",
        message: "Only the CEO changes an offer's video.",
      });
    expect(
      (
        await h.failure(BUYER, VSAVE, [
          "offer_website",
          "demo",
          "en",
          url,
          null,
          null,
          0,
        ])
      ).message,
    ).toBe("Active client-success access required");
    const en = await h.one(CEO, VSAVE, [
      "offer_website",
      "demo",
      "en",
      url,
      "Your website",
      60,
      0,
    ]);
    expect(en).toMatchObject({
      deck: "offer_website",
      slotKey: "demo",
      lang: "en",
      provider: "wistia",
      revision: 1,
      changed: true,
      updatedBy: EMAILS.CEO,
    });
    expect(
      (await h.one(CSM_B, VREAD, ["offer_website"])).rows.map(
        (r: Row) => r.url,
      ),
    ).toEqual([url]);
    expect(
      (await h.one(CSM_A, "SELECT public.cockpit_upsell_catalog_read() r"))
        .videos,
    ).toEqual([
      {
        deck: "offer_website",
        slotKey: "demo",
        lang: "en",
        provider: "wistia",
        url,
        embedUrl: `${url}?seo=false`,
        posterUrl: null,
        title: "Your website",
        durationSeconds: 60,
        revision: 1,
      },
    ]);
    expect(
      await h.failure(CSM_A, VCLEAR, ["offer_website", "demo", "en", 1]),
    ).toEqual({
      code: "42501",
      message: "Only the CEO changes an offer's video.",
    });
    expect(
      await h.one(CEO, VCLEAR, ["offer_website", "demo", "en", 1]),
    ).toMatchObject({ cleared: true, revision: 2 });
    expect(
      await h.failure(CEO, VSAVE, [
        "offer_website",
        "pitch",
        "en",
        url,
        null,
        null,
        0,
      ]),
    ).toEqual({
      code: "22023",
      message: "That video slot is not in the offer_website deck.",
    });
    // Put it back for the later blocks, in both languages.
    await h.one(CEO, VSAVE, [
      "offer_website",
      "demo",
      "en",
      url,
      "Your website",
      60,
      0,
    ]);
    await h.one(CEO, VSAVE, [
      "offer_website",
      "demo",
      "ar",
      "https://fast.wistia.net/embed/iframe/klmnopqrst",
      "موقعك",
      60,
      0,
    ]);
    const audits = (await h.audits("cockpit_csm_deck_videos")).filter(a =>
      a.entity_id.startsWith("offer_website"),
    );
    expect(audits.map(a => [a.action, a.actor_email])).toEqual([
      ["deck_video.save", EMAILS.CEO],
      ["deck_video.clear", EMAILS.CEO],
      ["deck_video.save", EMAILS.CEO],
      ["deck_video.save", EMAILS.CEO],
    ]);
  });
});

describe("capture files", () => {
  const RESERVE =
    "SELECT public.cockpit_upsell_file_reserve($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9::date,$10) r";
  const args = (
    request: string,
    task: string = A,
    extra: Partial<Record<string, unknown>> = {},
  ) => {
    const a = {
      kind: "capture",
      mime: "image/png",
      bytes: 2048,
      width: 1280,
      height: 720,
      name: "folder/their-site.png",
      on: today(-1),
      searched: "Kuwait City",
      ...extra,
    };
    return [
      request,
      task,
      a.kind,
      a.mime,
      a.bytes,
      a.width,
      a.height,
      a.name,
      a.on,
      a.searched,
    ];
  };
  let first: Row;

  test("reserve: one row per request id for the same seat and file; anything else is refused", async () => {
    first = await h.one(CSM_A, RESERVE, args(uuid(1)));
    expect(first).toMatchObject({
      kind: "capture",
      mime: "image/png",
      bytes: 2048,
      status: "uploading",
    });
    expect(first.path).toBe(`${A}/${first.id}.png`);
    expect(await h.one(CSM_A, RESERVE, args(uuid(1)))).toEqual(first);
    expect(await h.failure(CSM_A2, RESERVE, args(uuid(1)))).toEqual({
      code: "42501",
      message:
        "This request id belongs to a different file. Add the file again.",
    });
    expect(
      await h.failure(CSM_A, RESERVE, args(uuid(1), A, { bytes: 4096 })),
    ).toEqual({
      code: "42501",
      message:
        "This request id belongs to a different file. Add the file again.",
    });
    expect((await h.failure(CSM_A, RESERVE, args(uuid(2), B))).message).toBe(
      "That client is not on your access list",
    );
    const bad: [Partial<Record<string, unknown>>, string][] = [
      [{ kind: "logo" }, "A capture is the only kind of file here."],
      [{ mime: "image/gif" }, "Add a picture (JPG, PNG or WebP)."],
      [{ bytes: 0 }, "The picture is empty."],
      [
        { bytes: 10485761 },
        "The picture is over 10 MB. Export a smaller copy.",
      ],
      [{ width: 0 }, "The picture's size is not valid."],
      [
        { on: today(1) },
        "Give the day the screenshot was taken, today or in the last year.",
      ],
      [
        { on: null },
        "Give the day the screenshot was taken, today or in the last year.",
      ],
      [
        { searched: "x".repeat(81) },
        "Searched as is too long. Keep it to 80 characters.",
      ],
      // The deck and the proposal show it to the client.
      [
        { searched: "leads in Kuwait" },
        'Searched as: Says lead. Say enquiry or client. ("leads")',
      ],
    ];
    for (const [extra, message] of bad)
      expect(await h.failure(CSM_A, RESERVE, args(uuid(3), A, extra))).toEqual({
        code: "22023",
        message,
      });
    expect(
      (
        await h.owner(
          "SELECT 1 FROM public.cockpit_upsell_files WHERE request_id=$1",
          [uuid(3)],
        )
      ).length,
    ).toBe(0);
  });

  test("accept checks Storage's own size and type, and only the seat that started it finishes it", async () => {
    const ACCEPT = "SELECT public.cockpit_upsell_file_accept($1,$2::uuid) r";
    expect(await h.failure(CSM_A, ACCEPT, [A, first.id])).toEqual({
      code: "22023",
      message: "The picture did not arrive. Add it again.",
    });
    await h.putObject("cockpit-upsell-files", first.path, 9999, "image/png");
    expect(await h.failure(CSM_A, ACCEPT, [A, first.id])).toEqual({
      code: "22023",
      message:
        "The uploaded picture does not match what was reserved. Add it again.",
    });
    await h.owner(
      'UPDATE storage.objects SET metadata=\'{"size":2048,"mimetype":"image/png"}\' WHERE name=$1',
      [first.path],
    );
    expect(await h.failure(CSM_A2, ACCEPT, [A, first.id])).toEqual({
      code: "42501",
      message: "Only the person who started this upload can finish it.",
    });
    const ready = await h.one(CSM_A, ACCEPT, [A, first.id]);
    expect(ready).toMatchObject({
      id: first.id,
      status: "ready",
      fileName: "their-site.png",
      searchedAs: "Kuwait City",
      capturedOn: today(-1),
    });
    expect(await h.one(CSM_A, ACCEPT, [A, first.id])).toEqual(ready);
    expect((await h.failure(CSM_B, ACCEPT, [A, first.id])).message).toBe(
      "That client is not on your access list",
    );
  });

  test("the read policy: a seat sees the ready captures of its own clients only", async () => {
    const b = await h.capture(CSM_B, B, uuid(10));
    const pending = await h.one(CSM_A, RESERVE, args(uuid(11)));
    await h.putObject("cockpit-upsell-files", pending.path, 2048, "image/png");
    const seen = async (who: string) =>
      (
        await h.rows<{ name: string }>(
          who,
          "SELECT name FROM storage.objects WHERE bucket_id='cockpit-upsell-files' ORDER BY name",
        )
      ).map(r => r.name);
    expect(await seen(CSM_A)).toEqual([first.path]);
    expect(await seen(CSM_B)).toEqual([b.path]);
    expect((await seen(CSM_ALL)).sort()).toEqual([first.path, b.path].sort());
    expect(await seen(BUYER)).toEqual([]);
    const policies = await h.owner<{ policyname: string; cmd: string }>(
      "SELECT policyname, cmd FROM pg_policies WHERE schemaname='storage' AND tablename='objects' ORDER BY 1",
    );
    expect(policies.map(p => [p.policyname, p.cmd])).toEqual([
      ["cockpit_launch_ads_read", "SELECT"],
      ["cockpit_upsell_files_read", "SELECT"],
      ["other_bucket_read", "SELECT"],
    ]);
    const bucket = await h.owner(
      "SELECT * FROM storage.buckets WHERE id='cockpit-upsell-files'",
    );
    expect(bucket).toEqual([
      {
        id: "cockpit-upsell-files",
        name: "cockpit-upsell-files",
        public: false,
        file_size_limit: 10485760,
        allowed_mime_types: ["image/jpeg", "image/png", "image/webp"],
      },
    ]);
    for (const name of [
      null,
      "x",
      `${A}/../${first.id}.png`,
      `${B}/${first.id}.png`,
    ])
      expect(
        await h.one(
          CSM_A,
          "SELECT public.cockpit_upsell_object_allowed($1) r",
          [name],
        ),
      ).toBe(false);
  });

  test("update, read, remove, the stale list and the service key's purge", async () => {
    const UPDATE =
      "SELECT public.cockpit_upsell_file_update($1,$2::uuid,$3::jsonb) r";
    const u = await h.one(CSM_A, UPDATE, [
      A,
      first.id,
      JSON.stringify({
        caption: " Their site today ",
        searched_as: null,
        captured_on: today(-2),
      }),
    ]);
    expect(u).toMatchObject({
      caption: "Their site today",
      searchedAs: null,
      capturedOn: today(-2),
    });
    expect(
      await h.failure(CSM_A, UPDATE, [
        A,
        first.id,
        JSON.stringify({ kind: "logo" }),
      ]),
    ).toEqual({ code: "22023", message: 'A capture does not keep "kind".' });
    // A caption or a search a client could see goes through the copy check.
    for (const [patch, message] of [
      [
        { caption: "CPL went up" },
        'The caption: Names an ad metric like CPL or ROAS. Clients never see those. ("CPL")',
      ],
      [
        { searched_as: "خصم تصميم داخلي" },
        'Searched as: Offers a discount. Clients see one price, never a discount. ("خصم")',
      ],
    ] as const)
      expect(
        await h.failure(CSM_A, UPDATE, [A, first.id, JSON.stringify(patch)]),
      ).toEqual({ code: "22023", message });
    expect(
      (await h.one(CSM_A, "SELECT public.cockpit_upsell_files_read($1) r", [A]))
        .rows[0].caption,
    ).toBe("Their site today");
    expect(
      await h.failure(CSM_A, UPDATE, [
        A,
        first.id,
        JSON.stringify({ captured_on: today(2) }),
      ]),
    ).toEqual({
      code: "22023",
      message:
        "Give the day the screenshot was taken, today or in the last year.",
    });
    expect(
      (
        await h.one(CSM_A, "SELECT public.cockpit_upsell_files_read($1) r", [A])
      ).rows.map((r: Row) => r.id),
    ).toEqual([first.id]);
    const gone = await h.one(
      CSM_A,
      "SELECT public.cockpit_upsell_file_remove($1,$2::uuid) r",
      [A, first.id],
    );
    expect(gone.status).toBe("removed");
    expect(
      (
        await h.rows(
          CSM_A,
          "SELECT name FROM storage.objects WHERE bucket_id='cockpit-upsell-files'",
        )
      ).length,
    ).toBe(0);
    const stale = await h.one(
      CSM_A,
      "SELECT public.cockpit_upsell_files_stale($1) r",
      [A],
    );
    expect(stale).toEqual([{ id: first.id, path: first.path }]);
    expect(
      (
        await h.failure(
          CSM_A,
          "SELECT public.cockpit_upsell_file_purged($1,$2::uuid[])",
          [A, [first.id]],
        )
      ).message,
    ).toContain("permission denied");
    expect(
      await h.svc("SELECT public.cockpit_upsell_file_purged($1,$2::uuid[]) r", [
        B,
        [first.id],
      ]),
    ).toBe(0);
    expect(
      await h.svc("SELECT public.cockpit_upsell_file_purged($1,$2::uuid[]) r", [
        A,
        [first.id],
      ]),
    ).toBe(1);
    expect(
      await h.svc("SELECT public.cockpit_upsell_file_purged($1,$2::uuid[]) r", [
        A,
        [first.id],
      ]),
    ).toBe(0);
    expect(
      await h.one(CSM_A, "SELECT public.cockpit_upsell_files_stale($1) r", [A]),
    ).toEqual([]);
    const actions = (await h.audits("cockpit_upsell_files"))
      .filter(a => a.entity_id === first.id)
      .map(a => [a.action, a.actor_email]);
    expect(actions).toEqual([
      ["upsellFiles.reserve", EMAILS.CSM_A],
      ["upsellFiles.ready", EMAILS.CSM_A],
      ["upsellFiles.update", EMAILS.CSM_A],
      ["upsellFiles.remove", EMAILS.CSM_A],
      ["upsellFiles.purge", "postgres"],
    ]);
  });
});

describe("offer prep keys", () => {
  let cap1: Row;
  let cap2: Row;
  let still: Row;
  beforeAll(async () => {
    cap1 = await h.capture(CSM_A, A, uuid(20));
    cap2 = await h.capture(CSM_A, A, uuid(21));
    const ad = await h.one(
      CSM_A,
      "SELECT public.cockpit_csm_launch_ad_reserve($1::uuid,$2,'custom','image/jpeg',4096) r",
      [uuid(22), A],
    );
    await h.putObject("cockpit-launch-ads", ad.path, 4096, "image/jpeg");
    still = await h.one(
      CSM_A,
      "SELECT public.cockpit_csm_launch_ad_accept($1,$2::uuid) r",
      [A, ad.id],
    );
  });

  test("each key takes its value and normalises it", async () => {
    const ok: [string, unknown, unknown][] = [
      ["language", "ar", "ar"],
      ["dialect", "sa", "sa"],
      [
        "site_url",
        " https://acme-interiors.example/about ",
        "https://acme-interiors.example/about",
      ],
      ["site_thin", true, true],
      [
        "captures",
        () => [
          { id: cap1.id },
          { id: cap2.id, mark: { x: 0.1, y: 0.2, w: 0.5, h: 0.3 } },
        ],
        null,
      ],
      ["goal_pick", "goal90", "goal90"],
      ["goal_typed", "  Three villas by summer ", "Three villas by summer"],
      ["goal_typed_on", today(), today()],
      ["example_stills", () => [still.id], null],
      [
        "example_colors",
        ["#AABBCC", "#aabbcc", "#112233"],
        ["#aabbcc", "#112233"],
      ],
      ["opening_price", { build: 2000, care: 200 }, { build: 2000, care: 200 }],
      ["opening_reason", "Long-standing client", "Long-standing client"],
      [
        "project_value",
        {
          amount: 18000,
          currency: "KWD",
          from: "onboarding",
          said_on: "2026-09-03",
        },
        {
          amount: 18000,
          currency: "KWD",
          from: "onboarding",
          said_on: "2026-09-03",
        },
      ],
      [
        "payment_link",
        "https://whop.com/checkout/plan_abc123/",
        "https://whop.com/checkout/plan_abc123/",
      ],
      [
        "payment_link",
        "https://invoice.ecom.io/i/AB12-xy",
        "https://invoice.ecom.io/i/AB12-xy",
      ],
      [
        "client_asked",
        { words: "  Can you build our site? ", on: today(-3) },
        { words: "Can you build our site?", on: today(-3) },
      ],
      ["hidden_slides", ["saw", "saw", "get"], ["saw", "get"]],
    ];
    for (const [key, raw, want] of ok) {
      const value = typeof raw === "function" ? (raw as () => unknown)() : raw;
      const r = await save(CSM_A, A, "offer_website", { [key]: value });
      expect({ key, got: r.overrides[key] }).toEqual({
        key,
        got: want ?? value,
      });
    }
    const r = await save(CSM_A, A, "offer_website", {
      goal_typed: null,
      example_colors: [],
    });
    expect(r.overrides.goal_typed).toBeUndefined();
    expect(r.overrides.example_colors).toBeUndefined();
  });

  test("each key refuses what it must, with a plain sentence", async () => {
    const other = await h.capture(CSM_B, B, uuid(30));
    const bad: [string, unknown, string][] = [
      ["language", "fr", "The language must be one of: en, ar."],
      ["dialect", "eg", "The dialect must be one of: kw, sa."],
      [
        "site_url",
        "http://acme.example",
        "Paste the site's https address, without a user, a port or an IP address.",
      ],
      [
        "site_url",
        "https://me@acme.example",
        "Paste the site's https address, without a user, a port or an IP address.",
      ],
      [
        "site_url",
        "https://acme.example:8443/",
        "Paste the site's https address, without a user, a port or an IP address.",
      ],
      [
        "site_url",
        "https://10.0.0.1/",
        "Paste the site's https address, without a user, a port or an IP address.",
      ],
      [
        "site_url",
        "javascript:alert(1)",
        "Paste the site's https address, without a user, a port or an IP address.",
      ],
      [
        "site_url",
        `https://a.example/${"x".repeat(290)}`,
        "The site address is too long. Keep it to 300 characters.",
      ],
      ["site_thin", "yes", "site_thin is a yes or no."],
      [
        "captures",
        [{ id: uuid(999) }],
        "Pick one of this client's own captures.",
      ],
      [
        "captures",
        () => [{ id: other.id }],
        "Pick one of this client's own captures.",
      ],
      [
        "captures",
        () => [{ id: cap1.id }, { id: cap1.id }],
        "Each capture once.",
      ],
      [
        "captures",
        () => [
          { id: cap1.id },
          { id: cap2.id },
          { id: cap1.id },
          { id: cap2.id },
        ],
        "Pick at most 3 captures.",
      ],
      [
        "captures",
        () => [{ id: cap1.id, mark: { x: 0.1, y: 0.1, w: 0.03, h: 0.5 } }],
        "The gap mark sits inside the capture and is at least 4% of it each way.",
      ],
      [
        "captures",
        () => [{ id: cap1.id, mark: { x: 0.6, y: 0.1, w: 0.5, h: 0.5 } }],
        "The gap mark sits inside the capture and is at least 4% of it each way.",
      ],
      [
        "captures",
        () => [{ id: cap1.id, note: "x" }],
        "Each capture is its id and an optional mark.",
      ],
      [
        "goal_pick",
        "nope",
        "The goal must be one of: goal90, goal12_24, challenges, why, typed.",
      ],
      [
        "goal_typed",
        "x".repeat(301),
        "The typed goal is too long. Keep it to 300 characters.",
      ],
      ["goal_typed_on", today(1), "The goal's date is today or earlier."],
      [
        "goal_typed_on",
        "2026-13-01",
        "The goal's date must be a date (YYYY-MM-DD).",
      ],
      [
        "example_stills",
        [uuid(998)],
        "Pick one of this client's own pictures from the ads tray.",
      ],
      ["example_colors", ["red"], "A colour is #rrggbb."],
      [
        "opening_price",
        { build: 2000 },
        "Type the opening price for the website build and the website care plan.",
      ],
      [
        "opening_price",
        { build: 2000, care: 200, hosting: 5 },
        "Type the opening price for the website build and the website care plan.",
      ],
      [
        "opening_price",
        { build: 0, care: 200 },
        "A price is a dollar amount from 1 to 1,000,000, with at most two decimals.",
      ],
      [
        "opening_price",
        2000,
        "The opening price names each part and its dollars.",
      ],
      [
        "opening_reason",
        "x".repeat(141),
        "The reason is too long. Keep it to 140 characters.",
      ],
      [
        "project_value",
        { amount: 18000, currency: "EUR", from: "typed" },
        "The currency must be one of: KWD, SAR, AED, QAR, BHD, OMR, USD.",
      ],
      [
        "project_value",
        { amount: 0, currency: "KWD", from: "typed" },
        "The typical project is an amount above 0 and up to 100,000,000.",
      ],
      [
        "project_value",
        { amount: 1, currency: "KWD" },
        "A typical project is its amount, its currency and where it came from.",
      ],
      [
        "payment_link",
        "https://evil.example/checkout/abc",
        "Paste a Whop checkout link or an ecom invoice link.",
      ],
      [
        "payment_link",
        "https://whop.com/checkout/a b/",
        "Paste a Whop checkout link or an ecom invoice link.",
      ],
      [
        "client_asked",
        { words: "Please", on: today(-31) },
        "The date they asked is within the last 30 days.",
      ],
      [
        "client_asked",
        { words: "ok", on: today() },
        "What they said is too short. Use at least 3 characters.",
      ],
      [
        "client_asked",
        { words: "Please do it" },
        "Client asked is their words and the date they said them.",
      ],
      [
        "hidden_slides",
        ["Bad Id"],
        "hidden_slides must be a list of slide ids",
      ],
      ["pain", "cost", 'Prep does not keep "pain"'],
    ];
    for (const [key, raw, message] of bad) {
      const value = typeof raw === "function" ? (raw as () => unknown)() : raw;
      expect({
        key,
        value,
        got: await refusedSave(CSM_A, A, "offer_website", { [key]: value }),
      }).toEqual({ key, value, got: { code: "22023", message } });
    }
  });

  test("the OFFER_PREP_KEYS line names exactly the keys the function keeps", () => {
    const sql = migration(UPSELL_FILES.v);
    const line = sql.match(/^-- OFFER_PREP_KEYS: (.+)$/m)?.[1].split(" ") ?? [];
    const body =
      sql.match(
        /FUNCTION public\.cockpit_csm_offer_prep_value[\s\S]*?END \$\$;/,
      )?.[0] ?? "";
    const keys = [
      ...body.matchAll(/WHEN '([a-z0-9_]+)'(?:, '([a-z0-9_]+)')? THEN/g),
    ].flatMap(m => [m[1], m[2]].filter(Boolean));
    expect(line.length).toBe(18);
    expect([...keys].sort()).toEqual([...line].sort());
  });

  test("presented_at keeps its first stamp until it is cleared", async () => {
    const one = await save(CSM_A, A, "offer_website", { presented_at: true });
    expect(one.overrides.presented_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
    const two = await save(CSM_A, A, "offer_website", {
      presented_at: "2020-01-01T00:00:00Z",
    });
    expect(two.overrides.presented_at).toBe(one.overrides.presented_at);
    expect(
      (await save(CSM_A, A, "offer_website", { presented_at: false })).overrides
        .presented_at,
    ).toBeUndefined();
  });

  test("the price rules: below a set list needs a reason; a locked offer opens at its list or not at all", async () => {
    await save(CSM_A, A, "offer_website", {
      opening_price: null,
      opening_reason: null,
    });
    await setList("website", [
      { key: "build", amount: 2000 },
      { key: "care", amount: 200 },
    ]);
    expect(
      await refusedSave(CSM_A, A, "offer_website", {
        opening_price: { build: 1800, care: 200 },
      }),
    ).toEqual({
      code: "22023",
      message:
        "Website build: below the list price (2,000). Add a one-line reason.",
    });
    const below = await save(CSM_A, A, "offer_website", {
      opening_price: { build: 1800, care: 200 },
      opening_reason: "Second site for them",
    });
    expect(below.overrides).toMatchObject({
      opening_price: { build: 1800, care: 200 },
      opening_reason: "Second site for them",
    });
    expect(
      await refusedSave(CSM_A, A, "offer_website", { opening_reason: null }),
    ).toEqual({
      code: "22023",
      message:
        "Website build: below the list price (2,000). Add a one-line reason.",
    });
    expect(
      (
        await save(CSM_A, A, "offer_website", {
          opening_price: { build: 2400, care: 250 },
          opening_reason: null,
        })
      ).overrides.opening_reason,
    ).toBeUndefined();
    // A later list change does not block an unrelated save.
    await setList("website", [{ key: "build", amount: 2500 }]);
    expect(
      (await save(CSM_A, A, "offer_website", { language: "en" })).changed,
    ).toBe(true);
    await setList("website", [{ key: "build", amount: 2000 }]);
    // SEO and GEO is locked, with its list blank.
    expect(
      await refusedSave(CSM_A, A, "offer_seo_geo", {
        opening_price: { program: 5000 },
      }),
    ).toEqual({
      code: "22023",
      message: "This price is locked. The CEO sets it on Money > Offers.",
    });
    await setList("seo_geo", [{ key: "program", amount: 5000 }]);
    expect(
      await refusedSave(CSM_A, A, "offer_seo_geo", {
        opening_price: { program: 4000 },
        opening_reason: "Asked for less",
      }),
    ).toEqual({
      code: "22023",
      message: "SEO and GEO, 90 days: locked at the list price (5,000).",
    });
    expect(
      await refusedSave(CSM_A, A, "offer_seo_geo", {
        opening_price: { program: 6000 },
      }),
    ).toEqual({
      code: "22023",
      message: "SEO and GEO, 90 days: locked at the list price (5,000).",
    });
    expect(
      (
        await save(CSM_A, A, "offer_seo_geo", {
          opening_price: { program: 5000 },
        })
      ).overrides.opening_price,
    ).toEqual({ program: 5000 });
    // No list (not locked): any price, no reason needed.
    expect(
      (await save(CSM_A, A, "offer_smm", { opening_price: { monthly: 700 } }))
        .changed,
    ).toBe(true);
    await setList("seo_geo", [{ key: "program", amount: null }]);
  });

  test("the prep audit is the decks' own, with the keys each save changed", async () => {
    const rows = (await h.audits("cockpit_csm_deck_prep")).filter(
      a => a.entity_id === `${A}:offer_website`,
    );
    expect(rows.length).toBeGreaterThan(10);
    expect(
      rows.every(
        a => a.action === "deckPrep.save" && a.source_app === "client-success",
      ),
    ).toBe(true);
    expect(rows.at(-1)!.metadata.changed).toEqual(["language"]);
  });
});

describe("site checks and the verdict", () => {
  const RECORD =
    "SELECT public.cockpit_client_site_check_record($1,$2,$3,$4::jsonb) r";
  const record = (
    task: string,
    url: string,
    source: string,
    status: string,
    who: string = CSM_B,
  ) =>
    h.one(who, RECORD, [
      task,
      url,
      source,
      JSON.stringify({
        status,
        httpStatus: status === "ok" ? 200 : null,
        finalUrl: url,
        title: "Beta",
      }),
    ]);
  const site = async (task: string, who: string = CSM_B) =>
    (
      await h.one(
        who,
        "SELECT public.cockpit_csm_offer_sources($1,'website') r",
        [task],
      )
    ).site;
  const shiftFirst = (hours: number) =>
    h.owner(
      `UPDATE public.cockpit_client_site_checks SET checked_at = checked_at - make_interval(hours => $1)
    WHERE id = (SELECT min(id) FROM public.cockpit_client_site_checks WHERE task_id='taskB1')`,
      [hours],
    );

  test("none on file, then not checked once prep names a site", async () => {
    expect(await site(B)).toMatchObject({
      verdict: "none_on_file",
      urls: [],
      checks: [],
      disagree: false,
      instagramOnly: false,
      note: "No website on file: not on the card, the onboarding form or prep.",
    });
    await save(CSM_B, B, "offer_website", {
      site_url: "https://beta-build.example",
    });
    expect(await site(B)).toMatchObject({
      verdict: "not_checked",
      urls: [{ url: "https://beta-build.example", from: "prep" }],
      note: "Site not checked yet. Run the site check.",
    });
  });

  test("one failure is failing; two 19 hours apart still failing; 21 hours apart is broken; a working check is ok", async () => {
    let r = await record(B, "https://beta-build.example", "prep", "dns");
    expect(r.check).toMatchObject({
      url: "https://beta-build.example",
      source: "prep",
      status: "dns",
      httpStatus: null,
      title: "Beta",
    });
    expect(r.verdict.verdict).toBe("failing");
    await shiftFirst(19);
    r = await record(B, "https://beta-build.example", "prep", "parked");
    expect(r.verdict.verdict).toBe("failing");
    await shiftFirst(2);
    expect((await site(B)).verdict).toBe("broken");
    expect((await site(B)).note).toMatch(/^No working site, checked twice, /);
    // A refused check counts for neither.
    r = await record(B, "https://beta-build.example", "prep", "refused");
    expect(r.verdict.verdict).toBe("broken");
    r = await record(B, "https://beta-build.example/", "prep", "ok");
    expect(r.verdict).toMatchObject({ verdict: "ok" });
    expect(r.verdict.checks.length).toBe(4);
    // A failure after the working check starts again.
    r = await record(B, "https://beta-build.example", "prep", "timeout");
    expect(r.verdict.verdict).toBe("failing");
  });

  test("at most 6 checks a client an hour; bad input is refused", async () => {
    await record(B, "https://beta-build.example", "prep", "timeout");
    await record(B, "https://beta-build.example", "prep", "timeout");
    expect(
      await h.failure(CSM_B, RECORD, [
        B,
        "https://beta-build.example",
        "prep",
        JSON.stringify({ status: "ok" }),
      ]),
    ).toEqual({
      code: "22023",
      message: "Checked 6 times this hour. Try again later.",
    });
    expect(
      await h.failure(CSM_A, RECORD, [
        A,
        "ftp://acme.example",
        "card",
        JSON.stringify({ status: "ok" }),
      ]),
    ).toEqual({
      code: "22023",
      message: "Check a site's http or https address.",
    });
    expect(
      await h.failure(CSM_A, RECORD, [
        A,
        "https://acme.example",
        "instagram",
        JSON.stringify({ status: "ok" }),
      ]),
    ).toEqual({
      code: "22023",
      message: "Say where the address came from: card, onboarding or prep.",
    });
    expect(
      await h.failure(CSM_A, RECORD, [
        A,
        "https://acme.example",
        "card",
        JSON.stringify({ status: "great" }),
      ]),
    ).toEqual({
      code: "22023",
      message: "The check's status is not one the site check knows.",
    });
    expect(
      (
        await h.failure(CSM_A, RECORD, [
          B,
          "https://acme.example",
          "card",
          JSON.stringify({ status: "ok" }),
        ])
      ).message,
    ).toBe("That client is not on your access list");
    expect((await h.audits("cockpit_client_site_checks")).length).toBe(0);
  });

  test("the card and the onboarding form: one address when they agree, flagged when they do not, and Instagram only", async () => {
    const a = await site(A, CSM_A);
    expect(a.urls).toEqual([
      { url: "https://acme-interiors.example", from: "card" },
      { url: "https://acme-interiors.example/about", from: "prep" },
    ]);
    expect(a.disagree).toBe(false);
    await h.owner(
      "UPDATE public.editor_clients SET website='https://other-firm.example' WHERE task_id=$1",
      [A],
    );
    expect((await site(A, CSM_A)).disagree).toBe(true);
    expect((await site(A, CSM_A)).note).toContain(
      "The card and the onboarding form give different sites.",
    );
    await h.owner(
      "UPDATE public.editor_clients SET website='https://www.instagram.com/acme' WHERE task_id=$1",
      [A],
    );
    await h.owner(
      "UPDATE public.cockpit_client_onboarding SET links = links - 'website' WHERE clickup_task_id=$1",
      [A],
    );
    await save(CSM_A, A, "offer_website", { site_url: null });
    expect(await site(A, CSM_A)).toMatchObject({
      instagramOnly: true,
      verdict: "not_checked",
    });
    await h.owner(
      "UPDATE public.editor_clients SET website='https://acme-interiors.example' WHERE task_id=$1",
      [A],
    );
    await h.owner(
      `UPDATE public.cockpit_client_onboarding SET links = links || '{"website":"https://acme-interiors.example/"}' WHERE clickup_task_id=$1`,
      [A],
    );
  });
});


test("capture caps share a client lock before either count and preserve idempotent retries at the limit", async () => {
  // PGlite is one backend, so it cannot interleave independent transactions.
  // Check the installed lock boundary, then exercise both caps through the RPC.
  const body = (await h.owner<{body:string}>("SELECT prosrc body FROM pg_proc WHERE oid='public.cockpit_upsell_file_reserve(uuid,text,text,text,bigint,integer,integer,text,date,text)'::regprocedure"))[0].body;
  const requestLock = body.indexOf("PERFORM pg_advisory_xact_lock(hashtextextended('cockpit_upsell_files:' || p_request_id::text, 0));");
  const clientLock = body.indexOf("PERFORM pg_advisory_xact_lock(hashtextextended('cockpit_upsell_files:client:' || p_task_id, 0));");
  expect(requestLock).toBeGreaterThan(-1); expect(clientLock).toBeGreaterThan(requestLock);
  expect(clientLock).toBeLessThan(body.indexOf('SELECT count(*) INTO v_pending'));
  expect(clientLock).toBeLessThan(body.indexOf('SELECT count(*) INTO v_count'));

  const task='captureCapFixture';
  await h.owner("INSERT INTO public.cockpit_csm_sources(table_name,source_id,client_names,data,source_snapshot_at) SELECT table_name,$2,client_names,jsonb_set(jsonb_set(data,'{taskId}',to_jsonb($2::text)),'{_id}',to_jsonb($2::text)),source_snapshot_at FROM public.cockpit_csm_sources WHERE table_name='clients' AND data->>'taskId'=$1",[A,task]);
  // This fixture is part of the same complete source snapshot as the copied row.
  await h.owner(`UPDATE public.cockpit_csm_source_state st
    SET row_count=(SELECT count(*) FROM public.cockpit_csm_sources s
      WHERE s.table_name=st.table_name AND s.source_snapshot_at=st.source_snapshot_at)
    WHERE st.table_name='clients'`);
  const seed=async(n:number,status:'uploading'|'ready')=>h.owner(`INSERT INTO public.cockpit_upsell_files(id,request_id,task_id,kind,status,storage_path,mime,bytes,captured_on,created_by,created_by_email,ready_at)
    SELECT id,gen_random_uuid(),$1,'capture',$3,$1||'/'||id||'.png','image/png',2048,public.cockpit_upsell_today(),$4::uuid,$5,CASE WHEN $3='ready' THEN now() END
    FROM (SELECT gen_random_uuid() id FROM generate_series(1,$2::int)) f`,[task,n,status,CEO,EMAILS.CEO]);
  const reserve="SELECT public.cockpit_upsell_file_reserve($1::uuid,$2,'capture','image/png',2048,1280,720,'cap.png',(now() AT TIME ZONE 'Asia/Kuwait')::date,NULL) r";
  await seed(19,'uploading');
  const twentieth=await h.one(CEO,reserve,[uuid(9500),task]);
  expect(await h.one(CEO,reserve,[uuid(9500),task])).toEqual(twentieth);
  expect((await h.failure(CEO,reserve,[uuid(9501),task])).message).toContain('20 unfinished uploads');
  await h.owner("UPDATE public.cockpit_upsell_files SET status='ready',ready_at=now() WHERE task_id=$1",[task]);
  await seed(79,'ready');
  await h.one(CEO,reserve,[uuid(9502),task]);
  expect((await h.failure(CEO,reserve,[uuid(9503),task])).message).toContain('100 captures already');
  expect((await h.owner<{n:number}>("SELECT count(*)::int n FROM public.cockpit_upsell_files WHERE task_id=$1",[task]))[0].n).toBe(100);
});
