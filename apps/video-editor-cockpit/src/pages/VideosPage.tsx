import { ChevronDown, ChevronRight } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { Link } from "react-router";
import {
  chip,
  Empty,
  Page,
  PageHeader,
  Problem,
  Spinner,
} from "../components/bits";
import { AnimatedSelect } from "../components/ui/animated-select";
import { useAllAssets, useJobs, useStills } from "../lib/data";
import { GAP_ORDER, gapOf, jobsWithoutFootage } from "../lib/footageGaps";
import { clock, minutes, shape } from "../lib/format";
import { matchScore } from "../lib/search";
import { stageLabel } from "../lib/stages";
import type { Job } from "../lib/types";

/** What a job without a client tag is filed under, on the wall and the list. */
const NO_TAG = "No client tag";

/** Rows a reason shows before "Show the other N" (DESIGN.md, long lists). */
const FIRST_ROWS = 5;

/**
 * Every clip the desk has read, in one wall. Called Footage, as in the
 * menu and on a job's own page.
 *
 * An editor cutting for one client wants to remember what exists for the
 * others: the drone pass shot last month, the interview nobody used. The job
 * pages have the same files, one job at a time; this is the way to look
 * across them, and every frame leads back to the job it belongs to.
 */
export default function VideosPage() {
  const assets = useAllAssets();
  const jobs = useJobs();
  const [client, setClient] = useState<string>("");
  const [onlyWithSpeech, setOnlyWithSpeech] = useState(false);
  // Across every job: a file's name, its client, and what is said in it
  // (the job page searches one job's words; this is the way across them).
  const [find, setFind] = useState("");

  const clientOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const j of jobs.data ?? []) map.set(j.task_id, j.client ?? NO_TAG);
    return map;
  }, [jobs.data]);

  // Open jobs the desk has not read, so a client missing from the wall
  // is missing for a reason the page can name.
  const notRead = useMemo(() => {
    const read = new Set(
      (assets.data ?? []).filter(a => !a.error).map(a => a.task_id),
    );
    return jobsWithoutFootage(jobs.data ?? [], read);
  }, [assets.data, jobs.data]);

  const shown = useMemo(() => {
    let rows = (assets.data ?? []).filter(a => !a.error);
    if (client) rows = rows.filter(a => clientOf.get(a.task_id) === client);
    if (onlyWithSpeech)
      rows = rows.filter(a => (a.transcript ?? "").trim().length > 0);
    if (find.trim())
      rows = rows.filter(
        a =>
          matchScore(
            [a.name, clientOf.get(a.task_id), a.transcript]
              .filter(Boolean)
              .join(" "),
            find,
          ) > 0,
      );
    return rows;
  }, [assets.data, client, onlyWithSpeech, clientOf, find]);

  const clients = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of assets.data ?? []) {
      if (a.error) continue;
      const name = clientOf.get(a.task_id) ?? NO_TAG;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    // A client with jobs but no clip read yet is still a client: picking
    // it shows why its footage is missing instead of hiding it.
    for (const j of notRead) {
      const name = j.client ?? NO_TAG;
      if (!counts.has(name)) counts.set(name, 0);
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [assets.data, clientOf, notRead]);

  const notReadShown = client
    ? notRead.filter(j => (j.client ?? NO_TAG) === client)
    : notRead;

  const stills = useStills(shown.map(a => a.still_path));
  const unread = (assets.data ?? []).filter(a => a.error).length;
  const totalSeconds = shown.reduce((n, a) => n + (a.seconds ?? 0), 0);

  return (
    <Page>
      <PageHeader
        title="Footage"
        sub={
          <>
            Every clip the desk has read, across all jobs.{" "}
            <span className="tabular-nums">
              {shown.length} {shown.length === 1 ? "file" : "files"} ·{" "}
              {minutes(totalSeconds)}
            </span>
          </>
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <input
          value={find}
          onChange={e => setFind(e.target.value)}
          placeholder="Find a clip: a name, or words said in it"
          aria-label="Find a clip"
          dir="auto"
          className="h-10 w-full rounded-lg border bg-background px-3 text-sm sm:w-72"
        />
        <AnimatedSelect
          aria-label="Client"
          value={client}
          onChange={e => setClient(e.target.value)}
        >
          <option value="">All clients</option>
          {clients.map(([name, n]) => (
            <option key={name} value={name}>
              {name} ({n})
            </option>
          ))}
        </AnimatedSelect>
        <button
          type="button"
          onClick={() => setOnlyWithSpeech(v => !v)}
          aria-pressed={onlyWithSpeech}
          className={chip(onlyWithSpeech)}
        >
          Someone speaks
        </button>
      </div>

      {assets.error || jobs.error ? (
        <Problem>
          The footage could not be read: {assets.error ?? jobs.error}. Reload
          the page to try again.
        </Problem>
      ) : null}
      {unread ? (
        <p className="mb-4 px-1 text-xs text-muted-foreground">
          {unread} {unread === 1 ? "clip" : "clips"} could not be read by the
          desk and {unread === 1 ? "is" : "are"} left out. Each job page says
          why.
        </p>
      ) : null}
      {assets.loading && !assets.data ? (
        <Spinner what="Reading the footage" />
      ) : null}
      {notReadShown.length ? (
        <NotRead
          key={client}
          jobs={notReadShown}
          open={Boolean(client) && !shown.length}
        />
      ) : null}
      {!assets.loading && !assets.error && !shown.length ? (
        <Empty>
          {onlyWithSpeech
            ? "No clip here has speech in it. Turn off Someone speaks to see them all."
            : client && notReadShown.length
              ? `No footage has been read for ${client} yet. The list above says why.`
              : "No footage has been read yet. The desk reads a job's Drive folder every half hour."}
        </Empty>
      ) : null}

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
        {shown.map(a => {
          const still = a.still_path ? stills[a.still_path] : undefined;
          const who = clientOf.get(a.task_id);
          return (
            <li key={a.id}>
              <Link
                to={`/job/${a.task_id}`}
                className="block overflow-hidden rounded-xl border bg-card transition-colors hover:border-primary"
              >
                <div className="relative aspect-video w-full overflow-hidden bg-muted">
                  {still ? (
                    <img
                      src={still}
                      alt=""
                      className="size-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <span className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">
                      No frame
                    </span>
                  )}
                  {a.seconds ? (
                    <span className="absolute right-1.5 bottom-1.5 rounded bg-black/70 px-1.5 py-0.5 font-mono text-xs text-white">
                      {clock(a.seconds)}
                    </span>
                  ) : null}
                </div>
                <div className="px-3 py-2">
                  <p dir="auto" className="truncate text-xs font-medium">
                    {who ?? (
                      <span className="text-muted-foreground">Not set</span>
                    )}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {a.name}
                  </p>
                  <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                    {shape(a.width, a.height) && (
                      <span>{shape(a.width, a.height)}</span>
                    )}
                    {a.has_audio === false ? <span>Silent</span> : null}
                    {a.transcript ? <span>Speech</span> : null}
                    {a.scenes?.length ? (
                      <span>{a.scenes.length} shots</span>
                    ) : null}
                  </p>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </Page>
  );
}

/**
 * The jobs whose footage is not on the wall, grouped by what fixes them.
 * Folded by default: the wall is the page. It opens on its own when the
 * client picked has no clip at all, because then it is the only answer.
 */
function NotRead({ jobs, open: initial }: { jobs: Job[]; open: boolean }) {
  const [open, setOpen] = useState(initial);
  const id = useId();
  const groups = useMemo(() => {
    const by = new Map<string, { title: string; fix: string; jobs: Job[] }>();
    for (const j of jobs) {
      const gap = gapOf(j);
      const g = by.get(gap.kind) ?? {
        title: gap.title,
        fix: gap.fix,
        jobs: [],
      };
      g.jobs.push(j);
      by.set(gap.kind, g);
    }
    return GAP_ORDER.flatMap(k => {
      const g = by.get(k);
      return g ? [{ kind: k, ...g }] : [];
    });
  }, [jobs]);
  const clients = new Set(jobs.map(j => j.client ?? NO_TAG)).size;

  return (
    <section className="mb-6 rounded-2xl border bg-card px-4 sm:px-6">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center justify-between gap-3 py-4 text-left"
      >
        <span className="min-w-0">
          <span className="block text-[15px] font-semibold tracking-tight">
            Not read yet
          </span>
          <span className="block text-[13px] text-muted-foreground tabular-nums">
            {jobs.length} open {jobs.length === 1 ? "job" : "jobs"} for{" "}
            {clients} {clients === 1 ? "client" : "clients"} have no footage
            here, and why
          </span>
        </span>
        <ChevronDown
          aria-hidden
          className={`size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      <div id={id} hidden={!open} className="space-y-6 pb-6">
        {groups.map(g => (
          <Reason key={g.kind} title={g.title} fix={g.fix} jobs={g.jobs} />
        ))}
      </div>
    </section>
  );
}

/** One reason: what fixes it, then its jobs as divided rows. */
function Reason({
  title,
  fix,
  jobs,
}: {
  title: string;
  fix: string;
  jobs: Job[];
}) {
  const [all, setAll] = useState(false);
  const rows = all ? jobs : jobs.slice(0, FIRST_ROWS);
  const more = jobs.length - rows.length;
  return (
    <div>
      <h3 className="text-sm font-medium">
        {title}{" "}
        <span className="font-normal text-muted-foreground tabular-nums">
          · {jobs.length}
        </span>
      </h3>
      <p className="mt-1 text-[13px] text-muted-foreground">{fix}</p>
      <ul className="mt-2 divide-y border-y">
        {rows.map(j => (
          <li key={j.task_id}>
            <Link
              to={`/job/${j.task_id}`}
              className="flex items-center gap-3 py-2.5 text-sm hover:text-primary"
            >
              <span className="min-w-0 flex-1">
                <span dir="auto" className="block truncate font-medium">
                  {j.client ?? (
                    <span className="text-muted-foreground">{NO_TAG}</span>
                  )}
                </span>
                <span
                  dir="auto"
                  className="block truncate text-xs text-muted-foreground"
                >
                  {j.name || "Untitled card"} · {stageLabel(j.status)}
                </span>
              </span>
              <ChevronRight
                aria-hidden
                className="size-4 shrink-0 text-muted-foreground"
              />
            </Link>
          </li>
        ))}
      </ul>
      {more > 0 ? (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="mt-2 text-xs font-medium text-primary underline-offset-4 hover:underline"
        >
          Show the other {more}
        </button>
      ) : null}
    </div>
  );
}
