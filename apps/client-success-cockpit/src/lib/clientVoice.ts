import type { SupabaseClient } from "@supabase/supabase-js";
import { type InviteRow, inviteRow, kuwaitDayWords } from "./clientFormsCore";

/**
 * The client's voice on the client page and on Today
 * (docs/forms/WAVE34-CONTRACT.md 3.3, 3.5, 5.3, 5.4): the client's own NPS
 * and onboarding answers, their portal feedback, and the low scores a CSM
 * calls about. Read through cockpit_client_voice_read and
 * cockpit_client_voice_today (migration 20261102c); missing stays null and
 * is said, never 0. Canary and legacy answers never reach these reads.
 */

type Any = any;
type Rpc = Pick<SupabaseClient, "rpc">;

/** The source sentence under the card, as the database words it (3.3). */
export const VOICE_SOURCE =
  "From the client's own answers in the portal or by link. The 2 old Typeform answers could not be matched to a client, so they are left out.";
export const VOICE_EMPTY =
  "No answers yet. Send the NPS survey from Send a form.";
export const VOICE_FAILED =
  "The client's answers could not be read, so a score may be missing here. Reload the page; if it stays, tell the tech lead.";
/** The low-score line's default (voice.low_score.max), when the read does not carry it. */
export const LOW_SCORE_MAX = 6;

export type NpsAnswer = {
  score: number;
  results: number | null;
  communication: number | null;
  startStop: string | null;
  at: string | null;
  round: number | null;
};

export type VoiceRead = {
  nps: {
    latest: NpsAnswer | null;
    history: { score: number; at: string | null }[];
  };
  csat: {
    score: number | null;
    liked: string | null;
    disliked: string | null;
    at: string | null;
  };
  feedback: {
    kind: string | null;
    topic: string | null;
    rating: number | null;
    message: string | null;
    at: string | null;
  }[];
  open: InviteRow[];
  source: string;
  lowScoreMax: number;
};

export type LowScore = {
  responseId: string;
  taskId: string;
  clientName: string;
  formKey: "nps" | "csat";
  score: number;
  at: string | null;
  ticketOpen: boolean;
};

const text = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s : null;
};
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const obj = (v: unknown): Any =>
  v && typeof v === "object" && !Array.isArray(v) ? v : null;
const arr = (v: unknown): Any[] => (Array.isArray(v) ? v : []);

export function voiceRead(d: unknown): VoiceRead | null {
  const o = obj(d);
  if (!o) return null;
  const nps = obj(o.nps) ?? {};
  const l = obj(nps.latest);
  const csat = obj(o.csat) ?? {};
  const latestScore = num(l?.score);
  return {
    nps: {
      latest:
        l && latestScore !== null
          ? {
              score: latestScore,
              results: num(l.results),
              communication: num(l.communication),
              startStop: text(l.startStop),
              at: text(l.at),
              round: num(l.round),
            }
          : null,
      history: arr(nps.history)
        .filter(h => num(h?.score) !== null)
        .slice(0, 6)
        .map(h => ({ score: Number(h.score), at: text(h.at) })),
    },
    csat: {
      score: num(csat.score),
      liked: text(csat.liked),
      disliked: text(csat.disliked),
      at: text(csat.at),
    },
    feedback: arr(o.feedback)
      .slice(0, 5)
      .map(f => ({
        kind: text(f?.kind),
        topic: text(f?.topic),
        rating: num(f?.rating),
        message: text(f?.message),
        at: text(f?.at),
      })),
    open: arr(o.open)
      .map(inviteRow)
      .filter((r): r is InviteRow => r !== null),
    source: text(o.source) ?? VOICE_SOURCE,
    lowScoreMax: num(o.lowScoreMax) ?? LOW_SCORE_MAX,
  };
}

export function lowScores(d: unknown): LowScore[] {
  return arr(d)
    .filter(
      r =>
        r?.kind === "low_score" &&
        text(r.responseId) &&
        text(r.taskId) &&
        num(r.score) !== null,
    )
    .map(r => ({
      responseId: String(r.responseId),
      taskId: String(r.taskId),
      clientName: text(r.clientName) ?? "A client",
      formKey: r.formKey === "csat" ? "csat" : "nps",
      score: Number(r.score),
      at: text(r.at),
      ticketOpen: r.ticketOpen === true,
    }));
}

export function hasAnswers(v: VoiceRead): boolean {
  return Boolean(
    v.nps.latest ||
      v.nps.history.length ||
      v.csat.score !== null ||
      v.feedback.length,
  );
}

/** The survey a score was given on, inside a sentence. */
export const surveyWords = (formKey: string) =>
  formKey === "csat" ? "onboarding survey" : "NPS survey";

/** Today's low-score line (5.3). */
export const lowScoreLine = (
  r: Pick<LowScore, "clientName" | "score" | "formKey">,
) =>
  `Low score: ${r.clientName} gave ${r.score}/10 on the ${surveyWords(r.formKey)}`;

/** The same row under the Low scores band, without the band's own words. */
export const lowScoreRowText = (
  r: Pick<LowScore, "clientName" | "score" | "formKey">,
) => `${r.clientName} gave ${r.score}/10 on the ${surveyWords(r.formKey)}`;

/** The low-score ticket's details line (the prefilled request form, type client_low_score). */
export const lowScoreDetails = (
  r: Pick<LowScore, "clientName" | "score" | "formKey" | "at">,
) =>
  `${r.clientName} gave ${r.score}/10 on the ${surveyWords(r.formKey)} on ${kuwaitDayWords(r.at) || "a day not recorded"}. Call them today.`;

/** "Portal feedback" rows: the kind and the topic in words. */
export function feedbackWords(f: VoiceRead["feedback"][number]): string {
  const kind = f.kind ? f.kind.replace(/_/g, " ") : "Feedback";
  const topic = f.topic ? ` about ${f.topic.replace(/_/g, " ")}` : "";
  return `${kind.charAt(0).toUpperCase()}${kind.slice(1)}${topic}`;
}

/** What the brief reads: the newest NPS or onboarding score (clientBrief.ts voiceBriefLine). */
export function voiceForBrief(v: VoiceRead | null) {
  if (!v) return null;
  const out: {
    formKey: "nps" | "csat";
    score: number;
    at: string;
    max: number;
  }[] = [];
  if (v.nps.latest?.at)
    out.push({
      formKey: "nps",
      score: v.nps.latest.score,
      at: v.nps.latest.at,
      max: v.lowScoreMax,
    });
  if (v.csat.score !== null && v.csat.at)
    out.push({
      formKey: "csat",
      score: v.csat.score,
      at: v.csat.at,
      max: v.lowScoreMax,
    });
  return out;
}

export async function readVoice(
  c: Rpc | null,
  taskId: string,
): Promise<VoiceRead> {
  if (!c) throw new Error("Sign in to the cockpit, then try again.");
  const { data, error } = await c.rpc("cockpit_client_voice_read", {
    p_task_id: taskId,
  });
  if (error) throw new Error(String(error.message ?? "") || VOICE_FAILED);
  const v = voiceRead(data);
  if (!v) throw new Error(VOICE_FAILED);
  return v;
}

export async function readLowScores(c: Rpc | null): Promise<LowScore[]> {
  if (!c) throw new Error("Sign in to the cockpit, then try again.");
  const { data, error } = await c.rpc("cockpit_client_voice_today");
  if (error) throw new Error(String(error.message ?? "") || VOICE_FAILED);
  return lowScores(data);
}
