import { ChevronRight } from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
import { Link, useLocation } from "react-router";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { useTaskSeat } from "@/lib/taskSeat";
import {
  focusSearch,
  readCanLinkSeats,
  type TaskFeedState,
  useTaskFeed,
} from "@/lib/tasksClient";
import {
  dueWords,
  emptySentence,
  firstFive,
  kuwaitTime,
  type MyTasks,
  TASK_SENTENCES,
  type TaskRow,
} from "@/lib/tasksCore";
import { TaskPanel } from "./TaskPanel";
import "./tasks.css";

/**
 * "Your tasks" on every Today (PLAN.md D19, CONTRACT.md 6.5): the open
 * ClickUp tasks assigned to this seat, at most five rows, late first, then
 * due today, then the newest. One line each; the whole row opens the task in
 * the focus view (?focus=), in place. "See all" opens the rest in a panel,
 * also in place. A seat with no ClickUp link is told so, never shown zero.
 */

export type CardState =
  | { kind: "reading" }
  | { kind: "failed" }
  | {
      kind: "not_linked";
      note: string;
      /** An editor cleared the seat's link: no "Link it" is offered. */
      cleared: boolean;
    }
  | {
      kind: "tasks";
      data: MyTasks;
      /** "Last read at 14:02" when the mirror is late, else null. */
      lateAt: string | null;
      /** The sentence in place of rows, else null. */
      empty: string | null;
    };

/** What the card shows for a feed state. */
export function cardState(
  feed: Pick<TaskFeedState, "tasks" | "error">,
  cockpit = "portal",
): CardState {
  const data = feed.tasks;
  if (!data) return feed.error.tasks ? { kind: "failed" } : { kind: "reading" };
  if (data.link === "not_linked") {
    const cleared = data.linkState === "cleared";
    return {
      kind: "not_linked",
      note:
        data.note?.trim() ||
        (cleared ? TASK_SENTENCES.cleared : TASK_SENTENCES.notLinked),
      cleared,
    };
  }
  const sourceMs = data.sourceAt ? Date.parse(data.sourceAt) : Number.NaN;
  const lateAt =
    !data.ready && Number.isFinite(sourceMs) ? kuwaitTime(sourceMs) : null;
  // Never read is not "nothing to do": it says it could not be read.
  if (!data.ready && !lateAt) return { kind: "failed" };
  const empty =
    data.tasks.length === 0 ? (lateAt ? null : emptySentence(cockpit)) : null;
  return { kind: "tasks", data, lateAt, empty };
}

/** A portal page: a link inside the portal, an address from elsewhere. */
export function PortalLink({
  path,
  className,
  children,
  onClick,
}: {
  path: string;
  className?: string;
  children: ReactNode;
  onClick?: () => void;
}) {
  const seat = useTaskSeat();
  return seat.inPortal ? (
    <Link to={path} className={className} onClick={onClick}>
      {children}
    </Link>
  ) : (
    <a href={seat.portalHref(path)} className={className} onClick={onClick}>
      {children}
    </a>
  );
}

/** One task, one line: the spine, the title, the client, the due word. */
export function TaskLine({
  task,
  nowMs,
  onOpen,
}: {
  task: TaskRow;
  nowMs: number;
  onOpen?: () => void;
}) {
  const { search } = useLocation();
  const due = dueWords(task, nowMs);
  return (
    <li>
      <Link
        to={{ search: focusSearch(search, task.taskId) }}
        className="tk-row"
        onClick={onOpen}
      >
        <span className={`tk-spine tk-spine-${due.tone}`} aria-hidden />
        <bdi dir="auto" className="tk-row-title">
          {task.title}
        </bdi>
        {task.clientName ? (
          <bdi dir="auto" className="tk-row-client">
            {task.clientName}
          </bdi>
        ) : null}
        {due.text ? <span className="tk-row-due">{due.text}</span> : null}
      </Link>
    </li>
  );
}

/** Every open task, in a panel over the page: "See all", or a due alert. */
export function TaskListPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const seat = useTaskSeat();
  const feed = useTaskFeed();
  const state = cardState(feed, seat.cockpit);
  const nowMs = Date.now();
  const data = state.kind === "tasks" ? state.data : null;
  return (
    <TaskPanel
      open={open}
      onClose={onClose}
      title="Your tasks"
      subtitle={
        data && data.counts.total > 0 ? `${data.counts.total} open` : undefined
      }
    >
      {data?.tasks.length ? (
        <>
          <ul className="tk-list tk-list-panel">
            {data.tasks.map(t => (
              <TaskLine
                key={t.taskId}
                task={t}
                nowMs={nowMs}
                onOpen={onClose}
              />
            ))}
          </ul>
          {data.more > 0 ? (
            <p className="tk-note">
              And {data.more} more in ClickUp. The newest 200 show here.
            </p>
          ) : null}
        </>
      ) : (
        <CardNote state={state} />
      )}
    </TaskPanel>
  );
}

/** The sentence for a card with no rows to show. */
function CardNote({ state }: { state: CardState }) {
  const feed = useTaskFeed();
  if (state.kind === "reading")
    return (
      <LoadingSkeleton variant="list" label="Reading your tasks…" rows={3} />
    );
  if (state.kind === "failed")
    return (
      <div className="tk-note tk-note-error" role="alert">
        <span>{TASK_SENTENCES.notRead}</span>{" "}
        <button
          type="button"
          className="tk-text-btn"
          onClick={feed.refresh}
          disabled={feed.reading}
        >
          {feed.reading ? "Trying…" : "Try again"}
        </button>
      </div>
    );
  if (state.kind === "not_linked")
    return <NotLinked note={state.note} cleared={state.cleared} />;
  if (state.empty) return <p className="tk-note">{state.empty}</p>;
  return null;
}

function NotLinked({ note, cleared }: { note: string; cleared: boolean }) {
  const seat = useTaskSeat();
  const [canLink, setCanLink] = useState(false);
  useEffect(() => {
    setCanLink(false);
    // An editor said this seat has no ClickUp user: nobody is sent to link it.
    if (!seat.client || cleared) return;
    let live = true;
    void readCanLinkSeats(seat.client, seat.seatId).then(yes => {
      if (live) setCanLink(yes);
    });
    return () => {
      live = false;
    };
  }, [seat.client, seat.seatId, cleared]);
  return (
    <div className="tk-note">
      <p>{note}</p>
      {canLink && !cleared ? (
        <PortalLink
          path="/requests/settings?tab=people"
          className="tk-link tk-link-chevron"
        >
          {TASK_SENTENCES.linkIt}
          <ChevronRight aria-hidden size={14} />
        </PortalLink>
      ) : null}
    </div>
  );
}

/**
 * The shape the card drew last time: how many rows and whether "See all"
 * showed. The reading card draws the same rows, so the page does not move
 * when the tasks arrive. Kept per cockpit and per seat, since each card
 * holds its own and one tab may sign a new seat in.
 */
const SHAPE_KEY = "mahara-your-tasks-shape:";
const DEFAULT_SHAPE = { rows: 5, more: false };

/** The seat's own key. A seat with no id remembers nothing. */
function shapeKey(cockpit: string, seatId: string | null): string | null {
  return seatId ? `${SHAPE_KEY}${cockpit}:${seatId}` : null;
}

export function readYourTasksShape(
  cockpit: string,
  seatId: string | null,
): {
  rows: number;
  more: boolean;
} {
  const key = shapeKey(cockpit, seatId);
  if (!key) return { ...DEFAULT_SHAPE };
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { ...DEFAULT_SHAPE };
    const shape = JSON.parse(raw) as { rows?: unknown; more?: unknown } | null;
    const stored = shape?.rows;
    const rows =
      typeof stored === "number" || typeof stored === "string"
        ? Number(stored)
        : Number.NaN;
    return {
      rows: Number.isFinite(rows)
        ? Math.min(5, Math.max(0, Math.trunc(rows)))
        : DEFAULT_SHAPE.rows,
      more: shape?.more === true,
    };
  } catch {
    return { ...DEFAULT_SHAPE };
  }
}

/** The line that says the task list is late, with the time in mono. */
export function LateLine({ at }: { at: string }) {
  return (
    <p className="tk-late" role="status">
      {TASK_SENTENCES.staleBefore}
      <time className="tk-mono">{at}</time>
      {TASK_SENTENCES.staleAfter}
    </p>
  );
}

export function YourTasks({ id }: { id?: string }) {
  const seat = useTaskSeat();
  const feed = useTaskFeed();
  const [all, setAll] = useState(false);
  const titleId = useId();
  const state = cardState(feed, seat.cockpit);
  const nowMs = Date.now();
  const data = state.kind === "tasks" ? state.data : null;
  const rows = data ? firstFive(data.tasks) : [];
  const total = data ? Math.max(data.counts.total, data.tasks.length) : 0;
  const hidden = data ? total - rows.length : 0;
  const key = shapeKey(seat.cockpit, seat.seatId);
  useEffect(() => {
    if (state.kind !== "tasks" || !key) return;
    try {
      localStorage.setItem(
        key,
        JSON.stringify({ rows: rows.length, more: hidden > 0 }),
      );
    } catch {
      // No storage: the reading card falls back to its default shape.
    }
  }, [state.kind, key, rows.length, hidden]);
  if (!seat.signedIn || !seat.client) return null;
  const shape = readYourTasksShape(seat.cockpit, seat.seatId);
  return (
    <section id={id} className="tk-card" aria-labelledby={titleId}>
      <header className="tk-card-head">
        <h2 id={titleId} className="tk-card-title">
          Your tasks
          {total > 0 ? <span className="tk-count">{total}</span> : null}
        </h2>
        {state.kind === "tasks" && state.lateAt ? (
          <LateLine at={state.lateAt} />
        ) : null}
      </header>
      {rows.length ? (
        <ul className="tk-list">
          {rows.map(t => (
            <TaskLine key={t.taskId} task={t} nowMs={nowMs} />
          ))}
        </ul>
      ) : state.kind === "reading" && shape.rows > 0 ? (
        <>
          <ul className="tk-list" aria-hidden="true">
            {Array.from({ length: shape.rows }, (_, i) => (
              <li key={`row-${i}`}>
                <span className="tk-row tk-row-skeleton">
                  <span className="tk-spine" aria-hidden="true" />
                  <span
                    aria-hidden="true"
                    className="tk-row-title block h-[14px] w-2/5 rounded-md bg-muted motion-safe:animate-pulse"
                  />
                  <span
                    aria-hidden="true"
                    className="tk-row-due block h-[13px] w-10 rounded-md bg-muted motion-safe:animate-pulse"
                  />
                </span>
              </li>
            ))}
          </ul>
          {shape.more ? <span className="tk-more" aria-hidden="true" /> : null}
          <span className="sr-only" role="status">
            Reading your tasks…
          </span>
        </>
      ) : (
        <div className="tk-card-body">
          <CardNote state={state} />
        </div>
      )}
      {hidden > 0 ? (
        <button
          type="button"
          className="tk-more"
          aria-haspopup="dialog"
          onClick={() => setAll(true)}
        >
          See all {total}
          <ChevronRight aria-hidden size={16} />
        </button>
      ) : null}
      <TaskListPanel open={all} onClose={() => setAll(false)} />
    </section>
  );
}
