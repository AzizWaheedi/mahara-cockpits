import { ChevronRight } from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
import { Link, useLocation } from "react-router";
import { useTaskSeat } from "@/lib/taskSeat";
import {
  focusSearch,
  readCanLinkSeats,
  type TaskFeedState,
  useTaskFeed,
} from "@/lib/tasksClient";
import {
  dueWords,
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
  | { kind: "not_linked"; note: string }
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
): CardState {
  const data = feed.tasks;
  if (!data) return feed.error.tasks ? { kind: "failed" } : { kind: "reading" };
  if (data.link === "not_linked")
    return {
      kind: "not_linked",
      note: data.note?.trim() || TASK_SENTENCES.notLinked,
    };
  const sourceMs = data.sourceAt ? Date.parse(data.sourceAt) : Number.NaN;
  const lateAt =
    !data.ready && Number.isFinite(sourceMs) ? kuwaitTime(sourceMs) : null;
  // Never read is not "nothing to do": it says it could not be read.
  if (!data.ready && !lateAt) return { kind: "failed" };
  const empty =
    data.tasks.length === 0 ? (lateAt ? null : TASK_SENTENCES.empty) : null;
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
  const feed = useTaskFeed();
  const state = cardState(feed);
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
      <p className="tk-note" aria-busy="true">
        Reading your tasks…
      </p>
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
  if (state.kind === "not_linked") return <NotLinked note={state.note} />;
  if (state.empty) return <p className="tk-note">{state.empty}</p>;
  return null;
}

function NotLinked({ note }: { note: string }) {
  const seat = useTaskSeat();
  const [canLink, setCanLink] = useState(false);
  useEffect(() => {
    if (!seat.client) return;
    let live = true;
    void readCanLinkSeats(seat.client).then(yes => {
      if (live) setCanLink(yes);
    });
    return () => {
      live = false;
    };
  }, [seat.client]);
  return (
    <div className="tk-note">
      <p>{note}</p>
      {canLink ? (
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
  if (!seat.signedIn || !seat.client) return null;
  const state = cardState(feed);
  const nowMs = Date.now();
  const data = state.kind === "tasks" ? state.data : null;
  const rows = data ? firstFive(data.tasks) : [];
  const total = data ? Math.max(data.counts.total, data.tasks.length) : 0;
  const hidden = data ? total - rows.length : 0;
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
