#!/usr/bin/env python3
"""Registers the hand-traced facade (film/dirb.py) to the Kling 2 dolly, for
the v4 reveal at 15.0 s. VPS only (numpy, ffmpeg).

  python3 scripts/trace_fit.py --clip <k2 30 fps clip> --out <dir>

1. Frame 0: every horizontal and vertical coordinate of FACADE moves to the
   edge it was drawn on (the median signed offset of the strongest edge
   across it, when at least 60% of the samples see one and they agree within
   2 px); oblique segments move along their normal the same way.
2. Free ends (the first and last point of a subpath, never a corner) that
   run into nothing are cut back to the last point on an edge plus a 16 px
   drafter's overrun.
3. HATCH is redrawn on the slats themselves (vertical edges found across
   the door and the two side screens, at least 11 px apart) and JOINTS on
   the walkway's own joints (above the caption band, y < 860).
4. For frames 0 to 42 it fits the overlay's transform x' = s*x + tx,
   y' = s*y + ty that puts the registered facade on the frame's edges.

Writes trace.json (paths, transform per frame, residuals) and overlay
PNGs for frames 0, 15, 30 and 39 to look at.
"""
import argparse
import json
import math
import re
import tempfile
from pathlib import Path

import numpy as np

import trace_check as tc
import dirb

REACH = 12.0


def oriented(gx, gy, n):
    return np.abs(gx * n[0] + gy * n[1])


def profile_offsets(seg, gx, gy, thresh, step=3.0, reach=REACH, xf=(1.0, 0.0, 0.0), nearest=False):
    """Signed offsets along the segment's normal of the strongest edge (or,
    with nearest, of the nearest edge peak above the threshold), with the
    overlay transform xf = (s, tx, ty) applied to the samples."""
    (x0, y0), (x1, y1) = seg
    L = math.hypot(x1 - x0, y1 - y0)
    ux, uy = (x1 - x0) / L, (y1 - y0) / L
    n = (-uy, ux)
    g = oriented(gx, gy, n)
    k = max(2, int(L // step) + 1)
    ts = np.linspace(0, L, k)
    s, tx, ty = xf
    px = (x0 + ux * ts) * s + tx
    py = (y0 + uy * ts) * s + ty
    offs = np.arange(-reach, reach + 0.01, 0.5)
    X = px[:, None] + n[0] * offs[None, :]
    Y = py[:, None] + n[1] * offs[None, :]
    inside = (X >= 1) & (X < 1918) & (Y >= 1) & (Y < 1078)
    prof = tc.bilinear(g, X, Y)
    prof[~inside] = 0
    if nearest:
        loc = np.zeros_like(prof, dtype=bool)
        loc[:, 1:-1] = (prof[:, 1:-1] >= prof[:, :-2]) & (prof[:, 1:-1] >= prof[:, 2:]) & (prof[:, 1:-1] >= thresh)
        dist = np.where(loc, np.abs(offs)[None, :], np.inf)
        j = dist.argmin(axis=1)
        off = np.where(np.isfinite(dist[np.arange(k), j]), offs[j], np.nan)
        return ts, off, n, L
    j = prof.argmax(axis=1)
    peak = prof[np.arange(k), j]
    off = np.where(peak >= thresh, offs[j], np.nan)
    return ts, off, n, L


def parse(d):
    """Subpaths as lists of points (with Z closing back)."""
    toks = re.findall(r"[MHVLZ]|-?\d+(?:\.\d+)?", d)
    subs, cur, i, cmd = [], None, 0, None
    while i < len(toks):
        t = toks[i]
        if t in "MHVLZ":
            cmd = t
            i += 1
            if cmd == "Z":
                cur["closed"] = True
            continue
        if cmd == "M":
            cur = {"pts": [[float(t), float(toks[i + 1])]], "closed": False}
            subs.append(cur)
            i += 2
            cmd = "L"
        elif cmd == "L":
            cur["pts"].append([float(t), float(toks[i + 1])])
            i += 2
        elif cmd == "H":
            cur["pts"].append([float(t), cur["pts"][-1][1]])
            i += 1
        elif cmd == "V":
            cur["pts"].append([cur["pts"][-1][0], float(t)])
            i += 1
    return subs


def fmt(v):
    v = round(v * 2) / 2
    return str(int(v)) if v == int(v) else f"{v:.1f}"


def unparse(subs):
    out = []
    for sp in subs:
        p = sp["pts"]
        d = f"M{fmt(p[0][0])} {fmt(p[0][1])}"
        for a, b in zip(p, p[1:]):
            if abs(a[1] - b[1]) < 1e-6:
                d += f" H{fmt(b[0])}"
            elif abs(a[0] - b[0]) < 1e-6:
                d += f" V{fmt(b[1])}"
            else:
                d += f" L{fmt(b[0])} {fmt(b[1])}"
        if sp["closed"]:
            d += " Z"
        out.append(d)
    return " ".join(out)


def segs_of(sp):
    p = sp["pts"]
    s = list(zip(p, p[1:]))
    if sp["closed"]:
        s.append((p[-1], p[0]))
    return s


def register(paths, gx, gy, thresh, reach=REACH, max_spread=2.0):
    """Moves each coordinate onto its edge (frame 0); returns new paths and a log."""
    log = []
    new = []
    for pi, d in enumerate(paths):
        subs = parse(d)
        # Collect signed corrections per coordinate value for axis-aligned
        # segments, and per segment for oblique ones.
        xs, ys, obl = {}, {}, {}
        for si, sp in enumerate(subs):
            for k, (a, b) in enumerate(segs_of(sp)):
                if math.hypot(b[0] - a[0], b[1] - a[1]) < 12:
                    continue
                ts, off, n, L = profile_offsets((tuple(a), tuple(b)), gx, gy, thresh, reach=reach)
                ok = ~np.isnan(off)
                if ok.mean() < 0.6:
                    continue
                med = float(np.median(off[ok]))
                spread = float(np.percentile(np.abs(off[ok] - med), 75))
                if abs(a[0] - b[0]) < 1e-6 or abs(a[1] - b[1]) < 1e-6:
                    if spread > max_spread:
                        continue
                    if abs(a[0] - b[0]) < 1e-6:  # vertical
                        xs.setdefault(a[0], []).append(med * n[0])
                    else:  # horizontal
                        ys.setdefault(a[1], []).append(med * n[1])
                else:
                    # An oblique line may be turned as well as shifted: fit the
                    # offset along it as a + b*t on the samples near the median.
                    inl = ok & (np.abs(np.nan_to_num(off, nan=99) - med) <= 3.0)
                    if inl.sum() < 6:
                        continue
                    b1, a1 = np.polyfit(ts[inl], off[inl], 1)
                    obl[(si, k)] = ((a1 * n[0], a1 * n[1]), ((a1 + b1 * L) * n[0], (a1 + b1 * L) * n[1]))
        dx = {v: float(np.median(c)) for v, c in xs.items()}
        dy = {v: float(np.median(c)) for v, c in ys.items()}
        for si, sp in enumerate(subs):
            for q in sp["pts"]:
                q0 = list(q)
                if q0[0] in dx:
                    q[0] = q0[0] + dx[q0[0]]
                if q0[1] in dy:
                    q[1] = q0[1] + dy[q0[1]]
            for (s2, k), (d0, d1) in obl.items():
                if s2 != si:
                    continue
                p = sp["pts"]
                for idx, dd in ((k, d0), ((k + 1) % len(p), d1)):
                    p[idx][0] += dd[0]
                    p[idx][1] += dd[1]
        moved = {"x": {fmt(k): round(v, 1) for k, v in dx.items() if abs(v) >= 0.5},
                 "y": {fmt(k): round(v, 1) for k, v in dy.items() if abs(v) >= 0.5},
                 "oblique": {f"{k}": [[round(v[0][0], 1), round(v[0][1], 1)], [round(v[1][0], 1), round(v[1][1], 1)]] for k, v in obl.items()}}
        log.append({"path": pi, "moved": moved})
        new.append(subs)
    return new, log


def trim_stubs(subs_list, gx, gy, thresh):
    """Cuts free ends that run into nothing back to a 16 px overrun."""
    log = []
    for pi, subs in enumerate(subs_list):
        for si, sp in enumerate(subs):
            if sp["closed"] or len(sp["pts"]) < 2:
                continue
            p = sp["pts"]
            for end in ("start", "end"):
                a, b = (p[1], p[0]) if end == "start" else (p[-2], p[-1])  # a -> b runs toward the free end
                L = math.hypot(b[0] - a[0], b[1] - a[1])
                if L < 30:
                    continue
                ts, off, n, _ = profile_offsets((tuple(a), tuple(b)), gx, gy, thresh, step=2.0, reach=4.0)
                good = ~np.isnan(off)
                if not good.any():
                    continue
                last = float(ts[good].max())
                tail = good[ts >= L - 24]
                if L - last > 20 and tail.mean() < 0.2:
                    keep = min(L, last + 16)
                    ux, uy = (b[0] - a[0]) / L, (b[1] - a[1]) / L
                    nb = [a[0] + ux * keep, a[1] + uy * keep]
                    log.append({"path": pi, "sub": si, "end": end, "from": [round(b[0], 1), round(b[1], 1)],
                                "to": [round(nb[0], 1), round(nb[1], 1)], "cut_px": round(L - keep, 1)})
                    b[0], b[1] = nb
    return log


# Calls made by eye on 3x crops of frame 0 (26 Oct), applied after the
# measured registration. Each replaces one path of FACADE.
MANUAL = {
    # The left wing's roof meets the portal at x 757, y 127 (the measured
    # trim stopped at 676 where the sky edge softens).
    6: ("M757 127 H372 V637 M372 206 H331 V637", "left wing roof runs to the portal (757, 127)"),
    # The far wing's canopy ends at about x 1675; past it are palms and sky.
    15: ("M1468 169 H1626 V637 M1626 262 H1691", "the far wing's canopy stops at x 1675: 16 px overrun to 1691 (was 1720, into the palms)"),
    # The walkway's two edges, measured at y 651 and 878 (B's right edge ran
    # to 1358 at the foot; it is at 1421), stopped at y 860 for the caption band.
    21: ("M886.5 651 L699.5 860 M1034 651 L1222.5 860 M886.5 651 H1034", "walkway edges remeasured, stopped at y 860"),
}


def peaks(profile, min_gap, rel=0.35):
    """Indices of local maxima above rel * max, at least min_gap apart (strongest first)."""
    order = np.argsort(profile)[::-1]
    top = profile.max()
    chosen = []
    for i in order:
        if profile[i] < rel * top:
            break
        if all(abs(i - c) >= min_gap for c in chosen):
            chosen.append(int(i))
    return sorted(chosen)


def hatch_from_slats(gx, Y):
    """Vertical hatch on the real slats: the door (x 886 to 1029) and the two
    side screens (x 384 to 461, 1470 to 1551), from the vertical edges
    averaged down each panel."""
    out = []
    for (x0, x1, y0, y1) in ((390, 456, 214, 614), (1475, 1547, 214, 614), (892, 1024, 236, 618)):
        band = np.abs(gx[int(y0):int(y1), x0:x1]).mean(axis=0)
        for i in peaks(band, 11):
            x = x0 + i
            if x0 + 4 <= x <= x1 - 4:
                out.append(f"M{x} {y0 - 3} V{y1 + 3}")
    return out


def joints_from_walkway(gy):
    """Horizontal joints across the walkway, where the walkway's own joints are
    (the strongest horizontal edges down its middle), above y 860."""
    col = np.abs(gy[655:860, 930:990]).mean(axis=1)
    out = []
    for i in peaks(col, 40, rel=0.4):
        y = 655 + i
        a, b = dirb.walk_x(y)
        out.append(f"M{a:.1f} {y} H{b:.1f}")
    return out


def fit_transform(subs_list, gx, gy, thresh, guess):
    """Best (s, tx, ty) for one frame: maximises the oriented gradient summed
    under the facade's samples (coarse to fine)."""
    pts, nrm = [], []
    for subs in subs_list:
        for sp in subs:
            for a, b in segs_of(sp):
                L = math.hypot(b[0] - a[0], b[1] - a[1])
                if L < 20:
                    continue
                ux, uy = (b[0] - a[0]) / L, (b[1] - a[1]) / L
                for t in np.arange(0, L, 6.0):
                    pts.append((a[0] + ux * t, a[1] + uy * t))
                    nrm.append((-uy, ux))
    P = np.array(pts)
    N = np.array(nrm)
    G = [oriented(gx, gy, (1, 0)), oriented(gx, gy, (0, 1))]

    def score(s, tx, ty):
        X = P[:, 0] * s + tx
        Yy = P[:, 1] * s + ty
        gxv = tc.bilinear(G[0], X, Yy)
        gyv = tc.bilinear(G[1], X, Yy)
        return float(np.sum(np.abs(N[:, 0]) * gxv + np.abs(N[:, 1]) * gyv))

    best = guess
    # Scale about the guess's centre first, then scale and a small shift together.
    for span, step, shift, sstep in ((0.02, 0.001, 0, 1.0), (0.003, 0.0005, 3.0, 0.5)):
        s0, tx0, ty0 = best
        cands = []
        for s in np.arange(s0 - span, s0 + span + 1e-9, step):
            for dtx in np.arange(-shift, shift + 0.01, sstep):
                for dty in np.arange(-shift, shift + 0.01, sstep):
                    tx = tx0 + (s0 - s) * 900 + dtx
                    ty = ty0 + (s0 - s) * 616 + dty
                    cands.append((score(s, tx, ty), s, tx, ty))
        cands.sort(reverse=True)
        best = cands[0][1:]
    return best


def overlay_png(path_png, subs_list, extra, xf, out):
    from PIL import Image, ImageDraw

    im = Image.open(path_png).convert("RGB")
    d = ImageDraw.Draw(im)
    s, tx, ty = xf
    for subs in subs_list:
        for sp in subs:
            for a, b in segs_of(sp):
                d.line([(a[0] * s + tx, a[1] * s + ty), (b[0] * s + tx, b[1] * s + ty)], fill=(255, 40, 40), width=1)
    for dd in extra:
        for sp in parse(dd):
            for a, b in segs_of(sp):
                d.line([(a[0] * s + tx, a[1] * s + ty), (b[0] * s + tx, b[1] * s + ty)], fill=(40, 255, 255), width=1)
    im.save(out, quality=88)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--clip", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--last", type=int, default=42)
    a = ap.parse_args()
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp())
    f0 = tc.frame_png(a.clip, 0, tmp)
    Y0 = tc.load_luma(f0)
    gx, gy = tc.gradients(Y0)
    thresh = float(np.percentile(np.hypot(gx, gy), 90)) * 0.6
    subs_list, reg_log = register(dirb.FACADE, gx, gy, thresh)
    subs_list, reg_log2 = register([unparse(s) for s in subs_list], gx, gy, thresh, reach=6.0, max_spread=3.0)
    reg_log = [{"path": a_["path"], "pass1": a_["moved"], "pass2": b_["moved"]} for a_, b_ in zip(reg_log, reg_log2)]
    stub_log = trim_stubs(subs_list, gx, gy, thresh)
    for pi, (d, why) in MANUAL.items():
        subs_list[pi] = parse(d)
        stub_log.append({"path": pi, "manual": d, "why": why})
    hatch = hatch_from_slats(gx, Y0)
    # JOINTS: the walkway shows no joint above y 860 in frame 0, and the two it
    # shows (a cross joint at y 878 and a centre seam) sit in the caption
    # band, so none is drawn rather than lines on nothing.
    joints = []
    facade = [unparse(s) for s in subs_list]
    # The transform per frame, each fit starting from the last.
    curve = {}
    guess = (1.0, 0.0, 0.0)
    pngs = {}
    for f in range(0, a.last + 1, 3):
        p = tc.frame_png(a.clip, f, tmp)
        pngs[f] = p
        Y = tc.load_luma(p)
        g1, g2 = tc.gradients(Y)
        th = float(np.percentile(np.hypot(g1, g2), 90)) * 0.6
        guess = fit_transform([parse(d) for d in facade], g1, g2, th, guess)
        curve[f] = [round(guess[0], 5), round(guess[1], 2), round(guess[2], 2)]
    # Residuals at 0, 15, 30, 39 with the fitted transform (interpolated).
    def xf_at(f):
        ks = sorted(curve)
        lo = max(k for k in ks if k <= f)
        hi = min((k for k in ks if k >= f), default=lo)
        if hi == lo:
            return tuple(curve[lo])
        w = (f - lo) / (hi - lo)
        return tuple(curve[lo][i] + (curve[hi][i] - curve[lo][i]) * w for i in range(3))

    resid = {}
    for f in (0, 15, 30, 39):
        p = tc.frame_png(a.clip, f, tmp)
        Y = tc.load_luma(p)
        g1, g2 = tc.gradients(Y)
        th = float(np.percentile(np.hypot(g1, g2), 90)) * 0.6
        xf = xf_at(f)
        rows = []
        for pi, d in enumerate(facade + hatch + joints):
            for sp in parse(d):
                for sa, sb in segs_of(sp):
                    if math.hypot(sb[0] - sa[0], sb[1] - sa[1]) < 12:
                        continue
                    ts, off, n, L = profile_offsets((tuple(sa), tuple(sb)), g1, g2, th, reach=8.0, xf=xf, nearest=True)
                    ok = ~np.isnan(off)
                    kind = "facade" if pi < len(facade) else ("hatch" if pi < len(facade) + len(hatch) else "joint")
                    rows.append({"kind": kind, "path": pi, "from": [round(sa[0], 1), round(sa[1], 1)], "to": [round(sb[0], 1), round(sb[1], 1)],
                                 "on_edge": round(float(ok.mean()), 2),
                                 "median_px": round(float(np.median(np.abs(off[ok]))), 2) if ok.any() else None})
        meds = [r["median_px"] for r in rows if r["median_px"] is not None and r["on_edge"] >= 0.5]
        resid[f] = {"transform": [round(v, 5) for v in xf], "segments": len(rows),
                    "on_edge_segments": len(meds),
                    "within_2px": sum(1 for m in meds if m <= 2.0),
                    "worst": sorted(rows, key=lambda r: -(r["median_px"] or 0))[:8]}
        overlay_png(p, [parse(d) for d in facade], hatch + joints, xf, out / f"overlay-f{f:02d}.jpg")
    res = {"facade": facade, "hatch": hatch, "joints": joints, "curve": curve, "registered": reg_log,
           "stubs": stub_log, "residuals": resid}
    (out / "trace.json").write_text(json.dumps(res, indent=1))
    print(json.dumps({"curve": curve, "stubs": stub_log, "residuals": {f: {k: v for k, v in r.items() if k != "worst"} for f, r in resid.items()}}, indent=1))
    for f, r in resid.items():
        print(f, "worst:", [(w["kind"], w["path"], w["from"], w["to"], w["on_edge"], w["median_px"]) for w in r["worst"][:5]])
    print("hatch", len(hatch), "joints", joints)


if __name__ == "__main__":
    main()
