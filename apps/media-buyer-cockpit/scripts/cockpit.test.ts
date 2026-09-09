import { runTest } from "./auth";

runTest("Media buyer cockpit", async h => {
  await h.goto("/dashboard");
  await h.page.waitForSelector("h1");
  await h.page.waitForTimeout(3000);
  const title = await h.page.textContent("h1");
  if (!title?.includes("Media Buyer Cockpit"))
    throw new Error(`bad title: ${title}`);
  const rows = await h.page.locator("table tbody tr").count();
  console.log("campaign rows:", rows);
  if (rows < 5) throw new Error(`expected campaign rows, got ${rows}`);
  await h.screenshot("cockpit-top.png");
  await h.page.locator("table tbody tr button").first().click();
  await h.page.waitForTimeout(800);
  await h.screenshot("cockpit-expanded.png");
});

runTest("Decision writes back to ClickUp", async h => {
  await h.goto("/dashboard");
  await h.page.waitForSelector("h1");
  await h.page.waitForTimeout(3000);

  // ARCWANI is under its contracted budget with a healthy CPL, so its row offers a raise.
  const row = h.page.locator("table tbody tr", { hasText: "ARCWANI" }).first();
  const raise = row.getByRole("button", { name: /Raise to/ });
  if (await raise.count()) {
    await raise.click();
    await h.page.waitForTimeout(8000);
  }

  const log = h.page
    .locator("text=/Logged on the ClickUp task|Not logged to ClickUp/")
    .first();
  const text = await log.textContent();
  console.log("writeback:", text);
  await h.screenshot("cockpit-writeback.png");
  if (!text?.includes("Logged on the ClickUp task")) {
    throw new Error(`writeback failed: ${text}`);
  }
});

runTest("Request routes to another team's board", async h => {
  await h.goto("/dashboard");
  await h.page.waitForSelector("h1");
  await h.page.waitForTimeout(3000);

  // حول العمران is flagged fatiguing, so a replacement creative is a real request.
  const row = h.page.locator("table tbody tr", { hasText: "العمران" }).first();
  const more = row.getByRole("button", { name: "⋯" });
  if (await more.count()) {
    await more.click();
    await h.page.waitForTimeout(600);
    await h.page
      .getByRole("button", { name: "Replacement creative — fatigue" })
      .click();
    await h.page
      .getByRole("button", { name: /Send to Creative director/ })
      .click();
    await h.page.waitForTimeout(8000);
  }
  await h.screenshot("cockpit-request.png");
  const text = await h.page
    .locator("text=/Logged on the ClickUp task|Not logged to ClickUp/")
    .first()
    .textContent();
  console.log("request:", text);
  if (!text?.includes("Logged on the ClickUp task"))
    throw new Error(`request failed: ${text}`);
});
