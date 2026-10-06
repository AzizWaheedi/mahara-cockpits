import { Check, Flame, X } from "lucide-react";
import { type ReactNode, useCallback, useState } from "react";
import { api } from "../lib/api";
import { useNow, useQuery } from "../lib/data";
import { when } from "../lib/format";
import {
  dueOf,
  followUpWords,
  type HotRow,
  heatOf,
  isOpen,
  lastFollowUp,
  newerRow,
  statusOf,
} from "../lib/hot";
import { supabase } from "../lib/supabase";
import { toast } from "../lib/toast";
import type { Me } from "../lib/types";
import {
  AmountEdit,
  FailedSaves,
  HeatPick,
  type HotField,
  LastShown,
  NextAsk,
  NextShown,
  type Phase,
  phaseClass,
  SaveMark,
  StatusPick,
  TextEdit,
  useHotEdits,
  WhenEdit,
} from "./HotCells";
import { useHotTouches } from "./HotSheet";
import { button, Failed } from "./kit";

/**
 * The hot list on one lead's page, with the sheet's fields (type, status,
 * amount, last and next follow-up, last objection, notes) edited in place,
 * each saved on its own (sales-api hot.save). A hot lead is ranked first in
 * the dialer and comes back at its next follow-up; the whole list is the
 * Pipeline page's Hot list (HotSheet.tsx).
 */

const DAY = 86_400_000;

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

/**
 * "Put on the hot list" is offered only once the read has come back and
 * found no row. It sends no fields, so even a row put there meanwhile by
 * someone else keeps everything it says.
 */
export function HotControl({
  me,
  contactId,
  name: givenName,
  phone8: givenPhone8,
}: {
  me: Me;
  contactId: string;
  /** The lead's name and last eight digits; read here when not given. */
  name?: string | null;
  phone8?: string | null;
}) {
  const hot = useHot(contactId);
  const given = givenPhone8 !== undefined;
  const lead = useQuery<{ name: string | null; phone8: string | null } | null>(
    () =>
      given
        ? Promise.resolve({ data: null, error: null })
        : supabase
            .from("cockpit_sales_leads")
            .select("name,phone8")
            .eq("contact_id", contactId)
            .maybeSingle(),
    [contactId, given],
  );
  const name = given ? (givenName ?? null) : (lead.data?.name ?? null);
  const phone8 = given ? givenPhone8 : (lead.data?.phone8 ?? null);
  // The row as this page's last save answered it: it stands while it is
  // newer than the read.
  const [saved, setSaved] = useState<HotRow | null>(null);
  // The read that was on screen when the lead was taken off here: until a
  // newer read lands, the row stays gone.
  const [gone, setGone] = useState<{ over: HotRow | null } | null>(null);
  const onSaved = useCallback((r: HotRow) => {
    setSaved(r);
    setGone(null);
  }, []);
  const edits = useHotEdits(onSaved);
  const now = useNow(60_000);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);

  const stored =
    gone && gone.over === hot.data ? null : newerRow(hot.data, saved);
  // The lead's own calls and WhatsApp, read only while they are on the list
  // (and once their digits are known, so unlinked calls count too).
  const touches = useHotTouches(
    stored && (given || lead.data !== null || !lead.loading)
      ? [{ contact_id: contactId, name, phone8 }]
      : null,
  );

  async function add() {
    setBusy(true);
    try {
      const out = await api<{ hot?: HotRow }>("hot.save", {
        contact_id: contactId,
      });
      if (out.hot) onSaved(out.hot);
      toast.success(
        "On the hot list. Set the next follow-up so the dialer brings them up.",
      );
    } catch (e) {
      toast.error(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api("hot.remove", {
        contact_id: contactId,
        why: "Taken off in the cockpit",
      });
      toast.success("Off the hot list.");
      setSaved(null);
      setAsking(false);
      setGone({ over: hot.data });
      hot.reload();
    } catch (e) {
      toast.error(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  }

  if (hot.error && !stored)
    return <Failed what="The hot list" error={hot.error} retry={hot.reload} />;
  if (hot.loading && !hot.data && !stored)
    return (
      <p className="muted inline-flex h-8 items-center text-xs">
        Reading the hot list…
      </p>
    );
  if (!stored)
    return (
      <button
        type="button"
        onClick={() => void add()}
        disabled={busy}
        className={button}
      >
        <Flame className="size-3.5" aria-hidden />
        {busy ? "Putting on the hot list…" : "Put on the hot list"}
      </button>
    );

  const r = edits.view(stored);
  const mine = Boolean(me.manager) || r.owner_email === me.email;
  const open = isOpen(r);
  const due = open ? dueOf(r.next_at, now) : null;
  const touch = touches.data?.get(contactId);
  const phase = (f: HotField) => edits.phase(contactId, f);
  const save = (f: HotField, body: Record<string, unknown>) =>
    edits.commit(contactId, f, body);
  const who = name?.trim() || "this lead";

  async function stamp() {
    if (await save("last_fu_at", { last_fu_at: new Date().toISOString() }))
      setAsking(true);
  }

  async function pickNext(at: number) {
    const iso = new Date(at).toISOString();
    if (!(await save("next_at", { next_at: iso }))) return;
    setAsking(false);
    toast.success(`Next follow-up with ${who}: ${when(iso)}.`);
  }

  return (
    <section
      aria-label="Hot list"
      className="@container panel w-full max-w-4xl space-y-2.5 p-3"
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1.5 text-sm font-medium">
          <Flame
            className="size-3.5"
            style={{ color: "var(--primary)" }}
            aria-hidden
          />
          On the hot list
          {r.owner_email !== me.email ? (
            <span className="muted font-normal">
              · {r.owner_email.split("@")[0]}'s
            </span>
          ) : null}
        </span>
        {mine ? (
          <span className="ms-auto flex items-center gap-3 text-xs">
            {open ? (
              <button
                type="button"
                onClick={() => void stamp()}
                disabled={phase("last_fu_at")?.phase === "saving"}
                title="Mark the last follow-up as now, then pick the next one"
                className="no-touch relative inline-flex items-center gap-1 font-medium after:absolute after:-inset-2 hover:text-[color:var(--primary)] disabled:opacity-60"
              >
                <Check className="size-3.5" aria-hidden /> Followed up
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void remove()}
              disabled={busy}
              className="no-touch muted relative inline-flex items-center gap-1 after:absolute after:-inset-2 hover:text-[color:var(--foreground)]"
            >
              <X className="size-3.5" aria-hidden /> Take off the list
            </button>
          </span>
        ) : null}
      </header>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] @md:grid-cols-3 @2xl:grid-cols-5">
        <Field label="Type" phase={phase("heat")}>
          <HeatPick
            value={heatOf(r)}
            readOnly={!mine}
            onPick={v => void save("heat", { heat: v })}
          />
        </Field>
        <Field label="Status" phase={phase("status")}>
          <StatusPick
            value={statusOf(r)}
            readOnly={!mine}
            onPick={v => void save("status", { status: v })}
          />
        </Field>
        <Field label="Amount" phase={phase("amount")}>
          <AmountEdit
            amount={r.amount}
            currency={r.amount_currency}
            readOnly={!mine}
            align="left"
            onCommit={v => void save("amount", v)}
          />
        </Field>
        <Field label="Last follow-up" phase={phase("last_fu_at")}>
          <WhenEdit
            label="Last follow-up"
            value={r.last_fu_at}
            min={now - 366 * DAY}
            max={now}
            readOnly={!mine}
            onCommit={v => void save("last_fu_at", { last_fu_at: v })}
          >
            <LastShown
              last={lastFollowUp(r.last_fu_at, touch)}
              words={followUpWords(
                r.last_fu_at,
                touch,
                Boolean(touches.error),
                now,
              )}
              now={now}
            />
          </WhenEdit>
        </Field>
        <Field label="Next follow-up" phase={phase("next_at")}>
          <WhenEdit
            label="Next follow-up"
            value={r.next_at}
            min={now - DAY}
            max={now + 366 * DAY}
            readOnly={!mine}
            onCommit={v => void save("next_at", { next_at: v })}
          >
            <NextShown at={r.next_at} due={due} open={open} now={now} />
          </WhenEdit>
        </Field>
      </div>
      <div className="grid gap-x-4 gap-y-2 text-[13px] @md:grid-cols-2">
        <Field label="Last objection" phase={phase("last_objection")}>
          <TextEdit
            label="Last objection"
            value={r.last_objection}
            max={500}
            empty="No objection noted yet."
            readOnly={!mine}
            onCommit={v => void save("last_objection", { last_objection: v })}
          />
        </Field>
        <Field label="Notes" phase={phase("note")}>
          <TextEdit
            label="Notes"
            value={r.note}
            max={4000}
            multiline
            empty="No notes yet."
            readOnly={!mine}
            onCommit={v => void save("note", { note: v })}
          />
        </Field>
      </div>

      {asking ? (
        <div className="rounded-[var(--radius-md)] bg-[color:var(--secondary)] px-2.5 py-2">
          <NextAsk
            name={who}
            busy={phase("next_at")?.phase === "saving"}
            onPick={at => void pickNext(at)}
            onClose={() => setAsking(false)}
          />
        </div>
      ) : null}
      {edits.failures(contactId).length ? (
        <div className="callout-bad rounded-[var(--radius-md)] border px-2.5 py-1.5">
          <FailedSaves
            list={edits.failures(contactId)}
            onRetry={f => edits.retry(contactId, f)}
            onUndo={f => edits.undo(contactId, f)}
          />
        </div>
      ) : null}
      {touches.error ? (
        <p className="muted text-xs">
          Calls and WhatsApp could not be read ({touches.error}), so Last
          follow-up shows only what was marked by hand.
        </p>
      ) : null}
    </section>
  );
}

/** One field of the hot row: its name above, its value (or editor) below. */
function Field({
  label,
  phase,
  children,
}: {
  label: string;
  phase?: Phase;
  children: ReactNode;
}) {
  return (
    <div
      className={`relative min-w-0 rounded-[var(--radius-md)] ${phaseClass(phase)}`}
    >
      <span className="muted block px-1.5 text-[11px] font-medium">
        {label}
      </span>
      {children}
      <SaveMark phase={phase} className="absolute right-1.5 top-1" />
    </div>
  );
}
