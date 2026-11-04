import { expect, test } from "bun:test";
import selection from "./selection.website.json";
test("art is labelled as an example, never a result or a real client's work", () => {
  for(const image of selection.images){
    expect(image.alt.en.startsWith("Example:")).toBe(true);
    expect(image.alt.ar.startsWith("مثال:")).toBe(true);
    expect(image.alt.en).not.toMatch(/guarantee|results|client|leads|CPL|spend|budget|upsell|[—–]/i);
    expect(image.alt.ar).not.toMatch(/[—–]/);
  }
});
