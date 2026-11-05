# PostgREST boundary for the native research reader

Status: design evaluation only. No new API schema, JWT role, grant, secret,
route, provider call, database change or activation has been made. The direct
Postgres driver remains blocked by inherited PUBLIC access to pg_net objects.

A dedicated PostgREST RPC surface may avoid giving a service an arbitrary SQL
connection. PostgREST permits requests only to configured exposed schemas; its
active role also needs the relevant grants. Supabase recommends a dedicated API
schema around private tables and helper functions. The existing live `net`
schema was observed not exposed by the Data API, but this alone does not
prove that a new role and every other exposed schema are safe.

Sources: [Supabase API security](https://supabase.com/docs/guides/api/securing-your-api),
[PostgREST schemas](https://docs.postgrest.org/en/stable/references/api/schemas.html),
[PostgREST authentication](https://docs.postgrest.org/en/stable/references/auth.html).

## Candidate boundary, not implementation

1. A server-only Supabase identity gets a short-lived signed JWT for a dedicated
   NOLOGIN API role. Bind it to one approved service subject and use a narrowly
   controlled token issuer. The GitHub OIDC handler still authenticates the
   exact workflow/run first; the browser never receives the JWT or capability.
2. Expose a purpose-built API schema containing only fixed, reviewed RPCs.
   Prefer `SECURITY INVOKER` API wrappers that can call a narrowly granted
   private helper. The private data and helper schemas, `net`, and arbitrary
   SQL must not be exposed. Audit effective privileges and every other exposed
   schema, including PUBLIC privileges and existing callable RPCs. Do not copy
   the broad example grants in generic schema setup instructions.
3. Change the source contract before exposing it: the current `read_source`
   can be called without a committed reservation. A fixed RPC must enforce the
   reservation and exact response capability, receipt, run, subject and version
   at the database boundary. A separate committed reservation may be necessary
   before an answer-bearing request. Raw capabilities, answers, JWTs and DB
   credentials must not enter logs or URL query strings.
4. Require a POST that actually commits before any answer is released. Check
   the deployed PostgREST transaction-end configuration and test adversarial
   requests with `Prefer: tx=rollback`, mixed Prefer headers, errors, timeouts,
   proxy retries and disconnects. Do not infer effective settings from defaults.
   PostgREST documents that rollback preference can return a response body if
   transaction-end overrides are enabled. A rollback-capable endpoint could
   recreate the replay bypass even if ordinary successful requests commit.
5. Preserve the locked native switch until a source-level submission and
   publication fence, post-provider recheck, unknown-outcome recovery, bounded
   rate/replay policy, least-privilege JWT provisioning, and data retention
   rules are implemented and reviewed. A role with a bearer JWT must not be
   able to self-assert a different GitHub run or bypass the OIDC gateway.

Sources: [PostgREST transactions](https://docs.postgrest.org/en/stable/references/transactions.html),
[PostgREST transaction preference](https://docs.postgrest.org/en/stable/references/api/preferences.html),
[Supabase custom claims](https://supabase.com/docs/guides/api/custom-claims-and-role-based-access-control-rbac).

## Required verification before any exposure

- Test with a dedicated synthetic database and synthetic JWTs first: wrong
  role, wrong subject, expired JWT/capability, direct unreserved reads, mixed
  role claims, raw `net` and other schema access, sensitive logs, stale or
  replaced answers, all failure/timeout/rollback paths, and concurrent reads.
- Prove by controlled readback which schemas and RPCs are exposed, the exact
  role's effective access, and actual PostgREST commit/rollback behavior; do not
  change global pg_net grants or existing cron jobs as part of this work.
- Treat a lost HTTP response as unknown until durable metadata reconciles it;
  do not automatically replay or publish a report for an older response.

Until those checks and the shared publication fence succeed, this alternative
is a promising design to investigate, not a proven safe replacement or a reason
to enable the native forms or market research.
