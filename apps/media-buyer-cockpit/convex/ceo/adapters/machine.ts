import { internal } from "../../_generated/api";
import type { Adapter } from "../types";

// biome-ignore lint/suspicious/noExplicitAny: internal query rows
type Any = any;

/** The machine behind the numbers: scheduled jobs, data sources and Hermes. */
export const machine: Adapter = {
  key: "machine",
  label: "Machine and data trust",
  compute: async ctx => {
    const [jobs, sources, stale, hermes]: Any[] = await Promise.all([
      ctx.runQuery(internal.health.jobs, {}),
      ctx.runQuery(internal.health.sources, {}),
      ctx.runQuery(internal.health.staleJobs, {}),
      ctx.runQuery(internal.askAi.health, {}),
    ]);
    const now = Date.now();
    const sync = (jobs as Any[]).find(j => j.job === "sync");
    const failing = (jobs as Any[]).filter(j => !j.ok);
    const badSources = (sources as Any[]).filter(s => s.ok === false);
    return {
      payload: {
        syncAgeMin: sync?.at ? Math.round((now - sync.at) / 60_000) : null,
        jobs: (jobs as Any[]).map(j => ({
          job: j.job,
          ok: j.ok,
          at: j.at,
          everyMin: j.everyMin,
          streak: j.streak,
          error: j.error ? String(j.error).slice(0, 200) : undefined,
        })),
        failingJobs: failing.length,
        staleJobs: (stale as Any[]).length,
        sources: (sources as Any[]).map(s => ({
          source: s.source ?? s.key,
          ok: s.ok,
          lastOkAt: s.lastOkAt,
          lastError: s.lastError
            ? String(s.lastError).slice(0, 200)
            : undefined,
        })),
        failingSources: badSources.length,
        hermes: {
          queued: hermes?.queued ?? 0,
          failed: hermes?.failed ?? 0,
          lastDoneAt: hermes?.lastDoneAt,
        },
      },
      sources: [
        { name: "Cockpit health ledger", freshestAt: sync?.at, ok: true },
      ],
    };
  },
};
