import { describe, expect, test } from "bun:test";
import { PAUSED_FORM_REASON, formsToRead } from "./funnelForms";

/** The form each ad id points at, the shape gatherFunnels reads from Meta. */
function forms(byAd: Record<string, string | undefined>) {
  return (adId: string) => byAd[adId];
}

describe("formsToRead", () => {
  test("reads the form of an active campaign", () => {
    const out = formsToRead({ a1: { campaign: { effective_status: "ACTIVE" } } }, forms({ a1: "F1" }));
    expect(out.read).toEqual(["F1"]);
    expect(out.paused.size).toBe(0);
  });

  test("skips the form of a paused campaign and keeps it stored", () => {
    const out = formsToRead({ a1: { campaign: { effective_status: "PAUSED" } } }, forms({ a1: "F2" }));
    expect(out.read).toEqual([]);
    expect(out.paused.has("F2")).toBe(true);
    expect(PAUSED_FORM_REASON).toBe("The campaign is paused, so the form was not read. Stored questions are kept.");
  });

  test("reads a form an active ad also uses", () => {
    const out = formsToRead(
      { a1: { campaign: { effective_status: "PAUSED" } }, a2: { campaign: { effective_status: "ACTIVE" } } },
      forms({ a1: "F3", a2: "F3" }),
    );
    expect(out.read).toEqual(["F3"]);
    expect(out.paused.has("F3")).toBe(false);
  });

  test("reads the form when the campaign field is missing", () => {
    const out = formsToRead({ a1: {} }, forms({ a1: "F4" }));
    expect(out.read).toEqual(["F4"]);
    expect(out.paused.size).toBe(0);
  });

  test("ignores an ad without a form id", () => {
    const out = formsToRead({ a1: { campaign: { effective_status: "PAUSED" } } }, forms({}));
    expect(out.read).toEqual([]);
    expect(out.paused.size).toBe(0);
  });

  test("lists a form used by two live ads once", () => {
    const out = formsToRead(
      { a1: { campaign: { effective_status: "ACTIVE" } }, a2: {} },
      forms({ a1: "F5", a2: "F5" }),
    );
    expect(out.read).toEqual(["F5"]);
  });

  test("returns the read list sorted", () => {
    const out = formsToRead(
      { a1: {}, a2: {}, a3: {} },
      forms({ a1: "F9", a2: "F2", a3: "F7" }),
    );
    expect(out.read).toEqual(["F2", "F7", "F9"]);
  });

  test("keeps the form of an archived campaign stored", () => {
    const out = formsToRead({ a1: { campaign: { effective_status: "ARCHIVED" } } }, forms({ a1: "F6" }));
    expect(out.read).toEqual([]);
    expect(out.paused.has("F6")).toBe(true);
  });
});
