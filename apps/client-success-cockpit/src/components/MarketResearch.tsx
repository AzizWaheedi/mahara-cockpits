import type { SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import {
  Chip,
  ExtLink,
  PageHeader,
  SectionCard,
  StatTile,
} from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  type Competitor,
  flagCompetitor,
  type ResearchView,
  readResearch,
  rerunResearch,
  safeResearchUrl,
} from "@/lib/marketResearch";

const OPEN = new Set([
  "queued",
  "claimed",
  "pulling",
  "picking",
  "writing",
  "checking",
  "publishing",
]);
const displayNumber = (n: number | null | undefined) =>
  n == null ? "Not checked" : n.toLocaleString();
const reportPath = (id: string) =>
  `/clients/${encodeURIComponent(id)}/research`;
const date = (value: string | null | undefined) => {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.valueOf())
    ? null
    : d.toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
};

function useResearch(client: SupabaseClient | null, taskId: string) {
  const [data, setData] = useState<ResearchView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: version is an explicit refresh request
  useEffect(() => {
    let current = true;
    setData(null);
    setError(null);
    void readResearch(client, taskId).then(
      v => {
        if (current) setData(v);
      },
      e => {
        if (current)
          setError(
            e instanceof Error
              ? e.message
              : "Market research could not be read.",
          );
      },
    );
    return () => {
      current = false;
    };
  }, [client, taskId, version]);
  return { data, error, refresh: () => setVersion(v => v + 1) };
}

function summary(v: ResearchView) {
  const run = v.run;
  if (!run) return undefined;
  const pieces = [
    date(run.finishedAt ?? run.requestedAt),
    run.sourcesN == null ? null : `${run.sourcesN} sources`,
    run.usd == null ? null : `$${run.usd.toFixed(2)} scraping`,
  ].filter(Boolean);
  return pieces.length ? pieces.join(" · ") : v.sentence;
}

function statusSentence(v: ResearchView) {
  if (v.state !== "none") return v.sentence;
  return v.on
    ? "No research in this cockpit yet. A previous report may be in Their links."
    : "No research in this cockpit yet. Automatic research is off. A previous report may be in Their links.";
}

/** Client-page entry. It never treats an unfinished run as a completed report. */
export function MarketResearchCard({
  client,
  taskId,
}: {
  client: SupabaseClient | null;
  taskId: string;
}) {
  const { data, error, refresh } = useResearch(client, taskId);
  const doc =
    data?.run?.mode === "live" ? safeResearchUrl(data.run.docUrl) : null;
  return (
    <SectionCard
      title="Market research"
      sub={data ? summary(data) : undefined}
      action={
        data ? (
          <Chip
            tone={
              data.state === "done"
                ? "good"
                : data.state === "needs_person" || data.state === "failed"
                  ? "warn"
                  : "neutral"
            }
          >
            {statusLabel(data)}
          </Chip>
        ) : undefined
      }
    >
      {error ? (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span role="alert">{error}</span>
          <Button size="sm" variant="outline" onClick={refresh}>
            Try again
          </Button>
        </div>
      ) : !data ? (
        <p className="text-sm text-muted-foreground">
          Loading market research…
        </p>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {statusSentence(data)}
          </p>
          {data.state === "done" && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <StatTile
                plain
                label="Sources"
                value={
                  data.run?.sourcesN == null
                    ? "—"
                    : displayNumber(data.run.sourcesN)
                }
                sub={data.run?.sourcesN == null ? "Not checked" : undefined}
              />
              <StatTile
                plain
                label="Competitors found"
                value={
                  data.run?.competitorsN == null
                    ? "—"
                    : displayNumber(data.run.competitorsN)
                }
                sub={data.run?.competitorsN == null ? "Not checked" : undefined}
              />
              <StatTile
                plain
                label="Longest ad"
                value={longest(data.competitors)}
                sub={
                  longest(data.competitors) === "—"
                    ? "Not checked"
                    : "Days running, where checked"
                }
              />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <Link
              className="font-medium underline underline-offset-4"
              to={reportPath(taskId)}
            >
              Open research
            </Link>
            {data.state === "done" && doc && (
              <ExtLink href={doc}>Open report</ExtLink>
            )}
          </div>
        </div>
      )}
    </SectionCard>
  );
}

function statusLabel(v: ResearchView) {
  return v.state === "done"
    ? v.run?.mode === "shadow"
      ? "Internal preview"
      : "Ready"
    : OPEN.has(v.state)
      ? "In progress"
      : v.state === "none"
        ? "Not started"
        : "Needs attention";
}

function longest(rows: Competitor[] | undefined): string {
  const values = (rows ?? [])
    .filter(c => !c.flagged && !c.reserve)
    .map(c => c.longestAdDays)
    .filter((v): v is number => typeof v === "number");
  return values.length ? `${Math.max(...values)} days` : "—";
}
function Candidate({
  row,
  canFlag,
  onFlag,
}: {
  row: Competitor;
  canFlag: boolean;
  onFlag: (cid: string, reason: string) => Promise<void>;
}) {
  const [show, setShow] = useState(false),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const website = safeResearchUrl(row.website),
    place = safeResearchUrl(row.placeUrl),
    days = row.longestAdDays;
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await onFlag(row.cid, reason);
      setShow(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save. Try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="space-y-3 px-4 py-4 sm:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="break-words text-sm font-semibold">{row.name}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {row.flagged
              ? "Marked as not a competitor"
              : row.reserve
                ? "Reserve candidate"
                : "Research candidate"}
          </p>
        </div>
        <div className="flex flex-wrap gap-3 text-xs">
          {place && <ExtLink href={place}>Maps</ExtLink>}
          {website && <ExtLink href={website}>Website</ExtLink>}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        <div>
          <span className="block text-xs text-muted-foreground">
            Maps rating
          </span>
          {displayNumber(row.rating)}
        </div>
        <div>
          <span className="block text-xs text-muted-foreground">Reviews</span>
          {displayNumber(row.reviewsN)}
        </div>
        <div>
          <span className="block text-xs text-muted-foreground">
            Active ads
          </span>
          {displayNumber(row.adsActiveN)}
        </div>
        <div>
          <span className="block text-xs text-muted-foreground">
            Longest ad
          </span>
          {days == null ? "Not checked" : `${displayNumber(days)} days`}
        </div>
      </div>
      {days != null && (
        <div aria-hidden="true">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{
                width: `${Math.min(100, Math.max(0, (days / 60) * 100))}%`,
              }}
            />
          </div>
          <div className="relative mt-1 h-4 font-mono text-[10px] text-muted-foreground">
            <span className="absolute left-0">0</span>
            <span
              className="absolute -translate-x-1/2"
              style={{ left: "11.67%" }}
            >
              7
            </span>
            <span className="absolute -translate-x-1/2" style={{ left: "35%" }}>
              21
            </span>
            <span className="absolute right-0">60+ days</span>
          </div>
        </div>
      )}
      {canFlag && !row.flagged && (
        <div>
          {!show ? (
            <Button size="sm" variant="outline" onClick={() => setShow(true)}>
              Not a competitor
            </Button>
          ) : (
            <div className="space-y-2">
              <label
                className="block text-xs font-medium"
                htmlFor={`why-${row.cid}`}
              >
                Why is this not a competitor?
              </label>
              <Textarea
                id={`why-${row.cid}`}
                maxLength={300}
                value={reason}
                onChange={e => setReason(e.target.value)}
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={busy || reason.trim().length < 3}
                  onClick={() => void send()}
                >
                  {busy ? "Saving…" : "Save"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setShow(false)}
                >
                  Cancel
                </Button>
              </div>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function ResearchDetail({
  client,
  taskId,
}: {
  client: SupabaseClient | null;
  taskId: string;
}) {
  const { data, error, refresh } = useResearch(client, taskId);
  const [show, setShow] = useState(false),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [actionError, setActionError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await rerunResearch(client, taskId, reason);
      setShow(false);
      setReason("");
      refresh();
    } catch (e) {
      setActionError(
        e instanceof Error ? e.message : "Could not start research.",
      );
    } finally {
      setBusy(false);
    }
  };
  const flag = async (cid: string, why: string) => {
    if (!data?.run?.id)
      throw Error("Research run is unavailable. Refresh and try again.");
    await flagCompetitor(client, data.run.id, cid, why);
    refresh();
  };
  const doc =
    data?.run?.mode === "live" ? safeResearchUrl(data.run.docUrl) : null;
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <Link
        className="text-sm text-muted-foreground underline underline-offset-4"
        to={`/clients/${encodeURIComponent(taskId)}?tab=onboarding`}
      >
        Back to client
      </Link>
      <PageHeader
        title="Market research"
        sub="A starting point for the team, grounded in the sources checked."
      />
      {error ? (
        <SectionCard title="Research unavailable">
          <div role="alert" className="space-y-3 text-sm">
            <p>{error}</p>
            <Button variant="outline" onClick={refresh}>
              Try again
            </Button>
          </div>
        </SectionCard>
      ) : !data ? (
        <p className="text-sm text-muted-foreground">
          Loading market research…
        </p>
      ) : (
        <>
          <SectionCard
            title="Research status"
            sub={summary(data)}
            action={
              <Chip tone={data.state === "done" ? "good" : "neutral"}>
                {statusLabel(data)}
              </Chip>
            }
          >
            <div className="space-y-4 text-sm">
              <p>{statusSentence(data)}</p>
              {data.run?.mode === "shadow" && (
                <p className="text-muted-foreground">
                  Internal preview. This run has not been published.
                </p>
              )}
              {data.state === "done" && doc && (
                <ExtLink href={doc}>Open report</ExtLink>
              )}
              {data.canRerun &&
                data.on &&
                !OPEN.has(data.state) &&
                (!show ? (
                  <div>
                    <Button variant="outline" onClick={() => setShow(true)}>
                      Run research again
                    </Button>
                  </div>
                ) : (
                  <div className="max-w-xl space-y-2">
                    <label
                      htmlFor="research-reason"
                      className="block text-xs font-medium"
                    >
                      Why run it again?
                    </label>
                    <Textarea
                      id="research-reason"
                      value={reason}
                      maxLength={300}
                      onChange={e => setReason(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Give at least 10 characters. A new run uses research
                      credits.
                    </p>
                    <div className="flex gap-2">
                      <Button
                        disabled={busy || reason.trim().length < 10}
                        onClick={() => void run()}
                      >
                        {busy ? "Starting…" : "Start research"}
                      </Button>
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() => setShow(false)}
                      >
                        Cancel
                      </Button>
                    </div>
                    {actionError && (
                      <p role="alert" className="text-destructive">
                        {actionError}
                      </p>
                    )}
                  </div>
                ))}
            </div>
          </SectionCard>
          {data.state === "done" && (
            <>
              <SectionCard
                title="Competitor candidates"
                sub="Review the candidates before using them. Missing values mean they were not checked."
                flush
              >
                {data.competitors?.length ? (
                  <ul>
                    {data.competitors.map(c => (
                      <Candidate
                        key={c.cid}
                        row={c}
                        canFlag={data.canRerun}
                        onFlag={flag}
                      />
                    ))}
                  </ul>
                ) : (
                  <p className="px-4 py-4 text-sm text-muted-foreground sm:px-6">
                    No competitor candidates were recorded in this run.
                  </p>
                )}
              </SectionCard>
              <SectionCard title="Findings and sources">
                <p className="text-sm text-muted-foreground">
                  {doc
                    ? "Open the report for the full findings, customer themes and sources."
                    : "A report has not been published for this run. Findings and source details are not available here yet."}
                </p>
                {doc && (
                  <div className="mt-3 text-sm">
                    <ExtLink href={doc}>Open report</ExtLink>
                  </div>
                )}
              </SectionCard>
            </>
          )}
        </>
      )}
    </div>
  );
}

export function MarketResearchPage() {
  const { key = "" } = useParams();
  const auth = useCockpitAuth();
  return (
    <ResearchDetail
      key={`${auth.session?.user.id ?? ""}:${key}`}
      client={auth.client}
      taskId={key}
    />
  );
}
