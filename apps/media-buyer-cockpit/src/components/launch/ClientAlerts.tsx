import { useCallback, useEffect, useMemo, useState } from "react";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import type { ExtraAlert, ExtraAlerts } from "@/components/tasks/AlertsBell";
import type { ClientNotice, ClientNotices } from "@/lib/launchModel";
import { useTaskFeed } from "@/lib/tasksClient";
// Loaded with the layout since the bell lived here; Today's launch parts
// still lean on it.
import "./launch.css";

/**
 * The media buyer's launch notices (relaunch checks, reviews, holds and the
 * media tasks of the old inbox) as the shared bell's second list
 * (CONTRACT.md 6.3). Media buyer, admin and CEO seats only, on every page of
 * the portal; everyone else gets undefined and a bell with task alerts only.
 *
 * Once the seat's own task feed is linked to its ClickUp user, the notices
 * of kind "task" are left out: the task alerts above carry them, so a task
 * shows once. The read keeps the pattern it had: on open, every 2 minutes
 * while the tab is visible, on focus, never twice within 30 seconds.
 */
export function useLaunchNotices(): ExtraAlerts | undefined {
  const { client, access } = useCockpitAuth();
  const feed = useTaskFeed();
  const enabled =
    !!client &&
    !!access &&
    (access.roles.includes("media_buyer") || access.isAdmin || access.isCeo);
  const [data, setData] = useState<ClientNotices | null>(null);
  const [failed, setFailed] = useState(false);

  // A new seat on the same client reads its own notices from scratch.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the seat's email is the trigger
  useEffect(() => {
    if (!enabled || !client) return;
    setData(null);
    setFailed(false);
    let active = true,
      busy = false,
      last = 0;
    async function read() {
      if (
        !active ||
        busy ||
        document.visibilityState === "hidden" ||
        Date.now() - last < 30000
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
          setFailed(false);
        }
      } catch {
        if (active) setFailed(true);
      } finally {
        busy = false;
      }
    }
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

  const markRead = useCallback(
    async (items: ExtraAlert[]) => {
      if (!client || !items.length) return;
      const some = items.slice(0, 200);
      const r = await client.rpc("cockpit_media_notices_seen", {
        p_notices: some.map(({ id, version }) => ({ id, version })),
      });
      if (r.error) throw new Error("Read status could not save. Try again.");
      const seen = new Set(some.map(n => `${n.id}:${n.version}`));
      setData(d =>
        d
          ? {
              ...d,
              notices: d.notices.map(n =>
                seen.has(`${n.id}:${n.version}`) ? { ...n, read: true } : n,
              ),
            }
          : d,
      );
    },
    [client],
  );

  const linked = feed.tasks?.link === "linked";
  return useMemo(() => {
    if (!enabled) return undefined;
    const notices: ClientNotice[] = (data?.notices ?? []).filter(
      n => !(linked && n.kind === "task"),
    );
    const tasksLate = !!data && !data.tasksReady && !linked;
    return {
      label: "Client alerts",
      ready: !!data && !failed && !tasksLate,
      note: failed
        ? "Client alerts could not refresh. Try again in a minute."
        : !data
          ? "Reading client alerts…"
          : tasksLate
            ? "Task updates are unavailable. Check Today or ClickUp."
            : null,
      items: notices.map(n => ({
        id: n.id,
        version: n.version,
        title: n.title,
        body: n.body,
        clientName: n.kind === "task" ? (n.clientName ?? null) : null,
        href: n.href,
        external: /^https?:\/\//.test(n.href),
        read: !!n.read,
      })),
      markRead,
    };
  }, [enabled, data, failed, linked, markRead]);
}
