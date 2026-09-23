import { useAction } from "convex/react";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { shortDate } from "@/components/ceo/format";
import { StatusChip } from "@/components/ceo/StatusChip";
import { AnimatedSelect } from "@/components/ui/animated-select";
import { api } from "../../../convex/_generated/api";
import type { Scorecard, ScorecardItem } from "../../../convex/ceo/profiles";

/**
 * The working document of a monthly one-to-one.
 *
 * Aziz, 2026-09-22: "based on the role that they have, for them to have their
 * own specific scorecard that we go over each month in their one-to-one. I
 * can grade them on it... and to duplicate and get saved for each month, the
 * scorecard for last month."
 *
 * A grade on its own is an argument. So every accountability shows what A, B,
 * C and D actually mean before the grade is pressed, and the comment box
 * carries the prompts from Aziz's own documents — the numbers to collect
 * before the call, not after it. A card is a draft until it is signed off,
 * and signing off needs an overall grade, because a review with no verdict is
 * not a review.
 */

const GRADES = ["A", "B", "C", "D"] as const;
type Grade = (typeof GRADES)[number];

const TONE: Record<Grade, "good" | "warning" | "serious" | "critical"> = {
  A: "good",
  B: "warning",
  C: "serious",
  D: "critical",
};

const field =
  "w-full rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--ceo-emphasis)]";
const primary =
  "rounded-md bg-[var(--ceo-emphasis)] px-3 py-1.5 text-sm font-medium text-background disabled:opacity-50";
const quiet =
  "rounded-md border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50";

function GradePicker({
  value,
  onChange,
  name,
}: {
  value: Grade | null;
  onChange: (g: Grade | null) => void;
  name: string;
}) {
  return (
    <div className="flex gap-1" role="group" aria-label={`Grade for ${name}`}>
      {GRADES.map(g => (
        <button
          key={g}
          type="button"
          aria-pressed={value === g}
          onClick={() => onChange(value === g ? null : g)}
          className={`size-8 rounded-md border text-sm font-semibold transition-colors ${
            value === g
              ? "border-transparent text-background"
              : "text-muted-foreground hover:text-foreground"
          }`}
          style={
            value === g
              ? {
                  background: `var(--ceo-${TONE[g] === "warning" ? "warning" : TONE[g]})`,
                }
              : undefined
          }
        >
          {g}
        </button>
      ))}
    </div>
  );
}

function Item({
  item,
  onChange,
}: {
  item: ScorecardItem;
  onChange: (next: ScorecardItem) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="grid gap-2 border-t py-3 first:border-t-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{item.accountability}</p>
          {item.lookingAt?.length ? (
            <ul className="mt-0.5 grid gap-0.5 text-xs text-muted-foreground">
              {(item.lookingAt ?? []).map(x => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          ) : null}
        </div>
        <GradePicker
          name={item.accountability}
          value={item.grade}
          onChange={grade => onChange({ ...item, grade })}
        />
      </div>

      <button
        type="button"
        className="justify-self-start text-xs text-muted-foreground underline underline-offset-2"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
      >
        {open ? "Hide what each grade means" : "What each grade means"}
      </button>
      {open ? (
        <dl className="grid gap-1 rounded-md bg-muted/40 p-2 text-xs">
          {GRADES.map(g => (
            <div key={g} className="flex gap-2">
              <dt className="w-4 shrink-0 font-semibold">{g}</dt>
              <dd className="text-muted-foreground">
                {item.scale[g.toLowerCase() as "a" | "b" | "c" | "d"]}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      <textarea
        className={`${field} min-h-[64px]`}
        aria-label={`Comments on ${item.accountability}`}
        placeholder={
          item.prompts?.length
            ? (item.prompts ?? []).map(p => `${p} `).join("\n")
            : "What happened, with the numbers."
        }
        value={item.comment}
        onChange={e => onChange({ ...item, comment: e.target.value })}
      />
    </div>
  );
}

export function ScorecardPanel({
  personId,
  personName,
  card,
  months,
  onMonth,
  onSaved,
}: {
  personId: number;
  personName: string;
  card: Scorecard | null;
  months: { month: string; overall: string | null; status: string }[];
  onMonth: (month: string) => void;
  onSaved: () => void;
}) {
  const save = useAction(api.ceo.profiles.saveScorecard);
  const [items, setItems] = useState<ScorecardItem[]>(card?.items ?? []);
  const [overall, setOverall] = useState<Grade | null>(
    (card?.overall as Grade | null) ?? null,
  );
  const [summary, setSummary] = useState(card?.summary ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A different month is a different card; the form starts again from it.
  useEffect(() => {
    setItems(Array.isArray(card?.items) ? card.items : []);
    setOverall((card?.overall as Grade | null) ?? null);
    setSummary(card?.summary ?? "");
    setMsg(null);
    setError(null);
  }, [card]);

  const graded = useMemo(() => items.filter(i => i?.grade).length, [items]);

  if (!card)
    return (
      <p className="text-sm text-muted-foreground">
        {`No scorecard for this role yet. Write one on the Scorecards card, and every ${personName.split(" ")[0]} one-to-one from then on starts from it.`}
      </p>
    );

  const put = async (status: "draft" | "final") => {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await save({
        personId,
        month: card.month,
        roleKey: card.roleKey,
        title: card.title,
        mission: card.mission,
        items,
        overall: overall ?? undefined,
        summary,
        status,
      });
      setMsg(status === "final" ? "Signed off." : "Saved.");
      onSaved();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e).slice(0, 300));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <AnimatedSelect
            aria-label="Which month"
            className="rounded-md border bg-background px-2 py-1 text-sm"
            value={card.month}
            onChange={e => onMonth(e.target.value)}
          >
            {[...new Set([card.month, ...months.map(m => m.month)])]
              .sort()
              .reverse()
              .map(m => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
          </AnimatedSelect>
          <StatusChip
            tone={card.status === "final" ? "good" : "neutral"}
            label={card.status === "final" ? "Signed off" : "Draft"}
          />
          <span className="text-xs text-muted-foreground">
            {`${graded} of ${items.length} graded`}
          </span>
        </div>
        {card.reviewedOn ? (
          <span className="text-xs text-muted-foreground">
            {`Reviewed ${shortDate(card.reviewedOn)}${card.reviewedBy ? ` by ${card.reviewedBy}` : ""}`}
          </span>
        ) : null}
      </div>

      {card.fresh ? (
        <p className="text-xs text-muted-foreground">
          {card.startedFrom
            ? `Started from ${card.startedFrom}: the same accountabilities, grades cleared. Nothing is saved until you press save.`
            : "Started from the role's scorecard. Nothing is saved until you press save."}
        </p>
      ) : null}

      {card.mission ? (
        <p className="rounded-md bg-muted/40 p-2 text-sm">
          <span className="font-medium">Mission. </span>
          {card.mission}
        </p>
      ) : null}

      <div className="grid">
        {items.map((it, i) => (
          <Item
            key={it.key}
            item={it}
            onChange={next =>
              setItems(x => x.map((y, n) => (n === i ? next : y)))
            }
          />
        ))}
      </div>

      <div className="grid gap-2 border-t pt-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium">Overall</span>
          <GradePicker name="overall" value={overall} onChange={setOverall} />
        </div>
        <textarea
          className={`${field} min-h-[72px]`}
          aria-label="Summary of the review"
          placeholder="The one thing to fix before next month, and the one thing to keep doing."
          value={summary}
          onChange={e => setSummary(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={quiet}
            disabled={busy}
            onClick={() => put("draft")}
          >
            {busy ? (
              <span className="flex items-center gap-1.5">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                Saving
              </span>
            ) : (
              "Save the draft"
            )}
          </button>
          <button
            type="button"
            className={primary}
            disabled={busy || !overall}
            onClick={() => put("final")}
          >
            Sign it off
          </button>
          {!overall ? (
            <span className="text-xs text-muted-foreground">
              An overall grade is needed to sign off.
            </span>
          ) : null}
        </div>
        {msg ? <p className="text-sm">{msg}</p> : null}
        {error ? (
          <p className="text-sm text-[var(--ceo-critical)]">{error}</p>
        ) : null}
      </div>

      {card.competencies?.length ? (
        <details className="border-t pt-3">
          <summary className="cursor-pointer text-sm font-medium">
            What an A-player looks like in any role
          </summary>
          <ul className="mt-2 grid gap-1 text-xs text-muted-foreground">
            {(card.competencies ?? []).map(c => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {card.bonus ? (
        <p className="text-xs text-muted-foreground">{card.bonus}</p>
      ) : null}
    </div>
  );
}
