/**
 * Smoke check for the Memory Core.
 *
 *   CONVEX_URL=https://<deployment>.convex.cloud \
 *   MEMORY_CORE_ACCESS_CODE=<code> \
 *   bun run smoke
 *
 * It walks the same path a person does — open the door, save a memory, search
 * for it, ask a question about it — and prints what the backend actually
 * returned. It fails loudly on the first step that does not work, because a
 * quiet failure here is a broken screen later.
 */
import { ConvexHttpClient } from "convex/browser";

const url = process.env.CONVEX_URL ?? process.env.VITE_CONVEX_URL;
const code = process.env.MEMORY_CORE_ACCESS_CODE;

if (!url) {
  console.error(
    "Set CONVEX_URL (or VITE_CONVEX_URL) to the deployment this should check.",
  );
  process.exit(2);
}
if (!code) {
  console.error("Set MEMORY_CORE_ACCESS_CODE to the code the deployment uses.");
  process.exit(2);
}

const client = new ConvexHttpClient(url);

function line(label: string, ok: boolean, detail: string) {
  const mark = ok ? "ok  " : "FAIL";
  console.log(`${mark} ${label}${detail ? ` — ${detail}` : ""}`);
}

async function main() {
  let failures = 0;

  // 1. The door.
  const access = (await client.query(
    "memory:checkAccess" as never,
    {
      code,
    } as never,
  )) as { ok: boolean; message: string };
  line("the access code opens the door", access.ok, access.message);
  if (!access.ok) process.exit(1);

  // 2. A memory, saved and read back.
  const stamp = `smoke check ${new Date().toISOString()}`;
  await client.mutation(
    "memory:saveMemory" as never,
    {
      code,
      text: `Favourite colour is green. (${stamp})`,
      tags: ["smoke"],
    } as never,
  );
  const memories = (await client.query(
    "memory:memories" as never,
    {
      code,
      limit: 5,
    } as never,
  )) as { title: string }[];
  const saved = memories.some(row => row.title.includes("Favourite colour"));
  line(
    "saving a memory and reading it back",
    saved,
    `${memories.length} recent memories`,
  );
  if (!saved) failures++;

  // 3. Search, live and from the index.
  const indexOnly = (await client.action(
    "search:search" as never,
    {
      code,
      query: "favourite colour",
      live: false,
    } as never,
  )) as { results: { source: string; title: string }[] };
  line(
    "the index finds the saved memory",
    indexOnly.results.length > 0,
    `${indexOnly.results.length} hit(s), first: ${indexOnly.results[0]?.title ?? "none"}`,
  );
  if (!indexOnly.results.length) failures++;

  // 4. A grounded answer.
  const answer = (await client.action(
    "chat:ask" as never,
    {
      code,
      question: "What is the favourite colour?",
      live: false,
    } as never,
  )) as {
    grounded: boolean;
    answer: string;
    citations: { n: number; source: string }[];
    model: string;
  };
  line(
    "an answer comes back grounded and cited",
    answer.grounded && answer.citations.length > 0,
    `${answer.model} cited ${answer.citations.length} item(s)`,
  );
  console.log(`     answer: ${answer.answer.slice(0, 200)}`);
  if (!answer.grounded || !answer.citations.length) failures++;

  // 5. The overview the Sources screen reads.
  const overview = (await client.query(
    "memory:overview" as never,
    {
      code,
    } as never,
  )) as {
    sources: { key: string; itemCount: number }[];
    answerModel: string;
    trouble: string[];
  };
  line(
    "the overview reports every source",
    overview.sources.length === 4,
    overview.sources
      .map(source => `${source.key}:${source.itemCount}`)
      .join(" "),
  );
  line(
    "an answer model is connected",
    overview.answerModel !== "no model connected",
    overview.answerModel,
  );
  if (overview.answerModel === "no model connected") failures++;
  if (overview.trouble.length) {
    for (const sentence of overview.trouble) {
      console.log(`     needs attention: ${sentence}`);
    }
  }

  console.log(failures ? `${failures} check(s) failed` : "all checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch(error => {
  console.error(
    `smoke check threw: ${error instanceof Error ? error.message : error}`,
  );
  process.exit(1);
});
