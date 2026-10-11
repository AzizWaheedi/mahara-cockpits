import { CalendarCheck, CalendarClock, Copy, ExternalLink } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { api, uncertain } from "../lib/api";
import { bookedDemo, bookingLine, introToMark } from "../lib/booking";
import { CLIENT_NOTE, isClient } from "../lib/clients";
import {
  type As,
  firstOf,
  isWhen,
  type Slots,
  time12,
  whenWords,
} from "../lib/reschedule";
import { toast } from "../lib/toast";
import type { CalendarRow, Lead, Me } from "../lib/types";
import { CallPicker, type PickerDone, pickedWords } from "./CallPicker";
import { button } from "./kit";

const msg = (e: unknown) => String((e as Error)?.message ?? e);

/**
 * Book the demo, at the end of the intro (sales simplify, 2026-10-10; the
 * one picker since 2026-10-11): the demo calendar's four soonest free times
 * as the picker's tiles, and one press books the time the lead picked after
 * the four-second hold with Undo, through the same path as everywhere
 * (book.create: HighLevel's own free-time check, the read-back, the closer
 * as owner, the stage move, the audit row, HighLevel's confirmations). When
 * the setter's intro is plainly happening it is marked held first, and the
 * block says so before the press. Once a demo is booked the block shows it
 * with Reschedule, never "move it in HighLevel". The calendar's booking
 * page is always under it, to send instead.
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
  // Booked from this block: its picker stays on its done state, with Tell
  // them, while the lead's calls are read again behind it.
  const [bookedHere, setBookedHere] = useState(false);
  const [moving, setMoving] = useState(false);
  const [slots, setSlots] = useState<Slots | null>(null);
  const [copied, setCopied] = useState(false);
  const marked = useRef(new Set<string>());

  if (isClient(lead))
    return (
      <BlockFrame>
        <p className="muted text-sm">{CLIENT_NOTE}</p>
      </BlockFrame>
    );

  const demo = bookedDemo(appointments);
  const intro = introToMark(appointments, me);
  const suggested = bookingLine(values, me.name);

  /** Today's intro is marked held first; the booking matters more, so a refusal only says so. */
  async function markIntro() {
    if (!intro || marked.current.has(intro.appointment_id)) return;
    try {
      await api("mark", {
        appointment_id: intro.appointment_id,
        status: "showed",
      });
      marked.current.add(intro.appointment_id);
    } catch (e) {
      if (!uncertain(e))
        toast.error(
          `Today's intro was not marked held: ${msg(e)} Mark it on the lead page.`,
        );
      else marked.current.add(intro.appointment_id);
    }
  }

  const done = (d: PickerDone) => {
    if (d.mode === "book") setBookedHere(true);
    onBooked(pickedWords(d), d.start);
  };

  const booking = (
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
  );

  if (demo && !bookedHere && !moving) {
    // Booked before this screen, or by HighLevel since: what it is, and
    // Reschedule right here.
    const bookedMs = demo.booked_at ? Date.parse(demo.booked_at) : Number.NaN;
    const onThisCall = Number.isFinite(bookedMs) && bookedMs >= since - 120_000;
    const closer = firstOf(demo.assigned_user_name);
    return (
      <BlockFrame>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <CalendarCheck
              className="mt-0.5 size-5 shrink-0"
              style={{ color: "var(--success)" }}
              aria-hidden
            />
            <div className="min-w-0 space-y-1">
              <p className="text-[15px] font-semibold">
                {demo.start_at
                  ? onThisCall
                    ? `Demo booked for ${whenWords(demo.start_at)}`
                    : `Their demo is ${isWhen(demo.start_at)}`
                  : "Their demo's time is not known"}{" "}
                (Kuwait time){closer ? `, with ${closer}` : ""}.
              </p>
              <p className="muted text-sm">
                {onThisCall
                  ? "HighLevel sends them the confirmation. Do the tie-downs and the show-rate lock now."
                  : "Booked before this call. Reschedule it here if they want another time."}
              </p>
            </div>
          </div>
          <button
            type="button"
            className={`${button} pointer-coarse:min-h-11 shrink-0`}
            onClick={() => setMoving(true)}
          >
            <CalendarClock className="size-3.5" aria-hidden />
            Reschedule
          </button>
        </div>
      </BlockFrame>
    );
  }

  if (moving && demo)
    return (
      <BlockFrame>
        <CallPicker
          key={`move:${demo.appointment_id}`}
          me={me}
          as={as}
          lead={lead}
          mode="reschedule"
          kind="demo"
          appointmentId={demo.appointment_id}
          current={{ start: demo.start_at, host: demo.assigned_user_name }}
          source="script"
          attemptId={attemptId}
          frame={false}
          onClose={() => setMoving(false)}
          onDone={done}
        />
      </BlockFrame>
    );

  return (
    <BlockFrame>
      {intro && !bookedHere ? (
        <p className="muted text-xs">
          Booking also marks today's intro (
          {intro.start_at ? time12(intro.start_at) : "its time"}) as held.
        </p>
      ) : null}
      <CallPicker
        key="book"
        me={me}
        as={as}
        lead={lead}
        mode="book"
        kind="demo"
        title="Book the demo"
        withDefault="anyone"
        source="script"
        attemptId={attemptId}
        line={suggested}
        lineLabel="A line for the closer (goes on the lead in HighLevel with the booking)"
        beforeBook={intro ? markIntro : undefined}
        onSlots={onSlots}
        onRead={setSlots}
        frame={false}
        onDone={done}
        footer={bookedHere ? null : booking}
      />
      {bookedHere ? (
        <p className="muted text-xs">
          Do the tie-downs and the show-rate lock now.
        </p>
      ) : null}
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

/**
 * Book a follow-up call, at the end of the demo script (2026-10-11): the
 * closer books the next talk with the lead on the line, on the Follow up
 * call calendar, with themself as the host by default. A follow-up call
 * already ahead shows with Reschedule instead.
 */
export function FollowUpBlock({
  me,
  as,
  lead,
  appointments,
  attemptId,
  onBooked,
}: {
  me: Me;
  as: As;
  lead: Lead;
  appointments: CalendarRow[];
  attemptId: string | null;
  onBooked?: (words: string, start: string | null) => void;
}) {
  const [bookedHere, setBookedHere] = useState(false);
  const [moving, setMoving] = useState(false);
  if (isClient(lead)) return null;
  const now = Date.now();
  const next = appointments
    .filter(
      a =>
        // A callback request is moved in HighLevel (sales-api reschedules
        // intro, demo and follow-up calls only), so it is not this block's.
        a.call_type === "follow_up" &&
        a.start_at &&
        Date.parse(a.start_at) > now - 20 * 60_000 &&
        !["cancelled", "noshow", "showed", "invalid"].includes(
          String(a.marked_status ?? a.status ?? ""),
        ),
    )
    .sort(
      (a, b) => Date.parse(String(a.start_at)) - Date.parse(String(b.start_at)),
    )[0];
  const done = (d: PickerDone) => {
    if (d.mode === "book") setBookedHere(true);
    onBooked?.(pickedWords(d), d.start);
  };
  const frame = (children: ReactNode) => (
    <section
      id="book-follow-up"
      aria-label="Book a follow-up call"
      className="scroll-mt-52 space-y-3 rounded-[18px] border border-[color:color-mix(in_oklch,var(--primary)_35%,transparent)] bg-[color:var(--card)] p-4 lg:scroll-mt-40"
    >
      {children}
    </section>
  );
  if (next && !bookedHere && !moving)
    return frame(
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <CalendarCheck
            className="mt-0.5 size-5 shrink-0"
            style={{ color: "var(--success)" }}
            aria-hidden
          />
          <p className="min-w-0 text-[15px] font-semibold">
            {next.start_at
              ? `Their follow-up call is ${isWhen(next.start_at)}`
              : "Their follow-up call's time is not known"}{" "}
            (Kuwait time)
            {firstOf(next.assigned_user_name)
              ? `, with ${firstOf(next.assigned_user_name)}`
              : ""}
            .
          </p>
        </div>
        <button
          type="button"
          className={`${button} pointer-coarse:min-h-11 shrink-0`}
          onClick={() => setMoving(true)}
        >
          <CalendarClock className="size-3.5" aria-hidden />
          Reschedule
        </button>
      </div>,
    );
  if (moving && next)
    return frame(
      <CallPicker
        key={`move:${next.appointment_id}`}
        me={me}
        as={as}
        lead={lead}
        mode="reschedule"
        kind="follow_up"
        appointmentId={next.appointment_id}
        current={{ start: next.start_at, host: next.assigned_user_name }}
        source="script"
        attemptId={attemptId}
        frame={false}
        onClose={() => setMoving(false)}
        onDone={done}
      />,
    );
  return frame(
    <CallPicker
      key="book"
      me={me}
      as={as}
      lead={lead}
      mode="book"
      kind="follow_up"
      title="Book a follow-up call"
      withDefault="me"
      source="script"
      attemptId={attemptId}
      line={`Follow-up after the demo, booked on the call by ${firstOf(me.name) || "the closer"}.`}
      frame={false}
      onDone={done}
    />,
  );
}
