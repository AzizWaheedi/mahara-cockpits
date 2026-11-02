#!/usr/bin/env python3
"""`bun run check`: the contract section 8 checks on a rendered version.

  python3 scripts/check.py [--out <media>/out/v4] [--hf <media>/v4/hf]

For each cut: 60.0 +- 0.1 s, 1920x1080, 30 fps, H.264 High yuv420p, AAC-LC
48 kHz stereo about 192 kbps, +faststart; loudness -15 +- 1 LUFS and true
peak at or under -1.0 dBTP for a voiced cut (a cut with no narrator yet is
reported as measured and must carry the voiced cut's gain); the poster; the
captions inside the safe area (from the caption scene's own geometry); the
caption file; the client copy check; no forbidden word, price or em dash in
what the cut shows or says; the contact sheet. Prints {ok, checks} and exits
1 when anything fails.
"""
import argparse
import json
import re
import struct
import sys
import platform
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import finish  # noqa: E402
sys.path.insert(0, str(HERE.parent / "film"))
from delivery import blockers_for, source_fingerprint

FORBIDDEN = [r"\bupsell", r"\brenewal", r"\bleads?\b", r"\bCPL\b", r"\bspend\b", r"\bbudget", r"\bprices?\b", r"\bdiscount",
             r"\bguarantee", r"\$", r"%", "—", "تجديد", "ميزانية", "سعر", "خصم", "ضمان"]


def faststart(p):
    """True when the moov atom comes before mdat."""
    with open(p, "rb") as f:
        while True:
            hdr = f.read(8)
            if len(hdr) < 8:
                return False
            size, kind = struct.unpack(">I4s", hdr)
            if kind == b"moov":
                return True
            if kind == b"mdat":
                return False
            if size == 1:
                size = struct.unpack(">Q", f.read(8))[0]
                if size < 16:
                    return False
                f.seek(size - 16, 1)
            else:
                if size < 8:
                    return False
                f.seek(size - 8, 1)


def main():
    if platform.system() == "Darwin":
        raise SystemExit("Video checks run on the VPS only.")
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(Path.home() / "upsell-studio-video/website/out/v4"))
    ap.add_argument("--hf", default=str(Path.home() / "upsell-studio-video/website/v4/hf"))
    ap.add_argument("--mode", choices=["client-ready", "internal-preview"], default="client-ready")
    ap.add_argument("--approvals", help="Reviewed evidence JSON; defaults to the media root's delivery-approvals.json")
    a = ap.parse_args()
    out, hf = Path(a.out), Path(a.hf)
    checks = []
    blocked = []
    current_source = source_fingerprint(HERE.parent)
    approval_path = Path(a.approvals) if a.approvals else out.parent.parent / "delivery-approvals.json"
    approval = json.loads(approval_path.read_text()) if approval_path.exists() else {}

    def ck(name, ok, detail=""):
        checks.append({"check": name, "ok": bool(ok), "detail": detail})

    en_gain = None
    if (out / "facts-en.json").exists():
        en_gain = json.loads((out / "facts-en.json").read_text())["gain_db"]
    for lang in ("en", "ar"):
        facts_p = out / f"facts-{lang}.json"
        if not facts_p.exists():
            ck(f"{lang}: rendered", False, f"no {facts_p.name}")
            continue
        fx = json.loads(facts_p.read_text())
        build = json.loads((out / f"build-{lang}.json").read_text())
        ck(f"{lang}: rendered from current source", build.get("source_fingerprint") == current_source, "Old renders need a fresh build; files are never relabelled as current.")
        blocked.extend(f"{lang}: {reason}" for reason in blockers_for(lang, build, approval, current_source, fx["main"].get("md5")))
        if build.get("closing") == "real":
            ck(f"{lang}: real close uses eight seconds without narrator overlap", build.get("closing_seconds") == 8 and build.get("narrator_ends_at") == 52)
        for kind in ("main", "clean"):
            f = fx[kind]
            artifact = out / f["file"]
            ck(f"{lang} {kind}: facts match actual bytes", artifact.exists() and artifact.stat().st_size == f["bytes"] and finish.md5(artifact) == f["md5"])
            v, au = f["video"], f["audio"] or {}
            ck(f"{lang} {kind}: 60.0 +- 0.1 s", abs(f["duration_s"] - 60.0) <= 0.1, f["duration_s"])
            ck(f"{lang} {kind}: format", (v["size"], v["fps"], v["codec"], v["profile"], v["pix_fmt"]) == ("1920x1080", "30/1", "h264", "High", "yuv420p"), v)
            ck(f"{lang} {kind}: audio", au.get("codec") == "aac" and au.get("profile") == "LC" and au.get("rate") == "48000"
               and au.get("channels") == 2 and 180 <= au.get("kbps", 0) <= 200, au)
            ck(f"{lang} {kind}: +faststart", faststart(out / f["file"]))
            if build.get("voice"):
                ck(f"{lang} {kind}: -15 +- 1 LUFS", -16 <= f["lufs"] <= -14, f["lufs"])
            else:
                ck(f"{lang} {kind}: no narrator yet, the voiced cut's gain", en_gain is not None and abs(fx["gain_db"] - en_gain) < 0.01,
                   f"{f['lufs']} LUFS measured (room tone and two effects only), gain {fx['gain_db']} dB")
            ck(f"{lang} {kind}: true peak <= -1.0 dBTP", f["true_peak_dbtp"] <= -1.0, f["true_peak_dbtp"])
        proxy = out / fx["proxy"]["file"]
        ck(f"{lang}: proxy <= 6 MB", proxy.exists() and proxy.stat().st_size == fx["proxy"]["bytes"] and fx["proxy"]["bytes"] <= 6_000_000, fx["proxy"]["bytes"])
        poster = out / f"website-{lang}-poster.jpg"
        ck(f"{lang}: poster", poster.exists() and poster.stat().st_size > 50_000, poster.name)
        vtt = out / f"website-{lang}.vtt"
        ck(f"{lang}: caption file", vtt.exists() and vtt.read_text().startswith("WEBVTT"), vtt.name)
        cap = (hf / lang / "compositions/captions.html").read_text()
        bottom = int(re.search(r"\.capg\{[^}]*bottom:(\d+)px", cap).group(1))
        maxw = int(re.search(r"max-width:(\d+)px", cap).group(1))
        ck(f"{lang}: captions inside the 80% box", 1080 - bottom <= 972 and (1920 - maxw) / 2 >= 192, f"bottom {1080 - bottom}, x {(1920 - maxw) // 2} to {(1920 + maxw) // 2}")
        words = json.loads((out / f"copy-{lang}.json").read_text())
        texts = [w["text"] for w in words] + [l for l in vtt.read_text().splitlines() if l and "-->" not in l and not l.isdigit() and l != "WEBVTT"]
        hits = sorted({f"{pat} in '{t}'" for t in texts for pat in FORBIDDEN if re.search(pat, t, re.I)})
        ck(f"{lang}: no forbidden word, price or em dash", not hits, hits)
        # Unlicensed music previews are optional review material, never a delivery requirement.
    cc = out / "copy-check.json"
    cc_ok = cc.exists() and json.loads(cc.read_text()).get("ok") is True
    ck("client copy check (cockpit_client_copy_problems)", cc_ok, json.loads(cc.read_text()) if cc.exists() else "missing")
    ck("contact sheet", (out / "contact-sheet.png").exists() or (out / "contact-sheet.jpg").exists())
    manifest_path = out / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    ck("manifest schema", manifest.get("schemaVersion") == 1 and isinstance(manifest.get("clientReady"), bool) and isinstance(manifest.get("not_for_clients_because"), list) and set(manifest.get("cuts", {})) == {"en", "ar"})
    if a.mode == "client-ready":
        ck("client delivery approvals and current recorded media", not blocked, blocked)
        ck("manifest also permits client delivery", manifest.get("clientReady") is True and not manifest.get("not_for_clients_because"), manifest.get("not_for_clients_because"))
    ok = all(c["ok"] for c in checks)
    print(json.dumps({"ok": ok, "mode": a.mode, "clientReady": ok and not blocked and manifest.get("clientReady") is True, "deliveryBlockers": blocked, "checks": checks}, indent=1, ensure_ascii=False))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
