import { Grid3x3 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  AD_GRID,
  CPB_BAD,
  CPB_GATE,
  CPL_BAD,
  CPL_GATE,
  GRID_COLUMNS,
  type GridRow,
  type GridVerdict,
} from "@/lib/kpi";
import { cn } from "@/lib/utils";

const ROWS: GridRow[] = ["good", "watch", "bad", "early"];

const DOT: Record<GridVerdict, string> = {
  scale: "var(--success)",
  hold: "var(--warning)",
  kill: "var(--destructive)",
};

const WORD: Record<GridVerdict, string> = {
  scale: "Scale",
  hold: "Hold",
  kill: "Kill",
};

/** The same chip the Call column shows, so a cell reads as the call itself. */
function Chip({ verdict }: { verdict: GridVerdict }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium text-foreground">
      <span
        aria-hidden
        className="size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: DOT[verdict] }}
      />
      {WORD[verdict]}
    </span>
  );
}

/**
 * How the Call column is decided (Muhammed, 2026-10-13): cost per lead and
 * cost per booking read together. With a mouse it opens on hover and a click
 * keeps it open; on a touch screen a tap opens and closes it. Pointing at a
 * cell lights its row and column, so the table reads like a lookup.
 */
export function VerdictPlaybook() {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [at, setAt] = useState<{ row: GridRow; col: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Hover only peeks: a pinned panel stays until a click, Escape or a click
  // outside closes it.
  const hover = (next: boolean) => (e: React.PointerEvent) => {
    if (e.pointerType !== "mouse" || pinned) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(next), next ? 150 : 250);
  };

  return (
    <Popover
      open={open}
      onOpenChange={next => {
        setOpen(next);
        if (!next) {
          setPinned(false);
          setAt(null);
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          onPointerEnter={hover(true)}
          onPointerLeave={hover(false)}
          onClick={e => {
            // Radix would toggle; a click on a panel that hover opened pins it.
            e.preventDefault();
            window.clearTimeout(timer.current);
            if (open && !pinned) setPinned(true);
            else {
              setOpen(!open);
              setPinned(!open);
            }
          }}
        >
          <Grid3x3 aria-hidden />
          How ads are judged
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        collisionPadding={16}
        onPointerEnter={hover(true)}
        onPointerLeave={hover(false)}
        onOpenAutoFocus={e => e.preventDefault()}
        className="max-h-(--radix-popover-content-available-height) w-[min(calc(100vw-2rem),32rem)] overflow-y-auto p-4 sm:p-5"
      >
        <h2 className="text-[15px] font-semibold">How ads are judged</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
          Cost per lead and cost per booking are read together, over the last 7
          days. Neither one decides alone: cheap leads that do not book are not
          working, and dearer leads that book cheaply are.
        </p>

        <div
          role="table"
          aria-label="The call for each cost per booking and cost per lead"
          className="mt-4 grid grid-cols-[minmax(0,1.25fr)_repeat(3,minmax(0,1fr))] items-center gap-x-2 gap-y-2.5"
          onPointerLeave={() => setAt(null)}
        >
          <div role="row" className="contents">
            {/* The corner keeps its grid cell; only its words are hidden. */}
            <span role="columnheader">
              <span className="sr-only">Cost per booking</span>
            </span>
            {GRID_COLUMNS.map((label, col) => (
              <span
                key={label}
                role="columnheader"
                className={cn(
                  "font-mono text-[10px] uppercase leading-tight tracking-[0.06em] text-muted-foreground transition-colors",
                  at?.col === col && "text-foreground",
                )}
              >
                {label}
              </span>
            ))}
          </div>
          {ROWS.map(row => (
            <div key={row} role="row" className="contents">
              <span
                role="rowheader"
                className={cn(
                  "text-[13px] leading-snug text-muted-foreground transition-colors",
                  at?.row === row && "text-foreground",
                )}
              >
                {AD_GRID[row].label}
                {AD_GRID[row].note ? (
                  <span className="block text-[11px] opacity-80">
                    {AD_GRID[row].note}
                  </span>
                ) : null}
              </span>
              {AD_GRID[row].cells.map((verdict, col) => (
                <span
                  key={col}
                  role="cell"
                  onPointerEnter={() => setAt({ row, col })}
                  className={cn(
                    "rounded-lg px-1 py-1 transition-colors",
                    at?.row === row && at.col === col && "bg-muted/60",
                  )}
                >
                  <Chip verdict={verdict} />
                </span>
              ))}
            </div>
          ))}
        </div>

        <dl className="mt-4 space-y-1.5 border-t pt-3 text-[13px] leading-relaxed">
          {[
            [
              "Zero leads after spend",
              `Kill. If earlier leads still booked: Hold, or Kill over $${CPB_BAD} a booking.`,
            ],
            [
              "A working ad seen 2.5 times per person",
              "Fatiguing: queue a refresh.",
            ],
            [
              "A hold with a weak page or hook",
              "Below KPI (people click, under 2% opt in) or Fatiguing (link CTR under 0.3%).",
            ],
            [
              "Done With You, or bookings not readable",
              `Cost per lead only: over $${CPL_GATE} is Hold, over $${CPL_BAD.toFixed(2)} is Kill. The reason says so.`,
            ],
          ].map(([when, then]) => (
            <div
              key={when}
              className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] gap-3"
            >
              <dt className="text-muted-foreground">{when}</dt>
              <dd>{then}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          A booking counts on the day it was made, under the ad that bought it.
          No booking after ${CPB_GATE} spent already means each booking will
          cost over ${CPB_GATE}. Each call's reason names the numbers it used.
        </p>
      </PopoverContent>
    </Popover>
  );
}
