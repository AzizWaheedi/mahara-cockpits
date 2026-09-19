import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Empty, Problem, Spinner } from "../components/bits";
import { useAllAssets, useJobs, useStills } from "../lib/data";
import { clock, minutes, shape } from "../lib/format";

/**
 * Every clip the desk has read, in one wall.
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
    for (const j of jobs.data ?? []) map.set(j.task_id, j.client ?? "no client tag");
    return map;
  }, [jobs.data]);

  const shown = useMemo(() => {
    let rows = (assets.data ?? []).filter((a) => !a.error);
    if (client) rows = rows.filter((a) => clientOf.get(a.task_id) === client);
    if (onlyWithSpeech) rows = rows.filter((a) => (a.transcript ?? "").trim().length > 0);
    return rows;
  }, [assets.data, client, onlyWithSpeech, clientOf]);

  const clients = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of assets.data ?? []) {
      if (a.error) continue;
      const name = clientOf.get(a.task_id) ?? "no client tag";
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [assets.data, clientOf]);

  const stills = useStills(shown.map((a) => a.still_path));
  const totalSeconds = shown.reduce((n, a) => n + (a.seconds ?? 0), 0);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8">
      <header className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Videos</h1>
        <p className="muted mt-1 text-sm">
          Every clip the desk has read, across all jobs. {shown.length} files ·{" "}
          {minutes(totalSeconds)}.
        </p>
      </header>

      <div className="mb-5 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setClient("")}
          aria-pressed={client === ""}
          className={`rounded-full px-3 py-1.5 text-xs font-medium ${
            client === ""
              ? "bg-[color:var(--primary)] text-[color:var(--primary-foreground)]"
              : "raised muted"
          }`}
        >
          Everyone
        </button>
        {clients.map(([name, n]) => (
          <button
            key={name}
            type="button"
            onClick={() => setClient(name)}
            aria-pressed={client === name}
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${
              client === name
                ? "bg-[color:var(--primary)] text-[color:var(--primary-foreground)]"
                : "raised muted"
            }`}
          >
            {name} <span className="tabular-nums opacity-70">{n}</span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => setOnlyWithSpeech((v) => !v)}
          aria-pressed={onlyWithSpeech}
          className={`ml-auto rounded-full px-3 py-1.5 text-xs font-medium ${
            onlyWithSpeech
              ? "bg-[color:var(--primary)] text-[color:var(--primary-foreground)]"
              : "raised muted"
          }`}
        >
          Someone speaks
        </button>
      </div>

      {(assets.error || jobs.error) && (
        <Problem>These files could not be read: {assets.error ?? jobs.error}</Problem>
      )}
      {assets.loading && <Spinner what="Reading the footage" />}
      {!assets.loading && !shown.length && (
        <Empty>
          {onlyWithSpeech
            ? "Nothing here has speech in it. Most of our footage is silent."
            : "No footage has been read yet."}
        </Empty>
      )}

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {shown.map((a) => {
          const still = a.still_path ? stills[a.still_path] : undefined;
          return (
            <li key={a.id}>
              <Link
                to={`/job/${a.task_id}`}
                className="block overflow-hidden rounded-[var(--radius-md)] border hairline transition-colors hover:border-[color:var(--primary)]"
              >
                <div className="raised relative aspect-video w-full overflow-hidden">
                  {still ? (
                    <img src={still} alt="" className="size-full object-cover" loading="lazy" />
                  ) : (
                    <span className="muted absolute inset-0 grid place-items-center text-xs">
                      no frame
                    </span>
                  )}
                  {a.seconds ? (
                    <span className="absolute right-1 bottom-1 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-white">
                      {clock(a.seconds)}
                    </span>
                  ) : null}
                </div>
                <div className="px-2 py-1.5">
                  <p className="truncate text-xs font-medium">{clientOf.get(a.task_id) ?? "—"}</p>
                  <p className="muted truncate text-[11px]">{a.name}</p>
                  <p className="muted mt-0.5 flex flex-wrap gap-x-2 text-[11px]">
                    {shape(a.width, a.height) && <span>{shape(a.width, a.height)}</span>}
                    {a.has_audio === false ? <span>silent</span> : null}
                    {a.transcript ? <span>speech</span> : null}
                    {a.scenes?.length ? <span>{a.scenes.length} shots</span> : null}
                  </p>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
