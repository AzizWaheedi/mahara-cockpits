import { expect, test } from "bun:test";
import { stillPropsFor } from "../src/components/CreativePreview";
import { deadStillHost, uniqueUrls } from "../src/lib/metaMedia";

const rowStill =
  "https://bldgtotkfmhoxmlzowdx.supabase.co/storage/v1/object/public/cockpit-ad-stills/" +
  "a".repeat(64);
const row = { stillKey: "c:444444", stillUrl: rowStill, stillTinyUrl: null };

test("a refused saved copy keeps the row's own still and leaves the Meta thumbnail alone", () => {
  const props = stillPropsFor(row, {
    "c:444444": { error: "The current ad creative is missing or changed." },
  });
  expect(props.backupStillUrl).toBe(rowStill);
  expect(props.stillUrl).toBeUndefined();
  // Spread after thumbUrl={...} at the call sites, so it must not carry the key.
  expect("thumbUrl" in props).toBe(false);
});

test("a still that is still loading does not blank the card either", () => {
  const props = stillPropsFor(row, { "c:444444": { error: "Loading saved image." } });
  expect(props.backupStillUrl).toBe(rowStill);
});

test("a saved copy, when it loads, comes first and the row's still is the backup", () => {
  const saved = rowStill.replace("aaaa", "bbbb");
  const props = stillPropsFor(row, { "c:444444": { url: saved } });
  expect(props.stillUrl).toBe(saved);
  expect(props.backupStillUrl).toBe(rowStill);
});

test("links to the retired Convex file store are never tried", () => {
  const dead = "https://adorable-seahorse-418.convex.cloud/api/storage/d0adff4c-7578";
  expect(deadStillHost(dead)).toBe(true);
  expect(deadStillHost(rowStill)).toBe(false);
  expect(uniqueUrls([dead, rowStill, rowStill, null])).toEqual([rowStill]);
});
