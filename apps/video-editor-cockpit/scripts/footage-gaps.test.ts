import { expect, test } from "bun:test";
import { gapOf, jobsWithoutFootage } from "../src/lib/footageGaps";
import type { Job } from "../src/lib/types";

function job(over: Partial<Job>): Job {
  return {
    task_id: "86abc",
    name: "New Video Request",
    url: null,
    status: "planning",
    client: "city wood",
    clients: ["city wood"],
    client_task_id: null,
    editor: null,
    editors: null,
    request_type: null,
    brief: null,
    script: null,
    script_task_id: null,
    footage_url: "https://drive.google.com/drive/folders/1abc",
    raw_url: null,
    edited_url: null,
    frameio_file_id: null,
    frameio_url: null,
    frameio_version: null,
    frameio_share_url: null,
    frameio_seen_at: null,
    website: null,
    due_at: null,
    opened_at: null,
    state: "blocked",
    ready: false,
    missing: null,
    files: 0,
    seconds: null,
    transcript_chars: null,
    prepared_at: null,
    attempts: 1,
    error: null,
    asked_for: null,
    asked_at: null,
    asked_by: null,
    synced_at: null,
    ...over,
  };
}

test("each worker message becomes the fix a person can make", () => {
  expect(gapOf(job({ footage_url: null })).kind).toBe("no-link");
  expect(
    gapOf(
      job({
        error: "no usable Drive link on the card",
        missing: [
          "The footage folder has no video in it yet, or it is not shared with us.",
        ],
      }),
    ).kind,
  ).toBe("not-drive");
  expect(
    gapOf(job({ error: "that link is not a folder and not a video" })).kind,
  ).toBe("not-video");
  expect(
    gapOf(job({ error: "the footage link could not be opened: HTTP 404" }))
      .kind,
  ).toBe("cannot-open");
  expect(
    gapOf(
      job({
        missing: [
          "The footage folder has no video in it yet, or it is not shared with us.",
        ],
      }),
    ).kind,
  ).toBe("empty");
  expect(gapOf(job({ missing: ["No editor assigned."] })).kind).toBe("other");
});

test("a job sent back to be read is waiting, whatever it said before", () => {
  expect(
    gapOf(job({ state: "new", error: "no usable Drive link on the card" }))
      .kind,
  ).toBe("waiting");
});

test("only open jobs with nothing read are listed", () => {
  const jobs = [
    job({ task_id: "empty" }),
    job({ task_id: "read", state: "ready", files: 4 }),
    job({ task_id: "on-wall" }),
    job({ task_id: "live", status: "live 🚀" }),
    job({ task_id: "gone", state: "gone" }),
  ];
  expect(
    jobsWithoutFootage(jobs, new Set(["on-wall"])).map(j => j.task_id),
  ).toEqual(["empty"]);
});
