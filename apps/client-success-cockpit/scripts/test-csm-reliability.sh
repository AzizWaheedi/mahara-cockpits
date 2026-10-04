#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Keep React module mocks and fake Convex backends in separate processes.
bun test scripts/check-in.test.ts scripts/projections.test.ts scripts/churn.test.ts
bun test scripts/csm-access.test.ts
bun test scripts/csm-billing-reliability.test.ts
bun test scripts/csm-page.test.tsx
bun run test:viktor-spaces-access
bun run test:phi-redaction
bun run test:phi-functions
bun run check:phi-functions
