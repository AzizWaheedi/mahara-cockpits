/**
 * Viktor Tools - the two generic AI helpers, now served by ./tools.ts callTool().
 *
 * Available tools include:
 * - quick_ai_search: AI-powered web search with summarized results
 * - text2im: Generate images from text prompts
 * - file_to_markdown: Convert PDF/DOCX/XLSX files to markdown
 * - And all MCP integration tools configured for your user
 *
 * To add a new tool, first test it to see the response shape.
 */
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { authenticatedAction } from "./functions";

import { callTool } from "./tools";

export const quickAiSearch = authenticatedAction({
  args: { query: v.string() },
  returns: v.string(),
  handler: async (_ctx, { query }) => {
    const result = await callTool<{ search_response: string }>(
      "quick_ai_search",
      {
        search_question: query,
      },
    );
    return result.search_response;
  },
});

export const generateImage = authenticatedAction({
  args: {
    prompt: v.string(),
    aspectRatio: v.optional(
      v.union(
        v.literal("1:1"),
        v.literal("16:9"),
        v.literal("9:16"),
        v.literal("4:3"),
        v.literal("3:2"),
      ),
    ),
  },
  returns: v.string(),
  handler: async (_ctx, { prompt, aspectRatio }) => {
    const result = await callTool<{ response_text: string }>("text2im", {
      prompt,
      aspect_ratio: aspectRatio ?? "1:1",
    });
    return result.response_text;
  },
});

/** Temporary probe: confirms the gateway path works for this project. */
export const probe = internalAction({
  args: { role: v.string() },
  returns: v.any(),
  handler: async (_ctx, { role }) => {
    try {
      const r = await callTool<unknown>(role, {
        url: "https://api.clickup.com/api/v2/team",
      });
      return { ok: true, r: JSON.stringify(r).slice(0, 300) };
    } catch (e) {
      return { ok: false, error: String(e).slice(0, 500) };
    }
  },
});
