import type { Note, PortalPayload } from "../payloads";
import { B2B, ms, num, sql } from "../sb";
import { kuwaitDay } from "../time";
import type { Adapter, DailyPoint, SourceStamp } from "../types";

/**
 * The portal's own refresh jobs rewrite __state__ about every half hour, as
 * do sign-ins and renewals, so half a day without a write means it has stopped.
 */
const STATE_STALE_MS = 12 * 3600_000;
/** The appointments sheet mirror syncs about hourly. */
const SHEET_STALE_MS = 3 * 3600_000;
/** The self-check runs about hourly. */
const HEALTH_STALE_MS = 6 * 3600_000;
/** The encrypted backup runs nightly. */
const BACKUP_STALE_MS = 36 * 3600_000;

const errText = (e: unknown) =>
  String(e instanceof Error ? e.message : e).slice(0, 160);

const hoursAgo = (at: number, now: number) => Math.round((now - at) / 3600_000);

/** "stale:previews" as "stale previews". */
const issueText = (code: string) => code.replace(/[:-]/g, " ");

const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

// mahara_portal_documents is the portal's JSON file store. It also holds
// session tokens, member emails, encrypted CRM credentials and lead rows, so
// every query below projects named fields and returns counts, client business
// names and timestamps only. Never select a body.

/**
 * Core: counts from the portal state, directory, access grants, health and
 * backup. directory.json still lists cancelled clients (23 of them kept their
 * access), so client, access and CRM counts cover current clients only and
 * cancelled ones are counted apart. Casts sit inside CASE because Postgres
 * does not promise to check the type test in a WHERE first.
 */
const CORE_SQL = `with docs as (
  select key, body, updated_at from public.mahara_portal_documents
  where key in ('__state__', 'directory.json', 'client-access.json', 'health.json', 'backup-status.json')
),
st as (select body from docs where key = '__state__'),
dir as (
  select e->>'id' as client_id,
    lower(coalesce(e->>'status', '')) in ('cancelled', 'canceled', 'churned') as cancelled
  from docs, jsonb_array_elements(case when jsonb_typeof(docs.body) = 'array' then docs.body else '[]'::jsonb end) e
  where docs.key = 'directory.json' and coalesce(e->>'id', '') <> ''
),
access as (
  select p.key as client_id
  from docs, jsonb_each(case when jsonb_typeof(docs.body->'profiles') = 'object' then docs.body->'profiles' else '{}'::jsonb end) p
  where docs.key = 'client-access.json'
    and jsonb_typeof(p.value->'principals') = 'array'
    and jsonb_array_length(p.value->'principals') > 0
),
sess as (
  select s.value->>'clientId' as client_id, lower(s.value->>'email') as person
  from st, jsonb_each(case when jsonb_typeof(st.body->'sessions') = 'object' then st.body->'sessions' else '{}'::jsonb end) s
  where s.value->>'role' = 'client'
    and case when jsonb_typeof(s.value->'expires') = 'number' then (s.value->>'expires')::numeric end > extract(epoch from now()) * 1000
),
crm as (
  select c.value->>'locationId' as client_id, c.value->>'status' = 'connected' as connected
  from st, jsonb_each(case when jsonb_typeof(st.body->'crmConnections') = 'object' then st.body->'crmConnections' else '{}'::jsonb end) c
),
outc as (
  select o.key
  from st, jsonb_each(case when jsonb_typeof(st.body->'outcomes') = 'object' then st.body->'outcomes' else '{}'::jsonb end) o
),
health as (select body from docs where key = 'health.json'),
backup as (select body from docs where key = 'backup-status.json')
select
  (select string_agg(key, ',' order by key) from docs) as found,
  (select concat_ws(',',
      case when jsonb_typeof(body->'sessions') <> 'object' then 'sessions' end,
      case when jsonb_typeof(body->'crmConnections') <> 'object' then 'crmConnections' end,
      case when jsonb_typeof(body->'outcomes') <> 'object' then 'outcomes' end)
    from st) as bad_state,
  (select jsonb_typeof(body->'profiles') <> 'object' from docs where key = 'client-access.json') as bad_access,
  (select count(distinct client_id) from dir) as directory_total,
  (select count(distinct client_id) from dir where not cancelled) as clients_current,
  (select count(distinct client_id) from dir where cancelled) as clients_cancelled,
  (select count(distinct client_id) from dir join access using (client_id) where not cancelled) as with_access,
  (select count(distinct client_id) from dir join access using (client_id) where cancelled) as cancelled_with_access,
  (select count(*) from sess) as live_sessions,
  (select count(distinct person) from sess) as live_people,
  (select count(distinct client_id) from sess) as live_clients,
  (select count(*) from outc) as outcomes_submitted,
  (select count(distinct client_id) from dir join crm using (client_id) where not cancelled and connected) as crm_connected,
  (select count(distinct client_id) from dir join crm using (client_id) where not cancelled) as crm_total,
  (select left(body->>'status', 40) from health) as health_status,
  (select case when jsonb_typeof(body->'issues') = 'array' then jsonb_array_length(body->'issues') end from health) as health_issues,
  (select string_agg(i, ',') from health, jsonb_array_elements_text(case when jsonb_typeof(body->'issues') = 'array' then body->'issues' else '[]'::jsonb end) i
    where i ~ '^[a-z-]+:[a-z0-9-]+$') as health_codes,
  (select body->>'checkedAt' from health) as health_checked_at,
  (select left(body->>'status', 40) from backup) as backup_status,
  (select body->>'restoreVerified' from backup) as backup_restore_verified,
  (select body->>'lastSuccessAt' from backup) as backup_last_success_at,
  (select floor(extract(epoch from updated_at) * 1000) from docs where key = '__state__') as state_updated_ms`;

/**
 * Clients with a client session seen in the last 7 days. Last seen is the
 * latest of sign-in, renewal and creation; a missing time counts as never so
 * greatest() cannot turn it into 1970.
 */
const SEEN_SQL = `with st as (select body from public.mahara_portal_documents where key = '__state__'),
dir as (
  select distinct on (e->>'id') e->>'id' as client_id, nullif(trim(e->>'name'), '') as client_name
  from public.mahara_portal_documents d,
    jsonb_array_elements(case when jsonb_typeof(d.body) = 'array' then d.body else '[]'::jsonb end) e
  where d.key = 'directory.json'
),
seen as (
  select s.value->>'clientId' as client_id,
    max(greatest(
      case when jsonb_typeof(s.value->'authenticatedAt') = 'number' then (s.value->>'authenticatedAt')::numeric else 0 end,
      case when jsonb_typeof(s.value->'renewedAt') = 'number' then (s.value->>'renewedAt')::numeric else 0 end,
      case when jsonb_typeof(s.value->'created') = 'number' then (s.value->>'created')::numeric else 0 end
    ))::bigint as last_seen_ms
  from st, jsonb_each(case when jsonb_typeof(st.body->'sessions') = 'object' then st.body->'sessions' else '{}'::jsonb end) s
  where s.value->>'role' = 'client' and coalesce(s.value->>'clientId', '') <> ''
  group by 1
)
select coalesce(dir.client_name, 'Client not in directory') as client, seen.last_seen_ms
from seen left join dir using (client_id)
where seen.last_seen_ms >= extract(epoch from now() - interval '7 days') * 1000
order by seen.last_seen_ms desc
limit 100`;

/**
 * Appointment rows in the DB Appointments sheet mirror, and how many carry a
 * portal outcome. Rows drop trailing empty cells, so the column is found by
 * its header name, never by position.
 */
const SHEET_SQL = `with doc as (
  select body->'values' as v, body->>'syncedAt' as synced_at, updated_at
  from public.mahara_portal_documents where key = 'appointments.json'
),
hdr as (
  select h.name, (h.ord - 1)::int as idx
  from doc, jsonb_array_elements_text(case when jsonb_typeof(doc.v->0) = 'array' then doc.v->0 else '[]'::jsonb end) with ordinality h(name, ord)
),
c as (select max(idx) filter (where name = 'Portal Updated At') as pua from hdr),
r as (
  select x.row
  from doc, jsonb_array_elements(case when jsonb_typeof(doc.v) = 'array' then doc.v else '[]'::jsonb end) with ordinality x(row, ord)
  where x.ord > 1
)
select
  (select count(*) from doc) as found,
  (select count(*) from r) as appointment_rows,
  (select count(*) from r, c where c.pua is not null and nullif(trim(r.row->>c.pua), '') is not null) as sheet_outcomes,
  (select synced_at from doc) as synced_at,
  (select floor(extract(epoch from updated_at) * 1000) from doc) as updated_ms`;

/**
 * Client portal (Mahara OS): who has access, who is signed in, CRM links,
 * client-submitted outcomes and the portal's own health and backup, all read
 * from the portal's document store in the B2B Supabase project.
 */
export const portal: Adapter = {
  key: "portal",
  label: "Client portal",
  compute: async () => {
    const now = Date.now();
    const today = kuwaitDay(now);
    const notes: Note[] = [];

    // --- Core: without the state and directory there is nothing to show.
    const [s] = await sql(B2B, CORE_SQL);
    if (!s) throw new Error("portal: core query returned no row");
    const found = new Set(String(s.found ?? "").split(","));
    if (!found.has("__state__"))
      throw new Error("portal: the __state__ document is missing");
    if (!found.has("directory.json"))
      throw new Error("portal: the directory.json document is missing");
    if (num(s.directory_total) === 0)
      throw new Error("portal: directory.json lists no clients");

    // A part of the state in an unexpected shape reads as empty, which is not
    // a real zero: say so and keep it out of history.
    const badState = new Set(
      String(s.bad_state ?? "")
        .split(",")
        .filter(Boolean),
    );
    const accessOk =
      found.has("client-access.json") && String(s.bad_access) !== "true";
    if (badState.size)
      notes.push({
        level: "warn",
        text: `The portal state has an unexpected shape (${[...badState].join(", ")}), so those counts show 0.`,
      });
    if (!accessOk)
      notes.push({
        level: "warn",
        text: "The access list is missing or unreadable, so clients with access shows 0.",
      });

    const stateAt = num(s.state_updated_ms) || undefined;
    const sources: SourceStamp[] = [
      {
        name: "Mahara OS portal state",
        freshestAt: stateAt,
        ok:
          stateAt !== undefined &&
          now - stateAt < STATE_STALE_MS &&
          badState.size === 0 &&
          accessOk,
      },
    ];
    if (stateAt !== undefined && now - stateAt >= STATE_STALE_MS)
      notes.push({
        level: "warn",
        text: `The portal last saved its state ${hoursAgo(stateAt, now)} hours ago, so sessions and access may be out of date.`,
      });

    // --- Clients seen in the last 7 days (same state document).
    let seen7d: PortalPayload["seen7d"] = [];
    let seenOk = false;
    try {
      const rows = await sql(B2B, SEEN_SQL);
      seen7d = rows
        .map(r => ({
          client: String(r.client),
          lastSeenAt: num(r.last_seen_ms),
        }))
        .filter(r => r.lastSeenAt > 0);
      seenOk = !badState.has("sessions");
    } catch (e) {
      sources[0].note = `seen in 7 days failed: ${errText(e)}`;
      notes.push({
        level: "warn",
        text: "Clients seen in the last 7 days could not be read, so the list is empty.",
      });
    }

    // --- Appointment rows from the sheet mirror.
    let appointmentRows = 0;
    let sheetOutcomes: number | null = null;
    let sheetOk = false;
    try {
      const [a] = await sql(B2B, SHEET_SQL);
      if (!a || num(a.found) === 0)
        throw new Error("the appointments.json document is missing");
      appointmentRows = num(a.appointment_rows);
      sheetOutcomes = num(a.sheet_outcomes);
      sheetOk = true;
      const sheetAt = ms(a.synced_at) ?? (num(a.updated_ms) || undefined);
      const fresh = sheetAt !== undefined && now - sheetAt < SHEET_STALE_MS;
      sources.push({
        name: "Portal appointments mirror",
        freshestAt: sheetAt,
        ok: fresh,
      });
      if (!fresh)
        notes.push({
          level: "warn",
          text:
            sheetAt === undefined
              ? "The appointments sheet mirror has no sync time, so appointment rows may be out of date."
              : `The appointments sheet mirror last synced ${hoursAgo(sheetAt, now)} hours ago, so appointment rows may be out of date.`,
        });
    } catch (e) {
      sources.push({
        name: "Portal appointments mirror",
        ok: false,
        note: errText(e),
      });
      notes.push({
        level: "warn",
        text: "Appointment rows could not be read, so they show 0.",
      });
    }

    // --- Health and backup, as the portal reports them about itself.
    const healthStatus = s.health_status ? String(s.health_status) : null;
    const healthIssues = num(s.health_issues);
    if (healthStatus === null)
      notes.push({
        level: "warn",
        text: "The portal has no health report, so its health is not known.",
      });
    else if (healthStatus !== "ok" && healthStatus !== "healthy") {
      const codes = String(s.health_codes ?? "")
        .split(",")
        .filter(Boolean)
        .slice(0, 8)
        .map(issueText);
      notes.push({
        level: "warn",
        text: `The portal's self-check says ${healthStatus}${codes.length ? `: ${codes.join(", ")}` : ""}.`,
      });
    }
    const healthAt = ms(s.health_checked_at);
    if (healthAt !== undefined && now - healthAt > HEALTH_STALE_MS)
      notes.push({
        level: "warn",
        text: `The portal last checked its health ${hoursAgo(healthAt, now)} hours ago.`,
      });

    const backupAt = ms(s.backup_last_success_at);
    const backupVerified =
      s.backup_status === "verified" &&
      String(s.backup_restore_verified) === "true";
    if (!backupVerified || backupAt === undefined)
      notes.push({
        level: "warn",
        text: !s.backup_status
          ? "The portal has no backup report, so the backup is not known."
          : backupVerified
            ? "The portal backup report has no success time."
            : `The portal backup is not verified (status ${String(s.backup_status)}).`,
      });
    else if (now - backupAt > BACKUP_STALE_MS)
      notes.push({
        level: "warn",
        text: `The last verified portal backup is ${hoursAgo(backupAt, now)} hours old; it should run nightly.`,
      });

    // --- Access and trust caveats.
    const cancelledWithAccess = num(s.cancelled_with_access);
    if (accessOk && cancelledWithAccess > 0)
      notes.push({
        level: "warn",
        text: `${plural(cancelledWithAccess, "cancelled client still has", "cancelled clients still have")} portal access.`,
      });
    const clientsCurrent = num(s.clients_current);
    const crmTotal = num(s.crm_total);
    notes.push({
      level: "info",
      text: `Clients, access and CRM counts cover the ${clientsCurrent} current clients in the portal directory; ${plural(num(s.clients_cancelled), "cancelled client is", "cancelled clients are")} left out.`,
    });
    if (!badState.has("crmConnections") && crmTotal < clientsCurrent)
      notes.push({
        level: "info",
        text: `${plural(clientsCurrent - crmTotal, "current client has", "current clients have")} no CRM connection in the portal.`,
      });
    const liveSessions = num(s.live_sessions);
    notes.push({
      level: "info",
      text: `${
        liveSessions > 0
          ? `The ${plural(liveSessions, "live session belongs", "live sessions belong")} to ${plural(num(s.live_people), "person", "people")} at ${plural(num(s.live_clients), "client", "clients")}. `
          : ""
      }Sessions are deleted when they expire, so there is no login history: live sessions and last seen are a snapshot of now. Staff sessions are not counted.`,
    });
    const outcomesSubmitted = num(s.outcomes_submitted);
    notes.push({
      level: "info",
      text: `Outcomes are submitted by clients and are still sparse (${outcomesSubmitted}${sheetOk ? ` against ${appointmentRows} appointment rows` : " so far"}), so read them as counts, not a rate.`,
    });
    if (sheetOutcomes !== null && sheetOutcomes !== outcomesSubmitted)
      notes.push({
        level: "info",
        text:
          sheetOutcomes < outcomesSubmitted
            ? `The appointments sheet shows ${sheetOutcomes} portal outcomes against ${outcomesSubmitted} in the portal. The sheet syncs about hourly, so it can trail.`
            : `The appointments sheet shows ${sheetOutcomes} portal outcomes against ${outcomesSubmitted} in the portal.`,
      });

    const payload = {
      clientsInDirectory: clientsCurrent,
      withAccess: num(s.with_access),
      liveSessions,
      seen7d,
      outcomesSubmitted,
      appointmentRows,
      crm: { connected: num(s.crm_connected), total: crmTotal },
      health: { status: healthStatus, issues: healthIssues },
      backupVerifiedAt: backupVerified ? (backupAt ?? null) : null,
      notes,
    } satisfies PortalPayload;

    // Sessions are deleted at expiry, and access grants and CRM links are
    // overwritten, so these counts cannot be rebuilt later: keep today's
    // value as history. A failed or unreadable part is not a real zero, so it
    // stays out.
    const daily: DailyPoint[] = [];
    const point = (metric: string, value: number) =>
      daily.push({ date: today, metric, scope: "company", value });
    if (!badState.has("sessions"))
      point("portal.liveSessions", payload.liveSessions);
    if (accessOk) point("portal.withAccess", payload.withAccess);
    if (seenOk) point("portal.seen7d", seen7d.length);
    if (!badState.has("crmConnections"))
      point("portal.crmConnected", payload.crm.connected);

    return { payload, daily, sources };
  },
};
