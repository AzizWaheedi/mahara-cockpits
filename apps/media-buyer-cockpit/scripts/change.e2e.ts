import { runTest } from "./auth";

runTest("Learning period, change log and ask-someone all work", async h => {
  await h.goto("/ads");
  await h.page.waitForTimeout(3500);
  await h.page.locator('button:has-text("Safad")').first().click();
  await h.page.waitForTimeout(1500);
  const learning = await h.page.locator("text=In learning").count();
  const early = await h.page.locator("text=Too early to call").count();
  console.log("learning rows:", learning, "too-early rows:", early);

  await h.page.locator('button:has-text("Liwan")').first().click();
  await h.page.waitForTimeout(1500);
  console.log(
    "doc link:",
    await h.page.locator("text=Diagnosing & Fixing").count(),
  );
  console.log(
    "change box:",
    await h.page.locator("text=What did you change?").count(),
  );
  await h.screenshot("changelog.png");

  await h.goto("/tasks");
  await h.page.waitForTimeout(2500);
  const askBtn = h.page.locator("text=Something missing? Ask someone").first();
  console.log(
    "ask controls:",
    await h.page.locator("text=Something missing? Ask someone").count(),
  );
  await askBtn.click();
  await h.page.waitForTimeout(800);
  const people = await h.page.locator("select option").count();
  console.log("people in picker:", people);
  await h.screenshot("ask.png");

  await h.goto("/eod");
  await h.page.waitForTimeout(2500);
  await h.page.locator("text=Write it for me").click();
  await h.page.waitForTimeout(1200);
  const val = await h.page.locator("textarea").last().inputValue();
  console.log("tomorrow plan:\n" + val);
  await h.screenshot("eod.png");
  if (!val.trim()) throw new Error("plan builder produced nothing");
});
