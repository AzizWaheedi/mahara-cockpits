# Client appointment feedback - production receipt

Verified 23 October 2026. All three cockpits were released through the unchanged guarded `scripts/ship.sh` from source **`72cf2e5a08dfb38fcc8257b72eb53a946f9de5cd`** on GitHub main. [PR #65](https://github.com/AzizWaheedi/mahara-cockpits/pull/65) implements the feature; [PR #66](https://github.com/AzizWaheedi/mahara-cockpits/pull/66) updates the existing Results navigation test.

## What users can see

- CSM client **Results** starts with **Client feedback**; Media Buyer Ads client details and Creative Director client workspaces show the same appointment feedback.
- The panels read the scoped Supabase RPC `cockpit_client_appointment_feedback`, including exact client comments, attendance, lead quality, outcome and save/delivery state. They refresh while visible and discard stale client responses.
- No-show appointments are never scored. Empty ratings are not zero. Unbound historical imports explicitly say their appointment time is not verified. Internal call-center notes are excluded.
- Replacement sections no longer send staff to the old reporting Sheet. Canonical feedback and board overlays are documented in the corresponding migrations; this frontend release does not itself activate the separately held native reminder cutover.

## Production identities and canonical entry assets

| App | Verified deployment | Canonical route | Served entry asset |
| --- | --- | --- | --- |
| Media Buyer | `dpl_Emg4ezHLdyRx35S8sPccMVRfAJXm` | [Cockpit](https://cockpit.maharamedia.com/) | `/assets/index-CR7FDmny.js` |
| Client Success | `dpl_22gqvdsp4AXkKitE9g1f5gda3Gr4` | [Client Success](https://cockpit.maharamedia.com/client-success/) | `/client-success/assets/index-Jda1U0lQ.js` |
| Creative Director | `dpl_D9qbayvGgbgFRyHidQ1tqVod8MSa` | [Creative](https://cockpit.maharamedia.com/creative/) | `/creative/assets/index-BTkpobLQ.js` |

Vercel project identities were verified as `mahara-media-buyer`, `mahara-client-success` and `mahara-creative-director`. Each deployment was READY in production, carried the source SHA above, and served its exact entry through the canonical cockpit route. Each live bundle contains its required public Supabase address.

## Feature asset proof

Each public canonical chunk below was fetched after release and contains all three markers: `cockpit_client_appointment_feedback`, `Client feedback`, and `appointment time not verified`. These checks require no sign-in or client-data reads.

| App | Canonical feature chunk | SHA256 |
| --- | --- | --- |
| Media Buyer | `/assets/AuthenticatedAppRoutes-CvNN_eGY.js` | `6e8232c6f8f1520c85d6621abe6059785ee60c4657da39669b52dd0fe7da22ca` |
| Client Success | `/client-success/assets/AuthenticatedAppRoutes-e-zG9pSV.js` | `8f19555b996a62987232c0a01f3940a55e537d939ef6af2e7c58fe587dbc90c0` |
| Creative Director | `/creative/assets/AuthenticatedAppRoutes-DMujhOPx.js` | `4b678460d8c9d44bba8b8fdc366b6134d9df8fc4c036a102cd6bed2e525188f7` |

## Validation and limits

- Each successful ship passed all **80 offline readiness suites**, fresh typechecks and builds for all five cockpit apps, shared-source checks, live authentication configuration, exact main/production ancestry, target-app lint/typecheck/build, and Vercel/canonical-route readback.
- Feature and adjacent board/native-feedback regressions passed **107 tests / 564 assertions** before release. Responsive review covered 360px, 390px and desktop, including Arabic comments, empty/error states and stale-client isolation.
- The initial CSM navigation expectation was corrected to include the intentional first feedback anchor. EOD tests used the runbook's `google-auth` and `requests` dependencies in an isolated temporary Python environment. Two intermittent existing offline suite failures passed unchanged in isolated reruns and the final complete ship passes; no assertions or timeouts were removed or relaxed.
- Readiness reports were retained locally as `readiness-20261023T121110.json` (CSM) and `readiness-20261023T121916.json` (Creative), together with ship logs and public asset hashes. No credentials, private raw data or test fixtures are included here.
- This receipt verifies deployed source and feature assets. It does not certify a blanket historical reconciliation or activate unrelated schedules. This documentation commit requires no redeploy.
