/**
 * The client page's numbers by funnel (src/lib/funnelSplit.ts, read
 * cockpit_media_campaign_funnels, 20261026s). Muhammed, 2026-10-26: the page
 * has to say whether its numbers come from the instant form or the lead page.
 * The figures mirror Merge Studio's two campaigns on 26 Oct 2026 (the instant
 * form since 4 Oct, the website campaign started that day); the rest is
 * invented.
 */
import { describe, expect, test } from "bun:test";
import {
  alsoRuns,
  type CampaignFunnel,
  funnelName,
  parseFunnel,
  splitByFunnel,
} from "../src/lib/funnelSplit";

const FORM = "Merge Studio | Instant Form | Leads | Oct2026 | MHM™";
const WEB = "Leads_Web_Form_Merge Studio_25/10";

const funnel = (
  campaign: string,
  kind: CampaignFunnel["kind"],
  kinds: CampaignFunnel["kinds"] = [{ kind, spend: 100 }],
): CampaignFunnel => ({
  campaign,
  kind,
  kinds,
  linkClicks: null,
  landingPageViews: null,
});

describe("splitByFunnel", () => {
  test("each campaign counts under its funnel, the one doing the work first", () => {
    const lines = splitByFunnel(
      [
        { campaign: WEB, spend: 18.71, leads: 0 },
        { campaign: FORM, spend: 350.14, leads: 38 },
      ],
      [funnel(FORM, "form"), funnel(WEB, "website")],
      true,
    );
    expect(lines.map(l => [l.name, l.spend, l.leads])).toEqual([
      ["Instant form", 350.14, 38],
      ["Lead page", 18.71, 0],
    ]);
    expect(lines[0].cpl).toBeCloseTo(9.21, 2);
    // No lead, so no cost per lead: never $18.71 or $0.
    expect(lines[1].cpl).toBeUndefined();
    expect(lines[0].share + lines[1].share).toBeCloseTo(1, 6);
    expect(lines[1].share).toBeCloseTo(18.71 / 368.85, 6);
  });

  test("a website campaign is the Lead page only for a client that has one", () => {
    const [line] = splitByFunnel(
      [{ campaign: WEB, spend: 10, leads: 1 }],
      [funnel(WEB, "website")],
      false,
    );
    expect(line.name).toBe("Website");
    expect(funnelName("website", true)).toBe("Lead page");
    expect(funnelName("form", true)).toBe("Instant form");
  });

  test("a campaign the read does not name is counted as not known, never dropped", () => {
    const lines = splitByFunnel(
      [
        { campaign: FORM, spend: 30, leads: 3 },
        { campaign: "Off the board", spend: 5, leads: 0 },
      ],
      [funnel(FORM, "form")],
      true,
    );
    expect(lines.map(l => [l.kind, l.spend])).toEqual([
      ["form", 30],
      ["unknown", 5],
    ]);
    expect(lines[1].name).toBe("Funnel not known");
  });

  test("before the read answers every campaign waits as not known", () => {
    const lines = splitByFunnel(
      [{ campaign: FORM, spend: 30, leads: 3 }],
      undefined,
      true,
    );
    expect(lines.map(l => l.kind)).toEqual(["unknown"]);
  });

  test("lines with no spend and no leads say nothing; an unread campaign is skipped", () => {
    const lines = splitByFunnel(
      [
        { campaign: FORM, spend: 0, leads: 0 },
        { campaign: WEB, spend: null, leads: null },
      ],
      [funnel(FORM, "form"), funnel(WEB, "website")],
      true,
    );
    expect(lines).toEqual([]);
  });

  test("a mixed campaign counts whole under its main funnel and is named", () => {
    const mixed = funnel("Both", "form", [
      { kind: "form", spend: 80 },
      { kind: "website", spend: 20 },
    ]);
    const [line] = splitByFunnel(
      [{ campaign: "Both", spend: 100, leads: 10 }],
      [mixed],
      true,
    );
    expect([line.kind, line.spend, line.mixed]).toEqual([
      "form",
      100,
      ["Both"],
    ]);
  });
});

describe("alsoRuns", () => {
  test("a second funnel counts from 10% of the known spend; unknown rows never do", () => {
    expect(
      alsoRuns(
        funnel("A", "form", [
          { kind: "form", spend: 91 },
          { kind: "website", spend: 9 },
        ]),
      ),
    ).toEqual([]);
    expect(
      alsoRuns(
        funnel("A", "form", [
          { kind: "form", spend: 90 },
          { kind: "whatsapp", spend: 10 },
        ]),
      ),
    ).toEqual(["whatsapp"]);
    expect(
      alsoRuns(
        funnel("A", "form", [
          { kind: "form", spend: 10 },
          { kind: "unknown", spend: 90 },
        ]),
      ),
    ).toEqual([]);
    expect(alsoRuns(undefined)).toEqual([]);
  });
});

describe("parseFunnel", () => {
  test("keeps known kinds and numbers, turns anything else into unknown or null", () => {
    expect(
      parseFunnel({
        campaign: WEB,
        kind: "website",
        kinds: [{ kind: "website", spend: "18.71" }, { kind: "bogus" }],
        linkClicks: 14,
        landingPageViews: null,
      }),
    ).toEqual({
      campaign: WEB,
      kind: "website",
      kinds: [
        { kind: "website", spend: 18.71 },
        { kind: "unknown", spend: 0 },
      ],
      linkClicks: 14,
      landingPageViews: null,
    });
    expect(parseFunnel({ kind: "form" })).toBeNull();
    expect(parseFunnel(null)).toBeNull();
    expect(parseFunnel({ campaign: "X", kind: "spaceship" })?.kind).toBe(
      "unknown",
    );
  });
});
