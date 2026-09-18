import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Empty, Problem, Spinner, StateBadge } from "../components/bits";
import { useWho } from "../lib/auth";
import { useJobs } from "../lib/data";
import { day, minutes, whenDue } from "../lib/format";
import type { Job } from "../lib/types";

type Filter = "open" | "mine" | "ready" | "blocked" | "all";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "mine", label: "Mine" },
  { key: "ready", label: "Ready" },
  { key: "blocked", label: "Blocked" },
  { key: "all", label: "All" },
];

const DONE = new Set(["complete", "closed", "done", "cancelled"]);

function mine(job: Job, email: string): boolean {
  if (!email) return false;
  const low = email.toLowerCase();
  return (job.editors ?? []).some((p) => (p.email ?? "").toLowerCase() === low);
}

export default function JobsPage() {
  const { data: jobs, error, loading, reload } = useJobs();
  const { email } = useWho();
  const [filter, setFilter] = useState<Filter>("open");

  const shown = useMemo(() => {
    const all = jobs ?? [];
    switch (filter) {
      case "all":
        return all;
      case "mine":
        return all.filter((j) => mine(j, email));
      case "ready":
        return all.filter((j) => j.state === "ready");
      case "blocked":
        return all.filter((j) => j.state === "blocked" || j.state === "stale");
      default:
        return all.filter((j) => !DONE.has((j.status ?? "").toLowerCase()));
    }
  }, [jobs, filter, email]);

  const counts = useMemo(() => {
    const all = jobs ?? [];
    return {
      ready: all.filter((j) => j.state === "ready").length,
      blocked: all.filter((j) => j.state === "blocked").length,
      mine: all.filter((j) => mine(j, email)).length,
    };
  }, [jobs, email]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Jobs</h1>
          <p className="muted mt-0.5 text-sm">
            {counts.ready} ready to start, {counts.blocked} blocked, {counts.mine} assigned to you.
          </p>
        </div>
        <button
          type="button"
          onClick={reload}
          className="raised rounded-md border hairline px-3 py-1.5 text-xs"
        >
          Refresh
        </button>
      </header>

      <nav className="mb-4 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${
              filter === f.key ? "raised border hairline" : "muted"
            }`}
          >
            {f.label}
          </button>
        ))}
      </nav>

      {error && <Problem>These jobs could not be read: {error}</Problem>}
      {loading && <Spinner what="Reading the board" />}
      {!loading && !shown.length && (
        <Empty>Nothing here. The desk reads the board every half hour.</Empty>
      )}

      <ul className="space-y-2">
        {shown.map((job) => {
          const due = whenDue(job.due_at);
          return (
            <li key={job.task_id}>
              <Link
                to={`/job/${job.task_id}`}
                className="panel block px-4 py-3 transition-colors hover:bg-[color:var(--raised)]"
              >
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-medium">{job.client ?? "No client tag"}</span>
                  <span className="muted text-sm">{job.request_type ?? "Video"}</span>
                  <span className="ml-auto flex items-center gap-2">
                    <StateBadge state={job.state} />
                  </span>
                </div>

                <div className="muted mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                  <span>{job.editor ?? "No editor assigned"}</span>
                  <span style={due.late ? { color: "var(--color-blocked)" } : undefined}>
                    {due.text}
                    {job.due_at ? ` · ${day(job.due_at)}` : ""}
                  </span>
                  {job.files ? (
                    <span>
                      {job.files} file{job.files === 1 ? "" : "s"} · {minutes(job.seconds)}
                    </span>
                  ) : null}
                  <span>{(job.status ?? "").toLowerCase()}</span>
                </div>

                {job.missing?.length ? (
                  <p className="mt-2 text-xs" style={{ color: "var(--color-blocked)" }}>
                    {job.missing[0]}
                    {job.missing.length > 1 ? ` (+${job.missing.length - 1} more)` : ""}
                  </p>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
