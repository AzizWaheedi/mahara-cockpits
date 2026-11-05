# Task comment receipt reader, disabled research integration

This is an isolated, unconnected provider adapter for the planned native onboarding research reader. It is not a server, deployment, authorization policy, database adapter or form cutover. No production caller imports it.

After the response-bound capability is verified and bound, this adapter may fetch the exact comment ID from the exact ClickUp task's comments endpoint. It only issues GET requests against the fixed ClickUp host, rejects redirects, bounds responses and page count, validates identifiers, follows ClickUp's documented `start` + `start_id` pagination, and returns only the requested `comment_text` bytes. It does not log responses or credentials, and never searches another task or falls back to the newest comment. Missing comments return null; ambiguous, malformed, oversized, provider-error, duplicate and pagination-limit cases fail closed.

The caller must separately validate the comment's expected SHA-256 against the independently stored intended text and delivered receipt, after authenticating and binding the exact task and response. Task ID and comment ID must originate from the bound trusted database record, not an untrusted caller. A task's comments API scopes results to that task; it does not itself establish the response's provenance. This adapter must not run before capability binding.

Integration is not approved yet: ClickUp's returned `comment_text` needs a controlled synthetic provider check against exact original UTF-8 bytes, including Arabic, newlines and long text; service-account access and token storage require review; production permissions, network policy, rate limits, receipt freshness and late or edited comments need test coverage. Pagination stops after four pages; old receipts beyond that deliberately fail closed instead of using an incorrect comment. The surrounding database adapter, provider ledger, identity enforcement, publication fence, and unknown-outcome recovery remain unimplemented. Do not enable native forms or research based on this adapter.

Synthetic tests only: `bun test hermes/forms-relay/native-research-reader/clickup-comment.test.ts`. The fetch function must be injected; the module never silently uses global fetch. No client data, keys, provider requests, client messages or live changes were used.

Reference: https://developer.clickup.com/docs/task-comments-pagination
