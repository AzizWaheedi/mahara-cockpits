import { afterAll, expect, test } from "bun:test";
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

test("both campaign and ad-set edits explain that the total is not checked", () => {
  for (const budgetLevel of ["campaign", "adset"]) {
    const html = renderToStaticMarkup(
      <BudgetEditor
        campaign={{ budgetLevel, budgetDaily: 25 }}
        adSets={[
          { metaId: "synthetic-adset", name: "Example", dailyBudget: 25 },
        ]}
      />,
    );
    expect(html).toContain("The cockpit does not check the");
    expect(html).toContain("total across accounts and platforms");
    expect(html).toContain("Check the combined daily");
    expect(html).toContain(">Set</button>");
  }
});
