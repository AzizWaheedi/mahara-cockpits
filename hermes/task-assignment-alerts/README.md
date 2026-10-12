# Department task assignment alerts

This worker announces new main-task assignments in the matching Slack channel.
It never changes a ClickUp task or sends a client message.

| ClickUp home list | List ID | Slack channel | Channel ID |
|---|---|---|---|
| Operations / Tech | 901816723190 | tech-general | C0AS2JLMJCB |
| Marketing / ADs | 901816723196 | client-ads-general | C0C8DLZGTMZ |
| Call Center | 901816723206 | csr-general-channel | C09R83NNQV9 |
| Client Success | 901816723211 | csm-general | C09RZ0GS0V9 |
| Media/Creative | 901818016338 | media-general | C0AE8G5MT7Y |
| Video Pipeline | 901816720767 | video-editors-labs | C0BJF7RR09Y |

Aziz excluded Sales on 12 October 2026. Other lists, templates and subtasks are excluded.

## Behavior

- The first baseline records existing assignments without sending historical alerts.
- A new assigned task generates one message. A later assignment notifies only the added people.
- Multiple assignments before delivery combine into one message.
- A new video request also generates a message when no editor is assigned.
- Video recipients include normal assignees and the verified Assigned Editor users field, `8e519279-da37-4ae2-93fa-78865ee187fc`.
- Subtasks, archived tasks and completed tasks cannot generate messages. Before sending, the worker checks the current task again.
- Title, due date, comment and status edits do not repeat assignment alerts. Removing a person does not post an alert.
- Slack identities match exact, unique active email addresses. Unknown matches use the ClickUp name and raise a health warning. Names never select a Slack account.
- Alerts show the task name, assignee mentions, due date and a ClickUp button. Time-specific deadlines say Kuwait time.
- No channel-wide mention, daily reminder or client WhatsApp is sent.

The worker polls every two minutes with a ten-minute overlap. It follows every ClickUp page before advancing that list's cursor. A full reconciliation runs every six hours. A source failure preserves the cursor and does not block healthy lists. Very brief assignment changes between polls can be missed, but the message always reflects the current assignment at delivery.

## Delivery safeguards

An OS lock allows only one worker. SQLite commits task snapshots and notification intents atomically. WAL and synchronous FULL protect receipts on this host. Each intent has a stable UUID and provider reference. A send intent is committed before the network request.

A timeout, server error, missing receipt or interrupted send becomes `unknown`. It is never automatically replayed. The worker searches Slack history for its reference and records an existing receipt. A missing history result is not permission to resend. An explicit rate-limit rejection retries with bounded backoff. Other failures need operator review.

SQLite is the private single-host delivery ledger. This small worker does not add polling/outbox load to the shared Supabase database. It mirrors aggregate health into existing `cockpit_sync_state`, key `task-assignment-alerts`. The guardian reads that row. No new public table or browser permission is required.

Daily consistent SQLite backups retain seven days. Keep the live ledger across releases. If it is missing, the worker refuses to recreate it. Restoring an old backup requires a provider-history audit before enabling sends. A new empty baseline is not a safe recovery method.

## Install

1. Test with `python3 -m unittest discover -s hermes/task-assignment-alerts`.
2. Install the reviewed source in its own versioned VPS directory. Ensure `run.sh` is executable (`chmod 750 run.sh`); the installer must verify this before adding cron.
3. Create a private config with `apply: false` and `credentials_file` pointing to the existing private service runtime.
4. Verify the native Slack bot can access all six channels. Verify assignee email matches and channel membership.
5. Run `worker.py --config <private-config> --state-dir <private-state> --bootstrap` once.
6. Check the complete baseline and zero delivery intents. Preserve the ledger.
7. Install the guardian check and confirm it reads the health row.
8. Set `apply: true`. Install the two-minute cron using the dedicated release link and private state directory.
9. Create one clearly marked internal test assigned to Aziz. Verify its Slack receipt and task link. A repeated scan must not post again. Close the test after verification.

The config uses existing `CLICKUP_API_TOKEN`, `SLACK_BOT_TOKEN`, `DESK_SUPABASE_URL` and `DESK_SUPABASE_KEY` through the private runtime. Never commit credentials.

Example cron shape:

```sh
*/2 * * * * TASK_ALERT_CONFIG=/home/hermes/.task-assignment-alerts/config.json TASK_ALERT_STATE=/home/hermes/.task-assignment-alerts /home/hermes/task-assignment-alerts-current/run.sh >> /home/hermes/.task-assignment-alerts/cron.log 2>&1
```

## Operations and rollback

Run the worker with `--status` to read receipt counts and list cursors. This does not send messages.
Set private `apply` to false to stop sends while preserving task observation. Do not delete the ledger or reset cursors.
The guardian reports stale health after ten minutes and flags source, identity or delivery faults through its existing incident process.
Inspect `unknown` and `failed` rows before any manual retry. Check Slack history and the exact event reference. Do not convert an unknown outcome directly to queued.
Route changes require a reviewed ledger migration because the worker checks the route fingerprint.

Existing Make workflows are unchanged. Their form-based campaign, call-summary and editor-receipt notices are separate from these ClickUp assignment events.

Sources: [ClickUp task paging and home lists](https://developer.clickup.com/reference/gettasks), [Slack message receipts](https://docs.slack.dev/reference/methods/chat.postMessage/), [Slack history](https://docs.slack.dev/reference/methods/conversations.history/).
