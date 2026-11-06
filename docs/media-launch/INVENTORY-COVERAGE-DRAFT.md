# Client ad account inventory coverage draft

This is an offline, disabled-by-default research candidate. It is not an
account importer, an editing screen, a provider collector, a spend total, or a
budget write guard. Do not apply or activate it without independent security,
operational and adapter review. It creates a new non-exposed schema and no
runtime grants. It does not populate data or affect existing clients or jobs.
The private Meta board evidence function is a disabled, read-only research
adapter.

## Why

The client budget board reads linked Meta accounts. The current client
registry has a Meta field and a TikTok field, but does not prove that it lists
every relevant account or platform. An incomplete or stale provider read
cannot establish the client's overall budget. A human or authoritative source
must first identify and attest the relevant scope, and each account needs
verified ownership and a fresh complete provider read.

## What the candidate records

An explicit whole-scope attestation has a source kind, evidence reference,
time, expiry and an exact, ordered set of `(platform, account, generation)` triples. Account
ownership must be independently verified and expire. Coverage is recorded per
account with completeness and a read time. A persistent generation per canonical
platform and account advances whenever membership is inserted, deleted or
changed, including when a different client adds or removes that account.
Old scope, ownership and provider-read evidence cannot be reused after such a
change; the provider read must also be no older than ownership verification.
Adding, deleting, recreating or changing an account makes the saved set differ,
so the status becomes unknown. The model
does not assume that a missing platform has no accounts. The default gate is
off; an absent, expired, future, overlong or unmatched attestation is unknown;
unverified ownership, a missing, incomplete, future or older-than-five-minute
provider read is incomplete. An exact account attributed to two clients is
incomplete for both, even if sharing may be legitimate. Meta and TikTok use
numeric-only IDs, Google uses ten digits, and Snap uses lowercase UUIDs in this
experiment; future adapters must validate these rules with their providers.
Unknown platforms remain incomplete. Different provider aliases can bypass
exact duplicate detection unless canonicalization is proven before ingestion.

Evidence references are private pointers, not a place for credentials,
signed URLs, raw responses, names or other sensitive data. The future writer
must reject or redact such values and protect all account and evidence data.
An evidence reference or `provider_read_complete=true` does not by itself
prove a read: that assertion is only as trustworthy as its future verifier.

The strongest modeled status is `ready_for_attested_scope`. It includes a
warning that accounts or platforms could have been omitted. It is not
`complete`, does not mean the attestation is objectively correct, and must
never approve an ad budget or claim a cross-platform total. The 30-day
attestation and ownership expiry and five-minute read window are conservative
experimental ceilings, not approved operational policy. They need review.

## Meta board evidence candidate

`meta_board_evidence` reads only existing board link and snapshot metadata.
It first requires exactly one board card for the supplied client key, an exact
numeric account link on that card, and no other board card linking that same
account visible to the function. Board refresh chooses one tie per account,
so absence of a duplicate board row does not establish ownership or rule out
conflicting source mappings. A conflict or unknown link returns the same
`unavailable` response without disclosing account details. These checks are
not caller authorization. Before any use, a trusted server must authorize
the caller for the client and perform a global conflict check. Review actual
RLS and privileges: client-filtered RLS could hide other board rows and make
the duplicate check falsely pass. Never expose this function directly to a
client-scoped caller. No runtime
role is granted access and the gate is disabled.

For an eligible link, it labels the most recent verified snapshot and account
state `recent`, `stale`, `inconsistent`, or `missing`, requiring matching run
IDs and rejecting future timestamps. Matching IDs are only a filter, not
proof the timestamps came from that run: the per-day upsert can retain the
greatest last-read timestamp while replacing its run ID. Activity-reconstructed
history is not accepted as a snapshot. `recent` means recently recorded
metadata, not verified budgets for the account-local day or complete worker
output. The five-minute boundary is an experimental ceiling.
It always returns `incomplete` and `provider_read_complete: false`, even for a
recent snapshot. It does not create or update inventory, coverage, or any
provider record, return amounts or authorize actions. Board linkage can depend
on names, so does not prove ownership; the snapshot's `verified` flag records a
read, not proof that all required pagination, budget modes, or other platforms
were covered. The adapter returns only a private candidate signal, never a
complete provider read. Independent review of the real worker and exact
account's provider responses is required before any stronger evidence claim.
Results are transaction snapshots and can be stale immediately; they cannot
fence or approve provider writes.

## What is still needed

- A trustworthy, role-authorized way to create and review scoped attestations,
  detect external account changes and maintain an audit trail. The eventual
  writer must protect against stale updates and support revocation. It must not
  permit direct generation edits or membership TRUNCATE (which does not fire
  row triggers), and must ensure evidence is bound to the current generation in
  the same transaction. There is currently no runtime writer or grant.
- Provider-specific, authenticated collectors that prove complete pagination,
  ownership, currencies, budget modes and timestamps, with explicit coverage
  semantics for accounts with zero campaigns. Each platform needs its own
  checks; a Meta read is not evidence about TikTok, Google or other platforms.
- An authenticated UI/API design with client isolation and grants reviewed
  against the live Data API and RLS configuration. There are no grants here.
- Concurrency, expiration, retry, provider failure, scale and privacy review,
  plus real-provider readback before any claim about production coverage.
  Verify actual PostgreSQL simultaneous transactions, locks, deadlock handling,
  rollback and races independently before activation. Synthetic PostgreSQL
  concurrency checks cover membership invalidation and isolation behavior only; they do not validate a future verifier or any
  writer and provider race.
- A separate decision and design for calculating amounts or blocking a write.
  A read can become stale immediately; this candidate is never an authorizer.

`client-ad-inventory-supabase.test.ts` uses synthetic clients/accounts and
tests the migration in local PGlite. It does not contact providers or a live
database. No result should be interpreted as production integration.
