/**
 * The upsell studio's catalog, settings, client copy check and audit
 * (20261026u_upsell_catalog.sql, docs/upsell-studio/BACKEND.md section 1), on
 * an isolated PostgreSQL with Supabase's default privileges on. The file is
 * applied twice. Every person and client is invented.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { migration } from "./lib/cockpitTestDb";
import {
  EMAILS,
  type Row,
  SEATS,
  UPSELL_FILES,
  upsellHelpers,
  upsellTestDb,
} from "./lib/upsellTestDb";

const { CSM_A, CSM_B, CSM_ALL, BUYER, SALES, CEO, GONE, UNCONFIRMED } = SEATS;
let db: PGlite;
let h: ReturnType<typeof upsellHelpers>;

const READ = "SELECT public.cockpit_upsell_catalog_read() r";
const SET = "SELECT public.cockpit_upsell_catalog_set($1,$2::jsonb,$3) r";
const SETTING = "SELECT public.cockpit_upsell_setting_set($1,$2) r";
const problems = async (text: string, moneyOk = false): Promise<Row[]> =>
  h.one(CSM_A, "SELECT public.cockpit_client_copy_problems($1,$2) r", [
    text,
    moneyOk,
  ]);
const rules = async (text: string, moneyOk = false) =>
  (await problems(text, moneyOk)).map(p => p.rule);
const blocking = async (text: string, moneyOk = false) =>
  (await problems(text, moneyOk)).filter(p => p.block).map(p => p.rule);

beforeAll(async () => {
  db = await upsellTestDb({ through: "u" });
  h = upsellHelpers(db);
}, 60000);
afterAll(async () => {
  await db?.close();
});

describe("the seed", () => {
  test("seven offers in the written order, every amount blank, the doc's prices as hints", async () => {
    const r = await h.one(CSM_A, READ);
    expect(r.rows.map((x: Row) => x.offerKey)).toEqual([
      "website",
      "second_campaign",
      "seo_geo",
      "smm",
      "cameraman",
      "ugc",
      "closer",
    ]);
    expect(r.rows.map((x: Row) => x.sort)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    const by = Object.fromEntries(r.rows.map((x: Row) => [x.offerKey, x]));
    const parts = (k: string) =>
      by[k].parts.map((p: Row) => [p.key, p.cadence, p.amount, p.hint]);
    expect(parts("website")).toEqual([
      ["build", "one_time", null, 2000],
      ["care", "monthly", null, 200],
    ]);
    expect(parts("second_campaign")).toEqual([
      ["monthly", "monthly", null, 500],
    ]);
    expect(parts("seo_geo")).toEqual([["program", "per_90_days", null, 5000]]);
    expect(parts("smm")).toEqual([["monthly", "monthly", null, 1000]]);
    expect(parts("cameraman")).toEqual([["day", "per_day", null, 800]]);
    expect(parts("ugc")).toEqual([["package", "one_time", null, 3500]]);
    expect(parts("closer")).toEqual([
      ["placement", "one_time", null, 4000],
      ["management", "monthly", null, 750],
    ]);
    expect(by.seo_geo).toMatchObject({
      locked: true,
      splitAllowed: true,
      splitParts: [2500, 2500],
    });
    for (const k of [
      "website",
      "second_campaign",
      "smm",
      "cameraman",
      "ugc",
      "closer",
    ])
      expect(by[k]).toMatchObject({
        locked: false,
        splitAllowed: false,
        splitParts: null,
      });
    expect(by.closer.minMonths).toBe(3);
    expect(by.website.waitsOn).toBeNull();
    expect(by.second_campaign.waitsOn).toBe(
      "Deck and video follow the website.",
    );
    expect(by.seo_geo.waitsOn).toBe(
      "Needs a delivery owner, a fulfilment list and proof.",
    );
    expect(by.smm.waitsOn).toBe(
      "Needs a delivery owner, a fulfilment list and proof.",
    );
    expect(by.cameraman.waitsOn).toBe(
      "Needs a cameraman listed for the client's city.",
    );
    expect(by.ugc.waitsOn).toBe("Needs real UGC videos we produced.");
    expect(by.closer.waitsOn).toBe("Needs a named recruiter.");
    for (const x of r.rows)
      expect(x).toMatchObject({
        copy: {},
        revision: 1,
        updatedBy: "migration",
      });
    expect(r.settings).toEqual({
      whatsappNumber: null,
      validDays: 30,
      doorLive: false,
    });
    expect(r.videos).toEqual([]);
    expect(r.isCeo).toBe(false);
    expect((await h.one(CEO, READ)).isCeo).toBe(true);
  });

  test("the seed wrote one audit row per row, and the second apply wrote none", async () => {
    const cat = await h.audits("cockpit_upsell_catalog");
    expect(cat.length).toBe(7);
    expect(
      cat.every(
        a =>
          a.action === "upsellCatalog.seed" &&
          a.before === null &&
          a.source_app === "client-success" &&
          a.metadata.op === "INSERT",
      ),
    ).toBe(true);
    const settings = await h.audits("cockpit_upsell_settings");
    expect(settings.map(a => [a.action, a.entity_id]).sort()).toEqual([
      ["upsellSettings.seed", "door_live"],
      ["upsellSettings.seed", "valid_days"],
    ]);
    await db.exec(migration(UPSELL_FILES.u));
    expect((await h.audits("cockpit_upsell_catalog")).length).toBe(7);
  });
});

describe("tables and grants", () => {
  test("row security on, no browser privileges, and the service key selects, inserts and updates only", async () => {
    for (const table of ["cockpit_upsell_catalog", "cockpit_upsell_settings"]) {
      const has = async (role: string, p: string) =>
        (
          await h.owner<{ ok: boolean }>(
            "SELECT has_table_privilege($1,$2,$3) ok",
            [role, `public.${table}`, p],
          )
        )[0].ok;
      for (const role of ["anon", "authenticated"])
        for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE"])
          expect(await has(role, p)).toBe(false);
      for (const p of ["SELECT", "INSERT", "UPDATE"])
        expect(await has("service_role", p)).toBe(true);
      for (const p of ["DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"])
        expect(await has("service_role", p)).toBe(false);
      expect(
        (
          await h.owner<{ rls: boolean }>(
            "SELECT relrowsecurity rls FROM pg_class WHERE oid=$1::regclass",
            [`public.${table}`],
          )
        )[0].rls,
      ).toBe(true);
      expect(
        (await h.owner("SELECT 1 FROM pg_policies WHERE tablename=$1", [table]))
          .length,
      ).toBe(0);
      expect(
        (await h.failure(CSM_A, `SELECT * FROM public.${table}`)).message,
      ).toContain("permission denied");
    }
  });

  test("every function in the file: definer with search_path '', and the ACL of its kind", async () => {
    const fns = await h.owner<{
      sig: string;
      definer: boolean;
      config: string[] | null;
      vol: string;
    }>(`
      SELECT p.oid::regprocedure::text sig, p.prosecdef definer, p.proconfig config, p.provolatile vol FROM pg_proc p
       WHERE p.pronamespace='public'::regnamespace AND (p.proname LIKE 'cockpit_upsell%' OR p.proname = 'cockpit_client_copy_problems')`);
    const browser = [
      "cockpit_upsell_catalog_read",
      "cockpit_upsell_catalog_set",
      "cockpit_upsell_setting_set",
    ];
    // The table CHECKs call these, so the service key may run them.
    const checks = [
      "cockpit_upsell_usd_ok",
      "cockpit_upsell_parts_ok",
      "cockpit_upsell_split_ok",
      "cockpit_upsell_copy_text_ok",
      "cockpit_upsell_copy_ok",
    ];
    expect(fns.length).toBe(19);
    for (const fn of fns) {
      const name = fn.sig.split("(")[0].replace(/^public\./, "");
      expect(fn.config).toContain('search_path=""');
      const can = async (role: string) =>
        (
          await h.owner<{ ok: boolean }>(
            "SELECT has_function_privilege($1,$2,'EXECUTE') ok",
            [role, fn.sig],
          )
        )[0].ok;
      if (name === "cockpit_client_copy_problems") {
        expect(fn.definer).toBe(false);
        expect(fn.vol).toBe("i");
        expect([
          await can("anon"),
          await can("authenticated"),
          await can("service_role"),
        ]).toEqual([false, true, true]);
        continue;
      }
      expect(fn.definer).toBe(true);
      expect(await can("anon")).toBe(false);
      expect({ name, service: await can("service_role") }).toEqual({
        name,
        service: checks.includes(name),
      });
      expect(await can("authenticated")).toBe(browser.includes(name));
    }
    // PUBLIC holds nothing either.
    const pub = await h.owner<{
      n: number;
    }>(`SELECT count(*)::int n FROM pg_proc p, aclexplode(p.proacl) a
      WHERE p.pronamespace='public'::regnamespace AND (p.proname LIKE 'cockpit_upsell%' OR p.proname='cockpit_client_copy_problems') AND a.grantee = 0`);
    expect(pub[0].n).toBe(0);
    // The relied-on functions are there with their signatures.
    for (const sig of [
      "cockpit_is_ceo()",
      "cockpit_csm_actor()",
      "cockpit_csm_client_gate(text)",
      "cockpit_pay_usd_per(text)",
      "cockpit_csm_deck_video_parse(text)",
      "cockpit_csm_launch_ad_reserve(uuid,text,text,text,bigint,integer,integer,numeric,text,text,bigint)",
      "cockpit_csm_launch_ad_accept(text,uuid)",
    ])
      expect(
        (await h.owner("SELECT to_regprocedure($1) r", [`public.${sig}`]))[0].r,
      ).not.toBeNull();
  });

  test("the audit trigger is on both tables", async () => {
    const t = await h.owner<{ tgname: string }>(
      `SELECT tgname FROM pg_trigger WHERE tgrelid IN ('public.cockpit_upsell_catalog'::regclass,'public.cockpit_upsell_settings'::regclass) AND NOT tgisinternal ORDER BY 1`,
    );
    expect(t.map(x => x.tgname)).toEqual([
      "cockpit_upsell_catalog_audit",
      "cockpit_upsell_settings_audit",
    ]);
  });
});

describe("the catalog read", () => {
  test("client success seats and the CEO read; other seats and signed out are refused", async () => {
    for (const who of [CSM_A, CSM_B, CSM_ALL, CEO])
      expect((await h.one(who, READ)).rows.length).toBe(7);
    for (const who of [BUYER, SALES, GONE, UNCONFIRMED])
      expect(await h.failure(who, READ)).toEqual({
        code: "42501",
        message: "Active client-success access required",
      });
    const anon = await h.failure(null, READ);
    expect(anon.code).toBe("42501");
    expect(anon.message).toContain("permission denied");
  });
});

describe("the CEO sets the list", () => {
  test("only the CEO: a CSM, a media buyer and signed out are refused with 42501 and nothing is written", async () => {
    const before = (await h.audits("cockpit_upsell_catalog")).length;
    for (const who of [CSM_A, CSM_ALL, BUYER])
      expect(
        await h.failure(who, SET, [
          "website",
          JSON.stringify({ parts: [{ key: "build", amount: 2000 }] }),
          1,
        ]),
      ).toEqual({
        code: "42501",
        message: "Only the CEO changes the price list.",
      });
    expect((await h.failure(null, SET, ["website", "{}", 1])).code).toBe(
      "42501",
    );
    expect((await h.audits("cockpit_upsell_catalog")).length).toBe(before);
  });

  test("a blank price takes the hint in one call; the audit line reads like the CEO card", async () => {
    const row = await h.one(CEO, SET, [
      "website",
      JSON.stringify({ parts: [{ key: "build", amount: 2000 }] }),
      1,
    ]);
    expect(row).toMatchObject({
      offerKey: "website",
      revision: 2,
      changed: true,
      updatedBy: EMAILS.CEO,
    });
    expect(row.parts).toEqual([
      { key: "build", cadence: "one_time", amount: 2000, hint: 2000 },
      { key: "care", cadence: "monthly", amount: null, hint: 200 },
    ]);
    const a = (await h.audits("cockpit_upsell_catalog")).at(-1)!;
    expect(a).toMatchObject({
      action: "upsellCatalog.set",
      entity_id: "website",
      actor_email: EMAILS.CEO,
    });
    expect(a.metadata.line).toBe("Website build: blank to 2,000, by the CEO");
    expect(a.metadata.changed).toEqual([
      "parts",
      "revision",
      "updated_at",
      "updated_by",
    ]);
    // Both parts at once, one sentence.
    const two = await h.one(CEO, SET, [
      "website",
      JSON.stringify({
        parts: [
          { key: "build", amount: 1999.5 },
          { key: "care", amount: 200 },
        ],
      }),
      2,
    ]);
    expect(two.revision).toBe(3);
    expect(
      (await h.audits("cockpit_upsell_catalog")).at(-1)!.metadata.line,
    ).toBe(
      "Website build: 2,000 to 1,999.50; Website care plan: blank to 200, by the CEO",
    );
    // Back to blank.
    await h.one(CEO, SET, [
      "website",
      JSON.stringify({ parts: [{ key: "build", amount: 2000 }] }),
      3,
    ]);
    await h.one(CEO, SET, [
      "website",
      JSON.stringify({ parts: [{ key: "build", amount: null }] }),
      4,
    ]);
    expect(
      (await h.audits("cockpit_upsell_catalog")).at(-1)!.metadata.line,
    ).toBe("Website build: 2,000 to blank, by the CEO");
  });

  test("a stale revision is 40001 and changes nothing; an unchanged patch writes nothing", async () => {
    const before = (await h.audits("cockpit_upsell_catalog")).length;
    expect(
      await h.failure(CEO, SET, [
        "website",
        JSON.stringify({ parts: [{ key: "care", amount: 250 }] }),
        1,
      ]),
    ).toEqual({
      code: "40001",
      message: "Someone else saved this. Read it again.",
    });
    const same = await h.one(CEO, SET, [
      "website",
      JSON.stringify({ parts: [{ key: "care", amount: 200 }] }),
      5,
    ]);
    expect(same).toMatchObject({ revision: 5, changed: false });
    expect((await h.audits("cockpit_upsell_catalog")).length).toBe(before);
  });

  test("bad values get a plain sentence with 22023", async () => {
    const cases: [string, unknown, number | null, string][] = [
      ["nope", { locked: true }, 1, "Choose one of the seven offers."],
      ["website", {}, 5, "Send the changes as named values."],
      [
        "website",
        { locked: true },
        null,
        "Read the price list again, then save.",
      ],
      [
        "website",
        { parts: [{ key: "build", amount: 0 }] },
        5,
        "A price is a dollar amount from 1 to 1,000,000, with at most two decimals.",
      ],
      [
        "website",
        { parts: [{ key: "build", amount: 1000001 }] },
        5,
        "A price is a dollar amount from 1 to 1,000,000, with at most two decimals.",
      ],
      [
        "website",
        { parts: [{ key: "build", amount: 10.555 }] },
        5,
        "A price is a dollar amount from 1 to 1,000,000, with at most two decimals.",
      ],
      [
        "website",
        { parts: [{ key: "build", amount: "2000" }] },
        5,
        "A price is a dollar amount from 1 to 1,000,000, with at most two decimals.",
      ],
      [
        "website",
        { parts: [{ key: "hosting", amount: 50 }] },
        5,
        "The Website offer has no part called hosting.",
      ],
      [
        "website",
        { parts: [{ key: "build", amount: 50, hint: 1 }] },
        5,
        "Send the prices as a list of parts, each with its key and amount.",
      ],
      [
        "website",
        { parts: [] },
        5,
        "Send the prices as a list of parts, each with its key and amount.",
      ],
      ["website", { locked: "yes" }, 5, "Set Locked to on or off."],
      ["website", { split_parts: [1000] }, 5, "A split is two dollar amounts."],
      [
        "website",
        { waits_on: "x".repeat(161) },
        5,
        "Say what the offer waits on in 160 characters or fewer.",
      ],
      ["website", { copy: {} }, 5, 'The price list does not keep "copy".'],
      [
        "seo_geo",
        { parts: [{ key: "program", amount: 6000 }] },
        1,
        "The split must add up to the price (6,000). Change both together.",
      ],
    ];
    for (const [offer, patch, rev, message] of cases)
      expect(
        await h.failure(CEO, SET, [offer, JSON.stringify(patch), rev]),
      ).toEqual({ code: "22023", message });
  });

  test("the lock, the split and what an offer waits on, each with its sentence", async () => {
    let r = await h.one(CEO, SET, [
      "seo_geo",
      JSON.stringify({ parts: [{ key: "program", amount: 5000 }] }),
      1,
    ]);
    expect(r.parts[0].amount).toBe(5000);
    r = await h.one(CEO, SET, [
      "seo_geo",
      JSON.stringify({
        parts: [{ key: "program", amount: 6000 }],
        split_parts: [3000, 3000],
      }),
      2,
    ]);
    expect(
      (await h.audits("cockpit_upsell_catalog")).at(-1)!.metadata.line,
    ).toBe(
      "SEO and GEO, 90 days: 5,000 to 6,000; SEO and GEO split: 3,000 + 3,000, by the CEO",
    );
    r = await h.one(CEO, SET, [
      "seo_geo",
      JSON.stringify({ locked: false, split_allowed: false }),
      3,
    ]);
    expect(
      (await h.audits("cockpit_upsell_catalog")).at(-1)!.metadata.line,
    ).toBe(
      "SEO and GEO: price unlocked; SEO and GEO: split not allowed, by the CEO",
    );
    r = await h.one(CEO, SET, [
      "seo_geo",
      JSON.stringify({
        locked: true,
        split_allowed: true,
        split_parts: [2500, 2500],
        parts: [{ key: "program", amount: null }],
      }),
      4,
    ]);
    expect(r).toMatchObject({
      locked: true,
      splitAllowed: true,
      splitParts: [2500, 2500],
      revision: 5,
    });
    r = await h.one(CEO, SET, [
      "second_campaign",
      JSON.stringify({ waits_on: "  " }),
      1,
    ]);
    expect(r.waitsOn).toBeNull();
    expect(
      (await h.audits("cockpit_upsell_catalog")).at(-1)!.metadata.line,
    ).toBe("Second campaign no longer waits, by the CEO");
    r = await h.one(CEO, SET, [
      "second_campaign",
      JSON.stringify({ waits_on: "Deck and video follow the website." }),
      2,
    ]);
    expect(
      (await h.audits("cockpit_upsell_catalog")).at(-1)!.metadata.line,
    ).toBe(
      "Second campaign waits on: Deck and video follow the website, by the CEO",
    );
  });
});

describe("the settings", () => {
  test("only the CEO; each value is checked; blank removes the WhatsApp number; each change has its sentence", async () => {
    for (const who of [CSM_A, BUYER])
      expect(await h.failure(who, SETTING, ["valid_days", "45"])).toEqual({
        code: "42501",
        message: "Only the CEO changes the offer settings.",
      });
    const bad: [string, string | null, string][] = [
      [
        "nope",
        "1",
        "Choose the WhatsApp number, the days a proposal stays open or video view counting.",
      ],
      [
        "whatsapp_number",
        "+965 abc",
        "Type the WhatsApp number as digits with the country code, 8 to 15 of them.",
      ],
      [
        "whatsapp_number",
        "1234567",
        "Type the WhatsApp number as digits with the country code, 8 to 15 of them.",
      ],
      ["valid_days", "6", "A proposal stays open 7 to 90 days."],
      ["valid_days", "91", "A proposal stays open 7 to 90 days."],
      ["valid_days", null, "A proposal stays open 7 to 90 days."],
      ["door_live", "yes", "Video view counting is on (true) or off (false)."],
    ];
    for (const [k, v, message] of bad)
      expect(await h.failure(CEO, SETTING, [k, v])).toEqual({
        code: "22023",
        message,
      });
    expect(
      await h.one(CEO, SETTING, ["whatsapp_number", "+965 5000-0000"]),
    ).toEqual({
      whatsappNumber: "96550000000",
      validDays: 30,
      doorLive: false,
      changed: true,
    });
    expect(await h.one(CEO, SETTING, ["valid_days", "45"])).toMatchObject({
      validDays: 45,
      changed: true,
    });
    expect(await h.one(CEO, SETTING, ["valid_days", "45"])).toMatchObject({
      changed: false,
    });
    expect(await h.one(CEO, SETTING, ["door_live", "TRUE"])).toMatchObject({
      doorLive: true,
      changed: true,
    });
    expect(await h.one(CEO, SETTING, ["whatsapp_number", " "])).toMatchObject({
      whatsappNumber: null,
      changed: true,
    });
    const lines = (await h.audits("cockpit_upsell_settings"))
      .slice(-4)
      .map(a => [a.action, a.metadata.line]);
    expect(lines).toEqual([
      [
        "upsellSettings.set",
        "WhatsApp number for the client page changed, by the CEO",
      ],
      [
        "upsellSettings.set",
        "Proposals stay open 45 days (was 30), by the CEO",
      ],
      ["upsellSettings.set", "Video links now count views, by the CEO"],
      [
        "upsellSettings.set",
        "WhatsApp number removed from the client page, by the CEO",
      ],
    ]);
    await h.one(CEO, SETTING, ["door_live", "false"]);
    await h.one(CEO, SETTING, ["valid_days", "30"]);
  });
});

// The copy written by migration x (the content builder) must pass the table's check.
const C = (lang: "en" | "ar", extra: Row = {}) => ({
  name: lang === "en" ? "Your website" : "موقعك",
  deckTitle: lang === "en" ? "Your website" : "موقعك",
  line: "A site that shows your work.",
  parts: { build: "Website build", care: "Care plan" },
  terms: "Paid in full.",
  timing: "Ready in four weeks from payment and your content.",
  get: [
    { key: "pages", text: "Six pages" },
    { key: "whatsapp", text: "A WhatsApp button" },
  ],
  need: [{ key: "logo", text: "Your logo" }],
  steps: [{ key: "pay", text: "Pay" }],
  why: [{ key: "search", label: "Search", text: "People search your name." }],
  button: "Yes, let's start",
  cta: "I want the website",
  close: "Shall we start?",
  work: [],
  ...extra,
});

describe("the copy check on the catalog", () => {
  const put = async (offer: string, copy: unknown) => {
    await h.asOwner();
    await db.query(
      "UPDATE public.cockpit_upsell_catalog SET copy=$2::jsonb WHERE offer_key=$1",
      [offer, JSON.stringify(copy)],
    );
  };
  const refusedCopy = async (offer: string, copy: unknown) => {
    await h.asOwner();
    let message = "";
    try {
      await db.query(
        "UPDATE public.cockpit_upsell_catalog SET copy=$2::jsonb WHERE offer_key=$1",
        [offer, JSON.stringify(copy)],
      );
    } catch (e) {
      message = (e as Error).message;
    }
    return message;
  };
  test("a full copy in both languages passes; the audit records it", async () => {
    await put("website", { en: C("en"), ar: C("ar") });
    expect((await h.one(CSM_A, READ)).rows[0].copy.en.deckTitle).toBe(
      "Your website",
    );
    await put("website", {});
  });
  test("each broken shape is refused by the table", async () => {
    const bad: [string, unknown][] = [
      ["website", { en: C("en") }],
      ["website", { en: C("en"), ar: C("ar"), fr: C("en") }],
      ["website", { en: C("en", { name: "x".repeat(41) }), ar: C("ar") }],
      ["website", { en: C("en", { line: " " }), ar: C("ar") }],
      [
        "website",
        { en: C("en", { parts: { build: "Website build" } }), ar: C("ar") },
      ],
      [
        "website",
        {
          en: C("en"),
          ar: C("ar", {
            get: [
              { key: "whatsapp", text: "x" },
              { key: "pages", text: "y" },
            ],
          }),
        },
      ],
      ["website", { en: C("en", { get: [] }), ar: C("ar", { get: [] }) }],
      [
        "website",
        {
          en: C("en", {
            need: [1, 2, 3, 4, 5].map(n => ({ key: `n${n}`, text: "x" })),
          }),
          ar: C("ar"),
        },
      ],
      [
        "website",
        {
          en: C("en", { why: [{ key: "a", text: "no label" }] }),
          ar: C("ar", { why: [{ key: "a", text: "no label" }] }),
        },
      ],
      [
        "website",
        {
          en: C("en", {
            work: [{ key: "a", label: "Site", url: "http://x.example" }],
          }),
          ar: C("ar"),
        },
      ],
      [
        "website",
        {
          en: C("en", {
            platforms: {
              instagram: "a",
              tiktok: "b",
              snapchat: "c",
              facebook: "d",
            },
          }),
          ar: C("ar"),
        },
      ],
      ["website", { en: C("en", { extra: "x" }), ar: C("ar", { extra: "x" }) }],
      [
        "smm",
        {
          en: C("en", { parts: { monthly: "Monthly" } }),
          ar: C("ar", { parts: { monthly: "Monthly" } }),
        },
      ],
    ];
    for (const [offer, copy] of bad)
      expect(await refusedCopy(offer, copy)).toContain(
        "cockpit_upsell_catalog_copy",
      );
    const p = {
      instagram: "Instagram",
      tiktok: "TikTok",
      snapchat: "Snapchat",
      facebook: "Facebook",
    };
    await put("smm", {
      en: C("en", { parts: { monthly: "Monthly" }, platforms: p }),
      ar: C("ar", { parts: { monthly: "Monthly" }, platforms: p }),
    });
    await put("smm", {});
  });
});

describe("cockpit_client_copy_problems", () => {
  test("at least sixty English and Arabic lines, each with the rules it hits", async () => {
    const cases: [string, string[]][] = [
      // promise, free work, result guarantee
      ["If it does not work, we refund you.", ["promise"]],
      ["Money-back if you are not happy.", ["promise"]],
      [
        "We keep working for free until you get projects.",
        ["promise", "free_work"],
      ],
      [
        "We will continue at no further fees until it works.",
        ["promise", "free_work"],
      ],
      ["نستمر مجاناً حتى تحصل على النتيجة", ["promise", "free_work", "mention"]],
      ["نرجع لك فلوسك إذا ما عجبك", ["promise"]],
      [
        "We guarantee 20 qualified appointments.",
        ["result_guarantee", "mention", "performance_number"],
      ],
      ["Guaranteed results in 90 days.", ["result_guarantee", "mention"]],
      [
        "نضمن لك ٢٠ موعد",
        ["result_guarantee", "mention", "performance_number"],
      ],
      ["ضمان على النتائج", ["result_guarantee", "mention"]],
      ["We do not guarantee results.", ["mention"]],
      ["Our seven-day satisfaction guarantee covers the setup.", ["mention"]],
      // outcome
      ["Your show rate goes up.", ["outcome"]],
      ["A better close rate for your team.", ["outcome"]],
      ["Get more appointments every week.", ["outcome"]],
      ["Be on page one of Google.", ["outcome"]],
      ["Rank #1 for your city.", ["outcome"]],
      ["Appear in ChatGPT answers.", ["outcome"]],
      ["Clients turn up and sign.", ["outcome"]],
      ["نسبة الحضور ترتفع", ["outcome"]],
      ["مواعيد أكثر كل أسبوع", ["outcome"]],
      ["تطلع في الصفحة الأولى", ["outcome"]],
      ["تظهر في شات جي بي تي", ["outcome"]],
      // performance numbers and money
      ["We booked 40 appointments last month.", ["performance_number"]],
      ["Your CPL was 12.", ["metric_word", "performance_number"]],
      ["Spend: 3,000 this month.", ["performance_number"]],
      ["وصلنا ١٥ ليد هالأسبوع", ["performance_number", "lead_word"]],
      ["الميزانية 500 يومياً", ["performance_number"]],
      ["The build is $2,000.", ["money"]],
      ["Paid in KWD.", ["money"]],
      ["السعر ٥٠٠ دينار", ["money"]],
      // lead and upsell words
      ["Every lead gets a call.", ["lead_word"]],
      ["All your leads in one place.", ["lead_word"]],
      ["كل الليدز توصلك", ["lead_word"]],
      ["وليدز أكثر", ["lead_word"]],
      ["This upsell is simple.", ["upsell_word"]],
      ["Before your renewal we talk.", ["upsell_word"]],
      ["قبل تجديد العقد", ["upsell_word"]],
      // Renewal with a one-letter prefix (and, for, with, so).
      ["وتجديد العقد", ["upsell_word"]],
      ["لتجديد اشتراككم", ["upsell_word"]],
      ["بتجديد الباقة", ["upsell_word"]],
      ["ونجدد العقد معكم", ["upsell_word"]],
      ["فتجديد البرنامج", ["upsell_word"]],
      ["والعقد يتجدد", ["upsell_word"]],
      // discount
      ["20% discount if you sign this week", ["discount"]],
      ["20% off the build.", ["discount"]],
      ["A special price for you.", ["discount"]],
      ["خصم خاص لكم", ["discount"]],
      ["بخصم ٢٠٪ هالأسبوع", ["discount"]],
      ["تخفيض السعر", ["discount"]],
      // our own words: CSM, ad spend, a list price
      ["Your CSM will walk you through it.", ["internal_word"]],
      ["We manage your ad spend.", ["internal_word"]],
      ["Below our list price.", ["internal_word"]],
      ["نتابع الصرف الإعلاني لكم", ["internal_word"]],
      ["أقل من السعر الأصلي", ["internal_word"]],
      // dashes
      ["Six pages — ready in four weeks.", ["em_dash"]],
      ["Live in two weeks – after your content", ["em_dash"]],
      // clean lines
      ["A leader in villa design.", []],
      ["Leading firms trust a clear site.", []],
      [
        "Six pages, a WhatsApp button and a form, ready four weeks after payment.",
        [],
      ],
      ["How many projects would pay for this?", []],
      ["موقع يعرض شغلك، وزر واتساب، ونموذج تواصل", []],
      ["التجديد والتشطيب من خدماتنا", []],
      ["التجديد الداخلي للفيلا", []],
      ["نجدد بيتك", []],
      ["We build it in 4 weeks.", []],
      ["Mislead nobody: show real projects.", []],
      // Waleed is a name and LED is lighting, never a lead.
      ["شكرا وليد على وقتك اليوم", []],
      ["م. وليد طلب نسخة من الموقع", []],
      ["إضاءة ليد مخفية في السقف", []],
      ["نساعدك في تخفيض التكاليف", []],
      ["A listing on Google", []],
      ["Spend a day on site", []],
      ["مدير حسابكم يتابع معكم", []],
      ["2025–2026", []],
    ];
    expect(cases.length).toBeGreaterThanOrEqual(60);
    for (const [text, want] of cases) {
      const got = await rules(text);
      expect({ text, got: got.sort() }).toEqual({
        text,
        got: [...want].sort(),
      });
    }
  });

  test("the shape: rule, the words it matched, why, and whether it blocks; mention only warns", async () => {
    expect(await problems("Six pages — free of charge.")).toEqual([
      {
        rule: "mention",
        match: "free of charge",
        why: "Mentions a guarantee or something free. Check it is the agreed terms and never a result.",
        block: false,
      },
      {
        rule: "em_dash",
        match: "—",
        why: "Uses a dash between clauses. Use a comma, a full stop or brackets.",
        block: true,
      },
    ]);
    expect(await blocking("We offer a guarantee on the build.")).toEqual([]);
    expect(await problems("")).toEqual([]);
    expect(await problems(null as unknown as string)).toEqual([]);
  });

  test("money passes on the investment lines (p_money_ok), every other rule still holds", async () => {
    expect(await rules("Website build, $2,000 paid in full", true)).toEqual([]);
    expect(await rules("٢٬٠٠٠ دولار", true)).toEqual([]);
    expect(await rules("$2,000 for 40 leads", true)).toEqual([
      "performance_number",
      "lead_word",
    ]);
    expect(await rules("$2,000", false)).toEqual(["money"]);
  });

  test("whole-word lead only, never leader, leading or mislead; the service key and every seat can call it", async () => {
    for (const ok of [
      "leader",
      "leading",
      "misleading",
      "Leadership",
      "Pleaded",
    ])
      expect(await rules(ok)).toEqual([]);
    for (const hit of ["lead", "Leads", "LEAD.", "(lead)", "lead-time"])
      expect(await rules(hit)).toEqual(["lead_word"]);
    expect(
      await h.svc("SELECT public.cockpit_client_copy_problems('two leads') r"),
    ).toEqual([
      {
        rule: "lead_word",
        match: "leads",
        why: "Says lead. Say enquiry or client.",
        block: true,
      },
    ]);
    expect(
      await h.one(BUYER, "SELECT public.cockpit_client_copy_problems('ok') r"),
    ).toEqual([]);
    expect(
      (
        await h.failure(
          null,
          "SELECT public.cockpit_client_copy_problems('ok')",
        )
      ).message,
    ).toContain("permission denied");
  });
});
