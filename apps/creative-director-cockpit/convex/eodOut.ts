/**
 * Putting the creative director's end of day where it is actually read.
 *
 * Saving it in this cockpit was never enough: EOD Radar watches the
 * Slack channels, and the tracking sheet is built from what the radar
 * sees. An EOD that only exists in Convex is an EOD nobody filed, which
 * is why Sabri has shown MISSED every day while filling one in.
 *
 * The row goes to `eod_outbox` in Supabase and a worker on the VPS posts
 * it, because that is where the Slack token and the Google token with
 * rights to the EOD sheet already live.
 */
import { v } from "convex/values";
import { internalAction } from "./_generated/server";

declare const process: { env: Record<string, string | undefined> };

const SUPABASE_URL = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

/** From the tracking sheet's Roster: the radar matches on this id. */
const SABRI = { name: "Sabri", slackId: "U0B2SHGS1JA", channel: "C0AQ2LD0PL1" };
const TAB = "Creative Director";

/** `DD-MM-YYYY`, which is the form the live EOD posts use. */
function asDate(day: string): string {
  const [y, m, d] = day.split("-");
  return `${d}-${m}-${y}`;
}

export const send = internalAction({
  args: {
    day: v.string(),
    answers: v.any(),
    computed: v.any(),
    email: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (_ctx, { day, answers, computed }) => {
    if (!SUPABASE_URL || !SUPABASE_KEY) return null;
    const a = (answers ?? {}) as Record<string, string>;
    const c = (computed ?? {}) as Record<string, unknown>;

    // Line for line in the shape the radar already recognises: the name,
    // then "Submitted by", then the sections it checks for quality.
    const body = [
      "*CREATIVE DIRECTOR EOD*",
      `*Date - ${asDate(day)}`,
      "",
      `*Name - ${SABRI.name}*`,
      `Submitted by: <@${SABRI.slackId}>`,
      "",
      "*HEALTH*",
      `Focus - ${a.focus ?? ""}`,
      `Energy - ${a.energy ?? ""}`,
      "",
      "*OUTPUT*",
      `Videos scripted or briefed today - ${c.scripted ?? a.scripted ?? ""}`,
      `Creatives reviewed - ${c.reviewed ?? a.reviewed ?? ""}`,
      `Posts scheduled - ${c.scheduled ?? a.scheduled ?? ""}`,
      "",
      "*WINS*",
      String(a.wins ?? "--"),
      "",
      "*BLOCKERS*",
      String(a.blockers ?? "--"),
      "",
      "*TOMORROW*",
      String(a.tomorrow ?? "--"),
      "",
      "*DAY SUMMARY*",
      String(a.summary ?? "--"),
    ].join("\n");

    const values = [
      new Date().toISOString().slice(0, 19).replace("T", " "),
      SABRI.name,
      `cockpit-${day}`,
      asDate(day),
      String(a.energy ?? ""),
      String(a.focus ?? ""),
      String(a.wins ?? ""),
      String(a.blockers ?? ""),
      String(a.tomorrow ?? ""),
      String(a.summary ?? ""),
    ];

    await fetch(
      `${SUPABASE_URL}/rest/v1/eod_outbox?on_conflict=role,day,person`,
      {
        method: "POST",
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json",
          // A resubmit replaces the queued row rather than posting twice.
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify([
          {
            role: "creative",
            day,
            person: SABRI.name,
            slack_id: SABRI.slackId,
            channel: SABRI.channel,
            tab: TAB,
            body,
            row_values: values,
            status: "queued",
            attempts: 0,
            error: null,
          },
        ]),
      },
    );
    return null;
  },
});
