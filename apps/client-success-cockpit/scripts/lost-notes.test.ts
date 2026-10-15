/**
 * The client success copy of lostNotes.ts (the same file as the media
 * buyer's, kept in step by scripts/check-shared.sh): a lost lead's note on
 * Results shows only what the agent typed, never the dialer's system lines.
 * The cases mirror apps/media-buyer-cockpit/scripts/lost-notes.test.ts.
 */
import { describe, expect, test } from "bun:test";
import { cleanLostNote } from "../src/lib/lostNotes";

const id = "[mahara:8a03189f-5850-467c-9e20-06d7117e0b09]";
const agent =
  "Outcome recorded by the agent; this does not establish a verified Maqsam call.";

describe("cleanLostNote", () => {
  test("dialer LOST note keeps the agent's words and flags it unverified", () => {
    const raw = `LOST: Other\n${agent}\nHe's not Arab, not serious.\n${id}`;
    expect(cleanLostNote(raw)).toEqual({
      note: "He's not Arab, not serious.",
      unverified: true,
    });
  });

  test("works when GHL has flattened the line breaks", () => {
    const raw = `LOST: Other ${agent} She closed the line: not interested. ${id}`;
    expect(cleanLostNote(raw)?.note).toBe(
      "She closed the line: not interested.",
    );
  });

  test("ladder-exhausted NO ANSWER keeps only the agent's word", () => {
    const raw = `NO ANSWER: Follow-up ladder exhausted. Lost: Unreachable.\n${agent}\nBusy\n${id}`;
    expect(cleanLostNote(raw)?.note).toBe("Busy");
    const flat = raw.replace(/\n/g, " ");
    expect(cleanLostNote(flat)?.note).toBe("Busy");
  });

  test("drops system lines and the feedback shared with the client", () => {
    const raw = `CANCELLED: Financial Issue\nNo-show attempt 2 of 3.\nClient sheet: no-show; row 14.\nReturned missed Maqsam call: 991.\nManual call reported by the agent; Maqsam duration is unverified.\nبيفكر ويرجع لنا\nFeedback shared with client: lead wants a cheaper option\n${id}`;
    expect(cleanLostNote(raw)).toEqual({
      note: "بيفكر ويرجع لنا",
      unverified: true,
    });
  });

  test("a flattened note with one break before the tag keeps the words", () => {
    const raw = `LOST: Other ${agent} He's not Arab. He doesn't have any project.\n${id}`;
    expect(cleanLostNote(raw)).toEqual({
      note: "He's not Arab. He doesn't have any project.",
      unverified: true,
    });
  });

  test("a reason outside the dialer list is cut with its header line", () => {
    const raw = `CANCELLED: Changed their mind\nCancellation reason: Travelling\nWill call back after Eid\n${id}`;
    expect(cleanLostNote(raw)?.note).toBe(
      "Cancellation reason: Travelling Will call back after Eid",
    );
  });

  test("notes already stored flat are cleaned in the view", () => {
    // Exactly as the cockpit stored them on 2026-10-13.
    expect(
      cleanLostNote(
        "NO ANSWER: Follow-up ladder exhausted. Lost: Unreachable. Outcome recorded by the agent; this does not establish a verified Maqsam call. No answer [mahara:681c392b-c484-4919-a442-ae052f6fabb2]",
      ),
    ).toEqual({ note: "No answer", unverified: true });
    // The 240-character cut took the tag; the header still marks it.
    expect(
      cleanLostNote(
        `LOST: Other ${agent} He said the price is too high for a small kitchen and`,
      )?.note,
    ).toBe("He said the price is too high for a small kitchen and");
  });

  test("an already clean note stays the same", () => {
    expect(cleanLostNote("He's not Arab, not serious.")).toEqual({
      note: "He's not Arab, not serious.",
    });
    expect(cleanLostNote("LOST interest after the price")).toEqual({
      note: "LOST interest after the price",
    });
  });

  test("a note verified by Maqsam is not flagged", () => {
    const raw = `LOST: Distance Issue\nToo far from the clinic\n${id}`;
    expect(cleanLostNote(raw)).toEqual({ note: "Too far from the clinic" });
  });

  test("a note typed straight into GHL is kept as written", () => {
    expect(
      cleanLostNote("<p>Wants a <b>cheaper</b> option &amp; later</p>"),
    ).toEqual({
      note: "Wants a cheaper option & later",
    });
  });

  test("nothing human left means no note", () => {
    expect(cleanLostNote(`NO ANSWER\n${agent}\n\n${id}`)).toBeNull();
    expect(cleanLostNote("  ")).toBeNull();
  });

  test("a note as the client profile stored it on 2026-10-13", () => {
    // Joe and Sera Company's latest lost lead: the reason is in the header.
    const raw = `LOST: Unsure of reason or never came back\n${agent}\nToo old.\n${id}`;
    expect(cleanLostNote(raw)).toEqual({ note: "Too old.", unverified: true });
  });
});
