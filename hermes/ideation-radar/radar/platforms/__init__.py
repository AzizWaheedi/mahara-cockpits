from __future__ import annotations

from ..config import Config
from .base import Adapter, PlatformError
from .instagram import Instagram
from .snapchat import Snapchat
from .tiktok import TikTok
from .youtube import YouTube


def adapter_for(platform: str, cfg: Config) -> Adapter:
    p = (platform or "").lower()
    if p == "instagram":
        return Instagram(cfg)
    if p == "tiktok":
        return TikTok(cfg)
    if p == "snapchat":
        return Snapchat(cfg)
    if p == "youtube":
        return YouTube(cfg)
    raise PlatformError(f"unknown platform: {platform}")


__all__ = ["adapter_for", "Adapter", "PlatformError", "Instagram", "TikTok", "Snapchat", "YouTube"]
