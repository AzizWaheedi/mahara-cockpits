import { useQuery } from "convex/react";
import { Search, Sparkles, Users } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { AnimatedSelect } from "@/components/ui/animated-select";
import {
  WinnerFilter,
  type WinnerOrigin,
  WinningAds,
} from "@/components/WinningAds";
import { api } from "../../convex/_generated/api";

/**
 * The client database.
 *
 * One row per live client, click through to everything: the Brand DNA and
 * Offer Cheat Sheet you already wrote, every open task with its real ClickUp
 * status, what is live on the ad account right now, and what has run before.
 *
 * Actions queue into the outbox and are executed by the sync, so the screen
 * never pretends a ClickUp write already landed.
 */

function Pill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "good" | "warn" | "bad" | "neutral";
}) {
  return (
    <span
      className={`tone-${tone} rounded-full px-2 py-0.5 text-[11px] font-medium`}
    >
      {children}
    </span>
  );
}

export function ClientDatabasePage() {
  const data = useQuery(api.clients.roster, {});
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    // biome-ignore lint/suspicious/noExplicitAny: query rows are untyped
    return (data.clients as any[]).filter(
      r => !needle || r.name.toLowerCase().includes(needle),
    );
  }, [data, q]);

  if (data === undefined) {
    return <p className="p-4 text-[14px] text-muted-foreground">Loading…</p>;
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Users className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-[15px] font-bold tracking-tight">Clients</h2>
        <span className="text-[13px] text-muted-foreground">
          {data.counts.live} live · {data.counts.toContact} waiting on you
        </span>
        <div className="ml-auto flex items-center gap-1.5 rounded-md border px-2 py-1">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Find a client"
            className="w-40 bg-transparent text-[13px] outline-none"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        {rows.map(r => (
          <div key={r.taskId} className="rounded-lg border">
            <Link
              to={`/clients/${encodeURIComponent(r.name)}`}
              className="flex w-full items-center justify-between gap-2 p-2.5 text-left text-[13px] hover:bg-muted/50"
            >
              <span className="flex min-w-0 items-center gap-2">
                <strong className="truncate">{r.name}</strong>
                <Pill tone={r.prelaunch ? "warn" : "neutral"}>
                  {r.clientStatus}
                </Pill>
              </span>
              <span className="flex shrink-0 items-center gap-2 text-[12px] text-muted-foreground">
                {r.hisMove > 0 && (
                  <span className="txt-bad">{r.hisMove} on you</span>
                )}
                {r.openScripts > 0 && <span>{r.openScripts} scripts</span>}
                {r.openVideos > 0 && <span>{r.openVideos} videos</span>}
                {!r.docsReady && <span className="txt-bad">docs missing</span>}
              </span>
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The scripting database.
 *
 * Aziz, 2026-09-07: the first version of this was a bare table of ad names and
 * it did not help anyone. So it is now the same view the media buyer has, on
 * the same rows: the creative itself, watchable, with the hook, the copy and
 * the transcript, and one click through to the client it ran for.
 */
export function ScriptDatabasePage() {
  const [service, setService] = useState<string>("");
  const [liveOnly, setLiveOnly] = useState(false);
  const [q, setQ] = useState("");
  const [origin, setOrigin] = useState<WinnerOrigin>("all");
  const [savedBy, setSavedBy] = useState("");
  const latest = useQuery(api.winners.list, {
    serviceLine: service || undefined,
    liveOnly: liveOnly || undefined,
    limit: 200,
    origin: origin === "all" ? undefined : origin,
    savedBy: savedBy || undefined,
  });
  // A new filter loads in the background: keep showing the last list so the
  // page (and the "Saved by" names it has seen) stays put meanwhile.
  const kept = useRef(latest);
  if (latest !== undefined) kept.current = latest;
  const data = latest ?? kept.current;
  const roster = useQuery(api.clients.roster, {});

  const rows = useMemo(() => {
    if (!data) return undefined;
    const needle = q.trim().toLowerCase();
    if (!needle) return data.rows;
    // biome-ignore lint/suspicious/noExplicitAny: query rows are untyped
    return (data.rows as any[]).filter(r =>
      [r.client, r.adName, r.hook, r.headline, r.body, r.transcript]
        .filter(Boolean)
        .some((x: string) => x.toLowerCase().includes(needle)),
    );
  }, [data, q]);

  if (data === undefined) {
    return <p className="p-4 text-[14px] text-muted-foreground">Loading…</p>;
  }

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <Sparkles className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-[15px] font-bold tracking-tight">
          Scripting database
        </h2>
        <span className="text-[13px] text-muted-foreground">
          {data.total} proven ads, {data.live} still running
          {data.saved ? `, ${data.saved} saved by the team` : ""}
        </span>
      </div>
      <p className="mb-3 text-[13px] text-muted-foreground">
        Before you write anything, read what already worked in the same service
        line. Search the actual copy and transcripts, not just the ad names.
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <AnimatedSelect
          value={service}
          onChange={e => setService(e.target.value)}
          className="rounded border bg-transparent px-2 py-1 text-[13px]"
        >
          <option value="">Every service line</option>
          {/* biome-ignore lint/suspicious/noExplicitAny: query rows are untyped */}
          {(data.serviceLines as any[]).map(sv => (
            <option key={sv} value={sv}>
              {sv}
            </option>
          ))}
        </AnimatedSelect>
        <label className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <input
            type="checkbox"
            checked={liveOnly}
            onChange={e => setLiveOnly(e.target.checked)}
          />
          Only ads still live
        </label>
        <div className="ml-auto flex items-center gap-1.5 rounded-md border px-2 py-1">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search hooks, copy, transcripts"
            className="w-52 bg-transparent text-[13px] outline-none"
          />
        </div>
      </div>

      <div className="mb-2">
        <WinnerFilter
          rows={data.rows}
          origin={origin}
          onOrigin={setOrigin}
          savedBy={savedBy}
          onSavedBy={setSavedBy}
        />
      </div>

      <WinningAds
        rows={rows}
        title=""
        sub="Ads found by the weekly check spent at least $100 at $15 or less a lead. Ads marked Saved were picked by the team, with their numbers from the day they were saved. Click one to read its hook, its copy and, for video, what is actually said and shown on screen."
        empty={
          q.trim()
            ? "No ad here matches that search."
            : origin === "saved" || savedBy
              ? "Nobody has saved an ad here yet. The media buyer saves one from the Ads table with Save as winner."
              : undefined
        }
      />

      {roster?.clients?.length ? (
        <div className="mt-6">
          <h3 className="mb-1.5 text-[14px] font-bold">
            Or start from a client
          </h3>
          <p className="mb-2 text-[12px] text-muted-foreground">
            Opens their full screen: brand direction, offer, everything we have
            made and what is live on their account right now.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {/* biome-ignore lint/suspicious/noExplicitAny: query rows are untyped */}
            {(roster.clients as any[]).map(c => (
              <Link
                key={c.taskId}
                to={`/clients/${encodeURIComponent(c.name)}`}
                className="rounded-full border px-2.5 py-1 text-[12px] hover:bg-muted"
                dir="auto"
              >
                {c.name}
              </Link>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
