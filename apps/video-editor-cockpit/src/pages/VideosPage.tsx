import { useMemo, useState } from "react";
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
import { clock, minutes, shape } from "../lib/format";

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

  const clientOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const j of jobs.data ?? [])
      map.set(j.task_id, j.client ?? "No client tag");
    return map;
  }, [jobs.data]);

  const shown = useMemo(() => {
    let rows = (assets.data ?? []).filter(a => !a.error);
    if (client) rows = rows.filter(a => clientOf.get(a.task_id) === client);
    if (onlyWithSpeech)
      rows = rows.filter(a => (a.transcript ?? "").trim().length > 0);
    return rows;
  }, [assets.data, client, onlyWithSpeech, clientOf]);

  const clients = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of assets.data ?? []) {
      if (a.error) continue;
      const name = clientOf.get(a.task_id) ?? "No client tag";
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [assets.data, clientOf]);

  const stills = useStills(shown.map(a => a.still_path));
  const totalSeconds = shown.reduce((n, a) => n + (a.seconds ?? 0), 0);

  return (
    <Page wide>
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
          className={`${chip(onlyWithSpeech)} sm:h-9`}
        >
          Someone speaks
        </button>
      </div>

      {(assets.error || jobs.error) && (
        <Problem>
          These files could not be read: {assets.error ?? jobs.error}
        </Problem>
      )}
      {assets.loading && <Spinner what="Reading the footage" />}
      {!assets.loading && !shown.length && (
        <Empty>
          {onlyWithSpeech
            ? "Nothing here has speech in it. Most of our footage is silent."
            : "No footage has been read yet."}
        </Empty>
      )}

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
