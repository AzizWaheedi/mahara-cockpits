import { useMemo } from "react";
import { Link } from "react-router";
import { Empty, Page, PageHeader, Problem, Spinner } from "../components/bits";
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
const ORDER = [
  "new video request",
  "in progress",
  "update required",
  "client review",
  "complete",
];
const CLOSED = new Set(["complete", "closed", "done", "cancelled"]);

/** The two dots a card can carry, said once in the header's legend. */
const DOT = {
  ready: { label: "Ready to start", tone: "var(--success)" },
  // Waiting on somebody is orange; red is kept for a date that has passed.
  stuck: { label: "Waiting on someone", tone: "var(--warning)" },
} as const;

/** "in progress" -> "In progress": the board's words, in sentence case. */
function sentence(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function Card({ job }: { job: Job }) {
  const due = whenDue(job.due_at);
  const stuck = job.state === "blocked" || job.state === "stale";
  const dot = stuck ? DOT.stuck : job.state === "ready" ? DOT.ready : null;
  return (
    <Link
      to={`/job/${job.task_id}`}
      className="block rounded-xl border bg-card p-3 transition-colors hover:border-primary/50"
    >
      <div className="flex items-start gap-2">
        <span
          dir="auto"
          className="min-w-0 flex-1 truncate text-sm font-medium"
        >
          {job.client ?? "No client tag"}
        </span>
        {/* A colour on its own says nothing to a screen reader, so the dot
            carries a role and a label as well as a tooltip. */}
        {dot ? (
          <span
            role="img"
            aria-label={dot.label}
            title={dot.label}
            className="mt-1.5 size-1.5 shrink-0 rounded-full"
            style={{ background: dot.tone }}
          />
        ) : null}
      </div>
      <p className="mt-1 truncate text-xs text-muted-foreground">
        {job.editor ?? "Nobody assigned"}
      </p>
      <p
        className={`mt-0.5 text-xs ${
          due.late ? "txt-bad font-medium" : "text-muted-foreground"
        }`}
      >
        {due.text}
        {job.due_at ? ` · ${day(job.due_at)}` : ""}
      </p>
    </Link>
  );
}

function Legend() {
  return (
    <ul className="flex flex-wrap items-center gap-2" aria-label="Legend">
      {Object.values(DOT).map(d => (
        <li
          key={d.label}
          className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium text-muted-foreground"
        >
          <span
            aria-hidden
            className="size-1.5 rounded-full"
            style={{ background: d.tone }}
          />
          {d.label}
        </li>
      ))}
    </ul>
  );
}

export default function PipelinePage() {
  const { data: jobs, error, loading } = useJobs();

  const columns = useMemo(() => {
    const all = (jobs ?? []).filter(
      j => j.state !== "gone" && !CLOSED.has((j.status ?? "").toLowerCase()),
    );
    const seen = new Map<string, Job[]>();
    for (const j of all) {
      const key = (j.status ?? "no status").toLowerCase();
      seen.set(key, [...(seen.get(key) ?? []), j]);
    }
    const known = ORDER.filter(s => seen.has(s));
    const rest = [...seen.keys()].filter(s => !ORDER.includes(s)).sort();
    return [...known, ...rest].map(key => ({ key, jobs: seen.get(key) ?? [] }));
  }, [jobs]);

  return (
    <Page wide>
      <PageHeader
        title="Pipeline"
        sub="Every open job by its status on the board."
        actions={<Legend />}
      />

      {error && <Problem>The board could not be read: {error}</Problem>}
      {loading && <Spinner what="Reading the board" />}
      {!loading && !columns.length && <Empty>No open jobs on the board.</Empty>}

      {/* The board scrolls sideways inside its own strip, edge to edge on
          a phone, never the page. */}
      <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex min-w-max gap-4">
          {columns.map(col => (
            <section key={col.key} className="w-64 shrink-0">
              <div className="mb-2 flex items-baseline gap-2 px-1">
                <h2 className="text-sm font-semibold tracking-tight">
                  {sentence(col.key)}
                </h2>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {col.jobs.length}
                </span>
              </div>
              <div className="space-y-2 rounded-2xl bg-muted/40 p-2">
                {col.jobs.map(j => (
                  <Card key={j.task_id} job={j} />
                ))}
                {!col.jobs.length ? (
                  <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                    empty
                  </p>
                ) : null}
              </div>
            </section>
          ))}
        </div>
      </div>
    </Page>
  );
}
