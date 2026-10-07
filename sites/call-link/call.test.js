// bun test sites/call-link
//
// call.js against a small fake DOM: the ended page (where its WhatsApp button
// comes from) and where keyboard focus goes when the buttons are redrawn.
// The fake has only what call.js touches; removing a focused element sends
// focus to <body>, as browsers do. Timers and fetch are driven by the test.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const C = require("./core.js");
const SRC = readFileSync(join(import.meta.dir, "call.js"), "utf8");
const DOOR = "https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/sales-live";

class El {
  constructor(doc, tag, cls = "", attrs = {}) {
    this.doc = doc;
    this.tagName = tag.toUpperCase();
    this.className = cls;
    this.attrs = { ...attrs };
    this.children = [];
    this.parent = null;
    this.textContent = "";
    this.hidden = false;
    this.lang = "";
    this.dir = "";
    this.listeners = {};
  }
  get classList() {
    const el = this;
    return {
      add(c) {
        if (!el.className.split(/\s+/).includes(c)) el.className = `${el.className} ${c}`.trim();
      },
      contains(c) {
        return el.className.split(/\s+/).includes(c);
      },
    };
  }
  get content() {
    return this.attrs.content;
  }
  getAttribute(n) {
    return n in this.attrs ? this.attrs[n] : null;
  }
  setAttribute(n, v) {
    this.attrs[n] = String(v);
  }
  appendChild(c) {
    c.parent = this;
    this.children.push(c);
    return c;
  }
  removeChild(c) {
    const i = this.children.indexOf(c);
    if (i >= 0) this.children.splice(i, 1);
    if (c.contains(this.doc.activeElement)) this.doc.activeElement = this.doc.body;
    c.parent = null;
    return c;
  }
  contains(x) {
    for (let n = x; n; n = n.parent) if (n === this) return true;
    return false;
  }
  addEventListener(type, fn) {
    if (!this.listeners[type]) this.listeners[type] = [];
    this.listeners[type].push(fn);
  }
  click() {
    for (const fn of this.listeners.click || []) fn({ preventDefault() {} });
  }
  focus() {
    this.doc.activeElement = this;
  }
  descendants() {
    const out = [];
    const walk = n => {
      for (const c of n.children) {
        out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
  matches(part) {
    if (part.startsWith(".")) return this.classList.contains(part.slice(1));
    const m = /^(\w+)\[([\w-]+)="([^"]*)"\]$/.exec(part);
    if (m) return this.tagName === m[1].toUpperCase() && this.getAttribute(m[2]) === m[3];
    return this.tagName === part.toUpperCase();
  }
  querySelectorAll(sel) {
    let scope = [this];
    for (const part of sel.trim().split(/\s+/)) {
      const next = [];
      for (const s of scope) for (const d of s.descendants()) if (d.matches(part) && !next.includes(d)) next.push(d);
      scope = next;
    }
    return scope;
  }
  querySelector(sel) {
    return this.querySelectorAll(sel)[0] || null;
  }
}

/** The page as index.html and ended.html build it, then call.js run against it. */
function page({ kind = "call", path = "/K7Q2MX", search = "", answer, languages = ["en-GB"] }) {
  const doc = { activeElement: null, title: "" };
  const add = (parent, tag, cls = "", attrs = {}) => parent.appendChild(new El(doc, tag, cls, attrs));
  const html = new El(doc, "html");
  const head = add(html, "head");
  add(head, "meta", "", { name: "mm-door", content: DOOR });
  const body = add(html, "body", "", { "data-page": kind, "data-state": kind === "call" ? "loading" : "ended" });
  const main = add(body, "main", "page");
  const stage = add(main, "section", "stage");
  add(add(stage, "div", "ring"), "div", "initial");
  const lines = add(stage, "div", "lines");
  add(lines, "p", "l1");
  add(lines, "p", "l2");
  const hint = add(stage, "div", "hint");
  hint.hidden = true;
  add(hint, "p", "h1");
  add(hint, "p", "h2");
  const actions = add(stage, "div", "actions");
  if (kind === "call") add(actions, "a", "btn fallback", { href: "?go=1" });
  const foot = add(main, "footer", "code");
  foot.hidden = true;
  add(foot, "span", "c1");
  add(foot, "span", "c2");
  add(foot, "b");
  doc.documentElement = html;
  doc.body = body;
  doc.activeElement = body;
  doc.querySelector = sel => html.querySelector(sel);
  doc.createElement = tag => new El(doc, tag);

  const timers = new Map();
  const scheduled = [];
  let nextTimer = 1;
  const requests = [];
  const moves = [];
  const store = () => {
    const m = new Map();
    return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
  };
  const win = {
    CallCore: C,
    AbortController,
    localStorage: store(),
    sessionStorage: store(),
    crypto: { randomUUID: () => "2b0c3f7e-5d1a-4c1b-9b7e-3a1f0d2c4e5f" },
    matchMedia: () => ({ matches: true }),
    listeners: {},
    addEventListener(type, fn) {
      if (!this.listeners[type]) this.listeners[type] = [];
      this.listeners[type].push(fn);
    },
  };
  const env = {
    window: win,
    document: doc,
    navigator: { languages, language: languages[0], userAgent: "Mozilla/5.0 (iPhone)", maxTouchPoints: 5 },
    location: {
      pathname: path,
      search,
      assign: u => moves.push(["assign", u]),
      replace: u => moves.push(["replace", u]),
    },
    fetch: (url, init) => {
      requests.push(url);
      const a = answer(url, requests.length);
      if (a instanceof Error) return Promise.reject(a);
      // A body that never arrives, until the page's own wait cuts it off.
      if (a.stall)
        return Promise.resolve({
          status: a.status,
          json: () =>
            new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))),
        });
      if (a.hang) return new Promise(() => {});
      return Promise.resolve({ status: a.status, json: () => Promise.resolve(a.body) });
    },
    setTimeout: (fn, ms) => {
      const id = nextTimer++;
      timers.set(id, { fn, ms });
      scheduled.push(ms);
      return id;
    },
    clearTimeout: id => timers.delete(id),
    matchMedia: win.matchMedia,
    crypto: win.crypto,
    AbortController,
  };
  new Function(...Object.keys(env), SRC)(...Object.values(env));

  return {
    doc,
    requests,
    moves,
    actions,
    l1: () => doc.querySelector(".l1"),
    buttons: () => actions.querySelectorAll(".made"),
    state: () => body.getAttribute("data-state"),
    /** Lets every pending promise settle. */
    async flush() {
      for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r));
    },
    win,
    timers,
    scheduled,
    /** Says to the page that it is showing again (a phone that woke). */
    async wake() {
      doc.visibilityState = "visible";
      for (const fn of win.listeners.visibilitychange || []) fn();
      await this.flush();
    },
    /** Runs every timer that waits `ms`, as if that long passed. */
    async run(ms) {
      let ran = false;
      for (const [id, t] of [...timers.entries()]) {
        if (t.ms !== ms || !timers.has(id)) continue;
        timers.delete(id);
        t.fn();
        ran = true;
      }
      await this.flush();
      return ran;
    },
    /** Runs the timers due now (the shortest first), once. */
    async tick() {
      const due = [...timers.entries()].sort((a, b) => a[1].ms - b[1].ms);
      if (!due.length) return;
      const [id, t] = due[0];
      timers.delete(id);
      t.fn();
      await this.flush();
    },
  };
}

describe("the ended page", () => {
  test("its WhatsApp button is the number the door gives for the room, never one from the address", async () => {
    const p = page({
      kind: "ended",
      path: "/ended",
      search: "?c=K7Q2MX&wa=96550000000",
      answer: () => ({ status: 200, body: { ok: true, state: "ended", code: "K7Q2MX", rep: {}, whatsapp: "96590054963" } }),
    });
    expect(p.state()).toBe("ended");
    await p.flush();
    expect(p.requests).toHaveLength(1);
    expect(p.requests[0]).toStartWith(`${DOOR}/open/K7Q2MX?d=`);
    const links = p.buttons().map(b => b.href);
    expect(links).toEqual(["https://wa.me/96590054963"]);
    expect(JSON.stringify(links)).not.toContain("96550000000");
    expect(p.l1().textContent).toContain("WhatsApp");
  });

  test("an address with only ?wa= gets the plain ended lines and no button", async () => {
    const p = page({ kind: "ended", path: "/ended", search: "?wa=96550000000", answer: () => ({ status: 500, body: {} }) });
    await p.flush();
    expect(p.requests).toHaveLength(0);
    expect(p.buttons()).toHaveLength(0);
    expect(p.l1().textContent).toBe(C.COPY.ended.en);
  });

  test("when the door cannot be reached the page still says the call ended, with no button", async () => {
    const p = page({ kind: "ended", path: "/ended", search: "?c=K7Q2MX", answer: () => new TypeError("offline") });
    await p.flush();
    await p.tick(); // the one retry after a second
    await p.flush();
    expect(p.state()).toBe("ended");
    expect(p.buttons()).toHaveLength(0);
  });

  test("a room that is not over after all sends the lead to the call page", async () => {
    const p = page({
      kind: "ended",
      path: "/ended",
      search: "?c=K7Q2MX",
      answer: () => ({
        status: 200,
        body: { ok: true, state: "open", code: "K7Q2MX", provider: "zoom", join_url: "https://us06web.zoom.us/j/1", rep: {} },
      }),
    });
    await p.flush();
    expect(p.moves).toEqual([["replace", "/K7Q2MX"]]);
  });

  test("the call code is not shown on the ended page", async () => {
    const p = page({ kind: "ended", path: "/ended", search: "?c=K7Q2MX", answer: () => ({ status: 200, body: { state: "ended" } }) });
    await p.flush();
    expect(p.doc.querySelector(".code").hidden).toBe(true);
  });
});

describe("the call page", () => {
  test("a link with a full stop or an Arabic comma after it asks for the right room", async () => {
    for (const path of ["/K7Q2MX.", "/K7Q2MX%D8%8C", "/K7Q2MX%E2%80%8F"]) {
      const p = page({ path, answer: () => ({ status: 404, body: { state: "unknown" } }) });
      await p.flush();
      expect([path, p.requests[0]?.split("?")[0]]).toEqual([path, `${DOOR}/open/K7Q2MX`]);
    }
  });

  test("after Try again, keyboard focus stays in the page: on the line while loading, then on the first new button", async () => {
    let answers = 0;
    const p = page({
      answer: () => {
        answers++;
        return { status: 503, body: { ok: false, state: "error" } };
      },
    });
    await p.flush();
    expect(p.state()).toBe("error");
    const tryAgain = p.buttons().find(b => b.tagName === "BUTTON");
    expect(tryAgain).toBeTruthy();
    tryAgain.focus();
    tryAgain.click(); // render(loading) removes the focused button
    expect(p.state()).toBe("loading");
    expect(p.doc.activeElement).toBe(p.l1());
    expect(p.l1().getAttribute("tabindex")).toBe("-1");
    await p.flush();
    expect(p.state()).toBe("error");
    expect(answers).toBe(2);
    const first = p.buttons()[0];
    expect(p.doc.activeElement).toBe(first);
    expect(p.actions.contains(p.doc.activeElement)).toBe(true);
  });

  test("a redraw never pulls focus that was somewhere else", async () => {
    const p = page({ answer: () => ({ status: 503, body: { state: "error" } }) });
    await p.flush();
    expect(p.state()).toBe("error");
    expect(p.doc.activeElement).toBe(p.doc.body);
  });

  test("Too many tries keeps focus on its buttons too", async () => {
    let n = 0;
    const p = page({ answer: () => (++n === 1 ? { status: 429, body: { state: "busy" } } : { status: 429, body: { state: "busy" } }) });
    await p.flush();
    expect(p.state()).toBe("busy");
    const again = p.buttons().find(b => b.tagName === "BUTTON");
    again.focus();
    again.click();
    await p.flush();
    expect(p.state()).toBe("busy");
    expect(p.doc.activeElement).toBe(p.buttons()[0]);
  });

  test("Too many tries still offers Join the call through the no-script route, first, then Try again", async () => {
    const p = page({ answer: () => ({ status: 429, body: { state: "busy" } }) });
    await p.flush();
    expect(p.state()).toBe("busy");
    const [join, again] = p.buttons();
    expect(join.attrs.href ?? join.href).toBe("?go=1");
    expect(again.tagName).toBe("BUTTON");
  });
});

describe("the call page's fallbacks", () => {
  test("a body that stalls is cut off by the wait and tried again, never a spinner for ever", async () => {
    let n = 0;
    const p = page({
      answer: () => (++n === 1 ? { status: 200, stall: true } : { status: 200, body: { state: "ended" } }),
    });
    await p.flush();
    expect(p.state()).toBe("loading");
    // The 6 s wait aborts the stalled body; after a second the door is asked again.
    expect(await p.run(C.REQUEST_MS)).toBe(true);
    expect(await p.run(1000)).toBe(true);
    expect(n).toBe(2);
    expect(p.state()).toBe("ended");
  });

  test("the second try waits 15 s, so a door that answers in 8 s is heard", async () => {
    let n = 0;
    const p = page({
      answer: () => (++n === 1 ? new Error("timed out") : { status: 200, body: { state: "ended" } }),
    });
    await p.flush();
    await p.run(1000);
    expect(p.scheduled).toContain(C.SECOND_TRY_MS);
    expect(p.state()).toBe("ended");
  });

  test("a slow door offers Join the call after 6 s while it keeps waiting", async () => {
    const p = page({ answer: () => ({ hang: true }) });
    await p.flush();
    expect(p.buttons().length).toBe(0);
    // The page's own 6 s: the slow line, with the no-script route to join.
    const slow = [...p.timers.entries()].filter(([, t]) => t.ms === C.REQUEST_MS);
    expect(slow.length).toBeGreaterThan(0);
    for (const [id, t] of slow) {
      p.timers.delete(id);
      t.fn();
    }
    await p.flush();
    expect(p.state()).toBe("loading");
    expect(p.buttons().map(b => b.attrs.href ?? b.href)).toContain("?go=1");
  });

  test("still loading when every try is over: the page says so instead of spinning", async () => {
    const p = page({ answer: () => ({ hang: true }) });
    await p.flush();
    const wait = C.REQUEST_MS + 1000 + C.SECOND_TRY_MS + 3000;
    expect(await p.run(wait)).toBe(true);
    expect(p.state()).toBe("error");
    expect(p.l1().textContent).toContain("reply to our message and we will call you");
  });

  test("a broken link says so, with no Join button that leads nowhere", async () => {
    const p = page({ answer: () => ({ status: 502, body: { ok: false, state: "broken" } }) });
    await p.flush();
    expect(p.state()).toBe("broken");
    expect(p.buttons().length).toBe(0);
  });

  test("a throw inside a promise is caught: the page shows its own error, not a spinner", () => {
    const p = page({ answer: () => ({ hang: true }) });
    expect(p.win.listeners.unhandledrejection?.length).toBe(1);
    p.win.listeners.unhandledrejection[0]();
    expect(p.state()).toBe("error");
  });

  test("back on the page after the call ended, the lead sees it ended, not a dead Join button", async () => {
    let n = 0;
    const p = page({
      answer: () =>
        ++n === 1
          ? {
              status: 200,
              body: { state: "open", provider: "meet", join_url: "https://meet.google.com/abc-defg-hij", rep: {} },
            }
          : { status: 200, body: { state: "ended" } },
    });
    await p.flush();
    expect(p.state()).toBe("opening");
    await p.wake();
    expect(n).toBe(2);
    expect(p.state()).toBe("ended");
  });

  test("a phone that slept while the room was made asks again on waking, not an error", async () => {
    let n = 0;
    const p = page({
      answer: () =>
        ++n === 1
          ? { status: 200, body: { state: "preparing", retry_ms: 2000 } }
          : {
              status: 200,
              body: { state: "open", provider: "zoom", join_url: "https://us06web.zoom.us/j/81234567890", rep: {} },
            },
    });
    await p.flush();
    expect(p.state()).toBe("preparing");
    await p.wake();
    expect(p.state()).toBe("opening");
  });
});

describe("the pages as they ship", () => {
  test("both pages name the door, so the ended page can ask whether the room is over", () => {
    for (const file of ["index.html", "ended.html"]) {
      const html = readFileSync(join(import.meta.dir, file), "utf8");
      expect([file, /<meta name="mm-door" content="https:\/\/[a-z0-9]+\.supabase\.co\/functions\/v1\/sales-live">/.test(html)]).toEqual([file, true]);
    }
  });
});
