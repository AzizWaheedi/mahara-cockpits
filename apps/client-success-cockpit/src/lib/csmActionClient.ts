import type { SupabaseClient } from "@supabase/supabase-js";
import type { PortalTask } from "./portalTasksCore";
export type ClientPortalTasks = {
  clientName: string;
  tag: string | null;
  formUrl: string;
  tasks: PortalTask[];
};
const pending = new Map<string, string>();
export async function executeCsmAction(
  client: SupabaseClient | null,
  operation: "act" | "plan",
  args: Record<string, unknown>,
) {
  if (!client) throw Error("Client-success sign-in is required");
  const { data: auth } = await client.auth.getSession();
  const actor = auth.session?.user.id;
  if (!actor) throw Error("Client-success sign-in is required");
  const key = actor + ":" + operation + ":" + JSON.stringify(args);
  const requestId = pending.get(key) ?? crypto.randomUUID();
  pending.set(key, requestId);
  const { data, error } = await client.functions.invoke("cockpit-csm-api", {
    body: { operation, args, requestId, apply: true },
  });
  if (error || data?.error) {
    let detail = data?.error;
    if (!detail && typeof (error as any)?.context?.json === "function")
      try {
        detail = (await (error as any).context.json())?.error;
      } catch {}
    throw Error(detail ?? error?.message ?? "Client-success action failed");
  }
  if (data?.ok !== true || typeof data.receiptId !== "string")
    throw Error("ClickUp did not confirm this action");
  pending.delete(key);
  return data;
}

export async function readCsmPortalTasks(
  client: SupabaseClient | null,
  args: { taskId: string },
): Promise<ClientPortalTasks> {
  if (!client) throw Error("Client-success sign-in is required");
  const { data: auth } = await client.auth.getSession();
  const actor = auth.session?.user.id;
  if (!actor) throw Error("Client-success sign-in is required");
  const { data, error } = await client.functions.invoke("cockpit-csm-api", {
    body: {
      operation: "portalTasks.forClient",
      args,
      requestId: crypto.randomUUID(),
      apply: false,
    },
  });
  const current = await client.auth.getSession();
  if (current.error || current.data.session?.user.id !== actor)
    throw Error("The signed-in account changed. Reopen portal tasks.");
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
      } catch {
        detail = error.message;
      }
    }
    throw Error(
      detail ?? error?.message ?? "The portal tasks could not be read",
    );
  }
  return data;
}
