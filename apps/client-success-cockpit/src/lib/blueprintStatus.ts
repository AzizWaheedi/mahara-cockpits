import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { mapUrl, phase5Message } from "@/present/blueprintBrief";

/**
 * The Brand Blueprint as the CSM sees it on the client's Onboarding panel
 * (docs/brand-blueprint SPEC.md 6.1): one line with each part's time, the
 * way into the deck (read only for a CSM), and, once the call is closed and
 * the cockpit is not set to let Make send it, the phase 5 message to paste
 * in the client's WhatsApp group. Read through cockpit_blueprint_read and
 * cockpit_blueprint_settings_read; nothing here writes.
 */

const text = z.string();
const stamp = z.object({ firstAt: text, lastAt: text.optional() });
const row = z.object({
  taskId: text,
  clientName: text,
  parts: z.record(text, stamp),
});
const read = z.object({ rows: z.array(row), now: text });
const settings = z.object({ closeRoute: text });

export type BlueprintParts = Partial<
  Record<"1" | "2" | "3", { firstAt: string }>
>;
export type BlueprintStatus = {
  /** null: no Blueprint in the cockpit for this card yet. */
  parts: BlueprintParts | null;
  /** null when the setting could not be read: the copy button then stays away. */
  closeRoute: string | null;
  now: string;
};

export async function readBlueprintStatus(
  client: Pick<SupabaseClient, "rpc">,
  taskId: string,
): Promise<BlueprintStatus> {
  const got = await client.rpc("cockpit_blueprint_read", {
    p_task_ids: [taskId],
  });
  if (got.error) throw Error(got.error.message);
  const page = read.safeParse(got.data);
  if (!page.success)
    throw Error(
      "The Blueprint record came back in a shape this page does not read.",
    );
  const mine = page.data.rows.find(r => r.taskId === taskId);
  let closeRoute: string | null = null;
  try {
    const s = await client.rpc("cockpit_blueprint_settings_read");
    if (!s.error)
      closeRoute = settings.safeParse(s.data).data?.closeRoute ?? null;
  } catch {
    closeRoute = null;
  }
  return {
    parts: mine ? (mine.parts as BlueprintParts) : null,
    closeRoute,
    now: page.data.now,
  };
}

const KUWAIT_MS = 3 * 3_600_000;
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "10:12" on the same Kuwait day as `now`, else "Sat 24 Oct". */
export function partWhen(iso: string, now: string): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  const k = new Date(at + KUWAIT_MS);
  const today = new Date(Date.parse(now) + KUWAIT_MS);
  return k.toISOString().slice(0, 10) === today.toISOString().slice(0, 10)
    ? k.toISOString().slice(11, 16)
    : `${WEEKDAY[k.getUTCDay()]} ${k.getUTCDate()} ${MONTH[k.getUTCMonth()]}`;
}

const PART_WORDS: [keyof BlueprintParts, string, string][] = [
  ["1", "starter ads sent", "starter ads not sent yet"],
  ["2", "call closed", "call not closed yet"],
  ["3", "offer locked", "offer not locked yet"],
];

/**
 * "Starter ads sent 10:12 · call closed 10:44 · offer not locked yet", each
 * part's time or what is still to come, on Kuwait's clock. The panel's
 * label says "Brand Blueprint", so the line does not say it again.
 */
export function blueprintLine(
  s: Pick<BlueprintStatus, "parts" | "now">,
): string {
  if (!s.parts) return "Not started in the cockpit yet.";
  const line = PART_WORDS.map(([k, words, notYet]) => {
    const at = s.parts?.[k]?.firstAt;
    return at ? `${words} ${partWhen(at, s.now)}` : notYet;
  }).join(" · ");
  return line.charAt(0).toUpperCase() + line.slice(1);
}

export function blueprintDone(parts: BlueprintParts | null): boolean {
  return Boolean(parts?.["1"] && parts["2"] && parts["3"]);
}

/**
 * What the CSM pastes in the client's WhatsApp group after the call: the
 * same text as the card comment (blueprintBrief.ts). Only once the call is
 * closed, and never while Make is the one that sends it. Until Make 14's
 * phase 5 text is copied into the cockpit, the map link is what is copied.
 */
export function phase5Copy(args: {
  taskId: string;
  clientName: string;
  status: Pick<BlueprintStatus, "parts" | "closeRoute">;
  links: Record<string, string | undefined>;
}): { label: string; text: string; note: string | null } | null {
  const { status } = args;
  if (!status.parts?.["2"]) return null;
  if (!status.closeRoute || status.closeRoute === "make") return null;
  const folder = args.links.drive_folder ?? args.links.drive ?? null;
  const message = phase5Message({
    card: { id: args.taskId, name: args.clientName },
    links: { driveFolder: folder },
  });
  return message
    ? {
        label: "Copy the phase 5 message for the group",
        text: message,
        note: null,
      }
    : {
        label: "Copy the phase 5 map link",
        text: mapUrl(args.taskId),
        note: "The phase 5 text is not in the cockpit yet. Send the usual phase 5 message with this map link.",
      };
}

/** The Blueprint deck's prep view, read only for a CSM. */
export function blueprintPrepUrl(taskId: string): string {
  const base = (import.meta.env?.BASE_URL ?? "/client-success/").replace(
    /\/$/,
    "",
  );
  return `${base}/clients/${encodeURIComponent(taskId)}/present/blueprint?view=prep`;
}
export const blueprintPrepWindow = (taskId: string) =>
  `mahara-prep-${taskId}-blueprint`;
