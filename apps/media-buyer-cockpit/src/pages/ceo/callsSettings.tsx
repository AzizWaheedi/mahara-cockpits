import { useAction } from "convex/react";
import { useEffect, useMemo, useState } from "react";
import { date } from "@/components/ceo/format";
import { SectionCard } from "@/components/ceo/SectionCard";
import { StatusChip } from "@/components/ceo/StatusChip";
import { useRefresh } from "@/components/ceo/useCeo";
import { cn } from "@/lib/utils";
import { api } from "../../../convex/_generated/api";
import type { WorkingHours } from "../../../convex/ceo/payloads";
import {
  DAY_NAMES,
  DAY_SHORT,
  DEFAULT_WORKING_HOURS,
  describeWorkingHours,
  normalizeWorkingHours,
  parseTime,
  WEEK_ORDER,
} from "../../../convex/ceo/workingHours";

/**
 * The working hours the speed to lead clock runs on (Aziz, 2026-09-21).
 *
 * One rule, drawn: the day as a rail with the working window on it, the
 * week as seven chips with the day off left blank. The hours are saved to
 * cockpit_settings by the CEO and apply to the next refresh of the Calls
 * section, which saving starts.
 */

type Form = { start: string; end: string; days: number[] };

const TICKS = [0, 6, 12, 18, 24];
const FIELD =
  "h-8 w-full rounded-md border bg-background px-2 text-sm text-foreground tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const pad = (n: number) => String(n).padStart(2, "0");

const sameDays = (a: number[], b: number[]) =>
  [...new Set(a)].sort().join() === [...new Set(b)].sort().join();

const message = (e: unknown) =>
  String(e instanceof Error ? e.message : e).slice(0, 240);

export function CallsSettingsCard({
  inForce,
  order,
}: {
  /** The hours the last refresh ran on, from the calls payload, shown until the saved ones load. */
  inForce?: WorkingHours;
  order?: number;
}) {
  const load = useAction(api.ceo.settings.get);
  const save = useAction(api.ceo.settings.setWorkingHours);
  const { refresh } = useRefresh();

  const [stored, setStored] = useState<WorkingHours | null>(null);
  const [ready, setReady] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    load({})
      .then(r => {
        if (!alive) return;
        setStored(r.hours);
        setReady(r.ready);
        setProblem(r.problem);
        setForm(
          f =>
            f ?? { start: r.hours.start, end: r.hours.end, days: r.hours.days },
        );
      })
      .catch(e => {
        if (alive) setError(message(e));
      });
    return () => {
      alive = false;
    };
  }, [load]);

  const base = stored ?? inForce ?? DEFAULT_WORKING_HOURS;
  const f: Form = form ?? { start: base.start, end: base.end, days: base.days };
  const dirty =
    f.start !== base.start ||
    f.end !== base.end ||
    !sameDays(f.days, base.days);

  // The same check the server runs, so the button never sends what it would refuse.
  const invalid = useMemo(() => {
    try {
      normalizeWorkingHours({ ...f, timezone: base.timezone }, "settings");
      return null;
    } catch (e) {
      return message(e);
    }
  }, [f, base.timezone]);

  // The working window on the day rail, as a share of 24 hours.
  const band = useMemo(() => {
    try {
      const a = parseTime(f.start);
      const b = parseTime(f.end);
      return b > a
        ? { left: (a / 1440) * 100, width: ((b - a) / 1440) * 100 }
        : null;
    } catch {
      return null;
    }
  }, [f.start, f.end]);

  function set(patch: Partial<Form>) {
    setForm({ ...f, ...patch });
    setSaved(null);
  }

  function toggle(day: number) {
    set({
      days: f.days.includes(day)
        ? f.days.filter(d => d !== day)
        : [...f.days, day],
    });
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const r = await save({
        start: f.start,
        end: f.end,
        days: f.days,
        timezone: base.timezone,
      });
      setStored(r.hours);
      setProblem(null);
      setForm({ start: r.hours.start, end: r.hours.end, days: r.hours.days });
      setSaved(
        `Saved ${describeWorkingHours(r.hours)}. Refreshing the Calls numbers.`,
      );
      await refresh(["calls"]);
    } catch (e) {
      setError(message(e));
    }
    setBusy(false);
  }

  const status =
    stored?.source === "settings" ? (
      <StatusChip
        tone="good"
        label={stored.updatedAt ? `Saved ${date(stored.updatedAt)}` : "Saved"}
        hint="These hours are saved in the cockpit and drive the working clock."
      />
    ) : (
      <StatusChip
        tone="neutral"
        label="Default until saved"
        hint="Nothing is saved yet, so the clock runs on the default: 10:00 to 18:00 Kuwait, Saturday to Thursday."
      />
    );

  return (
    <SectionCard
      kicker="Speed to lead rule"
      title="Working hours"
      order={order}
      actions={status}
      bodyClassName="space-y-5"
    >
      {() => (
        <>
          <p className="text-sm leading-relaxed text-muted-foreground">
            The clock starts at the later of the lead's creation and the next
            working window, and only working minutes count.
          </p>

          {ready ? null : (
            <p className="rounded-md border border-[var(--ceo-warning)] p-3 text-sm">
              The settings table does not exist yet. Run{" "}
              <code>supabase/migrations/20260921a_cockpit_settings.sql</code> in
              the Creative Triage SQL editor.
            </p>
          )}
          {ready && problem ? (
            <p className="text-xs leading-relaxed text-muted-foreground">
              {problem}
            </p>
          ) : null}

          {/* The day, 00:00 to 24:00, with the working window drawn on it. */}
          <div>
            <div
              className="relative h-2 overflow-hidden rounded-full bg-[var(--ceo-emphasis-track)]"
              aria-hidden
            >
              {band ? (
                <div
                  className="absolute inset-y-0 rounded-full transition-[left,width] duration-200 motion-reduce:transition-none"
                  style={{
                    left: `${band.left}%`,
                    width: `${band.width}%`,
                    backgroundColor: "var(--ceo-emphasis)",
                  }}
                />
              ) : null}
            </div>
            <div
              className="mt-1 flex justify-between text-[10px] leading-4 text-muted-foreground tabular-nums"
              aria-hidden
            >
              {TICKS.map(h => (
                <span key={h}>{pad(h)}</span>
              ))}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="grid gap-1 text-xs text-muted-foreground">
                From
                <input
                  type="time"
                  className={FIELD}
                  value={f.start}
                  onChange={e => set({ start: e.target.value })}
                />
              </label>
              <label className="grid gap-1 text-xs text-muted-foreground">
                To
                <input
                  type="time"
                  className={FIELD}
                  value={f.end}
                  onChange={e => set({ end: e.target.value })}
                />
              </label>
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">Kuwait time.</p>
          </div>

          {/* The week, Saturday first; the day off stays blank. */}
          <div
            role="group"
            aria-label="Working days"
            className="grid grid-cols-7 gap-1"
          >
            {WEEK_ORDER.map(d => {
              const on = f.days.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  aria-label={`${DAY_NAMES[d]}, ${on ? "working" : "off"}`}
                  onClick={() => toggle(d)}
                  className={cn(
                    "h-8 rounded-md border text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    on
                      ? "border-[color:var(--ceo-emphasis)] bg-[var(--ceo-emphasis-wash)] text-foreground"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  {DAY_SHORT[d]}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <button
              type="button"
              disabled={busy || !ready || !dirty || invalid !== null}
              onClick={submit}
              className="rounded-md bg-foreground px-3 py-1.5 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Saving" : "Save hours"}
            </button>
            <p className="text-xs text-muted-foreground">
              Applies to the next refresh.
            </p>
          </div>
          {dirty && invalid ? (
            <p className="text-xs text-[var(--ceo-critical)]">{invalid}</p>
          ) : null}
          {saved ? (
            <p className="text-sm text-muted-foreground">{saved}</p>
          ) : null}
          {error ? (
            <p className="text-sm text-[var(--ceo-critical)]">{error}</p>
          ) : null}
        </>
      )}
    </SectionCard>
  );
}
