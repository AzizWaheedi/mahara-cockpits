import { describe, expect, test } from "bun:test";
import { clean, handle, type Row } from "./handler.ts";

const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148";
const event = (over: Row = {}) => ({
  slug: "mergestudio",
  session_id: "a1b2c3d4-e5f6",
  form_version: "v1",
  screen: "q:project_type",
  step: 1,
  utm_source: "facebook",
  ad_id: "120200000000000001",
  has_fbclid: true,
  ...over,
});

function deps(hostsBySlug: Record<string, string[]> = { mergestudio: ["mergestudio-form.vercel.app"] }) {
  const inserted: Row[][] = [];
  return {
    inserted,
    d: {
      hosts: async (slug: string) => hostsBySlug[slug] ?? null,
      insert: async (rows: Row[]) => {
        inserted.push(rows);
        return { ok: true, status: 201 };
      },
    },
  };
}

let ip = 0;
const post = (body: unknown, origin = "https://mergestudio-form.vercel.app", ua = UA) =>
  new Request("https://x.supabase.co/functions/v1/page-form-events", {
    method: "POST",
    headers: {
      origin,
      "user-agent": ua,
      "content-type": "text/plain",
      // A fresh address per request, so the per-minute cap never mixes tests.
      "cf-connecting-ip": `10.0.0.${++ip}`,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("page-form-events", () => {
  test("stores one checked row from the page's own host, without answers", async () => {
    const { d, inserted } = deps();
    const res = await handle(post(event({ answer: "شقة كاملة", phone: "+96550000000" })), d);
    expect(res.status).toBe(204);
    expect(inserted).toHaveLength(1);
    const row = inserted[0][0];
    expect(row).toMatchObject({
      slug: "mergestudio",
      origin_host: "mergestudio-form.vercel.app",
      screen: "q:project_type",
      step: 1,
      device: "mobile",
      has_fbclid: true,
      ad_id: "120200000000000001",
    });
    expect(Object.keys(row)).not.toContain("answer");
    expect(Object.keys(row)).not.toContain("phone");
  });

  test("refuses a host that is not the page's, and an unknown page", async () => {
    const { d, inserted } = deps();
    expect((await handle(post(event(), "https://evil.example"), d)).status).toBe(403);
    expect((await handle(post(event({ slug: "nopage" })), d)).status).toBe(403);
    expect(inserted).toHaveLength(0);
  });

  test("localhost may post (tests)", async () => {
    const { d, inserted } = deps();
    expect((await handle(post(event(), "http://localhost:5191"), d)).status).toBe(204);
    expect(inserted[0][0].origin_host).toBe("localhost:5191");
  });

  test("drops crawlers, bad fields and unknown screens", async () => {
    const { d, inserted } = deps();
    expect((await handle(post(event(), undefined, "HeadlessChrome/127"), d)).status).toBe(204);
    expect((await handle(post(event({ screen: "q:Bad Key" })), d)).status).toBe(204);
    expect((await handle(post(event({ session_id: "x" })), d)).status).toBe(204);
    expect((await handle(post("not json"), d)).status).toBe(400);
    expect(inserted).toHaveLength(0);
  });

  test("keeps only digit ad ids and caps a batch", async () => {
    expect(clean(event({ ad_id: "abc" }), "h", UA)?.ad_id).toBeNull();
    const { d, inserted } = deps();
    const events = Array.from({ length: 15 }, (_, i) => event({ session_id: `session-${i}0000` }));
    expect((await handle(post({ events }), d)).status).toBe(204);
    expect(inserted[0]).toHaveLength(10);
  });

  test("answers a preflight and refuses GET", async () => {
    const { d } = deps();
    const pre = new Request("https://x/f", { method: "OPTIONS", headers: { origin: "https://mergestudio-form.vercel.app" } });
    expect((await handle(pre, d)).status).toBe(204);
    expect((await handle(new Request("https://x/f", { headers: { origin: "https://a.b" } }), d)).status).toBe(405);
  });
});
