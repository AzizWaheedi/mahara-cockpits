import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  EodChannelRead,
  EodCredit,
  EodDay,
  EodPerson,
  EodRadarBoard,
  EodStatus,
} from "../types/ceo/eodRadar";

/**
 * EOD Radar for the Management tab: `cockpit_eod_radar_read` with the CEO's
 * session (the function lets the CEO and admins in), read into the board the
 * card trusts. A shape this does not know is an error, never an empty board.
 */

const STATUSES = new Set<EodStatus>([
  "on_time",
  "late",
  "missed",
  "pending",
  "leave",
  "off",
  "not_read",
]);
const CREDITS = new Set<EodCredit>([
  "poster",
  "submitted_by",
  "name_line",
  "cockpit_outbox",
]);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v : null;
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

function bad(what: string): never {
  throw new Error(
    `EOD Radar came back in a shape this screen does not read (${what}).`,
  );
}

function parseDay(raw: unknown): EodDay {
  if (!isObj(raw) || typeof raw.day !== "string" || !DAY.test(raw.day))
    bad("a day");
  const status = raw.status as EodStatus;
  if (!STATUSES.has(status)) bad("a status");
  const credit = str(raw.creditedBy) as EodCredit | null;
  return {
    day: raw.day as string,
    status,
    postedAt: str(raw.postedAt),
    lateMinutes: num(raw.lateMinutes),
    creditedBy: credit && CREDITS.has(credit) ? credit : null,
    words: num(raw.words),
    quality: str(raw.quality),
    note: str(raw.note),
    slackTs: str(raw.slackTs),
    postedChannel: str(raw.postedChannel),
    posts: num(raw.posts) ?? 0,
  };
}

function parsePerson(raw: unknown): EodPerson {
  if (
    !isObj(raw) ||
    typeof raw.personId !== "number" ||
    typeof raw.name !== "string"
  )
    bad("a person");
  return {
    personId: raw.personId as number,
    name: raw.name as string,
    role: str(raw.role),
    active: raw.active !== false,
    channel: str(raw.channel),
    channelName: str(raw.channelName),
    slackLinked: raw.slackLinked === true,
    days: (Array.isArray(raw.days) ? raw.days : []).map(parseDay),
  };
}

function parseChannel(raw: unknown): EodChannelRead | null {
  if (!isObj(raw) || !str(raw.id) || !str(raw.name)) return null;
  return {
    id: raw.id as string,
    name: raw.name as string,
    ok: raw.ok === true,
    error: str(raw.error),
    posts: num(raw.posts),
  };
}

export function parseEodRadar(raw: unknown): EodRadarBoard {
  if (!isObj(raw)) bad("not an object");
  const s = isObj(raw.settings) ? raw.settings : bad("settings");
  for (const k of ["today", "from", "to"])
    if (typeof raw[k] !== "string" || !DAY.test(raw[k] as string)) bad(k);
  const sync = isObj(raw.sync) ? raw.sync : null;
  const scopes = sync && isObj(sync.scopes) ? sync.scopes : null;
  const kick = isObj(raw.kick) ? raw.kick : null;
  return {
    now: str(raw.now) ?? new Date().toISOString(),
    today: raw.today as string,
    from: raw.from as string,
    to: raw.to as string,
    settings: {
      digestOn: s.digestOn === true,
      remindersOn: s.remindersOn === true,
      strikesOn: s.strikesOn === true,
      lateAt: str(s.lateAt) ?? "22:00",
      closeoutAt: str(s.closeoutAt) ?? "23:00",
      digestChannelName: str(s.digestChannelName) ?? "team-management",
      lookbackDays: num(s.lookbackDays) ?? 2,
    },
    sync: sync
      ? {
          lastRunAt: str(sync.lastRunAt),
          lastOkAt: str(sync.lastOkAt),
          ok: sync.ok === true,
          note: str(sync.note),
          channels: (Array.isArray(sync.channels) ? sync.channels : [])
            .map(parseChannel)
            .filter((c): c is EodChannelRead => c !== null),
          unmatched: (Array.isArray(sync.unmatched) ? sync.unmatched : [])
            .filter(isObj)
            .map(u => ({
              channel: String(u.channel ?? ""),
              name: str(u.name),
              reason: String(u.reason ?? "unknown"),
            })),
          missingScopes:
            scopes && Array.isArray(scopes.missing)
              ? scopes.missing.filter((x): x is string => typeof x === "string")
              : null,
        }
      : null,
    kick: kick
      ? {
          lastRunAt: str(kick.lastRunAt),
          ok: kick.ok === true,
          note: str(kick.note),
        }
      : null,
    people: (Array.isArray(raw.people) ? raw.people : bad("people")).map(
      parsePerson,
    ),
    notTracked: (Array.isArray(raw.notTracked) ? raw.notTracked : [])
      .filter(isObj)
      .map(p => ({
        personId: Number(p.personId),
        name: String(p.name ?? ""),
        role: str(p.role),
      })),
    digests: (Array.isArray(raw.digests) ? raw.digests : [])
      .filter(isObj)
      .map(g => ({
        day: String(g.day ?? ""),
        state: String(g.state ?? ""),
        slackTs: str(g.slackTs),
        error: str(g.error),
        finishedAt: str(g.finishedAt),
      })),
  };
}

/** The board for [from, to] (at most 62 days), or the database's sentence when it refuses. */
export async function readEodRadar(
  client: SupabaseClient | null,
  args: { from?: unknown; to?: unknown },
): Promise<EodRadarBoard> {
  if (!client) throw new Error("Sign in to read EOD Radar.");
  const from =
    typeof args?.from === "string" && DAY.test(args.from) ? args.from : null;
  const to = typeof args?.to === "string" && DAY.test(args.to) ? args.to : null;
  if (!from || !to)
    throw new Error("Choose the days for EOD Radar as YYYY-MM-DD.");
  const { data, error } = await client.rpc("cockpit_eod_radar_read", {
    p_from: from,
    p_to: to,
  });
  if (error) throw new Error(error.message || "EOD Radar could not be read.");
  return parseEodRadar(data);
}
