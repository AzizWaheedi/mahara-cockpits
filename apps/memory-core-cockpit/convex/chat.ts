import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action } from "./_generated/server";
import { requireOperator } from "./gate";
import { drainNotes } from "./health";
import { retrieveContext } from "./search";
import { SOURCE_SEARCH_NOTE } from "./sources";
import { writeAnswer } from "./tools";

/**
 * Ask: a question in, a grounded answer out.
 *
 * The answer is written only from the numbered excerpts a search just found.
 * Three things keep it honest:
 *
 *   1. Nothing relevant found → no model call at all, and the answer says so.
 *   2. The prompt forbids filling gaps, and forbids general knowledge.
 *   3. Every number the model uses is checked against the excerpts before the
 *      answer is stored, so a made-up citation is called out on the screen
 *      instead of passing as a source.
 */

const NOT_FOUND = "I don't have that in your connected sources.";

const SYSTEM = [
  "You answer questions about one person's own material: their Notion pages, their Gmail, their Google Drive, and memories they saved in this app.",
  "The excerpts below are the only thing you may use.",
  "Rules:",
  "1. Every claim must come from an excerpt and must carry that excerpt's number in square brackets, like [2].",
  "2. If the excerpts do not contain the answer, reply with exactly this sentence and nothing else: " +
    NOT_FOUND,
  "3. Never use general knowledge, and never guess at a name, a date, an amount or a client. If an excerpt only partly answers, give the part it answers and say what is missing.",
  "4. Answer in plain, active sentences. Lead with the answer, not with a restatement of the question. No preamble, no sign-off.",
  "5. Keep it under 200 words unless the question asks for a list; when it does, use short bullet lines.",
  "6. If the excerpts disagree, say so.",
].join("\n");

/** What Ask hands back to the screen. Annotated so the action's own type can resolve. */
export type AskResult = {
  chatId: Id<"memory_chats">;
  answer: string;
  citations: {
    n: number;
    source: string;
    title: string;
    externalId: string;
    url?: string;
    snippet: string;
  }[];
  grounded: boolean;
  model: string;
  /** The excerpt numbers the answer actually used, deduped. */
  used: number[];
  warnings: string[];
  retrieval: {
    perSource: { source: string; count: number; ok: boolean; note: string }[];
    indexed: number;
    usedLive: boolean;
    tookMs: number;
    error: string | null;
  };
};

export const ask = action({
  args: {
    code: v.optional(v.string()),
    question: v.string(),
    /** Continue an existing conversation, or start a new one. */
    chatId: v.optional(v.id("memory_chats")),
    /** false answers from the index alone, without calling the sources live. */
    live: v.optional(v.boolean()),
    /** How many results to ground the answer in. */
    groundWith: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<AskResult> => {
    const actor = requireOperator(args.code);
    const question = args.question.trim();
    if (question.length < 3) {
      throw new Error("Write a question first — a few words is enough.");
    }

    const retrieval = await retrieveContext(ctx, {
      query: question,
      actor,
      per: args.groundWith ?? 8,
      live: args.live,
      via: "asked",
    });

    const grounded = retrieval.results.slice(0, args.groundWith ?? 8);

    // Nothing to stand on: say so plainly instead of asking a model to guess.
    if (grounded.length === 0) {
      const searched = retrieval.perSource
        .map(result => `· ${result.note}`)
        .join("\n");
      const answer =
        `${NOT_FOUND} I looked at ${retrieval.perSource.length} sources and nothing matched "${question}".\n\n${searched}\n\n` +
        "Try different words, check the source's own search rules below, or save it as a memory so it is here next time.";
      const { chatId } = await ctx.runMutation(internal.memory.saveTurn, {
        chatId: args.chatId,
        question,
        answer,
        citations: [],
        grounded: false,
        model: "no model called",
        actor,
      });
      await ctx.runMutation(internal.health.record, { rows: drainNotes() });
      return {
        chatId,
        answer,
        citations: [],
        grounded: false,
        model: "no model called",
        used: [] as number[],
        warnings: [
          retrieval.error ??
            "Nothing in the connected sources matched this question.",
        ],
        retrieval: retrievalSummary(retrieval),
      };
    }

    const citations = grounded.map((item, index) => ({
      n: index + 1,
      source: item.source,
      title: item.title,
      externalId: item.externalId,
      url: item.url ?? undefined,
      snippet: item.snippet,
    }));

    const excerpts = citations
      .map(
        citation =>
          `[${citation.n}] ${labelOf(citation.source)} · ${dateOf(
            grounded[citation.n - 1].occurredAt,
          )}\n${citation.title}\n${citation.snippet}`,
      )
      .join("\n\n");

    const prompt = `Question: ${question}\n\nExcerpts from the connected sources:\n\n${excerpts}`;

    let answer: string;
    let model: string;
    try {
      const written = await writeAnswer(SYSTEM, prompt, 1200);
      answer = written.text || NOT_FOUND;
      model = written.model;
    } catch (e) {
      // The search worked but the writer did not: hand back the sources rather
      // than nothing, and say which part failed.
      await ctx.runMutation(internal.health.record, { rows: drainNotes() });
      throw new Error(
        `The sources answered but the answer could not be written: ${String(e).slice(0, 200)}`,
      );
    }

    const used = [...answer.matchAll(/\[(\d+)\]/g)].map(match =>
      Number(match[1]),
    );
    const warnings: string[] = [];
    const outOfRange = used.filter(n => n < 1 || n > citations.length);
    if (outOfRange.length) {
      warnings.push(
        `The answer pointed at excerpt ${outOfRange.join(", ")} which was not in the sources — treat that part with care.`,
      );
    }
    if (!used.length && !answer.includes(NOT_FOUND)) {
      warnings.push(
        "The answer did not name an excerpt, so nothing in it is tied to a source.",
      );
    }
    if (answer.includes(NOT_FOUND)) warnings.push(NOT_FOUND);

    const saved = await ctx.runMutation(internal.memory.saveTurn, {
      chatId: args.chatId,
      question,
      answer,
      citations,
      grounded: true,
      model,
      actor,
    });
    await ctx.runMutation(internal.health.record, { rows: drainNotes() });

    return {
      chatId: saved.chatId,
      answer,
      citations,
      grounded: true,
      model,
      used: [...new Set(used)].sort((a, b) => a - b),
      warnings,
      retrieval: retrievalSummary(retrieval),
    };
  },
});

function retrievalSummary(retrieval: {
  perSource: { source: string; count: number; note: string; ok: boolean }[];
  indexed: { inserted: number };
  usedLive: boolean;
  tookMs: number;
  error: string | null;
}) {
  return {
    perSource: retrieval.perSource.map(result => ({
      source: result.source,
      count: result.count,
      ok: result.ok,
      note: result.note || SOURCE_SEARCH_NOTE[result.source] || "",
    })),
    indexed: retrieval.indexed.inserted,
    usedLive: retrieval.usedLive,
    tookMs: retrieval.tookMs,
    error: retrieval.error,
  };
}

function labelOf(source: string): string {
  if (source === "gmail") return "Gmail";
  if (source === "drive") return "Google Drive";
  if (source === "notion") return "Notion";
  return "A memory you saved";
}

function dateOf(ms: number): string {
  if (!ms) return "date unknown";
  return new Date(ms).toISOString().slice(0, 10);
}
