import { BookOpen, ExternalLink, LoaderCircle } from "lucide-react";
import { day, sourceLabel } from "./format";
import { SourceBadge } from "./SourceBadge";

export type ResultItem = {
  key?: string;
  id?: string;
  source: string;
  externalId?: string;
  title: string;
  snippet: string;
  url?: string | null;
  occurredAt: number;
  score?: number;
  fromIndex?: boolean;
  canRead?: boolean;
  tags?: string[];
};

/**
 * One line of the answer to a search: where it came from, what it is called,
 * the part that matched, and a way into the whole thing.
 *
 * The snippet is the reason the row is here — it is the matched text, not a
 * blind preview — so it sits directly under the title at readable size, and it
 * is the only place the row is allowed to run to two lines.
 */
export function ResultRow({
  item,
  rank,
  when,
  reading,
  onRead,
  onForget,
}: {
  item: ResultItem;
  /** Position in the list, shown in the left margin. */
  rank?: number;
  /** Pre-formatted date line. Defaults to the item's own date. */
  when?: string;
  /** True while this row's Notion page is being read into the index. */
  reading?: boolean;
  /** Present on Notion rows: pull the page's text into memory. */
  onRead?: () => void;
  /** Present on saved memories: remove it. */
  onForget?: () => void;
}) {
  return (
    <li className="group flex min-w-0 gap-3 border-t border-border/70 py-3 first:border-t-0 first:pt-0">
      {typeof rank === "number" ? (
        <span
          className="mt-0.5 w-5 shrink-0 text-right font-mono text-[11px] leading-5 text-muted-foreground/70 tabular-nums"
          aria-hidden
        >
          {rank}
        </span>
      ) : null}

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <SourceBadge
            source={item.source}
            when={when ?? day(item.occurredAt)}
          />
          {item.tags?.length ? (
            <span className="text-[11px] text-muted-foreground">
              {item.tags.map(tag => `#${tag}`).join(" ")}
            </span>
          ) : null}
        </div>

        <div className="mt-1 flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            {item.url ? (
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-medium leading-5 text-foreground underline decoration-transparent decoration-1 underline-offset-4 transition-colors hover:decoration-[color:var(--mc-emphasis)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {item.title}
                <ExternalLink
                  className="ml-1 inline size-3 align-[-1px] text-muted-foreground"
                  aria-hidden
                />
              </a>
            ) : (
              <span className="text-sm font-medium leading-5 text-foreground">
                {item.title}
              </span>
            )}
            <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
              {item.snippet || "No text to show for this one."}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {onRead ? (
              <button
                type="button"
                onClick={onRead}
                disabled={reading}
                className="inline-flex h-7 items-center gap-1.5 rounded-lg border bg-card px-2 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70"
                title={`Read this ${sourceLabel(item.source)} page's text into memory`}
              >
                {reading ? (
                  <LoaderCircle
                    className="mc-spin size-3 animate-spin"
                    aria-hidden
                  />
                ) : (
                  <BookOpen className="size-3" aria-hidden />
                )}
                {reading ? "Reading" : "Read in"}
              </button>
            ) : null}
            {onForget ? (
              <button
                type="button"
                onClick={onForget}
                className="inline-flex h-7 items-center rounded-lg border border-transparent px-2 text-[11px] text-muted-foreground opacity-0 transition-opacity hover:border-border hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100"
              >
                Forget
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </li>
  );
}
