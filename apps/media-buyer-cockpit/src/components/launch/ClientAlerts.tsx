import { Bell, CheckCheck, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { ClientNotice, ClientNotices } from "@/lib/launchModel";
import "./launch.css";
export function ClientAlerts() {
  const { client, access } = useCockpitAuth();
  const { pathname } = useLocation();
  const enabled =
    /^\/(clients|launch|ads|dashboard|eod|playbook|ideation|swipe)(\/|$)/.test(
      pathname,
    ) &&
    !!access &&
    (access.roles.includes("media_buyer") || access.isAdmin || access.isCeo);
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ClientNotices | null>(null),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  const refreshRef = useRef<() => void>(() => {});
  useEffect(() => {
    if (!enabled || !client) return;
    setData(null);
    setError("");
    let active = true,
      busy = false,
      last = 0;
    async function read(force = false) {
      if (
        !active ||
        busy ||
        document.visibilityState === "hidden" ||
        (!force && Date.now() - last < 30000)
      )
        return;
      busy = true;
      last = Date.now();
      try {
        const r = await client!.rpc("cockpit_media_client_notices");
        if (r.error) throw r.error;
        if (!Array.isArray(r.data?.notices))
          throw Error("Notices are unavailable");
        if (active) {
          setData(r.data);
          setError("");
        }
      } catch {
        if (active) setError("Alerts could not refresh. Try again.");
      } finally {
        busy = false;
      }
    }
    refreshRef.current = () => void read(true);
    const visible = () => void read();
    void read();
    const timer = window.setInterval(visible, 120000);
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [client, enabled, access?.email]);
  if (!enabled) return null;
  const unread = data?.notices.filter(n => !n.read) ?? [];
  async function seen(notices: ClientNotice[]) {
    if (!client || !notices.length) return;
    setSaving(true);
    try {
      const r = await client.rpc("cockpit_media_notices_seen", {
        p_notices: notices
          .slice(0, 200)
          .map(({ id, version }) => ({ id, version })),
      });
      if (r.error) throw r.error;
      const versions = new Set(
        notices.slice(0, 200).map(n => `${n.id}:${n.version}`),
      );
      setData(d =>
        d
          ? {
              ...d,
              notices: d.notices.map(n =>
                versions.has(`${n.id}:${n.version}`) ? { ...n, read: true } : n,
              ),
            }
          : d,
      );
    } catch {
      setError("Read status could not save. Try again.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="client-alert-bar">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            aria-label={`Client alerts${unread.length ? `, ${unread.length} unread` : ""}`}
          >
            <Bell size={15} />
            Alerts
            {unread.length > 0 && (
              <span className="client-alert-count" aria-live="polite">
                {unread.length}
              </span>
            )}
            {error && <span>Unavailable</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="client-alert-panel">
          <header>
            <div>
              <h2>Client alerts</h2>
              <p>Relaunch checks and media tasks.</p>
            </div>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Refresh alerts"
              onClick={() => refreshRef.current()}
            >
              <RefreshCw size={14} />
            </Button>
          </header>
          {error && <p role="alert">{error}</p>}
          {data && !data.tasksReady && (
            <p role="status">
              Task updates are unavailable. Check Today or ClickUp.
            </p>
          )}
          {data?.sourceAt && (
            <small>
              Task source checked{" "}
              {new Date(data.sourceAt).toLocaleString("en-GB", {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </small>
          )}
          {!!unread.length && (
            <Button
              variant="ghost"
              size="sm"
              disabled={saving}
              onClick={() => void seen(unread)}
            >
              <CheckCheck size={14} />
              Mark all read
            </Button>
          )}
          <div className="client-alert-list">
            {!data && !error ? (
              <p>Loading alerts…</p>
            ) : data?.notices.length ? (
              data.notices.map(n => {
                const content = (
                  <>
                    <span
                      className={`client-notice-dot ${n.read ? "read" : ""}`}
                    />
                    <div>
                      <strong>{n.title}</strong>
                      <p>{n.body}</p>
                      {n.clientName && n.kind === "task" && (
                        <small>{n.clientName}</small>
                      )}
                    </div>
                  </>
                );
                return n.href.startsWith("https://app.clickup.com/t/") ? (
                  <a
                    key={n.id}
                    href={n.href}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => {
                      setOpen(false);
                      void seen([n]);
                    }}
                  >
                    {content}
                  </a>
                ) : (
                  <Link
                    key={n.id}
                    to={n.href}
                    onClick={() => {
                      setOpen(false);
                      void seen([n]);
                    }}
                  >
                    {content}
                  </Link>
                );
              })
            ) : !error ? (
              <p>No client action or media task is waiting.</p>
            ) : null}
          </div>
          <footer>
            Checked while this cockpit is open. Source updates follow the
            existing sync.
          </footer>
        </PopoverContent>
      </Popover>
    </div>
  );
}
