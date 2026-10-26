/**
 * The rules and words of Your tasks, the bell and the focus view
 * (src/lib/tasksCore.ts, the same file in all five cockpits): the first five,
 * the due words across Kuwait midnight, and the sentences of CONTRACT.md 6.6
 * word for word.
 */
import { expect, test } from "bun:test";
import {
  ALERT_KINDS,
  actionPhase,
  agoWords,
  actionState,
  alertOpens,
  alertWords,
  capitalFirst,
  checklistWords,
  dayWords,
  dueWords,
  emptySentence,
  firstFive,
  isTaskId,
  kuwaitDay,
  kuwaitTime,
  staleSentence,
  statusTone,
  TASK_SENTENCES,
  withoutMarker,
} from "../src/lib/tasksCore";

const at = (iso: string) => Date.parse(iso);

test("firstFive keeps the server's order and stops at five", () => {
  const rows = ["a", "b", "c", "d", "e", "f", "g"];
  expect(firstFive(rows)).toEqual(["a", "b", "c", "d", "e"]);
  expect(firstFive(rows.slice(0, 3))).toEqual(["a", "b", "c"]);
  expect(firstFive([])).toEqual([]);
  // A copy: the card never changes the feed it was given.
  const five = firstFive(rows);
  five.pop();
  expect(rows).toHaveLength(7);
});

test("the Kuwait day turns at 21:00 UTC, not at midnight UTC", () => {
  expect(kuwaitDay(at("2026-10-26T20:59:59Z"))).toBe("2026-10-26");
  expect(kuwaitDay(at("2026-10-26T21:00:00Z"))).toBe("2026-10-27");
  expect(kuwaitTime(at("2026-10-26T11:02:00Z"))).toBe("14:02");
  // 26 October 2026 is a Monday; 6 November a Friday.
  expect(dayWords("2026-10-26", false)).toBe("Mon");
  expect(dayWords("2026-11-06", true)).toBe("Fri 6 Nov");
});

test("due words across Kuwait midnight", () => {
  const due = {
    dueOn: "2026-10-26",
    dueAt: "2026-10-26T09:00:00Z",
    dueHasTime: null,
  };
  // 23:59 Kuwait on Monday the 26th: still today.
  expect(dueWords(due, at("2026-10-26T20:59:00Z"))).toEqual({
    text: "Today",
    tone: "today",
  });
  // 00:01 Kuwait on Tuesday the 27th, while UTC is still the 26th: late.
  expect(dueWords(due, at("2026-10-26T21:01:00Z"))).toEqual({
    text: "1 day late",
    tone: "late",
  });
  expect(dueWords(due, at("2026-10-29T08:00:00Z"))).toEqual({
    text: "3 days late",
    tone: "late",
  });
});

test("due words: a time today, later this week, later on, and none", () => {
  const now = at("2026-10-26T10:00:00Z"); // 13:00 Kuwait, Monday
  // A due time later today, then one already past.
  expect(
    dueWords(
      { dueOn: "2026-10-26", dueAt: "2026-10-26T12:00:00Z", dueHasTime: true },
      now,
    ),
  ).toEqual({ text: "Today 15:00", tone: "today" });
  expect(
    dueWords(
      { dueOn: "2026-10-26", dueAt: "2026-10-26T08:00:00Z", dueHasTime: true },
      now,
    ),
  ).toEqual({ text: "Late, was 11:00", tone: "late" });
  // Not known to have a time (the focus view has not read it): the day only.
  expect(
    dueWords(
      { dueOn: "2026-10-26", dueAt: "2026-10-26T08:00:00Z", dueHasTime: null },
      now,
    ),
  ).toEqual({ text: "Today", tone: "today" });
  // Within six days, the weekday; further out, the date too.
  expect(
    dueWords({ dueOn: "2026-10-29", dueAt: null, dueHasTime: null }, now),
  ).toEqual({ text: "Thu", tone: "none" });
  expect(
    dueWords({ dueOn: "2026-11-06", dueAt: null, dueHasTime: null }, now),
  ).toEqual({ text: "Fri 6 Nov", tone: "none" });
  // No due date: no word, no spine.
  expect(dueWords({ dueOn: null, dueAt: null, dueHasTime: null }, now)).toEqual(
    { text: "", tone: "none" },
  );
  // Only an instant: its Kuwait day decides (21:30 UTC on the 25th is the 26th).
  expect(
    dueWords(
      { dueOn: null, dueAt: "2026-10-25T21:30:00Z", dueHasTime: null },
      now,
    ),
  ).toEqual({ text: "Today", tone: "today" });
});

test("the sentences are the contract's, word for word", () => {
  expect(TASK_SENTENCES.notLinked).toBe(
    "Your seat is not linked to a ClickUp user, so your tasks cannot show here. Ask the systems manager to link it.",
  );
  expect(TASK_SENTENCES.notRead).toBe(
    "Your tasks could not be read just now. They are still in ClickUp. Try again in a minute.",
  );
  expect(staleSentence("14:02")).toBe(
    "Task updates are late. Last read at 14:02. Open ClickUp for anything urgent.",
  );
  // The empty card says what this cockpit leaves out (D3): never that
  // nothing is assigned in ClickUp.
  expect(TASK_SENTENCES.empty).toBe(
    "Nothing open is assigned to you outside the client cards. New ClickUp tasks show here within two minutes.",
  );
  expect(TASK_SENTENCES.bellEmpty).toBe("No alerts in the last 14 days.");
  expect(TASK_SENTENCES.bellNotRead).toBe(
    "Alerts could not refresh. Try again.",
  );
  expect(TASK_SENTENCES.bellChecked).toBe(
    "Checked every 2 minutes while this cockpit is open.",
  );
  expect(TASK_SENTENCES.saving).toBe("Saving…");
  expect(TASK_SENTENCES.saved).toBe("Saved");
  expect(TASK_SENTENCES.waiting).toBe("Waiting for ClickUp to confirm.");
  expect(TASK_SENTENCES.markDone).toBe("Mark done");
  expect(TASK_SENTENCES.done).toBe("Done");
  expect(TASK_SENTENCES.linkIt).toBe("Link it in Requests settings");
  // House style: no exclamation marks, no em dashes, no emoji.
  for (const words of Object.values(TASK_SENTENCES)) {
    expect(words).not.toMatch(/[!—]/);
    expect(words).not.toMatch(/\p{Extended_Pictographic}/u);
  }
});

test("each alert kind has words, and a request alert opens the request", () => {
  expect(ALERT_KINDS).toHaveLength(8);
  for (const kind of ALERT_KINDS)
    expect(alertWords(kind).length).toBeGreaterThan(5);
  expect(alertWords("request_failed")).toBe("A failed request");
  expect(
    alertOpens({ kind: "request_done", taskId: null, requestId: "r1" }),
  ).toBe("request");
  expect(
    alertOpens({ kind: "assigned", taskId: "86fx1", requestId: null }),
  ).toBe("task");
  // "2 tasks are due today" names no one task: it opens the list.
  expect(alertOpens({ kind: "due_today", taskId: null, requestId: null })).toBe(
    "list",
  );
});

test("an action's queue state becomes the control's words", () => {
  const row = (state: string, error: string | null = null) => ({
    id: "q1",
    op: "tick" as const,
    state,
    error,
    at: "2026-10-26T10:00:00Z",
    itemId: "i1",
  });
  // Not read back yet, queued, sending, retry and unknown: still saving.
  expect(actionPhase(null)).toEqual({ phase: "saving" });
  for (const s of ["queued", "sending", "retry", "unknown"])
    expect(actionPhase(row(s))).toEqual({ phase: "saving" });
  expect(actionPhase(row("delivered"))).toEqual({ phase: "saved" });
  expect(
    actionPhase(
      row("skipped", "ClickUp changed this step. Open the task there."),
    ),
  ).toEqual({
    phase: "error",
    message: "ClickUp changed this step. Open the task there.",
  });
  // A failure with no reason still says what to do.
  expect(actionPhase(row("failed", " "))).toEqual({
    phase: "error",
    message: TASK_SENTENCES.notSent,
  });
  expect(actionPhase(row("dry_run"))).toEqual({
    phase: "error",
    message: TASK_SENTENCES.testRun,
  });
  // The act call answers the queue row's id; the press holds its own too.
  expect(actionState([row("delivered")], ["a-press", "q1"])?.state).toBe(
    "delivered",
  );
  expect(actionState([row("delivered")], ["other"])).toBeNull();
});

test("small words: checklists, status dots, task ids, markers", () => {
  expect(
    checklistWords([
      { resolved: true },
      { resolved: false },
      { resolved: true },
    ]),
  ).toBe("2 of 3 done");
  expect(statusTone("done")).toBe("done");
  expect(statusTone("closed")).toBe("closed");
  expect(statusTone("open")).toBe("open");
  expect(statusTone("custom")).toBe("active");
  expect(isTaskId("86fxtk001")).toBe(true);
  expect(isTaskId("86fx tk")).toBe(false);
  expect(isTaskId("")).toBe(false);
  expect(isTaskId(null)).toBe(false);
  expect(
    withoutMarker(
      "The systems manager wrote in the cockpit: done\n\nCockpit ref T-1a2b3c4d5e",
    ),
  ).toBe("The systems manager wrote in the cockpit: done");
  expect(withoutMarker("Steps below.\n\nCockpit ref R-1a2b3c4d5e-tech")).toBe(
    "Steps below.",
  );
  // A marker in the middle is a person's words, kept.
  expect(withoutMarker("See Cockpit ref R-1a2b3c4d5e-tech above, please")).toBe(
    "See Cockpit ref R-1a2b3c4d5e-tech above, please",
  );
  expect(capitalFirst("the CSM")).toBe("The CSM");
  expect(capitalFirst("")).toBe("");
});

test("the empty card names what this cockpit leaves out (D3)", () => {
  expect(emptySentence("portal")).toBe(TASK_SENTENCES.empty);
  expect(emptySentence("csm")).toBe(TASK_SENTENCES.empty);
  // The editor cockpit hides Video Pipeline (its Jobs page owns it).
  expect(emptySentence("editor")).toBe(
    "Nothing open is assigned to you outside Jobs and the client cards. New ClickUp tasks show here within two minutes.",
  );
  for (const c of ["portal", "csm", "creative", "editor", "sales"])
    expect(emptySentence(c)).not.toContain("Nothing is assigned to you in");
});

test("an alert's time, short and in Kuwait time (D9)", () => {
  const now = at("2026-10-26T08:00:00Z"); // Mon 11:00 in Kuwait
  expect(agoWords("2026-10-26T07:59:40Z", now)).toBe("Just now");
  expect(agoWords("2026-10-26T07:48:00Z", now)).toBe("12 min ago");
  expect(agoWords("2026-10-26T05:00:00Z", now)).toBe("3 h ago");
  // Before Kuwait midnight is yesterday, with its clock.
  expect(agoWords("2026-10-25T20:30:00Z", now)).toBe("Yesterday 23:30");
  expect(agoWords("2026-10-25T21:30:00Z", now)).toBe("10 h ago"); // 00:30 today
  expect(agoWords("2026-10-22T06:10:00Z", now)).toBe("Thu 22 Oct 09:10");
  expect(agoWords(null, now)).toBe("");
  expect(agoWords("not a time", now)).toBe("");
});
