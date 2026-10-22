import { type CSSProperties, useLayoutEffect, useRef, useState } from "react";
import { type L, type Lang, t } from "../content";
import { Logo } from "../platforms";
import { ClientMark, type Identity } from "./Identity";

/**
 * The client's WhatsApp group, drawn as what it is (DESIGN 9.3, 22.2.3):
 * one group and the people in it. Their mark on the start side, the real
 * WhatsApp mark badged on its corner (the slide's title says "WhatsApp
 * group"), and from the mark one line that
 * branches to each role, in the journey's line language (a 2 px line,
 * rounded elbows, a teal node for each of ours).
 *
 * Stop 1, on arrival: the group fills. The trunk leaves the mark, then each
 * branch reaches its role in turn, and each role fades in as its branch
 * arrives (one path drawing at a time, about 760 ms, then still). Stop 2:
 * the promise, "We reply within 2 working hours.", as the stop's heading
 * under the label, with the hours under it. Its room is kept on stop 1, so
 * nothing moves when it arrives.
 *
 * Not WhatsApp's own screen (WhatsApp never lists roles), so no app
 * colours, no messages, no faces, no names: roles only.
 */
export function WhatsAppGroup({
  who,
  lang,
  header,
  reply,
  hours,
  promise,
  rows,
}: {
  who: Identity;
  lang: Lang;
  header: L;
  /** The promise, stop 2's heading. */
  reply: L;
  /** The hours and the worry line, under the promise. */
  hours: L;
  /** Stop 2: the promise shows. */
  promise: boolean;
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
  const said = rows.map(r => t(r.name, lang)).join("|") + t(hours, lang);
  // Measured once laid out (and again once the fonts are in): the mark's
  // end edge, and each role's node, in canvas pixels from the section's
  // inline start, so one drawing serves both directions (it mirrors).
  // biome-ignore lint/correctness/useExhaustiveDependencies: measured again when the words change
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    let live = true;
    const fit = () => {
      if (!live) return;
      const hub = root.querySelector<HTMLElement>(".dkc-group-hub");
      const mark = root.querySelector<HTMLElement>(".dkc-group-mark");
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
      // The mark level with the middle role, so the trunk runs straight
      // into it and branches up and down to the others.
      const a = to[Math.floor((to.length - 1) / 2)].y;
      const b = to[Math.ceil((to.length - 1) / 2)].y;
      const mid = (a + b) / 2;
      const shift = mid - cy(m);
      hub.style.transform = `translateY(${shift}px)`;
      const next = {
        w: root.offsetWidth,
        h: root.offsetHeight,
        from: { x: lx(rtl ? m.left : m.right) + 10, y: mid },
        // The bus 100 px before the roles, so the trunk from the mark is
        // under 300 px and the drawing reads as one group (score round 2:
        // 470 px of trunk left a hole in the middle of it). Not nearer the
        // mark (score round 4 tried 196): the bus then ran through stop
        // 2's reply-time block, which fills the hub's 460 px column.
        bus: Math.min(...to.map(p => p.x)) - 100,
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
    <section
      className="dkc-group"
      aria-label={t(header, lang)}
      ref={ref}
      data-drawn={lines ? "" : undefined}
    >
      {lines ? (
        <svg
          className="dkc-group-lines"
          width={lines.w}
          height={lines.h}
          viewBox={`0 0 ${lines.w} ${lines.h}`}
          aria-hidden
        >
          <path
            className="dkc-group-trunk"
            d={`M ${lines.from.x} ${lines.from.y} L ${lines.bus} ${lines.from.y}`}
            pathLength={1}
          />
          {lines.to.map((p, i) => (
            <path
              key={rows[i]?.key ?? i}
              className="dkc-group-branch"
              d={branch(p, lines.from, lines.bus)}
              pathLength={1}
              style={{ "--i": i } as CSSProperties}
            />
          ))}
        </svg>
      ) : null}
      <div className="dkc-group-hub">
        {/* The WhatsApp mark badged on their mark's bottom end corner, as
            WhatsApp badges a group's picture (score round 2: alone under
            the mark it read as a stray glyph). The title names the group,
            and the section's label says it to a screen reader. */}
        <span className="dkc-group-mark">
          <ClientMark who={who} size={112} />
          <span className="dkc-group-badge" aria-hidden>
            <Logo mark="whatsapp" size={36} />
          </span>
        </span>
        <div
          className="dkc-group-promise"
          data-shown={promise ? "" : undefined}
        >
          <p className="dk-h3">{t(reply, lang)}</p>
          <p className="dkc-group-hours">{t(hours, lang)}</p>
        </div>
      </div>
      <ul className="dkc-group-members">
        {rows.map((r, i) => (
          <li
            key={r.key}
            data-theirs={r.theirs ? "" : undefined}
            style={{ "--i": i } as CSSProperties}
          >
            <i className="dkc-member-dot" aria-hidden />
            <b>{t(r.name, lang)}</b>
            <span>{t(r.line, lang)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
