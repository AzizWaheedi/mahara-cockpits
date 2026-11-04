/* Pure public proposal renderer. Strings and proposal text are always escaped. */
const PICTURE_HOSTS = new Set(["bldgtotkfmhoxmlzowdx.supabase.co", "cdn.loom.com", "embed-ssl.wistia.com", "i.vimeocdn.com", "i.ytimg.com"]);
const PLAYERS = {
  "www.youtube-nocookie.com": /^\/embed\/[A-Za-z0-9_-]+$/,
  "www.loom.com": /^\/embed\/[A-Za-z0-9_-]+$/,
  "fast.wistia.net": /^\/embed\/iframe\/[A-Za-z0-9_-]+$/,
  "player.vimeo.com": /^\/video\/\d+$/,
  "drive.google.com": /^\/file\/d\/[A-Za-z0-9_-]+\/preview$/,
};
export const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
export const fill = (text, slots) => String(text ?? "").replace(/\{(\w+)\}/g, (_, key) => String(slots[key] ?? ""));
export function httpsUrl(raw) {
  if (typeof raw !== "string" || raw.length > 4096) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && !u.username && !u.password && !u.port ? u : null;
  } catch { return null; }
}
export function pictureUrl(raw) {
  const u = httpsUrl(raw);
  return u && PICTURE_HOSTS.has(u.hostname) ? u.href : null;
}
export function embedUrl(raw) {
  const u = httpsUrl(raw);
  return u && Object.hasOwn(PLAYERS,u.hostname) && PLAYERS[u.hostname].test(u.pathname) ? u.href : null;
}
export function whatsappUrl(raw) {
  const u = httpsUrl(raw);
  return u?.hostname === "wa.me" && /^\/[0-9]{8,15}$/.test(u.pathname) ? u.href : null;
}
export function codeFromPath(path) {
  try {
    const code = decodeURIComponent(String(path).replace(/^\//, "").replace(/\/$/, "")).toLowerCase();
    return /^[a-hj-km-np-z2-9]{12}$/.test(code) ? code : null;
  } catch { return null; }
}
export function stateFromQuery(search) {
  const q = new URLSearchParams(search);
  return q.get("gone") === "1" ? "videoGone" : q.get("busy") === "1" ? "busy" : q.get("error") === "1" ? "error" : null;
}
export function money(amount, lang) {
  return typeof amount === "number" && Number.isFinite(amount) && amount >= 0
    ? new Intl.NumberFormat(lang === "ar" ? "ar-KW" : "en-US", {maximumFractionDigits:2}).format(amount) : "";
}
export function dateLabel(date, lang) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) return "";
  const d = new Date(`${date}T12:00:00Z`);
  return Number.isNaN(d.valueOf()) ? "" : new Intl.DateTimeFormat(lang === "ar" ? "ar-KW" : "en-GB", {day:"numeric",month:"short",year:"numeric",timeZone:"UTC"}).format(d);
}
const list = (x, limit=20) => Array.isArray(x) ? x.slice(0,limit) : [];
const text = x => typeof x === "string" ? x : "";
const esc = escapeHtml;
const assetBase = value => typeof value === "string" && /^\/(?!\/)[A-Za-z0-9/_-]*$/.test(value) ? value.replace(/\/$/, "") : "";
const inlineLogo = value => typeof value === "string" && value.length <= 300000 && /^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/=]*$/.test(value) ? value : null;
function brand(opts={}) {
  const base=assetBase(opts.assetBase);
  const dark=inlineLogo(opts.brand?.dark) || (opts.preview ? null : `${base}/logo.png`);
  const light=inlineLogo(opts.brand?.light) || (opts.preview ? null : `${base}/logo-light.png`);
  return `<span class="of-brand" role="img" aria-label="Mahara Media">${dark ? `<img class="of-brand-dark" src="${esc(dark)}" alt="" width="182" height="40" decoding="async">` : ""}${light ? `<img class="of-brand-light" src="${esc(light)}" alt="" width="182" height="40" decoding="async">` : ""}</span>`;
}
// Provider-verified full-size stills, not Wistia's tiny blurred swatches.
const WORK_POSTERS = {
  qlwysqfu2g: "ee0de9394a4d688f85de81165e1ceb13870c55d2",
  btp2dokvjr: "33e27b2faa619214d4961f7d833a94f98e7a3cdf",
  nix1oq0h3a: "8ecea92509dfb94e6272f3b447f0d3a47aa401b4",
};
/** Frozen work links only become players for exact approved Wistia URL shapes. */
export function workVideo(raw) {
  const u=httpsUrl(raw);
  if(!u || u.search || u.hash) return null;
  const match=u.hostname==="maharamedia.wistia.com" ? u.pathname.match(/^\/medias\/([a-z0-9]{10})\/?$/)
    : u.hostname==="fast.wistia.net" ? u.pathname.match(/^\/embed\/iframe\/([a-z0-9]{10})$/) : null;
  if(!match) return null;
  return {id:match[1],embedUrl:`https://fast.wistia.net/embed/iframe/${match[1]}`,posterUrl:Object.hasOwn(WORK_POSTERS,match[1]) ? `https://embed-ssl.wistia.com/deliveries/${WORK_POSTERS[match[1]]}.jpg` : null};
}
function section(id, title, body, className="") {
  return body ? `<section class="of-section ${className}" aria-labelledby="${id}"><h2 id="${id}">${esc(title)}</h2><div class="of-section-body">${body}</div></section>` : "";
}
export function stateView(state, strings, contact) {
  const known = ["loading","expired","archived","unknown","busy","error","videoGone"];
  const key = known.includes(state) ? state : "error";
  const digits = contact?.whatsapp;
  const href = typeof digits === "string" && /^[0-9]{8,15}$/.test(digits) ? `https://wa.me/${digits}` : null;
  return `<div class="of-state"><header>${brand()}</header><section role="status" aria-live="polite"><span class="of-state-line" aria-hidden="true"></span><h1>${esc(strings.states[key])}</h1>${href ? `<a class="of-button" href="${href}" rel="noopener noreferrer">${esc(strings.messageUs)}</a>` : ""}</section></div>`;
}
export function render(proposal, strings, opts={}) {
  if (!proposal || !["en","ar"].includes(proposal.lang)) return stateView("error", strings, null);
  const p = proposal, lang=p.lang, preview=opts.preview === true;
  const logo = pictureUrl(p.logo?.url);
  const player = embedUrl(p.video?.embedUrl);
  const poster = pictureUrl(p.video?.posterUrl);
  const assets = assetBase(opts.assetBase);
  const inlineArt = preview && typeof opts.posterFallback === "string" && opts.posterFallback.length <= 400000 && /^data:image\/webp;base64,UklGR[A-Za-z0-9+/]+=*$/.test(opts.posterFallback) ? opts.posterFallback : null;
  const art = !poster && p.offer === "website" ? (preview ? inlineArt : `${assets}/art/website/hero.webp`) : null;
  const cta = whatsappUrl(p.button?.whatsapp);
  const due = dateLabel(p.validUntil,lang);
  const found = list(p.found,3).map((f)=>{
    const url=pictureUrl(f?.url);
    if(!url) return "";
    const captured=dateLabel(f.capturedOn,lang);
    return `<figure><img crossorigin="anonymous" referrerpolicy="no-referrer" src="${esc(url)}" alt="${esc(f.caption)}" loading="lazy" decoding="async"><figcaption><span>${esc(f.caption)}</span><small>${esc(fill(strings.captured,{date:captured}))}${f.searchedAs ? ` · ${esc(fill(strings.searchedAs,{city:f.searchedAs}))}` : ""}</small></figcaption></figure>`;
  }).join("");
  const get = list(p.get).filter(v=>typeof v==="string" && v.trim()).map(v=>`<li>${esc(v)}</li>`).join("");
  const work = list(p.work,6).map((w,index)=>{
    const url=httpsUrl(w?.url);
    if (!url) return "";
    const example=workVideo(w.url);
    if(example) return `<li class="of-work-film"><figure><div class="of-work-player" data-work-video>${example.posterUrl ? `<img src="${esc(example.posterUrl)}" alt="" referrerpolicy="no-referrer" loading="lazy" decoding="async" width="360" height="640">` : ""}<button class="of-work-play" type="button" data-action="play-work" data-work-index="${index}" ${preview ? "disabled" : ""} aria-label="${esc(strings.play)}: ${esc(w.label)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7z"/></svg><span>${esc(strings.play)}</span></button></div><figcaption>${preview ? `<span>${esc(w.label)}</span>` : `<a href="${esc(url.href)}" target="_blank" rel="noopener noreferrer">${esc(w.label)}<span aria-hidden="true"> ↗</span></a>`}</figcaption></figure></li>`;
    return `<li>${preview ? `<span>${esc(w.label)}</span>` : `<a href="${esc(url.href)}" target="_blank" rel="noopener noreferrer">${esc(w.label)}<span aria-hidden="true"> ↗</span></a>`}</li>`;
  }).join("");
  const cadence = {once:strings.oneTime,one_time:strings.oneTime,monthly:strings.monthly,day:strings.perDay,per_day:strings.perDay,per_90_days:strings.per90,per90:strings.per90};
  const prices = list(p.investment?.parts).map(part=>{
    const amount=money(part?.amountUsd,lang);
    if (!amount) return "";
    return `<tr><th scope="row">${esc(part.label)}<small>${esc(cadence[part.cadence] || "")}</small></th><td><bdi>${esc(amount)}</bdi> <span>${esc(strings.dollars)}</span></td></tr>`;
  }).join("");
  const split = Array.isArray(p.investment?.split) && p.investment.split.length===2 && p.investment.split.every(n=>typeof n==="number" && n>0 && Number.isFinite(n))
    ? `<p class="of-split">${esc(strings.split)}: <bdi>${esc(p.investment.split.map(n=>money(n,lang)).join(" + "))}</bdi> ${esc(strings.dollars)}</p>` : "";
  const print = httpsUrl(opts.proposalUrl);
  const video = player ? `<div class="of-video" data-video>${poster || art ? `<img crossorigin="anonymous" referrerpolicy="no-referrer" src="${esc(poster || art)}" alt="" fetchpriority="high" decoding="async" width="1920" height="1080">` : '<div class="of-video-empty" aria-hidden="true"></div>'}${art ? `<span class="of-example">${esc(strings.example)}</span>` : ""}<button class="of-play" type="button" data-action="play" ${preview ? "disabled" : ""} aria-label="${esc(strings.play)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5 11 7-11 7z"/></svg><span>${esc(strings.play)}</span></button></div><p class="of-video-note">${esc(strings.playNote)}</p>` : "";
  return `<article class="of-proposal" lang="${lang}" dir="${lang==="ar"?"rtl":"ltr"}">
    <header class="of-masthead">${brand(opts)}${due ? `<p>${esc(fill(strings.validUntil,{date:due}))}</p>` : ""}</header>
    <div class="of-heading">${logo ? `<img class="of-client-logo" crossorigin="anonymous" referrerpolicy="no-referrer" src="${esc(logo)}" alt="${esc(p.logo.alt || p.clientName)}" width="160" height="80">` : ""}<p class="of-kicker">${esc(fill(strings.proposalFor,{name:p.clientName}))}</p><h1>${esc(p.title)}</h1>${p.csmFirstName ? `<p class="of-prepared">${esc(fill(strings.preparedBy,{name:p.csmFirstName}))}</p>` : ""}</div>
    ${video}
    ${section("of-found",strings.found,found ? `<div class="of-captures">${found}</div>` : "","of-found")}
    ${section("of-why",strings.why,text(p.why) ? `<p class="of-statement">${esc(p.why)}</p>` : "")}
    ${section("of-get",strings.get,get ? `<ol class="of-deliverables" role="list">${get}</ol>${list(p.platforms,4).length ? `<p class="of-platforms" dir="ltr">${list(p.platforms,4).map(esc).join(" · ")}</p>` : ""}` : "")}
    ${section("of-work",strings.work,work ? `<ul class="of-work-list${list(p.work,6).some(w=>workVideo(w?.url)) ? " of-work-gallery" : ""}" role="list">${work}</ul>` : "")}
    ${section("of-runs",strings.runs,`${text(p.steps) ? `<p class="of-lines">${esc(p.steps)}</p>` : ""}${text(p.timing) ? `<p class="of-timing">${esc(p.timing)}</p>` : ""}`)}
    ${section("of-investment",strings.investment,prices ? `<table class="of-bill"><tbody>${prices}</tbody></table>${text(p.investment.terms) ? `<p class="of-terms">${esc(p.investment.terms)}</p>` : ""}${split}` : "","of-investment")}
    <footer class="of-footer"><div>${cta ? `${preview ? `<button type="button" class="of-button" disabled>${esc(p.button.text)}</button>` : `<a class="of-button" data-action="cta" href="${esc(cta)}" rel="noopener noreferrer">${esc(p.button.text)}</a>`}<p>${esc(strings.messageUs)}</p>` : ""}</div>${brand(opts)}</footer>
    ${print ? `<p class="of-print-link">${esc(fill(strings.printLink,{url:print.href}))}</p>` : ""}
  </article>`;
}
