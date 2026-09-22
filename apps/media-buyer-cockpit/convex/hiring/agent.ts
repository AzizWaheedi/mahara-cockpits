import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { rest, upsertMerge } from "../ceo/sbWrite";
import { authenticatedAction } from "../functions";
import { callTool } from "../tools";
import { type Any, ghl } from "./ghl";
import { type Role, roleByKey } from "./spec";
import { meta } from "./sync";

/**
 * The recruiting agent: it reads an application and says what it is worth.
 *
 * Aziz asked (2026-09-22) for "a recruiting agent as well, that keeps
 * self-improving and that I can use to help me headhunt". This is the first
 * half of it. It never decides anything: it proposes a score out of ten with
 * its reasons, and Aziz's own score is what counts. The difference between
 * the two is the thing that makes it better.
 *
 * How it learns, which is the whole point:
 *
 * 1. It proposes a score and the reasons, and that proposal is written to
 *    cockpit_hiring_events as an action row.
 * 2. Aziz grades the same candidate from the cockpit. That is a score row.
 * 3. `calibrate` pairs them up, keeps the ones where he disagreed by two
 *    points or more, and stores them as examples.
 * 4. Every later screening carries those examples in its prompt, so it drifts
 *    towards his taste rather than a generic idea of a good applicant.
 *
 * It reads the application from GoHighLevel, where the whole questionnaire is
 * kept as a note, so it judges what the person actually wrote and not a
 * summary of it.
 */

declare const process: { env: Record<string, string | undefined> };

/** The agent thinks, so it needs a model. Everything else here works without one. */
export function agentReady(): boolean {
  return Boolean((process.env.ANTHROPIC_API_KEY ?? "").trim());
}

const NO_KEY =
  "The recruiting agent needs ANTHROPIC_API_KEY on this deployment. Nothing else in hiring needs it: applications, the board, the scores and the messages all work without it.";

const LEARNING_KEY = "agent-calibration";
/** A disagreement smaller than this is noise, not a lesson. */
const LESSON_GAP = 2;
/** How many lessons ride in a prompt. */
const LESSONS_IN_PROMPT = 12;

type Lesson = {
  role: string;
  agentScore: number;
  azizScore: number;
  azizNote: string;
  agentReason: string;
  at: number;
};

export type Screening = {
  score: number;
  headline: string;
  strengths: string[];
  concerns: string[];
  /** Advance, look closer, or drop. Never acted on by itself. */
  recommendation: "advance" | "look closer" | "drop";
  /** What to ask them if they go through, which is the real output. */
  askThem: string[];
};

const SCHEMA = {
  type: "object",
  properties: {
    score: { type: "number" },
    headline: { type: "string" },
    strengths: { type: "array", items: { type: "string" } },
    concerns: { type: "array", items: { type: "string" } },
    recommendation: {
      type: "string",
      enum: ["advance", "look closer", "drop"],
    },
    askThem: { type: "array", items: { type: "string" } },
  },
  required: [
    "score",
    "headline",
    "strengths",
    "concerns",
    "recommendation",
    "askThem",
  ],
};

async function lessons(): Promise<Lesson[]> {
  const rows = await rest(
    `cockpit_hiring_meta?key=eq.${LEARNING_KEY}&select=value&limit=1`,
  );
  const held = rows?.[0]?.value as { lessons?: Lesson[] } | undefined;
  return held?.lessons ?? [];
}

/** The application as the candidate wrote it, from the GoHighLevel note. */
async function applicationText(contactId: string): Promise<string> {
  const r = await ghl("GET", `/contacts/${contactId}/notes`);
  if (r.status !== 200) return "";
  const notes: Any[] = r.body?.notes ?? [];
  const application = notes.find(n =>
    /^Application,/i.test(String(n.body ?? "")),
  );
  return String(application?.body ?? notes[0]?.body ?? "").slice(0, 12_000);
}

function prompt(
  role: Role,
  candidate: { name: string; country: string; years: string; arabic: string },
  application: string,
  learned: Lesson[],
): string {
  const mine = learned
    .filter(l => l.role === role.key)
    .slice(0, LESSONS_IN_PROMPT);
  const calibration = mine.length
    ? `\n\nHow Aziz has graded against you before. Move towards him.\n${mine
        .map(
          l =>
            `- You said ${l.agentScore}, he said ${l.azizScore}. Your reason: ${l.agentReason}. His note: ${l.azizNote || "(none)"}`,
        )
        .join("\n")}`
    : "";
  return `You are screening a job application for Mahara Media, a Kuwait based B2B marketing agency. Mahara runs paid ads on Meta, Snapchat and TikTok for construction and design firms across the GCC, books their leads through an Arabic speaking call centre, and manages the accounts with client success managers.

The role is ${role.label}.
What the person will do: ${role.dailyResponsibilities}
What the role pays: ${role.compensation}
What they will be judged on once hired: ${role.scorecard.join("; ")}
Where this role is usually hired from: ${role.postOn}
How long until they are useful: ${role.rampTime}

The applicant said they are in ${candidate.country || "an unstated country"}, with ${candidate.years || "an unstated number of"} years of experience${candidate.arabic ? `, Arabic: ${candidate.arabic}` : ""}.

Here is their application, as they wrote it:

${application || "(The application text could not be read. Score on what little is above and say so in your concerns.)"}

Score them out of ten on how likely they are to hold the scorecard above, not on how polished the writing is. A specific number about their own past work is worth more than any adjective. Somebody who has done this exact job in this exact market scores high; somebody with the right ambition and no evidence scores in the middle; somebody who answered in generalities scores low.

Be hard. A seven should be uncommon. Say the concerns plainly, including the ones that are only a hunch, and mark a hunch as a hunch.

askThem is the most useful thing you produce: the two or three questions that would settle whether this person is real, written so they can be read out on a call.

No em-dashes anywhere in your answer.${calibration}`;
}

/** Screen one candidate and write the proposal down. */
export async function screenOne(candidateId: string): Promise<Any> {
  if (!agentReady()) throw new Error(NO_KEY);
  const rows = await rest(
    `cockpit_hiring_candidates?id=eq.${encodeURIComponent(candidateId)}&select=*&limit=1`,
  );
  const row = rows?.[0];
  if (!row) throw new Error("That candidate is not on the board.");
  const role = roleByKey(String(row.role));
  if (!role) throw new Error(`Unknown role ${String(row.role)}`);
  const application = await applicationText(String(row.contact_id)).catch(
    () => "",
  );
  const out = (await callTool("ai_structured_output", {
    prompt: prompt(
      role,
      {
        name: String(row.name ?? ""),
        country: String(row.country ?? ""),
        years: String(row.years_experience ?? ""),
        arabic: String(row.arabic ?? ""),
      },
      application,
      await lessons(),
    ),
    output_schema: SCHEMA,
  })) as Screening;

  const score = Math.max(0, Math.min(10, Math.round(Number(out.score))));
  const detail = [
    `Agent score ${score}/10, ${out.recommendation}.`,
    out.headline,
    out.strengths.length ? `For: ${out.strengths.join("; ")}` : "",
    out.concerns.length ? `Against: ${out.concerns.join("; ")}` : "",
    out.askThem.length ? `Ask them: ${out.askThem.join(" / ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  await rest("cockpit_hiring_events", {
    method: "POST",
    body: [
      {
        candidate_id: candidateId,
        role: role.key,
        kind: "action",
        action: "agent_screen",
        to_stage: String(row.stage),
        detail,
        ok: true,
        by_whom: "the recruiting agent",
      },
    ],
    prefer: "return=minimal",
  });
  return { candidateId, name: String(row.name ?? ""), ...out, score };
}

export const screen = authenticatedAction({
  args: { candidateId: v.string() },
  returns: v.any(),
  handler: async (ctx, { candidateId }) => {
    await ctx.runQuery(internal.ceo.ltv.whoami, { userId: ctx.userId });
    return screenOne(candidateId);
  },
});

/**
 * Screen everyone sitting at Application with no score and no proposal yet.
 * Small batches, because this costs money per candidate.
 */
export async function screenQueueOnce(limit = 10): Promise<Any> {
  const waiting =
    (await rest(
      "cockpit_hiring_candidates?stage=eq.application&score_application=is.null&select=id,name,role&order=applied_at.desc&limit=200",
    )) ?? [];
  const already =
    (await rest(
      "cockpit_hiring_events?action=eq.agent_screen&select=candidate_id&limit=2000",
    )) ?? [];
  const done = new Set(already.map(r => String(r.candidate_id)));
  const todo = waiting.filter(r => !done.has(String(r.id))).slice(0, limit);
  const out: Any[] = [];
  for (const r of todo) {
    try {
      const s = await screenOne(String(r.id));
      out.push({
        name: s.name,
        score: s.score,
        recommendation: s.recommendation,
      });
    } catch (e) {
      out.push({ name: String(r.name), error: (e as Error).message });
    }
  }
  return { screened: out.length, waiting: waiting.length - done.size, out };
}

/** The same batch from the CLI, for a check or a one-off catch up. */
export const screenBatch = internalAction({
  args: { limit: v.optional(v.number()) },
  returns: v.any(),
  handler: async (_ctx, { limit }) =>
    screenQueueOnce(Math.max(1, Math.min(25, limit ?? 5))),
});

export const screenQueue = authenticatedAction({
  args: { limit: v.optional(v.number()) },
  returns: v.any(),
  handler: async (ctx, { limit }) => {
    await ctx.runQuery(internal.ceo.ltv.whoami, { userId: ctx.userId });
    return screenQueueOnce(Math.max(1, Math.min(25, limit ?? 10)));
  },
});

/**
 * Pair every proposal with the score Aziz gave afterwards and keep the
 * disagreements. This is the agent getting better, and it is the only place
 * that writes the calibration.
 */
export async function calibrateOnce(): Promise<Any> {
  const proposals =
    (await rest(
      "cockpit_hiring_events?action=eq.agent_screen&select=candidate_id,role,detail,at&order=at.desc&limit=500",
    )) ?? [];
  const human =
    (await rest(
      "cockpit_hiring_events?kind=eq.score&select=candidate_id,detail,at,by_whom&order=at.desc&limit=500",
    )) ?? [];
  const humanBy = new Map<string, Any>();
  for (const h of human)
    if (!humanBy.has(String(h.candidate_id)))
      humanBy.set(String(h.candidate_id), h);

  const learned: Lesson[] = [];
  for (const p of proposals) {
    const h = humanBy.get(String(p.candidate_id));
    if (!h) continue;
    const agentScore = Number(
      /Agent score (\d+(?:\.\d+)?)\/10/.exec(String(p.detail ?? ""))?.[1] ??
        NaN,
    );
    const azizScore = Number(
      /(\d+(?:\.\d+)?)\/10/.exec(String(h.detail ?? ""))?.[1] ?? NaN,
    );
    if (!Number.isFinite(agentScore) || !Number.isFinite(azizScore)) continue;
    if (Math.abs(agentScore - azizScore) < LESSON_GAP) continue;
    learned.push({
      role: String(p.role ?? ""),
      agentScore,
      azizScore,
      azizNote: String(h.detail ?? "")
        .split(": ")
        .slice(1)
        .join(": ")
        .slice(0, 400),
      agentReason:
        String(p.detail ?? "")
          .split("\n")[1]
          ?.slice(0, 400) ?? "",
      at: Date.parse(String(p.at)) || Date.now(),
    });
  }
  learned.sort((a, b) => b.at - a.at);
  const kept = learned.slice(0, 60);
  await upsertMerge(
    "cockpit_hiring_meta",
    [
      {
        key: LEARNING_KEY,
        value: { lessons: kept, at: Date.now() },
        updated_at: new Date().toISOString(),
      },
    ],
    "key",
  );
  const byRole: Record<string, number> = {};
  for (const l of kept) byRole[l.role] = (byRole[l.role] ?? 0) + 1;
  const bias = kept.length
    ? Math.round(
        (kept.reduce((t, l) => t + (l.azizScore - l.agentScore), 0) /
          kept.length) *
          10,
      ) / 10
    : 0;
  return {
    pairs: learned.length,
    kept: kept.length,
    byRole,
    // Positive means Aziz is kinder than the agent, negative means harsher.
    azizMinusAgent: bias,
  };
}

export const calibrate = internalAction({
  args: {},
  returns: v.any(),
  handler: async () => calibrateOnce(),
});

/** What the agent has learned so far, for the screen and for a sanity check. */
export const calibration = authenticatedAction({
  args: {},
  returns: v.any(),
  handler: async ctx => {
    await ctx.runQuery(internal.ceo.ltv.whoami, { userId: ctx.userId });
    const all = await lessons();
    const byRole: Record<string, { lessons: number; bias: number }> = {};
    for (const l of all) {
      const r = byRole[l.role] ?? { lessons: 0, bias: 0 };
      r.lessons += 1;
      r.bias += l.azizScore - l.agentScore;
      byRole[l.role] = r;
    }
    for (const k of Object.keys(byRole))
      byRole[k].bias =
        Math.round((byRole[k].bias / byRole[k].lessons) * 10) / 10;
    return { lessons: all.length, byRole, newest: all.slice(0, 8) };
  },
});

/**
 * Where to go looking for this role, and the message to send when you find
 * someone. For the headhunting half of what Aziz asked for: the agent does
 * not have a list of people, it has the search and the words.
 */
export const headhunt = authenticatedAction({
  args: { role: v.string(), note: v.optional(v.string()) },
  returns: v.any(),
  handler: async (ctx, { role: roleKey, note }) => {
    await ctx.runQuery(internal.ceo.ltv.whoami, { userId: ctx.userId });
    if (!agentReady()) throw new Error(NO_KEY);
    const role = roleByKey(roleKey);
    if (!role) throw new Error(`No role called ${roleKey}`);
    const m = await meta().catch(() => null);
    const out = (await callTool("ai_structured_output", {
      prompt: `You are helping Aziz, who runs Mahara Media, a Kuwait based B2B marketing agency selling to GCC construction and design firms, headhunt a ${role.label}.

What the person will do: ${role.dailyResponsibilities}
What it pays: ${role.compensation}
What they will be judged on: ${role.scorecard.join("; ")}
Where this role is usually hired from: ${role.postOn}
${note ? `What Aziz added: ${note}` : ""}

Give him:
- searches: five concrete searches he can run today, each naming the platform and the exact query or filter, not general advice. Prefer places where people show their work rather than their CV.
- signals: what to look for on a profile that means this person is actually good at this job, specific to this role and this market.
- disqualifiers: what to skip on sight.
- opener: one outreach message, under 90 words, written in Aziz's voice. Plain, direct, no flattery, no em-dashes, says who he is and what the job is and asks one easy question. Written to be sent cold on LinkedIn or WhatsApp.
- followUp: one message to send four days later if they do not reply, under 40 words.

No em-dashes anywhere.`,
      output_schema: {
        type: "object",
        properties: {
          searches: { type: "array", items: { type: "string" } },
          signals: { type: "array", items: { type: "string" } },
          disqualifiers: { type: "array", items: { type: "string" } },
          opener: { type: "string" },
          followUp: { type: "string" },
        },
        required: [
          "searches",
          "signals",
          "disqualifiers",
          "opener",
          "followUp",
        ],
      },
    })) as Any;
    return {
      role: role.label,
      careersUrl: role.careersUrl,
      pipelineReady: Boolean(m?.pipelines?.[role.key]),
      ...out,
    };
  },
});
