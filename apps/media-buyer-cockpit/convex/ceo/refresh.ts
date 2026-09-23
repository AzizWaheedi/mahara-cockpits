import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { DEFINITIONS, extract } from "./metricRegistry";
import { ADAPTERS } from "./registry";
import { sbWritable, upsertMerge } from "./sbWrite";
import { kuwaitDay } from "./time";
import type { Adapter, DailyPoint } from "./types";

/**
 * How long one section may take. Creative Triage can hang for minutes when it
 * is degraded (2026-09-15: its gateway returned 524 after 100 s), and one slow
 * source must not hold back the rest. A section that runs out of time keeps
 * its last good payload and shows the error.
 */
const SECTION_BUDGET_MS = 150_000;

function withBudget<T>(p: Promise<T>, key: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            `${key} took longer than ${SECTION_BUDGET_MS / 1000} s; a source is slow or down`,
          ),
        ),
      SECTION_BUDGET_MS,
    );
    p.then(
      v => {
        clearTimeout(timer);
        resolve(v);
      },
      e => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * Every section and every number, into Supabase (Aziz, 2026-09-21: "all
 * these sources of truth should pull into Supabase as the number one thing
 * ... formatted really cleanly in a table that any LLM would be able to
 * understand"). Three cockpit_ tables in Creative Triage: the whole payload
 * per section, the metric definitions, and one row per metric, scope,
 * window and day. A failure here is reported and never blocks the refresh.
 */
async function mirrorSection(
  key: string,
  label: string,
  ok: boolean,
  payload: unknown,
  sources: unknown,
  error?: string,
): Promise<string> {
  if (!sbWritable()) return "no Supabase key";
  const now = new Date().toISOString();
  const day = kuwaitDay();
  await upsertMerge(
    "cockpit_sections",
    [
      {
        key,
        label,
        ok,
        error: ok ? null : (error ?? null),
        computed_at: now,
        payload: ok ? payload : undefined,
        sources,
        updated_at: now,
      },
    ],
    "key",
  );
  if (!ok || !payload) return "section stored";
  const values = extract(key, payload).filter(
    v => v.value !== null && Number.isFinite(v.value),
  );
  const rows = values.map(v => ({
    day,
    metric: v.metric,
    scope: v.scope.slice(0, 120),
    window: v.window,
    value: Math.round(v.value! * 10000) / 10000,
    window_from: v.windowFrom ?? null,
    window_to: v.windowTo ?? null,
    captured_at: now,
  }));
  for (let i = 0; i < rows.length; i += 300)
    await upsertMerge(
      "cockpit_metric_values",
      rows.slice(i, i + 300),
      "day,metric,scope,window",
    );
  return `section stored, ${rows.length} values`;
}

/** The definitions, once per refresh, so a new metric is explained the day it appears. */
async function mirrorDefinitions(): Promise<void> {
  if (!sbWritable()) return;
  const now = new Date().toISOString();
  await upsertMerge(
    "cockpit_metric_definitions",
    DEFINITIONS.map(x => ({
      metric: x.metric,
      section: x.section,
      label: x.label,
      definition: x.definition,
      source: x.source,
      leaves_out: x.leavesOut ?? null,
      unit: x.unit,
      updated_at: now,
    })),
    "metric",
  );
}

/**
 * Recompute CEO sections (all, or the ones named). Sections run at the same
 * time, each within its budget, so the refresh takes as long as the slowest
 * section instead of the sum. One failing section never stops the rest.
 */
export const refreshAll = internalAction({
  args: { only: v.optional(v.array(v.string())) },
  returns: v.any(),
  handler: async (ctx, { only }): Promise<Record<string, string>> => {
    const report: Record<string, string> = {};
    try {
      await mirrorDefinitions();
    } catch (e) {
      report._definitions = `mirror FAILED ${String(e instanceof Error ? e.message : e).slice(0, 200)}`;
    }
    // Every section is saved together at the end of the cycle, not as each
    // one finishes: the CEO page re-reads every section on every save, so
    // thirteen saves were thirteen full re-reads per open screen per cycle.
    type Pending = {
      key: string;
      label: string;
      ok: boolean;
      payload?: unknown;
      error?: string;
      sources: unknown[];
      ms: number;
    };
    const pending: Pending[] = [];
    const run = async (a: Adapter) => {
      const started = Date.now();
      try {
        const res = await withBudget(a.compute(ctx), a.key);
        pending.push({
          key: a.key,
          label: a.label,
          ok: true,
          payload: res.payload,
          sources: res.sources,
          ms: Date.now() - started,
        });
        const daily: DailyPoint[] = res.daily ?? [];
        for (let i = 0; i < daily.length; i += 400)
          await ctx.runMutation(internal.ceo.store.saveDaily, {
            points: daily.slice(i, i + 400),
          });
        let mirrored = "";
        try {
          mirrored = await mirrorSection(
            a.key,
            a.label,
            true,
            res.payload,
            res.sources,
          );
        } catch (e) {
          mirrored = `mirror FAILED ${String(e instanceof Error ? e.message : e).slice(0, 160)}`;
        }
        report[a.key] =
          `ok ${Date.now() - started}ms, ${daily.length} daily points, ${mirrored}`;
      } catch (e) {
        const error = String(e instanceof Error ? e.message : e).slice(0, 400);
        pending.push({
          key: a.key,
          label: a.label,
          ok: false,
          error,
          sources: [],
          ms: Date.now() - started,
        });
        try {
          await mirrorSection(a.key, a.label, false, null, [], error);
        } catch {
          // The mirror never blocks the refresh.
        }
        report[a.key] = `FAILED ${error}`;
      }
    };
    // Billing first: payments Maher or a CSM logged go into the ledger before
    // the money section reads it, and the ClickUp cards are mirrored so the
    // billing sheet and Maher see edits made on a card within one cycle.
    // Neither can stop the refresh.
    if (!only?.length) {
      for (const [key, job] of [
        ["_billingInbox", internal.billing.ingestInbox],
        ["_billingMirror", internal.billing.syncMirror],
      ] as const) {
        try {
          report[key] = await ctx.runAction(job, {});
        } catch (e) {
          report[key] =
            `FAILED ${String(e instanceof Error ? e.message : e).slice(0, 200)}`;
        }
      }
    }
    await Promise.all(
      ADAPTERS.filter(a => !only?.length || only.includes(a.key)).map(run),
    );
    // One write per cycle, split only when the payloads together would be too
    // big for one mutation. A save that fails is reported, never thrown: the
    // sections already stored stay, which is the old "keep the last good"
    // behaviour.
    const LIMIT = 3_000_000;
    let batch: Pending[] = [];
    let size = 0;
    const flush = async () => {
      if (!batch.length) return;
      try {
        await ctx.runMutation(internal.ceo.store.saveSections, {
          items: batch as never,
        });
      } catch (e) {
        for (const b of batch)
          report[b.key] =
            `${report[b.key] ?? ""} · save FAILED ${String(e instanceof Error ? e.message : e).slice(0, 160)}`;
      }
      batch = [];
      size = 0;
    };
    for (const item of pending) {
      const bytes = JSON.stringify(item.payload ?? null).length;
      if (size + bytes > LIMIT) await flush();
      batch.push(item);
      size += bytes;
    }
    await flush();
    return report;
  },
});
