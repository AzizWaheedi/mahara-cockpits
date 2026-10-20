import { type ReactNode, useMemo } from "react";
import { Link } from "react-router";
import { Empty, Page, PageHeader, Problem, Spinner } from "../components/bits";
import { useJobs } from "../lib/data";
import { day, whenDue } from "../lib/format";
import { holder, onEditor, stageLabel, stageRank } from "../lib/stages";
import type { Job } from "../lib/types";
import { syncedLine } from "./JobsPage";

/**
 * The board as the team works it, not as the desk stores it.
 *
 * Columns are ClickUp's own statuses in ClickUp's own order (lib/stages.ts),
 * so what this shows and what someone sees in ClickUp are the same thing. A
 * status nobody has used is not drawn, and a status the board adds later
 * appears at the end rather than being dropped. Live and cancelled cards
 * are finished and stay off the board.
 */

/** The two dots a card can carry, said once in the header's legend. */
const DOT = {
  ready: { label: "Ready to start", tone: "var(--success)" },
  // Waiting on somebody is orange; red is kept for a date that has passed.
  stuck: { label: "Waiting on someone", tone: "var(--warning)" },
} as const;

function Card({ job }: { job: Job }) {
  // Late only means something while the job is the editor's turn.
  const owed = onEditor(job);
  const due = whenDue(job.due_at);
  const stuck = owed && (job.state === "blocked" || job.state === "stale");
  const dot = stuck
    ? DOT.stuck
    : owed && job.state === "ready"
      ? DOT.ready
      : null;
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
          owed && due.late ? "txt-bad font-medium" : "text-muted-foreground"
        }`}
      >
        {!job.due_at
          ? "No date"
          : owed
            ? `${due.text} · ${day(job.due_at)}`
            : `Due ${day(job.due_at)}`}
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

export default function PipelinePage({
  actions,
}: {
  actions?: ReactNode;
} = {}) {
  const { data: jobs, error, loading } = useJobs();

  const columns = useMemo(() => {
    const all = (jobs ?? []).filter(
      j => j.state !== "gone" && holder(j.status) !== "finished",
    );
    const seen = new Map<string, Job[]>();
    for (const j of all) {
      const key = (j.status ?? "no status").toLowerCase();
      seen.set(key, [...(seen.get(key) ?? []), j]);
    }
    return [...seen.keys()]
      .sort((a, b) => stageRank(a) - stageRank(b) || a.localeCompare(b))
      .map(key => ({ key, jobs: seen.get(key) ?? [] }));
  }, [jobs]);

  return (
    <Page>
      <PageHeader
        title="Jobs"
        sub={syncedLine(jobs)}
        actions={
          <>
            {actions}
            <Legend />
          </>
        }
      />

      {error ? (
        <Problem>
          The board could not be read: {error}. Reload the page to try again.
        </Problem>
      ) : null}
      {loading && !jobs ? <Spinner what="Reading the board" /> : null}
      {!loading && !error && !columns.length ? (
        <Empty>
          No open jobs on the board. New cards on the Video Pipeline show here
          within five minutes.
        </Empty>
      ) : null}

      {/* The board scrolls sideways inside its own strip, edge to edge on
          a phone, never the page. */}
      <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <div className="flex min-w-max gap-4">
          {columns.map(col => (
            <section key={col.key} className="w-64 shrink-0">
              <div className="mb-2 flex items-baseline gap-2 px-1">
                <h2 className="text-[15px] font-semibold tracking-tight">
                  {stageLabel(col.key)}
                </h2>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {col.jobs.length}
                </span>
              </div>
              <div className="space-y-2 rounded-2xl bg-muted/40 p-2">
                {col.jobs.map(j => (
                  <Card key={j.task_id} job={j} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </Page>
  );
}
