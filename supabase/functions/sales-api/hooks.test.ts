// bun test supabase/functions/sales-api/hooks.test.ts
// The hooks commit's lib.ts changes (contract v2 section 11, item 7).
import { describe, expect, test } from "bun:test";
import { checkTemplateRoute, FOLLOWUP_SEGMENTS, redact, renderTemplate, TEMPLATE_VARIABLES } from "./lib.ts";

describe("lib hooks", () => {
  test("redact hides zak= and pwd= in errors and logs", () => {
    expect(redact("https://us06web.zoom.us/j/1?pwd=SECRET&zak=TOKEN failed")).toBe("https://us06web.zoom.us/j/1?pwd=[key]&zak=[key] failed");
  });
  test("call_time is a template variable; reactivate is a follow-up kind", () => {
    expect(TEMPLATE_VARIABLES).toContain("call_time");
    expect(FOLLOWUP_SEGMENTS).toContain("reactivate");
    expect(renderTemplate("Hi {{1}}, demo {{3}} with {{2}}", ["first_name", "rep_name", "call_time"], { first_name: "Huda", rep_name: "Sami", call_time: "Sunday 4 pm" })).toBe(
      "Hi Huda, demo Sunday 4 pm with Sami",
    );
  });
  test("a template save keeps the button variable unless it names one", () => {
    const base = { key: "call_link_en", name: "cockpit_call_link_en", language: "en", purpose: "Room link", preview: "Hi {{1}}, {{2}}", variables: ["first_name", "rep_name"] };
    const plain = checkTemplateRoute(base);
    expect(plain.ok && "button_variable" in plain.value).toBe(false);
    const named = checkTemplateRoute({ ...base, button_variable: "join_code" });
    expect(named.ok && named.value.button_variable).toBe("join_code");
    expect(checkTemplateRoute({ ...base, button_variable: "other" }).ok).toBe(false);
    expect(checkTemplateRoute({ ...base, preview: "Demo {{1}}", variables: ["call_time"] }).ok).toBe(true);
  });
});

