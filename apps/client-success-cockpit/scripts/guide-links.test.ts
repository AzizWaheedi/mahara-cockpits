/**
 * "How this cockpit works" on the Links page: the demo, the two Google Docs
 * SOPs and the how-to videos (onboarding call, launch call, Offers), all
 * from the shared COCKPIT_GUIDES. The command palette (Ctrl K) is drawn from
 * the same rows.
 *
 * Run: bun test scripts/guide-links.test.ts
 */

import { expect, test } from "bun:test";
import { COCKPIT_GUIDES } from "../src/lib/cockpits";
import { LINK_GROUPS } from "../src/lib/csmLinks";

const guide = LINK_GROUPS.find(g => g.title === "How this cockpit works");
const drive = (id: string) => `https://drive.google.com/file/d/${id}/view`;

test("the guide group lists the demo, both SOPs and the how-to videos", () => {
  expect(guide?.rows.map(r => r.label)).toEqual([
    "Watch the demo",
    "The simple SOP",
    "The in-depth SOP",
    "Onboarding call: run the deck and the kickoff form (video)",
    "Launch call: run the launch deck (video)",
    "Offers: pitch an offer and send a proposal (video)",
    "Client success cockpit, how to use it",
  ]);
});

test("each how-to row opens its Drive video", () => {
  const url = (start: string) =>
    guide?.rows.find(r => r.label.startsWith(start))?.url;
  expect(url("Onboarding call:")).toBe(COCKPIT_GUIDES.csm.howTo.onboarding);
  expect(url("Onboarding call:")).toBe(
    drive("1AuD8qBlwRJHdUHF_teerPlLJI856WgTG"),
  );
  expect(url("Launch call:")).toBe(COCKPIT_GUIDES.csm.howTo.launch);
  expect(url("Launch call:")).toBe(drive("1A-4eHbzNXXA2DiH5bZJzfn19LlgGKYdJ"));
  expect(url("Offers:")).toBe(COCKPIT_GUIDES.csm.howTo.offers);
  expect(url("Offers:")).toBe(drive("1fJ2aj62n1uCkxj5HO17Uxd9nqw97xuC2"));
});

test("every guide row has a link", () => {
  for (const r of guide?.rows ?? [])
    expect({ label: r.label, url: r.url }).toEqual({
      label: r.label,
      url: expect.stringMatching(/^https:\/\//),
    });
});
