import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
export type CommsApp = "media-buyer" | "client-success" | "creative";
const appSchema = z.enum(["media-buyer", "client-success", "creative"]);
const record = z.record(z.string(), z.unknown());
const messageSchema = z
  .object({
    direction: z.enum(["inbound", "outbound"]),
    body: z.string().nullable(),
    kind: z.string(),
    speaker: z.string().nullable(),
    at: z.string().min(1),
  })
  .passthrough();
const draftSchema = z
  .object({
    ar: z.string().nullable(),
    en: z.string().nullable(),
    why: z.string().nullable(),
    sent_at: z.string().nullable(),
    sent_by: z.string().nullable(),
  })
  .passthrough();
const threadSchema = z
  .object({
    id: z.string().min(1),
    contact_name: z.string().nullable(),
    phone: z.string().nullable(),
    is_group: z.boolean(),
    desk: z.enum(["csm", "ads", "creative"]),
    last_inbound_at: z.string().nullable(),
    draft: draftSchema.nullable(),
    messages: z.array(messageSchema),
    contextKey: z.string().regex(/^[0-9a-f]{32}$/),
    sendSupported: z.boolean(),
    replyState: z.string().nullable(),
  })
  .passthrough();
const inboxSchema = z.object({
  configured: z.boolean(),
  ready: z.boolean(),
  sourceNote: z.string().nullable(),
  syncedAt: z.number().nullable(),
  totalAwaiting: z.number().int().nonnegative().nullable(),
  threads: z.array(threadSchema),
});
const overviewSchema = z.object({
  today: z.array(record),
  upcoming: z.array(record),
  nextCall: z.array(record),
  myCalendar: record.nullable(),
  bindingRevision: z.number().int().nonnegative(),
  saEmail: z.string().nullable(),
  calendarConfigured: z.boolean(),
  calendarReady: z.boolean(),
  sourceNote: z.string().nullable(),
  syncedAt: z.number().nullable(),
  threads: z.array(record),
  whatsappConfigured: z.boolean(),
  whatsappReady: z.boolean(),
  whatsappNote: z.string().nullable(),
  whatsappSyncedAt: z.number().nullable(),
});
const intentSchema = z
  .object({
    id: z.string().uuid(),
    app: appSchema,
    chatId: z.string().min(1),
    text: z.string().min(1).max(4000),
    contextKey: z.string().regex(/^[0-9a-f]{32}$/),
  })
  .strict();
type Intent = z.infer<typeof intentSchema>;
const pending = new Map<string, Intent>();
async function accountGuard(client: SupabaseClient) {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user)
    throw new Error("Sign in again before using meetings or messages.");
  const id = data.user.id;
  let changed = false;
  const subscription = client.auth.onAuthStateChange((_event, session) => {
    if (session?.user.id !== id) changed = true;
  }).data.subscription;
  return {
    id,
    check: async () => {
      const session = await client.auth.getSession();
      if (changed || session.error || session.data.session?.user.id !== id)
        throw new Error(
          "The signed-in account changed. This response was discarded. Reload the view.",
        );
    },
    release: () => subscription.unsubscribe(),
  };
}
export async function nativeCommsOverview(
  client: SupabaseClient,
  app: CommsApp,
) {
  appSchema.parse(app);
  const guard = await accountGuard(client);
  try {
    await guard.check();
    const { data, error } = await client.rpc("cockpit_comms_overview", {
      p_app: app,
    });
    await guard.check();
    if (error) throw new Error(error.message);
    return overviewSchema.parse(data);
  } finally {
    guard.release();
  }
}
export async function nativeWaInbox(client: SupabaseClient, app: CommsApp) {
  appSchema.parse(app);
  const guard = await accountGuard(client);
  try {
    await guard.check();
    const { data, error } = await client.rpc("cockpit_wa_inbox", {
      p_app: app,
    });
    await guard.check();
    if (error) throw new Error(error.message);
    return inboxSchema.parse(data);
  } finally {
    guard.release();
  }
}
export async function nativeWaReply(
  client: SupabaseClient,
  app: CommsApp,
  args: { chatId: string; text: string; contextKey: string },
  options: { apply?: boolean; requestId?: string } = {},
): Promise<{
  ok: boolean;
  dryRun?: boolean;
  state?: "accepted" | "delivered";
  deliveryConfirmed?: boolean;
  providerMessageId?: string;
}> {
  appSchema.parse(app);
  z.string().min(1).max(4000).parse(args.text);
  z.string()
    .regex(/^[0-9a-f]{32}$/)
    .parse(args.contextKey);
  const guard = await accountGuard(client);
  try {
    const bytes = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
        JSON.stringify([app, args.chatId, args.text, args.contextKey]),
      ),
    );
    const key = `cockpit-wa-intent:${guard.id}:${Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("")}`;
    let storage: Storage | undefined;
    try {
      if (typeof window !== "undefined") storage = window.localStorage;
    } catch {}
    let intent = pending.get(key);
    if (!intent) {
      let saved: string | null = null;
      try {
        saved = storage?.getItem(key) ?? null;
      } catch {
        storage = undefined;
      }
      if (saved) intent = intentSchema.parse(JSON.parse(saved));
      else {
        if (options.apply === true && !storage && !options.requestId)
          throw new Error(
            "Without durable browser storage, retain the original reply requestId before submitting.",
          );
        intent = intentSchema.parse({
          id: options.requestId ?? crypto.randomUUID(),
          app,
          ...args,
        });
        if (options.apply === true) {
          storage?.setItem(key, JSON.stringify(intent));
          pending.set(key, intent);
        }
      }
    }
    if (
      intent.app !== app ||
      intent.chatId !== args.chatId ||
      intent.text !== args.text ||
      intent.contextKey !== args.contextKey
    )
      throw new Error(
        "The saved reply intent does not match the reviewed conversation. Reconcile it first.",
      );
    if (options.requestId && intent.id !== options.requestId)
      throw new Error(
        "An uncertain reply already exists. Retry its original request ID.",
      );
    await guard.check();
    const { data, error } = await client.functions.invoke("cockpit-media-api", {
      body: {
        operation: "comms.sendReply",
        args: {
          app,
          chatId: intent.chatId,
          text: intent.text,
          contextKey: intent.contextKey,
          requestId: intent.id,
          apply: options.apply === true,
        },
      },
    });
    await guard.check();
    if (error)
      throw new Error(
        "The reply result is unavailable. Retain the original request ID and reconcile before retrying.",
      );
    const result = record.parse(data);
    if (result.ok !== true) {
      if (options.apply !== true && result.dryRun === true)
        return { ok: false, dryRun: true };
      throw new Error(
        typeof result.error === "string"
          ? result.error
          : "The reply was not confirmed. Reconcile its original request ID.",
      );
    }
    if (
      result.id !== intent.id ||
      (result.state !== "accepted" && result.state !== "delivered") ||
      typeof result.providerMessageId !== "string" ||
      !result.providerMessageId
    )
      throw new Error(
        "The reply returned no matching provider receipt. Reconcile its original request ID.",
      );
    if (result.deliveryConfirmed !== (result.state === "delivered"))
      throw new Error(
        "The reply delivery state is inconsistent. Reconcile the provider receipt.",
      );
    if (pending.get(key)?.id === intent.id) pending.delete(key);
    try {
      const saved = storage?.getItem(key);
      if (saved && intentSchema.parse(JSON.parse(saved)).id === intent.id)
        storage?.removeItem(key);
    } catch {}
    return {
      ok: true,
      state: result.state,
      deliveryConfirmed: result.deliveryConfirmed === true,
      providerMessageId: result.providerMessageId,
    };
  } finally {
    guard.release();
  }
}
export async function nativeWaArchive(
  client: SupabaseClient,
  app: CommsApp,
  threadId: string,
  contextKey: string,
  requestId: string,
  apply = false,
) {
  appSchema.parse(app);
  z.string().uuid().parse(requestId);
  z.string()
    .regex(/^[0-9a-f]{32}$/)
    .parse(contextKey);
  const guard = await accountGuard(client);
  try {
    await guard.check();
    const { data, error } = await client.rpc("cockpit_wa_archive", {
      p_app: app,
      p_thread: threadId,
      p_archived: true,
      p_context_key: contextKey,
      p_request_id: requestId,
      p_apply: apply,
    });
    await guard.check();
    if (error) throw new Error(error.message);
    const result = record.parse(data);
    if (
      apply
        ? result.ok !== true || result.id !== requestId
        : result.ok !== false || result.dryRun !== true
    )
      throw new Error(
        "The archive returned no matching receipt. Retain its original request ID.",
      );
    return result;
  } finally {
    guard.release();
  }
}
