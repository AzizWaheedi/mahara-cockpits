# Sales call exclusions, 13 October 2026

Status: implemented and tested locally. Production is unchanged. Merge and deployment need Aziz's approval.

## Problem and change

Generic Fathom titles allowed client account calls and internal meetings into sales notes and Intelligence.
The notes worker now classifies each call as sales, client service, internal, or unknown.
Client-service and internal classifications require a quote from that call's transcript.
This uses the existing notes request. It does not add a model request.

The database preserves exclusions through imports and duplicate reconciliation.
It also recognizes service-call titles and strong CSM matches for the exact Fathom recording.
It does not match people by name or exclude their historical demos because they became clients.
Ambiguous calls remain unknown. Classification can still require human review.

Excluded calls cannot contribute to new digests, follow-up context, sales reviews, or proposal drafting.
Authenticated reads hide their notes and reviews. Source recordings, notes, and transcripts remain stored.
The hidden-recordings view labels client-service calls and internal meetings.

The migration corrects 10 verified records: 3 client account calls and 7 internal meetings.
Each correction checks an exact recording ID and a summary prefix. No private transcript is included.
Recording `190894076` is the example reported by Aziz.
The live audit also matched one genuine prospect call. That call is not in the correction list.

## Release sequence after approval

1. Fetch current main. Check for changes to the same files before merging the PR.
2. Apply `20261013112622_sales_client_call_exclusion.sql` to Creative Triage, project `bldgtotkfmhoxmlzowdx`.
3. Release the sales frontend through the normal `scripts/ship.sh sales` procedure with its production configuration.
4. Release the changed `sales-api` function and the sales-desk worker from the approved commit.
5. Run `python3 desk.py digest` on the configured worker to rebuild both 7-day and 30-day digests.
6. Check the 10 corrected rows and the newest digests in Supabase.
7. Check Intelligence in the live sales cockpit. Confirm that the corrected calls do not appear in the normal recording list.

Release these components together. The new frontend hides invalidated digests until regeneration completes.
Old workers produce digests without source IDs. The database marks those digests invalid until the worker is upgraded.
The old frontend does not understand invalidation, so a database-only release is incomplete.
Do not deploy the local fixture configuration or its build output.

If a correction is wrong, first correct its evidence with the service role.
Then clear its exclusion and regenerate affected digests. Do not clear exclusions while their source evidence still classifies the call as non-sales.

## Verification

- Full Python suite before the internal-meeting extension: 1,363 tests, 18 skipped, no failures.
- Updated targeted Python suite: 102 tests, 5 skipped, no failures. It includes 7 call-scope regression tests.
- Local Postgres: 22 checks passed. These cover replay, RLS, reimports, strong versus weak CSM matches, digest invalidation, and duplicate isolation.
- Sales frontend suite: 1,222 passed, 2 skipped, no failures.
- TypeScript and production build passed. The bundle-size warning is unchanged.
- Biome passed for the five changed frontend files.
- Fictional browser harness: both digest windows hide the excluded text and show the refresh notice.

The live database inspection was read-only. No provider messages, calls, CSM changes, or production writes occurred.
