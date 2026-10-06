import { createStore } from "../lib/store.js";
import { createPipelineProvider } from "../lib/pipeline.js";
import { pipelineAdapters, syncPipelineCard } from "../lib/pipeline-sync.js";
import { trackedBridgeRun, runPipelineBatch } from "../lib/bridge-run.js";
// Bounded batches under flock. No cron is installed by this command.
const env = process.env,
  store = createStore();
try {
  if (process.argv.includes("--doctor"))
    console.log(
      JSON.stringify({
        status: "doctor",
        enabled: env.WEBINAR_PIPELINE_SYNC_ENABLED === "true",
        ghlConfigured: !!env.GHL_TOKEN,
        storageConfigured: !!(
          env.WEBINAR_SUPABASE_URL && env.WEBINAR_SUPABASE_SERVICE_KEY
        ),
        health: await store.read("cockpit_webinar_pipeline_health?select=*"),
      }),
    );
  else if (env.WEBINAR_PIPELINE_SYNC_ENABLED !== "true")
    console.log(
      JSON.stringify({ status: "held", code: "pipeline_sync_disabled" }),
    );
  else {
    const provider = pipelineAdapters(createPipelineProvider());
    const result = await trackedBridgeRun(store, "pipeline", () =>
      runPipelineBatch({
        store,
        sync: (registration) =>
          syncPipelineCard({ store, provider, registration, enabled: true }),
      }),
    );
    console.log(JSON.stringify(result));
    if (["blocked", "uncertain", "error", "held"].includes(result.status))
      process.exitCode = 1;
  }
} catch {
  console.error(
    JSON.stringify({ status: "error", code: "pipeline_worker_failed" }),
  );
  process.exitCode = 1;
}
