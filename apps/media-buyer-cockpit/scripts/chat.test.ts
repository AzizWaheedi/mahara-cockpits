import { runTest } from "./auth";

runTest("Chat box delivers to Viktor", async (h) => {
  await h.goto("/dashboard");
  await h.page.waitForTimeout(3000);
  await h.page.locator('button:has-text("Ask Viktor")').first().click();
  await h.page.waitForTimeout(500);
  await h.page
    .locator("textarea")
    .last()
    .fill("Test message from the cockpit chat box — checking it reaches you.");
  await h.page.locator('button:has-text("Send")').last().click();
  await h.page.waitForTimeout(4000);
  const body = await h.page.locator("body").innerText();
  console.log("delivered:", body.includes("sent to Viktor") ? "YES" : "NO");
  await h.screenshot("chat.png");
  if (!body.includes("sent to Viktor")) throw new Error("not delivered");
});
