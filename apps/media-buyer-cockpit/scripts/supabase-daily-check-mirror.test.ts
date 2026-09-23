import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  buildCockpitDailyCheckRow,
  type CockpitDailyCheckInput,
  calculateNextRevision,
  canAcknowledgeDailyCheckRevision,
  mirrorCockpitDailyCheck,
  needsDailyCheckShadow,
} from "../convex/tools";

const originalEnv = {
  dryRun: process.env.SUPABASE_CHECKS_SHADOW_DRY_RUN,
  url: process.env.SUPABASE_URL,
  key: process.env.SUPABASE_SERVICE_ROLE_KEY,
  canary: process.env.SUPABASE_CHECKS_SHADOW_CANARY_SOURCE_ID,
  batch: process.env.SUPABASE_CHECKS_SHADOW_BATCH_ENABLED,
};

beforeEach(() => {
  process.env.SUPABASE_CHECKS_SHADOW_BATCH_ENABLED = "true";
  delete process.env.SUPABASE_CHECKS_SHADOW_CANARY_SOURCE_ID;
});

afterEach(() => {
  for (const [name, value] of [
    ["SUPABASE_CHECKS_SHADOW_DRY_RUN", originalEnv.dryRun],
    ["SUPABASE_URL", originalEnv.url],
    ["SUPABASE_SERVICE_ROLE_KEY", originalEnv.key],
    ["SUPABASE_CHECKS_SHADOW_CANARY_SOURCE_ID", originalEnv.canary],
    ["SUPABASE_CHECKS_SHADOW_BATCH_ENABLED", originalEnv.batch],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

const sampleCheck: CockpitDailyCheckInput = {
  _id: "check_mb_today_1",
  _creationTime: 1790160000000,
  role: "media_buyer",
  day: "2026-09-23",
  key: "sod_spend_check",
  label: "Verify Daily Spend vs Budget",
  detail: "Check all live campaigns against budget floor",
  phase: "sod",
  block: "sprint_am",
  order: 1,
  href: "/dashboard",
  done: true,
  doneAt: 1790163600000,
  shadowRevision: 1790163600500,
  shadowActor: "nada@maharamedia.com",
};

describe("Supabase daily check shadow contract", () => {
  it("pure row mapping: formats all fields exactly matching the backfill schema", () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "super-secret-key-12345";

    const row = buildCockpitDailyCheckRow(sampleCheck);

    expect(row.role).toBe("media_buyer");
    expect(row.owner_app).toBe("media-buyer");
    expect(row.day).toBe("2026-09-23");
    expect(row.check_key).toBe("sod_spend_check");
    expect(row.label).toBe("Verify Daily Spend vs Budget");
    expect(row.detail).toBe("Check all live campaigns against budget floor");
    expect(row.phase).toBe("sod");
    expect(row.block).toBe("sprint_am");
    expect(row.display_order).toBe(1);
    expect(row.href).toBe("/dashboard");
    expect(row.done).toBe(true);
    expect(row.done_at).toBe(new Date(1790163600000).toISOString());
    expect(row.source_system).toBe("convex");
    expect(row.source_deployment).toBe("adorable-seahorse-418");
    expect(row.source_id).toBe("check_mb_today_1");
    expect(row.source_created_at).toBe(new Date(1790160000000).toISOString());
    expect(row.source_snapshot_ts).toBe("live:1790163600500");
    expect(row.changed_by).toBe("nada@maharamedia.com");
    expect(row.source_revision).toBe(1790163600500);
    expect(row.source_deleted).toBe(false);
    expect(row.source_row).toMatchObject({
      _id: "check_mb_today_1",
      role: "media_buyer",
      day: "2026-09-23",
      key: "sod_spend_check",
    });

    // Ensure secrets are never leaked into the mapped payload
    expect(JSON.stringify(row)).not.toContain("super-secret-key-12345");
  });

  it("pure row mapping: nulls optional fields when omitted and defaults source_deleted", () => {
    const minimalDoc: CockpitDailyCheckInput = {
      _id: "check_min_1",
      role: "media_buyer",
      day: "2026-09-23",
      key: "minimal_check",
      label: "Minimal Check",
      done: false,
      shadowRevision: 100,
    };

    const row = buildCockpitDailyCheckRow(minimalDoc);

    expect(row.detail).toBeNull();
    expect(row.phase).toBeNull();
    expect(row.block).toBeNull();
    expect(row.display_order).toBeNull();
    expect(row.href).toBeNull();
    expect(row.done_at).toBeNull();
    expect(row.source_created_at).toBeNull();
    expect(row.source_deleted).toBe(false);
    expect(row.changed_by).toBe("media_buyer");
    expect(row.source_snapshot_ts).toBe("live:100");
    expect(row.source_revision).toBe(100);
  });

  it("wrong-role rejection: throws when given CSM or creative check", () => {
    expect(() =>
      buildCockpitDailyCheckRow({
        ...sampleCheck,
        role: "csm",
      }),
    ).toThrow(/Only media_buyer checks can be mirrored/);

    expect(() =>
      buildCockpitDailyCheckRow({
        ...sampleCheck,
        role: "creative",
      }),
    ).toThrow(/Only media_buyer checks can be mirrored/);

    expect(() =>
      buildCockpitDailyCheckRow({
        ...sampleCheck,
        role: "unknown",
      }),
    ).toThrow(/Only media_buyer checks can be mirrored/);
  });

  it("validation: rejects non-positive or non-integer shadow revisions", () => {
    expect(() =>
      buildCockpitDailyCheckRow({
        ...sampleCheck,
        shadowRevision: 0,
      }),
    ).toThrow(/positive integral shadowRevision/);

    expect(() =>
      buildCockpitDailyCheckRow({
        ...sampleCheck,
        shadowRevision: -5,
      }),
    ).toThrow(/positive integral shadowRevision/);

    expect(() =>
      buildCockpitDailyCheckRow({
        ...sampleCheck,
        shadowRevision: 12.34,
      }),
    ).toThrow(/positive integral shadowRevision/);

    expect(() =>
      buildCockpitDailyCheckRow({
        ...sampleCheck,
        shadowRevision: undefined,
      }),
    ).toThrow(/positive integral shadowRevision/);
  });

  it("validation: rejects blank required fields or invalid day formats", () => {
    expect(() =>
      buildCockpitDailyCheckRow({
        ...sampleCheck,
        key: "  ",
      }),
    ).toThrow(/missing required source ID, day, key, or label/);

    expect(() =>
      buildCockpitDailyCheckRow({
        ...sampleCheck,
        label: "",
      }),
    ).toThrow(/missing required source ID, day, key, or label/);

    expect(() =>
      buildCockpitDailyCheckRow({
        ...sampleCheck,
        day: "2026/09/23",
      }),
    ).toThrow(/Invalid day format/);
  });

  it("dry-run default: returns dry-run mode and never calls fetch", async () => {
    delete process.env.SUPABASE_CHECKS_SHADOW_DRY_RUN;
    let fetchCalled = false;
    const fetchImpl = (async () => {
      fetchCalled = true;
      throw new Error("Must not be called during dry run");
    }) as typeof fetch;

    const res = await mirrorCockpitDailyCheck(sampleCheck, { fetchImpl });
    expect(res).toEqual({ mode: "dry-run" });
    expect(fetchCalled).toBe(false);

    // Explicit dryRun option overrides environment variable
    process.env.SUPABASE_CHECKS_SHADOW_DRY_RUN = "false";
    const explicitDryRun = await mirrorCockpitDailyCheck(sampleCheck, {
      dryRun: true,
      fetchImpl,
    });
    expect(explicitDryRun).toEqual({ mode: "dry-run" });
    expect(fetchCalled).toBe(false);
  });

  it("limits an enabled pilot to one exact canary source ID", async () => {
    process.env.SUPABASE_CHECKS_SHADOW_CANARY_SOURCE_ID = "another-check-id";
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      throw new Error("non-canary check must not be sent");
    }) as typeof fetch;
    expect(
      await mirrorCockpitDailyCheck(sampleCheck, {
        dryRun: false,
        fetchImpl,
      }),
    ).toEqual({ mode: "dry-run" });
    expect(called).toBe(false);
  });

  it("keeps writes off when live flag lacks both canary and batch approval", async () => {
    process.env.SUPABASE_CHECKS_SHADOW_DRY_RUN = "false";
    delete process.env.SUPABASE_CHECKS_SHADOW_BATCH_ENABLED;
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      throw new Error("unguarded write");
    }) as typeof fetch;
    expect(await mirrorCockpitDailyCheck(sampleCheck, { fetchImpl })).toEqual({
      mode: "dry-run",
    });
    expect(called).toBe(false);
  });

  it("outgoing RPC request and headers: sends expected payload without exposing service key", async () => {
    process.env.SUPABASE_CHECKS_SHADOW_DRY_RUN = "false";
    process.env.SUPABASE_URL = "https://bldgtotkfmhoxmlzowdx.supabase.co/";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-secret-key-999";

    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;

    const fetchImpl = (async (
      url: string | URL | Request,
      init?: RequestInit,
    ) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(
        JSON.stringify({
          status: "inserted",
          id: 42,
          source_revision: 1790163600500,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const result = await mirrorCockpitDailyCheck(sampleCheck, {
      dryRun: false,
      fetchImpl,
    });

    expect(result).toEqual({
      mode: "written",
      result: { status: "inserted", id: 42, source_revision: 1790163600500 },
    });

    expect(capturedUrl).toBe(
      "https://bldgtotkfmhoxmlzowdx.supabase.co/rest/v1/rpc/cockpit_apply_daily_check_shadow",
    );
    expect(capturedInit?.method).toBe("POST");
    expect(capturedInit?.headers).toEqual({
      apikey: "service-role-secret-key-999",
      Authorization: "Bearer service-role-secret-key-999",
      "Content-Type": "application/json",
    });

    const parsedBody = JSON.parse(String(capturedInit?.body));
    expect(parsedBody).toHaveProperty("p_row");
    expect(parsedBody.p_row.role).toBe("media_buyer");
    expect(parsedBody.p_row.source_deployment).toBe("adorable-seahorse-418");
    expect(parsedBody.p_row.source_revision).toBe(1790163600500);

    // Ensure the payload body itself never leaked the service role key
    expect(String(capturedInit?.body)).not.toContain(
      "service-role-secret-key-999",
    );
  });

  it("network/HTTP health reporting: records error on missing configuration", async () => {
    process.env.SUPABASE_CHECKS_SHADOW_DRY_RUN = "false";
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    let threw = false;
    try {
      await mirrorCockpitDailyCheck(sampleCheck, { dryRun: false });
    } catch (e) {
      threw = true;
      expect(String(e)).toContain("not configured");
    }
    expect(threw).toBe(true);
  });

  it("refuses a Supabase URL for another project", async () => {
    process.env.SUPABASE_URL = "https://wrong-project.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      throw new Error("must not call the wrong project");
    }) as typeof fetch;
    await expect(
      mirrorCockpitDailyCheck(sampleCheck, { dryRun: false, fetchImpl }),
    ).rejects.toThrow(/Creative Triage/);
    expect(called).toBe(false);
  });

  it("network/HTTP health reporting: throws on network failure", async () => {
    process.env.SUPABASE_CHECKS_SHADOW_DRY_RUN = "false";
    process.env.SUPABASE_URL = "https://bldgtotkfmhoxmlzowdx.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";

    const fetchImpl = (async () => {
      throw new Error("DNS resolution failed");
    }) as typeof fetch;

    let threw = false;
    try {
      await mirrorCockpitDailyCheck(sampleCheck, { dryRun: false, fetchImpl });
    } catch (e) {
      threw = true;
      expect(String(e)).toContain("DNS resolution failed");
    }
    expect(threw).toBe(true);
  });

  it("network/HTTP health reporting: throws on non-2xx status code", async () => {
    process.env.SUPABASE_CHECKS_SHADOW_DRY_RUN = "false";
    process.env.SUPABASE_URL = "https://bldgtotkfmhoxmlzowdx.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";

    const fetchImpl = (async () => {
      return new Response("Internal Server Error", { status: 500 });
    }) as typeof fetch;

    let threw = false;
    try {
      await mirrorCockpitDailyCheck(sampleCheck, { dryRun: false, fetchImpl });
    } catch (e) {
      threw = true;
      expect(String(e)).toContain("failed (500)");
    }
    expect(threw).toBe(true);
  });

  it("rejects a successful HTTP response without a valid RPC result", async () => {
    process.env.SUPABASE_URL = "https://bldgtotkfmhoxmlzowdx.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ status: "unknown" }), {
        status: 200,
      })) as typeof fetch;
    await expect(
      mirrorCockpitDailyCheck(sampleCheck, { dryRun: false, fetchImpl }),
    ).rejects.toThrow(/invalid result/);
  });

  it("rapid toggle ordering and revision monotonicity", () => {
    const t0 = Date.now();
    const r1 = calculateNextRevision(undefined);
    expect(r1).toBeGreaterThanOrEqual(t0);

    const r2 = calculateNextRevision(r1);
    expect(r2).toBeGreaterThan(r1);

    const r3 = calculateNextRevision(r2);
    expect(r3).toBeGreaterThan(r2);

    // High prior timestamp always increments by at least 1
    const futurePrior = 2000000000000;
    const rNext = calculateNextRevision(futurePrior);
    expect(rNext).toBe(2000000000001);

    // Successive toggle rows maintain monotonic revisions and stable snapshots
    const toggle1 = buildCockpitDailyCheckRow({
      ...sampleCheck,
      done: true,
      shadowRevision: r1,
    });
    const toggle2 = buildCockpitDailyCheckRow({
      ...sampleCheck,
      done: false,
      shadowRevision: r2,
    });

    expect(toggle1.source_revision).toBe(r1);
    expect(toggle1.source_snapshot_ts).toBe(`live:${r1}`);
    expect(toggle2.source_revision).toBe(r2);
    expect(toggle2.source_snapshot_ts).toBe(`live:${r2}`);
    expect(toggle2.source_revision).toBeGreaterThan(toggle1.source_revision);
  });

  it("replays a check until the current revision is acknowledged", () => {
    expect(needsDailyCheckShadow(undefined, undefined)).toBe(true);
    expect(needsDailyCheckShadow(200, undefined)).toBe(true);
    expect(needsDailyCheckShadow(200, 100)).toBe(true);
    expect(needsDailyCheckShadow(200, 200)).toBe(false);
    expect(needsDailyCheckShadow(200, 201)).toBe(true);
    expect(canAcknowledgeDailyCheckRevision(200, 200, undefined)).toBe(true);
    expect(canAcknowledgeDailyCheckRevision(201, 200, undefined)).toBe(false);
    expect(canAcknowledgeDailyCheckRevision(200, 200, 200)).toBe(false);
  });
});
