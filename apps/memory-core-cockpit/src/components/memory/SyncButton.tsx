import { LoaderCircle, RefreshCw } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { useSync } from "./useMemoryCore";

/**
 * "Sync now": pulls the newest from Notion, Gmail and Drive. Spins while it
 * runs and reports the result in words — the counts land on the Sources view
 * by themselves, because those are subscriptions.
 */
export function SyncButton({
  code,
  size = "md",
  label = "Sync now",
  className,
  onDone,
}: {
  code: string;
  /** md for the page header, sm inside cards. */
  size?: "sm" | "md";
  label?: string;
  className?: string;
  onDone?: (note: string | null, error: string | null) => void;
}) {
  const { run, busy, note, error } = useSync();
  const [localNote, setLocalNote] = useState<string | null>(null);
  const shown = localNote ?? note;

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={async () => {
          const result = await run(code);
          const nextNote = result
            ? result.inserted === 0
              ? "Synced — nothing new since last time."
              : `Synced ${result.inserted} new item${result.inserted === 1 ? "" : "s"}.`
            : null;
          setLocalNote(nextNote);
          onDone?.(nextNote, error);
        }}
        disabled={busy}
        aria-busy={busy}
        className={cn(
          "inline-flex items-center gap-2 rounded-lg border bg-card font-medium text-foreground transition-colors hover:bg-[var(--mc-emphasis-wash)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-80",
          size === "md" ? "h-9 px-3.5 text-sm" : "h-8 px-3 text-xs",
          className,
        )}
      >
        {busy ? (
          <LoaderCircle
            className="mc-spin size-4 animate-spin text-[color:var(--mc-emphasis)]"
            aria-hidden
          />
        ) : (
          <RefreshCw
            className="size-4 text-[color:var(--mc-emphasis)]"
            aria-hidden
          />
        )}
        <span>{busy ? "Syncing" : label}</span>
      </button>
      {!busy && shown ? (
        <span className="text-xs text-muted-foreground">{shown}</span>
      ) : null}
    </span>
  );
}
