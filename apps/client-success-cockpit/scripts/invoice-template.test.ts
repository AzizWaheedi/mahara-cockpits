import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  day,
  fillInvoice,
  type InvoiceDraft,
  money,
  normalizeTemplate,
} from "../src/lib/invoiceTemplate";

/**
 * The preview beside the invoice form must be the PDF the worker prints:
 * the same template bytes and the same fill, checked against the worker's
 * golden cases (hermes/invoice-desk/tests/golden/cases.json).
 * Run: bun test scripts/invoice-template.test.ts
 */
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../..");
const desk = join(repo, "hermes/invoice-desk");
const read = (path: string) => normalizeTemplate(readFileSync(path, "utf8"));
const deskTemplate = read(join(desk, "template.html"));
const appTemplate = read(join(here, "../src/lib/invoice-template.html"));
const cases: {
  name: string;
  invoiceNo: string;
  invoice: InvoiceDraft;
  sha256: string;
}[] = JSON.parse(readFileSync(join(desk, "tests/golden/cases.json"), "utf8"));

describe("invoice preview", () => {
  test("the app's template is the worker's template", () => {
    expect(appTemplate).toBe(deskTemplate);
  });

  for (const c of cases) {
    test(`golden: ${c.name}`, () => {
      const html = fillInvoice(c.invoice, c.invoiceNo, appTemplate);
      expect(createHash("sha256").update(html, "utf8").digest("hex")).toBe(
        c.sha256,
      );
    });
  }

  test("typed text is escaped and never read as a placeholder", () => {
    const c = cases.find(x => x.name.startsWith("pay online"));
    if (!c) throw new Error("golden case missing");
    const html = fillInvoice(c.invoice, "INV-2026-099", appTemplate);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("client&#x27;s {{AMOUNT}} plan");
  });

  test("money rounds half up as typed, like Python's Decimal", () => {
    expect(money(6000)).toBe("6,000.00");
    expect(money("1500.5")).toBe("1,500.50");
    expect(money(0.005)).toBe("0.01");
    expect(money("1.005")).toBe("1.01");
    expect(money("999999.99")).toBe("999,999.99");
    expect(day("2026-10-06")).toBe("6 Oct 2026");
    expect(day("2026-12-31T00:00:00+00:00")).toBe("31 Dec 2026");
  });
});
