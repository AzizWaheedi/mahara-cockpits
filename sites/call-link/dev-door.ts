/**
 * The call page on this machine, with a stand-in for sales-live's door, so
 * every way the door can fail is walked before a deploy. Nothing leaves the
 * machine: the page's door is pointed at this server.
 *
 *   bun sites/call-link/dev-door.ts [port]        (5419 by default)
 *
 * Then open http://127.0.0.1:5419/K7Q2MX?door=MODE, where MODE is what
 * /open/{code} answers:
 *
 *   open | open_zoom   the room is ready (Meet, Zoom)
 *   preparing          still being made, ready after 6 s
 *   ended | unknown    over, or no such code (404)
 *   busy               too many tries (429)
 *   broken             a join link the door refuses (502, state broken)
 *   garbage            a 200 whose body is not JSON
 *   slow               the answer after 8 s (the second try hears it)
 *   stall              the headers at once, the body never
 *   hang               no answer at all
 *   down               a door nobody answers at (a closed port)
 *   error              a 503
 *
 * The no-script route works too: /K7Q2MX?go=1 answers as sales-live/go
 * would (a plain two-language text, or a redirect to the room).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = import.meta.dir;
const PORT = Number(process.argv[2] ?? 5419);
const MEET = "https://meet.google.com/abc-defg-hij";
const ZOOM = "https://us06web.zoom.us/j/81234567890";
const REP = { en: "Sara", ar: "سارة" };
const started = new Map<string, number>();

const TYPES: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".html": "text/html; charset=utf-8",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
    },
  });

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** The page as Vercel serves it, with its door pointed here. */
function page(file: string, mode: string): Response {
  const door =
    mode === "down"
      ? "http://127.0.0.1:9/sales-live"
      : `http://127.0.0.1:${PORT}/__door/${mode}`;
  const html = readFileSync(join(DIR, file), "utf8").replace(
    /<meta name="mm-door" content="[^"]*">/,
    `<meta name="mm-door" content="${door}">`,
  );
  return new Response(html, { headers: { "content-type": TYPES[".html"] } });
}

async function door(mode: string, code: string): Promise<Response> {
  switch (mode) {
    case "open":
      return json({ ok: true, state: "open", provider: "meet", join_url: MEET, rep: REP });
    case "open_zoom":
      return json({ ok: true, state: "open", provider: "zoom", join_url: ZOOM, rep: REP });
    case "preparing": {
      const at = started.get(code) ?? Date.now();
      started.set(code, at);
      if (Date.now() - at < 6000)
        return json({ ok: true, state: "preparing", provider: "zoom", rep: REP, retry_ms: 2000 });
      started.delete(code);
      return json({ ok: true, state: "open", provider: "zoom", join_url: ZOOM, rep: REP });
    }
    case "ended":
      return json({ ok: true, state: "ended", rep: REP, whatsapp: "96590054963" });
    case "unknown":
      return json({ ok: false, state: "unknown", code }, 404);
    case "busy":
      return json({ ok: false, state: "busy", error: "Too many tries from this network." }, 429);
    case "broken":
      return json({ ok: false, state: "broken", code, error: "This room's link cannot be opened." }, 502);
    case "garbage":
      return new Response("<html>not json", {
        headers: { "access-control-allow-origin": "*" },
      });
    case "slow":
      await sleep(8000);
      return json({ ok: true, state: "open", provider: "meet", join_url: MEET, rep: REP });
    case "stall":
      return new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode('{"ok":tr'));
          },
        }),
        { headers: { "content-type": "application/json", "access-control-allow-origin": "*" } },
      );
    case "hang":
      await sleep(10 * 60_000);
      return json({});
    default:
      return json({ ok: false, state: "error" }, 503);
  }
}

/** sales-live/go as the no-script link meets it. */
function go(mode: string): Response {
  const text = (body: string, status: number) =>
    new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
  if (mode === "open" || mode === "slow") return Response.redirect(MEET, 302);
  if (mode === "open_zoom") return Response.redirect(ZOOM, 302);
  if (mode === "ended") return Response.redirect(`http://127.0.0.1:${PORT}/ended?c=K7Q2MX&door=ended`, 302);
  if (mode === "busy")
    return text(
      "Too many tries from this network. Wait a minute, then open the link again.\nمحاولات كثيرة من نفس الشبكة. انطر دقيقة وبعدين افتح اللينك مرة ثانية.",
      429,
    );
  return text(
    "This call link cannot be opened right now. Reply to our message and we will send it again.\nما نقدر نفتح لينك المكالمة الحين. رد على رسالتنا ونرسله لك مرة ثانية.",
    503,
  );
}

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);
    const p = url.pathname;
    const d = /^\/__door\/([a-z_]+)\/open\/([^/?]+)/.exec(p);
    if (d) return door(d[1], d[2]);
    const file = p.slice(1);
    if (/^[\w-]+\.(js|css|png)$/.test(file)) {
      try {
        const ext = file.slice(file.lastIndexOf("."));
        return new Response(readFileSync(join(DIR, file)), {
          headers: { "content-type": TYPES[ext] ?? "application/octet-stream" },
        });
      } catch {
        return new Response("Not found", { status: 404 });
      }
    }
    const mode = url.searchParams.get("door") ?? "open";
    if (p === "/ended") return page("ended.html", mode);
    if (url.searchParams.has("go")) return go(mode);
    return page("index.html", mode);
  },
});
console.log(`The call page with a stand-in door: http://127.0.0.1:${PORT}/K7Q2MX?door=open`);
