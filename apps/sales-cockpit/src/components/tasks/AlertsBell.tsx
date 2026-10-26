import { Bell, CheckCheck, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useTaskSeat } from "@/lib/taskSeat";
import { focusSearch, useTaskFeed } from "@/lib/tasksClient";
import {
  type AlertRow,
  alertOpens,
  kuwaitTime,
  TASK_SENTENCES,
} from "@/lib/tasksCore";
import { TaskPanel } from "./TaskPanel";
import { LateLine, PortalLink, TaskListPanel } from "./YourTasks";
import "./tasks.css";

/**
 * The alerts bell, in every cockpit (PLAN.md D19, CONTRACT.md 6.5): what
 * changed for me in ClickUp, newest first, with an unread count. A press
 * opens the task in the focus view, or the request in Requests, and marks
 * it read. The portal passes its launch notices as `extra`, listed under
 * their own label, so the media buyer keeps one bell, not two.
 */

export type ExtraAlert = {
  id: string;
  version: string;
  title: string;
  body: string;
  clientName?: string | null;
  href: string;
  /** Opens in a new tab (a ClickUp link); otherwise an in-app page. */
  external: boolean;
  read: boolean;
  at?: string | null;
};

export type ExtraAlerts = {
  label: string;
  ready: boolean;
  note?: string | null;
  items: ExtraAlert[];
  markRead(items: ExtraAlert[]): Promise<void>;
};

export function AlertsBell({
  variant,
  extra,
}: {
  variant: "row" | "icon";
  extra?: ExtraAlerts;
}) {
  const seat = useTaskSeat();
  const feed = useTaskFeed();
  const navigate = useNavigate();
  const { search } = useLocation();
  const [open, setOpen] = useState(false);
  const [list, setList] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  if (!seat.signedIn || !seat.client) return null;

  const data = feed.alerts;
  const alerts = data?.alerts ?? [];
  const extraItems = extra?.items ?? [];
  const unreadTasks = data
    ? Math.max(data.unread, alerts.filter(a => !a.read).length)
    : 0;
  const unreadExtra = extraItems.filter(i => !i.read);
  const unread = unreadTasks + unreadExtra.length;
  const label = `Alerts, ${unread} unread`;

  const markRead = async (ids: string[], items: ExtraAlert[]) => {
    setSaveError(null);
    try {
      await Promise.all([
        ids.length ? feed.markRead(ids) : Promise.resolve(),
        items.length && extra ? extra.markRead(items) : Promise.resolve(),
      ]);
    } catch (err) {
      setSaveError((err as Error).message || TASK_SENTENCES.readNotSaved);
    }
  };

  const markAll = async () => {
    setSaving(true);
    await markRead(
      alerts.filter(a => !a.read).map(a => a.id),
      unreadExtra,
    );
    setSaving(false);
  };

  const press = (alert: AlertRow) => {
    if (!alert.read) void markRead([alert.id], []);
    setOpen(false);
    const opens = alertOpens(alert);
    if (opens === "task" && alert.taskId)
      navigate({ search: focusSearch(search, alert.taskId) });
    else if (opens === "request" && alert.requestId) {
      const path = `/requests?id=${encodeURIComponent(alert.requestId)}`;
      if (seat.inPortal) navigate(path);
      else window.location.assign(seat.portalHref(path));
    } else setList(true);
  };

  const sourceMs = data?.sourceAt ? Date.parse(data.sourceAt) : Number.NaN;
  const lateAt =
    data && !data.ready && Number.isFinite(sourceMs)
      ? kuwaitTime(sourceMs)
      : null;

  const trigger =
    variant === "row" ? (
      <div className="tk-bell-bar">
        <button
          type="button"
          className="tk-btn tk-btn-outline tk-bell-row"
          aria-label={label}
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
        >
          <Bell aria-hidden size={15} />
          Alerts
          {unread > 0 ? (
            <span className="tk-bell-count" aria-hidden>
              {unread > 99 ? "99+" : unread}
            </span>
          ) : null}
        </button>
      </div>
    ) : (
      <button
        type="button"
        className="tk-bell-icon"
        aria-label={label}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <Bell aria-hidden size={20} />
        {unread > 0 ? (
          <span className="tk-bell-badge" aria-hidden>
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </button>
    );

  return (
    <>
      {trigger}
      <TaskPanel
        open={open}
        onClose={() => setOpen(false)}
        title="Alerts"
        subtitle={unread > 0 ? `${unread} unread` : undefined}
        footer={
          <div className="tk-bell-foot">
            <span>{TASK_SENTENCES.bellChecked}</span>
            <PortalLink
              path="/requests/settings?tab=alerts"
              className="tk-link tk-link-chevron"
              onClick={() => setOpen(false)}
            >
              Alert settings
              <ChevronRight aria-hidden size={14} />
            </PortalLink>
          </div>
        }
      >
        {unread > 0 ? (
          <div className="tk-bell-tools">
            <button
              type="button"
              className="tk-btn tk-btn-ghost"
              disabled={saving}
              onClick={() => void markAll()}
            >
              <CheckCheck aria-hidden size={15} />
              {saving ? "Marking…" : "Mark all read"}
            </button>
          </div>
        ) : null}
        {saveError ? (
          <p className="tk-note tk-note-error" role="alert">
            {saveError}
          </p>
        ) : null}
        {feed.error.alerts ? (
          <div className="tk-note tk-note-error" role="alert">
            <span>{TASK_SENTENCES.bellNotRead}</span>{" "}
            <button
              type="button"
              className="tk-text-btn"
              disabled={feed.reading}
              onClick={feed.refresh}
            >
              {feed.reading ? "Trying…" : "Try again"}
            </button>
          </div>
        ) : null}
        {data?.link === "not_linked" ? (
          <p className="tk-note">
            {data.note?.trim() || TASK_SENTENCES.notLinked}
          </p>
        ) : null}
        {lateAt ? <LateLine at={lateAt} /> : null}
        {!data && !feed.error.alerts ? (
          <p className="tk-note" aria-busy="true">
            Reading your alerts…
          </p>
        ) : null}
        {alerts.length ? (
          <ul className="tk-alerts">
            {alerts.map(a => (
              <li key={a.id}>
                <button
                  type="button"
                  className="tk-alert"
                  onClick={() => press(a)}
                >
                  <span
                    className={`tk-dot${a.read ? " tk-dot-read" : ""}`}
                    aria-hidden
                  />
                  <span className="tk-alert-text">
                    <bdi dir="auto" className="tk-alert-title">
                      {a.title}
                    </bdi>
                    <span className="tk-alert-body">
                      {a.body}
                      {a.clientName ? (
                        <>
                          {" · "}
                          <bdi dir="auto">{a.clientName}</bdi>
                        </>
                      ) : null}
                    </span>
                  </span>
                  {a.read ? null : <span className="tk-sr">Unread</span>}
                </button>
              </li>
            ))}
          </ul>
        ) : data && !feed.error.alerts ? (
          <p className="tk-note">{TASK_SENTENCES.bellEmpty}</p>
        ) : null}
        {extra ? (
          <section className="tk-extra" aria-label={extra.label}>
            <h3 className="tk-extra-title">{extra.label}</h3>
            {!extra.ready && extra.note ? (
              <p className="tk-note">{extra.note}</p>
            ) : null}
            {extraItems.length ? (
              <ul className="tk-alerts">
                {extraItems.map(item => {
                  const inner = (
                    <>
                      <span
                        className={`tk-dot${item.read ? " tk-dot-read" : ""}`}
                        aria-hidden
                      />
                      <span className="tk-alert-text">
                        <bdi dir="auto" className="tk-alert-title">
                          {item.title}
                        </bdi>
                        <span className="tk-alert-body">
                          {item.body}
                          {item.clientName ? (
                            <>
                              {" · "}
                              <bdi dir="auto">{item.clientName}</bdi>
                            </>
                          ) : null}
                        </span>
                      </span>
                    </>
                  );
                  const done = () => {
                    setOpen(false);
                    if (!item.read) void markRead([], [item]);
                  };
                  return (
                    <li key={item.id}>
                      {item.external ? (
                        <a
                          href={item.href}
                          target="_blank"
                          rel="noreferrer"
                          className="tk-alert"
                          onClick={done}
                        >
                          {inner}
                        </a>
                      ) : (
                        <Link
                          to={item.href}
                          className="tk-alert"
                          onClick={done}
                        >
                          {inner}
                        </Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : extra.ready ? (
              <p className="tk-note">Nothing is waiting here.</p>
            ) : null}
          </section>
        ) : null}
      </TaskPanel>
      <TaskListPanel open={list} onClose={() => setList(false)} />
    </>
  );
}
