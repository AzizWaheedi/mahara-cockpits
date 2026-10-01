import { ArrowUpRight, Check, Loader2, Pencil, Plus, X } from "lucide-react";
import { type FormEvent, useState } from "react";
import { linkName, type MeetingLink } from "../../../convex/teamDoc";

/**
 * What a meeting keeps open while it runs: its boards, docs and the
 * cockpit's own screens (the CEO, 2026-09-30: "link things that are useful
 * for that"; 2026-10-01: "make everything simple and easy to use and easily
 * editable for all meetings"). Each opens in a new tab, so the meeting's
 * page stays where it is.
 *
 * Editing happens in place: paste a link and press Enter (a known board or
 * screen names itself), click a name to rename it, the cross takes it off.
 * Every change saves at once; anyone on the team can make it, and the
 * change log keeps what the links were (team.saveLinks).
 */
export function MeetingLinks({
  links,
  onSave,
}: {
  links: MeetingLink[];
  onSave: (links: MeetingLink[]) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async (next: MeetingLink[]): Promise<boolean> => {
    setBusy(true);
    try {
      await onSave(next);
      return true;
    } catch {
      // The page shows the server's sentence.
      return false;
    } finally {
      setBusy(false);
    }
  };

  /** "https://…", or "A name https://…" to name it while pasting. */
  const add = async (e: FormEvent) => {
    e.preventDefault();
    const text = adding.trim();
    if (!text) return;
    const m = text.match(/(https?:\/\/\S+|\b[\w-]+(\.[\w-]+)+\S*)$/);
    const raw = m ? m[1] : text;
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const label = (m ? text.slice(0, m.index).trim() : "") || linkName(url);
    if (await save([...links, { label, url }])) setAdding("");
  };

  return (
    <section
      aria-label="Links"
      className="flex flex-wrap items-center gap-x-2 gap-y-2"
    >
      <span className="mr-1 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
        Links
      </span>
      {links.map((l, i) =>
        editing ? (
          <EditableLink
            key={l.url}
            link={l}
            disabled={busy}
            onRename={label =>
              save(links.map((x, j) => (j === i ? { ...x, label } : x)))
            }
            onRemove={() => save(links.filter((_, j) => j !== i))}
          />
        ) : (
          <a
            key={l.url}
            href={l.url}
            target="_blank"
            rel="noopener noreferrer"
            title={l.url}
            className="inline-flex h-8 max-w-full items-center gap-1 rounded-full border px-3 text-xs transition-colors hover:border-primary/40 hover:bg-muted"
          >
            <bdi className="truncate">{l.label}</bdi>
            <ArrowUpRight
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-hidden
            />
          </a>
        ),
      )}
      {!links.length && !editing ? (
        <span className="text-sm text-muted-foreground">
          None yet. Add the boards and docs this meeting works from.
        </span>
      ) : null}
      {editing ? (
        <>
          <form onSubmit={add} className="flex items-center gap-1">
            <input
              // biome-ignore lint/a11y/noAutofocus: opened by the person's own click on Edit links
              autoFocus
              value={adding}
              onChange={e => setAdding(e.target.value)}
              placeholder="Paste a link, then Enter"
              aria-label="Add a link: paste its address, then press Enter"
              className="h-8 w-64 max-w-full rounded-full border border-dashed border-input bg-transparent px-3 text-xs focus-visible:border-primary/60 focus-visible:outline-none"
            />
            {busy ? (
              <Loader2
                className="size-3.5 animate-spin text-muted-foreground"
                aria-hidden
              />
            ) : null}
          </form>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setAdding("");
            }}
            className="inline-flex h-8 items-center gap-1 rounded-full bg-primary/15 px-3 text-xs font-medium ring-1 ring-inset ring-primary/40"
          >
            <Check className="size-3.5" aria-hidden /> Done
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
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
      )}
    </section>
  );
}

/** A link while editing: its name renames in place, the cross takes it off. */
function EditableLink({
  link,
  disabled,
  onRename,
  onRemove,
}: {
  link: MeetingLink;
  disabled: boolean;
  onRename: (label: string) => Promise<boolean>;
  onRemove: () => Promise<boolean>;
}) {
  const [renaming, setRenaming] = useState(false);
  const [label, setLabel] = useState(link.label);
  const finish = async () => {
    const next = label.replace(/\s+/g, " ").trim();
    if (!next || next === link.label) {
      setLabel(link.label);
      setRenaming(false);
      return;
    }
    if (await onRename(next)) setRenaming(false);
  };
  return (
    <span className="inline-flex h-8 max-w-full items-center gap-0.5 rounded-full border border-primary/30 bg-muted/40 pl-3 pr-1 text-xs">
      {renaming ? (
        <input
          // biome-ignore lint/a11y/noAutofocus: opened by a click on the name itself
          autoFocus
          value={label}
          maxLength={80}
          onChange={e => setLabel(e.target.value)}
          onBlur={() => void finish()}
          onKeyDown={e => {
            if (e.key === "Enter") {
              e.preventDefault();
              void finish();
            }
            if (e.key === "Escape") {
              setLabel(link.label);
              setRenaming(false);
            }
          }}
          aria-label={`New name for ${link.label}`}
          className="h-6 w-44 bg-transparent text-xs focus-visible:outline-none"
          dir="auto"
        />
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => setRenaming(true)}
          title={`${link.url} · click to rename`}
          className="max-w-[16rem] truncate text-left underline-offset-2 hover:underline"
        >
          <bdi>{link.label}</bdi>
        </button>
      )}
      <button
        type="button"
        disabled={disabled}
        onClick={() => void onRemove()}
        aria-label={`Remove ${link.label}`}
        title="Remove"
        className="flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40 pointer-coarse:size-8"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </span>
  );
}
