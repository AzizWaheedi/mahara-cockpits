import { describe, expect, test } from "bun:test";
import {
  DOCUMENT_SANDBOX,
  downloadLabel,
  draftWait,
  failedLine,
  noDocument,
  notesOf,
  proposalTitle,
  REQUEST_GONE,
  requestRead,
  retryToast,
  sentence,
  tryWords,
  waitingFor,
  waitLabel,
  waitsOnCloser,
  whatIsWrong,
} from "./proposals";
import type { WorkRequest } from "./types";

const NOW = Date.parse("2026-10-04T12:00:00Z");
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

const request = (over: Partial<WorkRequest> = {}): WorkRequest => ({
  id: "q1",
  kind: "proposal",
  contact_id: "c1",
  appointment_id: null,
  params: { proposal_id: "p1" },
  status: "queued",
  requested_by: "rep@example.com",
  requested_at: minutesAgo(3),
  claimed_at: null,
  attempts: 0,
  finished_at: null,
  error: null,
  result: null,
  ...over,
});

const OUTAGE =
  "The proposal writer cannot work right now: the Claude sign-in on the VPS has lapsed. This proposal waits and drafts by itself once that is fixed, so there is no need to ask again; if it is still waiting in an hour, tell the CEO.";

describe("draftWait", () => {
  test("a fresh draft says ten minutes, and can be stopped while queued", () => {
    const w = draftWait(
      { error: null, created_at: minutesAgo(3) },
      request(),
      NOW,
    );
    expect(w.tone).toBe("good");
    expect(w.head).toBe("The proposal is being written");
    expect(w.body).toContain("about ten minutes");
    // An expectation, never a promise: a draft can wait on an outage for hours.
    expect(w.body).toContain("usually");
    expect(w.meta).toBe("Asked 3 min ago · waiting for the writer");
    expect(w.stoppable).toBe(true);
  });

  test("a model down shows the writer's sentence, never ten minutes", () => {
    const w = draftWait(
      { error: OUTAGE, created_at: minutesAgo(5) },
      request({ requested_at: minutesAgo(5), error: "the fix" }),
      NOW,
    );
    expect(w.tone).toBe("warn");
    expect(w.head).toBe("The proposal is not written yet");
    expect(w.body).toBe(OUTAGE);
    expect(w.body).not.toContain("ten minutes");
  });

  test("the request's reason stands in when the proposal has none", () => {
    const w = draftWait(
      { error: null, created_at: minutesAgo(5) },
      request({ requested_at: minutesAgo(5), error: "Not started this run." }),
      NOW,
    );
    expect(w.tone).toBe("warn");
    expect(w.body).toBe("Not started this run.");
  });

  test("after 20 minutes it is taking longer than usual, with the try count", () => {
    const w = draftWait(
      { error: null, created_at: minutesAgo(40) },
      request({
        status: "running",
        attempts: 2,
        requested_at: minutesAgo(35),
      }),
      NOW,
    );
    expect(w.tone).toBe("warn");
    expect(w.head).toBe("Taking longer than usual");
    expect(w.meta).toBe("Asked 35 min ago · writing now, try 2 of 4");
    expect(w.body).toContain("tell the CEO");
    expect(w.stoppable).toBe(false);
  });

  test("a slow retry says what to do, after the writer's sentence", () => {
    const w = draftWait(
      {
        error:
          "Try 2 of 4 failed (no JSON object in the reply); it will be tried again.",
        created_at: minutesAgo(38),
      },
      request({ status: "running", attempts: 3, requested_at: minutesAgo(38) }),
      NOW,
    );
    expect(w.head).toBe("Taking longer than usual");
    expect(w.body).toBe(
      "Try 2 of 4 failed (no JSON object in the reply); it will be tried again. It is still drafting by itself, so there is no need to ask again. If it is not written an hour after you asked, tell the CEO.",
    );
    expect(w.meta).toBe("Asked 38 min ago · writing now, try 3 of 4");
  });

  test("slow and waiting says both", () => {
    const w = draftWait(
      { error: OUTAGE, created_at: minutesAgo(90) },
      request({ requested_at: minutesAgo(90) }),
      NOW,
    );
    expect(w.body).toBe(OUTAGE);
    expect(w.head).toBe("Taking longer than usual");
    expect(w.meta).toBe("Asked 2 h ago · waiting for the writer");
  });

  test("a rebuild says the figures are going in, not ten minutes", () => {
    const w = draftWait(
      { error: null, created_at: minutesAgo(300) },
      request({ params: { proposal_id: "p1", rebuild: true } }),
      NOW,
    );
    expect(w.head).toBe("Your figures are going into the document");
    expect(w.body).not.toContain("ten minutes");
    // It can wait behind a draft the writer is already on.
    expect(w.body).toContain("longer while another proposal is being written");
  });

  test("without the request it goes by the proposal", () => {
    const w = draftWait({ error: null, created_at: minutesAgo(25) }, null, NOW);
    expect(w.head).toBe("Taking longer than usual");
    expect(w.stoppable).toBe(false);
  });
});

describe("tryWords", () => {
  test("names the try in every state", () => {
    expect(tryWords(request({ status: "running", attempts: 1 }))).toBe(
      "writing now",
    );
    expect(tryWords(request({ status: "queued", attempts: 1 }))).toBe(
      "waiting to try again, 1 of 4 try made",
    );
    expect(tryWords(request({ status: "queued", attempts: 3 }))).toBe(
      "waiting to try again, 3 of 4 tries made",
    );
    expect(tryWords(null)).toBe("waiting for the writer");
  });
});

describe("chips, titles and lists", () => {
  test("a waiting draft says why in its chip", () => {
    expect(waitLabel({ status: "drafting", error: OUTAGE })).toBe(
      "Waiting: writer offline",
    );
    expect(
      waitLabel({
        status: "drafting",
        error:
          "Try 1 of 4 failed (no JSON object in the reply); it will be tried again.",
      }),
    ).toBe("Retrying");
    expect(waitLabel({ status: "drafting", error: null })).toBeNull();
    expect(waitLabel({ status: "failed", error: "x" })).toBeNull();
  });

  test("the download says what it is", () => {
    const base = { html_path: "proposals/p/v1.html", pdf_path: null };
    expect(downloadLabel({ ...base, status: "needs_input" })).toBe(
      "Download draft (has blanks)",
    );
    expect(downloadLabel({ ...base, status: "ready" })).toBe(
      "Download page (no PDF)",
    );
    expect(
      downloadLabel({
        ...base,
        status: "ready",
        pdf_path: "proposals/p/v1.pdf",
      }),
    ).toBe("Download PDF");
    expect(
      downloadLabel({ status: "drafting", html_path: null, pdf_path: null }),
    ).toBeNull();
  });

  test("the history names a proposal by its status", () => {
    expect(proposalTitle({ status: "drafting", sent_at: null })).toBe(
      "Proposal being drafted",
    );
    expect(proposalTitle({ status: "failed", sent_at: null })).toBe(
      "Proposal draft failed",
    );
    expect(proposalTitle({ status: "needs_input", sent_at: null })).toBe(
      "Proposal drafted, needs figures",
    );
    expect(
      proposalTitle({ status: "archived", sent_at: "2026-10-01T00:00:00Z" }),
    ).toBe("Proposal sent");
  });

  test("a failed draft waits on the closer", () => {
    expect(waitsOnCloser({ status: "failed" })).toBe(true);
    expect(waitsOnCloser({ status: "ready" })).toBe(true);
    expect(waitsOnCloser({ status: "drafting" })).toBe(false);
    expect(waitsOnCloser({ status: "sent" })).toBe(false);
  });

  test("notes are the writer's lines and nothing else", () => {
    expect(notesOf({ notes: ["One.", "", 3, "Two."] })).toEqual([
      "One.",
      "Two.",
    ]);
    expect(notesOf(null)).toEqual([]);
  });

  test("a failed draft on the card says what to do once", () => {
    const none =
      "No Fathom recording of this lead's demo was found. Share the recording with the team in Fathom, then draft again.";
    expect(failedLine(none)).toBe(none);
    expect(
      failedLine("The draft failed four times. The last error: timeout"),
    ).toBe(
      "The draft failed four times. The last error: timeout. Open it to draft again.",
    );
    expect(failedLine(null)).toBe(
      "The writer gave no reason. Open it to draft again.",
    );
  });

  test("a sentence ends once", () => {
    expect(sentence("No recording was found.")).toBe("No recording was found.");
    expect(sentence("the writer gave no reason")).toBe(
      "the writer gave no reason.",
    );
  });
});

describe("waitingFor", () => {
  test("reads the desk's waiting line wherever it sits", () => {
    expect(waitingFor("waiting: The Claude sign-in has lapsed.")).toBe(
      "The Claude sign-in has lapsed",
    );
    expect(
      waitingFor(
        "1 drafted through the fallback: the primary could not answer; waiting: Fathom refused the key.",
      ),
    ).toBe("Fathom refused the key");
    expect(waitingFor("2 done (2 ready), 0 to try again, 0 failed")).toBeNull();
    expect(waitingFor(null)).toBeNull();
  });
});

describe("whatIsWrong", () => {
  test("keeps what is wrong and leaves the fix out", () => {
    expect(
      whatIsWrong(
        "The Claude sign-in on the VPS has lapsed, so nothing can be drafted. Sign Claude Code in again on the VPS as aziz (run claude, then /login); drafting resumes by itself",
      ),
    ).toBe(
      "The Claude sign-in on the VPS has lapsed, so nothing can be drafted",
    );
    expect(whatIsWrong("Fathom refused the key (401)")).toBe(
      "Fathom refused the key (401)",
    );
  });
});

describe("noDocument", () => {
  test("every state says what happens or what to do next", () => {
    expect(noDocument("drafting")).toBe(
      "The document appears here when the draft is done.",
    );
    expect(noDocument("archived")).toContain(
      "Draft proposal on the lead's page starts a new one",
    );
    expect(noDocument("failed")).toContain("Draft it again");
    for (const s of ["needs_input", "ready", "sent"] as const)
      expect(noDocument(s)).toContain("Draft it again from the lead's page");
  });
});

describe("the document frame", () => {
  test("runs the document's editor and nothing that reaches the cockpit", () => {
    const tokens = DOCUMENT_SANDBOX.split(/\s+/);
    expect(tokens).toEqual([
      "allow-scripts",
      "allow-modals",
      "allow-downloads",
    ]);
    for (const t of tokens)
      expect(t).not.toMatch(/same-origin|top-navigation|popups/);
  });
});

describe("requestRead", () => {
  test("a request that is not there is said, so the page never waits blank", () => {
    expect(requestRead(null, null)).toEqual({
      data: null,
      error: { message: REQUEST_GONE },
    });
    expect(REQUEST_GONE).toContain("draft a new one from the lead's page");
  });

  test("a row comes through, and a read error stays the read error", () => {
    expect(requestRead({ id: "r1" }, null)).toEqual({
      data: { id: "r1" },
      error: null,
    });
    expect(requestRead(null, { message: "offline" })).toEqual({
      data: null,
      error: { message: "offline" },
    });
  });
});

describe("retryToast", () => {
  test("a rebuild that failed is rebuilt with the closer's figures, in minutes", () => {
    expect(retryToast({ rebuild: true })).toBe(
      "Rebuilding the document with your figures. It usually takes a minute or two.",
    );
  });
  test("a fresh draft says the figures go back in when there are some, and where", () => {
    expect(retryToast({ rebuild: false, figures_kept: true })).toBe(
      "Drafting again with the same choices. Your figures go back into the blanks on the same lines, and the notes say any that did not. It usually takes about ten minutes.",
    );
    expect(retryToast({})).toBe(
      "Drafting again with the same choices. It usually takes about ten minutes.",
    );
    expect(retryToast(null)).toBe(
      "Drafting again with the same choices. It usually takes about ten minutes.",
    );
  });
});
