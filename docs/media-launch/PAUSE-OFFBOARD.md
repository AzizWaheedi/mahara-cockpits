# Pause and offboarding

Media buyer → Clients → client → Pause & offboard.

A pause reads every linked account, shows verified Mahara campaigns that are
switched on, then sets those campaigns to PAUSED. Creator evidence, account ID,
current campaign status and the caller's current access are checked. Unknown
creators stay unchanged and are shown for manual review. Account errors and
partial Meta lists block apply. Budget, ad sets, client access and source records
are preserved.

Full offboarding pauses the same verified campaigns and creates a typed Client
Offboarding Request on the existing Client Success list. It does **not** revoke
access automatically. The team completes and records four checks: campaigns,
client access to Mahara OS/Academy, Mahara access to client Meta assets, and other
connections including GHL, calendars and Drive. The client keeps an administrator.
Each confirmation stores the member, time and evidence note in the audit log.
Completion requires all four confirmations and is labelled a team confirmation.
The CSM continues to own the canonical Client Board status and the request task.

The durable Supabase hold is saved before the first provider write. Launch,
campaign-control and native-worker write scopes refuse work while it is active
or complete. Read-only client context stays available. Ordinary pause holds can
be reopened by the assigned media buyer; offboarding holds require an admin.
Reopening does not switch ads on or restore revoked access. Existing jobs and
intents are not deleted. An uncertain write remains in reconciliation, and the
hold stays on until an admin has reviewed its receipts. Do not bypass it or retry
with a new request to hide a partial result.

No external campaigns, tasks or access were changed for tests. The harness uses
fictional clients and intercepts every client lifecycle request.

## How we know it works

- API fakes cover preview/no-write, disabled apply, wrong accounts, paging,
  unknown creators, stale reviews, read-back failure, lost response, membership
  change, typed ClickUp requests and duplicate receipts.
- PostgreSQL tests apply the migration twice and check RLS/grants, role/client
  scope, service holds, queued worker fencing, optimistic revision checks,
  all-step completion, admin release and receipt reuse.
- Browser checks: pause → offboard → four confirmations → complete. Dark layout
  at 390, 820 and 1440 pixels. No real provider writes.

## Not in scope

This feature does not automatically cancel agreements, change billing, remove
client users or permissions, delete assets, or change the Client Board status.
The checklist is a guided handoff with evidence, not an automatic access-revocation
engine. LAUNCH_APPLY remains the existing server gate and rehearsal stays read-only.
