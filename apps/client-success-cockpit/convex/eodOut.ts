/**
 * Putting the CSM's end of day where it is actually read.
 *
 * Saving it in this cockpit was never enough: EOD Radar watches the
 * Slack channels, and the tracking sheet is built from what the radar
 * sees. An EOD that only exists in Convex is an EOD nobody filed.
 *
 * The row goes to `eod_outbox` in Supabase and a worker on the VPS posts
 * it, because that is where the Slack token and the Google token with
 * rights to the EOD sheet already live.
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation } from "./_generated/server";

declare const process: { env: Record<string, string | undefined> };

const SUPABASE_URL = (process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

/** From the tracking sheet's Roster: the radar matches on this id. */
const CHANNEL = "#eods-csms";
const TAB = "Account Manager";

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
    reportId: v.optional(v.id("eodReports")),
    version: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (
    ctx,
    { day, answers, computed, email, reportId, version },
  ) => {
    const record = async (error?: string) => {
      if (reportId)
        await ctx.runMutation(internal.eodOut.record, {
          reportId,
          version,
          error,
        });
    };
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      await record("The EOD delivery connection is not configured.");
      return null;
    }
    let roster: Record<string, { name: string; slackId: string }> = {};
    try {
      roster = JSON.parse(process.env.CSM_EOD_ROSTER ?? "{}");
    } catch {
      /* Fail closed for a malformed mapping. */
    }
    const person = roster[(email ?? "").trim().toLowerCase()];
    if (!person?.name || !/^U[A-Z0-9]+$/.test(person.slackId)) {
      await record(
        "Ask the system owner to connect your email to the EOD roster. Your report is saved.",
      );
      return null;
    }
    const a = (answers ?? {}) as Record<string, string>;
    const c = (computed ?? {}) as Record<string, unknown>;

    // Line for line in the shape the radar already recognises: the name,
    // then "Submitted by", then the sections it checks for quality.
    const body = [
      "*CSM EOD*",
      `*Date - ${asDate(day)}`,
      "",
      `*Name - ${person.name}*`,
      `Submitted by: <@${person.slackId}>`,
      "",
      "*HEALTH*",
      `Focus - ${a.focus ?? a.stress ?? ""}`,
      `Energy - ${a.energy ?? ""}`,
      "",
      "*OUTPUT*",
      `Clients contacted today - ${c.contacted ?? a.contacted ?? ""}`,
      `Calls held - ${c.calls ?? a.calls ?? ""}`,
      `Clients at risk - ${c.atRisk ?? a.atRisk ?? ""}`,
      "",
      "*WINS*",
      String(a.wins ?? a.onePercent ?? "--"),
      "",
      "*BLOCKERS*",
      String(a.blockers ?? a.expectations ?? "--"),
      "",
      "*TOMORROW*",
      String(a.tomorrow ?? "--"),
      "",
      "*DAY SUMMARY*",
      String(a.summary ?? a.rollup ?? "--"),
    ].join("\n");

    const values = [
      new Date().toISOString().slice(0, 19).replace("T", " "),
      person.name,
      `cockpit-${day}`,
      asDate(day),
      String(a.energy ?? ""),
      String(a.focus ?? a.stress ?? ""),
      String(a.wins ?? a.onePercent ?? ""),
      String(a.blockers ?? a.expectations ?? ""),
      String(a.tomorrow ?? ""),
      String(a.summary ?? a.rollup ?? ""),
    ];

    try {
      const response = await fetch(
        `${SUPABASE_URL}/rest/v1/eod_outbox?on_conflict=role,day,person`,
        {
          method: "POST",
          signal: AbortSignal.timeout(15000),
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            "Content-Type": "application/json",
            // A resubmit replaces the queued row rather than posting twice.
            Prefer: "resolution=merge-duplicates,return=minimal",
          },
          body: JSON.stringify([
            {
              role: "csm",
              day,
              person: person.name,
              slack_id: person.slackId,
              channel: CHANNEL,
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
      if (!response.ok)
        throw new Error(
          `Delivery queue refused the report (${response.status}).`,
        );
      await record();
    } catch {
      await record(
        "The delivery queue did not confirm this report. Ask the system owner to check it before resubmitting.",
      );
    }
    return null;
  },
});

export const record = internalMutation({
  args: {
    reportId: v.id("eodReports"),
    version: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const row = await ctx.db.get(a.reportId);
    if (row && (a.version === undefined || row.at === a.version))
      await ctx.db.patch(a.reportId, { exportError: a.error });
  },
});
