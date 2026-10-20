import type { CSSProperties, ReactNode } from "react";
import {
  digits,
  JOURNEY,
  type L,
  LAUNCH,
  type Lang,
  stepNumeral,
  t,
  tf,
} from "../content";
import { Node } from "../JourneyLanes";
import { Avatar, type Identity } from "./Identity";

/**
 * The drawn pieces of the launch deck (DESIGN 6.5, 7.6, 7.9): our own UI in
 * deck tokens, each tagged on the slide as what it is (Example, Example
 * wording, Illustration). No names, no phone numbers, no money: the cards
 * show a mechanism, never a real customer.
 */

/** A provenance tag above a picture's end corner (DESIGN 5.4). */
export function Tagged({
  tag,
  children,
  className,
  style,
}: {
  tag: string | null;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <figure className={`dkc-tagged ${className ?? ""}`} style={style}>
      {tag ? <figcaption className="dk-tag">{tag}</figcaption> : null}
      {children}
    </figure>
  );
}

// ------------------------------------------------------- the call queue

/**
 * Our dialer's list, simplified (journey stop 3): four rows, no names, no
 * phone numbers, the client's own services. The new enquiry carries no time
 * and no "Calling" chip: the card shows the order, never a speed. The
 * stop's words already say the hours, the top of the list and the night
 * rule, so the card does not say them again: its order shows the first,
 * and done with you its one chip says who calls. No marks on the rows (a
 * ring per row read as a form's radio buttons): each row carries its place
 * in the queue, the new enquiry first, on the journey's row band.
 */
export function QueueCard({
  lang,
  services,
  dwy,
  still,
}: {
  lang: Lang;
  services: string[];
  dwy: boolean;
  still?: boolean;
}) {
  const Q = LAUNCH.journey.queue;
  // A service in the other script keeps its place in the row (an isolate).
  // With no service known, the rows leave it out (no made-up placeholder).
  const s = (i: number) => {
    const name = services[i] ?? services[0];
    return name ? `\u2068${name}\u2069` : "";
  };
  const row = (l: L, i: number) =>
    s(i)
      ? tf(l, lang, { service: s(i) })
      : t(
          {
            en: l.en.replace(" · {service}", ""),
            ar: l.ar.replace(" · {service}", ""),
          },
          lang,
        );
  return (
    <div className="dkc-queue" data-still={still ? "" : undefined}>
      <ol>
        {/* The row the journey's leader points at. */}
        <li data-row="new" data-anchor="">
          <span className="dkc-queue-n">{stepNumeral(0, lang)}</span>
          <span className="dkc-queue-text">
            <bdi>{row(Q.fresh, 0)}</bdi>
          </span>
          {dwy ? (
            // Their team's step: the "You" lane's ink, never our teal.
            <span className="dkc-queue-chip" data-lane="you">
              {t(Q.topDwy, lang)}
            </span>
          ) : null}
        </li>
        <li>
          <span className="dkc-queue-n">{stepNumeral(1, lang)}</span>
          <span className="dkc-queue-text">
            <bdi>{row(Q.second, 1)}</bdi>
          </span>
        </li>
        <li>
          <span className="dkc-queue-n">{stepNumeral(2, lang)}</span>
          <span className="dkc-queue-text">
            <bdi>{row(Q.callback, 2)}</bdi>
          </span>
        </li>
        <li data-row="lost">
          <span className="dkc-queue-n">{stepNumeral(3, lang)}</span>
          <span className="dkc-queue-text">{t(Q.lost, lang)}</span>
        </li>
      </ol>
    </div>
  );
}

// ------------------------------------------------- the calendar entry

/**
 * Their calendar's day (journey stop 5), from the booked hour on: the
 * appointment at the hour the example call books (4 pm, or earlier for a
 * client who closes earlier), then the three hours after it. The block is
 * the card's first row, so it sits level with "Lands with you" and the
 * lanes' leader ends on it, straight.
 */
export function CalendarEntry({
  lang,
  day,
  place,
  hour,
}: {
  lang: Lang;
  day: string;
  place: string;
  /** The booked hour, 24-hour (13 to 16). */
  hour: number;
}) {
  const C = LAUNCH.journey.calendar;
  const hours = [hour, hour + 1, hour + 2, hour + 3];
  return (
    <div className="dkc-cal">
      <b className="dkc-cal-day">{day}</b>
      <div className="dkc-cal-grid">
        {hours.map((h, i) => (
          <div key={h} className="dkc-cal-hour">
            <span className="dkc-cal-time">
              {tf(C.hour, lang, { h: digits(h % 12 || 12, lang) })}
            </span>
            <i />
            {i === 0 ? (
              <span className="dkc-cal-block" data-anchor="">
                <bdi>{tf(C.block, lang, { place })}</bdi>
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Journey stop 4: the steps before the meeting, drawn at the lanes' own
 * scale and in their marks (nodes on the dotted line), running down from
 * the lit row to the meeting: the strip starts level with "Booked,
 * confirmed, reminded" and its last node, "The meeting", sits level with
 * "You meet". Each step says when it happens and what happens then
 * ("The day before · a reminder"), in the call slide's words, so the
 * stop's sentence above it reads straight into the strip. Done with you,
 * its four steps.
 */
export function FiveDots({
  lang,
  dwy,
  height,
}: {
  lang: Lang;
  dwy: boolean;
  /** From the first node's centre to the last's. */
  height: number;
}) {
  const A = LAUNCH.call.after;
  const rows = dwy ? A.rowsDwy : A.rows;
  const n = rows.length;
  // A node a step under the lanes' 14, so five fit between two rows with
  // the dotted line still showing between them.
  const R = 12;
  const y = (i: number) => R + (i * height) / (n - 1);
  const h = height + R * 2;
  return (
    <div className="dkc-fivedots" style={{ height: h }}>
      <svg width={R * 2} height={h} viewBox={`0 0 ${R * 2} ${h}`} aria-hidden>
        <path
          d={`M ${R} ${y(0)} L ${R} ${y(n - 1)}`}
          stroke="var(--dk-line-strong)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeDasharray="2 8"
        />
        {rows.map((r, i) => (
          <Node
            key={r.what.en}
            x={R}
            y={y(i)}
            r={R}
            state={i === 0 ? "now" : "ahead"}
          />
        ))}
      </svg>
      <ol>
        {rows.map((r, i) => (
          <li
            key={r.what.en}
            style={{ top: y(i) }}
            data-first={i === 0 ? "" : undefined}
            data-anchor={i === 0 ? "" : undefined}
          >
            {r.when ? (
              <>
                <span className="dkc-dot-when">{t(r.when, lang)}</span>
                {r.plain ? (lang === "ar" ? "، " : ": ") : " · "}
                {t(r.what, lang)}
              </>
            ) : (
              t(r.what, lang)
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

// ---------------------------------------- after the call (L6 stop 7, 8)

/**
 * "What we do before the meeting": the five steps joined by the journey's
 * line, lit top to bottom (400 ms a step), each a dot and one line of words
 * in the deck's one face: its time first in ink-2, then the step. Said as
 * what we do, never "every"; no reply buttons, no channel icons.
 */
export function Reminders({
  lang,
  dwy,
  lit,
  still,
}: {
  lang: Lang;
  dwy: boolean;
  /** Light the rows (on arrival at stop 7). */
  lit: boolean;
  still?: boolean;
}) {
  const A = LAUNCH.call.after;
  const rows = dwy ? A.rowsDwy : A.rows;
  return (
    <div
      className="dkc-reminders"
      data-lit={lit ? "" : undefined}
      data-still={still ? "" : undefined}
    >
      <h4>{t(dwy ? A.headingDwy : A.heading, lang)}</h4>
      <ol>
        {rows.map((r, i) => (
          <li
            key={r.what.en}
            style={{ "--i": i } as CSSProperties}
            data-last={i === rows.length - 1 ? "" : undefined}
          >
            <span className="dkc-rem-mark" aria-hidden>
              <i />
            </span>
            <span className="dkc-rem-text">
              {r.when ? (
                <>
                  <span className="dkc-rem-when">{t(r.when, lang)}</span>
                  {r.plain ? (lang === "ar" ? "، " : ": ") : " · "}
                </>
              ) : null}
              <span>{t(r.what, lang)}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * The WhatsApp confirmation the customer receives (DESIGN 7.6): WhatsApp's
 * dark colours, because it is what they receive; their own name and
 * avatar; one incoming message in the live template's structure. No ticks,
 * no "online", no input bar. The date and time keep the template's Latin
 * digits in both decks.
 */
export function Confirmation({
  who,
  name,
  lines,
}: {
  who: Identity;
  name: string;
  lines: { text: string; link?: boolean }[];
}) {
  return (
    <div className="dkc-app dkc-wa-card" data-app="wa">
      <div className="dkc-wa-card-head">
        <Avatar who={who} size="48px" />
        <b dir="auto">{name}</b>
      </div>
      <div className="dkc-wa-bubble">
        {lines.map(l => (
          <p key={l.text} dir="auto" data-link={l.link ? "" : undefined}>
            {l.text}
          </p>
        ))}
        <span className="dkc-wa-time">10:29</span>
      </div>
    </div>
  );
}

/** What lands with the client (L6 stop 8): the caller's notes come with it. */
export function AppointmentCard({
  lang,
  rows,
  notes,
  dwy = false,
}: {
  lang: Lang;
  rows: { label: L; value: ReactNode }[];
  notes: string[];
  /** Done with you: the notes are their own caller's. */
  dwy?: boolean;
}) {
  const N = LAUNCH.call.lands;
  return (
    <div className="dkc-appt">
      <h4 className="dk-h3">{t(N.heading, lang)}</h4>
      <dl>
        {rows.map(r => (
          <div key={r.label.en}>
            <dt>{t(r.label, lang)}</dt>
            <dd>{r.value}</dd>
          </div>
        ))}
      </dl>
      <div className="dkc-appt-notes">
        <span className="dk-label">{t(dwy ? N.notesDwy : N.notes, lang)}</span>
        <ul>
          {notes.map(n => (
            <li key={n} dir="auto">
              {n}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ------------------------------------------- creative freedom's proof

/** The 11 on and 9 off of one campaign's 20 versions, as neutral tiles. */
const ON = new Set([0, 2, 3, 5, 8, 9, 11, 12, 14, 17, 18]);

export function TestTiles({ still }: { still?: boolean }) {
  return (
    <div className="dkc-tiles" data-still={still ? "" : undefined}>
      {Array.from({ length: 20 }, (_, i) => (
        <span
          key={`tile-${String(i)}`}
          className="dkc-tile"
          data-on={ON.has(i) ? "" : undefined}
          style={{ "--i": i } as CSSProperties}
        >
          <i className="dkc-toggle" aria-hidden>
            <i />
          </i>
        </span>
      ))}
    </div>
  );
}

// ------------------------------------------- the CRM stages (DWY)

/**
 * Their CRM's stages after a meeting, in the journey's line language: the
 * meeting has happened (passed, a check), the next stage to move it to is
 * lit (Showed), the ones after it wait, and a no-show is a side branch that
 * ends there (it never becomes Showed). The names sit above the main line,
 * so the branch leaves the meeting's node downwards without crossing one.
 * No arrows and no stacked bars: a meeting takes one path or the other.
 */
export function CrmStages({
  lang,
  width = 940,
  drop = 150,
  anchor = false,
}: {
  lang: Lang;
  width?: number;
  /** How far below the stages the no-show branch ends. */
  drop?: number;
  /** Mark the stages' line for a leader to run straight into. */
  anchor?: boolean;
}) {
  const [noShow, ...main] = LAUNCH.portal.crm;
  const R = 14;
  // The last stage's own room ("Closed" is short), so the other names get
  // the width: every stage's name has its column to itself, on one line,
  // with a clear gap before the next ("Quote sent" and "Closed" read as two).
  const COL = 130;
  const gap = (width - COL) / 3;
  const x = (i: number) => R + i * gap;
  const NAME = 64;
  const y = NAME + R + 6;
  const yb = y + drop;
  const H = yb + R + 6;
  const steps: { label: L; i: number; state: "past" | "now" | "ahead" }[] = [
    { label: JOURNEY.rows[5].name, i: 0, state: "past" },
    ...main.map((label, k) => ({
      label,
      i: k + 1,
      state: k === 0 ? ("now" as const) : ("ahead" as const),
    })),
  ];
  const dotted = {
    fill: "none",
    stroke: "var(--dk-line-strong)",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeDasharray: "2 8",
  };
  return (
    <div className="dkc-crm" style={{ width, height: H }}>
      <svg viewBox={`0 0 ${width} ${H}`} width={width} height={H} aria-hidden>
        <path
          d={`M ${x(0)} ${y} L ${x(1)} ${y}`}
          fill="none"
          stroke="var(--dk-teal)"
          strokeWidth={3}
          strokeLinecap="round"
        />
        <path d={`M ${x(1)} ${y} L ${x(3)} ${y}`} {...dotted} />
        <path
          d={`M ${x(0)} ${y + R} C ${x(0)} ${yb - 30} ${x(1) - gap * 0.6} ${yb} ${x(1) - R} ${yb}`}
          {...dotted}
        />
        {steps.map(s => (
          <Node key={s.label.en} x={x(s.i)} y={y} r={R} state={s.state} />
        ))}
        <Node x={x(1)} y={yb} r={R} state="ahead" />
      </svg>
      {anchor ? (
        <i
          data-anchor=""
          aria-hidden
          style={{ position: "absolute", top: y - 1, height: 2, width: 2 }}
        />
      ) : null}
      <ol>
        {steps.map(s => (
          <li
            key={s.label.en}
            data-state={s.state}
            style={{
              insetInlineStart: x(s.i) - R,
              bottom: H - y + R + 18,
              // A stage's name keeps clear of the next node's column; the
              // last one has the end column to itself.
              width: s.i === 3 ? COL : gap - 8,
            }}
          >
            {t(s.label, lang)}
          </li>
        ))}
        <li
          data-branch=""
          style={{
            insetInlineStart: x(1) + R + 18,
            top: yb,
            transform: "translateY(-50%)",
          }}
        >
          {t(noShow, lang)}
        </li>
      </ol>
    </div>
  );
}

// --------------------------------------------- cropped screenshots

export interface CropBox {
  /** Fractions of the picture's width and height: x0, y0, x1, y1. */
  box: [number, number, number, number];
  /** The picture's own width over height. */
  ratio: number;
}

/**
 * A screenshot shown as a plain figure, cropped to the part that matters
 * (DESIGN 8.7): a 1 px edge and a 16 px radius, no browser bar. Crops keep
 * the portal's "lead" headings and the demo project values out of frame
 * where the screen stays readable (CONTENT copy rule 3).
 */
export function Crop({
  src,
  crop,
  width,
  alt = "",
  radius = 16,
}: {
  src: string;
  crop: CropBox;
  width: number;
  alt?: string;
  radius?: number;
}) {
  const [x0, y0, x1, y1] = crop.box;
  const imgW = width / (x1 - x0);
  const imgH = imgW / crop.ratio;
  const height = (y1 - y0) * imgH;
  return (
    <div
      className="dkc-crop"
      style={{ width, height, borderRadius: radius }}
      {...(alt ? { role: "img", "aria-label": alt } : {})}
    >
      <img
        src={src}
        alt=""
        draggable={false}
        style={{
          width: imgW,
          height: imgH,
          left: -x0 * imgW,
          top: -y0 * imgH,
        }}
      />
    </div>
  );
}

/** The crop's height for a width (to lay a stage out before it renders). */
export const cropHeight = (crop: CropBox, width: number) =>
  ((crop.box[3] - crop.box[1]) * width) /
  (crop.box[2] - crop.box[0]) /
  crop.ratio;
