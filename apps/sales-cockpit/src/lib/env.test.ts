// bun test src/lib/env.test.ts
import { describe, expect, test } from "bun:test";
import { supabaseEnvProblem } from "./env";

const URL = "https://bldgtotkfmhoxmlzowdx.supabase.co";

/** A key-shaped string with the given claims; the signature is not real. */
function key(claims: Record<string, unknown>) {
  const b64 = (o: unknown) =>
    btoa(JSON.stringify(o))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64(claims)}.not-a-signature`;
}

describe("supabaseEnvProblem", () => {
  test("the project's anon key and address pass", () => {
    expect(
      supabaseEnvProblem(
        URL,
        key({ role: "anon", ref: "bldgtotkfmhoxmlzowdx" }),
      ),
    ).toBeNull();
    expect(supabaseEnvProblem(`${URL}/`, "sb_publishable_abc")).toBeNull();
  });

  test("missing values are named", () => {
    expect(supabaseEnvProblem(undefined, "x")).toContain("no Supabase address");
    expect(supabaseEnvProblem(URL, "")).toContain("no Supabase address");
  });

  test("Vercel ciphertext in place of the address is refused (2026-09-24)", () => {
    const cipher = btoa(JSON.stringify({ v: "v2", c: [1, 2, 3], k: "x" }));
    expect(supabaseEnvProblem(cipher, key({ role: "anon" }))).toContain(
      "not a Supabase project address",
    );
    expect(supabaseEnvProblem(URL, cipher)).toContain("not a Supabase key");
  });

  test("a service key never reaches the browser", () => {
    expect(
      supabaseEnvProblem(
        URL,
        key({ role: "service_role", ref: "bldgtotkfmhoxmlzowdx" }),
      ),
    ).toContain("service_role key");
    expect(supabaseEnvProblem(URL, "sb_secret_abc")).toContain("secret key");
  });

  test("a key from another project is refused", () => {
    expect(
      supabaseEnvProblem(
        URL,
        key({ role: "anon", ref: "flwboeijllbtrufxkhts" }),
      ),
    ).toContain("different Supabase project");
  });

  test("an address that is not a Supabase project is refused", () => {
    expect(
      supabaseEnvProblem(
        "http://bldgtotkfmhoxmlzowdx.supabase.co",
        key({ role: "anon" }),
      ),
    ).toContain("not a Supabase project address");
  });
});
