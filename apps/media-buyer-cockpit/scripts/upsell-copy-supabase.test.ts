/**
 * The upsell studio's client copy through the database's own copy check
 * (cockpit_client_copy_problems, 20261026u), and the copy migration
 * 20261026x on top of u, v and w (docs/upsell-studio/CONTENT.md), on an
 * isolated PostgreSQL with Supabase's default privileges on.
 *
 * Every catalog string, every canvas and notes line of the website deck,
 * every line of the website video and every string of the offer page must
 * come back with no problem at all. The bill's money column is the one line
 * that may name a currency, and it passes only with p_money_ok.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { PGlite } from "@electric-sql/pglite";
import { STRINGS } from "../../../sites/offer/strings.js";
import { OFFER_CHROME } from "../../client-success-cockpit/src/present/offer/content/shared";
import { WEBSITE_DECK } from "../../client-success-cockpit/src/present/offer/content/website";
import { WEBSITE_VIDEO } from "../../client-success-cockpit/src/present/offer/content/websiteVideo";
import { migration } from "./lib/cockpitTestDb";
import {
  type Row,
  SEATS,
  UPSELL_FILES,
  upsellHelpers,
  upsellTestDb,
} from "./lib/upsellTestDb";

const { CSM_A, CEO } = SEATS;
const OFFERS = [
  "website",
  "second_campaign",
  "seo_geo",
  "smm",
  "cameraman",
  "ugc",
  "closer",
];
const SQL = migration(UPSELL_FILES.x);
const FILE_COPY: Record<string, Row> = JSON.parse(
  SQL.match(/\$json\$([\s\S]*?)\$json\$/)?.[1] ?? "{}",
);

type Line = { path: string; text: string; moneyOk?: boolean };

/** Every string under a value, with its path; list keys are ids, not copy. */
function strings(v: unknown, path: string, out: Line[] = []): Line[] {
  if (typeof v === "string") {
    if (!/\.key$/.test(path)) out.push({ path, text: v });
  } else if (Array.isArray(v))
    v.forEach((x, i) => {
      strings(x, `${path}[${i}]`, out);
    });
  else if (v && typeof v === "object")
    for (const [k, x] of Object.entries(v)) strings(x, `${path}.${k}`, out);
  return out;
}

/** The lines the deck, the video and the page carry (not the catalog). */
function codeLines(): Line[] {
  const out: Line[] = [
    ...strings(WEBSITE_DECK, "WEBSITE_DECK"),
    ...strings(WEBSITE_VIDEO, "WEBSITE_VIDEO"),
    ...strings(STRINGS, "STRINGS").map(line => ({
      ...line,
      moneyOk: /\.dollars$/.test(line.path),
    })),
  ];
  for (const [k, l] of Object.entries(OFFER_CHROME))
    for (const lang of ["en", "ar"] as const)
      out.push({
        path: `OFFER_CHROME.${k}.${lang}`,
        text: l[lang],
        // The bill's money column is the one label that names a currency.
        moneyOk: k === "dollars",
      });
  // A fact's source is a citation for the CSM, not a line anyone says.
  return out.filter(l => !/\.facts\[\d+\]\.(?:source|country)$/.test(l.path));
}

let db: PGlite;
let h: ReturnType<typeof upsellHelpers>;

const problemsOf = async (lines: Line[]) => {
  const found: string[] = [];
  for (const l of lines) {
    const p = (await h.one(
      CSM_A,
      "SELECT public.cockpit_client_copy_problems($1,$2) r",
      [l.text, l.moneyOk ?? false],
    )) as Row[];
    for (const x of p)
      found.push(
        `${l.path} [${x.rule}${x.block ? "" : ", warning"}]: ${l.text}`,
      );
  }
  return found;
};

beforeAll(async () => {
  db = await upsellTestDb({ through: "x" });
  h = upsellHelpers(db);
}, 120000);
afterAll(async () => {
  await db?.close();
});

describe("the copy migration on top of u, v and w (applied twice)", () => {
  test("every offer holds this file's copy, written once with one audit row each", async () => {
    const r = await h.one(
      CSM_A,
      "SELECT public.cockpit_upsell_catalog_read() r",
    );
    expect(r.rows.map((x: Row) => x.offerKey)).toEqual(OFFERS);
    for (const row of r.rows) {
      expect(row.copy).toEqual(FILE_COPY[row.offerKey]);
      // The seed is revision 1; the copy is the one change, despite two applies.
      expect([row.offerKey, row.revision, row.updatedBy]).toEqual([
        row.offerKey,
        2,
        "migration",
      ]);
      // Prices stay blank: the copy never touches them.
      for (const p of row.parts) expect(p.amount).toBeNull();
    }
    const audits = (await h.audits("cockpit_upsell_catalog")).filter(
      a => a.action === "upsellCatalog.copy",
    );
    expect(audits.map(a => a.entity_id).sort()).toEqual([...OFFERS].sort());
    for (const a of audits) {
      expect(a.metadata.changed).toContain("copy");
      expect(a.metadata.line).toMatch(
        /: client copy written in English and Arabic$/,
      );
      expect(a.source_app).toBe("client-success");
    }
    expect(audits.find(a => a.entity_id === "website")?.metadata.line).toBe(
      "Website: client copy written in English and Arabic",
    );
  });

  test("the proposal builder's first draft fills from the website's copy", async () => {
    const created = await h.one(
      CSM_A,
      "SELECT public.cockpit_upsell_proposal_create($1,'website','ar',$2::uuid) r",
      ["taskA1", "20000000-0000-4000-8000-000000000001"],
    );
    const c = created.proposal.content;
    expect(c.why.text).toBe(FILE_COPY.website.ar.why[0].text);
    expect(c.get.map((g: Row) => g.text)).toEqual(
      FILE_COPY.website.ar.get.map((g: Row) => g.text),
    );
    expect(c.button.text).toBe(FILE_COPY.website.ar.button);
    expect(c.steps.text).toBe(
      FILE_COPY.website.ar.steps.map((s: Row) => s.text).join("\n"),
    );
  });

  test("a third apply changes nothing", async () => {
    const before = (await h.audits("cockpit_upsell_catalog")).length;
    await h.asOwner();
    await db.exec(SQL);
    expect((await h.audits("cockpit_upsell_catalog")).length).toBe(before);
  });
});

describe("every client line passes the copy check", () => {
  test("the seven offers' catalog copy, as the database holds it", async () => {
    const rows = (await h.owner<{ offer_key: string; copy: Row }>(
      "SELECT offer_key, copy FROM public.cockpit_upsell_catalog ORDER BY sort",
    )) as { offer_key: string; copy: Row }[];
    const lines = rows.flatMap(r => strings(r.copy, `catalog.${r.offer_key}`));
    // Seven offers, two languages, about 27 lines each.
    expect(lines.length).toBeGreaterThan(350);
    expect(await problemsOf(lines)).toEqual([]);
  }, 120000);

  test("the website deck's canvas and talk track, the video, the chrome and the offer page", async () => {
    const lines = codeLines();
    expect(lines.length).toBeGreaterThan(400);
    expect(
      lines.filter(l => l.path.includes(".sayKw[")).length,
    ).toBeGreaterThan(20);
    expect(
      lines.filter(l => l.path.includes(".saySa[")).length,
    ).toBeGreaterThan(20);
    // The page's ended video link, the film's poster and the words the film
    // draws on screen are read too.
    const paths = new Set(lines.map(l => l.path));
    for (const p of [
      "STRINGS.en.states.videoGone",
      "STRINGS.ar.states.videoGone",
      "WEBSITE_VIDEO.poster.ar",
      "WEBSITE_VIDEO.beats[4].labels.ar[1]",
    ])
      expect([p, paths.has(p)]).toEqual([p, true]);
    expect(await problemsOf(lines)).toEqual([]);
  }, 120000);

  test("the bill's money column passes only as an investment line", async () => {
    for (const lang of ["en", "ar"] as const) {
      const t = OFFER_CHROME.dollars[lang];
      const without = (await h.one(
        CSM_A,
        "SELECT public.cockpit_client_copy_problems($1,false) r",
        [t],
      )) as Row[];
      expect(without.map(p => p.rule)).toEqual(["money"]);
      expect(
        await h.one(
          CSM_A,
          "SELECT public.cockpit_client_copy_problems($1,true) r",
          [t],
        ),
      ).toEqual([]);
    }
  });

  test("a price said on the call, once filled, is money: it stays in the notes", async () => {
    // The notes' {build} line with a figure in it: the slide never shows it.
    const filled = WEBSITE_DECK.slides.investment.notes.say[0]
      .replace("{build}", "2,000 dollars")
      .replace("{care}", "200 dollars");
    const p = (await h.one(
      CSM_A,
      "SELECT public.cockpit_client_copy_problems($1,false) r",
      [filled],
    )) as Row[];
    expect(p.map(x => x.rule)).toEqual(["money"]);
  });
});

describe("the copy migration refuses", () => {
  let fresh: PGlite;
  let f: ReturnType<typeof upsellHelpers>;
  const apply = async (sql: string) => {
    await f.asOwner();
    try {
      await fresh.exec(sql);
      return "";
    } catch (e) {
      return (e as Error).message;
    } finally {
      await fresh.exec("ROLLBACK");
    }
  };
  const copyOf = async (offer: string) =>
    (
      await f.owner<{ copy: Row }>(
        "SELECT copy FROM public.cockpit_upsell_catalog WHERE offer_key=$1",
        [offer],
      )
    )[0].copy;

  beforeAll(async () => {
    fresh = await upsellTestDb({ through: "w" });
    f = upsellHelpers(fresh);
  }, 120000);
  afterAll(async () => {
    await fresh?.close();
  });

  test("a line the copy check blocks, naming it and the rule", async () => {
    const bad = SQL.replace(
      '"timing": "Live two weeks after we have your content."',
      '"timing": "Guaranteed results: more clients in two weeks."',
    );
    expect(bad).not.toBe(SQL);
    const message = await apply(bad);
    expect(message).toContain("This client copy breaks the copy rules");
    expect(message).toContain("website.en.timing (result_guarantee, outcome)");
    expect(await copyOf("website")).toEqual({});
  });

  test("to overwrite copy someone changed after it was written, and writes nothing", async () => {
    const changed = {
      ...FILE_COPY.website,
      en: { ...FILE_COPY.website.en, name: "Websites" },
    };
    await f.owner(
      "UPDATE public.cockpit_upsell_catalog SET copy=$1::jsonb WHERE offer_key='website'",
      [JSON.stringify(changed)],
    );
    const message = await apply(SQL);
    expect(message).toContain(
      "The client copy for website was changed after this file was written",
    );
    expect(await copyOf("website")).toEqual(changed);
    expect(await copyOf("smm")).toEqual({});
  });

  test("then, with the offer blank again, writes all seven", async () => {
    await f.owner(
      "UPDATE public.cockpit_upsell_catalog SET copy='{}'::jsonb WHERE offer_key='website'",
    );
    expect(await apply(SQL)).toBe("");
    for (const offer of OFFERS)
      expect(await copyOf(offer)).toEqual(FILE_COPY[offer]);
  });

  test("a copy the shape check refuses never lands", async () => {
    const bad = SQL.replace('"button": "Yes, let\'s start the search",', "");
    expect(bad).not.toBe(SQL);
    await f.owner(
      "UPDATE public.cockpit_upsell_catalog SET copy='{}'::jsonb WHERE offer_key='closer'",
    );
    const message = await apply(bad);
    expect(message).toContain("cockpit_upsell_catalog_copy");
    expect(await copyOf("closer")).toEqual({});
  });

  test("the CEO's price list cannot carry copy", async () => {
    const rev = (
      await f.owner<{ revision: number }>(
        "SELECT revision FROM public.cockpit_upsell_catalog WHERE offer_key='website'",
      )
    )[0].revision;
    const fail = await f.failure(
      CEO,
      "SELECT public.cockpit_upsell_catalog_set('website',$1::jsonb,$2) r",
      [JSON.stringify({ copy: {} }), rev],
    );
    expect(fail.code).toBe("22023");
  });
});
