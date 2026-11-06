# Local PostgreSQL concurrency rehearsal, held plan

This is an offline rehearsal record, not permission to install a package or activate the feature. Do not connect to production, use real client data, mutate providers, or enable the retained-context policy. The tests below cover only a limited part of the required concurrency proof.

## Rehearsal result, 6 November

This plan was subsequently rehearsed on an isolated PostgreSQL 17 cluster under a restricted macOS sandbox, with TCP disabled and access through a private Unix socket. The 49,189,537-byte npm archive matched the pinned SHA-512. All 998 regular native files matched the corresponding Zonky 17.0.0 Maven artifact by SHA-256, and macOS verified the `postgres` executable's signature. Archive paths and file types were checked before extraction; 17 validated local symlinks were created without running the package's scripts. No production credentials or client records were used.

The saved `row-lock-probe.py` first checked the lock mechanism on a minimal synthetic row. The saved `postgres-fixture-bootstrap.ts` and `postgres-policy-race.ts` then ran the actual offline request prototype against canonical migration-based synthetic fixtures. Two independent sessions demonstrated that an in-flight legacy submit delays activation until commit; an activation in progress delays legacy submit and causes it to refuse after activation commits; and activation rollback releases the waiting legacy submit. The test also checked that the two-commit-order scenario created exactly one request. No external provider was connected.

These are targeted rehearsal results, not approval to migrate. The actual kickoff caller, all applicable request types, deadlock/latency behavior, client authentication and UI wiring, provider delivery, live drift guards, full rollout and reverse migration are not covered. These scripts create and drop a database named `requests_probe`; run them only against a verified disposable local PostgreSQL instance, with the sandbox and synthetic environment described below. Their `/private/tmp/` prefix check alone does not prove an instance is disposable.

The temporary PostgreSQL server was stopped after the independent budget test finished, and the exact temporary server, archive and registry metadata directories were removed. No binaries are stored in the repository.

## Package assessment

The npm package `@embedded-postgres/darwin-arm64@17.0.0-beta.12` is published by the maintainer of [embedded-postgres](https://github.com/leinelissen/embedded-postgres), and the registry describes the native binaries as derived from Zonky's embedded PostgreSQL binaries. That is a third-party distribution, not an independently verified official PostgreSQL binary. Registry metadata lists `dist.unpackedSize` 135,957,454 bytes and the following pinned integrity:

`sha512-tisbMdfNPvuCrrSevv+lWa0q13r4MiMCI7ie4BGLcDRIHlfGPmCYL1CNuhUcHfXDcHGVapvb1LvLPKy4CsKrvQ==`

Registry metadata includes an npm signature, but neither the signature nor provenance against the upstream Zonky binary has been independently verified here. The package's postinstall script reads `native/pg-symlinks.json` and creates the listed symlinks, ignoring failures. The manifest inspected from that exact npm version lists 17 paths within `native/lib`; the script itself does not validate paths, so executing it is not part of this plan. On 6 November the Mac reported about 3.2 GiB free; the archive, any cache, temporary cluster and database/WAL would be additional to the unpacked size. Their exact total is not yet measured.

## Proposed rehearsal after review

1. Recheck free space and running workloads. Bound the archive, extracted files, database and WAL, and stop before any resource threshold set by the release coordinator. Use a unique temporary directory, record its exact path and avoid touching shared dependencies.
2. Obtain only the exact registry tarball into that directory. Verify the pinned SHA-512 before unpacking. Inspect the complete archive manifest for absolute paths, `..`, links and unexpected executable hooks before extraction. Independently inspect distribution provenance and native binaries' linked libraries and macOS signatures; stop if they are inconsistent or cannot be assessed. Record measured tarball and extracted sizes.
3. Do not run package-manager lifecycle scripts. If the verified binary requires symlinks, recreate only the validated relative manifest entries inside the extracted package, rejecting anything that escapes that directory. Start a disposable cluster under the current user with a private Unix socket and no TCP listener; never create an OS user. Supply no production credentials or data.
4. Load only synthetic schema and fixtures needed for the exact prototype. In separate PostgreSQL connections, test both ordering cases: a legacy submit holding the shared type lock while activation waits, and activation holding its update lock while legacy submit waits and then observes the new policy. Exercise kickoff, stale type version, rollback, simultaneous readiness change, retries and timeouts; record transaction outcomes and verify no duplicate or provider output. Check off-mode behavior and transaction read-only preview separately. Detect deadlocks, wrong ordering, and unexpected waits.
5. Shut down the exact temporary server, confirm it is gone, remove only this test's known directory, and verify reclaimed space. Record PostgreSQL version, fixture and test revision, assertions and limitations. Passing this rehearsal does not prove production migration, UI, provider delivery or deployment safety.
