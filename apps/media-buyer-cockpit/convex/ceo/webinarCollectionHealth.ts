export type CollectionCheck = {
  key: string;
  label: string;
  status: "verified" | "processing" | "needs_attention" | "unavailable";
  lastSuccessAt: number | null;
  detail: string;
};
export type CollectionHealth = { checkedAt: number; checks: CollectionCheck[] };
export const WEBINAR_COLLECTION_HEALTH_SQL = `select
  (select coalesce(json_agg(x), '[]'::json) from (
    select distinct on(source) source, started_at, finished_at, ok, counts,
      (select max(q.finished_at) from public.cockpit_webinar_pulls q where q.source=p.source and q.ok) as last_ok
    from public.cockpit_webinar_pulls p where source in ('zoom','typeform','reminders')
    order by source,started_at desc) x) as pulls,
  (select json_build_object(
    'pending',count(*) filter(where state in ('ready','retry','running')),
    'uncertain',count(*) filter(where state='uncertain'),
    'blocked',count(*) filter(where state='blocked'),
    'oldest',min(created_at) filter(where state in ('ready','retry','running')))
    from public.cockpit_webinar_jobs) as queue,
  (select count(*) from public.cockpit_webinar_survey_receipts where registration_id is null) as unmatched_surveys,
  case when exists(select 1 from public.cockpit_webinar_event_versions v
    where v.revision=(select max(q.revision) from public.cockpit_webinar_event_versions q where q.event_id=v.event_id)
    and now() between v.scheduled_at-interval '36 hours' and v.scheduled_at+interval '6 hours') then 60 else 360 end as reminder_interval_minutes`;

const object = (x: unknown): Record<string, unknown> =>
  x !== null && typeof x === "object" && !Array.isArray(x)
    ? (x as Record<string, unknown>)
    : {};
const time = (x: unknown) =>
  typeof x === "string" && Number.isFinite(Date.parse(x))
    ? Date.parse(x)
    : null;
const count = (x: unknown) =>
  typeof x === "number" && Number.isInteger(x) && x >= 0 ? x : null;
export function collectionHealth(
  raw: unknown,
  now = Date.now(),
): CollectionHealth {
  const data = object(raw),
    rows = Array.isArray(data.pulls) ? data.pulls.map(object) : [];
  const checks: CollectionCheck[] = [];
  for (const [source, label] of [
    ["zoom", "Zoom collection"],
    ["typeform", "Survey collection"],
    ["reminders", "Reminder receipts"],
  ]) {
    const row = rows.find(r => r.source === source),
      c = object(row?.counts);
    const good = time(row?.last_ok),
      started = time(row?.started_at),
      finished = time(row?.finished_at);
    const interval =
      source === "reminders"
        ? data.reminder_interval_minutes === 60
          ? 60
          : 360
        : 60;
    let status: CollectionCheck["status"] = "verified",
      detail =
        "Recent successful source read. This does not prove the complete customer journey.";
    if (!row || good === null) {
      status = "unavailable";
      detail = "No successful source read is recorded.";
    } else if (good > now + 60000 || now - good > 2 * interval * 60000) {
      status = "needs_attention";
      detail = `Source collection missed two ${interval === 60 ? "hourly" : "six-hourly"} windows.`;
    } else if (row.ok === false || c.complete === false) {
      status = "needs_attention";
      detail = "Latest source read failed or reported incomplete coverage.";
    } else if (!finished || row.ok !== true) {
      status =
        started !== null && now - started <= 15 * 60000
          ? "processing"
          : "needs_attention";
      detail =
        status === "processing"
          ? "A source read is running."
          : "A source read did not finish within 15 minutes.";
    } else if (
      source === "typeform" &&
      (c.complete !== true ||
        count(c.received) === null ||
        count(c.source_total) === null ||
        c.received !== c.source_total)
    ) {
      status = "needs_attention";
      detail = "Survey pagination totals have not reconciled.";
    }
    checks.push({
      key: `webinar-${source}`,
      label,
      status,
      lastSuccessAt: good,
      detail,
    });
  }
  const queue = object(data.queue),
    pending = count(queue.pending),
    uncertain = count(queue.uncertain),
    blocked = count(queue.blocked),
    oldest = time(queue.oldest);
  const queueKnown = pending !== null && uncertain !== null && blocked !== null;
  const bad =
    queueKnown &&
    (uncertain > 0 ||
      blocked > 0 ||
      (pending > 0 && (oldest === null || now - oldest > 15 * 60000)));
  checks.push({
    key: "webinar-queue",
    label: "Registration processing",
    lastSuccessAt: null,
    status: !queueKnown
      ? "unavailable"
      : bad
        ? "needs_attention"
        : pending > 0
          ? "processing"
          : "verified",
    detail: !queueKnown
      ? "Queue could not be read."
      : bad
        ? `${uncertain} uncertain, ${blocked} held, ${pending} pending. Review before retrying provider writes.`
        : pending > 0
          ? `${pending} requests are processing.`
          : "No queued or uncertain provider work.",
  });
  const unmatched = count(data.unmatched_surveys);
  checks.push({
    key: "webinar-survey-links",
    label: "Survey attribution",
    lastSuccessAt: null,
    status:
      unmatched === null
        ? "unavailable"
        : unmatched > 0
          ? "needs_attention"
          : "verified",
    detail:
      unmatched === null
        ? "Unmatched survey count could not be read."
        : `${unmatched} responses need a registration reference. Name or email guesses are not used.`,
  });
  return { checkedAt: now, checks };
}
