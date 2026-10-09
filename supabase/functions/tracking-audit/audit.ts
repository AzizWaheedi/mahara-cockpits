// Tracking audit: the native port of convex/tracking.ts audit (daily 02:30 UTC).
//
// Reads every client ad account's ACTIVE ads from Meta and flags two faults:
// no URL parameters on the creative, and no lead form on an ad whose ad set
// delivers one. Reads only; nothing is written to Meta.
//
// Differences from Convex, on purpose:
// - An account Meta refuses is recorded on the run, and its earlier issues are
//   kept. Convex dropped them, which showed a broken account as clean.
// - Ads are paged with Meta's cursor (up to 1,000 per account); Convex read
//   the first 200 only.
// The weekly ClickUp backlog task (convex/tracking.ts backlogTask) is queued for
// the clickup-writeback function, which applies the dry-run gate.

export type Row = Record<string, any>;
export interface Provider {
  call(provider: "meta" | "clickup", method: string, path: string, body?: Row): Promise<Row>;
}

export const AD_FIELDS = "name,creative{url_tags,object_story_spec},adset{destination_type,optimization_goal}";
/** Marketing/ADs list, where Convex filed the weekly backlog task. */
export const BACKLOG_LIST = "901816723196";

export type Issue = { client: string; accountId: string; adId: string; adName: string; issue: string; detail: string };

/** The two checks, exactly as convex/tracking.ts makes them. */
export function issuesFor(ads: Row[], acc: { accountId: string; client: string }): Issue[] {
  const rows: Issue[] = [];
  for (const ad of ads) {
    const creative = ad.creative ?? {};
    const spec = creative.object_story_spec;
    const adset = ad.adset ?? {};
    if (!creative.url_tags) {
      rows.push({
        client: acc.client,
        accountId: acc.accountId,
        adId: String(ad.id),
        adName: ad.name ?? "",
        issue: "No URL parameters",
        detail:
          "The buildout checklist requires the UTM string on every ad. Without it this ad cannot be told apart from the others in reporting.",
      });
    }
    // Only judged when the ad set delivers a lead form on the ad and the creative is readable.
    const readable = Boolean(spec);
    const wantsLeadForm = adset.destination_type === "ON_AD";
    if (readable && wantsLeadForm) {
      const data = spec.video_data ?? spec.link_data ?? {};
      const leadForm = data.call_to_action?.value?.lead_gen_form_id;
      if (!leadForm) {
        rows.push({
          client: acc.client,
          accountId: acc.accountId,
          adId: String(ad.id),
          adName: ad.name ?? "",
          issue: "No lead form attached",
          detail: "This ad set delivers a lead form, but this ad has none.",
        });
      }
    }
  }
  return rows;
}

/** Week key like 2026-W41, Kuwait time (convex/tracking.ts weekKey). */
export function weekKey(now = Date.now()): string {
  const d = new Date(now + 3 * 3600_000);
  const jan1 = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d.getTime() - jan1) / 86400_000 + new Date(jan1).getUTCDay() + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export type Group = { client: string; count: number; ads: { adName: string; issue: string }[] };

/** Worst clients first (convex/tracking.ts issuesInternal). */
export function groupIssues(rows: { client: string; adName: string; issue: string }[]): Group[] {
  const byClient = new Map<string, { adName: string; issue: string }[]>();
  for (const r of rows) byClient.set(r.client, [...(byClient.get(r.client) ?? []), { adName: r.adName, issue: r.issue }]);
  return [...byClient.entries()].map(([client, ads]) => ({ client, count: ads.length, ads })).sort((a, b) => b.count - a.count);
}

/** The weekly backlog task, or null when there is nothing to file. */
export function backlogPayload(groups: Group[], now = Date.now()) {
  const total = groups.reduce((n, r) => n + r.count, 0);
  if (!total) return null;
  const week = weekKey(now);
  const lines = groups.map(r => `• ${r.client}: ${r.count} (${[...new Set(r.ads.map(a => a.issue))].join(", ")})`);
  return {
    week,
    listId: BACKLOG_LIST,
    priority: 4,
    total,
    name: `Tracking backlog · ${total} ads across ${groups.length} clients without UTM strings or a lead form (${week})`,
    description: [
      "Standing hygiene backlog from the Media Buyer Cockpit, refreshed weekly. The buildout checklist requires the UTM string on every ad and a lead form on every ON_AD ad set.",
      "",
      ...lines,
    ].join("\n"),
  };
}

/** One account's ACTIVE ads, following Meta's cursor. */
export async function readAccountAds(provider: Provider, accountId: string, maxPages = 5): Promise<Row[]> {
  const base = `act_${accountId}/ads?fields=${encodeURIComponent(AD_FIELDS)}&effective_status=${encodeURIComponent('["ACTIVE"]')}&limit=200`;
  const out: Row[] = [];
  let after = "";
  for (let page = 0; page < maxPages; page++) {
    const r = await provider.call("meta", "GET", after ? `${base}&after=${encodeURIComponent(after)}` : base);
    if (!Array.isArray(r.data)) throw new Error("Meta returned no ad list for this account");
    out.push(...r.data);
    after = String(r.paging?.cursors?.after ?? "");
    if (!r.paging?.next || !after) break;
  }
  return out;
}

export const redact = (s: string) => s.replace(/\bEAA[A-Za-z0-9]+/g, "[key]").replace(/Bearer\s+\S+/gi, "Bearer [key]").slice(0, 300);

export type Deps = {
  env: (name: string) => string | undefined;
  rpc: (name: string, params?: Row) => Promise<any>;
  providerFor: (actionId: string) => Provider;
  now: () => number;
};

export type AuditResult = { ok: boolean; note: string; counts?: Row };

async function idle(deps: Deps, ok: boolean, note: string): Promise<AuditResult> {
  await deps.rpc("cockpit_media_tracking_idle", { p_ok: ok, p_note: note });
  return { ok, note };
}

export async function runAudit(deps: Deps): Promise<AuditResult> {
  if (!deps.env("META_SYSTEM_TOKEN"))
    return idle(deps, false, "META_SYSTEM_TOKEN is not set on this Edge Function. Add it under Edge Functions, Secrets. The tracking issues were left as they were.");
  const inputs = await deps.rpc("cockpit_media_tracking_inputs", {});
  if (!inputs?.ready)
    return idle(deps, false, "The marketPlays source has not been imported and verified, so there is no list of ad accounts. The tracking issues were left as they were.");
  const accounts: { accountId: string; client: string }[] = inputs.accounts ?? [];
  if (!accounts.length) return idle(deps, false, "The marketPlays source lists no ad accounts. The tracking issues were left as they were.");
  const run = await deps.rpc("cockpit_media_tracking_begin", { p_accounts: accounts.length });
  if (!run?.id) return { ok: true, note: String(run?.note ?? "Another audit is in progress.") };
  const provider = deps.providerFor(run.id);
  const issues: Issue[] = [];
  const read: string[] = [];
  const failed: Row[] = [];
  let checked = 0;
  try {
    for (const acc of accounts) {
      const id = String(acc.accountId ?? "").replace(/^act_/, "");
      if (!/^\d{5,}$/.test(id)) {
        failed.push({ accountId: acc.accountId, client: acc.client, error: "Not a Meta ad account id." });
        continue;
      }
      try {
        const ads = await readAccountAds(provider, id);
        checked += ads.length;
        issues.push(...issuesFor(ads, { accountId: id, client: acc.client }));
        read.push(id);
      } catch (e) {
        const message = redact(String(e instanceof Error ? e.message : e));
        if (/is not configured/.test(message)) throw e;
        // An unreadable account is an access problem, not a tracking fault.
        failed.push({ accountId: id, client: acc.client, error: message });
      }
    }
    if (!read.length) {
      const note = `Meta refused all ${accounts.length} ad accounts, so the tracking issues were left as they were. First error: ${failed[0]?.error ?? "none"}`;
      await deps.rpc("cockpit_media_tracking_fail", { p_run: run.id, p_note: note, p_failed: failed });
      return { ok: false, note };
    }
    const published = await deps.rpc("cockpit_media_tracking_publish", {
      p_run: run.id,
      p_issues: issues,
      p_read: read,
      p_failed: failed,
      p_checked: checked,
    });
    const groups = groupIssues(published?.current ?? []);
    const backlog = backlogPayload(groups, deps.now());
    let queued = false;
    if (backlog) {
      // One ClickUp backlog task a week; clickup-writeback files it behind the dry-run gate.
      queued = Boolean(await deps.rpc("cockpit_clickup_writeback_enqueue", {
        p_dedupe_key: `tracking-backlog:${backlog.week}`,
        p_kind: "tracking_backlog",
        p_source_table: "cockpit_media_tracking_runs",
        p_source_id: run.id,
        p_payload: backlog,
      }));
    }
    const counts = { accounts: accounts.length, read: read.length, failed: failed.length, checked, issues: issues.length, current: (published?.current ?? []).length, backlogQueued: queued };
    return { ok: true, note: String(published?.note ?? `${checked} ads checked, ${issues.length} issues.`), counts };
  } catch (e) {
    const note = redact(String(e instanceof Error ? e.message : e));
    await deps.rpc("cockpit_media_tracking_fail", { p_run: run.id, p_note: note, p_failed: failed });
    return { ok: false, note };
  }
}
