import { v } from "convex/values";
import { internalMutation } from "./_generated/server";

/**
 * Errors the cockpits flag become jobs for Hermes, not only Slack messages.
 *
 * Aziz, 2026-09-10: "make sure the AI has access to fix any errors in the
 * cockpit that they can flag, so that it can go in and fix them." Three
 * sources file here: the smoke checks (a screen threw), the CSM's "Report an
 * issue" box, and the media buyer's feedback box. Hermes picks the job up
 * through /askai like everything else; what he returns is sent to Aziz on
 * Slack by hermesDrain. Whether he can actually change code depends on what
 * he has been given: the repo, the deploy keys. REPO_URL tells him where.
 */

declare const process: { env: Record<string, string | undefined> };

const APP_DIR: Record<string, string> = {
  "media-buyer": "apps/media-buyer-cockpit",
  local: "apps/media-buyer-cockpit",
  csm: "apps/client-success-cockpit",
  "client-success": "apps/client-success-cockpit",
  creative: "apps/creative-director-cockpit",
};

const FIX_SCHEMA = {
  type: "object",
  properties: {
    status: {
      type: "string",
      enum: ["fixed", "needs_human", "not_a_code_bug"],
    },
    summary: { type: "string" },
    changes: { type: "array", items: { type: "string" } },
  },
  required: ["status", "summary"],
};

export function fixPrompt(x: {
  source: string;
  app: string;
  title: string;
  detail: string;
  page?: string;
}): string {
  const repo =
    process.env.REPO_URL ??
    "(no REPO_URL set on this deployment; the code lives at /Users/abdulazizwaheedi/mahara-cockpits on Aziz's Mac)";
  const dir = APP_DIR[x.app] ?? "apps/";
  return `You are Hermes, the engineer on call for the Mahara cockpits (three Vite + Convex apps in one repository).

A problem was flagged and you are asked to fix it if you can.

Source: ${x.source}
App: ${x.app} (folder ${dir})
Screen: ${x.page ?? "(unknown)"}
Title: ${x.title}
Detail:
${x.detail}

Repository: ${repo}
Backend deploy, from the app folder: bunx convex deploy --yes --typecheck enable
Frontend deploy, from the app folder: bun run build && bunx vercel deploy --prod --yes
Docs in the repo: SOURCES.md (where every number comes from), HOSTING.md (deployments and env).

Rules:
- Read the code before changing it. Keep the fix small and in the style of the file.
- Run the typecheck (bun run typecheck) before deploying. Never deploy something that does not compile.
- If you cannot reach the repository or deploy, do not guess: say exactly what access is missing.
- If the flag is not a code problem (data missing on a sheet, a card not filled in), say so and name the fix.

Return JSON: {"status": "fixed" | "needs_human" | "not_a_code_bug", "summary": "<what you found and did, a few sentences>", "changes": ["<file or step>", ...]}`;
}

/** File a fix job for Hermes and remember it so his answer reaches Aziz. */
export const file = internalMutation({
  args: {
    source: v.string(),
    app: v.string(),
    title: v.string(),
    detail: v.string(),
    page: v.optional(v.string()),
  },
  returns: v.id("aiJobs"),
  handler: async (ctx, args) => {
    const jobId = await ctx.db.insert("aiJobs", {
      kind: "fix_request",
      refId: `${args.source}:${args.title.slice(0, 60)}`,
      prompt: fixPrompt(args),
      schema: FIX_SCHEMA,
      status: "queued",
      tries: 0,
      createdAt: Date.now(),
    });
    await ctx.db.insert("chatRelay", {
      app: "fix",
      messageId: `${args.app} · ${args.title.slice(0, 80)}`,
      jobId: String(jobId),
      at: Date.now(),
    });
    return jobId;
  },
});
