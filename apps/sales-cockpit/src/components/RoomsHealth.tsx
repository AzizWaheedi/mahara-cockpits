import { useNow, useQuery, useSetting, useWorkerStatus } from "../lib/data";
import { useLiveStatus } from "../lib/rooms";
import {
  type HostRow,
  type LineTone,
  roomJobLines,
  seatRoomLines,
  switchesLine,
} from "../lib/roomsHealth";
import { supabase } from "../lib/supabase";
import type { Person } from "../lib/types";
import { readRoomsSetting } from "../lib/videoLink";
import { Failed, SectionCard } from "./kit";
import { HealthLine } from "./RoomPanel";

/**
 * Video rooms on the Team page: whether they are switched on, the health
 * line sales-api sends with live.status (the foundation's sentence), the
 * jobs behind it, and each seat's Zoom and Meet from the host check. The
 * seat's Zoom user and default room are saved by a sales-api action that
 * does not exist yet, so they are read here, not edited.
 */
export function RoomsHealthCard({ people }: { people: readonly Person[] }) {
  const now = useNow(15_000);
  const setting = useSetting<unknown>("rooms");
  const rooms = readRoomsSetting(setting.data);
  const live = useLiveStatus(true);
  const workers = useWorkerStatus();
  const hosts = useQuery<HostRow[]>(
    () =>
      supabase
        .from("cockpit_sales_room_hosts")
        .select(
          "email,zoom_status,zoom_live_until,google_ok,default_provider,checked_at",
        ),
    [],
    60_000,
  );
  const on = Boolean(rooms?.enabled);
  const health = live.data?.health ?? null;
  const lines = workers.data ? roomJobLines(workers.data, now, on) : [];
  const byEmail = new Map(
    (hosts.data ?? []).map(h => [h.email.toLowerCase(), h] as const),
  );
  const seats = people.filter(p => p.active);

  return (
    <SectionCard title="Video rooms">
      <p className="text-sm">
        {setting.error
          ? `The video rooms setting could not be read: ${setting.error}.`
          : setting.loading && !setting.data
            ? "Reading the video rooms setting…"
            : switchesLine(rooms)}
      </p>

      {health ? (
        <HealthLine health={health} className="mt-2" />
      ) : on && live.error && !live.off ? (
        <p className="muted mt-2 text-xs">
          The room health could not be read: {live.error}
        </p>
      ) : null}

      <h3 className="mt-4 text-xs font-semibold">What keeps rooms working</h3>
      {workers.error ? (
        <Failed
          what="The job reports"
          error={workers.error}
          retry={workers.reload}
        />
      ) : !workers.data ? (
        <p className="muted mt-1 text-xs">Loading…</p>
      ) : (
        <ul className="mt-1.5 space-y-1">
          {lines.map(l => (
            <li key={l.key} className="flex items-start gap-2 text-xs">
              <Dot tone={l.tone} />
              <span className={`min-w-0 ${l.tone === "quiet" ? "muted" : ""}`}>
                {l.text}
              </span>
            </li>
          ))}
        </ul>
      )}

      <h3 className="mt-4 text-xs font-semibold">Each seat's Zoom and Meet</h3>
      {hosts.error ? (
        <Failed
          what="The host check"
          error={hosts.error}
          retry={hosts.reload}
        />
      ) : !hosts.data ? (
        <p className="muted mt-1 text-xs">Loading…</p>
      ) : !seats.length ? (
        <p className="muted mt-1 text-xs">No active seats.</p>
      ) : (
        <ul className="mt-1.5 divide-y hairline">
          {seats.map(p => {
            const s = seatRoomLines(
              byEmail.get(String(p.email).toLowerCase()),
              now,
            );
            return (
              <li key={p.email} className="py-2 text-xs">
                <p className="truncate text-sm font-medium">
                  {p.name ?? p.email}
                </p>
                <p className="mt-0.5 flex items-start gap-2">
                  <Dot tone={s.zoom.tone} />
                  <span>
                    {s.zoom.text}. {s.meet}.
                  </span>
                </p>
                <p className="muted mt-0.5">{s.note}</p>
              </li>
            );
          })}
        </ul>
      )}
      <p className="muted mt-3 text-xs">
        From the room worker's host check every 10 minutes, and the status rows
        each job writes. A job that has not reported shows as not run, never as
        working.
      </p>
    </SectionCard>
  );
}

function Dot({ tone }: { tone: LineTone }) {
  return (
    <span
      aria-hidden
      className="mt-1 size-2 shrink-0 rounded-full"
      style={{
        background:
          tone === "bad"
            ? "var(--destructive)"
            : tone === "owed"
              ? "var(--owed)"
              : tone === "good"
                ? "var(--won)"
                : "var(--muted-foreground)",
        opacity: tone === "quiet" ? 0.5 : 1,
      }}
    />
  );
}
