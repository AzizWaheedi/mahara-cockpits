#!/usr/bin/env python3
"""v4, art direction B ("Drawing set"): the proof stills.

  python3 film/dirb.py --lang en|ar --out <dir>

Writes a HyperFrames project holding the five proof shots of the v4 plan
(hw-notes/upsell-studio/video/website/v4-dir-B/PLAN.md) at their real film
times, so `npx hyperframes snapshot --at 1.5,10,15.5,40.3,48.6` gives the key
frames: the hook (0 to 2.6 s), the gap (5 to 15 s), the turn (15 to 17.6 s),
what we need (35 to 45 s) and the bill of quantities (45 to 52 s). Between
them the ground is empty: this is a proof, not the film.

It reuses film/build.py for the copy, the voice clock, the captions and the
shapes, so captions, cue times and rules stay exactly v3's. Grades and blur go
on afterwards with `npx hyperframes media-treatment` (scripts/dirb-stills.sh),
never CSS filters.
"""
import argparse
import json
import math
import shutil
import subprocess
from pathlib import Path

import build as B  # film/build.py, the v3 film (same folder)

W, H = B.W, B.H
SPACE, DEEP, PANEL = B.SPACE, B.DEEP, B.PANEL
TEAL, INK, AMBER = B.TEAL, B.INK, B.AMBER
esc, box = B.esc, B.box

# Words only this direction shows. Arabic under the voice skill: plain Gulf
# business wording, no guillemets, Arabic-Indic digits, revision letters Latin.
COPYB = {
    "firm_caps": ("HOSH DESIGN & BUILD", "حوش للتصميم والبناء"),
    "sheets": (
        ["Sheet 1 of 5 · The ad", "Sheet 2 of 5 · What they find", "Sheet 3 of 5 · Your website",
         "Sheet 4 of 5 · From you", "Sheet 5 of 5 · Your numbers"],
        ["لوحة ١ من ٥ · الإعلان", "لوحة ٢ من ٥ · الوضع الحالي", "لوحة ٣ من ٥ · موقعكم",
         "لوحة ٤ من ٥ · منكم", "لوحة ٥ من ٥ · أرقامكم"],
    ),
    "thirty": ("30 seconds", "٣٠ ثانية"),
    "boq": ("Bill of quantities", "جدول الكميات"),
    "boq_cols": (["Item", "Description", "Quantity"], ["البند", "الوصف", "الكمية"]),
    "your_numbers": ("your numbers", "أرقامكم"),
}


def cb(cut, key):
    v = COPYB[key]
    return v[1] if cut.ar else v[0]


# ------------------------------------------------------------ the elevation
# The hero facade traced by hand on the Kling 2 first frame (= the 16:9 hero
# still at 1920 wide; measured on a 20 px grid, 26 Oct). Frame coordinates.

def walk_x(y):
    """The walkway's two edges at height y (it runs from 651 to the frame foot;
    remeasured for v4: the right edge reaches 1421 at the foot, not 1358)."""
    f = (y - 651) / 429
    return 886.6 + (501.8 - 886.6) * f, 1034 + (1421 - 1034) * f


# Registered for v4 on 26 Oct 2026 (scripts/trace_fit.py, report in
# <media>/v4/work/trace/trace.json): every coordinate moved onto the edge it
# was drawn on in the 30 fps clip's frame 0 (80 of 80 segments on an edge sit
# within 2 px), the stubs cut back to 16 px overruns (the far wing's canopy now
# stops at 1691, not in the palms), the walkway's edges remeasured and stopped
# at y 860. B's proof stills used the first, 20 px grid trace.
FACADE = [
    "M757 637 V102 H1161 V637",  # portal block
    "M842 637 V153 H1077 V637",  # its lit frame
    "M844 154 L870.5 222 M1075 154.5 L1045 221.5",  # the frame's reveals
    "M869 633 V230 H1046 V633",
    "M886 230 H1029 V625 H886 Z",  # door
    "M842 646 H1076",  # step
    "M757 127 H372 V637 M372 206 H331 V637",  # left wing
    "M372 384 H759 M372 426 H759",  # slab
    "M462 211 H697 V384 H462 Z",  # windows
    "M486 426 H694 V627 H486 Z M642 426 V627",
    "M384 209 H461 V623 H384 Z",  # screen
    "M1161 128 H1470 V637",  # right wing
    "M1161 383 H1468 M1161 426 H1468",
    "M1219 211 H1439 V383 H1219 Z M1376 211 V383",
    "M1219 426 H1434 V629 H1219 Z M1385 426 V629",
    "M1468 169 H1626 V637 M1626 262 H1691",
    "M1470 209 H1551 V624 H1470 Z",
    "M180 637 H1760",  # ground line
    "M609 652 H886 M1030 652 H1311",  # pool back edges
    "M608.5 644 L0.5 728.5 M590.5 664.5 L5.5 789.5",  # copings
    "M1312 641 L1920.5 732 M1332.5 647 L1921 755",
    "M886.5 651 L699.5 860 M1034 651 L1222.5 860 M886.5 651 H1034",  # walkway (stopped at y 860, clear of the caption band)
]
# Hatch on the real slats: the two side screens and the door (vertical edges
# found down each panel, at least 11 px apart).
HATCH = ["M402 211 V617", "M420 211 V617", "M433 211 V617", "M447 211 V617", "M1479 211 V617", "M1493 211 V617", "M1511 211 V617", "M1526 211 V617", "M900 233 V621", "M911 233 V621", "M926 233 V621", "M937 233 V621", "M953 233 V621", "M964 233 V621", "M977 233 V621", "M993 233 V621", "M1005 233 V621"]
# No walkway joints: frame 0 shows none above y 860, and the two it shows
# (a cross joint at y 878, a centre seam) sit in the caption band.
JOINTS = []

# The dolly under the trace, fitted on frames 0 to 42 of the 30 fps clip:
# frame -> (s, tx, ty) for x' = s*x + tx, y' = s*y + ty. It matches B's
# measured 1.008 and 1.018 at frames 15 and 30, then grows faster (1.028 at
# 39 against B's 1.0205), so the overlay plays these keys.
DOLLY_FIT = {
    0: (1.0, 0.0, 0.0),
    3: (1.0015, -1.35, -0.92),
    6: (1.0035, -3.15, -2.16),
    9: (1.0045, -4.05, -2.27),
    12: (1.0065, -5.85, -4.0),
    15: (1.0085, -7.65, -5.24),
    18: (1.01, -9.0, -6.16),
    21: (1.0125, -11.25, -7.7),
    24: (1.0155, -13.95, -8.55),
    27: (1.0185, -17.15, -9.9),
    30: (1.0205, -18.95, -11.63),
    33: (1.022, -20.3, -12.55),
    36: (1.024, -22.1, -14.28),
    39: (1.028, -26.2, -16.25),
    42: (1.031, -29.9, -17.6),
}

AXES = ((757, "1"), (1161, "2"))  # the portal's two piers; Arabic numbers them from the right


def facade_svg(pfx, lw=1.6, alpha=0.86):
    out = []
    for i, d in enumerate(FACADE):
        out.append(f'<path id="{pfx}f{i}" class="draw" d="{d}" pathLength="1" stroke="{INK}" stroke-width="{lw}" stroke-opacity="{alpha}" stroke-linejoin="miter"/>')
    for i, d in enumerate(HATCH + JOINTS):
        out.append(f'<path id="{pfx}h{i}" class="draw" d="{d}" pathLength="1" stroke="{INK}" stroke-width="1.1" stroke-opacity="0.42"/>')
    return "\n".join(out), len(FACADE), len(HATCH) + len(JOINTS)


def axes_svg(cut, pfx, y_c=76, y_end=1040):
    out = []
    labels = [a[1] for a in AXES]
    if cut.ar:
        labels = labels[::-1]
    for (x, _), lab in zip(AXES, labels):
        out.append(
            f'<g id="{pfx}{lab}" class="axis"><circle cx="{x}" cy="{y_c}" r="22" fill="{DEEP}" fill-opacity="0.7" stroke="{INK}" stroke-width="2"/>'
            f'<text x="{x}" y="{y_c + 8.5}" text-anchor="middle">{esc(cut.num(lab))}</text>'
            f'<path d="M{x} {y_c + 22} V{y_end}" stroke="{INK}" stroke-width="1.4" stroke-opacity="0.55" stroke-dasharray="22 7 3 7"/></g>'
        )
    return "\n".join(out)


def frame_lines(x, y, w, h, over=16, sw=2, color=INK, pid=None):
    """A viewport frame as a drafter draws it: each edge runs on past the
    corner by `over` px. One path, drawable with pathLength."""
    d = (
        f"M{x - over} {y} H{x + w + over} M{x + w} {y - over} V{y + h + over} "
        f"M{x + w + over} {y + h} H{x - over} M{x} {y + h + over} V{y - over}"
    )
    i = f' id="{pid}"' if pid else ""
    return f'<path{i} class="draw" d="{d}" pathLength="1" stroke="{color}" stroke-width="{sw}"/>'


def view_title(cut, vid, num, title, sub, x_start, y):
    """A drawing's view title: the view number in a circle, its name on a
    heavy rule, a note of record under it. x_start is its start edge."""
    side = f"left:{x_start}px" if not cut.ar else f"right:{W - x_start}px"
    sub_html = "".join(f'<div class="vt-sub mono">{esc(x)}</div>' for x in sub.split("|")) if sub else ""
    return (
        f'<div id="{vid}" class="abs vt" style="{side};top:{y}px">'
        f'<span class="vt-n mono">{esc(cut.num(num))}</span>'
        f'<div class="vt-b"><div class="vt-t">{esc(title)}</div>{sub_html}</div></div>'
    )


VT_CSS = f"""
.vt{{display:flex;align-items:flex-start;gap:18px}}
.vt-n{{width:52px;height:52px;flex:none;border-radius:50%;box-shadow:inset 0 0 0 2px {INK};display:grid;place-items:center;font-size:26px;line-height:1;direction:ltr}}
.vt-b{{display:flex;flex-direction:column}}
.vt-t{{font-size:32px;font-weight:500;line-height:44px;padding-bottom:6px;border-bottom:3px solid {INK};white-space:nowrap}}
.vt-sub{{margin-top:6px;font-size:24px;line-height:1.3;color:rgba(242,246,250,0.74);white-space:nowrap}}
.axis text{{font:500 24px 'Geist Mono',monospace;fill:{INK}}}
"""


# ------------------------------------------------------------ title block

def tblock_scene(cut):
    """The sheet's title block, top start corner, 0 to 52 s: the demo firm,
    Example, the sheet of five and its revision. Replaces v3's corner tag."""
    TW = 480
    x = cut.mx(96, TW)
    sheets = cb(cut, "sheets")
    def sheet_html(t):
        a, b = t.split(" · ")
        return f'{esc(a)}<i class="sep"></i>{esc(b)}'
    sh = "".join(f'<span id="tb-s{i + 1}" class="lay">{sheet_html(s)}</span>' for i, s in enumerate(sheets))
    body = f"""
<div id="tb" class="abs tb" style="left:{x}px;top:54px;width:{TW}px">
 <div class="c firm">{esc(cb(cut, 'firm_caps'))}</div>
 <div class="c ex mono">{esc(cut.c('tag'))}</div>
 <div class="c sh">{sh}</div>
 <div class="c rv mono"><span id="tb-r0" class="lay dim">Rev</span><span id="tb-rA" class="lay">Rev A</span><span id="tb-rB" class="lay">Rev B</span></div>
</div>"""
    css = f"""
.tb{{display:grid;grid-template-columns:minmax(0,1fr) 132px;grid-template-rows:48px 48px;background:rgba(6,13,36,0.94);box-shadow:inset 0 0 0 1.5px rgba(242,246,250,0.42)}}
.tb .c{{position:relative;display:flex;align-items:center;padding:0 16px;font-size:{26 if cut.ar else 24}px;line-height:1;white-space:nowrap}}
.tb .firm{{font-weight:600;letter-spacing:{0 if cut.ar else 0.06}em;border-bottom:1.5px solid rgba(242,246,250,0.42)}}
.tb .ex{{justify-content:center;color:{INK};border-bottom:1.5px solid rgba(242,246,250,0.42);border-inline-start:1.5px solid rgba(242,246,250,0.42)}}
.tb .sh{{color:rgba(242,246,250,0.80)}}
.tb .rv{{justify-content:center;direction:ltr;border-inline-start:1.5px solid rgba(242,246,250,0.42);color:rgba(242,246,250,0.80)}}
.tb .lay{{position:absolute;inset-inline-start:16px;top:50%;margin-top:-0.5em;line-height:1}}
.tb .rv .lay{{left:0;right:0;text-align:center}}
.tb .dim{{opacity:0.45}}
.tb .sep{{display:inline-block;width:1.5px;height:22px;margin:0 12px;vertical-align:-4px;background:rgba(242,246,250,0.5)}}
"""
    js = B.hide0("#tb", *[f"#tb-s{i}" for i in range(2, 6)], "#tb-rA", "#tb-rB")
    js += B.fade_js("#tb", 0.6, 0.35)
    for i, t in ((1, 5.0), (2, 15.0), (3, 35.0), (4, 45.0)):
        js += f'  tl.set("#tb-s{i}", {{ opacity: 0 }}, {t:.2f});\n  tl.set("#tb-s{i + 1}", {{ opacity: 1 }}, {t:.2f});\n'
    js += '  tl.set("#tb-r0", { opacity: 0 }, 5.0);\n'
    js += '  tl.set("#tb-rA", { opacity: 1 }, 5.0);\n  tl.set("#tb-rA", { opacity: 0 }, 15.0);\n  tl.set("#tb-rB", { opacity: 1 }, 15.0);\n'
    js += '  tl.fromTo("#tb", { y: 0 }, { y: 0, duration: 52 }, 0);\n'
    return B.scene("tblock", cut, css, body, js)


# ------------------------------------------------------------ shot 1: hook

def hook(cut, A):
    # The ad's window: the centre 80% of the 4:5 crop that Kling 1 is made
    # from (the 4:5 still is the 16:9 hero's centre crop, x 528 to 1392).
    WH_ = 864
    WW_ = WH_ * 4 / 5
    wx, wy = (W - WW_) / 2, 128
    fac, nf, nh = facade_svg("hk-")
    vt_x = 120 if not cut.ar else W - 120
    body = f"""
<div id="hk-stage" class="abs" style="{box(0, 0, W, H)}transform-origin:{W / 2}px 540px" data-layout-allow-overflow>
 <img id="hk-plate" src="assets/img/hero.jpg" class="abs" style="{box(0, 0, W, H)}object-fit:cover">
 <svg class="svgo" viewBox="0 0 {W} {H}" aria-hidden="true">
  <defs><mask id="hk-m" maskUnits="userSpaceOnUse" x="0" y="0" width="{W}" height="{H}">
   <rect x="0" y="0" width="{W}" height="{H}" fill="#fff"/>
   <rect x="{wx:.1f}" y="{wy:.1f}" width="{WW_:.1f}" height="{WH_:.1f}" fill="#000"/>
  </mask></defs>
  <g mask="url(#hk-m)">
   <rect id="hk-wash" x="-40" y="-40" width="{W + 80}" height="{H + 80}" fill="{DEEP}" fill-opacity="0"/>
   <g id="hk-lines">{fac}</g>
  </g>
  {frame_lines(wx, wy, WW_, WH_, pid="hk-win")}
 </svg>
</div>
{view_title(cut, "hk-vt", "1", cut.c("example_ad"), "", vt_x, 812)}
"""
    css = VT_CSS
    js = B.hide0("#hk-vt")
    # Full frame, the render alone; then the drawing takes everything outside
    # the ad's crop, and the crop stays lit: the frame the prospect saw.
    js += '  tl.fromTo("#hk-stage", { scale: 1 }, { scale: 1.035, duration: 2.6, ease: "sine.inOut" }, 0);\n'
    js += '  tl.fromTo("#hk-wash", { attr: { "fill-opacity": 0 } }, { attr: { "fill-opacity": 0.8 }, duration: 0.8, ease: "power2.inOut" }, 0.3);\n'
    for i in range(nf):
        js += B.draw_js(f"#hk-f{i}", 0.35 + 0.025 * i, 0.55)
    for i in range(nh):
        js += B.draw_js(f"#hk-h{i}", 0.7 + 0.01 * i, 0.4)
    js += B.draw_js("#hk-win", 0.8, 0.5)
    js += B.fade_js("#hk-vt", 1.05, 0.3, extra_from=f", x: {-12 * cut.S}", extra_to=", x: 0")
    return B.scene("hook", cut, css, body, js)


# ------------------------------------------------------------ shot 2: the gap

def gap(cut, A, boxes, date_label, thirty_at):
    VW = 1200
    VH = VW / 2
    vx, vy = cut.mx(608, VW), 206
    eb = boxes[f"err-{cut.lang}"]
    k0 = VW / eb["page"]["w"]
    hb = {key: v * k0 for key, v in eb["h1"].items()}
    ox, oy = hb["x"] + hb["w"] / 2, hb["y"] + hb["h"] / 2
    k = 1.04

    def fy(y_css):
        return vy + oy + (y_css * k0 - oy) * k

    # Rev A: amber, the markup pen, round the headline (v3's fit, new frame).
    BULGE_HALO, CLEAR = 12, 16
    pad_x, pad_top, pad_bot = 30, 8, 8
    top = fy(eb["h1"]["y"]) - pad_top
    bot = fy(eb["h1"]["y"] + eb["h1"]["h"]) + pad_bot
    if "line2" in eb:
        bot = min(bot, fy(eb["line2"]["y"]) - CLEAR - BULGE_HALO)
    cw, ch = hb["w"] * k + pad_x * 2, bot - top
    cx, cy = vx + ox - cw / 2, top
    d = B.cloud_path(cx, cy, cw, ch, step=26, rtl=cut.ar)
    mid = cy + ch / 2
    if cut.ar:
        note_x0 = vx + VW + 56
        lead = f"M{note_x0 - 12:.1f} {mid:.1f} H{cx + cw + 4:.1f}"
        tri_x = cx + cw - 24
    else:
        note_x0 = vx - 56
        lead = f"M{note_x0 + 12:.1f} {mid:.1f} H{cx - 4:.1f}"
        tri_x = cx - 30
    note_side = f"right:{W - note_x0:.0f}px" if not cut.ar else f"left:{note_x0:.0f}px"
    # The dimension string: what the voice measures, set on the sheet.
    dy_line = vy - 50
    ext = f"M{vx} {vy - 10} V{dy_line - 14} M{vx + VW} {vy - 10} V{dy_line - 14}"
    dim = f"M{vx - 14} {dy_line} H{vx + VW + 14}"
    ticks = f"M{vx - 11} {dy_line + 11} L{vx + 11} {dy_line - 11} M{vx + VW - 11} {dy_line + 11} L{vx + VW + 11} {dy_line - 11}"
    vt_x = 120 if not cut.ar else W - 120
    body = f"""
<div id="g-plw" class="abs" style="{box(0, 0, W, H)}overflow:hidden" data-layout-allow-overflow>
 <img id="g-plate" src="assets/img/bg1.jpg" class="abs" style="{box(-60, -34, W + 120, H + 68)}object-fit:cover">
</div>
<div class="abs" style="{box(0, 0, W, H)}background:{DEEP};opacity:0.34"></div>
<div id="g-vp" class="abs" style="{box(vx, vy, VW, VH)}overflow:hidden;background:#fff">
 <img id="g-cap" src="assets/cap/err-{cut.lang}.png" class="abs" style="{box(0, 0, VW, VW * 500 / 800)}transform-origin:{ox:.1f}px {oy:.1f}px">
</div>
<svg class="svgo" viewBox="0 0 {W} {H}" aria-hidden="true">
 {frame_lines(vx, vy, VW, VH, pid="g-frame")}
 <path id="g-ext" class="draw" d="{ext}" pathLength="1" stroke="{INK}" stroke-width="1.6"/>
 <path id="g-dim" class="draw" d="{dim}" pathLength="1" stroke="{INK}" stroke-width="2"/>
 <path id="g-tick" d="{ticks}" stroke="{INK}" stroke-width="3"/>
 <path id="g-cloudh" class="draw" d="{d}" pathLength="1" stroke="{DEEP}" stroke-width="10" stroke-linejoin="round" stroke-linecap="round"/>
 <path id="g-cloud" class="draw" d="{d}" pathLength="1" stroke="{AMBER}" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"/>
 <path id="g-lead" class="draw" d="{lead}" pathLength="1" stroke="{AMBER}" stroke-width="2.5"/>
</svg>
<div id="g-dimt" class="abs dimt" style="{box(vx, dy_line - 96, VW, 86)}">{esc(cb(cut, 'thirty'))}</div>
{B.tri("g-tri", tri_x, cy - 46, "A", AMBER)}
<div id="g-note" class="abs note" style="{note_side};top:{mid - 30:.0f}px">{esc(cut.c('note'))}</div>
{view_title(cut, "g-vt", "2", "hosh.example", date_label, vt_x, 640)}
"""
    css = VT_CSS + f"""
.dimt{{text-align:center;font-size:{80 if cut.ar else 76}px;font-weight:600;line-height:86px;letter-spacing:{0 if cut.ar else -0.01}em}}
.note{{font-size:40px;font-weight:500;line-height:60px;white-space:nowrap}}
.vt-t{{font-family:'Geist Mono',monospace;direction:ltr}}
"""
    t_this = A["this"] - 5.0
    th = thirty_at - 5.0
    js = B.hide0("#g-tri", "#g-note", "#g-dimt", "#g-tick", "#g-vt")
    js += '  tl.fromTo("#g-plate", { scale: 1.0, x: 0 }, { scale: 1.035, x: -24, duration: 10, ease: "none" }, 0);\n'
    js += B.draw_js("#g-frame", 0.05, 0.5)
    js += B.fade_js("#g-vp", 0.0, 0.35, a=0, b=1)
    js += f'  tl.fromTo("#g-cap", {{ scale: 1 }}, {{ scale: {k}, duration: {t_this - 0.2:.2f}, ease: "power1.inOut" }}, 0);\n'
    js += B.fade_js("#g-vt", 0.6, 0.3)
    # "thirty": extension lines, the dimension line, its ticks, then the words.
    js += B.draw_js("#g-ext", th - 0.25, 0.3, "power2.out")
    js += B.draw_js("#g-dim", th - 0.05, 0.42, "power2.inOut")
    js += f'  tl.set("#g-tick", {{ opacity: 1 }}, {th + 0.12:.3f});\n'
    js += B.fade_js("#g-dimt", th + 0.05, 0.35, extra_from=", y: 14", extra_to=", y: 0", ease="power3.out")
    js += B.draw_js("#g-cloudh", t_this) + B.draw_js("#g-cloud", t_this)
    js += B.draw_js("#g-lead", t_this + 0.2, 0.3, "power2.out")
    js += B.fade_js("#g-tri", t_this + 0.5, 0.16)
    js += B.fade_js("#g-note", t_this + 0.2, 0.2)
    return B.scene("gap", cut, css, body, js)


# ------------------------------------------------------------ shot 3: the turn

def turn(cut, A):
    """15.0: the facade as a drawing on the dark plate; the warm render floods
    in through it, piece by piece in the order it was drawn (door, portal,
    wings, ground, sky), while the Kling dolly runs. The reveal's moving
    edges are teal: ours."""
    fac, nf, nh = facade_svg("tu-", lw=1.7, alpha=0.9)
    # (id, start rect, end rect, t0, t1)
    R = [
        ("tu-r1", (886, 230, 143, 394), (759, 101, 402, 545), 0.04, 0.30),
        ("tu-r2", (759, 120, 0, 525), (300, 120, 459, 525), 0.24, 0.78),
        ("tu-r3", (1161, 120, 0, 525), (1161, 120, 559, 525), 0.24, 0.78),
        ("tu-r4", (0, 645, W, 0), (0, 645, W, 445), 0.62, 1.02),
        ("tu-r5", (0, 0, W, 0), (0, -10, W, 140), 0.80, 1.10),
    ]
    rects = "".join(f'<rect id="{i}" x="{a[0]}" y="{a[1]}" width="{a[2]}" height="{a[3]}" fill="#000"/>' for i, a, _, _, _ in R)
    edges = (f'<line id="tu-eL" x1="759" y1="112" x2="759" y2="652" stroke="{TEAL}" stroke-width="3"/>'
             f'<line id="tu-eR" x1="1161" y1="112" x2="1161" y2="652" stroke="{TEAL}" stroke-width="3"/>')
    body = f"""
<div id="tu-k2w" class="abs" style="{box(0, 0, W, H)}">
 <video id="tu-k2" class="clip" muted playsinline src="assets/media/k2.mp4" data-start="0" data-duration="2.6" data-track-index="2" style="position:absolute;left:0;top:0;width:{W}px;height:{H}px;object-fit:cover"></video>
</div>
<svg class="svgo" viewBox="0 0 {W} {H}" aria-hidden="true">
 <defs><mask id="tu-m" maskUnits="userSpaceOnUse" x="-100" y="-100" width="{W + 200}" height="{H + 200}">
  <rect x="-100" y="-100" width="{W + 200}" height="{H + 200}" fill="#fff"/>
  <g id="tu-mg">{rects}</g>
 </mask></defs>
 <g id="tu-over" mask="url(#tu-m)">
  <rect x="-60" y="-60" width="{W + 120}" height="{H + 120}" fill="{DEEP}" fill-opacity="0.74"/>
  <g id="tu-lines">{fac}{axes_svg(cut, "tu-ax")}</g>
 </g>
 <g id="tu-edges">{edges}</g>
</svg>
"""
    js = ""
    # The drawing is already there on the cut (it is sheet 2's opposite).
    for i in range(nf):
        js += f'  gsap.set("#tu-f{i}", {{ strokeDashoffset: 0 }});\n'
    for i in range(nh):
        js += f'  gsap.set("#tu-h{i}", {{ strokeDashoffset: 0 }});\n'
    for rid, a, b, t0, t1 in R:
        tw = f'{{ attr: {{ x: {b[0]}, y: {b[1]}, width: {b[2]}, height: {b[3]} }}, duration: {t1 - t0:.2f}, ease: "power2.inOut" }}'
        fr = f'{{ attr: {{ x: {a[0]}, y: {a[1]}, width: {a[2]}, height: {a[3]} }} }}'
        js += f'  tl.fromTo("#{rid}", {fr}, {tw}, {t0:.2f});\n'
        if rid in ("tu-r2", "tu-r3"):
            e, x0, x1 = ("#tu-eL", 759, b[0]) if rid == "tu-r2" else ("#tu-eR", 1161, b[0] + b[2])
            js += (f'  tl.fromTo("{e}", {{ attr: {{ x1: {x0}, x2: {x0} }}, opacity: 1 }}, {{ attr: {{ x1: {x1}, x2: {x1} }}, opacity: 1, '
                   f'duration: {t1 - t0:.2f}, ease: "power2.inOut" }}, {t0:.2f});\n')
            js += f'  tl.to("{e}", {{ opacity: 0, duration: 0.25 }}, {t1 + 0.02:.2f});\n'
    js += '  tl.to("#tu-over", { opacity: 0, duration: 0.35, ease: "power1.out" }, 0.95);\n'
    # The overlay rides the dolly: scale measured on the facade (frames 0, 15,
    # 30, 60 of the 30 fps clip: 1.000, 1.008, 1.018, 1.046 about 900,616).
    for sel in ("#tu-mg", "#tu-lines", "#tu-edges"):
        js += f'  tl.fromTo("{sel}", {{ scale: 1, svgOrigin: "900 616" }}, {{ scale: 1.018, svgOrigin: "900 616", duration: 1.0, ease: "none" }}, 0);\n'
        js += f'  tl.to("{sel}", {{ scale: 1.046, svgOrigin: "900 616", duration: 1.0, ease: "power1.in" }}, 1.0);\n'
    return B.scene("turn", cut, VT_CSS, body, js)


# ------------------------------------------------------------ shot 4: need

def need(cut, A, boxes):
    L = cut.lang
    VH = 756
    s = VH / 1024
    VW = 1440 * s
    vx = cut.mx(W - 120 - VW, VW)
    vy = 62
    b = boxes[f"index-{L}"]
    br = b["brand"]
    origin = (br["x"] + br["w"] / 2, br["y"] + br["h"] / 2)
    PUSH = 1.025

    def film(px, py):
        qx = origin[0] + (px - origin[0]) * PUSH
        qy = origin[1] + (py - origin[1]) * PUSH
        return vx + qx * s, vy + qy * s

    mirror = (lambda x: 1440 - x) if cut.ar else (lambda x: x)
    st = b["strip"]
    sv = b["services-row"]
    t1 = film(mirror(40), br["y"] + br["h"] / 2)
    t2 = film(mirror(42), st["y"] + st["h"] * 0.5)
    t3 = film(mirror(36), sv["y"] + sv["h"] * 0.5)
    labels = cut.c("need")
    # Keynotes in the start margin; leaders cross to the page with a shoulder.
    col_x = 120 if not cut.ar else W - 120
    rows_y = (330, 560, 740)
    shoulder_x = (vx - 64) if not cut.ar else (vx + VW + 64)
    leads = ""
    kn = ""
    for i, ((tx, ty), ry) in enumerate(zip((t1, t2, t3), rows_y)):
        sx0 = shoulder_x - 34 * cut.S
        leads += (
            f'<path id="n-l{i + 1}" class="draw" d="M{sx0:.1f} {ry + 26} H{shoulder_x:.1f} L{tx:.1f} {ty:.1f}" pathLength="1" '
            f'stroke="{AMBER}" stroke-width="2.5" stroke-linejoin="round"/>'
            f'<circle id="n-d{i + 1}" cx="{tx:.1f}" cy="{ty:.1f}" r="7" fill="{AMBER}"/>'
        )
        side = f"left:{col_x}px" if not cut.ar else f"right:{W - col_x}px"
        kn += (
            f'<div id="n-k{i + 1}" class="abs kn" style="{side};top:{ry}px">'
            f'<span class="kn-n mono">{esc(cut.num(i + 1))}</span><span class="kn-t">{esc(labels[i])}</span></div>'
        )
    side = f"left:{col_x}px" if not cut.ar else f"right:{W - col_x}px"
    body = f"""
<div id="n-plw" class="abs" style="{box(0, 0, W, H)}overflow:hidden" data-layout-allow-overflow>
 <img id="n-plate" src="assets/img/bg3.jpg" class="abs" style="{box(-60, -34, W + 120, H + 68)}object-fit:cover">
</div>
<div class="abs" style="{box(0, 0, W, H)}background:{DEEP};opacity:0.30"></div>
<div id="n-kick" class="abs kick" style="{side};top:196px">{esc(cut.c('kicker'))}</div>
<div id="n-vp" class="abs" style="{box(vx, vy, VW, VH)}overflow:hidden;background:{DEEP}">
 <img id="n-home" src="assets/cap/index-{L}.png" class="abs" style="{box(0, 0, VW, VH)}object-fit:cover;object-position:top;transform-origin:{origin[0] * s:.1f}px {origin[1] * s:.1f}px">
</div>
<svg class="svgo" viewBox="0 0 {W} {H}" aria-hidden="true">
 {frame_lines(vx, vy, VW, VH, pid="n-frame")}
 {leads}
</svg>
{kn}
"""
    css = f"""
.kick{{font-size:{46 if cut.ar else 44}px;font-weight:600;line-height:1.2;color:{AMBER};white-space:nowrap}}
.kn{{display:flex;align-items:center;gap:18px;height:52px}}
.kn-n{{width:52px;height:52px;flex:none;border-radius:50%;box-shadow:inset 0 0 0 2.5px {AMBER};color:{AMBER};display:grid;place-items:center;font-size:26px;line-height:1;direction:ltr}}
.kn-t{{font-size:{38 if cut.ar else 36}px;font-weight:500;white-space:nowrap}}
"""
    T = lambda key: A[key] - 35.0
    js = B.hide0("#n-kick", *[f"#n-k{i}" for i in (1, 2, 3)], *[f"#n-d{i}" for i in (1, 2, 3)])
    js += '  tl.fromTo("#n-plate", { scale: 1.0, x: 0 }, { scale: 1.03, x: 18, duration: 10, ease: "none" }, 0);\n'
    js += B.draw_js("#n-frame", 0.0, 0.5)
    js += f'  tl.fromTo("#n-home", {{ scale: 1 }}, {{ scale: {PUSH}, duration: 1.4, ease: "power2.out" }}, 0.5);\n'
    js += B.fade_js("#n-kick", T("kicker"), 0.3, extra_from=", y: 10", extra_to=", y: 0", ease="power3.out")
    for i, key in enumerate(("logo", "photos", "services")):
        t = T(key) - 0.05
        js += B.fade_js(f"#n-k{i + 1}", t, 0.22, extra_from=f", x: {-14 * cut.S}", extra_to=", x: 0", ease="power3.out")
        js += B.draw_js(f"#n-l{i + 1}", t + 0.08, 0.3, "power2.out")
        js += B.fade_js(f"#n-d{i + 1}", t + 0.32, 0.1)
    return B.scene("need", cut, css, body, js, ' data-hold="true"')


# ------------------------------------------------------------ shot 5: bill of quantities

def ret(cut, A):
    TW, TH = 1400, 464
    tx, ty = (W - TW) / 2, 300
    cols = cb(cut, "boq_cols")
    card = cut.c("card")
    yn = cb(cut, "your_numbers")
    thumbs = (("assets/img/hero-card.jpg", "50% 60%"), (f"assets/cap/index-{cut.lang}.png", "50% 0%"))
    rows = ""
    for i, (label, (src, pos)) in enumerate(zip(card, thumbs)):
        rows += (
            f'<div id="r-row{i + 1}" class="br">'
            f'<span class="bi mono">{esc(cut.num(i + 1) if cut.ar else f"{i + 1:02d}")}</span>'
            f'<span class="bd"><span class="bt"><img src="{src}" style="object-position:{pos}"></span><span class="bl">{esc(label)}</span></span>'
            f'<span class="bq"><span id="r-f{i + 1}" class="field"><span class="fl">{esc(yn)}</span></span></span></div>'
        )
    body = f"""
<div id="r-plw" class="abs" style="{box(0, 0, W, H)}overflow:hidden" data-layout-allow-overflow>
 <img id="r-plate" src="assets/img/bg2.jpg" class="abs" style="{box(-60, -34, W + 120, H + 68)}object-fit:cover">
</div>
<div class="abs" style="{box(0, 0, W, H)}background:{DEEP};opacity:0.30"></div>
{view_title(cut, "r-vt", "5", cb(cut, "boq"), "", tx if not cut.ar else tx + TW, ty - 104)}
<div id="r-tw" class="abs" style="{box(tx, ty, TW, TH)}">
 <div class="boq">
  <div class="bc mono"><span class="bi">{esc(cols[0])}</span><span class="bd">{esc(cols[1])}</span><span class="bq">{esc(cols[2])}</span></div>
  {rows}
 </div>
</div>
"""
    css = VT_CSS + f"""
.vt-t{{font-size:{46 if cut.ar else 44}px;line-height:56px;font-weight:600}}
.boq{{position:absolute;inset:0;background:rgba(6,13,36,0.90);box-shadow:inset 0 0 0 2px rgba(242,246,250,0.55)}}
.bh{{height:96px;display:flex;align-items:center;padding:0 40px;border-bottom:2px solid rgba(242,246,250,0.55)}}
.bh b{{font-size:{50 if cut.ar else 48}px;font-weight:600;letter-spacing:{0 if cut.ar else -0.01}em}}
.bc,.br{{display:grid;grid-template-columns:120px minmax(0,1fr) 420px}}
.bc{{height:56px;align-items:center;font-size:24px;color:rgba(242,246,250,0.72);border-bottom:1.5px solid rgba(242,246,250,0.38)}}
.bc span{{padding:0 24px;height:100%;display:flex;align-items:center}}
.bc .bi,.br .bi{{border-inline-end:1.5px solid rgba(242,246,250,0.30)}}
.bc .bq,.br .bq{{border-inline-start:1.5px solid rgba(242,246,250,0.30)}}
.br{{height:204px;border-bottom:1.5px solid rgba(242,246,250,0.30)}}
.br:last-child{{border-bottom:0}}
.br .bi{{display:flex;align-items:center;justify-content:center;font-size:28px;color:rgba(242,246,250,0.72);direction:ltr}}
.bd{{display:flex;align-items:center;gap:32px;padding:0 32px}}
.bt{{width:232px;height:140px;flex:none;overflow:hidden;box-shadow:0 0 0 1.5px rgba(242,246,250,0.42)}}
.bt img{{width:100%;height:100%;object-fit:cover;display:block}}
.bl{{font-size:{50 if cut.ar else 46}px;font-weight:500;white-space:nowrap}}
.br .bq{{display:flex;align-items:center;justify-content:center}}
.field{{width:330px;height:104px;display:flex;align-items:center;justify-content:center;
  background-image:linear-gradient(90deg,{AMBER} 60%,transparent 0),linear-gradient(90deg,{AMBER} 60%,transparent 0),linear-gradient(0deg,{AMBER} 60%,transparent 0),linear-gradient(0deg,{AMBER} 60%,transparent 0);
  background-size:20px 2.5px,20px 2.5px,2.5px 20px,2.5px 20px;background-position:0 0,0 100%,0 0,100% 0;background-repeat:repeat-x,repeat-x,repeat-y,repeat-y}}
.fl{{font-size:{34 if cut.ar else 30}px;font-weight:500;color:{AMBER}}}
"""
    js = B.hide0("#r-f1", "#r-f2")
    js += B.fade_js("#r-vt", 0.2, 0.4, extra_from=f", x: {-14 * cut.S}", extra_to=", x: 0", ease="power3.out")
    js += '  tl.fromTo("#r-plate", { scale: 1.0 }, { scale: 1.03, duration: 7, ease: "none" }, 0);\n'
    js += '  tl.fromTo("#r-tw", { scale: 1, opacity: 0 }, { scale: 1.03, opacity: 1, duration: 1.6, ease: "power2.out" }, 0);\n'
    # The fields come with "projects" (how many?), and stay empty on purpose.
    js += B.fade_js("#r-f1", 0.9, 0.3)
    js += B.fade_js("#r-f2", 1.1, 0.3)
    return B.scene("ret", cut, css, body, js, ' data-hold="true"')


# ------------------------------------------------------------ root

def root_html(cut, has_captions=True):
    hosts = [("hook", 0, 2.6), ("gap", 5, 10), ("turn", 15, 2.6), ("need", 35, 10), ("ret", 45, 7)]
    h = ""
    for i, (sid, st, du) in enumerate(hosts):
        h += (f'<div id="{sid}" data-composition-id="{sid}" data-composition-src="compositions/{sid}.html" data-start="{st}" '
              f'data-duration="{du}" data-track-index="1" data-track-kind="graphics" data-width="{W}" data-height="{H}" style="z-index:{2 + i}"></div>\n')
    h += (f'<div id="tblock" data-composition-id="tblock" data-composition-src="compositions/tblock.html" data-start="0" data-duration="52" '
          f'data-track-index="3" data-track-kind="graphics" data-width="{W}" data-height="{H}" style="z-index:20"></div>\n')
    if has_captions:
        h += (f'<div id="captions" data-composition-id="captions" data-composition-src="compositions/captions.html" data-start="0" data-duration="60" '
              f'data-track-index="4" data-track-kind="captions" data-width="{W}" data-height="{H}" style="z-index:30"></div>\n')
    return f"""<!doctype html>
<html lang="{cut.lang}">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width={W}, height={H}" />
<script src="assets/vendor/gsap.min.js"></script>
<style>
{B.FONTS_CSS}
*{{margin:0;padding:0;box-sizing:border-box}}
html,body{{margin:0;width:{W}px;height:{H}px;overflow:hidden;background:{SPACE}}}
#ground{{position:absolute;inset:0;background:{SPACE}}}
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="60" data-width="{W}" data-height="{H}">
<div id="ground"></div>
{h}</div>
<script>
  const tl = gsap.timeline({{ paused: true }});
  window.__timelines["main"] = tl;
</script>
</body>
</html>
"""


def sh(cmd):
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lang", choices=["en", "ar"], required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--media", default=str(B.HOME / "upsell-studio-video/website"))
    ap.add_argument("--clean", action="store_true")
    a = ap.parse_args()
    media = Path(a.media)
    caps = media / "capture/v2"
    cut = B.Cut(a.lang)
    lines = json.loads((B.HERE / "lines.json").read_text())
    slug = B.VOICE_SLUG[a.lang]
    tp = media / f"voice/{a.lang}/{slug}/timing.json"
    timing = json.loads(tp.read_text()) if tp.exists() else None
    if a.lang == "en" and timing is None:
        raise SystemExit("The English voice's timing file is missing.")
    A = B.anchors(cut, timing)
    # "thirty" in the gap's first line: the voice's word, or the script's window.
    thirty = 7.0
    if timing:
        l2 = next(l for l in timing["lines"] if l["id"] == "en-2a")
        thirty = next(w["start"] for w in l2["words"] if w["w"].startswith("thirty"))
    boxes = json.loads((caps / "boxes.json").read_text())
    when = boxes["capturedAt"][:10]
    y, m, d = (int(x) for x in when.split("-"))
    date = f"{d} {B.AR_MONTHS[m - 1]} {y}".translate(B.AR_DIGITS) if cut.ar else f"{d} {B.EN_MONTHS[m - 1]} {y}"

    out = Path(a.out)
    if out.exists():
        shutil.rmtree(out)
    for sub in ("compositions", "assets/fonts", "assets/vendor", "assets/cap", "assets/media", "assets/img"):
        (out / sub).mkdir(parents=True)
    gf = B.NM / "geist/dist/fonts"
    for f in ("Geist-Regular", "Geist-Medium", "Geist-SemiBold", "Geist-Bold"):
        shutil.copy(gf / f"geist-sans/{f}.woff2", out / f"assets/fonts/{f}.woff2")
    for f in ("GeistMono-Regular", "GeistMono-Medium"):
        shutil.copy(gf / f"geist-mono/{f}.woff2", out / f"assets/fonts/{f}.woff2")
    for wgt in (400, 500, 600):
        shutil.copy(B.NM / f"@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-{wgt}-normal.woff2", out / f"assets/fonts/plexar-{wgt}.woff2")
    shutil.copy(B.NM / "hyperframes/dist/vendor/npm/gsap@3.15.0/dist/gsap.min.js", out / "assets/vendor/gsap.min.js")
    for name in (f"err-{cut.lang}", f"index-{cut.lang}"):
        shutil.copy(caps / f"{name}.png", out / f"assets/cap/{name}.png")
    shutil.copy(B.kling_30fps(media / "final/kling/website-kling-2-hero-dolly.mp4",
                              media / "final/kling/30fps/website-kling-2-hero-dolly-30fps.mp4"), out / "assets/media/k2.mp4")
    art = media / "final/art"
    for src, dst, wpx in (("website-hero-16x9.jpg", "hero.jpg", 2880), ("website-bg-1.jpg", "bg1.jpg", 2400),
                          ("website-bg-2.jpg", "bg2.jpg", 2400), ("website-bg-3-spare.jpg", "bg3.jpg", 2400),
                          ("website-hero-16x9.jpg", "hero-card.jpg", 720)):
        sh(["ffmpeg", "-y", "-v", "error", "-i", str(art / src), "-vf", f"scale={wpx}:-2", "-q:v", "2", str(out / f"assets/img/{dst}")])

    comps = {
        "hook": hook(cut, A),
        "gap": gap(cut, A, boxes, cut.c("record").format(date=date).replace(". ", ".|", 1), thirty),
        "turn": turn(cut, A),
        "need": need(cut, A, boxes),
        "ret": ret(cut, A),
        "tblock": tblock_scene(cut),
        "captions": B.captions_scene(cut, B.caption_groups(cut, lines, timing)),
    }
    for sid, src in comps.items():
        (out / "compositions" / f"{sid}.html").write_text(src, encoding="utf-8")
    (out / "index.html").write_text(root_html(cut, not a.clean), encoding="utf-8")
    (out / "hyperframes.json").write_text(json.dumps({
        "$schema": "https://hyperframes.heygen.com/schema/hyperframes.json",
        "paths": {"blocks": "compositions", "components": "compositions/components", "assets": "assets"},
        "media": {"autoProxy": True},
    }, indent=1))
    (out / "build.json").write_text(json.dumps({
        "direction": "B, drawing set", "lang": cut.lang, "proof_only": True,
        "anchors": {k: round(v, 3) for k, v in A.items()}, "thirty": round(thirty, 3),
        "voice": bool(timing), "captured": when,
    }, indent=1))
    print(f"dirb: {out} ({cut.lang})")


if __name__ == "__main__":
    main()
