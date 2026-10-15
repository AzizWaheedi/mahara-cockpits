/**
 * The Results tab's Calls part from invented answers, to check it at phone
 * and laptop widths, light and dark, without signing in. `bunx vite`, then
 * open /client-success/src/dev/calls-harness.html (?state=on_track,
 * ?theme=light). Play makes a short tone; the fourth lost lead's call fails
 * on purpose, to show the refusal.
 */

import { StrictMode, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import {
  CallCentreView,
  ClientCallerChip,
  ClientCallerLine,
} from "@/components/CallCentreSection";
import { Chip } from "@/components/kit";
import { ResultsParts, ResultsSection } from "@/components/ResultsLayout";
import { parseCallCentre } from "@/lib/callCentre";
import {
  type CallsState,
  callersByTask,
  callRange,
} from "@/lib/callCentreClient";
import type { RecordingResult } from "@/lib/callRecording";
import {
  type CallsKind,
  callCentreFixture,
  callersFixture,
} from "./callCentreFixture";
import "@/index.css";

const STATES = [
  "call_centre",
  "lead_quality",
  "on_track",
  "not_enough",
  "client_calls",
  "no_data",
  "report_failed",
  "loading",
  "error",
] as const;
type HarnessState = (typeof STATES)[number];

/** A second and a half of a quiet 440 Hz tone, as a WAV file. */
function tone(): Blob {
  const rate = 8000;
  const n = Math.round(rate * 1.5);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, "RIFF");
  v.setUint32(4, 36 + n * 2, true);
  text(8, "WAVEfmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, "data");
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++)
    v.setInt16(
      44 + i * 2,
      Math.sin((2 * Math.PI * 440 * i) / rate) * 4000,
      true,
    );
  return new Blob([buf], { type: "audio/wav" });
}

async function fakePlay(callId: string): Promise<RecordingResult> {
  await new Promise(r => setTimeout(r, 700));
  if (callId.endsWith("3"))
    return {
      ok: false,
      message:
        "Maqsam has no recording of this call, often because nobody answered.",
    };
  return { ok: true, blob: tone() };
}

function Harness() {
  const params = new URLSearchParams(window.location.search);
  const [state, setState] = useState<HarnessState>(
    (STATES as readonly string[]).includes(params.get("state") ?? "")
      ? (params.get("state") as HarnessState)
      : "call_centre",
  );
  const range = useMemo(
    () =>
      callRange(
        params.get("clamp") === "1"
          ? { from: "2026-05-01", to: "2026-10-13" }
          : { from: "2026-09-14", to: "2026-10-13" },
        "2026-10-13",
      ),
    [params],
  );
  const read: CallsState = useMemo(() => {
    if (state === "loading") return { status: "loading" };
    if (state === "error")
      return {
        status: "error",
        message:
          "This client is not on your cockpit seat. Ask the CEO to add it.",
      };
    return {
      status: "ready",
      data: parseCallCentre(callCentreFixture(state as CallsKind)),
    };
  }, [state]);
  const byTask = useMemo(() => callersByTask(callersFixture()), []);
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-center gap-3">
        <select
          aria-label="State"
          className="rounded-md border bg-card px-2 py-1 text-sm"
          value={state}
          onChange={e => {
            const next = e.target.value as HarnessState;
            setState(next);
            const u = new URL(window.location.href);
            u.searchParams.set("state", next);
            window.history.replaceState(null, "", u);
          }}
        >
          {STATES.map(s => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground">
          Invented data. Callers on the client list and header:
        </span>
        <ClientCallerChip callers={byTask.get("task-fictional")} expected />
        <ClientCallerChip callers={byTask.get("task-two")} expected />
        <ClientCallerChip callers={[]} expected />
        <Chip dot={false}>Live</Chip>
      </div>
      <div className="space-y-1">
        <ClientCallerLine
          read={{ byTask, error: null }}
          taskId="task-fictional"
          dwy={false}
        />
        <ClientCallerLine
          read={{ byTask, error: null }}
          taskId="task-unknown"
          dwy={false}
        />
      </div>
      <ResultsParts>
        <ResultsSection
          id="results-numbers"
          title="Numbers"
          lede="The part above Calls on the Results tab."
        >
          <div className="h-24 rounded-2xl border bg-card" />
        </ResultsSection>
        <CallCentreView
          key={state}
          state={read}
          range={range}
          onRetry={() => setState("call_centre")}
          play={fakePlay}
          lostElsewhereHref="/clients/task-fictional?tab=ads"
        />
        <ResultsSection id="results-ads" title="Ads">
          <div className="h-24 rounded-2xl border bg-card" />
        </ResultsSection>
      </ResultsParts>
    </main>
  );
}

if (new URLSearchParams(window.location.search).get("theme") === "light")
  document.documentElement.classList.remove("dark");
createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <MemoryRouter>
      <Harness />
    </MemoryRouter>
  </StrictMode>,
);
