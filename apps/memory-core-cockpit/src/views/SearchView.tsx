import { Search as SearchIcon, Sparkles } from "lucide-react";
import { useState } from "react";
import { EmptyState } from "@/components/memory/EmptyState";
import { count, relative } from "@/components/memory/format";
import { Notes } from "@/components/memory/Notes";
import { ResultRow } from "@/components/memory/ResultRow";
import { SectionCard } from "@/components/memory/SectionCard";
import { SourceBadge } from "@/components/memory/SourceBadge";
import {
  useReadNotionPage,
  useRecentItems,
  useSearch,
} from "@/components/memory/useMemoryCore";
import { useNow } from "@/components/memory/useNow";

/**
 * One search box over everything the memory core holds.
 *
 * The screen answers three questions in order: what matched (ranked, with the
 * source on every row), what each source actually did (a count and a plain
 * sentence, because "nothing matched" and "did not answer" are different), and
 * what is already remembered even when nothing was typed.
 */
export function SearchView({ code }: { code: string }) {
  const [query, setQuery] = useState("");
  const [live, setLive] = useState(true);
  const { run, busy, result, error } = useSearch();
  const recent = useRecentItems(code, 8);
  const reader = useReadNotionPage();
  const now = useNow();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (query.trim().length < 2) return;
    await run(code, query.trim(), live);
  };

  const notes = result
    ? [
        ...result.perSource.map(source => ({
          level: source.ok ? ("info" as const) : ("warn" as const),
          // The source's own note already carries its search rules, so nothing
          // is appended here — the same sentence twice reads as padding.
          text: source.note,
        })),
        result.error
          ? {
              level: "warn" as const,
              text: `The live search itself did not run: ${result.error}`,
            }
          : null,
      ]
    : [];

  return (
    <div className="space-y-5">
      <SectionCard
        kicker="Search"
        title="Everything you have, in one box"
        hideAsOf
        actions={
          result ? (
            <span className="text-xs text-muted-foreground tabular-nums">
              {result.results.length} of{" "}
              {count(result.indexed.inserted + result.results.length)} · took{" "}
              {result.tookMs} ms
            </span>
          ) : null
        }
        notes={result ? notes : null}
      >
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="relative">
            <SearchIcon
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <input
              // biome-ignore lint/a11y/noAutofocus: this is the one thing the screen is for
              autoFocus
              type="search"
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="A client, a file, a phrase from an email…"
              aria-label="Search everything"
              className="h-11 w-full rounded-xl border bg-background pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={live}
                onChange={event => setLive(event.target.checked)}
                className="size-3.5 rounded border-input"
              />
              Ask Notion, Gmail and Drive live (off searches what is already
              remembered)
            </label>
            <button
              type="submit"
              disabled={busy || query.trim().length < 2}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            >
              {busy ? (
                <>
                  <Sparkles
                    className="mc-spin size-4 animate-spin"
                    aria-hidden
                  />
                  Searching
                </>
              ) : (
                "Search"
              )}
            </button>
          </div>
        </form>
      </SectionCard>

      {error ? (
        <SectionCard kicker="Search" title="That search did not run" order={1}>
          <p className="text-sm text-foreground">{error}</p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Nothing was lost. Try again, or turn off the live search to look at
            what is already remembered.
          </p>
        </SectionCard>
      ) : null}

      {result ? (
        <SectionCard
          kicker={result.usedLive ? "Live and remembered" : "Remembered"}
          title={
            result.results.length
              ? `Best matches for “${result.query}”`
              : `Nothing matched “${result.query}”`
          }
          order={2}
          actions={
            <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {result.perSource.map(source => (
                <span
                  key={source.source}
                  className="inline-flex items-center gap-1"
                >
                  <SourceBadge source={source.source} />
                  <span className="tabular-nums">{source.count}</span>
                </span>
              ))}
            </span>
          }
        >
          {result.results.length === 0 ? (
            <EmptyState
              title="Nothing in the connected sources matched"
              text="Try different words. If it is something you know, save it as a memory on the Memories view and it will be here next time."
              compact
            />
          ) : (
            <ul className="min-w-0">
              {result.results.map((item, index) => (
                <ResultRow
                  key={item.key}
                  item={item}
                  rank={index + 1}
                  reading={reader.busyId === item.externalId}
                  onRead={
                    item.canRead && item.externalId
                      ? () =>
                          void reader.run(
                            code,
                            item.externalId as string,
                            item.title,
                            item.url,
                          )
                      : undefined
                  }
                />
              ))}
            </ul>
          )}
        </SectionCard>
      ) : (
        <SectionCard
          kicker="Remembered"
          title="The newest things in the memory"
          order={1}
          actions={
            <span className="text-xs text-muted-foreground">
              {recent ? `${recent.length} newest` : "loading"}
            </span>
          }
        >
          {recent && recent.length > 0 ? (
            <ul className="min-w-0">
              {recent.map(item => (
                <ResultRow
                  key={item.id}
                  item={{ ...item, key: item.id }}
                  when={relative(item.occurredAt, now)}
                />
              ))}
            </ul>
          ) : (
            <EmptyState
              title="Nothing in the memory yet"
              text="Press Sync now in the header to pull the newest from Notion, Gmail and Google Drive, or save a memory you want kept."
              compact
            />
          )}
        </SectionCard>
      )}

      {reader.error ? (
        <Notes
          notes={[{ level: "warn", text: reader.error }]}
          className="px-1"
        />
      ) : null}
    </div>
  );
}
