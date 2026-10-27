/**
 * Stage 1's file ownership (docs/forms/STAGE1-CONTRACT.md section 8: "A file
 * not listed is not changed"). Every file this branch changes since it left
 * main, committed or not, must be in that table. Other sessions work on main
 * in other worktrees, so an unlisted edit (the Links page's Card details form,
 * removed here once by mistake) would ship with whoever ships that app next.
 *
 * It reads git only (never writes). Where there is no git, or no origin/main
 * to measure from, it says so and skips. It also skips once Stage 1 is on
 * main, or on a branch that does not carry it (the notices migration is not
 * among the changes): there the changes are some other session's, and an
 * empty diff on a clean main is not a failure.
 *
 * Run: cd apps/media-buyer-cockpit && bun test scripts/stage1-ownership.test.ts
 */
import { expect, test } from "bun:test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../../..");

function git(args: string[]): string | null {
  try {
    const out = Bun.spawnSync(["git", ...args], {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    return out.exitCode === 0 ? out.stdout.toString() : null;
  } catch {
    return null;
  }
}

/** The owned paths: exact files, and directory prefixes for `dir/*` and `dir/`. */
export function ownedPaths(
  contract: string,
  exists: (p: string) => boolean,
): { files: Set<string>; dirs: string[] } {
  const start = contract.indexOf("## 8. File ownership");
  const end = contract.indexOf("## 9.", start);
  if (start < 0 || end < 0)
    throw new Error("STAGE1-CONTRACT.md has no section 8 to read.");
  const files = new Set<string>();
  const dirs: string[] = [];
  for (const line of contract.slice(start, end).split("\n")) {
    if (!line.startsWith("| `")) continue;
    const cell = line.split("|")[1] ?? "";
    let base = "";
    for (const [, token] of cell.matchAll(/`([^`]+)`/g)) {
      if (!/[./]/.test(token)) continue; // a function name, not a path
      const bare = token.replace(/\*$/, "");
      // A path from the repository root, else one relative to the row's last
      // full path (or a folder above it): `form-panel.test.tsx`, `src/dev/`.
      let path = exists(bare) ? bare : "";
      if (!path) {
        for (let dir = base; ; dir = dirname(dir)) {
          const cand = join(dir, bare);
          if (exists(cand)) {
            path = cand;
            break;
          }
          if (!dir || dir === "." || dir === "/") break;
        }
      }
      if (!path) path = join(base, bare);
      if (token.endsWith("/") || token.endsWith("/*"))
        dirs.push(path.replace(/\/?$/, "/"));
      else files.add(path);
      base =
        token.endsWith("/") || token.endsWith("/*")
          ? path.replace(/\/$/, "")
          : dirname(path);
    }
  }
  return { files, dirs };
}

const base = git(["merge-base", "HEAD", "origin/main"])?.trim() ?? "";
const changed = base
  ? [
      ...(git(["diff", "--name-only", base]) ?? "").split("\n"),
      ...(git(["ls-files", "--others", "--exclude-standard"]) ?? "").split(
        "\n",
      ),
    ]
      .map(s => s.trim())
      .filter(Boolean)
  : [];
// Stage 1 is unmerged here only while its notices migration is a change.
const carriesStage1 = changed.includes(
  "supabase/migrations/20261025n_slack_notices.sql",
);

test.skipIf(!carriesStage1)(
  "every file Stage 1 changes is in the contract's ownership table",
  () => {
    expect(changed.length).toBeGreaterThan(0);
    const exists = (p: string) => {
      const full = join(ROOT, p);
      return (
        existsSync(full) &&
        (statSync(full).isFile() || statSync(full).isDirectory())
      );
    };
    const { files, dirs } = ownedPaths(
      readFileSync(join(ROOT, "docs/forms/STAGE1-CONTRACT.md"), "utf8"),
      exists,
    );
    const unowned = changed.filter(
      p => !files.has(p) && !dirs.some(d => p.startsWith(d)),
    );
    expect(unowned).toEqual([]);
  },
);

test("the table reader resolves a row's short names against its full path", () => {
  const contract = [
    "## 8. File ownership",
    "| File | Owner |",
    "|---|---|",
    "| `apps/x/scripts/a.test.ts`, `b.test.ts` | screens |",
    "| `apps/x/src/pages/P.tsx` (new), `src/pages/index.ts` | screens |",
    "| `hermes/g/checks/q.py`, `checks/e.py`, `README.md` | docs |",
    "| `apps/x/src/dev/h.tsx` and new files under `src/dev/` | screens |",
    "| `supabase/functions/n/*` (all new: `index.ts`, `deno.json`) | fn |",
    "| `supabase/functions/t.ts` (append `slackTools`) | fn |",
    "## 9. Tests",
  ].join("\n");
  const real = new Set([
    "apps/x/scripts/a.test.ts",
    "apps/x/scripts/b.test.ts",
    "apps/x/src/pages/P.tsx",
    "apps/x/src/pages/index.ts",
    "hermes/g/checks/q.py",
    "hermes/g/checks/e.py",
    "hermes/g/README.md",
    "apps/x/src/dev/h.tsx",
    "apps/x/src/dev",
    "supabase/functions/n",
    "supabase/functions/t.ts",
  ]);
  const { files, dirs } = ownedPaths(contract, p =>
    real.has(p.replace(/\/$/, "")),
  );
  for (const p of [
    "apps/x/scripts/b.test.ts",
    "apps/x/src/pages/index.ts",
    "hermes/g/checks/e.py",
    "hermes/g/README.md",
    "supabase/functions/t.ts",
  ])
    expect(files.has(p)).toBe(true);
  expect(dirs).toEqual(
    expect.arrayContaining(["apps/x/src/dev/", "supabase/functions/n/"]),
  );
  expect(files.has("apps/x/src/lib/csmLinks.ts")).toBe(false);
});
