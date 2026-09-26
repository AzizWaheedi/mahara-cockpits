import { ChevronRight, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import {
  chip,
  Empty,
  Page,
  PageHeader,
  Problem,
  Spinner,
  StateBadge,
} from "../components/bits";
import { Button } from "../components/ui/button";
import { useWho } from "../lib/auth";
import { useJobs } from "../lib/data";
import { day, minutes, whenDue } from "../lib/format";
import type { Job } from "../lib/types";

const DONE = new Set(["complete", "closed", "done", "cancelled"]);

function isMine(job: Job, email: string): boolean {
  if (!email) return false;
  const low = email.toLowerCase();
  return (job.editors ?? []).some(p => (p.email ?? "").toLowerCase() === low);
}

/** Whole days from now to the due date, rounded the way `whenDue` rounds. */
function daysToDue(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.round((t - Date.now()) / 86_400_000);
}

/**
 * Jobs in the order an editor thinks about them: what can I start, what is
 * stuck and on whom, what is finished. Grouping does the work that a row of
 * filter buttons used to, so the first screen already answers the question.
 */
const GROUPS: {
  key: string;
  title: string;
  hint: string;
  has: (j: Job) => boolean;
}[] = [
  {
    key: "ready",
    title: "Ready to start",
    hint: "Footage read, nothing missing",
    has: j => j.state === "ready",
  },
  {
    key: "blocked",
    title: "Waiting on something",
    hint: "These need someone else first",
    has: j => j.state === "blocked" || j.state === "stale",
  },
  {
    key: "new",
    title: "Not read yet",
    hint: "The desk reads the board every half hour",
    has: j => j.state === "new" || j.state === null,
  },
  {
    key: "delivered",
    title: "Delivered",
    hint: "Sent for client review",
    has: j => j.state === "delivered",
  },
  {
    key: "gone",
    title: "Card deleted",
    hint: "The ClickUp card no longer exists",
    has: j => j.state === "gone",
  },
];

function JobRow({ job, badge }: { job: Job; badge: boolean }) {
  const due = whenDue(job.due_at);
  const blocker = job.missing?.[0];
  const more = (job.missing?.length ?? 0) - 1;

  return (
    <Link
      to={`/job/${job.task_id}`}
      className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-muted sm:px-5"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <span dir="auto" className="min-w-0 font-medium tracking-tight">
            {job.client ?? "No client tag"}
          </span>
          <span className="text-xs text-muted-foreground">
            {job.request_type ?? "Video"}
          </span>
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span>{job.editor ?? "Nobody assigned"}</span>
          <span className={due.late ? "txt-bad font-medium" : ""}>
            {due.text}
            {job.due_at ? ` · ${day(job.due_at)}` : ""}
          </span>
          {job.files ? (
            <span className="tabular-nums">
              {job.files} file{job.files === 1 ? "" : "s"} ·{" "}
              {minutes(job.seconds)}
            </span>
          ) : null}
        </div>

        {blocker ? (
          <p className="txt-warn mt-2 text-xs leading-relaxed">
            {blocker}
            {/* A separate clause: the blocker is a full sentence and
                "and 1 more" ran straight on after its full stop. */}
            {more > 0 ? (
              <span className="text-muted-foreground"> Plus {more} more.</span>
            ) : null}
          </p>
        ) : null}

        {job.asked_for ? (
          <p className="mt-1.5 text-xs text-muted-foreground">
            Asked for {job.asked_for}.
          </p>
        ) : null}
      </div>

      {/* The group title already says the state; only "Waiting on
          something" holds two (blocked, reading again), so only it shows. */}
      {badge ? <StateBadge state={job.state} /> : null}
      <ChevronRight
        aria-hidden
        className="size-4 shrink-0 text-muted-foreground"
      />
    </Link>
  );
}

function Stat({
  label,
  value,
  alarm = false,
}: {
  label: string;
  value: number | null;
  /** Red, for the one number that means something is wrong. */
  alarm?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-2xl border bg-card p-3 sm:p-4">
      <p className="truncate text-xs text-muted-foreground">{label}</p>
      <p
        className={`mt-1 whitespace-nowrap text-2xl font-semibold tracking-tight tabular-nums ${
          alarm && value ? "txt-bad" : ""
        }`}
      >
        {value ?? "n/a"}
      </p>
    </div>
  );
}

export default function JobsPage() {
  const { data: jobs, error, loading, reload } = useJobs();
  const { email } = useWho();
  const [onlyMine, setOnlyMine] = useState(false);
  const [showDone, setShowDone] = useState(false);

  const shown = useMemo(() => {
    // A deleted card leaves its job behind, with the transcripts and frames
    // that cost money to make. It is kept, and shown only on purpose.
    let all = (jobs ?? []).filter(
      j =>
        showDone ||
        (j.state !== "gone" && !DONE.has((j.status ?? "").toLowerCase())),
    );
    if (onlyMine) all = all.filter(j => isMine(j, email));
    return all;
  }, [jobs, onlyMine, showDone, email]);

  const groups = useMemo(
    () =>
      GROUPS.map(g => ({ ...g, jobs: shown.filter(g.has) })).filter(
        g => g.jobs.length,
      ),
    [shown],
  );

  const mineCount = useMemo(
    () => (jobs ?? []).filter(j => isMine(j, email)).length,
    [jobs, email],
  );

  // The day in four numbers, counted from the list already on screen: open
  // jobs only (closed and deleted cards never count), mine only when that
  // filter is on. Late and due today leave out what is already delivered.
  const tally = useMemo(() => {
    if (!jobs) return null;
    const open = jobs.filter(
      j =>
        j.state !== "gone" &&
        !DONE.has((j.status ?? "").toLowerCase()) &&
        (!onlyMine || isMine(j, email)),
    );
    const owed = open.filter(j => j.state !== "delivered");
    return {
      ready: open.filter(j => j.state === "ready").length,
      waiting: open.filter(j => j.state === "blocked" || j.state === "stale")
        .length,
      late: owed.filter(j => (daysToDue(j.due_at) ?? 0) < 0).length,
      today: owed.filter(j => daysToDue(j.due_at) === 0).length,
    };
  }, [jobs, onlyMine, email]);

  return (
    <Page>
      <PageHeader
        title="Jobs"
        sub="Everything on the Video Pipeline, read by the desk every half hour."
        actions={
          <Button variant="outline" size="sm" onClick={reload}>
            <RefreshCw aria-hidden />
            Refresh
          </Button>
        }
      />

      {tally ? (
        // One row on a phone too: four short numbers read at a glance.
        <div className="mb-6 grid grid-cols-4 gap-2 sm:gap-4">
          <Stat label="Ready" value={tally.ready} />
          <Stat label="Waiting" value={tally.waiting} />
          <Stat label="Late" value={tally.late} alarm />
          <Stat label="Due today" value={tally.today} />
        </div>
      ) : null}

      <div className="-mx-4 mb-6 flex flex-nowrap items-center gap-2 overflow-x-auto px-4 no-scrollbar sm:mx-0 sm:flex-wrap sm:px-0">
        <button
          type="button"
          onClick={() => setOnlyMine(m => !m)}
          aria-pressed={onlyMine}
          className={chip(onlyMine)}
        >
          Assigned to me
          {mineCount ? <span className="tabular-nums">{mineCount}</span> : null}
        </button>
        <button
          type="button"
          onClick={() => setShowDone(d => !d)}
          aria-pressed={showDone}
          className={chip(showDone)}
        >
          Include closed and deleted
        </button>
      </div>

      {error && <Problem>These jobs could not be read: {error}</Problem>}
      {loading && <Spinner what="Reading the board" />}
      {!loading && !groups.length && (
        <Empty>
          {onlyMine
            ? "Nothing is assigned to you right now."
            : "No open jobs on the board."}
        </Empty>
      )}

      <div className="space-y-6">
        {groups.map(g => (
          <section key={g.key}>
            <div className="mb-2 flex items-baseline gap-2 px-1">
              <h2 className="text-[15px] font-semibold tracking-tight">
                {g.title}
              </h2>
              <span className="text-xs tabular-nums text-muted-foreground">
                {g.jobs.length}
              </span>
              <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">
                {g.hint}
              </span>
            </div>
            <div className="divide-y overflow-hidden rounded-2xl border bg-card">
              {g.jobs.map(job => (
                <JobRow
                  key={job.task_id}
                  job={job}
                  badge={g.key === "blocked"}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </Page>
  );
}
