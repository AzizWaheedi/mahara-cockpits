import { describe, expect, test } from "bun:test";
import { assertBudget, checkSelection, filterFor, hash, limitFor } from "./export";
describe("reviewed master exports", () => {
  test("selection is bounded and labels fictional work", () => expect(checkSelection).not.toThrow());
  test("every transformation ends at the exact full HD crop", () => {
    expect(filterFor("quiet-navy")).toContain("crop=1920:1080");
    expect(filterFor("highlight-cap")).not.toContain("0.32");
    expect(()=>filterFor("invented")).toThrow();
  });
  test("byte budgets reject a single over-budget or empty image", () => {
    expect(limitFor("hero")).toBe(250000);
    expect(()=>assertBudget([{id:"hero",bytes:250001}])).toThrow();
    expect(()=>assertBudget([{id:"stone",bytes:0}])).toThrow();
    expect(()=>assertBudget([{id:"stone",bytes:150001}])).toThrow();
    expect(()=>assertBudget(Array.from({length:6},()=>({id:"stone",bytes:150000})))).toThrow();
  });
  test("provenance hashes the bytes, not their filenames", () => {
    expect(hash(new TextEncoder().encode("abc"),"md5")).toBe("900150983cd24fb0d6963f7d28e17f72");
  });
});
