/**
 * The creative director's how-to video for the Brand Blueprint call, from
 * the shared COCKPIT_GUIDES, sits on the Links page beside the call's
 * framework. Key links and the command palette (Ctrl K) draw the same rows.
 *
 * Run: bun test scripts/guide-links.test.ts
 */

import { expect, test } from "bun:test";
import { COCKPIT_GUIDES } from "../src/lib/cockpits";
import { LINK_GROUPS } from "../src/lib/creativeLinks";

const call = LINK_GROUPS.find(g => g.title === "The Brand Blueprint call");

test("the Blueprint video follows the call's framework", () => {
  const labels = call?.rows.map(r => r.label) ?? [];
  const at = labels.indexOf(
    "Brand Blueprint call: run it in this cockpit (video)",
  );
  expect(at).toBe(1);
  expect(labels[0]).toBe("Brand Blueprint call framework (the SOP)");
});

test("the Blueprint row opens its Drive video", () => {
  const row = call?.rows.find(r => r.label.startsWith("Brand Blueprint call:"));
  expect(row?.url).toBe(COCKPIT_GUIDES.creative.howTo.blueprint);
  expect(row?.url).toBe(
    "https://drive.google.com/file/d/11Lry1EYCxCxlfc96QESOSTuH5KVI6coi/view",
  );
});

test("the guide group still opens the demo and both SOPs", () => {
  const guide = LINK_GROUPS.find(g => g.title === "How this cockpit works");
  expect(guide?.rows.slice(0, 3).map(r => r.url)).toEqual([
    COCKPIT_GUIDES.creative.video,
    COCKPIT_GUIDES.creative.simple,
    COCKPIT_GUIDES.creative.deep,
  ]);
});
