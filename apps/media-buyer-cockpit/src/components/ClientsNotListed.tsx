import { money } from "@/components/ceo/format";
import { Button } from "@/components/ui/button";
import {
  type ClientRangeRead,
  type ClientRangeRow,
  clientCpb,
  clientsWithoutCampaigns,
  countedSpan,
} from "@/lib/clientRange";
import { api, useQueryState } from "@/lib/cockpitApi";
import { costText } from "@/lib/costTone";
import type { Range } from "@/lib/range";

/**
 * The clients that spent or booked in the picked range with no campaign
 * running on the list, so the board has no row to open them from (R8,
 * 2026-10-22). On 1 to 20 Oct that was ARCWANI ($151.40, 1 booking) and
 * Liwan ($194.58, 1 booking): their page said "No spend between ..." and
 * could not be opened. Each one opens the client's own page with its ad
 * accounts, so the page keeps reading the client on any range. A client
 * whose spend is not known (no ad account of its own on the Client
 * Performance board) is listed apart with the reason, never as spend. The
 * figures name the days they count when those are not the range picked.
 * Nothing shows while there is no such client, and a failed read says so in
 * one line instead of claiming there are none.
 */
export function ClientsNotListed({
  range,
  campaigns,
  onOpen,
}: {
  range: Range;
  /** The campaigns on the board's Running list. */
  campaigns: {
    clientName?: unknown;
    accountName?: unknown;
    metaAccountId?: unknown;
  }[];
  /** Opens the client's page, read by these ad accounts. */
  onOpen: (clientName: string, accounts: string[]) => void;
}) {
  const read = useQueryState<ClientRangeRead>(api.stats.clientRange, {
    start: range.start,
    end: range.end,
    accounts: null,
  });
  if (read.error)
    return (
      <p className="mt-6 border-t pt-4 text-xs text-muted-foreground">
        Clients that spent in {range.label.toLowerCase()} with no campaign
        running here could not be read. Reload the page to try again.
      </p>
    );
  const rows = clientsWithoutCampaigns(read.data, campaigns);
  if (rows.length === 0) return null;
  const spent = rows.filter(r => r.spend !== null);
  const unknown = rows.filter(r => r.spend === null);
  const span = countedSpan(read.data, range.start, range.end);
  const reasons = [
    ...new Set(unknown.map(r => r.why).filter((w): w is string => !!w)),
  ];
  return (
    <div className="mt-6 border-t pt-4">
      <h3 className="text-sm font-semibold">
        Spent in this range, no campaign running here{" "}
        <span className="font-normal text-muted-foreground">{rows.length}</span>
      </h3>
      <p className="mt-1 text-xs text-muted-foreground">
        These clients spent or booked in {range.label.toLowerCase()} on
        campaigns that have stopped, so the list above has no row for them.
        Mahara's campaigns only; bookings are the Client Performance board's
        confirmed count.
        {span
          ? ` The figures count ${span}, the days the client numbers cover.`
          : ""}
      </p>
      {spent.length > 0 && (
        <ul className="mt-3 divide-y text-sm">
          {spent.map(r => (
            <ClientLine key={rowKey(r)} row={r} onOpen={onOpen} />
          ))}
        </ul>
      )}
      {unknown.length > 0 && (
        <>
          <p className="mt-4 text-xs text-muted-foreground">
            Booked in {range.label.toLowerCase()}, spend not known:{" "}
            {reasons.length > 0
              ? reasons.join(" ")
              : "no Meta ad account of their own is linked on the Client Performance board."}
          </p>
          <ul className="mt-2 divide-y text-sm">
            {unknown.map(r => (
              <ClientLine key={rowKey(r)} row={r} onOpen={onOpen} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

const rowKey = (r: ClientRangeRow) => r.locationId ?? r.clickupId ?? r.name;

/** One client: its spend, leads and bookings, and the button to its page. */
function ClientLine({
  row: r,
  onOpen,
}: {
  row: ClientRangeRow;
  onOpen: (clientName: string, accounts: string[]) => void;
}) {
  const dwy = r.serviceMode === "DWY";
  const cpb = clientCpb(r);
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
      <span className="min-w-0 font-medium" dir="auto">
        {r.name}
      </span>
      <span className="text-xs text-muted-foreground">
        {r.spend === null ? (
          <span title={r.why ?? undefined}>spend not known</span>
        ) : (
          money(r.spend)
        )}
        {r.leads === null ? "" : ` · ${r.leads} leads`}
        {dwy ? (
          " · Done with you"
        ) : r.bookings === null ? (
          <span title={r.why ?? undefined}> · bookings n/a</span>
        ) : (
          <>
            {` · ${r.bookings} booked`}
            {r.spend !== null && (r.bookings > 0 || cpb.noneOnSpend) ? (
              <>
                {" · "}
                <span className={costText(cpb.tone)} title={cpb.why}>
                  {r.bookings > 0 ? `${cpb.text} a booking` : cpb.text}
                </span>
              </>
            ) : null}
          </>
        )}
        {r.status && r.status !== "Active" ? ` · ${r.status}` : ""}
      </span>
      <Button
        size="sm"
        variant="outline"
        className="text-xs sm:ml-auto"
        onClick={() => onOpen(r.name, r.accounts)}
      >
        Open
      </Button>
    </li>
  );
}
