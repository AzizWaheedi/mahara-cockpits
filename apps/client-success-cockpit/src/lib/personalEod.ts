import type { SupabaseClient } from "@supabase/supabase-js";
export type EodRole = "media_buyer" | "csm" | "creative";
/**
 * Where a submitted EOD is on its way to Slack and the EOD sheet: the
 * eod_outbox row cockpit_personal_eod returns as `outbox` (20261009g,
 * 20261015190100). Null when the report was never queued.
 */
export type EodOutbox = {
  status: "queued" | "processing" | "sent" | "failed";
  attempts: number;
  slackPosted: boolean;
  sheetFiled: boolean;
  /** When Slack took it (ms), once it did. */
  sentAt: number | null;
  error: string | null;
  sheetError: string | null;
  needsReconciliation: boolean;
  /** Hourly retries so far, and whether another one is coming. */
  retries: number;
  retrying: boolean;
  /** When the hourly retries stop (ms). */
  retryUntil: number | null;
};
export type PersonalEodContext = {
  owner: string;
  day: string;
  report: any;
  outbox: EodOutbox | null;
};
const STATUSES = ["queued", "processing", "sent", "failed"] as const;
const when = (v: unknown): number | null => {
  const t = typeof v === "string" ? Date.parse(v) : Number.NaN;
  return Number.isFinite(t) ? t : null;
};
const text = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v : null;
function outboxOf(o: any): EodOutbox | null {
  if (o === null || o === undefined) return null;
  if (
    typeof o !== "object" ||
    Array.isArray(o) ||
    !(STATUSES as readonly string[]).includes(o.status)
  )
    throw new Error("The server returned an invalid EOD delivery state.");
  return {
    status: o.status,
    attempts: Number(o.attempts) || 0,
    slackPosted: o.slack_posted === true,
    sheetFiled: o.sheet_filed === true,
    sentAt: when(o.sent_at),
    error: text(o.error),
    sheetError: text(o.sheet_error),
    needsReconciliation: o.needs_reconciliation === true,
    retries: Number(o.retries) || 0,
    retrying: o.retrying === true,
    retryUntil: when(o.retry_until),
  };
}
function checked(data: any): PersonalEodContext {
  if (
    !data ||
    typeof data.owner !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      data.owner,
    ) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(data.day) ||
    (data.report !== null &&
      (typeof data.report !== "object" ||
        data.report.owner_user_id !== data.owner ||
        data.report.day !== data.day ||
        typeof data.report.answers !== "object"))
  )
    throw new Error("The server did not confirm your EOD.");
  const outbox = outboxOf(data.outbox);
  data = { ...data, outbox };
  if (data.report) {
    const r = data.report;
    if (
      !Number.isSafeInteger(Number(r.id)) ||
      Number(r.id) <= 0 ||
      !Number.isFinite(Date.parse(r.updated_at)) ||
      (r.submitted_at !== null &&
        !Number.isFinite(Date.parse(r.submitted_at))) ||
      !r.answers ||
      Array.isArray(r.answers) ||
      !r.computed ||
      typeof r.computed !== "object" ||
      Array.isArray(r.computed)
    )
      throw new Error("The server returned an invalid EOD report.");
    data = {
      ...data,
      report: {
        ...r,
        _id: String(r.id),
        at: Date.parse(r.updated_at),
        submittedAt: r.submitted_at ? Date.parse(r.submitted_at) : null,
        delivery: outbox,
      },
    };
  }
  return data;
}
export async function readPersonalEod(
  client: SupabaseClient,
  role: EodRole,
  day?: string,
) {
  const { data, error } = await client.rpc("cockpit_personal_eod", {
    p_role: role,
    p_day: day ?? null,
  });
  if (error) throw new Error(error.message);
  return checked(data);
}
export async function savePersonalEod(
  client: SupabaseClient,
  role: EodRole,
  context: { owner: string; day: string },
  args: Record<string, unknown>,
) {
  if (!context.owner || !context.day)
    throw new Error("Reload your EOD before saving.");
  const patch = Object.fromEntries(
    Object.entries(args).filter(([, value]) => value !== undefined),
  );
  const { data, error } = await client.rpc("cockpit_save_personal_eod", {
    p_role: role,
    p_patch: patch,
    p_expected_owner: context.owner,
    p_day: context.day,
  });
  if (error) throw new Error(error.message);
  return checked(data);
}

/**
 * Keeps the first time the form was opened for a working day (20261026151000).
 * The server writes it once and returns the time it already has after that.
 */
export async function markEodOpened(
  client: SupabaseClient,
  role: EodRole,
  day: string,
): Promise<{ openedAt: string | null; first: boolean }> {
  const { data, error } = await client.rpc("cockpit_mark_eod_opened", {
    p_role: role,
    p_day: day,
  });
  if (error) throw new Error(error.message);
  if (!data || data.day !== day)
    throw new Error("The server did not confirm the open time.");
  return { openedAt: data.openedAt ?? null, first: data.first === true };
}

/** Why Slack or the sheet has not taken it yet, in plain words. */
export function eodDeliveryReason(o: EodOutbox): string {
  const e = (o.error ?? "").toLowerCase();
  if (/channel_not_found|not_in_channel/.test(e))
    return "the Slack bot cannot see the EOD channel";
  if (/is_archived/.test(e)) return "the EOD channel is archived";
  if (
    /invalid_auth|not_authed|token_revoked|token_expired|account_inactive|slack_bot_token is not set/.test(
      e,
    )
  )
    return "the Slack bot is signed out";
  if (/missing_scope|no_permission|restricted_action/.test(e))
    return "the Slack bot is not allowed to post there";
  if (/ratelimited|rate_limited|429/.test(e))
    return "Slack asked us to slow down";
  if (/maximum delivery attempts/.test(e)) return "it ran out of tries";
  if (e) return "Slack refused it";
  if (o.sheetError) return "the EOD sheet did not take its row";
  return "Slack has not confirmed it";
}

const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * One sentence on where a submitted EOD is, from the outbox, for the person
 * who filed it. Null while it is a draft (each screen words its own draft).
 */
export function eodDeliveryNote(
  report:
    | { submittedAt?: number | null; delivery?: EodOutbox | null }
    | null
    | undefined,
): { tone: "good" | "warn" | "bad"; text: string } | null {
  if (!report?.submittedAt) return null;
  const o = report.delivery ?? null;
  if (!o)
    return {
      tone: "bad",
      text: "Submitted, but it is not in the Slack queue. Tell the CEO so it can be sent.",
    };
  if (o.slackPosted) {
    const at = o.sentAt ? ` at ${clock(o.sentAt)}` : "";
    if (o.status === "sent" || o.sheetFiled)
      return { tone: "good", text: `Posted to Slack${at}.` };
    return {
      tone: o.status === "failed" ? "bad" : "good",
      text:
        o.status === "failed"
          ? `Posted to Slack${at}. The EOD sheet did not take its row; tell the CEO.`
          : `Posted to Slack${at}. The EOD sheet row is still to go.`,
    };
  }
  const why = eodDeliveryReason(o);
  if (o.needsReconciliation)
    return {
      tone: "bad",
      text: "Not confirmed in Slack: the send was cut off. The CEO checks Slack before it goes again.",
    };
  if (o.status === "failed" && o.retrying)
    return {
      tone: "bad",
      text: `Not posted yet: ${why}. Tell the CEO so it can be fixed; it is tried again every hour${
        o.retryUntil
          ? ` until ${new Date(o.retryUntil).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })}`
          : ""
      }.`,
    };
  if (o.status === "failed")
    return {
      tone: "bad",
      text: `Not posted to Slack: ${why}. Tell the CEO; it can be sent again once that is fixed.`,
    };
  if (o.error)
    return {
      tone: "warn",
      text: `Not posted yet: ${why}. Trying again within 5 minutes.`,
    };
  return {
    tone: "warn",
    text: "Waiting to post to Slack. It goes within 5 minutes.",
  };
}
