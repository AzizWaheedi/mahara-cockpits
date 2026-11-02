/**
 * The SOP videos play inside the cockpit (Aziz, 2026-11-02): each one where
 * its work happens, from the shared SOP_VIDEOS, and only once opened.
 *
 * Run: bun test scripts/sop-videos.test.tsx
 */

import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SopVideo } from "../src/components/SopVideo";
import { COCKPIT_GUIDES, SOP_VIDEOS, wistiaPlayer } from "../src/lib/cockpits";
import { LINK_GROUPS } from "../src/lib/csmLinks";
import { prepVideo } from "../src/present/PrepView";

test("every SOP video is a cockpit guide's Drive file", () => {
  const guides = Object.values(COCKPIT_GUIDES).flatMap(g => [
    g.video,
    ...Object.values("howTo" in g ? g.howTo : {}),
  ]);
  const videos = Object.values(SOP_VIDEOS).flatMap(c => Object.values(c));
  expect(videos.map(v => v.url).sort()).toEqual([...guides].sort());
  for (const v of videos) expect(v.length).toMatch(/^\d:\d\d$/);
  expect(new Set(videos.map(v => v.key)).size).toBe(videos.length);
});

test("each video plays from its own Wistia media", () => {
  const videos = Object.values(SOP_VIDEOS).flatMap(c => Object.values(c));
  for (const v of videos) expect(v.wistia).toMatch(/^[a-z0-9]{10}$/);
  expect(new Set(videos.map(v => v.wistia)).size).toBe(videos.length);
  expect(wistiaPlayer(SOP_VIDEOS.csm.offers.wistia)).toBe(
    "https://fast.wistia.net/embed/iframe/7nqvimzoia",
  );
});

test("each call's prep holds its own video", () => {
  expect(prepVideo("onboarding")).toBe(SOP_VIDEOS.csm.onboarding);
  expect(prepVideo("launch")).toBe(SOP_VIDEOS.csm.launch);
  expect(prepVideo("offer_website")).toBe(SOP_VIDEOS.csm.offers);
  // The creative director's page holds the Blueprint's, above the frame.
  expect(prepVideo("blueprint")).toBeNull();
});

test("the Links page plays the demo and the three how-to videos", () => {
  const guide = LINK_GROUPS.find(g => g.title === "How this cockpit works");
  expect(guide?.rows.filter(r => r.video).map(r => r.video?.key)).toEqual([
    "csm-demo",
    "csm-onboarding",
    "csm-launch",
    "csm-offers",
  ]);
  for (const r of guide?.rows ?? [])
    if (r.video) expect(r.url).toBe(r.video.url);
});

test("folded, the player loads nothing; opened, it plays the file", () => {
  const shut = renderToStaticMarkup(<SopVideo video={SOP_VIDEOS.csm.offers} />);
  expect(shut).not.toContain("<iframe");
  expect(shut).toContain("Pitch an offer and send a proposal");
  expect(shut).toContain("2:46");
  const open = renderToStaticMarkup(
    <SopVideo video={SOP_VIDEOS.csm.offers} startOpen />,
  );
  expect(open).toContain(
    'src="https://fast.wistia.net/embed/iframe/7nqvimzoia"',
  );
  expect(open).toContain("Open in Drive");
});
