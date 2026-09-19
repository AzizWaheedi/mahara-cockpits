import { ArrowUpRight, Compass, Layers, Radar, Smartphone, Users } from "lucide-react";
import type { ReactNode } from "react";
import { foreplay } from "../lib/foreplay";
import type { ForeplayBoard } from "../lib/types";

/**
 * The two places the cockpit hands off to Foreplay.
 *
 * Their app sets `frame-ancestors 'self'`, so it cannot be embedded here --
 * an iframe of discovery is a blank box, in this cockpit or any other. What
 * works is a link: everybody is signed in there already, so one lands on the
 * real page with their team's saves in it.
 *
 * The cockpit is still the place you read from. Discovery is where you go
 * looking for something that is not on the board yet, and whatever you save
 * there comes back here by itself.
 */
function Link({ href, icon, children }: { href: string; icon: ReactNode; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="raised group flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold"
    >
      {icon}
      {children}
      <ArrowUpRight
        className="muted size-3 transition group-hover:translate-x-px group-hover:-translate-y-px"
        strokeWidth={2.5}
      />
    </a>
  );
}

/** Where to go in Foreplay, in the order somebody actually needs them. */
export function ForeplayLinks() {
  const ic = "size-3.5";
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Link href={foreplay.discovery} icon={<Compass className={ic} strokeWidth={2} />}>
        Search discovery
      </Link>
      <Link href={foreplay.brands} icon={<Users className={ic} strokeWidth={2} />}>
        By advertiser
      </Link>
      <Link href={foreplay.spyder} icon={<Radar className={ic} strokeWidth={2} />}>
        Brands we follow
      </Link>
      <Link href={foreplay.boards} icon={<Layers className={ic} strokeWidth={2} />}>
        Boards
      </Link>
      <Link href={foreplay.onPhone} icon={<Smartphone className={ic} strokeWidth={2} />}>
        Save from your phone
      </Link>
    </div>
  );
}

/**
 * A board counts as new if we first saw it in the last week.
 *
 * Derived rather than stored on purpose. A "seen" flag somebody has to clear
 * is one more thing that can get stuck in the wrong position, and a board
 * permanently marked new is worse than no marking at all.
 */
const WEEK = 7 * 24 * 60 * 60 * 1000;

export function isNew(board: ForeplayBoard): boolean {
  const at = Date.parse(board.first_seen_at ?? "");
  return Number.isFinite(at) && Date.now() - at < WEEK;
}

/**
 * The boards Foreplay had at the last sync.
 *
 * A board deleted over there should stop appearing here, but a worker that
 * has stopped running must not empty the strip. Both hold if we keep the
 * boards from the most recent sync: they all carry that run's timestamp, so
 * a deleted one falls away on the next run and a dead worker just leaves
 * the last good set on screen.
 */
export function currentBoards(boards: ForeplayBoard[] | null | undefined): ForeplayBoard[] {
  const rows = boards ?? [];
  if (!rows.length) return [];
  const newest = rows.reduce((a, b) => (a.last_seen_at > b.last_seen_at ? a : b)).last_seen_at;
  const cutoff = Date.parse(newest) - 10 * 60 * 1000;
  return rows.filter((b) => Date.parse(b.last_seen_at) >= cutoff);
}

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
    `flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold ${
      on ? "bg-[color:var(--primary)] text-[color:var(--primary-foreground)]" : "raised muted"
    }`;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => onChoose("")}
        aria-pressed={!chosen}
        className={chip(!chosen)}
      >
        All boards
        <span className="tabular-nums opacity-70">{total}</span>
      </button>

      {boards.map((b) => {
        const on = chosen === b.id;
        return (
          <span key={b.id} className="flex items-center">
            <button
              type="button"
              onClick={() => onChoose(b.id)}
              aria-pressed={on}
              className={`${chip(on)} rounded-r-none pr-2`}
            >
              {b.name ?? "Untitled board"}
              <span className="tabular-nums opacity-70">{counts.get(b.id) ?? 0}</span>
              {b.feeds_ideation ? (
                <span
                  title="Saves here become ideation posts on their own"
                  className="rounded-full bg-[color:var(--success)]/15 px-1.5 text-[10px] font-bold uppercase tracking-wide"
                  style={{ color: "var(--success)" }}
                >
                  ideation
                </span>
              ) : null}
              {isNew(b) ? (
                <span
                  title="First seen this week"
                  className="rounded-full bg-[color:var(--primary)]/15 px-1.5 text-[10px] font-bold uppercase tracking-wide"
                  style={{ color: "var(--primary)" }}
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
              className={`${chip(on)} rounded-l-none border-l border-[color:var(--border)] pl-2`}
            >
              <ArrowUpRight className="size-3" strokeWidth={2.5} />
            </a>
          </span>
        );
      })}
    </div>
  );
}
