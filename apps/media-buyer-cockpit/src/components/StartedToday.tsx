import type { StartedTodayRead, StartedTodayRow } from "@/lib/startedToday";

/**
 * Campaigns that started spending today sit in the Ads list as ordinary rows,
 * in their client's group and in name order, with a grey "Started today" line
 * under the name (Muhammed, 2026-11-04). The list's own numbers start after a
 * full day of spend, so these rows carry today's figures from Meta's hourly
 * read until the sync lists them after midnight.
 */

// biome-ignore lint/suspicious/noExplicitAny: the board's rows are untyped
type Campaign = any;

const time = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kuwait",
  hour: "2-digit",
  minute: "2-digit",
});

const usd = (n: number, d = 0) =>
  `$${n.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d })}`;

const norm = (s: unknown) =>
  String(s ?? "")
    .trim()
    .toLowerCase();

/**
 * Board-shaped rows for today's new campaigns. Each takes the client name the
 * list already uses for that client (same ad account first, then the same
 * name in any case), so it lands under the existing client header.
 */
export function startedTodayCampaigns(
  read: StartedTodayRead | undefined,
  campaigns: Campaign[],
): Campaign[] {
  if (!read) return [];
  const listed = new Set(campaigns.map(c => norm(c.campaignName)));
  return read.rows
    .filter(r => !listed.has(norm(r.campaignName)))
    .map(r => {
      const own = r.clientName ?? r.accountName ?? "Unassigned";
      const peer =
        campaigns.find(c => String(c.metaAccountId ?? "") === r.accountId) ??
        campaigns.find(c => norm(c.clientName ?? c.accountName) === norm(own));
      return {
        _id: `started-today-${r.campaignId}`,
        campaignName: r.campaignName,
        clientName: peer ? (peer.clientName ?? peer.accountName) : own,
        clientTag: peer?.clientTag,
        accountName: r.accountName,
        metaAccountId: r.accountId,
        metaCampaignId: r.campaignId,
        startedToday: r,
        feedAt: read.feedAt,
        day: read.day,
      };
    });
}

const na = (title: string) => (
  <span className="font-normal text-muted-foreground" title={title}>
    n/a
  </span>
);

const MONTHS = [
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

export function startedLabel(
  startedOn: string | null,
  day: string | null | undefined,
): string {
  if (!startedOn || !day || startedOn === day) return "Started today";
  const [, month, dayOfMonth] = startedOn.split("-");
  return `Started ${Number(dayOfMonth)} ${MONTHS[Number(month) - 1]}`;
}

/** The eight cells of a started-today row, in the board's column order. */
export function StartedTodayCells({
  row,
  feedAt,
  day,
}: {
  row: StartedTodayRow;
  feedAt: string | null;
  day?: string | null;
}) {
  const at = feedAt ? time.format(new Date(feedAt)) : null;
  const label = startedLabel(row.startedOn, day);
  const sinceStart = label !== "Started today";
  const cpl =
    typeof row.spendUsd === "number" && row.leads > 0
      ? usd(row.spendUsd / row.leads, 2)
      : null;
  const later = "Read once the campaign has a full day of spend.";
  return (
    <>
      <td className="py-2.5 pr-2">
        <span className="font-bold" dir="auto">
          {row.campaignName}
        </span>
        <div
          className="text-xs text-muted-foreground"
          title={
            sinceStart
              ? "The list's 7-day numbers arrive with the morning sync, so this row shows the figures since the campaign started."
              : "The list's 7-day numbers start after a full day of spend, so this row shows today's figures until midnight."
          }
        >
          {label}
          {at
            ? ` · ${sinceStart ? "figures since then" : "today's figures"} from Meta at ${at}`
            : ""}
          {row.card?.url ? (
            <>
              {" · "}
              <a
                href={row.card.url}
                target="_blank"
                rel="noreferrer"
                className="underline-offset-2 hover:underline"
              >
                ClickUp card
              </a>
            </>
          ) : null}
        </div>
        {row.card === null && (
          <div className="text-xs text-amber-700 dark:text-amber-400">
            No card on the ads board yet
          </div>
        )}
      </td>
      <td className="px-2 tabular-nums font-semibold">
        {typeof row.spendUsd === "number" ? usd(row.spendUsd) : na(later)}
        {row.currency && row.currency !== "USD" && (
          <div className="text-xs font-normal text-muted-foreground">
            {row.currency} {row.spend.toFixed(2)}
          </div>
        )}
      </td>
      <td className="px-2 tabular-nums font-semibold">{row.leads}</td>
      <td className="px-2 tabular-nums font-semibold">
        {cpl ?? na("No lead yet today.")}
      </td>
      <td className="px-2 tabular-nums">{na(later)}</td>
      <td className="px-2 tabular-nums">{na(later)}</td>
      <td className="px-2 tabular-nums">{na(later)}</td>
      <td className="px-2 text-xs text-muted-foreground" title={later}>
        Too early to call
      </td>
    </>
  );
}

/** Said under the board when today's new campaigns could not be read. */
export function StartedTodayError({ error }: { error: Error | null }) {
  if (!error) return null;
  return (
    <p className="mt-3 text-xs text-muted-foreground">
      Campaigns that started today could not be read. Reload the page to try
      again.
    </p>
  );
}
