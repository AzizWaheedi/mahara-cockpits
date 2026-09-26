import { ChartNoAxesColumn, Link2Off } from "lucide-react";
import { useMemo } from "react";
import { useSearchParams } from "react-router";
import { EmptyState, Failed, SourceNote, StatusChip } from "../components/kit";
import { NumbersBoard } from "../components/NumbersBoard";
import { DIALS_CAP, NumbersDials } from "../components/NumbersDials";
import { NumbersGoals } from "../components/NumbersGoals";
import { NumbersPay } from "../components/NumbersPay";
import { NumbersCalls, NumbersClosing } from "../components/NumbersTiles";
import { type CallRow, callGaps, speedToLead } from "../lib/calls";
import {
  useBoard,
  useDials,
  useNow,
  usePeople,
  useReps,
  useScoreRows,
  useSpeedToLead,
} from "../lib/data";
import { ago, kuwaitDay, kuwaitMidnight } from "../lib/format";
import {
  addDays,
  dialStats,
  rangeWords,
  teamTotal,
  windowDays,
} from "../lib/pay";
import type { Me, Person, Scorecard, WindowKey } from "../lib/types";

/**
 * How it is going: B2B's scorecard for a window, the Maqsam dials beside it,
 * the pace against the person's goals, their pay, and the team's rates.
 *
 * A rep sees their own numbers (row security returns only their scorecard
 * row and their own seat). A manager chooses the team total or one person;
 * the team total adds the counts and works every rate out again from the
 * sums, never averaging percentages.
 */

const WINDOWS: { key: WindowKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "d30", label: "Last 30 days" },
  { key: "d90", label: "Last 90 days" },
];

const TEAM = "team";

function asWindow(v: string | null): WindowKey {
  return WINDOWS.find(w => w.key === v)?.key ?? "week";
}

/** The seat a B2B scorecard row belongs to: by the linked rep, else by the HighLevel user B2B could not name. */
function seatFor(people: Person[], key: string): Person | null {
  const matches = people.filter(
    p =>
      p.b2b_rep_id === key ||
      (p.ghl_user_id ? `ghl:${p.ghl_user_id}` === key : false),
  );
  const score = (p: Person) =>
    (p.via_portal && p.active ? 4 : 0) +
    (Object.keys(p.pay ?? {}).length ? 2 : 0) +
    (Object.keys(p.goals ?? {}).length ? 1 : 0);
  return matches.sort((a, b) => score(b) - score(a))[0] ?? null;
}

export default function NumbersPage({ me }: { me: Me }) {
  const now = useNow(60_000);
  const today = kuwaitDay(now);
  const [params, setParams] = useSearchParams();
  const w = asWindow(params.get("w"));
  const manager = Boolean(me.manager);
  const who = manager ? params.get("who") || TEAM : null;

  const setParam = (k: string, v: string) =>
    setParams(
      prev => {
        const next = new URLSearchParams(prev);
        next.set(k, v);
        return next;
      },
      { replace: true },
    );

  const rows = useScoreRows(w);
  const board = useBoard(w);
  const people = usePeople();
  const reps = useReps();

  const rowList = rows.data ?? [];
  const boardList = board.data ?? [];
  const peopleList = people.data ?? [];

  // The window's days come from the scorecard row; before the window has a
  // row, from the board, and failing that from the mirror's own rules.
  const days = rowList[0]
    ? { from: rowList[0].from_day, to: rowList[0].to_day }
    : boardList[0]
      ? { from: boardList[0].from_day, to: boardList[0].to_day }
      : windowDays(w, now);
  const computedAt = [...rowList, ...boardList]
    .map(r => r.computed_at)
    .sort()
    .at(-1);
  // Whether B2B's scorecard has been read for this window at all: then a
  // person with no row had no calls and no closes, which is a real zero.
  const scored = rowList.length > 0 || boardList.length > 0;

  // Whose numbers.
  const team = who === TEAM;
  const key = manager ? (team ? null : who) : (me.b2b_rep_id ?? null);
  const row = key ? (rowList.find(r => r.person_key === key) ?? null) : null;
  const seat = manager
    ? key
      ? seatFor(peopleList, key)
      : null
    : (peopleList.find(p => p.email === me.email) ?? null);
  const self = !team && key !== null && key === (me.b2b_rep_id ?? null);
  const whose: "your" | "their" = manager && !self ? "their" : "your";

  let card: Scorecard | null = null;
  if (team) card = rowList.length ? teamTotal(rowList.map(r => r.row)) : null;
  else if (row) card = row.row;
  else if (key && scored) card = teamTotal([]);

  const name = team
    ? "Team total"
    : (row?.display_name ??
      boardList.find(r => r.person_key === key)?.display_name ??
      seat?.name ??
      "Someone");

  // Maqsam, by the seat's Maqsam email; the whole team when the team is chosen.
  const fromIso = kuwaitMidnight(days.from).toISOString();
  const toIso = kuwaitMidnight(addDays(days.to, 1)).toISOString();
  const maqsam = seat?.maqsam_email ?? null;
  const dials = useDials(fromIso, toIso, team ? null : (maqsam ?? "__none__"));
  const stats = useMemo(
    () => (dials.data ? dialStats(dials.data) : null),
    [dials.data],
  );
  const hasMaqsam = team || Boolean(maqsam);
  // The setter's rhythm: speed to lead (the first caller's cohort for one
  // rep, every lead for the team) and the gap between calls.
  const speedIn = useSpeedToLead(fromIso, toIso);
  const speed = useMemo(
    () =>
      speedIn.data
        ? speedToLead(
            speedIn.data.leads,
            speedIn.data.calls,
            team ? null : maqsam,
          )
        : null,
    [speedIn.data, team, maqsam],
  );
  const gaps = useMemo(
    () => (dials.data ? callGaps(dials.data as unknown as CallRow[]) : null),
    [dials.data],
  );

  const rep = useMemo(() => {
    const id =
      seat?.b2b_rep_id ??
      (key && !key.includes(":") && key !== "unattributed" ? key : null);
    return (reps.data ?? []).find(r => r.id === id) ?? null;
  }, [reps.data, seat, key]);

  // Everyone B2B has a row for in this window, for the manager's choice.
  const options = rowList.map(r => ({
    key: r.person_key,
    name: r.display_name ?? r.person_key,
  }));
  if (key && !options.some(o => o.key === key)) options.push({ key, name });
  const odd = (k: string) => k === "unattributed" || k.startsWith("ghl:");
  options.sort(
    (a, b) =>
      Number(odd(a.key)) - Number(odd(b.key)) || a.name.localeCompare(b.name),
  );

  const unlinked = !manager && !me.b2b_rep_id;
  const firstLoad =
    (rows.loading && !rows.data) || (board.loading && !board.data);
  // The seat carries the Maqsam email, the goals and the pay rule; until it
  // has been read, those cards wait rather than say "not set".
  const seatRead = Boolean(people.data);
  const noSeat = manager && !team && seatRead && !seat;

  return (
    <main className="mx-auto w-full max-w-6xl space-y-5 px-4 py-6 md:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">
            {manager ? "Numbers" : "Your numbers"}
          </h1>
          <p className="muted text-sm">
            {rangeWords(days.from, days.to)}
            {computedAt ? ` · scorecard as of ${ago(computedAt, now)}` : ""}
          </p>
        </div>
        {manager ? (
          <label className="flex min-w-0 items-center gap-2 text-sm">
            <span className="muted shrink-0">Whose numbers</span>
            <select
              value={team ? TEAM : (key ?? TEAM)}
              onChange={e => setParam("who", e.target.value)}
              className="h-9 min-w-0 max-w-[16rem] rounded-[var(--radius-md)] border hairline bg-[color:var(--background)] px-2 text-sm"
            >
              <option value={TEAM}>Team total</option>
              {options.map(o => (
                <option key={o.key} value={o.key}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </header>

      <div
        role="group"
        aria-label="Window"
        className="raised grid grid-cols-3 gap-0.5 rounded-[var(--radius-md)] p-0.5 text-sm lg:inline-flex"
      >
        {WINDOWS.map(x => (
          <button
            key={x.key}
            type="button"
            aria-pressed={w === x.key}
            onClick={() => setParam("w", x.key)}
            className={`whitespace-nowrap rounded-[calc(var(--radius-md)-2px)] px-2 py-1 sm:px-3 ${
              w === x.key
                ? "bg-[color:var(--card)] font-medium shadow-sm"
                : "muted"
            }`}
          >
            {x.label}
          </button>
        ))}
      </div>

      {people.error ? (
        <Failed what="The seats" error={people.error} retry={people.reload} />
      ) : null}

      {noSeat ? (
        <div className="callout-warn rounded-[var(--radius-md)] border px-3 py-2 text-sm">
          {name} has no seat in the sales cockpit, so there are no goals, pay
          rule or Maqsam email to show. Their calls and closes come from B2B.
        </div>
      ) : null}

      {unlinked ? (
        <section className="panel">
          <EmptyState
            icon={Link2Off}
            title="Your numbers are not linked yet."
            text="Aziz links your seat on the Team page. From then on your calls, closes and pay show here."
          />
        </section>
      ) : rows.error ? (
        <Failed what="The scorecard" error={rows.error} retry={rows.reload} />
      ) : firstLoad ? (
        <p className="muted text-sm">Loading the scorecard…</p>
      ) : !card ? (
        <section className="panel">
          <EmptyState
            icon={ChartNoAxesColumn}
            title="No scorecard for this window yet"
            text="Nobody has calls or closes in it yet, or B2B's scorecard has not been read. It is read every 15 minutes."
          />
        </section>
      ) : (
        <>
          <NumbersCalls
            card={card}
            side={
              !team && !row ? (
                <StatusChip
                  tone="neutral"
                  label={`No calls or closes for ${self ? "you" : name}`}
                />
              ) : (
                <span className="muted text-xs">
                  {team ? "Team total" : name}
                </span>
              )
            }
          />
          <NumbersClosing card={card} />
        </>
      )}

      {noSeat ? null : !team && !seatRead ? (
        people.error ? null : (
          <p className="muted text-sm">Loading the seat…</p>
        )
      ) : (
        <>
          <NumbersDials
            speed={speed}
            gaps={gaps}
            stats={stats}
            rows={dials.data?.length ?? 0}
            loading={dials.loading}
            error={dials.error}
            reload={dials.reload}
            hasMaqsam={hasMaqsam}
            team={team}
            self={!manager || self}
          />
          <div
            className={`grid grid-cols-1 gap-5 ${team ? "" : "lg:grid-cols-2"}`}
          >
            <NumbersGoals
              windowKey={w}
              fromDay={days.from}
              today={today}
              card={card}
              goals={seat?.goals ?? null}
              outboundDials={
                hasMaqsam && stats && !dials.error ? stats.outbound : null
              }
              hasMaqsam={hasMaqsam}
              team={team}
              whose={whose}
              onWindow={k => setParam("w", k)}
            />
            {team ? null : (
              <NumbersPay
                rule={seat?.pay ?? null}
                role={seat?.role ?? (manager ? null : (me.role ?? null))}
                rep={rep}
                card={card}
                fromIso={fromIso}
                toIso={toIso}
                whose={whose}
              />
            )}
          </div>
        </>
      )}

      <NumbersBoard
        rows={board.data}
        error={board.error}
        reload={board.reload}
        loading={board.loading && !board.data}
        mine={me.b2b_rep_id ?? null}
      />

      <SourceNote>
        <p>
          Calls and closes are B2B's rep scorecard, the one the CEO cockpit
          reads. B2B copies HighLevel every 15 minutes; the cockpit copies B2B
          every 3 minutes and reads the scorecard again every 15.
        </p>
        <p>
          Booked: calls whose time falls in the window. Due: booked calls whose
          time has passed. Shown: marked showed, or confirmed or disqualified
          once past. A past call nobody marked counts as shown until it is
          marked. Show rate: shown ÷ due. No-show and disqualified rates are
          also on due calls.
        </p>
        <p>
          Qualified: shown minus disqualified. Qualified rate: qualified ÷
          shown. Close rate: closes ÷ demos shown. Qualified close rate: closes
          ÷ qualified demos, B2B's own close rate. Closes are dated by the New
          Client Form, so a short window can pass 100%.
        </p>
        <p>
          Cash collected: the deposits recorded on the New Client Form. Revenue:
          the contracted value. Average deal: revenue ÷ closes. Cash per call:
          cash ÷ demos due. Cash per show: cash ÷ demos shown.
        </p>
        <p>
          Team total adds everyone's counts, the calls B2B could not put a name
          to included, and works each rate out again from the sums; it never
          averages percentages.
        </p>
        <p>
          Dials are Maqsam's calls under the seat's Maqsam email (B2B keeps
          calls for the agents on its roster). Connected: outbound calls Maqsam
          marks completed. Talk time: their length. At most{" "}
          {DIALS_CAP.toLocaleString("en-US")} calls are read per window.
        </p>
        <p>
          Goals: on this pace = so far ÷ working days so far (today included) ×
          working days in the period, Saturday to Thursday, Kuwait days. This
          week runs Saturday to Thursday; this month is the calendar month.
        </p>
        <p>
          Pay is an estimate from the deposits on the New Client Form, matched
          to the closer by B2B's closer names and the rep's display name. B2B's
          scorecard credits a close by the closer names alone, so the two can
          differ by a deal typed under the display name.
        </p>
      </SourceNote>
    </main>
  );
}
