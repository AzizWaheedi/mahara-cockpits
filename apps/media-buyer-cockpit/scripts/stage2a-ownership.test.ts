/**
 * Stage 2a's file ownership (docs/forms/STAGE2-CONTRACT.md section 10, "A file
 * not listed is not changed", and A7.11): every file this build changes has
 * exactly one owner, and nothing else changed. Other sessions work on main in
 * other worktrees, so an unlisted edit would ship with whoever ships that app
 * next.
 *
 * It reads git only (never writes): the files changed since the build's base,
 * committed or not, plus the untracked ones. The base is where the branch
 * leaves main (the merge-base with origin/main, b642283b when the build
 * began), so main's own commits are never counted as this build's. It runs only
 * on the build's own branch (stage2a-1028); on any other checkout it is
 * skipped. Not in scripts/ship.sh for that reason.
 *
 * It also holds the committed room fixture to section 5.3 test 11: every value
 * in hermes/csm-calls/rooms.cases.json is invented, so no passcode but TEST
 * and no Meet code outside the allow-list (a real link with its passcode lets
 * anyone into the CSM's or a client's room).
 *
 * Run: cd apps/media-buyer-cockpit && bun test scripts/stage2a-ownership.test.ts
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const BRANCH = "stage2a-1028";

function git(...args: string[]): string | null {
  const out = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  return out.status === 0 ? out.stdout : null;
}
const BASE = git("merge-base", "HEAD", "origin/main")?.trim() || "b642283b";
const onBranch =
  git("rev-parse", "--abbrev-ref", "HEAD")?.trim() === BRANCH &&
  git("cat-file", "-e", `${BASE}^{commit}`) !== null;

const under = (dir: string, files: string[]) => files.map(f => `${dir}/${f}`);
const CS_APP = "apps/client-success-cockpit";
const MB_APP = "apps/media-buyer-cockpit";
const CSM_CALLS = "hermes/csm-calls";
const GUARDIAN = "hermes/cockpit-guardian";

/** Section 10's table, by role. A path ending in "/" owns everything under it (the table's `dir/*`). */
const OWNERS: Record<string, string[]> = {
  db: [
    "supabase/migrations/20261027f_forms_core.sql",
    "supabase/migrations/20261027g_fathom_intake.sql",
    `${MB_APP}/scripts/forms-core-supabase.test.ts`,
    `${MB_APP}/scripts/fathom-intake-supabase.test.ts`,
  ],
  parity: [
    "supabase/migrations/20261027h_checkin_plans.sql",
    ...under(`${MB_APP}/scripts`, [
      "checkin-plans-supabase.test.ts",
      "checkin-replay.ts",
      "checkin-replay.test.ts",
      "fixtures/checkin-replay-picks.json",
    ]),
    // The new section, the new block and one line only (checked below).
    "RUNBOOK.md",
    "scripts/ship.sh",
    "scripts/verify-cutover-readiness.py",
    "docs/csm-forms/KICKOFF.md",
  ],
  fathom: [
    ...under(CSM_CALLS, [
      "fathomRules.ts",
      "fathomRules.test.ts",
      "lib.ts",
      "lib.test.ts",
      "sources.ts",
      "sources.test.ts",
      "match.ts",
      "match.test.ts",
      "worker.ts",
      "RUNBOOK.md",
      "rollback/2cacdca5.patch",
      "rollback.test.ts",
    ]),
    "scripts/dev/forms_key.py",
    "scripts/dev/test_forms_key.py",
    // index.ts, verify.ts, handler.ts, testkit.ts, deno.json, README.md and their tests.
    "supabase/functions/fathom-webhook/",
    ...under(GUARDIAN, [
      "checks/csm_calls.py",
      "checks/edge_functions.py",
      "README.md",
      "tests/test_checks_data.py",
      "tests/test_csm_calls.py",
    ]),
  ],
  "forms-api": [
    ...under(CSM_CALLS, [
      "callMatch.ts",
      "callMatch.test.ts",
      "rooms.cases.json",
    ]),
    // 6.1's files, with prompts/, todos.ts, typeform.ts and their tests.
    "supabase/functions/cockpit-forms-api/",
    // fathomTools appended only (checked below).
    "supabase/functions/cockpit-csm-api/tools.ts",
    "supabase/functions/cockpit-media-api/model.ts",
    "supabase/functions/cockpit-media-api/model.test.ts",
  ],
  screens: [
    ...under(`${CS_APP}/src/forms`, [
      "checkinForm.ts",
      "fieldSaver.ts",
      "checkinClient.ts",
      "useCheckin.ts",
      "CheckinWindow.tsx",
      "CheckinCall.tsx",
      "CheckinFields.tsx",
      "CheckinRecap.tsx",
      "checkinTrail.ts",
      "checkinRail.ts",
      "FormWindow.tsx",
      "FormPanel.tsx",
      "OpenFormButton.tsx",
    ]),
    ...under(`${CS_APP}/src`, [
      "lib/formsRegistry.ts",
      "components/FormsButton.tsx",
      "components/AfterCalls.tsx",
      "pages/CsmPage.tsx",
      "components/kit.tsx",
      "lib/csmCalls.ts",
      "components/CommandPalette.tsx",
      "components/ClientCalls.tsx",
      "dev/checkinFixtures.ts",
      "dev/checkinHarness.tsx",
      "dev/checkin-harness.html",
    ]),
    ...under(`${CS_APP}/scripts`, [
      "checkin-form.test.ts",
      "field-saver.test.ts",
      "checkin-trail.test.ts",
      "checkin-window.test.tsx",
      "after-calls.test.tsx",
      "forms-button.test.tsx",
      "client-calls.test.tsx",
      "csm-page.test.tsx",
    ]),
    ...under(MB_APP, [
      "src/pages/ceo/FormsConnections.tsx",
      "src/lib/formsKeysClient.ts",
      "src/pages/ceo/ClientSuccessTab.tsx",
      "scripts/forms-connections.test.tsx",
    ]),
  ],
  orchestrator: [
    ...under(`${MB_APP}/scripts`, [
      "stage2a-fit-supabase.test.ts",
      "stage2a-ownership.test.ts",
      // A7.11.
      "stage2a-writers.test.ts",
    ]),
    "docs/forms/STAGE2-CONTRACT.md",
    // Evidence on this Mac, not tracked.
    "notes/stage2/",
  ],
};
/** Files a builder may only add to: RUNBOOK's new section, ship.sh's block, KICKOFF's line, tools.ts's fathomTools. */
const ADD_ONLY = [
  "RUNBOOK.md",
  "scripts/ship.sh",
  "docs/csm-forms/KICKOFF.md",
  "supabase/functions/cockpit-csm-api/tools.ts",
];

const lines = (out: string | null) =>
  (out ?? "")
    .split("\n")
    .map(s => s.trim())
    .filter(Boolean);

describe("file ownership (contract section 10 and A7.11)", () => {
  test("no file has two owners", () => {
    const seen = new Map<string, string>();
    for (const [role, files] of Object.entries(OWNERS))
      for (const f of files) {
        expect(
          seen.get(f),
          `${f} is listed for ${seen.get(f)} and ${role}`,
        ).toBeUndefined();
        seen.set(f, role);
      }
    // A folder owned whole holds no file another role owns.
    const all = [...seen];
    for (const [dir, role] of all.filter(([p]) => p.endsWith("/")))
      expect(
        all.filter(([p, r]) => p !== dir && p.startsWith(dir) && r !== role),
      ).toEqual([]);
  });

  test.skipIf(!onBranch)(
    "every file this build changed has its owner, and nothing else changed",
    () => {
      const changed = new Set([
        ...lines(git("diff", "--name-only", BASE)),
        ...lines(git("ls-files", "--others", "--exclude-standard")),
      ]);
      expect(changed.size).toBeGreaterThan(0);
      const owned = Object.values(OWNERS).flat();
      const owns = (f: string) =>
        owned.some(o => (o.endsWith("/") ? f.startsWith(o) : f === o));
      expect([...changed].filter(f => !owns(f)).sort()).toEqual([]);
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
});

describe("the room fixture (section 5.3 test 11)", () => {
  const rooms = readFileSync(`${ROOT}${CSM_CALLS}/rooms.cases.json`, "utf8");
  const ALLOWED = ["abc-defg-hij", "kln-opqr-stu", "vwx-yzab-cde"];

  test("holds no passcode but TEST", () => {
    const passcodes = [...rooms.matchAll(/pwd=([^&"#\s]*)/gi)].map(m => m[1]);
    expect(passcodes.length).toBeGreaterThan(0);
    expect(passcodes.filter(p => p !== "TEST")).toEqual([]);
  });

  test("holds no Meet code outside the allow-list", () => {
    const codes = [...rooms.matchAll(/\b[a-z]{3}-[a-z]{4}-[a-z]{3}\b/gi)].map(
      m => m[0].toLowerCase(),
    );
    expect(codes.length).toBeGreaterThan(0);
    expect(codes.filter(c => !ALLOWED.includes(c))).toEqual([]);
  });
});
