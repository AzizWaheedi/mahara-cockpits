# Native research reader HTTP candidate, offline only

This directory is not a deployed service. It contains no server, real database or ClickUp adapter, secrets, configuration, migration, sender integration or production entry point. Nothing here switches either form on. The production form ownership and Typeform/Make workflows must remain unchanged until the entire cutover is verified.

The candidate models these boundaries:

1. A disabled-by-default handler permits only a bounded JSON POST and checks a signed GitHub OIDC identity for the pinned repository, owner, workflow, commit, ref, protected environment and event. A real deployment needs an independently managed rate limiter and a platform gateway compatible with GitHub OIDC.
2. A response-bound 256-bit capability is hashed; the injected database port must atomically check and bind the exact task, response, version, receipt, identity, state, expiry, latest submission and retry count. This candidate cannot prove those checks because its port is a fake. A failed provider check comes after the capability is bound, so a durable bounded same-run retry and an explicit reconciliation state are required.
3. Only after that binding does an injected provider port read the specified comment. Its actual adapter must independently verify task association, enforce provider response limits and timeouts, and never log data. The handler hashes the returned bytes and compares the pinned digest. A second database transaction must recheck the binding, currentness, capability, receipt and approved schema fingerprints after the provider read. Neither port is implemented here.
4. The handler denies unexpected response fields, invalid shapes, duplicate refs, mismatched schema/printer fingerprints or absent validation attestations. It also requires an explicitly configured per-version ref/title allowlist; nothing is implicitly approved, and a missing or unexpected ref is denied. The production allowlist and handling of retained free text must be reviewed, because even a permitted field can contain sensitive information. Those attestations are only meaningful if the real, narrowly privileged database function validates the complete raw answer object under the pinned versioned schema, rejects unknown or invalid fields, confirms the actual printer definition, and returns only approved fields. Exact live schema hashes and the production data-retention/privacy policy have not been established. The database adapter must convert its timestamp into a genuine UTC instant using the exact canonical format `YYYY-MM-DDTHH:mm:ss.sssZ`; the candidate rejects impossible dates, noncanonical values and unnormalized PostgreSQL timestamp text.

No real client-field allowlist is provided in this candidate. Each returned field must have an exact allowed ref and title; unknown, duplicate or changed refs and titles fail closed. A missing answer is not detected by this allowlist because some fields are optional. Only complete validation of the underlying raw submission and its printer at the trusted source can establish what should have been returned. A synthetic test demonstrates rejection of a phone field unless it was explicitly allowed. Client needs, all appendix fields, access rights and retention require a deliberate decision before configuring this handler. Neither allowlisting nor removing phone fields proves that retained free text is free of personal information.

The handler rejects unexpected top-level snapshot fields and blank printed values before reading the provider comment. The mapper separately prepared for the private worker preserves the legacy contact and appendix fields; this candidate has no approved policy that authorizes returning those fields.

The wire timestamp has millisecond precision and can lose database microseconds. It is display metadata only and must never be the sole response identity or ordering key. Freshness needs a database-enforced, deterministic ordering with a tie-breaker, checked inside the actual transaction.

The key-fetch candidate pins `https://token.actions.githubusercontent.com/.well-known/jwks`, rejects redirects, oversized or malformed payloads and duplicate key IDs, and does not reuse an expired cache after an error. It aborts stalled headers and body reads after five seconds in synthetic tests. It caches for five minutes; a newly rotated signing key can be rejected until the cache expires. It has not been tested against a real GitHub endpoint. A real network adapter must handle DNS and TLS securely, use an independently reviewed timeout, cache and provider error policy, and never log keys, tokens or request content.

The second database check reduces stale reads but does not serialize later external publication with new submissions. A response can still be superseded immediately afterward. The report publication fence, provider-side idempotency and unknown-outcome recovery remain unimplemented, so this candidate must not be deployed or used to justify the native switch.

The candidate has an eight-second whole-request deadline and passes an abort signal to database, rate-limiter and provider ports. Those adapters must actually honor cancellation and have their own verified deadlines. A timeout after a database or provider operation began is an unknown outcome and needs durable reconciliation, not an automatic retry. The test ports have no such durable state and do not prove production recovery.

## How we know it works

Run only the explicitly named tests:

```
bun test hermes/forms-relay/native-reader-service/auth.test.ts hermes/forms-relay/native-reader-service/jwks.test.ts hermes/forms-relay/native-reader-service/handler.test.ts
```

Tests use generated keys, fictional identifiers, a fake provider and fake database ports. They do not test provider delivery, deployed credentials, role grants, Postgres transactions, real schema validation, actual rate limits or concurrent production submissions. Source copied from the earlier offline prototype remains experimental.

## Not in scope

Client data, network provider calls, actual database changes, app installation, secrets, dispatches, publication, deployment and production cutover.
