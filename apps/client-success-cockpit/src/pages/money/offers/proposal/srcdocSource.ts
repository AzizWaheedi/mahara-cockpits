export type OfferPageSources = {
  core: string;
  css: string;
  strings: string;
  script: string;
  hero?: string;
  logoDark?: string;
  logoLight?: string;
};

/** Source code is trusted. Proposal values only enter through the isolated frame's message listener. */
export function buildProposalSrcdoc({
  core,
  css,
  strings,
  script,
  hero,
  logoDark,
  logoLight,
}: OfferPageSources): string {
  const moduleUrl = (source: string) =>
    `data:text/javascript;base64,${btoa(unescape(encodeURIComponent(source)))}`;
  const linked = script
    .replace(/(["'])\.\/core\.js\1/g, JSON.stringify(moduleUrl(core)))
    .replace(/(["'])\.\/strings\.js\1/g, JSON.stringify(moduleUrl(strings)));
  const art =
    hero &&
    hero.length <= 400000 &&
    /^data:image\/webp;base64,[A-Za-z0-9+/=]+$/.test(hero)
      ? hero
      : null;
  const logo = (value?: string) =>
    value &&
    value.length <= 300000 &&
    /^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/=]*$/.test(value)
      ? value
      : null;
  const brand = { dark: logo(logoDark), light: logo(logoLight) };
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src https: data:; frame-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap"><style>${css.replace(/<\/style/gi, "<\\/style")}</style></head><body><main id="app"></main><script>window.__OFFER_PREVIEW__=true;window.__OFFER_ART__=${JSON.stringify(art)};window.__OFFER_BRAND__=${JSON.stringify(brand)};</script><script type="module">${linked.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
}
