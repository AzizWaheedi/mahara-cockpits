import { runTest } from "./auth";

runTest("Build a campaign panel and winners library", async (h) => {
  await h.goto("/ads");
  await h.page.waitForTimeout(4000);
  // open the first campaign
  const body = await h.page.locator("body").innerText();
  console.log("ads loaded:", body.length > 500 ? "yes" : "no");
  const btn = h.page.locator('text=/build me a campaign/i').first();
  const count = await h.page.locator('text=/build me a campaign/i').count();
  console.log("build panel headings found:", count);
  if (count === 0) {
    // expand a campaign first
    await h.page.locator("summary").first().click();
    await h.page.waitForTimeout(1500);
  }
  const after = await h.page.locator('text=/build me a campaign/i').count();
  console.log("after expand:", after);
  await h.screenshot("build.png");
  if (after === 0) throw new Error("build panel not rendered");
});
