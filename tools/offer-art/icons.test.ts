import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { ICON_STROKE, MIRROR_IN_RTL, OFFER_ICON_NAMES, iconSprite } from "../../apps/client-success-cockpit/src/present/offer/art/icons";
import { SPRITE } from "./paths";
test("the public sprite is exactly the deck linework", async () => {
  expect((await readFile(SPRITE,"utf8")).trim()).toBe(iconSprite().trim());
  expect(new Set(OFFER_ICON_NAMES).size).toBe(11);
  expect(ICON_STROKE).toBe(1.5);
  for (const name of OFFER_ICON_NAMES) expect(iconSprite()).toContain(`id="${name}"`);
  for (const name of MIRROR_IN_RTL) expect(iconSprite()).toContain(`id="${name}-rtl"`);
  expect(iconSprite()).not.toMatch(/<script|onload|<image|<foreignObject/);
});
