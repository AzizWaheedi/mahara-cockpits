#!/usr/bin/env python3
"""Fail before deployment when a local link points to a similarly named project."""
import json
import sys
from pathlib import Path


def verify(link, expected):
    if any(link.get(key) != expected[key] for key in ("projectId", "orgId")):
        raise ValueError(
            f"Wrong Vercel project link. {expected['domain']} belongs to "
            f"{expected['projectName']} ({expected['projectId']}). "
            "Verify the live alias before repairing .vercel/project.json."
        )


def main():
    root = Path(__file__).resolve().parent.parent
    directory = sys.argv[1]
    expected = json.loads((root / "config/vercel-projects.json").read_text()).get(directory)
    if expected is None:
        return  # Do not invent ownership for unverified projects.
    link_path = root / directory / ".vercel/project.json"
    if not link_path.exists():
        raise ValueError("Missing Vercel link; use config/vercel-projects.json after verifying the live alias.")
    verify(json.loads(link_path.read_text()), expected)
    print(f"Vercel project verified for {expected['domain']}: {expected['projectName']}")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, IndexError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
