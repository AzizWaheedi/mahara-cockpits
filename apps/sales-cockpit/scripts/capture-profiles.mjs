// The two profile pictures on the deck's channels slide (src/deck/proof.ts
// PROFILES): our YouTube channel and our Instagram profile, in dark mode,
// with every count hidden.
//
// The CEO, 2026-10-10: "for the picture of our Instagram and YouTube, don't
// put the number of subscribers or videos ... Just put a screenshot of our
// Instagram and YouTube just to show the videos and our page. If you can use
// dark mode as well, that would be better." So before the capture this hides
// YouTube's "N subscribers • N videos" row and each video's "▷ views  age"
// line (the titles stay), and Instagram's posts / followers / following row.
//
// Both pages are read signed out, at 2x, with cookies declined: YouTube's
// consent page gets "Reject all", Instagram's banner "Decline optional
// cookies". The sign-in layers Instagram puts over a signed-out page are
// hidden; they are not the page.
//
// The pictures are written as WebP at the deck's sizes, YouTube 1800 wide and
// Instagram 1500 wide (the slide never draws them larger), encoded by Chrome
// itself, so nothing beyond Chrome and playwright-core is needed. It prints
// each picture's size and corner colour: put the sizes in proof.ts's `r` and
// `w`, and the colour in its `bg` when it moved.
//
// From the repo root:
//   node apps/sales-cockpit/scripts/capture-profiles.mjs [outDir]
// outDir defaults to apps/sales-cockpit/src/deck/assets/proof. playwright-core
// is the one installed for the media buyer cockpit's harness.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = new URL(".", import.meta.url);
const { chromium } = await import(
  new URL(
    "../../media-buyer-cockpit/node_modules/playwright-core/index.mjs",
    here,
  ).href
);
const OUT =
  process.argv[2] ??
  fileURLToPath(new URL("../src/deck/assets/proof/", here));
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CHANNEL = "https://www.youtube.com/@MaharaMedia/videos";
const PROFILE = "https://www.instagram.com/mahara_media/";

const browser = await chromium.launch({
  executablePath: CHROME,
  headless: true,
});

/** A PNG screenshot as a WebP `width` pixels wide, its size and its top-left colour. */
async function toWebp(png, width, path) {
  const page = await browser.newPage();
  const out = await page.evaluate(
    async ({ b64, width }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const height = Math.round((img.naturalHeight * width) / img.naturalWidth);
      const c = document.createElement("canvas");
      c.width = width;
      c.height = height;
      const g = c.getContext("2d");
      g.imageSmoothingEnabled = true;
      g.imageSmoothingQuality = "high";
      g.drawImage(img, 0, 0, width, height);
      const [r, gr, b] = g.getImageData(4, 4, 1, 1).data;
      const hex = `#${[r, gr, b].map(v => v.toString(16).padStart(2, "0")).join("")}`;
      return {
        data: c.toDataURL("image/webp", 0.84).split(",")[1],
        height,
        corner: hex,
      };
    },
    { b64: png.toString("base64"), width },
  );
  await page.close();
  const bytes = Buffer.from(out.data, "base64");
  writeFileSync(path, bytes);
  console.log(
    `${path}: ${width}x${out.height}, ${Math.round(bytes.length / 1024)} KB, corner ${out.corner}`,
  );
}

async function youtube() {
  const ctx = await browser.newContext({
    viewport: { width: 1180, height: 1400 },
    deviceScaleFactor: 2,
    colorScheme: "dark",
    locale: "en-US",
  });
  const page = await ctx.newPage();
  await page.goto(CHANNEL, { waitUntil: "domcontentloaded" });
  if (page.url().includes("consent.youtube.com")) {
    await page
      .getByRole("button", { name: /reject all/i })
      .first()
      .click();
    // The consent page sends the browser back on its own; wait for it, and
    // go there directly if it stalls.
    for (let i = 0; i < 40 && !page.url().includes("www.youtube.com/@"); i++)
      await page.waitForTimeout(500);
    if (!page.url().includes("www.youtube.com/@"))
      await page.goto(CHANNEL, { waitUntil: "domcontentloaded" });
  }
  // Signed out, YouTube ignores the system theme: the PREF cookie's f6=400 is "Dark theme".
  const pref = (await ctx.cookies("https://www.youtube.com")).find(
    c => c.name === "PREF",
  );
  const value = pref
    ? pref.value.includes("f6=")
      ? pref.value.replace(/f6=[0-9a-f]+/, "f6=400")
      : `${pref.value}&f6=400`
    : "f6=400";
  await ctx.addCookies([
    {
      name: "PREF",
      value,
      domain: ".youtube.com",
      path: "/",
      secure: true,
      sameSite: "Lax",
      expires: Math.floor(Date.now() / 1000) + 86400 * 30,
    },
  ]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("ytd-rich-grid-media, yt-lockup-view-model", {
    timeout: 30000,
  });
  await page.waitForTimeout(3000);
  const dark = await page.evaluate(() =>
    document.documentElement.hasAttribute("dark"),
  );
  if (!dark) throw new Error("YouTube is not in dark theme");
  // Each video's views-and-age line, under its title (both lockup shapes).
  await page.addStyleTag({
    content: `
      ytd-rich-item-renderer .ytLockupMetadataViewModelMetadata,
      ytd-rich-item-renderer #metadata-line { display: none !important; }
    `,
  });
  // The header's counts: "N subscribers • N videos" is a row of its own under
  // the handle, joined to it by a dot.
  const rows = await page.evaluate(() => {
    let n = 0;
    for (const row of document.querySelectorAll(
      "yt-page-header-view-model .ytContentMetadataViewModelMetadataRow, yt-page-header-view-model [class*='MetadataRow']",
    )) {
      const text = row.textContent ?? "";
      if (!/subscriber|videos?\b/i.test(text) || /@/.test(text)) continue;
      row.style.display = "none";
      n++;
      for (const sib of [row.previousElementSibling, row.nextElementSibling])
        if (sib && /^\s*[•·]\s*$/.test(sib.textContent ?? ""))
          sib.style.display = "none";
      const prev = row.previousElementSibling;
      if (prev)
        for (const d of prev.querySelectorAll("[class*='Delimiter']"))
          if (d === prev.lastElementChild || !d.nextElementSibling)
            d.style.display = "none";
    }
    return n;
  });
  if (rows < 1) throw new Error("YouTube: the subscribers row was not found");
  // Thumbnails are lazy: scroll through, then back.
  await page.evaluate(async () => {
    for (let y = 0; y < 2000; y += 300) {
      window.scrollTo(0, y);
      await new Promise(r => setTimeout(r, 250));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(2500);
  const left = await page.evaluate(() => {
    const counts = [
      ...document.querySelectorAll(
        "yt-page-header-view-model, ytd-rich-item-renderer",
      ),
    ].filter(
      e =>
        e.getBoundingClientRect().height > 0 &&
        /subscribers?\b|\bviews?\b|\d+\s*(mo|yr|wk|d)\s+ago/i.test(
          e.innerText ?? "",
        ),
    );
    return counts.length;
  });
  if (left) throw new Error(`YouTube: ${left} blocks still show a count`);
  const box = await page.evaluate(() => {
    const items = [...document.querySelectorAll("ytd-rich-item-renderer")].filter(
      e => e.getBoundingClientRect().height > 0,
    );
    const header = document.querySelector(
      "yt-page-header-renderer, #page-header, ytd-tabbed-page-header",
    );
    const h = header.getBoundingClientRect();
    const first = items[0].getBoundingClientRect();
    const sixth = (items[5] ?? items[items.length - 1]).getBoundingClientRect();
    const guide = document.querySelector("ytd-mini-guide-renderer");
    const guideRight =
      guide && guide.getBoundingClientRect().width > 0
        ? guide.getBoundingClientRect().right
        : 0;
    const inner = Math.min(h.left, first.left);
    const left = Math.max(guideRight + 1, inner - 16);
    const right = Math.min(
      innerWidth,
      Math.max(h.right, sixth.right) + (inner - left),
    );
    return {
      x: Math.max(0, Math.floor(left)),
      width: Math.ceil(right - left),
      y: Math.max(0, Math.floor(h.top + window.scrollY - 8)),
      bottom: Math.ceil(sixth.bottom + window.scrollY),
      videos: items.length,
    };
  });
  console.log("youtube", box);
  const png = await page.screenshot({
    clip: {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.bottom - box.y + 16,
    },
    fullPage: true,
  });
  await ctx.close();
  await toWebp(png, 1800, `${OUT}profile-youtube.webp`);
}

async function instagram() {
  const ctx = await browser.newContext({
    viewport: { width: 1000, height: 1400 },
    deviceScaleFactor: 2,
    colorScheme: "dark",
    locale: "en-US",
  });
  const page = await ctx.newPage();
  await page.goto(PROFILE, { waitUntil: "domcontentloaded" });
  const decline = page.getByRole("button", {
    name: /decline optional cookies/i,
  });
  try {
    await decline.first().click({ timeout: 15000 });
  } catch {
    console.log("instagram: no cookie banner");
  }
  await page.waitForTimeout(2500);
  const dark = await page.evaluate(() =>
    document.documentElement.classList.contains("__fb-dark-mode"),
  );
  if (!dark) throw new Error("Instagram is not in dark mode");
  await page.waitForSelector("main header", { timeout: 30000 });
  // Signed out: the top bar and any sign-up prompts are not the page.
  await page.addStyleTag({
    content: `
      section > nav, nav[role="navigation"], div[role="dialog"],
      div[role="presentation"] > div[style*="fixed"] { display: none !important; }
    `,
  });
  await page.evaluate(async () => {
    for (let y = 0; y < 1600; y += 300) {
      window.scrollTo(0, y);
      await new Promise(r => setTimeout(r, 250));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(2500);
  // Close any login layer that scrolling opened, and its dimmed backdrop.
  await page.keyboard.press("Escape").catch(() => {});
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("body *")) {
      if (getComputedStyle(el).position !== "fixed") continue;
      if (el.querySelector("main") || el.closest("main")) continue;
      const r = el.getBoundingClientRect();
      if (
        r.width * r.height > 0.4 * innerWidth * innerHeight ||
        /log in|sign up/i.test(el.textContent ?? "")
      )
        el.style.setProperty("display", "none", "important");
    }
    document.documentElement.style.overflow = "auto";
    document.body.style.overflow = "auto";
  });
  // The counts: the smallest block in the header that holds both "followers"
  // and "following" (the posts count sits in it too).
  const rows = await page.evaluate(() => {
    const header = document.querySelector("main header");
    let n = 0;
    for (const el of header.querySelectorAll("ul, div, section")) {
      const t = (el.textContent ?? "").trim();
      if (
        !/followers/i.test(t) ||
        !/following/i.test(t) ||
        t.length >= 80 ||
        el.querySelector("img")
      )
        continue;
      const inner = [...el.children].some(
        c => /followers/i.test(c.textContent) && /following/i.test(c.textContent),
      );
      if (!inner) {
        el.style.setProperty("display", "none", "important");
        n++;
      }
    }
    return n;
  });
  if (rows < 1) throw new Error("Instagram: the followers row was not found");
  await page.waitForTimeout(400);
  const left = await page.evaluate(
    () =>
      /\bfollowers\b|\bfollowing\b|\bposts\b/i.test(
        document.querySelector("main header")?.innerText ?? "",
      ),
  );
  if (left) throw new Error("Instagram: the header still shows a count");
  const box = await page.evaluate(() => {
    const header = document.querySelector("main header");
    const main = header.closest("main");
    const r = header.parentElement.getBoundingClientRect();
    const posts = [
      ...main.querySelectorAll("a[href*='/p/'], a[href*='/reel/']"),
    ].filter(a => a.getBoundingClientRect().height > 50);
    const sixth = posts[5] ?? posts[posts.length - 1];
    const h = header.getBoundingClientRect();
    return {
      x: Math.floor(r.left),
      width: Math.ceil(r.width),
      y: Math.max(0, Math.floor(h.top + window.scrollY - 24)),
      bottom: Math.ceil(sixth.getBoundingClientRect().bottom + window.scrollY),
      posts: posts.length,
    };
  });
  console.log("instagram", box);
  const png = await page.screenshot({
    clip: {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.bottom - box.y,
    },
    fullPage: true,
  });
  await ctx.close();
  await toWebp(png, 1500, `${OUT}profile-instagram.webp`);
}

let failed = false;
for (const [name, run] of [
  ["youtube", youtube],
  ["instagram", instagram],
]) {
  try {
    await run();
  } catch (e) {
    failed = true;
    console.log(`${name} failed: ${e.message}`);
  }
}
await browser.close();
process.exit(failed ? 1 : 0);
