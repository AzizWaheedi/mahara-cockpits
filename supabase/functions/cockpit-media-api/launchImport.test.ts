import { expect, test } from "bun:test";
import { normalizeImportLinks } from "./launchImport";
test("file links are canonical and deduplicated across sharing formats", () => {
 expect(normalizeImportLinks(["https://drive.google.com/file/d/abcdefghijklmnop/view?usp=sharing", "https://drive.google.com/open?id=abcdefghijklmnop"])).toEqual(["https://drive.google.com/file/d/abcdefghijklmnop/view"]);
});
test("imports reject folders, arbitrary hosts, insecure URLs and oversized batches", () => {
 for (const input of [[], Array(7).fill("https://drive.google.com/file/d/abcdefghijklmnop/view"), ["https://evil.test/file/d/abcdefghijklmnop/view"], ["http://drive.google.com/file/d/abcdefghijklmnop/view"], ["https://drive.google.com/drive/folders/abcdefghijklmnop"], ["https://drive.google.com.evil.test/file/d/abcdefghijklmnop/view"], ["https://a:b@drive.google.com/file/d/abcdefghijklmnop/view"]]) expect(() => normalizeImportLinks(input)).toThrow();
});
