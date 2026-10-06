// The existing source ledger makes crashes visible, including runs with no work.
export async function trackedBridgeRun(store, source, work) {
  const id = await store.rpc("cockpit_start_webinar_bridge_run", {
    p_source: source,
  });
  let result;
  try {
    result = await work();
  } catch (error) {
    await store.rpc("cockpit_finish_webinar_bridge_run", {
      p_id: id,
      p_ok: false,
      p_counts: { complete: false, status: "failed" },
    });
    throw error;
  }
  const ok = !["blocked", "uncertain", "error", "held"].includes(result.status);
  const counts = { complete: ok, status: result.status };
  for (const k of ["processed", "failed", "accepted", "source_total"])
    if (Number.isInteger(result[k]) && result[k] >= 0) counts[k] = result[k];
  await store.rpc("cockpit_finish_webinar_bridge_run", {
    p_id: id,
    p_ok: ok,
    p_counts: counts,
  });
  return result;
}
export async function runPipelineBatch({
  store,
  sync,
  now = Date.now,
  maxItems = 25,
  maxMs = 90000,
}) {
  const started = now();
  let processed = 0,
    failed = 0;
  // Read a fixed batch so an active workflow cannot cause unbounded self-enrollment.
  const rows = await store.read(
    `cockpit_webinar_pipeline_due?select=registration_id&order=last_success_at.asc.nullsfirst,updated_at.asc.nullsfirst,registration_id.asc&limit=${maxItems}`,
  );
  for (const row of rows) {
    if (now() - started >= maxMs) break;
    const result = await sync(row.registration_id);
    processed++;
    if (["blocked", "uncertain", "error"].includes(result.status)) failed++;
  }
  return {
    status: failed ? "blocked" : processed ? "synced" : "idle",
    processed,
    failed,
  };
}
