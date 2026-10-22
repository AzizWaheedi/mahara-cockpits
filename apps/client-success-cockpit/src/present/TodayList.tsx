import { type CSSProperties, useRef } from "react";
import { type Lang, O, stepNumeral, t } from "./content";
import type { DeckData } from "./deckData";

/**
 * The call's checklist (DESIGN 22.2.0, `dkc-today`): the three things the
 * onboarding call must finish, in the call's order. Introduced on the
 * cover as three rings with their numbers (always open: it is the agenda),
 * ticked at the foot of O4 and O6 when each gets done, and closed on O7's
 * last stop with their true state. Every tick is a recorded fact (the
 * client's choice, a setup step, a booking), never the deck's Next press,
 * and there is never a count ("2 of 3").
 *
 * Only a change seen on screen animates: an item that turns done while the
 * slide is up draws its check; a slide that opens on a done item shows it
 * done at once, except O7's close, which draws its done items in order as
 * the deck ends. Everything is set at once under `--dk-m: 0`.
 */

export type TodayKey = "service" | "access" | "blueprint";
export const TODAY_KEYS: readonly TodayKey[] = [
  "service",
  "access",
  "blueprint",
];

type Variant = "cover" | "foot" | "close";

/** The ring's check, in the lanes' hand (the same in both languages). */
function Mark({ size, done }: { size: number; done: boolean }) {
  const r = size / 2 - 1;
  const c = size / 2;
  const k = size / 44;
  return (
    <svg
      className="dkc-today-mark"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden
    >
      {/* A path, not a circle, so it can draw from the top (pathLength). */}
      <path
        className="dkc-today-ring"
        d={`M ${c} ${c - r} a ${r} ${r} 0 1 1 0 ${2 * r} a ${r} ${r} 0 1 1 0 ${-2 * r}`}
        pathLength={1}
      />
      <g className="dkc-today-done" data-on={done ? "" : undefined}>
        <circle cx={c} cy={c} r={r} />
        <path
          className="dkc-today-check"
          pathLength={1}
          d={`M ${c - 8.5 * k} ${c + 0.5 * k} L ${c - 2.5 * k} ${c + 6.5 * k} L ${c + 9.5 * k} ${c - 6 * k}`}
        />
      </g>
    </svg>
  );
}

export function TodayList({
  d,
  lang,
  variant,
  own = null,
}: {
  d: DeckData;
  lang: Lang;
  variant: Variant;
  /** The slide's own item (the foot of O4 and O6): ink-2 while open. */
  own?: number | null;
}) {
  // On the cover the three are always open: it is the agenda, said before
  // anything is done.
  const done = TODAY_KEYS.map(k => variant !== "cover" && d.today[k]);
  // What was done when the slide opened: only a later change draws.
  const atOpen = useRef(done);
  // The cover's rings sit under the name since the fixer's round (22.11);
  // the foot's at 30 with 17 px numerals (score round 2 of the five
  // services: at 24 and 14 they did not read on a share).
  const size = variant === "foot" ? 30 : variant === "cover" ? 36 : 44;
  const names =
    variant === "cover"
      ? O.welcome.agenda
      : (O.today.short as readonly { en: string; ar: string }[]);
  let drawn = 0;
  const list = (
    <ol className="dkc-today-list">
      {names.map((name, i) => {
        const on = done[i];
        // O7's close draws its done items in order; elsewhere only a tick
        // made while the slide is up draws.
        const draw = on && (variant === "close" || !atOpen.current[i]);
        const order = draw ? drawn++ : 0;
        return (
          <li
            key={name.en}
            data-done={on ? "" : undefined}
            data-draw={draw ? "" : undefined}
            data-own={own === i ? "" : undefined}
            style={{ "--i": i, "--k": order } as CSSProperties}
          >
            <span className="dkc-today-ring-wrap">
              {variant === "cover" && i > 0 ? (
                // The lanes' unlit dotted line, ring to ring.
                <svg
                  className="dkc-today-join"
                  width="2"
                  height="36"
                  viewBox="0 0 2 36"
                  aria-hidden
                >
                  <line x1="1" y1="6" x2="1" y2="30" />
                </svg>
              ) : null}
              <Mark size={size} done={on} />
              <span className="dkc-today-num" aria-hidden>
                {stepNumeral(i, lang)}
              </span>
            </span>
            <span className="dkc-today-name">{t(name, lang)}</span>
            {/* The state, for a screen reader: the ring says it on screen. */}
            <span className="dk-sr">{on ? ", done" : ""}</span>
          </li>
        );
      })}
    </ol>
  );
  if (variant === "cover")
    return (
      <div className="dkc-today" data-variant="cover">
        <p className="dkc-today-lead">{t(O.welcome.agendaLead, lang)}</p>
        {list}
      </div>
    );
  return (
    <div className="dkc-today" data-variant={variant}>
      <span className="dkc-today-label">{t(O.today.label, lang)}</span>
      {list}
    </div>
  );
}
