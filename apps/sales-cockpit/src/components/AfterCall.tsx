import { Check, CircleCheck, Pencil } from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useId,
  useState,
} from "react";
import { Link } from "react-router";
import {
  asksWhy,
  heldCall,
  type NoDemoReason,
  outcomeMissing,
  qualityTone,
  REASON_GROUPS,
  reasonLabel,
} from "../lib/afterCall";
import { api } from "../lib/api";
import { callType, when } from "../lib/format";
import { toast } from "../lib/toast";
import type { CalendarRow, Me } from "../lib/types";
import { SectionCard } from "./kit";

/**
 * After the call (Aziz, 2026-10-29): on every intro or demo held, the lead's
 * quality from 1 to 10, and on a held intro that booked no demo, why. A press
 * saves it (sales-api call.outcome); nothing goes to HighLevel, so there is
 * no hold and no Undo, and a second press changes the answer.
 *
 * Open while something is missing; then one line with the answers and a
 * Change. The end of day waits on it (lib/afterCall outcomeMissing).
 */

const TONE: Record<"bad" | "watch" | "good", string> = {
  bad: "var(--destructive)",
  watch: "var(--warning)",
  good: "var(--primary)",
};

/** The ten cells, filled up to the score in its band's colour: the scale and its read-back. */
export function QualityGauge({
  value,
  size = "sm",
}: {
  value: number | null;
  size?: "sm" | "md";
}) {
  const color = value === null ? null : TONE[qualityTone(Math.round(value))];
  return (
    <span
      aria-hidden
      className={`inline-grid shrink-0 grid-cols-10 ${size === "sm" ? "w-14 gap-[2px]" : "w-24 gap-[3px]"}`}
    >
      {Array.from({ length: 10 }, (_, i) => {
        const on = value !== null && i + 1 <= Math.round(value);
        return (
          <span
            key={i}
            className={`${size === "sm" ? "h-2" : "h-2.5"} rounded-[2px]`}
            style={{
              background: on
                ? (color ?? undefined)
                : "color-mix(in oklch, var(--foreground) 12%, transparent)",
            }}
          />
        );
      })}
    </span>
  );
}

function Scale({
  value,
  busy,
  onPick,
  labelId,
}: {
  value: number | null;
  busy: boolean;
  onPick: (n: number) => void;
  labelId: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value;
  const color = shown === null ? null : TONE[qualityTone(shown)];
  return (
    <div className="w-full max-w-[24rem]">
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        className="grid grid-cols-10 gap-1"
        onMouseLeave={() => setHover(null)}
      >
        {Array.from({ length: 10 }, (_, i) => {
          const n = i + 1;
          const on = shown !== null && n <= shown;
          const chosen = value === n;
          const style: CSSProperties = on
            ? {
                background: `color-mix(in oklch, ${color} ${hover !== null && !chosen ? 16 : 24}%, transparent)`,
                borderColor: `color-mix(in oklch, ${color} ${chosen ? 85 : 35}%, transparent)`,
              }
            : {};
          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={chosen}
              aria-label={`${n} out of 10`}
              disabled={busy}
              onMouseEnter={() => setHover(n)}
              onFocus={() => setHover(n)}
              onBlur={() => setHover(null)}
              onClick={() => onPick(n)}
              style={style}
              className={`h-9 rounded-[10px] border border-white/10 text-xs tabular-nums transition-[background-color,border-color,transform] duration-150 active:scale-[0.94] disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring)] pointer-coarse:h-10 ${
                chosen ? "font-semibold" : "font-medium"
              } ${on ? "text-[color:var(--foreground)]" : "muted hover:text-[color:var(--foreground)]"}`}
            >
              {n}
            </button>
          );
        })}
      </div>
      <div className="muted mt-1 flex justify-between text-[11px]">
        <span>Poor fit</span>
        <span>Ideal client</span>
      </div>
    </div>
  );
}

const PILL =
  "inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-xs font-medium transition-colors disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring)] pointer-coarse:h-10";
const PILL_ON =
  "border-transparent bg-[color:color-mix(in_oklch,var(--primary)_15%,transparent)] text-[color:var(--foreground)] ring-1 ring-[color:color-mix(in_oklch,var(--primary)_45%,transparent)] ring-inset";
const PILL_OFF =
  "hairline text-[color:var(--foreground)] hover:bg-[color:var(--muted)]";

function Reason({
  on,
  busy,
  onClick,
  children,
}: {
  on: boolean;
  busy: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={busy}
      onClick={onClick}
      className={`${PILL} ${on ? PILL_ON : PILL_OFF}`}
    >
      {on ? <Check className="size-3.5" aria-hidden /> : null}
      {children}
    </button>
  );
}

/** What the row says once answered: the gauge, the score, and why no demo or where it went. */
function Summary({
  row,
  quality,
  reason,
  note,
  saved,
  onChange,
}: {
  row: CalendarRow;
  quality: number | null;
  reason: string | null;
  note: string | null;
  saved: boolean;
  onChange: (() => void) | null;
}) {
  const next = row.demo_after_at
    ? `Booked a demo · ${when(row.demo_after_at)}`
    : row.signed_after
      ? "Signed"
      : reason
        ? `No demo: ${reason === "other" && note ? note : reasonLabel(reason)}`
        : null;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
      {quality !== null ? (
        <span className="inline-flex items-center gap-1.5">
          <QualityGauge value={quality} />
          <span className="font-semibold tabular-nums">{quality}/10</span>
          <span className="muted">lead quality</span>
        </span>
      ) : (
        <span className="muted">Lead not rated</span>
      )}
      {next ? (
        <span className="min-w-0 [overflow-wrap:anywhere]">
          <span className="muted">· </span>
          <bdi>{next}</bdi>
        </span>
      ) : null}
      {saved ? (
        <span className="inline-flex items-center gap-1 txt-now">
          <CircleCheck className="size-3.5" aria-hidden />
          Saved
        </span>
      ) : null}
      {onChange ? (
        <button
          type="button"
          onClick={onChange}
          className="muted inline-flex items-center gap-1 underline-offset-2 hover:text-[color:var(--foreground)] hover:underline"
        >
          <Pencil className="size-3" aria-hidden />
          Change
        </button>
      ) : null}
    </div>
  );
}

export function AfterCall({
  row,
  canEdit,
  onSaved,
  framed = true,
  whyWords = "No demo booked. Why?",
}: {
  row: CalendarRow;
  /** The question over the reasons ("No demo? Say why" while Book the demo is beside it). */
  whyWords?: string;
  /** The host or a manager (sales-api refuses anyone else). */
  canEdit: boolean;
  /** The answer landed: the parent reads its list again. */
  onSaved?: () => void;
  /** A panel of its own (false inside a card that is already one). */
  framed?: boolean;
}) {
  const ids = useId();
  const [quality, setQuality] = useState<number | null>(
    row.lead_quality ?? null,
  );
  const [reason, setReason] = useState<string | null>(
    row.no_demo_reason ?? null,
  );
  const [note, setNote] = useState(row.no_demo_note ?? "");
  const [typing, setTyping] = useState(row.no_demo_reason === "other");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // The row as read again (another tab, a manager) carries the answers.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when the stored answers change, never mid-save
  useEffect(() => {
    if (busy) return;
    setQuality(row.lead_quality ?? null);
    setReason(row.no_demo_reason ?? null);
    setNote(row.no_demo_note ?? "");
  }, [row.lead_quality, row.no_demo_reason, row.no_demo_note]);

  useEffect(() => {
    if (savedAt === null) return;
    const t = window.setTimeout(() => setSavedAt(null), 2500);
    return () => window.clearTimeout(t);
  }, [savedAt]);

  if (!heldCall(row)) return null;
  const why = asksWhy(row);
  const local: CalendarRow = {
    ...row,
    lead_quality: quality,
    no_demo_reason: reason,
  };
  const missing = outcomeMissing(local);
  const open = canEdit && (missing || editing);

  async function save(patch: {
    lead_quality?: number;
    no_demo_reason?: NoDemoReason;
    no_demo_note?: string;
  }) {
    const before = { quality, reason, note };
    if (patch.lead_quality !== undefined) setQuality(patch.lead_quality);
    if (patch.no_demo_reason !== undefined) setReason(patch.no_demo_reason);
    setBusy(true);
    try {
      await api("call.outcome", {
        appointment_id: row.appointment_id,
        ...patch,
      });
      // Filling in, the panel folds to its line once nothing is missing;
      // after Change it stays open until Done. A list of calls still owed
      // answers drops the call then, so the toast says what was kept.
      setSavedAt(Date.now());
      const q = patch.lead_quality ?? quality;
      const r = patch.no_demo_reason ?? reason;
      if (
        missing &&
        !outcomeMissing({ ...local, lead_quality: q, no_demo_reason: r })
      )
        toast.success(
          `Saved for ${row.contact_name?.trim() || "the lead"}: ${q}/10${
            why && r ? `, ${reasonLabel(r).toLowerCase()}` : ""
          }.`,
        );
      onSaved?.();
    } catch (e) {
      setQuality(before.quality);
      setReason(before.reason);
      setNote(before.note);
      toast.error(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  }

  const body = open ? (
    <div className="space-y-4">
      <div className="space-y-2">
        <p id={`${ids}-q`} className="text-sm font-medium">
          How good is this lead?
          {row.call_type === "demo" ? null : (
            <span className="muted font-normal"> From your intro.</span>
          )}
        </p>
        <Scale
          value={quality}
          busy={busy}
          labelId={`${ids}-q`}
          onPick={n => void save({ lead_quality: n })}
        />
      </div>

      {row.demo_after_at ? (
        <p className="inline-flex items-center gap-1.5 text-xs">
          <CircleCheck className="size-3.5 txt-now" aria-hidden />
          Booked a demo · {when(row.demo_after_at)}
        </p>
      ) : row.signed_after && row.call_type === "intro" ? (
        <p className="inline-flex items-center gap-1.5 text-xs">
          <CircleCheck className="size-3.5 txt-now" aria-hidden />
          They signed: no demo needed
        </p>
      ) : why ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{whyWords}</legend>
          <div className="flex flex-wrap gap-1.5">
            <Reason
              on={reason === "signed"}
              busy={busy}
              onClick={() => {
                setTyping(false);
                void save({ no_demo_reason: "signed" });
              }}
            >
              They signed on this call
            </Reason>
          </div>
          {REASON_GROUPS.map(g => (
            <div
              key={g.label}
              className="grid gap-1.5 sm:grid-cols-[6.5rem_minmax(0,1fr)] sm:items-baseline"
            >
              <span className="muted text-[11px] font-medium uppercase tracking-wide">
                {g.label}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {g.reasons.map(r => (
                  <Reason
                    key={r.key}
                    on={reason === r.key}
                    busy={busy}
                    onClick={() => {
                      setTyping(false);
                      void save({ no_demo_reason: r.key });
                    }}
                  >
                    {r.label}
                  </Reason>
                ))}
              </div>
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-1.5">
            <Reason
              on={reason === "other" || typing}
              busy={busy}
              onClick={() => setTyping(true)}
            >
              Other…
            </Reason>
            {typing ? (
              <form
                className="flex min-w-0 flex-1 basis-56 items-center gap-1.5"
                onSubmit={e => {
                  e.preventDefault();
                  if (note.trim().length >= 3)
                    void save({
                      no_demo_reason: "other",
                      no_demo_note: note.trim(),
                    });
                }}
              >
                <input
                  aria-label="Why no demo, in a few words"
                  className="h-8 min-w-0 flex-1 rounded-full border border-white/10 bg-[color:var(--background)] px-3 text-xs placeholder:text-[color:var(--muted-foreground)] transition-all focus:border-[color:var(--ring)] focus:outline-none focus:ring-1 focus:ring-[color:var(--ring)] pointer-coarse:h-10"
                  value={note}
                  maxLength={500}
                  onChange={e => setNote(e.target.value)}
                  placeholder="In a few words"
                  dir="auto"
                  // biome-ignore lint/a11y/noAutofocus: opened by the press on Other
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={busy || note.trim().length < 3}
                  className={`${PILL} ${PILL_OFF}`}
                >
                  Save
                </button>
              </form>
            ) : null}
          </div>
        </fieldset>
      ) : null}

      {!missing ? (
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="muted text-xs underline underline-offset-2 hover:text-[color:var(--foreground)]"
        >
          Done
        </button>
      ) : null}
    </div>
  ) : (
    <Summary
      row={row}
      quality={quality}
      reason={why ? reason : null}
      note={note}
      saved={savedAt !== null}
      onChange={canEdit ? () => setEditing(true) : null}
    />
  );

  if (!framed || !open) return body;
  return (
    <div className="rounded-2xl border hairline bg-white/[0.02] p-3 sm:p-4">
      {body}
    </div>
  );
}

/**
 * Today: the calls you held that still need the lead rated or a reason, the
 * last seven days, newest first. Hidden when there are none.
 */
export function AfterCallCard({
  me,
  rows,
  reload,
  team,
}: {
  me: Me;
  rows: CalendarRow[] | null;
  reload: () => void;
  team: boolean;
}) {
  const list = (rows ?? []).filter(outcomeMissing);
  if (!list.length) return null;
  return (
    <SectionCard
      title={
        <span className="inline-flex items-center gap-2">
          Rate these leads
          <span
            className="rounded-full px-1.5 text-xs font-semibold tabular-nums"
            style={{
              background: "var(--owed)",
              color: "var(--warning-foreground)",
            }}
          >
            {list.length}
          </span>
        </span>
      }
      side={<span className="muted text-xs">Last 7 days</span>}
      flush
    >
      <p className="muted border-b hairline px-4 py-2 text-xs">
        Every call you held: how good the lead is, and for an intro with no
        demo, why. Your end of day waits on these.
      </p>
      <ul className="divide-y hairline">
        {list.slice(0, 12).map(r => (
          <li key={r.appointment_id} className="space-y-2.5 px-4 py-3">
            <div className="min-w-0">
              <Link
                to={`/lead/${r.contact_id ?? ""}`}
                className="block truncate text-sm font-semibold transition-colors hover:text-[color:var(--primary)] hover:underline"
                dir="auto"
              >
                {r.contact_name ?? "A lead"}
              </Link>
              <p className="muted mt-0.5 text-xs">
                {callType(r.call_type)} · {when(r.start_at)}
                {team && r.assigned_user_name ? (
                  <>
                    {" · "}
                    <bdi>{r.assigned_user_name}</bdi>
                  </>
                ) : null}
              </p>
            </div>
            <AfterCall
              row={r}
              canEdit={
                Boolean(me.manager) || r.assigned_user_id === me.ghl_user_id
              }
              onSaved={reload}
              framed={false}
            />
          </li>
        ))}
      </ul>
      {list.length > 12 ? (
        <p className="muted border-t hairline px-4 py-2 text-xs">
          {list.length - 12} more on the lead pages.
        </p>
      ) : null}
    </SectionCard>
  );
}
