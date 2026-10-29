import { describe, expect, test } from "bun:test";
import {
  CARD_GROUP_FIELD,
  cardGroup,
  columnLetter,
  groupOf,
  groupVerdict,
  jitterMs,
  last4,
  normalise,
  sha256,
  sheetShape,
} from "./core.ts";

// Every card, group and client here is invented.
const G1 = "120363000000000001@g.us";
const G2 = "120363000000000002@g.us";
const head = [
  "Client Name",
  "Package",
  "Start",
  "Phone",
  " ClickUp ID ",
  "WA Group ID",
  "Notes",
];
const sheet = (...rows: unknown[][]) => [head, ...rows];

describe("Client Data, by its two headers only", () => {
  test("one row for the card with a group id gives the group", () => {
    expect(
      groupOf(
        sheet([
          "Acme Interiors",
          "Growth",
          "2026-09-01",
          "SECRET-PHONE",
          "86abc0001",
          G1,
          "SECRET-NOTE",
        ]),
        "86abc0001",
      ),
    ).toEqual({ ok: true, group: G1 });
    // Old-style group ids with a dash are groups too.
    expect(
      groupOf(
        sheet(["x", "", "", "", "86abc0001", "96550000000-1600000000@g.us"]),
        "86abc0001",
      ),
    ).toEqual({ ok: true, group: "96550000000-1600000000@g.us" });
  });
  test("no row, an empty cell, two rows, a non-group id, or the columns missing", () => {
    expect(
      groupOf(sheet(["Other", "", "", "", "86abc0002", G2]), "86abc0001"),
    ).toEqual({ ok: false, why: "none" });
    expect(
      groupOf(sheet(["Acme", "", "", "", "86abc0001", ""]), "86abc0001"),
    ).toEqual({ ok: false, why: "none" });
    expect(
      groupOf(
        sheet(
          ["Acme", "", "", "", "86abc0001", G1],
          ["Acme again", "", "", "", "86abc0001", G2],
        ),
        "86abc0001",
      ),
    ).toEqual({ ok: false, why: "many" });
    expect(
      groupOf(
        sheet(["Acme", "", "", "", "86abc0001", "96550000001@s.whatsapp.net"]),
        "86abc0001",
      ),
    ).toEqual({ ok: false, why: "invalid" });
    expect(
      groupOf(
        [
          ["Client", "Task"],
          ["Acme", "86abc0001"],
        ],
        "86abc0001",
      ),
    ).toEqual({ ok: false, why: "no_columns" });
    expect(groupOf([], "86abc0001")).toEqual({ ok: false, why: "no_columns" });
    expect(groupOf(sheet(["Acme", "", "", "", "", G1]), "")).toEqual({
      ok: false,
      why: "none",
    });
  });
  test("no other column is read: changing every other cell changes nothing", () => {
    const a = groupOf(
      sheet(["A", "B", "C", "D", "86abc0001", G1, "E"]),
      "86abc0001",
    );
    const b = groupOf(
      sheet([null, 7, {}, [], "86abc0001", G1, "zzz"]),
      "86abc0001",
    );
    expect(a).toEqual(b);
  });
  test("the column F shape: WA GROUP ID must stay in F", () => {
    expect(sheetShape(sheet())).toEqual({ ok: true, column: "F" });
    expect(sheetShape([["Client", "ClickUp ID", "WA Group ID"]])).toEqual({
      ok: false,
      column: "C",
    });
    expect(sheetShape([["Client", "Phone"]])).toEqual({
      ok: false,
      column: null,
    });
    expect(columnLetter(0)).toBe("A");
    expect(columnLetter(25)).toBe("Z");
    expect(columnLetter(26)).toBe("AA");
  });
});

describe("the card's group and the verdict", () => {
  test("the card field is read by its id; an empty one is null", () => {
    expect(
      cardGroup({
        custom_fields: [
          { id: "other", value: G2 },
          { id: CARD_GROUP_FIELD, value: ` ${G1} ` },
        ],
      }),
    ).toBe(G1);
    expect(cardGroup({ custom_fields: [{ id: CARD_GROUP_FIELD }] })).toBeNull();
    expect(
      cardGroup({ custom_fields: [{ id: CARD_GROUP_FIELD, value: "" }] }),
    ).toBeNull();
    expect(cardGroup({})).toBeNull();
    expect(cardGroup(null)).toBeNull();
  });
  test("empty or the same passes; a different group is refused", () => {
    expect(groupVerdict(G1, null)).toBe("empty");
    expect(groupVerdict(G1, G1)).toBe("same");
    expect(groupVerdict(G1, G2)).toBe("differs");
  });
});

describe("matching a sent text again, and the wait", () => {
  test("normalise forgives line endings, trailing spaces and the Unicode form, and nothing else", () => {
    const sent = "مرحبا،\nهذا ملخص المكالمة.\n\nInvented line.";
    expect(
      normalise("مرحبا،  \r\nهذا ملخص المكالمة.\r\n\r\nInvented line.\n"),
    ).toBe(sent);
    expect(sha256(normalise("Café"))).toBe(sha256(normalise("Café")));
    expect(normalise("one two")).not.toBe(normalise("one  two"));
  });
  test("sha256 is of the exact UTF-8 bytes", () => {
    expect(sha256("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(sha256("ملخص")).toBe(
      "c4be7405ec278fcfda9ec12156bf46fea539a618390a8444c9c8b55f02b41b67",
    );
  });
  test("jitterMs is uniform from 30 to 120 seconds", () => {
    expect(jitterMs(() => 0)).toBe(30_000);
    expect(jitterMs(() => 0.999999999999)).toBe(120_000);
    expect(jitterMs(() => 0.5)).toBe(75_000);
    for (let i = 0; i < 200; i++) {
      const ms = jitterMs();
      expect(ms).toBeGreaterThanOrEqual(30_000);
      expect(ms).toBeLessThanOrEqual(120_000);
    }
  });
  test("last4 gives four digits, never more", () => {
    expect(last4("96550001234@s.whatsapp.net")).toBe("1234");
    expect(last4(G1)).toBe("0001");
    expect(last4("12")).toBeNull();
    expect(last4(null)).toBeNull();
  });
});
