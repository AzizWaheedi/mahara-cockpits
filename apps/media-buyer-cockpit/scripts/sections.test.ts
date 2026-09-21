import { runTest } from "./auth";

runTest("Four sections load with real content", async h => {
  for (const [path, must] of [
    ["/dashboard", "First three moves today"],
    ["/ads", "Campaigns · ranked by what needs a decision"],
    ["/tasks", "Your ClickUp tasks"],
    ["/touchpoints", "Proactive touchpoints"],
    ["/eod", "Your EOD report"],
  ] as const) {
    await h.goto(path);
    await h.page.waitForSelector("h1");
    await h.page.waitForTimeout(2500);
    const body = await h.page.textContent("body");
    if (!body?.includes(must)) throw new Error(`${path} missing "${must}"`);
    await h.screenshot(`section${path.replace("/", "-")}.png`);
  }

  // Filters must actually cut the list down.
  await h.goto("/ads");
  await h.page.waitForTimeout(2500);
  const all = await h.page.locator("table tbody tr").count();
  await h.page.getByRole("button", { name: /^Cost per booking over/ }).click();
  await h.page.waitForTimeout(500);
  await h.page.getByRole("button", { name: /^Below KPI/ }).click();
  await h.page.waitForTimeout(600);
  const filtered = await h.page.locator("table tbody tr").count();
  console.log("rows all:", all, "above KPI:", filtered);
  if (filtered >= all) throw new Error("filter did not narrow the list");
  await h.screenshot("section-ads-filtered.png");
});

runTest("Touchpoint messages are editable and language sticks", async h => {
  await h.goto("/touchpoints");
  await h.page.waitForSelector("h1");
  await h.page.waitForTimeout(3000);
  const box = h.page.locator("textarea").first();
  await box.fill("Edited by hand — this must survive.");
  const after = await box.inputValue();
  if (!after.includes("Edited by hand"))
    throw new Error("message is not editable");

  // Flip the first client to English and check the draft is rewritten.
  await h.page.getByRole("button", { name: "English" }).first().click();
  await h.page.waitForTimeout(2500);
  const rewritten = await h.page.locator("textarea").first().inputValue();
  console.log("after language flip:", rewritten.slice(0, 60));
  if (rewritten.includes("Edited by hand"))
    throw new Error("language flip did not redraft");
  await h.screenshot("touch-editable.png");
});

runTest("Every campaign deep-links into Ads Manager", async h => {
  await h.goto("/ads");
  await h.page.waitForSelector("h1");
  await h.page.waitForTimeout(3000);
  const links = h.page.locator('a:has-text("Open in Ads Manager")');
  const n = await links.count();
  const href = await links.first().getAttribute("href");
  console.log("ads manager links:", n, href);
  // Only accounts shared with our Meta partner id (or carrying a Meta Ad Account
  // link on the board) can be deep-linked — today that is 3 of 14.
  // Supabase supplies account + campaign ids for every client account, so this
  // should now cover essentially every row, not just partner-shared accounts.
  if (n < 10)
    throw new Error(`expected deep links on nearly every row, got ${n}`);
  if (!href?.includes("adsmanager.facebook.com"))
    throw new Error(`bad href: ${href}`);
});

runTest(
  "Ad sets and Meta creative previews render inside the cockpit",
  async h => {
    await h.goto("/ads");
    await h.page.waitForSelector("h1");
    await h.page.waitForTimeout(3000);
    // Open the campaign whose account we can actually see in the Meta API.
    const row = h.page.locator('button:has-text("نهوض نجد")').first();
    await row.click();
    await h.page.waitForTimeout(4000);
    const frames = h.page.locator('iframe[src*="preview_iframe"]');
    const n = await frames.count();
    const sets = await h.page.locator("text=Live in Meta").count();
    console.log("preview iframes:", n, "adset blocks:", sets);
    await h.screenshot("meta-embed.png");
    if (sets < 1) throw new Error("no ad set block rendered");
    if (n < 1) throw new Error("no embedded creative preview rendered");
  },
);

runTest(
  "Creative thumbnails and the Meta change log show on a non-partner account",
  async h => {
    await h.goto("/ads");
    await h.page.waitForSelector("h1");
    await h.page.waitForTimeout(3000);
    await h.page.locator('button:has-text("Liwan")').first().click();
    await h.page.waitForTimeout(3000);
    const thumbs = await h.page
      .locator('img[src*="fbcdn"], img[src*="http"]')
      .count();
    const log = await h.page.locator("text=Changed in this account").count();
    console.log("thumbnails:", thumbs, "change log blocks:", log);
    await h.screenshot("supabase-enrichment.png");
    if (thumbs < 1) throw new Error("no creative thumbnails rendered");
    if (log < 1) throw new Error("no change log rendered");
  },
);

runTest(
  "Each account shows a ranked recommendation list, not one verdict",
  async h => {
    await h.goto("/ads");
    await h.page.waitForSelector("h1");
    await h.page.waitForTimeout(3000);
    await h.page.locator('button:has-text("Liwan")').first().click();
    await h.page.waitForTimeout(2500);
    const header =
      (await h.page.locator("text=What needs a decision here").count()) +
      (await h.page.locator("text=Nothing needs touching").count());
    const first = await h.page.locator("text=Fix this first").count();
    const bullets = await h.page.locator("li").count();
    console.log(
      "recommendation blocks:",
      header,
      "fix-first badges:",
      first,
      "bullets:",
      bullets,
    );
    await h.screenshot("recommendations.png");
    if (header < 1 || first < 1) throw new Error("recommendation list missing");
  },
);
