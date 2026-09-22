import { agentReady } from "../../hiring/agent";
import { FORMS } from "../../hiring/forms";
import { hiringConfigured } from "../../hiring/ghl";
import { settings } from "../../hiring/settings";
import {
  ADVANCING_STAGES,
  EXIT_STAGES,
  ROLES,
  STAGE_SCORES,
  STAGES,
} from "../../hiring/spec";
import type {
  HiringCandidate,
  HiringEvent,
  HiringPayload,
  HiringRoleFunnel,
  HiringStageCount,
  Note,
} from "../payloads";
import { num, sql, TRIAGE } from "../sb";
import type { Adapter, DailyPoint, SourceStamp } from "../types";

/**
 * Recruiting, end to end.
 *
 * Aziz asked (2026-09-22) for "an amazing recruiting and hiring part of the
 * CEO cockpit", with a pipeline that matches his interview process and a
 * score on every candidate at every stage. The funnel itself lives in a
 * GoHighLevel sub-account so the board can be dragged on a phone; this
 * section reads the mirror of it in Creative Triage and turns it into the
 * four things a founder actually needs:
 *
 * - who is waiting on him, which is the grading queue,
 * - who is going stale, because a good candidate goes cold in a week,
 * - what each role's funnel converts at, so a bad job post shows up as a
 *   stage that everyone dies in rather than as a feeling,
 * - and the bench, which is the cheapest hire there is.
 *
 * No email or phone number is in this payload. Contact details stay in
 * GoHighLevel and every candidate carries a link to their card there, the
 * same rule the growth section follows for leads.
 */

const DAY_MS = 86_400_000;

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  const v = s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  return Math.round(v * 10) / 10;
};

const daysSince = (iso: unknown, now: number): number | null => {
  const t = Date.parse(String(iso ?? ""));
  return Number.isFinite(t) ? Math.floor((now - t) / DAY_MS) : null;
};

const text = (x: unknown): string | null => {
  const t = String(x ?? "").trim();
  return t ? t : null;
};

const score = (x: unknown): number | null => {
  if (x === null || x === undefined || String(x).trim() === "") return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
};

export const hiring: Adapter = {
  key: "hiring",
  label: "Recruiting",
  compute: async ctx => {
    void ctx;
    const now = Date.now();
    const notes: Note[] = [];
    const sources: SourceStamp[] = [];
    const daily: DailyPoint[] = [];

    const connected = hiringConfigured();
    const engineSettings = await settings().catch(() => null);
    const staleDays = engineSettings?.staleDays ?? 7;

    if (!connected)
      notes.push({
        level: "warn",
        text: "The hiring sub-account is not connected. Set GHL_HIRING_PIT and GHL_HIRING_LOCATION on the deployment, then run the hiring setup.",
      });

    const [rows, events, engineRows, formRows] = await Promise.all([
      sql(
        TRIAGE,
        `select id, contact_id, location_id, role, role_label, stage, stage_name,
                name, country, years_experience, arabic, portfolio_url, loom_url,
                test_project_url, score_application, score_loom, score_group,
                score_one_to_one, score_test_project, score_total, bench_reason,
                to_char(applied_at, 'YYYY-MM-DD') as applied_day,
                extract(epoch from applied_at) * 1000 as applied_ms,
                extract(epoch from stage_since) * 1000 as stage_ms,
                extract(epoch from offer_sent_on) * 1000 as offer_ms,
                extract(epoch from synced_at) * 1000 as synced_ms
         from public.cockpit_hiring_candidates
         order by stage_since desc nulls last
         limit 2000`,
      ).catch(() => []),
      sql(
        TRIAGE,
        `select e.candidate_id, e.role, e.kind, e.action, e.to_stage, e.detail, e.ok,
                e.by_whom, extract(epoch from e.at) * 1000 as at_ms,
                coalesce(c.name, '') as name
         from public.cockpit_hiring_events e
         left join public.cockpit_hiring_candidates c on c.id = e.candidate_id
         order by e.at desc
         limit 40`,
      ).catch(() => []),
      sql(
        TRIAGE,
        `select value from public.cockpit_hiring_meta where key = 'engine' limit 1`,
      ).catch(() => []),
      sql(
        TRIAGE,
        `select key, value from public.cockpit_hiring_meta where key like 'intake:%'`,
      ).catch(() => []),
    ]);
    void engineRows;
    void formRows;

    const freshest = rows.reduce((t, r) => Math.max(t, num(r.synced_ms)), 0);
    sources.push({
      name: "GoHighLevel hiring board, mirrored",
      ok: connected && rows.length > 0,
      freshestAt: freshest || undefined,
      note: connected
        ? `${rows.length} candidates across ${ROLES.length} roles.`
        : "Not connected.",
    });

    // --- Every candidate, shaped ---------------------------------------------

    const boardBase = rows[0]?.location_id
      ? `https://app.gohighlevel.com/v2/location/${String(rows[0].location_id)}`
      : null;

    const shape = (r: Record<string, unknown>): HiringCandidate => {
      const stage = String(r.stage ?? "application");
      const scores = {
        application: score(r.score_application),
        loom: score(r.score_loom),
        group: score(r.score_group),
        oneToOne: score(r.score_one_to_one),
        testProject: score(r.score_test_project),
        total: score(r.score_total),
      };
      const wanted = STAGE_SCORES[stage as keyof typeof STAGE_SCORES] ?? [];
      const due =
        wanted.find(k => scores[k as keyof typeof scores] === null) ?? null;
      const inStage = daysSince(
        num(r.stage_ms) ? new Date(num(r.stage_ms)).toISOString() : null,
        now,
      );
      return {
        id: String(r.id),
        contactId: String(r.contact_id ?? ""),
        role: String(r.role ?? ""),
        roleLabel: String(r.role_label ?? ""),
        name: String(r.name ?? "").trim() || "No name given",
        stage,
        stageName: String(r.stage_name ?? stage),
        daysInStage: inStage,
        appliedDay: text(r.applied_day),
        country: text(r.country),
        years: score(r.years_experience),
        arabic: text(r.arabic),
        portfolioUrl: text(r.portfolio_url),
        loomUrl: text(r.loom_url),
        testProjectUrl: text(r.test_project_url),
        scores,
        scoreDue: due,
        benchReason: text(r.bench_reason),
        ghlUrl:
          boardBase && r.contact_id
            ? `${boardBase}/contacts/detail/${String(r.contact_id)}`
            : "",
        stale:
          ADVANCING_STAGES.includes(stage as never) &&
          stage !== "hired" &&
          (inStage ?? 0) > staleDays,
      };
    };

    const all = rows.map(shape);
    const live = all.filter(
      c => !EXIT_STAGES.includes(c.stage as never) && c.stage !== "hired",
    );

    // --- One funnel per role --------------------------------------------------

    const roles: HiringRoleFunnel[] = ROLES.map(role => {
      const mine = all.filter(c => c.role === role.key);
      const stages: HiringStageCount[] = STAGES.map(s => {
        const here = mine.filter(c => c.stage === s.key);
        return {
          key: s.key,
          name: s.name,
          count: here.length,
          medianDays: median(
            here.map(c => c.daysInStage).filter((n): n is number => n !== null),
          ),
        };
      });
      const hired = mine.filter(c => c.stage === "hired").length;
      const applied = mine.length;
      const offers = rows
        .filter(r => String(r.role) === role.key && num(r.offer_ms) > 0)
        .map(r => (num(r.offer_ms) - num(r.applied_ms)) / DAY_MS)
        .filter(n => Number.isFinite(n) && n >= 0);
      const open = mine.filter(
        c => !EXIT_STAGES.includes(c.stage as never) && c.stage !== "hired",
      ).length;
      if (applied)
        daily.push({
          date: new Date(now).toISOString().slice(0, 10),
          metric: "hiring.in_funnel",
          scope: `role:${role.key}`,
          value: open,
        });
      return {
        role: role.key,
        label: role.label,
        stages,
        open,
        hired,
        applied,
        conversion: applied
          ? Math.round((hired / applied) * 1000) / 1000
          : null,
        timeToOfferDays: median(offers),
        scorecard: role.scorecard,
        compensation: role.compensation,
        testProject: role.testProject,
        careersUrl: role.careersUrl,
        formResponses: FORMS[role.key] ? null : null,
        running: open > 0,
      };
    });

    // --- The three lists that are actually work -------------------------------

    const byMove = (a: HiringCandidate, b: HiringCandidate) =>
      (a.daysInStage ?? 0) - (b.daysInStage ?? 0);

    const needsGrading = live
      .filter(c => c.scoreDue !== null)
      .sort((a, b) => (b.daysInStage ?? 0) - (a.daysInStage ?? 0));
    const stale = live
      .filter(c => c.stale)
      .sort((a, b) => (b.daysInStage ?? 0) - (a.daysInStage ?? 0));
    const bench = all
      .filter(c => c.stage === "bench")
      .sort((a, b) => (b.scores.total ?? 0) - (a.scores.total ?? 0));

    // --- The engine -----------------------------------------------------------

    const drafted = events.filter(
      e => String(e.kind) === "action" && e.ok === false,
    ).length;
    const blockers: string[] = [];
    if (!connected) blockers.push("The hiring sub-account is not connected.");
    if (engineSettings && !engineSettings.armed)
      blockers.push(
        "The engine is disarmed on purpose: every message is written down and nothing is sent until you arm it.",
      );

    const payload: HiringPayload = {
      connected,
      boardUrl: boardBase ? `${boardBase}/opportunities/list` : null,
      roles,
      candidates: live.sort(byMove).slice(0, 300),
      needsGrading: needsGrading.slice(0, 100),
      stale: stale.slice(0, 50),
      bench: bench.slice(0, 50),
      engine: {
        armed: engineSettings?.armed ?? false,
        channel: engineSettings?.channel ?? "Email",
        staleDays,
        actions: Object.entries(engineSettings?.actions ?? {}).map(
          ([action, on]) => ({ action, on: Boolean(on) }),
        ),
        pending: 0,
        drafted,
        blockers,
      },
      recent: events.map(
        (e): HiringEvent => ({
          at: num(e.at_ms),
          name: String(e.name ?? "").trim() || "Someone",
          role: String(e.role ?? ""),
          kind: String(e.kind ?? ""),
          text:
            String(e.detail ?? "")
              .split("\n")[0]
              .slice(0, 160) || String(e.action ?? e.to_stage ?? ""),
          ok: e.ok !== false,
        }),
      ),
      totals: {
        inFunnel: live.length,
        applied30: all.filter(c => {
          const d = c.appliedDay ? Date.parse(c.appliedDay) : NaN;
          return Number.isFinite(d) && now - d < 30 * DAY_MS;
        }).length,
        // Hires whose card moved to Hired inside the window. A candidate
        // imported from a form's history has no move behind them, so they
        // count only once they are actually moved.
        hired90: all.filter(
          c =>
            c.stage === "hired" &&
            c.daysInStage !== null &&
            c.daysInStage <= 90,
        ).length,
        rolesRunning: roles.filter(r => r.running).length,
        ungraded: needsGrading.length,
      },
      notes,
    };

    if (connected && !rows.length)
      notes.push({
        level: "info",
        text: "The board is empty. Applications arrive on their own from the careers page forms; run the hiring intake to pull in what the forms already hold.",
      });
    if (!agentReady())
      notes.push({
        level: "info",
        text: "The recruiting agent is off: it needs ANTHROPIC_API_KEY on the deployment. Everything else here runs without it.",
      });
    if (payload.totals.ungraded > 0)
      notes.push({
        level: "info",
        text: `${payload.totals.ungraded} candidates are waiting on a score from you. A stage's score is what moves them, so nothing advances until it is given.`,
      });

    daily.push({
      date: new Date(now).toISOString().slice(0, 10),
      metric: "hiring.in_funnel",
      scope: "company",
      value: live.length,
    });

    return { payload, daily, sources };
  },
};
