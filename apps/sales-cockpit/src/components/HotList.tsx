import { Flame, Pencil, X } from "lucide-react";
import { type FormEvent, useState } from "react";
import { api } from "../lib/api";
import { useQuery } from "../lib/data";
import { callbackPicks, localInput } from "../lib/dialer";
import { when } from "../lib/format";
import { supabase } from "../lib/supabase";
import { toast } from "../lib/toast";
import type { Me } from "../lib/types";
import { button, buttonPrimary, field } from "./kit";

/**
 * The hot list on one lead: when to follow up next and how, the last
 * objection, a line of notes. A hot lead is ranked first in the dialer and
 * comes back at its follow-up time (sales-api hot.save / hot.remove).
 */

export interface HotRow {
  contact_id: string;
  owner_email: string;
  next_at: string | null;
  next_how: "call" | "whatsapp" | "email" | "meeting" | null;
  last_objection: string | null;
  note: string | null;
  added_by: string;
  added_at: string;
  updated_at: string;
  removed_at: string | null;
}

const HOW: [string, string][] = [
  ["call", "Call"],
  ["whatsapp", "WhatsApp"],
  ["email", "Email"],
  ["meeting", "Meeting"],
];

export function useHot(contactId: string) {
  return useQuery<HotRow | null>(
    () =>
      supabase
        .from("cockpit_sales_hot")
        .select("*")
        .eq("contact_id", contactId)
        .is("removed_at", null)
        .maybeSingle(),
    [contactId],
  );
}

export function HotControl({ me, contactId }: { me: Me; contactId: string }) {
  const hot = useHot(contactId);
  const row = hot.data ?? null;
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const mine = !row || me.manager || row.owner_email === me.email;

  async function remove() {
    setBusy(true);
    try {
      await api("hot.remove", {
        contact_id: contactId,
        why: "Taken off in the cockpit",
      });
      toast.success("Off the hot list.");
      hot.reload();
    } catch (e) {
      toast.error(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  }

  if (editing)
    return (
      <HotForm
        contactId={contactId}
        row={row}
        onDone={() => {
          setEditing(false);
          hot.reload();
        }}
        onCancel={() => setEditing(false)}
      />
    );
  if (!row)
    return (
      <button type="button" onClick={() => setEditing(true)} className={button}>
        <Flame className="size-3.5" aria-hidden /> Put on the hot list
      </button>
    );
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border px-2.5 py-1.5 text-xs"
      style={{
        borderColor: "color-mix(in oklch, var(--primary) 45%, transparent)",
        background: "color-mix(in oklch, var(--primary) 8%, transparent)",
      }}
    >
      <Flame
        className="size-3.5"
        style={{ color: "var(--primary)" }}
        aria-hidden
      />
      <span className="font-medium">Hot</span>
      <span className="muted">
        {[
          row.next_at ? `next ${when(row.next_at)}` : "no follow-up set",
          row.next_how
            ? `by ${HOW.find(([k]) => k === row.next_how)?.[1] ?? row.next_how}`
            : null,
          row.last_objection ? `last objection: ${row.last_objection}` : null,
          row.owner_email !== me.email
            ? `${row.owner_email.split("@")[0]}'s`
            : null,
        ]
          .filter(Boolean)
          .join(" · ")}
      </span>
      {mine ? (
        <>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="muted inline-flex items-center gap-0.5 underline-offset-2 hover:underline"
          >
            <Pencil className="size-3" aria-hidden /> Change
          </button>
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="muted inline-flex items-center gap-0.5 underline-offset-2 hover:underline"
          >
            <X className="size-3" aria-hidden /> Take off
          </button>
        </>
      ) : null}
    </div>
  );
}

function HotForm({
  contactId,
  row,
  onDone,
  onCancel,
}: {
  contactId: string;
  row: HotRow | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [nextAt, setNextAt] = useState(
    row?.next_at ? localInput(Date.parse(row.next_at)) : "",
  );
  const [how, setHow] = useState(row?.next_how ?? "call");
  const [objection, setObjection] = useState(row?.last_objection ?? "");
  const [note, setNote] = useState(row?.note ?? "");
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("hot.save", {
        contact_id: contactId,
        next_at: nextAt ? new Date(nextAt).toISOString() : null,
        next_how: how,
        last_objection: objection,
        note,
      });
      toast.success(
        row
          ? "Saved."
          : "On the hot list. The dialer brings them up at the follow-up time.",
      );
      onDone();
    } catch (err) {
      toast.error(String((err as Error).message ?? err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="panel w-full space-y-3 p-3">
      <p className="text-sm font-medium">
        <Flame className="me-1 inline size-3.5 align-[-2px]" aria-hidden />
        {row ? "The hot lead's next step" : "Put on the hot list"}
      </p>
      <div className="space-y-1">
        <span className="muted block text-xs">Follow up next</span>
        <div className="flex flex-wrap gap-1.5">
          {callbackPicks(Date.now()).map(p => (
            <button
              key={p.label}
              type="button"
              aria-pressed={nextAt === localInput(p.at)}
              onClick={() => setNextAt(localInput(p.at))}
              className={`rounded-full border px-2.5 py-0.5 text-xs ${
                nextAt === localInput(p.at)
                  ? "border-[color:var(--primary)] font-semibold"
                  : "hairline"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <input
          type="datetime-local"
          value={nextAt}
          onChange={e => setNextAt(e.target.value)}
          className={`${field} max-w-xs`}
        />
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="How">
        {HOW.map(([k, label]) => (
          <button
            key={k}
            type="button"
            aria-pressed={how === k}
            onClick={() => setHow(k as typeof how)}
            className={`rounded-full border px-2.5 py-0.5 text-xs ${
              how === k
                ? "border-[color:var(--primary)] font-semibold"
                : "hairline"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <label className="block space-y-1">
        <span className="muted block text-xs">Their last objection</span>
        <input
          value={objection}
          onChange={e => setObjection(e.target.value)}
          dir="auto"
          placeholder="Wants to talk to his partner first"
          className={field}
        />
      </label>
      <label className="block space-y-1">
        <span className="muted block text-xs">Notes</span>
        <textarea
          value={note}
          onChange={e => setNote(e.target.value)}
          rows={2}
          dir="auto"
          className={`${field} h-auto py-2`}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className={buttonPrimary}>
          {busy ? "Saving…" : row ? "Save" : "Put on the hot list"}
        </button>
        <button type="button" onClick={onCancel} className={button}>
          Cancel
        </button>
      </div>
    </form>
  );
}
