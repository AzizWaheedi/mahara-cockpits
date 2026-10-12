# Video review handoff

User decision, 12 October 2026: notify the media buyer **only after client approval**. Client Review sends no buyer heads-up. The buyer moves the task to Live after the ad is running. This worker never launches an ad or marks it Live.

## Team workflow

1. The editor saves the finished cut in **Edited Video Link** and chooses **Request internal review**. New deliveries always move to Internal Review.
2. One Slack notice in **csm-general** mentions the active creative director and CSM. Either reviews the cut in ClickUp and moves it to **Internal Approved**, or leaves changes on the task.
3. Internal Approved sends the CSM a **Prepare client link** button. It opens the exact task in the existing CSM Inbox. The approved cut must have a link and a verified client card.
4. The CSM prepares the review link. The worker verifies the current ClickUp task and cut, moves the task to **Client Review**, and confirms the link is ready. Preparing or copying does not send a message. The CSM copies the prepared Arabic message and sends it through the existing WhatsApp desk. This preserves human control and existing client-group routing.
5. The client watches the video and selects **موافقة** or **طلب تعديل**. Comments save in the review database and editor notes. The worker copies each comment to the exact ClickUp video task before notifying **video-editors-labs**.
6. A change request or a new comment after approval returns the task to **Update Required**. Approval changes it to **Client Approved**, adds a decision comment, and notifies the current client-scoped media buyer in **client-ads-general**.
7. After launch, the buyer moves the task to **Live** in ClickUp. The approved review remains readable. The worker does not infer that an ad is live.

Use a **new file/link for every replacement cut**. Changing the contents of the same external URL is not a verifiable version change. Drive previews need client-viewable file permissions; the review page includes an Open video fallback. The system cannot grant Drive access by itself.

## Identity and approval

- Only main tasks on Video Pipeline `901816720767` are observed.
- The internal Slack notice mentions active CSM/creative seats matched by exact email to Slack. Buyer access uses the verified client record and current cockpit client scopes. Currently one non-admin buyer has all-client scope.
- Task-linked preparation requires an active CSM, creative or admin seat with access to that client. Editors cannot approve their own cut through this RPC. The actual internal approval uses the existing ClickUp status controls and permissions.
- The database locks the video row when creating a link. Repeated clicks return the same unexpired review for the same cut. New cuts revoke the previous link.
- Public clients get a random, expiring review capability. They cannot list reviews or access the staff preparation RPCs.
- Client decisions and comments reject stale/revoked cuts. The worker checks live ClickUp again before changing status or notifying the buyer. A pending change request blocks the buyer notice even while ClickUp is catching up.
- Unlinked historical reviews and social reviews keep their existing path. The old review watcher excludes `flow_task_id` reviews so two workers cannot post the same comment.

## Reliability

The worker polls every two minutes. The existing editor read sync runs every five minutes (previously thirty), so the CSM panel follows current task metadata. First installation records a silent baseline and does not announce old review tasks. SQLite stores status observations, separate delivery intents, receipts and unknown outcomes. An OS lock prevents concurrent workers. A timeout or interrupted send stays unknown until provider history confirms it; it is never blindly resent. Slack and ClickUp comments contain a stable event reference. Status PUTs are checked by readback. A failed source for one task does not block other tasks.

The worker mirrors aggregate health to `cockpit_sync_state`, key `video-review-flow`. The existing guardian checks freshness and unresolved deliveries. Daily consistent ledger backups retain seven days. Missing state fails closed. Never reset a ledger or requeue an unknown result without checking provider history.

Polling observes current state. A brief transition that happens entirely between scans may not generate a notice. ClickUp does not expose conditional status writes; the worker rechecks the source immediately before changes but cannot make a cross-provider transaction atomic.

## Release and rollback

1. Run the Python worker tests, editor-desk tests, guardian tests, the browser media test, app lint/typechecks, and SQL tests in a rolled-back transaction.
2. Apply `20261012145212_video_review_task_flow.sql`. Check RPC grants and Supabase advisors.
3. Ship CSM and editor frontends from merged main.
4. Install the new worker and sibling assignment source in an isolated release. Create a private config with `apply:false` and the existing credentials-file path. Never copy keys into source.
5. Update only the reviewed old review-watch filter and editor queue delivery function. Compare live files before editing; preserve unrelated changes.
6. Bootstrap once, then set `apply:true` and add the two-minute cron. Install the guardian check. Verify one unattended cycle and controlled fictional-task receipts.
7. A real client response is still a separate acceptance milestone. Do not fabricate or send a client test without authorization for its exact recipient.

Rollback: set `apply:false`, preserve the ledger and links, and restore the saved worker versions if needed. Keep managed reviews out of the old watcher until their receipts are reconciled. Do not drop review data or undo client decisions.
