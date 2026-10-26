/**
 * Reads what the rules need, once per run, from tables other jobs already keep fresh in
 * Creative Triage. Nothing here calls Meta, GoHighLevel or ClickUp.
 *
 *   clients     cockpit_board_clients, status Active (one row per GoHighLevel location)
 *   spend/leads cockpit_meta_ad_days (hourly Meta store), Mahara's campaigns only, minus the
 *               compromise list (cockpit_excluded_ads); a day is read when the store's
 *               "days" task for that account finished through it, else null
 *   bookings    cockpit_client_days.confirmed_bookings (the board's rule), CRM ad leads too
 *   status      cockpit_meta_budgets (campaign level), cockpit_meta_account_state, and the
 *               ad billing guard's signal (cockpit_ad_billing_bindings)
 *   lines       cockpit_board_targets (client, then board), else the official lines
 *   owners      cockpit_members (media buyers) and the ClickUp "CSM assigned" person on the
 *               client card (cockpit_csm_sources, table "clients")
 */
import { addDays, type CampaignFact, type DayRow, kuwaitDay, type Line, OFFICIAL, type Targets } from "./rules";

type Row = Record<string, any>;
export type Db = {
  all(table: string, query: string): Promise<Row[]>;
};

export type Client = {
  key: string;
  name: string;
  clickupId: string | null;
  serviceMode: string | null;
  accounts: string[];
  days: DayRow[];
  campaigns: CampaignFact[];
  accountFacts: { id: string; status: number | null; billingSignal: string | null }[];
  /** newest Meta campaign status read on the client's accounts; null when none */
  budgetsFetchedAt: number | null;
  targets: Targets;
  csm: string | null;
};

export type Inputs = {
  today: string;
  since: string;
  clients: Client[];
  leadSync: Map<string, Row>;
  leadSyncAlerts: Map<string, Row>;
  members: Row[];
};

const acct = (x: unknown) => String(x ?? "").replace(/^act_/, "").trim();
export const nameKey = (s: unknown) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const inList = (xs: string[]) => `(${xs.map(x => `"${x.replace(/"/g, "")}"`).join(",")})`;
const num = (x: unknown) => (x === null || x === undefined || x === "" ? null : Number(x));

function line(rows: Row[], scope: string, metric: string): Line | null {
  const r = rows.find(t => t.scope_key === scope && t.metric === metric && t.good !== null);
  return r ? { good: Number(r.good), watch: num(r.watch), source: scope === "defaults" ? "board" : "client" } : null;
}

export function targetsFor(rows: Row[], clickupId: string | null): Targets {
  const pick = (metric: string, official: { good: number; watch: number }): Line =>
    (clickupId ? line(rows, `client:${clickupId}`, metric) : null) ??
    line(rows, "defaults", metric) ?? { good: official.good, watch: official.watch, source: "official" };
  return { cpl: pick("cpl", OFFICIAL.cpl), cpb: pick("cost_per_booking", OFFICIAL.cpb) };
}

/**
 * Which Meta campaigns are Mahara's: a campaign that has, or had, a card on the Ads
 * Management board, never an internal one (the board's rule, 20261022x). Matched by Meta
 * id, else by name on the same ad account.
 */
export function maharaCampaigns(rows: Row[]) {
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const r of rows) {
    if (String(r.internal ?? "false") === "true") continue;
    if (!(r.task_id || r.task_id_raw)) continue;
    for (const id of [r.meta_campaign_id, r.meta_campaign_id_raw]) if (id) ids.add(String(id));
    if (r.campaign_name && r.meta_account_id) names.add(`${acct(r.meta_account_id)}|${String(r.campaign_name).trim()}`);
  }
  const accounts = new Set(
    rows.filter(r => String(r.internal ?? "false") !== "true" && (r.task_id || r.task_id_raw) && r.meta_account_id).map(r => acct(r.meta_account_id)),
  );
  const isMahara = (accountId: string, campaignId: string, campaignName: string) => ids.has(campaignId) || names.has(`${accountId}|${String(campaignName ?? "").trim()}`);
  /** Accounts that carry, or carried, a Mahara campaign: only these must be read before a day counts. */
  isMahara.accounts = accounts;
  return isMahara;
}

/** Every day from `since` to `today` for one client; the store's coverage decides null vs 0. */
export function buildDays(x: {
  since: string;
  today: string;
  accounts: string[];
  adRows: Row[];
  readThrough: Map<string, string | null>;
  dayRows: Row[];
}): DayRow[] {
  // A client with no Mahara campaign on any account has nothing of Mahara's to read: its
  // spend is 0, not unknown. Every account that carries one must be read through the day.
  const known = (day: string) => x.accounts.every(a => (x.readThrough.get(a) ?? "") >= day);
  const spend = new Map<string, number>();
  const leads = new Map<string, number>();
  const leadsUnknown = new Set<string>();
  for (const r of x.adRows) {
    const s = num(r.spend_usd) ?? 0;
    spend.set(r.day, (spend.get(r.day) ?? 0) + s);
    if (r.leads === null || r.leads === undefined) {
      if (s > 0) leadsUnknown.add(r.day);
    } else leads.set(r.day, (leads.get(r.day) ?? 0) + Number(r.leads));
  }
  const cd = new Map(x.dayRows.map(r => [String(r.day), r]));
  const out: DayRow[] = [];
  for (let day = x.since; day <= x.today; day = addDays(day, 1)) {
    const k = known(day);
    const c = cd.get(day);
    out.push({
      day,
      spend: k ? Math.round((spend.get(day) ?? 0) * 100) / 100 : null,
      metaLeads: !k ? null : leadsUnknown.has(day) && !leads.has(day) ? null : (leads.get(day) ?? 0),
      crmAdLeads: c ? num(c.crm_ad_leads) : null,
      bookings: c ? num(c.confirmed_bookings) : null,
    });
  }
  return out;
}

export async function loadInputs(db: Db, nowMs: number, lookbackDays: number): Promise<Inputs> {
  const today = kuwaitDay(nowMs);
  const since = addDays(today, -lookbackDays);
  const board = await db.all("cockpit_board_clients", "select=location_id,clickup_id,client_name,service_mode,ad_account_ids&status=eq.Active");
  if (board.length < 5) throw new Error(`Only ${board.length} active clients on the board; refusing to judge against it`);
  const accounts = [...new Set(board.flatMap(b => (b.ad_account_ids ?? []).map(acct)).filter(a => /^\d{6,}$/.test(a)))];
  const locations = board.map(b => String(b.location_id));

  // One read per table, one after another: small reads, no burst on the Small database.
  const q = (table: string, query: string) => db.all(table, query);
  const adRows = await q("cockpit_meta_ad_days", `select=account_id,day,campaign_id,campaign_name,ad_id,spend_usd,leads&account_id=in.${inList(accounts)}&day=gte.${since}`);
  const tasks = await q("cockpit_meta_ad_day_tasks", `select=account_id,until&kind=eq.days&state=eq.done&account_id=in.${inList(accounts)}&updated_at=gte.${new Date(nowMs - 48 * 3_600_000).toISOString()}`);
  const excluded = await q("cockpit_excluded_ads", "select=ad_id");
  const campaigns = await q("cockpit_campaigns", "select=meta_account_id,meta_campaign_id,task_id,campaign_name:raw_data->>campaignName,task_id_raw:raw_data->>taskId,meta_campaign_id_raw:raw_data->>metaCampaignId,internal:raw_data->>internal");
  const dayRows = await q("cockpit_client_days", `select=location_id,day,crm_ad_leads,confirmed_bookings&location_id=in.${inList(locations)}&day=gte.${since}`);
  const budgets = await q("cockpit_meta_budgets", `select=object_id,account_id,name,switched_on,delivering,why_not,start_time,starts_at,fetched_at&level=eq.campaign&account_id=in.${inList(accounts)}`);
  const accountState = await q("cockpit_meta_account_state", `select=account_id,account_status&account_id=in.${inList(accounts)}`);
  const billing = await q("cockpit_ad_billing_bindings", `select=account_id,signal,enabled&account_id=in.${inList(accounts)}`);
  const targetRows = await q("cockpit_board_targets", "select=scope_key,metric,good,watch&metric=in.(cpl,cost_per_booking)");
  const leadSync = await q("cockpit_lead_sync_status", "select=client_key,client_name,location_id,state,reason,episode_id,meta_24h,crm_24h");
  const members = await q("cockpit_members", "select=email,name,roles,clients,active&active=is.true");
  const csmRows = await q("cockpit_csm_sources", "select=source_snapshot_at,task:data->>taskId,csm:data->>csmAssigned&table_name=eq.clients&order=source_snapshot_at.desc");

  const readThrough = new Map<string, string | null>();
  for (const t of tasks) {
    const a = acct(t.account_id);
    const u = t.until ? String(t.until).slice(0, 10) : null;
    if (u && (readThrough.get(a) ?? "") < u) readThrough.set(a, u);
  }
  const out = new Set(excluded.map(e => String(e.ad_id)));
  const isMahara = maharaCampaigns(campaigns);
  const mine = adRows.filter(r => !out.has(String(r.ad_id)) && isMahara(acct(r.account_id), String(r.campaign_id), r.campaign_name));
  const budgetById = new Map(budgets.map(b => [String(b.object_id), b]));
  const csmByTask = new Map<string, string>();
  for (const r of csmRows) if (r.task && !csmByTask.has(String(r.task)) && r.csm) csmByTask.set(String(r.task), String(r.csm).trim());
  const lsByLocation = new Map(leadSync.filter(r => r.location_id).map(r => [String(r.location_id), r]));

  const clients: Client[] = board.map(b => {
    const accts = (b.ad_account_ids ?? []).map(acct).filter((a: string) => /^\d{6,}$/.test(a));
    const ads = mine.filter(r => accts.includes(acct(r.account_id)));
    const byCampaign = new Map<string, Row[]>();
    for (const r of ads) {
      const k = String(r.campaign_id);
      if (!byCampaign.has(k)) byCampaign.set(k, []);
      byCampaign.get(k)!.push(r);
    }
    const facts: CampaignFact[] = [...byCampaign.entries()].map(([id, rows]) => {
      const spendByDay: Record<string, number> = {};
      for (const r of rows) spendByDay[r.day] = (spendByDay[r.day] ?? 0) + (num(r.spend_usd) ?? 0);
      const spent = Object.entries(spendByDay).filter(([, v]) => v > 0).map(([d]) => d).sort();
      const bud = budgetById.get(id);
      const start = bud ? Date.parse(bud.starts_at ?? bud.start_time) : NaN;
      return {
        id,
        name: String(rows[0].campaign_name ?? bud?.name ?? id),
        accountId: acct(rows[0].account_id),
        firstSpendDay: spent[0] ?? null,
        lastSpendDay: spent[spent.length - 1] ?? null,
        startAt: Number.isFinite(start) ? start : null,
        switchedOn: bud ? Boolean(bud.switched_on) : null,
        delivering: bud ? Boolean(bud.delivering) : null,
        whyNot: String(bud?.why_not ?? ""),
        spendByDay,
      };
    });
    return {
      key: String(b.location_id),
      name: String(b.client_name),
      clickupId: b.clickup_id ? String(b.clickup_id) : null,
      serviceMode: b.service_mode ?? null,
      accounts: accts,
      days: buildDays({ since, today, accounts: accts.filter((a: string) => isMahara.accounts.has(a)), adRows: ads, readThrough, dayRows: dayRows.filter(r => String(r.location_id) === String(b.location_id)) }),
      campaigns: facts,
      accountFacts: accts.map((a: string) => ({
        id: a,
        status: num(accountState.find(s => acct(s.account_id) === a)?.account_status),
        billingSignal: billing.find(s => acct(s.account_id) === a && s.enabled !== false)?.signal ?? null,
      })),
      budgetsFetchedAt:
        budgets
          .filter(r => accts.includes(acct(r.account_id)))
          .map(r => Date.parse(r.fetched_at))
          .filter(Number.isFinite)
          .reduce((m: number | null, t: number) => (m === null || t > m ? t : m), null),
      targets: targetsFor(targetRows, b.clickup_id ?? null),
      csm: b.clickup_id ? (csmByTask.get(String(b.clickup_id)) ?? null) : null,
    };
  });

  const episodes = [...lsByLocation.values()].map(r => r.episode_id).filter(Boolean);
  const lsAlerts = episodes.length
    ? await db.all("cockpit_lead_sync_alerts", `select=episode_id,status,slack_ts,channel,created_at&kind=eq.alert&episode_id=in.${inList(episodes)}`)
    : [];
  return {
    today,
    since,
    clients,
    leadSync: lsByLocation,
    leadSyncAlerts: new Map(lsAlerts.map(r => [String(r.episode_id), r])),
    members,
  };
}
