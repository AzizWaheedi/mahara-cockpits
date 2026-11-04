// node --test scripts/check-installs.test.mjs
// Fake folders with fake packages: complete, missing a file, cut short, not
// installed, and one that needs a browser (not a broken install).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const script = join(dirname(fileURLToPath(import.meta.url)), "check-installs.mjs");
const root = mkdtempSync(join(tmpdir(), "check-installs-"));
after(() => rmSync(root, { recursive: true, force: true }));

function app(name, deps, packages) {
  const dir = join(root, name);
  mkdirSync(join(dir, "node_modules"), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name, dependencies: deps }));
  for (const [pkg, files] of Object.entries(packages)) {
    const at = join(dir, "node_modules", pkg);
    mkdirSync(at, { recursive: true });
    for (const [file, body] of Object.entries(files)) {
      mkdirSync(dirname(join(at, file)), { recursive: true });
      writeFileSync(join(at, file), body);
    }
  }
  return dir;
}
const esm = (main) => JSON.stringify({ name: "x", type: "module", exports: { ".": main } });
const run = (...dirs) => spawnSync(process.execPath, [script, ...dirs], { encoding: "utf8" });

const whole = {
  "whole-pkg": { "package.json": esm("./index.js"), "index.js": 'export * from "./_lib/a.js";', "_lib/a.js": "export const a = 1;" },
  "needs-browser": { "package.json": esm("./index.js"), "index.js": "window.document.title;" },
};

test("a complete install passes", () => {
  const dir = app("good", { "whole-pkg": "1", "needs-browser": "1", "@types/node": "1" }, whole);
  const done = run(dir);
  assert.equal(done.status, 0, done.stdout);
  assert.match(done.stdout, /2 checked in 1 folders, none broken/);
});

test("a package missing one of its files is named with the file", () => {
  const dir = app("hollow", { "hollow-pkg": "1" }, {
    "hollow-pkg": { "package.json": esm("./index.js"), "index.js": 'export * from "./_lib/defaultOptions.js";' },
  });
  const done = run(dir);
  assert.equal(done.status, 1);
  assert.match(done.stdout, /hollow-pkg is incomplete \(missing file .*defaultOptions\.js\)/);
  assert.match(done.stdout, /--backend=copyfile/);
});

test("a file cut short is named", () => {
  const dir = app("cut", { "cut-pkg": "1" }, {
    "cut-pkg": { "package.json": esm("./index.js"), "index.js": "export const a = {" },
  });
  const done = run(dir);
  assert.equal(done.status, 1);
  assert.match(done.stdout, /cut-pkg is incomplete \(unreadable file/);
});

test("a package that is not installed points to prepare-worktree", () => {
  const dir = app("absent", { "absent-pkg": "1", "whole-pkg": "1" }, whole);
  const done = run(dir);
  assert.equal(done.status, 1);
  assert.match(done.stdout, /absent-pkg is not installed/);
  assert.match(done.stdout, /prepare-worktree\.sh --apply/);
});

test("every broken folder is listed in one run", () => {
  const a = app("two-a", { "absent-pkg": "1" }, {});
  const b = app("two-b", { "hollow-pkg": "1" }, {
    "hollow-pkg": { "package.json": esm("./index.js"), "index.js": 'import "./gone.js";' },
  });
  const done = run(a, b);
  assert.equal(done.status, 1);
  assert.match(done.stdout, /2 broken/);
  assert.match(done.stdout, /two-a: absent-pkg is not installed/);
  assert.match(done.stdout, /two-b: hollow-pkg is incomplete/);
});
