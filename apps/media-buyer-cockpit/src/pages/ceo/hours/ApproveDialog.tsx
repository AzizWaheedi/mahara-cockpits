import { Check, Loader2 } from "lucide-react";
import { useMemo, useState } from "react";
import { count } from "@/components/ceo/format";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { HoursView } from "@/lib/ceoHoursClient";
import { api, useAction } from "@/lib/cockpitApi";
import type {
  ApproveResult,
  LookAt,
  PersonMonth,
} from "@/types/ceo/hoursContract";
import { owedAfterLeaving } from "./HoursMonthView";
import { approveItems, ZONE_NOTE } from "./hoursCopy";
import { hm, monthLabel, pay } from "./hoursFormat";

/**
 * The approve step (design 5.8): who is approved and for what, the lines
 * worth a look (only the ones that apply, one sentence each), then one
 * button. The server reloads the inputs, recomputes with the same rule and
 * stores nothing for anyone whose figures moved since this was opened.
 */

export function ApproveDialog({
  view,
  people,
  onClose,
  onDone,
}: {
  view: HoursView;
  /** The people to approve; null closes the dialog. */
  people: PersonMonth[] | null;
  onClose: () => void;
  onDone: () => Promise<void> | void;
}) {
  const approveMany = useAction(api.ceo.hours.approveMany);
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<ApproveResult[] | null>(null);
  const list = people ?? [];
  const mName = monthLabel(view.month);
  const totalUsd = list.reduce<number | null>(
    (n, p) =>
      n === null || p.pay.totalUsd === null ? null : n + p.pay.totalUsd,
    0,
  );
  const looks = useMemo(() => {
    const out: (LookAt & { who: string })[] = [];
    for (const p of list)
      for (const l of p.lookAt)
        out.push({ ...l, who: `${p.role ?? "No role"} (${p.name})` });
    return out;
  }, [list]);
  const zone = view.sources.some(
    s => s.provider === "hubstaff" && s.zoneShiftedDays > 0,
  );

  const approve = async () => {
    setState("busy");
    setError(null);
    try {
      const out = (await approveMany({
        month: view.month,
        items: approveItems(list, view.ruleVersion),
      })) as { results: ApproveResult[] };
      setResults(out.results);
      setState("done");
      await onDone();
    } catch (e) {
      setError(
        String(e instanceof Error ? e.message : e).split("\n")[0] ||
          "Nothing was approved. Try again in a minute.",
      );
      setState("idle");
    }
  };

  const failed = results?.filter(
    (r): r is Extract<ApproveResult, { ok: false }> => !r.ok,
  );
  const approvedCount = results?.filter(r => r.ok).length ?? 0;
  const nameOf = (id: number) =>
    list.find(p => p.personId === id)?.name ?? `Person ${id}`;

  return (
    <Dialog
      open={people !== null}
      onOpenChange={open => {
        if (!open) {
          setState("idle");
          setResults(null);
          setError(null);
          onClose();
        }
      }}
    >
      <DialogContent className="ceo-root max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader className="pr-8">
          <DialogTitle>
            {`Approve ${mName} pay for ${list.length === 1 ? list[0]?.name : `${count(list.length)} people`}`}
          </DialogTitle>
          <DialogDescription>
            The figures lock once approved. Nothing is paid or sent to anyone.
          </DialogDescription>
        </DialogHeader>

        <dl className="grid divide-y text-sm">
          {list.map(p => {
            const r = results?.find(x => x.personId === p.personId);
            return (
              <div
                key={p.personId}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 py-2"
              >
                <dt className="min-w-0">
                  <span className="font-medium">{p.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {[
                      p.role ?? "No role",
                      owedAfterLeaving(view, p.personId)
                        ? "Owed after leaving"
                        : p.paysOnHours
                          ? `${hm(p.hours.payable)} payable`
                          : p.shadow
                            ? "Fixed pay (shadow)"
                            : "Fixed pay",
                    ].join(" · ")}
                  </span>
                </dt>
                <dd className="text-right">
                  <span className="font-mono font-medium tabular-nums">
                    {pay(p.pay.total, p.currency)}
                  </span>
                  {r ? (
                    <span className="block text-xs text-muted-foreground">
                      {r.ok ? "Approved" : "Not approved"}
                    </span>
                  ) : null}
                </dd>
              </div>
            );
          })}
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 py-2 font-semibold">
            <dt>Total</dt>
            <dd className="text-right">
              <span className="font-mono tabular-nums">
                {totalUsd === null ? "n/a" : pay(totalUsd, "USD")}
              </span>
              <span className="block text-xs font-normal text-muted-foreground">
                in dollars, at fixed rates
              </span>
            </dd>
          </div>
        </dl>

        {looks.length || zone ? (
          <div className="grid gap-1.5">
            <p className="text-sm font-semibold">Worth a look</p>
            <ul className="grid gap-1 text-sm">
              {looks.map((l, i) => (
                <li key={i} className="text-muted-foreground">
                  <span className="text-foreground">{l.who}: </span>
                  {l.text}
                </li>
              ))}
              {zone ? (
                <li className="text-muted-foreground">{ZONE_NOTE}</li>
              ) : null}
            </ul>
          </div>
        ) : null}

        {failed?.length ? (
          <ul className="ceo-stale grid gap-1 rounded-lg border px-3 py-2 text-sm">
            {failed.map(f => (
              <li key={f.personId}>
                <span className="font-medium">{`${nameOf(f.personId)}: `}</span>
                {f.code === "changed"
                  ? "Figures changed since you opened this. Review and approve again."
                  : f.text}
              </li>
            ))}
          </ul>
        ) : null}
        {error ? (
          <p className="text-sm text-[var(--ceo-critical)]">{error}</p>
        ) : null}

        <p className="text-xs text-muted-foreground">
          {`Rule ${view.ruleVersion}. Approved figures lock; a later change is carried into the next month.`}
        </p>

        <DialogFooter>
          {state === "done" ? (
            <Button type="button" onClick={onClose}>
              <Check aria-hidden />
              {`Approved ${count(approvedCount)}`}
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="button"
                disabled={state === "busy" || !list.length}
                onClick={approve}
              >
                {state === "busy" ? (
                  <>
                    <Loader2 className="animate-spin" aria-hidden />
                    Approving…
                  </>
                ) : (
                  `Approve ${count(list.length)}`
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
