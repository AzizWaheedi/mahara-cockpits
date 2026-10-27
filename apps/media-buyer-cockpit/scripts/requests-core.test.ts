/**
 * The requests core (docs/requests/CONTRACT.md 2.5, 6.2, 6.6): the form's
 * checks say exactly what cockpit_request_submit says, the states read in
 * the contract's words, the route line names list, task, owner, template
 * and due day, and the four shared request files are the same bytes in all
 * five cockpits with only the imports the contract allows. The seeded types
 * come from docs/requests/request-types.json, read as the database would
 * serve them; every client and request here is made up.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  type HARNESS_SEED,
  type Seed,
  typeViewOf,
  workingDaysAhead,
} from "../src/dev/requestsHarness";
import {
  ANSWER_PROBLEMS,
  bodyFields,
  carriedDueOn,
  cleanAnswers,
  dayLabel,
  deliveredNote,
  display,
  dueWord,
  fieldOfSentence,
  groupTypes,
  isOpen,
  kuwaitClock,
  kuwaitToday,
  type PartRow,
  partChip,
  partHeld,
  partialNext,
  partMoving,
  partWaiting,
  partWords,
  REQUEST_SENTENCES,
  REQUESTS_CANARY_CARD,
  type RequestRow,
  requestHeld,
  requestsOpen,
  routeLine,
  sentLines,
  sentTone,
  stateChip,
  stateHint,
  stateWords,
  type TypeView,
  unfinishedNote,
  validateAnswers,
  verifyWords,
} from "../src/lib/requestsCore";
import {
  callRequests,
  errorWords,
  PLAIN_ERRORS,
  RequestError,
} from "../src/lib/requestsClient";

const ROOT = path.resolve(import.meta.dir, "../../..");
const seed = JSON.parse(
  readFileSync(path.join(ROOT, "docs/requests/request-types.json"), "utf8"),
) as Seed & { types: (Seed["types"][number] & { sources?: string[] })[] };
const TODAY = "2026-10-26"; // a Monday in Kuwait
const views: TypeView[] = seed.types.map(t =>
  typeViewOf(t, seed.field_catalog, false, TODAY),
);
const typeOf = (key: string) => {
  const t = views.find(v => v.key === key);
  if (!t) throw new Error(`No seeded type ${key}`);
  return t;
};
// Keeps the harness's own seed type in step with the binding JSON.
const _seedShape: typeof HARNESS_SEED = seed;
void _seedShape;

describe("the form's checks are the server's (2.5 step 5)", () => {
  const sql = readFileSync(
    path.join(ROOT, "supabase/migrations/20261026r_requests.sql"),
    "utf8",
  );

  test("every problem the form names is a sentence cockpit_request_submit raises", () => {
    for (const [name, words] of Object.entries(ANSWER_PROBLEMS))
      expect({ name, inSubmit: sql.includes(words) }).toEqual({
        name,
        inSubmit: true,
      });
    for (const s of [
      REQUEST_SENTENCES.dueRequired,
      REQUEST_SENTENCES.dueTooFar,
    ])
      expect(sql.includes(`'${s}'`)).toBe(true);
  });

  test("required answers, in the order the form asks them", () => {
    const script = typeOf("new_script");
    const problems = validateAnswers(script, {}, null, TODAY, TODAY);
    expect(problems.client).toBe("Client: pick a client.");
    for (const f of bodyFields(script).filter(f => f.required))
      expect(problems[f.key]).toBe(
        `${f.label}: ${f.kind === "select" ? "pick one" : "fill this in"}.`,
      );
    expect(Object.keys(problems)[0]).toBe("client");
  });

  test("lengths, links, numbers and choices", () => {
    const t: TypeView = {
      ...typeOf("general_tech"),
      fields: [
        {
          key: "short",
          label: "Short",
          kind: "text",
          required: false,
          options: null,
          help: null,
        },
        {
          key: "long",
          label: "Long",
          kind: "longtext",
          required: false,
          options: null,
          help: null,
        },
        {
          key: "link",
          label: "Link",
          kind: "url",
          required: false,
          options: null,
          help: null,
        },
        {
          key: "count",
          label: "How many",
          kind: "number",
          required: false,
          options: null,
          help: null,
        },
        {
          key: "pick",
          label: "Pick",
          kind: "select",
          required: false,
          options: [{ id: "a", name: "A" }],
          help: null,
        },
        {
          key: "gone",
          label: "Gone",
          kind: "select",
          required: true,
          options: [],
          help: null,
        },
        {
          key: "deadline",
          label: "Due",
          kind: "deadline",
          required: true,
          options: null,
          help: null,
        },
      ],
    };
    const bad = validateAnswers(
      t,
      {
        short: "x".repeat(501),
        long: "y".repeat(4001),
        link: "www.example.test",
        count: "1001",
        pick: "b",
      },
      null,
      "2026-10-25",
      TODAY,
    );
    expect(bad).toEqual({
      short: "Short: keep it under 500 characters.",
      long: "Long: keep it under 4000 characters.",
      link: "Link: paste a link that starts with http:// or https://.",
      count: "How many: enter a whole number from 0 to 1000.",
      pick: "Pick: pick one of the choices.",
      gone: "Gone: this choice could not be read from ClickUp. Ask the systems manager.",
      deadline: "Pick today or a later day.",
    });
    // Postgres counts characters, not UTF-16 units: 500 Arabic letters and
    // emoji pass.
    const fine = validateAnswers(
      { ...t, fields: t.fields.filter(f => f.key !== "gone") },
      {
        short: "🙂".repeat(500),
        link: "https://example.test/a",
        count: 12,
        pick: "a",
      },
      null,
      TODAY,
      TODAY,
    );
    expect(fine).toEqual({});
    expect(
      validateAnswers(
        t,
        { link: `https://${"a".repeat(2000)}` },
        null,
        TODAY,
        TODAY,
      ).link,
    ).toBe("Link: that link is too long.");
    expect(validateAnswers(t, {}, null, "2027-10-27", TODAY).deadline).toBe(
      "Pick a day within the next year.",
    );
  });

  test("the answers sent leave out the client, due day and priority, and blanks", () => {
    const script = typeOf("new_script");
    const qty = bodyFields(script).find(f => f.kind === "number");
    expect(qty).toBeTruthy();
    const out = cleanAnswers(script, {
      client: "86harb001",
      deadline: TODAY,
      priority: "high",
      [qty?.key ?? "x"]: " 3 ",
      additional_notes: "  ",
    });
    expect(out).toEqual({ [qty?.key ?? "x"]: 3 });
  });

  test("a server sentence lands under the field it names", () => {
    const t = typeOf("low_schedule_rate");
    expect(fieldOfSentence(t, "Where is the problem?: pick one.")).toBe(
      "schedule_rate_issue",
    );
    expect(fieldOfSentence(t, "Pick today or a later day.")).toBe("deadline");
    expect(
      fieldOfSentence(t, "You cannot raise a request for this client."),
    ).toBe(null);
  });
});

describe("the seeded types as the form reads them", () => {
  test("31 types, every one with one due and one priority question", () => {
    expect(views.length).toBe(31);
    for (const v of views) {
      expect(v.fields.filter(f => f.kind === "deadline").length).toBe(1);
      expect(v.fields.filter(f => f.kind === "priority").length).toBe(1);
      expect(v.parts.length).toBeGreaterThan(0);
    }
  });

  test("grouped by team in the server's order, and searchable", () => {
    const groups = groupTypes(
      [...views].sort(
        (a, b) =>
          ["client_success", "tech", "ads", "creative", "call_center"].indexOf(
            a.team,
          ) -
          ["client_success", "tech", "ads", "creative", "call_center"].indexOf(
            b.team,
          ),
      ),
    );
    expect(groups.map(g => g.teamLabel)).toEqual([
      "Client Success",
      "Operations / Tech",
      "Marketing / ADs",
      "Media/Creative",
      "Call Center",
    ]);
    const pause = groupTypes(views, "pause");
    expect(pause.flatMap(g => g.types.map(t => t.key))).toEqual([
      "client_pause",
    ]);
    expect(groupTypes(views, "zzz nothing")).toEqual([]);
  });

  test("a select's choices come from the ClickUp field", () => {
    const issue = typeOf("low_schedule_rate").fields.find(
      f => f.key === "schedule_rate_issue",
    );
    expect(issue?.options?.map(o => o.name)).toEqual([
      "Ads issue",
      "Call Center Issue",
      "Both",
    ]);
    expect(
      display(issue ?? { kind: "select", options: [] }, issue?.options?.[2].id),
    ).toBe("Both");
    expect(display({ kind: "priority", options: null }, "high")).toBe("High");
    expect(display({ kind: "text", options: null }, "  x ")).toBe("x");
  });

  test("the due default counts Sunday to Thursday only", () => {
    expect(workingDaysAhead("2026-10-29", 1)).toBe("2026-11-01"); // Thu to Sun
    expect(workingDaysAhead(TODAY, 0)).toBe(TODAY);
    expect(workingDaysAhead(TODAY, 3)).toBe("2026-10-29");
  });
});

const part = (over: Partial<PartRow> = {}): PartRow => ({
  part: "main",
  listName: "Operations / Tech",
  teamLabel: "Operations / Tech",
  taskName: "Harbour Interiors - Client pause (Tech)",
  owner: { label: "the systems manager", how: "named", note: null },
  state: "delivered",
  error: null,
  url: "https://app.clickup.com/t/86harn001",
  status: "to do",
  statusType: "open",
  verifyState: null,
  verifyNote: null,
  ...over,
});
const row = (
  over: Partial<Pick<RequestRow, "state" | "done" | "parts">> = {},
): Pick<RequestRow, "state" | "done" | "parts"> => ({
  state: "delivered",
  done: false,
  parts: [part()],
  ...over,
});

describe("states in words (6.6)", () => {
  test("every request state", () => {
    expect(
      stateWords(row({ state: "sending", parts: [part({ state: "queued" })] })),
    ).toBe("Sending to ClickUp");
    // The old held state, kept as a fallback: said as saved, not as the
    // writer's test run.
    expect(stateWords(row({ state: "dry_run" }))).toBe(
      "Saved. It goes to ClickUp when requests open",
    );
    expect(stateWords(row())).toBe("In ClickUp: to do");
    expect(
      stateWords(
        row({
          parts: [part(), part({ part: "media", status: "in progress" })],
        }),
      ),
    ).toBe("In ClickUp: to do and in progress");
    expect(
      stateWords(
        row({
          state: "partial",
          parts: [
            part(),
            part({ state: "failed", error: "ClickUp refused the list." }),
          ],
        }),
      ),
    ).toBe("Part of it did not reach ClickUp: ClickUp refused the list");
    expect(
      stateWords(
        row({
          state: "failed",
          parts: [part({ state: "failed", error: "Token expired" })],
        }),
      ),
    ).toBe("Not in ClickUp: Token expired");
    expect(stateWords(row({ state: "cancelled" }))).toBe("Cancelled");
    expect(stateWords(row({ state: "imported" }))).toBe(
      "Came in through the old ClickUp form. Make it a request to route it.",
    );
    expect(stateWords(row({ state: "routed" }))).toBe(
      "Routed as a new request",
    );
    expect(stateWords(row({ done: true }))).toBe("Done");
    expect(stateChip(row({ done: true }))).toEqual({
      label: "Done",
      tone: "good",
    });
    expect(stateChip(row({ state: "failed" })).tone).toBe("critical");
    expect(stateChip(row({ state: "imported" })).label).toBe("Old form");
  });

  test("every part state, and the 2-minute check", () => {
    expect(partWords(part({ state: "retry" }))).toBe(
      "Sending to ClickUp, trying again in a few minutes",
    );
    expect(partWords(part({ state: "unknown" }))).toBe(
      "Checking whether it reached ClickUp",
    );
    expect(partWords(part({ status: "complete", statusType: "done" }))).toBe(
      "Done in ClickUp",
    );
    expect(
      partWords(part({ state: "skipped", error: "Cancelled in the cockpit." })),
    ).toBe("Not sent: Cancelled in the cockpit");
    expect(
      partChip(part({ statusType: "closed", status: "cancelled" })),
    ).toEqual({
      label: "Done",
      tone: "good",
    });
    expect(verifyWords(part({ verifyState: "restored" }))).toBe(
      "A ClickUp rule removed the owner; the cockpit put them back.",
    );
    expect(verifyWords(part({ verifyState: "removed" }))).toBe(
      "A ClickUp rule keeps removing the owner. Assign it in ClickUp.",
    );
    expect(verifyWords(part({ verifyState: "moved" }))).toBe(
      "ClickUp moved this task after its Request Type was set. Request Type is now off for this type.",
    );
    expect(
      verifyWords(
        part({
          verifyState: "kept",
          verifyNote: "ClickUp also added another person.",
        }),
      ),
    ).toBe("ClickUp also added another person.");
    expect(verifyWords(part())).toBe(null);
  });

  test("open, due words and Kuwait days", () => {
    expect(isOpen(row())).toBe(true);
    expect(isOpen(row({ state: "cancelled" }))).toBe(false);
    expect(dueWord("2026-10-23", true, TODAY)).toEqual({
      text: "3 days late",
      tone: "late",
    });
    expect(dueWord("2026-10-25", true, TODAY)).toEqual({
      text: "1 day late",
      tone: "late",
    });
    expect(dueWord("2026-10-25", false, TODAY).tone).toBe("none");
    expect(dueWord(TODAY, true, TODAY)).toEqual({
      text: "Today",
      tone: "today",
    });
    expect(dueWord("2026-10-27", true, TODAY).text).toBe("Tomorrow");
    expect(dueWord("2026-10-29", true, TODAY).text).toBe("Thu 29 Oct");
    expect(dayLabel("2027-01-03", TODAY)).toBe("Sun 3 Jan 2027");
    // 20:59 UTC is still the 26th in Kuwait; 21:00 UTC is the 27th.
    expect(kuwaitToday(Date.parse("2026-10-26T20:59:00Z"))).toBe("2026-10-26");
    expect(kuwaitToday(Date.parse("2026-10-26T21:00:00Z"))).toBe("2026-10-27");
    expect(kuwaitClock("2026-10-26T11:02:00Z")).toBe("14:02");
  });

  test("a request's own due day carries into the form only when the server would take it", () => {
    expect(carriedDueOn("2026-10-29", TODAY)).toBe("2026-10-29");
    expect(carriedDueOn(TODAY, TODAY)).toBe(TODAY);
    // Before today in Kuwait, more than a year ahead, or not a day: the
    // form starts on the type's default instead.
    expect(carriedDueOn("2026-10-25", TODAY)).toBeNull();
    expect(carriedDueOn("2027-10-27", TODAY)).toBeNull();
    expect(carriedDueOn("2027-10-26", TODAY)).toBe("2027-10-26");
    expect(carriedDueOn("29 Oct", TODAY)).toBeNull();
    expect(carriedDueOn(null, TODAY)).toBeNull();
  });
});

describe("the route line (6.1's signature)", () => {
  test("list, task, owner, template and due day, in one line", () => {
    expect(
      routeLine(
        {
          listName: "Operations / Tech",
          taskName: "Acme - Client pause (Tech)",
          owner: { label: "the systems manager", how: "named", note: null },
          templateName: "Client Pause ⏸️ (Tech)",
          stepCount: null,
          stepsDraft: false,
        },
        "2026-10-28",
        TODAY,
      ),
    ).toBe(
      'Goes to Operations / Tech as "Acme - Client pause (Tech)". Owner: the systems manager. Uses the ClickUp template Client Pause ⏸️ (Tech). Due Wed 28 Oct.',
    );
    expect(
      routeLine(
        {
          listName: "Client Success",
          taskName: "General CSM ticket - from the CEO",
          owner: { label: "", how: "none", note: "No owner could be found." },
          templateName: null,
          stepCount: 5,
          stepsDraft: true,
        },
        null,
        TODAY,
      ),
    ).toBe(
      'Goes to Client Success as "General CSM ticket - from the CEO". Owner: nobody yet. Adds 5 draft SOP steps.',
    );
  });

  test("the sent panel says where each task really is (F4, D13)", () => {
    const owners = { label: "", how: "none" as const, note: null };
    // In the list only once ClickUp has it, with its owner.
    expect(
      sentLines(
        [part(), part({ listName: "Marketing / ADs", owner: owners })],
        true,
      ),
    ).toEqual([
      "In Operations / Tech. Owner: the systems manager.",
      "In Marketing / ADs. Owner: nobody yet.",
    ]);
    // On its way while requests are open.
    expect(
      sentLines(
        [
          part({ state: "queued", url: null }),
          part({ state: "sending", url: null }),
          part({ state: "retry", url: null }),
          part({ state: "unknown", url: null }),
        ],
        true,
      ),
    ).toEqual([
      "Sending to Operations / Tech.",
      "Sending to Operations / Tech.",
      "Sending to Operations / Tech.",
      "Checking whether it reached Operations / Tech.",
    ]);
    // Held while requests are not open: saved, never sent, no owner yet.
    expect(sentLines([part({ state: "queued", url: null })], false)).toEqual([
      "Saved. Goes to Operations / Tech when requests open.",
    ]);
    // The writer's note marks a held task even when the form thought
    // requests were open; a task ClickUp already has says so.
    const waiting =
      "Waiting in the queue: requests are a dry run, so nothing goes to ClickUp until CLICKUP_WRITEBACK_APPLY_REQUESTS is true.";
    expect(
      sentLines(
        [
          part({ state: "queued", url: null, error: waiting }),
          part({ state: "retry", error: waiting }),
        ],
        true,
      ),
    ).toEqual([
      "Saved. Goes to Operations / Tech when requests open.",
      "In Operations / Tech, not finished yet. The cockpit finishes it when requests open.",
    ]);
    // A delivered task is never held, and a failure says why.
    expect(
      sentLines(
        [part(), part({ state: "failed", url: null, error: "Gone." })],
        false,
      ),
    ).toEqual([
      "In Operations / Tech. Owner: the systems manager.",
      "Not sent to Operations / Tech: Gone.",
    ]);
    // The old held state is a harmless fallback.
    expect(sentLines([part({ state: "dry_run", url: null })], true)).toEqual([
      "Saved. Goes to Operations / Tech when requests open.",
    ]);
  });

  test("requests are open for a card in apply, and in apply_limited for the test card only", () => {
    expect(requestsOpen({ mode: "apply" }, null)).toBe(true);
    expect(requestsOpen({ mode: "apply_limited" }, REQUESTS_CANARY_CARD)).toBe(
      true,
    );
    expect(REQUESTS_CANARY_CARD).toBe("86eywg1cq");
    expect(requestsOpen({ mode: "apply_limited" }, "86harb002")).toBe(false);
    expect(requestsOpen({ mode: "dry_run" }, REQUESTS_CANARY_CARD)).toBe(false);
    expect(requestsOpen({ mode: "unknown" }, null)).toBe(false);
    expect(requestsOpen(null, null)).toBe(false);
  });

  test("a held request reads as saved everywhere, from the server or the writer's note", () => {
    const waiting =
      "Waiting in the queue: requests are being tested on the canary card only, so this goes when they open to every card.";
    const queued = part({ state: "queued", url: null });
    // The server's flag.
    const flagged = { ...row({ state: "sending", parts: [queued] }), held: true };
    expect(requestHeld(flagged)).toBe(true);
    expect(stateWords(flagged)).toBe(
      "Saved. It goes to ClickUp when requests open",
    );
    expect(stateChip(flagged)).toEqual({ label: "Saved", tone: "warning" });
    // The writer's note on every task not yet in ClickUp.
    const noted = row({
      state: "sending",
      parts: [part({ state: "queued", url: null, error: waiting })],
    });
    expect(requestHeld(noted)).toBe(true);
    expect(partWaiting(noted.parts[0])).toBe(true);
    expect(partWords(noted.parts[0])).toBe(
      "Saved. It goes to ClickUp when requests open",
    );
    expect(partChip(noted.parts[0])).toEqual({
      label: "Saved",
      tone: "warning",
    });
    // A held request's tasks say so, not "Sending to ClickUp".
    expect(partWords(queued, true)).toBe(
      "Saved. It goes to ClickUp when requests open",
    );
    expect(partWords(queued)).toBe("Sending to ClickUp");
    // On its way is not held; done is never held.
    expect(requestHeld(row({ state: "sending", parts: [queued] }))).toBe(false);
    expect(requestHeld({ ...flagged, done: true })).toBe(false);
    expect(partHeld(part(), false)).toBe(false);
    expect(partMoving(queued, true)).toBe(true);
    expect(partMoving(queued, false)).toBe(false);
  });

  test("a task in ClickUp with a refused step is delivered, with a quiet note", () => {
    const refused =
      "The SOP steps did not save as a checklist in ClickUp. Add them on the task there.";
    const p = part({ error: refused });
    expect(deliveredNote(p)).toBe(refused);
    expect(partChip(p)).toEqual({ label: "To do", tone: "neutral" });
    expect(partWords(p)).toBe("In ClickUp: to do");
    expect(deliveredNote(part({ state: "failed", error: refused }))).toBe(null);
    expect(deliveredNote(part())).toBe(null);
    // A delivered note is not the reason a partial request names.
    expect(
      stateWords(
        row({
          state: "partial",
          parts: [p, part({ state: "failed", error: "The task was deleted." })],
        }),
      ),
    ).toBe("Part of it did not reach ClickUp: The task was deleted");
  });

  test("a list row whose task the cockpit could not finish never reads as a clean one", () => {
    const refused =
      "ClickUp refused the owner, due day or priority. Set them on the task in ClickUp.";
    const noted = row({ parts: [part({ error: refused })] });
    expect(unfinishedNote(noted)).toBe(refused);
    // The chip keeps its ClickUp status, in the warning tone.
    expect(stateChip(noted)).toEqual({ label: "To do", tone: "warning" });
    expect(stateChip(row())).toEqual({ label: "To do", tone: "neutral" });
    // The hint says the state, then what to check.
    expect(stateHint(noted)).toBe(`In ClickUp: to do. ${refused}`);
    expect(stateHint(row())).toBe("In ClickUp: to do");
    // Once done, there is nothing left to check.
    const done = { ...noted, done: true };
    expect(unfinishedNote(done)).toBe(null);
    expect(stateChip(done)).toEqual({ label: "Done", tone: "good" });
    expect(stateHint(done)).toBe("Done");
    // A failed task's error is its reason, never an unfinished note.
    expect(
      unfinishedNote(
        row({ parts: [part({ state: "failed", error: refused })] }),
      ),
    ).toBe(null);
  });

  test("an old form ticket says Make it a request only to a seat that may route it", () => {
    const imported = { ...row({ state: "imported" }), canRoute: true };
    expect(stateWords(imported)).toBe(
      "Came in through the old ClickUp form. Make it a request to route it.",
    );
    expect(stateWords({ ...imported, canRoute: false })).toBe(
      "Came in through the old ClickUp form. Route it in ClickUp.",
    );
    expect(stateHint({ ...imported, canRoute: false })).toBe(
      REQUEST_SENTENCES.importedElsewhere,
    );
  });

  test("review round 3: an old ticket handled in ClickUp, a create in doubt, a quiet writer's held note", () => {
    // An old form ticket the team moved, closed or deleted in ClickUp: no route is offered, and it is not open.
    const handled = { ...row({ state: "imported" }), canRoute: false, importHandled: true };
    expect(stateWords(handled)).toBe(REQUEST_SENTENCES.importHandled);
    expect(stateWords(handled)).not.toContain("Route it in ClickUp");
    expect(stateChip(handled)).toEqual({ label: "Old form", tone: "neutral" });
    expect(isOpen(handled)).toBe(false);
    expect(isOpen({ ...handled, importHandled: false })).toBe(true);
    // A task in doubt says what a person must do, in the writer's words.
    const twoTasks =
      "Two tasks match this request in ClickUp. Keep one and cancel the other. The cockpit checks ClickUp again every 4 hours.";
    expect(partWords(part({ state: "unknown", url: null, error: twoTasks }))).toBe(
      "Checking whether it reached ClickUp. Two tasks match this request in ClickUp. Keep one and cancel the other. The cockpit checks ClickUp again every 4 hours",
    );
    // Handed back while requests are not open, it never shows the switch's note.
    const heldInDoubt = part({
      state: "unknown",
      url: null,
      error: "Waiting in the queue: requests are a dry run, so nothing goes to ClickUp until CLICKUP_WRITEBACK_APPLY_REQUESTS is true.",
    });
    expect(partWords(heldInDoubt)).toBe(REQUEST_SENTENCES.checkingHeld);
    expect(partWords(heldInDoubt)).not.toContain("CLICKUP_WRITEBACK");
    expect(partChip(heldInDoubt)).toEqual({ label: "Checking", tone: "warning" });
    // The database's held note, when it sends one, is the request's words (a writer gone quiet said as such).
    const quiet = {
      ...row({ state: "sending", parts: [part({ state: "queued", url: null })] }),
      held: true,
      heldNote:
        "Saved, not sent yet: the requests writer has not reported in the last 15 minutes. It goes to ClickUp once the writer runs again.",
    };
    expect(stateWords(quiet)).toBe(
      "Saved, not sent yet: the requests writer has not reported in the last 15 minutes. It goes to ClickUp once the writer runs again",
    );
    expect(stateWords({ ...quiet, heldNote: null })).toBe(REQUEST_SENTENCES.heldRequest);
  });

  test("a partial request names the task that did not go, and keeps the ones that did", () => {
    const tech = part({ part: "tech", listName: "Operations / Tech" });
    const media = (over: Partial<PartRow> = {}) =>
      part({ part: "media", listName: "Marketing / ADs", ...over });
    expect(
      partialNext({ parts: [tech, media({ state: "failed", error: "x" })] }),
    ).toBe(
      "The Marketing / ADs task did not reach ClickUp; the one that did stays there. Raise the missing task with the ClickUp request form, or ask the systems manager to make it.",
    );
    // Two refused, one landed: both named, "them".
    expect(
      partialNext({
        parts: [
          tech,
          media({ state: "failed" }),
          part({ part: "cc", listName: "Call Center", state: "skipped" }),
        ],
      }),
    ).toBe(
      "The Marketing / ADs and Call Center tasks did not reach ClickUp; the one that did stays there. Raise the missing tasks with the ClickUp request form, or ask the systems manager to make them.",
    );
    // Two landed: "the ones that did stay there".
    expect(
      partialNext({
        parts: [tech, part({ part: "b" }), media({ state: "failed" })],
      }),
    ).toContain("; the ones that did stay there.");
    // No task named as refused (an older state): still a next step.
    expect(partialNext({ parts: [tech] })).toBe(
      "Part of this request did not reach ClickUp; the one that did stays there. Raise the missing task with the ClickUp request form, or ask the systems manager to make it.",
    );
    for (const words of [
      partialNext({ parts: [tech, media({ state: "failed" })] }),
      REQUEST_SENTENCES.againFailed,
      REQUEST_SENTENCES.sentFailed,
      REQUEST_SENTENCES.importedElsewhere,
    ]) {
      expect(words).not.toMatch(/[!—]/);
      expect(words).not.toContain("File the rest again");
    }
  });

  test("the sent panel's mark follows its tasks: refused, on the way, saved, in ClickUp", () => {
    const queued = part({ state: "queued", url: null });
    const waiting = part({
      state: "queued",
      url: null,
      error: "Waiting in the queue: requests are a dry run.",
    });
    expect(sentTone([part()], true)).toBe("done");
    expect(sentTone([queued], true)).toBe("moving");
    expect(sentTone([part({ state: "unknown" })], true)).toBe("moving");
    expect(sentTone([waiting], true)).toBe("held");
    expect(sentTone([queued], false)).toBe("held");
    // A refused task wins over one still on its way: never a check beside it.
    expect(sentTone([part({ state: "failed" }), queued], true)).toBe("failed");
    expect(sentTone([part(), part({ state: "skipped" })], true)).toBe("failed");
  });
});

describe("database and network errors in plain words (D5)", () => {
  const answering = (answer: unknown, throws = false) =>
    ({
      rpc: async () => {
        if (throws) throw new TypeError("Failed to fetch");
        return answer;
      },
    }) as any;
  const said = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      return e;
    }
    throw new Error("expected a refusal");
  };

  test("the server's own sentences pass through; raw database text never does", async () => {
    const warn = console.warn;
    const logged: unknown[][] = [];
    console.warn = (...a: unknown[]) => void logged.push(a);
    try {
      const own = (await said(
        callRequests(
          answering({
            data: null,
            error: { message: "Client: pick a client.", code: "22023" },
          }),
          "cockpit_request_submit",
        ),
      )) as RequestError;
      expect(own).toBeInstanceOf(RequestError);
      expect(own.message).toBe("Client: pick a client.");
      expect(own.code).toBe("22023");
      for (const [error, words] of [
        [
          {
            message: "canceling statement due to statement timeout",
            code: "57014",
          },
          PLAIN_ERRORS.slow,
        ],
        [{ message: "JWT expired", code: "PGRST301" }, PLAIN_ERRORS.signedOut],
        [
          { message: 'relation "x" does not exist', code: "42P01" },
          PLAIN_ERRORS.other,
        ],
        [{ message: "", code: null }, PLAIN_ERRORS.other],
        // Postgres's own words under a code the server also uses.
        [
          {
            message: "permission denied for function cockpit_x",
            code: "42501",
          },
          PLAIN_ERRORS.notAllowed,
        ],
        [
          {
            message:
              'duplicate key value violates unique constraint "cockpit_member_clickup_user_key"',
            code: "23505",
          },
          PLAIN_ERRORS.clash,
        ],
        // The server's own sentence under 23505 is shown as it is.
        [
          {
            message:
              "That ClickUp user is already linked to another seat. Clear that link first.",
            code: "23505",
          },
          "That ClickUp user is already linked to another seat. Clear that link first.",
        ],
      ] as const) {
        const e = (await said(
          callRequests(answering({ data: null, error }), "cockpit_x"),
        )) as Error;
        expect(e.message).toBe(words);
      }
      const offline = (await said(
        callRequests(answering(null, true), "cockpit_x"),
      )) as Error;
      expect(offline.message).toBe(PLAIN_ERRORS.unreachable);
      expect(offline.message).not.toContain("Failed to fetch");
      // The missing migration keeps its own sentence.
      const missing = (await said(
        callRequests(
          answering({ data: null, error: { message: "x", code: "PGRST202" } }),
          "cockpit_x",
        ),
      )) as Error;
      expect(missing.message).toBe(REQUEST_SENTENCES.missingFunction);
      // Something that is not a RequestError is not shown as it is.
      expect(errorWords(new Error("undefined is not an object"))).toBe(
        PLAIN_ERRORS.other,
      );
      expect(errorWords(new RequestError("Pick one."))).toBe("Pick one.");
      // The raw text went to the console for whoever debugs it.
      expect(JSON.stringify(logged)).toContain("statement timeout");
    } finally {
      console.warn = warn;
    }
  });
});

describe("the shared files (6.2)", () => {
  const APPS = [
    "client-success-cockpit",
    "media-buyer-cockpit",
    "creative-director-cockpit",
    "video-editor-cockpit",
    "sales-cockpit",
  ];
  const FILES = [
    "src/lib/requestsCore.ts",
    "src/lib/requestsClient.ts",
    "src/components/tasks/RequestForm.tsx",
    "src/components/tasks/requests.css",
  ];
  const read = (app: string, file: string) =>
    readFileSync(path.join(ROOT, "apps", app, file), "utf8");

  test("the same bytes in all five cockpits", () => {
    for (const file of FILES) {
      const master = read(APPS[0], file);
      for (const app of APPS.slice(1))
        expect({ app, file, same: read(app, file) === master }).toEqual({
          app,
          file,
          same: true,
        });
    }
  });

  test("requestsCore imports nothing; the others only what the contract allows", () => {
    const imports = (src: string) =>
      [
        ...src.matchAll(
          /^(?:import|export)\b[^;]*?from\s+"([^"]+)"|^import\s+"([^"]+)"/gms,
        ),
      ].map(m => m[1] ?? m[2]);
    expect(imports(read("media-buyer-cockpit", FILES[0]))).toEqual([]);
    const allowed = new Set([
      "react",
      "react-dom",
      "react-router",
      "lucide-react",
      "@supabase/supabase-js",
      "@/lib/taskSeat",
      "@/lib/requestsCore",
      "@/lib/requestsClient",
      "./requests.css",
    ]);
    for (const file of FILES.slice(1, 3))
      for (const spec of imports(read("media-buyer-cockpit", file)))
        expect({ file, spec, allowed: allowed.has(spec) }).toEqual({
          file,
          spec,
          allowed: true,
        });
    // The client package is used for its type only.
    expect(read("media-buyer-cockpit", FILES[1])).toContain(
      'import type { SupabaseClient } from "@supabase/supabase-js";',
    );
  });

  test("the form's classes use the cockpit's tokens only, no new colour", () => {
    const css = read("media-buyer-cockpit", FILES[3]);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(/i);
    expect(css).not.toMatch(/gradient|box-shadow/);
    expect(css).toContain("var(--primary-ink, var(--primary))");
  });
});
