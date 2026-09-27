import { Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { api } from "../lib/api";
import { ago } from "../lib/format";
import { toast } from "../lib/toast";
import type { Me, Note } from "../lib/types";
import { buttonPrimary, Failed, Reading } from "./kit";

const KIND_WORDS: Record<string, string> = {
  note: "Note",
  call: "Call notes",
  script: "From the script",
  ai: "AI notes",
  handoff: "Handover to the closer",
};

/**
 * Notes on a lead. A setter's handover is the one the closer reads before
 * the demo, so it can be marked as such; everything else is a plain note.
 * Notes stay in the cockpit (and in the audit log); nothing here is posted
 * to HighLevel. The parent owns the notes' read and says when it is still
 * on its way or failed, so the list never says "no notes" until it knows.
 */
export function NotesPanel({
  me,
  contactId,
  notes,
  onChange,
  loading = false,
  error = null,
  retry,
}: {
  me: Me;
  contactId: string;
  notes: Note[];
  onChange: () => void;
  /** The notes have not been read yet. */
  loading?: boolean;
  /** Why the notes could not be read. */
  error?: string | null;
  retry?: () => void;
}) {
  const [body, setBody] = useState("");
  const [handoff, setHandoff] = useState(false);
  const [busy, setBusy] = useState(false);
  const canHandoff = me.role === "setter" || me.role === "both" || me.manager;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    try {
      await api("note.add", {
        contact_id: contactId,
        body,
        kind: handoff ? "handoff" : "note",
      });
      setBody("");
      setHandoff(false);
      toast.success(
        handoff
          ? "Handover saved. The closer sees it on this lead."
          : "Note saved.",
      );
      onChange();
    } catch (err) {
      toast.error(String((err as Error).message ?? err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await api("note.delete", { id });
      toast.success("Note deleted.");
      onChange();
    } catch (err) {
      toast.error(String((err as Error).message ?? err));
    }
  }

  return (
    <div className="space-y-3">
      <form onSubmit={save} className="space-y-2">
        <label htmlFor="note-body" className="sr-only">
          New note
        </label>
        <textarea
          id="note-body"
          value={body}
          onChange={e => setBody(e.target.value)}
          rows={3}
          dir="auto"
          placeholder="What did you learn? Budget, timing, who decides, the objection…"
          className="w-full rounded-[var(--radius-md)] border hairline bg-[color:var(--background)] px-3 py-2 text-sm"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          {canHandoff ? (
            <label className="muted inline-flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={handoff}
                onChange={e => setHandoff(e.target.checked)}
              />
              Handover for the closer
            </label>
          ) : (
            <span />
          )}
          <button
            type="submit"
            disabled={busy || !body.trim()}
            className={buttonPrimary}
          >
            {busy ? "Saving…" : "Save note"}
          </button>
        </div>
      </form>
      {error ? (
        <Failed what="This lead's notes" error={error} retry={retry} />
      ) : loading ? (
        <Reading what="the notes" />
      ) : notes.length ? (
        <ul className="space-y-2">
          {notes.map(n => (
            <li
              key={n.id}
              className={`rounded-[var(--radius-md)] border px-3 py-2 ${
                n.kind === "handoff" ? "callout-good" : "hairline"
              }`}
            >
              <div className="muted flex items-center gap-2 text-xs">
                <span className="font-medium">
                  {KIND_WORDS[n.kind] ?? "Note"}
                </span>
                <span>·</span>
                <span>{n.author.split("@")[0]}</span>
                <span>·</span>
                <span title={n.created_at}>{ago(n.created_at)}</span>
                {n.author === me.email || me.manager ? (
                  <button
                    type="button"
                    onClick={() => remove(n.id)}
                    className="ml-auto opacity-60 hover:opacity-100"
                    aria-label="Delete note"
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                ) : null}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm" dir="auto">
                {n.body}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted text-sm">
          No notes yet. The first call's notes go here.
        </p>
      )}
    </div>
  );
}
