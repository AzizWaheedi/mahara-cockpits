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
  cleanAnswers,
  dayLabel,
  display,
  dueWord,
  fieldOfSentence,
  groupTypes,
  isOpen,
  kuwaitClock,
  kuwaitToday,
  type PartRow,
  partChip,
  partWords,
  REQUEST_SENTENCES,
  type RequestRow,
  routeLine,
  sentLines,
  stateChip,
  stateWords,
  type TypeView,
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
    expect(stateWords(row({ state: "dry_run" }))).toBe(
      "Not in ClickUp: the writer is in its test run",
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

  test("the sent panel says where each task went", () => {
    expect(
      sentLines([
        part(),
        part({
          listName: "Marketing / ADs",
          owner: { label: "", how: "none", note: null },
        }),
      ]),
    ).toEqual([
      "Sent to Operations / Tech. Owner: the systems manager.",
      "Sent to Marketing / ADs. Owner: nobody yet.",
    ]);
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
