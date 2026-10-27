/**
 * The one rule for "Slack posted it" (docs/forms/STAGE1-CONTRACT.md 4.5),
 * shared by cockpit-notices and cockpit-media-api/execute.ts. Import-free, so
 * both bundles carry it as is.
 *
 * A post counts only on Slack's own receipt: `ok` is true, `ts` has the shape
 * Slack gives a message, and the channel Slack answered with fits what was
 * asked for. A requested channel (C, G) or direct message (D) must come back
 * as that same id; a requested person (U, W) must come back as a direct
 * message (D). Anything else is not confirmed: the caller records it as
 * unknown or for a person to reconcile, never as sent, and never sends again.
 */

export type ReceiptCheck = { ok: true; ts: string; channel: string } | { ok: false; why: string };

const TS = /^\d+\.\d+$/;
const RETURNED = /^[CDG][A-Z0-9]+$/;
const CHANNEL = /^[CDG][A-Z0-9]+$/;
const PERSON = /^[UW][A-Z0-9]+$/;

export function slackReceiptConfirmed(
  requested: string,
  receipt: { ok?: unknown; ts?: unknown; channel?: unknown } | null | undefined,
): ReceiptCheck {
  if (!receipt || typeof receipt !== "object") return { ok: false, why: "Slack sent no receipt." };
  if (receipt.ok !== true) return { ok: false, why: "Slack's receipt does not say ok." };
  const ts = typeof receipt.ts === "string" ? receipt.ts : "";
  if (!TS.test(ts)) return { ok: false, why: "Slack's receipt has no message timestamp." };
  const channel = typeof receipt.channel === "string" ? receipt.channel : "";
  if (!RETURNED.test(channel)) return { ok: false, why: "Slack's receipt names no channel." };
  const asked = typeof requested === "string" ? requested.trim() : "";
  if (CHANNEL.test(asked)) {
    if (asked !== channel) return { ok: false, why: `Slack answered for another channel (${channel}).` };
    return { ok: true, ts, channel };
  }
  if (PERSON.test(asked)) {
    if (!channel.startsWith("D")) return { ok: false, why: `Slack answered for a channel (${channel}), not a direct message.` };
    return { ok: true, ts, channel };
  }
  return { ok: false, why: "The post was not addressed to a Slack channel or person id." };
}
