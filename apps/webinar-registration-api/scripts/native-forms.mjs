import { readFileSync } from "node:fs";
import { createStore } from "../lib/store.js";
import { createPipelineProvider } from "../lib/pipeline.js";
import { ingestNativeForms } from "../lib/native-forms.js";
import { trackedBridgeRun } from "../lib/bridge-run.js";
import { schedule } from "../lib/schedule.js";
try {
  const apply = process.argv.includes("--apply");
  if (apply && process.env.WEBINAR_INTAKE_ENABLED !== "true")
    throw Error("native_intake_held");
  const { bindings } = JSON.parse(
    readFileSync(
      new URL("../../../config/webinar/ghl-form-windows.json", import.meta.url),
      "utf8",
    ),
  );
  const store = createStore();
  const work = () =>
    ingestNativeForms({
      provider: createPipelineProvider(),
      store,
      bindings,
      current: schedule,
      apply,
    });
  const result = await (apply
    ? trackedBridgeRun(store, "native_forms", work)
    : work());
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(
    JSON.stringify({
      status: "error",
      code: error.code || "native_form_ingestion_failed",
    }),
  );
  process.exitCode = 1;
}
