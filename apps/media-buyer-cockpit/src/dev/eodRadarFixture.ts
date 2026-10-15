/**
 * EOD Radar for the layout harness and the screen tests (2026-10-15): what
 * `cockpit_eod_radar_read` would answer, built around a given clock so
 * today's column is today. Every name is made up (the hours harness's people
 * and two more); never imported by the production app.
 *
 * `?radar=full|unread|never|empty` picks the scenario (default full): a
 * normal fortnight with a late filer, a missed day, leave and a person with
 * no Slack id; the same with #eods-csr unreadable (missing_scope), so its
 * people read "not read"; a radar that has never run; nobody who files.
 */
import type { EodDay, EodRadarBoard, EodStatus } from "../types/ceo/eodRadar";

export type RadarScenario = "full" | "unread" | "never" | "empty";
const SCENARIOS: RadarScenario[] = ["full", "unread", "never", "empty"];

export function radarScenario(): RadarScenario {
  const raw =
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("radar");
  return SCENARIOS.includes(raw as RadarScenario)
    ? (raw as RadarScenario)
    : "full";
}

const KUWAIT = 3 * 3600_000;
const DAY = 86_400_000;
const workingDay = (ms: number) =>
  new Date(ms + KUWAIT - 4 * 3600_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const friday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay() === 5;
/** A Kuwait wall-clock time on a day, as ISO. */
const at = (d: string, hhmm: string) =>
  new Date(Date.parse(`${d}T${hhmm}:00Z`) - KUWAIT).toISOString();

const CSR = "C09R4QJCZ5Y";
const MEDIA = "C0AQ2LD0PL1";

function day(
  d: string,
  status: EodStatus,
  extra: Partial<EodDay> = {},
): EodDay {
  return {
    day: d,
    status,
    postedAt: null,
    lateMinutes: null,
    creditedBy: null,
    words: null,
    quality: null,
    note: null,
    slackTs: null,
    postedChannel: null,
    posts: 0,
    ...extra,
  };
}

/** One person's 17 days: a pattern by index back from today (0 is today). */
function history(
  today: string,
  nowMs: number,
  pattern: (i: number, d: string) => EodDay | null,
  closed: boolean,
): EodDay[] {
  const out: EodDay[] = [];
  for (let i = 0; i < 18; i++) {
    const d = addDays(today, -i);
    if (friday(d)) {
      out.push(day(d, "off", { note: "Friday, no EOD due" }));
      continue;
    }
    if (i === 0 && !closed && nowMs < Date.parse(at(d, "22:00"))) {
      out.push(day(d, "pending", { note: "Due by 22:00" }));
      continue;
    }
    const row = pattern(i, d);
    if (row) out.push(row);
  }
  return out.reverse();
}

const onTime = (
  d: string,
  hhmm = "20:40",
  by: EodDay["creditedBy"] = "submitted_by",
  words = 180,
): EodDay =>
  day(d, "on_time", {
    postedAt: at(d, hhmm),
    creditedBy: by,
    words,
    posts: 1,
    slackTs: `${Date.parse(at(d, hhmm)) / 1000}.000100`,
  });
const late = (
  d: string,
  minutes: number,
  by: EodDay["creditedBy"] = "submitted_by",
): EodDay =>
  day(d, "late", {
    postedAt: new Date(
      Date.parse(at(d, "22:00")) + minutes * 60_000,
    ).toISOString(),
    lateMinutes: minutes,
    creditedBy: by,
    words: 140,
    posts: 1,
  });

export function eodRadarFixture(
  scenario: RadarScenario = radarScenario(),
  nowMs = Date.now(),
): EodRadarBoard {
  const today = workingDay(nowMs);
  const closed = nowMs >= Date.parse(at(today, "23:00"));
  const unread = scenario === "unread";
  const missedOrUnread = (d: string) =>
    unread
      ? day(d, "not_read", {
          note: "Could not read #eods-csr (the Slack app needs the groups:history scope), so this day is not counted",
        })
      : day(d, "missed", {
          note: "No EOD in #eods-csr or the other EOD channels by 23:00",
        });
  const people =
    scenario === "empty" || scenario === "never"
      ? []
      : [
          {
            personId: 1,
            name: "Hala Mansour",
            role: "Call centre agent",
            channel: CSR,
            channelName: "eods-csr",
            slackLinked: true,
            days: history(
              today,
              nowMs,
              (i, d) =>
                i === 3
                  ? missedOrUnread(d)
                  : onTime(d, "19:10", "submitted_by", 41),
              closed,
            ).map(r =>
              r.status === "on_time"
                ? {
                    ...r,
                    quality:
                      "Under 50 words (41); No wins, blockers or plan for tomorrow",
                  }
                : r,
            ),
          },
          {
            personId: 2,
            name: "Omar Fayed",
            role: "Call centre agent",
            channel: CSR,
            channelName: "eods-csr",
            slackLinked: true,
            days: history(
              today,
              nowMs,
              (i, d) =>
                i % 5 === 2
                  ? missedOrUnread(d)
                  : i === 1
                    ? late(d, 45)
                    : onTime(d, "21:15"),
              closed,
            ),
          },
          {
            personId: 3,
            name: "Sara Kanaan",
            role: "Media buyer",
            channel: MEDIA,
            channelName: "media-eods",
            slackLinked: true,
            days: history(
              today,
              nowMs,
              (i, d) =>
                i === 4 || i === 5
                  ? day(d, "leave", { note: "On leave: Annual leave" })
                  : i === 2
                    ? {
                        ...late(d, 207, "cockpit_outbox"),
                        note: "Filed in the cockpit at 01:27; Slack had it two days later",
                      }
                    : onTime(d, "21:50", "cockpit_outbox"),
              closed,
            ),
          },
          {
            personId: 4,
            name: "Yousef Karam",
            role: "Video editor",
            channel: MEDIA,
            channelName: "media-eods",
            slackLinked: true,
            days: history(
              today,
              nowMs,
              (i, d) =>
                i % 3 === 1
                  ? late(d, 14 * 60 + 17, "name_line")
                  : onTime(d, "17:05", "name_line"),
              closed,
            ),
          },
          {
            personId: 5,
            name: "Lina Haddad",
            role: "Video editor",
            channel: MEDIA,
            channelName: "media-eods",
            slackLinked: false,
            days: history(
              today,
              nowMs,
              (i, d) =>
                i < 3
                  ? day(d, "not_read", {
                      note: "No Slack id for Lina Haddad, so only posts with their Name line can be found. Add their email on the roster",
                    })
                  : i === 6
                    ? onTime(d, "20:00", "name_line")
                    : null,
              closed,
            ),
          },
        ];
  const lastRun = new Date(nowMs - 12 * 60_000).toISOString();
  return {
    now: new Date(nowMs).toISOString(),
    today,
    from: addDays(today, -17),
    to: today,
    settings: {
      digestOn: true,
      remindersOn: false,
      strikesOn: false,
      lateAt: "22:00",
      closeoutAt: "23:00",
      digestChannelName: "team-management",
      lookbackDays: 2,
    },
    sync:
      scenario === "never"
        ? null
        : {
            lastRunAt: lastRun,
            lastOkAt: unread
              ? new Date(nowMs - 3 * DAY).toISOString()
              : lastRun,
            ok: !unread,
            note: unread
              ? "Read 4 of 5 EOD channels. Could not read #eods-csr (missing_scope)"
              : "Read 5 of 5 EOD channels (31 posts) for the last 3 days",
            channels: [
              {
                id: "C0AS90M9SN6",
                name: "tech-eods",
                ok: true,
                error: null,
                posts: 3,
              },
              {
                id: MEDIA,
                name: "media-eods",
                ok: true,
                error: null,
                posts: 9,
              },
              {
                id: "C09RQS2TFST",
                name: "eods-csms",
                ok: true,
                error: null,
                posts: 4,
              },
              {
                id: "C0AF5PJEAUX",
                name: "eods-salesreps",
                ok: true,
                error: null,
                posts: 2,
              },
              {
                id: CSR,
                name: "eods-csr",
                ok: !unread,
                error: unread ? "missing_scope" : null,
                posts: unread ? 0 : 6,
              },
            ],
            unmatched:
              scenario === "full"
                ? [{ channel: MEDIA, name: "Ahmed", reason: "ambiguous" }]
                : [],
            missingScopes: unread ? ["groups:history"] : [],
          },
    kick:
      scenario === "never"
        ? {
            lastRunAt: null,
            ok: false,
            note: "The vault has no cockpit_sync_secret, so EOD Radar was not started. Add it to the vault.",
          }
        : { lastRunAt: lastRun, ok: true, note: "Posted a radar run" },
    people,
    notTracked:
      scenario === "full"
        ? [{ personId: 9, name: "Rami Saleh", role: "Operations lead" }]
        : [],
    digests:
      scenario === "full"
        ? [
            {
              day: addDays(today, -1),
              state: "posted",
              slackTs: "1791997503.000100",
              error: null,
              finishedAt: lastRun,
            },
          ]
        : [],
  };
}
