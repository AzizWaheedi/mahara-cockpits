/* call.maharamedia.com/{code}: ask sales-live where the room is, say whose
   call it is, then open it. One request per load (plus one retry, and a
   2-second check while the room is still being made). No cookies, no
   trackers: a random device id in this browser, so an open counts once. */
(() => {
  const C = window.CallCore;
  const doc = document;
  const html = doc.documentElement;
  const body = doc.body;
  html.classList.add("js");
  if (!C) return fail();

  const DOOR = doc.querySelector('meta[name="mm-door"]')?.content || "";
  const OPEN_DELAY_MS = 1400; // the ring fills, then the room opens
  const CHECK_AFTER_MS = 2600; // still here after that: offer the button
  const PREPARING_FOR_MS = 90000;
  const REQUEST_MS = C.REQUEST_MS || 6000;
  const SECOND_TRY_MS = C.SECOND_TRY_MS || 15000;
  // Still loading after both tries and their pause: something hung, say so.
  const WATCHDOG_MS = REQUEST_MS + 1000 + SECOND_TRY_MS + 3000;

  const order = C.langOrder(navigator.languages || [navigator.language]);
  const lead = order[0];
  const ios = C.isIos(navigator.userAgent, navigator.maxTouchPoints);
  const page = body.getAttribute("data-page") || "call";
  // The ended page knows its room only by ?c= and asks the door about it;
  // nothing it shows (the WhatsApp number included) comes from the address.
  const code = page === "call" ? C.codeFromPath(location.pathname) : C.endedCode(location.search);
  let startedAt = Date.now();
  let current = null;
  let prepTimer = 0;
  let slowTimer = 0;
  let watchdog = 0;
  let checking = false;
  // Focus was in the buttons when they were redrawn, and moved to the line.
  let focusFollows = false;

  html.lang = lead;
  html.dir = lead === "ar" ? "rtl" : "ltr";
  // The page's own script broke while loading: the no-script route still
  // works. A throw inside a promise is an unhandled rejection, not an error.
  const broke = () => {
    if (!current || current.state === "loading") fail();
  };
  window.addEventListener("error", broke);
  window.addEventListener("unhandledrejection", broke);

  const $ = (sel) => doc.querySelector(sel);

  function store(kind) {
    try {
      return window[kind];
    } catch (_e) {
      return null;
    }
  }

  function deviceId() {
    const ls = store("localStorage");
    let id = null;
    try {
      id = ls?.getItem("mm-call-device");
      if (!id || !/^[A-Za-z0-9-]{8,64}$/.test(id)) {
        id =
          window.crypto && crypto.randomUUID
            ? crypto.randomUUID()
            : `d${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
        if (ls) ls.setItem("mm-call-device", id);
      }
    } catch (_e) {
      id = id || `d${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    }
    return id;
  }

  /** Opened already in this tab (back from Zoom, or a reload): do not jump again. */
  function openedBefore() {
    const ss = store("sessionStorage");
    try {
      const at = Number(ss?.getItem(`mm-call-opened-${code}`));
      return at > 0 && Date.now() - at < 30 * 60 * 1000;
    } catch (_e) {
      return false;
    }
  }

  function markOpened() {
    const ss = store("sessionStorage");
    try {
      if (ss) ss.setItem(`mm-call-opened-${code}`, String(Date.now()));
    } catch (_e) {
      /* private mode: the page still works, it just may open again */
    }
  }

  // ------------------------------------------------------------ rendering

  function setPair(el1, el2, pair) {
    const second = order[1];
    el1.textContent = pair[lead];
    el1.lang = lead;
    el1.dir = lead === "ar" ? "rtl" : "ltr";
    el2.textContent = pair[second];
    el2.lang = second;
    el2.dir = second === "ar" ? "rtl" : "ltr";
  }

  function button(pair, href, quiet, onClick) {
    const el = doc.createElement(href ? "a" : "button");
    el.className = `btn made${quiet ? " quiet" : ""}`;
    if (href) {
      el.href = href;
      el.rel = "noopener";
    } else {
      el.type = "button";
    }
    const a = doc.createElement("span");
    const b = doc.createElement("span");
    a.className = "b1";
    b.className = "b2";
    setPair(a, b, pair);
    el.appendChild(a);
    el.appendChild(b);
    if (onClick) el.addEventListener("click", onClick);
    return el;
  }

  function render(view) {
    current = view;
    body.setAttribute("data-state", view.state);
    setPair($(".l1"), $(".l2"), C.linesFor(view));

    const initial = $(".initial");
    const letter = view.rep ? C.initialFor(view.rep, lead) : null;
    if (letter) {
      initial.textContent = letter;
      initial.lang = /[\u0600-\u06FF]/.test(letter) ? "ar" : "en";
    }

    const hint = $(".hint");
    const hintPair = view.state === "opening" || view.state === "opened" ? C.hintFor(view.provider, ios) : null;
    hint.hidden = !hintPair;
    if (hintPair) setPair($(".h1"), $(".h2"), hintPair);

    const actions = $(".actions");
    const active = doc.activeElement;
    const hadFocus = Boolean(active && active !== body && actions.contains(active));
    const made = actions.querySelectorAll(".made");
    for (let i = 0; i < made.length; i++) actions.removeChild(made[i]);
    if (view.state === "opening" || view.state === "opened") {
      actions.appendChild(
        button(C.COPY.join, view.joinUrl, false, () => {
          markOpened();
        }),
      );
    } else if (view.state === "loading" && view.slow && code) {
      // The door is slow: the no-script route is offered while it waits.
      actions.appendChild(button(C.COPY.join, "?go=1", false));
    } else if (view.state === "ended" && view.whatsapp) {
      actions.appendChild(button(C.COPY.whatsapp, view.whatsapp, false));
    } else if (view.state === "error") {
      if (code) actions.appendChild(button(C.COPY.join, "?go=1", false));
      actions.appendChild(button(C.COPY.tryAgain, null, true, retry));
    } else if (view.state === "busy") {
      // The door's limits must never keep the lead out of their call: the
      // no-script route opens the room without them (final review,
      // code-limiter-locks-out-the-lead).
      if (code) actions.appendChild(button(C.COPY.join, "?go=1", false));
      actions.appendChild(button(C.COPY.tryAgain, null, true, retry));
    }

    // Keyboard and screen-reader users keep their place: when "Try again"
    // (or any button) is redrawn, focus goes to the first new button, or to
    // the line while there is none, and on to the first button that follows.
    const l1 = $(".l1");
    const first = actions.querySelector(".made");
    if (hadFocus || (focusFollows && doc.activeElement === l1)) {
      if (first) {
        first.focus();
        focusFollows = false;
      } else {
        l1.setAttribute("tabindex", "-1");
        l1.focus();
        focusFollows = true;
      }
    }

    const foot = $(".code");
    if (page === "call" && code && view.state !== "unknown") {
      foot.hidden = false;
      setPair($(".code .c1"), $(".code .c2"), C.COPY.codeLabel);
      $(".code b").textContent = code;
    } else {
      foot.hidden = true;
    }
    doc.title = `${C.COPY.title[lead]} · ${lead === "ar" ? "مهارة ميديا" : "Mahara Media"}`;
  }

  function fail() {
    // The page's own script broke: the no-script route still works.
    body.setAttribute("data-state", "error");
    const pair = C ? C.COPY.error : { en: "We could not load your call. Tap Join the call.", ar: "ما قدرنا نحمّل مكالمتك. اضغط ادخل المكالمة." };
    const l1 = doc.querySelector(".l1");
    const l2 = doc.querySelector(".l2");
    if (l1 && l2) {
      l1.textContent = pair.ar;
      l2.textContent = pair.en;
    }
    const a = doc.querySelector(".fallback");
    if (a) a.classList.add("show");
  }

  // -------------------------------------------------------------- the door

  /**
   * Ask the door once per try. The first try waits 6 s, the second 15 s:
   * a slow door is still an answer. The wait covers the whole answer, its
   * body too, so a body that stalls is a failed try, not a spinner for ever.
   */
  function ask(tries, waitMs) {
    const ms = waitMs || REQUEST_MS;
    const ctl = window.AbortController ? new AbortController() : null;
    const timer = setTimeout(() => {
      if (ctl) ctl.abort();
    }, ms);
    const url = `${DOOR}/open/${code}?d=${encodeURIComponent(deviceId())}`;
    return fetch(url, { method: "GET", credentials: "omit", cache: "no-store", signal: ctl ? ctl.signal : undefined })
      .then((res) =>
        res.json().then(
          (json) => {
            clearTimeout(timer);
            return C.viewFor(res.status, json);
          },
          (e) => {
            // Cut off by the wait: a failed try. Anything else: no answer to read.
            if (ctl && ctl.signal.aborted) throw e;
            clearTimeout(timer);
            return C.viewFor(res.status, {});
          },
        ),
      )
      .catch(() => {
        clearTimeout(timer);
        if (tries > 1)
          return new Promise((r) => {
            setTimeout(r, 1000);
          }).then(() => ask(tries - 1, SECOND_TRY_MS));
        return { state: "error" };
      });
  }

  function retry() {
    startedAt = Date.now();
    render({ state: "loading" });
    load();
  }

  /** What the door said, acted on: open the room, wait for it, or say why not. */
  function handle(view) {
    clearTimeout(slowTimer);
    clearTimeout(watchdog);
    if (view.state === "preparing") {
      if (Date.now() - startedAt > PREPARING_FOR_MS) return render({ state: "error" });
      render(view);
      clearTimeout(prepTimer);
      prepTimer = setTimeout(load, view.retryMs);
      return;
    }
    if (view.state !== "opening") return render(view);
    if (openedBefore()) return render(Object.assign({}, view, { state: "opened" }));
    render(view);
    const reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
    setTimeout(
      () => {
        markOpened();
        location.assign(view.joinUrl);
        setTimeout(() => {
          if (current && current.state === "opening") render(Object.assign({}, current, { state: "opened" }));
        }, CHECK_AFTER_MS);
      },
      reduce ? 600 : OPEN_DELAY_MS,
    );
  }

  function load() {
    // Slow door: offer Join the call while it waits. Hung page: say so.
    clearTimeout(slowTimer);
    clearTimeout(watchdog);
    if (current && current.state === "loading") {
      slowTimer = setTimeout(() => {
        if (current && current.state === "loading") render({ state: "loading", slow: true });
      }, REQUEST_MS);
      watchdog = setTimeout(() => {
        if (!current || current.state !== "loading") return;
        try {
          render({ state: "error" });
        } catch (_e) {
          fail();
        }
      }, WATCHDOG_MS);
    }
    ask(2).then(handle);
  }

  /**
   * Back on the page (from the call app, or a phone that slept): the room
   * may have ended or come ready meanwhile, so the door is asked again,
   * once. A lead whose room is over sees that, never a dead join button.
   */
  function recheck() {
    if (checking || !current || !code || page !== "call") return;
    const st = current.state;
    if (st !== "opened" && st !== "preparing" && st !== "error" && st !== "opening") return;
    checking = true;
    // A phone that slept while the room was being made starts its wait again.
    startedAt = Date.now();
    ask(1).then(
      (view) => {
        checking = false;
        if (view.state === "ended" || view.state === "unknown" || view.state === "broken") return render(view);
        if (view.state === "opening") {
          if (st === "opened" || st === "opening") return render(Object.assign({}, view, { state: "opened" }));
          return handle(view);
        }
        if (view.state === "preparing") return handle(view);
        // No answer this time: what shows stays.
      },
      () => {
        checking = false;
      },
    );
  }

  // Back from the call app (the page comes out of the back-forward cache).
  window.addEventListener("pageshow", (e) => {
    if (e.persisted && current && (current.state === "opening" || current.state === "opened"))
      render(Object.assign({}, current, { state: "opened" }));
    if (e.persisted) recheck();
  });
  window.addEventListener("visibilitychange", () => {
    if (doc.visibilityState === "visible") recheck();
  });

  if (page === "ended") {
    render({ state: "ended", whatsapp: null });
    if (!code || !DOOR) return;
    return ask(2).then((view) => {
      const next = C.endedNext(view);
      if (next.go === "call") return location.replace(`/${code}`);
      if (next.whatsapp) render(next);
    });
  }
  if (!code || !DOOR) return render({ state: "unknown" });
  render({ state: "loading" });
  load();
})();
