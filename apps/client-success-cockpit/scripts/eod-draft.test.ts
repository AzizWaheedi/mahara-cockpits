import { describe, expect, test } from "bun:test";
import {
  buildCallDraft,
  type EodCall,
  type EodDecision,
  eodCounts,
  eodWindow,
  eodWorkingDay,
  firstSentence,
} from "../src/lib/eodDraft";

/** The call summary draft (Muhammed, 26 October 2026), from invented calls. */
const DAY = "2026-10-26";
const at = (local: string) => new Date(`${local}+03:00`).toISOString();
const call = (
  subject: string,
  local: string,
  reason?: string,
  clickupTaskId?: string,
): EodDecision => ({
  subject,
  action: "Held a call",
  kind: "approved",
  reason,
  loggedAt: at(local),
  clickupTaskId,
});
const fathom = (
  taskId: string,
  clientName: string,
  local: string,
  summary: string | null,
): EodCall => ({ id: 1, taskId, clientName, startsAt: at(local), summary });

const SUMMARY = [
  "## Meeting Purpose",
  "",
  "[Align the ad plan with the B2B buyers they found.](https://fathom.video/share/x?timestamp=355.0) More detail follows.",
  "",
  "## Key Takeaways",
  "",
  "  - [**Wrong leads:** the campaigns bring single homeowners.](https://fathom.video/share/x)",
].join("\n");

describe("the call summary draft", () => {
  test("a logged call with a note gives the client and the CSM's note", () => {
    const d = buildCallDraft(
      DAY,
      [
        call(
          "City Wood",
          "2026-10-26T11:00:00",
          "Agreed to move to B2B targeting",
        ),
      ],
      [],
    );
    expect(d.text).toBe("City Wood: Agreed to move to B2B targeting");
    expect(d).toMatchObject({
      lines: 1,
      fromNotes: 1,
      fromFathom: 0,
      noNote: 0,
    });
  });

  test("with no note, the first sentence of that client's Fathom summary that day", () => {
    const d = buildCallDraft(
      DAY,
      [call("City Wood", "2026-10-26T12:30:00", "  ", "task-cw")],
      [
        fathom("task-cw", "City Wood", "2026-10-26T11:56:00", SUMMARY),
        // Another day's recording of the same client is not this day's call.
        fathom("task-cw", "City Wood", "2026-10-25T11:00:00", "Old call."),
      ],
    );
    expect(d.text).toBe(
      "City Wood: Align the ad plan with the B2B buyers they found.",
    );
    expect(d).toMatchObject({ lines: 1, fromNotes: 0, fromFathom: 1 });
  });

  test("a logged call and a Fathom call join on the client's name when the log has no ClickUp id", () => {
    const d = buildCallDraft(
      DAY,
      [call("city wood", "2026-10-26T12:30:00")],
      [fathom("task-cw", "City Wood", "2026-10-26T11:56:00", SUMMARY)],
    );
    expect(d.lines).toBe(1);
    expect(d.text).toStartWith("city wood: Align the ad plan");
  });

  test("with neither a note nor a recording: Call held, no note", () => {
    const d = buildCallDraft(
      DAY,
      [call("Smart Interior", "2026-10-26T15:00:00")],
      [fathom("task-other", "Ardon", "2026-10-26T15:00:00", null)],
    );
    expect(d.text).toBe(
      "Smart Interior: Call held, no note\nArdon: Call held, no note",
    );
    expect(d.noNote).toBe(2);
  });

  test("several calls with one client make one line, notes in order, the note beating Fathom", () => {
    const d = buildCallDraft(
      DAY,
      [
        call("MOFAG", "2026-10-26T16:00:00", "Sent the new offer", "task-m"),
        call("City Wood", "2026-10-26T10:00:00", "Booked the shoot"),
        call("MOFAG", "2026-10-26T09:00:00", "Report walk-through", "task-m"),
        call("MOFAG", "2026-10-26T17:00:00", "Sent the new offer", "task-m"),
        call("MOFAG", "2026-10-26T18:00:00", undefined, "task-m"),
      ],
      [fathom("task-m", "MOFAG", "2026-10-26T09:00:00", SUMMARY)],
    );
    expect(d.text).toBe(
      [
        "MOFAG: Report walk-through · Sent the new offer",
        "City Wood: Booked the shoot",
      ].join("\n"),
    );
    expect(d).toMatchObject({ lines: 2, fromNotes: 2, fromFathom: 0 });
  });

  test("a Fathom call the CSM never logged still gets its line", () => {
    const d = buildCallDraft(
      DAY,
      [],
      [fathom("task-cw", "City Wood", "2026-10-26T11:56:00", SUMMARY)],
    );
    expect(d.text).toBe(
      "City Wood: Align the ad plan with the B2B buyers they found.",
    );
  });

  test("only logged calls count: a ticket or a stage change is not a call", () => {
    const d = buildCallDraft(
      DAY,
      [
        {
          ...call("City Wood", "2026-10-26T11:00:00", "x"),
          action: "New ads needed",
        },
        {
          ...call("City Wood", "2026-10-26T11:00:00", "x"),
          action: "Moved to Paused",
        },
      ],
      [],
    );
    expect(d).toMatchObject({ text: "", lines: 0 });
  });
});

describe("the EOD working day", () => {
  test("a save between 00:00 and 04:00 Kuwait belongs to the day before", () => {
    expect(eodWorkingDay(Date.parse("2026-10-27T01:30:00+03:00"))).toBe(DAY);
    expect(eodWorkingDay(Date.parse("2026-10-27T03:59:59+03:00"))).toBe(DAY);
    expect(eodWorkingDay(Date.parse("2026-10-27T04:00:00+03:00"))).toBe(
      "2026-10-27",
    );
    expect(eodWorkingDay(Date.parse("2026-10-26T04:00:00+03:00"))).toBe(DAY);
  });

  test("a call logged at 01:30 is in the evening's draft and counts, not the next day's", () => {
    const late = [
      call("City Wood", "2026-10-27T01:30:00", "Late call about the launch"),
      // 02:00 on the 26th is still the 25th's working day.
      call("Ardon", "2026-10-26T02:00:00", "Night call"),
    ];
    expect(buildCallDraft(DAY, late, []).text).toBe(
      "City Wood: Late call about the launch",
    );
    expect(buildCallDraft("2026-10-27", late, []).lines).toBe(0);
    expect(buildCallDraft("2026-10-25", late, []).text).toBe(
      "Ardon: Night call",
    );
    expect(eodCounts(DAY, late).calls).toBe(1);
    expect(eodWindow(DAY)).toEqual({
      from: "2026-10-26T01:00:00.000Z",
      to: "2026-10-27T01:00:00.000Z",
    });
    expect(() => eodWindow("26 Oct")).toThrow();
  });

  test("the counts read the EOD day, and Upsells counts only upsells", () => {
    const ds: EodDecision[] = [
      call("City Wood", "2026-10-26T10:00:00", "n"),
      {
        subject: "MOFAG",
        action: "Upsell pitched",
        loggedAt: at("2026-10-26T11:00:00"),
      },
      {
        subject: "Ardon",
        action: "Review asked",
        loggedAt: at("2026-10-26T12:00:00"),
      },
      {
        subject: "Greystone",
        action: "Welcome call",
        loggedAt: at("2026-10-26T13:00:00"),
      },
      {
        subject: "Greystone",
        action: "New ads needed",
        kind: "ticket",
        clickupTaskUrl: "https://app.clickup.com/t/1",
        loggedAt: at("2026-10-26T14:00:00"),
      },
      {
        subject: "Smart",
        action: "Left",
        kind: "left",
        loggedAt: at("2026-10-26T15:00:00"),
      },
      // The day before, and a row with no time: neither counts.
      {
        subject: "Old",
        action: "Upsell pitched",
        loggedAt: at("2026-10-26T03:00:00"),
      },
      { subject: "Unknown", action: "Held a call" },
    ];
    expect(eodCounts(DAY, ds)).toEqual({
      handled: 5,
      calls: 1,
      signups: 1,
      hot: 2,
      upsells: 1,
      tickets: 1,
      left: 1,
    });
  });
});

describe("the first sentence of a Fathom summary", () => {
  test("skips headings, unwraps links and keeps decimals whole", () => {
    expect(firstSentence(SUMMARY)).toBe(
      "Align the ad plan with the B2B buyers they found.",
    );
    expect(
      firstSentence(
        "## Purpose\n\n- **Goal:** cut the cost from 11.29 to 8 dollars. Then more.",
      ),
    ).toBe("Goal: cut the cost from 11.29 to 8 dollars.");
    expect(
      firstSentence(
        "## الغرض من الاجتماع\n\n[مواءمة الخطة مع السوق؟](https://x) ثم",
      ),
    ).toBe("مواءمة الخطة مع السوق؟");
  });

  test("a long sentence is cut at a word, and an empty summary gives nothing", () => {
    const long = `${"word ".repeat(60)}end.`;
    const cut = firstSentence(long, 40);
    expect(cut.length).toBeLessThanOrEqual(40);
    expect(cut).toEndWith("word…");
    expect(firstSentence("## Only a heading")).toBe("");
    expect(firstSentence(null)).toBe("");
  });
});
