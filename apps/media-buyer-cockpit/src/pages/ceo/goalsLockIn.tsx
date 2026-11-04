import { Loader2, Lock, LockOpen } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { count, dateTime, decimal, money, pct1 } from "@/components/ceo/format";
import { KICKER } from "@/components/ceo/Kicker";
import { StatusChip } from "@/components/ceo/StatusChip";
import { Button } from "@/components/ui/button";
import type { LockInRow, SheetContext } from "@/lib/ceoGoalSheetClient";
import { api, useAction } from "@/lib/cockpitApi";
import type { SheetData } from "./goalsSheetData";
import {
  COLUMN_BY_KEY,
  lifecycleOf,
  lineLabel,
  type ManualLogged,
  type MeasuredLine,
  manualLoggedOf,
  matchMeasured,
  measuredLines,
  type SheetColumn,
} from "./goalsSheetModel";

/**
 * "Lock In Last Month", in his outline's order: the clients behind client
 * success first, then a line per number with where it came from and what it
 * leaves out. A line nobody can read yet says missing and names the source
 * that would give it; it is never a zero.
 *
 * Since waves 1 and 2 (WAVE12-CONTRACT 4.11.5) the churned, extensions and
 * late payments sections also show what the cockpit measured for the month:
 * the churn confirm, the extension grants and the late spells, each with its
 * source sentence. The measured line sits beside the typed one and never
 * replaces it; an answer the cockpit holds is offered with "Use it", which
 * saves it only when pressed.
 */

const SECTIONS: { key: string; title: string; blurb?: string }[] = [
  {
    key: "churned",
    title: "Client success: churned clients",
    blurb:
      "The exit call comes first. Client is leaving on the client page then confirms it: the register, the card and the notice move together.",
  },
  { key: "retained", title: "Client success: retained clients" },
  {
    key: "extensions",
    title: "Client success: extensions",
    blurb:
      "Every extension is given with Give more time on the client page or Extend on the billing sheet, so the card's weeks and next payment date move with it.",
  },
  {
    key: "late_payments",
    title: "Client success: late payments",
    blurb:
      "Late spells from the daily card snapshots, checked against Whop, Tap and the payments logged by hand.",
  },
  { key: "upsells", title: "Client success: upsells" },
  { key: "client_data", title: "Client success: client data" },
  { key: "sales", title: "Sales" },
  { key: "marketing", title: "Marketing" },
  { key: "client_media", title: "Client media buying" },
  { key: "call_center", title: "Call center" },
  { key: "creative", title: "Client creatives" },
  { key: "finances", title: "Finances" },
];

/** The answers a section asks for against each client. */
const ANSWERS: Record<string, { key: string; label: string; rows?: number }[]> =
  {
    churned: [
      { key: "form", label: "Cancellation form sent", rows: 4 },
      { key: "why", label: "Why they churned exactly", rows: 4 },
      { key: "prevent", label: "How we can stop it next time", rows: 3 },
    ],
    retained: [
      { key: "why", label: "Why they continued", rows: 2 },
      { key: "keep", label: "How we can continue to retain them", rows: 2 },
    ],
    extensions: [
      { key: "why", label: "Why we gave it", rows: 2 },
      { key: "next", label: "What happens when it ends", rows: 2 },
    ],
    late_payments: [
      { key: "why", label: "Why it is late", rows: 2 },
      { key: "plan", label: "How we collect it", rows: 2 },
    ],
    upsells: [
      { key: "potential", label: "Potential upsell", rows: 2 },
      { key: "missed", label: "Why we missed it", rows: 2 },
    ],
    client_data: [{ key: "why", label: "Why not updated", rows: 2 }],
  };

const STATUS: Record<
  LockInRow["status"],
  { tone: "good" | "warning" | "critical" | "neutral"; label: string }
> = {
  measured: { tone: "good", label: "Measured" },
  partial: { tone: "warning", label: "Partial" },
  typed: { tone: "neutral", label: "Typed" },
  missing: { tone: "critical", label: "Missing" },
};

function live(c: SheetColumn | undefined, v: number | null | undefined) {
  if (!c || v === null || v === undefined || !Number.isFinite(v)) return null;
  switch (c.unit) {
    case "usd":
      return money(v);
    case "rate":
      return pct1(v);
    case "x":
      return `${decimal(v, 1)}×`;
    case "pts":
      return decimal(v, 1);
    default:
      return c.rollup.kind === "perWorkingDay" ? decimal(v, 1) : count(v);
  }
}

function Answer({
  row,
  field,
  measured,
  onSave,
}: {
  row: LockInRow;
  field: { key: string; label: string; rows?: number };
  /** What the cockpit already holds for this answer, offered, never saved by itself. */
  measured?: string;
  onSave: (id: number, key: string, text: string) => Promise<void>;
}) {
  const saved = row.answers?.[field.key] ?? "";
  const [text, setText] = useState(saved);
  const offer = measured && measured.trim() !== text.trim() ? measured : null;
  return (
    <label className="grid gap-1">
      <span className="text-xs font-medium text-muted-foreground">
        {field.label}
      </span>
      <textarea
        value={text}
        rows={field.rows ?? 1}
        dir="auto"
        onChange={e => setText(e.target.value)}
        onBlur={() => {
          if (text !== saved) void onSave(row.id, field.key, text);
        }}
        className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      {offer ? (
        <span className="flex items-start gap-2 text-xs text-muted-foreground">
          <span
            className="min-w-0 flex-1"
            dir="auto"
          >{`In the cockpit: ${offer}`}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 shrink-0 px-2 text-xs"
            onClick={() => {
              setText(offer);
              void onSave(row.id, field.key, offer);
            }}
          >
            Use it
          </Button>
        </span>
      ) : null}
    </label>
  );
}

/** The cockpit's measured line under a lock-in line: a chip, the value and where it came from. */
export function Measured({ line }: { line: MeasuredLine }) {
  return (
    <div className="grid gap-0.5 border-l-2 border-[color:var(--mahara-teal)] pl-2 text-xs">
      <p className="flex flex-wrap items-baseline gap-2">
        <StatusChip tone="good" label="Measured" />
        <span className="font-medium tabular-nums text-foreground" dir="auto">
          {line.value}
        </span>
      </p>
      <p className="text-muted-foreground">{line.source}</p>
    </div>
  );
}

/** The "Logged, not checked" line under Total new cash (plan 5.3): hand-logged money not in the total yet. */
export function LoggedLine({ logged }: { logged: ManualLogged | null }) {
  if (!logged)
    return (
      <p className="text-xs text-muted-foreground">
        Logged, not checked: not read yet. The next money refresh writes it.
      </p>
    );
  return (
    <p className="flex flex-wrap items-baseline gap-2 text-xs">
      <StatusChip
        tone={logged.count ? "warning" : "neutral"}
        label="Logged, not checked"
      />
      <span className="tabular-nums">{`${money(logged.usd)} (${count(logged.count)})`}</span>
      <span className="text-muted-foreground">
        {logged.count
          ? "Not in the total until finance or the CEO checks each one against the bank."
          : "Every hand-logged payment is checked."}
      </span>
    </p>
  );
}

export function LockIn({
  ctx,
  sheet,
  actual,
  onChanged,
}: {
  ctx: SheetContext;
  sheet: SheetData;
  actual: Record<string, number | null>;
  onChanged: () => void;
}) {
  const saveRow = useAction(api.ceo.goals.saveLockIn);
  const lock = useAction(api.ceo.goals.lockMonth);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const locked = Boolean(ctx.locked?.locked_at);
  const life = useMemo(() => lifecycleOf(ctx), [ctx]);
  const logged = useMemo(() => manualLoggedOf(ctx), [ctx]);
  const bySection = useMemo(() => {
    const map = new Map<string, LockInRow[]>();
    for (const r of ctx.lockin) {
      const list = map.get(r.section) ?? [];
      list.push(r);
      map.set(r.section, list);
    }
    return map;
  }, [ctx.lockin]);

  const shownValue = useCallback(
    (r: LockInRow): string | null => {
      if (locked || !r.metric_key) return r.value;
      return live(COLUMN_BY_KEY[r.metric_key], actual[r.metric_key]) ?? r.value;
    },
    [locked, actual],
  );

  const onSave = useCallback(
    async (id: number, key: string, text: string) => {
      setError(null);
      try {
        await saveRow({ id, answers: { [key]: text } });
        onChanged();
      } catch (e) {
        setError(String(e instanceof Error ? e.message : e).slice(0, 300));
      }
    },
    [saveRow, onChanged],
  );

  const setLock = useCallback(
    async (next: boolean) => {
      setBusy(true);
      setError(null);
      try {
        const values: Record<string, string> = {};
        if (next) {
          for (const r of ctx.lockin) {
            if (!r.metric_key) continue;
            const v = live(COLUMN_BY_KEY[r.metric_key], actual[r.metric_key]);
            if (v) values[r.metric_key] = v;
          }
        }
        await lock({ month: ctx.month, lock: next, values });
        setConfirming(false);
        onChanged();
      } catch (e) {
        setError(String(e instanceof Error ? e.message : e).slice(0, 300));
      } finally {
        setBusy(false);
      }
    },
    [ctx, actual, lock, onChanged],
  );

  const name = new Date(`${ctx.month}-01T00:00:00Z`).toLocaleString("en", {
    month: "long",
    timeZone: "UTC",
  });
  const tally = (st: LockInRow["status"]) =>
    ctx.lockin.filter(r => r.status === st).length;
  // Measured lines no lock-in row names: counted in the header so it never reads "0 measured" over them.
  const extraMeasured = ["churned", "extensions", "late_payments"].reduce(
    (n, k) =>
      n +
      matchMeasured(bySection.get(k) ?? [], measuredLines(k, life)).extra
        .length,
    0,
  );
  const daysLeft = sheet.workingDays - sheet.workedSoFar;

  const anyMeasured = ["churned", "extensions", "late_payments"].some(
    k => (measuredLines(k, life) ?? []).length > 0,
  );
  if (!ctx.lockin.length && !anyMeasured)
    return (
      <p className="text-sm text-muted-foreground">
        {`No lock-in for ${name} yet. The sheet still shows its numbers: choose Sheet above.`}
      </p>
    );

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-muted/40 px-3 py-2">
        <p className="text-sm">
          {locked
            ? `${name} is locked${ctx.locked?.locked_at ? `, ${dateTime(Date.parse(ctx.locked.locked_at))}` : ""}. Answers can still be typed; numbers are frozen.`
            : `${name} is open${daysLeft > 0 ? `, ${daysLeft} working ${daysLeft === 1 ? "day" : "days"} left` : ""}. ${tally("measured")} lines measured, ${tally("partial")} partial, ${tally("typed")} typed, ${tally("missing")} missing${extraMeasured ? `, and ${extraMeasured} more measured by the cockpit` : ""}. Written when the numbers ran to the last complete day; lines tied to the sheet keep moving until you lock.`}
        </p>
        <div className="flex items-center gap-2">
          {busy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : null}
          {locked ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void setLock(false)}
            >
              <LockOpen aria-hidden />
              Unlock
            </Button>
          ) : confirming ? (
            <>
              <Button size="sm" onClick={() => void setLock(true)}>
                <Lock aria-hidden />
                {`Lock ${name}`}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirming(false)}
              >
                Keep open
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirming(true)}
            >
              <Lock aria-hidden />
              {`Lock ${name}`}
            </Button>
          )}
        </div>
      </div>

      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
          {error}
        </p>
      ) : null}

      {life?.missing.length ? (
        <ul className="grid gap-1 text-xs text-muted-foreground">
          {life.missing.map(m => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      ) : null}

      {SECTIONS.map(s => {
        const rows = bySection.get(s.key) ?? [];
        const { byRow, extra } = matchMeasured(
          rows,
          measuredLines(s.key, life),
        );
        if (!rows.length && !extra.length) return null;
        const fields = ANSWERS[s.key];
        return (
          <section key={s.key} className="grid gap-2">
            <h3 className={KICKER}>{s.title}</h3>
            {s.blurb ? (
              <p className="text-xs text-muted-foreground">{s.blurb}</p>
            ) : null}
            <ul className="grid">
              {rows.map((r, i) => {
                const value = shownValue(r);
                const st = STATUS[r.status];
                return (
                  <li
                    key={r.id}
                    className={
                      i
                        ? "grid gap-2 border-t py-3"
                        : "grid gap-2 border-t py-3"
                    }
                  >
                    <div className="grid gap-x-4 gap-y-1 lg:grid-cols-[minmax(0,14rem)_minmax(0,14rem)_minmax(0,1fr)]">
                      <p className="text-sm font-medium" dir="auto">
                        {lineLabel(r)}
                      </p>
                      <p className="flex flex-wrap items-baseline gap-2 text-sm">
                        <span className="font-semibold tabular-nums" dir="auto">
                          {value ?? "Missing"}
                        </span>
                        <StatusChip tone={st.tone} label={st.label} />
                      </p>
                      <div className="grid gap-0.5 text-xs text-muted-foreground">
                        {r.source ? <p>{r.source}</p> : null}
                        {r.leaves_out ? (
                          <p>{`Leaves out: ${r.leaves_out}`}</p>
                        ) : null}
                      </div>
                    </div>
                    {byRow.get(r.id) ? (
                      <Measured line={byRow.get(r.id) as MeasuredLine} />
                    ) : null}
                    {r.metric_key === "totalCash" ? (
                      <LoggedLine logged={logged} />
                    ) : null}
                    {fields ? (
                      <div className="grid gap-3 lg:grid-cols-3">
                        {fields.map(f => (
                          <Answer
                            key={f.key}
                            row={r}
                            field={f}
                            measured={byRow.get(r.id)?.answers[f.key]}
                            onSave={onSave}
                          />
                        ))}
                      </div>
                    ) : null}
                  </li>
                );
              })}
              {extra.map(line => (
                <li
                  key={`measured:${line.taskId ?? line.client}:${line.value}`}
                  className="grid gap-2 border-t py-3"
                >
                  <div className="grid gap-x-4 gap-y-1 lg:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
                    <p className="text-sm font-medium" dir="auto">
                      <bdi>{line.client}</bdi>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Not a line of this lock-in yet; the cockpit measured it.
                    </p>
                  </div>
                  <Measured line={line} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
