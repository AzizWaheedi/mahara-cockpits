// bun test supabase/functions/sales-api
import { describe, expect, test } from "bun:test";
import { ALREADY_DRAFTING, archivePlan, BEING_WRITTEN, STOPPED, stoppedProposal } from "./proposals.ts";

describe("archiving a proposal stops its draft", () => {
  test("a queued draft is cancelled with it", () => {
    expect(archivePlan([{ id: "r1", status: "queued" }])).toEqual({ ok: true, cancel: ["r1"] });
  });

  test("nothing open is nothing to cancel", () => {
    expect(archivePlan([])).toEqual({ ok: true, cancel: [] });
  });

  test("one the worker is running refuses, and cancels nothing", () => {
    expect(
      archivePlan([
        { id: "r1", status: "queued" },
        { id: "r2", status: "running" },
      ]),
    ).toEqual({ ok: false, error: BEING_WRITTEN });
    expect(BEING_WRITTEN).toBe("It is being written right now. Archive it when it finishes.");
  });
});

describe("stopping a draft", () => {
  test("a first draft, with nothing to show, is archived as before", () => {
    expect(stoppedProposal({ html_path: null, validation: null })).toEqual({ status: "archived" });
  });

  test("a retry of a draft that needed figures goes back to needing them", () => {
    expect(
      stoppedProposal({ html_path: "proposals/p/v1.html", validation: { status: "needs_input" } }),
    ).toEqual({ status: "needs_input", error: null });
  });

  test("a rebuild of a ready proposal goes back to ready", () => {
    expect(stoppedProposal({ html_path: "proposals/p/v2.html", validation: { status: "ready" } })).toEqual({
      status: "ready",
      error: null,
    });
  });

  test("a retry of a failed draft is failed again, saying it was stopped", () => {
    expect(stoppedProposal({ html_path: "proposals/p/v1.html", validation: { status: "failed" } })).toEqual({
      status: "failed",
      error: STOPPED,
    });
  });

  test("a version with no status it can go back to is archived", () => {
    expect(stoppedProposal({ html_path: "proposals/p/v1.html", validation: {} })).toEqual({ status: "archived" });
  });
});

describe("a second draft for the same lead", () => {
  test("is refused without promising a time, and says what to do", () => {
    // A draft waiting on an outage can take hours: "about ten minutes" was a promise.
    expect(ALREADY_DRAFTING).not.toMatch(/minute|hour|soon/i);
    expect(ALREADY_DRAFTING).toMatch(/Refresh the lead's page/);
    expect(ALREADY_DRAFTING).not.toContain("\u2014");
  });
});
