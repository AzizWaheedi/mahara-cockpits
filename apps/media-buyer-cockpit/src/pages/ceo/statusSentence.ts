import {
  change,
  count,
  isNum,
  money,
  month,
  pct,
  plural,
} from "@/components/ceo/format";
import { cashHeadline, highRiskCount } from "@/components/ceo/metrics";
import type { CeoSections } from "@/components/ceo/useCeo";

/** The month before "YYYY-MM" as a long name, e.g. "August". */
function previousMonthName(ym: string): string | null {
  const m = /^(\d{4})-(\d{2})/.exec(ym);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 2, 1));
  return month(
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`,
    { long: true },
  );
}

/**
 * The one-line read under the page title, built only from numbers that exist:
 * "Cash is 12% ahead of August's pace, 3 clients need attention, 212 dials so far today."
 */
export function statusSentence(sections: CeoSections): string {
  const cash: string[] = [];
  const attention: string[] = [];
  const activity: string[] = [];

  const moneyP = sections.money?.payload;
  if (moneyP) {
    // The same cash the Today hero shows under this line: every connected
    // rail (Whop, Tap, hand-logged), not Whop alone, so the two never disagree.
    const rail = cashHeadline(moneyP).rail;
    const pace = change(rail.mtd, rail.lastMonthToDate);
    const prev = previousMonthName(moneyP.month);
    const against = prev ? `${prev}'s pace` : "last month's pace";
    if (pace !== null)
      cash.push(
        Math.abs(pace) <= 0.02
          ? `cash is level with ${against}`
          : `cash is ${pct(Math.abs(pace))} ${pace > 0 ? "ahead of" : "behind"} ${against}`,
      );
  }

  const clients = sections.clients?.payload;
  if (clients) {
    // The shared rule, so this line, the tab badge, the Backend rollup and the
    // Client success tab always show the same count.
    const high = highRiskCount(clients);
    attention.push(
      high > 0
        ? `${plural(high, "client")} ${high === 1 ? "needs" : "need"} attention`
        : "no clients at high risk",
    );
  }

  const delivery = sections.delivery?.payload;
  if (
    delivery &&
    isNum(delivery.last7.cpl) &&
    delivery.last7.cpl > delivery.gates.cpl
  )
    attention.push(
      `client cost per lead is over the ${money(delivery.gates.cpl)} gate`,
    );

  const machine = sections.machine?.payload;
  const failures = machine
    ? (isNum(machine.failingJobs) ? machine.failingJobs : 0) +
      (isNum(machine.failingSources) ? machine.failingSources : 0)
    : 0;
  if (failures > 0)
    attention.push(
      `${plural(failures, "machine check")} ${failures === 1 ? "is" : "are"} failing`,
    );

  const calls = sections.calls?.payload;
  if (calls && calls.today.dials > 0)
    activity.push(`${count(calls.today.dials)} dials so far today`);

  // Four clauses fit one line on a laptop; the call count is the first to go.
  const parts = [...cash, ...attention, ...activity].slice(0, 4);
  if (parts.length === 0) return "Waiting for the first numbers.";
  const text = parts.join(", ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}
