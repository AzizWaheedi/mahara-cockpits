import { mkdir, writeFile } from "node:fs/promises";
import { iconSprite } from "../../apps/client-success-cockpit/src/present/offer/art/icons";
import { SITE_ART, SPRITE } from "./paths";
await mkdir(SITE_ART, {recursive:true});
await writeFile(SPRITE, `${iconSprite()}\n`);
console.log("Wrote the shared OfferIcon sprite.");
