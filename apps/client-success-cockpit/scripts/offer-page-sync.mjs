/** Keep the standalone cockpit deployment byte-identical to the canonical public page. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const app = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(app, "../../sites/offer");
const target = resolve(app, "src/pages/money/offers/proposal/page");
const check = process.argv.includes("--check");
let bad = false;
for (const name of ["core.js", "offer.css", "strings.js", "offer.js"]) {
  const canonical = readFileSync(resolve(source, name));
  if (check) {
    let same = false;
    try { same = canonical.equals(readFileSync(resolve(target, name))); } catch { /* Missing is drift. */ }
    if (!same) { console.error(`Offer page copy differs: ${name}. Run node scripts/offer-page-sync.mjs from the CSM app.`); bad = true; }
  } else { mkdirSync(target, { recursive: true }); writeFileSync(resolve(target, name), canonical); }
}
if (bad) process.exit(1);
