import type { Filter, Repository, Row } from "./runtime.ts";

const TRIAGE = "bldgtotkfmhoxmlzowdx";
const FAMILY_TABLES = {
  media: "cockpit_media_sources",
  csm: "cockpit_csm_sources",
  creative: "cockpit_creative_sources",
} as const;
const FAMILY_STATES = {
  media: "cockpit_media_source_state",
  csm: "cockpit_csm_source_state",
  creative: "cockpit_creative_source_state",
} as const;
const SOURCE_TABLES: Record<string, string> = {
  cockpit_media_sources: "cockpit_media_sources",
  cockpit_csm_sources: "cockpit_csm_sources",
  cockpit_creative_sources: "cockpit_creative_sources",
  cockpit_metric_days: "cockpit_metric_days",
  cockpit_sections: "cockpit_sections",
  cockpit_settings: "cockpit_settings",
  cockpit_sync_state: "cockpit_sync_state",
  cockpit_bank_lines: "cockpit_bank_lines",
};
const SOURCE_FIELDS: Record<string, Record<string, true>> = {
  cockpit_media_sources: { table_name: true, source_id: true, source_snapshot_at: true },
  cockpit_csm_sources: { table_name: true, source_id: true, source_snapshot_at: true },
  cockpit_creative_sources: { table_name: true, source_id: true, source_snapshot_at: true },
  cockpit_metric_days: { day: true, metric: true, scope: true, value: true, captured_at: true },
  cockpit_sections: { key: true, label: true, ok: true, computed_at: true, updated_at: true },
  cockpit_settings: { key: true, updated_at: true },
  cockpit_sync_state: { key: true, last_run_at: true, last_ok_at: true, ok: true, updated_at: true },
  cockpit_bank_lines: { id: true, statement_id: true, day: true, kind: true, category: true, account: true },
};
const SOURCE_ORDER: Record<string, string> = {
  cockpit_media_sources: "source_id",
  cockpit_csm_sources: "source_id",
  cockpit_creative_sources: "source_id",
  cockpit_metric_days: "day,metric,scope",
  cockpit_sections: "key",
  cockpit_settings: "key",
  cockpit_sync_state: "key",
  cockpit_bank_lines: "id",
};

type Feed = { rows: Row[]; stamp: number; count: number };
type ReadFunction = (project: string, query: string) => Promise<Row[]>;

function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function asRows(value: unknown, label: string): Row[] {
  if (!Array.isArray(value)) throw new Error(`${label} returned no row collection`);
  return value.map(row => {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error(`${label} returned an invalid row`);
    return row as Row;
  });
}

function asNumber(value: unknown, label: string): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} is not numeric`);
  return number;
}

function asJsonRows(value: unknown, label: string): Row[] {
  let parsed = value;
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed); }
    catch { throw new Error(`${label} is not valid JSON`); }
  }
  return asRows(parsed, label);
}

function filterSql(filters: Filter[]): string {
  const operators: Record<Filter["op"], string> = { eq: "=", gte: ">=", gt: ">", lte: "<=", lt: "<" };
  if (filters.length > 8) throw new Error("Repository read has too many filters");
  return filters.map(filter => {
    if (!/^[a-z_][a-z0-9_]*$/i.test(filter.field)) throw new Error("Repository filter field is invalid");
    if (filter.value === undefined) {
      if (filter.op !== "eq") throw new Error("Only equality filters may omit a value");
      return `"${filter.field}" IS NULL`;
    }
    const value = filter.value;
    if (value === null) return `"${filter.field}" IS NULL`;
    if (typeof value === "string") return `"${filter.field}" ${operators[filter.op]} ${quote(value)}`;
    if (typeof value === "number" && Number.isFinite(value)) return `"${filter.field}" ${operators[filter.op]} ${value}`;
    if (typeof value === "boolean") return `"${filter.field}" ${operators[filter.op]} ${value}`;
    throw new Error("Repository filter value must be scalar");
  }).join(" AND ");
}

function cleanDigest(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const masked = value
    .replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[email]")
    .replace(/\+?\d[\d\s-]{6,}\d/g, match => /^\d{4}-\d{1,2}-\d{1,2}$/.test(match) || match.replace(/\D/g, "").length < 8 ? match : "[number]")
    .replace(/\s+/g, " ")
    .trim();
  if (!masked) return null;
  if (masked.length <= 280) return masked;
  const cut = masked.slice(0, 277);
  const boundary = cut.lastIndexOf(" ");
  return `${boundary > 200 ? cut.slice(0, boundary) : cut}...`;
}

export function createRepository(read: ReadFunction): Repository {
  const feedCache = new Map<string, Promise<Feed>>();

  const feed = (family: keyof typeof FAMILY_TABLES, name: string): Promise<Feed> => {
    const cacheKey = `${family}:${name}`;
    const cached = feedCache.get(cacheKey);
    if (cached) return cached;
    const stateTable = FAMILY_STATES[family];
    const rowsTable = FAMILY_TABLES[family];
    const query = `
      SELECT s.ready, s.row_count, s.source_snapshot_at,
             floor(extract(epoch FROM s.source_snapshot_at) * 1000)::bigint AS stamp_ms,
             count(r.source_id)::bigint AS actual_count,
             coalesce(jsonb_agg(r.data ORDER BY r.source_id) FILTER (WHERE r.source_id IS NOT NULL), '[]'::jsonb) AS rows
      FROM public.${stateTable} s
      LEFT JOIN public.${rowsTable} r
        ON r.table_name=s.table_name AND r.source_snapshot_at=s.source_snapshot_at
      WHERE s.table_name=${quote(name)}
      GROUP BY s.ready,s.row_count,s.source_snapshot_at`;
    const loaded = (async (): Promise<Feed> => {
      const result = await read(TRIAGE, query);
      const row = result[0];
      if (!row) throw new Error(`Canonical ${family} source ${name} is missing`);
      if (row.ready !== true || row.source_snapshot_at === null || row.source_snapshot_at === undefined) {
        throw new Error(`Canonical ${family} source ${name} is not ready`);
      }
      const expected = asNumber(row.row_count, `${family}.${name} row_count`);
      const actual = asNumber(row.actual_count, `${family}.${name} actual_count`);
      if (expected !== actual) throw new Error(`Canonical ${family} source ${name} does not match its verified row count`);
      return { rows: asJsonRows(row.rows, `${family}.${name}`), stamp: asNumber(row.stamp_ms, `${family}.${name} snapshot`), count: actual };
    })();
    feedCache.set(cacheKey, loaded);
    return loaded;
  };

  const rawCampaigns = async (): Promise<{ rows: Row[]; stamp: number }> => {
    const rows = await read(TRIAGE, `
      SELECT raw_data || jsonb_build_object('syncedAt',floor(extract(epoch FROM synced_at)*1000)::bigint) AS data,
             floor(extract(epoch FROM synced_at)*1000)::bigint AS stamp_ms
      FROM public.cockpit_campaigns
      WHERE NOT source_deleted
      ORDER BY id`);
    if (!rows.length) throw new Error("Canonical Ads Management campaign rows are missing");
    const campaigns = rows.map(row => {
      let data = row.data;
      if (typeof data === "string") data = JSON.parse(data);
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Canonical campaign row is malformed");
      return data as Row;
    });
    return { rows: campaigns, stamp: Math.max(...rows.map(row => asNumber(row.stamp_ms, "campaign sync stamp"))) };
  };

  const billing = async (): Promise<Row[]> => {
    const rows = await read(TRIAGE, `
      SELECT DISTINCT ON (clickup_task_id) clickup_task_id AS "taskId", client_name AS name, stage,
             mrr_usd AS "mrrUsd", ltv_usd AS "ltvUsd", next_payment_usd AS "nextPaymentAmountUsd",
             source_currency AS currency, next_payment_date AS "nextPaymentDate", signup_date AS "signupDate",
             launch_date AS "launchDate", paused_on AS "pausedOn", churn_date AS "churnDate",
             next_renewal_date AS "nextContractRenewal", payment_plan AS "paymentPlan", payment_method AS "paymentMethod",
             contract_status AS "contractStatus", churn_reason AS "churnReason", churn_type AS "churnType",
             closer, lead_source AS "leadSource", floor(extract(epoch FROM captured_at)*1000)::bigint AS "syncedAt"
      FROM public.cockpit_client_billing_days
      ORDER BY clickup_task_id,day DESC`);
    if (!rows.length) throw new Error("Canonical client billing snapshots are missing");
    const newest = Math.max(...rows.map(row => asNumber(row.syncedAt, "billing capture time")));
    if (Date.now() - newest > 24 * 60 * 60_000) throw new Error("Canonical client billing snapshots are stale; refresh the ClickUp billing source");
    return rows;
  };

  const repository: Repository = {
    async read(table, filters, limit, descending = false) {
      const relation = SOURCE_TABLES[table];
      const fields = SOURCE_FIELDS[table];
      if (!relation || !fields) throw new Error(`Repository table ${table} is not an approved canonical source`);
      if (!Number.isInteger(limit) || limit < 1 || limit > 50_000) throw new Error("Repository read limit is outside 1..50000");
      for (const filter of filters) if (fields[filter.field] !== true) throw new Error(`Repository field ${filter.field} is not in the ${table} contract`);
      const where = filters.length ? `WHERE ${filterSql(filters)}` : "";
      const direction = descending ? "DESC" : "ASC";
      return read(TRIAGE, `SELECT * FROM public.${relation} ${where} ORDER BY ${SOURCE_ORDER[table]} ${direction} LIMIT ${limit}`);
    },

    async clients() {
      const [roster, linksFeed, commentsFeed, campaignsData] = await Promise.all([
        feed("csm", "clients"), feed("media", "clientLinks"), feed("media", "clientComments"), rawCampaigns(),
      ]);
      const clients = roster.rows.map(row => ({ ...row, syncedAt: row.syncedAt ?? roster.stamp }));
      const links = linksFeed.rows.map(row => ({
        name: row.name,
        aliases: Array.isArray(row.aliases) ? row.aliases : [],
        taskId: /\/t\/([A-Za-z0-9_-]+)/.exec(String(row.url ?? ""))?.[1] ?? null,
      })).filter(row => row.taskId);
      const campaigns = campaignsData.rows.filter(row => row.onBoard === true && row.internal !== true)
        .map(row => ({ ...row, syncedAt: row.syncedAt ?? campaignsData.stamp }));
      const latestUpdate: Record<string, { at: number; summary: string }> = {};
      for (const comment of commentsFeed.rows) {
        const taskId = String(comment.taskId ?? "");
        const summary = cleanDigest((comment.digest as Row | null)?.summary);
        if (!taskId || !summary || latestUpdate[taskId]) continue;
        latestUpdate[taskId] = { at: asNumber(comment.at, "client comment timestamp"), summary };
      }
      return { clients, links, campaigns, latestUpdate };
    },

    async delivery() {
      const today = new Date(Date.now() + 3 * 60 * 60_000).toISOString().slice(0, 10);
      const since = new Date(Date.parse(`${today}T00:00:00Z`) - 180 * 86_400_000).toISOString().slice(0, 10);
      const [campaignData, roster, offBoard, treeFeed, onboardings, launchWatch, syncRuns, dailyState, bookingState, dailyRows, bookingRows] = await Promise.all([
        rawCampaigns(), feed("csm", "clients"), feed("media", "offBoardCampaigns"), feed("media", "metaTree"),
        feed("media", "onboardings"), feed("media", "launchWatch"), feed("media", "syncRuns"),
        read(TRIAGE, `SELECT s.feed,s.ready,s.source_snapshot_at,s.source_rows,(SELECT count(*) FROM public.cockpit_media_daily_stats)::bigint AS actual_rows FROM public.cockpit_media_feed_state s WHERE s.feed='dailyStats'`),
        read(TRIAGE, `SELECT s.feed,s.ready,s.source_snapshot_at,s.source_rows,(SELECT count(*) FROM public.cockpit_media_booking_events)::bigint AS actual_rows FROM public.cockpit_media_feed_state s WHERE s.feed='bookingEvents'`),
        read(TRIAGE, `SELECT data FROM public.cockpit_media_daily_stats WHERE day>=date '${since}' ORDER BY day,campaign_name,source_id LIMIT 50001`),
        read(TRIAGE, `SELECT data FROM public.cockpit_media_booking_events WHERE day>=date '${since}' ORDER BY day,campaign_name,source_id LIMIT 50001`),
      ]);
      for (const state of [dailyState[0], bookingState[0]]) {
        if (!state || state.ready !== true || state.source_snapshot_at == null || asNumber(state.source_rows, "media feed source_rows") !== asNumber(state.actual_rows, "media feed actual_rows")) {
          throw new Error("Canonical media statistics or booking history is not ready or does not match its source count");
        }
      }
      if (dailyRows.length > 50_000 || bookingRows.length > 50_000) throw new Error("Canonical media history exceeds the verified read limit");
      const campaigns = campaignData.rows.filter(row => row.onBoard === true && row.internal !== true)
        .map(row => ({ ...row, syncedAt: row.syncedAt ?? campaignData.stamp }));
      const daily = dailyRows.map(row => typeof row.data === "string" ? JSON.parse(row.data) as Row : row.data as Row);
      const bookings: Row[] = [];
      let bookingsSyncedAt = 0;
      // Legacy groups: campaignName -> groupKey -> syncedAt -> count
      const legacyGroups = new Map<string, Map<string, Map<number, number>>>();
      const modernMap = new Map<string, Row>();

      for (const row of bookingRows) {
        const data = (typeof row.data === "string" ? JSON.parse(row.data) : row.data) as Row;
        const date = String(data.date ?? "");
        const campaignName = String(data.campaignName ?? "");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !campaignName) {
          throw new Error("Canonical booking event has no stable campaign, date, or event identity");
        }

        const eventId = String(data.eventId ?? data.id ?? data.contactId ?? "");
        const hasLegacyGroupFields = data.appointmentDate !== undefined || (data.status !== undefined && data.eventId === undefined && data.contactId === undefined);

        if (!eventId && hasLegacyGroupFields) {
          if (data.status === undefined || data.status === null) {
            throw new Error("Canonical booking event has no verified calendar classification");
          }
          const rawStatus = String(data.status).trim().toLowerCase();
          let kind: "provisional" | "confirmed" | null = null;
          if (rawStatus === "provisional" || rawStatus === "not confirmed") {
            kind = "provisional";
          } else if (rawStatus === "confirmed" || rawStatus === "showed" || rawStatus === "noshow") {
            kind = "confirmed";
          }
          if (!kind) throw new Error("Canonical booking event has no verified calendar classification");

          if (data.syncedAt === undefined || data.syncedAt === null) {
            throw new Error("Canonical legacy booking event has no verified syncedAt timestamp");
          }
          const syncStamp = asNumber(data.syncedAt, "legacy booking syncedAt");
          if (!Number.isFinite(syncStamp) || syncStamp <= 0) {
            throw new Error("Canonical legacy booking event has no verified syncedAt timestamp");
          }
          bookingsSyncedAt = Math.max(bookingsSyncedAt, syncStamp);

          const groupKey = [
            date,
            kind,
            String(data.client ?? ""),
            String(data.appointmentDate ?? ""),
            String(data.status),
            String(data.adId ?? ""),
          ].join("|");

          let campaignMap = legacyGroups.get(campaignName);
          if (!campaignMap) {
            campaignMap = new Map<string, Map<number, number>>();
            legacyGroups.set(campaignName, campaignMap);
          }
          const bySync = campaignMap.get(groupKey) ?? new Map<number, number>();
          bySync.set(syncStamp, (bySync.get(syncStamp) ?? 0) + 1);
          campaignMap.set(groupKey, bySync);
          continue;
        }

        const eventTime = String(data.startTime ?? data.date ?? "");
        if (!eventId || !eventTime) {
          throw new Error("Canonical booking event has no stable campaign, date, or event identity");
        }
        const calendar = String(data.kind ?? data.calendarType ?? data.calendar ?? data.calendarName ?? data.status ?? "").toLowerCase();
        const kind = /provisional|not confirmed/.test(calendar) ? "provisional" : /confirmed|main|online/.test(calendar) ? "confirmed" : null;
        if (!kind) throw new Error("Canonical booking event has no verified calendar classification");

        const identity = JSON.stringify([campaignName, String(data.locationId ?? ""), eventId, eventTime]);
        const existing = modernMap.get(identity);
        if (existing) {
          existing.copies = Number(existing.copies ?? 0) + 1;
        } else {
          modernMap.set(identity, {
            ...data,
            campaignName,
            date,
            kind,
            count: typeof data.count === "number" ? data.count : 1,
            future: date > today ? (typeof data.count === "number" ? data.count : 1) : 0,
            copies: Number(data.copies ?? 0),
          });
        }
      }

      for (const [campaignName, campaignMap] of legacyGroups) {
        // (date, kind) -> { count, copies }
        const bookedByDateAndKind = new Map<string, { count: number; copies: number; date: string; kind: "provisional" | "confirmed" }>();
        for (const [groupKey, bySync] of campaignMap) {
          const kept = Math.max(...bySync.values());
          let all = 0;
          for (const n of bySync.values()) all += n;
          const [groupDate, groupKind] = groupKey.split("|");
          const dateKindKey = `${groupDate}|${groupKind}`;
          const b = bookedByDateAndKind.get(dateKindKey) ?? { count: 0, copies: 0, date: groupDate, kind: groupKind as "provisional" | "confirmed" };
          b.count += kept;
          b.copies += all - kept;
          bookedByDateAndKind.set(dateKindKey, b);
        }
        for (const b of bookedByDateAndKind.values()) {
          bookings.push({
            campaignName,
            date: b.date,
            count: b.count,
            copies: b.copies,
            kind: b.kind,
            future: b.date > today ? b.count : 0,
          });
        }
      }

      for (const row of modernMap.values()) {
        bookings.push(row);
      }
      const latestRun = syncRuns.rows.slice().sort((a, b) => asNumber(b.at, "media sync timestamp") - asNumber(a.at, "media sync timestamp"))[0];
      const health = (latestRun?.health && typeof latestRun.health === "object" ? latestRun.health : {}) as Row;
      const dates = daily.map(row => String(row.date ?? "")).filter(Boolean).sort();
      const tasks = onboardings.rows.map(row => ({ ...row, syncedAt: row.syncedAt ?? onboardings.stamp }));
      const watch = launchWatch.rows.map(row => ({ ...row, syncedAt: row.syncedAt ?? launchWatch.stamp }));
      const tree = treeFeed.rows.map(row => ({ ...row, active: row.active ?? row.status === "ACTIVE" }));
      const stateStamp = (row: Row | undefined): number | undefined => row?.source_snapshot_at ? Date.parse(String(row.source_snapshot_at)) : undefined;
      return {
        today,
        campaigns,
        daily,
        bookings,
        clients: roster.rows.map(row => ({ ...row, taskId: row.taskId ?? row.id, onboarding: row.bucket ? row.bucket === "onboarding" : String(row.stage ?? "").toLowerCase().includes("onboard") })),
        offBoard: offBoard.rows,
        tree,
        launches: { tasks, watch },
        health,
        firstDate: dates[0] ?? null,
        lastDate: dates.at(-1) ?? null,
        
        bookingsSyncedAt: stateStamp(bookingState[0]) ?? (bookingsSyncedAt > 0 ? bookingsSyncedAt : undefined),
      };
    },

    async team() {
      const [mediaMembers, chat, manualChanges, comments, adChanges, decisionsFeed, eods, statuses, statusHistory, members] = await Promise.all([
        feed("media", "clickupMembers"), feed("media", "campaignChat"), feed("media", "manualChanges"),
        feed("media", "clientComments"), feed("media", "adChanges"), feed("csm", "decisions"),
        read(TRIAGE, `SELECT r.day::text AS day,
                     coalesce(
                       nullif(btrim(m_id.name), ''),
                       nullif(btrim(m_em.name), ''),
                       nullif(btrim(p.name), ''),
                       nullif(btrim(r.source_row->>'name'), ''),
                       nullif(btrim(r.source_row->>'person'), '')
                     ) AS name,
                     r.energy,
                     floor(extract(epoch FROM r.submitted_at)*1000)::bigint AS at,
                     r.role
              FROM public.cockpit_eod_reports r
              LEFT JOIN LATERAL (
                SELECT m.name
                FROM public.cockpit_members m
                WHERE r.owner_user_id IS NOT NULL AND m.auth_user_id = r.owner_user_id
                ORDER BY m.id
                LIMIT 1
              ) m_id ON true
              LEFT JOIN LATERAL (
                SELECT m.name
                FROM public.cockpit_members m
                WHERE r.owner_email IS NOT NULL AND lower(btrim(m.email)) = lower(btrim(r.owner_email))
                ORDER BY m.id
                LIMIT 1
              ) m_em ON true
              LEFT JOIN LATERAL (
                SELECT p.name
                FROM public.cockpit_people p
                WHERE r.owner_email IS NOT NULL AND lower(btrim(p.email)) = lower(btrim(r.owner_email))
                ORDER BY p.id
                LIMIT 1
              ) p ON true
              WHERE r.day >= (now() AT TIME ZONE 'Asia/Kuwait')::date-40
              ORDER BY r.submitted_at DESC
              LIMIT 1000`),
        read(TRIAGE, `SELECT person_key AS "personKey",status,since::text AS since,note,floor(extract(epoch FROM set_at)*1000)::bigint AS "setAt" FROM public.cockpit_team_status`),
        read(TRIAGE, `SELECT after->>'person_key' AS "personKey",after->>'status' AS status,after->>'since' AS since,floor(extract(epoch FROM created_at)*1000)::bigint AS at FROM public.cockpit_audit_log WHERE entity_type='cockpit_team_status' AND after IS NOT NULL ORDER BY created_at DESC LIMIT 2000`),
        read(TRIAGE, `SELECT p.name,p.role,p.active,p.engagement,floor(extract(epoch FROM p.added_at)*1000)::bigint AS "addedAt",floor(extract(epoch FROM m.last_seen_at)*1000)::bigint AS "lastSeenAt",m.roles FROM public.cockpit_people p LEFT JOIN public.cockpit_members m ON lower(btrim(m.email))=lower(btrim(p.email)) WHERE p.active OR m.active ORDER BY p.name LIMIT 1000`),
      ]);
      const today = new Date(Date.now() + 3 * 60 * 60_000).toISOString().slice(0, 10);
      const commentsToday = comments.rows.filter(row => String(row.at ?? "").slice(0, 10) === today).map(row => ({ ...row, by: row.by ?? row.author ?? null }));
      const digests = comments.rows.map(row => {
        const digest = row.digest && typeof row.digest === "object" ? row.digest as Row : {};
        return { by: row.by ?? row.author ?? null, at: row.at, summary: cleanDigest(digest.summary), campaignName: row.clientName ?? null };
      }).filter(row => row.summary);
      const memberRows = members.map(row => ({ ...row, roles: Array.isArray(row.roles) ? row.roles : [] }));
      const mediaNames = mediaMembers.rows.map(row => ({ id: row.id, name: row.name, username: row.username }));
      const decisionRows = decisionsFeed.rows.map(row => ({ ...row, at: row.at ?? row.createdAt, day: row.day ?? null }));
      return {
        members: memberRows.length ? memberRows : mediaNames,
        eods,
        statuses,
        statusChanges: statusHistory,
        chat: chat.rows,
        manualChanges: manualChanges.rows,
        decisions: decisionRows,
        digests,
        adChanges: adChanges.rows,
        adChangesRows: adChanges.count,
        commentsToday,
      };
    },

    async billing() { return billing(); },

    async jobs() {
      const rows = await read(TRIAGE, `SELECT key AS job,ok,note AS error,floor(extract(epoch FROM coalesce(last_ok_at,last_run_at))*1000)::bigint AS at,rows_seen AS "rowsSeen" FROM public.cockpit_sync_state ORDER BY key`);
      return rows.map(row => ({ ...row, ok: row.ok === true }));
    },

    async sources() {
      const feeds: Row[] = [];
      for (const family of ["media", "csm", "creative"] as const) {
        const table = FAMILY_STATES[family];
        const rows = await read(TRIAGE, `SELECT table_name AS source,ready AS ok,row_count AS rows,floor(extract(epoch FROM source_snapshot_at)*1000)::bigint AS "lastOkAt" FROM public.${table} ORDER BY table_name`);
        feeds.push(...rows.map(row => ({ ...row, source: `${family}:${String(row.source)}`, label: `${family} ${String(row.source)}`, ok: row.ok === true })));
      }
      return feeds;
    },

    async staleJobs() {
      const rows = await read(TRIAGE, `SELECT key AS job,ok,last_ok_at FROM public.cockpit_sync_state WHERE NOT ok OR last_ok_at IS NULL ORDER BY key`);
      return rows.map(row => ({ job: String(row.job), minutes: row.last_ok_at ? Math.max(0, Math.round((Date.now() - Date.parse(String(row.last_ok_at))) / 60_000)) : null }));
    },

    async askAiHealth() {
      const rows = await read(TRIAGE, `SELECT count(*) FILTER (WHERE status IN ('queued','claimed'))::int AS queued,count(*) FILTER (WHERE status='failed')::int AS failed,floor(extract(epoch FROM max(completed_at))*1000)::bigint AS "lastDoneAt" FROM public.cockpit_ask_ai_jobs WHERE app='media-buyer' AND NOT hidden`);
      if (!rows[0]) throw new Error("Canonical Ask AI health query returned no row");
      return rows[0];
    },
  };
  return repository;
}
