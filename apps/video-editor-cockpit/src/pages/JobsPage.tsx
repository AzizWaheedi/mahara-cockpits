import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Empty, Problem, Spinner, StateBadge } from "../components/bits";
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
    hint: "footage read, nothing missing",
    has: j => j.state === "ready",
  },
  {
    key: "blocked",
    title: "Waiting on something",
    hint: "these need someone else first",
    has: j => j.state === "blocked" || j.state === "stale",
  },
  {
    key: "new",
    title: "Not read yet",
    hint: "the desk reads the board every half hour",
    has: j => j.state === "new" || j.state === null,
  },
  {
    key: "delivered",
    title: "Delivered",
    hint: "sent for client review",
    has: j => j.state === "delivered",
  },
  {
    key: "gone",
    title: "Card deleted",
    hint: "the ClickUp card no longer exists",
    has: j => j.state === "gone",
  },
];

function JobRow({ job }: { job: Job }) {
  const due = whenDue(job.due_at);
  const blocker = job.missing?.[0];
  const more = (job.missing?.length ?? 0) - 1;

  return (
    <Link
      to={`/job/${job.task_id}`}
      className="group block border-b hairline px-4 py-3.5 transition-colors last:border-b-0 hover:bg-[color:var(--secondary)]"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <span className="font-medium tracking-tight">
              {job.client ?? "No client tag"}
            </span>
            <span className="muted text-xs">{job.request_type ?? "Video"}</span>
          </div>

          <div className="muted mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
            <span>{job.editor ?? "nobody assigned"}</span>
            <span
              className={due.late ? "font-medium" : ""}
              style={due.late ? { color: "var(--destructive)" } : undefined}
            >
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
            <p
              className="mt-2 text-xs leading-relaxed"
              style={{ color: "var(--destructive)" }}
            >
              {blocker}
              {/* A separate clause: the blocker is a full sentence and
                  "and 1 more" ran straight on after its full stop. */}
              {more > 0 ? (
                <span className="muted"> Plus {more} more.</span>
              ) : null}
            </p>
          ) : null}

          {job.asked_for ? (
            <p className="muted mt-1.5 text-xs">Asked for {job.asked_for}.</p>
          ) : null}
        </div>

        <StateBadge state={job.state} />
      </div>
    </Link>
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

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Jobs</h1>
        <p className="muted mt-1 text-sm">
          Everything on the Video Pipeline, read by the desk every half hour.
        </p>
      </header>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOnlyMine(m => !m)}
          aria-pressed={onlyMine}
          className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
            onlyMine
              ? "bg-[color:var(--primary)] text-[color:var(--primary-foreground)]"
              : "raised muted"
          }`}
        >
          Assigned to me{mineCount ? ` (${mineCount})` : ""}
        </button>
        <button
          type="button"
          onClick={() => setShowDone(d => !d)}
          aria-pressed={showDone}
          className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
            showDone
              ? "bg-[color:var(--primary)] text-[color:var(--primary-foreground)]"
              : "raised muted"
          }`}
        >
          Include closed and deleted
        </button>
        <button
          type="button"
          onClick={reload}
          className="muted ml-auto text-xs"
        >
          Refresh
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

      <div className="space-y-7">
        {groups.map(g => (
          <section key={g.key}>
            <div className="mb-2 flex items-baseline gap-2 px-1">
              <h2 className="text-sm font-semibold tracking-tight">
                {g.title}
              </h2>
              <span className="muted tabular-nums text-xs">
                {g.jobs.length}
              </span>
              <span className="muted ml-auto hidden text-xs sm:inline">
                {g.hint}
              </span>
            </div>
            <div className="panel overflow-hidden">
              {g.jobs.map(job => (
                <JobRow key={job.task_id} job={job} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
