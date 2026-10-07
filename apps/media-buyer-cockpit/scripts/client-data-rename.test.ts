import { describe, expect, test } from "bun:test";
import { type ClientDataRow, renameCell } from "../convex/clientData";

const row = (over: Partial<ClientDataRow>): ClientDataRow => ({
  rowNumber: 2,
  status: "Active",
  name: "",
  clickupId: "",
  ghlLocationId: "",
  ghlToken: "",
  waGroupId: "",
  reportDocId: "",
  driveLink: "",
  sheetLink: "",
  adAccountSnap: "",
  adAccountMeta: "",
  adAccountTiktok: "",
  ...over,
});

const rows = [
  row({ rowNumber: 9, name: "Acturus Construction", clickupId: "86eyqx2f6" }),
  row({ rowNumber: 31, name: "Architecture Team", clickupId: "86ex3n199" }),
];

describe("correcting a client's name in Client Data", () => {
  test("the row is found by its ClickUp id and the cell by the name column", () => {
    expect(
      renameCell(
        rows,
        1,
        "86eyqx2f6",
        "Acturus Construction",
        "Arcturus Construction",
      ),
    ).toEqual({ cell: "B9", rowNumber: 9 });
  });

  test("nothing is written when the row no longer reads the old name", () => {
    const out = renameCell(
      rows,
      1,
      "86eyqx2f6",
      "Something Else",
      "Arcturus Construction",
    );
    expect("error" in out && out.error).toContain(
      'reads "Acturus Construction"',
    );
  });

  test("nothing is written for an unknown card, an empty name or no name column", () => {
    expect("error" in renameCell(rows, 1, "nope", "x", "y")).toBe(true);
    expect(
      "error" in renameCell(rows, 1, "86eyqx2f6", "Acturus Construction", "  "),
    ).toBe(true);
    expect(
      "error" in
        renameCell(
          rows,
          -1,
          "86eyqx2f6",
          "Acturus Construction",
          "Arcturus Construction",
        ),
    ).toBe(true);
  });
});
