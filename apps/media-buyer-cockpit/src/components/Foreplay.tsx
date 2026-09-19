import {
  ArrowUpRight,
  Compass,
  Layers,
  Radar,
  Smartphone,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";
import { type ForeplayBoard, foreplay, isNew } from "../lib/foreplay";

/**
 * The two places a cockpit hands off to Foreplay: the links out, and the
 * boards the saves are kept in.
 *
 * Foreplay cannot be embedded (`frame-ancestors 'self'`), so ideation links
 * out instead. The cockpit is still where you read from; discovery is where
 * you go looking for something the board does not have yet, and whatever
 * gets saved there comes back here by itself.
 *
 * This file is the same in all three cockpits. Change it in one and copy it.
 */
const LINKS: [string, string, ReactNode][] = [
  [
    "Search discovery",
    foreplay.discovery,
    <Compass key="i" className="h-3.5 w-3.5" />,
  ],
  ["By advertiser", foreplay.brands, <Users key="i" className="h-3.5 w-3.5" />],
  [
    "Brands we follow",
    foreplay.spyder,
    <Radar key="i" className="h-3.5 w-3.5" />,
  ],
  ["Boards", foreplay.boards, <Layers key="i" className="h-3.5 w-3.5" />],
  [
    "Save from your phone",
    foreplay.onPhone,
    <Smartphone key="i" className="h-3.5 w-3.5" />,
  ],
];

export function ForeplayLinks({ bare = false }: { bare?: boolean }) {
  const row = (
    <div className="flex flex-wrap items-center gap-1.5">
      {LINKS.map(([label, href, icon]) => (
        <a
          key={label}
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          {icon}
          {label}
          <ArrowUpRight className="h-3 w-3 opacity-60" />
        </a>
      ))}
    </div>
  );
  if (bare) return row;
  return (
    <div className="mb-3 rounded-md border p-2.5">
      <p className="mb-2 text-[13px] font-semibold">Go looking in Foreplay</p>
      {row}
      <p className="mt-2 text-[12px] text-muted-foreground">
        Anything the team saves into the Foreplay drop box lands on this board
        by itself, wherever they save it from.
      </p>
    </div>
  );
}

export default ForeplayLinks;

/**
 * One chip per board, so saves stay separated instead of pooling into one
 * undifferentiated swipe file. Counts come from the ads we hold, not from
 * the board record, so the number always matches what the filter will show.
 */
export function BoardStrip({
  boards,
  counts,
  chosen,
  onChoose,
  total,
}: {
  boards: ForeplayBoard[];
  counts: Map<string, number>;
  chosen: string;
  onChoose: (id: string) => void;
  total: number;
}) {
  const chip = (on: boolean) =>
    `flex items-center gap-1.5 border px-3 py-1 text-[12px] font-semibold ${
      on
        ? "border-transparent bg-foreground text-background"
        : "text-muted-foreground hover:bg-muted"
    }`;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => onChoose("")}
        aria-pressed={!chosen}
        className={`${chip(!chosen)} rounded-full`}
      >
        All boards
        <span className="tabular-nums opacity-70">{total}</span>
      </button>

      {boards.map(b => {
        const on = chosen === b.id;
        return (
          <span key={b.id} className="flex items-center">
            <button
              type="button"
              onClick={() => onChoose(b.id)}
              aria-pressed={on}
              className={`${chip(on)} rounded-l-full pr-2`}
            >
              {b.name ?? "Untitled board"}
              <span className="tabular-nums opacity-70">
                {counts.get(b.id) ?? 0}
              </span>
              {b.feeds_ideation ? (
                <span
                  title="Saves here become ideation posts on their own"
                  className="rounded-full px-1.5 text-[10px] font-bold uppercase tracking-wide"
                  style={{
                    color: "var(--success)",
                    backgroundColor:
                      "color-mix(in oklch, var(--success) 15%, transparent)",
                  }}
                >
                  ideation
                </span>
              ) : null}
              {isNew(b) ? (
                <span
                  title="First seen this week"
                  className="rounded-full px-1.5 text-[10px] font-bold uppercase tracking-wide"
                  style={{
                    color: "var(--primary)",
                    backgroundColor:
                      "color-mix(in oklch, var(--primary) 18%, transparent)",
                  }}
                >
                  new
                </span>
              ) : null}
            </button>
            <a
              href={foreplay.board(b.id)}
              target="_blank"
              rel="noreferrer noopener"
              title={`Open ${b.name ?? "this board"} in Foreplay`}
              aria-label={`Open ${b.name ?? "this board"} in Foreplay`}
              className={`${chip(on)} rounded-r-full border-l-0 pl-2`}
            >
              <ArrowUpRight className="h-3 w-3" />
            </a>
          </span>
        );
      })}
    </div>
  );
}
