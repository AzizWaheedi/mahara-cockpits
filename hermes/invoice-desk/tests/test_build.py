"""The template fill: escaping, the right blocks, numbers and dates.
Run: cd hermes/invoice-desk && python3 -m unittest discover -s tests
"""
from __future__ import annotations

import hashlib
import json
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from desk import build  # noqa: E402

CASES = json.loads((HERE / "golden" / "cases.json").read_text(encoding="utf-8"))
TEMPLATE = build.TEMPLATE.read_text(encoding="utf-8")


def case(name: str) -> dict:
    return next(c for c in CASES if c["name"].startswith(name))


class Fill(unittest.TestCase):
    def test_golden_hashes(self):
        # The cockpit's preview (src/lib/invoiceTemplate.ts) checks the same hashes.
        for c in CASES:
            got = hashlib.sha256(build.fill(c["invoice"], c["invoiceNo"], TEMPLATE).encode("utf-8")).hexdigest()
            self.assertEqual(got, c["sha256"], f"{c['name']}: run `python3 desk.py golden --write` if the template changed on purpose")

    def test_paid_shows_amount_paid_and_each_payment(self):
        html = build.fill(case("paid")["invoice"], "INV-2026-024", TEMPLATE)
        self.assertIn("Amount paid", html)
        self.assertIn("Total paid", html)
        self.assertIn("USD 6,000.00", html)
        self.assertIn("3 Oct 2026 &nbsp;·&nbsp; Bank transfer &nbsp;·&nbsp; USD <b>500.00</b> &nbsp;·&nbsp; REF DEPOSIT", html)
        self.assertIn(">6 Oct 2026<", html)  # paid date = last payment
        self.assertNotIn("Payment by card", html)
        self.assertNotIn("{{", html)
        self.assertNotIn("<!--IF_CHECKOUT-->", html)

    def test_typed_text_is_escaped_and_never_read_as_a_placeholder(self):
        html = build.fill(case("pay online")["invoice"], "INV-2026-099", TEMPLATE)
        self.assertNotIn("<script>alert(1)</script>", html)
        self.assertIn("&lt;script&gt;alert(1)&lt;/script&gt;", html)
        self.assertIn("Madana &lt;Consulting&gt; &amp; &quot;Engineering&quot;", html)
        self.assertIn("client&#x27;s {{AMOUNT}} plan", html)  # typed braces stay as typed
        self.assertIn('href="https://whop.com/checkout/plan_xvX0i6dKyMYR4?email=turkido%40madana.com.sa&amp;email.disabled=1"', html)
        self.assertIn("USD 1,500.50", html)
        self.assertIn("Payment by card", html)
        self.assertNotIn("Payment received", html)

    def test_card_on_file_without_period_drops_the_period_column(self):
        html = build.fill(case("card on file")["invoice"], "INV-2026-100", TEMPLATE)
        self.assertNotIn(">Period<", html)
        self.assertIn("Payment by card on file", html)
        self.assertIn("No action is needed on your side.", html)
        self.assertIn("USD 1,333.00", html)

    def test_money_and_days(self):
        self.assertEqual(build.money(6000), "6,000.00")
        self.assertEqual(build.money("1500.5"), "1,500.50")
        self.assertEqual(build.money(0.005), "0.01")
        self.assertEqual(build.day("2026-10-06"), "6 Oct 2026")
        self.assertEqual(build.day("2026-12-31T00:00:00+00:00"), "31 Dec 2026")

    def test_next_number_is_above_every_number_used_this_year(self):
        self.assertEqual(build.next_number(2026, ["Invoice #", "INV-2026-023", "INV-2026-024"], ["INV-2026-030"]), "INV-2026-031")
        self.assertEqual(build.next_number(2027, ["INV-2026-024"], []), "INV-2027-001")
        self.assertEqual(build.next_number(2026, ["INV-2026-1000"], []), "INV-2026-1001")

    def test_register_row(self):
        row = build.register_row(case("paid")["invoice"], "INV-2026-024", "https://drive/x")
        self.assertEqual(row[:9], ["INV-2026-024", "Shades Interior Design & General Contracting", "z8xmdvfpyw", 6000.0,
                                   "2026-10-11", "2026-10-06", "https://drive/x", "Paid", ""])
        self.assertIn("2026-10-03 Bank transfer $500.00 ref DEPOSIT", row[9])
        self.assertIn("by csm@maharamedia.com", row[9])
        pending = build.register_row(case("pay online")["invoice"], "INV-2026-099", "https://drive/y")
        self.assertEqual((pending[5], pending[7]), ("2026-11-01", "Pending"))

    def test_pdf_checks(self):
        one = b"%PDF-1.4 /Type /Page /FontFamily (Geist) /FontFamily (Geist Mono) /Type /Pages"
        self.assertEqual(build.pdf_problems(one), [])
        two = one + b" /Type /Page "
        self.assertIn("2 pages", build.pdf_problems(two)[0])
        self.assertIn("fonts did not load", build.pdf_problems(b"/Type /Page /Type /Pages")[0])


if __name__ == "__main__":
    unittest.main()
