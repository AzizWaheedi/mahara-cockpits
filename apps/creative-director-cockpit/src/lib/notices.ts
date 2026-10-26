import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

/**
 * The client success cockpit's Slack notices, as the creative director's
 * Blueprint card reads them (docs/forms/STAGE1-CONTRACT.md 2.1 and 6.2):
 * cockpit_slack_notice_read only, gated for a creative seat on its own
 * clients. Never a notice's text or facts; nothing here writes. The
 * settings live in the client success cockpit (Settings, Notices and
 * routing), so this app only reads.
 */

type Rpc = Pick<SupabaseClient, "rpc">;

const nul = <T extends z.ZodType>(s: T) =>
  s.nullish().transform(v => (v ?? null) as z.output<T> | null);

const view = z.object({
  id: z.string(),
  kind: z.string(),
  state: z.enum([
    "queued",
    "sending",
    "posted",
    "failed",
    "unknown",
    "skipped",
    "muted",
  ]),
  variant: nul(z.string()),
  responseId: nul(z.string()),
  outboxId: nul(z.string()),
  parentKind: nul(z.string()),
  channel: nul(z.object({ id: z.string(), name: nul(z.string()) })),
  at: z.string(),
  dueAt: nul(z.string()),
  permalink: nul(z.string()),
  reason: nul(z.string()),
});
const read = z.object({
  taskId: z.string(),
  now: z.string(),
  notices: z.array(view),
});

export type NoticeView = z.infer<typeof view>;
export type NoticeRead = z.infer<typeof read>;

export async function readNotices(
  client: Rpc,
  taskId: string,
): Promise<NoticeRead> {
  const { data, error } = await client.rpc("cockpit_slack_notice_read", {
    p_task_id: taskId,
  });
  if (error) {
    const m = String(error.message ?? "").trim();
    throw new Error(
      /could not find the function|PGRST202|schema cache/i.test(m)
        ? "The Slack notices are not live in the cockpit yet."
        : m || "The server gave no reason.",
    );
  }
  const out = read.safeParse(data);
  if (!out.success)
    throw new Error(
      "The Slack notices came back in a shape this page does not read. Reload the page.",
    );
  return out.data;
}

/** The newest notice of a kind (the read is newest first). */
export const noticeOf = (r: NoticeRead | null | undefined, kind: string) =>
  r?.notices.find(n => n.kind === kind) ?? null;
