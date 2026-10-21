import { useMemo, useState } from "react";
import { FilterChips } from "@/components/ceo/FilterChips";
import { AnimatedSelect } from "@/components/ui/animated-select";
import {
  COUNTRY_TEXT,
  dayText,
  hourText,
  kuwaitToday,
  MIN_LEADS,
  plural,
  rateText,
  SPEED_WINDOWS,
  type SpeedBand,
  type SpeedWindowKey,
  speedBands,
  speedCountries,
  speedHours,
  speedWindow,
} from "@/lib/resultsModel";
import { fetchSpeed, useRead } from "@/lib/resultsReads";
import { Notice, Problem, ResultCard, RowsSkeleton, SourceNote } from "./ResultsKit";

const BAR_AREA = 168;

/**
 * Bookings per 100 paid leads, by how fast the first call came (Muhammed, 2026-10-21), with the
 * arrival hour and the country as filters. The database sends counts per hour, country and band
 * (cockpit_speed_read); the sums for any filter are worked out here, so a filter asks nothing more of it.
 * A band with fewer than 30 paid leads says "Too few leads" instead of a rate. It shows what happened,
 * never that a faster call causes a booking.
 */
export function SpeedChart({ className }: { className?: string }) {
  const [windowKey, setWindowKey] = useState<SpeedWindowKey>("60");
  const [clock, setClock] = useState<"clock" | "working">("clock");
  const [hour, setHour] = useState<number | null>(null);
  const [country, setCountry] = useState<string | null>(null);
  const win = useMemo(() => speedWindow(windowKey, kuwaitToday()), [windowKey]);
  const read = useRead(`speed|${win.from}|${win.to}|${clock}`, () =>
    fetchSpeed(win.from, win.to, clock),
  );
  const data = read.status === "ready" ? read.data : read.status === "error" ? read.data : undefined;
  const cells = data?.cells ?? [];
  const { bands, total } = useMemo(
    () => speedBands(cells, { hour, country }),
    [cells, hour, country],
  );
  const hours = useMemo(() => speedHours(cells, country), [cells, country]);
  const countries = useMemo(() => speedCountries(cells, hour), [cells, hour]);
  const fast = bands.find(b => b.key === "up_to_30m");
  const slow = bands.find(b => b.key === "over_24h");
  const scale =
    Math.max(10, ...bands.map(b => b.per100 ?? 0), total.per100 ?? 0) * 1.15;
  const figure = bands
    .map(b => `${b.label}: ${b.per100 === null ? "too few leads" : `${rateText(b.per100)} per 100`}`)
    .join(". ");

  return (
    <ResultCard
      id="speed-chart"
      kicker="Paid leads"
      title="Bookings per 100 paid leads, by speed of first call"
      className={className}
      aside={
        <FilterChips
          ariaLabel="Time frame"
          value={windowKey}
          onChange={setWindowKey}
          options={SPEED_WINDOWS.map(w => ({ key: w.key, label: w.label }))}
        />
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <AnimatedSelect
          aria-label="Arrival hour"
          className="ceo-select-sm"
          value={hour === null ? "all" : String(hour)}
          onChange={e => setHour(e.target.value === "all" ? null : Number(e.target.value))}
        >
          <option value="all">All hours</option>
          {hours.map(h => (
            <option key={h.hour} value={String(h.hour)}>
              {hourText(h.hour)} ({h.leads})
            </option>
          ))}
        </AnimatedSelect>
        <AnimatedSelect
          aria-label="Country"
          className="ceo-select-sm"
          value={country ?? "all"}
          onChange={e => setCountry(e.target.value === "all" ? null : e.target.value)}
        >
          <option value="all">All countries</option>
          {countries.map(c => (
            <option key={c.country} value={c.country}>
              {COUNTRY_TEXT[c.country] ?? c.country} ({c.leads})
            </option>
          ))}
        </AnimatedSelect>
        <FilterChips
          ariaLabel="Clock"
          value={clock}
          onChange={setClock}
          options={[
            { key: "clock", label: "Clock time" },
            { key: "working", label: "Working hours" },
          ]}
        />
      </div>

      <div className="mt-5">
        {read.status === "loading" ? <RowsSkeleton rows={3} /> : null}
        {read.status === "error" ? (
          <Problem message={read.message} onRetry={read.reload} />
        ) : null}
        {data && bands.length === 0 ? (
          <Notice
            title="No paid leads for this pick"
            text="Choose another hour or country, or a longer time frame."
          />
        ) : null}
        {data && bands.length > 0 ? (
          <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_21rem] lg:gap-10">
            <div className="min-w-0">
              <p className="text-sm">
                {fast && slow && fast.per100 !== null && slow.per100 !== null
                  ? `Leads called within 30 minutes booked ${rateText(fast.per100)} per 100. Leads called after 24 hours booked ${rateText(slow.per100)} per 100.`
                  : `${plural(total.leads, "paid lead")} in this pick, ${total.bookings} booked.`}
              </p>
              {total.per100 !== null ? (
                <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <span
                    aria-hidden
                    className="inline-block w-5 border-t border-dashed border-foreground/60"
                  />
                  All paid leads in this pick: {rateText(total.per100)} per 100
                </p>
              ) : null}
              <div
                role="figure"
                aria-label={`Bookings per 100 paid leads by speed of first call. ${figure}`}
                className="mt-5"
              >
                <div className="relative" style={{ height: BAR_AREA }}>
                  <div className="flex h-full items-end gap-2 sm:gap-4">
                    {bands.map(b => (
                      <Bar key={b.key} band={b} scale={scale} />
                    ))}
                  </div>
                  {total.per100 !== null ? (
                    <div
                      aria-hidden
                      className="pointer-events-none absolute inset-x-0 border-t border-dashed border-foreground/40"
                      style={{ bottom: `${(total.per100 / scale) * BAR_AREA}px` }}
                    />
                  ) : null}
                </div>
                <div className="mt-2 flex gap-2 sm:gap-4">
                  {bands.map(b => (
                    <div key={b.key} className="min-w-0 flex-1 text-center">
                      <p className="text-xs leading-4 text-foreground">{b.label}</p>
                      <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                        {plural(b.leads, "lead")}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-4 min-w-0 lg:mt-0">
              <details className="text-sm lg:hidden">
                <summary className="cursor-pointer select-none text-xs font-medium text-muted-foreground">
                  Show the numbers
                </summary>
                <div className="mt-3 overflow-x-auto">
                  <NumbersTable rows={[...bands, total]} />
                </div>
              </details>
              <div className="hidden lg:block">
                <NumbersTable rows={[...bands, total]} />
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {data ? (
        <SourceNote>
          {data.note} Paid leads are CRM leads that carry an ad, created{" "}
          {dayText(win.from)} to {dayText(data.windowTo ?? win.to)}; the last{" "}
          {data.settleDays} days are left out so bookings have time to arrive. Only
          counted bookings are included: not provisional, cancelled or Google
          Calendar ones. A band under {MIN_LEADS} paid leads shows no rate.
          {clock === "working"
            ? " Working hours count only the caller's scheduled hours between the lead and the call."
            : " Clock time counts every minute between the lead and the call."}{" "}
          The call is the first outbound call linked to the lead, and only
          clients with outbound calls in the dialer are included.
        </SourceNote>
      ) : null}
    </ResultCard>
  );
}

function NumbersTable({ rows }: { rows: SpeedBand[] }) {
  return (
    <table className="w-full min-w-[20rem] text-left text-xs tabular-nums">
      <thead className="text-muted-foreground">
        <tr>
          <th className="py-1.5 pr-3 font-normal">First call</th>
          <th className="px-3 py-1.5 text-right font-normal">Paid leads</th>
          <th className="px-3 py-1.5 text-right font-normal">Booked</th>
          <th className="py-1.5 pl-3 text-right font-normal">Per 100</th>
        </tr>
      </thead>
      <tbody className="divide-y">
        {rows.map(b => (
          <tr key={b.key} className={b.key === "all" ? "font-medium" : undefined}>
            <td className="py-1.5 pr-3">{b.label}</td>
            <td className="px-3 py-1.5 text-right">{b.leads}</td>
            <td className="px-3 py-1.5 text-right">{b.bookings}</td>
            <td className="py-1.5 pl-3 text-right">
              {b.per100 === null ? "Too few" : rateText(b.per100)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Bar({ band: b, scale }: { band: SpeedBand; scale: number }) {
  if (b.per100 === null)
    return (
      <div className="flex h-full min-w-0 flex-1 flex-col items-center justify-end">
        <p className="mb-1 text-[11px] text-muted-foreground">Too few leads</p>
        <div className="h-6 w-full max-w-12 rounded-t-md border border-dashed border-muted-foreground/40" />
      </div>
    );
  const height = Math.max(2, (b.per100 / scale) * BAR_AREA);
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col items-center justify-end">
      <p className="mb-1 text-sm font-semibold tabular-nums">{rateText(b.per100)}</p>
      <div
        className="w-full max-w-12 rounded-t-md"
        style={{ height, backgroundColor: "var(--ceo-emphasis)" }}
      />
    </div>
  );
}
