/* call.maharamedia.com: the page's pure rules and every line it can show.
   No DOM here, so `bun test sites/call-link` can check it. Loaded before
   call.js as a classic script (window.CallCore), or required by the tests.

   Arabic lines marked DRAFT are new for this page and wait for the CEO's
   review under aziz-kuwaiti-voice; the others come from final_arabic.md. */
((root, factory) => {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CallCore = api;
})(typeof self !== "undefined" ? self : this, () => {
  /** Six characters, no I, O, 0 or 1: the sales-live code alphabet. */
  const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;

  /** How long the page waits for the door on its first try (sales-live answers inside 4.5 s). */
  const REQUEST_MS = 6000;

  /** The second try waits longer: a door that answers in 8 s is still an answer. */
  const SECOND_TRY_MS = 15000;

  /* Marks nobody can see that a message app may leave in or after a link:
     zero-width spaces and joiners, the left-to-right and right-to-left marks,
     bidi embeddings and isolates, the Arabic letter mark, the byte order mark. */
  const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\u061C\uFEFF]/g;

  /** The code at the start, when no other letter or digit of the alphabet follows it. */
  const LEADING_CODE = /^([A-HJ-NP-Z2-9]{6})(?![A-Z0-9])/;

  /** A code as a lead may tap it: any case, spaces, invisible marks, punctuation after it. */
  function normalizeCode(x) {
    if (typeof x !== "string") return null;
    const c = x.replace(INVISIBLE, "").replace(/[\s/]+/g, "").toUpperCase();
    const m = LEADING_CODE.exec(c);
    return m ? m[1] : null;
  }

  /**
   * The code in the page's path ("/k7q2mx" works too), or null. A full stop,
   * an Arabic comma or a right-to-left mark glued to the link by the message
   * around it is not part of the code (the same rule as sales-live door.ts).
   */
  function codeFromPath(path) {
    let first = String(path || "").split("/").filter(Boolean)[0] || "";
    try {
      first = decodeURIComponent(first);
    } catch (_e) {
      return null;
    }
    return normalizeCode(first);
  }

  /** The ended page's code (/ended?c=K7Q2MX), or null. Nothing else is read from the address. */
  function endedCode(search) {
    let c = null;
    try {
      c = new URLSearchParams(String(search || "")).get("c");
    } catch (_e) {
      return null;
    }
    return normalizeCode(c);
  }

  /**
   * What the ended page does with the door's answer for its code: the room
   * is over (with the official WhatsApp number when the door has one), or it
   * is not over after all and the call page takes over. An error or an
   * unknown code leaves the plain ended lines, with no button.
   */
  function endedNext(view) {
    const v = view && typeof view === "object" ? view : {};
    if (v.state === "opening" || v.state === "preparing") return { go: "call" };
    return { state: "ended", whatsapp: v.state === "ended" ? v.whatsapp || null : null };
  }

  /** Which language leads: Arabic when the phone's first language is Arabic. */
  function langOrder(languages) {
    const list = languages?.length ? languages : ["ar"];
    const first = String(list[0] || "").toLowerCase();
    return first.indexOf("ar") === 0 ? ["ar", "en"] : ["en", "ar"];
  }

  /** iPhone, iPad (which says it is a Mac) or iPod. */
  function isIos(ua, maxTouchPoints) {
    const s = String(ua || "");
    if (/iPhone|iPad|iPod/i.test(s)) return true;
    return /Macintosh/i.test(s) && Number(maxTouchPoints) > 1;
  }

  /**
   * The join links the page will open: https on Zoom's or Meet's hosts only,
   * and never a host's start link (zak=, /s/ or /wc/.../start), as the
   * door's safeJoinUrl.
   */
  function safeJoinUrl(x) {
    if (typeof x !== "string" || x.length > 2000) return null;
    let u;
    try {
      u = new URL(x);
    } catch (_e) {
      return null;
    }
    if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
    const h = u.hostname.toLowerCase();
    const ok =
      h === "meet.google.com" ||
      h === "zoom.us" ||
      /\.zoom\.us$/.test(h) ||
      h === "zoom.com" ||
      /\.zoom\.com$/.test(h);
    if (!ok) return null;
    if (/[?&;#]zak=/i.test(u.search + u.hash)) return null;
    if (/^\/s\//i.test(u.pathname) || /^\/wc\/.*\/start(\/|$)/i.test(u.pathname)) return null;
    return u.toString();
  }

  function whatsappLink(digits) {
    const d = String(digits || "").replace(/\D/g, "");
    return d.length >= 8 && d.length <= 15 ? `https://wa.me/${d}` : null;
  }

  /* final_arabic.md: {rep_first_name} falls back to فريق المبيعات, the sales team. */
  const FALLBACK_REP = { en: "the sales team", ar: "فريق المبيعات" };

  const COPY = {
    openingPlain: { en: "Opening your call...", ar: "لحظة.. قاعدين نفتح لك مكالمتك" },
    opening: {
      en: "Opening your call with {rep}...",
      ar: "لحظة.. قاعدين نفتح لك مكالمتك مع {rep}",
    },
    notInYet: {
      en: "Not in the call yet? Tap the button below.",
      ar: "ما دخلت المكالمة؟ اضغط الزر اللي تحت.", // DRAFT
    },
    zoomHint: {
      en: "No Zoom app? Tap Join from your browser.",
      // Zoom's own label kept whole on one line (no-break spaces), inside the Arabic.
      ar: "ما عندك تطبيق زووم؟ اضغط Join\u00a0from\u00a0your\u00a0browser وتدخل من المتصفح.",
    },
    meetHint: {
      en: "Meet needs iOS\u00a017 or the Meet app.",
      ar: "قوقل ميت يحتاج iOS\u00a017 وفوق، أو تطبيق قوقل ميت.",
    },
    preparing: {
      en: "Your call is almost ready. This page opens it by itself.",
      ar: "مكالمتك قاعدة تتجهز.. بنفتحها لك أول ما تجهز.", // DRAFT
    },
    ended: {
      en: "This call has ended. Reply to our last message and we will find a new time.",
      ar: "هالمكالمة خلصت. رد على آخر رسالة منا ونرتب لك وقت ثاني.",
    },
    endedWhatsapp: {
      en: "This call has ended. Reply to our last message, or message us on WhatsApp, and we will find a new time.",
      ar: "هالمكالمة خلصت. رد على آخر رسالة منا، أو راسلنا على الواتساب، ونرتب لك وقت ثاني.",
    },
    unknown: {
      en: "This link is not valid. Reply to our message and we will send a new one.",
      ar: "هاللينك مو شغال. رد على رسالتنا ونرسل لك لينك يديد.",
    },
    /* The room exists but its join link cannot be opened: no Join button,
       because it would only lead to the same dead link. */
    broken: {
      en: "This link is not working. Reply to our message and we will send a new one.",
      ar: "هاللينك مو شغال. رد على رسالتنا ونرسل لك لينك يديد.",
    },
    error: {
      en: "We could not load your call. Tap Join the call, or reply to our message and we will call you.",
      ar: "ما قدرنا نحمّل مكالمتك. اضغط ادخل المكالمة، أو رد على رسالتنا ونتصل فيك.", // DRAFT
    },
    busy: {
      en: "Too many tries from this network. Tap Join the call, or wait a minute and tap Try again.",
      ar: "محاولات كثيرة من نفس الشبكة. اضغط ادخل المكالمة، أو انطر دقيقة وبعدين اضغط حاول مرة ثانية.", // DRAFT
    },
    join: { en: "Join the call", ar: "ادخل المكالمة" },
    whatsapp: { en: "Message us on WhatsApp", ar: "راسلنا على الواتساب" },
    tryAgain: { en: "Try again", ar: "حاول مرة ثانية" }, // DRAFT
    codeLabel: { en: "Call code", ar: "كود المكالمة" }, // DRAFT
    title: { en: "Your call", ar: "مكالمتك" },
  };

  function fill(line, rep) {
    return {
      en: line.en.replace("{rep}", (rep?.en) || FALLBACK_REP.en),
      ar: line.ar.replace("{rep}", (rep?.ar) || FALLBACK_REP.ar),
    };
  }

  /**
   * What /open answered, as one of the page's states:
   * opening, preparing, ended, unknown, busy or error.
   */
  function viewFor(status, body) {
    const b = body && typeof body === "object" ? body : {};
    const rep = b.rep && typeof b.rep === "object" ? b.rep : { en: null, ar: null };
    if (status === 200 && b.state === "open") {
      const url = safeJoinUrl(b.join_url);
      if (!url) return { state: "error" };
      return { state: "opening", provider: b.provider === "meet" ? "meet" : "zoom", joinUrl: url, rep: rep };
    }
    if (status === 200 && b.state === "preparing") {
      const wait = Number(b.retry_ms);
      return {
        state: "preparing",
        provider: b.provider === "meet" || b.provider === "zoom" ? b.provider : null,
        rep: rep,
        retryMs: wait >= 500 && wait <= 10000 ? wait : 2000,
      };
    }
    if (status === 200 && b.state === "ended") return { state: "ended", rep: rep, whatsapp: whatsappLink(b.whatsapp) };
    if (status === 404 || b.state === "unknown") return { state: "unknown" };
    if (b.state === "broken") return { state: "broken" };
    if (status === 429) return { state: "busy" };
    return { state: "error" };
  }

  /** The two lines a state shows, before language order is applied. */
  function linesFor(view) {
    switch (view.state) {
      case "loading":
        return COPY.openingPlain;
      case "opening":
        return fill(COPY.opening, view.rep);
      case "opened":
        return COPY.notInYet;
      case "preparing":
        return COPY.preparing;
      case "ended":
        return view.whatsapp ? COPY.endedWhatsapp : COPY.ended;
      case "unknown":
        return COPY.unknown;
      case "broken":
        return COPY.broken;
      case "busy":
        return COPY.busy;
      default:
        return COPY.error;
    }
  }

  /** The app hint: Zoom's everywhere, Meet's only on an iPhone or iPad. */
  function hintFor(provider, ios) {
    if (provider === "zoom") return COPY.zoomHint;
    if (provider === "meet" && ios) return COPY.meetHint;
    return null;
  }

  /** The first letter for the ring, in the leading language, or null. */
  function initialFor(rep, lang) {
    const name = rep && (rep[lang] || rep.en || rep.ar);
    if (!name) return null;
    const ch = Array.from(String(name).trim())[0];
    return ch ? ch.toUpperCase() : null;
  }

  return {
    CODE_RE: CODE_RE,
    REQUEST_MS: REQUEST_MS,
    SECOND_TRY_MS: SECOND_TRY_MS,
    COPY: COPY,
    FALLBACK_REP: FALLBACK_REP,
    normalizeCode: normalizeCode,
    codeFromPath: codeFromPath,
    endedCode: endedCode,
    endedNext: endedNext,
    langOrder: langOrder,
    isIos: isIos,
    safeJoinUrl: safeJoinUrl,
    whatsappLink: whatsappLink,
    viewFor: viewFor,
    linesFor: linesFor,
    hintFor: hintFor,
    initialFor: initialFor,
    fill: fill,
  };
});
