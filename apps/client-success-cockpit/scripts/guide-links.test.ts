/**
 * "How this cockpit works" on the Links page: the demo, the two Google Docs
 * SOPs and, since 2026-11-01, the Offers how-to video, all from the shared
 * COCKPIT_GUIDES. The command palette (Ctrl K) is drawn from the same rows.
 *
 * Run: bun test scripts/guide-links.test.ts
 */

import { expect, test } from "bun:test";
import { COCKPIT_GUIDES } from "../src/lib/cockpits";
import { LINK_GROUPS } from "../src/lib/csmLinks";

const guide = LINK_GROUPS.find(g => g.title === "How this cockpit works");

test("the guide group lists the demo, both SOPs and the Offers video", () => {
  expect(guide?.rows.map(r => r.label)).toEqual([
    "Watch the demo",
    "The simple SOP",
    "The in-depth SOP",
    "Offers: pitch an offer and send a proposal (video)",
    "Client success cockpit, how to use it",
  ]);
});

test("the Offers row opens the Drive how-to video", () => {
  const offers = guide?.rows.find(r => r.label.startsWith("Offers:"));
  expect(offers?.url).toBe(COCKPIT_GUIDES.csm.offers!);
  expect(offers?.url).toBe(
    "https://drive.google.com/file/d/1fJ2aj62n1uCkxj5HO17Uxd9nqw97xuC2/view",
  );
});

test("every guide row has a link", () => {
  for (const r of guide?.rows ?? [])
    expect({ label: r.label, url: r.url }).toEqual({
      label: r.label,
      url: expect.stringMatching(/^https:\/\//),
    });
});
