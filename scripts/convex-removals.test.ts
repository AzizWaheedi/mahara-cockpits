/**
 * The deploy guard (scripts/convex-removals.ts): a function production has
 * and this clone does not export is a removal, unless it is named.
 *
 * Run: bun test scripts/convex-removals.test.ts
 */

import { describe, expect, test } from "bun:test";
import {
  exportedNames,
  removals,
  splitIdentifier,
} from "./convex-removals";

describe("what a module exports", () => {
  test("every export form the cockpits use", () => {
    const src = `
      export const kits = authenticatedAction({});
      export const syncAll = internalAction({});
      export async function helper() {}
      export function plain() {}
      export const { auth, signIn: signInFn, signOut, store, ...rest } = convexAuth({});
      const a = 1, b = 2;
      export { a, b as bee };
      export default http;
      // export const commented = query({});
    `;
    const names = exportedNames(src);
    for (const n of ["kits", "syncAll", "helper", "plain", "auth", "signInFn", "signOut", "store", "rest", "a", "bee", "default"])
      expect(names.has(n)).toBe(true);
    expect(names.has("signIn")).toBe(false);
    expect(names.has("b")).toBe(false);
  });

  test("identifiers split into module and name, nested modules too", () => {
    expect(splitIdentifier("checkIns.js:prepare")).toEqual(["checkIns", "prepare"]);
    expect(splitIdentifier("ceo/queries.js:history")).toEqual(["ceo/queries", "history"]);
    expect(splitIdentifier("not an identifier")).toBeNull();
  });
});

describe("what a deploy would remove", () => {
  const modules = new Map([
    ["csm", "export const act = authenticatedMutation({});"],
    ["onboarding", "export const kits = authenticatedAction({});\nexport const syncAll = internalAction({});"],
    ["ceo/queries", "export const history = query({});"],
  ]);

  test("nothing, when every production function is still exported", () => {
    expect(
      removals(["csm.js:act", "onboarding.js:kits", "ceo/queries.js:history"], modules),
    ).toEqual([]);
  });

  test("another agent's module and a dropped function are named", () => {
    // 2026-10-05: the check-in booking was in production from a branch.
    expect(
      removals(
        ["checkIns.js:prepare", "checkIns.js:book", "csm.js:act", "onboarding.js:refresh"],
        modules,
      ),
    ).toEqual(["checkIns.js:book", "checkIns.js:prepare", "onboarding.js:refresh"]);
  });

  test("a removal that is meant is named, by function or by module", () => {
    expect(
      removals(["checkIns.js:prepare", "checkIns.js:book", "onboarding.js:refresh"], modules, [
        "checkIns.js",
        " onboarding.js:refresh ",
      ]),
    ).toEqual([]);
  });
});
