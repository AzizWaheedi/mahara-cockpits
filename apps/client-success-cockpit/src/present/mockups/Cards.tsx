import {
  ArrowDown,
  Bell,
  CalendarCheck,
  MessageSquareText,
  Phone as PhoneIcon,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { type L, LAUNCH, type Lang, t, tf } from "../content";
import { Node } from "../JourneyLanes";
import { Logo } from "../platforms";
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
  const any = t(Q.anyService, lang);
  // A service in the other script keeps its place in the row (an isolate).
  const s = (i: number) => `\u2068${services[i] ?? services[0] ?? any}\u2069`;
  return (
    <div className="dkc-queue" data-still={still ? "" : undefined}>
      <ol>
        <li data-row="new">
          <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden>
            <Node x={14} y={14} r={10} state="now" />
          </svg>
          <span className="dkc-queue-text">
            <bdi>{tf(Q.fresh, lang, { service: s(0) })}</bdi>
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
            <bdi>{tf(Q.second, lang, { service: s(1) })}</bdi>
          </span>
        </li>
        <li>
          <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden>
            <Node x={14} y={14} r={10} state="ahead" />
          </svg>
          <span className="dkc-queue-text">
            <bdi>{tf(Q.callback, lang, { service: s(2) })}</bdi>
          </span>
        </li>
        <li data-row="lost">
          <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden>
            <Node x={14} y={14} r={10} state="ahead" />
          </svg>
          <span className="dkc-queue-text">{t(Q.lost, lang)}</span>
        </li>
      </ol>
      <p className="dkc-queue-night">{t(Q.night, lang)}</p>
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

/** Journey stop 4: the reminders as five dots on a line, no words (DESIGN 6.5). */
export function FiveDots() {
  const x = (i: number) => 8 + i * 72;
  return (
    <svg
      className="dkc-fivedots"
      width={x(4) + 8}
      height={16}
      viewBox={`0 0 ${x(4) + 8} 16`}
      aria-hidden
    >
      <path
        d={`M ${x(0)} 8 L ${x(4)} 8`}
        stroke="var(--dk-line-strong)"
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray="2 8"
      />
      {[0, 1, 2, 3, 4].map(i => (
        <circle
          key={i}
          cx={x(i)}
          cy={8}
          r={6}
          fill={i === 0 ? "var(--dk-teal)" : "var(--dk-space)"}
          stroke={i === 0 ? "var(--dk-teal)" : "var(--dk-line-strong)"}
          strokeWidth={2}
        />
      ))}
    </svg>
  );
}

// ---------------------------------------- after the call (L6 stop 7, 8)

const MARKS = [null, Bell, PhoneIcon, MessageSquareText, CalendarCheck];

/**
 * "What we do before the meeting": the five steps joined by the journey's
 * line, lit top to bottom (400 ms a step), each with its time in Mono and
 * its channel's mark. Said as what we do, never "every"; no reply buttons.
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
        {rows.map((r, i) => {
          const Mark = MARKS[dwy && i === 3 ? 4 : i];
          return (
            <li
              key={r.what.en}
              style={{ "--i": i } as CSSProperties}
              data-last={i === rows.length - 1 ? "" : undefined}
            >
              <span className="dkc-rem-mark" aria-hidden>
                {i === 0 ? (
                  <Logo mark="whatsapp" size={30} />
                ) : Mark ? (
                  <Mark />
                ) : null}
              </span>
              <span className="dkc-rem-text">
                {r.when ? (
                  <span
                    className="dkc-rem-when"
                    data-plain={r.plain ? "" : undefined}
                  >
                    {t(r.when, lang)}:
                  </span>
                ) : null}
                <span>{t(r.what, lang)}</span>
              </span>
            </li>
          );
        })}
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

export function CrmStages({ lang }: { lang: Lang }) {
  return (
    <ol className="dkc-crm">
      {LAUNCH.portal.crm.map((s, i) => (
        <li key={s.en}>
          <span>{t(s, lang)}</span>
          {i < LAUNCH.portal.crm.length - 1 ? <ArrowDown aria-hidden /> : null}
        </li>
      ))}
    </ol>
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
