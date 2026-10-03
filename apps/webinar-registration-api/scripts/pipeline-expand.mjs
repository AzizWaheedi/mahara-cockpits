import { readFile } from "node:fs/promises";
import { createPipelineProvider, expandPipeline } from "../lib/pipeline.js";
try {
  if (process.argv.slice(2).some((x) => x !== "--apply"))
    throw new Error("unknown_argument");
  const previous = JSON.parse(
    await readFile(
      new URL("../../../config/webinar/pipeline.json", import.meta.url),
      "utf8",
    ),
  );
  const result = await expandPipeline(createPipelineProvider(), previous, {
    apply: process.argv.includes("--apply"),
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(
    JSON.stringify({
      ok: false,
      code: error.code || "pipeline_expansion_failed",
    }),
  );
  process.exitCode = 1;
}
