"""Canonical identity for a pasted social link.

A creative director pastes whatever the share sheet gave him: a reel link
with tracking parameters, a vm.tiktok.com short link, a Snapchat spotlight
link. The database must key on one stable id per post, so every URL is
reduced to (platform, post_id, canonical_url). Short links that cannot be
read without a network call are flagged needs_resolve; the caller follows
the redirect and canonicalises again.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional
from urllib.parse import urlparse, urlunparse


@dataclass
class Link:
    platform: str  # instagram | tiktok | snapchat
    kind: str  # post | profile | hashtag | spotlight | story | unknown
    post_id: str
    canonical_url: str
    handle: str = ""
    needs_resolve: bool = False

    @property
    def key(self) -> str:
        return f"{self.platform}:{self.post_id}" if self.post_id else f"{self.platform}:{self.kind}:{self.handle}"


class UnsupportedLink(ValueError):
    pass


_IG_POST = re.compile(r"^/(?:[A-Za-z0-9_.]+/)?(reel|reels|p|tv)/([A-Za-z0-9_-]{5,})/?")
_IG_PROFILE = re.compile(r"^/([A-Za-z0-9_.]{1,30})/?$")
_IG_SHARE = re.compile(r"^/share/")
_IG_HASHTAG = re.compile(r"^/explore/tags/([^/]+)/?")
_TT_VIDEO = re.compile(r"^/@([A-Za-z0-9_.]+)/video/(\d{6,})")
_TT_VIDEO_NOUSER = re.compile(r"^/(?:v|video)/(\d{6,})")
_TT_PHOTO = re.compile(r"^/@([A-Za-z0-9_.]+)/photo/(\d{6,})")
_TT_PROFILE = re.compile(r"^/@([A-Za-z0-9_.]+)/?$")
_TT_TAG = re.compile(r"^/tag/([^/]+)/?")
_TT_SHORT = re.compile(r"^/(?:t/)?([A-Za-z0-9]{6,})/?$")
_SC_SPOTLIGHT = re.compile(r"^/spotlight/([A-Za-z0-9_-]{6,})")
_SC_PROFILE = re.compile(r"^/(?:add/)?@?([A-Za-z0-9_.-]{2,})/?$")
_SC_STORY = re.compile(r"^/@?([A-Za-z0-9_.-]+)/(?:story|s)/([A-Za-z0-9_-]+)")
_SC_SHORT = re.compile(r"^/t/([A-Za-z0-9]+)/?$")


def _clean(url: str) -> tuple[str, str, str]:
    u = url.strip()
    if not u:
        raise UnsupportedLink("empty link")
    if "://" not in u:
        u = "https://" + u
    p = urlparse(u)
    host = (p.netloc or "").lower()
    host = host.split("@")[-1].split(":")[0]
    if host.startswith("www."):
        host = host[4:]
    if host.startswith("m."):
        host = host[2:]
    path = p.path or "/"
    return host, path, u


def canonicalize(url: str) -> Link:
    host, path, full = _clean(url)
    if host in ("instagram.com", "instagr.am"):
        if _IG_SHARE.match(path):
            return Link("instagram", "unknown", "", full, needs_resolve=True)
        m = _IG_POST.match(path)
        if m:
            kind, code = m.group(1), m.group(2)
            seg = "p" if kind == "p" else "reel"
            return Link("instagram", "post", code, f"https://www.instagram.com/{seg}/{code}/")
        m = _IG_HASHTAG.match(path)
        if m:
            tag = m.group(1).lower()
            return Link("instagram", "hashtag", "", f"https://www.instagram.com/explore/tags/{tag}/", handle=tag)
        m = _IG_PROFILE.match(path)
        if m and m.group(1) not in ("explore", "accounts", "reels", "p", "tv", "stories"):
            h = m.group(1).lower()
            return Link("instagram", "profile", "", f"https://www.instagram.com/{h}/", handle=h)
        raise UnsupportedLink(f"unrecognised Instagram link: {path}")
    if host in ("tiktok.com", "vm.tiktok.com", "vt.tiktok.com"):
        m = _TT_VIDEO.match(path)
        if m:
            h, vid = m.group(1).lower(), m.group(2)
            return Link("tiktok", "post", vid, f"https://www.tiktok.com/@{h}/video/{vid}", handle=h)
        m = _TT_PHOTO.match(path)
        if m:
            h, vid = m.group(1).lower(), m.group(2)
            return Link("tiktok", "post", vid, f"https://www.tiktok.com/@{h}/photo/{vid}", handle=h)
        m = _TT_VIDEO_NOUSER.match(path)
        if m:
            vid = m.group(1)
            return Link("tiktok", "post", vid, f"https://www.tiktok.com/video/{vid}", needs_resolve=True)
        m = _TT_TAG.match(path)
        if m:
            tag = m.group(1).lower()
            return Link("tiktok", "hashtag", "", f"https://www.tiktok.com/tag/{tag}", handle=tag)
        m = _TT_PROFILE.match(path)
        if m:
            h = m.group(1).lower()
            return Link("tiktok", "profile", "", f"https://www.tiktok.com/@{h}", handle=h)
        if host != "tiktok.com" or _TT_SHORT.match(path):
            return Link("tiktok", "unknown", "", full, needs_resolve=True)
        raise UnsupportedLink(f"unrecognised TikTok link: {path}")
    if host in ("snapchat.com", "story.snapchat.com", "t.snapchat.com"):
        m = _SC_SPOTLIGHT.match(path)
        if m:
            sid = m.group(1)
            return Link("snapchat", "spotlight", sid, f"https://www.snapchat.com/spotlight/{sid}")
        m = _SC_STORY.match(path)
        if m:
            h, sid = m.group(1).lower(), m.group(2)
            return Link("snapchat", "story", sid, f"https://www.snapchat.com/@{h}/story/{sid}", handle=h)
        m = _SC_SHORT.match(path)
        if m or host == "t.snapchat.com":
            return Link("snapchat", "unknown", "", full, needs_resolve=True)
        m = _SC_PROFILE.match(path)
        if m:
            h = m.group(1).lower()
            return Link("snapchat", "profile", "", f"https://www.snapchat.com/@{h}", handle=h)
        raise UnsupportedLink(f"unrecognised Snapchat link: {path}")
    raise UnsupportedLink(f"not an Instagram, TikTok or Snapchat link: {host}")


def profile_url(platform: str, handle: str) -> str:
    h = handle.lstrip("@")
    if platform == "instagram":
        return f"https://www.instagram.com/{h}/"
    if platform == "tiktok":
        return f"https://www.tiktok.com/@{h}"
    if platform == "snapchat":
        return f"https://www.snapchat.com/@{h}"
    raise UnsupportedLink(platform)


def strip_query(url: str) -> str:
    p = urlparse(url)
    return urlunparse((p.scheme, p.netloc, p.path, "", "", ""))
