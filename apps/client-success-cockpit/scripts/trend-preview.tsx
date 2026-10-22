/**
 * Local-only visual check of the Results tab's ratio cards (R9, 2026-10-21;
 * repaired 2026-10-22): each headline adds up the complete days both sides
 * are on record for, names them, and colours a cost per booking on the grid's
 * bands, with "None on $233" for spend that booked nothing. The numbers are
 * City Wood's This month on 21 Oct, then the edge cases. No connection,
 * nothing written.
 */
import { createRoot } from "react-dom/client";
import {
  costJudge,
  type Headline,
  pairedFromRecord,
  partialBucket,
  ratioHead,
  TrendChart,
  type TrendPoint,
} from "../src/components/TrendChart";
import { plural } from "../src/lib/format";
import { CPB_BAD, CPB_GATE } from "../src/lib/kpi";
import { dayLabel } from "../src/lib/reportPeriod";
import "../src/index.css";

const TODAY = "2026-10-21";
const SPEND: [string, number, number][] = [
  ["2026-10-01", 32.04, 3],
  ["2026-10-02", 45.55, 0],
  ["2026-10-03", 24.3, 0],
  ["2026-10-04", 37.56, 1],
  ["2026-10-05", 37.22, 7],
  ["2026-10-06", 37.68, 2],
  ["2026-10-07", 35.34, 2],
  ["2026-10-08", 33.47, 1],
  ["2026-10-09", 28.85, 2],
  ["2026-10-13", 8.62, 1],
  ["2026-10-14", 58.05, 2],
  ["2026-10-15", 56.48, 2],
  ["2026-10-16", 59.8, 5],
  ["2026-10-17", 58.96, 5],
  ["2026-10-18", 41.26, 2],
  ["2026-10-19", 44.67, 6],
  ["2026-10-20", 34.78, 10],
];
type Day = { date: string; spend: number; leads: number };
type Appt = { date: string; booked: boolean };
const daily: Day[] = SPEND.map(([date, spend, leads]) => ({
  date,
  spend,
  leads,
}));
const appts: Appt[] = [
  ...Array(3).fill("2026-10-20"),
  ...Array(4).fill("2026-10-21"),
].map(date => ({ date, booked: true }));
const done = (pts: TrendPoint[]) =>
  pts.map(p => ({ ...p, partial: partialBucket(p.x, false, TODAY) }));
const spent = (n: number) =>
  n ? `$${Math.round(n).toLocaleString("en-US")} spent` : "";
const sum = (rows: Day[]) => rows.reduce((s, r) => s + r.spend, 0);
const booked = (rows: Appt[]) => rows.filter(r => r.booked).length;
const judge = costJudge(CPB_GATE, CPB_BAD);

function Card({
  title,
  spend,
  bookings,
  from,
  to,
  hint,
  head,
}: {
  title: string;
  spend: Day[];
  bookings: Appt[];
  from: string;
  to: string;
  hint?: string;
  head?: Headline;
}) {
  const pair = pairedFromRecord(spend, bookings, from, to, TODAY, sum, booked);
  return (
    <TrendChart
      title={title}
      points={done(pair.points)}
      unit="$"
      mode="avg"
      goodWhen="down"
      head={
        head ??
        ratioHead(pair, {
          unit: "$",
          none: "No bookings yet",
          noTop: "No spend found",
          parts: (n, d) =>
            [spent(n), plural(d, "booking")].filter(Boolean).join(" · "),
          judge,
        })
      }
      hint={
        hint ??
        (pair.since
          ? `Spend before ${dayLabel(pair.since)} is not on record, so the days before it are left out.`
          : undefined)
      }
    />
  );
}

const flat = (from: string, days: number, each: number): Day[] =>
  Array.from({ length: days }, (_, i) => ({
    date: new Date(Date.parse(`${from}T00:00:00Z`) + i * 86400_000)
      .toISOString()
      .slice(0, 10),
    spend: each,
    leads: 1,
  }));

function Preview() {
  return (
    <main className="mx-auto max-w-5xl space-y-8 p-4 py-10 sm:p-10">
      <p className="text-xs text-muted-foreground">
        Local preview · Today is {TODAY} · Nothing is read or written
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 lg:gap-4">
        <Card
          title="City Wood, this month (bad)"
          spend={daily}
          bookings={appts}
          from="2026-10-01"
          to={TODAY}
        />
        <Card
          title="City Wood, 14-20 Oct (bad)"
          spend={daily}
          bookings={appts}
          from="2026-10-14"
          to="2026-10-20"
        />
        <Card
          title="Nothing booked on $233 (bad)"
          spend={flat("2026-10-14", 7, 33.34)}
          bookings={[]}
          from="2026-10-14"
          to="2026-10-20"
        />
        <Card
          title="Nothing booked on $70 (warning)"
          spend={flat("2026-10-14", 7, 10)}
          bookings={[]}
          from="2026-10-14"
          to="2026-10-20"
        />
        <Card
          title="Nothing booked on $49 (too early)"
          spend={flat("2026-10-14", 7, 7)}
          bookings={[]}
          from="2026-10-14"
          to="2026-10-20"
        />
        <Card
          title="$43.63 a booking (good)"
          spend={flat("2026-10-14", 7, 24.93)}
          bookings={Array(4).fill({ date: "2026-10-15", booked: true })}
          from="2026-10-14"
          to="2026-10-20"
        />
        <Card
          title="Spend on record from 7 Oct"
          spend={flat("2026-10-07", 14, 24)}
          bookings={[
            ...Array(7).fill({ date: "2026-09-25", booked: true }),
            ...Array(5).fill({ date: "2026-10-12", booked: true }),
          ]}
          from="2026-09-21"
          to="2026-10-20"
        />
        <Card
          title="Bookings, no spend on record"
          spend={[]}
          bookings={Array(2).fill({ date: "2026-10-15", booked: true })}
          from="2026-10-01"
          to="2026-10-20"
        />
        <Card
          title="Sheet not read"
          spend={flat("2026-10-14", 7, 30)}
          bookings={[]}
          from="2026-10-14"
          to="2026-10-20"
          head={{ text: "Sheet not read", basis: "14–20 Oct · $210 spent" }}
          hint="The client's performance sheet could not be read, so its bookings are unknown, not zero."
        />
      </div>
    </main>
  );
}

const root = document.getElementById("root");
if (root) createRoot(root).render(<Preview />);
