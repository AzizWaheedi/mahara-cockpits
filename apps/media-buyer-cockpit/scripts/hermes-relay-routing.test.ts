import { expect, test } from "bun:test";
import { hasThreadReadingState } from "../src/lib/relay-routing";

test("only real chat threads are marked reading", () => {
  expect(hasThreadReadingState("local")).toBe(true);
  expect(hasThreadReadingState("csm")).toBe(true);
  expect(hasThreadReadingState("creative")).toBe(true);
  // Draft/fix relays use synthetic IDs, not a cockpit chat document ID.
  expect(hasThreadReadingState("wadraft")).toBe(false);
  expect(hasThreadReadingState("fix")).toBe(false);
});
