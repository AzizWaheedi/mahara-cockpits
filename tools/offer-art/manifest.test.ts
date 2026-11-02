import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import selection from "./selection.website.json";
import { COCKPIT_ART, SITE_ART } from "./paths";
import { hash } from "./export";
test("every manifest image exists identically in both consumers", async () => {
  const a = JSON.parse(await readFile(join(COCKPIT_ART,"manifest.json"),"utf8"));
  const b = JSON.parse(await readFile(join(SITE_ART,"manifest.json"),"utf8"));
  expect(a).toEqual(b);
  expect(a.motion).toBeNull();
  expect(a.images).toHaveLength(selection.images.length);
  for (const image of a.images) {
    const bytes = await readFile(join(COCKPIT_ART,image.file));
    expect(bytes).toEqual(await readFile(join(SITE_ART,image.file)));
    expect(bytes.length).toBe(image.bytes);
    expect(hash(bytes)).toBe(image.sha256);
    expect(selection.images.find(i=>i.id===image.id)?.md5).toBe(image.md5);
  }
});
