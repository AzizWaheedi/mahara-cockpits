import { BookmarkPlus } from "lucide-react";
import { useState } from "react";
import { EmptyState } from "@/components/memory/EmptyState";
import { count, relative } from "@/components/memory/format";
import { ResultRow } from "@/components/memory/ResultRow";
import { SectionCard } from "@/components/memory/SectionCard";
import {
  useForgetMemory,
  useMemories,
  useSaveMemory,
} from "@/components/memory/useMemoryCore";
import { useNow } from "@/components/memory/useNow";

/**
 * Memories: the facts Aziz tells the core directly.
 *
 * This is the one place the memory core learns something nobody emailed,
 * saved to Drive or wrote in Notion — "favourite colour is green" — and it
 * then behaves exactly like everything else: it comes back in search, and an
 * answer can cite it.
 */
export function MemoriesView({ code }: { code: string }) {
  const [text, setText] = useState("");
  const [tags, setTags] = useState("");
  const [justSaved, setJustSaved] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const { run: save, busy, error } = useSaveMemory();
  const memories = useMemories(code, 100);
  const forget = useForgetMemory();
  const now = useNow();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const clean = text.trim();
    if (!clean) return;
    const ok = await save(
      code,
      clean,
      tags
        .split(",")
        .map(tag => tag.trim())
        .filter(Boolean),
    );
    if (ok) {
      setText("");
      setTags("");
      setJustSaved(clean.split("\n")[0].slice(0, 80));
    }
  };

  const shown = (memories ?? []).filter(memory => {
    if (!filter.trim()) return true;
    const needle = filter.trim().toLowerCase();
    return `${memory.title} ${memory.snippet}`.toLowerCase().includes(needle);
  });

  return (
    <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <SectionCard
        kicker="Memories"
        title={`${count(memories?.length ?? null)} saved`}
        actions={
          <input
            type="search"
            value={filter}
            onChange={event => setFilter(event.target.value)}
            placeholder="Filter by words"
            aria-label="Filter memories"
            className="h-8 w-44 rounded-lg border bg-background px-2.5 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        }
        notes={
          justSaved
            ? [
                {
                  level: "info",
                  text: `Saved: “${justSaved}”. It is searchable now, and an answer can cite it.`,
                },
              ]
            : null
        }
      >
        {shown.length ? (
          <ul className="min-w-0">
            {shown.map(memory => (
              <ResultRow
                key={memory.id}
                item={{ ...memory, source: "note", key: memory.id }}
                when={relative(memory.occurredAt, now)}
                onForget={() => void forget(code, memory.id)}
              />
            ))}
          </ul>
        ) : memories && memories.length > 0 ? (
          <EmptyState
            title="No memory matches that filter"
            text="Clear the filter to see all of them."
            compact
          />
        ) : (
          <EmptyState
            title="Nothing saved yet"
            text="Write the first thing worth keeping — a preference, a decision, a name you want to remember — in the box beside this card."
            compact
          />
        )}
      </SectionCard>

      <SectionCard
        kicker="Save"
        title="A fact worth keeping"
        order={1}
        className="h-fit lg:sticky lg:top-4"
        notes={[
          {
            level: "info",
            text: "Saved memories are written straight into the same index the synced sources use, so one search still finds everything.",
          },
        ]}
      >
        <form onSubmit={submit} className="space-y-3">
          <textarea
            value={text}
            onChange={event => setText(event.target.value)}
            rows={5}
            placeholder="Aziz prefers meetings in the morning, never after 4pm Kuwait time."
            aria-label="The memory to save"
            className="w-full resize-y rounded-xl border bg-background p-3 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <input
            type="text"
            value={tags}
            onChange={event => setTags(event.target.value)}
            placeholder="Tags, comma separated (optional)"
            aria-label="Tags"
            className="h-9 w-full rounded-lg border bg-background px-2.5 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {error ? (
            <p className="text-xs leading-relaxed text-foreground">{error}</p>
          ) : null}
          <button
            type="submit"
            disabled={busy || !text.trim()}
            className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          >
            <BookmarkPlus className="size-4" aria-hidden />
            {busy ? "Saving" : "Save this memory"}
          </button>
        </form>
      </SectionCard>
    </div>
  );
}
