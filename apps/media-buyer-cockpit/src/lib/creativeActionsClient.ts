import type { SupabaseClient } from "@supabase/supabase-js";

const canonical = (value: any): string =>
  JSON.stringify(
    value && typeof value === "object"
      ? Array.isArray(value)
        ? value.map(v => JSON.parse(canonical(v)))
        : Object.fromEntries(
            Object.keys(value)
              .sort()
              .filter(k => value[k] !== undefined)
              .map(k => [k, JSON.parse(canonical(value[k]))]),
          )
      : (value ?? null),
  );

export type CreativeRequest = {
  id: string;
  campaign_name: string;
  client_name: string;
  status: string;
  feedback_error: string | null;
  feedback_posted_at: string | null;
  [key: string]: unknown;
};
export async function listCreativeRequests(
  client: SupabaseClient,
  args: { campaignName?: string } = {},
): Promise<CreativeRequest[]> {
  const { data, error } = await client.rpc("cockpit_creative_requests_list", {
    p_campaign: args.campaignName ?? null,
  });
  if (error) throw new Error(error.message);
  if (!Array.isArray(data))
    throw new Error("Creative requests could not be loaded.");
  return data;
}
export async function reviewCreativeRequest(
  client: SupabaseClient,
  args: {
    id: string;
    campaignName: string;
    verdict: "worked" | "needs_another_version" | "stop";
    note?: string;
  },
): Promise<CreativeRequest> {
  const { data, error } = await client.rpc("cockpit_creative_request_review", {
    p_id: args.id,
    p_campaign: args.campaignName,
    p_verdict: args.verdict,
    p_note: args.note ?? null,
  });
  if (error) throw new Error(error.message);
  if (!data?.id) throw new Error("The creative assessment was not confirmed.");
  if (data.feedback_posted_at) return data;
  try {
    return await creativeProviderAction(
      client,
      "retryFeedback",
      { id: args.id, campaignName: args.campaignName },
      true,
    );
  } catch (error) {
    return {
      ...data,
      feedback_error: `Assessment saved; feedback was not confirmed: ${error instanceof Error ? error.message : "Check ClickUp before retrying."}`,
    };
  }
}

export async function creativeProviderAction(
  client: SupabaseClient,
  operation: "request" | "linkLaunch" | "retryFeedback",
  args: Record<string, unknown>,
  apply = false,
) {
  const { data: auth, error: authError } = await client.auth.getUser();
  if (authError || !auth.user) throw new Error("Sign in again");
  const hash = Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(canonical([operation, args])),
      ),
    ),
  )
    .map(x => x.toString(16).padStart(2, "0"))
    .join("");
  const key = `cockpit-creative-intent:${auth.user.id}:${hash}`;
  let requestId: string | undefined;
  if (apply) {
    requestId = localStorage.getItem(key) ?? crypto.randomUUID();
    localStorage.setItem(key, requestId);
  }
  const { data, error } = await client.functions.invoke(
    "cockpit-creative-api",
    { body: { operation, args, apply, requestId } },
  );
  if (error) {
    const response = (error as { context?: Response }).context;
    if (response) {
      let detail: any;
      try {
        detail = await response.json();
      } catch {
        /* Keep transport error. */
      }
      if (detail?.error) throw new Error(detail.error);
    }
    throw new Error(error.message);
  }
  if (data?.ok === false)
    throw new Error(data.error ?? "The creative action was not confirmed.");
  if (apply) {
    if (!data?.id) throw new Error("The creative request was not confirmed.");
    localStorage.removeItem(key);
  }
  return data;
}
