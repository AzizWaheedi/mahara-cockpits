# Launch desk verification, 24 October 2026

Release mode: rehearsal only. `LAUNCH_APPLY` was absent in the live project secret-name inventory before release. No Meta, ClickUp or GoHighLevel write was used while building or testing. Live `validate_only` is deferred with activation.

## Source and isolation

Built in `launch-desk-b`, starting from `origin/launch-desk-1024`. The shared checkout HEAD was verified unchanged at `11f1dcca0d08a686b768e65381ce57e977e2f8ab`. No changes to deck-answers-1020, bp-embed-1024, the creative/client-success app sources, or present/forms. The creative API prompt/schema extraction is shared code with equivalent behavior.

## Local evidence

- 232 media API and writeback tests, 1,294 assertions, passing. Providers are fakes; unauthorized non-GET calls fail the test.
- 10 PGlite tests, 48 assertions, passing. Migration applied twice; table security, function grants, role/client scopes, receipt identity, account ownership, local discard and first new impressions covered.
- 4 launch-model tests and 4 launch-screen tests passing.
- Existing Ads filters (27), client ranges (23), campaign build store (57), board screen (1) all pass, run file by file.
- Media app TypeScript checks and shared-source checks pass.
- Manual refresh effect dependencies are deliberate. Do not apply the unsafe Biome suggestion removing their version counters.

## Design review

System Chrome, dark cockpit tokens and Geist. All 23 specified fixture states captured at 1440x900, 1920x1080, 390x844 and 820x1180. Ninety-two viewport captures inspected as contact sheets; no document horizontal overflow. The browser capture is PNG; review sheets are JPEG quality 75. Detail views additionally inspected at desktop, tablet and phone widths. Transient review captures are removed after inspection.

Interactive checks: source-campaign plan, new Page/form/country/city/media/copy selections, preview and rehearsal press, shared-account chooser and link plan, refused plan disables the primary, stopped client has no launch actions, two-account default picks the healthy account, and Just launched opens the normal campaign panel. Existing Ads filters and date-range calculations remain intact. The harness uses fictional clients and never sends launch calls to providers.

Critique: pipeline page P4 H4 E4 S5 R4 V4; client workspace P4 H4 E4 S5 R4 V4; integrated Ads additions P4 H4 E4 S4 R5 V4. Clear next action per row, distinct account/brief context, quiet empty states, visible rehearsal, keyboard labels/focus, reduced-motion handling and mobile stacking. Existing app navigation is preserved.

## Accuracy and safety corrections from review

- Current ClickUp Ads card Daily Ad Spend is read before budget caps, because the mirror does not carry that field. Unreadable or moved cards fail closed.
- Unknown creators remain unverified; a campaign name never proves ownership. Active outsiders block copy, switch and rebuild targets.
- New campaigns use verified account media, Page/forms and city keys. Landing-page builds require an account-owned pixel. Cross-account rebuilds transfer media and strip account-specific audiences.
- Meta status is read again before linking. Scope is rechecked before each actual provider write.
- Switching snapshots current campaign impressions. Earlier same-day impressions cannot label a relaunch live.
- Just launched shows unknown range totals until native sync; it reuses campaign controls and disappears when the native Ads record arrives.
- No polling loop was added. Sources load on entry or explicit refresh; catalog reads load only for the selected route.

## Harness and handoff

Start in this worktree's media app with `bunx vite --config vite.harness.config.ts --host 127.0.0.1 --port 5193 --strictPort`.

- Client book: http://127.0.0.1:5193/harness.html?path=/launch
- Ready client: http://127.0.0.1:5193/harness.html?path=/launch%3Fclient%3D1&fixture=ready-brief
- Two accounts: http://127.0.0.1:5193/harness.html?path=/launch%3Fclient%3D3&fixture=two-accounts
- Ads arrival: http://127.0.0.1:5193/harness.html?path=/ads&fixture=just-launched

Final ship commit, production deployment receipts and live read-only verification belong in the dated mahara-context session note. First live validation and SAFAD switch-on need Aziz's later activation. A paused build and switching it on remain separate actions.
