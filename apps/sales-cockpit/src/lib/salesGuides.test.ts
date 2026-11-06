/**
 * The setter's day in the dialer (2026-11-06): the Links page shows its SOP
 * and its video as one card, the video plays from Wistia, and both addresses
 * come from the shared COCKPIT_GUIDES, the same in all five apps.
 *
 * Run: bun test src/lib/salesGuides.test.ts
 */

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COCKPIT_GUIDES, SOP_VIDEOS, wistiaPlayer } from "./cockpits";
import { SALES_GUIDE_GROUPS } from "./salesGuides";

const setter = SALES_GUIDE_GROUPS.find(g => g.id === "setter-day");

test("the setter's card lists the SOP, then the video", () => {
  expect(setter?.title).toBe("The setter's day in the dialer");
  expect(setter?.rows.map(r => r.label)).toEqual([
    "The setter's day in the dialer (the SOP)",
    "The setter's day in the dialer (video)",
  ]);
  expect(setter?.blurb).toContain("instead of the four Slack channels");
});

test("the SOP opens the Google Doc and the video its Drive file", () => {
  expect(setter?.rows.map(r => r.url)).toEqual([
    "https://docs.google.com/document/d/1J0h59nnDZjSH0SwfHB8lVJG7NzB1e-cNo1FdFZjlbVg/edit",
    "https://drive.google.com/file/d/1jXgNxiLeOhgUB1THzjx_Fvxbgzb9cyW2/view",
  ]);
  expect(setter?.rows[0].url).toBe(COCKPIT_GUIDES.sales.sops.setter);
  expect(setter?.rows[1].url).toBe(COCKPIT_GUIDES.sales.howTo.setter);
});

test("the video row plays the setter's narrated Wistia media", () => {
  const video = setter?.rows[1].video;
  expect(video).toBe(SOP_VIDEOS.sales.setter);
  expect(video?.url).toBe(setter?.rows[1].url);
  expect(video?.key).toBe("sales-setter");
  expect(video?.length).toBe("11:19");
  expect(wistiaPlayer(video?.wistia ?? "")).toBe(
    "https://fast.wistia.net/embed/iframe/meweo5l2k9",
  );
});

test("the five cockpits.ts copies carry the same guides", () => {
  const here = readFileSync(join(import.meta.dir, "cockpits.ts"), "utf8");
  for (const app of [
    "client-success-cockpit",
    "creative-director-cockpit",
    "media-buyer-cockpit",
    "video-editor-cockpit",
  ])
    expect(
      readFileSync(
        join(import.meta.dir, `../../../${app}/src/lib/cockpits.ts`),
        "utf8",
      ),
    ).toBe(here);
});

test("the Links page shows the card and search finds its rows", () => {
  const page = readFileSync(
    join(import.meta.dir, "../pages/LinksPage.tsx"),
    "utf8",
  );
  expect(page).toContain("SALES_GUIDE_GROUPS.map");
  const search = readFileSync(
    join(import.meta.dir, "../components/SearchBox.tsx"),
    "utf8",
  );
  expect(search).toContain("...GUIDE_HITS");
});
