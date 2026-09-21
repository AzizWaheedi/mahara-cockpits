import { useMemo } from "react";
import { count, kuwaitDay, money, pct } from "@/components/ceo/format";
import { SectionCard } from "@/components/ceo/SectionCard";
import { StatTile } from "@/components/ceo/StatTile";
import { TimeframeBar } from "@/components/ceo/TimeframeBar";
import { useTimeframe } from "@/components/ceo/timeframe";
import type { CeoSection } from "@/components/ceo/useCeo";
import type { Note } from "../../../convex/ceo/payloads";

/**
 * One card per tab that rebuilds the headline numbers for any timeframe from
 * that tab's daily series (Aziz, 2026-09-21: "any number with a time
 * dimension gets the same timeframe control as the charts"). Days run to
 * yesterday; a sum of days, so a rate is a quotient of sums.
 */

const NOTE: Note = {
  level: "info",
  text: "Rebuilt from the daily series for the days chosen: every count is a sum of days and every rate a quotient of sums. Days run to yesterday. Numbers that are not kept per day (per-client rates, monthly figures) keep their own windows on the cards below.",
};

function useBounds<T extends { date: string }>(
  rows: T[],
  today: string,
  initial: "30d" | "mtd" | "7d",
) {
  const tf = useTimeframe(initial);
  const days = useMemo(() => rows.filter(r => r.date < today), [rows, today]);
  const first = days[0]?.date ?? null;
  const last = days[days.length - 1]?.date ?? null;
  const bounds = last ? tf.bounds(last, first) : null;
  const inRange = useMemo(
    () =>
      bounds
        ? days.filter(r => r.date >= bounds.from && r.date <= bounds.to)
        : [],
    [days, bounds],
  );
  return { tf, first, last, bounds, inRange, days: inRange.length };
}

export function DeliveryTimeframeCard({
  section,
  rows,
  now,
  day,
  order,
}: {
  section: CeoSection<"delivery"> | null;
  rows: { date: string; spend: number; leads: number; bookings: number }[];
  now: number;
  day: string | null;
  order: number;
}) {
  const today = day ?? kuwaitDay(now);
  const { tf, first, last, bounds, inRange, days } = useBounds(
    rows,
    today,
    "30d",
  );
  const spend = inRange.reduce((t, r) => t + r.spend, 0);
  const leads = inRange.reduce((t, r) => t + r.leads, 0);
  const bookings = inRange.reduce((t, r) => t + r.bookings, 0);
  return (
    <SectionCard
      kicker={`${count(days)} days`}
      title="Client ads over the timeframe"
      section={section}
      notes={[NOTE]}
      order={order}
    >
      {() => (
        <div className="grid gap-4">
          <TimeframeBar
            tf={tf}
            bounds={bounds}
            ariaLabel="Timeframe for client ads"
            first={first}
            last={last}
          />
          <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-5">
            <StatTile
              variant="plain"
              label="Client ad spend"
              value={money(spend)}
            />
            <StatTile variant="plain" label="Leads" value={count(leads)} />
            <StatTile
              variant="plain"
              label="Cost per lead"
              value={money(leads > 0 ? spend / leads : null)}
              naHint="No leads in these days."
            />
            <StatTile
              variant="plain"
              label="Bookings"
              value={count(bookings)}
              sub="all calendars, due"
            />
            <StatTile
              variant="plain"
              label="Cost per booking"
              value={money(bookings > 0 ? spend / bookings : null)}
              naHint="No bookings in these days."
            />
          </div>
        </div>
      )}
    </SectionCard>
  );
}

export function CallsTimeframeCard({
  section,
  rows,
  now,
  day,
  order,
}: {
  section: CeoSection<"calls"> | null;
  rows: {
    date: string;
    dials: number;
    connected: number;
    conversations90s: number;
  }[];
  now: number;
  day: string | null;
  order: number;
}) {
  const today = day ?? kuwaitDay(now);
  const { tf, first, last, bounds, inRange, days } = useBounds(
    rows,
    today,
    "7d",
  );
  const dials = inRange.reduce((t, r) => t + r.dials, 0);
  const connected = inRange.reduce((t, r) => t + r.connected, 0);
  const conv = inRange.reduce((t, r) => t + r.conversations90s, 0);
  return (
    <SectionCard
      kicker={`${count(days)} days`}
      title="Dials over the timeframe"
      section={section}
      notes={[NOTE]}
      order={order}
    >
      {() => (
        <div className="grid gap-4">
          <TimeframeBar
            tf={tf}
            bounds={bounds}
            ariaLabel="Timeframe for dials"
            first={first}
            last={last}
          />
          <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
            <StatTile variant="plain" label="Dials" value={count(dials)} />
            <StatTile
              variant="plain"
              label="Connected"
              value={count(connected)}
            />
            <StatTile
              variant="plain"
              label="Connect rate"
              value={pct(dials > 0 ? connected / dials : null)}
              naHint="No dials in these days."
            />
            <StatTile
              variant="plain"
              label="Conversations over 90 s"
              value={count(conv)}
            />
          </div>
        </div>
      )}
    </SectionCard>
  );
}

export function MoneyTimeframeCard({
  section,
  rails,
  now,
  day,
  order,
}: {
  section: CeoSection<"money"> | null;
  rails: {
    label: string;
    daily: { date: string; value: number }[];
    connected: boolean;
  }[];
  now: number;
  day: string | null;
  order: number;
}) {
  const today = day ?? kuwaitDay(now);
  const total = rails.find(r => r.label.startsWith("All rails")) ?? rails[0];
  const { tf, first, last, bounds, days } = useBounds(
    total?.daily ?? [],
    today,
    "mtd",
  );
  const sumIn = (daily: { date: string; value: number }[]) =>
    bounds
      ? daily
          .filter(
            p => p.date >= bounds.from && p.date <= bounds.to && p.date < today,
          )
          .reduce((t, p) => t + p.value, 0)
      : 0;
  return (
    <SectionCard
      kicker={`${count(days)} days`}
      title="Cash over the timeframe"
      section={section}
      notes={[NOTE]}
      order={order}
    >
      {() => (
        <div className="grid gap-4">
          <TimeframeBar
            tf={tf}
            bounds={bounds}
            ariaLabel="Timeframe for cash"
            first={first}
            last={last}
          />
          <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-5">
            {rails
              .filter(r => r.connected)
              .map(r => (
                <StatTile
                  key={r.label}
                  variant="plain"
                  label={r.label}
                  value={money(sumIn(r.daily))}
                />
              ))}
          </div>
        </div>
      )}
    </SectionCard>
  );
}
