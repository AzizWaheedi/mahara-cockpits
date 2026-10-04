// bun test sites/call-link/stress_security_r4_call.test.ts
//
// Security stress of the short page, round 4, 3 October 2026: the pages as
// they are shipped (index.html, ended.html, vercel.json), not as call.test.js
// builds them. call.test.js's page() adds the mm-door meta to both pages
// itself, so a page that ships without it passes there. Each `test` held when
// written; each `test.failing` pins a confirmed finding (its key is in its
// name) and goes red when the fix lands, so the fix flips it to `test`.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const HERE = import.meta.dir;
const read = (f: string) => readFileSync(join(HERE, f), "utf8");

/** The mm-door meta's content in a shipped page, or null. */
function doorOf(html: string): string | null {
  const m = /<meta\s+name="mm-door"\s+content="([^"]*)"/i.exec(html);
  return m ? (m[1] ?? null) : null;
}

/** The CSP's connect-src origins for every path, from vercel.json. */
function connectSrc(): string[] {
  const cfg = JSON.parse(read("vercel.json")) as { headers: { source: string; headers: { key: string; value: string }[] }[] };
  const all = cfg.headers.find(h => h.source === "/(.*)");
  const csp = all?.headers.find(h => h.key.toLowerCase() === "content-security-policy")?.value ?? "";
  const part = csp.split(";").map(s => s.trim()).find(s => s.startsWith("connect-src")) ?? "";
  return part.split(/\s+/).slice(1);
}

describe("security r4: the shipped pages and the door they may reach", () => {
  test("the call page names the door, and the CSP lets it reach exactly that origin and no other (the fixture works)", () => {
    const door = doorOf(read("index.html"));
    expect(door).toBe("https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/sales-live");
    expect(connectSrc()).toEqual([new URL(String(door)).origin]);
  });

  test("neither page loads a script from anywhere but the site itself", () => {
    for (const f of ["index.html", "ended.html"]) {
      const srcs = [...read(f).matchAll(/<script[^>]*\bsrc="([^"]+)"/gi)].map(m => m[1]);
      expect([f, srcs.every(s => typeof s === "string" && s.startsWith("/"))]).toEqual([f, true]);
      // No inline script: the CSP's script-src 'self' would refuse it anyway, and a page that relied on one would break.
      expect([f, /<script(?![^>]*\bsrc=)[^>]*>/i.test(read(f))]).toEqual([f, false]);
    }
  });

  test.failing("ended-page-never-asks-door: /ended?c={code} ships without the mm-door meta, so call.js never asks the door: no WhatsApp button, and a room that is not over is never handed back to the call page", () => {
    // call.js reads DOOR from <meta name="mm-door"> and, on the ended page,
    // returns at once when it is empty (`if (!code || !DOOR) return;`).
    // ended.html's own comment says the script asks sales-live/open/{code}
    // for the official WhatsApp number, and /go sends every lead whose room
    // is over (or whose replaced room's link it follows) there. As shipped,
    // the page shows the plain ended lines only: the "Message us on
    // WhatsApp" fallback (rooms.fallback.ended_page_whatsapp) never appears,
    // and endedNext's "not over after all, go back to the call" never runs.
    // call.test.js passes because its page() adds the meta to both pages.
    expect(doorOf(read("ended.html"))).toBe(doorOf(read("index.html")));
  });
});
