/**
 * Smmim's client page crashed on 2026-10-28 ("This screen hit an error").
 * Its campaign had no client tag, because the Client Data sheet held the bare
 * account id instead of the tracker's "<id>, SAR". The build panel sent the
 * account name as a tag, cockpit_build_scope refused it, and the refusal took
 * the whole page down. The panel now says why it cannot build and the page
 * keeps working. Every id and name here is made up.
 */
import { afterAll, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

// The panel's module builds the sign-in client on import. Nothing here reads
// the network: no effect runs in a static render. The env is put back.
const envBefore = [process.env, import.meta.env].map(env => ({
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
const { BuildPanel, buildBlockedReason } = await import(
  "../src/components/BuildPanel"
);
afterAll(() => {
  for (const { env, url, key } of envBefore) {
    if (url === undefined) delete env.VITE_SUPABASE_URL;
    else env.VITE_SUPABASE_URL = url;
    if (key === undefined) delete env.VITE_SUPABASE_ANON_KEY;
    else env.VITE_SUPABASE_ANON_KEY = key;
  }
});

test("a campaign with no client tag says how to map it and offers no build", () => {
  const html = renderToStaticMarkup(
    <BuildPanel
      clientName="Test Studio"
      accountId="111222333"
      accountName="111222333, SAR"
    />,
  );
  expect(html).toContain("not matched to a client on the Client Data sheet");
  expect(html).toContain("&quot;111222333, SAR&quot;");
  expect(html).not.toContain("Build a campaign");
});

test("a refused drafts read becomes the panel's own sentence", () => {
  expect(
    buildBlockedReason(
      "teststudio",
      "111222333, SAR",
      new Error(
        "The client ad account is missing or ambiguous. Refresh its mapping first",
      ),
    ),
  ).toBe(
    "I cannot build for this client right now: The client ad account is missing or ambiguous. Refresh its mapping first",
  );
});

test("a tagged client with a working read still offers the build", () => {
  expect(buildBlockedReason("teststudio", "111222333, SAR", null)).toBe(
    undefined,
  );
  const html = renderToStaticMarkup(
    <BuildPanel
      clientTag="teststudio"
      clientName="Test Studio"
      accountId="111222333"
    />,
  );
  expect(html).toContain("Build a campaign");
});
