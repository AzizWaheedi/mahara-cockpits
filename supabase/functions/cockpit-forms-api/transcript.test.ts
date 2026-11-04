import { describe, expect, test } from "bun:test";
import { transcriptText } from "../../../hermes/csm-calls/fathomRules.ts";
import { clock, cut, cutBlock, labelLines, lineAt, MAX_LINES, numbered, parseTranscript, quoteOf, riskTalk, sameName, sideOfNameFrom } from "./transcript.ts";

const STAFF = [
  { name: "Csm Seat", email: "csm.seat@maharamedia.com" },
  { name: "Team Member Extra", email: "team.seat@maharamedia.com" },
];
const WHO = { recorderEmail: "CSM.Seat@maharamedia.com", recorderName: "Fathom Display Name", staff: STAFF };

describe("the transcript", () => {
  test("parses the worker's stored format, joins a broken line to its entry, and names a speaker it lacks", () => {
    const stored = transcriptText([
      { speaker: { display_name: "Csm Seat" }, text: "Hello: welcome.", timestamp: "00:00:05" },
      { speaker: { display_name: "Omar Testcontact" }, text: "Thanks", timestamp: "01:02:03" },
      { speaker: {}, text: "Who is this?", timestamp: "00:03" },
    ]);
    const entries = parseTranscript(`${stored}\nand a second line`);
    expect(entries).toEqual([
      { stamp: "00:00:05", at: 5, speaker: "Csm Seat", text: "Hello: welcome." },
      { stamp: "01:02:03", at: 3723, speaker: "Omar Testcontact", text: "Thanks" },
      { stamp: "00:00:03", at: 3, speaker: "Speaker", text: "Who is this? and a second line" },
    ]);
    expect(parseTranscript(null)).toEqual([]);
  });

  test("labels: CSM for the recorder (by the staff list's name), Team for other staff, Client for everyone else", () => {
    const lines = labelLines(
      parseTranscript(["[00:00:01] Csm Seat Alhusseini: Hi", "[00:00:02] Csm: Short", "[00:00:03] Team Member: I send it", "[00:00:04] Team: lone", "[00:00:05] Omar Testcontact: Fine", "[00:00:06] Seat Csm: Reversed"].join("\n")),
      WHO,
    );
    expect(lines.map(l => l.label)).toEqual(["CSM", "CSM", "Team", "Team", "Client", "Client"]);
    expect(lines.map(l => l.n)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(numbered(lines.slice(0, 2))).toBe("L1 [00:00:01] CSM: Hi\nL2 [00:00:02] CSM: Short");
    const fallback = labelLines(parseTranscript("[00:00:01] Fathom Display Name: Hi"), { recorderEmail: "someone@else.example", recorderName: "Fathom Display Name", staff: [] });
    expect(fallback[0].label).toBe("CSM");
  });

  test("names agree on their first two words, or a lone name on the first name, letter for letter", () => {
    expect(sameName("Sara Ahmed Ali", "Sara Ahmed")).toBe(true);
    expect(sameName("Sara", "Sara Ahmed")).toBe(true);
    expect(sameName("Sara Khalid", "Sara Ahmed")).toBe(false);
    expect(sameName("Saraa", "Sara Ahmed")).toBe(false);
    expect(sameName("", "Sara")).toBe(false);
    expect(sameName("S", "S Ahmed")).toBe(false);
  });

  test("at most 3,000 lines reach a model", () => {
    const many = Array.from({ length: MAX_LINES + 5 }, (_, i) => `[00:00:01] Omar Testcontact: line ${i}`).join("\n");
    expect(labelLines(parseTranscript(many), WHO)).toHaveLength(3000);
  });

  test("an assignee's side from the speakers: a client's name is theirs, a staff speaker's ours, else unknown", () => {
    const side = sideOfNameFrom(labelLines(parseTranscript(["[00:00:01] Csm Seat: Hi", "[00:00:02] Omar Testcontact: Hi", "[00:00:03] Team Member Extra: Hi"].join("\n")), WHO));
    expect(side("Omar Testcontact")).toBe("they");
    expect(side("Omar")).toBe("they");
    expect(side("Csm Seat")).toBe("we");
    expect(side("Team Member")).toBe("we");
    expect(side("Nobody Here")).toBeNull();
  });

  test("a cited line: by number or L-number, never outside the transcript; its quote cut at a word to 200", () => {
    const lines = labelLines(parseTranscript([`[00:00:01] Omar Testcontact: ${"word ".repeat(60)}end`, "[00:00:09] Csm Seat: ok"].join("\n")), WHO);
    expect(lineAt(lines, 2)?.text).toBe("ok");
    expect(lineAt(lines, "L1")?.n).toBe(1);
    for (const bad of [0, 3, 1.5, "two", null, undefined, -1]) expect(lineAt(lines, bad)).toBeUndefined();
    const q = quoteOf(lines[0]);
    expect(q.length).toBeLessThanOrEqual(200);
    expect(q.endsWith("word")).toBe(true);
  });

  test("risk talk: pause, cancel, stop or refund in the client's lines only, English and Arabic", () => {
    const lines = labelLines(parseTranscript(["[00:00:01] Csm Seat: We never pause.", "[00:00:02] Omar Testcontact: We like it.", "[00:00:03] Omar Testcontact: بنوقف الإعلانات شهر"].join("\n")), WHO);
    expect(riskTalk(lines)?.n).toBe(3);
    expect(riskTalk(lines.slice(0, 2))).toBeUndefined();
    const english = labelLines(parseTranscript("[00:10:00] Omar Testcontact: We want a refund."), WHO);
    expect(riskTalk(english)?.stamp).toBe("00:10:00");
  });

  test("clock and cuts", () => {
    expect(clock(3723)).toBe("01:02:03");
    expect(clock(0)).toBe("00:00:00");
    expect(cut("a  b\nc", 10)).toBe("a b c");
    expect(cutBlock("one\n\n\n\ntwo  three", 100)).toBe("one\n\ntwo three");
    expect([...cut("😀".repeat(10), 5)].length).toBe(2);
  });
});
