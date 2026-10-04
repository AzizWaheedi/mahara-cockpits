"""The browser layer: where it finds a browser, what doctor is told, and (only
when SALES_RENDER_LIVE=1) a real proposal printed by the browser on this box.

    SALES_RENDER_LIVE=1 python3 -m unittest tests.test_render
"""
from __future__ import annotations

import contextlib
import importlib.util
import io
import os
import re
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from desk import build as build_mod  # noqa: E402
from desk import engine as engine_mod  # noqa: E402
from desk import render  # noqa: E402
from desk import validate as validate_mod  # noqa: E402
from tests.fakes import general_deal, specific_deal  # noqa: E402

A4_POINTS = (595.0, 841.9)


def load_cli():
    spec = importlib.util.spec_from_file_location("desk_cli_render", HERE.parent / "desk.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def pdf_pages(raw: bytes) -> list[tuple[float, float]]:
    """Each page's size in points, from the MediaBox Chrome writes per page."""
    boxes = re.findall(rb"/MediaBox \[([^\]]*)\]", raw)
    return [tuple(round(float(x), 1) for x in b.split()[2:4]) for b in boxes]


class HeadlessShellTests(unittest.TestCase):
    def shell(self, home: Path, folder: str, inner: str = "chrome-linux/headless_shell") -> Path:
        path = home / ".cache" / "ms-playwright" / folder / inner
        path.parent.mkdir(parents=True)
        path.write_text("#!/bin/sh\n")
        return path

    def test_the_newest_headless_shell_in_the_cache_is_found(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            self.shell(home, "chromium_headless_shell-1187")
            newest = self.shell(home, "chromium_headless_shell-1193")
            self.shell(home, "chromium-1193", "chrome-linux/chrome")  # a full Chromium is not this
            self.assertEqual(render._headless_shell(home), str(newest))

    def test_the_newer_folder_layout_is_found_too(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            self.shell(home, "chromium_headless_shell-1193")
            newer = self.shell(home, "chromium_headless_shell-1200",
                               "chrome-headless-shell-linux64/chrome-headless-shell")
            self.assertEqual(render._headless_shell(home), str(newer))

    def test_no_cache_is_no_candidate(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertIsNone(render._headless_shell(Path(tmp)))

    def test_chrome_path_still_wins(self):
        self.assertEqual(render.CHROME_CANDIDATES[0], os.environ.get("CHROME_PATH"))


class ProbeTests(unittest.TestCase):
    def test_a_page_and_a_pdf_are_both_reported(self):
        def printed(_page: Path, out: Path) -> bool:
            Path(out).write_bytes(b"%PDF-1.4\n%%EOF")
            return True

        with mock.patch.object(render, "dom", side_effect=lambda p: Path(p).read_text()), \
                mock.patch.object(render, "pdf", side_effect=printed), \
                mock.patch.object(render, "engine", return_value="chrome one-shot"):
            got = render.probe()
        self.assertEqual((got["engine"], got["dom"], got["pdf"]), ("chrome one-shot", True, True))

    def test_a_hang_or_a_crash_is_a_false_not_an_exception(self):
        with mock.patch.object(render, "dom", side_effect=RuntimeError("boom")), \
                mock.patch.object(render, "pdf", return_value=False):
            got = render.probe()
        self.assertEqual((got["dom"], got["pdf"]), (False, False))

    def test_a_file_that_is_not_a_pdf_does_not_count(self):
        def junk(_page: Path, out: Path) -> bool:
            Path(out).write_bytes(b"<html>")
            return True

        with mock.patch.object(render, "dom", return_value=None), mock.patch.object(render, "pdf", side_effect=junk):
            self.assertFalse(render.probe()["pdf"])

    def test_the_probe_uses_its_own_timeout_and_puts_the_drafting_one_back(self):
        seen = []
        render.set_timeout(120)
        with mock.patch.object(render, "dom", side_effect=lambda _p: seen.append(render.TIMEOUT_MS)), \
                mock.patch.object(render, "pdf", return_value=False):
            render.probe(timeout_s=20)
        self.assertEqual(seen, [20000])
        self.assertEqual(render.TIMEOUT_MS, 120000)


class DoctorSentenceTests(unittest.TestCase):
    def setUp(self):
        self.cli = load_cli()

    def test_the_one_shot_path_is_not_said_to_hang(self):
        name, ok, detail = self.cli._browser_row("chrome one-shot", "/x/headless_shell")
        self.assertEqual((name, ok), ("browser", True))
        self.assertIn("/x/headless_shell", detail)
        self.assertNotIn("hang", detail)

    def test_no_browser_says_what_to_set(self):
        _name, ok, detail = self.cli._browser_row("none", None)
        self.assertIsNone(ok)
        self.assertIn("CHROME_PATH", detail)

    def test_the_render_line_is_the_measurement(self):
        good = self.cli._render_row({"engine": "chrome one-shot", "dom": True, "pdf": True, "seconds": 0.6})
        self.assertEqual(good, ("render", True, "chrome one-shot rendered a page and printed a PDF in 0.6s"))
        half = self.cli._render_row({"engine": "chrome one-shot", "dom": True, "pdf": False, "seconds": 30})
        self.assertIsNone(half[1])
        self.assertIn("PDF is skipped", half[2])
        none = self.cli._render_row({"engine": "playwright", "dom": False, "pdf": False, "seconds": 60})
        self.assertIsNone(none[1])
        self.assertIn("overflow is not measured", none[2])

    def test_offline_doctor_launches_no_browser(self):
        with tempfile.TemporaryDirectory() as tmp, \
                mock.patch.dict(os.environ, {"SALES_DESK_HOME": tmp}), \
                mock.patch.object(self.cli.render_mod, "probe", side_effect=AssertionError("launched")):
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                self.cli.main(["doctor", "--offline"])
        self.assertIn(" browser ", buf.getvalue())
        self.assertNotIn("hang on the VPS", buf.getvalue())


@unittest.skipUnless(os.environ.get("SALES_RENDER_LIVE") == "1", "SALES_RENDER_LIVE=1 runs the real browser")
class LiveRenderTests(unittest.TestCase):
    """The real browser on this machine, on the real template. Run on the VPS
    after a change to render.py or to the browser."""

    def test_the_probe_page_renders_and_prints(self):
        got = render.probe()
        self.assertTrue(got["dom"], got)
        self.assertTrue(got["pdf"], got)

    def test_a_proposal_prints_one_a4_page_per_sheet(self):
        with tempfile.TemporaryDirectory() as tmp:
            for deal in (specific_deal(), general_deal()):
                html_path = build_mod.build(deal, Path(tmp) / "p.html")
                out = Path(tmp) / "p.pdf"
                self.assertTrue(render.pdf(html_path, out))
                raw = out.read_bytes()
                self.assertTrue(raw.rstrip().endswith(b"%%EOF"))
                pages = pdf_pages(raw)
                self.assertEqual(len(pages), validate_mod.expected_sheets(deal))
                self.assertTrue(all(abs(w - A4_POINTS[0]) < 1 and abs(h - A4_POINTS[1]) < 1 for w, h in pages), pages)

    def test_the_tightening_measurement_sees_every_sheet(self):
        with tempfile.TemporaryDirectory() as tmp:
            deal = specific_deal()
            over, dom = engine_mod.overflowing(deal, Path(tmp) / "d.html", render)
            self.assertIsNotNone(dom)
            sheets = len(re.findall(r'<section[^>]*class="sheet', validate_mod.live_dom(dom)))
            self.assertEqual(sheets, validate_mod.expected_sheets(deal))
            self.assertIsInstance(over, list)


if __name__ == "__main__":
    unittest.main()
