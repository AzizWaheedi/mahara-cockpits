import { ArrowUpRight, Check } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useTaskSeat } from "@/lib/taskSeat";
import {
  actOnTask,
  focusSearch,
  readTaskDetail,
  useTaskFeed,
} from "@/lib/tasksClient";
import {
  type ActionPhase,
  actionPhase,
  actionState,
  capitalFirst,
  checklistWords,
  dayWords,
  dueWords,
  isTaskId,
  kuwaitDay,
  kuwaitTime,
  statusTone,
  TASK_SENTENCES,
  type TaskDetail,
  type TaskOp,
  withoutMarker,
} from "@/lib/tasksCore";
import { TaskPanel } from "./TaskPanel";
import "./tasks.css";

/**
 * The focus view (PLAN.md D19, CONTRACT.md 6.5): one task and nothing else.
 * It opens wherever the address has ?focus=<task id>, in any cockpit, and
 * closes on Escape, Back or Close. Ticks, comments and Mark done go through
 * the ClickUp writeback queue; each control says "Saving…" until ClickUp's
 * read-back settles it, so "Saved" always means ClickUp has it.
 */

const POLL_MS = 3000;
const GIVE_UP_MS = 60_000;

type Pending = { ids: string[]; startedAt: number; phase: ActionPhase };

export function TaskFocusHost() {
  const seat = useTaskSeat();
  const location = useLocation();
  const navigate = useNavigate();
  const raw = new URLSearchParams(location.search).get("focus");
  const taskId = isTaskId(raw) ? raw : null;
  const close = useCallback(
    () =>
      navigate(
        {
          pathname: location.pathname,
          search: focusSearch(location.search, null),
          hash: location.hash,
        },
        { replace: true },
      ),
    [navigate, location.pathname, location.search, location.hash],
  );
  if (!taskId || !seat.signedIn || !seat.client) return null;
  return <FocusView key={taskId} taskId={taskId} onClose={close} />;
}

function PhaseNote({ phase }: { phase: ActionPhase | undefined }) {
  if (!phase) return null;
  const words =
    phase.phase === "saving"
      ? TASK_SENTENCES.saving
      : phase.phase === "saved"
        ? TASK_SENTENCES.saved
        : phase.phase === "waiting"
          ? TASK_SENTENCES.waiting
          : phase.message;
  return (
    <span
      className={`tk-phase tk-phase-${phase.phase}`}
      role={phase.phase === "error" ? "alert" : "status"}
    >
      {words}
    </span>
  );
}

function when(at: string): string {
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) return "";
  const day = kuwaitDay(ms);
  return day === kuwaitDay(Date.now())
    ? kuwaitTime(ms)
    : `${dayWords(day, true)}, ${kuwaitTime(ms)}`;
}

function FocusView({
  taskId,
  onClose,
}: {
  taskId: string;
  onClose: () => void;
}) {
  const seat = useTaskSeat();
  const feed = useTaskFeed();
  const { search } = useLocation();
  const [detail, setDetail] = useState<TaskDetail | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, Pending>>({});
  const [comment, setComment] = useState("");
  const [allComments, setAllComments] = useState(false);
  const [tick, setTick] = useState(0);
  const live = useRef(true);
  const shown = useRef<TaskDetail | null>(null);
  const client = seat.client;

  const load = useCallback(
    async (refresh: boolean): Promise<TaskDetail | null> => {
      if (!client) return null;
      try {
        const next = await readTaskDetail(client, taskId, refresh);
        if (live.current) {
          shown.current = next;
          setDetail(next);
          setRefused(null);
        }
        return next;
      } catch (err) {
        // A failed refresh keeps what is on screen; a first read says why.
        if (live.current && !shown.current)
          setRefused((err as Error).message || TASK_SENTENCES.notOpened);
        return null;
      }
    },
    [client, taskId],
  );

  useEffect(() => {
    live.current = true;
    void load(false);
    return () => {
      live.current = false;
    };
  }, [load]);

  const waitingOnClickUp = Object.values(pending).some(
    p => p.phase.phase === "saving" && p.ids.length > 0,
  );

  // While a change is on its way, read the task again every 3 seconds until
  // the queue settles it, for a minute at most.
  // biome-ignore lint/correctness/useExhaustiveDependencies: tick re-arms the poll
  useEffect(() => {
    if (!waitingOnClickUp) return;
    const timer = setTimeout(async () => {
      const next = await load(true);
      if (!live.current) return;
      let doneNow = false;
      let commented = false;
      setPending(prev => {
        const out: Record<string, Pending> = {};
        for (const [key, p] of Object.entries(prev)) {
          if (p.phase.phase !== "saving" || !p.ids.length) {
            out[key] = p;
            continue;
          }
          let phase = next
            ? actionPhase(actionState(next.actions, p.ids))
            : p.phase;
          if (phase.phase === "saving" && Date.now() - p.startedAt > GIVE_UP_MS)
            phase = { phase: "waiting" };
          if (phase.phase === "saved" && key === "done") doneNow = true;
          if (phase.phase === "saved" && key === "comment") commented = true;
          out[key] = { ...p, phase };
        }
        return out;
      });
      if (doneNow) feed.refresh();
      if (commented) setComment("");
      setTick(t => t + 1);
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [waitingOnClickUp, tick, load]);

  const act = async (
    key: string,
    op: TaskOp,
    payload: Record<string, unknown>,
  ) => {
    if (!client) return;
    setPending(p => ({
      ...p,
      [key]: { ids: [], startedAt: Date.now(), phase: { phase: "saving" } },
    }));
    try {
      const sent = await actOnTask(client, { taskId, op, payload });
      if (!live.current) return;
      setPending(p => ({
        ...p,
        [key]: {
          ids: [sent.id, sent.actionId],
          startedAt: Date.now(),
          phase: { phase: "saving" },
        },
      }));
    } catch (err) {
      if (!live.current) return;
      setPending(p => ({
        ...p,
        [key]: {
          ids: [],
          startedAt: Date.now(),
          phase: {
            phase: "error",
            message: (err as Error).message || TASK_SENTENCES.notSent,
          },
        },
      }));
    }
  };

  const fallbackUrl = `https://app.clickup.com/t/${taskId}`;
  const openInClickUp = (url: string) => (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="tk-btn tk-btn-outline"
    >
      Open in ClickUp
      <ArrowUpRight aria-hidden size={15} />
    </a>
  );

  if (!detail) {
    return (
      <TaskPanel
        open
        onClose={onClose}
        title="Task"
        footer={
          <div className="tk-foot-actions">{openInClickUp(fallbackUrl)}</div>
        }
      >
        {refused ? (
          <p className="tk-note" role="alert">
            {refused}
          </p>
        ) : (
          <p className="tk-note" aria-busy="true">
            {TASK_SENTENCES.opening}
          </p>
        )}
      </TaskPanel>
    );
  }

  const task = detail.task;
  const nowMs = Date.now();
  const due = dueWords(
    {
      dueOn: task.dueOn,
      dueAt: task.dueAt,
      dueHasTime: detail.detail?.dueHasTime ?? task.dueHasTime,
    },
    nowMs,
  );
  const tone = statusTone(task.statusType);
  const finished = tone === "done" || tone === "closed";
  const doneState = pending.done?.phase;
  const isDone = finished || doneState?.phase === "saved";
  const can = detail.can;
  const why =
    can.why && (!can.tick || !can.comment || !can.done) ? can.why : null;
  const line = [task.clientName, task.listName, due.text].filter(Boolean);
  const description = withoutMarker(
    detail.detail?.description?.trim() || task.description?.trim() || "",
  );
  const checklists = detail.detail?.checklists ?? [];
  const subtasks = detail.detail?.subtasks ?? [];
  const comments = [...(detail.detail?.comments ?? [])].sort(
    (a, b) => Date.parse(b.at) - Date.parse(a.at),
  );
  const visibleComments = allComments ? comments : comments.slice(0, 3);
  const commentPhase = pending.comment?.phase;
  const commentBusy = commentPhase?.phase === "saving";

  return (
    <TaskPanel
      open
      onClose={onClose}
      title={<bdi dir="auto">{task.title}</bdi>}
      subtitle={
        line.length ? (
          <span className="tk-focus-line">
            <span
              className={`tk-spine-inline tk-spine-${due.tone}`}
              aria-hidden
            />
            <span>
              {line.map((part, i) => (
                <span key={i}>
                  {i ? " · " : ""}
                  <bdi dir="auto">{part}</bdi>
                </span>
              ))}
            </span>
          </span>
        ) : undefined
      }
      footer={
        <div className="tk-foot-actions">
          {can.done || isDone ? (
            <span className="tk-foot-done">
              <button
                type="button"
                className={`tk-btn ${isDone ? "tk-btn-done" : "tk-btn-primary"}`}
                disabled={isDone || doneState?.phase === "saving"}
                aria-busy={doneState?.phase === "saving"}
                onClick={() =>
                  void act("done", "done", { statusSeen: task.status })
                }
              >
                {isDone ? <Check aria-hidden size={15} /> : null}
                {isDone
                  ? TASK_SENTENCES.done
                  : doneState?.phase === "saving"
                    ? TASK_SENTENCES.saving
                    : TASK_SENTENCES.markDone}
              </button>
              {doneState && doneState.phase !== "saving" && !isDone ? (
                <PhaseNote phase={doneState} />
              ) : null}
            </span>
          ) : null}
          {openInClickUp(task.url || fallbackUrl)}
        </div>
      }
    >
      <div className="tk-focus">
        <div className="tk-focus-meta">
          <span className={`tk-chip tk-chip-${tone}`}>
            <span className="tk-chip-dot" aria-hidden />
            {task.status}
          </span>
          {detail.request ? (
            <span className="tk-focus-request">
              Request from {detail.request.requesterLabel}
            </span>
          ) : null}
          {detail.sopUrl ? (
            <a
              href={detail.sopUrl}
              target="_blank"
              rel="noreferrer"
              className="tk-link"
            >
              SOP
              <ArrowUpRight aria-hidden size={14} />
            </a>
          ) : null}
        </div>

        {detail.detailNote ? (
          <p className="tk-note" role="status">
            {detail.detailNote}
          </p>
        ) : null}
        {why ? <p className="tk-note">{why}</p> : null}

        {checklists.map(list => (
          <section key={list.id} className="tk-block" aria-label={list.name}>
            <div className="tk-block-head">
              <h3 className="tk-block-title">
                <bdi dir="auto">{list.name}</bdi>
              </h3>
              <span className="tk-block-count">
                {checklistWords(list.items)}
              </span>
            </div>
            <ul className="tk-checks">
              {list.items.map(item => {
                const key = `item:${item.id}`;
                const phase = pending[key]?.phase;
                const busy = phase?.phase === "saving";
                const box = (
                  <span
                    className={`tk-box${item.resolved ? " tk-box-on" : ""}`}
                    aria-hidden
                  >
                    {item.resolved ? <Check size={13} strokeWidth={3} /> : null}
                  </span>
                );
                return (
                  <li key={item.id}>
                    {can.tick ? (
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={item.resolved}
                        aria-busy={busy}
                        className="tk-check"
                        disabled={busy}
                        onClick={() =>
                          void act(key, item.resolved ? "untick" : "tick", {
                            checklistId: list.id,
                            itemId: item.id,
                            itemName: item.name,
                            from: item.resolved,
                          })
                        }
                      >
                        {box}
                        <bdi dir="auto" className="tk-check-name">
                          {item.name}
                        </bdi>
                        <PhaseNote phase={phase} />
                      </button>
                    ) : (
                      <div className="tk-check tk-check-static">
                        {box}
                        <bdi dir="auto" className="tk-check-name">
                          {item.name}
                        </bdi>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        {subtasks.length ? (
          <section className="tk-block" aria-label="Subtasks">
            <div className="tk-block-head">
              <h3 className="tk-block-title">Subtasks</h3>
              <span className="tk-block-count">{subtasks.length}</span>
            </div>
            <ul className="tk-list tk-list-inset">
              {subtasks.map(s => (
                <li key={s.id}>
                  <Link
                    to={{ search: focusSearch(search, s.id) }}
                    className="tk-row"
                  >
                    <span
                      className={`tk-chip-dot tk-chip-${statusTone(s.statusType)}`}
                      aria-hidden
                    />
                    <bdi dir="auto" className="tk-row-title">
                      {s.name}
                    </bdi>
                    <span className="tk-row-due">{s.status}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {description ? (
          <details className="tk-details">
            <summary className="no-marker">Details</summary>
            <div className="tk-desc" dir="auto">
              {description}
            </div>
          </details>
        ) : null}

        <section className="tk-block" aria-label="Comments">
          <div className="tk-block-head">
            <h3 className="tk-block-title">Comments</h3>
            {comments.length ? (
              <span className="tk-block-count">{comments.length}</span>
            ) : null}
          </div>
          {visibleComments.length ? (
            <ul className="tk-comments">
              {visibleComments.map(c => (
                <li key={c.id} className="tk-comment">
                  <div className="tk-comment-head">
                    <span className="tk-comment-author">
                      {c.mine ? "You" : capitalFirst(c.authorLabel)}
                    </span>
                    <time className="tk-comment-at">{when(c.at)}</time>
                  </div>
                  <p className="tk-comment-text" dir="auto">
                    {withoutMarker(c.text)}
                  </p>
                </li>
              ))}
            </ul>
          ) : detail.detail ? (
            <p className="tk-note">No comments yet.</p>
          ) : null}
          {comments.length > 3 && !allComments ? (
            <button
              type="button"
              className="tk-text-btn"
              onClick={() => setAllComments(true)}
            >
              Show the other {comments.length - 3}
            </button>
          ) : null}
          {can.comment ? (
            <form
              className="tk-comment-box"
              onSubmit={e => {
                e.preventDefault();
                const text = comment.trim();
                if (!text || commentBusy) return;
                void act("comment", "comment", { text });
              }}
            >
              <label className="tk-sr" htmlFor={`tk-comment-${taskId}`}>
                Write a comment
              </label>
              <textarea
                id={`tk-comment-${taskId}`}
                className="tk-textarea"
                rows={2}
                maxLength={2000}
                dir="auto"
                placeholder="Write a comment. The team sees it in ClickUp."
                value={comment}
                disabled={commentBusy}
                onChange={e => setComment(e.target.value)}
              />
              <div className="tk-comment-actions">
                <PhaseNote phase={commentBusy ? undefined : commentPhase} />
                <button
                  type="submit"
                  className="tk-btn tk-btn-outline"
                  disabled={!comment.trim() || commentBusy}
                  aria-busy={commentBusy}
                >
                  {commentBusy ? TASK_SENTENCES.saving : "Comment"}
                </button>
              </div>
            </form>
          ) : null}
        </section>
      </div>
    </TaskPanel>
  );
}
