/*
 * Mahara live training: page events for the CEO cockpit's webinar funnel.
 *
 * The tracking brief (6 August 2026): "Landing page (Vercel) events: page
 * views, form submits, and CTA link clicks. Fired client-side to a Supabase
 * edge function." Events go to the Edge Function webinar-events in Creative
 * Triage, which checks every field (supabase/functions/webinar-events).
 *
 * No cookies and nothing personal: a random visitor id kept in this
 * browser, a session that ends after 30 idle minutes, and where the visit
 * came from (utm_*, kept for 30 days so the thank-you page knows the ad).
 * Nothing here can stop the page from working: every step is in a try.
 *
 * <script src="/mm-track.js" data-page="landing|thank_you|live|pitch" defer></script>
 */
(function () {
  "use strict";
  var ENDPOINT =
    "https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/webinar-events";
  var SESSION_IDLE_MS = 30 * 60 * 1000;
  var UTM_DAYS = 30;
  var script = document.currentScript;
  var page = (script && script.getAttribute("data-page")) || "landing";
  var loadedAt = Date.now();

  function rid() {
    try {
      var a = new Uint8Array(12);
      window.crypto.getRandomValues(a);
      var s = "";
      for (var i = 0; i < a.length; i++) s += ("0" + a[i].toString(16)).slice(-2);
      return s;
    } catch (e) {
      return (Date.now().toString(36) + Math.random().toString(36).slice(2, 12)).slice(0, 24);
    }
  }
  function get(k) {
    try { return window.localStorage.getItem(k); } catch (e) { return null; }
  }
  function put(k, v) {
    try { window.localStorage.setItem(k, v); } catch (e) { /* private mode */ }
  }

  var visitor = get("mm_vid");
  if (!visitor) { visitor = rid(); put("mm_vid", visitor); }
  var session = null;
  try { session = JSON.parse(get("mm_sid") || "null"); } catch (e) { session = null; }
  if (!session || !session.id || loadedAt - session.t > SESSION_IDLE_MS)
    session = { id: rid(), t: loadedAt };
  function touch() { session.t = Date.now(); put("mm_sid", JSON.stringify(session)); }
  touch();

  // Where the visit came from: this URL's utm_*, else the last ones kept.
  var utm = {};
  var fbclid = false;
  try {
    var q = new URLSearchParams(window.location.search);
    var keys = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
    var found = false;
    for (var i = 0; i < keys.length; i++) {
      var v = q.get(keys[i]);
      if (v) { utm[keys[i]] = v.slice(0, 200); found = true; }
    }
    fbclid = q.has("fbclid");
    if (found || fbclid) {
      put("mm_utm", JSON.stringify({ u: utm, fb: fbclid, t: loadedAt }));
    } else {
      var kept = JSON.parse(get("mm_utm") || "null");
      if (kept && loadedAt - kept.t < UTM_DAYS * 86400000) { utm = kept.u || {}; fbclid = !!kept.fb; }
    }
  } catch (e) { /* keep going without attribution */ }
  var referrer = "";
  try {
    if (document.referrer) {
      var r = new URL(document.referrer);
      if (r.host !== window.location.host) referrer = r.hostname;
    }
  } catch (e) { referrer = ""; }

  var queue = [];
  var timer = null;
  function post(batch) {
    var body = JSON.stringify({ events: batch });
    try {
      // text/plain keeps it a simple request: no preflight, and sendBeacon
      // survives the page closing.
      if (navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "text/plain" }))) return;
    } catch (e) { /* fall through to fetch */ }
    try {
      fetch(ENDPOINT, {
        method: "POST", body: body, keepalive: true, mode: "cors", credentials: "omit",
        headers: { "Content-Type": "text/plain" }
      }).catch(function () {});
    } catch (e) { /* nothing else to try */ }
  }
  function flush() {
    clearTimeout(timer);
    while (queue.length) post(queue.splice(0, 20));
  }
  function track(event, label, value, now) {
    try {
      touch();
      queue.push({
        event_id: rid(),
        event: event,
        page: page,
        visitor_id: visitor,
        session_id: session.id,
        label: label == null ? null : String(label).slice(0, 80),
        value: typeof value === "number" && isFinite(value) ? Math.round(value) : null,
        client_at: new Date().toISOString(),
        utm_source: utm.utm_source || null,
        utm_medium: utm.utm_medium || null,
        utm_campaign: utm.utm_campaign || null,
        utm_content: utm.utm_content || null,
        utm_term: utm.utm_term || null,
        has_fbclid: fbclid,
        referrer_host: referrer || null,
        lang: (document.body && document.body.getAttribute("data-lang")) || null,
        path: window.location.pathname
      });
      if (now) flush();
      else { clearTimeout(timer); timer = setTimeout(flush, 800); }
    } catch (e) { /* never break the page */ }
  }
  var once = {};
  function first(key) { if (once[key]) return false; once[key] = true; return true; }
  window.mmTrack = track;

  // The /live page records the click on the reminders' join link and then
  // redirects itself to Zoom; nothing else happens there.
  if (page === "live") {
    track("join_click", null, null, true);
    return;
  }
  // /p1 and /p2, the booking links shared at each pitch: same idea.
  if (page === "pitch") {
    track("pitch_click", (script && script.getAttribute("data-label")) || null, null, true);
    return;
  }
  track("page_view", null, null, true);

  // How far down the page they read.
  var marks = [25, 50, 75, 100];
  function onScroll() {
    try {
      var doc = document.documentElement;
      var seen = (window.scrollY + window.innerHeight) / Math.max(1, doc.scrollHeight);
      for (var i = 0; i < marks.length; i++) {
        if (seen * 100 >= marks[i] - 1 && first("scroll" + marks[i])) track("scroll", null, marks[i]);
      }
    } catch (e) { /* ignore */ }
  }
  window.addEventListener("scroll", onScroll, { passive: true });

  // Clicks: the register buttons, add to calendar, the WhatsApp group.
  document.addEventListener("click", function (ev) {
    try {
      var a = ev.target && ev.target.closest ? ev.target.closest("a") : null;
      if (!a) return;
      var href = a.getAttribute("href") || "";
      if (a.classList.contains("cta")) {
        track("cta_click", a.getAttribute("data-mm-cta") || href, null, true);
      } else if (href.indexOf("calendar.google.com") >= 0) {
        track("calendar_add", "google", null, true);
      } else if (/whatsapp|wa\.me|WHATSAPP_LINK/i.test(href)) {
        track("whatsapp_click", href.indexOf("[") >= 0 ? "placeholder" : "group", null, true);
      }
    } catch (e) { /* ignore */ }
  }, true);

  // The GHL opt-in form: seen, clicked into, submitted.
  var form = document.querySelector('iframe[src*="/widget/form/"]');
  if (form && "IntersectionObserver" in window) {
    // The form is taller than a phone screen, so "seen" is a quarter of it
    // or 200 pixels of it on screen, whichever is less.
    var io = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        var need = Math.min(200, e.boundingClientRect.height * 0.25);
        if (e.isIntersecting && e.intersectionRect.height >= need && first("form_view")) {
          track("form_view");
          io.disconnect();
        }
      }
    }, { threshold: [0, 0.05, 0.1, 0.2, 0.25] });
    io.observe(form);
  }
  window.addEventListener("blur", function () {
    setTimeout(function () {
      try {
        var el = document.activeElement;
        if (form && el === form && first("form_focus")) track("form_focus", null, null, true);
      } catch (e) { /* ignore */ }
    }, 0);
  });
  window.addEventListener("message", function (ev) {
    try {
      var d = ev.data;
      // GHL's form tells its embed a lead was collected with this message.
      if (Array.isArray(d) && d[0] === "set-sticky-contacts" && first("form_submit")) {
        track("form_submit", null, null, true);
        return;
      }
      // The Typeform survey on the thank-you page.
      if (d && typeof d === "object" && /typeform\.com$/.test(new URL(ev.origin).hostname)) {
        if (d.type === "form-started" && first("survey_start")) track("survey_start", null, null, true);
        if (d.type === "form-submit" && first("survey_submit")) track("survey_submit", null, null, true);
      }
    } catch (e) { /* ignore */ }
  });

  // Wistia videos: played, and how much of each was watched.
  try {
    window._wq = window._wq || [];
    window._wq.push({
      id: "_all",
      onReady: function (video) {
        var id = video.hashedId();
        video.bind("play", function () {
          if (first("play" + id)) track("video_play", id);
        });
        video.bind("percentwatchedchanged", function (p) {
          var steps = [25, 50, 75, 95];
          for (var i = 0; i < steps.length; i++) {
            if (p * 100 >= steps[i] && first("watch" + id + steps[i])) track("video_progress", id, steps[i]);
          }
        });
      }
    });
  } catch (e) { /* no Wistia on this page */ }

  // Time on the page: seconds it was actually on screen, sent each time it
  // is hidden (a visitor who checks WhatsApp and comes back keeps adding
  // up). The label ties every send to this one page view; the cockpit
  // keeps the largest.
  var view = rid();
  var shown = 0;
  var since = document.visibilityState === "hidden" ? null : loadedAt;
  function leave() {
    if (since === null) return;
    shown += Date.now() - since;
    since = null;
    track("page_leave", view, Math.min(3600, shown / 1000));
    flush();
  }
  window.addEventListener("pagehide", leave);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") leave();
    else if (since === null) since = Date.now();
  });
})();
