import type { Fact, GoldRow, Likelihood, ProjectionsPage, ProjectionWeek, StripRow, WindowRow } from './projectionsView';
import { actualOf,addDays,daysToRenewal,filtersOf,GOLD_TARGET,hardestOf,hotUsedThisMonth,inWindow,isDay,kuwaitDay,METRIC_LABEL,METRIC_UNIT,METRICS,type Metric,type Paid,type PlanStatus,RENEWAL_FIELD,resellGate,rowState,shortDay,verdictOf,weekStartOf,whereTheyAre,winsInWeek } from './projectionsCore';
import type { ProjectionSource, ProjectionClient, ProjectionPlan } from './projectionsSchema';
type Feed = ProjectionSource["feed"];
const norm=(s:string)=>s.trim().toLowerCase().replace(/\s+/g,' ');
const hoursAgo = (ms: number, now: number) => {
  const h = Math.round((now - ms) / 3600_000);
  return h < 1
    ? "under an hour ago"
    : h === 1
      ? "an hour ago"
      : `${h} hours ago`;
};

type Source =
  | { ok: true; value: number; note: string }
  | { ok: false; note: string };

type Sources = {
  now: number;
  today: string;
  feed: Feed;
  tracked: boolean;
  inScope: (name: string) => boolean;
};

/** Cash for a week, from the ledger, or why it cannot be said. */
function cashSource(s: Sources, weekStart: string): Source {
  const weekEnd = addDays(weekStart, 6);
  const f = s.feed;
  if (!f?.okAt)
    return {
      ok: false,
      note: f?.error
        ? `The billing ledger could not be read: ${f.error}`
        : "The billing ledger has not been read yet.",
    };
  if (s.now - f.okAt > 3 * 3600_000)
    return {
      ok: false,
      note: `The billing ledger was last read ${hoursAgo(f.okAt, s.now)}${f.error ? `: ${f.error}` : ""}.`,
    };
  const ledgerAt = f.ledgerSyncedAt ?? 0;
  // A past week needs a ledger refreshed after it ended; this week, one
  // refreshed in the last two days.
  const weekClosedAt = Date.parse(`${weekEnd}T21:00:00Z`);
  const fresh =
    weekEnd < s.today
      ? ledgerAt > weekClosedAt
      : s.now - ledgerAt < 48 * 3600_000;
  if (!fresh)
    return {
      ok: false,
      note: ledgerAt
        ? `The billing ledger has not been refreshed since ${shortDay(kuwaitDay(ledgerAt))}.`
        : "The billing ledger has never been refreshed.",
    };
  const value = f.payments
    .filter(
      p =>
        p.side === "back_end" &&
        p.day >= weekStart &&
        p.day <= weekEnd &&
        s.inScope(p.clientName),
    )
    .reduce((t, p) => t + p.usd, 0);
  return {
    ok: true,
    value: Math.round(value * 100) / 100,
    note: "Back-end client payments in the billing ledger, by payment day.",
  };
}

function sourceFor(
  s: Sources,
  metric: Metric,
  weekStart: string,
  wins: Record<Metric, number> | null,
): Source {
  if (metric === "cash") return cashSource(s, weekStart);
  if (metric === "renewal" && !s.tracked)
    return {
      ok: false,
      note: `No contract end dates yet: the ClickUp field "${RENEWAL_FIELD.name}" (${RENEWAL_FIELD.type}) is missing on ${RENEWAL_FIELD.list}.`,
    };
  const note: Record<Metric, string> = {
    resell:
      "Wins logged in the cockpit: hot-list re-sell rows marked Closed and renewal plans marked re-sold.",
    renewal: "Renewal plans marked renewed.",
    cash: "",
    review: "Hot-list review rows marked Closed.",
    referral: "Hot-list referral rows marked Closed.",
  };
  return { ok: true, value: wins?.[metric] ?? 0, note: note[metric] };
}

/** What a client has paid so far: the ledger first, the card's LTV field second. */
function paidOf(feed: Feed, c: { taskId: string; name: string }): Paid {
  if (!feed?.okAt) return null;
  const mine = feed.payments.filter(
    p => p.taskId === c.taskId || norm(p.clientName) === norm(c.name),
  );
  if (mine.length)
    return {
      usd: Math.round(mine.reduce((t, p) => t + p.usd, 0) * 100) / 100,
      payments: mine.length,
      since: mine.map(p => p.day).sort()[0] ?? null,
      source: "ledger",
    };
  const acct = feed.accounts.find(
    a => a.taskId === c.taskId || norm(a.clientName) === norm(c.name),
  );
  return typeof acct?.ltvUsd === "number" && acct.ltvUsd > 0
    ? { usd: acct.ltvUsd, payments: 0, since: null, source: "ltv" }
    : null;
}

function paidLine(p: NonNullable<Paid>): string {
  return p.source === "ledger"
    ? `billing ledger, ${p.payments} payment${p.payments === 1 ? "" : "s"}${p.since ? ` since ${shortDay(p.since)}` : ""}`
    : "the LTV field on the ClickUp card";
}
function onboardedOf(appointments:ProjectionSource["appointments"],c:ProjectionClient,today:string): {day:string;source:string}|null {
 const first=appointments.filter(a=>a.clientName===c.name&&a.kind==='onboarding'&&a.status!=='cancelled').map(a=>a.day as string).sort()[0];
 return first?{day:first,source:'the onboarding call in GoHighLevel'}:typeof c.signupDays==='number'?{day:addDays(today,-c.signupDays),source:'the day the ClickUp card was made'}:null;
}
function liveFacts(profiles:ProjectionSource["profiles"],c:ProjectionClient,feed:Feed): Fact[] {
 const profile=profiles.find(p=>norm(p.clientName??p.client_name??'')===norm(c.name));
 return whereTheyAre(c,profile?.performance??null,paidOf(feed,{taskId:c.taskId,name:c.name}));
}
function planOf(p: ProjectionPlan | null | undefined) {
  return {
    status: p?.status ?? "planned",
    callBookedFor: p?.callBookedFor ?? null,
    notThisCycleReason: p?.notThisCycleReason ?? null,
  };
}
export function buildProjections(data:ProjectionSource):ProjectionsPage {
 const now=Date.now(), today=data.today, weekStart=weekStartOf(today);
 const weeks=[weekStart,...Array.from({length:8},(_,i)=>addDays(weekStart,-7*(i+1)))];
 const clients=data.clients, owner=data.owner, rows=data.projections;
 const owners=[...new Set(rows.map(r=>String(r.byEmail)))];
 const mine=new Map(rows.filter(r=>r.byEmail===owner).map(r=>[r.weekStart+'|'+r.metric,r]));
 const countable=data.decisions.filter(d=>d.role==='csm');
 const hotUsed=hotUsedThisMonth(countable,today.slice(0,7));
 const feed=data.feed;
 const sources:Sources={now,today,feed,tracked:clients.some(c=>c.renewalTracked===true),inScope:()=>true};
  const weekOf = (ws: string): ProjectionWeek => {
    const weekEnd = addDays(ws, 6);
    const over = weekEnd < today;
    const wins = winsInWeek(countable, ws);
    return {
      weekStart: ws,
      weekEnd,
      over,
      rows: METRICS.map((m): StripRow => {
        const p = mine.get(`${ws}|${m}`);
        const src = sourceFor(sources, m, ws, wins);
        const a = actualOf(src, p?.actual);
        return {
          metric: m,
          label: METRIC_LABEL[m],
          unit: METRIC_UNIT[m],
          blood: p?.blood ?? null,
          stretch: p?.stretch ?? null,
          actual: a.value,
          actualFrom: a.from,
          note: a.note,
          manualAllowed: !src.ok,
          missReason: p?.missReason ?? null,
          verdict: verdictOf(
            { blood: p?.blood, stretch: p?.stretch },
            a.value,
            over,
          ),
        };
      }),
    };
  };

 const windowRows:WindowRow[]=[];
 for(const c of clients){
  if(!c.renewalDate||!isDay(c.renewalDate))continue;
  const renewalDate=c.renewalDate;
  const plan=data.plans.find(p=>p.taskId===c.taskId&&p.renewalDate===renewalDate);
    const pl = planOf(plan);
    if (!inWindow(renewalDate, today, pl.status)) continue;
    const gate = resellGate({name:c.name,stage:c.stage,liveDays:c.liveDays,firstWin:c.firstWin}, hotUsed, today);
    const paid = paidOf(feed, {taskId:c.taskId,name:c.name});
    const saved = plan?.whereTheyAre?.length ? plan.whereTheyAre : null;
    windowRows.push({
      taskId: c.taskId,
      clientName: c.name,
      renewalDate,
      days: daysToRenewal(renewalDate, today),
      state: rowState(renewalDate, pl, today),
      filters: filtersOf(renewalDate, pl, today),
      planId: plan?._id ?? null,
      status: pl.status as PlanStatus,
      likelihood: (plan?.likelihood as Likelihood | undefined) ?? null,
      callBookedFor: pl.callBookedFor,
      notThisCycleReason: pl.notThisCycleReason,
      angle: plan?.angle ?? null,
      objection: plan?.objection ?? null,
      objectionAnswer: plan?.objectionAnswer ?? null,
      offer: plan?.offer
        ? {
            price: plan.offer.price ?? null,
            deliverables: plan.offer.deliverables ?? null,
            durationMonths: plan.offer.durationMonths ?? null,
          }
        : null,
      offerGate: gate.ok
        ? { ok: true, why: null }
        : { ok: false, why: gate.why },
      outcomeNote: plan?.outcomeNote ?? null,
      callRecordingUrl: plan?.callRecordingUrl ?? null,
      goldStandard: Boolean(plan?.goldStandard),
      onboardedOn: onboardedOf(data.appointments, c, today),
      paid: paid ? { usd: paid.usd, source: paidLine(paid) } : null,
      facts: saved ?? liveFacts(data.profiles, c, feed),
      factsSaved: Boolean(saved),
      updatedAt: plan?.updatedAt ?? null,
    });
  }
  const order: Record<string, number> = {
    missed: 0,
    red: 1,
    outcome_due: 2,
    planned: 3,
    booked: 4,
    done: 5,
  };
  windowRows.sort(
    (a, b) =>
      (order[a.state] ?? 9) - (order[b.state] ?? 9) ||
      a.renewalDate.localeCompare(b.renewalDate),
  );

  // Clients being served with no end date on their card.
  const missing = clients
    .filter(c => c.bucket === "management" && !isDay(c.renewalDate))
    .map(c => ({ taskId: c.taskId, clientName: c.name }))
    .sort((a, b) => a.clientName.localeCompare(b.clientName));

  const gold: GoldRow[] = data.plans
    .filter(
      (p): p is ProjectionPlan & { callRecordingUrl: string } =>
        Boolean(p.goldStandard && p.callRecordingUrl),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(p => ({
      planId: p._id,
      clientName: p.clientName,
      renewalDate: p.renewalDate,
      status: p.status,
      outcomeNote: p.outcomeNote ?? null,
      callRecordingUrl: p.callRecordingUrl,
    }));
  return {
    today,
    weekStart,
    owner,
    owners,
    thisWeek: weekOf(weekStart),
    lastWeek: weekOf(weeks[1]),
    history: weeks.slice(1).map(weekOf),
    window: {
      tracked: sources.tracked,
      rows: windowRows,
      missing,
      field: { ...RENEWAL_FIELD },
    },
    hardest: hardestOf(windowRows, today),
    gold: { count: gold.length, target: GOLD_TARGET, rows: gold },
    billing: {
      okAt: feed?.okAt ?? null,
      ledgerSyncedAt: feed?.ledgerSyncedAt ?? null,
      error: feed?.error ?? null,
    },
    canGold: data.canGold,
    canEditOthers: data.canEditOthers,
  };
}
