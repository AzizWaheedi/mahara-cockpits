import { afterEach, describe, expect, it } from "bun:test";
import {
  buildCockpitFeedbackRow,
  mirrorCockpitFeedback,
} from "../convex/tools";

const original = {
  dryRun: process.env.SUPABASE_MIGRATION_DRY_RUN,
  url: process.env.SUPABASE_URL,
  key: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

afterEach(() => {
  for (const [name, value] of [
    ["SUPABASE_MIGRATION_DRY_RUN", original.dryRun],
    ["SUPABASE_URL", original.url],
    ["SUPABASE_SERVICE_ROLE_KEY", original.key],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

const input = {
  sourceId: "feedback-123",
  app: "media-buyer",
  page: "/dashboard",
  role: "media_buyer",
  text: "The total is wrong",
  actorEmail: "NADA@MAHARAMEDIA.COM ",
  at: Date.parse("2026-09-22T12:00:00Z"),
  metadata: { delivered: false },
};

describe("Supabase feedback shadow migration", () => {
  it("defaults to dry-run and never calls fetch", async () => {
    delete process.env.SUPABASE_MIGRATION_DRY_RUN;
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      throw new Error("must not run");
    }) as typeof fetch;

    expect(await mirrorCockpitFeedback(input, { fetchImpl })).toEqual({
      mode: "dry-run",
    });
    expect(called).toBe(false);
  });

  it("builds a bounded normalized row without configuration secrets", () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "never-copy-this";
    const row = buildCockpitFeedbackRow({
      ...input,
      sourceId: `  ${"x".repeat(240)}  `,
      page: `  ${"p".repeat(300)}  `,
      text: `  ${"t".repeat(10_100)}  `,
    });

    expect(row.source_id).toHaveLength(200);
    expect(row.page).toHaveLength(255);
    expect(row.text).toHaveLength(10_000);
    expect(row.actor_email).toBe("nada@maharamedia.com");
    expect(JSON.stringify(row)).not.toContain("never-copy-this");
  });

  it("upserts the expected row only when live mode is explicit", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co/";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
    let request: { url: string; init?: RequestInit } | undefined;
    const fetchImpl = (async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      request = { url: String(url), init };
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    expect(
      await mirrorCockpitFeedback(input, { dryRun: false, fetchImpl }),
    ).toEqual({ mode: "written" });
    expect(request?.url).toBe(
      "https://example.supabase.co/rest/v1/cockpit_issue_reports?on_conflict=source_system,source_id",
    );
    expect(request?.init?.method).toBe("POST");
    expect(request?.init?.headers).toEqual({
      apikey: "service-role-test",
      Authorization: "Bearer service-role-test",
      "Content-Type": "application/json",
      Prefer: "resolution=ignore-duplicates,return=minimal",
    });
    expect(JSON.parse(String(request?.init?.body))).toMatchObject({
      kind: "issue",
      source_system: "convex",
      source_id: "feedback-123",
      app: "media-buyer",
      page: "/dashboard",
      role: "media_buyer",
      actor_email: "nada@maharamedia.com",
      metadata: { delivered: false },
    });
  });
});
