# Client ad account inventory coverage draft

This is an offline, disabled-by-default research candidate. It is not an
account importer, an editing screen, a provider collector, a spend total, or a
budget write guard. Do not apply or activate it without independent security,
operational and adapter review. It creates a new non-exposed schema and no
runtime grants. It does not populate data or affect existing clients or jobs.

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
  rollback and races independently before activation. The local single-connection
  tests do not establish concurrent behavior or validate a future verifier.
- A separate decision and design for calculating amounts or blocking a write.
  A read can become stale immediately; this candidate is never an authorizer.

`client-ad-inventory-supabase.test.ts` uses synthetic clients/accounts and
tests the migration in local PGlite. It does not contact providers or a live
database. No result should be interpreted as production integration.
