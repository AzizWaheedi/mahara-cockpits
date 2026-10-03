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

runTest("New creative asks for a reason before sending", async h => {
  await h.goto("/dashboard");
  await h.page.waitForSelector("h1");
  await h.page.waitForTimeout(3000);

  // The campaign request keeps the buyer's reason explicit.
  const row = h.page.locator("table tbody tr", { hasText: "العمران" }).first();
  const more = row.getByRole("button", { name: "⋯" });
  if (await more.count()) {
    await more.click();
    await h.page.waitForTimeout(600);
    await h.page.getByRole("button", { name: "New creative" }).first().click();
    const dialog = h.page.getByRole("dialog", { name: "New creative" });
    if (!(await dialog.getByRole("button", { name: "Send to creative director" }).isDisabled()))
      throw new Error("Creative request can be sent without a reason");
    await dialog.getByRole("radio", { name: "Refresh a fatigued ad" }).check();
    if (!(await dialog.getByRole("button", { name: "Send to creative director" }).isEnabled()))
      throw new Error("Creative request did not accept the selected reason");
    await dialog.getByRole("button", { name: "Cancel" }).click();
  }
  await h.screenshot("cockpit-request.png");
});
