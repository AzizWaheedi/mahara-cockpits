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
  callRequests,
  errorWords,
  PLAIN_ERRORS,
  partFacts,
  RequestError,
} from "../src/lib/requestsClient";
import {
  ANSWER_PROBLEMS,
  answerTeamLines,
  bodyFields,
  carriedDueOn,
  choiceControl,
  cleanAnswers,
  dayLabel,
  deliveredNote,
  display,
  dueChoices,
  dueWord,
  everyType,
  fieldOfSentence,
  GENERAL_KEYS,
  groupTypes,
  isOpen,
  kuwaitClock,
  kuwaitToday,
  markWords,
  nextWorkingDay,
  type PartRow,
  partChip,
  partHeld,
  partialNext,
  partMoving,
  partReachable,
  partWaiting,
  partWords,
  plainTemplateName,
  questionGroups,
  REQUEST_SENTENCES,
  REQUESTS_CANARY_CARD,
  type RequestRow,
  ROUTE_WORDS,
  type RoutePart,
  reachText,
  requestHeld,
  requestsOpen,
  routeLine,
  routeModel,
  routeNote,
  routesKnown,
  searchCountWords,
  searchLeads,
  searchTypes,
  sentLines,
  sentModel,
  sentTone,
  stateChip,
  stateHint,
  stateWords,
  TEAM_LOOK,
  TYPE_LOOK,
  type TypeView,
  taskNameParts,
  teamByAnswer,
  teamExamples,
  teamRelated,
  teamTypes,
  typeFacts,
  typeLook,
  unfinishedNote,
  validateAnswers,
  verifyWords,
} from "../src/lib/requestsCore";

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
    const flagged = {
      ...row({ state: "sending", parts: [queued] }),
      held: true,
    };
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
    const handled = {
      ...row({ state: "imported" }),
      canRoute: false,
      importHandled: true,
    };
    expect(stateWords(handled)).toBe(REQUEST_SENTENCES.importHandled);
    expect(stateWords(handled)).not.toContain("Route it in ClickUp");
    expect(stateChip(handled)).toEqual({ label: "Old form", tone: "neutral" });
    expect(isOpen(handled)).toBe(false);
    expect(isOpen({ ...handled, importHandled: false })).toBe(true);
    // A task in doubt says what a person must do, in the writer's words.
    const twoTasks =
      "Two tasks match this request in ClickUp. Keep one and cancel the other. The cockpit checks ClickUp again every 4 hours.";
    expect(
      partWords(part({ state: "unknown", url: null, error: twoTasks })),
    ).toBe(
      "Checking whether it reached ClickUp. Two tasks match this request in ClickUp. Keep one and cancel the other. The cockpit checks ClickUp again every 4 hours",
    );
    // Handed back while requests are not open, it never shows the switch's note.
    const heldInDoubt = part({
      state: "unknown",
      url: null,
      error:
        "Waiting in the queue: requests are a dry run, so nothing goes to ClickUp until CLICKUP_WRITEBACK_APPLY_REQUESTS is true.",
    });
    expect(partWords(heldInDoubt)).toBe(REQUEST_SENTENCES.checkingHeld);
    expect(partWords(heldInDoubt)).not.toContain("CLICKUP_WRITEBACK");
    expect(partChip(heldInDoubt)).toEqual({
      label: "Checking",
      tone: "warning",
    });
    // The database's held note, when it sends one, is the request's words (a writer gone quiet said as such).
    const quiet = {
      ...row({
        state: "sending",
        parts: [part({ state: "queued", url: null })],
      }),
      held: true,
      heldNote:
        "Saved, not sent yet: the requests writer has not reported in the last 15 minutes. It goes to ClickUp once the writer runs again.",
    };
    expect(stateWords(quiet)).toBe(
      "Saved, not sent yet: the requests writer has not reported in the last 15 minutes. It goes to ClickUp once the writer runs again",
    );
    expect(stateWords({ ...quiet, heldNote: null })).toBe(
      REQUEST_SENTENCES.heldRequest,
    );
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

describe("the department map (tickets-look-1028)", () => {
  const TEAMS = ["client_success", "tech", "ads", "creative", "call_center"];
  const ordered = [...views].sort(
    (a, b) =>
      TEAMS.indexOf(a.team) - TEAMS.indexOf(b.team) ||
      (seed.types.find(t => t.key === a.key)?.type_index ?? 0) -
        (seed.types.find(t => t.key === b.key)?.type_index ?? 0),
  );
  const keys = (q: string) => searchTypes(ordered, q).hits.map(h => h.type.key);
  const form = readFileSync(
    path.join(
      ROOT,
      "apps/media-buyer-cockpit/src/components/tasks/RequestForm.tsx",
    ),
    "utf8",
  );
  const imported = new Set(
    (form.match(/^import \{([^}]*)\} from "lucide-react";/m)?.[1] ?? "")
      .split(",")
      .map(x => x.trim())
      .filter(Boolean),
  );

  test("every seeded type and team has its own look, drawn with an icon the form imports", () => {
    for (const v of views) {
      const look = TYPE_LOOK[v.key];
      expect({ key: v.key, has: Boolean(look) }).toEqual({
        key: v.key,
        has: true,
      });
      expect({ key: v.key, icon: imported.has(look.icon) }).toEqual({
        key: v.key,
        icon: true,
      });
      // One line in the asker's words: no full stop, no exclamation, no em dash.
      expect(look.line).not.toMatch(/[.!—]$|—|!/);
      expect(look.words.length).toBeGreaterThan(0);
    }
    for (const team of TEAMS) {
      const look = TEAM_LOOK[team as keyof typeof TEAM_LOOK];
      expect(imported.has(look?.icon ?? "")).toBe(true);
      // Its shortcuts are its own requests.
      for (const k of look?.examples ?? [])
        expect({ k, team: views.find(v => v.key === k)?.team }).toEqual({
          k,
          team,
        });
    }
    expect(imported.has("Ticket")).toBe(true);
    expect(GENERAL_KEYS.every(k => views.some(v => v.key === k))).toBe(true);
    // Only the general requests wear a team's own mark, so a team's page
    // never shows its mark on the hero and on two rows (review D13).
    const teamMarks = new Set(
      Object.values(TEAM_LOOK).map(look => look?.icon ?? ""),
    );
    for (const v of views)
      expect({
        key: v.key,
        teamMark: teamMarks.has(TYPE_LOOK[v.key].icon),
      }).toEqual({ key: v.key, teamMark: GENERAL_KEYS.includes(v.key) });
  });

  test("a look is keyed on the type's key: a new key takes its team's mark and a line from its own data", () => {
    const pause = typeOf("client_pause");
    expect(typeLook({ ...pause, label: "Renamed by an editor" }).icon).toBe(
      "Pause",
    );
    const later = { ...typeOf("general_tech"), key: "added_later" };
    expect(typeLook(later)).toEqual({
      icon: "Wrench",
      line: "Goes to Operations / Tech. Owner: the systems manager",
      words: [],
    });
    expect(typeLook({ ...later, team: "all_tasks" }).icon).toBe("Ticket");
  });

  test("search forgives: the judges' needs, typed as words or sentences, come first", () => {
    const needs: [string, string][] = [
      ["card failed", "card_missing"],
      ["card declined", "card_missing"],
      ["ads stopped", "card_missing"],
      ["new hire", "employee_onboarding"],
      ["new team member", "employee_onboarding"],
      ["stop ads", "client_pause"],
      ["hold", "client_pause"],
      ["pause", "client_pause"],
      ["own team", "dfy_to_dwy"],
      ["dwy", "dfy_to_dwy"],
      ["their own callers", "dfy_to_dwy"],
      ["leads not arriving", "missing_leads"],
      ["no leads", "missing_leads"],
      ["leads not coming", "missing_leads"],
      ["invoice", "ad_spend_invoice"],
      ["watsapp", "whatsapp_connection"],
      ["script", "new_script"],
      ["budget", "edit_campaign"],
      ["leaving", "employee_offboarding"],
      ["invoce", "ad_spend_invoice"],
      [
        "a client's ads stopped because the payment card failed",
        "card_missing",
      ],
      ["a new team member starts on Sunday", "employee_onboarding"],
      ["stop a client's ads for now", "client_pause"],
      ["the client's own team will call their leads from now on", "dfy_to_dwy"],
      ["leads from a form are not arriving", "missing_leads"],
    ];
    for (const [q, want] of needs)
      expect({ q, first: keys(q)[0] }).toEqual({ q, first: want });
    expect(keys("refund")).toEqual([]);
    // Two words: only what matches both stays.
    expect(keys("stop ads")).toEqual(["client_pause", "card_missing"]);
    // Filler alone is not a search.
    expect(searchTypes(ordered, "a the for").words).toEqual([]);
  });

  test("search finds everyday rewordings of the five needs, and the DFY and DWY switches by where they go (CL-02)", () => {
    const rewordings: [string, string][] = [
      // Need 1: a card that failed.
      ["billing issue", "card_missing"],
      ["payment issue", "card_missing"],
      ["payment failed", "card_missing"],
      ["card expired", "card_missing"],
      ["add a new card", "card_missing"],
      ["no card on the ad account", "card_missing"],
      ["ads not running because of the card", "card_missing"],
      // Need 2: someone new.
      ["someone new is joining", "employee_onboarding"],
      ["new colleague", "employee_onboarding"],
      ["new person starting", "employee_onboarding"],
      ["set up accounts for a new employee", "employee_onboarding"],
      ["we hired someone", "employee_onboarding"],
      // Need 3: a pause; "off" counts inside a phrase.
      ["switch off the ads", "client_pause"],
      ["ads off", "client_pause"],
      ["turn off ads", "client_pause"],
      ["stop the campaign for now", "client_pause"],
      ["freeze the account", "client_pause"],
      ["stop the client's ads for a while", "client_pause"],
      // Need 4: the client's own team calls; never the opposite switch.
      ["client takes over the calls", "dfy_to_dwy"],
      ["stop our call centre for this client", "dfy_to_dwy"],
      ["client calls leads", "dfy_to_dwy"],
      ["client handles the calls now", "dfy_to_dwy"],
      ["hand over calls to the client", "dfy_to_dwy"],
      ["switch to dwy", "dfy_to_dwy"],
      ["dfy to dwy", "dfy_to_dwy"],
      ["change from dfy to dwy", "dfy_to_dwy"],
      ["done with you", "dfy_to_dwy"],
      // ... and its opposite, by where it goes.
      ["dwy to dfy", "dwy_to_dfy"],
      ["switch to dfy", "dwy_to_dfy"],
      ["change from dwy to dfy", "dwy_to_dfy"],
      ["done for you", "dwy_to_dfy"],
      ["we take over the calls", "dwy_to_dfy"],
      ["client wants us to call their leads", "dwy_to_dfy"],
      // Need 5: missing leads, above a new lead form.
      ["not getting leads", "missing_leads"],
      ["leads stopped", "missing_leads"],
      ["leads disappeared", "missing_leads"],
      ["we are not receiving leads", "missing_leads"],
      ["leads not syncing", "missing_leads"],
      ["leads not in the CRM", "missing_leads"],
      ["leads not showing in ghl", "missing_leads"],
      ["no new leads today", "missing_leads"],
      ["zero leads", "missing_leads"],
      // The rest still come first.
      ["new lead form", "connect_lead_form"],
      ["client offboarding", "client_offboarding"],
      ["leads not booking", "low_schedule_rate"],
      ["no shows", "low_show_rate"],
      // T2-clarity-01: a start and a client's exit, never the opposite
      // lifecycle request; "client" and "new" stay everyday words.
      ["first day for a new employee", "employee_onboarding"],
      ["new employee first day", "employee_onboarding"],
      ["a new sales rep starts on sunday", "employee_onboarding"],
      ["client is leaving", "client_offboarding"],
      ["client quits", "client_offboarding"],
      ["client wants to leave", "client_offboarding"],
      ["employee is leaving", "employee_offboarding"],
      ["last day", "employee_offboarding"],
    ];
    for (const [q, want] of rewordings)
      expect({ q, first: keys(q)[0] }).toEqual({ q, first: want });
    // The opposite switch is still listed, below.
    expect(keys("client takes over the calls")).toContain("dwy_to_dfy");
    // Return opens only a request that leads on words or phrases; a tie the
    // server's order would settle is the list's to show.
    const leads = (q: string) => searchLeads(searchTypes(ordered, q));
    expect(leads("pause")).toBe(true);
    expect(leads("stop ads")).toBe(true);
    expect(leads("not getting leads")).toBe(true);
    expect(leads("watsapp")).toBe(false);
    expect(leads("dwy")).toBe(false);
    expect(leads("refund")).toBe(false);
    expect(leads("first day for a new employee")).toBe(true);
    expect(leads("client quits")).toBe(true);
    // T2-clarity-02: one of the DFY and DWY switches never opens on Return
    // while the other is listed, unless the search says which way: "our call
    // centre" is said to drop it as well as to ask for it.
    for (const q of [
      "client doesn't want our call centre anymore",
      "client no longer needs our call centre",
      "client no longer wants our callers",
      "remove our call center from this client",
      "client will not use our call centre",
      "call centre no longer needed",
      "client doesn't need our team anymore",
      "client takes over the calls",
    ]) {
      expect({ q, listed: keys(q).includes("dfy_to_dwy") }).toEqual({
        q,
        listed: true,
      });
      expect({ q, leads: leads(q) }).toEqual({ q, leads: false });
    }
    expect(leads("change from dwy to dfy")).toBe(true);
    expect(leads("switch to dfy")).toBe(true);
    expect(leads("change from dfy to dwy")).toBe(true);
    expect(leads("switch to dwy")).toBe(true);
    expect(leads("done with you")).toBe(true);
    // Both ways said: the list is shown.
    expect(leads("from done with you to done for you")).toBe(false);
  });

  test("pause and script still find only their own request, against every look's words", () => {
    expect(keys("pause")).toEqual(["client_pause"]);
    expect(keys("script")).toEqual(["new_script"]);
    // No other type's name, hidden words, line or questions has such a word.
    const words = (t: TypeView) =>
      [
        t.label,
        ...TYPE_LOOK[t.key].words,
        TYPE_LOOK[t.key].line,
        ...bodyFields(t).map(f => f.label),
      ]
        .join(" ")
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u);
    for (const v of views) {
      if (v.key !== "client_pause")
        expect({
          key: v.key,
          pause: words(v).some(w => w.startsWith("pause")),
        }).toEqual({ key: v.key, pause: false });
      if (v.key !== "new_script")
        expect({
          key: v.key,
          script: words(v).some(w => w.startsWith("script")),
        }).toEqual({ key: v.key, script: false });
    }
    // The core's grouping is the form's own search.
    expect(groupTypes(ordered, "stop ads").map(g => g.teamLabel)).toEqual([
      "Operations / Tech",
      "Client Success",
    ]);
  });

  test("one wrong letter only when nothing matches, said in the count line", () => {
    const fixed = searchTypes(ordered, "watsapp");
    expect(fixed.fixed).toEqual({ from: "watsapp", to: "whatsapp" });
    expect(searchCountWords("watsapp", fixed)).toBe(
      'No match for "watsapp". 2 requests match "whatsapp".',
    );
    // "invoice" matches as typed, so nothing is fixed.
    expect(searchTypes(ordered, "invoice").fixed).toBeNull();
    expect(searchCountWords("pause", searchTypes(ordered, "pause"))).toBe(
      '1 request matches "pause".',
    );
    expect(searchCountWords("refund", searchTypes(ordered, "refund"))).toBe(
      'No request matches "refund".',
    );
    expect(markWords("Stop a client's ads", ["stop", "ads"])).toEqual([
      { text: "Stop", hit: true },
      { text: " ", hit: false },
      { text: "a", hit: false },
      { text: " ", hit: false },
      { text: "client", hit: false },
      { text: "'", hit: false },
      { text: "s", hit: false },
      { text: " ", hit: false },
      { text: "ads", hit: true },
    ]);
  });

  test("where a request goes, in words true for every answer", () => {
    expect(reachText(typeOf("low_schedule_rate"))).toBe(
      "Call Center, Marketing / ADs or both, by your answer",
    );
    // T2-clarity-04: while requests are not open to the seat no answer is
    // asked here, so the words name the question, as the route does.
    expect(reachText(typeOf("low_schedule_rate"), true)).toBe(
      'Call Center, Marketing / ADs or both, depending on the answer to "Where is the problem?"',
    );
    expect(
      typeFacts(typeOf("low_schedule_rate"), null, true, true).find(
        f => f.kind === "reach",
      )?.text,
    ).toBe(
      'Call Center, Marketing / ADs or both, depending on the answer to "Where is the problem?"',
    );
    expect(reachText(typeOf("client_pause"), true)).toBe(
      "Operations / Tech and Marketing / ADs",
    );
    expect(reachText(typeOf("client_pause"))).toBe(
      "Operations / Tech and Marketing / ADs",
    );
    expect(reachText(typeOf("create_ad_account"))).toBe("Marketing / ADs");
    // A task that always runs, and one for some answers only.
    const mixed = typeOf("low_schedule_rate");
    const always = {
      ...mixed,
      parts: [
        {
          ...mixed.parts[1],
          listName: "Operations / Tech",
          teamLabel: "Operations / Tech",
          when: null,
        },
        mixed.parts[1],
      ],
    };
    expect(reachText(always)).toBe(
      "Operations / Tech, and Marketing / ADs for Ads issue or Both",
    );
    // A database from before 20261028a: the teams joined, as before.
    const old = {
      ...mixed,
      parts: mixed.parts.map(({ when: _w, steps: _s, ...p }) => p),
    };
    expect(routesKnown(old)).toBe(false);
    expect(reachText(old)).toBe("Call Center and Marketing / ADs");
    // Each answer names the team it reaches, when the answers differ.
    const issue = mixed.fields.find(f => f.key === "schedule_rate_issue");
    if (!issue) throw new Error("No schedule_rate_issue");
    expect(Object.values(answerTeamLines(mixed, issue) ?? {})).toEqual([
      "Marketing / ADs",
      "Call Center",
      "Both teams",
    ]);
    const platform = typeOf("create_ad_account").fields.find(
      f => f.key === "ads_platform",
    );
    if (!platform) throw new Error("No ads_platform");
    expect(answerTeamLines(typeOf("create_ad_account"), platform)).toBeNull();
  });

  test("a row's facts, a team's list and a tile's shortcuts", () => {
    expect(typeFacts(typeOf("missing_leads")).map(f => f.text)).toEqual([
      "Due in 1 working day",
      "High priority",
    ]);
    expect(typeFacts(typeOf("client_pause")).map(f => f.text)).toEqual([
      "Due in 2 working days",
      "Also Marketing / ADs",
    ]);
    expect(typeFacts(typeOf("client_pause"), "ads").map(f => f.text)).toEqual([
      "Due in 2 working days",
      "Filed under Operations / Tech",
    ]);
    expect(
      typeFacts(typeOf("employee_onboarding"), null, true).map(f => f.text),
    ).toEqual(["Operations / Tech", "Due in 3 working days", "No client"]);
    expect(typeFacts(typeOf("general_tech")).map(f => f.text)).toContain(
      "Client optional",
    );
    // Every request under each team it reaches, its own first.
    expect(teamTypes(ordered, "ads").map(t => t.key)).toEqual([
      "create_ad_account",
      "ads_request",
      "edit_campaign",
      "general_marketing",
      "client_offboarding",
      "client_pause",
      "client_relaunch",
      "low_schedule_rate",
    ]);
    expect(teamTypes(ordered, "tech").at(-1)?.key).toBe(
      "whatsapp_reactivation",
    );
    expect(teamExamples(ordered, "tech").map(t => t.key)).toEqual([
      "missing_leads",
      "connect_lead_form",
      "client_pause",
    ]);
    // A type an editor moved to another board leaves its old tile.
    const moved = ordered.map(t =>
      t.key === "missing_leads" ? { ...t, team: "ads" as const } : t,
    );
    expect(teamExamples(moved, "tech").map(t => t.key)).toEqual([
      "connect_lead_form",
      "client_pause",
      "employee_onboarding",
    ]);
    expect(everyType(ordered)[0].label).toBe("Ad spend invoice");
  });

  test("the control by the number of choices, the due choices and the question headings", () => {
    const script = typeOf("new_script");
    const kind = (key: string) => {
      const f = script.fields.find(x => x.key === key);
      if (!f) throw new Error(`No ${key}`);
      return choiceControl(f);
    };
    expect(kind("who_films")).toBe("pills");
    expect(kind("orientation")).toBe("pills");
    expect(kind("script_style")).toBe("pills");
    expect(kind("script_type")).toBe("radios");
    expect(kind("arabic_dialect")).toBe("radios");
    expect(choiceControl({ options: [] })).toBe("select");
    expect(
      choiceControl({
        options: Array.from({ length: 11 }, (_, i) => ({
          id: `${i}`,
          name: `${i}`,
        })),
      }),
    ).toBe("select");
    // Mon 26 Oct: one working day is Tue 27, so the day after is offered.
    expect(dueChoices("2026-10-27", TODAY)).toEqual([
      { iso: "2026-10-27", tag: "usual" },
      { iso: "2026-10-28", tag: "later" },
    ]);
    // In date order, the usual one tagged wherever it falls (D16, CL-11).
    expect(dueChoices("2026-10-29", TODAY)).toEqual([
      { iso: "2026-10-27", tag: "sooner" },
      { iso: "2026-10-29", tag: "usual" },
    ]);
    expect(nextWorkingDay("2026-10-29")).toBe("2026-11-01"); // Thu to Sun
    expect(
      questionGroups(script).map(g => [g.title, g.fields.map(f => f.key)]),
    ).toEqual([
      [
        "The script",
        ["script_type", "script_style", "orientation", "script_quantity"],
      ],
      [
        "Filming and language",
        ["who_films", "script_language", "arabic_dialect"],
      ],
      [null, ["additional_notes"]],
    ]);
    // An editor's order that splits a heading's questions: no headings.
    const split = {
      ...script,
      fields: [...script.fields].sort((a, b) =>
        a.key === "who_films" ? -1 : b.key === "who_films" ? 1 : 0,
      ),
    };
    expect(questionGroups(split).map(g => g.title)).toEqual([null]);
    expect(questionGroups(typeOf("low_schedule_rate"))[0].fields[0].key).toBe(
      "schedule_rate_issue",
    );
  });

  const rp = (over: Partial<RoutePart> = {}): RoutePart => ({
    part: "main",
    listName: "Operations / Tech",
    teamLabel: "Operations / Tech",
    taskName: "Dune Build Co - General tech request",
    templateName: null,
    stepCount: 5,
    stepsDraft: true,
    owner: { label: "the systems manager", how: "rule", note: null },
    ...over,
  });

  test("routeModel: one task, its steps, and no task name before the client", () => {
    const tech = typeOf("general_tech");
    const one = routeModel({
      type: tech,
      preview: { parts: [rp()], note: null },
      answers: {},
      clientPicked: true,
    });
    expect(one.summary).toBe("One task, for Operations / Tech");
    expect(one.layout).toBe("stack");
    expect(one.lanes[0]).toMatchObject({
      kind: "plan",
      listName: "Operations / Tech",
      taskName: "Dune Build Co - General tech request",
    });
    expect(one.lanes[0].works).toEqual({
      kind: "steps",
      count: 5,
      steps: tech.parts[0].steps,
      draft: true,
    });
    // A client-required type names no task before the client is picked.
    const card = typeOf("card_missing");
    const early = routeModel({
      type: card,
      preview: {
        parts: [
          rp({
            listName: "Client Success",
            teamLabel: "Client Success",
            taskName: "Card missing for ads - from the CEO",
          }),
        ],
        note: null,
      },
      answers: {},
      clientPicked: false,
    });
    expect(early.lanes[0].taskName).toBeNull();
    // A ClickUp template's name, without its emoji.
    const pause = routeModel({
      type: typeOf("client_pause"),
      preview: {
        parts: [
          rp({
            part: "tech",
            templateName: "Client Pause ⏸️ (Tech)",
            stepCount: null,
          }),
          rp({
            part: "media",
            listName: "Marketing / ADs",
            teamLabel: "Marketing / ADs",
            templateName: "Client Pause ⏸️ (Media)",
            stepCount: null,
          }),
        ],
        note: null,
      },
      answers: {},
      clientPicked: true,
    });
    expect(pause.lanes.map(l => l.works)).toEqual([
      { kind: "template", name: "Client Pause (Tech)" },
      { kind: "template", name: "Client Pause (Media)" },
    ]);
    expect(pause.layout).toBe("pair");
    expect(pause.summary).toBe(
      "Two tasks, for Operations / Tech and Marketing / ADs",
    );
  });

  test("routeModel: the lanes that may run before the answer, the fork after it, three tasks stacked", () => {
    const low = typeOf("low_schedule_rate");
    const issue = low.fields.find(f => f.key === "schedule_rate_issue");
    if (!issue?.options) throw new Error("No schedule_rate_issue choices");
    const [adsIssue, ccIssue, both] = issue.options;
    const cc = rp({
      part: "call_center",
      listName: "Call Center",
      teamLabel: "Call Center",
      taskName: "Dune Build Co - Low schedule rate (Call Center)",
      templateName: "Low Schedule Rate📉 (Call Center)",
      stepCount: null,
      owner: {
        label: "the CSM",
        how: "card",
        note: "The CSM named on the client card.",
      },
    });
    const ads = rp({
      part: "ads",
      listName: "Marketing / ADs",
      teamLabel: "Marketing / ADs",
      taskName: "Dune Build Co - Low schedule rate (Ads)",
      templateName: "Low Schedule Rate📉 (Ads)",
      stepCount: null,
      owner: {
        label: "the systems manager",
        how: "fallback",
        note: "No media buyer is named for this request type yet.",
      },
    });
    const before = routeModel({
      type: low,
      preview: {
        parts: [],
        note: "Pick Where is the problem? to see where it goes.",
      },
      choicePreviews: {
        [adsIssue.id]: [ads],
        [ccIssue.id]: [cc],
        [both.id]: [cc, ads],
      },
      answers: {},
      clientPicked: true,
    });
    expect(before.summary).toBe("One or two tasks, by your answer");
    expect(before.note).toBeNull();
    expect(
      before.lanes.map(l => [l.kind, l.condition, l.owner?.label]),
    ).toEqual([
      ["may", "If the problem is Call Center Issue or Both", "the CSM"],
      ["may", "If the problem is Ads issue or Both", "the systems manager"],
    ]);
    expect(before.lanes[1].owner?.note).toBe(
      "No media buyer is named for this request type yet.",
    );
    expect(before.decision).toBeNull();
    const after = routeModel({
      type: low,
      preview: { parts: [cc, ads], note: null },
      answers: { schedule_rate_issue: both.id },
      clientPicked: true,
    });
    expect(after.decision).toEqual({
      question: "Where is the problem?",
      answer: "Both",
    });
    expect(after.layout).toBe("pair");
    const adsOnly = routeModel({
      type: low,
      preview: { parts: [ads], note: null },
      answers: { schedule_rate_issue: adsIssue.id },
      clientPicked: true,
    });
    expect(adsOnly.lanes.map(l => l.listName)).toEqual(["Marketing / ADs"]);
    expect(adsOnly.layout).toBe("stack");
    // Create an ad account: three tasks that may run, one for each answer,
    // on one list for one owner, drawn as one lane (D7): the answers in the
    // question's order, and what each answer's task works from.
    const account = routeModel({
      type: typeOf("create_ad_account"),
      preview: { parts: [], note: "Pick Ad platform to see where it goes." },
      answers: {},
      clientPicked: true,
    });
    expect(account.summary).toBe(
      "One task for Marketing / ADs, by your answer",
    );
    expect(account.lanes.map(l => [l.kind, l.listName, l.condition])).toEqual([
      [
        "may",
        "Marketing / ADs",
        "If the platform is Facebook/Meta, Tiktok or Snapchat",
      ],
    ]);
    expect(account.lanes[0].works).toBeNull();
    expect(account.lanes[0].byAnswer).toEqual([
      {
        answer: "Facebook/Meta",
        works: { kind: "template", name: "Create Meta Ad Account" },
      },
      {
        answer: "Tiktok",
        works: { kind: "template", name: "Create TikTok Ad Account" },
      },
      {
        answer: "Snapchat",
        works: { kind: "template", name: "Create Snapchat Ad Account" },
      },
    ]);
    expect(account.layout).toBe("stack");
    // An editor's third task: three lanes, stacked, said in words.
    const three = routeModel({
      type: typeOf("client_pause"),
      preview: {
        parts: [
          rp({ part: "tech" }),
          rp({ part: "media", listName: "Marketing / ADs" }),
          rp({ part: "extra", listName: "Client Success" }),
        ],
        note: null,
      },
      answers: {},
      clientPicked: true,
    });
    expect(three.summary).toBe(
      "Three tasks, for Operations / Tech, Marketing / ADs and Client Success",
    );
    expect(three.layout).toBe("stack");
    // A database from before 20261028a: the server's note, no lanes.
    const old = {
      ...low,
      parts: low.parts.map(({ when: _w, steps: _s, ...p }) => p),
    };
    const plain = routeModel({
      type: old,
      preview: {
        parts: [],
        note: "Pick Where is the problem? to see where it goes.",
      },
      answers: {},
      clientPicked: true,
    });
    expect(plain.lanes).toEqual([]);
    expect(plain.note).toBe("Pick Where is the problem? to see where it goes.");
    // T2-clarity-03: not open to the seat, the question is not on the page,
    // so the server's "Pick ..." is never said, nor read for its question.
    const plainAhead = routeModel({
      type: old,
      preview: {
        parts: [],
        note: "Pick Where is the problem? to see where it goes.",
      },
      answers: {},
      clientPicked: false,
      ahead: true,
    });
    expect(plainAhead.lanes).toEqual([]);
    expect(plainAhead.note).toBe(
      "Where it goes depends on the answer to one of its questions.",
    );
    // BT-1, CL-03: while requests are not open to the seat no answer is
    // asked here, so the summary names the question, never "your answer".
    const ahead = routeModel({
      type: low,
      preview: {
        parts: [],
        note: "Pick Where is the problem? to see where it goes.",
      },
      choicePreviews: {
        [adsIssue.id]: [ads],
        [ccIssue.id]: [cc],
        [both.id]: [cc, ads],
      },
      answers: {},
      clientPicked: false,
      ahead: true,
    });
    expect(ahead.summary).toBe(
      'One or two tasks, depending on the answer to "Where is the problem?"',
    );
    expect(ahead.lanes.map(l => l.taskName)).toEqual([null, null]);
    expect(ROUTE_WORDS.namedForClient).toBe(
      "Named after the client it is for.",
    );
  });

  test("sentModel: every state in the core's own sentences, a held request never a success", () => {
    const moving = sentModel(
      [part({ state: "sending", url: null, status: null })],
      true,
    );
    expect(moving).toMatchObject({
      tone: "moving",
      heading: "Sent",
      layout: "stack",
    });
    expect(moving.sub).toBe(
      "Nothing else to do now. It is on its way to ClickUp, usually within a minute or two.",
    );
    expect(moving.lanes[0]).toMatchObject({
      line: "Sending to Operations / Tech.",
      state: "moving",
      url: null,
    });
    const done = sentModel([part()], true);
    expect(done.lanes[0]).toMatchObject({
      line: "In Operations / Tech. Owner: the systems manager.",
      state: "done",
      url: "https://app.clickup.com/t/86harn001",
    });
    expect(done.sub).toBe("Nothing else to do now. It is in ClickUp.");
    const held = sentModel(
      [part({ state: "queued", url: null, status: null })],
      false,
    );
    expect(held).toMatchObject({
      tone: "held",
      heading: "Saved",
      sub: "Nothing else to do now. It goes to ClickUp by itself once requests open.",
    });
    expect(held.lanes[0].line).toBe(
      "Saved. Goes to Operations / Tech when requests open.",
    );
    const refused = sentModel(
      [part({ state: "failed", error: "ClickUp refused the task", url: null })],
      true,
    );
    expect(refused).toMatchObject({
      tone: "failed",
      heading: "Not sent",
      next: REQUEST_SENTENCES.sentFailed,
    });
    expect(refused.lanes[0].line).toBe(
      "Not sent to Operations / Tech: ClickUp refused the task.",
    );
    const two = [
      part(),
      part({
        part: "media",
        listName: "Marketing / ADs",
        state: "sending",
        url: null,
        status: null,
      }),
    ];
    const half = sentModel(two, true);
    expect(half.sub).toBe(
      "Nothing else to do now. One task is in ClickUp; the other is on its way.",
    );
    expect(half.sub).not.toContain("minute or two");
    expect(half.layout).toBe("pair");
    const partly = sentModel(
      [two[0], { ...two[1], state: "failed", error: "gone" }],
      true,
    );
    expect(partly).toMatchObject({
      heading: "Partly sent",
      sub: "Part of it reached ClickUp.",
    });
    expect(partly.next).toBe(
      partialNext({ parts: [two[0], { ...two[1], state: "failed" }] }),
    );
    const lost = sentModel([part({ state: "unknown", url: null })], true);
    expect(lost.lanes[0]).toMatchObject({
      line: "Checking whether it reached Operations / Tech.",
      state: "checking",
    });
    const three = sentModel(
      [part(), part({ part: "b" }), part({ part: "c" })],
      true,
    );
    expect(three.sub).toBe(
      "Nothing else to do now. All three tasks are in ClickUp.",
    );
    expect(three.layout).toBe("stack");
    // A delivered task with a refused step keeps its quiet note.
    expect(
      sentModel([part({ error: "The SOP steps did not save." })], true).lanes[0]
        .note,
    ).toBe("The SOP steps did not save.");
    // CL-01: and the line under the heading points at that note, never
    // "Nothing else to do now", while the mark and the task's sentence stay.
    const owner =
      "ClickUp refused the owner, due day or priority. Set them on the task in ClickUp.";
    const unfinished = sentModel([part({ error: owner })], true);
    expect(unfinished).toMatchObject({ tone: "done", heading: "Sent" });
    expect(unfinished.sub).toBe(
      "It is in ClickUp, but not finished. The note under the task says what to check there.",
    );
    expect(unfinished.lanes[0]).toMatchObject({
      line: "In Operations / Tech. Owner: the systems manager.",
      note: owner,
    });
    const oneOfTwo = sentModel(
      [
        part({ error: owner }),
        part({ part: "media", listName: "Marketing / ADs" }),
      ],
      true,
    );
    expect(oneOfTwo.sub).toBe(
      "Both tasks are in ClickUp. One is not finished: the note under it says what to check there.",
    );
    expect(oneOfTwo.sub).not.toContain("Nothing else to do now");
    const stillMoving = sentModel(
      [part({ error: owner }), { ...two[1] }],
      true,
    );
    // T2-clarity-06: while another task is on its way, which one is not
    // finished: the one in ClickUp.
    expect(stillMoving.sub).toBe(
      "One task is in ClickUp; the other is on its way. The one in ClickUp is not finished: the note under it says what to check there.",
    );
    const twoOfThree = sentModel(
      [
        part({ error: owner }),
        part({ part: "media", listName: "Marketing / ADs", error: owner }),
        { ...two[1], part: "cc", listName: "Call Center" },
      ],
      true,
    );
    expect(twoOfThree.sub).toBe(
      "Two tasks are in ClickUp; the other is on its way. The two in ClickUp are not finished: the notes under them say what to check there.",
    );
  });

  test("review part 2: a part no choice runs, the unheld owner, a team's pointer, and the sent words by state", () => {
    // BT-6, S4: a part whose `when` keeps no choice (20261028a sends
    // options []) never runs: no lane, no team in the reach words or facts,
    // and not on that team's list.
    const low = typeOf("low_schedule_rate");
    const emptied: TypeView = {
      ...low,
      parts: low.parts.map(p =>
        p.listName === "Marketing / ADs" && p.when
          ? { ...p, when: { ...p.when, options: [] } }
          : p,
      ),
    };
    const adsPart = emptied.parts.find(p => p.listName === "Marketing / ADs");
    if (!adsPart) throw new Error("No ads part");
    expect(partReachable(adsPart)).toBe(false);
    expect(partReachable({ when: null })).toBe(true);
    expect(reachText(emptied)).toBe("Call Center");
    expect(typeFacts(emptied).map(f => f.text)).toEqual([
      "Due in 3 working days",
    ]);
    const withEmptied = views.map(v =>
      v.key === "low_schedule_rate" ? emptied : v,
    );
    expect(teamTypes(withEmptied, "ads").map(t => t.key)).not.toContain(
      "low_schedule_rate",
    );
    const route = routeModel({
      type: emptied,
      preview: {
        parts: [],
        note: "Pick Where is the problem? to see where it goes.",
      },
      answers: {},
      clientPicked: true,
    });
    expect(route.lanes.map(l => [l.kind, l.listName])).toEqual([
      ["may", "Call Center"],
    ]);
    expect(route.summary).toBe("One task for Call Center, by your answer");
    // ... and with the question lost, every task it decides rests on no
    // choice: the route says why, never "Pick ..." for what cannot be
    // picked (routeNote, which Send says too).
    const lostQuestion: TypeView = {
      ...low,
      fields: low.fields.map(f =>
        f.key === "schedule_rate_issue" ? { ...f, options: [] } : f,
      ),
      parts: low.parts.map(p =>
        p.when ? { ...p, when: { ...p.when, options: [] } } : p,
      ),
    };
    const pickNote = "Pick Where is the problem? to see where it goes.";
    const lostRoute = routeModel({
      type: lostQuestion,
      preview: { parts: [], note: pickNote },
      answers: {},
      clientPicked: true,
    });
    expect(lostRoute.lanes).toEqual([]);
    expect(lostRoute.summary).toBe("");
    expect(lostRoute.note).toBe(ROUTE_WORDS.routeLost);
    expect(ROUTE_WORDS.routeLost).toBe(
      "Where it goes rests on a choice that could not be read from ClickUp. Ask the systems manager.",
    );
    // A task some answer still runs, or a database from before 20261028a,
    // keeps the server's sentence.
    expect(routeNote(emptied, pickNote)).toBe(pickNote);
    expect(
      routeNote({ parts: low.parts.map(({ when: _w, ...p }) => p) }, pickNote),
    ).toBe(pickNote);
    expect(routeNote(lostQuestion, null)).toBeNull();
    // CL-07: with no lane to draw, the server's sentence is said once, on
    // the route's own stop, never again as the summary.
    const old = {
      ...low,
      parts: low.parts.map(({ when: _w, steps: _s, ...p }) => p),
    };
    const plain = routeModel({
      type: old,
      preview: {
        parts: [],
        note: "Pick Where is the problem? to see where it goes.",
      },
      answers: {},
      clientPicked: true,
    });
    expect(plain.summary).toBe("");
    // CL-12, BT-12: a later type's line never names an owner nobody holds.
    // BT-6, S4: it speaks the plate's own reach words, true for every
    // answer, and never names a team no offered choice reaches.
    expect(typeLook({ ...low, key: "added_later" }).line).toBe(
      "Goes to Call Center, Marketing / ADs or both, by your answer",
    );
    expect(typeLook({ ...low, key: "added_later" }, true).line).toBe(
      'Goes to Call Center, Marketing / ADs or both, depending on the answer to "Where is the problem?"',
    );
    // With that task gone, the owner nobody holds goes too, and the one
    // that runs is named.
    expect(typeLook({ ...emptied, key: "added_later" }).line).toBe(
      "Goes to Call Center. Owner: the client's CSM",
    );
    // ... and a search for the team it no longer reaches does not find it.
    const marketing = (ts: TypeView[]) =>
      searchTypes(ts, "marketing").hits.map(h => h.type.key);
    expect(marketing(views)).toContain("low_schedule_rate");
    expect(marketing(withEmptied)).not.toContain("low_schedule_rate");
    // CL-09: a team's pointer to what is filed under another team.
    expect(teamRelated(views, "ads")).toEqual({
      ask: "Ads stopped because a payment card failed?",
      types: [typeOf("card_missing")],
    });
    expect(teamRelated(views, "call_center")?.types.map(t => t.key)).toEqual([
      "dfy_to_dwy",
      "dwy_to_dfy",
    ]);
    expect(teamRelated(views, "tech")).toBeNull();
    // T3-design-clarity-02: of the requests filed elsewhere that give
    // Marketing / ADs a task, only Low schedule rate does so for some
    // answers alone; a pause, relaunch or exit always does. A database from
    // before 20261028a cannot tell, and counts none.
    expect(teamByAnswer(views, "ads").map(t => t.key)).toEqual([
      "low_schedule_rate",
    ]);
    expect(teamByAnswer(views, "call_center")).toEqual([]);
    expect(
      teamByAnswer(
        views.map(v => ({
          ...v,
          parts: v.parts.map(({ when: _when, ...p }) => p),
        })),
        "ads",
      ),
    ).toEqual([]);
    expect(
      teamRelated(
        views.filter(v => v.key !== "card_missing"),
        "ads",
      ),
    ).toBeNull();
    // BT-5, CL-08: the minute-or-two only while the page still reads it,
    // and never beside a create in doubt.
    const sending = part({ state: "sending", url: null, status: null });
    expect(sentModel([sending], true, { stopped: true }).sub).toBe(
      "Nothing else to do now. It is on its way to ClickUp.",
    );
    expect(sentModel([part({ state: "unknown", url: null })], true).sub).toBe(
      "Nothing else to do now. The cockpit is checking whether it reached ClickUp.",
    );
    const media = { part: "media", listName: "Marketing / ADs" };
    expect(
      sentModel(
        [part({ state: "unknown", url: null }), { ...sending, ...media }],
        true,
      ).sub,
    ).toBe(
      "Nothing else to do now. Both tasks are on their way to ClickUp; the cockpit is checking whether one reached it.",
    );
    // CL-04: a quiet writer's held request follows its hedge, with no
    // "Nothing else to do now" (its note asks to check the Machine tab).
    const quietHeld = sentModel(
      [part({ state: "queued", url: null, status: null })],
      false,
      { quiet: true },
    );
    expect(quietHeld.sub).toBe(
      "It goes to ClickUp by itself once the requests writer runs with requests open.",
    );
    // ... and so does each held task's own line (sentLines stays as pinned).
    expect(quietHeld.lanes[0].line).toBe(
      "Saved. Goes to Operations / Tech once the writer runs with requests open.",
    );
    expect(
      sentModel(
        [part({ state: "queued", url: "https://app.clickup.com/t/86harn001" })],
        false,
        { quiet: true },
      ).lanes[0].line,
    ).toBe(
      "In Operations / Tech, not finished yet. The cockpit finishes it once the writer runs with requests open.",
    );
    // CL-05: refused tasks are named as such at once, and a request that
    // reached nothing and moves no more has ended.
    const gone = part({ state: "failed", error: "x", url: null });
    const neither = sentModel([gone, { ...gone, ...media }], true);
    expect(neither).toMatchObject({
      heading: "Not sent",
      sub: "Neither task reached ClickUp.",
      refused: true,
      ended: true,
      delivered: false,
    });
    const onTheWay = sentModel([gone, { ...sending, ...media }], true);
    expect(onTheWay).toMatchObject({
      tone: "failed",
      heading: "Partly sent",
      sub: "One task did not reach ClickUp; the other is on its way.",
      refused: true,
      ended: false,
    });
    expect(sentModel([part()], true)).toMatchObject({
      refused: false,
      ended: false,
    });
  });

  test("names and ids: a template without its emoji, only the client isolated, the new keys parsed as optional", () => {
    expect(plainTemplateName("Low Schedule Rate📉 (Call Center)")).toBe(
      "Low Schedule Rate (Call Center)",
    );
    expect(plainTemplateName("Change Company Name⏎")).toBe(
      "Change Company Name",
    );
    expect(plainTemplateName("Whatsapp Connection Issue📲❌")).toBe(
      "Whatsapp Connection Issue",
    );
    expect(plainTemplateName("📣")).toBe("📣");
    expect(
      taskNameParts(
        "مجموعة الواحة للمقاولات - Low schedule rate (Ads)",
        "مجموعة الواحة للمقاولات",
      ),
    ).toEqual({
      client: "مجموعة الواحة للمقاولات",
      rest: " - Low schedule rate (Ads)",
    });
    expect(
      taskNameParts("General tech request - from the CEO", "Dune Build Co"),
    ).toBeNull();
    const base = typeOf("low_schedule_rate").parts[0];
    const { when: _w, steps: _s, ...bare } = base;
    expect("when" in partFacts(bare)).toBe(false);
    expect("steps" in partFacts(bare)).toBe(false);
    expect(partFacts({ ...bare, when: null, steps: null })).toMatchObject({
      when: null,
      steps: null,
    });
    expect(
      partFacts({
        ...bare,
        when: {
          fieldKey: "x",
          options: [{ id: "a", name: "A" }, { id: 3 }],
        } as never,
        steps: ["One", 2] as never,
      }),
    ).toEqual({
      ...bare,
      when: { fieldKey: "x", options: [{ id: "a", name: "A" }] },
    });
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

  test("the form's CSS keeps its accessibility rules (A11Y-12 to A11Y-21)", () => {
    const css = read("media-buyer-cockpit", FILES[3]);
    /** The declarations of the rule whose selector list is exactly `sel`. */
    const rule = (sel: string) => {
      const at = css.indexOf(`\n${sel} {\n`);
      return at < 0 ? "" : css.slice(at, css.indexOf("\n}", at + 1));
    };
    /** An at-rule's whole block, up to its closing brace at the margin. */
    const block = (head: string) => {
      const at = css.indexOf(`${head} {\n`);
      return at < 0 ? "" : css.slice(at, css.indexOf("\n}\n", at));
    };
    // A heading that takes focus after a view change shows the ring.
    for (const sel of [
      ".rq-kicker:focus-visible",
      ".rq-hero-name:focus-visible",
    ])
      expect({ sel, ring: rule(sel) }).toEqual({
        sel,
        ring: expect.stringContaining("outline: 2px solid var(--rq-focus)"),
      });
    // A choice question in error takes the red, as a text field's edge.
    expect(rule('.rq-choices[aria-invalid="true"] .rq-choice-face')).toContain(
      "var(--destructive)",
    );
    expect(rule('.rq-radios[aria-invalid="true"]')).toContain(
      "var(--destructive)",
    );
    // The unseen radio covers its face, and a focused control stops clear
    // of the floating Ask Hermes button (116px up on a phone).
    expect(rule(".rq-choice-input")).toContain("inset: 0;");
    expect(rule(".rq-choice-input")).toContain("width: 100%;");
    expect(css).toMatch(/scroll-margin-block: 16px calc\(136px \+ env\(/);
    // Forced colours: rings only on focus, the chosen dot drawn as an edge.
    const forced = block("@media (forced-colors: active)");
    expect(forced).toContain("outline-style: none;");
    expect(forced).toMatch(/:focus-visible[^{]*\{\s*outline: 3px solid/);
    expect(forced).toContain(".rq-choice[data-on] .rq-radio-dot::after");
    // Touch: the links and the search's clear button are 40px targets.
    const touch = block("@media (pointer: coarse)");
    for (const sel of [".rq-sop", ".rq-open", ".rq-link"])
      expect({ sel, listed: touch.includes(`  ${sel},`) }).toEqual({
        sel,
        listed: true,
      });
    expect(touch).toMatch(
      /\.rq-search-clear \{\s*width: 40px;\s*height: 40px;/,
    );
    // A choice ClickUp lost is aria-disabled and still looks unavailable.
    expect(css).toContain('.rq-input[aria-disabled="true"] {');
  });
});
