import { ChevronRight } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { kuwaitDay } from "@/components/ceo/format";
import { SectionCard } from "@/components/ceo/SectionCard";
import { StatusChip } from "@/components/ceo/StatusChip";
import { useNow } from "@/components/ceo/useCeo";
import type { HoursView } from "@/lib/ceoHoursClient";
import { api, useAction } from "@/lib/cockpitApi";
import { nowSentence } from "./HoursMonthView";
import { countedSoFar, statusChip } from "./hoursCopy";
import { hoursDec, monthLabel, pay } from "./hoursFormat";
import { decideDaysOf, MonthRibbon } from "./MonthRibbon";
import { hoursHash } from "./useHoursHash";

/**
 * One person's month on their page (design 5.11): the ribbon, counted
 * against target, and whether they are tracking now. Read-only; everything
 * is decided in Team & payroll, which the link opens on this person. Shows
 * nothing for someone the hours rule does not count (the CEO, an account).
 */
export function PersonHoursStrip({ personId }: { personId: number }) {
  const now = useNow();
  const month = kuwaitDay(now).slice(0, 7);
  const read = useAction(api.ceo.hours.month);
  const navigate = useNavigate();
  const [view, setView] = useState<HoursView | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    read({ month })
      .then((v: HoursView) => {
        if (live) setView(v);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [read, month]);

  const p = view?.people.find(x => x.personId === personId) ?? null;
  const decide = useMemo(
    () => (p ? decideDaysOf(p.status.reasons) : undefined),
    [p],
  );
  if (failed || !view || !p) return null;

  const fixed = !p.paysOnHours && !p.shadow;
  const soFar = countedSoFar(p);
  const chip = statusChip(p);
  const flag = p.now ? nowSentence(p.now, now) : null;
  const open = () =>
    navigate({
      search: "?tab=team",
      hash: hoursHash({ month, view: "month", person: personId }),
    });

  return (
    <SectionCard
      title={`Hours in ${monthLabel(month)}`}
      description={
        fixed
          ? "Fixed pay: tracked time is shown for information."
          : `${soFar === null ? "No data yet" : hoursDec(soFar)} counted of ${hoursDec(p.hours.target)}${p.pay.total === null ? "" : ` · ${pay(p.pay.total, p.currency)}${p.pay.provisional ? " provisional" : ""}`}`
      }
      actions={<StatusChip tone={chip.tone} label={chip.label} />}
      order={1}
    >
      <div className="grid gap-3">
        <MonthRibbon days={p.days} decide={decide} fixed={fixed} />
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">
            {p.now?.kind === "tracking"
              ? "Tracking now"
              : flag
                ? `Now: ${flag}`
                : "Not expected to track today"}
          </span>
          <button
            type="button"
            onClick={open}
            className="inline-flex items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
          >
            Open in Team & payroll
            <ChevronRight className="size-4" aria-hidden />
          </button>
        </div>
      </div>
    </SectionCard>
  );
}
