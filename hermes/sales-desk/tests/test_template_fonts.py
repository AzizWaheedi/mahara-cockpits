"""The template's font stacks: every Arabic letter set in a face the document
carries, never in whatever the machine has.

On 2026-10-04 an Arabic proposal printed on the VPS embedded DejaVu Sans:
the mono labels' stack had no Arabic face after Geist Mono, so the server's
own font drew them. With "Plex Arabic" after Geist Mono the same PDFs embed
only the document's faces, with the same seven A4 pages and no overflow.
"""
from __future__ import annotations

import re
import unittest
from pathlib import Path

TEMPLATE = Path(__file__).resolve().parent.parent / "proposal-template.html"


class FontStacks(unittest.TestCase):
    def setUp(self):
        self.css = TEMPLATE.read_text(encoding="utf-8")

    def stack(self, name: str) -> list[str]:
        found = re.search(rf"^\s*--{name}:\s*([^;]+);", self.css, re.M)
        self.assertIsNotNone(found, name)
        return [f.strip().strip('"') for f in found.group(1).split(",")]

    def test_the_arabic_face_is_carried_by_the_document(self):
        self.assertIn('font-family: "Plex Arabic"', self.css)
        self.assertIn("data:font/", self.css)

    def test_every_stack_reaches_plex_arabic_right_after_its_latin_face(self):
        for name, latin in (("sans", "Geist"), ("mono", "Geist Mono")):
            faces = self.stack(name)
            self.assertEqual(faces[:2], [latin, "Plex Arabic"], (name, faces))

    def test_the_figures_use_the_text_stack(self):
        self.assertEqual(self.stack("num"), ["var(--sans)"])


if __name__ == "__main__":
    unittest.main()
