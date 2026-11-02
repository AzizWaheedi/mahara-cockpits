import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { clientForAccount, normalize } from "./calculator";

// Smmim studio, 2026-10-28: Client Data held the bare id 1988430024784828 and
// the tracker named the account "1988430024784828, SAR", so the campaign had
// no client tag, no bookings and no service mode.
const sheet = (cells: [string, string][]) =>
  new Map(cells.map(([meta, name]) => [normalize(meta), name]));

describe("clientForAccount", () => {
  test("a bare id on Client Data matches the tracker's '<id>, <CUR>' account", () => {
    const map = sheet([["1988430024784828", "Smmim studio"]]);
    expect(clientForAccount(map, "1988430024784828, SAR")).toBe("Smmim studio");
    expect(clientForAccount(map, "1988430024784828,KWD")).toBe("Smmim studio");
  });

  test("an exact match returns what it always did and wins over the bare id", () => {
    const map = sheet([
      ["718146936708597, SAR", "Ardon"],
      ["718146936708597", "Someone else"],
      ["منشآت خالدة", "Khalida"],
    ]);
    expect(clientForAccount(map, "718146936708597, SAR")).toBe("Ardon");
    expect(clientForAccount(map, "منشآت خالدة")).toBe("Khalida");
    expect(clientForAccount(map, "718146936708597")).toBe("Someone else");
  });

  test("an account Client Data does not list matches no client", () => {
    const map = sheet([["1988430024784828", "Smmim studio"]]);
    expect(clientForAccount(map, "999999999999999, SAR")).toBeUndefined();
    expect(clientForAccount(map, "Unknown account")).toBeUndefined();
    // A sheet "<id>, <CUR>" is never reached from a bare tracker id.
    expect(
      clientForAccount(sheet([["718146936708597, SAR", "Ardon"]]), "718146936708597"),
    ).toBeUndefined();
  });
});

test("the worker reads clientByAccount only through clientForAccount", () => {
  const calc = readFileSync(new URL("./calculator.ts", import.meta.url), "utf8");
  // Both are inside clientForAccount itself.
  expect(calc.match(/clientByAccount\.get\(/g)?.length).toBe(2);
  expect(calc.match(/clientForAccount\(clientByAccount,/g)?.length).toBe(4);
});
