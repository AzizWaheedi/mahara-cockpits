import { ChevronRight, RefreshCw } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { Link } from "react-router";
import {
  chip,
  Empty,
  Page,
  PageHeader,
  Problem,
  Spinner,
  StateBadge,
  StatTile,
  StatusChip,
} from "../components/bits";
import { ReportIssue } from "../components/ReportIssue";
import { Button } from "../components/ui/button";
import { useWho } from "../lib/auth";
import { useJobs } from "../lib/data";
import { day, dueDays, minutes, moment, whenDue } from "../lib/format";
import { holder, onEditor, stageLabel } from "../lib/stages";
import type { Job } from "../lib/types";

function isMine(job: Job, email: string): boolean {
  if (!email) return false;
  const low = email.toLowerCase();
  return (job.editors ?? []).some(p => (p.email ?? "").toLowerCase() === low);
}

/** When the board was last read, from the rows themselves. */
export function syncedLine(jobs: Job[] | null): string {
  const last = (jobs ?? [])
    .map(j => j.synced_at)
    .filter((s): s is string => Boolean(s))
    .sort()
    .at(-1);
  return last
    ? `The Video Pipeline in ClickUp, synced ${moment(last)}.`
    : "The Video Pipeline in ClickUp.";
}

/**
 * Jobs in the order an editor thinks about them: what is mine to start,
 * what is stuck and on whom, what is with a reviewer, what is finished.
 * Whose turn it is comes from the ClickUp status (lib/stages.ts); the
 * desk's state only says whether the footage is read.
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
    has: j => onEditor(j) && j.state === "ready",
  },
  {
    key: "blocked",
    title: "Waiting on something",
    hint: "These need someone else first",
    has: j => onEditor(j) && (j.state === "blocked" || j.state === "stale"),
  },
  {
    key: "new",
    title: "Not read yet",
    hint: "The desk reads new footage every half hour",
    has: j => onEditor(j) && (j.state === "new" || j.state === null),
  },
  {
    key: "review",
    title: "In review",
    hint: "With the reviewer or the client until it comes back",
    has: j =>
      j.state !== "gone" &&
      (holder(j.status) === "review" ||
        (holder(j.status) === "editor" && j.state === "delivered")),
  },
  {
    key: "hold",
    title: "On hold",
    hint: "Paused on the board",
    has: j => j.state !== "gone" && holder(j.status) === "hold",
  },
  {
    key: "finished",
    title: "Finished",
    hint: "Live or cancelled on the board",
    has: j => j.state !== "gone" && holder(j.status) === "finished",
  },
  {
    key: "gone",
    title: "Off the board",
    hint: "Archived or deleted in ClickUp",
    has: j => j.state === "gone",
  },
];

function JobRow({ job, group }: { job: Job; group: string }) {
  const owed = onEditor(job);
  const due = whenDue(job.due_at);
  const blocker = owed ? job.missing?.[0] : undefined;
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
          {/* Late only means something while the job is the editor's. */}
          {owed ? (
            <span className={due.late ? "txt-bad font-medium" : ""}>
              {due.text}
              {job.due_at ? ` · ${day(job.due_at)}` : ""}
            </span>
          ) : job.due_at ? (
            <span>Due {day(job.due_at)}</span>
          ) : null}
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

        {owed && job.asked_for ? (
          <p className="mt-1.5 text-xs text-muted-foreground">
            Asked for {job.asked_for}.
          </p>
        ) : null}
      </div>

      {/* The group title already says the state. "Waiting on something"
          holds two (blocked, reading again), and a review or finished
          group holds several board statuses, so those rows say theirs. */}
      {group === "blocked" ? <StateBadge state={job.state} /> : null}
      {group === "review" || group === "finished" || group === "hold" ? (
        <StatusChip tone={group === "review" ? "accent" : "neutral"}>
          {stageLabel(job.status)}
        </StatusChip>
      ) : null}
      <ChevronRight
        aria-hidden
        className="size-4 shrink-0 text-muted-foreground"
      />
    </Link>
  );
}

export default function JobsPage({ actions }: { actions?: ReactNode } = {}) {
  const { data: jobs, error, loading, reload } = useJobs();
  const { email } = useWho();
  const [onlyMine, setOnlyMine] = useState(false);
  const [showDone, setShowDone] = useState(false);

  const shown = useMemo(() => {
    // A card taken off the board leaves its job behind, with the transcripts
    // and frames that cost money to make. Finished and removed jobs are
    // kept, and shown only on purpose.
    let all = (jobs ?? []).filter(
      j => showDone || (j.state !== "gone" && holder(j.status) !== "finished"),
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
    () => (jobs ?? []).filter(j => onEditor(j) && isMine(j, email)).length,
    [jobs, email],
  );

  // The day in four numbers. Every one counts only work that is the
  // editor's turn (lib/stages.ts), mine only when that filter is on.
  const tally = useMemo(() => {
    if (!jobs) return null;
    const owed = jobs.filter(
      j => onEditor(j) && (!onlyMine || isMine(j, email)),
    );
    return {
      ready: owed.filter(j => j.state === "ready").length,
      waiting: owed.filter(j => j.state === "blocked" || j.state === "stale")
        .length,
      late: owed.filter(j => (dueDays(j.due_at) ?? 0) < 0).length,
      today: owed.filter(j => dueDays(j.due_at) === 0).length,
      review: jobs.filter(
        j =>
          j.state !== "gone" &&
          holder(j.status) === "review" &&
          (!onlyMine || isMine(j, email)),
      ).length,
    };
  }, [jobs, onlyMine, email]);

  return (
    <Page>
      <PageHeader
        title="Jobs"
        sub={syncedLine(jobs)}
        actions={
          <>
            {actions}
            <Button variant="outline" size="sm" onClick={reload}>
              <RefreshCw aria-hidden />
              Refresh
            </Button>
            <ReportIssue />
          </>
        }
      />

      {tally ? (
        <>
          {/* One row on a phone too: four short numbers read at a glance. */}
          <div className="grid grid-cols-4 gap-2 sm:gap-4">
            <StatTile label="Ready" value={tally.ready} />
            <StatTile label="Waiting" value={tally.waiting} />
            <StatTile
              label="Late"
              value={tally.late}
              tone={tally.late ? "txt-bad" : undefined}
            />
            <StatTile label="Due today" value={tally.today} />
          </div>
          <p className="mt-2 mb-6 px-1 text-xs text-muted-foreground">
            These count jobs on you: new, planning, in progress and update
            required.
            {tally.review
              ? ` ${tally.review} more ${tally.review === 1 ? "is" : "are"} in review.`
              : ""}
          </p>
        </>
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
          Include finished and removed
        </button>
      </div>

      {error ? (
        <Problem>
          The jobs could not be read: {error}. Press Refresh to try again.
        </Problem>
      ) : null}
      {loading && !jobs ? <Spinner what="Reading the board" /> : null}
      {!loading && !error && !groups.length ? (
        <Empty>
          {onlyMine
            ? "Nothing is assigned to you right now. Turn off Assigned to me to see every job."
            : "No open jobs on the board. New cards on the Video Pipeline show here within five minutes."}
        </Empty>
      ) : null}

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
                <JobRow key={job.task_id} job={job} group={g.key} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </Page>
  );
}
