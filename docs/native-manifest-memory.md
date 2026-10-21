# Smaller native feed revision checks

## Problem and change

The media capture and publication each call `cockpit_native_manifest()`. The
original implementation sorts all full JSON rows, builds a JSON array for each
of 20 input tables, and serializes the array again to calculate its fingerprint.
This creates avoidable memory pressure alongside the actual source data.

The migration replaces that intermediate array with sorted, fixed-width SHA-256
row digests. Every column still participates through `to_jsonb(t)`. Counts,
duplicate multiplicity, empty tables and physical row order retain their intended
meaning. The digest aggregate contains 32 bytes per row instead of complete
payloads. It is smaller, not constant-memory; exceptionally large row counts or
individual records still require capacity planning.

No worker payload, deployment package or table data changes are required. The
internal helper remains unavailable to browser and service API roles. Existing
state/publish RPC permissions, transaction locks, lease fencing, protected human
histories and exact retry receipts remain in force.

## Not in scope

- Paid compute changes, `work_mem` changes or database maintenance.
- Removing protected histories from worker payloads, skipping freshness writes
  or changing the caller's polling schedule.
- Replacing production's concurrent Meta and CRM collector fixes.
- Marking missing client forms, creative approvals or WhatsApp pairing complete.

## How we know it works

Run the canonical PGlite publication suite and the new manifest tests:

```sh
bun test scripts/native-manifest.test.ts scripts/native-feed.test.ts scripts/native-audit-payload.test.ts
```

The tests cover all 20 original tables and counts, empty-table versioning,
full-row/nested/Unicode edits, additions, deletions, snapshot changes, human
notes, reorder invariance, privilege denial and repeatable migration. The full
publication suite also covers duplicate identity, stale source revision,
atomic rollback, protected history and exact retry behavior.

A synthetic 2,500-row fixture measures 10,502,786 bytes of serialized row input
versus 80,000 digest bytes (99.24% less aggregate input). This is **not a measured
process-RSS reduction or a production outage guarantee**. A changed final row
still changes the fingerprint.

The upgrade test captures a plan using the original function, applies the
migration, and proves that the old plan fails without writing a campaign. A
fresh capture then publishes on the same valid fenced run and repeats exactly.

## Release and rollback

This is a proposed database-only release. Obtain approval for this PR/migration;
approval for the earlier PR 62 does not cover it.

1. Read the current live function definition and privileges again. Confirm its
   20-table coverage still matches; stop if another change added an input.
2. Apply only `20261021173015_native_manifest_compact_fingerprint.sql` through
   the normal migration mechanism. Do not push every unrelated pending migration.
   The migration uses the existing publication advisory lock with a five-second
   lock timeout; a busy publisher causes a clean refusal, not a partial change.
3. Verify the stored function and unchanged privileges. Observe a normal fresh
   state capture and the next exact publication receipt. A plan captured before
   the upgrade is deliberately rejected as a source revision conflict. Let the
   regular worker calculate again; do not replay an uncertain write.
4. Compare publication duration, temporary I/O and database restarts during the
   existing observation period. Keep the remaining capacity work open.

For rollback, restore only the saved previous function definition and privileges
in a reviewed forward migration. Never revert source rows or run receipts. The
fingerprint version changes again, so any in-flight plan must be recalculated.
