import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { FormKey, FormSend } from "./formConfig";

/**
 * The two gated calls behind the form panel (supabase/migrations/
 * 20261023a_csm_form_sends.sql): note a send, read the sends. Both go
 * through the signed-in seat's own client, so cockpit_csm_client_gate
 * decides, and the server re-checks every argument: the form ID is its own
 * constant, the carried ID must be the card's, and "second" is its call.
 * The same sign-in guard as onboardingClient.ts: a read that finishes after
 * the account changed is thrown away.
 */

export type FormClient = Pick<SupabaseClient, "rpc" | "auth">;

const send = z.object({
  responseId: z.string(),
  formKey: z.enum(["kickoff", "blueprint", "checkin"]),
  formId: z.string(),
  taskId: z.string(),
  clientName: z.string(),
  hiddenKeys: z.array(z.string()),
  second: z.boolean(),
  sentBy: z.string().nullable(),
  sentAt: z.string(),
});
const sent = z.object({ send, noted: z.boolean() });
const sends = z.object({ sends: z.array(send), now: z.string() });

async function guard(client: FormClient) {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user)
    throw Error("Sign in to the cockpit, then try again.");
  const uid = data.user.id;
  let changed = false;
  const sub = client.auth.onAuthStateChange((_event, session) => {
    if (session?.user.id !== uid) changed = true;
  }).data.subscription;
  return {
    check: async () => {
      const current = await client.auth.getSession();
      if (changed || current.error || current.data.session?.user.id !== uid)
        throw Error("The signed-in account changed. Reload this window.");
    },
    release: () => sub.unsubscribe(),
  };
}

/** The server's words, or a plain sentence when the backend is not live yet. */
function said(message: string): string {
  if (/could not find the function|PGRST202|does not exist/i.test(message))
    return "The cockpit's form record is not live yet.";
  return message;
}

export interface SendInput {
  taskId: string;
  formKey: FormKey;
  responseId: string;
  hiddenKeys: string[];
  hiddenSha256: string;
  /** The ID the form carried in its hidden field. */
  carriedId: string;
}

/** Notes one Typeform response. Safe to repeat: the response ID is the key. */
export async function recordFormSend(
  client: FormClient | null,
  input: SendInput,
): Promise<{ send: FormSend; noted: boolean }> {
  if (!client) throw Error("Sign in to the cockpit, then try again.");
  const actor = await guard(client);
  try {
    await actor.check();
    const { data, error } = await client.rpc("cockpit_csm_form_sent", {
      p_task_id: input.taskId,
      p_form_key: input.formKey,
      p_response_id: input.responseId,
      p_hidden_keys: input.hiddenKeys,
      p_hidden_sha256: input.hiddenSha256,
      p_carried_id: input.carriedId,
    });
    await actor.check();
    if (error) throw Error(said(error.message));
    const parsed = sent.safeParse(data);
    if (!parsed.success) throw Error("The server did not confirm the note.");
    return parsed.data;
  } finally {
    actor.release();
  }
}

/** This client's newest sends of one form, with the server's clock. */
export async function readFormSends(
  client: FormClient | null,
  taskId: string,
  formKey: FormKey,
): Promise<{ sends: FormSend[]; now: string }> {
  if (!client) throw Error("Sign in to the cockpit, then try again.");
  const actor = await guard(client);
  try {
    await actor.check();
    const { data, error } = await client.rpc("cockpit_csm_form_sends_read", {
      p_task_id: taskId,
      p_form_key: formKey,
    });
    await actor.check();
    if (error) throw Error(said(error.message));
    const parsed = sends.safeParse(data);
    if (!parsed.success)
      throw Error(
        "The form record came back in a shape this page does not read.",
      );
    return parsed.data;
  } finally {
    actor.release();
  }
}
