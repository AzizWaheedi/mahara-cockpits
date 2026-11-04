/**
 * Requests and task alerts: every file this build changes has exactly one
 * owner (docs/requests/CONTRACT.md section 8), and nothing else changed.
 *
 * It reads git: the files changed since the build's base plus the untracked
 * ones. The base is where the branch leaves main (the merge-base with
 * origin/main: 86ee4e84 when the build began, 3f9f5c41 after the rebase of
 * 2026-10-26; b642283b for the department map round), so main's own commits
 * are never counted as this build's. It runs only on a build branch of this
 * contract (tickets-1026, then tickets-look-1028), before that build is
 * committed onto main; on any other checkout it is skipped. Not in
 * scripts/ship.sh for that reason.
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
// Each build branch, with the base to use if git cannot find the merge-base.
const BRANCHES: Record<string, string> = {
  "tickets-1026": "3f9f5c41",
  // The department map round (2026-10-28), from origin/main b642283b.
  "tickets-look-1028": "b642283b",
};

function git(...args: string[]): string | null {
  const out = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  return out.status === 0 ? out.stdout : null;
}
const BRANCH = git("rev-parse", "--abbrev-ref", "HEAD")?.trim() ?? "";
const BASE =
  git("merge-base", "HEAD", "origin/main")?.trim() ||
  BRANCHES[BRANCH] ||
  "3f9f5c41";
const onBranch =
  Object.hasOwn(BRANCHES, BRANCH) &&
  git("cat-file", "-e", `${BASE}^{commit}`) !== null;

const APPS = [
  "media-buyer-cockpit",
  "client-success-cockpit",
  "creative-director-cockpit",
  "video-editor-cockpit",
  "sales-cockpit",
];
const inAll = (paths: string[]) =>
  APPS.flatMap(app => paths.map(p => `apps/${app}/${p}`));

const OWNERS: Record<string, string[]> = {
  db: [
    "supabase/migrations/20261026r_requests.sql",
    "supabase/migrations/20261026s_request_types_seed.sql",
    "scripts/gen-request-types-seed.ts",
    "apps/media-buyer-cockpit/scripts/requests-supabase.test.ts",
    "apps/media-buyer-cockpit/scripts/request-types-seed.test.ts",
    // tickets-look-1028 (2026-10-28): every seat reads each part's runs-when
    // choices and SOP steps in cockpit_request_types_read.
    "supabase/migrations/20261028a_request_types_read_routes.sql",
    "apps/media-buyer-cockpit/scripts/request-routes-supabase.test.ts",
  ],
  writer: [
    "index.ts",
    "run.ts",
    "run.test.ts",
    "rules.ts",
    "rules.test.ts",
    "requests.ts",
    "taskActions.ts",
    "requestsTestkit.ts",
    "requests.test.ts",
    "taskActions.test.ts",
    // Review R1 (2026-10-26): the writer's fixes, proven in their own file.
    "reviewR1.test.ts",
  ]
    .map(f => `supabase/functions/clickup-writeback/${f}`)
    // Retest round 2: the comment watch never digests the writer's own card
    // comments (a request's link comment, any Cockpit ref).
    .concat(
      ["watch.ts", "watch.test.ts"].map(
        f => `supabase/functions/comment-watch/${f}`,
      ),
    ),
  "mirror-alerts": [
    "supabase/migrations/20261026t_task_alerts.sql",
    "apps/media-buyer-cockpit/scripts/task-alerts-supabase.test.ts",
    ...[
      "index.ts",
      "door.ts",
      "delta.ts",
      "seats.ts",
      "detail.ts",
      "doctor.ts",
      "clickup.ts",
      "testkit.ts",
      "deno.json",
      "README.md",
      "door.test.ts",
      "delta.test.ts",
      "seats.test.ts",
      "detail.test.ts",
    ].map(f => `supabase/functions/cockpit-tasks/${f}`),
    ...["queues.py", "sections.py", "pg_cron.py", "edge_functions.py"].map(
      f => `hermes/cockpit-guardian/checks/${f}`,
    ),
    "hermes/cockpit-guardian/tests/test_checks_data.py",
    // "any other guardian test whose counts change" (section 8)
    "hermes/cockpit-guardian/tests/test_hiring_sync.py",
    "RUNBOOK.md",
    "scripts/ship.sh",
  ],
  "portal-screens": [
    ...inAll([
      "src/lib/requestsCore.ts",
      "src/lib/requestsClient.ts",
      "src/components/tasks/RequestForm.tsx",
      "src/components/tasks/requests.css",
    ]),
    ...[
      "RequestsPage.tsx",
      "RequestsSettings.tsx",
      "RequestRow.tsx",
      "RequestPanel.tsx",
      "TypeEditor.tsx",
      "SeatLinks.tsx",
      "AlertRules.tsx",
    ].map(f => `apps/media-buyer-cockpit/src/pages/requests/${f}`),
    "apps/media-buyer-cockpit/src/lib/requestsAdmin.ts",
    "apps/media-buyer-cockpit/src/auth/authenticated/AuthenticatedAppRoutes.tsx",
    "apps/media-buyer-cockpit/src/dev/requestsHarness.ts",
    "apps/media-buyer-cockpit/src/dev/harness.tsx",
    ...[
      "requests-core.test.ts",
      "request-form.test.tsx",
      "requests-page.test.tsx",
      "requests-settings.test.tsx",
    ].map(f => `apps/media-buyer-cockpit/scripts/${f}`),
    // tickets-look-1028 (2026-10-28): IBM Plex Sans Arabic follows Geist in
    // --font-sans, for Arabic client names on requests and tasks, as in the
    // other three apps; the media buyer app also loads it now (client
    // success already did, in index.html).
    "apps/client-success-cockpit/src/index.css",
    "apps/media-buyer-cockpit/src/index.css",
  ],
  "cockpit-screens": [
    ...inAll([
      "src/lib/tasksCore.ts",
      "src/lib/tasksClient.ts",
      "src/components/tasks/TaskPanel.tsx",
      "src/components/tasks/YourTasks.tsx",
      "src/components/tasks/AlertsBell.tsx",
      "src/components/tasks/TaskFocus.tsx",
      "src/components/tasks/tasks.css",
      "src/lib/taskSeat.ts",
      "src/lib/cockpits.ts",
    ]),
    ...[
      "components/AppLayout.tsx",
      "components/AppSidebar.tsx",
      "components/MobileTabBar.tsx",
      "components/CommandPalette.tsx",
      "components/launch/ClientAlerts.tsx",
      "pages/CockpitPage.tsx",
      "pages/team/TeamPage.tsx",
      "pages/AdminPage.tsx",
      // Review R1, ask F13: the CEO's /ceo Today tab has Your tasks.
      "pages/ceo/TodayTab.tsx",
      "dev/tasksHarness.ts",
    ].map(f => `apps/media-buyer-cockpit/src/${f}`),
    ...[
      "components/AppLayout.tsx",
      "components/AppSidebar.tsx",
      "pages/CsmPage.tsx",
      "pages/ClientPerformancePage.tsx",
      "pages/NoticesPage.tsx",
      // Review R1, ask F6: the old Ask a team stays until requests are open for that client.
      "lib/requestsOpen.ts",
    ].map(f => `apps/client-success-cockpit/src/${f}`),
    ...[
      "components/AppLayout.tsx",
      "components/AppSidebar.tsx",
      "pages/DashboardPage.tsx",
    ].map(f => `apps/creative-director-cockpit/src/${f}`),
    ...[
      "App.tsx",
      "pages/JobsPage.tsx",
      "components/Sidebar.tsx",
      "components/SearchBox.tsx",
    ].map(f => `apps/video-editor-cockpit/src/${f}`),
    ...[
      "App.tsx",
      "pages/TodayPage.tsx",
      "components/Sidebar.tsx",
      "components/SearchBox.tsx",
      "components/MacOSMenuBar.tsx",
    ].map(f => `apps/sales-cockpit/src/${f}`),
    "scripts/check-shared.sh",
    "apps/media-buyer-cockpit/scripts/tasks-core.test.ts",
    "apps/media-buyer-cockpit/scripts/your-tasks.test.tsx",
    "apps/media-buyer-cockpit/scripts/sections.e2e.ts",
    "apps/client-success-cockpit/scripts/csm-page.test.tsx",
  ],
  orchestrator: [
    "docs/requests/CONTRACT.md",
    "docs/requests/request-types.json",
    ...[
      "alerts-and-tasks.md",
      "today-and-shell.md",
      "types-and-sops.md",
      "writers.md",
    ].map(f => `docs/requests/maps/${f}`),
    "apps/media-buyer-cockpit/scripts/requests-ownership.test.ts",
    "apps/media-buyer-cockpit/scripts/requests-fit-supabase.test.ts",
    // The round 1 review's findings and verdicts, and the forms handover.
    "docs/requests/REVIEW-R1-raw.txt",
    "docs/forms/HANDOVER.md",
  ],
};

describe("file ownership (contract section 8)", () => {
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
  });

  test.skipIf(!onBranch)(
    "every file this build changed has its owner, and nothing else changed",
    () => {
      const changed = new Set(
        [
          ...(git("diff", "--name-only", BASE) ?? "").split("\n"),
          ...(git("ls-files", "--others", "--exclude-standard") ?? "").split(
            "\n",
          ),
        ]
          .map(s => s.trim())
          .filter(Boolean),
      );
      const owned = new Set(Object.values(OWNERS).flat());
      expect([...changed].filter(f => !owned.has(f)).sort()).toEqual([]);
    },
  );

  test("the eleven shared files are present in all five apps", () => {
    const shared = [
      "src/lib/tasksCore.ts",
      "src/lib/tasksClient.ts",
      "src/components/tasks/TaskPanel.tsx",
      "src/components/tasks/YourTasks.tsx",
      "src/components/tasks/AlertsBell.tsx",
      "src/components/tasks/TaskFocus.tsx",
      "src/components/tasks/tasks.css",
      "src/lib/requestsCore.ts",
      "src/lib/requestsClient.ts",
      "src/components/tasks/RequestForm.tsx",
      "src/components/tasks/requests.css",
    ];
    const missing = inAll(shared).filter(f => !Bun.file(`${ROOT}${f}`).size);
    expect(missing).toEqual([]);
  });
});
