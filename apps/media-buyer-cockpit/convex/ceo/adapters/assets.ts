import type { AssetsPayload, Note } from "../payloads";
import { B2B, num, sql } from "../sb";
import type { Adapter, DailyPoint, SourceStamp } from "../types";

/**
 * The sales asset library: what we have to send, and what sending it did.
 *
 * Mahara has 203 assets on file — videos, case studies, testimonials, funnel
 * pages — each tagged with what it proves, which objection it answers, which
 * stage of the call it belongs to, and paste-ready text in Arabic and English.
 * None of it reached any screen before 2026-09-19, because the nine functions
 * over it were refused to the cockpit's read-only login until the grant.
 *
 * Two questions this answers, and they pull in opposite directions.
 *
 * Coverage asks what a rep has to reach for. The library is indexed by
 * objection against stage, so an empty cell is a moment in a sales call where
 * somebody has nothing to send. Those gaps are worth more than the totals.
 *
 * Performance asks whether any of it is used. It is measured from `asset_sends`
 * — what a rep actually sent — and on 2026-09-19 that table held four rows
 * against a library of 203. So the honest reading is that the library is built
 * and barely touched, and the payload says which of the two numbers is which
 * rather than averaging them into something that sounds healthy.
 */

export const assets: Adapter = {
  key: "assets",
  label: "Sales assets",
  compute: async ctx => {
    void ctx;
    const notes: Note[] = [];
    const sources: SourceStamp[] = [];

    const [libraryRows, coverageRows, performanceRows] = await Promise.all([
      sql(
        B2B,
        `select asset_type, status, count(*) as n,
                count(*) filter (where language = 'ar') as arabic,
                count(*) filter (where link_ok is false) as broken,
                max(extract(epoch from updated_at) * 1000) as fresh_ms
         from public.assets group by asset_type, status`,
      ),
      sql(
        B2B,
        `select objection, objection_label, stage, stage_label, asset_count
         from public.b2b_asset_coverage()`,
      ),
      sql(
        B2B,
        `select slug, title, asset_type, sends, contacts_reached,
                closes_after, revenue_usd,
                extract(epoch from last_sent_at) * 1000 as last_sent_ms
         from public.b2b_asset_performance()
         where sends > 0
         order by closes_after desc, sends desc
         limit 20`,
      ),
    ]);

    let total = 0;
    let live = 0;
    let arabic = 0;
    let broken = 0;
    let freshest = 0;
    const byType = new Map<string, number>();
    for (const r of libraryRows) {
      const n = num(r.n);
      const type = String(r.asset_type ?? "other");
      total += n;
      arabic += num(r.arabic);
      broken += num(r.broken);
      freshest = Math.max(freshest, num(r.fresh_ms));
      // The library's live status is spelled "published"; nothing is ever
      // "live". Checked against the table rather than assumed, because the
      // wrong string here reads as a library of nothing.
      if (String(r.status ?? "") === "published") {
        live += n;
        byType.set(type, (byType.get(type) ?? 0) + n);
      }
    }

    // An empty cell is a moment in a call where a rep has nothing to reach
    // for. That is the finding; the totals are context for it.
    const gaps: AssetsPayload["gaps"] = [];
    const stages = new Map<string, string>();
    for (const r of coverageRows) {
      const count = num(r.asset_count);
      stages.set(String(r.stage), String(r.stage_label ?? r.stage));
      if (count === 0)
        gaps.push({
          objection: String(r.objection_label ?? r.objection),
          stage: String(r.stage_label ?? r.stage),
        });
    }

    const performance = performanceRows.map(r => ({
      slug: String(r.slug),
      title: String(r.title ?? r.slug),
      assetType: String(r.asset_type ?? "other"),
      sends: num(r.sends),
      contacts: num(r.contacts_reached),
      closesAfter: num(r.closes_after),
      revenue: num(r.revenue_usd),
      lastSentAt: num(r.last_sent_ms) || null,
    }));
    const sends = performance.reduce((n, a) => n + a.sends, 0);

    notes.push({
      level: "info",
      text: `The library holds ${live} published assets of ${total} on file, tagged by what they prove, which objection they answer and where in a call they belong. Arabic and English paste text sits on each one.`,
    });
    if (sends === 0)
      notes.push({
        level: "warn",
        text: `No asset has ever been recorded as sent. The library is built and unused, so nothing here can say which asset closes: every performance figure would be a division by nothing.`,
      });
    else
      notes.push({
        level: "warn",
        text: `Only ${sends} ${sends === 1 ? "send has" : "sends have"} ever been recorded against ${live} published assets, so read the performance rows as anecdotes rather than a ranking. An asset with one send and one close is not a better asset than one nobody tried.`,
      });
    if (gaps.length)
      notes.push({
        level: "warn",
        text: `${gaps.length} of ${coverageRows.length} objection and stage combinations have no asset at all, so a rep meeting that objection at that point in the call has nothing to send.`,
      });
    if (broken > 0)
      notes.push({
        level: "warn",
        text: `${broken} ${broken === 1 ? "asset has a link that last checked as broken" : "assets have links that last checked as broken"}, so sending one would send a dead page.`,
      });

    // --- Live Training: built, wired, never run -------------------------
    // Six tables and eight views: registrants with full UTM and ad, adset and
    // campaign ids, attendance, engagement, a retention curve, pitch
    // attribution and outcomes carrying contract value and cash collected.
    // End-to-end attribution from a webinar to closed money.
    //
    // Every one of them is empty. A section of zeros would read as a webinar
    // that performed terribly rather than one that never happened, so this
    // reports the capability and its emptiness, and no rate is computed at all.
    let liveTraining: AssetsPayload["liveTraining"];
    try {
      const rows = await sql(
        B2B,
        `select
           (select count(*) from public.lt_events) as events,
           (select count(*) from public.lt_registrants) as registrants,
           (select count(*) from public.lt_attendance) as attendance,
           (select count(*) from public.lt_outcomes) as outcomes`,
      );
      const r = rows[0] ?? {};
      const events = num(r.events);
      liveTraining = {
        events,
        registrants: num(r.registrants),
        attendance: num(r.attendance),
        outcomes: num(r.outcomes),
        everUsed: events > 0,
      };
      if (!liveTraining.everUsed)
        notes.push({
          level: "info",
          text: `The Live Training pipeline is built and has never run. Six tables and eight views are wired for it: registrants with their full UTM and their ad, adset and campaign ids, attendance, engagement, a retention curve, pitch attribution and outcomes carrying contract value and cash collected. That is attribution from a webinar through to closed money, and it is waiting on a first event rather than on any code. No figure is shown for it, because zero events and a bad webinar would print the same numbers.`,
        });
    } catch (e) {
      notes.push({
        level: "warn",
        text: `The Live Training tables could not be read this run (${String(e).slice(0, 140)}).`,
      });
    }

    sources.push({
      name: "B2B sales asset library",
      freshestAt: freshest || undefined,
      ok: true,
    });

    const payload: AssetsPayload = {
      total,
      live,
      arabic,
      broken,
      byType: [...byType.entries()]
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count),
      gaps: gaps.sort(
        (a, b) =>
          a.stage.localeCompare(b.stage) ||
          a.objection.localeCompare(b.objection),
      ),
      combinations: coverageRows.length,
      sends,
      performance,
      ...(liveTraining ? { liveTraining } : {}),
      notes,
    };

    const daily: DailyPoint[] = [
      { date: "", metric: "", scope: "company", value: 0 },
    ];
    daily.length = 0;

    return { payload, daily, sources };
  },
};
