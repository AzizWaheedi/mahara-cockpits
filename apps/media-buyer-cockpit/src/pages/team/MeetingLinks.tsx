import { ArrowUpRight, Loader2, Pencil, Plus, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { MeetingLink } from "../../../convex/teamDoc";

/**
 * What a meeting keeps open while it runs: its boards, docs and the
 * cockpit's own screens (the CEO, 2026-09-30: "link things that are useful
 * for that like slow clients calls maybe ads management board and
 * diagnosing and fixing constraints"). Each opens in a new tab, so the
 * meeting's page stays where it is. Anyone on the team edits them, like
 * the doc; the change log keeps what they were (team.saveLinks).
 */
export function MeetingLinks({
  links,
  onSave,
}: {
  links: MeetingLink[];
  onSave: (links: MeetingLink[]) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<MeetingLink[]>(links);
  const [busy, setBusy] = useState(false);

  const open = () => {
    setRows(links.length ? links : [{ label: "", url: "" }]);
    setEditing(true);
  };

  if (editing)
    return (
      <form
        className="grid gap-3 rounded-2xl border bg-card p-4 sm:p-6"
        onSubmit={async e => {
          e.preventDefault();
          setBusy(true);
          try {
            await onSave(rows.filter(r => r.url.trim() || r.label.trim()));
            setEditing(false);
          } catch {
            // The page shows the error; the rows stay for another try.
          } finally {
            setBusy(false);
          }
        }}
      >
        <div>
          <h2 className="text-[15px] font-semibold">Links</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            The boards, docs and screens this meeting works from. A link with no
            name shows its address.
          </p>
        </div>
        <ul className="grid gap-2">
          {rows.map((r, i) => (
            <li
              key={i}
              className="grid gap-2 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto]"
            >
              <Input
                value={r.label}
                onChange={e =>
                  setRows(
                    rows.map((x, j) =>
                      j === i ? { ...x, label: e.target.value } : x,
                    ),
                  )
                }
                placeholder="Name, e.g. Ads management board"
                aria-label={`Link ${i + 1} name`}
                maxLength={80}
                dir="auto"
              />
              <div className="flex gap-2">
                <Input
                  value={r.url}
                  onChange={e =>
                    setRows(
                      rows.map((x, j) =>
                        j === i ? { ...x, url: e.target.value } : x,
                      ),
                    )
                  }
                  placeholder="https://"
                  aria-label={`Link ${i + 1} address`}
                  inputMode="url"
                />
                <button
                  type="button"
                  aria-label={`Remove link ${i + 1}`}
                  onClick={() => setRows(rows.filter((_, j) => j !== i))}
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground pointer-coarse:size-10"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={rows.length >= 30}
            onClick={() => setRows([...rows, { label: "", url: "" }])}
          >
            <Plus aria-hidden /> Add a link
          </Button>
          <span className="flex-1" />
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setEditing(false)}
          >
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={busy}>
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
            Save links
          </Button>
        </div>
      </form>
    );

  return (
    <section
      aria-label="Links"
      className="flex flex-wrap items-center gap-x-2 gap-y-2"
    >
      <span className="mr-1 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
        Links
      </span>
      {links.length ? (
        links.map(l => (
          <a
            key={l.url}
            href={l.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-8 max-w-full items-center gap-1 rounded-full border px-3 text-xs transition-colors hover:border-primary/40 hover:bg-muted"
            dir="auto"
          >
            <span className="truncate">{l.label}</span>
            <ArrowUpRight
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-hidden
            />
          </a>
        ))
      ) : (
        <span className="text-sm text-muted-foreground">
          None yet. Add the boards and docs this meeting works from.
        </span>
      )}
      <button
        type="button"
        onClick={open}
        className="inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        {links.length ? (
          <>
            <Pencil className="size-3.5" aria-hidden /> Edit links
          </>
        ) : (
          <>
            <Plus className="size-3.5" aria-hidden /> Add links
          </>
        )}
      </button>
    </section>
  );
}
