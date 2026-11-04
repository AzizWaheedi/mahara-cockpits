import { describe, expect, test } from "bun:test";
import {
  CARD_GROUP_FIELD,
  cardGroup,
  cardRead,
  cardVerdict,
  CONTENT_FOLDER,
  columnLetter,
  columnsOf,
  FOLDER_KINDS,
  groupOf,
  groupVerdict,
  isFolderLink,
  jitterMs,
  last4,
  maskFolder,
  maskInviteLink,
  needsFolder,
  normalise,
  sha256,
  sheetShape,
  withFolder,
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

describe("Client Data, by its three headers only", () => {
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
    ).toEqual({ ok: true, group: G1, folder: { ok: false, why: "no_column" } });
    // Old-style group ids with a dash are groups too.
    expect(
      groupOf(
        sheet(["x", "", "", "", "86abc0001", "96550000000-1600000000@g.us"]),
        "86abc0001",
      ),
    ).toMatchObject({ ok: true, group: "96550000000-1600000000@g.us" });
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

describe("the content folder: Client Data's Google Drive Link on the card's one row (WAVE56 D-S4.0)", () => {
  // The live header row, A to I (Make 13 [31] searches it; [48] reads H, its `7`).
  const live = [
    "Status",
    "Client Name",
    "Clickup ID",
    "GHL ID",
    "GHL API",
    "WA GROUP ID",
    "Report Document ID",
    " Google  Drive Link ",
    "Sheet Link",
  ];
  const FOLDER = "https://drive.google.com/drive/folders/1InventedFolderId0000";
  const row = (link: unknown, task = "86abc0001", group: unknown = G1) => [
    "Active",
    "Acme Interiors",
    task,
    "SECRET-GHL",
    "SECRET-KEY",
    group,
    "SECRET-DOC",
    link,
    "SECRET-SHEET",
  ];
  test("found by its header name, from the same row as the group; column H on the live sheet", () => {
    expect(columnsOf([live])).toEqual({ task: 2, group: 5, folder: 7 });
    expect(columnLetter(columnsOf([live]).folder)).toBe("H");
    expect(groupOf([live, row(` ${FOLDER} `)], "86abc0001")).toEqual({
      ok: true,
      group: G1,
      folder: { ok: true, link: FOLDER },
    });
    // Another card's link is never this card's.
    expect(
      groupOf(
        [live, row("", "86abc0001"), row(FOLDER, "86abc0002", G2)],
        "86abc0001",
      ),
    ).toEqual({ ok: true, group: G1, folder: { ok: false, why: "none" } });
  });
  test("an empty cell is none; words, two links or another scheme are no link; a sheet without the header has no column", () => {
    for (const cell of ["", "   ", null, undefined])
      expect(groupOf([live, row(cell)], "86abc0001")).toMatchObject({
        folder: { ok: false, why: "none" },
      });
    for (const cell of [
      "Drive",
      "drive.google.com/drive/folders/x",
      `Folder: ${FOLDER}`,
      `${FOLDER} ${FOLDER}`,
      "ftp://drive.google.com/x",
      "javascript:alert(1)",
      "https://",
      7,
    ])
      expect(groupOf([live, row(cell)], "86abc0001")).toMatchObject({
        folder: { ok: false, why: "invalid" },
      });
    expect(
      groupOf(
        [live.map(h => (h.includes("Drive") ? "Drive" : h)), row(FOLDER)],
        "86abc0001",
      ),
    ).toMatchObject({ ok: true, folder: { ok: false, why: "no_column" } });
    expect(isFolderLink("http://drive.google.com/x")).toBe(true);
    expect(isFolderLink(FOLDER)).toBe(true);
  });
  test("a missing folder never stops the group: recaps read the row as before", () => {
    expect(groupOf([live, row("")], "86abc0001")).toMatchObject({
      ok: true,
      group: G1,
    });
    expect(sheetShape([live])).toEqual({ ok: true, column: "F" });
  });
  test("only a phase 3 or phase 4 text that keeps the placeholder needs it", () => {
    expect(CONTENT_FOLDER).toBe("{content_folder}");
    expect(FOLDER_KINDS).toEqual(["phase3", "phase4"]);
    expect(needsFolder("phase3", "x\n{content_folder}")).toBe(true);
    expect(needsFolder("phase4", "{content_folder}")).toBe(true);
    expect(needsFolder("phase4", "no folder here")).toBe(false);
    for (const kind of ["recap_checkin", "form_invite", "phase5"])
      expect(needsFolder(kind, "{content_folder}")).toBe(false);
  });
  test("filled as plain text, every placeholder; masked back by the exact link, so the fingerprint matches", () => {
    const body = "ارفعوا المحتوى هني:\n{content_folder}";
    const sent = withFolder(body, FOLDER);
    expect(sent).toBe(`ارفعوا المحتوى هني:\n${FOLDER}`);
    expect(sha256(normalise(maskFolder(`${sent}  \n`, FOLDER)))).toBe(
      sha256(normalise(body)),
    );
    // A `$` in a link is never read as a replacement pattern.
    const odd = "https://drive.google.com/x?a=$&b=$1";
    expect(withFolder("{content_folder} and {content_folder}", odd)).toBe(
      `${odd} and ${odd}`,
    );
    expect(maskFolder(`${odd} and ${odd}`, odd)).toBe(
      "{content_folder} and {content_folder}",
    );
    // No link, or another link: nothing changes.
    expect(maskFolder(sent, null)).toBe(sent);
    expect(maskFolder(sent, "https://drive.google.com/other")).toBe(sent);
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
  test("an answer that does not list the card's fields is unread, never empty; a card that lists them can be empty", () => {
    for (const answer of [
      {},
      null,
      undefined,
      "x",
      { err: "Team not authorized" },
      { id: "abc", custom_fields: "x" },
      { id: "abc", custom_fields: null },
      { custom_fields: [{ id: CARD_GROUP_FIELD, value: 120363 }] },
      { custom_fields: [{ id: CARD_GROUP_FIELD, value: { group: G1 } }] },
    ]) {
      expect([answer, cardRead(answer), cardVerdict(G1, answer)]).toEqual([
        answer,
        false,
        "unread",
      ]);
    }
    for (const answer of [
      { custom_fields: [] },
      { custom_fields: [{ id: "other", value: G2 }] },
      { custom_fields: [{ id: CARD_GROUP_FIELD }] },
      { custom_fields: [{ id: CARD_GROUP_FIELD, value: null }] },
      { custom_fields: [{ id: CARD_GROUP_FIELD, value: "" }] },
    ]) {
      expect([answer, cardRead(answer), cardVerdict(G1, answer)]).toEqual([
        answer,
        true,
        "empty",
      ]);
    }
    const on = (value: string) => ({
      custom_fields: [{ id: CARD_GROUP_FIELD, value }],
    });
    expect(cardVerdict(G1, on(G1))).toBe("same");
    expect(cardVerdict(G1, on(G2))).toBe("differs");
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

describe("maskInviteLink (docs/forms/WAVE34-CONTRACT.md 4.1.6)", () => {
  const token = `f1${"Zz9_-".repeat(8)}abc`;
  test("a sent form link reads back as its placeholder, every time it appears", () => {
    expect(maskInviteLink(`Answer here: https://portal.maharamedia.com/f#${token}`)).toBe("Answer here: {form_link}");
    expect(sha256(normalise(maskInviteLink(`x https://portal.maharamedia.com/f#${token} `)))).toBe(sha256(normalise("x {form_link}")));
  });
  test("anything that is not a whole minted link is left as it is", () => {
    for (const t of [
      "https://portal.maharamedia.com/f#f1short",
      `https://portal.maharamedia.com/f/${token}`,
      `https://example.test/f#${token}`,
      "no link at all",
    ])
      expect(maskInviteLink(t)).toBe(t);
  });
});
