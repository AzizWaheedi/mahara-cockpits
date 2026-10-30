import { Loader2, Lock, LockOpen } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { count, dateTime, decimal, money, pct1 } from "@/components/ceo/format";
import { KICKER } from "@/components/ceo/Kicker";
import { StatusChip } from "@/components/ceo/StatusChip";
import { Button } from "@/components/ui/button";
import type { LockInRow, SheetContext } from "@/lib/ceoGoalSheetClient";
import { api, useAction } from "@/lib/cockpitApi";
import type { SheetData } from "./goalsSheetData";
import { COLUMN_BY_KEY, type SheetColumn } from "./goalsSheetModel";

/**
 * "Lock In Last Month", in his outline's order: the clients behind client
 * success first, then a line per number with where it came from and what it
 * leaves out. A line nobody can read yet says missing and names the source
 * that would give it; it is never a zero.
 */

const SECTIONS: { key: string; title: string; blurb?: string }[] = [
  {
    key: "churned",
    title: "Client success: churned clients",
    blurb:
      "The form goes after the exit call, never instead of it. A submitted form marks the card Stopped by itself.",
  },
  { key: "retained", title: "Client success: retained clients" },
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
  onSave,
}: {
  row: LockInRow;
  field: { key: string; label: string; rows?: number };
  onSave: (id: number, key: string, text: string) => Promise<void>;
}) {
  const saved = row.answers?.[field.key] ?? "";
  const [text, setText] = useState(saved);
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
    </label>
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
  const daysLeft = sheet.workingDays - sheet.workedSoFar;

  if (!ctx.lockin.length)
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
            : `${name} is open${daysLeft > 0 ? `, ${daysLeft} working ${daysLeft === 1 ? "day" : "days"} left` : ""}. ${tally("measured")} lines measured, ${tally("partial")} partial, ${tally("typed")} typed, ${tally("missing")} missing. Written when the numbers ran to the last complete day; lines tied to the sheet keep moving until you lock.`}
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

      {SECTIONS.map(s => {
        const rows = bySection.get(s.key);
        if (!rows?.length) return null;
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
                        {r.label}
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
                    {fields ? (
                      <div className="grid gap-3 lg:grid-cols-3">
                        {fields.map(f => (
                          <Answer
                            key={f.key}
                            row={r}
                            field={f}
                            onSave={onSave}
                          />
                        ))}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
