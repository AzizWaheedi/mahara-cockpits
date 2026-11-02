import logoDark from "../../../../assets/mahara-logo-dark.png?inline";
import logoLight from "../../../../assets/mahara-logo-light.png?inline";
import hero from "../../../../present/offer/art/website/hero.webp?inline";
import core from "./page/core.js?raw";
import css from "./page/offer.css?raw";
import script from "./page/offer.js?raw";
import strings from "./page/strings.js?raw";
import { buildProposalSrcdoc } from "./srcdocSource";

/** Only trusted source bytes enter scripts. Client values arrive by postMessage. */
export function proposalSrcdoc(): string {
  return buildProposalSrcdoc({
    core,
    css,
    strings,
    script,
    hero,
    logoDark,
    logoLight,
  });
}
