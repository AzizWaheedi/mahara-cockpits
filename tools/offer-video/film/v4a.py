#!/usr/bin/env python3
"""The v4 website film: direction A ("Architectural film") with direction B's
grafts, built to hw-notes/upsell-studio/video/website/v4-final-PLAN.md.

  python3 film/v4bake.py                     (once: the grades, baked)
  python3 film/v4a.py --lang en|ar [--clean] [--poster] [--bed off|heygen] --out <dir> [--range 15,25]

VPS only. Writes a HyperFrames project per cut. What it keeps from v3
(film/build.py, imported, unchanged in behaviour): the deck tokens, the copy,
the voice clock (ANCHOR_WORDS), the captions and their timing, the Example
tag rule, the Kling 30 fps conforms, the sound (room tone, key ticks, one
click) and the bed switch. What is new is the picture: graded art plates
(baked by film/v4bake.py through media-treatment, never CSS filters), real
captures standing in them as screens, B's traced facade at 15.0 s registered
to the dolly (film/dirb.py, scripts/trace_fit.py), six sheets for the six
pages, a drawn bill of quantities, and a type layer inside the 80% box.
--range START,END writes a project of that stretch only, for a timed test.
"""
import argparse
import json
import math
import shutil
import subprocess
from pathlib import Path

import build as v3
import dirb
from delivery import CLOSE_SECONDS, CLOSE_START, extra_cues, sha256, source_fingerprint
from build import (W, H, SPACE, DEEP, TEAL, INK, AMBER, LINE, LINE_STRONG, Cut, esc, box, cloud_path, scene, draw_js,
                   fade_js, hide0, tri, MARK_SVG, SEARCH_SVG, LINK_SVG, TRACK_SVG, CURSOR_SVG)

HOME = Path.home()
TX0, TX1, TY0, TY1 = 192, 1728, 108, 972  # 80% title-safe: every word
AX0, AX1, AY0, AY1 = 96, 1824, 54, 1026   # 90% action-safe: screens, plates, sheets, marks
CAP_TOP = 880                              # the caption band, kept clear of labels and lines
PERSP = 2400.0
INK_A = lambda a: f"rgba(242,246,250,{a})"
DEEP_A = lambda a: f"rgba(6,13,36,{a})"
SPACE_A = lambda a: f"rgba(9,19,51,{a})"

# New words (v4-final-PLAN section 4; through the client copy check before a
# render). Arabic under the aziz-kuwaiti-voice skill: Arabic-Indic digits,
# the decks' plural address, formal business wording on the drawing.
COPY4 = {
    "thirty": ("30", "٣٠"),
    "seconds": ("seconds", "ثانية"),
    "six_pages": ("Six pages", "ست صفحات"),
    "ar_en": ("Arabic and English", "بالعربي والإنجليزي"),
    "weeks": ("2 weeks", "أسبوعين"),
    "from_content": ("from your content", "من وصول المحتوى"),
    "boq": ("Bill of quantities", "جدول الكميات"),
    "cols": (["Item", "Description", "Quantity"], ["البند", "الوصف", "الكمية"]),
    "your_numbers": ("your numbers", "أرقامكم"),
    "record": (["Example.", "Captured {date}"], ["مثال.", "لقطة بتاريخ {date}"]),
}
PAGES = ["index", "projects", "project", "services", "about", "contact"]


def c4(cut, key):
    v = COPY4[key]
    return v[1] if cut.ar else v[0]


def projector(x, y, w, h, ry, rx, s=1.0, P=PERSP, ox=None, oy=None):
    """Where a point (u, v) of a pane lands on the film, for a pane at
    (x, y, w, h) under perspective(P) rotateY(ry) rotateX(rx) about its centre,
    after an in-plane scale s about (ox, oy) (the centre by default)."""
    cx, cy = w / 2, h / 2
    ox = cx if ox is None else ox
    oy = cy if oy is None else oy
    t, p = math.radians(ry), math.radians(rx)

    def f(u, v):
        u2, v2 = ox + (u - ox) * s, oy + (v - oy) * s
        X, Y = u2 - cx, v2 - cy
        Y1, Z1 = Y * math.cos(p), Y * math.sin(p)
        X2, Z2 = X * math.cos(t) + Z1 * math.sin(t), -X * math.sin(t) + Z1 * math.cos(t)
        q = 1 - Z2 / P
        return x + cx + X2 / q, y + cy + Y1 / q

    return f


def tilt(ry, rx):
    return f"transform:perspective({PERSP:.0f}px) rotateY({ry}deg) rotateX({rx}deg);transform-origin:50% 50%;"


def measure(items):
    """Text widths with the film's fonts (film/measure.mjs, headless Chrome)."""
    r = subprocess.run(["node", str(v3.HERE / "measure.mjs")], input=json.dumps(items), capture_output=True, text=True, check=True)
    return {k: v["w"] for k, v in json.loads(r.stdout).items()}


def fam(cut, mono=False):
    if cut.ar:
        return "Plex Arabic"
    return "Geist Mono" if mono else "Geist"


CSS4 = f"""
.pane{{position:absolute;inset:0;overflow:hidden;border-radius:10px;background:{DEEP};
  box-shadow:0 0 0 1px rgba(255,255,255,0.20), 0 34px 60px -18px rgba(2,5,16,0.72), 0 90px 150px -40px rgba(2,5,16,0.60)}}
.pane > img, .pimg{{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:cover}}
.edge{{position:absolute;inset:0;border-radius:10px;box-shadow:inset 0 1px 0 rgba(255,255,255,0.28);pointer-events:none}}
.sweep{{position:absolute;top:-10%;height:120%;left:0;width:55%;pointer-events:none}}
.bgp{{position:absolute;left:0;top:0;width:{W}px;height:{H}px;object-fit:cover}}
.kin{{position:absolute;color:{INK};font-weight:600;line-height:1.0;letter-spacing:-0.02em;white-space:nowrap;text-shadow:0 2px 24px rgba(6,13,36,0.45)}}
.recd{{position:absolute;font-size:28px;line-height:1.36;color:{INK_A(0.78)};white-space:nowrap;text-shadow:0 1px 14px rgba(6,13,36,0.6)}}
.call{{position:absolute;font-weight:500;white-space:nowrap;text-shadow:0 2px 18px rgba(6,13,36,0.55)}}
.svgo{{position:absolute;left:0;top:0;width:{W}px;height:{H}px;overflow:visible;pointer-events:none}}
.tri b{{font-size:28px;top:18px}}
"""


def plate_html(cut, pid, src, flip=True, style=""):
    """A full-frame plate; the Arabic cut flips the soft plates (none carries
    text, a person or a logo). GSAP moves #<pid>-w only."""
    f = "transform:scaleX(-1);" if (cut.ar and flip) else ""
    return (f'<div class="abs" style="{box(0, 0, W, H)}{f}overflow:hidden" data-layout-allow-overflow>'
            f'<div id="{pid}-w" class="abs" style="{box(0, 0, W, H)}"><img id="{pid}" class="bgp" src="{src}" style="{style}"></div></div>')


def blur_in(sel, t, dur=0.2):
    return fade_js(sel, t, dur, extra_from=', filter: "blur(8px)"', extra_to=', filter: "blur(0px)"', ease="power2.out")


def blur_out(sels, t, dur=0.2):
    return f'  tl.to({json.dumps(sels)}, {{ opacity: 0, filter: "blur(8px)", duration: {dur}, ease: "power3.in" }}, {t:.3f});\n'


def side(cut, x_start, width=None):
    """CSS for a block whose start edge sits at x_start (an English x; the
    Arabic cut mirrors it to its right edge)."""
    if cut.ar:
        return f"right:{x_start:.1f}px;" + (f"width:{width:.1f}px;" if width else "")
    return f"left:{x_start:.1f}px;" + (f"width:{width:.1f}px;" if width else "")


def label_html(cut, lid, x_start, top, text, size_en=40, color=INK, extra=""):
    size = size_en + 2 if cut.ar else size_en
    al = "right" if cut.ar else "left"
    return (f'<div id="{lid}" class="call" style="{side(cut, x_start)}top:{top:.1f}px;font-size:{size}px;line-height:{size * 1.25:.0f}px;'
            f'color:{color};text-align:{al};{extra}">{text}</div>')


# ---------------------------------------------------------------- 0 to 5: hook

def hook(cut, A):
    L = cut.lang
    rw, rh = 576, 720
    rx, ry = (W - rw) / 2, 118
    PH = 760
    PWp = PH * 390 / 845
    ppx, ppy = (W - PWp) / 2, 120
    PREV, HEAD = 90, 56
    MED_Y = PREV + HEAD
    MED_H = PWp * 5 / 4
    CTA_Y = MED_Y + MED_H
    k = PWp / rw
    mx, my = ppx, ppy + MED_Y
    dx, dy = mx - rx, my - ry
    arm = 46

    def corner(cx, cy, sx, sy):
        return f"M{cx + sx * arm:.1f} {cy:.1f} H{cx:.1f} V{cy + sy * arm:.1f}"

    marks = [corner(rx, ry, 1, 1), corner(rx + rw, ry, -1, 1), corner(rx + rw, ry + rh, -1, -1), corner(rx, ry + rh, 1, -1)]
    paths = "".join(
        f'<path id="h-mh{i}" class="draw" d="{d}" pathLength="1" stroke="{DEEP}" stroke-opacity="0.55" stroke-width="7"/>'
        f'<path id="h-m{i}" class="draw" d="{d}" pathLength="1" stroke="{INK}" stroke-width="2.5"/>'
        for i, d in enumerate(marks)
    )
    firm = esc(cut.c("firm"))
    # "Example ad" beside the window's top start corner, outside the window,
    # inside the 80% box; it rides with that corner into the phone.
    if cut.ar:
        lab = f'<div id="h-lab" class="abs mono hlab" style="left:{rx + rw + 24:.0f}px;top:{ry + 10:.0f}px;font-size:30px">{esc(cut.c("example_ad"))}</div>'
        ldx = (mx + PWp) - (rx + rw)
    else:
        lab = f'<div id="h-lab" class="abs mono hlab" style="right:{W - (rx - 24):.0f}px;top:{ry + 10:.0f}px">{esc(cut.c("example_ad"))}</div>'
        ldx = dx
    letters = "".join(
        f'<span id="h-l{i}" class="ch">{"&nbsp;" if ch == " " else esc(ch)}</span>' for i, ch in enumerate(cut.c("firm")))
    # The search: one hairline, the glyph, the name typed large, one plain row.
    LX0, LX1, LY = 410, 1510, 470
    gx = LX1 - 52 if cut.ar else LX0
    tx = (W - (LX1 - 76)) if cut.ar else (LX0 + 76)
    tpos = f"right:{tx:.0f}px" if cut.ar else f"left:{tx:.0f}px"
    body = f"""
<div class="abs" style="{box(0, 0, W, H)}overflow:hidden" data-layout-allow-overflow>
 <video id="h-world" class="clip bgp" muted playsinline src="assets/media/k2-night.mp4" data-start="0" data-duration="2.6" data-track-index="2"></video>
 <div id="h-softw" class="abs" style="{box(0, 0, W, H)}"><video id="h-soft" class="clip bgp" muted playsinline src="assets/media/k2-soft.mp4" data-start="1.45" data-duration="3.8" data-media-start="1.45" data-hf-media-start-basis="local" data-track-index="3"></video></div>
 <div id="h-coldw" class="abs" style="{box(0, 0, W, H)}"><video id="h-cold" class="clip bgp" muted playsinline src="assets/media/k2-soft-cold.mp4" data-start="2.6" data-duration="2.65" data-media-start="0.1" data-hf-media-start-basis="local" data-track-index="4"></video></div>
</div>
<div id="h-dim" class="abs" style="{box(rx, ry, rw, rh)}box-shadow:0 0 0 2600px {DEEP_A(0.62)}" data-layout-allow-overflow></div>
<svg class="svgo" viewBox="0 0 {W} {H}" aria-hidden="true">{paths}</svg>
<div id="h-stage" class="abs" style="{box(0, 0, W, H)}transform-origin:{W / 2:.0f}px {ppy + PH / 2:.0f}px" data-layout-allow-overflow>
 <div id="h-phone" class="abs phone4" style="{box(ppx, ppy, PWp, PH)}" data-layout-ignore>
  <div class="prevpost" style="height:{PREV}px"><img src="assets/img/kitchen-feed.webp"></div>
  <div class="ph" style="height:{HEAD}px"><span class="av">{MARK_SVG}</span><span class="who"><b>{firm}</b><small>{esc(cut.c('sponsored'))}</small></span><span class="dots">&middot;&middot;&middot;</span></div>
  <div class="slot" style="height:{MED_H:.2f}px"></div>
  <div class="cta"><span>{esc(cut.c('learn'))}</span><span class="chev">&rsaquo;</span></div>
  <div class="ph" style="height:{HEAD}px"><span class="av av2"></span><span class="who"><b class="bar"></b></span></div>
  <div class="nextpic"><img src="assets/img/villa-feed.webp"></div>
 </div>
 <div id="h-win" class="abs" style="{box(rx, ry, rw, rh)}overflow:hidden;transform-origin:0 0">
  <video id="h-wv" class="clip" muted playsinline src="assets/media/k2-night.mp4" data-start="0" data-duration="2.58" data-track-index="5" style="position:absolute;left:{-rx:.1f}px;top:{-ry:.1f}px;width:{W}px;height:{H}px"></video>
 </div>
 <div id="h-touch" class="abs touch" style="left:{mx + PWp / 2 - 23:.1f}px;top:{my + MED_H * 0.55 - 23:.1f}px"></div>
</div>
{lab}
<div id="h-search" class="abs" style="{box(0, 0, W, H)}">
 <div id="h-line" class="abs" style="left:{LX0}px;top:{LY - 1}px;width:{LX1 - LX0}px;height:2px;background:{INK}"></div>
 <div id="h-sg" class="abs sg" style="left:{gx}px;top:{LY - 22 - 70:.0f}px;width:52px;height:52px;color:{INK_A(0.8)}">{SEARCH_SVG}</div>
 <div id="h-typed" class="abs typed" style="{tpos};top:{LY - 22 - 110:.0f}px;height:110px">{letters}<i id="h-caret" class="caret"></i></div>
 <div id="h-res" class="abs res" style="{box(LX0, LY + 30, LX1 - LX0, 112)}">
  <b>{firm}</b><small>hosh.example</small>
  <div id="h-tap" class="abs touch" style="{'right' if cut.ar else 'left'}:120px;top:33px"></div>
 </div>
</div>
"""
    css = CSS4 + f"""
.hlab{{font-size:28px;letter-spacing:0.04em;color:{INK_A(0.92)};white-space:nowrap;text-shadow:0 1px 14px rgba(6,13,36,0.7)}}
.phone4{{overflow:hidden;border-radius:46px;background:#000;display:flex;flex-direction:column;
  box-shadow:0 0 0 1px rgba(255,255,255,0.20), 0 34px 60px -18px rgba(2,5,16,0.72), 0 90px 150px -40px rgba(2,5,16,0.60)}}
.prevpost{{overflow:hidden;border-bottom:1px solid #262626;flex:none}}
.prevpost img{{width:100%;height:100%;object-fit:cover;object-position:50% 100%}}
.ph{{display:flex;align-items:center;gap:10px;padding:0 14px;flex:none;direction:{'rtl' if cut.ar else 'ltr'}}}
.av{{width:34px;height:34px;border-radius:50%;background:#f4f3ef;color:#46553a;display:grid;place-items:center;flex:none}}
.av svg{{width:20px;height:20px}}
.who{{display:flex;flex-direction:column;line-height:1.2;flex:1}}
.who b{{font-size:15px;font-weight:600;color:#fff}}
.who small{{font-size:13px;color:#a8a8a8}}
.dots{{color:#a8a8a8;font-size:18px}}
.av2{{background:#262626}}
.bar{{display:block;width:120px;height:12px;border-radius:6px;background:#262626}}
.slot{{flex:none;background:#111}}
.cta{{height:48px;flex:none;display:flex;align-items:center;justify-content:space-between;padding:0 14px;font-size:15px;font-weight:600;color:#fff;border-bottom:1px solid #262626;direction:{'rtl' if cut.ar else 'ltr'}}}
.chev{{font-size:22px;color:#a8a8a8;{'transform:scaleX(-1);display:inline-block' if cut.ar else ''}}}
.nextpic{{flex:1;overflow:hidden}}
.nextpic img{{width:100%;height:100%;object-fit:cover;object-position:50% 0%}}
.touch{{width:46px;height:46px;border-radius:50%;background:rgba(242,246,250,0.55)}}
.sg svg{{width:100%;height:100%}}
.typed{{font-size:{104 if cut.ar else 96}px;font-weight:500;line-height:110px;white-space:nowrap;color:{INK};direction:{'rtl' if cut.ar else 'ltr'}}}
.ch{{display:none}}
.caret{{display:inline-block;width:4px;height:84px;margin-inline-start:6px;background:{TEAL};vertical-align:-10px}}
.res{{padding:0 76px;border-radius:10px;display:flex;flex-direction:column;justify-content:center;gap:6px;background:{DEEP_A(0.72)};
  box-shadow:0 0 0 1px rgba(255,255,255,0.16);transform-origin:50% 50%}}
.res b{{font-size:40px;font-weight:500;color:{INK};white-space:nowrap;line-height:1.1}}
.res small{{font:400 28px 'Geist Mono',monospace;color:{INK_A(0.6)};direction:ltr;text-align:{'right' if cut.ar else 'left'};unicode-bidi:isolate}}
"""
    js = hide0("#h-dim", "#h-lab", "#h-phone", "#h-touch", "#h-search", "#h-res", "#h-tap", "#h-softw", "#h-coldw")
    # 1A: four crop marks draw round the 4:5 window on "Someone sees your",
    # the world outside dims to 62% Deep by 1.5 s (F5), the label blurs in.
    for i in range(4):
        js += draw_js(f"#h-mh{i}", 0.95 + 0.04 * i, 0.42, "power3.out") + draw_js(f"#h-m{i}", 0.95 + 0.04 * i, 0.42, "power3.out")
    js += fade_js("#h-dim", 1.0, 0.5, ease="power2.inOut")
    js += blur_in("#h-lab", 1.05)
    # 1B: on "ad" the window, still playing, shrinks into the phone's post;
    # the world blurs and darkens (a dissolve to the soft bake) and stays.
    t = max(A["ad"], 1.6)
    js += f'  tl.to([{",".join(json.dumps(f"#h-mh{i}") for i in range(4))}, {",".join(json.dumps(f"#h-m{i}") for i in range(4))}], {{ opacity: 0, duration: 0.18, ease: "power2.in" }}, {t:.3f});\n'
    js += f'  tl.to("#h-win", {{ x: {dx:.2f}, y: {dy:.2f}, scale: {k:.5f}, duration: 0.65, ease: "power2.inOut" }}, {t:.3f});\n'
    js += f'  tl.to("#h-lab", {{ x: {ldx:.2f}, y: {dy:.2f}, duration: 0.65, ease: "power2.inOut" }}, {t:.3f});\n'
    js += fade_js("#h-softw", t, 0.4, ease="power2.inOut")
    js += f'  tl.to("#h-dim", {{ opacity: 0, duration: 0.3, ease: "power1.in" }}, {t:.3f});\n'
    js += f'  tl.fromTo("#h-phone", {{ opacity: 0, scale: 0.985 }}, {{ opacity: 1, scale: 1, duration: 0.4, ease: "expo.out" }}, {t + 0.15:.3f});\n'
    # The phone turns toward the open side, then a touch on the post.
    js += f'  tl.to("#h-stage", {{ rotationY: {-4 * cut.S}, transformPerspective: {PERSP:.0f}, duration: 0.5, ease: "power1.inOut" }}, {t + 0.62:.3f});\n'
    js += f'  tl.fromTo("#h-touch", {{ opacity: 0 }}, {{ opacity: 0.8, duration: 0.08 }}, 2.30);\n'
    js += '  tl.to("#h-touch", { opacity: 0, duration: 0.18 }, 2.42);\n'
    js += '  tl.to("#h-lab", { opacity: 0, duration: 0.15 }, 2.45);\n'
    # 1C: match cut to the search, set as type on the plate, which cools.
    js += '  tl.set(["#h-stage"], { opacity: 0 }, 2.6);\n  tl.set("#h-search", { opacity: 1 }, 2.6);\n'
    js += fade_js("#h-coldw", 2.6, 2.3, ease="power1.inOut")
    js += '  gsap.set("#h-line", { opacity: 0.5 });\n'
    t0 = A["type"]
    for i in range(len(cut.c("firm"))):
        js += f'  tl.set("#h-l{i}", {{ display: "inline" }}, {t0 + i / 14:.3f});\n'
    js += f'  tl.to("#h-line", {{ opacity: 1, duration: 0.15 }}, {A["enter"]:.3f});\n'
    js += f'  tl.set("#h-caret", {{ opacity: 0 }}, {A["enter"]:.3f});\n'
    js += f'  tl.fromTo("#h-res", {{ opacity: 0, y: 8 }}, {{ opacity: 1, y: 0, duration: 0.16, ease: "power2.out" }}, {A["enter"] + 0.1:.3f});\n'
    tap = A["tap"]
    js += f'  tl.fromTo("#h-tap", {{ opacity: 0 }}, {{ opacity: 0.8, duration: 0.06 }}, {tap:.3f});\n'
    js += f'  tl.to("#h-tap", {{ opacity: 0, duration: 0.08 }}, {tap + 0.06:.3f});\n'
    # Object becomes the world: the row opens toward the page (the gap scene
    # takes it over at 5.0 s from the row's place).
    js += f'  tl.to("#h-res", {{ scale: 1.12, opacity: 0, duration: 0.3, ease: "power2.in" }}, {tap + 0.05:.3f});\n'
    js += f'  tl.to(["#h-line", "#h-typed", "#h-sg"], {{ opacity: 0, duration: 0.2 }}, {tap + 0.1:.3f});\n'
    return scene("hook", cut, css, body, js), (LX0 + LX1) / 2, LY + 30 + 56


# ---------------------------------------------------------------- 5 to 15: gap

def gap(cut, A, boxes, date_label, M, row_c):
    PH = 736
    PW = PH * 1.6
    px, py = cut.mx(96, PW), 62
    ry_, rx_ = (-5.0 if cut.ar else 5.0), 1.5
    PUSH = 1.025
    eb = boxes[f"err-{cut.lang}"]
    k0 = PW / eb["page"]["w"]
    hb = {kk: v * k0 for kk, v in eb["h1"].items()}
    # Rev A round the headline, in the pane's plane (the push carries it); its
    # halo stops clear of Chrome's second line.
    pad_x, pad_y = 30, 10
    cy0 = hb["y"] - pad_y
    cy1 = min(hb["y"] + hb["h"] + pad_y, eb["line2"]["y"] * k0 - 28)
    cx0, cw = hb["x"] - pad_x, hb["w"] + 2 * pad_x
    dA = cloud_path(cx0, cy0, cw, cy1 - cy0, step=26, rtl=cut.ar)
    proj = projector(px, py, PW, PH, ry_, rx_, s=PUSH)
    side_u = cx0 if cut.ar else cx0 + cw
    sx, sy = proj(side_u + (-4 if cut.ar else 4), (cy0 + cy1) / 2)
    tri_u = (cx0 - 30) if cut.ar else (cx0 + cw - 24)
    # The dimension in the screen's plane, along its end edge, 36 px out (B's
    # idea for "30 seconds", F3): extension lines off the page's corners, the
    # dimension line, oblique ticks; the words horizontal in the end column.
    e = 0.0 if cut.ar else PW
    o = -1 if cut.ar else 1
    dl = e + 36 * o
    ext = f"M{e + 8 * o:.1f} 0 H{dl + 16 * o:.1f} M{e + 8 * o:.1f} {PH:.1f} H{dl + 16 * o:.1f}"
    dim = f"M{dl:.1f} -14 V{PH + 14:.1f}"
    ticks = f"M{dl - 11:.1f} 11 L{dl + 11:.1f} -11 M{dl - 11:.1f} {PH + 11:.1f} L{dl + 11:.1f} {PH - 11:.1f}"
    thirty, secs = c4(cut, "thirty"), c4(cut, "seconds")
    gap_u = 30
    # The words' start edge in the pane's plane, and their size from the
    # measured width so their far edge stays inside x 192 to 1728 at full push.
    if cut.ar:
        wsize = 104
        ww = M["ar30"] * wsize / 104
        u_near = dl - gap_u
        while True:
            fx, _ = proj(u_near - ww * (wsize / 104) - 4, PH / 2)
            if fx >= TX0 + 6 or wsize <= 88:
                break
            wsize -= 2
        words = (f'<div id="g-dw" class="abs kin" style="right:{PW - u_near:.1f}px;top:{PH / 2 - wsize * 0.62:.1f}px;font-size:{wsize}px;direction:rtl">'
                 f'{esc(thirty)} {esc(secs)}</div>')
    else:
        wsize = 96
        u_near = dl + gap_u
        while True:
            fx, _ = proj(u_near + M["seconds"] * wsize / 96 + 4, PH / 2)
            if fx <= TX1 - 6 or wsize <= 84:
                break
            wsize -= 2
        words = (f'<div id="g-dw" class="abs kin" style="left:{u_near:.1f}px;top:{PH / 2 - wsize * 0.98:.1f}px;font-size:{wsize}px;line-height:0.98">'
                 f'{esc(thirty)}<br>{esc(secs)}</div>')
    # The end column (flat): from the projected words' start to the 80% edge.
    if cut.ar:
        col_x1 = proj(dl - gap_u, PH / 2)[0]          # its right edge
        col_x0 = TX0
    else:
        col_x0 = proj(dl + gap_u, PH / 2)[0]
        col_x1 = TX1
    col_w = col_x1 - col_x0
    note_w = M["arnote"] if cut.ar else M["note"]
    note_lines = 1 if note_w <= col_w - 8 else 2
    note_h = (42 if cut.ar else 40) * 1.25 * note_lines
    note_top = sy - 14 - note_h
    near = col_x1 if cut.ar else col_x0
    lead = f"M{near + (8 if cut.ar else -8):.1f} {sy:.1f} L{sx:.1f} {sy:.1f}"
    rec = date_label
    rec_style = (f"right:{W - col_x1:.1f}px;text-align:right;font-family:'Plex Arabic','Geist',sans-serif;font-size:30px"
                 if cut.ar else f"left:{col_x0:.1f}px")
    # Above the dimension's lower extension line (the pane's foot at full push)
    # by 30 px, and clear of the two-line caption.
    pane_foot = proj(PW / 2, PH)[1]
    rec_top = min(826, pane_foot - 30) - 2 * (30 if cut.ar else 28) * 1.36
    note_side = f"right:{W - col_x1:.1f}px;text-align:right" if cut.ar else f"left:{col_x0:.1f}px"
    body = f"""
{plate_html(cut, 'g-plate', 'assets/img/bg1-cold.jpg')}
<div class="abs" style="{box(px, py, PW, PH)}{tilt(ry_, rx_)}" data-layout-allow-overflow>
 <div id="g-pm" class="abs" style="{box(0, 0, PW, PH)}" data-layout-allow-overflow>
  <div class="pane"><img src="assets/cap/err-{cut.lang}-cold.png"><div id="g-sweep" class="sweep"></div><div class="edge"></div></div>
  <svg class="abs" style="{box(0, 0, PW, PH)}overflow:visible" viewBox="0 0 {PW:.1f} {PH}" aria-hidden="true">
   <g id="g-dim">
    <path id="g-exth" class="draw" d="{ext}" pathLength="1" stroke="{DEEP}" stroke-opacity="0.6" stroke-width="6"/>
    <path id="g-ext" class="draw" d="{ext}" pathLength="1" stroke="{INK}" stroke-width="1.6"/>
    <path id="g-dlh" class="draw" d="{dim}" pathLength="1" stroke="{DEEP}" stroke-opacity="0.6" stroke-width="7"/>
    <path id="g-dl" class="draw" d="{dim}" pathLength="1" stroke="{INK}" stroke-width="2"/>
    <path id="g-tick" d="{ticks}" stroke="{INK}" stroke-width="3" stroke-linecap="square"/>
   </g>
   <path id="g-cloudh" class="draw" d="{dA}" pathLength="1" stroke="{DEEP}" stroke-width="9" stroke-linejoin="round" stroke-linecap="round"/>
   <path id="g-cloud" class="draw" d="{dA}" pathLength="1" stroke="{AMBER}" stroke-width="3.2" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>
  {tri("g-tri", tri_u, cy0 - 44, "A", AMBER)}
  {words}
 </div>
</div>
<svg class="svgo" viewBox="0 0 {W} {H}" aria-hidden="true">
 <path id="g-leadh" class="draw" d="{lead}" pathLength="1" stroke="{DEEP}" stroke-opacity="0.7" stroke-width="7"/>
 <path id="g-lead" class="draw" d="{lead}" pathLength="1" stroke="{AMBER}" stroke-width="2"/>
</svg>
<div id="g-note" class="abs note" style="{note_side};top:{note_top:.1f}px;width:{col_w:.1f}px">{esc(cut.c('note'))}</div>
<div id="g-rec" class="recd mono" style="{rec_style};top:{rec_top:.1f}px">{esc(rec[0])}<br>{esc(rec[1])}</div>
"""
    sweep_bg = "linear-gradient(100deg, rgba(220,232,250,0) 0%, rgba(220,232,250,0.20) 50%, rgba(220,232,250,0) 100%)"
    css = CSS4 + f"""
#g-sweep{{background:{sweep_bg}}}
.note{{font-size:{42 if cut.ar else 40}px;font-weight:500;line-height:1.25;color:{INK};text-wrap:balance;text-shadow:0 2px 18px rgba(6,13,36,0.55)}}
"""
    T = lambda key: A[key] - 5.0
    js = hide0("#g-note", "#g-dw", "#g-tick", "#g-tri", "#g-rec")
    js += '  tl.fromTo("#g-plate-w", { scale: 1.16, x: 0, y: -96 }, { scale: 1.20, x: -28, y: -104, duration: 10, ease: "power1.inOut" }, 0);\n'
    # In from the tapped row (the row's centre to the pane's), then one push.
    pcx, pcy = px + PW / 2, py + PH / 2
    js += (f'  tl.fromTo("#g-pm", {{ scale: 0.42, x: {row_c[0] - pcx:.1f}, y: {row_c[1] - pcy:.1f}, opacity: 0 }}, '
           f'{{ scale: 1, x: 0, y: 0, opacity: 1, duration: 0.75, ease: "expo.out" }}, 0);\n')
    js += f'  tl.to("#g-pm", {{ scale: {PUSH}, duration: 7.7, ease: "power1.inOut" }}, 0.75);\n'
    js += fade_js("#g-plate", 0, 0.22)
    a, b = (210, -110) if cut.ar else (-110, 210)
    js += f'  tl.fromTo("#g-sweep", {{ xPercent: {a} }}, {{ xPercent: {b}, duration: 3.6, ease: "power1.inOut" }}, 3.2);\n'
    th = A["thirty"] - 5.0
    js += draw_js("#g-exth", th - 0.25, 0.3, "power2.out") + draw_js("#g-ext", th - 0.25, 0.3, "power2.out")
    js += draw_js("#g-dlh", th - 0.05, 0.42, "power2.inOut") + draw_js("#g-dl", th - 0.05, 0.42, "power2.inOut")
    js += f'  tl.set("#g-tick", {{ opacity: 1 }}, {th + 0.12:.3f});\n'
    js += blur_in("#g-dw", th + 0.05)
    js += blur_out(["#g-dw", "#g-dim"], 7.30)
    js += fade_js("#g-rec", 0.75, 0.3)
    t = T("this")
    js += fade_js("#g-note", t - 0.25, 0.2)
    js += draw_js("#g-cloudh", t) + draw_js("#g-cloud", t)
    ch_ = cy1 - cy0
    f_side = (cw + ch_ / 2) / (2 * cw + 2 * ch_)
    tau = (f_side / 2) ** 0.5 if f_side < 0.5 else 1 - ((1 - f_side) / 2) ** 0.5
    lead_end = max(t + 0.56, t + 0.64 * tau + 0.06)
    js += draw_js("#g-leadh", t + 0.2, lead_end - t - 0.2, "power2.out") + draw_js("#g-lead", t + 0.2, lead_end - t - 0.2, "power2.out")
    js += fade_js("#g-tri", t + 0.5, 0.16)
    geo = {"pane": [round(px, 1), py, round(PW, 1), PH], "words_px": wsize, "column": [round(col_x0, 1), round(col_x1, 1)],
           "note_lines": note_lines}
    return scene("gap", cut, css, body, js), geo


# ---------------------------------------------------------------- 15 to 17.6: issued from the drawing

def reveal(cut, A, boxes):
    """15.0: the facade as a drawing on a 74% Deep wash over the warm render;
    the render floods in through it in the order it was drawn (B's signature
    move). The overlay rides the dolly on the fitted transform
    (dirb.DOLLY_FIT), never flipped. 17.0 to 17.6: the frame shrinks into the
    home page's hero slot over the courtyard-portal plate."""
    fac, nf, nh = dirb.facade_svg("rv-", lw=1.7, alpha=0.9)
    # Axis lines at the portal's two piers, dash-dot 1 px, 40 px bubbles above
    # them in the 90% box (drawing marks, like crop marks); stopped at y 860.
    labels = ["1", "2"] if not cut.ar else ["2", "1"]
    axes = ""
    for (x, _), lab in zip(dirb.AXES, labels):
        axes += (f'<circle cx="{x}" cy="76" r="20" fill="{DEEP}" fill-opacity="0.7" stroke="{INK}" stroke-width="2"/>'
                 f'<text x="{x}" y="86" text-anchor="middle" class="axt">{esc(cut.num(lab))}</text>'
                 f'<path d="M{x} 96 V860" stroke="{INK}" stroke-width="1" stroke-opacity="0.6" stroke-dasharray="22 7 3 7"/>')
    # (id, start rect, end rect, t0, t1): door to portal, the wings outward,
    # ground, sky (B's timings, the registered geometry).
    R = [
        ("rv-r1", (886, 230, 143, 395), (757, 102, 404, 535), 0.04, 0.30),
        ("rv-r2", (757, 112, 0, 540), (290, 112, 467, 540), 0.24, 0.78),
        ("rv-r3", (1161, 112, 0, 540), (1161, 112, 569, 540), 0.24, 0.78),
        ("rv-r4", (0, 645, W, 0), (-40, 645, W + 80, 480), 0.62, 1.02),
        ("rv-r5", (-40, -40, W + 80, 0), (-40, -40, W + 80, 192), 0.80, 1.10),
    ]
    rects = "".join(f'<rect id="{i}" x="{a[0]}" y="{a[1]}" width="{a[2]}" height="{a[3]}" fill="#000"/>' for i, a, _, _, _ in R)
    edges = (f'<line id="rv-eL" x1="757" y1="112" x2="757" y2="652" stroke="{TEAL}" stroke-width="3"/>'
             f'<line id="rv-eR" x1="1161" y1="112" x2="1161" y2="652" stroke="{TEAL}" stroke-width="3"/>')
    # The home page, flat and centred, its hero slot = the clip's frame 77.
    HW, HH = 1084, 1084 * 1024 / 1440
    hx0, hy0 = (W - HW) / 2, (H - HH) / 2
    s = HW / 1440
    hp = boxes[f"index-{cut.lang}"]["hero-pic"]
    hx, hy, hw = hx0 + hp["x"] * s, hy0 + hp["y"] * s, hp["w"] * s
    body = f"""
{plate_html(cut, 'rv-plate', 'assets/img/court-warm.jpg')}
<div id="rv-home" class="abs" style="{box(hx0, hy0, HW, HH)}"><div class="pane"><img src="assets/cap/index-{cut.lang}.png"><div class="edge"></div></div></div>
<div id="rv-filmw" class="abs" style="{box(0, 0, W, H)}transform-origin:0 0" data-layout-allow-overflow>
 <video id="rv-k2" class="clip bgp" muted playsinline src="assets/media/k2-warm.mp4" data-start="0" data-duration="2.6" data-track-index="2"></video>
 <div id="rv-rawd" class="abs" style="{box(0, 0, W, H)}"><video id="rv-raw" class="clip bgp" muted playsinline src="assets/media/k2.mp4" data-start="1.85" data-duration="0.75" data-media-start="1.85" data-hf-media-start-basis="local" data-track-index="3"></video></div>
</div>
<svg class="svgo" viewBox="0 0 {W} {H}" aria-hidden="true">
 <defs><mask id="rv-m" maskUnits="userSpaceOnUse" x="-100" y="-100" width="{W + 200}" height="{H + 200}">
  <rect x="-100" y="-100" width="{W + 200}" height="{H + 200}" fill="#fff"/>
  <g id="rv-mg">{rects}</g>
 </mask></defs>
 <g id="rv-over" mask="url(#rv-m)">
  <rect x="-60" y="-60" width="{W + 120}" height="{H + 120}" fill="{DEEP}" fill-opacity="0.74"/>
  <g id="rv-lines">{fac}{axes}</g>
 </g>
 <g id="rv-edges">{edges}</g>
</svg>
"""
    css = CSS4 + f".axt{{font:500 28px 'Geist Mono',monospace;fill:{INK}}}\n"
    js = hide0("#rv-plate", "#rv-home", "#rv-rawd", "#rv-eL", "#rv-eR")
    for i in range(nf):
        js += f'  gsap.set("#rv-f{i}", {{ strokeDashoffset: 0 }});\n'
    for i in range(nh):
        js += f'  gsap.set("#rv-h{i}", {{ strokeDashoffset: 0 }});\n'
    for rid, a, b, t0, t1 in R:
        js += (f'  tl.fromTo("#{rid}", {{ attr: {{ x: {a[0]}, y: {a[1]}, width: {a[2]}, height: {a[3]} }} }}, '
               f'{{ attr: {{ x: {b[0]}, y: {b[1]}, width: {b[2]}, height: {b[3]} }}, duration: {t1 - t0:.2f}, ease: "power2.inOut" }}, {t0:.2f});\n')
        if rid in ("rv-r2", "rv-r3"):
            e, x0, x1 = ("#rv-eL", 757, b[0]) if rid == "rv-r2" else ("#rv-eR", 1161, b[0] + b[2])
            js += f'  tl.set("{e}", {{ opacity: 1 }}, {t0:.2f});\n'
            js += (f'  tl.fromTo("{e}", {{ attr: {{ x1: {x0}, x2: {x0} }} }}, {{ attr: {{ x1: {x1}, x2: {x1} }}, '
                   f'duration: {t1 - t0:.2f}, ease: "power2.inOut" }}, {t0:.2f});\n')
            js += f'  tl.to("{e}", {{ opacity: 0, duration: 0.22 }}, {t1 - 0.06:.2f});\n'
    js += '  tl.to("#rv-over", { opacity: 0, duration: 0.35, ease: "power1.out" }, 0.95);\n'
    # The overlay rides the dolly: the transform fitted on frames 0 to 42.
    keys = sorted(dirb.DOLLY_FIT)
    for sel in ("#rv-mg", "#rv-lines", "#rv-edges"):
        s0, tx0, ty0 = dirb.DOLLY_FIT[keys[0]]
        js += f'  tl.fromTo("{sel}", {{ svgOrigin: "0 0", scale: {s0}, x: {tx0}, y: {ty0} }}, {{ svgOrigin: "0 0", scale: {s0}, x: {tx0}, y: {ty0}, duration: 0.001 }}, 0);\n'
        for ka, kb in zip(keys, keys[1:]):
            s1, tx1, ty1 = dirb.DOLLY_FIT[kb]
            js += (f'  tl.to("{sel}", {{ svgOrigin: "0 0", scale: {s1}, x: {tx1}, y: {ty1}, duration: {(kb - ka) / 30:.4f}, ease: "none" }}, '
                   f'{ka / 30:.4f});\n')
    # 3B: the clean warm dolly, then it shrinks into the hero slot; the warm
    # grade hands over to the raw clip (the site's hero is the raw frame 77).
    js += fade_js("#rv-plate", 1.95, 0.4, ease="power1.out")
    js += fade_js("#rv-home", 2.05, 0.3, ease="power1.out")
    js += fade_js("#rv-rawd", 1.95, 0.5, ease="power1.inOut")
    js += f'  tl.to("#rv-filmw", {{ x: {hx:.2f}, y: {hy:.2f}, scale: {hw / W:.5f}, duration: 0.6, ease: "power2.inOut" }}, 2.0);\n'
    js += '  tl.fromTo("#rv-plate-w", { scale: 1.04, x: 0 }, { scale: 1.045, x: -2, duration: 0.6, ease: "none" }, 2.0);\n'
    return scene("reveal", cut, css, body, js, ' data-hold="true"'), {"home": [hx0, hy0, HW, HH]}


# ---------------------------------------------------------------- 17.6 to 35: the site

SCR = (128, 68, 1063, 756)  # the start-side screen in beat 3 (English x; 70% of the height)


def site(cut, A, boxes, M, home_rect):
    L, O = cut.lang, cut.other
    sx_en, sy, SW_, SH_ = SCR
    sx = cut.mx(sx_en, SW_)
    ry_, rx_ = (-4.0 if cut.ar else 4.0), 1.2
    ks = SW_ / 1440
    pcx, pcy = sx + SW_ / 2, sy + SH_ / 2
    T = lambda key: A[key] - 17.6
    # Six sheets: 3 by 2 on the start side, flat, drafter's overruns, labels.
    SHW, SHH, G = 300, 213, 30
    xs_en = [156 + i * (SHW + G) for i in range(3)]
    ys = [230, 528]
    sheets = []
    for i in range(6):
        x = cut.mx(xs_en[i % 3], SHW)
        y = ys[i // 3]
        sheets.append((x, y))
    names = v3.COPY["rows"][1 if cut.ar else 0]
    shtml, fr = "", ""
    for i, (x, y) in enumerate(sheets):
        pg = PAGES[i]
        lab = f"{cut.num(i + 1)} {names[i]}" if cut.ar else f"0{i + 1} {names[i]}"
        extra = f'<img id="s-b{i}" class="pimg" src="assets/sheet/{pg}-{L}.jpg">' if i == 1 else ""
        shtml += (f'<div id="s-sh{i}" class="abs sheet" style="{box(x, y, SHW, SHH)}">'
                  f'<img class="pimg" src="assets/sheet/{pg}-{L}.jpg"><img id="s-o{i}" class="pimg" src="assets/sheet/{pg}-{O}.jpg">{extra}</div>'
                  f'<div id="s-lb{i}" class="abs mono slab" style="{box(x - 40, y + SHH + 12, SHW + 80, 40)}">{esc(lab)}</div>')
        fr += dirb.frame_lines(x, y, SHW, SHH, over=16, sw=2, pid=f"s-fr{i}")
    # The end column (beside the sheets), its words measured.
    col_x0 = 156 + 3 * SHW + 2 * G + 60          # English x of its start edge
    col_w = TX1 - col_x0
    kin_size = 102 if cut.ar else 96
    k1, k2 = c4(cut, "six_pages"), c4(cut, "ar_en")
    if cut.ar:
        k2_html = "بالعربي<br>والإنجليزي"
    else:
        k2_html = "Arabic and<br>English" if M["arabic_and"] <= col_w else "Arabic<br>and English"
    kin = (f'<div id="s-k1" class="abs kin" style="{side(cut, col_x0)}top:248px;font-size:{kin_size}px">{esc(k1)}</div>'
           f'<div id="s-k2" class="abs kin" style="{side(cut, col_x0)}top:{248 + kin_size * 1.32:.0f}px;font-size:{kin_size}px;line-height:1.02">{k2_html}</div>')
    # The cursor on sheet 1's language switch.
    ls = boxes[f"index-{L}"]["lang-switch"]
    sk = SHW / 1440
    s1x, s1y = sheets[0]
    cur_to = (s1x + (ls["x"] + ls["w"] / 2) * sk, s1y + (ls["y"] + ls["h"] / 2) * sk)
    cur_from = (cur_to[0] + (-90 if cut.ar else 90), cur_to[1] + 150)
    # The screen (sheet 2 grows into it), its pages and its marks in its plane.
    full_h = SW_ * 2264 / 2880
    scroll = full_h - SH_
    fm = boxes[f"contact-{L}"]["form"]
    fn = boxes[f"contact-{L}"]["foot-note"]
    STEP = 0.92
    projS = projector(sx, sy, SW_, SH_, ry_, rx_, s=STEP)
    # Enquiry form: a ringed dot on the form's end edge, a leader to the column.
    f_u = (fm["x"] if cut.ar else fm["x"] + fm["w"]) * ks
    f_v = (fm["y"] + fm["h"] * 0.42) * ks
    fdot = projS(f_u, f_v)
    # Tracking: the mark beside the footer note, in the page's plane.
    mark_u = ((fn["x"] + fn["w"] + 30) if cut.ar else (fn["x"] - 30)) * ks
    mark_v = (fn["y"] + fn["h"] / 2) * ks
    mdot = projS(mark_u, mark_v)
    ccol0 = 1222                                   # English column start for 3E labels
    ccol = W - ccol0 if cut.ar else ccol0           # near edge x on film
    fit = v3.COPY["fit"][1 if cut.ar else 0]
    lab_form_top = fdot[1] - 26 - 6
    lab_trk_top = mdot[1] - 150
    f_lead = f"M{fdot[0]:.1f} {fdot[1]:.1f} H{(ccol - 12) if not cut.ar else (ccol + 12):.1f}"
    t_sh = lab_trk_top + 56
    t_lead = (f"M{mdot[0]:.1f} {mdot[1] - 18:.1f} L{(ccol - 40) if not cut.ar else (ccol + 40):.1f} {t_sh:.1f} "
              f"H{(ccol - 12) if not cut.ar else (ccol + 12):.1f}")
    # Phone A (WhatsApp) on the end side, in front of the stepped-back screen.
    PH = 760
    PWp = PH * 390 / 845
    pk = PWp / 390
    pax = cut.mx(1100, PWp)
    pay = 110
    wa = boxes[f"phone-{L}"]["wa-float"]
    if cut.ar:
        wa_pt = (pax + wa["x"] * pk - 6, pay + (wa["y"] + wa["h"] / 2) * pk)
        wa_end = wa_pt[0] - 52
    else:
        wa_pt = (pax + (wa["x"] + wa["w"]) * pk + 6, pay + (wa["y"] + wa["h"] / 2) * pk)
        wa_end = wa_pt[0] + 52
    wa_lead = f"M{wa_pt[0]:.1f} {wa_pt[1]:.1f} H{wa_end:.1f}"
    wa_lab_x = (W - (wa_end - 12)) if cut.ar else (wa_end + 12)
    # Phone B (the link), centred.
    pbx, pby = (W - PWp) / 2, 70
    tall = boxes[f"phonetall-{L}"]
    tall_h = tall["page"]["h"] * pk
    tscroll = tall["strip"]["y"] * pk - 40
    # Rev B round the finished home, in its plane, inside the 90% box.
    padB = 6
    dB = cloud_path(-padB, -padB, SW_ + 2 * padB, SH_ + 2 * padB, step=28, rtl=cut.ar)
    # The B beside the cloud's end edge near its top, in the open column
    # (above the cloud it would leave the 90% box).
    triB_u = (-padB - 14 - 54) if cut.ar else (SW_ + padB + 14)
    care_top = 826 - 2 * (30 if cut.ar else 28) * 1.36
    care_w = TX1 - ccol0
    care_html = esc(v3.COPY["care"][1 if cut.ar else 0])
    body = f"""
{plate_html(cut, 's-plate', 'assets/img/court-warm.jpg')}
<div id="s-home" class="abs" style="{box(*home_rect)}transform-origin:0 0"><div id="s-homep" class="pane"><img src="assets/cap/index-{L}.png"><div class="edge"></div></div></div>
{shtml}
<svg class="svgo" viewBox="0 0 {W} {H}" aria-hidden="true">{fr}</svg>
{kin}
<div id="s-cur" class="abs" style="left:0;top:0;width:28px;height:36px">{CURSOR_SVG}</div>
<div id="s-scr" class="abs" style="{box(sx, sy, SW_, SH_)}{tilt(ry_, rx_)}" data-layout-allow-overflow>
 <div id="s-scrm" class="abs" style="{box(0, 0, SW_, SH_)}" data-layout-allow-overflow>
  <div id="s-scrsh" class="abs" style="{box(0, 0, SW_, SH_)}border-radius:10px;box-shadow:0 34px 60px -18px rgba(2,5,16,0.72), 0 90px 150px -40px rgba(2,5,16,0.60)"></div>
  <div id="s-pane" class="abs" style="{box(0, 0, SW_, SH_)}overflow:hidden;background:{DEEP};box-shadow:0 0 0 1px rgba(255,255,255,0.20)">
   <img id="s-proj" src="assets/cap/projects-full-{L}.png" style="position:absolute;left:0;top:0;width:{SW_}px;height:{full_h:.1f}px">
   <img id="s-contact" class="pimg" src="assets/cap/contact-{L}.png">
   <img id="s-homeB" class="pimg" src="assets/cap/index-{L}.png">
   <div id="s-sweep" class="sweep"></div>
   <div class="edge"></div>
  </div>
  <div id="s-trk" class="abs trk" style="{box(mark_u - 15, mark_v - 15, 30, 30)}">{TRACK_SVG}</div>
  <svg class="abs" style="{box(0, 0, SW_, SH_)}overflow:visible" viewBox="0 0 {SW_} {SH_}" aria-hidden="true">
   <path id="s-cloudh" class="draw" d="{dB}" pathLength="1" stroke="{DEEP}" stroke-width="9" stroke-linejoin="round" stroke-linecap="round"/>
   <path id="s-cloud" class="draw" d="{dB}" pathLength="1" stroke="{TEAL}" stroke-width="3.2" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>
  {tri("s-tri", triB_u, 36, "B", TEAL)}
 </div>
</div>
<div id="s-phA" class="abs phone4" style="{box(pax, pay, PWp, PH)}"><img src="assets/cap/phone-{L}.png" style="width:100%;height:100%;object-fit:cover;object-position:top"></div>
<div id="s-phB" class="abs phone4" style="{box(pbx, pby, PWp, PH)}background:{DEEP}">
 <div id="s-tallw" class="abs" style="left:0;top:0;width:100%;height:{tall_h:.1f}px" data-layout-allow-overflow><img id="s-tall" src="assets/cap/phonetall-{L}.png" style="width:100%;height:{tall_h:.1f}px;display:block"></div>
 <div id="s-chip" class="abs" style="left:0;right:0;top:44%;display:flex;justify-content:center"><div class="chip"><span class="lk">{LINK_SVG}</span><span>hosh.example</span></div></div>
</div>
<svg class="svgo" viewBox="0 0 {W} {H}" aria-hidden="true">
 <path id="s-l1h" class="draw" d="{wa_lead}" pathLength="1" stroke="{DEEP}" stroke-opacity="0.7" stroke-width="7"/>
 <path id="s-l1" class="draw" d="{wa_lead}" pathLength="1" stroke="{TEAL}" stroke-width="2"/>
 <path id="s-l2h" class="draw" d="{f_lead}" pathLength="1" stroke="{DEEP}" stroke-opacity="0.7" stroke-width="7"/>
 <path id="s-l2" class="draw" d="{f_lead}" pathLength="1" stroke="{TEAL}" stroke-width="2"/>
 <circle id="s-d2" cx="{fdot[0]:.1f}" cy="{fdot[1]:.1f}" r="8" fill="{DEEP}" fill-opacity="0.55" stroke="{TEAL}" stroke-width="2.5"/>
 <path id="s-l3h" class="draw" d="{t_lead}" pathLength="1" stroke="{DEEP}" stroke-opacity="0.7" stroke-width="7" stroke-linejoin="round"/>
 <path id="s-l3" class="draw" d="{t_lead}" pathLength="1" stroke="{TEAL}" stroke-width="2" stroke-linejoin="round"/>
</svg>
{label_html(cut, "s-p1", wa_lab_x, wa_pt[1] - 26, esc(fit[0]), color=TEAL)}
{label_html(cut, "s-p2", W - ccol if cut.ar else ccol, lab_form_top, esc(fit[1]), color=TEAL)}
{label_html(cut, "s-p3", W - ccol if cut.ar else ccol, lab_trk_top, esc(fit[2]), color=TEAL, extra=f"width:{TX1 - ccol0}px;white-space:normal;text-wrap:balance")}
<div id="s-care" class="recd mono" style="{side(cut, ccol0)}top:{care_top:.1f}px;width:{care_w}px;white-space:normal;text-wrap:balance;{'font-size:30px;text-align:right' if cut.ar else ''}">{care_html}</div>
"""
    sweep_bg = "linear-gradient(100deg, rgba(255,236,206,0) 0%, rgba(255,236,206,0.18) 50%, rgba(255,236,206,0) 100%)"
    css = CSS4 + f"""
.sheet{{overflow:hidden;background:{DEEP}}}
.slab{{text-align:center;font-size:{30 if cut.ar else 28}px;color:{INK_A(0.86)};white-space:nowrap;text-shadow:0 1px 12px rgba(6,13,36,0.7)}}
.phone4{{overflow:hidden;border-radius:46px;background:#000;
  box-shadow:0 0 0 1px rgba(255,255,255,0.20), 0 34px 60px -18px rgba(2,5,16,0.72), 0 90px 150px -40px rgba(2,5,16,0.60)}}
.chip{{display:flex;align-items:center;gap:10px;padding:12px 18px;border-radius:999px;background:#0e1a42;box-shadow:0 0 0 1px {LINE_STRONG};font:500 28px 'Geist Mono',monospace;white-space:nowrap;direction:ltr;color:{INK}}}
.lk{{width:26px;height:26px;color:{TEAL}}}
.trk{{color:{TEAL}}}
.trk svg{{width:100%;height:100%}}
#s-cur svg{{width:100%;height:100%}}
#s-sweep{{background:{sweep_bg};mix-blend-mode:soft-light}}
"""
    sh_ids = [f"#s-sh{i}" for i in range(6)]
    lb_ids = [f"#s-lb{i}" for i in range(6)]
    fr_ids = [f"#s-fr{i}" for i in range(6)]
    js = hide0(*sh_ids, *lb_ids, "#s-k1", "#s-k2", "#s-cur", "#s-scr", "#s-phA", "#s-phB", "#s-tallw", "#s-chip",
               "#s-contact", "#s-homeB", "#s-trk", "#s-tri", "#s-p1", "#s-p2", "#s-p3", "#s-d2", "#s-care")
    js += f'  gsap.set([{",".join(json.dumps(f"#s-o{i}") for i in range(6))}], {{ clipPath: "inset(0% 0% 100% 0%)" }});\n'
    js += '  gsap.set("#s-b1", { clipPath: "inset(0% 0% 100% 0%)" });\n'
    js += f'  gsap.set("#s-cur", {{ x: {cur_from[0]:.1f}, y: {cur_from[1]:.1f} }});\n'
    js += '  tl.fromTo("#s-plate-w", { scale: 1.045, x: -2 }, { scale: 1.085, x: -28, duration: 17.4, ease: "power1.inOut" }, 0);\n'
    # 3C: on "six" the home page shrinks into sheet 1; the others issue from
    # behind it; the frames draw; the labels come up.
    t6 = max(T("six") - 0.15, 0.02)   # the shrink leads "six" a little
    hx0, hy0, HW, HH = home_rect
    js += (f'  tl.to("#s-home", {{ x: {sheets[0][0] - hx0:.2f}, y: {sheets[0][1] - hy0:.2f}, scale: {SHW / HW:.5f}, '
           f'duration: 0.5, ease: "power3.inOut" }}, {t6:.3f});\n')
    js += f'  tl.to("#s-homep", {{ boxShadow: "0 0 0 1px rgba(255,255,255,0), 0 0 0 0 rgba(2,5,16,0), 0 0 0 0 rgba(2,5,16,0)", borderRadius: 0, duration: 0.5, ease: "power2.in" }}, {t6:.3f});\n'
    js += f'  tl.set("#s-sh0", {{ opacity: 1 }}, {t6 + 0.5:.3f});\n  tl.set("#s-home", {{ opacity: 0 }}, {t6 + 0.5:.3f});\n'
    for i in range(1, 6):
        x, y = sheets[i]
        js += (f'  tl.fromTo("#s-sh{i}", {{ opacity: 0, x: {sheets[0][0] - x:.1f}, y: {sheets[0][1] - y:.1f} }}, '
               f'{{ opacity: 1, x: 0, y: 0, duration: 0.5, ease: "expo.out" }}, {t6 + 0.42 + 0.06 * i:.3f});\n')
    for i in range(6):
        js += draw_js(f"#s-fr{i}", t6 + 0.55 + 0.06 * i, 0.4, "power2.out")
        js += fade_js(f"#s-lb{i}", t6 + 0.62 + 0.06 * i, 0.2)
    # "Six pages" lands as "pages" is said, once the page has left the column.
    js += blur_in("#s-k1", T("six") + 0.2)
    js += blur_in("#s-k2", T("arabic") - 0.04)
    # On "English": the cursor taps sheet 1's language switch (one click),
    # and every sheet re-issues in the other language, top down, in order.
    e = T("english")
    js += fade_js("#s-cur", e - 1.0, 0.2)
    js += f'  tl.to("#s-cur", {{ x: {cur_to[0] - 3:.1f}, y: {cur_to[1] - 2:.1f}, duration: 0.7, ease: "power2.inOut" }}, {e - 0.86:.3f});\n'
    js += f'  tl.to("#s-cur", {{ scale: 0.86, duration: 0.06 }}, {e - 0.14:.3f});\n  tl.to("#s-cur", {{ scale: 1, duration: 0.14 }}, {e - 0.07:.3f});\n'
    for i in range(6):
        js += f'  tl.to("#s-o{i}", {{ clipPath: "inset(0% 0% 0% 0%)", duration: 0.4, ease: "power2.out" }}, {e + 0.06 * i:.3f});\n'
    js += f'  tl.to("#s-cur", {{ opacity: 0, duration: 0.2 }}, {e + 0.45:.3f});\n'
    # 3D: the words leave at 21.0; sheet 2 re-issues in the cut's language and
    # grows into the start-side screen; one slow scroll to the first project.
    js += blur_out(["#s-k1", "#s-k2"], 21.0 - 17.6)
    tp = T("projects")
    js += f'  tl.to("#s-b1", {{ clipPath: "inset(0% 0% 0% 0%)", duration: 0.3, ease: "power2.out" }}, {tp - 0.32:.3f});\n'
    x2, y2 = sheets[1]
    sc0 = SHW / SW_
    js += f'  tl.set("#s-scr", {{ opacity: 1 }}, {tp:.3f});\n  tl.set("#s-sh1", {{ opacity: 0 }}, {tp:.3f});\n'
    js += (f'  tl.fromTo("#s-scrm", {{ x: {x2 + SHW / 2 - pcx:.1f}, y: {y2 + SHH / 2 - pcy:.1f}, scale: {sc0:.5f} }}, '
           f'{{ x: 0, y: 0, scale: 1, duration: 0.6, ease: "power2.inOut", immediateRender: false }}, {tp:.3f});\n')
    js += f'  tl.fromTo("#s-scrsh", {{ opacity: 0 }}, {{ opacity: 1, duration: 0.6, ease: "power2.in", immediateRender: false }}, {tp:.3f});\n'
    js += f'  tl.fromTo("#s-pane", {{ borderRadius: 0 }}, {{ borderRadius: 10, duration: 0.6, ease: "power2.in", immediateRender: false }}, {tp:.3f});\n'
    others = [s for j, s in enumerate(sh_ids) if j != 1] + lb_ids + fr_ids
    js += f'  tl.to({json.dumps(others)}, {{ opacity: 0, duration: 0.3, ease: "power1.out" }}, {tp:.3f});\n'
    js += f'  tl.fromTo("#s-proj", {{ y: 0 }}, {{ y: {-scroll:.1f}, duration: 1.2, ease: "power2.inOut" }}, {21.9 - 17.6:.3f});\n'
    a_, b_ = (210, -110) if cut.ar else (-110, 210)
    js += f'  tl.fromTo("#s-sweep", {{ xPercent: {a_} }}, {{ xPercent: {b_}, duration: 3.6, ease: "power1.inOut" }}, {tp + 0.7:.3f});\n'
    # 3E: the screen steps back; the WhatsApp phone comes in front of it.
    t = T("whatsapp") - 0.15
    js += f'  tl.to("#s-scrm", {{ scale: {STEP}, duration: 0.5, ease: "power2.inOut" }}, {min(t - 0.3, 23.2 - 17.6):.3f});\n'
    js += f'  tl.fromTo("#s-phA", {{ opacity: 0, y: 40 }}, {{ opacity: 1, y: 0, duration: 0.35, ease: "expo.out" }}, {t:.3f});\n'
    js += draw_js("#s-l1h", t + 0.15, 0.2, "power2.out") + draw_js("#s-l1", t + 0.15, 0.2, "power2.out")
    js += blur_in("#s-p1", t + 0.25)
    # The enquiry form: the page cuts to contact under the phone, the phone goes.
    t = T("form")
    js += f'  tl.set("#s-proj", {{ opacity: 0 }}, {t:.3f});\n  tl.set("#s-contact", {{ opacity: 1 }}, {t:.3f});\n'
    js += f'  tl.to(["#s-phA", "#s-p1", "#s-l1", "#s-l1h"], {{ opacity: 0, duration: 0.15 }}, {t + 0.15:.3f});\n'
    js += fade_js("#s-d2", t + 0.32, 0.12)
    js += draw_js("#s-l2h", t + 0.36, 0.28, "power2.out") + draw_js("#s-l2", t + 0.36, 0.28, "power2.out")
    js += blur_in("#s-p2", t + 0.5)
    # Tracking: the mark in the footer and its label.
    # Just before its word, but never before the form's label has landed
    # (Arabic's script windows put the two words 0.7 s apart).
    t = max(T("tracking") - 0.55, T("form") + 0.6)
    js += fade_js("#s-trk", t, 0.2, extra_from=", scale: 0.8", extra_to=", scale: 1")
    js += draw_js("#s-l3h", t + 0.1, 0.3, "power2.out") + draw_js("#s-l3", t + 0.1, 0.3, "power2.out")
    js += blur_in("#s-p3", t + 0.25)
    # Care prints as a label of record at the column's foot (to 30.9).
    cp = "inset(0% 0% 0% 100%)" if cut.ar else "inset(0% 100% 0% 0%)"
    js += f'  tl.fromTo("#s-care", {{ opacity: 1, clipPath: "{cp}" }}, {{ opacity: 1, clipPath: "inset(0% 0% 0% 0%)", duration: 0.7, ease: "none", immediateRender: false }}, {T("care"):.3f});\n'
    # 3F: the link arrives in the phone, the site opens, one scroll.
    t = T("link")
    js += f'  tl.to(["#s-p2", "#s-l2", "#s-l2h", "#s-d2"], {{ opacity: 0, duration: 0.15 }}, {t - 0.05:.3f});\n'
    js += f'  tl.to(["#s-scr", "#s-trk", "#s-p3", "#s-l3", "#s-l3h"], {{ opacity: 0, duration: 0.15 }}, {t + 0.1:.3f});\n'
    js += fade_js("#s-phB", t + 0.1, 0.25)
    js += f'  tl.fromTo("#s-chip", {{ opacity: 0, y: -60 }}, {{ opacity: 1, y: 0, duration: 0.45, ease: "expo.out" }}, {t + 0.18:.3f});\n'
    js += f'  tl.to("#s-chip", {{ opacity: 0, duration: 0.15 }}, {T("open"):.3f});\n'
    js += f'  tl.fromTo("#s-tallw", {{ opacity: 0, scale: 0.96 }}, {{ opacity: 1, scale: 1, duration: 0.35, ease: "power2.out" }}, {T("open"):.3f});\n'
    js += f'  tl.fromTo("#s-tall", {{ y: 0 }}, {{ y: {-tscroll:.1f}, duration: 1.8, ease: "power2.inOut" }}, {T("scroll"):.3f});\n'
    # 3G: the finished home returns; Rev B on the second "they"; still; a push-cut.
    t = T("ret")
    js += f'  tl.to(["#s-phB", "#s-care"], {{ opacity: 0, duration: 0.15 }}, {t:.3f});\n'
    js += f'  tl.set("#s-contact", {{ opacity: 0 }}, {t:.3f});\n  tl.set("#s-homeB", {{ opacity: 1 }}, {t:.3f});\n'
    js += f'  tl.set("#s-scrm", {{ scale: 1 }}, {t:.3f});\n'
    js += f'  tl.to("#s-scr", {{ opacity: 1, duration: 0.3, ease: "power1.out" }}, {t + 0.15:.3f});\n'
    t = T("before")
    js += draw_js("#s-cloudh", t) + draw_js("#s-cloud", t) + fade_js("#s-tri", t + 0.5, 0.16)
    js += f'  tl.to("#s-scrm", {{ scale: 1.08, duration: 0.3, ease: "power3.in" }}, {35.0 - 17.6 - 0.3:.3f});\n'
    geo = {"sheets": sheets, "sheet": [SHW, SHH], "column_x0": col_x0, "screen": [round(sx, 1), sy, SW_, SH_],
           "phoneA": [round(pax, 1), pay], "form_dot": [round(fdot[0], 1), round(fdot[1], 1)], "mark": [round(mdot[0], 1), round(mdot[1], 1)]}
    return scene("site", cut, css, body, js, ' data-hold="true"'), geo


# ---------------------------------------------------------------- 35 to 45: what we need

NEED = (745, 160, 1063, 756)   # the end-side screen (English x)


def need(cut, A, boxes, M, ret_thumb):
    L = cut.lang
    nx_en, ny, NW, NH = NEED
    nx = cut.mx(nx_en, NW)
    ry_, rx_ = (4.0 if cut.ar else -4.0), 1.2
    ks = NW / 1440
    tg = {"en": [(68, 74), (216, 785), (34, 971)], "ar": [(1372, 74), (1223, 785), (1406, 976)]}[L]
    # The push holds the services target still, so it never reaches the caption band.
    PUSH = 1.01
    ox, oy = tg[2][0] * ks, tg[2][1] * ks
    proj1 = projector(nx, ny, NW, NH, ry_, rx_, s=PUSH, ox=ox, oy=oy)
    proj0 = projector(nx, ny, NW, NH, ry_, rx_)
    targets = [proj0(u * ks, v * ks) for u, v in tg]
    labels = cut.c("need")
    col0, col1 = TX0, TX0 + 560                     # English column
    shoulder_y = [372, 566, 760]
    leads, dots, calls = "", "", ""
    for i, ((tx, ty), sy_, lab) in enumerate(zip(targets, shoulder_y, labels)):
        far = (W - col0) if cut.ar else col0
        nearx = (W - col1) if cut.ar else col1
        d = f"M{far:.1f} {sy_:.1f} H{nearx:.1f} L{tx:.1f} {ty:.1f}"
        leads += (f'<path id="n-lh{i}" class="draw" d="{d}" pathLength="1" stroke="{DEEP}" stroke-opacity="0.55" stroke-width="6"/>'
                  f'<path id="n-l{i}" class="draw" d="{d}" pathLength="1" stroke="{AMBER}" stroke-width="2"/>')
        dots += f'<circle id="n-d{i}" cx="{tx:.1f}" cy="{ty:.1f}" r="8" fill="{DEEP}" fill-opacity="0.55" stroke="{AMBER}" stroke-width="2.5"/>'
        calls += label_html(cut, f"n-c{i}", col0, sy_ - 58, esc(lab), color=AMBER)
    # The two weeks stamp, set large, in a ruled box in the start column.
    wk, fc = c4(cut, "weeks"), c4(cut, "from_content")
    stamp = (f'<div id="n-stamp" class="abs stamp" style="{side(cut, col0)}top:430px">'
             f'<div class="sw">{esc(wk)}</div><div class="sf">{esc(fc)}</div></div>')
    # Out: the screen shrinks into row 02's thumbnail of the schedule.
    pcx, pcy = nx + NW / 2, ny + NH / 2
    tcx, tcy, tw = ret_thumb
    body = f"""
{plate_html(cut, 'n-plate', 'assets/img/bg3-warm.jpg')}
<div id="n-p2w" class="abs" style="{box(0, 0, W, H)}">{plate_html(cut, 'n-plate2', 'assets/img/bg2-warm-lo.jpg')}</div>
<div id="n-push" class="abs" style="{box(0, 0, W, H)}" data-layout-allow-overflow>
 <div class="abs" style="{box(nx, ny, NW, NH)}{tilt(ry_, rx_)}" data-layout-allow-overflow>
  <div id="n-pm" class="abs" style="{box(0, 0, NW, NH)}transform-origin:{ox:.1f}px {oy:.1f}px" data-layout-allow-overflow>
   <div class="pane"><img src="assets/cap/index-{L}.png"><div id="n-sweep" class="sweep"></div><div class="edge"></div></div>
  </div>
 </div>
 <svg class="svgo" viewBox="0 0 {W} {H}" aria-hidden="true">{leads}{dots}</svg>
</div>
{calls}
<div id="n-kick" class="abs kick" style="{side(cut, col0)}top:112px;width:620px">{esc(cut.c('kicker'))}</div>
{stamp}
"""
    sweep_bg = "linear-gradient(100deg, rgba(255,236,206,0) 0%, rgba(255,236,206,0.20) 50%, rgba(255,236,206,0) 100%)"
    css = CSS4 + f"""
#n-sweep{{background:{sweep_bg};mix-blend-mode:soft-light}}
.kick{{font-size:{66 if cut.ar else 60}px;font-weight:600;line-height:1.08;text-wrap:balance;letter-spacing:-0.015em;color:{AMBER};text-shadow:0 2px 24px rgba(6,13,36,0.5);text-align:{'right' if cut.ar else 'left'}}}
.stamp{{padding:26px 34px 30px;box-shadow:inset 0 0 0 2px {AMBER};color:{AMBER};text-align:{'right' if cut.ar else 'left'}}}
.sw{{font-size:{120 if cut.ar else 112}px;font-weight:600;line-height:1.0;letter-spacing:-0.02em;white-space:nowrap}}
.sf{{margin-top:12px;font-size:{42 if cut.ar else 40}px;font-weight:500;line-height:1.2;white-space:nowrap}}
"""
    T = lambda key: A[key] - 35.0
    js = hide0("#n-kick", "#n-stamp", "#n-p2w", *[f"#n-c{i}" for i in range(3)], *[f"#n-d{i}" for i in range(3)])
    js += '  gsap.set("#n-p2w", { scale: 1.04 });\n'
    js += '  tl.fromTo("#n-plate-w", { scale: 1.08, x: 0 }, { scale: 1.12, x: 24, duration: 10, ease: "power1.inOut" }, 0);\n'
    # The push-cut lands: the page settles from 1.06.
    js += '  tl.fromTo("#n-pm", { scale: 1.06 }, { scale: 1, duration: 0.45, ease: "expo.out" }, 0);\n'
    js += f'  tl.to("#n-pm", {{ scale: {PUSH}, duration: 8.7, ease: "power1.inOut" }}, 0.6);\n'
    a, b = (210, -110) if cut.ar else (-110, 210)
    js += f'  tl.fromTo("#n-sweep", {{ xPercent: {a} }}, {{ xPercent: {b}, duration: 4.2, ease: "power1.inOut" }}, 1.4);\n'
    js += blur_in("#n-kick", T("kicker"))
    for i, key in enumerate(("logo", "photos", "services")):
        t = T(key) - 0.32
        js += draw_js(f"#n-lh{i}", t, 0.3, "power2.out") + draw_js(f"#n-l{i}", t, 0.3, "power2.out")
        js += fade_js(f"#n-d{i}", t + 0.22, 0.1)
        js += blur_in(f"#n-c{i}", t + 0.06)
    # 4B: the callouts leave; two weeks lands on "two".
    js += blur_out([f"#n-c{i}" for i in range(3)] + [f"#n-l{i}" for i in range(3)] + [f"#n-lh{i}" for i in range(3)] + [f"#n-d{i}" for i in range(3)], 41.4 - 35.0)
    js += f'  tl.fromTo("#n-stamp", {{ opacity: 0, scale: 1.04 }}, {{ opacity: 1, scale: 1, duration: 0.2, ease: "power3.out" }}, {T("weeks") - 0.04:.3f});\n'
    # Out: the type leaves, the plate turns to the courtyard, and the page
    # shrinks into row 02's thumbnail (the schedule takes it at 45.0).
    js += blur_out(["#n-kick", "#n-stamp"], 9.25, 0.25)
    js += fade_js("#n-p2w", 9.45, 0.5, ease="power1.inOut")
    k = tw / NW
    # Keep the push's origin (ox, oy): the pane's centre lands on the thumbnail's.
    ttx = (tcx - nx) - ox - k * (NW / 2 - ox)
    tty = (tcy - ny) - oy - k * (NH / 2 - oy)
    js += f'  tl.to("#n-pm", {{ x: {ttx:.1f}, y: {tty:.1f}, scale: {k:.5f}, duration: 0.7, ease: "power2.inOut" }}, 9.3);\n'
    geo = {"screen": [round(nx, 1), ny, NW, NH], "targets": [[round(a_, 1), round(b_, 1)] for a_, b_ in targets],
           "targets_at_push": [[round(v, 1) for v in proj1(u * ks, w_ * ks)] for u, w_ in tg]}
    return scene("need", cut, css, body, js, ' data-hold="true"'), geo


# ---------------------------------------------------------------- 45 to 52: the bill of quantities

SCHED = (559, 118, 1180, 744)   # container (English x): view title + sheet


def sched_geometry(cut):
    sx_en, sy, SW_, SH_ = SCHED
    sx = cut.mx(sx_en, SW_)
    ry_, rx_ = (6.0 if cut.ar else -6.0), 2.0
    # Inside the container: the view title (0 to 72), the sheet (96 to 744).
    BODY_Y, HEAD_H, ROW_H, ITEM_W, QTY_W, INSET = 96, 64, 236, 120, 380, 10
    th_w, th_h = 204, 115
    row2_top = BODY_Y + INSET + HEAD_H + ROW_H
    desc_x = (SW_ - INSET - ITEM_W - 34 - th_w) if cut.ar else (INSET + ITEM_W + 34)
    th = (desc_x, row2_top + (ROW_H - th_h) / 2, th_w, th_h)
    proj = projector(sx, sy, SW_, SH_, ry_, rx_, s=0.985)
    c = proj(th[0] + th_w / 2, th[1] + th_h / 2)
    a = proj(th[0], th[1] + th_h / 2)
    b = proj(th[0] + th_w, th[1] + th_h / 2)
    return {"sx": sx, "sy": sy, "w": SW_, "h": SH_, "ry": ry_, "rx": rx_, "BODY_Y": BODY_Y, "HEAD_H": HEAD_H, "ROW_H": ROW_H,
            "ITEM_W": ITEM_W, "QTY_W": QTY_W, "INSET": INSET, "thumb": th, "thumb_film": (c[0], c[1], abs(b[0] - a[0]))}


def ret(cut, A, timing):
    g = sched_geometry(cut)
    sx, sy, SW_, SH_ = g["sx"], g["sy"], g["w"], g["h"]
    cols = c4(cut, "cols")
    card = cut.c("card")
    yn = c4(cut, "your_numbers")
    thumbs = (("assets/img/hero-card.jpg", "50% 60%"), (f"assets/cap/index-{cut.lang}.png", "50% 0%"))
    rows = ""
    for i, (label, (src, pos)) in enumerate(zip(card, thumbs)):
        num = cut.num(i + 1) if cut.ar else f"0{i + 1}"
        rows += (f'<div class="br"><span class="bi mono">{esc(num)}</span>'
                 f'<span class="bd"><span class="bt"><img src="{src}" style="object-position:{pos}"></span><span class="bl">{esc(label)}</span></span>'
                 f'<span class="bq"><span id="r-f{i}" class="field"><span class="fl">{esc(yn)}</span></span></span></div>')
    th = g["thumb"]
    body = f"""
<div id="r-plw" class="abs" style="{box(0, 0, W, H)}">
 {plate_html(cut, 'r-lo', 'assets/img/bg2-warm-lo.jpg')}
 <div id="r-hiw" class="abs" style="{box(0, 0, W, H)}">{plate_html(cut, 'r-hi', 'assets/img/bg2-warm-hi.jpg')}</div>
</div>
<div class="abs" style="{box(sx, sy, SW_, SH_)}{tilt(g['ry'], g['rx'])}" data-layout-allow-overflow>
 <div id="r-sm" class="abs" style="{box(0, 0, SW_, SH_)}" data-layout-allow-overflow>
  <div id="r-body" class="abs" style="{box(0, 0, SW_, SH_)}">
   <div class="vt"><span>{esc(c4(cut, 'boq'))}</span></div>
   <div class="sheet5" style="{box(0, g['BODY_Y'], SW_, SH_ - g['BODY_Y'])}">
    <div class="in">
     <div class="bc mono"><span class="bi">{esc(cols[0])}</span><span class="bd">{esc(cols[1])}</span><span class="bq">{esc(cols[2])}</span></div>
     {rows}
     <div class="bf"><span class="bi"></span><span class="bd"></span><span class="bq mono">{esc(cut.c('tag'))}</span></div>
    </div>
   </div>
  </div>
  <div id="r-thc" class="abs" style="{box(*th)}overflow:hidden;box-shadow:0 0 0 1px rgba(242,246,250,0.45)"><img src="assets/sheet/index-{cut.lang}.jpg" style="width:100%;height:100%;object-fit:cover;object-position:50% 0%;display:block"></div>
 </div>
</div>
"""
    dash = AMBER
    css = CSS4 + f"""
.vt{{position:absolute;{'right' if cut.ar else 'left'}:0;top:0;padding-bottom:8px;border-bottom:3px solid {INK};font-size:{48 if cut.ar else 44}px;font-weight:600;line-height:60px;white-space:nowrap;color:{INK};text-shadow:0 2px 18px rgba(6,13,36,0.5)}}
.sheet5{{position:absolute;background:{SPACE_A(0.9)};box-shadow:inset 0 0 0 2px {INK_A(0.75)}, 0 30px 60px -24px rgba(2,5,16,0.55)}}
.sheet5 .in{{position:absolute;inset:{g['INSET']}px;box-shadow:0 0 0 1px {INK_A(0.45)};display:flex;flex-direction:column}}
.bc,.br,.bf{{display:grid;grid-template-columns:{g['ITEM_W']}px minmax(0,1fr) {g['QTY_W']}px}}
.bc{{height:{g['HEAD_H']}px;align-items:stretch;font-size:{30 if cut.ar else 28}px;color:{INK_A(0.78)};border-bottom:1px solid {INK_A(0.35)}}}
.bc span{{padding:0 26px;display:flex;align-items:center}}
.bi{{border-inline-end:1px solid {INK_A(0.35)}}}
.bq{{border-inline-start:1px solid {INK_A(0.35)}}}
.br{{height:{g['ROW_H']}px;border-bottom:1px solid {INK_A(0.35)}}}
.br .bi{{display:flex;align-items:center;justify-content:center;font-size:{30 if cut.ar else 28}px;color:{INK_A(0.78)}}}
.bd{{display:flex;align-items:center;gap:34px;padding:0 34px}}
.bt{{width:204px;height:115px;flex:none;overflow:hidden;box-shadow:0 0 0 1px {INK_A(0.45)}}}
.bt img{{width:100%;height:100%;object-fit:cover;display:block}}
.bl{{font-size:{54 if cut.ar else 50}px;font-weight:500;line-height:1.12;color:{INK};text-wrap:balance}}
.br .bq{{display:flex;align-items:center;justify-content:center}}
.field{{width:330px;height:104px;display:flex;align-items:center;justify-content:center;
  background-image:linear-gradient(90deg,{dash} 60%,transparent 0),linear-gradient(90deg,{dash} 60%,transparent 0),linear-gradient(0deg,{dash} 60%,transparent 0),linear-gradient(0deg,{dash} 60%,transparent 0);
  background-size:18px 2px,18px 2px,2px 18px,2px 18px;background-position:0 0,0 100%,0 0,100% 0;background-repeat:repeat-x,repeat-x,repeat-y,repeat-y}}
.fl{{font-size:{40 if cut.ar else 36}px;font-weight:500;color:{AMBER};white-space:nowrap}}
.bf{{flex:1;align-items:stretch}}
.bf .bq{{display:flex;align-items:center;padding:0 26px;font-size:{30 if cut.ar else 28}px;letter-spacing:0.04em;color:{INK_A(0.82)}}}
"""
    # The fields land on "projects" (how many?), and stay empty on purpose.
    t_proj = A["return_projects"]
    t_proj -= 45.0
    js = hide0("#r-hiw", "#r-f0", "#r-f1")
    js += '  tl.fromTo("#r-plw", { scale: 1.04, x: 0 }, { scale: 1.08, x: -20, duration: 7, ease: "power1.inOut" }, 0);\n'
    js += fade_js("#r-hiw", 0.2, 2.6, ease="power2.inOut")
    js += '  tl.fromTo("#r-sm", { scale: 0.985 }, { scale: 1, duration: 0.6, ease: "expo.out" }, 0);\n'
    js += '  tl.to("#r-sm", { scale: 1.02, duration: 6.2, ease: "power1.inOut" }, 0.6);\n'
    js += '  tl.fromTo("#r-body", { opacity: 0 }, { opacity: 1, duration: 0.3, ease: "power1.out" }, 0);\n'
    js += '  tl.set("#r-thc", { opacity: 0 }, 0.32);\n'
    js += fade_js("#r-f0", t_proj, 0.25) + fade_js("#r-f1", t_proj + 0.2, 0.25)
    js += '  tl.to("#r-body", { opacity: 0, duration: 0.3, ease: "power1.in" }, 6.7);\n'
    return scene("ret", cut, css, body, js, ' data-hold="true"'), {"sheet": [round(sx, 1), sy, SW_, SH_], "fields_at": round(t_proj + 45, 2)}


# ---------------------------------------------------------------- 52 to 60: the slot and the lockup

def close(cut, A, real_clip):
    SL = (320, 180, 1280, 720)
    inside = (f'<video id="c-clip" class="clip" playsinline data-has-audio="true" src="assets/media/close.mp4" data-start="0" data-duration="8" '
              f'data-track-index="2" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"></video>') if real_clip else (
        f'<img src="assets/brand/mark.png" class="abs" style="{box(640 - 48, 250, 96, 96)}">'
        f'<div class="abs closing" style="{box(80, 390, 1120, 160)}">{esc(cut.c("closing"))}</div>')
    lock_ground = "transparent" if real_clip else SPACE
    lock_box = box(W / 2 - 95, 916, 190, 50) if real_clip else box(W / 2 - 450, H / 2 - 160, 900, 240)
    body = f"""
<div id="c-push" class="abs" style="{box(0, 0, W, H)}" data-layout-allow-overflow>
 <div id="c-plw" class="abs" style="{box(0, 0, W, H)}">{plate_html(cut, 'c-plate', 'assets/img/bg2-warm-hi.jpg')}</div>
 <div id="c-slot" class="abs slot" style="{box(*SL)}">{inside}</div>
</div>
<div id="c-lock" class="abs" style="{box(0, 0, W, H)}background:{lock_ground}">
 <img src="assets/brand/lockup.png" class="abs" style="{lock_box}object-fit:contain">
</div>
"""
    css = CSS4 + f"""
.slot{{overflow:hidden;background:{SPACE_A(0.88)};box-shadow:0 0 0 1px {LINE_STRONG}, 0 34px 60px -18px rgba(2,5,16,0.72), 0 90px 150px -40px rgba(2,5,16,0.6)}}
.closing{{text-align:center;font-size:{52 if cut.ar else 48}px;font-weight:500;line-height:1.3;color:{INK};text-wrap:balance}}
"""
    js = hide0("#c-lock")
    js += '  gsap.set("#c-plw", { scale: 1.08, x: -20 });\n'
    js += '  tl.fromTo("#c-slot", { opacity: 0, scale: 0.985 }, { opacity: 1, scale: 1, duration: 0.5, ease: "expo.out" }, 0.05);\n'
    js += '  tl.fromTo("#c-push", { scale: 1 }, { scale: 1.04, duration: 7, ease: "power1.inOut" }, 0);\n'
    js += '  tl.set("#c-lock", { opacity: 1 }, 7.0);\n'
    return scene("close", cut, css, body, js, ' data-hold="true"')


def tag(cut):
    if cut.ar:
        st = f"left:{TX0}px;top:{TY0}px;font-size:30px"
    else:
        st = f"right:{W - TX1}px;top:{TY0}px"
    body = f'<div id="t-tag" class="abs mono tagx" style="{st}">{esc(cut.c("tag"))}</div>'
    css = f".tagx{{font-size:28px;line-height:1;letter-spacing:0.06em;color:{INK_A(0.8)};white-space:nowrap;text-shadow:0 1px 14px rgba(6,13,36,0.7)}}"
    # 45 to 52 s the schedule carries the tag in its own strip (F10).
    return scene("tag", cut, css, body, '  tl.fromTo("#t-tag", { opacity: 1 }, { opacity: 1, duration: 45 }, 0);\n')


HOSTS = [("hook", 0, 5.25, 0), ("gap", 5, 10, 1), ("reveal", 15, 2.6, 1), ("site", 17.6, 17.4, 1), ("need", 35, 10, 1),
         ("ret", 45, 7, 1), ("close", 52, 8, 1)]


def root_html(cut, has_vo, clean, poster, has_bed, rng=None, has_clip=False):
    a0, a1 = rng if rng else (0, 60)
    h = ""
    for i, (sid, st, du, tr) in enumerate(HOSTS):
        s2, e2 = max(st, a0), min(st + du, a1)
        if e2 <= s2:
            continue
        h += (f'<div id="{sid}" data-composition-id="{sid}" data-composition-src="compositions/{sid}.html" data-start="{s2 - a0:.3f}" '
              f'data-duration="{e2 - s2:.3f}"{f" data-media-start={chr(34)}{s2 - st:.3f}{chr(34)}" if s2 > st else ""} '
              f'data-track-index="{tr}" data-track-kind="graphics" data-width="{W}" data-height="{H}" style="z-index:{2 + i}"></div>\n')
    if not rng:
        h += (f'<div id="tag" data-composition-id="tag" data-composition-src="compositions/tag.html" data-start="0" data-duration="45" '
              f'data-track-index="3" data-track-kind="graphics" data-width="{W}" data-height="{H}" style="z-index:20"></div>\n')
        if not clean:
            h += (f'<div id="captions" data-composition-id="captions" data-composition-src="compositions/captions.html" data-start="0" '
                  f'data-duration="60" data-track-index="4" data-track-kind="captions" data-width="{W}" data-height="{H}" style="z-index:30"></div>\n')
        if poster:
            h += (f'<div id="poster-title" class="clip" data-start="33" data-duration="1" data-track-index="5" style="position:absolute;left:0;right:0;'
                  f'bottom:{H - 968}px;text-align:center;z-index:40;font:600 58px/1.2 {cut.font()};color:{INK};direction:{"rtl" if cut.ar else "ltr"};'
                  f'text-shadow:0 2px 24px rgba(6,13,36,0.6)">{esc(cut.c("poster"))}</div>\n')
    a = ""
    if not rng:
        if has_vo:
            a += f'<audio id="vo" class="clip" src="assets/audio/vo.wav" data-start="0" data-duration="{52 if has_clip else 60}" data-track-index="10" data-volume="1"></audio>\n'
        a += '<audio id="room" class="clip" src="assets/audio/room.wav" data-start="0" data-duration="60" data-track-index="11" data-volume="1"></audio>\n'
        if has_bed:
            a += '<audio id="bed" class="clip" src="assets/audio/bed.wav" data-start="0" data-duration="60" data-track-index="14" data-volume="1"></audio>\n'
        a += '<audio id="keys" class="clip" src="assets/audio/keys.wav" data-start="0" data-duration="8" data-track-index="12" data-volume="1"></audio>\n'
        a += '<audio id="click" class="clip" src="assets/audio/click.wav" data-start="0" data-duration="24" data-track-index="13" data-volume="1"></audio>\n'
    dur = a1 - a0
    return f"""<!doctype html>
<html lang="{cut.lang}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width={W}, height={H}" />
<script src="assets/vendor/gsap.min.js"></script>
<style>
{v3.FONTS_CSS}
*{{margin:0;padding:0;box-sizing:border-box}}
html,body{{margin:0;width:{W}px;height:{H}px;overflow:hidden;background:{SPACE}}}
#ground{{position:absolute;inset:0;background:{SPACE}}}
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="{dur:g}" data-width="{W}" data-height="{H}">
<div id="ground"></div>
{h}{a}</div>
<script>
  const tl = gsap.timeline({{ paused: true }});
  window.__timelines["main"] = tl;
</script>
</body>
</html>
"""


def copy_items(cut, lines):
    items = v3.copy_items(cut, lines)
    for k, v in COPY4.items():
        val = v[1] if cut.ar else v[0]
        for t in val if isinstance(val, list) else [val]:
            items.append({"lang": cut.lang, "where": f"v4:{k}", "text": t.replace("{date}", "")})
    names = v3.COPY["rows"][1 if cut.ar else 0]
    for i, n in enumerate(names):
        items.append({"lang": cut.lang, "where": "v4:sheet", "text": f"{cut.num(i + 1)} {n}" if cut.ar else f"0{i + 1} {n}"})
    return items


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lang", choices=["en", "ar"], required=True)
    ap.add_argument("--clean", action="store_true")
    ap.add_argument("--poster", action="store_true")
    ap.add_argument("--out", required=True)
    ap.add_argument("--media", default=str(HOME / "upsell-studio-video/website"))
    ap.add_argument("--bed", choices=["off", "heygen"], default="off")
    ap.add_argument("--range", help="START,END: only that stretch (a timed test render)")
    ap.add_argument("--baked", help="the baked grades (default <media>/v4/baked)")
    a = ap.parse_args()
    rng = tuple(float(x) for x in a.range.split(",")) if a.range else None
    media = Path(a.media)
    caps = media / "capture/v3"
    baked = Path(a.baked) if a.baked else media / "v4/baked"
    cut = Cut(a.lang)
    lines = json.loads((v3.HERE / "lines.json").read_text())
    slug = v3.VOICE_SLUG[a.lang]
    timing_path = media / f"voice/{a.lang}/{slug}/timing.json"
    vo = media / f"voice/{a.lang}/{slug}/website-vo-{a.lang}-{slug}.wav"
    has_vo = timing_path.exists() and vo.exists()
    timing = json.loads(timing_path.read_text()) if has_vo else None
    if not has_vo and a.lang == "en":
        raise SystemExit("The English voice or its timing file is missing: run the voice step first.")
    boxes = json.loads((caps / "boxes.json").read_text())
    when = boxes["capturedAt"][:10]
    y, m, d = (int(x) for x in when.split("-"))
    date = f"{d} {v3.AR_MONTHS[m - 1]} {y}".translate(v3.AR_DIGITS) if cut.ar else f"{d} {v3.EN_MONTHS[m - 1]} {y}"
    A = v3.anchors(cut, timing, lines)
    # Two more words the type layer lands on: "thirty" (the dimension) and
    # "Arabic" (the second line at 3C), from the voice or the script's window.
    A.update(extra_cues(cut.lang, timing))
    real_clip = (HOME / f"upsell-build/media/real/aziz-close-{a.lang}.mp4")
    has_clip = real_clip.exists()
    M = measure([
        {"id": "seconds", "family": "Geist", "weight": 600, "size": 96, "text": c4(Cut("en"), "seconds")},
        {"id": "ar30", "family": "Plex Arabic", "weight": 600, "size": 104, "text": "٣٠ ثانية"},
        {"id": "note", "family": "Geist", "weight": 500, "size": 40, "text": Cut("en").c("note")},
        {"id": "arnote", "family": "Plex Arabic", "weight": 500, "size": 42, "text": Cut("ar").c("note")},
        {"id": "arabic_and", "family": "Geist", "weight": 600, "size": 96, "text": "Arabic and"},
    ])

    out = Path(a.out)
    if out.exists():
        shutil.rmtree(out)
    for sub in ("compositions", "assets/fonts", "assets/vendor", "assets/cap", "assets/sheet", "assets/media", "assets/img", "assets/brand", "assets/audio"):
        (out / sub).mkdir(parents=True)
    gf = v3.NM / "geist/dist/fonts"
    for f in ("Geist-Regular", "Geist-Medium", "Geist-SemiBold", "Geist-Bold"):
        shutil.copy(gf / f"geist-sans/{f}.woff2", out / f"assets/fonts/{f}.woff2")
    for f in ("GeistMono-Regular", "GeistMono-Medium"):
        shutil.copy(gf / f"geist-mono/{f}.woff2", out / f"assets/fonts/{f}.woff2")
    for wgt in (400, 500, 600):
        shutil.copy(v3.NM / f"@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-{wgt}-normal.woff2", out / f"assets/fonts/plexar-{wgt}.woff2")
    shutil.copy(v3.NM / "hyperframes/dist/vendor/npm/gsap@3.15.0/dist/gsap.min.js", out / "assets/vendor/gsap.min.js")
    L, O = cut.lang, cut.other
    for name in (f"index-{L}", f"projects-full-{L}", f"contact-{L}", f"phone-{L}", f"phonetall-{L}"):
        shutil.copy(caps / f"{name}.png", out / f"assets/cap/{name}.png")
    shutil.copy(baked / f"err-{L}-cold.png", out / f"assets/cap/err-{L}-cold.png")
    # The sheets: each page at twice its sheet size, both languages.
    for pg in PAGES:
        for lg in (L, O):
            v3.sh(["ffmpeg", "-y", "-v", "error", "-i", str(caps / f"{pg}-{lg}.png"), "-vf", "scale=640:-2", "-q:v", "2", str(out / f"assets/sheet/{pg}-{lg}.jpg")])
    for name in ("k2-night.mp4", "k2-soft.mp4", "k2-soft-cold.mp4", "k2-warm.mp4"):
        shutil.copy(baked / name, out / f"assets/media/{name}")
    shutil.copy(media / "final/kling/30fps/website-kling-2-hero-dolly-30fps.mp4", out / "assets/media/k2.mp4")
    for name in ("bg1-cold.jpg", "court-warm.jpg", "bg3-warm.jpg", "bg2-warm-lo.jpg", "bg2-warm-hi.jpg"):
        shutil.copy(baked / name, out / f"assets/img/{name}")
    v3.sh(["ffmpeg", "-y", "-v", "error", "-i", str(media / "final/art/website-hero-16x9.jpg"), "-vf", "scale=720:-2", "-q:v", "3", str(out / "assets/img/hero-card.jpg")])
    for scene_name in ("kitchen", "villa"):
        shutil.copy(v3.REPO / f"apps/client-success-cockpit/src/present/assets/examples/{scene_name}-feed.webp", out / f"assets/img/{scene_name}-feed.webp")
    shutil.copy(media / "brand/mahara-lockup-dark-full.png", out / "assets/brand/lockup.png")
    shutil.copy(media / "brand/favicon.png", out / "assets/brand/mark.png")
    if has_clip:
        clip_probe = json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_format", "-show_streams", "-of", "json", str(real_clip)], check=True, capture_output=True, text=True).stdout)
        if float(clip_probe["format"]["duration"]) < CLOSE_SECONDS or not any(s.get("codec_type") == "audio" for s in clip_probe["streams"]):
            raise SystemExit("Aziz's real closing clip needs at least 8 seconds and its own recorded audio. Never fill it with an artificial voice.")
        v3.sh(["ffmpeg", "-y", "-v", "error", "-i", str(real_clip), "-t", str(CLOSE_SECONDS), "-c:v", "libx264", "-crf", "14", "-c:a", "aac", str(out / "assets/media/close.mp4")])
    if has_vo:
        trim = ["-af", f"atrim=end={CLOSE_START},afade=t=out:st=51.95:d=0.05"] if has_clip else []
        v3.sh(["ffmpeg", "-y", "-v", "error", "-i", str(vo), *trim, "-ar", "48000", "-ac", "2", str(out / "assets/audio/vo.wav")])
    # Sound as v3; the one click now sounds on the cursor's tap at 3C.
    v3.make_audio(cut, dict(A, english=A["english"] - 0.14), out / "assets/audio", v3.NM / "hyperframes/dist/skills/media-use/audio/assets/sfx")
    bed = {"mode": "off", "why": "contract section 8: no ElevenLabs plan with commercial use, so room tone only"}
    if a.bed == "heygen":
        bed = v3.make_bed(media, out / "assets/audio", (out / "assets/audio/vo.wav") if has_vo else None)

    geo = {}
    hook_html, rcx, rcy = hook(cut, A)
    comps = {"hook": hook_html}
    rec = [t.replace("{date}", date) for t in c4(cut, "record")]
    comps["gap"], geo["gap"] = gap(cut, A, boxes, rec, M, (rcx, rcy))
    comps["reveal"], rv = reveal(cut, A, boxes)
    comps["site"], geo["site"] = site(cut, A, boxes, M, rv["home"])
    g5 = sched_geometry(cut)
    comps["need"], geo["need"] = need(cut, A, boxes, M, g5["thumb_film"])
    comps["ret"], geo["ret"] = ret(cut, A, timing)
    comps["close"] = close(cut, A, has_clip)
    comps["tag"] = tag(cut)
    groups = v3.caption_groups(cut, lines, timing)
    if has_clip:
        groups.append((CLOSE_START, 59.85, v3.screen_text(cut, cut.c("closing"))))
    comps["captions"] = v3.captions_scene(cut, groups)
    for sid, src in comps.items():
        (out / "compositions" / f"{sid}.html").write_text(src, encoding="utf-8")
    (out / "index.html").write_text(root_html(cut, has_vo, a.clean, a.poster, a.bed != "off", rng, has_clip), encoding="utf-8")
    (out / "hyperframes.json").write_text(json.dumps({
        "$schema": "https://hyperframes.heygen.com/schema/hyperframes.json",
        "paths": {"blocks": "compositions", "components": "compositions/components", "assets": "assets"},
        "media": {"autoProxy": True},
    }, indent=1))
    (out / f"website-{cut.lang}.vtt").write_text(v3.vtt(groups, None if has_clip else v3.closing_cue(cut, lines, timing)), encoding="utf-8")
    (out / "copy.json").write_text(json.dumps(copy_items(cut, lines), ensure_ascii=False, indent=1), encoding="utf-8")
    bake = json.loads((baked / "bake.json").read_text()) if (baked / "bake.json").exists() else {}
    (out / "build.json").write_text(json.dumps({
        "film": "v4 (direction A with B's grafts, v4-final-PLAN.md)", "lang": cut.lang, "clean": a.clean, "poster": a.poster,
        "range": rng, "voice": has_vo, "voice_slug": slug if has_vo else None, "voice_timing": str(timing_path) if has_vo else None,
        "source_fingerprint": source_fingerprint(Path(__file__).resolve().parent.parent),
        "script_sha256": sha256(v3.HERE / "lines.json"), "voice_sha256": sha256(vo) if has_vo else None,
        "voice_copy_matches": has_vo and all(next((t.get("text") for t in timing["lines"] if t["id"] == line["id"]), None) == line["text"] for line in lines[cut.lang] if not (has_clip and line.get("placeholder"))),
        "closing_sha256": sha256(real_clip) if has_clip else None, "closing_seconds": CLOSE_SECONDS if has_clip else None,
        "narrator_ends_at": CLOSE_START if has_clip else 60,
        "cues_from": "the voice's word times" if has_vo else "the script's windows (no narrator yet)",
        "anchors": {k: round(v, 3) for k, v in A.items()}, "captions": len(groups), "captured": when, "captures": str(caps),
        "closing": "real" if has_clip else "placeholder", "bed": {"track": v3.BED if a.bed != "off" else None, **bed},
        "geometry": geo, "baked": {k: {kk: v.get(kk) for kk in ("grade", "md5", "source")} for k, v in bake.items()},
    }, indent=1, ensure_ascii=False))
    print(f"v4: {out} ({cut.lang}{', clean' if a.clean else ''}{', poster' if a.poster else ''}{f', range {rng}' if rng else ''}, voice {'yes' if has_vo else 'no'})")


if __name__ == "__main__":
    main()
