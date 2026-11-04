import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

// The RPC only returns validated findings after a run is done. Its competitor
// list is provisional until then, so the view deliberately hides it.
const optionalNumber = z.number().finite().nonnegative().nullable().optional();
const optionalText = z.string().nullable().optional();
const competitor = z.object({
  cid: z.string().regex(/^C\d{1,2}$/),
  name: z.string(),
  reserve: z.boolean(),
  placeUrl: optionalText,
  website: optionalText,
  rating: optionalNumber,
  reviewsN: optionalNumber,
  adsActiveN: optionalNumber,
  longestAdDays: optionalNumber,
  flagged: z.boolean(),
  flagReason: optionalText,
});
export const researchView = z.object({
  state: z.enum([
    "none",
    "queued",
    "claimed",
    "pulling",
    "picking",
    "writing",
    "checking",
    "publishing",
    "needs_person",
    "done",
    "failed",
    "cancelled",
  ]),
  on: z.boolean(),
  canRerun: z.boolean(),
  sentence: z.string(),
  run: z
    .object({
      id: z.string().uuid(),
      mode: z.enum(["shadow", "live"]),
      requestedAt: optionalText,
      finishedAt: optionalText,
      sourcesN: optionalNumber,
      competitorsN: optionalNumber,
      usd: optionalNumber,
      docUrl: optionalText,
    })
    .nullable()
    .optional(),
  competitors: z.array(competitor).optional(),
});
export type ResearchView = z.infer<typeof researchView>;
export type Competitor = z.infer<typeof competitor>;

/** Accept only actual HTTPS links; data returned by providers is untrusted. */
export function safeResearchUrl(
  value: string | null | undefined,
): string | null {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

type Operation = "marketIntel.view" | "marketIntel.rerun" | "marketIntel.flag";
async function call(
  client: SupabaseClient | null,
  operation: Operation,
  args: Record<string, string>,
) {
  if (!client) throw Error("Sign in to read market research.");
  const { data: before, error: sessionError } = await client.auth.getSession();
  const uid = before.session?.user.id;
  if (sessionError || !uid) throw Error("Sign in to read market research.");
  const { data, error } = await client.functions.invoke("cockpit-csm-api", {
    body: { operation, args },
  });
  const after = await client.auth.getSession();
  if (after.error || after.data.session?.user.id !== uid)
    throw Error("Your account changed. Reopen market research.");
  if (error || data?.error) {
    let detail = typeof data?.error === "string" ? data.error : "";
    if (
      !detail &&
      error &&
      "context" in error &&
      error.context instanceof Response
    ) {
      try {
        const body = await error.context.json();
        if (typeof body?.error === "string") detail = body.error;
      } catch {
        /* use the safe fallback */
      }
    }
    throw Error(detail || "Market research could not be read. Try again.");
  }
  return data;
}
export async function readResearch(
  client: SupabaseClient | null,
  taskId: string,
): Promise<ResearchView> {
  const data = await call(client, "marketIntel.view", { taskId });
  const parsed = researchView.safeParse(data);
  if (!parsed.success)
    throw Error("Market research returned an unexpected response. Try again.");
  return parsed.data;
}
export async function rerunResearch(
  client: SupabaseClient | null,
  taskId: string,
  reason: string,
) {
  const data = await call(client, "marketIntel.rerun", {
    taskId,
    reason: reason.trim(),
  });
  if (data?.ok !== true)
    throw Error(
      "The research request was not confirmed. Refresh before trying again.",
    );
}
export async function flagCompetitor(
  client: SupabaseClient | null,
  runId: string,
  cid: string,
  reason: string,
) {
  const data = await call(client, "marketIntel.flag", {
    runId,
    cid,
    reason: reason.trim(),
  });
  if (data?.ok !== true)
    throw Error("The change was not confirmed. Refresh before trying again.");
}
