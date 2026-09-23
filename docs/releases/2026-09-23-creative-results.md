# Creative requests and Changes & Results

Status: implemented on `codex/creative-results`; **not deployed**. The context repo could not be fast-forwarded because its local `main` had diverged. No live migration, ClickUp task, or production sync was run in this session.

## Buyer flow

1. Open a campaign. Its Scale / Hold / Kill verdict remains above the detail tabs. Open **Changes & Results** to see Meta activity and buyer notes with three complete Kuwait days before and after each change. The edit day is excluded. This is an observed comparison, not proof of cause.
2. Use **Add change** only when a change is missing from Meta. The existing manual change entry is reused and queued for the campaign's ClickUp task.
3. From an affected ad in Recommendations, click **Request creative**. The current ad and its evidence create one request in the Creative Triage cockpit store and one Script Request task in the director's existing ClickUp queue. A second click for the same open request does not create another task.
4. The director writes the script in the existing Scripts flow and sends it to the existing editor video pipeline. The 15-minute creative bridge links the script task, editor task and finished cut by exact task ID. It defaults to a dry run until enabled for one pilot campaign.
5. The buyer selects the replacement Meta ad and enters the Kuwait day it went live. After three complete days, the buyer sees original-ad and replacement-ad results, marks **Worked**, **Needs another version**, or **Stop**. The review is saved and posted as comments on the linked internal production tasks. Retrying feedback checks for the request marker first.

## Data and limits

- Meta account activity provides change time, actor, event and object ID. The sync assigns an activity to a campaign only when its object ID belongs to that campaign and the account ID agrees. Its current 14-day fetch is capped at 1,500 activities across accounts; missing activity must not be read as no change.
- The campaign and ad spend/leads come from the existing Meta daily feed in Convex. Matched bookings are GHL bookings with an ad/campaign match. Unmatched bookings are excluded. A day without a daily record is missing data, not zero spend.
- The comparison is **Too early** until the three post-change days are complete and present. It is **Inconclusive** when daily coverage is incomplete, leads are thin, or another logged change overlaps. Results are labeled **Observed** and never attributed solely to one change.
- The launch date is supplied by the buyer; Meta ad creation time is not treated as launch time. The UI shows this source.
- The Supabase migration creates `cockpit_creative_requests` and `cockpit_creative_request_events` in Creative Triage with row security, service-role grants, and an audit trigger for every insert/update. The B2B Supabase project is read only.
- If ClickUp task creation is not confirmed after the request row is saved, the row remains visible with an error. The creative bridge can recover the task link from the unique request ID in its description. If no task appears, inspect ClickUp before a manual retry; never create another task blindly.

## Release gate and pilot

1. Inspect the SQL migration and apply it to Creative Triage only. Read back table grants, row security and audit trigger before deploying Convex functions. This step was **not run**.
2. Configure the existing Convex deployment with the Creative Triage `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and ClickUp token. The new server helper rejects another Supabase project. Run `bunx convex codegen` from `apps/media-buyer-cockpit` in the release environment before `scripts/ship.sh`, since that script typechecks before deploying Convex. Local ignored generated types were used only for the build.
3. Run the creative bridge with its default `CREATIVE_REQUEST_LINKS_DRY_RUN` state. The logs print each proposed request-link diff. For one approved campaign, set `CREATIVE_REQUEST_LINKS_DRY_RUN=false` and `CREATIVE_REQUEST_PILOT_CAMPAIGN=<exact campaign name>`, then read back the request row, event rows, director task, editor task and cut. Leave other campaigns in dry run. After the pilot passes, `CREATIVE_REQUEST_PILOT_CAMPAIGN=*` allows all campaigns while keeping the same dry-run switch.
4. Verify one campaign's Meta change activity directly against Meta's activity history and its daily spend/leads against Meta reporting for the same Kuwait dates. Check matched bookings against GHL. Confirm the three-day guard and missing-data messages using a recent change and an older one.
5. Test one buyer-requested creative through script, editor, launch link and review. Confirm exactly one ClickUp script task, one linked editor task, one finished cut, and one feedback comment per linked production task. Review the audit rows and the cockpit UI after each stage.
6. Merge the reviewed feature to GitHub main, then release using `scripts/ship.sh media-buyer` and verify the production URL only after the migration and pilot pass. The ship script refuses a dirty or non-main app checkout. Record the release in `mahara-context/shared/sessions/` once its Git divergence is resolved safely.

## Local checks completed

- `npm run build` in `apps/media-buyer-cockpit`: passed.
- `node node_modules/typescript/bin/tsc -p convex/tsconfig.json --noEmit`: passed with local ignored generated API types.
- `node --experimental-strip-types --test scripts/change-results.test.ts`: three tests passed.
- `git diff --check`: passed.
