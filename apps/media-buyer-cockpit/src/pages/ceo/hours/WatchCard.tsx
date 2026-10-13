import {
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  ImageOff,
  Loader2,
  OctagonAlert,
  RefreshCw,
  Settings2,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { EmptyState } from "@/components/ceo/EmptyState";
import { count, plural, time } from "@/components/ceo/format";
import { SectionCard } from "@/components/ceo/SectionCard";
import {
  STATUS_COLOR,
  StatusChip,
  StatusDot,
} from "@/components/ceo/StatusChip";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type {
  WatchAiProvider,
  WatchBoard,
  WatchIncident,
  WatchKeyResult,
  WatchKind,
  WatchPerson,
  WatchSettings,
  WatchShot,
} from "@/types/ceo/hoursWatch";
import { ShiftLegend, ShiftLine } from "./ShiftLine";
import { WatchSettingsSheet } from "./WatchSettings";
import {
  boardErrorText,
  buildLine,
  dayLabel,
  figures,
  headline,
  hubstaffReadable,
  incidentSentence,
  incidentShots,
  lineDomain,
  onShift,
  type PeopleById,
  problems,
  recentSentence,
  rowFix,
  slackLine,
  stateChip,
  type WatchProblem,
} from "./watchCopy";

/**
 * Hubstaff watch (the CEO, 2026-10-13: "a really easy way to be alerted"):
 * who is working right now, who is not, and the proof. The card, without its
 * reads: HubstaffWatch.tsx passes the board and the actions in, so the
 * tests render it as it ships. Spec: docs/hours-watch/SPEC.md, "Screen".
 */

export type WatchActions = {
  onCheckNow: () => void;
  onSetAlerts: (on: boolean) => void;
  onSet: (patch: Partial<WatchSettings>) => Promise<void>;
  onKey: (a: {
    provider: WatchAiProvider;
    key: string;
  }) => Promise<WatchKeyResult>;
  onReview: (incidentId: number) => void;
  onGoTeam: () => void;
  /** A 10-minute link to a stored screenshot. */
  sign: (path: string) => Promise<string>;
};

export type WatchBusy = {
  checking: boolean;
  switching: boolean;
  reviewing: Set<number>;
  /** The last action's outcome, in one sentence. */
  said: { ok: boolean; text: string } | null;
};

const IDLE_BUSY: WatchBusy = {
  checking: false,
  switching: false,
  reviewing: new Set(),
  said: null,
};

const KIND_ICON: Record<WatchKind, typeof TriangleAlert> = {
  not_tracking: TriangleAlert,
  idle: TriangleAlert,
  not_work: OctagonAlert,
  source: CircleAlert,
};
const KIND_COLOR: Record<WatchKind, string> = {
  not_tracking: STATUS_COLOR.warning,
  idle: STATUS_COLOR.warning,
  not_work: STATUS_COLOR.critical,
  source: STATUS_COLOR.critical,
};
const PROBLEM_ICON = {
  good: CircleCheck,
  warning: TriangleAlert,
  serious: CircleAlert,
  critical: OctagonAlert,
  neutral: CircleDashed,
} as const;

/** The large view: one screenshot, or an alert's screenshots with the one to show first. */
type Viewing = { shots: WatchShot[]; index: number; name: string };
type OnView = (shots: WatchShot[], first: WatchShot, name: string) => void;

export function WatchCard({
  board,
  error,
  now,
  busy = IDLE_BUSY,
  actions,
  order = 0,
}: {
  board: WatchBoard | null;
  error: string | null;
  now: number;
  busy?: WatchBusy;
  actions: WatchActions;
  order?: number;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [viewing, setViewing] = useState<Viewing | null>(null);

  const header = board ? (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={actions.onCheckNow}
        disabled={busy.checking}
      >
        <RefreshCw
          className={busy.checking ? "ceo-spin animate-spin" : undefined}
          aria-hidden
        />
        Check now
      </Button>
      <span className="inline-flex items-center gap-2 text-xs">
        <Switch
          id="hw-alerts-switch"
          checked={board.settings.on}
          disabled={busy.switching}
          onCheckedChange={actions.onSetAlerts}
          aria-label="Slack alerts"
        />
        <label htmlFor="hw-alerts-switch" className="cursor-pointer">
          Slack alerts
        </label>
      </span>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => setSettingsOpen(true)}
      >
        <Settings2 aria-hidden />
        Settings
      </Button>
    </>
  ) : null;

  return (
    <SectionCard
      id="hubstaff-watch"
      title="Hubstaff watch"
      order={order}
      description={
        board ? (
          <span className="text-sm text-foreground">
            {headline(board, now)}
          </span>
        ) : undefined
      }
      actions={header}
    >
      {board ? (
        <Body
          board={board}
          now={now}
          busy={busy}
          actions={actions}
          onView={(shots, first, name) =>
            setViewing({
              shots: shots.length ? shots : [first],
              index: Math.max(
                0,
                shots.findIndex(s => s.id === first.id),
              ),
              name,
            })
          }
        />
      ) : error ? (
        <EmptyState
          icon={CircleAlert}
          title="Hubstaff watch is not showing"
          text={boardErrorText(error)}
          compact
        />
      ) : (
        <p
          role="status"
          className="flex items-center gap-2 text-sm text-muted-foreground"
        >
          <Loader2 className="ceo-spin size-4 animate-spin" aria-hidden />
          Reading Hubstaff watch
        </p>
      )}
      {board ? (
        <WatchSettingsSheet
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          board={board}
          onSet={actions.onSet}
          onKey={actions.onKey}
          onGoTeam={() => {
            setSettingsOpen(false);
            actions.onGoTeam();
          }}
        />
      ) : null}
      <ShotDialog
        viewing={viewing}
        onPick={index => setViewing(v => (v ? { ...v, index } : v))}
        onClose={() => setViewing(null)}
        sign={actions.sign}
      />
    </SectionCard>
  );
}

function Body({
  board,
  now,
  busy,
  actions,
  onView,
}: {
  board: WatchBoard;
  now: number;
  busy: WatchBusy;
  actions: WatchActions;
  onView: OnView;
}) {
  const people: PeopleById = useMemo(
    () => new Map(board.people.map(p => [p.personId, p])),
    [board.people],
  );
  const issues = problems(board, now);
  const known = hubstaffReadable(board);
  const domain = useMemo(
    () => lineDomain(board.people, now),
    [board.people, now],
  );
  // On shift first, then the rest, in the server's order.
  const rows = [...board.people].sort(
    (a, z) => Number(onShift(z)) - Number(onShift(a)),
  );
  return (
    <div className="grid gap-6">
      {busy.said ? (
        <p
          aria-live="polite"
          className={cn(
            "text-sm",
            busy.said.ok
              ? "text-muted-foreground"
              : "text-[var(--ceo-critical)]",
          )}
        >
          {busy.said.text}
        </p>
      ) : null}

      {issues.length ? (
        <Problems issues={issues} onGoTeam={actions.onGoTeam} />
      ) : null}

      {rows.length ? (
        <div className="grid gap-3">
          <ul className="-mx-2 divide-y">
            {rows.map(p => (
              <PersonRow
                key={p.personId}
                p={p}
                now={now}
                line={buildLine(
                  p,
                  domain,
                  now,
                  board.settings.graceMinutes,
                  known && p.state !== "cant_tell",
                )}
                alertShots={alertShotsOf(board, p)}
                onView={(shots, first) => onView(shots, first, p.name)}
                onGoTeam={actions.onGoTeam}
              />
            ))}
          </ul>
          <ShiftLegend />
        </div>
      ) : (
        <EmptyState
          icon={CircleDashed}
          title="Nobody is watched yet"
          text="Hubstaff watch looks at everyone who must track time: call centre agents and the media buyer by default. Set who tracks in Team & payroll."
          action={
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={actions.onGoTeam}
            >
              Open Team & payroll
              <ChevronRight aria-hidden />
            </Button>
          }
          compact
        />
      )}

      <OpenAlerts
        board={board}
        people={people}
        busy={busy}
        onReview={actions.onReview}
        sign={actions.sign}
        onView={onView}
      />

      <Recent board={board} people={people} now={now} />

      <p className="text-xs text-muted-foreground">
        {[
          board.lastRun
            ? `Last check ${time(Date.parse(board.lastRun.at))}`
            : "No check yet",
          board.cronOn ? "every 5 minutes on shift" : "not scheduled",
          board.settings.on
            ? `alerts to #${board.settings.channelName || board.settings.channel}`
            : "Slack alerts off, recorded here only",
        ].join(" · ")}
      </p>
    </div>
  );
}

/** The screenshots behind the person's open not-work alert, newest first. */
function alertShotsOf(board: WatchBoard, p: WatchPerson): WatchShot[] {
  const alert = board.open.find(
    i => i.kind === "not_work" && i.personId === p.personId,
  );
  return alert ? incidentShots(alert, p, board.settings.windowMinutes) : [];
}

/** The watch's own problems. Settings is the header's one button; Team & payroll is elsewhere. */
function Problems({
  issues,
  onGoTeam,
}: {
  issues: WatchProblem[];
  onGoTeam: () => void;
}) {
  return (
    <ul role="status" className="grid gap-2 rounded-xl bg-muted/40 p-3 sm:p-4">
      {issues.map(i => {
        const Icon = PROBLEM_ICON[i.tone];
        return (
          <li
            key={i.key}
            className="flex flex-wrap items-start gap-x-3 gap-y-1 text-sm"
          >
            <Icon
              className="mt-0.5 size-4 shrink-0"
              style={{ color: STATUS_COLOR[i.tone] }}
              aria-hidden
            />
            <span className="min-w-0 flex-1 basis-56">{i.text}</span>
            {i.action === "team" ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={onGoTeam}
              >
                Team & payroll
                <ChevronRight aria-hidden />
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function PersonRow({
  p,
  now,
  line,
  alertShots,
  onView,
  onGoTeam,
}: {
  p: WatchPerson;
  now: number;
  line: ReturnType<typeof buildLine>;
  alertShots: WatchShot[];
  onView: (shots: WatchShot[], first: WatchShot) => void;
  onGoTeam: () => void;
}) {
  const chip = stateChip(p, now);
  const fix = rowFix(p);
  const f = figures(p);
  const live = onShift(p);
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 px-2 py-3 @3xl:grid-cols-[minmax(9rem,12rem)_minmax(0,1fr)_7.5rem] @3xl:items-center">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{p.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {p.role ?? "No role"}
        </p>
        <StatusChip className="mt-1.5" tone={chip.tone} label={chip.label} />
        {fix ? (
          // A real link to Team & payroll; a plain click stays in the page.
          <a
            href="?tab=team"
            onClick={e => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0)
                return;
              e.preventDefault();
              onGoTeam();
            }}
            className="mt-1.5 flex w-fit items-center gap-0.5 rounded-sm text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {fix.text}
            <ChevronRight className="size-3.5" aria-hidden />
          </a>
        ) : null}
      </div>
      <div className="text-right text-xs text-muted-foreground tabular-nums @3xl:col-start-3 @3xl:row-start-1">
        <p className="whitespace-nowrap">
          <span className="text-sm text-foreground">{f.tracked}</span> today
        </p>
        {live ? (
          <p className="whitespace-nowrap">{f.active} activity, 30 min</p>
        ) : null}
      </div>
      <ShiftLine
        className="col-span-2 @3xl:col-span-1 @3xl:col-start-2 @3xl:row-start-1"
        line={line}
        name={p.name}
        live={live && p.state !== "cant_tell"}
        onOpenShot={shot =>
          onView(
            alertShots.some(s => s.id === shot.id) ? alertShots : [shot],
            shot,
          )
        }
        onOpenGroup={shots => {
          // Ticks too close to tap apart open the alert they belong to.
          const newest = [...shots].sort(
            (a, z) => Date.parse(z.at) - Date.parse(a.at),
          );
          const inAlert = shots.some(s => alertShots.some(a => a.id === s.id));
          onView(inAlert ? alertShots : newest, newest[0]);
        }}
      />
    </li>
  );
}

function OpenAlerts({
  board,
  people,
  busy,
  onReview,
  sign,
  onView,
}: {
  board: WatchBoard;
  people: PeopleById;
  busy: WatchBusy;
  onReview: (id: number) => void;
  sign: (path: string) => Promise<string>;
  onView: OnView;
}) {
  const byId = new Map(board.people.map(p => [p.personId, p]));
  return (
    <section aria-labelledby="hw-open" className="grid gap-2">
      <h3 id="hw-open" className="text-sm font-medium">
        Open alerts
        {board.open.length ? (
          <span className="ml-2 font-normal text-muted-foreground">
            {count(board.open.length)}
          </span>
        ) : null}
      </h3>
      {board.open.length ? (
        <ul className="-mx-2 divide-y">
          {board.open.map(i => (
            <AlertRow
              key={i.id}
              i={i}
              person={i.personId === null ? undefined : byId.get(i.personId)}
              people={people}
              settings={board.settings}
              reviewing={busy.reviewing.has(i.id)}
              onReview={() => onReview(i.id)}
              sign={sign}
              onView={onView}
            />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No open alerts.</p>
      )}
    </section>
  );
}

function AlertRow({
  i,
  person,
  people,
  settings,
  reviewing,
  onReview,
  sign,
  onView,
}: {
  i: WatchIncident;
  person: WatchPerson | undefined;
  people: PeopleById;
  settings: WatchSettings;
  reviewing: boolean;
  onReview: () => void;
  sign: (path: string) => Promise<string>;
  onView: OnView;
}) {
  const Icon = KIND_ICON[i.kind];
  const shots = incidentShots(i, person, settings.windowMinutes);
  const slack = slackLine(i.slackState, i.slackError, settings);
  return (
    <li className="grid gap-2 px-2 py-3">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <Icon
          className="mt-0.5 size-4 shrink-0"
          style={{ color: KIND_COLOR[i.kind] }}
          aria-hidden
        />
        <div className="min-w-0 flex-1 basis-56">
          <p className="text-sm">{incidentSentence(i, people, shots)}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="tabular-nums">
              Opened {time(Date.parse(i.openedAt))}
            </span>
            <span aria-hidden>·</span>
            <span className="inline-flex items-center gap-1.5">
              <StatusDot tone={slack.tone} label={i.slackState} />
              {slack.text}
            </span>
          </p>
        </div>
        {i.reviewedAt ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <CircleCheck
              className="size-3.5"
              style={{ color: STATUS_COLOR.good }}
              aria-hidden
            />
            Reviewed {time(Date.parse(i.reviewedAt))}
          </span>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onReview}
            disabled={reviewing}
          >
            {reviewing ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : null}
            Mark reviewed
          </Button>
        )}
      </div>
      {shots.length ? (
        <ul
          aria-label="Screenshots behind this alert"
          className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 sm:ml-7"
        >
          {shots.map(s => (
            <li key={s.id} className="shrink-0">
              <ShotThumb
                shot={s}
                name={i.name ?? person?.name ?? "Someone"}
                sign={sign}
                onOpen={() =>
                  onView(shots, s, i.name ?? person?.name ?? "Someone")
                }
              />
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** One screenshot in a strip: signed only when it scrolls into view. */
function ShotThumb({
  shot,
  name,
  sign,
  onOpen,
}: {
  shot: WatchShot;
  name: string;
  sign: (path: string) => Promise<string>;
  onOpen: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const path = shot.thumbPath;
    const el = ref.current;
    if (!path || !el) return;
    let alive = true;
    const load = () =>
      sign(path)
        .then(u => alive && setUrl(u))
        .catch(() => alive && setFailed(true));
    if (typeof IntersectionObserver === "undefined") {
      void load();
      return () => {
        alive = false;
      };
    }
    const seen = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) {
        seen.disconnect();
        void load();
      }
    });
    seen.observe(el);
    return () => {
      alive = false;
      seen.disconnect();
    };
  }, [shot.thumbPath, sign]);
  const at = time(Date.parse(shot.at));
  return (
    <button
      ref={ref}
      type="button"
      onClick={onOpen}
      className="group grid w-36 gap-1 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`Open ${name}'s screenshot from ${at}${shot.label ? `: ${shot.label}` : ""}`}
    >
      <span className="relative block aspect-video overflow-hidden rounded-md border bg-muted">
        {url && !failed ? (
          <img
            src={url}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover transition-opacity group-hover:opacity-90"
            onError={() => setFailed(true)}
          />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-muted-foreground">
            {failed || !shot.thumbPath ? (
              <ImageOff className="size-4" aria-hidden />
            ) : null}
          </span>
        )}
      </span>
      <span className="truncate text-[11px] text-muted-foreground">
        <span className="font-mono tabular-nums">{at}</span>
        {shot.label ? ` · ${shot.label}` : ""}
      </span>
    </button>
  );
}

/** The large view: the full image when the server keeps its path, else the thumbnail. */
function ShotDialog({
  viewing,
  onPick,
  onClose,
  sign,
}: {
  viewing: Viewing | null;
  onPick: (index: number) => void;
  onClose: () => void;
  sign: (path: string) => Promise<string>;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const shot = viewing?.shots[viewing.index] ?? viewing?.shots[0] ?? null;
  const path = shot?.fullPath ?? shot?.thumbPath ?? null;
  useEffect(() => {
    setUrl(null);
    setFailed(null);
    if (!path) return;
    let alive = true;
    sign(path)
      .then(u => alive && setUrl(u))
      .catch(
        e =>
          alive &&
          setFailed(
            e instanceof Error
              ? e.message
              : "The screenshot could not be opened.",
          ),
      );
    return () => {
      alive = false;
    };
  }, [path, sign]);
  const at = shot ? time(Date.parse(shot.at)) : "";
  const sure =
    shot?.confidence !== null && shot?.confidence !== undefined
      ? `, ${Math.round(shot.confidence * 100)}% sure`
      : "";
  const verdict =
    shot?.verdict === "not_work"
      ? "Not work"
      : shot?.verdict === "unclear"
        ? "Unclear"
        : "Screenshot";
  return (
    <Dialog open={viewing !== null} onOpenChange={o => (o ? null : onClose())}>
      <DialogContent className="ceo-root max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader className="pr-8 text-left">
          <DialogTitle>
            {viewing ? `${viewing.name}, ${at}` : "Screenshot"}
          </DialogTitle>
          <DialogDescription>
            {`${verdict}${sure}${shot?.label ? `: ${shot.label}` : ""}.`}
          </DialogDescription>
        </DialogHeader>
        <div className="relative aspect-video overflow-hidden rounded-lg border bg-muted">
          {url ? (
            <img
              src={url}
              alt={`${viewing?.name ?? "Someone"}'s screen at ${at}${shot?.label ? `: ${shot.label}` : ""}`}
              referrerPolicy="no-referrer"
              className="h-full w-full object-contain"
              onError={() =>
                setFailed(
                  "The link ran out. Close this and open the screenshot again.",
                )
              }
            />
          ) : (
            <p
              role="status"
              className="absolute inset-0 flex items-center justify-center gap-2 p-4 text-center text-sm text-muted-foreground"
            >
              {failed ? (
                <>
                  <ImageOff className="size-4 shrink-0" aria-hidden />
                  {failed}
                </>
              ) : path ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Opening the screenshot
                </>
              ) : (
                "This screenshot was not kept. Only screenshots judged not work are stored."
              )}
            </p>
          )}
        </div>
        {viewing && viewing.shots.length > 1 ? (
          <ul
            aria-label="The alert's screenshots"
            className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1"
          >
            {viewing.shots.map((s, n) => (
              <li key={s.id} className="shrink-0">
                <Button
                  type="button"
                  size="sm"
                  variant={n === viewing.index ? "secondary" : "ghost"}
                  aria-pressed={n === viewing.index}
                  onClick={() => onPick(n)}
                  className="font-mono tabular-nums"
                >
                  {time(Date.parse(s.at))}
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Kept 90 days, visible only to you. The link lasts 10 minutes.
        </p>
      </DialogContent>
    </Dialog>
  );
}

function Recent({
  board,
  people,
  now,
}: {
  board: WatchBoard;
  people: PeopleById;
  now: number;
}) {
  const [all, setAll] = useState(false);
  const rows = all ? board.recent : board.recent.slice(0, 5);
  const rest = board.recent.length - 5;
  return (
    <section aria-labelledby="hw-recent" className="grid gap-2">
      <h3 id="hw-recent" className="text-sm font-medium">
        Last 7 days
      </h3>
      {board.recent.length ? (
        <>
          <ul className="grid gap-1.5">
            {rows.map(r => (
              <li
                key={r.id}
                className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 text-xs text-muted-foreground"
              >
                <span className="font-mono tabular-nums">
                  {dayLabel(r.openedAt, now)}
                </span>
                <span className="min-w-0">
                  {recentSentence(r, people)}
                  {r.reviewedAt ? " Reviewed." : ""}
                </span>
              </li>
            ))}
          </ul>
          {rest > 0 ? (
            <button
              type="button"
              onClick={() => setAll(v => !v)}
              aria-expanded={all}
              className="justify-self-start rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {all ? "Show fewer" : `Show the other ${count(rest)}`}
            </button>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          {`Nothing in the last 7 days${board.people.length ? `: ${plural(board.people.length, "person", "people")} watched` : ""}.`}
        </p>
      )}
    </section>
  );
}
