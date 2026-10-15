import { expect, test } from "bun:test";
import { drivePreview } from "../src/lib/reviewMedia";
test("only exact HTTPS Drive file links can be embedded", () => {
  expect(drivePreview("https://drive.google.com/file/d/1234567890abcd/view?usp=sharing")).toBe("https://drive.google.com/file/d/1234567890abcd/preview");
  expect(drivePreview("https://drive.google.com/open?id=1234567890abcd")).toContain("/preview");
  for (const url of ["javascript:alert(1)","https://drive.google.com.evil.test/file/d/1234567890abcd/view","https://example.com/video.mp4","http://drive.google.com/file/d/1234567890abcd/view","https://drive.google.com/drive/folders/1234567890abcd","bad"])
    expect(drivePreview(url)).toBeNull();
});
