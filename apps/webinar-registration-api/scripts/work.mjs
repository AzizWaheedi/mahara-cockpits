import { createStore } from "../lib/store.js";
import { createProviders } from "../lib/providers.js";
import { runOne } from "../lib/worker.js";
import { schedule, scheduleIssues } from "../lib/schedule.js";

// Run explicitly under the existing VPS process lock; no cron is installed here.
const enabled=process.env.WEBINAR_DISPATCH_ENABLED==='true';
if(enabled && scheduleIssues().length) {
  console.log(JSON.stringify({status:'held',code:'schedule_not_ready'}));
  process.exitCode=1;
} else {
  try {
    const result=await runOne({store:createStore(),providers:createProviders(),enabled,
      allow:{contactCreation:process.env.WEBINAR_ALLOW_CONTACT_CREATION==='true',trainingBooking:process.env.WEBINAR_ALLOW_TRAINING_BOOKING==='true',zoomRegistration:process.env.WEBINAR_ALLOW_ZOOM_REGISTRATION==='true'}});
    // Never print registration IDs, provider receipts, join URLs or request bodies.
    console.log(JSON.stringify({status:result.status,kind:result.kind,code:result.code}));
    if(['blocked','uncertain','retry'].includes(result.status)) process.exitCode=1;
  } catch { console.log(JSON.stringify({status:'error',code:'worker_unavailable'})); process.exitCode=1; }
}
