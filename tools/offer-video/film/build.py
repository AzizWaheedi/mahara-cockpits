#!/usr/bin/env python3
"""Writes the website demo film as a HyperFrames project, one per cut.

  python3 film/build.py --lang en|ar [--clean] [--poster] [--bed off|heygen] --out <dir>

Reads, all on the VPS (paths below, or flags):
  --media     ~/upsell-studio-video/website      art, Kling, voice, brand
  --captures  <media>/capture/v2                 PNGs + boxes.json (capture/capture.mjs)
  --lines     film/lines.json                    narrator lines and windows, both languages
  --timing    <media>/voice/<lang>/<slug>/timing.json   word times (VOICE_SLUG: george, mohamed)

The voice is the clock: every cue lands on a word time from the voice's
timing file (ANCHOR_WORDS names the word). A language with no voice yet
(Arabic, until Mohamed is voiced on a paid ElevenLabs plan) times its cues
on the script's windows and plays no narrator; the manifest says so.
--clean leaves the burned captions out; --poster adds the poster title at
33.5 s. --bed is off by default (contract section 8: room tone only).
"""
import argparse
import html
import json
import shutil
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
TOOL = HERE.parent
REPO = TOOL.parent.parent
NM = TOOL / "node_modules"
HOME = Path.home()

W, H = 1920, 1080
FPS = 30

# Deck tokens (present.css), nothing new but motion.
SPACE, DEEP, PANEL = "#091333", "#060d24", "#0e1a42"
TEAL, INK, AMBER = "#00cfc8", "#f2f6fa", "#f5b84b"
LINE, LINE_STRONG = "rgba(255,255,255,0.10)", "rgba(255,255,255,0.22)"

COPY = {
    "tag": ("Example", "مثال"),
    "example_ad": ("Example ad", "إعلان للتوضيح"),
    "firm": ("Hosh Design & Build", "حوش للتصميم والبناء"),
    "sponsored": ("Sponsored", "مُموَّل"),
    "learn": ("Learn more", "معرفة المزيد"),
    "record": ("Example. Captured {date}", "مثال. لقطة بتاريخ {date}"),
    "note": ("The page doesn’t open", "الصفحة ما تفتح"),
    "tb_title": ("Website, Arabic and English", "موقع بالعربي والإنجليزي"),
    "rows": (
        ["Home", "Projects", "A project", "Services", "About", "Contact"],
        ["الرئيسية", "المشاريع", "صفحة مشروع", "الخدمات", "من نحن", "تواصل معنا"],
    ),
    "fit": (
        ["WhatsApp", "Enquiry form", "Tracking, tied to your ads"],
        ["واتساب", "نموذج الاستفسار", "تتبع مربوط بإعلاناتكم"],
    ),
    "care": (
        "Care: hosting, backups, an hour of edits a month",
        "العناية: استضافة، ونسخ احتياطي، وساعة تعديلات بالشهر",
    ),
    "kicker": ("What we need from you", "المطلوب منكم"),
    "need": (
        ["Your logo", "Photos of your projects", "Your list of services"],
        ["شعاركم", "صور مشاريعكم", "قائمة خدماتكم"],
    ),
    "stamp": ("2 weeks from your content", "أسبوعين من وصول المحتوى"),
    "card": (["Your typical project", "This"], ["مشروعكم المعتاد", "هذا"]),
    # Aziz's teleprompter line, word for word (website-script.md); its ".."
    # pause is a comma on screen, as in the captions.
    "closing": (
        "Your account manager will walk you through it.",
        "فريق نجاح العملاء بيمشي معاكم فيها، خطوة خطوة.",
    ),
    "poster": ("Your website, in Arabic and English", "موقعكم، بالعربي والإنجليزي"),
}

AR_DIGITS = str.maketrans("0123456789", "٠١٢٣٤٥٦٧٨٩")
AR_MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"]
EN_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def esc(s):
    return html.escape(s, quote=True)


class Cut:
    def __init__(self, lang):
        self.lang = lang
        self.ar = lang == "ar"
        self.other = "en" if self.ar else "ar"
        self.S = -1 if self.ar else 1  # x direction of "forward"

    def c(self, key):
        v = COPY[key]
        return v[1] if self.ar else v[0]

    def mx(self, x, w):
        """Mirror a box's x for the Arabic cut (start side becomes the right)."""
        return W - x - w if self.ar else x

    def font(self):
        return "'Plex Arabic', 'Geist', sans-serif" if self.ar else "'Geist', sans-serif"

    def num(self, n):
        return str(n).translate(AR_DIGITS) if self.ar else str(n)


# ---------------------------------------------------------------- anchors

# The narrator per language: voice/<lang>/<slug>/timing.json and the WAV
# beside it (written by the voice step on the VPS). Arabic is Mohamed
# (KJe6YIQ4MHI94EGaDZC7) once the ElevenLabs plan allows library voices.
VOICE_SLUG = {"en": "george", "ar": "mohamed"}

# Each cue lands on one spoken word: (line id, word index, seconds added,
# the word as the line spells it[, its index in the line's "voiced" text]).
# The spelling is checked against the voice's own words, so a rewritten line
# stops the build instead of drifting. The fifth field serves a line whose
# approved text (lines.json "text", synced to websiteVideo.ts) the draft
# voice still says in its old words ("voiced"): the cue then reads that word
# in the old take. "before" is the second "they" ("before they meet you"),
# never the first "before".
ANCHOR_WORDS = {
    "en": dict(
        ad=("en-1a", 3, 0, "ad."), this=("en-2b", 2, -0.14, "it's"), six=("en-3b", 2, 0, "six"),
        english=("en-3b", 7, 0, "English."), projects=("en-3c", 1, 0, "projects,"), properly=("en-3c", 3, 0, "properly."),
        whatsapp=("en-3d", 0, 0, "WhatsApp,"), form=("en-3d", 2, 0, "enquiry"), tracking=("en-3d", 5, 0, "tracking."),
        link=("en-3e", 2, 0, "link", 1), before=("en-3e", 13, 0, "they", 13), logo=("en-4b", 0, 0, "Your"),
        photos=("en-4c", 0, 0, "Photos"), services=("en-4d", 0, 0, "Your"), weeks=("en-4e", 2, 0, "two"),
    ),
    "ar": dict(
        ad=("ar-1a", 2, 0, "إعلانكم…"), this=("ar-2d", 0, -0.14, "هذا"), six=("ar-3b", 1, 0, "ست"),
        english=("ar-3b", 4, 0, "والإنجليزي."), projects=("ar-3c", 0, 0, "مشاريعكم"), properly=("ar-3c", 2, 0, "مثل"),
        whatsapp=("ar-3d", 1, 0, "واتساب،"), form=("ar-3d", 2, 0, "وفورم"), tracking=("ar-3d", 4, 0, "وتتبع."),
        link=("ar-3e", 1, 0, "الرابط"), before=("ar-3f", 3, 0, "قبل"), logo=("ar-4b", 0, 0, "شعاركم…"),
        photos=("ar-4c", 0, 0, "صور"), services=("ar-4d", 0, 0, "وقائمة"), weeks=("ar-4e", 1, 0, "أسبوعين"),
    ),
}

# Where each beat ends: a caption never runs over a cut into the next beat.
BEAT_ENDS = (5.0, 15.0, 35.0, 45.0, 52.0, 60.0)


def anchors(cut, timing, script=None):
    """Cue times (absolute seconds), from the voice's word times when the cut
    has a narrator; from the script's windows when it has none yet (Arabic
    until Mohamed is voiced). `script` is lines.json (read from beside this
    file when not given): a timing line that says a line's "voiced" text
    takes the anchor's voiced index."""
    if timing is None:
        if not cut.ar:
            raise SystemExit("The English cut needs its voice's timing file.")
        # «الرابط» is the second word of ar-3e since the 26 Oct copy repair.
        a = dict(ad=1.1, this=13.6, six=18.0, english=19.4, projects=21.0, properly=22.2,
                 whatsapp=23.6, form=24.25, tracking=24.95, link=26.75, before=31.0,
                 logo=37.0, photos=38.2, services=39.6, weeks=41.9)
    else:
        lines = {l["id"]: l for l in timing["lines"]}
        if script is None:
            script = json.loads((HERE / "lines.json").read_text())
        approved = {l["id"]: l for l in script[cut.lang]}
        a = {}
        for key, spec in ANCHOR_WORDS[cut.lang].items():
            lid, i, add, spelled = spec[:4]
            said_text = lines[lid]["text"]
            if said_text != approved[lid]["text"]:
                if said_text != approved[lid].get("voiced"):
                    raise SystemExit(f"{lid}: the voice says a line that is neither its text nor its voiced field in lines.json; re-run the voice step.")
                i = spec[4] if len(spec) > 4 else i
            words = lines[lid]["words"]
            if len(words) != len(lines[lid]["text"].split()):
                raise SystemExit(f"{lid}: the voice's words do not split like the line's text; re-run the voice step.")
            said = words[i]["w"].replace("’", "'")
            if said != spelled:
                raise SystemExit(f"{lid}: cue '{key}' expects word {i} to be '{spelled}', the voice has '{said}'. Update ANCHOR_WORDS.")
            a[key] = words[i]["start"] + add
    a["type"] = 2.75
    # Enter, the result row and its tap all sit before the 5.0 s cut, so the
    # row reads for about half a second (the typing ends near 4.05 s).
    a["enter"] = 4.4
    a["tap"] = 4.85
    a["care"] = a["tracking"] + 0.55
    a["open"] = a["link"] + 0.7
    a["scroll"] = a["link"] + 1.3
    a["ret"] = a["before"] - 0.6
    a["kicker"] = 35.3
    return a


# ---------------------------------------------------------------- shapes

def cloud_path(x, y, w, h, step=34.0, rtl=False):
    """A revision cloud round a box: scallops bulging outward, drawn from the
    top-left clockwise (from the top-right anticlockwise for Arabic)."""
    def edge(p0, p1):
        import math
        d = math.dist(p0, p1)
        n = max(2, round(d / step))
        out = []
        for i in range(1, n + 1):
            px = p0[0] + (p1[0] - p0[0]) * i / n
            py = p0[1] + (p1[1] - p0[1]) * i / n
            r = d / n * 0.62
            out.append(f"A{r:.1f} {r:.1f} 0 0 {0 if rtl else 1} {px:.1f} {py:.1f}")
        return out

    tl, tr, br, bl = (x, y), (x + w, y), (x + w, y + h), (x, y + h)
    pts = [tr, tl, bl, br, tr] if rtl else [tl, tr, br, bl, tl]
    d = [f"M{pts[0][0]:.1f} {pts[0][1]:.1f}"]
    for p0, p1 in zip(pts, pts[1:]):
        d += edge(p0, p1)
    return " ".join(d)


def tri(cid, x, y, letter, color, size=54):
    return (
        f'<div id="{cid}" class="tri" style="left:{x:.0f}px;top:{y:.0f}px;width:{size}px;height:{size}px;color:{color}">'
        f'<svg viewBox="0 0 54 54"><path d="M27 3 L52 50 L2 50 Z" fill="{DEEP}" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/></svg>'
        f"<b>{letter}</b></div>"
    )


MARK_SVG = (
    '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M3 3h26v26H19.5v-4.5H25V7H7v17.5h5.5V29H3z" fill="currentColor"/>'
    '<rect x="12" y="12" width="8" height="8" fill="currentColor"/></svg>'
)
SEARCH_SVG = '<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M15.5 15.5 21 21" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>'
LINK_SVG = '<svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.6 0l3-3a4 4 0 0 0-5.6-5.6l-1 1M14 10a4 4 0 0 0-5.6 0l-3 3a4 4 0 0 0 5.6 5.6l1-1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
TRACK_SVG = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" fill="currentColor"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
CURSOR_SVG = '<svg viewBox="0 0 28 36"><path d="M2 2 L2 29 L9 22.5 L13.5 33 L18 31 L13.6 20.8 L23 20.8 Z" fill="#fff" stroke="#0b0f1a" stroke-width="2" stroke-linejoin="round"/></svg>'


def plate_html(cut, pid, text, near_x, top, color, forward=True):
    """A label plate whose near edge sits at near_x; it runs forward (right in
    English, left in Arabic) or backward. Anchoring the near edge with left or
    right keeps the leader on the plate whatever the text's real width."""
    goes_right = forward != cut.ar
    side = f"left:{near_x:.0f}px" if goes_right else f"right:{W - near_x:.0f}px"
    return (
        f'<div id="{pid}" class="plate" style="{side};top:{top:.0f}px;color:{color};'
        f'box-shadow:0 0 0 1px {color}">{esc(text)}</div>'
    )


def box(x, y, w, h):
    return f"left:{x:.1f}px;top:{y:.1f}px;width:{w:.1f}px;height:{h:.1f}px;"


FONTS_CSS = """
@font-face{font-family:'Geist';src:url('assets/fonts/Geist-Regular.woff2') format('woff2');font-weight:400}
@font-face{font-family:'Geist';src:url('assets/fonts/Geist-Medium.woff2') format('woff2');font-weight:500}
@font-face{font-family:'Geist';src:url('assets/fonts/Geist-SemiBold.woff2') format('woff2');font-weight:600}
@font-face{font-family:'Geist';src:url('assets/fonts/Geist-Bold.woff2') format('woff2');font-weight:700}
@font-face{font-family:'Geist Mono';src:url('assets/fonts/GeistMono-Regular.woff2') format('woff2');font-weight:400}
@font-face{font-family:'Geist Mono';src:url('assets/fonts/GeistMono-Medium.woff2') format('woff2');font-weight:500}
@font-face{font-family:'Plex Arabic';src:url('assets/fonts/plexar-400.woff2') format('woff2');font-weight:400}
@font-face{font-family:'Plex Arabic';src:url('assets/fonts/plexar-500.woff2') format('woff2');font-weight:500}
@font-face{font-family:'Plex Arabic';src:url('assets/fonts/plexar-600.woff2') format('woff2');font-weight:600}
"""


def base_css(cut):
    return f"""
#root{{position:absolute;inset:0;font-family:{cut.font()};color:{INK};direction:{'rtl' if cut.ar else 'ltr'}}}
.abs{{position:absolute}}
.well{{position:absolute;background:{DEEP};box-shadow:0 0 0 1px {LINE_STRONG};overflow:hidden}}
.well > img, .pg{{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover}}
.phone{{position:absolute;padding:12px;border-radius:46px;background:{DEEP};box-shadow:0 0 0 1px {LINE_STRONG}}}
.screen{{position:relative;width:100%;height:100%;overflow:hidden;border-radius:35px;background:#000}}
.island{{position:absolute;top:10px;left:50%;width:30%;height:24px;margin-left:-15%;border-radius:999px;background:#000;box-shadow:0 0 0 1px {LINE};z-index:5}}
.svgo{{position:absolute;left:0;top:0;width:{W}px;height:{H}px;overflow:visible;pointer-events:none}}
.draw{{fill:none;stroke-dasharray:1 1;stroke-dashoffset:1}}
.tri{{position:absolute}}
.tri svg{{position:absolute;inset:0;width:100%;height:100%}}
.tri b{{position:absolute;left:0;right:0;top:20px;text-align:center;font:500 24px/1 'Geist Mono',monospace;direction:ltr}}
.mono{{font-family:{"'Plex Arabic', 'Geist Mono', monospace" if cut.ar else "'Geist Mono', monospace"}}}
.plate{{position:absolute;padding:8px 16px;background:{DEEP};font-size:28px;font-weight:500;line-height:1.25;white-space:nowrap;border-radius:4px}}
"""


def scene(sid, cut, css, body, js, attrs=""):
    return f"""<template>
<style>{FONTS_CSS}{base_css(cut)}{css}</style>
<div id="root" data-composition-id="{sid}" data-width="{W}" data-height="{H}"{attrs}>
{body}
</div>
<script>
(function () {{
  const tl = gsap.timeline({{ paused: true }});
  const S = {cut.S};
{js}
  window.__timelines["{sid}"] = tl;
}})();
</script>
</template>
"""


def draw_js(sel, t, dur=0.64, ease="power2.inOut"):
    # autoRound off: GSAP rounds px values to whole numbers by default, and on a
    # pathLength of 1 that turns the 640 ms draw into a jump from 1 to 0.
    return (
        f'  tl.fromTo("{sel}", {{ strokeDashoffset: 1 }}, {{ strokeDashoffset: 0, autoRound: false, duration: {dur}, '
        f'ease: "{ease}" }}, {t:.3f});\n'
    )


def fade_js(sel, t, dur=0.3, a=0, b=1, ease="power1.out", extra_from="", extra_to="", later=False):
    ir = ", immediateRender: false" if later else ""
    return (
        f'  tl.fromTo("{sel}", {{ opacity: {a}{extra_from} }}, {{ opacity: {b}{extra_to}, duration: {dur}, ease: "{ease}"{ir} }}, {t:.3f});\n'
    )


def hide0(*sels):
    return "".join(f'  gsap.set("{s}", {{ opacity: 0 }});\n' for s in sels)


# ---------------------------------------------------------------- scene 1: hook

def hook(cut, A):
    PH_H = 700
    scr_h = PH_H - 24
    scr_w = scr_h * 390 / 845
    PH_W = scr_w + 24
    px, py = (W - PH_W) / 2, 110
    feed_rest = 56 - 150
    firm = esc(cut.c("firm"))
    letters = "".join(
        f'<span id="h-l{i}" class="ch">{"&nbsp;" if ch == " " else esc(ch)}</span>' for i, ch in enumerate(cut.c("firm"))
    )
    # Arabic is typed as whole growing words would break shaping: each
    # letter span stays in one text run (display toggled), so shaping holds.
    body = f"""
<div id="h-bg" class="abs" style="{box(0, 0, W, H)}overflow:hidden" data-layout-allow-overflow><img id="h-bgi" src="assets/img/bg1.jpg" style="width:100%;height:100%;object-fit:cover;opacity:0.26"></div>
<div id="h-exad" class="abs mono exad" style="{box(0, 62, W, 40)}">{esc(cut.c('example_ad'))}</div>
<div id="h-phw" class="abs" style="{box(px, py, PH_W, PH_H)}transform-origin:{PH_W / 2:.1f}px {12 + 56 + 22:.1f}px" data-layout-allow-overflow>
 <div class="phone" style="{box(0, 0, PH_W, PH_H)}">
  <div class="screen">
   <div id="h-feed" class="abs" style="left:0;top:0;width:100%">
    <div class="prevpost"><img src="assets/img/kitchen-feed.webp"></div>
    <div class="post">
     <div class="ph"><span class="av">{MARK_SVG}</span><span class="who"><b>{firm}</b><small>{esc(cut.c('sponsored'))}</small></span><span class="dots">&middot;&middot;&middot;</span></div>
     <div class="pm" id="h-media">
      <video id="h-k1" class="clip" muted playsinline src="assets/media/k1.mp4" data-start="0" data-duration="2.6" data-track-index="2"></video>
      <div id="h-press" class="abs" style="inset:0;background:#000"></div>
      <div id="h-touch" class="abs touch"></div>
     </div>
     <div class="cta"><span>{esc(cut.c('learn'))}</span><span class="chev">&rsaquo;</span></div>
    </div>
    <div class="post"><div class="ph"><span class="av av2"></span><span class="who"><b class="bar"></b></span></div><div class="nextpic"><img src="assets/img/villa-feed.webp"></div></div>
   </div>
   <div id="h-search" class="abs" style="inset:0;background:#000">
    <div id="h-load" class="abs" style="left:0;top:0;width:100%;height:3px;background:{INK};transform-origin:{'100%' if cut.ar else '0%'} 50%"></div>
    <div class="field"><span class="sg">{SEARCH_SVG}</span><span class="typed">{letters}<i id="h-caret" class="caret"></i></span></div>
    <div id="h-res" class="abs res"><b>{firm}</b><small>hosh.example</small><div id="h-tap" class="abs touch"></div></div>
   </div>
   <div class="island"></div>
  </div>
 </div>
</div>
"""
    css = f"""
.exad{{text-align:center;font-size:28px;letter-spacing:0.04em;color:rgba(242,246,250,0.72)}}
.prevpost{{height:150px;overflow:hidden;border-bottom:1px solid #262626}}
.prevpost img{{width:100%;height:100%;object-fit:cover;object-position:50% 100%}}
.post{{background:#000}}
.ph{{height:56px;display:flex;align-items:center;gap:10px;padding:0 12px;direction:{'rtl' if cut.ar else 'ltr'}}}
.av{{width:34px;height:34px;border-radius:50%;background:#f4f3ef;color:#46553a;display:grid;place-items:center;flex:none}}
.av svg{{width:20px;height:20px}}
.who{{display:flex;flex-direction:column;line-height:1.2;flex:1}}
.who b{{font-size:15px;font-weight:600}}
.who small{{font-size:13px;color:#a8a8a8}}
.dots{{color:#a8a8a8;font-size:18px}}
.av2{{background:#262626}}
.bar{{display:block;width:120px;height:12px;border-radius:6px;background:#262626}}
.nextpic{{height:300px;overflow:hidden}}
.nextpic img{{width:100%;height:100%;object-fit:cover;object-position:50% 0%}}
.pm{{position:relative;width:100%;aspect-ratio:4/5;overflow:hidden;background:#111}}
.pm video{{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}}
.touch{{left:50%;top:52%;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;background:rgba(242,246,250,0.55)}}
.cta{{height:48px;display:flex;align-items:center;justify-content:space-between;padding:0 14px;font-size:15px;font-weight:600;border-bottom:1px solid #262626}}
.chev{{font-size:22px;color:#a8a8a8;{'transform:scaleX(-1);display:inline-block' if cut.ar else ''}}}
.field{{position:absolute;left:14px;right:14px;top:58px;height:46px;border-radius:12px;background:#262626;display:flex;align-items:center;gap:10px;padding:0 14px}}
.sg{{width:20px;height:20px;color:#a8a8a8;flex:none}}
.typed{{font-size:19px;white-space:nowrap;color:#fff}}
.ch{{display:none}}
.caret{{display:inline-block;width:2px;height:22px;margin-inline-start:1px;background:{TEAL};vertical-align:-4px}}
.res{{left:14px;right:14px;top:116px;height:64px;padding:0 14px;border-radius:12px;display:flex;flex-direction:column;justify-content:center;gap:3px;background:#000}}
.res b{{font-size:17px;font-weight:600;color:#fff;white-space:nowrap}}
.res small{{font-size:14px;color:#a8a8a8;direction:ltr;text-align:{'right' if cut.ar else 'left'};unicode-bidi:isolate}}
.res .touch{{left:{70 if cut.ar else 30}%;top:50%}}
"""
    t0 = A["type"]
    n = len(cut.c("firm"))
    js = hide0("#h-search", "#h-press", "#h-touch", "#h-res", "#h-tap")
    js += '  gsap.set("#h-load", { scaleX: 0 });\n'
    js += '  tl.fromTo("#h-bgi", { scale: 1 }, { scale: 1.04, duration: 5, ease: "none" }, 0);\n'
    js += f'  tl.fromTo("#h-feed", {{ y: {feed_rest + 250} }}, {{ y: {feed_rest}, duration: 0.95, ease: "expo.out" }}, 0.12);\n'
    ad = A["ad"]
    js += f'  tl.fromTo("#h-press", {{ opacity: 0 }}, {{ opacity: 0.14, duration: 0.08 }}, {ad:.3f});\n'
    js += f'  tl.to("#h-press", {{ opacity: 0, duration: 0.3, ease: "power1.out" }}, {ad + 0.14:.3f});\n'
    js += f'  tl.fromTo("#h-touch", {{ opacity: 0 }}, {{ opacity: 0.8, duration: 0.08 }}, {ad:.3f});\n'
    js += f'  tl.to("#h-touch", {{ opacity: 0, duration: 0.3 }}, {ad + 0.22:.3f});\n'
    # The cut to the search: the phone pushes in on the field so the name reads.
    js += '  tl.set("#h-feed", { opacity: 0 }, 2.6);\n  tl.set("#h-search", { opacity: 1 }, 2.6);\n'
    js += '  tl.to("#h-exad", { opacity: 0, duration: 0.2 }, 2.5);\n'
    # Close enough that the typed name reads at about 46 px on the film.
    js += '  tl.fromTo("#h-phw", { scale: 1, y: 0 }, { scale: 2.4, y: 260, duration: 0.6, ease: "power3.out" }, 2.6);\n'
    for i in range(n):
        js += f'  tl.set("#h-l{i}", {{ display: "inline" }}, {t0 + i / 14:.3f});\n'
    js += f'  tl.to("#h-load", {{ scaleX: 1, duration: 0.22, ease: "power2.out" }}, {A["enter"]:.3f});\n'
    js += f'  tl.to("#h-load", {{ opacity: 0, duration: 0.15 }}, {A["enter"] + 0.26:.3f});\n'
    # One plain result (no search engine's look) comes in under the field, and
    # the thumb taps it just before the cut to the page it opens.
    js += f'  tl.set("#h-caret", {{ opacity: 0 }}, {A["enter"]:.3f});\n'
    js += f'  tl.fromTo("#h-res", {{ opacity: 0, y: 8 }}, {{ opacity: 1, y: 0, duration: 0.14, ease: "power2.out" }}, {A["enter"] + 0.1:.3f});\n'
    tap = A["tap"]
    js += f'  tl.to("#h-res", {{ backgroundColor: "#1c1c1c", duration: 0.06 }}, {tap:.3f});\n'
    js += f'  tl.fromTo("#h-tap", {{ opacity: 0 }}, {{ opacity: 0.8, duration: 0.06 }}, {tap:.3f});\n'
    js += f'  tl.to("#h-tap", {{ opacity: 0, duration: 0.08 }}, {tap + 0.06:.3f});\n'
    return scene("hook", cut, css, body, js)


# ---------------------------------------------------------------- scene 2: gap

def gap(cut, A, boxes, date_label):
    WW, WH = 1120, 700
    wx, wy = cut.mx(120, WW), 80
    eb = boxes[f"err-{cut.lang}"]
    k0 = WW / eb["page"]["w"]  # capture CSS px to film px
    hb = {key: v * k0 for key, v in eb["h1"].items()}
    ox, oy = hb["x"] + hb["w"] / 2, hb["y"] + hb["h"] / 2
    k = 1.04  # the slow push on the page, held from just before the cloud

    def fy(y_css):
        """A capture y (CSS px) on the film once the push has landed."""
        return wy + oy + (y_css * k0 - oy) * k

    # The cloud hugs the headline. Its scallops bulge about 7 px outward and
    # the Deep halo adds 4.5 px, so its lower edge stops that much plus a clear
    # gap above Chrome's second line ("Check if there is a typo...", measured
    # by the capture). The gap is 16 px from the line's box because Arabic
    # marks ride above it (the shadda in تحقّق sits about 4 px higher), which
    # leaves at least 10 px of page between the halo and any ink.
    BULGE_HALO, CLEAR = 12, 16
    pad_x, pad_top, pad_bot = 30, 8, 8
    h_top, h_bot = fy(eb["h1"]["y"]), fy(eb["h1"]["y"] + eb["h1"]["h"])
    top, bot = h_top - pad_top, h_bot + pad_bot
    if "line2" in eb:
        bot = min(bot, fy(eb["line2"]["y"]) - CLEAR - BULGE_HALO)
    cw, ch = hb["w"] * k + pad_x * 2, bot - top
    cx, cy = wx + ox - cw / 2, top
    d = cloud_path(cx, cy, cw, ch, step=26, rtl=cut.ar)
    mid = cy + ch / 2
    # The leader runs from the note to the cloud's side, so it can start as
    # the note comes in and still meet the cloud after the cloud has passed
    # that point (top edge, then half the near side: power2.inOut inverted).
    if cut.ar:
        note_w = wx - 60 - 120
        note_x = 120
        lead = f"M{wx - 44:.1f} {mid:.1f} H{cx - 4:.1f}"
        tri_x = cx - 30
    else:
        note_x = wx + WW + 60
        note_w = W - 120 - note_x
        lead = f"M{note_x - 16:.1f} {mid:.1f} H{cx + cw + 4:.1f}"
        tri_x = cx + cw - 24
    f_side = (cw + ch / 2) / (2 * cw + 2 * ch)
    tau = (f_side / 2) ** 0.5 if f_side < 0.5 else 1 - ((1 - f_side) / 2) ** 0.5
    cloud_at_side = 0.64 * tau
    tri_y = cy - 44
    t = A["this"] - 5.0
    # The page first fills the middle of the frame, large, while the long line
    # plays; just before "this" it settles (one move) to the start side, which
    # leaves room for the leader and the note on the other side.
    BW = 1160
    s0 = BW / WW
    bx0, by0 = (W - BW) / 2, 52
    move_at = max(t - 1.5, 6.0)
    # Ink is theirs (Rev A); on a white page it keeps a Deep halo underneath.
    body = f"""
<div id="g-move" class="abs" style="{box(wx, wy, WW, WH + 50)}transform-origin:0 0">
<div id="g-well" class="well" style="{box(0, 0, WW, WH)}">
 <img id="g-cap" src="assets/cap/err-{cut.lang}.png" style="transform-origin:{ox:.1f}px {oy:.1f}px">
</div>
<div id="g-rec" class="abs mono rec" style="{box(0, WH + 14, WW, 36)}">{esc(date_label)}</div>
</div>
<svg class="svgo" viewBox="0 0 {W} {H}">
<path id="g-cloudh" class="draw" d="{d}" pathLength="1" stroke="{DEEP}" stroke-width="9" stroke-linejoin="round" stroke-linecap="round"/>
<path id="g-cloud" class="draw" d="{d}" pathLength="1" stroke="{INK}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
<path id="g-leadh" class="draw" d="{lead}" pathLength="1" stroke="{DEEP}" stroke-width="7"/>
<path id="g-lead" class="draw" d="{lead}" pathLength="1" stroke="{INK}" stroke-width="2"/></svg>
{tri("g-tri", tri_x, tri_y, "A", INK)}
<div id="g-note" class="abs note" style="{box(note_x, mid - 30, note_w, 60)}">{esc(cut.c('note'))}</div>
"""
    css = f"""
.rec{{font-size:26px;color:rgba(242,246,250,0.72);text-align:start}}
.note{{font-size:40px;font-weight:500;line-height:60px;text-align:start;white-space:nowrap}}
"""
    js = hide0("#g-tri", "#g-note")
    js += (
        f'  tl.fromTo("#g-move", {{ x: {bx0 - wx:.1f}, y: {by0 - wy:.1f}, scale: {s0:.4f} }}, '
        f'{{ x: 0, y: 0, scale: 1, duration: 0.6, ease: "power3.inOut" }}, {move_at:.3f});\n'
    )
    js += f'  tl.fromTo("#g-cap", {{ scale: 1 }}, {{ scale: {k}, duration: {max(t - 0.2, 6):.2f}, ease: "power1.inOut" }}, 0);\n'
    js += draw_js("#g-cloudh", t) + draw_js("#g-cloud", t)
    # The note comes in early (a plain fade) so it reads before the 15.0 s cut;
    # its leader reaches the cloud just after the cloud has drawn past it.
    lead_end = max(t + 0.35, t + cloud_at_side + 0.04)
    js += draw_js("#g-leadh", t + 0.15, lead_end - t - 0.15, "power2.out") + draw_js("#g-lead", t + 0.15, lead_end - t - 0.15, "power2.out")
    js += fade_js("#g-tri", t + 0.5, 0.16)
    js += fade_js("#g-note", t + 0.2, 0.2)
    return scene("gap", cut, css, body, js)


# ---------------------------------------------------------------- scene 3: what

def what(cut, A, boxes):
    L, O = cut.lang, cut.other
    WW, WH = 984, 700
    s = WW / 1440
    wx, wy = cut.mx(120, WW), 80
    TBW = 636
    tbx = cut.mx(W - 120 - TBW, TBW)
    b = lambda k: boxes[k]
    hp = b(f"index-{L}")["hero-pic"]
    hx, hy, hw = wx + hp["x"] * s, wy + hp["y"] * s, hp["w"] * s
    k2s = hw / W
    # Phones inside the well.
    PH_H = 640
    scr_w = (PH_H - 24) * 390 / 845
    PH_W = scr_w + 24
    phx, phy = wx + (WW - PH_W) / 2, wy + (WH - PH_H) / 2
    sc = scr_w / 390
    scr_x, scr_y = phx + 12, phy + 12
    wa = b(f"phone-{L}")["wa-float"]
    wa_x, wa_y, wa_w, wa_h = scr_x + wa["x"] * sc, scr_y + wa["y"] * sc, wa["w"] * sc, wa["h"] * sc
    tall = b(f"phonetall-{L}")
    tall_h = tall["page"]["h"] * sc
    scroll = tall["strip"]["y"] * sc - 40
    # Language switch on the first home.
    ls = b(f"index-{L}")["lang-switch"]
    cur_to = (wx + (ls["x"] + ls["w"] / 2) * s, wy + (ls["y"] + ls["h"] / 2) * s)
    cur_from = (wx + WW * (0.42 if cut.ar else 0.58), wy + WH * 0.62)
    # Form and tracking on the contact page.
    fm = b(f"contact-{L}")["form"]
    fn = b(f"contact-{L}")["foot-note"]
    form_edge_x = wx + (fm["x"] + (0 if cut.ar else fm["w"])) * s
    form_y = wy + (fm["y"] + fm["h"] * 0.5) * s
    icon_c = (wx + (fn["x"] + (fn["w"] + 26 if cut.ar else -26)) * s, wy + (fn["y"] + fn["h"] / 2) * s)

    fit = cut.c("fit")
    # WhatsApp: the leader leaves the button on its outward side.
    if cut.ar:
        wa_pt = (wa_x - 4, wa_y + wa_h / 2)
        wa_lab_x = wa_pt[0] - 56
    else:
        wa_pt = (wa_x + wa_w + 4, wa_y + wa_h / 2)
        wa_lab_x = wa_pt[0] + 56
    p_wa = plate_html(cut, "w-p1", fit[0], wa_lab_x, wa_pt[1] - 26, TEAL)
    wa_lead = f"M{wa_pt[0]:.1f} {wa_pt[1]:.1f} H{wa_lab_x + (6 if cut.ar else -6):.1f}"
    # Form.
    f_pt = (form_edge_x + (-6 if cut.ar else 6), form_y)
    f_lab_x = f_pt[0] + (-60 if cut.ar else 60)
    p_form = plate_html(cut, "w-p2", fit[1], f_lab_x, form_y - 26, TEAL)
    form_lead = f"M{f_pt[0]:.1f} {f_pt[1]:.1f} H{f_lab_x + (6 if cut.ar else -6):.1f}"
    # Tracking: the label sits above its mark.
    trk_y = icon_c[1] - 70
    # Centred over its mark by a flex row, so no CSS transform meets GSAP.
    p_trk = (
        f'<div id="w-p3" class="abs" style="{box(icon_c[0] - 320, trk_y - 26, 640, 54)}display:flex;justify-content:center">'
        f'<div class="plate" style="position:relative;color:{TEAL};box-shadow:0 0 0 1px {TEAL}">{esc(fit[2])}</div></div>'
    )
    trk_lead = f"M{icon_c[0]:.1f} {trk_y + 26:.1f} V{icon_c[1] - 17:.1f}"
    # Rev B round the finished home, inside the 90% safe frame (x 96 to 1824,
    # y 54 to 1026) so a 1.91:1 link preview of the 33.5 s poster keeps it:
    # 12 px out from the well, scallops bulge about 10 px more. The B sits on
    # the cloud's top corner (its apex 1.75 px above its box with the stroke).
    pad = 12
    dB = cloud_path(wx - pad, wy - pad, WW + 2 * pad, WH + 2 * pad, step=40, rtl=cut.ar)
    corner_x = (wx - pad) if cut.ar else (wx + WW + pad)
    triB_x = corner_x + 5 * cut.S - 27
    triB_y = max(wy - pad - 14, 54 - 1.75 + 0.5)

    rows = cut.c("rows")
    rows_html = "".join(
        f'<div id="w-r{i + 1}" class="tbr"><span class="n mono">{cut.num(i + 1)}</span><span class="t">{esc(r)}</span></div>'
        for i, r in enumerate(rows)
    )
    fits_html = "".join(
        f'<div id="w-f{i + 1}" class="tbr fit"><span class="n"><i></i></span><span class="t">{esc(f)}</span></div>'
        for i, f in enumerate(fit)
    )
    body = f"""
<div id="w-well" class="well" style="{box(wx, wy, WW, WH)}">
 <img id="w-home1" class="pg" src="assets/cap/index-{L}.png">
 <img id="w-home2" class="pg" src="assets/cap/index-{O}.png">
 <img id="w-projects" class="pg" src="assets/cap/projects-{L}.png">
 <img id="w-project" class="pg" src="assets/cap/project-{L}.png">
 <img id="w-contact" class="pg" src="assets/cap/contact-{L}.png">
 <img id="w-homeB" class="pg" src="assets/cap/index-{L}.png">
</div>
<div id="w-phA" class="phone" style="{box(phx, phy, PH_W, PH_H)}"><div class="screen"><img src="assets/cap/phone-{L}.png" style="width:100%;height:100%;object-fit:cover;object-position:top"></div><div class="island"></div></div>
<div id="w-phB" class="phone" style="{box(phx, phy, PH_W, PH_H)}"><div class="screen" style="background:{DEEP}">
 <div id="w-tallw" class="abs" style="left:0;top:0;width:100%;height:{tall_h:.1f}px" data-layout-allow-overflow><img id="w-tall" src="assets/cap/phonetall-{L}.png" style="width:100%;height:{tall_h:.1f}px;display:block"></div>
 <div id="w-chip" class="abs" style="left:0;right:0;top:44%;display:flex;justify-content:center"><div class="chip"><span class="lk">{LINK_SVG}</span><span>hosh.example</span></div></div>
</div><div class="island"></div></div>
<div id="w-k2w" class="abs" style="{box(0, 0, W, H)}transform-origin:0 0" data-layout-allow-overflow>
 <video id="w-k2" class="clip" muted playsinline src="assets/media/k2.mp4" data-start="0" data-duration="2.6" data-track-index="2" style="position:absolute;left:0;top:0;width:{W}px;height:{H}px;object-fit:cover"></video>
</div>
<div id="w-tb" class="abs tb" style="left:{tbx}px;top:{wy}px;width:{TBW}px">
 <div class="tbh"><b>{esc(cut.c('tb_title'))}</b><span class="rev mono">Rev B</span></div>
 {rows_html}
 <div class="tbsep"></div>
 {fits_html}
 <div id="w-care" class="tbf">{esc(cut.c('care'))}</div>
</div>
<div id="w-trk" class="abs trk" style="{box(icon_c[0] - 15, icon_c[1] - 15, 30, 30)}">{TRACK_SVG}</div>
{p_wa}{p_form}{p_trk}
<svg class="svgo" viewBox="0 0 {W} {H}">
 <path id="w-l1" class="draw" d="{wa_lead}" pathLength="1" stroke="{TEAL}" stroke-width="2"/>
 <path id="w-l2" class="draw" d="{form_lead}" pathLength="1" stroke="{TEAL}" stroke-width="2"/>
 <path id="w-l3" class="draw" d="{trk_lead}" pathLength="1" stroke="{TEAL}" stroke-width="2"/>
 <path id="w-cloud" class="draw" d="{dB}" pathLength="1" stroke="{TEAL}" stroke-width="3" stroke-linejoin="round"/>
</svg>
{tri("w-tri", triB_x, triB_y, "B", TEAL)}
<div id="w-cur" class="abs" style="left:0;top:0;width:28px;height:36px">{CURSOR_SVG}</div>
"""
    css = f"""
.tb{{background:{PANEL};box-shadow:0 0 0 1px {LINE_STRONG}}}
.tbh{{display:flex;align-items:center;justify-content:space-between;gap:16px;height:76px;padding:0 24px;border-bottom:1px solid {LINE_STRONG}}}
.tbh b{{font-size:30px;font-weight:600}}
.rev{{font-size:26px;color:{TEAL};direction:ltr}}
.tbr{{display:flex;align-items:center;height:54px;border-bottom:1px solid {LINE};font-size:28px}}
.tbr .n{{width:72px;flex:none;text-align:center;font-size:26px;color:rgba(242,246,250,0.6);border-inline-end:1px solid {LINE};height:100%;display:grid;place-items:center}}
.tbr .t{{padding:0 20px;color:rgba(242,246,250,0.78)}}
.tbr.fit .n i{{display:block;width:12px;height:12px;background:{TEAL}}}
.tbr.fit .t{{color:{INK}}}
.tbsep{{height:10px;border-bottom:1px solid {LINE_STRONG}}}
.tbf{{padding:18px 24px 20px;font-size:26px;line-height:1.35;color:rgba(242,246,250,0.86)}}
.chip{{display:flex;align-items:center;gap:10px;padding:12px 18px;border-radius:999px;background:{PANEL};box-shadow:0 0 0 1px {LINE_STRONG};font:500 22px 'Geist Mono',monospace;white-space:nowrap;direction:ltr}}
.lk{{width:22px;height:22px;color:{TEAL}}}
.trk{{color:{TEAL}}}
.trk svg{{width:100%;height:100%}}
#w-cur svg{{width:100%;height:100%}}
"""
    T = lambda key: A[key] - 15.0
    pages = ["#w-home2", "#w-projects", "#w-project", "#w-contact", "#w-homeB"]
    js = hide0("#w-well", "#w-tb", "#w-phA", "#w-phB", "#w-trk", "#w-p1", "#w-p2", "#w-p3", "#w-tri", "#w-cur", "#w-tallw", "#w-chip", *pages)
    js += hide0(*[f"#w-r{i}" for i in range(1, 7)], *[f"#w-f{i}" for i in range(1, 4)])
    js += f'  gsap.set("#w-care", {{ clipPath: "{"inset(0% 0% 0% 100%)" if cut.ar else "inset(0% 100% 0% 0%)"}" }});\n'
    js += f'  gsap.set("#w-cur", {{ x: {cur_from[0]:.1f}, y: {cur_from[1]:.1f} }});\n'
    # Kling 2 full frame, then it becomes the home page's hero.
    js += f'  tl.fromTo("#w-k2w", {{ x: 0, y: 0, scale: 1 }}, {{ x: {hx:.2f}, y: {hy:.2f}, scale: {k2s:.5f}, duration: 0.6, ease: "power2.inOut" }}, 2.0);\n'
    js += fade_js("#w-well", 2.0, 0.45)
    js += fade_js("#w-tb", 2.6, 0.35)
    for i in range(6):
        js += f'  tl.fromTo("#w-r{i + 1}", {{ opacity: 0, x: {-10 * cut.S} }}, {{ opacity: 1, x: 0, duration: 0.3, ease: "expo.out" }}, {T("six") + 0.08 * i:.3f});\n'

    def lit(i, t):
        return (
            f'  tl.to("#w-r{i} .n", {{ color: "{TEAL}", duration: 0.2 }}, {t:.3f});\n'
            f'  tl.to("#w-r{i} .t", {{ color: "{INK}", duration: 0.2 }}, {t:.3f});\n'
        )

    js += lit(1, T("six") + 0.1)
    # The language switch.
    e = T("english")
    js += fade_js("#w-cur", e - 1.0, 0.2)
    js += f'  tl.to("#w-cur", {{ x: {cur_to[0] - 4:.1f}, y: {cur_to[1] - 2:.1f}, duration: 0.72, ease: "power2.inOut" }}, {e - 0.8:.3f});\n'
    js += f'  tl.to("#w-cur", {{ scale: 0.86, duration: 0.06 }}, {e:.3f});\n  tl.to("#w-cur", {{ scale: 1, duration: 0.14 }}, {e + 0.07:.3f});\n'
    js += f'  tl.set("#w-home2", {{ opacity: 1 }}, {e + 0.06:.3f});\n'
    js += f'  tl.to("#w-cur", {{ opacity: 0, duration: 0.2 }}, {T("projects") - 0.4:.3f});\n'
    # Projects, then one project. Each new page comes in fully opaque behind a
    # wipe that travels against the reading direction (a page turn: from the
    # right in English, from the left in Arabic), so no frame ever shows two
    # pages at part opacity.
    wipe_from = "inset(0% 100% 0% 0%)" if cut.ar else "inset(0% 0% 0% 100%)"
    for sel, key, row in (("#w-projects", "projects", 2), ("#w-project", "properly", 3)):
        js += (f'  tl.fromTo("{sel}", {{ opacity: 1, clipPath: "{wipe_from}" }}, {{ opacity: 1, clipPath: "inset(0% 0% 0% 0%)", '
               f'duration: 0.4, ease: "expo.out", immediateRender: false }}, {T(key):.3f});\n')
        js += lit(row, T(key) + 0.1)
    # WhatsApp on the phone.
    # The phone leads its word a little and its label lands quickly, so the
    # label holds about a second even where the next word follows close
    # (the Arabic line names all three in 2 s).
    t = T("whatsapp") - 0.15
    js += f'  tl.to("#w-well", {{ opacity: 0, duration: 0.15 }}, {t - 0.15:.3f});\n'
    js += f'  tl.fromTo("#w-phA", {{ opacity: 0, y: 24 }}, {{ opacity: 1, y: 0, duration: 0.35, ease: "expo.out" }}, {t:.3f});\n'
    js += draw_js("#w-l1", t + 0.15, 0.2, "power2.out") + fade_js("#w-p1", t + 0.25, 0.15)
    js += f'  tl.fromTo("#w-f1", {{ opacity: 0, x: {-10 * cut.S} }}, {{ opacity: 1, x: 0, duration: 0.3, ease: "expo.out" }}, {t + 0.1:.3f});\n'
    # The enquiry form: the phone has fully gone before the contact page
    # comes up in the well, alone.
    t = T("form")
    js += f'  tl.to(["#w-phA", "#w-p1", "#w-l1"], {{ opacity: 0, duration: 0.15 }}, {t + 0.15:.3f});\n'
    js += f'  tl.set(["#w-home1", "#w-home2", "#w-projects", "#w-project"], {{ opacity: 0 }}, {t:.3f});\n'
    js += f'  tl.set("#w-contact", {{ opacity: 1 }}, {t:.3f});\n'
    js += fade_js("#w-well", t + 0.3, 0.22, later=True)
    js += draw_js("#w-l2", t + 0.5, 0.25, "power2.out") + fade_js("#w-p2", t + 0.62, 0.18)
    js += f'  tl.fromTo("#w-f2", {{ opacity: 0, x: {-10 * cut.S} }}, {{ opacity: 1, x: 0, duration: 0.3, ease: "expo.out" }}, {t + 0.1:.3f});\n'
    js += lit(6, t + 0.1)
    # Tracking, in the footer.
    t = T("tracking") - 0.25
    js += fade_js("#w-trk", t, 0.2, extra_from=", scale: 0.8", extra_to=", scale: 1")
    js += draw_js("#w-l3", t + 0.15, 0.2, "power2.out") + fade_js("#w-p3", t + 0.28, 0.18)
    js += f'  tl.fromTo("#w-f3", {{ opacity: 0, x: {-10 * cut.S} }}, {{ opacity: 1, x: 0, duration: 0.3, ease: "expo.out" }}, {t + 0.1:.3f});\n'
    js += f'  tl.to("#w-care", {{ clipPath: "inset(0% 0% 0% 0%)", duration: 0.7, ease: "none" }}, {T("care"):.3f});\n'
    # The link: it arrives in the phone, the site opens, one scroll.
    t = T("link")
    js += f'  tl.to(["#w-well", "#w-trk", "#w-p2", "#w-p3", "#w-l2", "#w-l3"], {{ opacity: 0, duration: 0.15 }}, {t - 0.05:.3f});\n'
    js += fade_js("#w-phB", t + 0.1, 0.25)
    js += f'  tl.fromTo("#w-chip", {{ opacity: 0, y: -60 }}, {{ opacity: 1, y: 0, duration: 0.45, ease: "expo.out" }}, {t + 0.18:.3f});\n'
    js += f'  tl.to("#w-chip", {{ opacity: 0, duration: 0.15 }}, {T("open"):.3f});\n'
    js += f'  tl.fromTo("#w-tallw", {{ opacity: 0, scale: 0.96 }}, {{ opacity: 1, scale: 1, duration: 0.35, ease: "power2.out" }}, {T("open"):.3f});\n'
    js += f'  tl.fromTo("#w-tall", {{ y: 0 }}, {{ y: {-scroll:.1f}, duration: 1.8, ease: "power2.inOut" }}, {T("scroll"):.3f});\n'
    # Back to the finished home, and Rev B.
    t = T("ret")
    js += f'  tl.to("#w-phB", {{ opacity: 0, duration: 0.15 }}, {t:.3f});\n'
    js += f'  tl.set("#w-contact", {{ opacity: 0 }}, {t:.3f});\n'
    js += f'  tl.set("#w-homeB", {{ opacity: 1 }}, {t:.3f});\n'
    js += fade_js("#w-well", t + 0.15, 0.3, later=True)
    t = T("before")
    js += draw_js("#w-cloud", t) + fade_js("#w-tri", t + 0.5, 0.16)
    for i in (4, 5):
        js += lit(i, t + 0.2 + 0.05 * i)
    return scene("what", cut, css, body, js, ' data-hold="true"')


# ---------------------------------------------------------------- scene 4: need

def need(cut, A, boxes):
    L = cut.lang
    WH = 720
    s = WH / 1024
    WW = 1440 * s
    wx, wy = (W - WW) / 2, 106
    # Where scene 3 left the well.
    p_w, p_h = 984, 700
    p_x = cut.mx(120, p_w)
    k0 = p_w / WW
    b = boxes[f"index-{L}"]
    br = b["brand"]
    origin = (br["x"] + br["w"] / 2, br["y"] + br["h"] / 2)  # the push holds the logo still
    PUSH = 1.025

    def film(px, py):
        qx = origin[0] + (px - origin[0]) * PUSH
        qy = origin[1] + (py - origin[1]) * PUSH
        return wx + qx * s, wy + qy * s

    labels = cut.c("need")
    mirror = (lambda x: 1440 - x) if cut.ar else (lambda x: x)
    # Targets: the logo's foot, a tile's top edge, the services row's top.
    t1 = film(br["x"] + br["w"] / 2, br["y"] + br["h"] + 4)
    st = b["strip"]
    t2 = film(mirror(56 + (1328 / 4) * 1.5), st["y"] + 44)
    sv = b["services-row"]
    t3 = film(mirror(sv["x"] + sv["w"] * 0.45), sv["y"])
    pl = ""
    leads = ""
    # (target, near edge offset forward, plate top offset): plates run forward
    # from their near edge; the leader meets that edge's top or bottom corner.
    for i, ((tx, ty), dx, dy) in enumerate(((t1, 40, 46), (t2, 40, -96), (t3, 40, -84))):
        nx, top = tx + dx * cut.S, ty + dy
        ey = top if top > ty else top + 52
        pl += plate_html(cut, f"n-p{i + 1}", labels[i], nx, top, AMBER)
        leads += f'<path id="n-l{i + 1}" class="draw" d="M{tx:.1f} {ty:.1f} L{nx:.1f} {ey:.1f}" pathLength="1" stroke="{AMBER}" stroke-width="2"/>'
        leads += f'<circle id="n-d{i + 1}" cx="{tx:.1f}" cy="{ty:.1f}" r="6" fill="none" stroke="{AMBER}" stroke-width="2"/>'
    stx = wx - 36 - 300 if cut.ar else wx + WW + 36
    body = f"""
<div id="n-kick" class="abs kick" style="{box(0, 40, W, 50)}">{esc(cut.c('kicker'))}</div>
<div id="n-wellw" class="abs" style="{box(wx, wy, WW, WH)}transform-origin:{('100%' if cut.ar else '0%')} 0%">
 <div class="well" style="{box(0, 0, WW, WH)}"><img id="n-home" class="pg" src="assets/cap/index-{L}.png" style="transform-origin:{origin[0] * s:.1f}px {origin[1] * s:.1f}px"></div>
</div>
<svg class="svgo" viewBox="0 0 {W} {H}">{leads}</svg>
{pl}
<div id="n-stamp" class="abs stamp mono" style="{box(stx, wy + WH - 150, 300, 110)}">{esc(cut.c('stamp'))}</div>
"""
    css = f"""
.kick{{text-align:center;font-size:40px;font-weight:600;color:{AMBER};line-height:50px}}
.stamp{{display:flex;align-items:center;justify-content:center;text-align:center;padding:0 20px;font-size:28px;line-height:1.3;color:{AMBER};box-shadow:inset 0 0 0 2px {AMBER}}}
"""
    T = lambda key: A[key] - 35.0
    # Scene 3's well (left or right) grows into this one in one move.
    sx0 = p_x - wx if not cut.ar else (p_x + p_w) - (wx + WW)
    js = hide0("#n-kick", "#n-stamp", "#n-p1", "#n-p2", "#n-p3", "#n-d1", "#n-d2", "#n-d3")
    js += f'  tl.fromTo("#n-wellw", {{ x: {sx0:.1f}, y: {80 - wy:.1f}, scale: {k0:.4f} }}, {{ x: 0, y: 0, scale: 1, duration: 0.55, ease: "power3.inOut" }}, 0);\n'
    js += f'  tl.fromTo("#n-home", {{ scale: 1 }}, {{ scale: {PUSH}, duration: 1.4, ease: "power2.out" }}, 0.5);\n'
    js += fade_js("#n-kick", T("kicker"), 0.2, extra_from=', filter: "blur(8px)"', extra_to=', filter: "blur(0px)"')
    for i, key in enumerate(("logo", "photos", "services")):
        t = T(key) + 0.1
        js += fade_js(f"#n-d{i + 1}", t, 0.12)
        js += draw_js(f"#n-l{i + 1}", t, 0.25, "power2.out")
        js += fade_js(f"#n-p{i + 1}", t + 0.12, 0.18)
    js += f'  tl.fromTo("#n-stamp", {{ opacity: 0, scale: 1.08 }}, {{ opacity: 1, scale: 1, duration: 0.18, ease: "power3.out" }}, {T("weeks"):.3f});\n'
    return scene("need", cut, css, body, js, ' data-hold="true"')


# ---------------------------------------------------------------- scene 5: close

def close(cut, A):
    cl = cut.c("card")
    # Each line shows what it means: one of their projects beside "Your typical
    # project", the finished home page beside "This". The value stays a blank
    # rule to be filled with their own numbers on the call: no figure is shown.
    thumbs = (("assets/img/hero-card.jpg", "50% 60%"), (f"assets/cap/index-{cut.lang}.png", "50% 0%"))
    rows = "".join(
        f'<div class="crow"><span class="ct"><img src="{src}" style="object-position:{pos}"></span>'
        f'<span class="cl">{esc(t)}</span><span class="cv"></span></div>'
        for t, (src, pos) in zip(cl, thumbs)
    )
    body = f"""
<div id="c-cardw" class="abs" style="{box(300, 190, 1320, 440)}">
 <div class="card">{rows}</div>
</div>
<div id="c-ph" class="abs" style="{box(0, 0, W, H)}">
 <div id="c-phi" class="abs" style="{box(0, 0, W, H)}">
  <img src="assets/brand/mark.png" class="abs" style="{box(W / 2 - 56, 250, 112, 112)}">
  <div class="abs closing" style="{box(160, 410, W - 320, 140)}">{esc(cut.c('closing'))}</div>
 </div>
</div>
<div id="c-lock" class="abs" style="{box(0, 0, W, H)};background:{SPACE}">
 <img src="assets/brand/lockup.png" class="abs" style="{box(W / 2 - 450, H / 2 - 120 - 40, 900, 240)}object-fit:contain">
</div>
"""
    css = f"""
.card{{position:absolute;inset:0;background:{PANEL};box-shadow:0 0 0 1px {LINE_STRONG};padding:0 48px;display:flex;flex-direction:column;justify-content:center}}
.crow{{display:flex;align-items:center;gap:40px;height:190px;border-bottom:1px solid {LINE}}}
.crow:last-child{{border-bottom:0}}
.ct{{width:236px;height:140px;flex:none;overflow:hidden;background:{DEEP};box-shadow:0 0 0 1px {LINE_STRONG}}}
.ct img{{width:100%;height:100%;object-fit:cover;object-position:50% 0%;display:block}}
.cl{{flex:1;font-size:{52 if cut.ar else 48}px;font-weight:500}}
.cv{{width:300px;height:84px;flex:none;border-bottom:2px solid rgba(242,246,250,0.34)}}
.closing{{text-align:center;font-size:{56 if cut.ar else 54}px;font-weight:500;line-height:1.3}}
"""
    js = hide0("#c-ph", "#c-lock")
    js += '  tl.fromTo("#c-cardw", { scale: 1 }, { scale: 1.03, duration: 1.6, ease: "power2.out" }, 0);\n'
    js += '  tl.set("#c-cardw", { opacity: 0 }, 7.0);\n'
    js += fade_js("#c-ph", 7.0, 0.4)
    js += '  tl.fromTo("#c-phi", { scale: 1 }, { scale: 1.025, duration: 7.0, ease: "none" }, 7.0);\n'
    js += '  tl.set("#c-lock", { opacity: 1 }, 14.0);\n'
    return scene("close", cut, css, body, js, ' data-hold="true"')


# ---------------------------------------------------------------- overlays

def tag_scene(cut):
    body = f'<div id="t-tag" class="abs mono tagx" style="{box(cut.mx(W - 120 - 400, 400), 28, 400, 40)}">{esc(cut.c("tag"))}</div>'
    css = ".tagx{font-size:28px;letter-spacing:0.06em;color:rgba(242,246,250,0.7);text-align:end}"
    # The demo firm is on screen to 52 s (the 45 to 52 s card shows its hero
    # project and home page); the close card and the lockup carry no tag.
    return scene("tag", cut, css, body, '  tl.fromTo("#t-tag", { opacity: 1 }, { opacity: 1, duration: 52 }, 0);\n')


def screen_text(cut, text):
    """A line as captions show it: curly apostrophes; the script's pause
    ellipsis becomes a comma in Arabic and goes at a line's end."""
    if cut.ar:
        return text.rstrip("…").replace("…", "،").strip()
    return text.replace("'", "’")


def beat_end_after(t):
    return next(b for b in BEAT_ENDS if b > t + 1e-6)


def caption_groups(cut, lines, timing):
    """One caption per line. With a narrator, each sits on the voice's own
    speech; without one (Arabic until it is voiced), on the script's windows.
    No caption crosses the cut into the next beat: it ends 0.15 s before the
    beat that its speech ends in."""
    groups = []
    src = [l for l in lines[cut.lang] if not l.get("placeholder")]
    tl = {l["id"]: l for l in timing["lines"]} if timing else None
    for i, l in enumerate(src):
        if tl:
            t = tl[l["id"]]
            nxt = tl[src[i + 1]["id"]]["speech_start"] if i + 1 < len(src) else 59.0
            start, spoken_end = t["speech_start"] - 0.05, t["speech_end"]
            end = min(spoken_end + 0.35, nxt - 0.08)
        else:
            nxt = src[i + 1]["window"][0] if i + 1 < len(src) else 59.0
            start, spoken_end = l["window"][0] - 0.05, l["window"][1]
            end = min(max(spoken_end + 0.8, start + 1.2), nxt - 0.08)
        end = min(end, beat_end_after(spoken_end) - 0.15)
        groups.append((start, end, screen_text(cut, l["text"])))
    return groups


def closing_cue(cut, lines, timing):
    """The narrator's closing line (read over the placeholder card) for the
    caption file only: the card already shows the words on screen."""
    if not timing:
        return None
    tl = {l["id"]: l for l in timing["lines"]}
    for l in lines[cut.lang]:
        if l.get("placeholder") and l["id"] in tl:
            t = tl[l["id"]]
            return (t["speech_start"] - 0.05, t["words"][-1]["end"] + 0.02, screen_text(cut, l["text"]))
    return None


def captions_scene(cut, groups):
    els = ""
    for i, (a, b, text) in enumerate(groups):
        els += (
            f'<div id="cap-{i}" class="clip capg" data-start="{a:.3f}" data-duration="{b - a:.3f}" data-track-index="{i % 2}">'
            f'<span class="capt">{esc(text)}</span></div>\n'
        )
    css = f"""
.capg{{position:absolute;left:0;right:0;bottom:{H - 968}px;text-align:center}}
.capt{{display:inline-block;max-width:1420px;padding:10px 28px 12px;background:rgba(6,13,36,0.94);border-radius:6px;font-size:{42 if cut.ar else 40}px;line-height:1.3;font-weight:400;color:{INK}}}
"""
    return scene("captions", cut, css, els, "")


# ---------------------------------------------------------------- audio

def sh(cmd):
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def make_audio(cut, A, out, sfx_dir):
    """Key ticks under the typing, one click on the language switch, room tone."""
    key = sfx_dir / "key-press.mp3"
    click = sfx_dir / "click-soft.mp3"
    n = len(cut.c("firm"))
    ticks = [A["type"] + i / 14 for i, ch in enumerate(cut.c("firm")) if ch != " "]
    ticks.append(A["enter"])
    rates = [1.0, 1.04, 0.96]
    parts, labels = [], []
    for i, t in enumerate(ticks):
        r = rates[i % 3] if i < len(ticks) - 1 else 0.9
        g = 0.38 if i < len(ticks) - 1 else 0.5
        parts.append(
            f"[k{i}]asetrate=48000*{r},aresample=48000,volume={g},adelay={int((t + 1 / FPS) * 1000)}|{int((t + 1 / FPS) * 1000)}[d{i}]"
        )
        labels.append(f"[d{i}]")
    split = f"[0:a]aresample=48000,aformat=channel_layouts=stereo,asplit={len(ticks)}" + "".join(f"[k{i}]" for i in range(len(ticks)))
    fc = ";".join([split] + parts) + ";" + "".join(labels) + f"amix=inputs={len(ticks)}:normalize=0,apad=whole_dur=8[o]"
    sh(["ffmpeg", "-y", "-v", "error", "-i", str(key), "-filter_complex", fc, "-map", "[o]", "-t", "8", "-ar", "48000", str(out / "keys.wav")])
    del n
    ms = int((A["english"] + 1 / FPS) * 1000)
    sh(["ffmpeg", "-y", "-v", "error", "-i", str(click), "-af", f"aresample=48000,aformat=channel_layouts=stereo,volume=0.7,adelay={ms}|{ms},apad=whole_dur=24", "-t", "24", str(out / "click.wav")])
    # Room tone: low and soft, a little lower under the gap, opening at 15 s.
    sh([
        "ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "anoisesrc=d=60:c=brown:r=48000:a=0.6:s=7",
        "-af", "highpass=f=45,lowpass=f=360,volume=-40dB,volume='if(between(t,5,15),0.55,1)':eval=frame,afade=t=in:d=0.6,afade=t=out:st=58.5:d=1.5,aformat=channel_layouts=stereo",
        "-t", "60", str(out / "room.wav"),
    ])


# The music bed. Contract section 8 allows only an ElevenLabs music bed made
# on a plan whose terms cover commercial use; otherwise no music, room tone
# only. The account is on the free plan (26 Oct), so cuts render with the bed
# OFF. `--bed heygen` puts the HeyGen catalog track below back for an
# internal listen only: its licence for use outside HeyGen is unconfirmed,
# and a cut made with it must never reach a client.
# Placed so its first full bar lands at 15.0 s when the site appears; near
# silence under the gap; from 15.0 it opens, ducks under the narrator
# (sidechain on the voice) and fades over the last 1.5 s under the lockup.
BED = {
    "file": "music/heygen-e43a0bf5.wav",
    "id": "e43a0bf5382944a7974b2d788be048b2",
    "entry_s": 10.25,  # the track's first full bar (momentary loudness jumps 9 dB)
    "opens_at": 15.0,
}


def make_bed(media, out, vo_wav):
    src = media / BED["file"]
    lead = BED["opens_at"] - BED["entry_s"]
    ms = int(round(lead * 1000))
    # Gains in dB: (under the gap, open), and the ramp between. With a
    # narrator the open bed sits about 8 LU under the voice and opens on the
    # cut in 0.4 s; with none (Arabic, until it is voiced) it sits higher but
    # rises over 1.5 s from 14.0 s, so the site's first bar does not slam in
    # on a phone speaker.
    if vo_wav:
        (g_gap, g_open), ramp_at, ramp = (-19.0, -14.5), BED["opens_at"], 0.4
    else:
        (g_gap, g_open), ramp_at, ramp = (-14.0, -9.0), 14.0, 1.5
    a, b = 10 ** (g_gap / 20), 10 ** (g_open / 20)
    o = ramp_at
    vol = f"volume='if(lt(t,{o}),{a:.5f},if(lt(t,{o + ramp}),{a:.5f}+({b:.5f}-{a:.5f})*(t-{o})/{ramp},{b:.5f}))':eval=frame"
    chain = (
        f"[0:a]aresample=48000,aformat=channel_layouts=stereo,adelay={ms}|{ms},afade=t=in:st={lead:.2f}:d=0.8,"
        f"{vol},apad=whole_dur=60[b]"
    )
    cmd = ["ffmpeg", "-y", "-v", "error", "-i", str(src)]
    if vo_wav:
        cmd += ["-i", str(vo_wav)]
        chain += (
            ";[1:a]aresample=48000,aformat=channel_layouts=stereo,apad=whole_dur=60[v]"
            # A slow, gentle duck: the bed no longer swells back up in every
            # pause between lines (release 1 s, ratio 2, attack 80 ms).
            ";[b][v]sidechaincompress=threshold=0.025:ratio=2:attack=80:release=1000[d]"
            ";[d]afade=t=out:st=58.5:d=1.5,atrim=0:60[o]"
        )
    else:
        chain += ";[b]afade=t=out:st=58.5:d=1.5,atrim=0:60[o]"
    sh(cmd + ["-filter_complex", chain, "-map", "[o]", "-ar", "48000", str(out / "bed.wav")])
    return {"mode": "heygen", "gap_db": g_gap, "open_db": g_open, "ramp_at_s": ramp_at, "ramp_s": ramp,
            "ducked_by_voice": bool(vo_wav), "duck": "ratio 2, attack 80 ms, release 1000 ms" if vo_wav else None,
            "starts_at_s": round(lead, 2)}


def kling_30fps(src, cache):
    """Kling renders 24 fps; placed in a 30 fps film every fifth frame repeats
    (visible judder on the slow dolly). Re-time each frame to 1/30 s instead:
    the clip plays 1.25x as fast (5.04 s becomes 4.03 s, still longer than
    the 2.6 s used) and every film frame is a new one. The grade is already
    baked in and is not applied again."""
    if not cache.exists() or cache.stat().st_mtime < src.stat().st_mtime:
        cache.parent.mkdir(parents=True, exist_ok=True)
        sh(["ffmpeg", "-y", "-v", "error", "-i", str(src), "-vf", "setpts=N/(30*TB)", "-r", "30", "-c:v", "libx264",
            "-crf", "12", "-preset", "slow", "-pix_fmt", "yuv420p", "-an", str(cache)])
    return cache


# ---------------------------------------------------------------- root

def root_html(cut, has_vo, clean, poster, has_bed):
    hosts = [
        ("hook", 0, 5), ("gap", 5, 10), ("what", 15, 20), ("need", 35, 10), ("close", 45, 15),
    ]
    h = ""
    for i, (sid, st, du) in enumerate(hosts):
        h += f'<div id="{sid}" data-composition-id="{sid}" data-composition-src="compositions/{sid}.html" data-start="{st}" data-duration="{du}" data-track-index="1" data-track-kind="graphics" data-width="{W}" data-height="{H}" style="z-index:{2 + i}"></div>\n'
    h += f'<div id="tag" data-composition-id="tag" data-composition-src="compositions/tag.html" data-start="0" data-duration="52" data-track-index="3" data-track-kind="graphics" data-width="{W}" data-height="{H}" style="z-index:20"></div>\n'
    if not clean:
        h += f'<div id="captions" data-composition-id="captions" data-composition-src="compositions/captions.html" data-start="0" data-duration="60" data-track-index="4" data-track-kind="captions" data-width="{W}" data-height="{H}" style="z-index:30"></div>\n'
    if poster:
        h += f'<div id="poster-title" class="clip" data-start="33" data-duration="1" data-track-index="5" style="position:absolute;left:0;right:0;bottom:{H - 968}px;text-align:center;z-index:40;font:600 58px/1.2 {cut.font()};color:{INK};direction:{"rtl" if cut.ar else "ltr"}">{esc(cut.c("poster"))}</div>\n'
    a = ""
    if has_vo:
        a += '<audio id="vo" class="clip" src="assets/audio/vo.wav" data-start="0" data-duration="60" data-track-index="10" data-volume="1"></audio>\n'
    a += '<audio id="room" class="clip" src="assets/audio/room.wav" data-start="0" data-duration="60" data-track-index="11" data-volume="1"></audio>\n'
    if has_bed:
        a += '<audio id="bed" class="clip" src="assets/audio/bed.wav" data-start="0" data-duration="60" data-track-index="14" data-volume="1"></audio>\n'
    a += '<audio id="keys" class="clip" src="assets/audio/keys.wav" data-start="0" data-duration="8" data-track-index="12" data-volume="1"></audio>\n'
    a += '<audio id="click" class="clip" src="assets/audio/click.wav" data-start="0" data-duration="24" data-track-index="13" data-volume="1"></audio>\n'
    return f"""<!doctype html>
<html lang="{cut.lang}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width={W}, height={H}" />
<script src="assets/vendor/gsap.min.js"></script>
<style>
{FONTS_CSS}
*{{margin:0;padding:0;box-sizing:border-box}}
html,body{{margin:0;width:{W}px;height:{H}px;overflow:hidden;background:{SPACE}}}
#ground{{position:absolute;inset:0;background:{SPACE}}}
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="60" data-width="{W}" data-height="{H}">
<div id="ground"></div>
{h}{a}</div>
<script>
  const tl = gsap.timeline({{ paused: true }});
  window.__timelines["main"] = tl;
</script>
</body>
</html>
"""


def vtt(groups, extra=None):
    groups = list(groups) + ([extra] if extra else [])

    def ts(t):
        m, s = divmod(t, 60)
        return f"00:{int(m):02d}:{s:06.3f}"

    out = ["WEBVTT", ""]
    for i, (a, b, text) in enumerate(groups):
        out += [str(i + 1), f"{ts(max(a, 0))} --> {ts(b)}", text, ""]
    return "\n".join(out)


def copy_items(cut, lines):
    """Every word this cut shows or says, for the client copy check: the
    film's own words, the narrator's lines and the demo firm's site."""
    import importlib.util

    items = []
    for key, v in COPY.items():
        val = v[1] if cut.ar else v[0]
        for t in val if isinstance(val, list) else [val]:
            items.append({"lang": cut.lang, "where": f"film:{key}", "text": t.replace("{date}", "")})
    for l in lines[cut.lang]:
        items.append({"lang": cut.lang, "where": f"voice:{l['id']}", "text": l["text"]})
    spec = importlib.util.spec_from_file_location("site", TOOL / "demo-site/build.py")
    site = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(site)
    i = 1 if cut.ar else 0
    for key, v in site.T.items():
        if key == "nav":
            items += [{"lang": cut.lang, "where": "site:nav", "text": n[1 + i]} for n in v]
        else:
            items.append({"lang": cut.lang, "where": f"site:{key}", "text": v[i]})
    items += [{"lang": cut.lang, "where": "site:project", "text": p[1 + i]} for p in site.PROJECTS]
    return items


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lang", choices=["en", "ar"], required=True)
    ap.add_argument("--clean", action="store_true")
    ap.add_argument("--poster", action="store_true")
    ap.add_argument("--out", required=True)
    ap.add_argument("--media", default=str(HOME / "upsell-studio-video/website"))
    ap.add_argument("--captures")
    ap.add_argument("--lines", default=str(HERE / "lines.json"))
    ap.add_argument("--timing")
    ap.add_argument("--vo")
    ap.add_argument("--bed", choices=["off", "heygen"], default="off",
                    help="off (contract section 8: room tone only) or heygen (internal listen only, unlicensed)")
    a = ap.parse_args()
    media = Path(a.media)
    caps = Path(a.captures or media / "capture/v2")
    cut = Cut(a.lang)
    lines = json.loads(Path(a.lines).read_text())
    slug = VOICE_SLUG[a.lang]
    timing_path = Path(a.timing) if a.timing else media / f"voice/{a.lang}/{slug}/timing.json"
    vo = Path(a.vo) if a.vo else media / f"voice/{a.lang}/{slug}/website-vo-{a.lang}-{slug}.wav"
    has_vo = timing_path.exists() and vo.exists()
    timing = json.loads(timing_path.read_text()) if has_vo else None
    if not has_vo and a.lang == "en":
        raise SystemExit("The English voice or its timing file is missing: run the voice step first.")
    boxes = json.loads((caps / "boxes.json").read_text())
    when = boxes["capturedAt"][:10]
    y, m, d = (int(x) for x in when.split("-"))
    date = f"{d} {AR_MONTHS[m - 1]} {y}".translate(AR_DIGITS) if cut.ar else f"{d} {EN_MONTHS[m - 1]} {y}"
    A = anchors(cut, timing)

    out = Path(a.out)
    if out.exists():
        shutil.rmtree(out)
    for sub in ("compositions", "assets/fonts", "assets/vendor", "assets/cap", "assets/media", "assets/img", "assets/brand", "assets/audio"):
        (out / sub).mkdir(parents=True)
    gf = NM / "geist/dist/fonts"
    for f in ("Geist-Regular", "Geist-Medium", "Geist-SemiBold", "Geist-Bold"):
        shutil.copy(gf / f"geist-sans/{f}.woff2", out / f"assets/fonts/{f}.woff2")
    for f in ("GeistMono-Regular", "GeistMono-Medium"):
        shutil.copy(gf / f"geist-mono/{f}.woff2", out / f"assets/fonts/{f}.woff2")
    for wgt in (400, 500, 600):
        shutil.copy(NM / f"@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-{wgt}-normal.woff2", out / f"assets/fonts/plexar-{wgt}.woff2")
    shutil.copy(NM / "hyperframes/dist/vendor/npm/gsap@3.15.0/dist/gsap.min.js", out / "assets/vendor/gsap.min.js")
    for name in (f"err-{cut.lang}", f"index-{cut.lang}", f"index-{cut.other}", f"projects-{cut.lang}", f"project-{cut.lang}",
                 f"contact-{cut.lang}", f"phone-{cut.lang}", f"phonetall-{cut.lang}"):
        shutil.copy(caps / f"{name}.png", out / f"assets/cap/{name}.png")
    for name, clip in (("k1", "website-kling-1-phone-ad-4x5"), ("k2", "website-kling-2-hero-dolly")):
        src = media / f"final/kling/{clip}.mp4"
        shutil.copy(kling_30fps(src, media / f"final/kling/30fps/{clip}-30fps.mp4"), out / f"assets/media/{name}.mp4")
    sh(["ffmpeg", "-y", "-v", "error", "-i", str(media / "final/art/website-bg-1.jpg"), "-vf", "scale=1920:-2", "-q:v", "3", str(out / "assets/img/bg1.jpg")])
    sh(["ffmpeg", "-y", "-v", "error", "-i", str(media / "final/art/website-hero-16x9.jpg"), "-vf", "scale=720:-2", "-q:v", "3", str(out / "assets/img/hero-card.jpg")])
    for scene_name in ("kitchen", "villa"):
        shutil.copy(REPO / f"apps/client-success-cockpit/src/present/assets/examples/{scene_name}-feed.webp", out / f"assets/img/{scene_name}-feed.webp")
    shutil.copy(media / "brand/mahara-lockup-dark-full.png", out / "assets/brand/lockup.png")
    shutil.copy(media / "brand/favicon.png", out / "assets/brand/mark.png")
    if has_vo:
        sh(["ffmpeg", "-y", "-v", "error", "-i", str(vo), "-ar", "48000", "-ac", "2", str(out / "assets/audio/vo.wav")])
    make_audio(cut, A, out / "assets/audio", NM / "hyperframes/dist/skills/media-use/audio/assets/sfx")
    bed = {"mode": "off", "why": "contract section 8: no ElevenLabs plan with commercial use, so room tone only"}
    if a.bed == "heygen":
        bed = make_bed(media, out / "assets/audio", (out / "assets/audio/vo.wav") if has_vo else None)

    comps = {
        "hook": hook(cut, A),
        "gap": gap(cut, A, boxes, cut.c("record").format(date=date)),
        "what": what(cut, A, boxes),
        "need": need(cut, A, boxes),
        "close": close(cut, A),
        "tag": tag_scene(cut),
    }
    groups = caption_groups(cut, lines, timing)
    comps["captions"] = captions_scene(cut, groups)
    for sid, src in comps.items():
        (out / "compositions" / f"{sid}.html").write_text(src, encoding="utf-8")
    (out / "index.html").write_text(root_html(cut, has_vo, a.clean, a.poster, a.bed != "off"), encoding="utf-8")
    (out / "hyperframes.json").write_text(json.dumps({
        "$schema": "https://hyperframes.heygen.com/schema/hyperframes.json",
        "paths": {"blocks": "compositions", "components": "compositions/components", "assets": "assets"},
        "media": {"autoProxy": True},
    }, indent=1))
    (out / f"website-{cut.lang}.vtt").write_text(vtt(groups, closing_cue(cut, lines, timing)), encoding="utf-8")
    (out / "copy.json").write_text(json.dumps(copy_items(cut, lines), ensure_ascii=False, indent=1), encoding="utf-8")
    (out / "build.json").write_text(json.dumps({
        "lang": cut.lang, "clean": a.clean, "poster": a.poster, "voice": has_vo,
        "voice_slug": slug if has_vo else None, "voice_timing": str(timing_path) if has_vo else None,
        "cues_from": "the voice's word times" if has_vo else "the script's windows (no narrator yet)",
        "anchors": {k: round(v, 3) for k, v in A.items()}, "captions": len(groups), "captured": when,
        "captures": str(caps), "closing": "placeholder",
        "bed": {"track": BED if a.bed != "off" else None, **bed},
    }, indent=1))
    print(f"film: {out} ({cut.lang}{', clean' if a.clean else ''}{', poster' if a.poster else ''}, voice {'yes' if has_vo else 'no'})")


if __name__ == "__main__":
    main()
