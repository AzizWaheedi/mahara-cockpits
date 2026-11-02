/**
 * Client cost per lead, one rule for every CEO surface that shows the company
 * figure (Delivery, Today), the same as the Goals sheet's client CPL.
 *
 * 2026-11-02, Goals sheet round 2, fix 9. The CEO: "leads, I would get them
 * from the CRM, not just Meta". The delivery worker now pairs each client's
 * spend with its CRM ad leads (cockpit_client_days.crm_ad_leads: a contact
 * with an ad id or a Facebook-ad attribution) by client and day, and publishes
 * the sums as `crmSpend` and `crmAdLeads` on every window and every day
 * (CONTRACT-ROUND2.md). The cost per lead is crmSpend / crmAdLeads, so a
 * client's spend counts only on the days its CRM count is stored.
 *
 * Absent-safe: a payload stored before the worker's release has no such keys,
 * and then the figure is Meta's, as before, labelled "Meta form leads" so it
 * is never read as the CRM's. With the keys present but null (no client pairs
 * on those days, or Creative Triage was not read), the CRM figure is missing,
 * never zero, and the reason names Meta's figure beside it. The per-client
 * tables stay on Meta form leads: the worker pairs the company total only, and
 * the Client Performance board's per-client cost per lead is Meta's too.
 */

import type { DeliveryDay, DeliveryWindow } from "@/types/ceo/payloads";
import { count, isNum, money } from "./format";

/** What the delivery worker adds (CONTRACT-ROUND2.md); absent before its release. */
type CrmPair = {
  crmAdLeads?: number | null;
  crmSpend?: number | null;
  /** Spend with no CRM pair, per client: what the CRM cost per lead leaves out. */
  crmLeftOut?: { client: string; spend: number }[] | null;
};

export const CRM_AD_LEADS = "CRM ad leads";
export const META_FORM_LEADS = "Meta form leads";

export type ClientCpl = {
  /** Spend over leads, or null when it cannot be worked out. */
  value: number | null;
  /** "crm" once the worker pairs CRM ad leads; "meta" on an older payload. */
  basis: "crm" | "meta";
  /** The leads it divides by, named: "CRM ad leads" or "Meta form leads". */
  leadsLabel: string;
  /** The leads it divides by; null when the CRM was not measured. */
  leads: number | null;
  /** The spend it divides; null when the CRM was not measured. */
  spend: number | null;
  /** "929 CRM ad leads": the line under the figure, or null when there is none. */
  sub: string | null;
  /** The definition behind the info icon. */
  hint: string;
  /** Why the figure is n/a, when it is. */
  naHint: string;
};

const CRM_HINT =
  "Client ad spend over CRM ad leads: contacts in each client's GoHighLevel with an ad id or a Facebook-ad attribution, as the Client Performance board counts them. Spend and leads are paired by client and day, so a client's spend counts only on the days its CRM count is stored. The Goals sheet's client CPL uses the same rule. The per-client cost per lead in the tables still divides by Meta form leads, as the Client Performance board does.";

const META_HINT =
  "Client ad spend over Meta form leads. This refresh does not carry the clients' CRM ad leads yet, so the cost per lead counts Meta's form leads; once it does, it divides by CRM ad leads, as the Goals sheet does.";

/** "It leaves out $635.94 of spend with no CRM count: Pidco Group $635.94." */
function leftOutLine(
  left: { client: string; spend: number }[] | null | undefined,
): string {
  if (!Array.isArray(left) || left.length === 0) return "";
  const total = left.reduce((t, x) => t + (isNum(x.spend) ? x.spend : 0), 0);
  if (!(total > 0)) return "";
  const named = left
    .slice(0, 4)
    .map(x => `${x.client} ${money(x.spend)}`)
    .join("; ");
  const more = left.length > 4 ? `; and ${left.length - 4} more` : "";
  return ` It leaves out ${money(total)} of spend with no CRM count: ${named}${more}.`;
}

function crmOf(
  spend: number,
  leads: number,
  extra: string,
  metaLeads: number,
): ClientCpl {
  return {
    value: leads > 0 ? spend / leads : null,
    basis: "crm",
    leadsLabel: CRM_AD_LEADS,
    leads,
    spend,
    sub: `${count(leads)} ${CRM_AD_LEADS}`,
    hint: `${CRM_HINT}${extra} Meta form leads for the same days: ${count(metaLeads)}.`,
    naHint:
      "No CRM ad leads on these days, so there is no cost per lead on the CRM.",
  };
}

function notPaired(metaCpl: number | null): ClientCpl {
  return {
    value: null,
    basis: "crm",
    leadsLabel: CRM_AD_LEADS,
    leads: null,
    spend: null,
    sub: null,
    hint: CRM_HINT,
    naHint: `No client's CRM ad leads are stored for these days, so the cost per lead on the CRM cannot be worked out yet; it shows once the Client Performance board stores them.${isNum(metaCpl) ? ` On Meta form leads it is ${money(metaCpl)}.` : ""}`,
  };
}

function metaOf(spend: number, leads: number): ClientCpl {
  return {
    value: leads > 0 ? spend / leads : null,
    basis: "meta",
    leadsLabel: META_FORM_LEADS,
    leads,
    spend,
    sub: `${count(leads)} ${META_FORM_LEADS}`,
    hint: META_HINT,
    naHint: "No Meta form leads on these days, so there is no cost per lead.",
  };
}

/** The client cost per lead of one of the worker's windows (yesterday, last 7, prev 7, month to date). */
export function clientCplOf(w: DeliveryWindow): ClientCpl {
  const c = w as DeliveryWindow & CrmPair;
  if (c.crmAdLeads === undefined) {
    // Before the worker's release: the window's own Meta figure, unchanged.
    const meta = metaOf(w.spend, w.leads);
    return { ...meta, value: w.cpl };
  }
  if (isNum(c.crmAdLeads) && isNum(c.crmSpend))
    return crmOf(c.crmSpend, c.crmAdLeads, leftOutLine(c.crmLeftOut), w.leads);
  return notPaired(w.cpl);
}

/**
 * The same for any run of days from the daily series: sum(crmSpend) over
 * sum(crmAdLeads), skipping the days no client pairs (CONTRACT-ROUND2.md).
 * Spend the pairing leaves out is the series' spend less the paired spend.
 */
export function clientCplOfDays(
  rows: DeliveryDay[] | null | undefined,
  from: string,
  to: string,
): ClientCpl {
  const days = (rows ?? []).filter(r => r.date >= from && r.date <= to);
  const spend = days.reduce((t, r) => t + (isNum(r.spend) ? r.spend : 0), 0);
  const leads = days.reduce((t, r) => t + (isNum(r.leads) ? r.leads : 0), 0);
  const crm = days as (DeliveryDay & CrmPair)[];
  if (!crm.some(r => r.crmAdLeads !== undefined)) return metaOf(spend, leads);
  const paired = crm.filter(r => isNum(r.crmAdLeads) && isNum(r.crmSpend));
  if (!paired.length) return notPaired(leads > 0 ? spend / leads : null);
  const crmLeads = paired.reduce((t, r) => t + (r.crmAdLeads ?? 0), 0);
  const crmSpend =
    Math.round(paired.reduce((t, r) => t + (r.crmSpend ?? 0), 0) * 100) / 100;
  const out = Math.round((spend - crmSpend) * 100) / 100;
  return crmOf(
    crmSpend,
    crmLeads,
    out >= 0.01
      ? ` It leaves out ${money(out)} of spend on client-days with no CRM count.`
      : "",
    leads,
  );
}
