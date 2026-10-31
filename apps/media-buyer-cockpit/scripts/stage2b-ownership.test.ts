/**
 * Stage 2b's file ownership (docs/forms/STAGE2B-CONTRACT.md section 7: "Every
 * file has exactly one owner; a file not listed is not changed"). Six builders
 * work in one worktree and other sessions ship from main, so an unlisted edit
 * would ship with whoever ships that app next.
 *
 * The owners are read from section 7's table itself, every path exactly as
 * written there, so the test and the contract cannot drift; the table's own
 * file counts ("db 10; writers 30; ...") are the second source. It reads git
 * only (never writes): the files changed since the branch left main (the
 * merge-base with origin/main, f80130d0 since the second rebase of 2026-10-30, Z79),
 * committed or not, plus the untracked ones. It runs only on the build's branch (stage2b-1029) and
 * skips once the branch is on main, as 2a's does; not in scripts/ship.sh for
 * that reason.
 *
 * Run: cd apps/media-buyer-cockpit && bun test scripts/stage2b-ownership.test.ts
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const BRANCH = "stage2b-1029";
const CONTRACT = "docs/forms/STAGE2B-CONTRACT.md";

function git(...args: string[]): string | null {
  const out = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  return out.status === 0 ? out.stdout : null;
}
/** Where 2b was first cut from, before the rebase: never the base again (Z79). */
const FIRST_BASE = "0889803b";
const BASE = git("merge-base", "HEAD", "origin/main")?.trim() || "f80130d0";
// Once the branch is on main its merge-base is HEAD and the diff is empty, so
// the check has nothing left to own (2a's lesson of 2026-10-29).
const onBranch =
  git("rev-parse", "--abbrev-ref", "HEAD")?.trim() === BRANCH &&
  git("cat-file", "-e", `${BASE}^{commit}`) !== null &&
  git("rev-parse", "HEAD")?.trim() !== BASE;

const ROLES = [
  "db",
  "writers",
  "notices",
  "worker",
  "screens",
  "parity",
] as const;
type Role = (typeof ROLES)[number] | "shared" | "orchestrator";

/** A backticked token in the table that names a file (a path, or a root file such as SOURCES.md). */
const PATH =
  /^(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*\.(?:ts|tsx|sql|py|md|sh|json|css)$/;

/** Section 7's table: each listed file and its owner, in the table's order. */
export function ownersOf(contract: string): { file: string; role: Role }[] {
  const section = contract
    .split(/^## 7\. File ownership$/m)[1]
    ?.split(/^## 8\./m)[0];
  if (!section) throw new Error("Section 7 of the 2b contract is missing.");
  // The first table only (the hand-offs and the build order follow it).
  const all = section.split("\n");
  const head = all.findIndex(l => l.startsWith("| File | Owner |"));
  if (head < 0) throw new Error("Section 7's File | Owner table is missing.");
  const end = all.findIndex((l, i) => i > head && !l.startsWith("|"));
  const rows = all.slice(head + 2, end < 0 ? undefined : end);
  const out: { file: string; role: Role }[] = [];
  for (const row of rows) {
    const cells = row.split(" | ");
    const owner = cells[cells.length - 1].replace(/\s*\|\s*$/, "").trim();
    const role: Role = (ROLES as readonly string[]).includes(owner)
      ? (owner as Role)
      : owner.startsWith("add-only")
        ? "shared"
        : owner.startsWith("the orchestrator")
          ? "orchestrator"
          : (() => {
              throw new Error(
                `Section 7 names an owner this test does not know: ${owner}`,
              );
            })();
    const files = [
      ...cells
        .slice(0, -1)
        .join(" | ")
        .matchAll(/`([^`]+)`/g),
    ]
      .map(m => m[1])
      .filter(t => PATH.test(t));
    for (const file of files) out.push({ file, role });
  }
  return out;
}

/** The table's own count line: "**File counts:** db 10; writers 29; ...". */
function countsOf(contract: string): Record<string, number> {
  const line =
    /\*\*File counts:\*\*([^\n]*(?:\n[^\n*][^\n]*)*)/.exec(contract)?.[1] ?? "";
  return Object.fromEntries(
    [
      ...line.matchAll(/\b(db|writers|notices|worker|screens|parity) (\d+)/g),
    ].map(m => [m[1], Number(m[2])]),
  );
}

const contract = readFileSync(`${ROOT}${CONTRACT}`, "utf8");
const OWNERS = ownersOf(contract);
/** Files a builder may only add to (section 6 for RUNBOOK.md; section 7's "one new 2b block", "only", "add only"). */
const ADD_ONLY = [
  "RUNBOOK.md",
  "scripts/ship.sh",
  "scripts/verify-cutover-readiness.py",
  "apps/client-success-cockpit/src/dev/noticesFixtures.ts",
  "apps/client-success-cockpit/src/dev/formHarness.tsx",
];
/** Evidence written on this Mac, never tracked (the replay's reports, the deploy's saved bodies). */
const UNTRACKED_EVIDENCE = ["notes/"];

const lines = (out: string | null) =>
  (out ?? "")
    .split("\n")
    .map(s => s.trim())
    .filter(Boolean);

describe("section 7's table", () => {
  test("lists every role's files, matching the table's own counts", () => {
    const counts = countsOf(contract);
    expect(Object.keys(counts).sort()).toEqual([...ROLES].sort());
    for (const role of ROLES)
      expect(
        OWNERS.filter(o => o.role === role).length,
        `${role}: the table lists a different number of files than its count line`,
      ).toBe(counts[role]);
    expect(OWNERS.filter(o => o.role === "shared").map(o => o.file)).toEqual([
      "RUNBOOK.md",
    ]);
    expect(
      OWNERS.filter(o => o.role === "orchestrator").map(o => o.file),
    ).toEqual([CONTRACT]);
  });

  test("no file has two owners", () => {
    const seen = new Map<string, Role>();
    for (const { file, role } of OWNERS) {
      expect(
        seen.get(file),
        `${file} is listed for ${seen.get(file)} and ${role}`,
      ).toBeUndefined();
      seen.set(file, role);
    }
  });

  test("parity's files are the ones this role builds", () => {
    expect(OWNERS.filter(o => o.role === "parity").map(o => o.file)).toEqual([
      "apps/client-success-cockpit/src/lib/clientBrief.ts",
      "apps/client-success-cockpit/scripts/client-brief.test.ts",
      "apps/media-buyer-cockpit/scripts/checkin-plans-supabase.test.ts",
      "supabase/functions/cockpit-forms-api/todos.ts",
      "supabase/functions/cockpit-forms-api/drafts.test.ts",
      "apps/media-buyer-cockpit/scripts/checkin-replay.ts",
      "apps/media-buyer-cockpit/scripts/checkin-replay.test.ts",
      "apps/media-buyer-cockpit/scripts/stage2b-fit-supabase.test.ts",
      "apps/media-buyer-cockpit/scripts/stage2b-ownership.test.ts",
      "scripts/ship.sh",
      "scripts/verify-cutover-readiness.py",
      "scripts/dev/forms_gates.py",
      "scripts/dev/test_forms_gates.py",
    ]);
  });

  test("the rows the rebase added have their owners (Z78)", () => {
    const owner = new Map(OWNERS.map(o => [o.file, o.role]));
    for (const [file, role] of [
      ["hermes/cockpit-guardian/checks/pg_cron.py", "worker"],
      ["hermes/cockpit-guardian/checks/sections.py", "worker"],
      ["hermes/cockpit-guardian/tests/test_hiring_sync.py", "worker"],
      ["supabase/functions/cockpit-notices/run.ts", "notices"],
      [
        "apps/media-buyer-cockpit/scripts/stage1-fit-supabase.test.ts",
        "screens",
      ],
      ["docs/requests/CLICKUP-DOWNGRADE.md", "writers"],
    ])
      expect(owner.get(file), file).toBe(role as Role);
  });

  test("names no file that section 7 says nobody touches", () => {
    const untouched = [
      "apps/media-buyer-cockpit/scripts/slack-notices-supabase.test.ts",
      "hermes/csm-calls/callMatch.ts",
      "hermes/csm-calls/match.ts",
      "hermes/csm-calls/fathomRules.ts",
      "hermes/csm-calls/eods.ts",
      "supabase/functions/cockpit-forms-api/transcript.ts",
      "supabase/functions/cockpit-forms-api/typeform.ts",
      "supabase/functions/cockpit-forms-api/keys.ts",
      "apps/client-success-cockpit/src/lib/onboardingCore.ts",
      "apps/client-success-cockpit/src/lib/csmLinks.ts",
      "apps/client-success-cockpit/src/lib/csmTemplates.ts",
      "apps/client-success-cockpit/src/lib/csmCalls.ts",
      "apps/client-success-cockpit/src/components/ClientCalls.tsx",
      "apps/client-success-cockpit/scripts/csm-read-model.test.ts",
    ];
    expect(OWNERS.filter(o => untouched.includes(o.file))).toEqual([]);
    expect(
      OWNERS.filter(o =>
        /^(supabase\/functions\/(fathom-webhook|cockpit-board-api)|hermes\/ad-billing-guard|viktor-side-scripts|apps\/media-buyer-cockpit\/src)\//.test(
          o.file,
        ),
      ),
    ).toEqual([]);
  });
});

describe("what the person running the hour reads", () => {
  test("section 8's forms-door list is what fn_extras prints", () => {
    const m = contract.match(
      /fn_extras\.py \. forms-door` lists exactly (\w+) files: (.+?) \(`cockpit-hours-sync\/db\.ts:6`/,
    );
    expect(m, "section 8 no longer lists forms-door's files").not.toBeNull();
    const listed = [...(m?.[2] ?? "").matchAll(/`([^`]+)`/g)].map(x => x[1]);
    const out = spawnSync(
      "python3",
      ["scripts/dev/fn_extras.py", ".", "forms-door"],
      { cwd: ROOT, encoding: "utf8" },
    );
    expect(out.status).toBe(0);
    const printed = out.stdout.trim().split(/\s+/);
    expect(listed).toEqual(printed);
    // The word and the list say the same number; ship.sh pins the same files
    // and the fit test holds it to fn_extras.
    const WORDS = ["five", "six", "seven", "eight"];
    expect(WORDS.indexOf(m?.[1] ?? "") + 5).toBe(printed.length);
  });

  // The canary limits ClickUp and the recap to the test card; the Call grade
  // follows the registry on every card (1.4), so someone has to be told. Off
  // before 7b the cut-over refuses (3.2), and off means that grade never posts.
  const hourText = (name: string, text: string | undefined) => {
    expect(text, `${name} is missing`).toBeDefined();
    const flat = (text ?? "").replace(/\s+/g, " ");
    expect(flat).toContain("not to send");
    expect(flat).toContain("#client-call-feedback");
    expect(flat).toContain("Notices and routing");
    expect(flat).toMatch(/only after 7b/);
    expect(flat).toMatch(/on every card/);
  };

  test("step 8 of 11.2 says the Call grade has no canary", () => {
    hourText(
      "step 8 of 11.2",
      contract
        .split(/^### 11\.2 The steps$/m)[1]
        ?.split(/^8\. \*\*The canary\*\*/m)[1]
        ?.split(/^9\. \*\*Open to all\*\*/m)[0],
    );
  });

  test("the runbook's cut-over hour says the Call grade has no canary", () => {
    hourText(
      "RUNBOOK.md's cut-over hour",
      readFileSync(`${ROOT}RUNBOOK.md`, "utf8")
        .split(/^## The 1-1 notes cut-over hour$/m)[1]
        ?.split(/^## /m)[0],
    );
  });
});

describe("the branch's changes (stage2b-1029 only)", () => {
  test.skipIf(!onBranch)(
    "compares with the merge-base with origin/main, past the first base",
    () => {
      // Diffing from the first base would list the 139 files main added since.
      const full = (rev: string) => git("rev-parse", rev)?.trim();
      expect(full(BASE)).toBe(git("merge-base", "HEAD", "origin/main")?.trim());
      expect(full(BASE)).not.toBe(full(FIRST_BASE));
      expect(
        git("merge-base", "--is-ancestor", FIRST_BASE, BASE),
        "the branch's base is older than the first base",
      ).not.toBeNull();
    },
  );

  test.skipIf(!onBranch)(
    "every file this build changed has its owner, and nothing else changed",
    () => {
      const changed = new Set([
        ...lines(git("diff", "--name-only", BASE)),
        ...lines(git("ls-files", "--others", "--exclude-standard")),
      ]);
      expect(changed.size).toBeGreaterThan(0);
      const owned = new Set(OWNERS.map(o => o.file));
      const unowned = [...changed]
        .filter(
          f => !owned.has(f) && !UNTRACKED_EVIDENCE.some(p => f.startsWith(p)),
        )
        .sort();
      expect(unowned).toEqual([]);
    },
  );

  test.skipIf(!onBranch)(
    "the files a builder may only add to lose no line",
    () => {
      // numstat: "<added>\t<removed>\t<path>" for each changed file.
      const removed = lines(git("diff", "--numstat", BASE, "--", ...ADD_ONLY))
        .map(l => l.split("\t"))
        .filter(([, minus]) => minus !== "0")
        .map(([, minus, path]) => `${path}: ${minus} lines removed`);
      expect(removed).toEqual([]);
    },
  );

  test.skipIf(!onBranch)("no earlier migration changed", () => {
    const migrations = lines(
      git("diff", "--name-only", BASE, "--", "supabase/migrations"),
    );
    const ours = new Set(
      OWNERS.filter(o => o.file.startsWith("supabase/migrations/")).map(
        o => o.file,
      ),
    );
    expect(migrations.filter(f => !ours.has(f))).toEqual([]);
  });
});
