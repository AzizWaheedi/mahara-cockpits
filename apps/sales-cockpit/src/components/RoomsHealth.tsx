import { useEffect, useRef } from "react";
import {
  SMALL_READ_MS,
  useNow,
  useQuery,
  useSetting,
  useWorkerStatus,
} from "../lib/data";
import { healthTone, monoTimes, useLiveStatus } from "../lib/rooms";
import {
  type HostRow,
  type LineTone,
  roomJobLines,
  roomsSummary,
  seatRoomLines,
  switchesLine,
} from "../lib/roomsHealth";
import { supabase } from "../lib/supabase";
import type { Person } from "../lib/types";
import { readRoomsSetting } from "../lib/videoLink";
import { Failed, SectionCard } from "./kit";
import { Say } from "./RoomLine";
import { HealthLine } from "./RoomPanel";

/** A read's failure in words a manager can act on, without a trailing full stop. */
function readError(e: string): string {
  if (
    /failed to fetch|load failed|networkerror|network request failed/i.test(e)
  )
    return "the connection dropped. It tries again by itself";
  return e.trim().replace(/[.\s]+$/, "");
}

/**
 * Video rooms on the Team page: whether they are switched on, the health
 * line sales-api sends with live.status (the foundation's sentence), the
 * jobs behind it, and each seat's Zoom and Meet from the host check. The
 * seat's Zoom user and default room are saved by a sales-api action that
 * does not exist yet, so they are read here, not edited.
 */
export function RoomsHealthCard({ people }: { people: readonly Person[] }) {
  const setting = useSetting<unknown>("rooms");
  const rooms = readRoomsSetting(setting.data);
  const live = useLiveStatus(true);
  // The jobs' report times are the database's: read on the server's clock
  // (live.status's offset), never the laptop's (stress2 round 3).
  const now = useNow(15_000) + live.offset;
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
    { timeoutMs: SMALL_READ_MS },
  );
  const on = Boolean(rooms?.enabled);
  const health = live.data?.health ?? null;
  const liveSetting = useSetting<{ enabled?: unknown; slack?: unknown }>(
    "live",
  );
  const slackOn =
    liveSetting.data?.enabled === true && liveSetting.data?.slack === true;
  const lines = workers.data
    ? roomJobLines(workers.data, now, on, {
        slack: slackOn,
        shortLink: rooms?.short_link === true,
      })
    : [];
  // The health line is read every 4 s and the job rows every 2 minutes:
  // when the health turns, the rows are read again, so the two agree.
  const tone = health ? healthTone(health) : null;
  const lastTone = useRef(tone);
  const { reload: reloadWorkers } = workers;
  useEffect(() => {
    if (lastTone.current !== null && tone !== null && tone !== lastTone.current)
      reloadWorkers();
    lastTone.current = tone;
  }, [tone, reloadWorkers]);
  const summary = health ? roomsSummary(health, lines) : null;
  const byEmail = new Map(
    (hosts.data ?? []).map(h => [h.email.toLowerCase(), h] as const),
  );
  const seats = people.filter(p => p.active);

  return (
    <SectionCard title="Video rooms">
      {setting.error && !setting.data ? (
        <Failed
          what="The video rooms setting"
          error={readError(setting.error)}
          retry={setting.reload}
        />
      ) : (
        <p className="text-sm">
          {setting.loading && !setting.data
            ? "Reading the video rooms setting…"
            : switchesLine(rooms)}
        </p>
      )}

      {health && summary ? (
        <HealthLine
          health={health}
          tone={summary.tone}
          sentence={summary.sentence ?? undefined}
          className="mt-2"
        />
      ) : on && live.error && !live.off ? (
        <p className="muted mt-2 text-xs">
          The room health could not be read: {live.error}
        </p>
      ) : null}

      <h3 className="mt-4 text-xs font-semibold">What keeps rooms working</h3>
      {workers.error ? (
        <Failed
          what="The job reports"
          error={readError(workers.error)}
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
                <Say s={l.say} />
              </span>
            </li>
          ))}
        </ul>
      )}

      <h3 className="mt-4 text-xs font-semibold">Each seat's Zoom and Meet</h3>
      {hosts.error ? (
        <Failed
          what="The host check"
          error={readError(hosts.error)}
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
                <p className="muted mt-0.5">
                  <Say s={monoTimes(s.note)} />
                </p>
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
