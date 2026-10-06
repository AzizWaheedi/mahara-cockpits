#!/usr/bin/env node
// No provider calls or registration activation. An explicit --apply writes a closed revision.
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { runtime } from "../../../scripts/webinar-schedule.mjs";
import { createStore } from "../lib/store.js";

export async function prepareEvent({ current, store, apply = false, actor = "schedule-operator" }) {
  const c = runtime(current);
  const result = { event_key: c.event_key, revision: c.revision, config_sha256: c.config_sha256, mode: apply ? "apply_closed" : "plan", starts_at: c.starts_at };
  if (!apply) return result;
  const defaults = await store.read("cockpit_webinar_target_versions?scope_key=eq.defaults&order=revision.desc&limit=1&select=values");
  if (!defaults?.[0]?.values) throw Error("Saved CEO targets required before preparing an event");
  const saved = await store.rpc("cockpit_prepare_webinar_event", {
    p_key:c.event_key,p_revision:c.revision,p_at:c.starts_at,p_zone:c.timezone,p_title:c.title.en,
    p_targets:defaults[0].values,p_by:actor,p_request:crypto.randomUUID(),p_location:c.providers.ghl_location_id,
    p_calendar:c.providers.ghl_calendar_id,p_meeting:c.providers.zoom_meeting_id,p_hash:c.config_sha256,p_minutes:c.duration_minutes,
  });
  return {...result, ...saved};
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  try {
    if (process.argv.slice(2).some(x=>x!=="--apply")) throw Error("Use --apply or no arguments for a plan");
    const current = JSON.parse(await readFile(new URL("../../../config/webinar/current.json", import.meta.url), "utf8"));
    console.log(JSON.stringify(await prepareEvent({current,store:createStore(),apply:process.argv.includes("--apply")})));
  } catch { console.error("Event preparation failed; no provider operation was attempted. Check the schedule, revision sequence and saved targets."); process.exitCode=1; }
}
