/**
 * The CSM call list and the gap report from invented answers (resultsFixture.ts), to check them at phone and
 * laptop widths, light and dark, without signing in. Start the app's Vite server with a placeholder project
 * address and key (no secret), then open /src/dev/results-harness.html:
 *
 *   VITE_SUPABASE_URL=https://bldgtotkfmhoxmlzowdx.supabase.co VITE_SUPABASE_ANON_KEY=placeholder bunx vite
 *
 * ?results=default, empty, allcalled, unread, error, loading; ?theme=light. Pressing Called answers from
 * here and the list then shows who and when. Never imported by the production app.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { Toaster } from "sonner";
import { getCockpitSupabaseClient } from "@/auth/SupabaseAuthProvider";
import { CallList } from "@/components/results/CallList";
import { GapReport } from "@/components/results/GapReport";
import {
  callListFixture,
  gapClientFixture,
  gapFixture,
  type ResultsScenario,
} from "./resultsFixture";
import "@/index.css";

type Answer = {
  data: unknown;
  error: { message: string; code?: string } | null;
};

const params = new URLSearchParams(window.location.search);
const pick = params.get("results") ?? "default";
if (params.get("theme") === "light")
  document.documentElement.classList.remove("dark");
const called = new Map<string, string>();

const client = getCockpitSupabaseClient() as unknown as {
  rpc: (name: string, args?: Record<string, unknown>) => Promise<Answer>;
};
client.rpc = async (name, args = {}) => {
  if (pick === "loading") return new Promise<Answer>(() => {});
  await new Promise(r => setTimeout(r, 300));
  if (pick === "error")
    return {
      data: null,
      error: {
        code: "57014",
        message: "canceling statement due to statement timeout",
      },
    };
  const scenario = pick as ResultsScenario;
  if (name === "cockpit_gap_read")
    return {
      data: gapFixture(String(args.p_from), String(args.p_to), scenario),
      error: null,
    };
  if (name === "cockpit_gap_client_read") {
    const data = gapClientFixture(
      String(args.p_location),
      String(args.p_from),
      String(args.p_to),
    );
    return data
      ? { data, error: null }
      : {
          data: null,
          error: {
            code: "42501",
            message: "That client is not on your board.",
          },
        };
  }
  if (name === "cockpit_csm_calls_read") {
    const list = callListFixture(scenario);
    for (const r of list.rows)
      if (called.has(r.locationId)) {
        r.calledAt = called.get(r.locationId) ?? null;
        r.calledBy = "you@example.test";
        r.calledByName = "You";
      }
    return { data: list, error: null };
  }
  if (name === "cockpit_csm_call_logged") {
    const row = callListFixture(scenario).rows.find(
      r => r.locationId === args.p_location,
    );
    if (row?.status !== "call")
      return {
        data: null,
        error: {
          code: "22023",
          message: "That client is not on this week's call list.",
        },
      };
    const at = new Date().toISOString();
    called.set(row.locationId, at);
    return {
      data: {
        ok: true,
        alreadyLogged: false,
        locationId: row.locationId,
        clientName: row.clientName,
        week: "2026-W43",
        calledAt: at,
        calledBy: "you@example.test",
      },
      error: null,
    };
  }
  return {
    data: null,
    error: { message: `The harness has no fixture for ${name}.` },
  };
};

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <MemoryRouter>
      <main className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
        <CallList />
        <GapReport />
      </main>
      <Toaster />
    </MemoryRouter>
  </StrictMode>,
);
