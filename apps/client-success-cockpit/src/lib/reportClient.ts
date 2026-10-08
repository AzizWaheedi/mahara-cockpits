import type { SupabaseClient } from "@supabase/supabase-js";
export type ReportRequest = {
  clientName: string;
  month?: string;
  from?: string;
  to?: string;
  label?: string;
  language?: string;
  note?: string;
  extras?: string[];
};
const pending = new Map<string, string>();
export async function requestNativeReport(
  client: SupabaseClient,
  args: ReportRequest,
): Promise<{ status: string; id: string; docUrl: string }> {
  const { data: session, error: sessionError } = await client.auth.getSession();
  const actor = session.session?.user.id;
  if (sessionError || !actor) throw Error("Client-success sign-in is required");
  const key =
    actor +
    ":" +
    JSON.stringify(
      Object.fromEntries(
        Object.entries(args)
          .filter(([, v]) => v !== undefined)
          .sort(([a], [b]) => a.localeCompare(b)),
      ),
    );
  const requestId = pending.get(key) ?? crypto.randomUUID();
  pending.set(key, requestId);
  const { data, error } = await client.functions.invoke("cockpit-csm-api", {
    body: { operation: "reports.create", args, requestId, apply: true },
  });
  const current = await client.auth.getSession();
  if (current.error || current.data.session?.user.id !== actor)
    throw Error("The signed-in account changed. Reopen the report.");
  if (error || data?.error) {
    let detail = data?.error;
    if (
      !detail &&
      error &&
      "context" in error &&
      error.context instanceof Response
    ) {
      try {
        detail = (await error.context.json())?.error;
      } catch {}
    }
    if (data?.retrySafe === true) pending.delete(key);
    throw Error(
      detail ??
        error?.message ??
        "The report outcome is unavailable. Reconcile the original request.",
    );
  }
  if (
    data?.ok !== true ||
    data.status !== "ready" ||
    typeof data.id !== "string" ||
    typeof data.docUrl !== "string" ||
    !/^https:\/\/docs\.google\.com\/document\/d\/[-_A-Za-z0-9]{10,}\/edit$/.test(
      data.docUrl,
    )
  )
    throw Error("The report receipt was not confirmed");
  pending.delete(key);
  return { status: data.status, id: data.id, docUrl: data.docUrl };
}
