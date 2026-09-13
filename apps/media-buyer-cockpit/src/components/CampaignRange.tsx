import { useQuery } from "convex/react";
import type { ReactNode } from "react";
import type { Range } from "@/lib/range";
import { rangeDays } from "@/lib/range";
import { api } from "../../convex/_generated/api";
import { RangePicker } from "./RangePicker";
import { CampaignTrend } from "./Trends";

/**
 * One campaign, over whatever window she asks for, at ad set and ad level.
 *
 * The cockpit's fixed 7-day view is the right default for a decision and the
 * wrong one for a question like "what did today cost?". This reads the daily
 * grain, so any range is one click. Cost per booking sits next to cost per
 * lead at every level: it is the number that actually decides whether an ad is
 * working. [aziz, 2026-09-07]
 */

const CPL_GATE = 15;
const CPB_GATE = 80;

function money(n: number | undefined, dp = 0) {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  return `$${n.toFixed(dp)}`;
}

function pct(n: number | undefined) {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  return `${n.toFixed(2)}%`;
}

type Row = {
  key: string;
  spend: number;
  leads: number;
  cpl?: number;
  bookings: number;
  costPerBooking?: number;
  bookingRate?: number;
  linkCtr?: number;
  cpm?: number;
  optInRate?: number;
  frequency?: number;
  bookingsAttributed: boolean;
};

export function CampaignRange({
  campaignName,
  range,
  onRangeChange,
  renderAdCell,
  renderAdCall,
  leadsOnly,
}: {
  campaignName: string;
  range: Range;
  onRangeChange: (r: Range) => void;
  /** Done With You: we do not book for them, so booking columns are hidden. */
  leadsOnly?: boolean;
  /** The creative thumbnail and name, owned by the page. */
  renderAdCell?: (adName: string) => ReactNode;
  /** The verdict badge and on/off toggle, owned by the page. */
  renderAdCall?: (adName: string) => ReactNode;
}) {
  const coverage = useQuery(api.stats.coverage, {});
  const data = useQuery(api.stats.range, {
    campaignName,
    start: range.start,
    end: range.end,
  });

  const days = rangeDays(range);

  return (
    <div className="mt-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-[12px] font-bold uppercase tracking-wide text-muted-foreground">
          Ad set and ad level · {range.label.toLowerCase()}
        </div>
        <RangePicker value={range} onChange={onRangeChange} compact />
      </div>
      <CampaignTrend
        campaignName={campaignName}
        start={range.start}
        end={range.end}
      />

      {coverage?.last && range.end > coverage.last && (
        <div className="mb-2 rounded border callout-warn px-2.5 py-1.5 text-[12px]">
          The tracker sheet has spend up to{" "}
          <span className="font-semibold">{coverage.last}</span>. Anything after
          that is not missing — it has not been pulled yet, so today's numbers
          appear tomorrow morning.
        </div>
      )}

      {data === undefined && (
        <div className="rounded border p-3 text-[13px] text-muted-foreground">
          Loading {range.label.toLowerCase()}…
        </div>
      )}

      {data && !data.hasData && (
        <div className="rounded border p-3 text-[13px] text-muted-foreground">
          No spend recorded for this campaign between {range.start} and{" "}
          {range.end}.
          {days <= 2 &&
            " Today's numbers only appear once the tracker has pulled the day — before that this is genuinely empty rather than zero."}
        </div>
      )}

      {data?.hasData && (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded border bg-muted/30 px-3 py-2 text-[13px]">
            <span>
              <span className="text-muted-foreground">Spend </span>
              <span className="font-semibold tabular-nums">
                {money(data.total.spend, 2)}
              </span>
            </span>
            <span>
              <span className="text-muted-foreground">Leads </span>
              <span className="font-semibold tabular-nums">
                {data.total.leads}
              </span>
            </span>
            <span>
              <span className="text-muted-foreground">CPL </span>
              <span
                className={`font-semibold tabular-nums ${
                  data.total.cpl === undefined
                    ? ""
                    : data.total.cpl > CPL_GATE
                      ? "txt-bad"
                      : "txt-good"
                }`}
              >
                {money(data.total.cpl, 2)}
              </span>
            </span>
            {leadsOnly ? (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-semibold uppercase text-muted-foreground">
                Done with you · leads only
              </span>
            ) : (
              <>
                <span>
                  <span className="text-muted-foreground">Bookings </span>
                  <span className="font-semibold tabular-nums">
                    {data.total.bookings}
                  </span>
                </span>
                <span>
                  <span className="text-muted-foreground">Cost/booking </span>
                  <span
                    className={`font-semibold tabular-nums ${
                      data.total.costPerBooking === undefined
                        ? ""
                        : data.total.costPerBooking > CPB_GATE
                          ? "txt-bad"
                          : "txt-good"
                    }`}
                  >
                    {money(data.total.costPerBooking, 0)}
                  </span>
                </span>
              </>
            )}
            <span className="text-[12px] text-muted-foreground">
              {data.days} day{data.days === 1 ? "" : "s"} with data
              {!leadsOnly &&
                data.bookingsTotal > 0 &&
                ` · ${data.bookingsAttributed} of ${data.bookingsTotal} bookings traced to an ad`}
            </span>
          </div>

          <Table
            title="Ad sets"
            rows={data.adSets as Row[]}
            leadsOnly={leadsOnly}
            emptyNote="Meta did not name an ad set on these rows."
          />
          <Table
            title="Ads"
            rows={data.ads as Row[]}
            leadsOnly={leadsOnly}
            renderKey={renderAdCell}
            renderTail={renderAdCall}
            tailTitle="Call"
          />
          {!leadsOnly &&
            data.bookingsTotal > 0 &&
            data.bookingsAttributed === 0 && (
              <p className="mt-1 text-[12px] text-muted-foreground">
                None of the {data.bookingsTotal} bookings in this window could
                be traced back to a specific ad, so cost per booking is shown
                for the campaign only. It is blank per ad rather than guessed.
              </p>
            )}
        </>
      )}
    </div>
  );
}

function Table({
  title,
  rows,
  renderKey,
  renderTail,
  tailTitle,
  emptyNote,
  leadsOnly,
}: {
  title: string;
  rows: Row[];
  leadsOnly?: boolean;
  renderKey?: (key: string) => ReactNode;
  renderTail?: (key: string) => ReactNode;
  tailTitle?: string;
  emptyNote?: string;
}) {
  if (!rows || rows.length === 0) {
    return emptyNote ? (
      <p className="mb-2 text-[12px] text-muted-foreground">{emptyNote}</p>
    ) : null;
  }
  return (
    <div className="mb-3">
      <div className="mb-1 text-[12px] font-bold">{title}</div>
      <table className="w-full text-[13px]">
        <thead>
          <tr className="text-[11px] uppercase text-muted-foreground">
            <th className="py-1 text-left">Name</th>
            <th className="text-left">Spend</th>
            <th className="text-left">Leads</th>
            <th className="text-left">CPL</th>
            {!leadsOnly && (
              <>
                <th className="text-left">Bookings</th>
                <th
                  className="text-left"
                  title="Spend in this window divided by the bookings its ads produced. The number that decides whether an ad is working."
                >
                  Cost/booking
                </th>
              </>
            )}
            <th
              className="text-left"
              title="Link clicks divided by impressions. Not CTR (all)."
            >
              Link CTR
            </th>
            <th className="text-left">CPM</th>
            <th
              className="text-left"
              title="Of those who clicked through, how many left their details. Needs 50+ link clicks."
            >
              Opt-in
            </th>
            <th className="text-left">Freq</th>
            {renderTail && <th className="text-left">{tailTitle ?? ""}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.key} className="border-t">
              <td className="py-1.5 font-semibold">
                {renderKey ? renderKey(r.key) : r.key}
              </td>
              <td className="tabular-nums">{money(r.spend, 2)}</td>
              <td className="tabular-nums">{r.leads}</td>
              <td
                className={`tabular-nums ${
                  r.cpl === undefined
                    ? ""
                    : r.cpl > CPL_GATE
                      ? "txt-bad"
                      : "txt-good"
                }`}
              >
                {money(r.cpl, 2)}
              </td>
              {!leadsOnly && (
                <>
                  <td className="tabular-nums">
                    {r.bookingsAttributed ? (
                      <>
                        {r.bookings}
                        {r.bookingRate !== undefined && r.bookings > 0 && (
                          <span className="ml-1 text-[12px] font-normal text-muted-foreground">
                            {Math.round(r.bookingRate)}%
                          </span>
                        )}
                      </>
                    ) : (
                      <span
                        className="text-muted-foreground"
                        title="No booking in this window carried an ad id"
                      >
                        —
                      </span>
                    )}
                  </td>
                  <td
                    className={`tabular-nums ${
                      r.costPerBooking === undefined
                        ? ""
                        : r.costPerBooking > CPB_GATE
                          ? "txt-bad"
                          : "txt-good"
                    }`}
                  >
                    {r.bookingsAttributed ? money(r.costPerBooking, 0) : "—"}
                  </td>
                </>
              )}
              <td className="tabular-nums">{pct(r.linkCtr)}</td>
              <td className="tabular-nums">{money(r.cpm, 2)}</td>
              <td className="tabular-nums">{pct(r.optInRate)}</td>
              <td className="tabular-nums">
                {r.frequency ? r.frequency.toFixed(2) : "—"}
              </td>
              {renderTail && <td>{renderTail(r.key)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
