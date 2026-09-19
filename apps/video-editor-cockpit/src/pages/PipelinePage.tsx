import { useMemo } from "react";
import { Link } from "react-router";
import { Empty, Problem, Spinner } from "../components/bits";
import { useJobs } from "../lib/data";
import { day, whenDue } from "../lib/format";
import type { Job } from "../lib/types";

/**
 * The board as the team works it, not as the desk stores it.
 *
 * Columns are ClickUp's own statuses in the order work moves through them, so
 * what this shows and what someone sees in ClickUp are the same thing. A
 * status nobody has used is not drawn, and a status the board invents later
 * appears at the end rather than being dropped.
 */
const ORDER = ["new video request", "in progress", "update required", "client review", "complete"];
const CLOSED = new Set(["complete", "closed", "done", "cancelled"]);

function Card({ job }: { job: Job }) {
  const due = whenDue(job.due_at);
  const stuck = job.state === "blocked" || job.state === "stale";
  return (
    <Link
      to={`/job/${job.task_id}`}
      className="block rounded-[var(--radius-md)] border hairline bg-[color:var(--card)] px-3 py-2.5 transition-colors hover:bg-[color:var(--secondary)]"
    >
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {job.client ?? "No client tag"}
        </span>
        {/* A colour on its own says nothing to a screen reader, so the dot
            carries a role and a label as well as a tooltip. */}
        {stuck || job.state === "ready" ? (
          <span
            role="img"
            aria-label={stuck ? "blocked" : "ready to start"}
            title={stuck ? "blocked" : "ready to start"}
            className="mt-1.5 size-1.5 shrink-0 rounded-full"
            style={{ background: stuck ? "var(--destructive)" : "var(--success)" }}
          />
        ) : null}
      </div>
      <p className="muted mt-1 truncate text-[11px]">{job.editor ?? "nobody assigned"}</p>
      <p
        className="mt-0.5 text-[11px]"
        style={due.late ? { color: "var(--destructive)" } : { color: "var(--muted-foreground)" }}
      >
        {due.text}
        {job.due_at ? ` · ${day(job.due_at)}` : ""}
      </p>
    </Link>
  );
}

export default function PipelinePage() {
  const { data: jobs, error, loading } = useJobs();

  const columns = useMemo(() => {
    const all = (jobs ?? []).filter((j) => !CLOSED.has((j.status ?? "").toLowerCase()));
    const seen = new Map<string, Job[]>();
    for (const j of all) {
      const key = (j.status ?? "no status").toLowerCase();
      seen.set(key, [...(seen.get(key) ?? []), j]);
    }
    const known = ORDER.filter((s) => seen.has(s));
    const rest = [...seen.keys()].filter((s) => !ORDER.includes(s)).sort();
    return [...known, ...rest].map((key) => ({ key, jobs: seen.get(key) ?? [] }));
  }, [jobs]);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Pipeline</h1>
        <p className="muted mt-1 text-sm">
          Every open job by its status on the board. A green dot is ready to start, a red one is
          waiting on somebody.
        </p>
      </header>

      {error && <Problem>The board could not be read: {error}</Problem>}
      {loading && <Spinner what="Reading the board" />}
      {!loading && !columns.length && <Empty>No open jobs on the board.</Empty>}

      <div className="-mx-4 overflow-x-auto px-4 pb-2">
        <div className="flex min-w-max gap-3">
          {columns.map((col) => (
            <section key={col.key} className="w-60 shrink-0">
              <div className="mb-2 flex items-baseline gap-2 px-1">
                <h2 className="text-xs font-semibold tracking-wide uppercase">{col.key}</h2>
                <span className="muted tabular-nums text-xs">{col.jobs.length}</span>
              </div>
              <div className="raised space-y-2 rounded-[calc(var(--radius)+0.25rem)] p-2">
                {col.jobs.map((j) => (
                  <Card key={j.task_id} job={j} />
                ))}
                {!col.jobs.length ? (
                  <p className="muted px-2 py-4 text-center text-xs">empty</p>
                ) : null}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
