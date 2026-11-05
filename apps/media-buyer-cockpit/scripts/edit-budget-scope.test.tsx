import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { renderToStaticMarkup } from "react-dom/server";

// The module initializes its Supabase client on import. Static rendering
// performs no network request, and the placeholder environment is restored.
const previous = [process.env, import.meta.env].map(env => ({
  env,
  url: env.VITE_SUPABASE_URL,
  key: env.VITE_SUPABASE_ANON_KEY,
}));
process.env.VITE_SUPABASE_URL = "https://bldgtotkfmhoxmlzowdx.supabase.co";
process.env.VITE_SUPABASE_ANON_KEY = "test-placeholder-key";
Object.assign(import.meta.env, {
  VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY,
});
const { BudgetEditor } = await import("../src/components/EditPanel");
afterAll(() => {
  for (const { env, url, key } of previous) {
    if (url === undefined) delete env.VITE_SUPABASE_URL;
    else env.VITE_SUPABASE_URL = url;
    if (key === undefined) delete env.VITE_SUPABASE_ANON_KEY;
    else env.VITE_SUPABASE_ANON_KEY = key;
  }
});

test("both campaign and ad-set edits explain that the total is not checked", async () => {
  for (const budgetLevel of ["campaign", "adset"]) {
    const html = renderToStaticMarkup(
      <BudgetEditor
        campaign={{ budgetLevel, budgetDaily: 25 }}
        adSets={[
          { metaId: "synthetic-adset-1", name: "Example one", dailyBudget: 25 },
          { metaId: "synthetic-adset-2", name: "Example two", dailyBudget: 10 },
        ]}
      />,
    );
    expect(html).toContain("The cockpit does not check the");
    expect(html).toContain("total across accounts and platforms");
    expect(html).toContain("Check the combined daily");
    expect(html).toContain(">Set</button>");
    const win = new Window({ url: "https://example.invalid/" });
    win.document.body.innerHTML = html;
    const inputs = win.document.querySelectorAll("input");
    expect(inputs.length).toBe(budgetLevel === "campaign" ? 1 : 2);
    for (const input of inputs) {
      expect(input.getAttribute("aria-label")).toContain(
        "New daily budget for",
      );
      expect(input.getAttribute("aria-label")).toContain("US dollars");
      const descriptionId = input.getAttribute("aria-describedby");
      expect(descriptionId).toBeTruthy();
      const note = win.document.getElementById(descriptionId as string);
      expect(note?.textContent).toContain("The cockpit does not check");
      expect(note?.textContent).toContain(
        "total across accounts and platforms",
      );
    }
    await win.happyDOM.close();
  }
});
