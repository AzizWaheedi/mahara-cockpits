import type { CSSProperties, ReactNode } from "react";
import { JOURNEY, type L, LAUNCH, type Lang, t, tf } from "../content";
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
 * and no "Calling" chip: the card shows the order, never a speed.
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
        <li data-row="new">
          <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden>
            <Node x={14} y={14} r={10} state="now" />
          </svg>
          <span className="dkc-queue-text">
            <bdi>{row(Q.fresh, 0)}</bdi>
          </span>
          <span className="dkc-queue-chip">
            {t(dwy ? Q.topDwy : Q.top, lang)}
          </span>
        </li>
        <li>
          <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden>
            <Node x={14} y={14} r={10} state="ahead" />
          </svg>
          <span className="dkc-queue-text">
            <bdi>{row(Q.second, 1)}</bdi>
          </span>
        </li>
        <li>
          <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden>
            <Node x={14} y={14} r={10} state="ahead" />
          </svg>
          <span className="dkc-queue-text">
            <bdi>{row(Q.callback, 2)}</bdi>
          </span>
        </li>
        <li data-row="lost">
          <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden>
            <Node x={14} y={14} r={10} state="ahead" />
          </svg>
          <span className="dkc-queue-text">{t(Q.lost, lang)}</span>
        </li>
      </ol>
      {/* Our call centre's hours: done with you, their team calls. */}
      {dwy ? null : <p className="dkc-queue-night">{t(Q.night, lang)}</p>}
    </div>
  );
}

// ------------------------------------------------- the calendar entry

/** Their calendar's day, one appointment at 4 pm (journey stop 5). */
export function CalendarEntry({
  lang,
  day,
  place,
}: {
  lang: Lang;
  day: string;
  place: string;
}) {
  const C = LAUNCH.journey.calendar;
  return (
    <div className="dkc-cal">
      <b className="dkc-cal-day">{day}</b>
      <div className="dkc-cal-grid">
        {C.hours.map((h, i) => (
          <div key={h.en} className="dkc-cal-hour">
            <span className="dkc-cal-time">{t(h, lang)}</span>
            <i />
            {i === 2 ? (
              <span className="dkc-cal-block">
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
 * Journey stop 4: the steps before the meeting as dots down one line, each
 * named in a word or two beside its dot (the call slide's stop 7 timeline,
 * the home of these steps, in miniature). Done with you, its four steps. A
 * step with no time of its own (the provisional bookings' calls) is named
 * by its whole line. Every name starts at one x, on its dot's centre line.
 */
const DOT_STEP = 58;

/** The strip's height, to set it level with its row before it renders. */
export const fiveDotsHeight = (dwy: boolean) =>
  ((dwy ? LAUNCH.call.after.rowsDwy : LAUNCH.call.after.rows).length - 1) *
    DOT_STEP +
  28;

export function FiveDots({ lang, dwy }: { lang: Lang; dwy: boolean }) {
  const A = LAUNCH.call.after;
  const rows = dwy ? A.rowsDwy : A.rows;
  const n = rows.length;
  const y = (i: number) => 14 + i * DOT_STEP;
  const h = y(n - 1) + 14;
  return (
    <div className="dkc-fivedots" style={{ height: h }}>
      <svg width={28} height={h} viewBox={`0 0 28 ${h}`} aria-hidden>
        <path
          d={`M 14 ${y(0)} L 14 ${y(n - 1)}`}
          stroke="var(--dk-line-strong)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeDasharray="2 8"
        />
        {rows.map((r, i) => (
          <circle
            key={r.what.en}
            cx={14}
            cy={y(i)}
            r={7}
            fill={i === 0 ? "var(--dk-teal)" : "var(--dk-space)"}
            stroke={i === 0 ? "var(--dk-teal)" : "var(--dk-line-strong)"}
            strokeWidth={2}
          />
        ))}
      </svg>
      <ol>
        {rows.map((r, i) => (
          <li
            key={r.what.en}
            style={{ top: y(i) }}
            data-first={i === 0 ? "" : undefined}
          >
            {r.plain && r.when
              ? `${t(r.when, lang)}: ${t(r.what, lang)}`
              : t(r.when ?? r.what, lang)}
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
}: {
  lang: Lang;
  rows: { label: L; value: ReactNode }[];
  notes: string[];
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
        <span className="dk-label">{t(N.notes, lang)}</span>
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
}: {
  lang: Lang;
  width?: number;
}) {
  const [noShow, ...main] = LAUNCH.portal.crm;
  const R = 14;
  const COL = 250;
  const gap = (width - COL) / 3;
  const x = (i: number) => R + i * gap;
  const NAME = 64;
  const y = NAME + R + 6;
  const yb = y + 150;
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
              width: s.i === 3 ? COL : gap - 20,
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
