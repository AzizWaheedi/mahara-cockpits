/**
 * Every word the website film puts on screen or in the voice, through the
 * client copy check (cockpit_client_copy_problems from 20261026u), on the
 * PGlite harness. Reads the JSON lists the film builder writes (copy.json in
 * each cut's project) and prints {ok, checked, problems}; exits 1 on any
 * blocking rule.
 *
 *   cd apps/media-buyer-cockpit && bun ../../tools/offer-video/scripts/copy-check.ts <copy.json> [...]
 */
import { readFileSync } from "node:fs";
import { SEATS, upsellHelpers, upsellTestDb } from "../../../apps/media-buyer-cockpit/scripts/lib/upsellTestDb";

type Item = { lang: string; where: string; text: string };
const items: Item[] = process.argv.slice(2).flatMap(f => JSON.parse(readFileSync(f, "utf8")) as Item[]);
const seen = new Set<string>();
const unique = items.filter(i => (seen.has(i.text) ? false : (seen.add(i.text), true)));

const db = await upsellTestDb({ through: "u" });
const h = upsellHelpers(db);
const problems: Array<Item & { rule: string; match: string; block: boolean }> = [];
for (const item of unique) {
  const found = (await h.one(SEATS.CSM_A, "SELECT public.cockpit_client_copy_problems($1,false) r", [item.text])) as Array<{
    rule: string;
    match: string;
    block: boolean;
  }>;
  for (const p of found) problems.push({ ...item, rule: p.rule, match: p.match, block: p.block });
}
const blocking = problems.filter(p => p.block);
console.log(JSON.stringify({ ok: blocking.length === 0, checked: unique.length, problems }, null, 1));
await db.close();
process.exit(blocking.length === 0 ? 0 : 1);
