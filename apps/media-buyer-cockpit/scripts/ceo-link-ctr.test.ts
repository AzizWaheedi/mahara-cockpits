/**
 * The CEO, 2026-10-08: "I need the ctr metric on the ads in ceo cockpit to be
 * link ctr not normal ctr". Link CTR is link clicks (Meta's
 * inline_link_clicks) divided by impressions; CTR (all) counts every click
 * and reads well above it (1.79% against 1.06% on lead-gen in August 2026).
 *
 * These tests fail if any CEO screen, the VPS worker that fills the stored
 * sections (hermes/ceo-refresh) or the targets card goes back to CTR (all),
 * or if a link-click count Meta did not send turns into 0.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  addKnown,
  knownCount,
  knownSum,
  LINK_CLICKS_SQL,
  linkCtr,
  marketingAdLink,
} from "../../../hermes/ceo-refresh/native/linkCtr.js";
import { linkCtrTargetNote } from "../../../supabase/functions/cockpit-ceo-api/finance/targets.ts";
import {
  CTR_TARGET_NOTE,
  LINK_CTR,
  LINK_CTR_HINT,
} from "../src/components/ceo/linkCtr";
import {
  TARGET_LABELS,
  TargetMeter,
  targetKind,
} from "../src/components/ceo/TargetMeter";

const APP = join(import.meta.dir, "..");
const WORKER = join(APP, "../../hermes/ceo-refresh/native");
const read = (path: string) => readFileSync(path, "utf8");
/** Source without comments, so a comment that names CTR (all) is not a use of it. */
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

describe("the words", () => {
  test("the label and hint are the media buyer cockpit's", () => {
    expect(LINK_CTR).toBe("Link CTR");
    expect(LINK_CTR_HINT).toBe(
      "Link clicks divided by impressions. Not CTR (all).",
    );
    const account = read(join(APP, "src/components/AccountView.tsx"));
    expect(account).toContain(`hint: "${LINK_CTR_HINT}"`);
  });

  test("the CTR target is labelled and formatted as Link CTR", () => {
    expect(TARGET_LABELS.ctr).toBe(LINK_CTR);
    expect(TARGET_LABELS.ctr_link).toBe(LINK_CTR);
    for (const metric of ["ctr", "ctr_link"]) {
      const kind = targetKind(metric);
      expect(kind.judge).toBe("higher");
      expect(kind.format(0.0106)).toBe("1.1%");
    }
    const html = renderToStaticMarkup(
      createElement(TargetMeter, {
        item: { metric: "ctr", target: 0.018, actual: 0.0106 },
        dayOfMonth: 8,
        daysInMonth: 31,
      }),
    );
    expect(html).toContain("Link CTR");
    expect(html).not.toContain("Click-through rate");
    expect(html).toContain("1.8%");
    expect(html).toContain("1.1%");
  });
});

describe("the CEO screens", () => {
  const files = ["src/pages/ceo", "src/components/ceo"].flatMap(dir =>
    readdirSync(join(APP, dir))
      .filter(f => /\.tsx?$/.test(f))
      .map(f => join(APP, dir, f)),
  );

  test("no screen reads an all-clicks CTR or calls anything plain CTR", () => {
    expect(files.length).toBeGreaterThan(40);
    for (const file of files) {
      const src = code(file);
      // `.ctr` is CTR (all) on every CEO payload; `.ctrLink` and `.linkCtr` are link CTR.
      expect({ file, hits: src.match(/\.ctr\b/g) ?? [] }).toEqual({
        file,
        hits: [],
      });
      expect({
        file,
        hits:
          src.match(/["'`](CTR|Clicks and CTR|Click.through rate)["'`]/gi) ??
          [],
      }).toEqual({ file, hits: [] });
    }
  });

  test("the Ads tab and the webinar funnel show link CTR under its own name", () => {
    const ads = code(join(APP, "src/pages/ceo/AdsTab.tsx"));
    expect(ads).toContain("{ label: LINK_CTR, v: w.ctrLink, f: pct }");
    expect(ads).toMatch(
      /key: "ctrLink",\s+label: LINK_CTR,\s+title: LINK_CTR_HINT,/,
    );
    expect(ads).toContain("hint: LINK_CTR_HINT,");

    const webinar = code(join(APP, "src/pages/ceo/WebinarFunnel.tsx"));
    expect(webinar).toContain(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the screen's source text
      "value: `${count(r.traffic.linkClicks)} at ${pct(r.traffic.linkCtr)}`",
    );
    expect(webinar).toContain("{pct(a.linkCtr)}");
    expect(webinar).toContain("{LINK_CTR}");
  });
});

describe("the CTR target's note", () => {
  /** A tab's [pattern, card] note routes, in order, read from its source. */
  function routesOf(file: string, table: string): [RegExp, string][] {
    const src = read(join(APP, "src/pages/ceo", file));
    const start = src.indexOf(`const ${table}`);
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf("\n];", start));
    return [
      ...body.matchAll(
        /\[\s*(CTR_TARGET_NOTE|\/((?:\\.|[^/\\\n])+)\/([a-z]*)),\s*"(\w+)",?\s*\]/g,
      ),
    ].map(m => [
      m[1] === "CTR_TARGET_NOTE" ? CTR_TARGET_NOTE : new RegExp(m[2], m[3]),
      m[4],
    ]);
  }
  const card = (routes: [RegExp, string][], text: string) =>
    routes.find(([re]) => re.test(text))?.[1];

  const monthName = (m: string) => (m === "2026-08" ? "August 2026" : m);
  const old = linkCtrTargetNote(
    [
      {
        month: "2026-08",
        metric: "ctr",
        projection: 1.8,
        updatedMs: Date.parse("2026-08-25T12:10:43Z"),
      },
    ],
    monthName,
  );
  const fresh = linkCtrTargetNote(
    [
      {
        month: "2026-10",
        metric: "ctr",
        projection: 1.2,
        updatedMs: Date.parse("2026-10-09T09:00:00Z"),
      },
    ],
    monthName,
  );
  const texts = [old?.text, fresh?.text].filter(
    (t): t is string => typeof t === "string",
  );
  // Other target notes the money adapter writes, which stay where they are.
  const others = [
    "The revenue target is compared with closer form contracted value, as the B2B dashboard does, so deal values logged by hand are not in its pace. Its definition is still pending, so read that pace with care.",
    "No targets exist for October 2026. The latest targets are for August 2026.",
  ];

  test("both notes are recognised as the CTR target's, and no other target note is", () => {
    expect(old?.level).toBe("warn");
    expect(fresh?.level).toBe("info");
    expect(texts).toHaveLength(2);
    for (const text of texts) expect(CTR_TARGET_NOTE.test(text)).toBe(true);
    for (const text of others) expect(CTR_TARGET_NOTE.test(text)).toBe(false);
  });

  test("it sits beside the Link CTR meter on Money and Frontend, and Sales points at it", () => {
    const money = routesOf("MoneyTab.tsx", "NOTE_ROUTES");
    const frontend = routesOf("FrontendTab.tsx", "MONEY_ROUTES");
    const sales = routesOf("SalesTab.tsx", "MONEY_NOTE_ROUTES");
    for (const routes of [money, frontend, sales])
      expect(routes.length).toBeGreaterThan(1);
    for (const text of texts) {
      expect(card(money, text)).toBe("targets");
      expect(card(frontend, text)).toBe("targets");
      // The sales targets card leaves CTR out: the note is pointed at.
      expect(card(sales, text)).toBe("otherTargets");
    }
    for (const text of others) expect(card(sales, text)).toBe("targets");
    const salesTab = code(join(APP, "src/pages/ceo/SalesTab.tsx"));
    expect(salesTab).toMatch(
      /notesElsewhere\(\s*mNotes\.otherTargets,\s*"targets this card leaves out",\s*"Money",?\s*\)/,
    );
  });
});

describe("the worker's link CTR", () => {
  test("link CTR is link clicks over impressions, never every click", () => {
    expect(linkCtr(1768, 162990)).toBe(0.0108);
    expect(linkCtr(0, 1000)).toBe(0);
    expect(linkCtr(5, 0)).toBeNull();
    expect(linkCtr(null, 1000)).toBeNull();
  });

  test("a link-click count Meta did not send is not known, never 0", () => {
    expect(knownCount(null)).toBeNull();
    expect(knownCount(undefined)).toBeNull();
    expect(knownCount("12")).toBe(12);
    expect(knownCount(0)).toBe(0);
    expect(knownSum([3, 4])).toBe(7);
    expect(knownSum([])).toBe(0);
    expect(knownSum([3, null, 4])).toBeNull();
    expect(addKnown(3, 4)).toBe(7);
    expect(addKnown(3, null)).toBeNull();
    expect(addKnown(null, 4)).toBeNull();
  });

  test("a winning ad carries link clicks and link CTR, not the dashboard's CTR (all)", () => {
    // A b2b_marketing_ads row as read on 2026-10-08: CTR (all) 1.17%, link CTR 0.64%.
    const row = {
      in_meta: "true",
      impressions: "49036",
      clicks: "573",
      ctr: "1.17",
      link_clicks: "316",
    };
    expect(marketingAdLink(row)).toEqual({ linkClicks: 316, linkCtr: 0.0064 });
    expect(marketingAdLink({ ...row, link_clicks: null })).toEqual({
      linkClicks: null,
      linkCtr: null,
    });
    // Meta has no snapshot of the ad: its link clicks are unknown, not zero.
    expect(marketingAdLink({ ...row, in_meta: "false" })).toEqual({
      linkClicks: null,
      linkCtr: null,
    });
  });

  test("the SQL sum stays null when one delivered day has no link-click count", async () => {
    const db = new PGlite();
    try {
      await db.exec(`
        create table meta_ad_snapshots (ad_id text, inline_link_clicks int, impressions int);
        insert into meta_ad_snapshots values
          ('known', 10, 1000), ('known', 5, 500),
          ('partial', 10, 1000), ('partial', null, 500);
      `);
      const { rows } = await db.query<{
        ad_id: string;
        link_clicks: number | null;
      }>(
        `select ad_id, ${LINK_CLICKS_SQL()} as link_clicks from meta_ad_snapshots group by 1 order by 1`,
      );
      expect(
        rows.map(r => [
          r.ad_id,
          r.link_clicks === null ? null : Number(r.link_clicks),
        ]),
      ).toEqual([
        ["known", 15],
        ["partial", null],
      ]);
      const aliased = await db.query<{ link_clicks: number | null }>(
        `select ${LINK_CLICKS_SQL("s.")} as link_clicks from meta_ad_snapshots s where s.ad_id = 'known'`,
      );
      expect(Number(aliased.rows[0].link_clicks)).toBe(15);
    } finally {
      await db.close();
    }
  });

  test("the adapters that fill the CEO sections use link CTR", () => {
    const ads = code(join(WORKER, "adapters/b2bAds.js"));
    expect(ads).toContain("w.ctrLink = linkCtr(w.linkClicks, w.impressions);");
    expect(ads).toContain(
      "into.linkClicks = addKnown(into.linkClicks, w.linkClicks);",
    );
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the adapter's source text
    expect(ads).toContain("${LINK_CLICKS_SQL()} as link_clicks");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the adapter's source text
    expect(ads).not.toContain("coalesce(${a}_ads.link_clicks,0)");

    const webinar = code(join(WORKER, "adapters/webinar.js"));
    // The round and every per-ad row.
    expect(
      webinar.match(/linkCtr: linkCtr\(linkClicks, impressions\)/g),
    ).toHaveLength(2);
    expect(webinar).toContain(
      "const linkClicks = knownSum(rows.map(s => s.linkClicks));",
    );
    expect(webinar).toContain(
      'metric: "Spend, impressions, link clicks, link CTR"',
    );
    expect(webinar).not.toMatch(/ads\.push\(\{[^}]*\bctr:/);

    const growth = code(join(WORKER, "adapters/growth.js"));
    expect(growth).not.toContain("r.v->>'ctr'");
    expect(growth).not.toMatch(/\bctr: opt\(/);
    expect(growth).toContain("...marketingAdLink(r),");

    const metrics = read(join(WORKER, "webinarMetrics.ts"));
    expect(metrics).toContain('"link_ctr",');
    expect(metrics).toContain("r => r.traffic.linkCtr,");
  });
});
