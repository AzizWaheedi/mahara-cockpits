import { CalendarPlus, Check, Flame, Hourglass } from "lucide-react";
import { type FormEvent, type ReactNode, useRef, useState } from "react";
import { api, uncertain } from "../lib/api";
import { dayAt } from "../lib/setterDay";
import { toast } from "../lib/toast";
import type { CalendarRow, MarkStatus } from "../lib/types";
import { AfterCall } from "./AfterCall";
import { button, buttonPrimary } from "./kit";
import { MarkControls } from "./MarkControls";

/**
 * The dialer's steps around a held intro (Aziz's Loom, 2026-11-05):
 * - Mark the intro: the rep's own call past its twenty minutes with no
 *   mark, marked here with the same controls as Today (Showed, Didn't
 *   happen with its five-second Undo, Disqualify).
 * - What next, once it was held: book the demo in the closer's soonest
 *   slot (qualified), the long-term nurture (qualified but not ready for a
 *   real reason, not a disqualification), or the hot list (showed, no demo
 *   yet), with the 1 to 10 rating and why no demo underneath.
 */

/** Mark the rep's own call: did it happen? */
export function MarkStep({
  row,
  noShowHeld = false,
  compact = false,
  onMarked,
}: {
  /** The call's calendar row (dial.queue mark_call). */
  row: CalendarRow;
  /** The lead's video room is open: Didn't happen waits (MarkControls). */
  noShowHeld?: boolean;
  /** One line under another item's work, not the pane's main step. */
  compact?: boolean;
  onMarked: (status: MarkStatus) => void;
}) {
  const noun = row.call_type === "demo" ? "demo" : "intro";
  const at = dayAt(row.start_at);
  if (compact)
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius-md)] border hairline px-3 py-2">
        <p className="min-w-0 flex-1 text-xs">
          <span className="font-medium">Also owed:</span> mark the {noun}
          {at ? ` booked for ${at}` : ""}.
        </p>
        <MarkControls
          row={row}
          variant="row"
          compact
          noShowHeld={noShowHeld}
          onDone={() => {}}
          onMarked={onMarked}
        />
      </div>
    );
  return (
    <div className="space-y-2 border-t hairline pt-4">
      <p className="text-sm font-medium">Did the {noun} happen?</p>
      <p className="muted text-xs">
        Didn't happen sends HighLevel's no-show message after five seconds; Undo
        stops it until then.
      </p>
      <MarkControls
        row={row}
        variant="row"
        noShowHeld={noShowHeld}
        onDone={() => {}}
        onMarked={onMarked}
      />
    </div>
  );
}

/**
 * After the intro is held. Book the demo is the teal button; Add to hot
 * list is one press; Not ready yet asks why in a line (it goes on the lead
 * in HighLevel), then saves them to the long-term nurture.
 */
export function HeldNext({
  contactId,
  row,
  hot,
  onBookDemo,
  onCallback,
  onNotReady,
  next,
}: {
  contactId: string;
  /** The held call, for the rating and why no demo. */
  row: CalendarRow | null;
  /** "on": on the hot list already (or just added); "offer": one press adds it. */
  hot: "offer" | "on";
  onBookDemo: () => void;
  onCallback: () => void;
  /** Saves Not ready yet with the rep's line; throws what the server said. */
  onNotReady: (note: string) => Promise<void>;
  next: ReactNode;
}) {
  const [hotNow, setHotNow] = useState(hot);
  const [hotAt, setHotAt] = useState<string | null>(null);
  const [hotBusy, setHotBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const [doubt, setDoubt] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  async function addHot() {
    if (hotBusy || hotNow === "on") return;
    setHotBusy(true);
    try {
      const out = await api<{
        hot?: { next_at?: string | null } | null;
        repeated?: boolean;
      }>("dial.hot", { contact_id: contactId });
      const at = out.hot?.next_at ?? null;
      setHotNow("on");
      setHotAt(at);
      toast.success(
        out.repeated
          ? "Already on the hot list."
          : `On the hot list.${at ? ` Follow up ${dayAt(at)}.` : ""}`,
      );
    } catch (e) {
      toast.error(String((e as Error)?.message ?? e));
    } finally {
      setHotBusy(false);
    }
  }

  async function notReady(e: FormEvent) {
    e.preventDefault();
    if (busy || why.trim().length < 3) return;
    setBusy(true);
    setDoubt(null);
    try {
      await onNotReady(why.trim());
    } catch (err) {
      if (uncertain(err))
        setDoubt(
          "No clear answer came back, so it may be saved already. Press Save again: the dialer keeps a save only once.",
        );
      else toast.error(String((err as Error)?.message ?? err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 border-t hairline pt-4">
      <div className="space-y-1">
        <p className="text-sm font-medium">
          The intro is marked held. What next?
        </p>
        <p className="muted text-xs">
          Qualified: book the demo in the closer's soonest slot, even five
          minutes from now. Qualified but not ready for a real reason: the
          long-term nurture, not a disqualification. Held but no demo yet: the
          hot list.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {/* One teal button: Save to the nurture holds it while that is open. */}
        <button
          type="button"
          onClick={onBookDemo}
          className={asking ? button : buttonPrimary}
        >
          <CalendarPlus className="size-3.5" aria-hidden /> Book the demo
        </button>
        <button
          type="button"
          onClick={() => void addHot()}
          disabled={hotBusy || hotNow === "on"}
          className={button}
          title={
            hotNow === "on"
              ? "They are on the hot list"
              : "Adds them to the hot list, followed up the next working morning"
          }
        >
          {hotNow === "on" ? (
            <Check className="size-3.5" aria-hidden />
          ) : (
            <Flame className="size-3.5" aria-hidden />
          )}
          {hotBusy
            ? "Adding…"
            : hotNow === "on"
              ? "On the hot list"
              : "Add to hot list"}
        </button>
        <button
          type="button"
          aria-expanded={asking}
          onClick={() => {
            setAsking(a => !a);
            window.setTimeout(() => field.current?.focus(), 0);
          }}
          className={button}
        >
          <Hourglass className="size-3.5" aria-hidden /> Not ready yet (nurture)
        </button>
        <button type="button" onClick={onCallback} className={button}>
          Set a call-back
        </button>
        {next}
      </div>
      {hotNow === "on" && hotAt ? (
        <p className="muted text-xs">
          On the hot list: the follow-up is {dayAt(hotAt)}.
        </p>
      ) : null}
      {asking ? (
        <form
          onSubmit={e => void notReady(e)}
          className="space-y-2 rounded-[var(--radius-md)] border hairline p-3"
        >
          <label className="block space-y-1">
            <span className="muted block text-xs">
              Why not now? It goes on the lead in HighLevel too.
            </span>
            <textarea
              ref={field}
              value={why}
              onChange={e => setWhy(e.target.value)}
              rows={2}
              dir="auto"
              required
              minLength={3}
              placeholder="Selling the business; back in six months"
              className="w-full rounded-[var(--radius-md)] border hairline bg-[color:var(--background)] px-3 py-2 text-sm"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={busy || why.trim().length < 3}
              className={buttonPrimary}
            >
              {busy ? "Saving…" : "Save to the nurture"}
            </button>
            <button
              type="button"
              onClick={() => setAsking(false)}
              className={button}
            >
              Back
            </button>
            <span className="muted text-xs">
              Not a disqualification: they stay a lead for later.
            </span>
          </div>
          {doubt ? (
            <p
              role="status"
              className="callout-warn rounded-[var(--radius-md)] border px-3 py-2 text-xs"
            >
              {doubt}
            </p>
          ) : null}
        </form>
      ) : null}
      {row ? (
        <div className="pt-1">
          <AfterCall row={row} canEdit whyWords="No demo? Say why" />
        </div>
      ) : null}
    </div>
  );
}
