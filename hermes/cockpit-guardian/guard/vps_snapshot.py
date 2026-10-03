#!/usr/bin/env python3
"""One read-only look at the VPS, printed as JSON. Runs ON the VPS as hermes.

The guardian runs it locally (python3 vps_snapshot.py SPEC) or, for a
read-only run from elsewhere, over ssh with the script on stdin
(ssh ... python3 - SPEC). SPEC is base64 JSON naming what to look at.

What it never returns: a key's value (env files give names and set/empty
only), a process's arguments (cloudflared carries its tunnel token there;
only counts, ages and the job each process belongs to), or a prompt from
the Hermes jobs file. Every part is read in its own try, so one failure
says "error" for that part and the rest still answer.

Standard library only, Python 3.6 or later.
"""
import base64
import glob
import json
import os
import pwd
import re
import subprocess
import sys
import time
import urllib.request

HOME = os.path.expanduser("~")


def x(path):
    return os.path.expanduser(path.replace("$HOME", HOME))


def part(fn):
    try:
        return fn()
    except Exception as e:  # noqa: BLE001 - one part failing must not hide the others
        return {"error": "%s: %s" % (type(e).__name__, str(e)[:200])}


_CRON_LINE = re.compile(r"^\s*(?:@\w+|(?:\S+\s+){5})\S")


def _mask(line):
    # A literal NAME=value assignment inline would be a secret: mask it.
    return re.sub(r"(?i)\b([A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*=)[^\s;\"']+", r"\1<hidden>", line)


def crontab():
    p = subprocess.run(["crontab", "-l"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20)
    if p.returncode != 0:
        err = p.stderr.decode("utf-8", "replace").strip()
        if "no crontab" in err.lower():
            return {"lines": [], "commented": []}
        return {"error": err[:200]}
    lines, commented = [], []
    for raw in p.stdout.decode("utf-8", "replace").splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith("#"):
            # A job line commented out on purpose (paused), told apart from prose comments.
            body = line.lstrip("#").strip()
            if _CRON_LINE.match(body) and ("flock" in body or "python" in body):
                commented.append(_mask(body))
            continue
        lines.append(_mask(line))
    return {"lines": lines, "commented": commented}


def meminfo():
    out = {}
    with open("/proc/meminfo") as fh:
        for line in fh:
            name, _, rest = line.partition(":")
            if name in ("MemTotal", "MemAvailable", "MemFree", "SwapTotal", "SwapFree"):
                out[name] = int(rest.split()[0])
    return out


def disk():
    st = os.statvfs("/")
    used = (st.f_blocks - st.f_bfree) * st.f_frsize
    avail = st.f_bavail * st.f_frsize
    return {"pct": round(100.0 * used / max(1, used + avail), 1), "avail_gb": round(avail / 1e9, 1),
            "size_gb": round(st.f_blocks * st.f_frsize / 1e9, 1)}


def load():
    return {"load": list(os.getloadavg()), "cpus": os.cpu_count()}


def _uptime():
    with open("/proc/uptime") as fh:
        return float(fh.read().split()[0])


def _lock_path(lock):
    return x(lock.replace("~", "$HOME", 1)) if lock.startswith("~") else x(lock)


def processes(markers):
    hz = os.sysconf("SC_CLK_TCK")
    page = os.sysconf("SC_PAGE_SIZE")
    up = _uptime()
    me = os.getpid()
    jobs, top, users = [], [], {}
    tunnels = {"n": 0, "rss_kb": 0, "users": {}, "started": {}}
    table = {}
    for d in glob.glob("/proc/[0-9]*"):
        pid = int(os.path.basename(d))
        if pid == me:
            continue
        try:
            with open(d + "/cmdline", "rb") as fh:
                argv = [a.decode("utf-8", "replace") for a in fh.read().split(b"\0") if a]
            with open(d + "/stat") as fh:
                stat = fh.read()
            with open(d + "/statm") as fh:
                rss_kb = int(fh.read().split()[1]) * page // 1024
            uid = os.stat(d).st_uid
        except (OSError, ValueError, IndexError):
            continue
        fields = stat.rsplit(")", 1)[1].split()
        table[pid] = {"ppid": int(fields[1]), "argv": argv, "start": int(fields[19]),
                      "cpu": int(fields[11]) + int(fields[12]), "uid": uid, "rss_kb": rss_kb}
    for pid, info in table.items():
        argv = info["argv"]
        if not argv:
            continue
        uid = info["uid"]
        etimes = int(up - info["start"] / hz)
        if uid not in users:
            try:
                users[uid] = pwd.getpwuid(uid).pw_name
            except KeyError:
                users[uid] = str(uid)
        user = users[uid]
        comm = os.path.basename(argv[0])[:40]
        args = " ".join(argv)
        if "cloudflared" in comm:
            tunnels["n"] += 1
            tunnels["rss_kb"] += info["rss_kb"]
            tunnels["users"][user] = tunnels["users"].get(user, 0) + 1
            started = int(time.time() - etimes)
            span = tunnels["started"].setdefault(user, [started, started])
            span[0], span[1] = min(span[0], started), max(span[1], started)
        if comm.startswith("python"):
            cwd = None
            for job, spec in markers.items():
                marker, folder = spec[0], spec[1]
                lock = spec[2] if len(spec) > 2 else ""
                if not marker or marker not in args:
                    continue
                if folder:
                    if cwd is None:
                        try:
                            cwd = os.readlink("/proc/%d/cwd" % pid)
                        except OSError:
                            cwd = ""
                    if folder not in cwd and folder not in args:
                        continue
                # Is this the cron run itself? An ancestor must be `flock -n <its lock>`.
                flock = False
                if lock:
                    want = _lock_path(lock)
                    up_pid, hops = info["ppid"], 0
                    while up_pid in table and hops < 6:
                        a = table[up_pid]["argv"]
                        if a and os.path.basename(a[0]) == "flock" and want in a:
                            flock = True
                            break
                        up_pid, hops = table[up_pid]["ppid"], hops + 1
                jobs.append({"pid": pid, "job": job, "etimes": etimes, "user": user, "mine": uid == os.getuid(),
                             "start": info["start"], "ppid": info["ppid"], "cpu": info["cpu"], "flock": flock})
        label = comm
        if comm in ("node", "python3", "python", "bun", "deno") and len(argv) > 1:
            first = next((a for a in argv[1:] if not a.startswith("-") and "=" not in a), "")
            if first:
                label = comm + " " + os.path.basename(first)[:40]
        top.append({"user": user, "name": label, "rss_mb": info["rss_kb"] // 1024})
    top.sort(key=lambda r: -r["rss_mb"])
    return {"jobs": jobs, "top": top[:6], "cloudflared": tunnels, "hz": hz}


def listeners():
    out = set()
    for path, v6 in (("/proc/net/tcp", False), ("/proc/net/tcp6", True)):
        try:
            with open(path) as fh:
                next(fh)
                for line in fh:
                    cols = line.split()
                    if cols[3] != "0A":
                        continue
                    addr, port = cols[1].split(":")
                    port = int(port, 16)
                    if v6:
                        host = "::" if set(addr) == {"0"} else ("::1" if addr.endswith("01000000") and set(addr[:24]) == {"0"} else "v6")
                    else:
                        b = bytes.fromhex(addr)[::-1]
                        host = ".".join(str(i) for i in b)
                    out.add("%s:%d" % (host, port))
        except OSError:
            continue
    return sorted(out)


def files(paths):
    out = {}
    for p in paths:
        fp = x(p)
        try:
            st = os.stat(fp)
            try:
                owner = pwd.getpwuid(st.st_uid).pw_name
            except KeyError:
                owner = str(st.st_uid)
            out[p] = {"mtime": int(st.st_mtime), "size": st.st_size, "mode": oct(st.st_mode & 0o777)[2:], "owner": owner}
        except OSError:
            out[p] = None
    return out


FLAG = re.compile(r"Traceback \(most recent call last\)|^\S*Error: |\bERROR\b")


def tails(paths, n, offsets=None):
    """The last n lines of each log, and the tracebacks written since the size the
    guardian saw at its previous scan (offsets), so one old traceback is not read
    again and again until it scrolls out of the tail."""
    offsets = offsets or {}
    out = {}
    for p in paths:
        fp = x(p)
        try:
            with open(fp, "rb") as fh:
                fh.seek(0, 2)
                size = fh.tell()
                seen = offsets.get(p)
                start = max(0, size - 64 * 1024)
                if isinstance(seen, int) and 0 <= seen <= size:
                    start = max(start, seen)
                fh.seek(start)
                new_text = fh.read().decode("utf-8", "replace")
                fh.seek(max(0, size - 64 * 1024))
                lines = fh.read().decode("utf-8", "replace").splitlines()[-n:]
        except OSError:
            out[p] = None
            continue
        fresh = new_text.splitlines()[-n:] if isinstance(offsets.get(p), int) else lines
        flagged = [l.strip()[:240] for l in fresh if FLAG.search(l)]
        out[p] = {"tracebacks": sum(1 for l in fresh if "Traceback (most recent call last)" in l),
                  "flagged": flagged[-3:], "last": (lines[-1].strip()[:240] if lines else ""),
                  "rotated": len(glob.glob(fp + ".*.gz")), "size": size,
                  "since_offset": isinstance(offsets.get(p), int)}
    return out


def env_keys(paths):
    """Names and set/empty only. A value never leaves this function."""
    out = {}
    for p in paths:
        fp = x(p)
        if not os.path.exists(fp):
            out[p] = None
            continue
        names = {}
        try:
            with open(fp, encoding="utf-8") as fh:
                for raw in fh:
                    line = raw.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    if line.startswith("export "):
                        line = line[7:]
                    name, _, value = line.partition("=")
                    value = value.strip().strip("\"'")
                    names[name.strip()] = "set" if value else "empty"
        except OSError as e:
            out[p] = {"error": str(e)[:120]}
            continue
        out[p] = names
    return out


def settings(spec):
    """Allow-listed non-secret settings, by name (SALES_MODEL_PROVIDER)."""
    out = {}
    for name, path in spec.items():
        fp = x(path)
        try:
            with open(fp, encoding="utf-8") as fh:
                for raw in fh:
                    line = raw.strip()
                    if line.startswith("export "):
                        line = line[7:]
                    if line.startswith(name + "="):
                        out[name] = line.split("=", 1)[1].strip().strip("\"'")[:40]
        except OSError:
            pass
    return out


def proxy(url):
    started = time.time()
    try:
        with urllib.request.urlopen(url, timeout=5) as r:
            body = r.read(2000).decode("utf-8", "replace")
            try:
                status = json.loads(body).get("status")
            except ValueError:
                status = None
            return {"http": r.status, "status": status, "seconds": round(time.time() - started, 2)}
    except Exception as e:  # noqa: BLE001
        code = getattr(e, "code", 0)
        return {"http": code or 0, "error": "%s: %s" % (type(e).__name__, str(e)[:120])}


def read_json(path):
    with open(x(path)) as fh:
        return json.load(fh)


def git_copy(repo):
    r = x(repo)
    head = subprocess.run(["git", "-C", r, "log", "-1", "--format=%h|%cI"], stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, timeout=30)
    if head.returncode != 0:
        return {"error": head.stderr.decode("utf-8", "replace")[:160]}
    h, _, date = head.stdout.decode().strip().partition("|")
    # --no-optional-locks: a read must not take .git/index.lock or rewrite the index.
    st = subprocess.run(["git", "--no-optional-locks", "-C", r, "status", "--porcelain"], stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE, timeout=60)
    return {"head": h, "date": date, "dirty": len([l for l in st.stdout.decode("utf-8", "replace").splitlines() if l.strip()])}


def monitors(paths):
    out = {}
    for name, path in paths.items():
        try:
            d = read_json(path)
        except Exception as e:  # noqa: BLE001
            out[name] = {"error": "%s: %s" % (type(e).__name__, str(e)[:120])}
            continue
        tick = d.get("last_tick") or {}
        status = tick.get("status") or {}
        incidents = {}
        for k, v in (d.get("incidents") or {}).items():
            if isinstance(v, dict):
                incidents[k] = {"summary": str(v.get("summary") or "")[:200], "severity": v.get("severity"),
                                "opened": v.get("opened"), "component": str(v.get("component") or "")[:80]}
        box = d.get("outbox") or []
        ats = [i.get("at") for i in box if isinstance(i, dict) and isinstance(i.get("at"), (int, float))]
        out[name] = {"at": tick.get("at"), "not_ok": {k: v for k, v in status.items() if v != "ok"},
                     "checks": len(status), "incidents": incidents, "outbox": len(box),
                     "outbox_oldest": min(ats) if ats else None,
                     "delivery_last_ok": (d.get("delivery") or {}).get("last_ok")}
    return out


def hermes_jobs(path):
    d = read_json(path)
    jobs = d.get("jobs") if isinstance(d, dict) else d
    if isinstance(jobs, dict):
        jobs = list(jobs.values())
    out = []
    for j in jobs or []:
        err = str(j.get("last_error") or "").strip().splitlines()
        out.append({"id": j.get("id"), "name": str(j.get("name") or "")[:80], "enabled": j.get("enabled"),
                    "last_status": j.get("last_status"), "last_run_at": j.get("last_run_at"),
                    "failure_streak": j.get("failure_streak"), "last_error": (err[0][:160] if err else ""),
                    "schedule": (j.get("schedule") or {}).get("display") if isinstance(j.get("schedule"), dict) else None,
                    "paused_reason": str(j.get("paused_reason") or "")[:120]})
    return out


# Log classes that are not an action: a no-op, a diagnosis (FIXER.md: data/ops issues are
# reported, never touched) or an escalation to the CEO.
QUIET_PREFIXES = ("no-op", "data/ops")
QUIET_WORDS = ("escalation only",)


def fixer(path):
    """When the reliability fixer last really acted. Its file is rewritten on every
    no-op run too, so the mtime alone would block the guardian most of the day."""
    fp = x(path)
    st = os.stat(fp)
    out = {"mtime": int(st.st_mtime), "last_action_at": None}
    try:
        d = read_json(path)
    except Exception:  # noqa: BLE001 - unreadable: fall back to the mtime
        out["last_action_at"] = int(st.st_mtime)
        return out
    log = d.get("log") if isinstance(d, dict) else None
    newest = None
    for item in log or []:
        if not isinstance(item, dict):
            continue
        cls = str(item.get("class") or "").strip().lower()
        if cls.startswith(QUIET_PREFIXES) or any(w in cls for w in QUIET_WORDS):
            continue
        at = str(item.get("at") or "").replace("Z", "+00:00")
        try:
            import datetime as _dt
            t = _dt.datetime.fromisoformat(at).timestamp()
        except ValueError:
            continue
        newest = t if newest is None or t > newest else newest
    if newest is not None:
        # The fixer's clock in that file can run ahead; it cannot have acted after the file was written.
        out["last_action_at"] = int(min(newest, st.st_mtime))
    return out


def rooms(spec):
    out = {"file": os.path.exists(x(spec["file"]))}
    try:
        p = subprocess.run(["systemctl", "--user", "is-active", spec["unit"]], stdout=subprocess.PIPE,
                           stderr=subprocess.PIPE, timeout=10)
        out["unit"] = p.stdout.decode().strip() or p.stderr.decode().strip()[:80]
    except Exception as e:  # noqa: BLE001
        out["unit"] = "unknown: %s" % type(e).__name__
    return out


def main():
    spec = json.loads(base64.b64decode(sys.argv[1]).decode("utf-8")) if len(sys.argv) > 1 else {}
    snap = {"at": int(time.time()), "user": pwd.getpwuid(os.getuid()).pw_name, "home": HOME}
    snap["crontab"] = part(crontab)
    snap["mem"] = part(meminfo)
    snap["disk"] = part(disk)
    snap["load"] = part(load)
    snap["procs"] = part(lambda: processes(spec.get("markers") or {}))
    snap["listen"] = part(listeners)
    snap["files"] = part(lambda: files(spec.get("files") or []))
    snap["logs"] = part(lambda: tails(spec.get("logs") or [], int(spec.get("tail_lines") or 80),
                                      spec.get("log_offsets") or {}))
    snap["env_keys"] = part(lambda: env_keys(spec.get("env_files") or []))
    snap["settings"] = part(lambda: settings(spec.get("settings") or {}))
    if spec.get("proxy"):
        snap["proxy"] = part(lambda: proxy(spec["proxy"]))
    if spec.get("salma_vps"):
        snap["salma_vps"] = part(lambda: read_json(spec["salma_vps"]))
    if spec.get("repo"):
        snap["git"] = part(lambda: git_copy(spec["repo"]))
    if spec.get("monitors"):
        snap["monitors"] = part(lambda: monitors(spec["monitors"]))
    if spec.get("jobs_json"):
        snap["hermes_jobs"] = part(lambda: hermes_jobs(spec["jobs_json"]))
    if spec.get("fixer_attempts"):
        snap["fixer"] = part(lambda: fixer(spec["fixer_attempts"]))
    if spec.get("rooms"):
        snap["rooms"] = part(lambda: rooms(spec["rooms"]))
    sys.stdout.write(json.dumps(snap, default=str))


if __name__ == "__main__":
    main()
