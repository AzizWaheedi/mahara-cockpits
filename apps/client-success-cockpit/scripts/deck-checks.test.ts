import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

/**
 * The client decks' build checks, as tests: the files copied from the sales
 * deck are still the same bytes (scripts/check-shared.sh), and the app
 * typechecks with the deck in it (src has no bun types, so tsc is run).
 */

const app = resolve(import.meta.dir, "..");
const repo = resolve(app, "../..");

const run = (cmd: string[], cwd: string) => {
  const r = Bun.spawnSync(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  return {
    code: r.exitCode,
    out: `${r.stdout.toString()}${r.stderr.toString()}`,
  };
};

describe("build checks", () => {
  test("the copied deck parts match the sales deck's", () => {
    const r = run(["bash", "scripts/check-shared.sh"], repo);
    expect(r.out).not.toContain("DRIFTED  deck");
    expect(r.out).not.toContain("MISSING  deck");
    expect(r.code).toBe(0);
    // bash on Windows takes longer than the 5 second default.
  }, 60_000);

  test("the app typechecks", () => {
    const r = run(
      ["bun", "run", "tsc", "--project", "tsconfig.app.json", "--noEmit"],
      app,
    );
    expect(r.out.trim()).toBe("");
    expect(r.code).toBe(0);
    // Shared build hosts can be CPU-bound. Keep the complete compiler check,
    // with a finite ceiling, rather than killing a valid check after two minutes.
  }, 600_000);
});
