import { CalendarCheck, CalendarPlus, Copy, ExternalLink } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { api, uncertain } from "../lib/api";
import {
  bookedDemo,
  bookingLine,
  introToMark,
  nextSlots,
  slotWords,
} from "../lib/booking";
import { CLIENT_NOTE, isClient } from "../lib/clients";
import { clock } from "../lib/format";
import { toast } from "../lib/toast";
import type { CalendarRow, Lead, Me } from "../lib/types";
import { type As, BookForm, type Slots } from "./BookForm";
import { button } from "./kit";

const msg = (e: unknown) => String((e as Error)?.message ?? e);

/**
 * Book the demo, at the end of the intro (sales simplify, 2026-10-10): the
 * demo calendar's four soonest free times as large buttons, and one press
 * books the time the lead picked through the same path as the dialer
 * (book.create: HighLevel's own free-time check, the read-back, the closer
 * as owner, the stage move, the audit row, HighLevel's confirmations). The
 * cockpit sends the lead nothing. When the setter's intro is plainly
 * happening it is marked held first, and the block says so before the
 * press. The calendar's booking page is always under it, to send instead.
 */
export function BookDemoBlock({
  me,
  as,
  lead,
  appointments,
  values,
  attemptId,
  since,
  onSlots,
  onBooked,
}: {
  me: Me;
  as: As;
  lead: Lead;
  appointments: CalendarRow[];
  /** What the setter captured: the line for the closer is written from it. */
  values: Record<string, string>;
  /** The dialer's open call with this lead, saved as booked. */
  attemptId: string | null;
  /** When this call's screen opened (ms, kept over a reload): a demo booked since is this call's. */
  since: number;
  /** The first free times, for the script's "__ or __". */
  onSlots: (isos: string[]) => void;
  /** Booked: the server's words, and the time when this block knows it. */
  onBooked: (words: string, start: string | null) => void;
}) {
  const [slots, setSlots] = useState<Slots | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [busyAt, setBusyAt] = useState<string | null>(null);
  const busy = useRef(false);
  const [unsure, setUnsure] = useState<string | null>(null);
  const tried = useRef<string | null>(null);
  const [booked, setBooked] = useState<{
    words: string;
    start: string | null;
    /** False: HighLevel took it, but reading it back did not match. */
    verified?: boolean;
  } | null>(null);
  const [more, setMore] = useState(false);
  // Never empty, so the time they pick books in one press; it can be edited.
  const suggested = bookingLine(values, me.name);
  const [note, setNote] = useState<string | null>(null);
  const line = note ?? suggested;
  const marked = useRef(new Set<string>());
  const [copied, setCopied] = useState(false);
  const slotsRef = useRef(onSlots);
  slotsRef.current = onSlots;
  const bookedRef = useRef(onBooked);
  bookedRef.current = onBooked;

  // biome-ignore lint/correctness/useExhaustiveDependencies: tick reads the calendar again
  useEffect(() => {
    let alive = true;
    setError(null);
    api<Slots>("book.slots", {
      contact_id: lead.contact_id,
      kind: "demo",
      with: "anyone",
    })
      .then(s => {
        if (!alive) return;
        const asked = tried.current;
        tried.current = null;
        if (asked) {
          if (
            s.existing &&
            Date.parse(s.existing.start) === Date.parse(asked)
          ) {
            const words = `Demo booked for ${s.existing.words} (Kuwait time)`;
            setBooked({ words, start: s.existing.start });
            setUnsure(null);
            bookedRef.current(words, s.existing.start);
          } else
            setUnsure(
              "The calendar does not show it yet. Press the time again: a booking already on its way is refused, never made twice.",
            );
        }
        setSlots(s);
        slotsRef.current(nextSlots(s.days, 2));
      })
      .catch(e => alive && setError(msg(e)));
    return () => {
      alive = false;
    };
  }, [lead.contact_id, tick]);

  if (isClient(lead))
    return (
      <BlockFrame>
        <p className="muted text-sm">{CLIENT_NOTE}</p>
      </BlockFrame>
    );

  const demo = bookedDemo(appointments);
  const intro = introToMark(appointments, me);
  const times = nextSlots(slots?.days, 4);

  async function book(start: string) {
    if (busy.current) return;
    if (line.trim().length < 3) {
      toast.error(
        "Write a line for the closer first, so they know what was said.",
      );
      return;
    }
    busy.current = true;
    setBusyAt(start);
    setUnsure(null);
    try {
      if (intro && !marked.current.has(intro.appointment_id)) {
        try {
          await api("mark", {
            appointment_id: intro.appointment_id,
            status: "showed",
          });
          marked.current.add(intro.appointment_id);
        } catch (e) {
          // The booking matters more: it goes ahead, and the mark is said.
          if (!uncertain(e))
            toast.error(
              `Today's intro was not marked held: ${msg(e)} Mark it on the lead page.`,
            );
          else marked.current.add(intro.appointment_id);
        }
      }
      const out = await api<{ verified: boolean; words: string }>(
        "book.create",
        {
          contact_id: lead.contact_id,
          kind: "demo",
          with: slots?.with ?? "anyone",
          start,
          note: line.trim(),
          as,
          attempt_id: attemptId,
        },
      );
      if (!out.verified)
        toast.error(
          "HighLevel took the booking, but reading it back did not match. Open the lead in HighLevel and check the time.",
        );
      setBooked({ words: out.words, start, verified: out.verified });
      onBooked(out.words, start);
    } catch (err) {
      if (uncertain(err)) {
        tried.current = start;
        setUnsure(
          "No answer came back about the booking, so it may have gone through. Checking the calendar…",
        );
        setTick(n => n + 1);
      } else {
        toast.error(msg(err));
        if (/taken|already have/i.test(msg(err))) setTick(n => n + 1);
      }
    } finally {
      busy.current = false;
      setBusyAt(null);
    }
  }

  const doneStart = booked?.start ?? demo?.start_at ?? null;
  // Booked on this call: here, or (after a reload) by HighLevel's booking
  // time. Only a demo booked before the call says so; an unknown time says
  // neither.
  const bookedMs = demo?.booked_at ? Date.parse(demo.booked_at) : Number.NaN;
  const onThisCall =
    Boolean(booked) ||
    (Number.isFinite(bookedMs) && bookedMs >= since - 120_000);
  const before = !onThisCall && Number.isFinite(bookedMs);
  const closer = demo?.assigned_user_name?.split(/\s+/)[0] ?? null;
  // HighLevel took it, but reading it back did not match: said on the
  // block, not only in a toast that goes away.
  const unread = booked?.verified === false;

  return (
    <BlockFrame>
      {booked || doneStart ? (
        <div className="flex items-start gap-3">
          <CalendarCheck
            className="mt-0.5 size-5 shrink-0"
            style={{ color: unread ? "var(--warning)" : "var(--success)" }}
            aria-hidden
          />
          <div className="min-w-0 space-y-1">
            <p className="text-[15px] font-semibold">
              {doneStart ? (
                <>
                  {unread
                    ? "Sent to HighLevel for "
                    : onThisCall
                      ? "Demo booked for "
                      : "Their demo is on "}
                  <span className="font-mono">
                    {slotWords(doneStart, lead.country, lead.phone).kuwait}
                  </span>{" "}
                  (Kuwait time){closer ? `, with ${closer}` : ""}.
                </>
              ) : (
                `${booked?.words ?? ""}.`
              )}
            </p>
            {unread ? (
              <p
                role="status"
                className="callout-warn rounded-[var(--radius-md)] border px-3 py-2 text-sm"
              >
                HighLevel took the booking, but reading it back did not match.
                Open the lead in HighLevel and check the time before the
                tie-downs.
              </p>
            ) : (
              <p className="muted text-sm">
                {onThisCall
                  ? "HighLevel sends them the confirmation. Do the tie-downs and the show-rate lock now."
                  : before
                    ? "Booked before this call. Move it in HighLevel if they want another time."
                    : "Move it in HighLevel if they want another time."}
              </p>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="flex items-center gap-2 text-[15px] font-semibold">
              <CalendarPlus
                className="size-4"
                style={{ color: "var(--primary)" }}
                aria-hidden
              />
              Book the demo
            </p>
            {slots && !slots.existing && times.length ? (
              <button
                type="button"
                onClick={() => setMore(m => !m)}
                aria-expanded={more}
                className="muted text-xs underline-offset-2 hover:underline"
              >
                {more ? "Hide the other times" : "More times"}
              </button>
            ) : null}
          </div>

          {error ? (
            <p className="callout-bad rounded-[var(--radius-md)] border px-3 py-2 text-sm">
              The calendar could not be read: {error}{" "}
              <button
                type="button"
                onClick={() => setTick(n => n + 1)}
                className="underline underline-offset-2"
              >
                Read it again
              </button>
            </p>
          ) : !slots ? (
            <p className="muted text-sm">
              Reading the demo calendar's free times…
            </p>
          ) : slots.existing ? (
            <p className="callout-warn rounded-[var(--radius-md)] border px-3 py-2 text-sm">
              They already have a demo on {slots.existing.words} (Kuwait time).
              Move that one in HighLevel instead of booking a second.
            </p>
          ) : !times.length ? (
            <p className="callout-warn rounded-[var(--radius-md)] border px-3 py-2 text-sm">
              No free demo times in the next few days. Send them the booking
              page below, or book in HighLevel.
            </p>
          ) : (
            <>
              <p className="muted text-xs">
                Kuwait time, {slots.minutes} minutes, with the closer who is
                free. One press books the time they pick.
                {intro
                  ? ` Booking also marks today's intro (${clock(intro.start_at)}) as held.`
                  : ""}
              </p>
              <div
                className="grid grid-cols-2 gap-2 sm:grid-cols-4"
                role="group"
                aria-label="The soonest free times"
              >
                {times.map(t => {
                  const w = slotWords(t, lead.country, lead.phone);
                  const pressing = busyAt === t;
                  return (
                    <button
                      key={t}
                      type="button"
                      disabled={busyAt !== null || line.trim().length < 3}
                      onClick={() => void book(t)}
                      aria-label={`Book ${w.kuwait}${intro ? " and mark today's intro as held" : ""}`}
                      className={`flex min-h-[4.25rem] flex-col items-start justify-center rounded-[14px] border px-3 py-2 text-left transition-colors disabled:opacity-50 ${
                        pressing
                          ? "border-[color:var(--primary)] bg-[color:color-mix(in_oklch,var(--primary)_16%,transparent)]"
                          : "border-white/10 bg-white/[0.03] hover:border-[color:color-mix(in_oklch,var(--primary)_60%,transparent)] hover:bg-[color:color-mix(in_oklch,var(--primary)_8%,transparent)]"
                      }`}
                    >
                      <span className="muted text-[11px] font-medium">
                        {pressing ? "Booking…" : w.day}
                      </span>
                      <span className="font-mono text-[17px] font-semibold tabular-nums">
                        {w.time}
                      </span>
                      {w.theirs ? (
                        <span className="muted text-[11px]">{w.theirs}</span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          <label className="block space-y-1">
            <span className="muted block text-xs">
              A line for the closer (goes on the lead in HighLevel with the
              booking)
            </span>
            <textarea
              value={line}
              onChange={e => setNote(e.target.value)}
              rows={2}
              dir="auto"
              className="w-full rounded-[14px] border border-white/10 bg-[color:var(--background)] px-3 py-2 text-sm focus:border-[color:var(--ring)] focus:outline-none focus:ring-1 focus:ring-[color:var(--ring)]"
            />
            {line.trim().length < 3 ? (
              <span
                className="block text-xs"
                style={{ color: "var(--warning)" }}
              >
                Write a line for the closer first: what they need to know before
                the demo.
              </span>
            ) : null}
          </label>

          {unsure ? (
            <p
              role="status"
              className="callout-warn rounded-[var(--radius-md)] border px-3 py-2 text-xs leading-relaxed"
            >
              {unsure}
            </p>
          ) : null}

          {more && slots ? (
            <BookForm
              me={me}
              as={as}
              contactId={lead.contact_id}
              attemptId={attemptId}
              kindFirst="demo"
              note={line}
              onNote={setNote}
              onClose={() => setMore(false)}
              closeLabel="Back to the soonest times"
              onBooked={words => {
                setMore(false);
                setBooked({ words, start: null });
                onBooked(words, null);
                setTick(n => n + 1);
              }}
            />
          ) : null}
        </>
      )}

      <BookingLink
        url={slots?.booking_url ?? null}
        // Only an answer that carries the field says the page is off: a
        // sales-api from before 2026-10-10 sends none, and is not asked.
        known={Boolean(slots && "booking_url" in slots)}
        copied={copied}
        onCopy={async () => {
          if (!slots?.booking_url) return;
          try {
            await navigator.clipboard.writeText(slots.booking_url);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
          } catch {
            toast.error(
              "The link could not be copied. Open it and copy it from the address bar.",
            );
          }
        }}
      />
    </BlockFrame>
  );
}

function BlockFrame({ children }: { children: ReactNode }) {
  return (
    <section
      id="book-demo"
      aria-label="Book the demo"
      className="scroll-mt-52 space-y-3 rounded-[18px] border border-[color:color-mix(in_oklch,var(--primary)_35%,transparent)] bg-[color:var(--card)] p-4 lg:scroll-mt-40"
    >
      {children}
    </section>
  );
}

function BookingLink({
  url,
  known,
  copied,
  onCopy,
}: {
  url: string | null;
  known: boolean;
  copied: boolean;
  onCopy: () => void;
}) {
  if (!known) return null;
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-white/5 pt-3 text-sm">
      {url ? (
        <>
          <span className="muted me-auto text-xs">
            Or send them the booking page
          </span>
          <button type="button" onClick={onCopy} className={button}>
            <Copy className="size-3.5" aria-hidden />
            {copied ? "Copied" : "Copy the link"}
          </button>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className={button}
          >
            <ExternalLink className="size-3.5" aria-hidden /> Open
          </a>
        </>
      ) : (
        <span className="muted text-xs">
          The booking page is switched off in HighLevel.
        </span>
      )}
    </div>
  );
}
