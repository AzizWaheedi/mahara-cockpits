/**
 * Requests and task alerts: every file this build changes has exactly one
 * owner (docs/requests/CONTRACT.md section 8), and nothing else changed.
 *
 * It reads git: the files changed since the build's base (main 86ee4e84)
 * plus the untracked ones. It runs only on the build's own branch
 * (tickets-1026), before the build is committed onto main; on any other
 * checkout it is skipped, because later commits on main are not this
 * build's. Not in scripts/ship.sh for that reason.
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const BASE = "86ee4e84";
const BRANCH = "tickets-1026";

function git(...args: string[]): string | null {
  const out = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  return out.status === 0 ? out.stdout : null;
}
const onBranch =
  git("rev-parse", "--abbrev-ref", "HEAD")?.trim() === BRANCH &&
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
  ].map(f => `supabase/functions/clickup-writeback/${f}`),
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
      "dev/tasksHarness.ts",
    ].map(f => `apps/media-buyer-cockpit/src/${f}`),
    ...[
      "components/AppLayout.tsx",
      "components/AppSidebar.tsx",
      "pages/CsmPage.tsx",
      "pages/ClientPerformancePage.tsx",
      "pages/NoticesPage.tsx",
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
