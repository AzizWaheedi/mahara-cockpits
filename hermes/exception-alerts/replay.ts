/**
 * The 30-day replay, required before any live post (plan 4.1, go-live rules of 2.4).
 *
 * Re-runs the same rules on the stored history, one evaluation a day at 09:00 Kuwait with
 * the days before it complete, twice an hour apart (the two-run confirm), carrying each
 * rule's state from day to day so an episode alerts once. Owners are today's owners. It
 * reports alerts per person per day before and after the 5 a day cap, alerts per rule and
 * the "too little data" counts. Reads only; writes nothing, posts nothing.
 *
 * Limits, said in the report: "campaign stopped" cannot be replayed (Meta's delivery status
 * is kept for now only, not as history); the lead sync gap is replayed from the lead sync
 * watch's own ledger, which starts on 14 October 2026.
 */
import { type Client, type Db, loadInputs } from "./inputs";
import { addDays, type CampaignFact, cpbOverLine, decide, floors, kuwaitDay, kuwaitDayStart, LIMITS, NO_PRIOR, type Prior, RULE_LABEL, type Rule, zeroLeads } from "./rules";
import { fallbackOf, ownersFor } from "./worker";

type Row = Record<string, any>;

export type Replay = {
  from: string;
  to: string;
  clients: number;
  people: Record<string, { role: string; perDay: Record<string, number> }>;
  perRule: Record<string, number>;
  tooLittleData: Record<string, number>;
  unknown: Record<string, number>;
  leadSyncPosts: number;
  leadSyncFrom: string | null;
  maxPerPersonDay: number;
  maxPerPersonDayAfterCap: number;
  digestItems: number;
  unowned: number;
  episodes: { day: string; rule: Rule; client: string; reason: string; to: string[]; days: number | null }[];
};

function asOf(c: Client, day: string): Client {
  const keep = (d: string) => d <= day;
  const campaigns: CampaignFact[] = c.campaigns.map(k => {
    const spendByDay = Object.fromEntries(Object.entries(k.spendByDay).filter(([d]) => keep(d)));
    const spent = Object.entries(spendByDay)
      .filter(([, v]) => v > 0)
      .map(([d]) => d)
      .sort();
    return { ...k, spendByDay, firstSpendDay: spent[0] ?? null, lastSpendDay: spent.at(-1) ?? null };
  });
  const next = addDays(day, 1);
  return { ...c, campaigns, days: [...c.days.filter(d => keep(d.day)), { day: next, spend: null, metaLeads: null, crmAdLeads: null, bookings: null }] };
}

export async function replay(db: Db, x: { days: number; nowMs: number }): Promise<Replay> {
  const inputs = await loadInputs(db, x.nowMs, x.days + LIMITS.floorDays + 2);
  const lsAlerts = await db.all("cockpit_lead_sync_alerts", `select=client_name,created_at,status&kind=eq.alert&order=created_at.asc`);
  const fallback = fallbackOf({});
  const today = kuwaitDay(x.nowMs);
  const from = addDays(today, -x.days);
  const out: Replay = {
    from,
    to: addDays(today, -1),
    clients: inputs.clients.length,
    people: {},
    perRule: { zero_leads: 0, cpb_over_line: 0 },
    tooLittleData: { zero_leads: 0, cpb_over_line: 0 },
    unknown: { zero_leads: 0, cpb_over_line: 0 },
    leadSyncPosts: 0,
    leadSyncFrom: lsAlerts[0] ? kuwaitDay(Date.parse(lsAlerts[0].created_at)) : null,
    maxPerPersonDay: 0,
    maxPerPersonDayAfterCap: 0,
    digestItems: 0,
    unowned: 0,
    episodes: [],
  };
  const priors = new Map<string, Prior>();
  const openIdx = new Map<string, number>();
  for (let day = from; day < today; day = addDays(day, 1)) {
    const evalDay = addDays(day, 1);
    const at = kuwaitDayStart(evalDay) + 9 * 3_600_000;
    const counts = new Map<string, number>();
    for (const c0 of inputs.clients) {
      const c = asOf(c0, day);
      const fl = floors(c.days, c.targets, addDays(day, -(LIMITS.floorDays - 1)), day);
      for (const rule of ["zero_leads", "cpb_over_line"] as Rule[]) {
        const f =
          rule === "zero_leads"
            ? zeroLeads({ days: c.days, campaigns: c.campaigns, floors: fl, today: evalDay, nowMs: at })
            : cpbOverLine({ days: c.days, floors: fl, targets: c.targets, serviceMode: c.serviceMode, today: evalDay });
        if (f.state === "too_little_data") out.tooLittleData[rule]++;
        if (f.state === "unknown") out.unknown[rule]++;
        const k = `${rule}|${c.key}`;
        let p = priors.get(k) ?? NO_PRIOR;
        let opened = false;
        let closed = false;
        for (const t of [at, at + 60 * 60_000]) {
          const n = decide(rule, c.key, p, f, t);
          opened ||= n.opened;
          closed ||= n.closed;
          p = n;
        }
        priors.set(k, p);
        if (closed && openIdx.has(k)) {
          const e = out.episodes[openIdx.get(k)!];
          e.days = Math.round((Date.parse(evalDay) - Date.parse(e.day)) / 86_400_000);
          openIdx.delete(k);
        }
        if (!opened) continue;
        out.perRule[rule]++;
        const owners = ownersFor(rule, c, inputs.members);
        const to = owners.length ? owners : [fallback];
        if (!owners.length) out.unowned++;
        openIdx.set(k, out.episodes.length);
        out.episodes.push({ day: evalDay, rule, client: c.name, reason: f.reason, to: to.map(o => o.name), days: null });
        for (const o of to) {
          const person = (out.people[o.name] ??= { role: o.role, perDay: {} });
          person.perDay[evalDay] = (person.perDay[evalDay] ?? 0) + 1;
          counts.set(o.name, (counts.get(o.name) ?? 0) + 1);
        }
      }
    }
    for (const [name, n] of counts) {
      out.maxPerPersonDay = Math.max(out.maxPerPersonDay, n);
      out.maxPerPersonDayAfterCap = Math.max(out.maxPerPersonDayAfterCap, Math.min(n, LIMITS.perPersonPerDay));
      if (out.people[name]?.role !== "fallback") out.digestItems += Math.max(0, n - LIMITS.perPersonPerDay);
    }
  }
  out.leadSyncPosts = lsAlerts.filter(a => kuwaitDay(Date.parse(a.created_at)) >= from && kuwaitDay(Date.parse(a.created_at)) < today).length;
  return out;
}

export function replayMarkdown(r: Replay): string {
  const days: string[] = [];
  for (let d = addDays(r.from, 1); d <= addDays(r.to, 1); d = addDays(d, 1)) days.push(d);
  const people = Object.entries(r.people);
  const total = (p: { perDay: Record<string, number> }) => Object.values(p.perDay).reduce((s, n) => s + n, 0);
  const busiest = (p: { perDay: Record<string, number> }) => Math.max(0, ...Object.values(p.perDay));
  const lines = [
    `# Exception alerts: 30-day replay`,
    ``,
    `Window: evaluations on ${addDays(r.from, 1)} to ${addDays(r.to, 1)} (Kuwait, 09:00, data through the day before). ${r.clients} active clients. Owners are today's owners.`,
    ``,
    `## Alerts per person per day`,
    ``,
    `| Person | Role | Alerts in 30 days | Busiest day | Days with any alert |`,
    `|---|---|---:|---:|---:|`,
    ...people.map(([name, p]) => `| ${name} | ${p.role.replace("_", " ")} | ${total(p)} | ${busiest(p)} | ${Object.keys(p.perDay).length} |`),
    ``,
    `Most alerts to one person on one day: ${r.maxPerPersonDay} before the cap, ${r.maxPerPersonDayAfterCap} after it (cap ${LIMITS.perPersonPerDay}). ${r.digestItems} alerts would have gone to a digest instead. ${r.unowned} had no owner and would go to the fallback digest.`,
    ``,
    `## Alerts per rule (episodes opened)`,
    ``,
    `| Rule | Episodes | Client-days with too little data | Client-days unknown |`,
    `|---|---:|---:|---:|`,
    ...(["zero_leads", "cpb_over_line"] as Rule[]).map(k => `| ${RULE_LABEL[k]} | ${r.perRule[k]} | ${r.tooLittleData[k]} | ${r.unknown[k]} |`),
    `| ${RULE_LABEL.campaign_stopped} | not replayable | | |`,
    `| ${RULE_LABEL.lead_sync} | ${r.leadSyncPosts} posts by the lead sync watch | | |`,
    ``,
    `"Campaign stopped" cannot be replayed: Meta's delivery status is stored for now only, not as history. The lead sync gap is the lead sync watch's own posts to #tech-general${r.leadSyncFrom ? `, whose ledger starts on ${r.leadSyncFrom}` : ""}; they are mirrored into the ledger, not sent again, and do not count against a person's ${LIMITS.perPersonPerDay}.`,
    ``,
    `## Every episode`,
    ``,
    `"Open for" counts days until the problem was gone on two runs; "still open" means it was open at the end of the window.`,
    ``,
    `| Day | Rule | Client | Why | Open for | To |`,
    `|---|---|---|---|---|---|`,
    ...r.episodes.map(
      e => `| ${e.day} | ${RULE_LABEL[e.rule]} | ${e.client} | ${e.reason.replace(/\|/g, "/")} | ${e.days === null ? "still open" : `${e.days} day${e.days === 1 ? "" : "s"}`} | ${e.to.join(", ")} |`,
    ),
    ``,
    `## Per person, day by day`,
    ``,
    `| Day | ${people.map(([n]) => n).join(" | ")} |`,
    `|---|${people.map(() => "---:").join("|")}|`,
    ...days.filter(d => people.some(([, p]) => p.perDay[d])).map(d => `| ${d} | ${people.map(([, p]) => p.perDay[d] ?? 0).join(" | ")} |`),
  ];
  return `${lines.join("\n")}\n`;
}
