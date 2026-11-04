/**
 * The video editor desk's loading placeholders. Rendered on the server:
 * nothing here signs in, reads a database or reaches the network.
 *
 * bun test scripts/skeleton-loading.test.tsx
 */
import { describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import {
  LoadingSkeleton,
  type LoadingSkeletonProps,
} from "../src/components/LoadingSkeleton";
import type { Job } from "../src/lib/types";

const VARIANTS: LoadingSkeletonProps["variant"][] = [
  "page",
  "cards",
  "table",
  "list",
  "detail",
  "form",
  "board",
  "media",
];

function renderSkeleton(props: LoadingSkeletonProps = {}): string {
  return renderToStaticMarkup(createElement(LoadingSkeleton, props));
}

describe("LoadingSkeleton", () => {
  for (const variant of VARIANTS) {
    test(`${variant} is one announced, decorative placeholder`, () => {
      const html = renderSkeleton({
        variant,
        label: `Loading ${variant}`,
        rows: 3,
      });

      expect(html.match(/role="status"/g)?.length).toBe(1);
      expect(html).toContain('aria-busy="true"');
      expect(html.match(/class="sr-only"/g)?.length).toBe(1);
      expect(html).toContain(`Loading ${variant}`);
      expect(html).toContain('aria-hidden="true"');
      expect(html).toContain("motion-safe:animate-pulse");
      expect(html).toContain("bg-muted");
      expect(html).toContain("min-w-0");
      expect(html).toContain("max-w-full");
      expect(html).not.toContain("bg-primary");
      expect(html).not.toContain("animate-shimmer");
    });
  }

  test("draws no button, link, field or made-up value", () => {
    const html = renderSkeleton({ variant: "board", rows: 2 });
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<a ");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("<select");
    expect(html).not.toContain("<textarea");
    expect(html).not.toMatch(/\b\d+%/);
  });
});

let jobsState: {
  data?: Job[];
  error: string | null;
  loading: boolean;
  reload: () => void;
} = { data: undefined, error: null, loading: true, reload: () => {} };

mock.module("../src/lib/data", () => ({
  useJobs: () => jobsState,
}));
mock.module("../src/lib/auth", () => ({
  useWho: () => ({ email: "editor@example.com" }),
}));
mock.module("../src/components/tasks/YourTasks", () => ({
  YourTasks: () => null,
}));
mock.module("../src/components/ReportIssue", () => ({
  ReportIssue: () => null,
}));

const { default: JobsPage } = await import("../src/pages/JobsPage");

function renderJobs(): string {
  return renderToStaticMarkup(
    createElement(MemoryRouter, null, createElement(JobsPage)),
  );
}

const JOB: Job = {
  task_id: "job-1",
  name: "Launch cut",
  url: null,
  status: "in progress",
  client: "Acme",
  clients: null,
  client_task_id: null,
  editor: "Editor",
  editors: [],
  request_type: "Video",
  brief: null,
  script: null,
  script_task_id: null,
  footage_url: null,
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
  state: "ready",
  ready: true,
  missing: null,
  files: 3,
  seconds: 120,
  transcript_chars: 40,
  prepared_at: null,
  attempts: 1,
  error: null,
  asked_for: null,
  asked_at: null,
  asked_by: null,
  synced_at: "2026-11-01T08:00:00.000Z",
};

describe("JobsPage initial paths", () => {
  test("a pending read is a board skeleton, not an empty board", () => {
    jobsState = {
      data: undefined,
      error: null,
      loading: true,
      reload: () => {},
    };
    const html = renderJobs();
    expect(html).toContain('role="status"');
    expect(html).toContain("Reading the board");
    expect(html).not.toContain("No open jobs on the board");
  });

  test("an error stays an error", () => {
    jobsState = {
      data: undefined,
      error: "offline",
      loading: false,
      reload: () => {},
    };
    const html = renderJobs();
    expect(html).not.toContain('role="status"');
    expect(html).toContain("could not be read");
  });

  test("an empty read keeps its empty state", () => {
    jobsState = { data: [], error: null, loading: false, reload: () => {} };
    const html = renderJobs();
    expect(html).not.toContain('role="status"');
    expect(html).toContain("No open jobs on the board");
  });

  test("a finished read shows the job", () => {
    jobsState = {
      data: [JOB],
      error: null,
      loading: false,
      reload: () => {},
    };
    const html = renderJobs();
    expect(html).not.toContain('role="status"');
    expect(html).toContain("Acme");
    expect(html).toContain("Ready to start");
  });
});
