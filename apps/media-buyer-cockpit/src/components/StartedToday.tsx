import { money } from "@/components/ceo/format";
import { api, useQueryState } from "@/lib/cockpitApi";
import type { StartedTodayRead, StartedTodayRow } from "@/lib/startedToday";

const time = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kuwait",
  hour: "2-digit",
  minute: "2-digit",
});

function spendText(r: StartedTodayRow): string {
  if (typeof r.spendUsd === "number") {
    const usd = money(r.spendUsd);
    return r.currency && r.currency !== "USD"
      ? `${usd} (${r.currency} ${r.spend.toFixed(2)})`
      : usd;
  }
  return `${r.currency ?? ""} ${r.spend.toFixed(2)}`.trim();
}

/**
 * Campaigns that started spending today, before the Ads list has them: the
 * list shows a campaign once it has a full day of spend. Each row carries
 * today's figures and the ClickUp card when the ads board has one.
 */
export function StartedTodayList({
  read,
  error,
}: {
  read: StartedTodayRead | undefined;
  error: Error | null;
}) {
  if (error)
    return (
      <p className="mt-6 border-t pt-4 text-xs text-muted-foreground">
        Campaigns that started today could not be read. Reload the page to try
        again.
      </p>
    );
  if (!read || read.rows.length === 0) return null;
  const at = read.feedAt ? time.format(new Date(read.feedAt)) : null;
  return (
    <div className="mt-6 border-t pt-4">
      <h3 className="text-sm font-semibold">
        Started today{" "}
        <span className="font-normal text-muted-foreground">
          {read.rows.length}
        </span>
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        {
          "These campaigns started spending today. The list above shows a campaign once it has a full day of spend, so they join it after midnight with their 7-day numbers. Today's figures come from Meta's hourly read"
        }
        {at ? ` at ${at}` : ""}.
      </p>
      <ul className="mt-3 divide-y text-sm">
        {read.rows.map(r => (
          <li
            key={r.campaignId}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5"
          >
            <span className="min-w-0 font-medium" dir="auto">
              {r.campaignName}
            </span>
            <span className="text-xs text-muted-foreground" dir="auto">
              {r.clientName ?? r.accountName}
              {` · ${spendText(r)}`}
              {` · ${r.leads} ${r.leads === 1 ? "lead" : "leads"}`}
              {` · ${r.ads} ${r.ads === 1 ? "ad" : "ads"}`}
            </span>
            {r.card === null ? (
              <span className="text-xs text-amber-700 dark:text-amber-400">
                No card on the ads board yet
              </span>
            ) : r.card.url ? (
              <a
                href={r.card.url}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-muted-foreground underline-offset-2 hover:underline sm:ml-auto"
              >
                ClickUp card{r.card.adStatus ? ` · ${r.card.adStatus}` : ""}
              </a>
            ) : (
              <span className="text-xs text-muted-foreground sm:ml-auto">
                ClickUp card{r.card.adStatus ? ` · ${r.card.adStatus}` : ""}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function StartedToday() {
  const q = useQueryState<StartedTodayRead>(api.stats.startedToday, {});
  return <StartedTodayList read={q.data} error={q.error} />;
}
