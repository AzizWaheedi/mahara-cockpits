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

  /** The code in the page's path ("/k7q2mx" works too), or null. */
  function codeFromPath(path) {
    let first = String(path || "").split("/").filter(Boolean)[0] || "";
    try {
      first = decodeURIComponent(first);
    } catch (_e) {
      return null;
    }
    const code = first.replace(/\s+/g, "").toUpperCase();
    return CODE_RE.test(code) ? code : null;
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

  /** The join links the page will open: https on Zoom's or Meet's hosts only. */
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
    return ok ? u.toString() : null;
  }

  function whatsappLink(digits) {
    const d = String(digits || "").replace(/\D/g, "");
    return d.length >= 8 && d.length <= 15 ? `https://wa.me/${d}` : null;
  }

  const FALLBACK_REP = { en: "the Mahara Media team", ar: "فريق المبيعات" };

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
    error: {
      en: "We could not load your call. Tap Join the call, or try again.",
      ar: "ما قدرنا نحمّل مكالمتك. اضغط ادخل المكالمة، أو حاول مرة ثانية.", // DRAFT
    },
    busy: {
      en: "Too many tries from this network. Wait a minute, then tap Try again.",
      ar: "محاولات كثيرة من نفس الشبكة. انطر دقيقة وبعدين اضغط حاول مرة ثانية.", // DRAFT
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
    COPY: COPY,
    FALLBACK_REP: FALLBACK_REP,
    codeFromPath: codeFromPath,
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
