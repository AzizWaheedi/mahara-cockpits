import { CircleAlert, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  ALERT_KIND_WORDS,
  ALERT_KINDS,
  type AlertKind,
  type AlertRulesPatch,
  type AlertRulesRead,
  readAlertRules,
  setAlertRules,
} from "@/lib/requestsAdmin";
import { errorWords, RequestError } from "@/lib/requestsClient";
import { useTaskSeat } from "@/lib/taskSeat";

/*
 * Hallmark · component: alert rules · genre: modern-minimal (the cockpit's)
 * · theme: the portal's own tokens (docs/DESIGN.md)
 * states: default · hover · focus · active · disabled · loading · error · success
 * pre-emit critique: P4 H4 E4 S4 R5 V4
 *
 * One card, one flush list: the eight things that can raise an alert, each
 * a line of words and a switch that saves at once (the switch moving is the
 * success; a refusal shows under its row). "A failed request" cannot be
 * turned off. Under the list, the shift that times the daily due and late
 * alerts, then one muted line about Slack. Editors pick a seat above.
 */

/** The Slack line (CONTRACT.md 6.4), exactly. */
export const SLACK_LINE =
  "Slack: new assignments already post in your team's channel. Slack messages for these alerts are not switched on yet.";

const NOT_ON_DB =
  "Task alerts are not on the database yet. They switch on with the next release.";

const DAY_NAMES: Record<string, string> = {
  sun: "Sunday",
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
};
const WEEK = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/** "Sunday to Thursday", "Sunday, Tuesday and Thursday", or the server's words. */
export function shiftDays(days: AlertRulesRead["shift"]["days"]): string {
  if (!days) return "Sunday to Thursday";
  if (typeof days === "string") return days;
  const keys = days
    .map(d => String(d).slice(0, 3).toLowerCase())
    .filter(d => WEEK.includes(d))
    .sort((a, b) => WEEK.indexOf(a) - WEEK.indexOf(b));
  if (!keys.length) return "no working days";
  const first = WEEK.indexOf(keys[0]);
  const run = keys.every((k, i) => WEEK.indexOf(k) === first + i);
  if (run && keys.length >= 3)
    return `${DAY_NAMES[keys[0]]} to ${DAY_NAMES[keys[keys.length - 1]]}`;
  const names = keys.map(k => DAY_NAMES[k]);
  return names.length === 1
    ? names[0]
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Where the shift comes from, in words (6.4). */
export function shiftSource(source: AlertRulesRead["shift"]["source"]): string {
  if (source === "rules") return "Set here";
  if (source === "schedule") return "From your schedule";
  return "The default";
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Alerts (every seat): which task alerts this seat gets and when the daily
 * ones come. An editor can open another seat's rules from the picker.
 */
export function AlertRules() {
  const seat = useTaskSeat();
  const client = seat.client;
  const [memberId, setMemberId] = useState<string | null>(null);
  // The seat's own member id, from the first read (no member asked for).
  const [selfId, setSelfId] = useState<string | null>(null);
  const [read, setRead] = useState<
    | { status: "loading" }
    | { status: "ready"; data: AlertRulesRead }
    | { status: "error"; error: string }
  >({ status: "loading" });
  const [saving, setSaving] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{
    key: string;
    text: string;
  } | null>(null);
  const [editingShift, setEditingShift] = useState(false);
  const [start, setStart] = useState("10:00");
  const [end, setEnd] = useState("18:00");
  const ids = useId();

  const load = useCallback(
    async (who: string | null) => {
      if (!client) return;
      setRead(r => (r.status === "ready" ? r : { status: "loading" }));
      try {
        const data = await readAlertRules(client, who);
        if (who === null) setSelfId(data.member.id);
        setRead({ status: "ready", data });
      } catch (e) {
        setRead({
          status: "error",
          error:
            e instanceof RequestError &&
            (e.code === "PGRST202" || e.code === "42883")
              ? NOT_ON_DB
              : errorWords(e),
        });
      }
    },
    [client],
  );
  useEffect(() => {
    if (seat.ready && client) void load(memberId);
  }, [seat.ready, client, memberId, load]);

  async function save(key: string, patch: AlertRulesPatch): Promise<boolean> {
    if (!client || read.status !== "ready" || saving) return false;
    setSaving(key);
    setRowError(null);
    try {
      const data = await setAlertRules(client, read.data.member.id, patch);
      setRead({ status: "ready", data });
      return true;
    } catch (e) {
      setRowError({ key, text: errorWords(e) });
      return false;
    } finally {
      setSaving(null);
    }
  }

  if (read.status === "loading")
    return (
      <section className="max-w-3xl rounded-2xl border bg-card p-4 sm:p-6">
        <p
          className="flex items-center gap-2 text-sm text-muted-foreground"
          role="status"
        >
          <LoaderCircle aria-hidden className="size-4 animate-spin" />
          Reading your alert settings
        </p>
      </section>
    );
  if (read.status === "error")
    return (
      <section className="max-w-3xl rounded-2xl border bg-card p-4 sm:p-6">
        <div className="flex items-start gap-2 text-sm" role="alert">
          <CircleAlert
            aria-hidden
            className="mt-0.5 size-4 shrink-0 text-destructive"
          />
          <div className="space-y-2">
            <p>{read.error}</p>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void load(memberId)}
            >
              Try again
            </Button>
          </div>
        </div>
      </section>
    );

  const { member, rules, shift, seats, canEditOthers } = read.data;
  const own = selfId === null || member.id === selfId;
  const kinds = new Set<AlertKind>(rules.kinds);

  async function toggle(kind: AlertKind, on: boolean) {
    const next = ALERT_KINDS.filter(k =>
      k === kind ? on : k === "request_failed" || kinds.has(k),
    );
    await save(kind, { kinds: next });
  }

  async function saveShift() {
    if (!HHMM.test(start) || !HHMM.test(end)) {
      setRowError({
        key: "shift",
        text: "Shift: use a start and an end time, for example 10:00 and 18:00.",
      });
      return;
    }
    if (start >= end) {
      setRowError({
        key: "shift",
        text: "Shift: the end comes after the start.",
      });
      return;
    }
    if (await save("shift", { shiftStart: start, shiftEnd: end }))
      setEditingShift(false);
  }

  const shiftWords = `${shift.start ?? "10:00"} to ${shift.end ?? "18:00"}, ${shiftDays(shift.days)}`;

  return (
    <section className="max-w-3xl rounded-2xl border bg-card">
      <header className="space-y-3 px-4 pt-4 pb-3 sm:px-6 sm:pt-6">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">
            {own ? "Your alerts" : `Alerts for ${member.label}`}
          </h2>
          <p className="mt-1 max-w-prose text-xs leading-5 text-muted-foreground">
            The bell in every cockpit shows these for tasks assigned to{" "}
            {own ? "you" : "this seat"} in ClickUp. It checks every 2 minutes
            while a cockpit is open.
          </p>
        </div>
        {canEditOthers && seats?.length ? (
          <div className="max-w-xs space-y-1.5">
            <label htmlFor={`${ids}-seat`} className="text-[13px] font-medium">
              Seat
            </label>
            <select
              id={`${ids}-seat`}
              className="block h-10 w-full min-w-0 rounded-lg border bg-background px-3 text-sm outline-none transition-colors hover:bg-accent/30 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-55"
              value={member.id}
              disabled={saving !== null}
              onChange={e => {
                setEditingShift(false);
                setRowError(null);
                setMemberId(e.target.value);
              }}
            >
              {seats.some(s => s.memberId === member.id) ? null : (
                <option value={member.id}>{member.label}</option>
              )}
              {seats.map(s => (
                <option key={s.memberId} value={s.memberId}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </header>

      <ul className="divide-y border-t" aria-label="Alerts">
        {ALERT_KINDS.map(kind => {
          const words = ALERT_KIND_WORDS[kind];
          const always = kind === "request_failed";
          const on = always || kinds.has(kind);
          const switchId = `${ids}-${kind}`;
          return (
            <li key={kind} className="px-4 py-3 sm:px-6">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor={switchId} className="min-w-0">
                  <span className="block text-sm font-medium">
                    {words.label}
                  </span>
                  <span className="block text-[13px] text-muted-foreground">
                    {always ? "Always on. " : ""}
                    {words.hint}
                  </span>
                </label>
                <div className="flex shrink-0 items-center gap-2">
                  {saving === kind ? (
                    <LoaderCircle
                      aria-label="Saving"
                      className="size-4 animate-spin text-muted-foreground"
                    />
                  ) : null}
                  <Switch
                    id={switchId}
                    checked={on}
                    disabled={always || saving !== null}
                    aria-describedby={
                      rowError?.key === kind ? `${switchId}-error` : undefined
                    }
                    onCheckedChange={next => void toggle(kind, next)}
                  />
                </div>
              </div>
              {rowError?.key === kind ? (
                <p
                  id={`${switchId}-error`}
                  className="mt-1 text-[13px] text-destructive"
                  role="alert"
                >
                  {rowError.text}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>

      <div className="space-y-3 border-t px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <h3 className="text-sm font-medium">
              {own ? "Your shift" : "Their shift"}
            </h3>
            <p className="text-[13px] text-muted-foreground">
              <span className="tabular-nums">{shiftWords}</span>.{" "}
              {shiftSource(shift.source)}. Due today and late task alerts come
              at its start.
            </p>
          </div>
          {editingShift ? null : (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={saving !== null}
                onClick={() => {
                  setStart(rules.shiftStart ?? shift.start ?? "10:00");
                  setEnd(rules.shiftEnd ?? shift.end ?? "18:00");
                  setRowError(null);
                  setEditingShift(true);
                }}
              >
                Set the hours here
              </Button>
              {shift.source === "rules" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={saving !== null}
                  aria-busy={saving === "shift" || undefined}
                  onClick={() =>
                    void save("shift", { shiftStart: null, shiftEnd: null })
                  }
                >
                  {saving === "shift" ? (
                    <LoaderCircle aria-hidden className="animate-spin" />
                  ) : null}
                  Use the schedule
                </Button>
              ) : null}
            </div>
          )}
        </div>
        {editingShift ? (
          <div className="flex flex-wrap items-end gap-3 rounded-xl bg-muted/40 p-3">
            <div className="space-y-1.5">
              <label
                htmlFor={`${ids}-start`}
                className="block text-[13px] font-medium"
              >
                Starts
              </label>
              <input
                id={`${ids}-start`}
                type="time"
                className="block h-10 w-32 rounded-lg border bg-background px-3 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[invalid=true]:border-destructive"
                value={start}
                aria-invalid={rowError?.key === "shift" ? true : undefined}
                onChange={e => setStart(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor={`${ids}-end`}
                className="block text-[13px] font-medium"
              >
                Ends
              </label>
              <input
                id={`${ids}-end`}
                type="time"
                className="block h-10 w-32 rounded-lg border bg-background px-3 text-sm tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[invalid=true]:border-destructive"
                value={end}
                aria-invalid={rowError?.key === "shift" ? true : undefined}
                onChange={e => setEnd(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={saving !== null}
                aria-busy={saving === "shift" || undefined}
                onClick={() => void saveShift()}
              >
                {saving === "shift" ? (
                  <LoaderCircle aria-hidden className="animate-spin" />
                ) : null}
                {saving === "shift" ? "Saving" : "Save the hours"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={saving !== null}
                onClick={() => {
                  setEditingShift(false);
                  setRowError(null);
                }}
              >
                Keep as it is
              </Button>
            </div>
          </div>
        ) : null}
        {rowError?.key === "shift" ? (
          <p className="text-[13px] text-destructive" role="alert">
            {rowError.text}
          </p>
        ) : null}
      </div>

      <p className="border-t px-4 py-3 text-[13px] text-muted-foreground sm:px-6">
        {SLACK_LINE}
      </p>
    </section>
  );
}
