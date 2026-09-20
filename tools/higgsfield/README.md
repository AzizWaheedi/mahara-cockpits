# Higgsfield: Seedance 2.5 text-to-video

The smallest working call against the Higgsfield API through the official
SDK (`@higgsfield/client`), using `subscribe` with polling.

```bash
bun install
bun run index.ts
```

A run is **billable**: it asks Higgsfield to generate a video.

## Credentials

`HF_CREDENTIALS=<key-id>:<key-secret>` in `.env.local`, which the root
`.gitignore` already ignores (`git check-ignore .env.local` confirms it).
Bun loads that file itself, so no dotenv package is needed. The value
stays in the process: nothing prints, logs or commits it.

The SDK reads `HF_CREDENTIALS` (or `HF_KEY`) from the environment on its
own; this example still passes it to `config()` explicitly so the
dependency is visible at the top of the file rather than implied.

## Three things worth knowing

**The published example is the v1 shape.** The docs show
`result.isCompleted` and `result.jobs[0].results.raw.url`. The v2 client
that `@higgsfield/client/v2` exports returns `V2Response`: a flat
`status` and the file at `video.url`. Following the docs against v2
yields `undefined`, which reads as a generation that produced nothing
rather than as a mistake in the calling code. The shape here was taken
from the package's own `dist/v2/types.d.ts` at version `0.2.6`.

**Status is checked, never assumed.** `V2RequestStatus` is
`queued | in_progress | completed | failed | nsfw`; `canceled` is
reachable through `cancel_url` but missing from that union, so it is
handled too. Only `completed` *with* a URL is treated as success, because
reporting a moderated or failed request as a success is how an empty post
reaches a client before anyone notices.

**An empty balance is a 403 `NotEnoughCreditsError`.** It is not a fault
in this code and retrying will not clear it, so it exits `2` with an
instruction instead of a stack trace. Exit `1` is a real failure, `0` is
a video.

Unlike raw HTTP calls to this API, the SDK is not stopped by Higgsfield's
Cloudflare bot rule — hand-rolled requests need a browser `User-Agent`,
the SDK does not.

## Status

Written and type-checked, and it reaches the API and authenticates. It
has **not** been observed returning a video: the account balance is
empty, so the call ends at `NotEnoughCreditsError` (HTTP 403) before
anything is generated. Top up and run it again to confirm end to end.
