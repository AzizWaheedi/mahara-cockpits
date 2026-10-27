#!/usr/bin/env python3
"""Measures the hand-traced facade (film/dirb.py FACADE, HATCH, JOINTS) against
the Kling 2 dolly's own edges, for the reveal at 15.0 s (v4). VPS only (needs
numpy, ffmpeg).

  python3 scripts/trace_check.py --clip <k2 30 fps clip> --frames 0,15,30,39 [--json out.json]

For every straight segment it samples a point every 4 px, looks across the
segment (+-8 px) for the strongest edge in the gradient that runs along it,
and records how far that edge sits from the drawn line. Frames after 0 are
read with the overlay's scale about (900, 616), the curve the film plays:
1.000, 1.008, 1.018 at frames 0, 15, 30, then rising to 1.046 at frame 60.
It also fits the best scale per frame, so the curve itself is checked.

Stubs: a segment end whose last 24 px have no edge under them runs into
nothing. Its suggested end is the last point that sits on an edge, plus a
16 px drafter's overrun.
"""
import argparse
import json
import math
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "film"))
import dirb  # noqa: E402

CENTER = (900.0, 616.0)


def scale_at(frame):
    """The overlay's scale at a 30 fps frame (film/v4a.py plays the same)."""
    t = frame / 30.0
    if t <= 1.0:
        return 1.0 + 0.018 * t
    u = min(t - 1.0, 1.0)
    return 1.018 + 0.028 * (u * u)  # power1.in from 1.018 to 1.046 over 1 s


def segments(d):
    """Straight segments of an M/H/V/L/Z path."""
    toks = d.replace(",", " ").split()
    out, i = [], 0
    x = y = sx = sy = 0.0
    cmd = None
    while i < len(toks):
        t = toks[i]
        if t[0].isalpha():
            cmd, t = t[0], t[1:]
            if cmd == "Z":
                out.append(((x, y), (sx, sy)))
                x, y = sx, sy
                i += 1
                continue
            if not t:
                i += 1
                t = toks[i]
        if cmd == "M":
            x, y = float(t), float(toks[i + 1])
            sx, sy = x, y
            i += 2
            cmd = "L"
            continue
        if cmd == "L":
            nx, ny = float(t), float(toks[i + 1])
            i += 2
        elif cmd == "H":
            nx, ny = float(t), y
            i += 1
        elif cmd == "V":
            nx, ny = x, float(t)
            i += 1
        else:
            raise ValueError(d)
        out.append(((x, y), (nx, ny)))
        x, y = nx, ny
    return out


def frame_png(clip, n, tmp):
    p = tmp / f"f{n:03d}.png"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(clip), "-vf", f"select=eq(n\\,{n})", "-frames:v", "1", str(p)], check=True)
    return p


def load_luma(p):
    from PIL import Image

    im = Image.open(p).convert("RGB").resize((1920, 1080))
    a = np.asarray(im, dtype=np.float32) / 255.0
    return 0.2126 * a[..., 0] + 0.7152 * a[..., 1] + 0.0722 * a[..., 2]


def gradients(Y):
    p = np.pad(Y, 1, mode="edge")
    gx = (p[1:-1, 2:] - p[1:-1, :-2]) * 2 + (p[:-2, 2:] - p[:-2, :-2]) + (p[2:, 2:] - p[2:, :-2])
    gy = (p[2:, 1:-1] - p[:-2, 1:-1]) * 2 + (p[2:, :-2] - p[:-2, :-2]) + (p[2:, 2:] - p[:-2, 2:])
    return gx, gy


def bilinear(img, xs, ys):
    h, w = img.shape
    xs = np.clip(xs, 0, w - 1.001)
    ys = np.clip(ys, 0, h - 1.001)
    x0, y0 = np.floor(xs).astype(int), np.floor(ys).astype(int)
    fx, fy = xs - x0, ys - y0
    return (img[y0, x0] * (1 - fx) * (1 - fy) + img[y0, x0 + 1] * fx * (1 - fy)
            + img[y0 + 1, x0] * (1 - fx) * fy + img[y0 + 1, x0 + 1] * fx * fy)


def measure(seg, gx, gy, s, thresh, step=4.0, reach=8.0):
    """Offsets (px, across the segment) of the strongest edge under each sample,
    or nan where nothing clears the threshold."""
    (x0, y0), (x1, y1) = seg
    L = math.hypot(x1 - x0, y1 - y0)
    if L < 1:
        return np.array([]), np.array([]), L
    ux, uy = (x1 - x0) / L, (y1 - y0) / L
    nx, ny = -uy, ux
    # The gradient that runs across the segment.
    g = np.abs(gx * nx + gy * ny)
    n = max(2, int(L // step) + 1)
    ts = np.linspace(0, L, n)
    px = CENTER[0] + (x0 + ux * ts - CENTER[0]) * s
    py = CENTER[1] + (y0 + uy * ts - CENTER[1]) * s
    offs = np.arange(-reach, reach + 0.01, 0.5)
    X = px[:, None] + nx * offs[None, :]
    Yy = py[:, None] + ny * offs[None, :]
    inside = (X >= 0) & (X < 1919) & (Yy >= 0) & (Yy < 1079)
    prof = bilinear(g, X, Yy)
    prof[~inside] = 0
    k = prof.argmax(axis=1)
    peak = prof[np.arange(n), k]
    found = offs[k]
    found = np.where(peak >= thresh, found, np.nan)
    return ts, found, L


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--clip", required=True)
    ap.add_argument("--frames", default="0,15,30,39")
    ap.add_argument("--json")
    a = ap.parse_args()
    frames = [int(f) for f in a.frames.split(",")]
    groups = {"facade": dirb.FACADE, "hatch": dirb.HATCH, "joints": dirb.JOINTS}
    segs = []
    for gname, paths in groups.items():
        for pi, d in enumerate(paths):
            for si, sg in enumerate(segments(d)):
                segs.append({"group": gname, "path": pi, "seg": si, "from": sg[0], "to": sg[1]})
    tmp = Path(tempfile.mkdtemp())
    report = {"clip": a.clip, "center": CENTER, "frames": {}, "segments": []}
    per = {}
    for f in frames:
        Y = load_luma(frame_png(a.clip, f, tmp))
        gx, gy = gradients(Y)
        mag = np.hypot(gx, gy)
        thresh = float(np.percentile(mag, 90)) * 0.6
        s = scale_at(f)
        # Best-fit scale: the share of facade samples within 1.5 px of an edge.
        best = None
        for cand in np.arange(s - 0.012, s + 0.0121, 0.002):
            hit = tot = 0
            for sg in segs:
                if sg["group"] != "facade":
                    continue
                _, off, _ = measure((sg["from"], sg["to"]), gx, gy, cand, thresh, step=8)
                ok = ~np.isnan(off)
                hit += int(np.sum(np.abs(off[ok]) <= 1.5))
                tot += len(off)
            share = hit / max(tot, 1)
            if best is None or share > best[1]:
                best = (round(float(cand), 4), share)
        report["frames"][f] = {"scale_played": round(s, 4), "scale_best_fit": best[0], "share_within_1_5px_at_best": round(best[1], 3)}
        for i, sg in enumerate(segs):
            ts, off, L = measure((sg["from"], sg["to"]), gx, gy, s, thresh)
            per.setdefault(i, {})[f] = (ts, off, L)
    for i, sg in enumerate(segs):
        row = {k: sg[k] for k in ("group", "path", "seg")}
        row["from"], row["to"] = sg["from"], sg["to"]
        row["length"] = round(per[i][frames[0]][2], 1)
        fr = {}
        for f in frames:
            ts, off, L = per[i][f]
            ok = ~np.isnan(off)
            fr[f] = {
                "on_edge": round(float(ok.mean()) if len(off) else 0.0, 2),
                "median_px": round(float(np.median(np.abs(off[ok]))), 2) if ok.any() else None,
                "p90_px": round(float(np.percentile(np.abs(off[ok]), 90)), 2) if ok.any() else None,
            }
        row["frames"] = fr
        # Stub audit on frame 0: each end's last 24 px.
        ts, off, L = per[i][frames[0]]
        ends = {}
        if L >= 24:
            for end, sel in (("end", ts >= L - 24), ("start", ts <= 24)):
                ok = ~np.isnan(off[sel]) & (np.abs(np.nan_to_num(off[sel], nan=99)) <= 3)
                ends[end] = round(float(ok.mean()), 2)
            # The last on-edge sample walking back from each end.
            good = (~np.isnan(off)) & (np.abs(np.nan_to_num(off, nan=99)) <= 3)
            if good.any():
                last_t = float(ts[good].max())
                first_t = float(ts[good].min())
                row["edge_span"] = [round(first_t, 1), round(last_t, 1)]
        row["ends_on_edge"] = ends
        report["segments"].append(row)
    out = json.dumps(report, indent=1)
    if a.json:
        Path(a.json).write_text(out)
    # A short table for the console.
    print("frame scales:", json.dumps(report["frames"]))
    for r in report["segments"]:
        f0 = r["frames"][frames[0]]
        worst = max((r["frames"][f]["median_px"] or 0) for f in frames)
        print(f'{r["group"]:7} p{r["path"]:02d}s{r["seg"]} len {r["length"]:7.1f}  on_edge f0 {f0["on_edge"]:.2f}  '
              f'med f0 {f0["median_px"]}  worst med {worst}  ends {r["ends_on_edge"]}  span {r.get("edge_span")}  '
              f'{tuple(round(v) for v in r["from"])}->{tuple(round(v) for v in r["to"])}')


if __name__ == "__main__":
    main()
