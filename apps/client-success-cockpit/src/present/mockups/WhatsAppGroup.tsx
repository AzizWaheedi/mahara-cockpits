import { useLayoutEffect, useRef, useState } from "react";
import { type L, type Lang, t } from "../content";
import { ClientMark, type Identity } from "./Identity";

/**
 * The client's WhatsApp group, drawn as what it is (DESIGN 9.3): one group
 * and the people in it. The group's head on the start side (their avatar,
 * its name and the hours as its description), and from the avatar one
 * line that branches to each member, in the journey's line language (a
 * 2 px line, rounded elbows, a teal dot for each of ours). Beside each dot
 * the role and what that person messages them about. Not WhatsApp's own
 * screen (WhatsApp never lists roles), so no app colours, no fake messages,
 * no tag. Roles, not names: the presenting CSM is named on the cover alone.
 */
export function WhatsAppGroup({
  who,
  lang,
  header,
  about,
  rows,
}: {
  who: Identity;
  lang: Lang;
  header: L;
  /** The group's description line under its name (the hours). */
  about: L;
  rows: { key: string; name: L; line: L; theirs?: boolean }[];
}) {
  const ref = useRef<HTMLElement>(null);
  const [lines, setLines] = useState<{
    w: number;
    h: number;
    from: { x: number; y: number };
    bus: number;
    to: { x: number; y: number }[];
  } | null>(null);
  const said = rows.map(r => t(r.name, lang)).join("|") + t(about, lang);
  // Measured once laid out (and again once the fonts are in): the avatar's
  // end edge, and each member's dot, in canvas pixels from the section's
  // inline start, so one drawing serves both directions (it mirrors).
  // biome-ignore lint/correctness/useExhaustiveDependencies: measured again when the words change
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    let live = true;
    const fit = () => {
      if (!live) return;
      const hub = root.querySelector<HTMLElement>(".dkc-group-hub");
      const mark = hub?.firstElementChild as HTMLElement | null | undefined;
      const dots = [...root.querySelectorAll<HTMLElement>(".dkc-member-dot")];
      if (!hub || !mark || !dots.length) return;
      hub.style.transform = "";
      const r = root.getBoundingClientRect();
      const k = r.width / root.offsetWidth || 1;
      const rtl = lang === "ar";
      const lx = (px: number) => (rtl ? r.right - px : px - r.left) / k;
      const cy = (b: DOMRect) => (b.top + b.height / 2 - r.top) / k;
      const m = mark.getBoundingClientRect();
      const ends = dots.map(d => d.getBoundingClientRect());
      const to = ends.map(b => ({
        x: lx(rtl ? b.right : b.left) - 6,
        y: cy(b),
      }));
      // The avatar level with the middle member, so the line from it runs
      // straight into that member and branches up and down to the others.
      const a = to[Math.floor((to.length - 1) / 2)].y;
      const b = to[Math.ceil((to.length - 1) / 2)].y;
      const mid = (a + b) / 2;
      const shift = mid - cy(m);
      hub.style.transform = `translateY(${shift}px)`;
      const next = {
        w: root.offsetWidth,
        h: root.offsetHeight,
        from: { x: lx(rtl ? m.left : m.right) + 10, y: mid },
        bus: Math.min(...to.map(p => p.x)) - 72,
        to,
      };
      setLines(l => (JSON.stringify(l) === JSON.stringify(next) ? l : next));
    };
    fit();
    document.fonts?.ready.then(fit);
    return () => {
      live = false;
    };
  }, [lang, said]);
  const R = 22;
  const branch = (
    p: { x: number; y: number },
    from: { y: number },
    bus: number,
  ) => {
    const dy = p.y - from.y;
    if (Math.abs(dy) < 2) return `M ${bus} ${from.y} L ${p.x} ${p.y}`;
    const s = Math.sign(dy);
    return `M ${bus} ${from.y} L ${bus} ${p.y - s * R} Q ${bus} ${p.y} ${bus + R} ${p.y} L ${p.x} ${p.y}`;
  };
  return (
    <section className="dkc-group" aria-label={t(header, lang)} ref={ref}>
      {lines ? (
        <svg
          className="dkc-group-lines"
          width={lines.w}
          height={lines.h}
          viewBox={`0 0 ${lines.w} ${lines.h}`}
          aria-hidden
        >
          <path
            d={`M ${lines.from.x} ${lines.from.y} L ${lines.bus} ${lines.from.y}`}
            fill="none"
            stroke="var(--dk-line-strong)"
            strokeWidth={2}
            strokeLinecap="round"
          />
          {lines.to.map((p, i) => (
            <path
              key={rows[i]?.key ?? i}
              d={branch(p, lines.from, lines.bus)}
              fill="none"
              stroke="var(--dk-line-strong)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </svg>
      ) : null}
      <div className="dkc-group-hub">
        <ClientMark who={who} size={128} />
        <b>{t(header, lang)}</b>
        <p>{t(about, lang)}</p>
      </div>
      <ul className="dkc-group-members">
        {rows.map(r => (
          <li key={r.key} data-theirs={r.theirs ? "" : undefined}>
            <i className="dkc-member-dot" aria-hidden />
            <b>{t(r.name, lang)}</b>
            <span>{t(r.line, lang)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
