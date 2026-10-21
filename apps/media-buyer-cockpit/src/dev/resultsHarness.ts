/**
 * The results and speed views in the layout harness: the gap report, the speed chart and the morning list
 * answer from invented data (resultsFixture.ts) after a short delay, so every state can be looked at
 * without signing in. Open, for example:
 *
 *   /harness.html?path=%2Fperformance%3Fview%3Dgap
 *   /harness.html?path=%2Fperformance%3Fview%3Dspeed&results=few
 *   /harness.html?path=%2Fperformance%3Fview%3Dmorning
 *
 * `results=` picks the answer: default, empty, few (a few leads: bands say too few), unread (a sheet that
 * could not be read), loading, error, refused (a seat that may not read it), missing (the read is not on the
 * database yet). `delay=` sets the wait in ms (500 by default). Never imported by the production app.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  callListFixture,
  gapClientFixture,
  gapFixture,
  morningFixture,
  type ResultsScenario,
  speedFixture,
} from "./resultsFixture";

type Answer = {
  data: unknown;
  error: { message: string; code?: string } | null;
};

const READS = [
  "cockpit_gap_read",
  "cockpit_gap_client_read",
  "cockpit_csm_calls_read",
  "cockpit_csm_call_logged",
  "cockpit_speed_read",
  "cockpit_morning_uncalled_read",
];

export function installResultsHarness(client: SupabaseClient): void {
  const params = new URLSearchParams(window.location.search);
  if (!/^\/performance\b/.test(params.get("path") ?? "")) return;
  const pick = params.get("results") ?? "default";
  const delay = Number(params.get("delay") ?? 500);
  const wait = () => new Promise(r => setTimeout(r, delay));
  const c = client as unknown as {
    rpc: (name: string, args?: Record<string, unknown>) => Promise<Answer>;
  };
  const previous = c.rpc.bind(c);
  c.rpc = async (name, args = {}) => {
    if (!READS.includes(name)) return previous(name, args);
    if (pick === "loading") return new Promise<Answer>(() => {});
    await wait();
    if (pick === "error")
      return {
        data: null,
        error: { code: "57014", message: "canceling statement due to statement timeout" },
      };
    if (pick === "refused")
      return {
        data: null,
        error: {
          code: "42501",
          message: "Speed numbers cover every client, so only seats that see every client open them.",
        },
      };
    if (pick === "missing")
      return { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
    const scenario = pick as ResultsScenario;
    if (name === "cockpit_gap_read")
      return { data: gapFixture(String(args.p_from), String(args.p_to), scenario), error: null };
    if (name === "cockpit_gap_client_read") {
      const data = gapClientFixture(String(args.p_location), String(args.p_from), String(args.p_to));
      return data
        ? { data, error: null }
        : { data: null, error: { code: "42501", message: "That client is not on your board." } };
    }
    if (name === "cockpit_speed_read")
      return {
        data: speedFixture(
          String(args.p_from),
          String(args.p_to),
          args.p_clock === "working" ? "working" : "clock",
          scenario,
        ),
        error: null,
      };
    if (name === "cockpit_morning_uncalled_read")
      return { data: morningFixture((args.p_location as string | null) ?? null, scenario), error: null };
    if (name === "cockpit_csm_calls_read") return { data: callListFixture(scenario), error: null };
    return { data: null, error: { message: `The harness has no fixture for ${name}.` } };
  };
}
