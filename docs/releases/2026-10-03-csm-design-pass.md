# Client Success cockpit design and reliability pass

Status: in progress. Continue PR #27. No production changes in this pass.

## Requested outcome

Make the whole CSM cockpit easier to use, remove repeated navigation and actions, and strengthen the backend. Keep the ClickUp Client ID and exact-contact check-in booking from PR #27. Prepare a reviewable preview. After Aziz approves the finished cockpit, make a step-by-step Higgsfield SOP video with voiceover. Do not generate the video before approval.

## Initial findings

- The sidebar has 13 destinations. Client and growth pages can use workspace tabs without removing existing routes.
- The live Today screen includes unrelated personal WhatsApp threads. Do not preserve their contents in evidence. Restrict the inbox to verified client IDs, the configured account and the authorized seat.
- Some public endpoints check a login but omit the CSM role or client scope. The shared role helper does not reject revoked members.
- Several queued actions report completion before a downstream receipt. Repeated clicks and failed requests need clear states.
- A route error persists after navigation. The error view claims a report succeeded before it knows the result.

## Work and acceptance

1. Audit client reads, writes, service-role adapters and role revocation. Add regression tests for denied access and mismatched IDs.
2. Simplify navigation and the daily workflow. Use the existing Mahara navy and teal style. Keep mobile and keyboard use practical.
3. Consolidate client booking and messages. Add pending, empty and error states to important actions.
4. Verify all main screens with fictional data. Test failures and retries. Run type checks, unit tests, the production build and shared-file checks.
5. Publish the code, evidence, known limits and recovery steps for approval.

## Boundaries

This pass strengthens the existing backend. It does not change backend ownership or claim the planned Supabase migration is complete. Provider writes, real messages and invitations are not test fixtures. Authenticated production acceptance and controlled provider acceptance remain release checks. No system can be guaranteed unbreakable.
