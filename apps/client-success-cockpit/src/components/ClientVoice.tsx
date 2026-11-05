/* Hallmark · component: Client voice card · genre: modern-minimal · theme: the cockpit's own (Geist, --mahara-teal)
 * states: loading · empty · failed · filled (low score in red ink, never colour alone)
 * Hallmark · pre-emit critique: P4 H4 E4 S4 R5 V4
 */

import { useEffect, useState } from "react";
import { Dot, SectionCard } from "@/components/kit";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { kuwaitDayWords } from "@/lib/clientFormsCore";
import {
  feedbackWords,
  hasAnswers,
  VOICE_EMPTY,
  VOICE_FAILED,
  type VoiceRead,
} from "@/lib/clientVoice";
import { cn } from "@/lib/utils";

/**
 * The client's voice on the client page (docs/forms/WAVE34-CONTRACT.md 5.4):
 * their newest NPS answer with its two side scores and their start/stop
 * text, a six-dot history in Geist Mono, the onboarding score with what
 * they liked and disliked, their last five portal feedback rows, and the
 * source sentence. Every score is the client's own; nothing is averaged
 * here and nothing missing reads as 0.
 */

export type VoiceState =
  | { status: "loading" }
  | { status: "failed"; error: string }
  | { status: "ready"; voice: VoiceRead };

/** One client's voice, read when the door is open (cockpit_client_voice_read). */
export function useClientVoice(
  read: ((taskId: string) => Promise<VoiceRead>) | null,
  taskId: string | null,
  on: boolean,
  version = 0,
): VoiceState | null {
  const [state, setState] = useState<VoiceState | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: version reads again
  useEffect(() => {
    if (!read || !taskId || !on) {
      setState(null);
      return;
    }
    let live = true;
    setState({ status: "loading" });
    read(taskId)
      .then(voice => live && setState({ status: "ready", voice }))
      .catch(
        e =>
          live &&
          setState({
            status: "failed",
            error: String((e as Error)?.message ?? e) || VOICE_FAILED,
          }),
      );
    return () => {
      live = false;
    };
  }, [read, taskId, on, version]);
  return state;
}

const scoreInk = (score: number, max: number) =>
  score <= max ? "txt-bad" : score >= 9 ? "text-primary-ink" : "";

function History({
  rows,
  max,
}: {
  rows: VoiceRead["nps"]["history"];
  max: number;
}) {
  if (!rows.length) return null;
  const oldestFirst = [...rows].reverse();
  return (
    <ol
      className="flex flex-wrap items-end gap-2 font-mono text-[11px]"
      aria-label={`NPS history: ${oldestFirst.map(h => `${h.score} on ${kuwaitDayWords(h.at) || "a day not recorded"}`).join(", ")}`}
      data-history
    >
      {oldestFirst.map((h, n) => (
        <li
          key={`${h.at}:${n}`}
          className="flex flex-col items-center gap-1"
          aria-hidden
        >
          <span
            className={cn(
              "grid size-6 place-items-center rounded-full border text-[11px] tabular-nums",
              h.score <= max
                ? "border-destructive text-destructive"
                : h.score >= 9
                  ? "border-mahara-teal bg-mahara-teal text-deep-space"
                  : "border-border",
            )}
          >
            {h.score}
          </span>
          <span className="text-[10px] text-muted-foreground">
            {kuwaitDayWords(h.at)}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function ClientVoiceCard({ state }: { state: VoiceState | null }) {
  if (!state) return null;
  const v = state.status === "ready" ? state.voice : null;
  return (
    <section id="client-voice" className="scroll-mt-20" data-client-voice>
      <SectionCard title="Client voice">
        {state.status === "loading" ? (
          <LoadingSkeleton variant="detail" label="Reading their answers" />
        ) : null}
        {state.status === "failed" ? (
          <p className="flex gap-2 text-sm" role="note">
            <span className="flex h-5 shrink-0 items-center">
              <Dot tone="warn" />
            </span>
            <span className="min-w-0">{VOICE_FAILED}</span>
          </p>
        ) : null}
        {v && !hasAnswers(v) ? (
          <p className="text-sm text-muted-foreground" data-empty>
            {VOICE_EMPTY}
          </p>
        ) : null}
        {v && hasAnswers(v) ? (
          <div className="space-y-5">
            {v.nps.latest ? (
              <div className="space-y-2" data-nps>
                <p className="text-sm">
                  <span className="text-xs text-muted-foreground">NPS </span>
                  <span
                    className={cn(
                      "font-mono font-semibold",
                      scoreInk(v.nps.latest.score, v.lowScoreMax),
                    )}
                  >
                    {v.nps.latest.score}/10
                  </span>{" "}
                  would recommend ·{" "}
                  <span className="font-mono">
                    {kuwaitDayWords(v.nps.latest.at) || "a day not recorded"}
                  </span>
                  {v.nps.latest.score <= v.lowScoreMax ? (
                    <span className="txt-bad"> · low score: call them</span>
                  ) : null}
                </p>
                {v.nps.latest.results !== null ||
                v.nps.latest.communication !== null ? (
                  <p className="text-xs text-muted-foreground">
                    {[
                      v.nps.latest.results !== null
                        ? `Results so far ${v.nps.latest.results}/10`
                        : null,
                      v.nps.latest.communication !== null
                        ? `Communication ${v.nps.latest.communication}/10`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                ) : null}
                {v.nps.latest.startStop ? (
                  <p className="rounded-lg bg-muted/40 px-3 py-2 text-sm">
                    <bdi dir="auto">{v.nps.latest.startStop}</bdi>
                  </p>
                ) : null}
                <History rows={v.nps.history} max={v.lowScoreMax} />
              </div>
            ) : null}
            {v.csat.score !== null ? (
              <div className="space-y-1.5" data-csat>
                <p className="text-sm">
                  <span className="text-xs text-muted-foreground">
                    Onboarding{" "}
                  </span>
                  <span
                    className={cn(
                      "font-mono font-semibold",
                      scoreInk(v.csat.score, v.lowScoreMax),
                    )}
                  >
                    {v.csat.score}/10
                  </span>{" "}
                  ·{" "}
                  <span className="font-mono">
                    {kuwaitDayWords(v.csat.at) || "a day not recorded"}
                  </span>
                </p>
                {v.csat.liked ? (
                  <p className="text-xs">
                    <span className="text-muted-foreground">Liked: </span>
                    <bdi dir="auto">{v.csat.liked}</bdi>
                  </p>
                ) : null}
                {v.csat.disliked ? (
                  <p className="text-xs">
                    <span className="text-muted-foreground">
                      Could be better:{" "}
                    </span>
                    <bdi dir="auto">{v.csat.disliked}</bdi>
                  </p>
                ) : null}
              </div>
            ) : null}
            {v.feedback.length ? (
              <div className="space-y-1.5" data-feedback>
                <p className="text-xs font-medium text-muted-foreground">
                  Portal feedback
                </p>
                <ul className="divide-y rounded-xl border">
                  {v.feedback.map((f, n) => (
                    <li key={`${f.at}:${n}`} className="space-y-0.5 px-3 py-2">
                      <p className="text-xs">
                        <span className="font-medium">{feedbackWords(f)}</span>
                        <span className="text-muted-foreground">
                          {" "}
                          ·{" "}
                          <span className="font-mono">
                            {kuwaitDayWords(f.at)}
                          </span>
                          {f.rating !== null ? (
                            <span className="font-mono"> · {f.rating}/5</span>
                          ) : null}
                        </span>
                      </p>
                      {f.message ? (
                        <p className="line-clamp-2 text-xs text-muted-foreground">
                          <bdi dir="auto">{f.message}</bdi>
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
        {v ? (
          <p
            className="mt-4 text-[11px] leading-4 text-muted-foreground"
            data-source
          >
            {v.source}
          </p>
        ) : null}
      </SectionCard>
    </section>
  );
}
