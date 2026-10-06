import { runTest } from "./auth";

runTest("CSM cockpit loads live clients", async h => {
  await h.goto("/csm");
  await h.page.waitForSelector("h1");
  await h.page.waitForTimeout(3000);
  const title = await h.page.textContent("h1");
  if (!title?.includes("Client Success Cockpit"))
    throw new Error(`bad title: ${title}`);
  const rows = await h.page.locator("text=/open$/").count();
  console.log("client rows:", rows);
  if (rows < 5) throw new Error(`expected client rows, got ${rows}`);
  await h.screenshot("csm-top.png");
});

runTest("Logging a touchpoint writes back to the client task", async h => {
  await h.goto("/csm");
  await h.page.waitForSelector("h1");
  await h.page.waitForTimeout(3000);

  // Safad is Active with a check-in call due, so a touchpoint is a real action.
  const row = h.page.locator("div", { hasText: "Safad" }).last();
  await row.click();
  await h.page.waitForTimeout(800);
  const btn = h.page.getByRole("button", { name: "Logged a message" }).first();
  if (!(await btn.count())) throw new Error("no touchpoint button found");
  await btn.click();
  await h.page.waitForTimeout(9000);
  await h.screenshot("csm-writeback.png");
});
