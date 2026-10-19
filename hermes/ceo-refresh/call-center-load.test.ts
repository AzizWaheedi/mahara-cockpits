import { describe, expect, test } from "bun:test";
import { createProviderDriver } from "./providerTools.ts";
import { withRuntime, type ProviderTools, type Repository, type Runtime } from "./runtime.ts";
import { calls } from "./native/adapters/calls.js";

/**
 * Creative Triage memory dips (2026-10-19): the CEO refresh sent its 30-day and
 * 7-day call center reports in the same millisecond and retried them after
 * 500 ms, so up to four heavy report scans overlapped on the Small database.
 * The reports now run one after the other, and a failed report waits 10 s,
 * then 20 s, before it is tried again. Every value here is made up.
 */

const ENV = { SUPABASE_URL: "https://bldgtotkfmhoxmlzowdx.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test" };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** A driver whose fetches answer with the given statuses in order ("throw" is a network failure). */
function driver(answers: (number | "throw")[]) {
  const waits: number[] = [];
  let fetches = 0;
  const fetcher = (async () => {
    const answer = answers[fetches++];
    if (answer === "throw") throw new Error("fictional network failure");
    return json(answer >= 400 ? { message: "fictional" } : { ok: true }, answer);
  }) as unknown as typeof fetch;
  const { tools } = createProviderDriver({ env: ENV, fetcher, apply: false, sleep: async ms => { waits.push(ms); } });
  return { tools, waits, fetches: () => fetches };
}

describe("call center report retry wait", () => {
  test("a failed report waits 10 s, then 20 s, before the next try", async () => {
    const { tools, waits, fetches } = driver([500, 503, 200]);
    expect(await tools.rest("rpc/mahara_call_center_report", { p_from: "2026-10-01", p_to: "2026-10-19" })).toEqual({ ok: true });
    expect(waits).toEqual([10_000, 20_000]);
    expect(fetches()).toBe(3);
  });

  test("a network failure on the report also waits 10 s", async () => {
    const { tools, waits } = driver(["throw", 200]);
    await tools.rest("rpc/mahara_call_center_report", { p_from: "2026-10-13", p_to: "2026-10-19" });
    expect(waits).toEqual([10_000]);
  });

  test("other reads keep the 500 ms retry", async () => {
    const finance = driver([500, 200]);
    await finance.tools.rest("rpc/cockpit_finance_refresh_input", {});
    expect(finance.waits).toEqual([500]);
    const section = driver([429, 200]);
    await section.tools.rest("cockpit_sections?select=key");
    expect(section.waits).toEqual([500]);
  });

  test("a report that keeps failing still stops after three tries", async () => {
    const { tools, waits, fetches } = driver([500, 500, 500]);
    await expect(tools.rest("rpc/mahara_call_center_report", { p_from: "2026-10-13", p_to: "2026-10-19" })).rejects.toThrow("HTTP 500");
    expect(waits).toEqual([10_000, 20_000]);
    expect(fetches()).toBe(3);
  });
});

const metrics = {
  dials: 0, providerDials: 0, connections: 0, talkSeconds: 0, leads: 0, leadsDialed: 0, leadsContacted: 0,
  noVerifiedDial: 0, confirmedBookings: 0, provisionalBookings: 0, unclassifiedBookings: 0, shows: 0, noShow: 0,
  closed: 0, values: [], showRate: null, closeRate: null, connectionRate: null, avgSpeedSeconds: null,
  medianSpeedSeconds: null, speedSamples: 0, withinTwoMinutes: 0, withinTwoMinutesRate: null,
  avgCallGapSeconds: null, callGapSamples: 0,
};

describe("calls section", () => {
  test("reads the 30-day report, then the 7-day report, never both at once", async () => {
    const ranges: string[] = [];
    let open = 0;
    let mostOpen = 0;
    const rest: ProviderTools["rest"] = async (resource, body) => {
      expect(resource).toBe("rpc/mahara_call_center_report");
      const { p_from, p_to } = body as { p_from: string; p_to: string };
      ranges.push(`${p_from}..${p_to}`);
      open++;
      mostOpen = Math.max(mostOpen, open);
      await new Promise(resolve => setTimeout(resolve, 5));
      open--;
      return {
        version: 1, from: p_from, to: p_to, timezone: "Asia/Kuwait", generatedAt: "2026-10-19T10:00:00Z",
        overall: metrics, callers: [], clients: [], daily: [], coverage: {}, warnings: [],
      };
    };
    const tools = { rest } as unknown as ProviderTools;
    const runtime: Runtime = { env: () => undefined, read: async () => [], repository: {} as Repository, tools };
    const result = (await withRuntime(runtime, () => calls.compute({ repository: runtime.repository }))) as {
      sources: { ok: boolean }[];
    };
    expect(mostOpen).toBe(1);
    expect(ranges).toHaveLength(2);
    const days = ranges.map(range => range.split("..").map(day => Date.parse(`${day}T00:00:00Z`)));
    expect(days.map(([from, to]) => (to - from) / 86_400_000)).toEqual([29, 6]);
    expect(result.sources[0].ok).toBe(true);
  });
});
