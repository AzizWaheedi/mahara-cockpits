/**
 * Seedance 2.5, text to video, through the official Higgsfield SDK.
 *
 * Credentials come from `HF_CREDENTIALS` in `.env.local` as
 * `<key-id>:<key-secret>`. Bun loads that file itself, the value stays in
 * the process, and nothing here prints it. `.env.local` is ignored by the
 * repository's root `.gitignore`.
 *
 *   bun run index.ts
 *
 * A run is billable: it asks Higgsfield to generate a video.
 */
import { config, higgsfield } from "@higgsfield/client/v2";

const MODEL = "bytedance/seedance-2.5/text-to-video";

/**
 * The published example shows `result.isCompleted` and
 * `result.jobs[0].results.raw.url`. That is the **v1** shape. The v2
 * client this imports resolves to `V2Response`, which carries a flat
 * `status` and the file under `video.url` -- checked against
 * `@higgsfield/client@0.2.6`'s own `dist/v2/types.d.ts` rather than the
 * docs, because following the docs here yields `undefined` and reads as
 * a generation that produced nothing.
 */
type Outcome = {
  status: string;
  request_id?: string;
  video?: { url?: string };
};

function main(): Promise<number> {
  const credentials = process.env.HF_CREDENTIALS;
  if (!credentials) {
    console.error(
      "HF_CREDENTIALS is not set. Put `HF_CREDENTIALS=<key-id>:<key-secret>` " +
        "in tools/higgsfield/.env.local (the file is git-ignored).",
    );
    return Promise.resolve(1);
  }
  config({ credentials });

  return higgsfield
    .subscribe(MODEL, {
      input: {
        prompt: "A cinematic scene at sunset",
        duration: 5,
        resolution: "720p",
        aspect_ratio: "16:9",
      },
      // Wait for the job rather than returning a handle to poll ourselves.
      withPolling: true,
    })
    .then((raw): number => {
      const result = raw as unknown as Outcome;
      const status = String(result.status ?? "unknown");
      const url = result.video?.url;

      // Only one status means a video exists, and even then the URL is
      // checked. Anything else is reported as what it is: treating a
      // moderated or failed request as success is how a broken pipeline
      // goes unnoticed until somebody opens an empty post.
      if (status === "completed" && url) {
        console.log(`status : ${status}`);
        console.log(`video  : ${url}`);
        return 0;
      }
      if (status === "completed") {
        console.error("Higgsfield reported completed but returned no video URL.");
        console.error(JSON.stringify(result, null, 2).slice(0, 600));
        return 1;
      }

      const why: Record<string, string> = {
        nsfw: "the prompt or the result was moderated",
        failed: "generation failed",
        canceled: "the request was canceled",
        cancelled: "the request was canceled",
        queued: "still queued when polling gave up",
        in_progress: "still running when polling gave up",
      };
      console.error(`No video: ${status} -- ${why[status] ?? "unrecognised status"}.`);
      if (result.request_id) console.error(`request_id: ${result.request_id}`);
      return 1;
    })
    .catch((err: unknown): number => {
      // The SDK raises NotEnoughCreditsError for an empty balance. That is
      // not a fault in this code and retrying will not fix it, so it is
      // named rather than buried in a stack trace.
      const name = err instanceof Error ? err.constructor.name : "Error";
      const message = err instanceof Error ? err.message : String(err);
      if (name === "NotEnoughCreditsError" || /not enough credits/i.test(message)) {
        console.error(
          "Higgsfield has no credits left, so nothing was generated. " +
            "Top up at cloud.higgsfield.ai and run this again; the setup itself is fine.",
        );
        return 2;
      }
      console.error(`${name}: ${message}`);
      return 1;
    });
}

main().then(code => {
  process.exitCode = code;
});
