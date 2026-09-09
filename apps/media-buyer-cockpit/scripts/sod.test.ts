import { runTest } from "./auth";

runTest("Morning sprint order, watch list and the chat box", async (h) => {
  await h.goto("/dashboard");
  await h.page.waitForTimeout(3500);
  const body = await h.page.locator("body").innerText();
  const order = ["ClickUp comments", "WhatsApp sprint", "Slack sprint", "Tasks and onboardings"]
    .map(t => body.indexOf(t));
  console.log("sprint order indexes:", order.join(","));
  if (order.some(i => i < 0)) throw new Error("a morning sprint step is missing");
  if (order.join() !== [...order].sort((a, b) => a - b).join())
    throw new Error("morning sprint is out of order");
  console.log("watch list:", /watch list/i.test(body) ? "present" : "MISSING");
  await h.screenshot("sod.png");

  await h.page.locator('button:has-text("Ask Viktor")').first().click();
  await h.page.waitForTimeout(600);
  await h.page.locator("textarea").last().fill("Test from the automated check — ignore this.");
  await h.screenshot("chat.png");

  await h.goto("/ads");
  await h.page.waitForTimeout(2500);
  const ads = await h.page.locator("body").innerText();
  console.log("mid-day sweep:", /middle of the day/i.test(ads) ? "present" : "MISSING");
  if (!/middle of the day/i.test(ads)) throw new Error("mid checks missing on ads page");
});
