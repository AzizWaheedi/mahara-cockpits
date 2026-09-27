import { ArrowUpRight } from "lucide-react";
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
 * Each link out carries one mark, the trailing arrow that says "opens in a
 * new tab"; a leading icon as well was two marks on one chip (Aziz,
 * 2026-09-26).
 *
 * This file is the same in all three cockpits. Change it in one and copy it.
 */
const LINKS: [string, string][] = [
  ["Search discovery", foreplay.discovery],
  ["By advertiser", foreplay.brands],
  ["Brands we follow", foreplay.spyder],
  ["Boards", foreplay.boards],
  ["Save from your phone", foreplay.onPhone],
];

/** A chip row that scrolls sideways on a phone instead of wrapping to three lines. */
const SCROLL_ROW =
  "flex flex-nowrap items-center gap-2 overflow-x-auto [scrollbar-width:none] sm:flex-wrap [&::-webkit-scrollbar]:hidden";

export function ForeplayLinks({
  bare = false,
  flat = false,
}: {
  /** Only the row of links. */
  bare?: boolean;
  /** The title, the links and the note, without a card around them. */
  flat?: boolean;
}) {
  const row = (
    <div className={SCROLL_ROW}>
      {LINKS.map(([label, href]) => (
        <a
          key={label}
          href={href}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground pointer-coarse:h-10"
        >
          {label}
          <ArrowUpRight className="size-3.5" aria-hidden />
        </a>
      ))}
    </div>
  );
  if (bare) return row;
  return (
    <div className={flat ? "" : "mb-4 rounded-2xl border bg-card p-4"}>
      <p className="text-sm font-semibold">Go looking in Foreplay</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Anything the team saves into the Foreplay drop box lands on this board
        by itself, wherever they save it from.
      </p>
      <div className="mt-3">{row}</div>
    </div>
  );
}

export default ForeplayLinks;

/** The teal active state every filter chip shares; inactive stays quiet. */
function chip(on: boolean) {
  return `inline-flex h-8 items-center gap-1.5 whitespace-nowrap border text-xs font-medium transition-colors pointer-coarse:h-10 ${
    on
      ? "border-primary/40 bg-primary/15 text-foreground"
      : "text-muted-foreground hover:bg-muted hover:text-foreground"
  }`;
}

/** A small mono tag inside a board chip ("ideation", "new"). */
const TAG =
  "rounded-full px-1.5 font-mono text-[11px] uppercase leading-4 tracking-[0.08em]";

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
  return (
    <div className={SCROLL_ROW}>
      <button
        type="button"
        onClick={() => onChoose("")}
        aria-pressed={!chosen}
        className={`${chip(!chosen)} shrink-0 rounded-full px-3`}
      >
        All boards
        <span className="tabular-nums opacity-70">{total}</span>
      </button>

      {boards.map(b => {
        const on = chosen === b.id;
        return (
          <span key={b.id} className="flex shrink-0 items-center">
            <button
              type="button"
              onClick={() => onChoose(b.id)}
              aria-pressed={on}
              className={`${chip(on)} rounded-l-full pr-2 pl-3`}
            >
              {b.name ?? "Untitled board"}
              <span className="tabular-nums opacity-70">
                {counts.get(b.id) ?? 0}
              </span>
              {b.feeds_ideation ? (
                <span
                  title="Saves here become ideation posts on their own"
                  className={TAG}
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
                  className={TAG}
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
              className={`${chip(on)} rounded-r-full border-l-0 pr-3 pl-2`}
            >
              <ArrowUpRight className="size-3.5" aria-hidden />
            </a>
          </span>
        );
      })}
    </div>
  );
}
