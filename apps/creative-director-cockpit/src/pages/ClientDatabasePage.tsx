import { useQuery } from "convex/react";
import { ChevronRight, Search } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { PageHeader } from "@/components/PageHeader";
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

/** A status chip: the words stay plain, a dot carries the colour. */
function Pill({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "good" | "warn" | "bad" | "neutral";
}) {
  const dot =
    tone === "good"
      ? "var(--success)"
      : tone === "warn"
        ? "var(--warning)"
        : tone === "bad"
          ? "var(--destructive)"
          : null;
  return (
    <span className="inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium">
      {dot ? (
        <span
          aria-hidden
          className="size-1.5 shrink-0 rounded-full"
          style={{ background: dot }}
        />
      ) : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

/** The search box both pages use. */
function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
}) {
  return (
    <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border px-3 sm:max-w-80">
      <Search className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="sr-only">Search</span>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-sm outline-none"
      />
    </label>
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
    return (
      <p className="mx-auto w-full max-w-6xl text-sm text-muted-foreground">
        Loading…
      </p>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader
        title="Clients"
        sub={`${data.counts.live} live · ${data.counts.toContact} waiting on you`}
        actions={
          <SearchBox value={q} onChange={setQ} placeholder="Find a client" />
        }
      />

      <div className="divide-y overflow-hidden rounded-xl border">
        {rows.map(r => (
          <Link
            key={r.taskId}
            to={`/clients/${encodeURIComponent(r.name)}`}
            className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted/40"
          >
            {/* The flags drop to their own line on a phone rather than
                squeezing the client's name to nothing. */}
            <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
              <span className="flex min-w-0 items-center gap-2">
                <strong className="min-w-0 truncate font-medium" dir="auto">
                  {r.name}
                </strong>
                <Pill tone={r.prelaunch ? "warn" : "neutral"}>
                  {r.clientStatus}
                </Pill>
              </span>
              <span className="flex basis-full flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground sm:ml-auto sm:basis-auto">
                {r.hisMove > 0 && (
                  <span className="txt-bad">{r.hisMove} on you</span>
                )}
                {r.openScripts > 0 && <span>{r.openScripts} scripts</span>}
                {r.openVideos > 0 && <span>{r.openVideos} videos</span>}
                {!r.docsReady && <span className="txt-bad">Docs missing</span>}
              </span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
          </Link>
        ))}
        {rows.length === 0 && (
          <p className="px-4 py-3 text-sm text-muted-foreground">
            {q.trim() ? "No client matches that." : "No live clients yet."}
          </p>
        )}
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
    return (
      <p className="mx-auto w-full max-w-6xl text-sm text-muted-foreground">
        Loading…
      </p>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader
        title="Scripting database"
        sub={`${data.total} proven ads, ${data.live} still running${data.saved ? `, ${data.saved} saved by the team` : ""}`}
      />
      <p className="-mt-3 mb-6 text-xs text-muted-foreground">
        Before you write anything, read what already worked in the same service
        line. Search the actual copy and transcripts, not just the ad names.
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <AnimatedSelect
          value={service}
          onChange={e => setService(e.target.value)}
          aria-label="Service line"
          className="h-8 rounded-md border bg-transparent px-3 text-xs"
        >
          <option value="">Every service line</option>
          {/* biome-ignore lint/suspicious/noExplicitAny: query rows are untyped */}
          {(data.serviceLines as any[]).map(sv => (
            <option key={sv} value={sv}>
              {sv}
            </option>
          ))}
        </AnimatedSelect>
        <label className="flex h-8 items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={liveOnly}
            onChange={e => setLiveOnly(e.target.checked)}
            className="size-4 accent-[var(--mahara-teal)]"
          />
          Only ads still live
        </label>
        <div className="flex basis-full sm:ml-auto sm:basis-80">
          <SearchBox
            value={q}
            onChange={setQ}
            placeholder="Search hooks, copy, transcripts"
          />
        </div>
      </div>

      <div className="mb-3">
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
        <section className="mt-8">
          <h2 className="text-[15px] font-semibold">Or start from a client</h2>
          <p className="mt-1 mb-3 text-xs text-muted-foreground">
            Opens their full screen: brand direction, offer, everything we have
            made and what is live on their account right now.
          </p>
          <div className="flex flex-wrap gap-2">
            {/* biome-ignore lint/suspicious/noExplicitAny: query rows are untyped */}
            {(roster.clients as any[]).map(c => (
              <Link
                key={c.taskId}
                to={`/clients/${encodeURIComponent(c.name)}`}
                className="inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium hover:bg-muted"
                dir="auto"
              >
                {c.name}
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
