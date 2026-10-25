import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { FORM_CONFIGS, formConfig, KICKOFF } from "../src/forms/kickoff";

/**
 * The form panel's contract, split for reuse (docs/csm-forms/KICKOFF.md 2
 * and 2.6, 2026-10-22): formConfig.ts holds types only, kickoff.ts holds
 * the kickoff's config and the registry, and the core's imports from the
 * rest of the app are exactly the ones KICKOFF.md 2.6 lists, so the
 * creative director cockpit knows what to bring when it copies the core.
 *
 * Run: bun test scripts/form-contract.test.ts
 */

const app = resolve(import.meta.dir, "..");
const read = (p: string) => readFileSync(resolve(app, p), "utf8");

const CORE = [
  "src/forms/formConfig.ts",
  "src/forms/useFormPanel.ts",
  "src/forms/FormPanel.tsx",
  "src/forms/formStatus.ts",
  "src/forms/formTime.ts",
  "src/forms/prefill.ts",
];
const LOCAL = new Set(
  CORE.map(
    p =>
      `./${p
        .split("/")
        .at(-1)
        ?.replace(/\.tsx?$/, "")}`,
  ),
);

/** Every module a file imports, static or on demand. */
function imports(src: string): string[] {
  const out = new Set<string>();
  for (const m of src.matchAll(/(?:from|import)\s*\(?\s*"([^"]+)"/g))
    out.add(m[1] as string);
  return [...out];
}

describe("formConfig.ts is the contract, types only", () => {
  const src = read("src/forms/formConfig.ts");

  test("every import is a type import", () => {
    const lines = src.split("\n").filter(l => /^import\b/.test(l));
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l).toMatch(/^import type /);
  });

  test("it exports no value: no const, function, class, enum or default", () => {
    expect(src).not.toMatch(
      /^export\s+(?:const|let|var|function|async|class|enum|default)\b/m,
    );
    expect(src).toMatch(/^export interface FormConfig\b/m);
    expect(src).toMatch(/^export interface FormContext\b/m);
  });

  test("the kickoff's form lives in kickoff.ts, not in the contract", () => {
    // Its doc comments quote the kickoff's words as examples; its code
    // names no form.
    expect(src).not.toContain("tG7dnxBn");
    expect(read("src/forms/kickoff.ts")).toContain("FORMS.kickoff");
  });
});

describe("kickoff.ts holds the config and the registry", () => {
  test("the registry opens the kickoff and nothing it does not configure", () => {
    expect(FORM_CONFIGS.kickoff).toBe(KICKOFF);
    expect(formConfig("kickoff")).toBe(KICKOFF);
    expect(formConfig("blueprint")).toBeNull();
    expect(formConfig("checkin")).toBeNull();
    expect(formConfig("toString")).toBeNull();
    expect(formConfig(undefined)).toBeNull();
  });

  test("the kickoff is the same object as before the split", () => {
    expect(KICKOFF.key).toBe("kickoff");
    expect(KICKOFF.formId).toBe("tG7dnxBn");
    expect(KICKOFF.idField).toBe("onboarding_client_id");
    expect(KICKOFF.ending).toEqual({
      book: "blueprint",
      label: "Book the Brand Blueprint call",
    });
    expect(KICKOFF.after.checksAtSec).toEqual([45, 120, 300]);
    expect(KICKOFF.after.linkBack?.key).toBe("blueprint_form");
  });
});

describe("the kickoff's words tell the truth (docs/forms/PLAN.md S9, S10)", () => {
  test("after the send: Make updates the card, the CSM books the call, the team hears in Slack", () => {
    expect(KICKOFF.after.say).toBe(
      "Kickoff sent. Make is updating the card. Book the Brand Blueprint call below.",
    );
    expect(KICKOFF.after.sub).toBe(
      "The team hears in #csm-general once the card is updated.",
    );
    expect(KICKOFF.again).toBe(
      "a second Kickoff Handoff comment, a second Technical and Creative task and a second WhatsApp to the client's group",
    );
    expect(KICKOFF.makeDoes).toEqual([
      "The Kickoff Handoff comment, with every answer, on the client's ClickUp card.",
      "A Technical Onboarding task and a Creative Onboarding task.",
      "The Brand Blueprint link on the card, and the card at Brand Blueprint Booked.",
      "The Onboarding Map at phase 4.",
      "The phase 4 WhatsApp to the client's group.",
    ]);
    const all = [KICKOFF.after.say, KICKOFF.after.sub, ...KICKOFF.makeDoes];
    for (const line of all) {
      expect(line).not.toMatch(/booking the Brand Blueprint|Make 06|summary/);
      expect(line).not.toMatch(/[!—]/);
    }
  });

  test("the trail's last link opens the cockpit's own Blueprint; the old Typeform is gone", () => {
    const back = KICKOFF.after.linkBack;
    expect(back).toMatchObject({
      key: "blueprint_form",
      label: "The card has the Brand Blueprint link",
      pending: "Make adds the Brand Blueprint link to the card",
      short: "the Blueprint link",
      open: "Open the Brand Blueprint",
    });
    expect(back?.href?.("86fixture1")).toBe(
      "/client-success/clients/86fixture1/present/blueprint?view=prep",
    );
    expect(read("src/forms/kickoff.ts")).not.toContain("oYZKtogO");
    expect(KICKOFF.after.notice).toEqual({
      kind: "kickoff",
      pending: "The team hears in #csm-general",
      line: "Once Make has updated the card, usually within a few minutes.",
    });
  });
});

describe("the core's dependencies are the ones KICKOFF.md 2.6 lists", () => {
  const doc = read("../../docs/csm-forms/KICKOFF.md");
  const section =
    doc.match(
      /#### The core's dependencies on the client success app([\s\S]*?)\n### /,
    )?.[1] ?? "";
  const imported = new Set(
    CORE.flatMap(p => imports(read(p))).filter(m => !LOCAL.has(m)),
  );

  test("the section is there, with its two tables", () => {
    expect(section).toContain("| Import |");
    expect(section).toContain("| Class or token |");
  });

  test("each import the core makes is listed, and each listed one is made", () => {
    const listed = new Set(
      [...section.matchAll(/^\| `([^`]+)` \|/gm)]
        .map(m => m[1] as string)
        .filter(m => !/^(?:txt-|text-|animate-)/.test(m)),
    );
    expect([...imported].sort()).toEqual([...listed].sort());
  });

  test("the core reaches nothing of the decks or the kickoff's own files but the one type", () => {
    for (const m of imported) {
      expect(m).not.toMatch(
        /^\.\/(?:kickoff|formRail|formClient|useLiveForm|FormWindow|OpenFormButton|useFormSend)$/,
      );
      if (m.startsWith("@/present/")) expect(m).toBe("@/present/sources");
    }
    // ...and that one is a type: nothing of the deck runs inside the panel.
    for (const p of CORE)
      for (const l of read(p).split("\n"))
        if (l.includes('"@/present/')) expect(l).toMatch(/^import type /);
  });

  test("each of the cockpit's own classes the panel uses is listed and defined", () => {
    const panel = read("src/forms/FormPanel.tsx");
    const css = read("src/index.css");
    for (const c of [
      "txt-warn",
      "txt-good",
      "callout-warn",
      "glow-teal",
      "no-marker",
    ]) {
      expect(panel).toContain(c);
      expect(section).toContain(c);
      expect(css).toContain(`.${c}`);
    }
    expect(css).toContain("--primary-ink");
    expect(css).toContain('@import "tw-animate-css"');
  });
});
