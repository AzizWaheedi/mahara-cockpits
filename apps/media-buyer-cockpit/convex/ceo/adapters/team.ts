import { internal } from "../../_generated/api";
import type {
  FeedItem,
  Note,
  TeamPayload,
  TeamPerson,
  TeamStatus,
} from "../payloads";
import { B2B, num, sql } from "../sb";
import {
  buildTimeline,
  maskText,
  roleLabel,
  type StatusSegment,
  segmentOn,
  splitPersonKey,
  titleCase,
} from "../teamRules";
import { addDays, KUWAIT_OFFSET_MS, kuwaitDay } from "../time";
import type { Adapter, DailyPoint, SourceStamp } from "../types";

type Any = any;

/** Which EOD roles a portal seat can be. The first one is used if none match. */
const SEAT_ROLES: Record<string, string[]> = {
  media_buyer: ["media_buyer"],
  csm: ["account_manager", "client_sales_rep"],
  creative: ["creative_director", "video_editor"],
};

const SALES_ROLES = ["sales_rep", "sales_setter", "client_sales_rep"];
const MACHINES = /^(hermes|claude|meta|clickbot)$/i;
/** Aziz's own card comments and Meta edits are not the team's work. */
const LEADERSHIP = /^(abdulaziz|aziz)$/i;

/** Name key: lower case letters of the first word, so spelling variants of a surname merge. */
const nameKey = (s: unknown) =>
  String(s ?? "")
    .trim()
    .split(/\s+/)[0]
    .toLowerCase()
    .replace(/[^\p{L}]/gu, "");

const isFriday = (day: string) =>
  new Date(`${day}T00:00:00Z`).getUTCDay() === 5;

/** Epoch ms of 22:00 Kuwait on a Kuwait day: the on-time cut-off. */
const cutoff = (day: string) =>
  new Date(`${day}T22:00:00Z`).getTime() - KUWAIT_OFFSET_MS;

/**
 * The working day a filing belongs to. Between 00:00 and 04:00 Kuwait it is
 * the previous working day (Friday is off), and it is late.
 */
function eodDay(day: string, at: number): string {
  const local = kuwaitDay(at);
  const hour = new Date(at + KUWAIT_OFFSET_MS).getUTCHours();
  if (hour < 4 && (day === local || day === addDays(local, -1))) {
    const prev = addDays(local, -1);
    return isFriday(prev) ? addDays(local, -2) : prev;
  }
  return day;
}

const MONTHS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");
const dayLabel = (day: string) =>
  `${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;

/** "Liwan |MAHARA|20\8" -> "Liwan 20/8": the campaign name without the house tag. */
function shortName(name: string): string {
  const s = name
    .replace(/(\d{1,2})[\\-](\d{1,2})(?!\d)/g, "$1/$2")
    .replace(/\bma?hara\b/gi, " ")
    .replace(/[|_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return s || name.trim();
}

/**
 * Plain text for the feed: no em dashes, one line, bounded. Typed notes and
 * digests are free text, so emails and phone numbers are masked on the way out.
 */
const clean = (s: string, max = 200) => maskText(s, max);

/** "12000" -> "12,000", without relying on Intl in the Convex runtime. */
const thousands = (n: number) =>
  String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/**
 * A cockpit action line with its campaign. The change log and the campaign
 * thread both get the same toggle, so they must word it the same way for the
 * feed to fold them into one.
 */
function onSubject(text: string, subject: string): string {
  if (/renamed the board card/i.test(text)) return `${text} to ${subject}`;
  if (!subject || text.toLowerCase().includes(subject.toLowerCase()))
    return text;
  return `${text} on ${subject}`;
}

/** Rewrite the board's logged texts into short "did X" lines. */
function boardText(text: string): string {
  const status =
    /^Ad status on the board set to (.+?)(?: \(old card.*\))?$/i.exec(text);
  if (status) return `Set Ad Status to ${status[1]}`;
  const cities = /^Advertising cities on the board set to (.+)$/i.exec(text);
  if (cities) return `Set advertising cities to ${cities[1]}`;
  if (/^Advertising cities on the board cleared/i.test(text))
    return "Cleared advertising cities";
  if (/^Board card renamed/i.test(text)) return "Renamed the board card";
  if (/^Card added to the ads board/i.test(text))
    return "Added a card to the ads board";
  return text.replace(/ from the cockpit$/i, "");
}

type EodFiling = { day: string; at: number; onTime: boolean };
type Person = {
  key: string;
  role: string;
  first: string;
  since: string | null;
  days: Map<string, EodFiling>;
  energy: { at: number; value: number } | null;
  lastAt: number | null;
};
type Event = FeedItem & { personKey: string | null };

/** Team: EOD discipline over 14 working days, activity today and a live feed. */
export const team: Adapter = {
  key: "team",
  label: "Management",
  compute: async ctx => {
    const now = Date.now();
    const today = kuwaitDay(now);
    const yesterday = addDays(today, -1);
    const todayStart =
      new Date(`${today}T00:00:00Z`).getTime() - KUWAIT_OFFSET_MS;
    const notes: Note[] = [];
    const sources: SourceStamp[] = [];

    // Core: every EOD filed in the last month, one row per person per working
    // day. Both B2B tables (role forms and sales forms), keyed by role plus
    // first name, with the 00:00 to 04:00 rule applied to the day.
    const filings = await sql(
      B2B,
      `with b as (select (now() at time zone 'Asia/Kuwait')::date as today),
      f as (
        select t.role_key as role, t.person_name, t.report_date, t.submitted_at, t.energy
        from team_eod_reports t
        union all
        select 'sales_' || e.role, coalesce(sr.display_name, e.person_name), e.report_date, e.submitted_at, null::int
        from eod_reports e left join sales_reps sr on sr.id = e.sales_rep_id
      ),
      k as (
        select role, lower(regexp_replace(split_part(trim(person_name), ' ', 1), '[^[:alpha:]]', '', 'g')) as first,
          report_date, submitted_at, energy, submitted_at at time zone 'Asia/Kuwait' as local_at
        from f where submitted_at is not null
      ),
      d as (
        select *, case
            when extract(hour from local_at) < 4 and report_date in (local_at::date, local_at::date - 1)
              then local_at::date - case when extract(dow from local_at) = 6 then 2 else 1 end
            else report_date end as day
        from k
      ),
      s as (select role, first, min(day) as since from d group by 1, 2)
      select d.role, d.first, s.since::text as since, d.day::text as day,
        round(extract(epoch from min(d.submitted_at)) * 1000) as first_at,
        round(extract(epoch from max(d.submitted_at)) * 1000) as last_at,
        bool_or(d.local_at <= d.day + time '22:00') as on_time,
        (array_agg(d.energy order by d.submitted_at desc) filter (where d.energy is not null))[1] as energy
      from d join s using (role, first), b
      where d.day between b.today - 31 and b.today and d.first <> ''
      group by d.role, d.first, s.since, d.day
      order by d.day desc
      limit 1000`,
    );

    const data: Any = await ctx.runQuery(internal.ceo.data.team.load, {});

    const people = new Map<string, Person>();
    const personFor = (role: string, first: string): Person => {
      const key = `${role}:${first}`;
      let p = people.get(key);
      if (!p) {
        p = {
          key,
          role,
          first,
          since: null,
          days: new Map(),
          energy: null,
          lastAt: null,
        };
        people.set(key, p);
      }
      return p;
    };
    const addFiling = (
      p: Person,
      f: EodFiling,
      lastAt: number,
      energy: number | null,
    ) => {
      const prev = p.days.get(f.day);
      p.days.set(
        f.day,
        prev
          ? {
              day: f.day,
              at: Math.min(prev.at, f.at),
              onTime: prev.onTime || f.onTime,
            }
          : f,
      );
      if (!p.since || f.day < p.since) p.since = f.day;
      p.lastAt = Math.max(p.lastAt ?? 0, lastAt);
      if (energy !== null && (!p.energy || lastAt > p.energy.at))
        p.energy = { at: lastAt, value: energy };
    };

    for (const r of filings) {
      const p = personFor(String(r.role), String(r.first));
      addFiling(
        p,
        { day: String(r.day), at: num(r.first_at), onTime: r.on_time === true },
        num(r.last_at),
        r.energy === null || r.energy === undefined ? null : num(r.energy),
      );
      if (r.since && (!p.since || String(r.since) < p.since))
        p.since = String(r.since);
    }

    // Cockpit EODs (media buyer today, CSM later) count as filed too.
    for (const e of (data?.eods ?? []) as Any[]) {
      const first = nameKey(e.name);
      if (!first) continue;
      const role = e.role === "csm" ? "account_manager" : String(e.role);
      const day = eodDay(String(e.day), num(e.at));
      const energy = Number.parseFloat(String(e.energy ?? ""));
      addFiling(
        personFor(role, first),
        { day, at: num(e.at), onTime: num(e.at) <= cutoff(day) },
        num(e.at),
        Number.isFinite(energy) ? energy : null,
      );
    }

    // --- Hand-set statuses (the Management tab's switch) ---
    const STATUSES = new Set<string>(["active", "paused", "left"]);
    const statusRows = new Map<
      string,
      { status: TeamStatus; since: string; note: string | null; setAt: number }
    >();
    for (const s of (data?.statuses ?? []) as Any[])
      if (STATUSES.has(s.status) && typeof s.since === "string")
        statusRows.set(String(s.personKey), {
          status: s.status,
          since: s.since,
          note: s.note ? clean(String(s.note), 300) || null : null,
          setAt: num(s.setAt),
        });
    const changesByKey = new Map<
      string,
      { status: TeamStatus; since: string; at: number }[]
    >();
    for (const c of (data?.statusChanges ?? []) as Any[]) {
      if (!STATUSES.has(c.status)) continue;
      const key = String(c.personKey);
      const list = changesByKey.get(key) ?? [];
      list.push({ status: c.status, since: String(c.since), at: num(c.at) });
      changesByKey.set(key, list);
    }
    // Replay every change in the order it was set, then the row itself: the
    // row is the truth for the latest state even if its trail is short.
    const timelines = new Map<string, StatusSegment[]>();
    for (const [key, row] of statusRows) {
      const changes = (changesByKey.get(key) ?? []).sort((a, b) => a.at - b.at);
      timelines.set(key, buildTimeline([...changes, row]));
    }
    const noStatus: StatusSegment = { status: "active", since: "" };
    /** The status segment in force for a person on a Kuwait day. */
    const segment = (key: string, day: string): StatusSegment => {
      const t = timelines.get(key);
      return t ? segmentOn(t, day) : noStatus;
    };
    /** Nobody owes an EOD on a day they were paused or had left. */
    const offOn = (key: string, day: string) =>
      segment(key, day).status !== "active";
    const leftListedFrom = addDays(today, -30);
    /** Listed apart today: paused, or left in the last 30 days. */
    const listedApart = (key: string) => {
      const s = segment(key, today);
      return (
        s.status === "paused" ||
        (s.status === "left" && s.since >= leftListedFrom)
      );
    };

    // Only people still around: filed in the last 30 days, or hold a seat,
    // or are paused or recently left (listed apart even with no filing).
    const activeFrom = addDays(today, -30);
    for (const [key, p] of people)
      if (!listedApart(key) && ![...p.days.keys()].some(d => d >= activeFrom))
        people.delete(key);

    const seenAt = new Map<string, number>();
    for (const m of (data?.members ?? []) as Any[]) {
      const first = nameKey(m.name);
      if (!first) continue;
      const candidates = (m.roles as string[]).flatMap(
        r => SEAT_ROLES[r] ?? [],
      );
      if (!candidates.length) continue;
      const existing = [...people.values()].find(
        p => p.first === first && candidates.includes(p.role),
      );
      const p = existing ?? personFor(candidates[0], first);
      // A seat with no filings is due from the day it was added.
      if (!p.since && m.addedAt) p.since = kuwaitDay(num(m.addedAt));
      if (m.lastSeenAt) seenAt.set(p.key, num(m.lastSeenAt));
    }

    // A paused or recently left person with no filing and no seat is still
    // listed apart, named from the key.
    for (const key of timelines.keys()) {
      if (people.has(key) || !listedApart(key)) continue;
      const parts = splitPersonKey(key);
      if (parts) personFor(parts.role, parts.first);
    }

    // A filing on a day the person is marked paused or left is not counted
    // and does not flip the status back; it is named instead. Only the
    // current stretch off counts (someone already back needs no nudge). The
    // start day itself is often the last day worked ("left on 16 Sep", then
    // the final EOD that evening), so only filings for later days are named.
    /** People who filed while marked off: kept on the Not active list so the switch stays in reach. */
    const filedWhileOff = new Set<string>();
    for (const p of people.values()) {
      if (!timelines.has(p.key)) continue;
      const s = segment(p.key, today);
      if (s.status === "active") continue;
      const offDays = [...p.days.values()]
        .filter(f => f.day > s.since)
        .map(f => f.day)
        .sort();
      const last = offDays[offDays.length - 1];
      if (!last) continue;
      filedWhileOff.add(p.key);
      const who = `${titleCase(p.first)} (${roleLabel(p.role)})`;
      const name = titleCase(p.first);
      const filed =
        offDays.length > 1
          ? `filed ${offDays.length} EODs since, the latest for ${dayLabel(last)}`
          : `filed an EOD for ${dayLabel(last)}`;
      notes.push(
        s.status === "left"
          ? {
              level: "warn",
              text: `${who} is marked as left from ${dayLabel(s.since)} but ${filed}. The status was not changed and the filing is not counted: set ${name} back to active on the Management tab if they are back.`,
            }
          : {
              level: "info",
              text: `${who} is marked as paused from ${dayLabel(s.since)} but ${filed}. Paused days owe no EOD, so the filing is not counted: set ${name} back to active on the Management tab if they are back.`,
            },
      );
    }

    /** The one active person an actor's first name points to, if it is not ambiguous. */
    const match = (
      actor: string | null,
      prefer: string[] = [],
      onlyPreferred = false,
    ) => {
      const first = nameKey(actor);
      if (!first) return null;
      const all = [...people.values()].filter(p => p.first === first);
      const preferred = all.filter(p => prefer.includes(p.role));
      if (preferred.length === 1) return preferred[0];
      if (onlyPreferred) return null;
      return all.length === 1 ? all[0] : null;
    };

    // --- Feed events ---
    const since = now - 7 * 86_400_000;
    const events: Event[] = [];
    const push = (e: Event) => {
      if (e.at >= since && e.text) events.push(e);
    };

    for (const p of people.values())
      for (const f of p.days.values())
        push({
          at: f.at,
          actor: titleCase(p.first),
          role: roleLabel(p.role),
          kind: "eod",
          subject: titleCase(p.first),
          text: `Filed the EOD for ${dayLabel(f.day)}${f.onTime ? "" : ", late"}`,
          personKey: p.key,
        });

    // Secondary: deals signed on the New Client form, over the feed's week.
    // Voided deals are already deleted from closed_deals.
    let deals: Any[] = [];
    let dealsOk = true;
    try {
      deals = await sql(
        B2B,
        `select round(extract(epoch from d.submitted_at) * 1000) as at,
          d.business_name as business, split_part(trim(d.closer), ' ', 1) as closer,
          d.contracted_revenue as contracted
        from closed_deals d
        where d.submitted_at >= now() - interval '7 days'
        order by d.submitted_at desc
        limit 20`,
      );
    } catch (e) {
      dealsOk = false;
      notes.push({
        level: "warn",
        text: `Recent deals could not be read from B2B, so they are missing from the feed: ${String(e).slice(0, 120)}`,
      });
    }
    for (const d of deals) {
      const closer = d.closer ? titleCase(nameKey(d.closer)) : null;
      // Only a sales seat closes: a closer who stopped filing must not land on
      // someone else with the same first name (Ahmed is also the creative director).
      const p = match(closer, SALES_ROLES, true);
      const business = d.business ? clean(String(d.business), 80) : null;
      const contracted =
        d.contracted === null || d.contracted === undefined
          ? null
          : num(d.contracted);
      push({
        at: num(d.at),
        actor: closer,
        role: p ? roleLabel(p.role) : null,
        kind: "deal",
        subject: business ?? "New client",
        text: `Closed a deal with ${business ?? "a new client"}${contracted ? `, $${thousands(contracted)} contracted` : ""}`,
        personKey: p?.key ?? null,
      });
    }

    // Cockpit rows record no signed-in person: actor null, role from the cockpit.
    for (const c of (data?.chat ?? []) as Any[]) {
      const subject = shortName(String(c.campaignName ?? ""));
      if (c.kind === "action") {
        const raw = String(c.text ?? "");
        const hermes = /^Hermes:\s*/i.test(raw);
        const body = raw.replace(/^Hermes:\s*/i, "");
        // Hermes looking at an account is not a change.
        if (
          hermes &&
          /^(read|list|get|fetch|check|look|find|search|inspect|verify|view|pull|load|query)\b/i.test(
            body,
          )
        )
          continue;
        const text = hermes ? body : boardText(body);
        const failed = c.ok === false && !/fail/i.test(text) ? " (failed)" : "";
        push({
          at: num(c.at),
          actor: hermes ? "Hermes" : null,
          role: hermes ? null : roleLabel("media_buyer"),
          kind: hermes ? "hermes" : /board/i.test(raw) ? "board" : "cockpit",
          subject,
          text: clean(`${onSubject(text, subject)}${failed}`),
          personKey: null,
        });
      } else if (c.kind === "question") {
        // An answer comes back from leadership, not from the team.
        const answer = c.author !== "her";
        push({
          at: num(c.at),
          actor: null,
          role: answer ? null : roleLabel("media_buyer"),
          kind: answer ? "answer" : "question",
          subject,
          text: answer
            ? `Question answered on ${subject}`
            : `Asked a question about ${subject}`,
          personKey: null,
        });
      }
    }

    for (const m of (data?.manualChanges ?? []) as Any[]) {
      // Rehearsal builds are tests of the builder, not work.
      if (/rehearsal|delete me/i.test(String(m.campaignName))) continue;
      const subject = shortName(String(m.campaignName ?? ""));
      push({
        at: num(m.at),
        actor: null,
        role: roleLabel("media_buyer"),
        kind: "change",
        subject,
        text: clean(onSubject(boardText(String(m.what ?? "")), subject)),
        personKey: null,
      });
    }

    for (const d of (data?.decisions ?? []) as Any[]) {
      const subject = shortName(String(d.subject ?? ""));
      push({
        at: num(d.at),
        actor: null,
        role: roleLabel(String(d.role)),
        kind: "decision",
        subject,
        // "Left" is the choice to leave a recommendation undone.
        text: clean(
          d.kind === "left"
            ? `Left ${subject} as it is`
            : onSubject(String(d.action ?? ""), subject),
        ),
        personKey: null,
      });
    }

    const COMMENT_KINDS: Record<string, string> = {
      call: "Call notes",
      kickoff: "Kickoff notes",
      brief: "Brief",
      note: "Note",
    };
    for (const c of (data?.digests ?? []) as Any[]) {
      if (!c.summary) continue;
      const p = match(c.by);
      push({
        at: num(c.at),
        actor: c.by ? titleCase(nameKey(c.by)) : null,
        role: p ? roleLabel(p.role) : null,
        kind: "comment",
        subject: String(c.clientName),
        text: clean(
          `${COMMENT_KINDS[c.kind] ?? "Note"} on ${c.clientName}: ${c.summary}`,
          240,
        ),
        personKey: p?.key ?? null,
      });
    }

    for (const a of (data?.adChanges ?? []) as Any[]) {
      const p = match(a.actor, ["media_buyer"]);
      // The account's activity is copied onto each of its campaigns, so a
      // single campaign names it best; otherwise the changed object does.
      const campaigns = (a.campaigns as string[]).map(shortName);
      const subject =
        campaigns.length === 1
          ? campaigns[0]
          : shortName(String(a.objectName ?? campaigns[0] ?? ""));
      push({
        at: num(a.at),
        actor: a.actor ? titleCase(nameKey(a.actor)) : null,
        role: p ? roleLabel(p.role) : null,
        kind: "meta",
        subject,
        text: clean(`${a.eventType} on ${subject}`),
        personKey: p?.key ?? null,
      });
    }

    if ((data?.adChangesRows ?? 0) === 0)
      notes.push({
        level: "warn",
        text: "The last cockpit sync copied no Meta account activity, so changes made in Meta are missing from the feed and from actions today.",
      });

    // One click can land in two tables (a cockpit toggle writes the change
    // log and the campaign thread); keep one per subject, text and minute.
    const seen = new Set<string>();
    const unique = events
      .sort((a, b) => b.at - a.at)
      .filter(e => {
        const key = `${e.subject}|${e.text}|${Math.floor(e.at / 60_000)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    // --- Actions today per person (only where the actor is recorded) ---
    const actionsToday = new Map<string, number>();
    const lastAction = new Map<string, number>();
    let companyActionsToday = 0;
    for (const e of unique) {
      if (e.kind === "eod" || e.kind === "comment" || e.kind === "answer")
        continue;
      if (e.personKey) {
        lastAction.set(
          e.personKey,
          Math.max(lastAction.get(e.personKey) ?? 0, e.at),
        );
      }
      if (e.at < todayStart) continue;
      // The team's own actions: Hermes, the cockpit's Meta app and Aziz are not.
      if (!MACHINES.test(e.actor ?? "") && !LEADERSHIP.test(e.actor ?? ""))
        companyActionsToday++;
      if (e.personKey)
        actionsToday.set(e.personKey, (actionsToday.get(e.personKey) ?? 0) + 1);
    }
    // Every real card comment today counts, digested or not.
    for (const c of (data?.commentsToday ?? []) as Any[]) {
      if (MACHINES.test(c.by ?? "") || LEADERSHIP.test(c.by ?? "")) continue;
      companyActionsToday++;
      const p = match(c.by);
      if (!p) continue;
      actionsToday.set(p.key, (actionsToday.get(p.key) ?? 0) + 1);
      lastAction.set(p.key, Math.max(lastAction.get(p.key) ?? 0, num(c.at)));
    }
    for (const c of (data?.digests ?? []) as Any[]) {
      const p = match(c.by);
      if (p)
        lastAction.set(p.key, Math.max(lastAction.get(p.key) ?? 0, num(c.at)));
    }

    // --- People ---
    const workDays: string[] = [];
    for (let i = 1; i <= 14; i++) {
      const d = addDays(today, -i);
      if (!isFriday(d)) workDays.push(d);
    }

    const rows = [...people.values()].map((p): TeamPerson => {
      // Due: working days from the person's first filing or seat, minus the
      // days they were paused or had left.
      const due = workDays.filter(
        d => (!p.since || d >= p.since) && !offOn(p.key, d),
      );
      const filed = due.filter(d => p.days.has(d));
      const late = filed.filter(d => !p.days.get(d)?.onTime).length;
      const y = p.days.get(yesterday);
      const yesterdayDue =
        !isFriday(yesterday) &&
        (!p.since || yesterday >= p.since) &&
        !offOn(p.key, yesterday);
      const set = statusRows.get(p.key);
      const lastActiveAt = Math.max(
        p.lastAt ?? 0,
        seenAt.get(p.key) ?? 0,
        lastAction.get(p.key) ?? 0,
      );
      return {
        key: p.key,
        name: titleCase(p.first),
        role: roleLabel(p.role),
        eodYesterday: !yesterdayDue
          ? "not due"
          : !y
            ? "missed"
            : y.onTime
              ? "on time"
              : "late",
        eod14: {
          due: due.length,
          filed: filed.length,
          late,
          missed: due.length - filed.length,
        },
        lastActiveAt: lastActiveAt || null,
        actionsToday: actionsToday.get(p.key) ?? 0,
        energy: p.energy?.value ?? null,
        status: set?.status ?? "active",
        statusSince: set?.since ?? null,
        statusNote: set?.note ?? null,
        statusSetAt: set?.setAt ?? null,
      };
    });
    rows.sort(
      (a, b) =>
        b.eod14.missed - a.eod14.missed ||
        a.role.localeCompare(b.role) ||
        a.name.localeCompare(b.name),
    );

    // Active today goes on `people`, which every EOD count reads (this tab,
    // the Today card, the status sentence). That includes someone whose
    // pause or leave starts on a later day. Paused and recently left people
    // go on `inactive`, and so does anyone marked off who filed again (the
    // note names them, and the switch must stay in reach); anyone else who
    // left more than 30 days ago is on neither.
    const activeRows = rows.filter(r => !offOn(r.key, today));
    const statusRank: Record<TeamStatus, number> = {
      paused: 0,
      left: 1,
      active: 2,
    };
    const inactiveRows = rows
      .filter(r => listedApart(r.key) || filedWhileOff.has(r.key))
      .sort(
        (a, b) =>
          statusRank[segment(a.key, today).status] -
            statusRank[segment(b.key, today).status] ||
          (b.statusSince ?? "").localeCompare(a.statusSince ?? "") ||
          a.name.localeCompare(b.name),
      );

    // --- Sources and trust ---
    let syncRows: Any[] = [];
    try {
      syncRows = await sql(
        B2B,
        `select distinct on (source) source,
          round(extract(epoch from last_synced_at) * 1000) as last_synced_ms,
          last_sync_status as status
        from sync_state where source in ('typeform_eod', 'typeform')
        order by source, (account_id is not null) desc, last_synced_at desc nulls last`,
      );
    } catch {
      // Freshness only; the numbers above stand without it.
    }
    const sync = (source: string) => syncRows.find(r => r.source === source);
    const eodSync = sync("typeform_eod");
    const newestFiling = Math.max(0, ...filings.map(r => num(r.last_at)));
    // A run in progress reads "running"; last_synced_at only moves on success,
    // so the age check below catches a feed that stopped succeeding.
    const syncOk = (r: Any) => r?.status !== "error";
    const eodSyncOk = syncOk(eodSync);
    const eodSyncAt = eodSync ? num(eodSync.last_synced_ms) : 0;
    sources.push({
      name: "B2B EOD Typeforms",
      freshestAt: eodSyncAt || newestFiling || undefined,
      ok: eodSyncOk,
      note: eodSync
        ? undefined
        : "Last sync time not readable; newest filing shown",
    });
    if (!eodSyncOk || (eodSyncAt && now - eodSyncAt > 2 * 3600_000))
      notes.push({
        level: "warn",
        text: "The Typeform EOD sync is failing or more than 2 hours old, so recent filings may show as missed.",
      });
    const dealSync = sync("typeform");
    sources.push({
      name: "B2B closed deals",
      freshestAt: dealSync ? num(dealSync.last_synced_ms) : undefined,
      ok: dealsOk && syncOk(dealSync),
    });
    const convexNewest = Math.max(
      0,
      ...[
        ...(data?.chat ?? []),
        ...(data?.manualChanges ?? []),
        ...(data?.decisions ?? []),
        ...(data?.digests ?? []),
        ...(data?.adChanges ?? []),
        ...(data?.eods ?? []),
      ].map((r: Any) => num(r.at)),
    );
    sources.push({
      name: "Cockpit activity",
      freshestAt: convexNewest || undefined,
      ok: true,
      note:
        (data?.adChangesRows ?? 0) === 0
          ? "Meta account activity copy is empty"
          : undefined,
    });

    notes.push(
      {
        level: "info",
        text: "On time means filed by 22:00 Kuwait on the day. A filing between 00:00 and 04:00 counts for the previous working day and is late. Friday is off and public holidays are not known. Leave is known only when it is set on this tab.",
      },
      {
        level: "info",
        text: "People are matched by role and first name, so two people with the same first name in the same role would count as one.",
      },
      {
        level: "info",
        text: "Cockpit actions (board changes, decisions, change notes) do not record who clicked. They show the cockpit role with no name and are not in anyone's actions today. Team actions today leave out Hermes, bots and Aziz's own comments and Meta edits.",
      },
      {
        level: "info",
        text: "EODs saved in the client success and creative cockpits are not read yet. Energy is self-reported and only some forms ask for it.",
      },
    );

    if (timelines.size > 0)
      notes.push({
        level: "info",
        text: `Paused and left are set by hand on this tab (${inactiveRows.length ? `${inactiveRows.length} listed apart now` : "nobody listed apart now"}). From the day the status starts, the person owes no EOD and is left out of every EOD count, here and on Today. Days inside a past pause stay not due after the person is back. A left person drops off the list 30 days after leaving.`,
      });

    const payload = {
      people: activeRows,
      inactive: inactiveRows,
      feed: unique
        .slice(0, 60)
        .map(({ personKey: _personKey, ...item }) => item),
      notes,
    } satisfies TeamPayload;

    const daily: DailyPoint[] = [
      {
        date: today,
        metric: "team_actions",
        scope: "company",
        value: companyActionsToday,
      },
    ];

    return { payload, daily, sources };
  },
};
