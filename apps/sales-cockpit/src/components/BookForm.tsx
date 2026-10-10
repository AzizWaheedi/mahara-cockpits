import { ArrowLeft, CalendarPlus } from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { api, uncertain } from "../lib/api";
import type { ItemKind } from "../lib/dialerUi";
import { clock, dayLabel } from "../lib/format";
import { toast } from "../lib/toast";
import type { Me } from "../lib/types";
import { buttonPrimary } from "./kit";
import { Segmented } from "./ScriptParts";

/**
 * Booking on the HighLevel calendar from the cockpit (mahara-power-dialer's
 * booking path): the calendar's free times, the booking written down first,
 * created with HighLevel's own free-slot check on, and read back before the
 * outcome is saved. Moved out of DialerPage.tsx unchanged (sales simplify,
 * 2026-10-10) so the intro script's booking block opens it for More times.
 */

export type As = "setter" | "closer";

export interface Slots {
  kind: "intro" | "demo";
  calendar_id: string;
  calendar: string;
  minutes: number;
  with: "me" | "anyone";
  /** Asked for the rep's own times, found none, so these are the team's. */
  fallback: boolean;
  on_team: boolean;
  notice: string;
  existing: { id: string; start: string; words: string } | null;
  /** When moving a booked call: the call as it stands. */
  moving?: { id: string; start: string; words: string } | null;
  days: { day: string; slots: string[] }[];
  /** The calendar's public booking page, for the lead to pick a time; none when it is switched off. */
  booking_url?: string | null;
}

const msg = (e: unknown) => String((e as Error)?.message ?? e);

function dayWords(day: string): string {
  const d = new Date(`${day}T12:00:00+03:00`);
  return dayLabel(d.toISOString());
}

export function BookForm({
  me,
  as,
  contactId,
  attemptId,
  kindFirst,
  moving,
  note,
  onNote,
  onClose,
  onBooked,
  closeLabel = "Back to outcomes",
}: {
  me: Me;
  as: As;
  contactId: string;
  attemptId: string | null;
  /** Which call to book first (the demo, right after an intro was held). */
  kindFirst?: "intro" | "demo" | null;
  /** Move this booked call instead of booking a new one. */
  moving?: { id: string; itemKind: ItemKind } | null;
  note: string;
  onNote: (note: string) => void;
  onClose: () => void;
  onBooked: (words: string) => void;
  /** The close button's words, where it does not go back to outcomes. */
  closeLabel?: string;
}) {
  const [kind, setKind] = useState<"intro" | "demo">(
    kindFirst ?? (as === "closer" ? "demo" : "intro"),
  );
  const [withWho, setWithWho] = useState<"me" | "anyone">("me");
  const [slots, setSlots] = useState<Slots | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [start, setStart] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // At once, so a double tap never books twice.
  const booking = useRef(false);
  // A booking that got no clear answer: said until the calendar is read again.
  const [unsure, setUnsure] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // A booking sent without a clear answer: the time it asked for, so the
  // calendar read after it can tell whether it landed.
  const tried = useRef<string | null>(null);
  const bookedRef = useRef(onBooked);
  bookedRef.current = onBooked;

  // biome-ignore lint/correctness/useExhaustiveDependencies: tick asks again after a time was taken
  useEffect(() => {
    let alive = true;
    setSlots(null);
    setError(null);
    setStart(null);
    api<Slots>(
      "book.slots",
      moving
        ? { appointment_id: moving.id }
        : { contact_id: contactId, kind, with: withWho },
    )
      .then(s => {
        if (!alive) return;
        const asked = tried.current;
        tried.current = null;
        if (asked) {
          const there = moving ? s.moving : s.existing;
          if (there && Date.parse(there.start) === Date.parse(asked)) {
            bookedRef.current(
              moving
                ? `Moved to ${there.words} (Kuwait time)`
                : `${s.kind === "demo" ? "Demo" : "Intro"} booked for ${there.words} (Kuwait time)`,
            );
            return;
          }
          setUnsure(
            "The calendar does not show it yet. Pick the time and book again: a booking already on its way is refused, never made twice.",
          );
        }
        setSlots(s);
        setDay(s.days[0]?.day ?? null);
      })
      .catch(e => alive && setError(msg(e)));
    return () => {
      alive = false;
    };
  }, [contactId, kind, withWho, tick, moving?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function book(e: FormEvent) {
    e.preventDefault();
    if (!start || booking.current) return;
    booking.current = true;
    setBusy(true);
    setUnsure(null);
    try {
      const out = await api<{ verified: boolean; words: string }>(
        moving ? "book.move" : "book.create",
        moving
          ? {
              appointment_id: moving.id,
              start,
              note,
              as,
              attempt_id: attemptId,
              item_kind: moving.itemKind,
            }
          : {
              contact_id: contactId,
              kind,
              with: slots?.with ?? withWho,
              start,
              note,
              as,
              attempt_id: attemptId,
            },
      );
      if (!out.verified)
        toast.error(
          "HighLevel took the booking, but reading it back did not match. Open the lead in HighLevel and check the time.",
        );
      onBooked(out.words);
    } catch (err) {
      if (uncertain(err)) {
        // It may have landed: the calendar is read again, and a booking
        // that did land at this time moves on to the next lead.
        tried.current = start;
        setUnsure(
          "No answer came back about the booking, so it may have gone through. Checking the calendar…",
        );
        setTick(n => n + 1);
      } else {
        toast.error(msg(err));
        // A time someone else just took: show what is free now.
        if (/taken|already have/i.test(msg(err))) setTick(n => n + 1);
      }
    } finally {
      booking.current = false;
      setBusy(false);
    }
  }

  const shown = slots?.days.find(d => d.day === day) ?? null;
  return (
    <form onSubmit={book} className="space-y-3 border-t hairline pt-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">
          {moving ? "Move the call" : "Book a time"}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="muted inline-flex items-center gap-1 text-xs hover:underline"
          title="Esc"
        >
          <ArrowLeft className="size-3.5" aria-hidden /> {closeLabel}
        </button>
      </div>
      {moving ? (
        <p className="muted text-sm">
          {slots?.moving
            ? `Now: ${slots.moving.words} (Kuwait time), with the same person. Pick the new time.`
            : "Reading the call…"}
        </p>
      ) : null}
      <div
        className={`flex flex-wrap items-center gap-2 ${moving ? "hidden" : ""}`}
      >
        <Segmented
          label="Which call"
          value={kind}
          options={[
            ["intro", "Intro, 15 min"],
            ["demo", "Demo, 45 min"],
          ]}
          onChange={v => setKind(v as "intro" | "demo")}
        />
        {slots?.on_team && !slots.fallback ? (
          <Segmented
            label="With whom"
            value={withWho}
            options={[
              ["me", `With ${(me.name ?? "me").split(/\s+/)[0]}`],
              ["anyone", "Anyone free"],
            ]}
            onChange={v => setWithWho(v as "me" | "anyone")}
          />
        ) : null}
      </div>
      {error ? (
        <p className="callout-bad rounded-[var(--radius-md)] border px-3 py-2 text-sm">
          The calendar could not be read: {error}
        </p>
      ) : !slots ? (
        <p className="muted text-sm">Reading the calendar's free times…</p>
      ) : slots.existing ? (
        <p className="callout-warn rounded-[var(--radius-md)] border px-3 py-2 text-sm">
          They already have {kind === "intro" ? "an intro" : "a demo"} on{" "}
          {slots.existing.words} (Kuwait time). Move that one in HighLevel
          instead of booking a second; if it was booked from here or by the
          lead, save the call as Handled.
        </p>
      ) : !slots.days.length ? (
        <p className="callout-warn rounded-[var(--radius-md)] border px-3 py-2 text-sm">
          No free times on this calendar in the next few days.{" "}
          {slots.with === "me" && slots.on_team
            ? "Try Anyone free, or book in HighLevel."
            : "Book in HighLevel, or set a call-back instead."}
        </p>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1" role="group" aria-label="Day">
            {slots.days.map(d => (
              <button
                key={d.day}
                type="button"
                aria-pressed={day === d.day}
                onClick={() => {
                  setDay(d.day);
                  setStart(null);
                }}
                className={`rounded-full border px-2.5 py-0.5 text-xs ${
                  day === d.day
                    ? "border-[color:var(--primary)] font-semibold"
                    : "hairline"
                }`}
              >
                {dayWords(d.day)}{" "}
                <span className="muted tabular-nums">{d.slots.length}</span>
              </button>
            ))}
          </div>
          <div
            className="grid grid-cols-4 gap-1 sm:grid-cols-6 xl:grid-cols-4"
            role="group"
            aria-label="Time"
          >
            {(shown?.slots ?? []).map(s => (
              <button
                key={s}
                type="button"
                aria-pressed={start === s}
                onClick={() => setStart(s)}
                className={`rounded-[var(--radius-sm)] border px-1 py-1 text-xs tabular-nums ${
                  start === s
                    ? "border-[color:var(--primary)] bg-[color:color-mix(in_oklch,var(--primary)_14%,transparent)] font-semibold"
                    : "hairline hover:bg-[color:var(--secondary)]"
                }`}
              >
                {clock(s)}
              </button>
            ))}
          </div>
          {slots.fallback ? (
            <p className="muted text-xs">
              You have no free time of your own on this calendar in the next few
              days, so these are the team's; HighLevel's round robin picks who
              takes the call.
            </p>
          ) : null}
          <p className="muted text-xs">
            Kuwait time, {slots.minutes} minutes. {slots.notice}
          </p>
        </div>
      )}
      <label className="block space-y-1">
        <span className="muted block text-xs">
          A line on the call, for whoever takes it (goes on the lead in
          HighLevel too)
        </span>
        <textarea
          id="dial-note"
          value={note}
          onChange={e => onNote(e.target.value)}
          rows={2}
          dir="auto"
          required
          className="w-full rounded-[var(--radius-md)] border hairline bg-[color:var(--background)] px-3 py-2 text-sm"
        />
      </label>
      <button
        type="submit"
        disabled={
          busy || !start || Boolean(slots?.existing) || note.trim().length < 3
        }
        className={buttonPrimary}
      >
        <CalendarPlus className="size-3.5" aria-hidden />
        {busy
          ? moving
            ? "Moving…"
            : "Booking…"
          : !start
            ? "Pick a time"
            : note.trim().length < 3
              ? "Write a line on the call first"
              : `${moving ? "Move to" : "Book"} ${dayLabel(start)} ${clock(start)}`}
      </button>
      {unsure ? (
        <p
          role="status"
          className="callout-warn rounded-[var(--radius-md)] border px-3 py-2 text-xs leading-relaxed"
        >
          {unsure}
        </p>
      ) : null}
    </form>
  );
}
