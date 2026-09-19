import { useAction } from "convex/react";
import { Database, KeyRound, LoaderCircle, RefreshCw } from "lucide-react";
import { useState } from "react";
import { EmptyState } from "@/components/memory/EmptyState";
import {
  count,
  dateTime,
  relative,
  sourceBlurb,
  sourceLabel,
} from "@/components/memory/format";
import { Notes } from "@/components/memory/Notes";
import { SectionCard } from "@/components/memory/SectionCard";
import { SourceBadge } from "@/components/memory/SourceBadge";
import { StatTile } from "@/components/memory/StatTile";
import { HealthDots, StatusChip } from "@/components/memory/StatusChip";
import { useOverview } from "@/components/memory/useMemoryCore";
import { useNow } from "@/components/memory/useNow";
import { api } from "../../convex/_generated/api";

/**
 * Sources: what is connected, when it last answered, and what to do when it
 * does not.
 *
 * Every row here is a subscription to real state, and no row is allowed to
 * show a zero it has not earned: a source that has never synced says so, and a
 * source that failed says what failed. The audit tail and the health dots sit
 * on this screen because this is where somebody comes when a number looks
 * wrong.
 */
export function SourcesView({
  code,
  onLock,
}: {
  code: string;
  onLock: () => void;
}) {
  const { overview, loading } = useOverview(code);
  const syncSource = useAction(api.sync.syncSource);
  const [busySource, setBusySource] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const now = useNow();

  const syncOne = async (source: string) => {
    setBusySource(source);
    setNote(null);
    try {
      const result = (await syncSource({
        code,
        source: source as "notion" | "gmail" | "drive",
      })) as { ok: boolean; count: number; note: string };
      setNote(
        result.ok
          ? `${sourceLabel(source)}: ${result.note}`
          : `${sourceLabel(source)}: ${result.note}`,
      );
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setBusySource(null);
    }
  };

  if (loading || !overview) {
    return (
      <SectionCard kicker="Sources" title="Checking the connections">
        <p className="text-sm text-muted-foreground">
          Reading the last sync of each source…
        </p>
      </SectionCard>
    );
  }

  const claudeMissing = !overview.answerModel.startsWith("Claude");

  return (
    <div className="space-y-5">
      <div className="grid min-w-0 gap-3 sm:grid-cols-3">
        <StatTile
          label="Items in the memory"
          value={count(overview.totals.items)}
          sub="Everything searchable, synced and saved"
        />
        <StatTile
          label="Memories you saved"
          value={count(overview.totals.memories)}
          sub="Facts written by hand, searched with the rest"
        />
        <StatTile
          label="Last source sync"
          value={
            overview.totals.lastSyncAt
              ? relative(overview.totals.lastSyncAt, now)
              : "n/a"
          }
          naHint="No source has synced yet"
          sub={
            overview.totals.lastSyncAt
              ? dateTime(overview.totals.lastSyncAt, now)
              : "Press Sync now in the header"
          }
        />
      </div>

      {overview.trouble.length ? (
        <SectionCard
          kicker="Needs attention"
          title="Something has stopped answering"
          className="mc-stale"
        >
          <Notes
            notes={overview.trouble.map(text => ({
              level: "warn" as const,
              text,
            }))}
          />
        </SectionCard>
      ) : null}

      <SectionCard
        kicker="Connections"
        title="Where the memory comes from"
        order={1}
        notes={[
          {
            level: "info",
            text: "Notion, Gmail and Google Drive come through Composio, which is already connected for aziz@maharamedia.com. Nothing else needs signing in.",
          },
        ]}
      >
        <ul className="min-w-0 space-y-3">
          {overview.sources.map(source => {
            const busy = busySource === source.key;
            const stale =
              source.lastSyncAt !== null && !source.connected
                ? {
                    label: source.label,
                    at: source.lastSyncAt,
                    lastOkAt: source.lastOkAt,
                    error: source.lastError,
                  }
                : null;
            return (
              <li
                key={source.key}
                className="flex min-w-0 flex-wrap items-start justify-between gap-3 border-t border-border/70 pt-3 first:border-t-0 first:pt-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    {source.key === "note" ? (
                      <SourceBadge source="note" />
                    ) : (
                      <SourceBadge source={source.key} />
                    )}
                    <StatusChip
                      tone={
                        source.neverSynced
                          ? "neutral"
                          : source.connected
                            ? "good"
                            : "serious"
                      }
                      label={
                        source.neverSynced
                          ? "Never synced"
                          : source.connected
                            ? "Connected"
                            : "Needs attention"
                      }
                    />
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {count(source.itemCount)} item
                      {source.itemCount === 1 ? "" : "s"}
                    </span>
                    {source.lastSyncAt ? (
                      <span className="text-xs text-muted-foreground">
                        · last sync {relative(source.lastSyncAt, now)}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {source.note}
                  </p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground/80">
                    {sourceBlurb(source.key)}.
                  </p>
                  {stale?.error ? (
                    <details className="group mt-1">
                      <summary className="cursor-pointer select-none text-[11px] text-muted-foreground hover:text-foreground">
                        Details
                      </summary>
                      <p className="mt-1 break-words font-mono text-[11px] leading-relaxed text-muted-foreground">
                        {stale.error}
                      </p>
                    </details>
                  ) : null}
                </div>
                {source.key === "note" ? (
                  <span className="text-xs text-muted-foreground">
                    Written on the Memories view
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void syncOne(source.key)}
                    disabled={busy}
                    className="inline-flex h-8 shrink-0 items-center gap-2 rounded-lg border bg-card px-3 text-xs font-medium text-foreground transition-colors hover:bg-[var(--mc-emphasis-wash)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70"
                  >
                    {busy ? (
                      <LoaderCircle
                        className="mc-spin size-3.5 animate-spin text-[color:var(--mc-emphasis)]"
                        aria-hidden
                      />
                    ) : (
                      <RefreshCw
                        className="size-3.5 text-[color:var(--mc-emphasis)]"
                        aria-hidden
                      />
                    )}
                    {busy ? "Syncing" : "Sync this one"}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        {note ? (
          <p className="mt-3 border-t pt-3 text-xs leading-relaxed text-muted-foreground">
            {note}
          </p>
        ) : null}
      </SectionCard>

      <div className="grid min-w-0 gap-5 lg:grid-cols-2">
        <SectionCard
          kicker="Health"
          title="The last calls to each system"
          order={2}
          notes={[
            {
              level: "info",
              text: `A dot is one call: green answered, red failed. ${overview.systems[0]?.alertAfter ?? 3} failures in a row turn into the sentence at the top of this page.`,
            },
          ]}
        >
          {overview.systems.length ? (
            <ul className="space-y-2">
              {overview.systems.map(system => (
                <li
                  key={system.source}
                  className="flex min-w-0 items-center justify-between gap-3 text-xs"
                >
                  <span className="min-w-0 truncate text-foreground">
                    {system.label}
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
                    <HealthDots recent={system.recent} label={system.label} />
                    <span className="tabular-nums">
                      {system.recent.filter(row => row.ok).length}/
                      {system.recent.length}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title="No calls logged yet"
              text="Search or sync once and each call lands here."
              compact
            />
          )}
        </SectionCard>

        <SectionCard
          kicker="Answer model"
          title={overview.answerModel}
          order={3}
          notes={
            claudeMissing
              ? [
                  {
                    level: "warn",
                    text: "Claude is not connected on this deployment, so answers are written by the fallback model. Set ANTHROPIC_API_KEY to have Claude write them.",
                  },
                ]
              : [
                  {
                    level: "info",
                    text: "Claude writes the answers. The exact model is shown on every answer.",
                  },
                ]
          }
        >
          <p className="text-xs leading-relaxed text-muted-foreground">
            The answer is written from numbered excerpts a search just found,
            and every number the answer uses is checked against those excerpts
            before it is stored.
          </p>
        </SectionCard>
      </div>

      <SectionCard
        kicker="Audit"
        title="Every change, newest first"
        order={4}
        notes={[
          {
            level: "info",
            text: "Saving a memory, syncing a source and asking a question all leave a row here. Nothing the memory core does to your data is invisible.",
          },
        ]}
      >
        {overview.audit.length ? (
          <ul className="space-y-1.5">
            {overview.audit.map((row, index) => (
              <li
                key={`${row.at}-${index}`}
                className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-xs"
              >
                <span className="font-mono tabular-nums text-muted-foreground">
                  {dateTime(row.at, now)}
                </span>
                <span className="font-medium text-foreground">
                  {row.action}
                </span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {row.detail}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title="Nothing has happened yet"
            text="Sync a source or save a memory and the row appears here."
            compact
          />
        )}
      </SectionCard>

      <SectionCard
        kicker="Access"
        title="This tool is one code, one person"
        order={5}
        actions={
          <button
            type="button"
            onClick={onLock}
            className="inline-flex h-8 items-center gap-2 rounded-lg border bg-card px-3 text-xs font-medium text-foreground transition-colors hover:bg-[var(--mc-emphasis-wash)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <KeyRound className="size-3.5" aria-hidden />
            Lock this browser
          </button>
        }
        notes={[
          {
            level: "info",
            text: "The code lives on the deployment (MEMORY_CORE_ACCESS_CODE) and every read and write checks it on the server. Locking this browser only removes it from this machine.",
          },
        ]}
      >
        <p className="flex items-center gap-2 text-xs leading-relaxed text-muted-foreground">
          <Database className="size-3.5 shrink-0" aria-hidden />
          Nothing here is written to Supabase or any other Mahara system — the
          memory core keeps its own tables in Convex.
        </p>
      </SectionCard>
    </div>
  );
}
