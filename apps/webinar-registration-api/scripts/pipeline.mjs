import { createPipelineProvider, provisionPipeline } from "../lib/pipeline.js";
try {
  if (process.argv.slice(2).some((x) => x !== "--apply"))
    throw new Error("unknown_argument");
  const result = await provisionPipeline(createPipelineProvider(), {
    apply: process.argv.includes("--apply"),
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(
    JSON.stringify({
      ok: false,
      code: error.code || "pipeline_command_failed",
    }),
  );
  process.exitCode = 1;
}
