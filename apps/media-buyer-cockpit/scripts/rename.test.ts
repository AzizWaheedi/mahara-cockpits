import { runTest } from "./auth";

runTest("Relaunched client updates its existing task", async h => {
  await h.goto("/dashboard");
  await h.page.waitForSelector("h1");
  await h.page.waitForTimeout(4000);

  const row = h.page.locator("table tbody tr", { hasText: "Liwan" }).first();
  const act = row
    .getByRole("button", {
      name: /Cut the worst ad|Turn it off|Add to Ads Managment board/,
    })
    .first();
  if (await act.count()) {
    await act.click();
    await h.page.waitForTimeout(10000);
  }
  await h.screenshot("cockpit-rename.png");
  const text = await h.page
    .locator("text=/Logged on the ClickUp task|Not logged to ClickUp/")
    .first()
    .textContent();
  console.log("rename log:", text);
});
