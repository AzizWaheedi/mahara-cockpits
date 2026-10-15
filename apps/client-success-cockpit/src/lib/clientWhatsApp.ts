import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";

/**
 * One client's WhatsApp on the client page: the chats linked to the client
 * (cockpit_csm_client_whatsapp, read from the inbox mirror, no GoHighLevel
 * call), what could be linked (cockpit_csm_wa_link_candidates) and the link
 * itself (cockpit_wa_link_thread, a dry run unless applied, one audit row).
 * Sending goes through comms.sendReply like the WhatsApp desk.
 */

const message = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  direction: z.enum(["inbound", "outbound"]),
  body: z.string().nullable(),
  kind: z
    .string()
    .nullable()
    .transform(k => k ?? "text"),
  speaker: z.string().nullable(),
  at: z.number(),
  status: z.string().nullable().optional(),
  today: z.boolean(),
});
const draft = z
  .object({
    ar: z.string().nullable(),
    en: z.string().nullable(),
    why: z.string().nullable(),
    sentAt: z.number().nullable().optional(),
  })
  .passthrough();
const thread = z.object({
  threadId: z.string().min(1),
  name: z.string(),
  isGroup: z.boolean(),
  archived: z.boolean(),
  awaitingUs: z.boolean().nullable().transform(Boolean),
  lastInboundAt: z.number().nullable(),
  lastAt: z.number().nullable(),
  today: z.object({ inbound: z.number(), outbound: z.number() }),
  messages: z.array(message),
  draft: draft.nullable(),
  contextKey: z.string().nullable(),
  sendSupported: z.boolean(),
  replyState: z.string().nullable(),
});
const day = z.object({
  configured: z.boolean(),
  ready: z.boolean(),
  stale: z.boolean(),
  syncedAt: z.number().nullable(),
  note: z.string().nullable(),
  dayStart: z.number(),
  taskId: z.string(),
  clientName: z.string().nullable(),
  threads: z.array(thread),
});
const card = z.object({
  threadId: z.string().min(1),
  name: z.string(),
  phoneLast4: z.string().nullable(),
  isGroup: z.boolean(),
  archived: z.boolean(),
  awaitingUs: z.boolean().nullable(),
  lastAt: z.number().nullable(),
  match: z.enum(["contact", "phone"]).optional(),
  linkedElsewhere: z.boolean().optional(),
});
const candidates = z.object({
  configured: z.boolean(),
  fullScope: z.boolean(),
  linked: z.array(card),
  matches: z.array(card),
  groups: z.array(card),
  note: z.string().nullable(),
});
const linkOutcome = z
  .object({
    threadId: z.string(),
    name: z.string(),
    linked: z.boolean(),
    changed: z.boolean(),
    ok: z.boolean(),
  })
  .passthrough();

export type ClientWhatsAppDay = z.infer<typeof day>;
export type ClientWhatsAppThread = z.infer<typeof thread>;
export type ClientWhatsAppMessage = z.infer<typeof message>;
export type LinkCandidates = z.infer<typeof candidates>;
export type LinkCard = z.infer<typeof card>;

export async function readClientWhatsApp(
  client: SupabaseClient,
  taskId: string,
): Promise<ClientWhatsAppDay> {
  const { data, error } = await client.rpc("cockpit_csm_client_whatsapp", {
    p_task_id: taskId,
  });
  if (error) throw new Error(error.message);
  return day.parse(data);
}

export async function readLinkCandidates(
  client: SupabaseClient,
  taskId: string,
  contact?: { id?: string | null; phone?: string | null },
): Promise<LinkCandidates> {
  const { data, error } = await client.rpc("cockpit_csm_wa_link_candidates", {
    p_task_id: taskId,
    p_contact_id: contact?.id ?? null,
    p_phone: contact?.phone ?? null,
  });
  if (error) throw new Error(error.message);
  return candidates.parse(data);
}

/**
 * Link or unlink one chat. The request ID is kept by the caller until the
 * answer arrives, so a retry after a dropped connection returns the first
 * outcome instead of a second audit row.
 */
export async function linkThread(
  client: SupabaseClient,
  args: {
    threadId: string;
    taskId: string;
    requestId: string;
    unlink?: boolean;
  },
) {
  z.string().uuid().parse(args.requestId);
  const { data, error } = await client.rpc("cockpit_wa_link_thread", {
    p_thread: args.threadId,
    p_task_id: args.taskId,
    p_request_id: args.requestId,
    p_apply: true,
    p_unlink: args.unlink === true,
  });
  if (error) throw new Error(error.message);
  const out = linkOutcome.parse(data);
  if (!out.ok) throw new Error("The link was not saved. Try again.");
  return out;
}

/**
 * The client's WhatsApp for the day, read once per client and again on
 * demand (after a send or a link). A late answer for a client no longer on
 * screen is dropped.
 */
export function useClientWhatsApp(
  client: SupabaseClient | null,
  taskId: string | undefined,
) {
  const [data, setData] = useState<ClientWhatsAppDay | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const seq = useRef(0);
  const load = useCallback(async () => {
    const n = ++seq.current;
    if (!client || !taskId) return;
    setLoading(true);
    try {
      const out = await readClientWhatsApp(client, taskId);
      if (n !== seq.current) return;
      setData(out);
      setError(null);
    } catch (e) {
      if (n !== seq.current) return;
      setError(e instanceof Error ? e.message : "WhatsApp could not be read.");
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, [client, taskId]);
  useEffect(() => {
    setData(null);
    setError(null);
    void load();
    return () => {
      seq.current++;
    };
  }, [load]);
  return { data, error, loading, reload: load };
}
