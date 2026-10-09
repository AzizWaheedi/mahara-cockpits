# Archived Viktor-side scripts

Archived on 2026-10-09 during the Convex retirement sweep. Every script here calls the Convex deployments, which were paused on 2026-10-07, so none of them can run. Do not schedule them again.

Native replacements:

- Media, CSM and creative feeds, market plays: `hermes/cockpit-sync`.
- Assist queue and chat replies: `hermes/media-native`.
- CSM actions and client reports: `supabase/functions/cockpit-csm-api`.
- Winner transcription (`transcribe_winners.py`) has no native replacement yet.

`csm/csm_app_bridge.py` held a hard-coded bridge token. The value was removed from the file on 2026-10-09, but it is still in git history, so treat it as exposed and retire it on the Convex side.
