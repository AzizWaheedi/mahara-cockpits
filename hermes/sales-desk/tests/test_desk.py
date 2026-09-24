"""The sales desk, tested without a network: synthetic calls and deals, a fake
PostgREST behind the real HTTP layer, and fakes for the model, Fathom and the
browser. Run from hermes/sales-desk:

    python3 -m unittest discover -s tests -t .
"""
from __future__ import annotations

import contextlib
import copy
import importlib.util
import io
import json
import os
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from unittest import mock

os.environ["SALES_NO_KEY_FILES"] = "1"
for _name in ("OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "FATHOM_API_KEY",
              "DESK_SUPABASE_URL", "DESK_SUPABASE_KEY", "SALES_MODEL_PROVIDER", "SALES_PROPOSAL_MODEL"):
    os.environ.pop(_name, None)

from desk import build, engine, fathom, http, model, offer, prompt, queue, recordings, validate  # noqa: E402
from desk.config import ROOT, Config  # noqa: E402
from desk.errors import NotNow, Refused  # noqa: E402
from desk.supabase import Supabase  # noqa: E402
from tests import fakes  # noqa: E402
from tests.fakes import (FakeFathom, FakePostgrest, FakeProvider, FakeRenderer, TEST_OFFER,  # noqa: E402
                         blind_deal, general_deal, specific_deal, transcript, triage_answer)

import extract_reference  # noqa: E402

REQ = "cockpit_sales_requests"
PROP = "cockpit_sales_proposals"


def cfg_in(tmp: str) -> Config:
    c = Config(home=Path(tmp), out_dir=Path(tmp) / "out", reference_dir=Path(tmp) / "reference",
               supabase_url="https://example.supabase.co", supabase_key="service-test")
    c.model_attempts = 2
    c.model_timeout = 5
    c.ensure_dirs()
    return c


def resolved(choice: Any = None) -> dict[str, Any]:
    return offer.resolve(TEST_OFFER, choice)


def with_offer(deal: dict[str, Any], choice: Any = None) -> dict[str, Any]:
    deal["offer"] = offer.stamp(resolved(choice))
    return deal


def check(deal: dict[str, Any], *, text: Any = "default", dom: bool = True, choice: Any = None,
          renderer: Any = None, today: Any = None) -> validate.Result:
    """Validate a deal the way the desk does: built, rendered by the fake browser, checked."""
    words = transcript() if text == "default" else text
    rendered = None
    if dom:
        with tempfile.TemporaryDirectory() as tmp:
            html_path = build.build(deal, Path(tmp) / "p.html")
            rendered = (renderer or FakeRenderer()).dom(html_path)
    r = resolved(choice) if choice is not None else offer.from_deal(deal, TEST_OFFER)
    return validate.validate(deal, words, resolved=r, offer=TEST_OFFER, dom=rendered, engine="fake", today=today)


def failing(result: validate.Result, name: str) -> list[str]:
    return [r["detail"] for r in result.rows if r["check"] == name and r["status"] == "FAIL"]


def warning(result: validate.Result, name: str) -> list[str]:
    return [r["detail"] for r in result.rows if r["check"] == name and r["status"] == "WARN"]


# ---------------------------------------------------------------------------
class VariantGateTests(unittest.TestCase):
    def test_value_and_net_margin_make_the_specific_one(self):
        self.assertEqual(engine.choose_variant(triage_answer(), "a call")[0], "specific")

    def test_value_without_margin_is_the_ordinary_general_one(self):
        v, why = engine.choose_variant(triage_answer(margin=None), "a call")
        self.assertEqual(v, "general")
        self.assertIn("margin not", why)

    def test_a_gross_margin_is_no_margin(self):
        self.assertEqual(engine.choose_variant(triage_answer(is_net=False), "a call")[0], "general")

    def test_no_figures_at_all_is_still_general(self):
        v, why = engine.choose_variant(triage_answer(value=None, margin=None), "a call")
        self.assertEqual((v, why), ("general", "no average project value either"))

    def test_an_unread_call_or_no_call_is_blind(self):
        self.assertEqual(engine.choose_variant(None, "a call"), ("blind", "the call could not be read"))
        self.assertEqual(engine.choose_variant(triage_answer(), ""), ("blind", "no recording"))


# ---------------------------------------------------------------------------
class JsonTests(unittest.TestCase):
    DEAL = json.dumps(specific_deal())

    def test_a_bare_object(self):
        self.assertEqual(model.as_json('{"a": 1}'), {"a": 1})

    def test_a_fenced_object(self):
        self.assertEqual(model.as_json('```json\n{"a": 1}\n```'), {"a": 1})

    def test_prose_around_the_object(self):
        out = model.as_json("Here is the deal:\n" + self.DEAL + "\nLet me know.", expect=prompt.is_deal)
        self.assertEqual(out["client_company"], "Mirage Test Contracting")

    def test_thinking_out_loud_before_the_answer(self):
        text = "<think>First {draft} the tree, then {the cost}.</think>\n" + self.DEAL
        self.assertEqual(model.as_json(text, expect=prompt.is_deal)["reference"], "MM-2099-0101-TST")

    def test_an_unclosed_think_block(self):
        self.assertEqual(model.as_json('<think>let me see {x} ' + '{"a": 2}'), {"a": 2})

    def test_braces_inside_strings_do_not_mislead_it(self):
        text = 'Sure. {"note": "a } and a { inside", "n": 3} and a stray } after'
        self.assertEqual(model.as_json(text), {"note": "a } and a { inside", "n": 3})

    def test_an_empty_answer_takes_the_json_from_the_reasoning(self):
        reasoning = 'I will answer {"draft": 1} no wait ' + json.dumps(triage_answer())
        out = model.as_json("", reasoning, expect=prompt.is_triage)
        self.assertIn("avg_project_value", out)

    def test_a_reply_cut_short_is_never_taken_for_a_deal(self):
        cut = self.DEAL[: len(self.DEAL) // 2]
        with self.assertRaises(model.NoJSON):
            model.as_json(cut, expect=prompt.is_deal)

    def test_nothing_at_all(self):
        with self.assertRaises(model.NoJSON):
            model.as_json("I could not do that.")


class StreamTests(unittest.TestCase):
    def test_openai_chunks_keepalives_and_done(self):
        lines = [
            b": OPENROUTER PROCESSING\n", b"\n",
            b'data: {"model":"gpt-x","choices":[{"delta":{"reasoning":"thinking "}}]}\n', b"\n",
            b'data: {"choices":[{"delta":{"content":"{\\"a\\": "}}]}\n', b"\n",
            b'data: {"choices":[{"delta":{"content":"1}"},"finish_reason":"stop"}],"usage":{"total_tokens":9}}\n', b"\n",
            b"data: [DONE]\n", b"\n",
        ]
        r = model.read_openai_stream(lines)
        self.assertEqual((r.text, r.reasoning, r.finish, r.model), ('{"a": 1}', "thinking ", "stop", "gpt-x"))
        self.assertEqual(r.usage["total_tokens"], 9)

    def test_an_error_mid_stream_is_a_failed_try(self):
        with self.assertRaises(model.ModelError):
            model.read_openai_stream([b'data: {"error":{"message":"overloaded"}}\n', b"\n"])

    def test_anthropic_text_thinking_and_a_refusal(self):
        lines = [
            b"event: message_start\n", b'data: {"type":"message_start","message":{"model":"claude-x","usage":{"input_tokens":5}}}\n', b"\n",
            b"event: content_block_delta\n", b'data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"hm"}}\n', b"\n",
            b"event: content_block_delta\n", b'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"{}"}}\n', b"\n",
            b"event: message_delta\n", b'data: {"type":"message_delta","delta":{"stop_reason":"refusal"},"usage":{"output_tokens":2}}\n', b"\n",
        ]
        r = model.read_anthropic_stream(lines)
        self.assertEqual((r.text, r.reasoning, r.finish, r.model), ("{}", "hm", "refusal", "claude-x"))
        self.assertTrue(r.refusal)

    def test_a_fallback_discards_what_the_declining_model_wrote(self):
        lines = [
            b'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"{\\"partial\\""}}\n', b"\n",
            b'data: {"type":"content_block_start","content_block":{"type":"fallback"}}\n', b"\n",
            b'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"{\\"ok\\": true}"}}\n', b"\n",
            b'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n', b"\n",
        ]
        self.assertEqual(model.read_anthropic_stream(lines).text, '{"ok": true}')


class ProviderTests(unittest.TestCase):
    def cfg(self, provider: str = "openai", model_name: str = "") -> Config:
        c = cfg_in(tempfile.mkdtemp())
        c.provider = provider
        c.model = model_name or model.DEFAULT_MODELS[provider]
        return c

    def test_openai_is_the_default_and_gpt5_takes_no_temperature(self):
        with mock.patch.dict(os.environ, {"OPENAI_API_KEY": "sk-test-000000"}):
            p = model.provider(self.cfg())
        self.assertEqual((p.name, p.model), ("openai", "gpt-5"))
        body = p._body("s", "u", temperature=0.3, stream=True)
        self.assertNotIn("temperature", body)
        self.assertEqual(body["response_format"], {"type": "json_object"})
        self.assertTrue(body["stream"])

    def test_a_non_reasoning_model_keeps_its_temperature(self):
        with mock.patch.dict(os.environ, {"OPENAI_API_KEY": "sk-test-000000"}):
            p = model.provider(self.cfg(model_name="gpt-4.1"))
        self.assertEqual(p._body("s", "u", temperature=0, stream=False)["temperature"], 0)

    def test_a_missing_key_is_one_plain_sentence(self):
        with self.assertRaises(model.ModelUnreachable) as e:
            model.provider(self.cfg("anthropic"))
        self.assertIn("ANTHROPIC_API_KEY is not set", str(e.exception))
        self.assertIn("SALES_MODEL_PROVIDER back to openai", str(e.exception))

    def test_deepseek_is_refused_by_name_and_by_model(self):
        with self.assertRaises(model.ModelUnreachable):
            model.provider(self.cfg("openai", "deepseek-chat"))
        c = self.cfg("openrouter", "deepseek/deepseek-r1")
        with mock.patch.dict(os.environ, {"OPENROUTER_API_KEY": "or-test"}), self.assertRaises(model.ModelUnreachable):
            model.provider(c)
        c.provider = "deepseek"
        with self.assertRaises(model.ModelUnreachable):
            model.provider(c)

    def test_an_unverified_org_is_asked_again_without_streaming(self):
        p = model.OpenAIShaped("openai", model.OPENAI_URL, "sk-test-000000", "gpt-5")
        refused = http.HttpError(400, "stream", b'{"error":{"message":"Your organization must be verified to stream this model.","param":"stream"}}')
        answer = json.dumps({"model": "gpt-5-x", "choices": [{"message": {"content": '{"ok": 1}'}, "finish_reason": "stop"}]}).encode()
        with mock.patch.object(http, "open_stream", side_effect=refused), \
                mock.patch.object(http, "request", return_value=(200, {}, answer)) as req:
            r = p.complete("s", "u")
        self.assertEqual(r.text, '{"ok": 1}')
        self.assertFalse(p.stream_ok)
        self.assertFalse(req.call_args.kwargs["json_body"]["stream"])

    def test_a_refused_key_is_an_outage_and_a_429_is_a_try(self):
        p = model.OpenAIShaped("openai", model.OPENAI_URL, "sk-test-000000", "gpt-5")
        with mock.patch.object(http, "open_stream", side_effect=http.HttpError(401, "bad key", b"{}")):
            with self.assertRaises(model.ModelUnreachable):
                p.complete("s", "u")
        with mock.patch.object(http, "open_stream", side_effect=http.HttpError(429, "slow down", b"{}")):
            with self.assertRaises(model.ModelError):
                p.complete("s", "u")

    def test_call_json_asks_again_after_a_garbled_answer(self):
        p = FakeProvider(["not json at all", json.dumps(triage_answer())])
        out, _ = model.call_json(p, "s", "u", temperature=0, attempts=2, timeout=5, expect=prompt.is_triage,
                                 log=lambda _m: None, what="triage", pause=0)
        self.assertIn("net_margin", out)
        self.assertEqual(len(p.calls), 2)

    def test_an_outage_is_never_asked_again(self):
        p = FakeProvider([model.ModelUnreachable("no key"), "unused"])
        with self.assertRaises(NotNow):
            model.call_json(p, "s", "u", temperature=0, attempts=3, timeout=5, expect=prompt.is_triage,
                            log=lambda _m: None, what="triage", pause=0)
        self.assertEqual(len(p.calls), 1)

    def test_a_reasoning_model_that_answers_only_in_its_reasoning(self):
        p = FakeProvider([model.Reply(text="", reasoning="so: " + json.dumps(triage_answer()), finish="stop")])
        out, _ = model.call_json(p, "s", "u", temperature=0, attempts=1, timeout=5, expect=prompt.is_triage,
                                 log=lambda _m: None, what="triage", pause=0)
        self.assertTrue(out["avg_project_value"]["stated"])

    def test_scrub_hides_keys(self):
        text = http.scrub("Incorrect API key provided: sk-proj-abcdef123456. Bearer abc.def apikey=zzz")
        self.assertNotIn("abcdef123456", text)
        self.assertNotIn("zzz", text)
        self.assertNotIn("abc.def", text)


# ---------------------------------------------------------------------------
class OfferTests(unittest.TestCase):
    def test_the_default_is_paid_in_full_without_a_guarantee(self):
        r = resolved()
        self.assertEqual((r["price"], r["months"], r["payment"], r["guarantee"]), (6000, 3, "pif", False))
        self.assertEqual([i["amount"] for i in r["instalments"]], [6000])

    def test_a_plan_adds_up_to_the_price_whatever_the_price(self):
        self.assertEqual([i["amount"] for i in resolved({"payment": "two_payments"})["instalments"]], [3000, 3000])
        self.assertEqual([i["amount"] for i in resolved({"payment": "two_payments", "price": 7500})["instalments"]],
                         [3750, 3750])
        monthly = resolved({"payment": "monthly", "price": 7000})["instalments"]
        self.assertEqual([i["amount"] for i in monthly], [2334, 2333, 2333])
        self.assertEqual(sum(i["amount"] for i in monthly), 7000)
        self.assertEqual([i["due_days"] for i in monthly], [0, 30, 60])
        self.assertEqual(len(resolved({"payment": "monthly", "months": 6})["instalments"]), 6)

    def test_fixed_amounts_that_miss_the_price_are_refused(self):
        with self.assertRaises(offer.OfferError) as e:
            resolved({"payment": "fixed"})
        self.assertIn("adds up to USD 5,500, not the price of USD 6,000", str(e.exception))

    def test_a_choice_that_does_not_exist_says_what_does(self):
        with self.assertRaises(offer.OfferError) as e:
            resolved({"payment": "weekly"})
        self.assertIn("Choose one of: pif, two_payments, monthly, fixed", str(e.exception))
        with self.assertRaises(offer.OfferError):
            resolved({"guarantee": "maybe"})
        with self.assertRaises(offer.OfferError):
            resolved({"price": "a lot"})

    def test_the_guarantee_is_written_from_the_program_and_the_term(self):
        self.assertEqual(resolved({"guarantee": True})["guarantee_text"],
                         "30 qualified appointments in 90 days, or we work for free until we deliver.")
        self.assertIn("180 days", resolved({"guarantee": True, "months": 6})["guarantee_text"])
        self.assertIsNone(resolved({"guarantee": False})["guarantee_text"])

    def test_the_prompt_block_carries_exactly_the_choice(self):
        pif = offer.prompt_block(resolved())
        self.assertIn("Print no split", pif)
        self.assertIn("Guarantee: none on this proposal", pif)
        plan = offer.prompt_block(resolved({"payment": "two_payments", "guarantee": True}))
        self.assertIn("USD 3,000 at the start; USD 3,000 45 days after the start", plan)
        self.assertIn("or we work for free until we deliver.", plan)
        self.assertNotIn("—", pif + plan)

    def test_a_stamp_reads_back_as_the_same_offer(self):
        r = resolved({"payment": "two_payments", "price": 7500, "guarantee": True})
        back = offer.from_deal({"offer": offer.stamp(r)}, TEST_OFFER)
        for k in ("price", "months", "payment", "guarantee", "deposit"):
            self.assertEqual(back[k], r[k])
        self.assertEqual([i["amount"] for i in back["instalments"]], [3750, 3750])

    def test_the_real_offer_json_reads_and_every_option_resolves(self):
        real = offer.load()
        for key in real["payment"]["options"]:
            r = offer.resolve(real, {"payment": key})
            self.assertEqual(sum(i["amount"] for i in r["instalments"]), r["price"])
        self.assertNotIn("—", real["guarantee"]["text"])


# ---------------------------------------------------------------------------
class ValidatorTests(unittest.TestCase):
    def test_a_good_specific_deal_passes_both_gates(self):
        r = check(specific_deal())
        self.assertEqual(r.errors(), [])
        self.assertEqual(r.status(), "ready")
        self.assertAlmostEqual(r.fee_band_pct, 19.886, places=2)
        self.assertEqual(r.fills, 0)

    def test_a_good_general_deal_passes(self):
        r = check(general_deal())
        self.assertEqual(r.errors(), [])
        self.assertTrue(any("row(s) under one project" in x["detail"] for x in r.rows if x["check"] == "arithmetic"))

    def test_a_good_blind_deal_states_nothing_about_the_client(self):
        r = check(blind_deal(), text=None)
        self.assertEqual(r.errors(), [])
        self.assertEqual(r.expected_sheets, 5)

    def test_a_bad_deal_fails_where_it_is_bad(self):
        deal = specific_deal(headline="We add SAR 999,999 a year — guaranteed", quotes=[{"en": "x"}])
        deal.pop("proof")
        deal["cost"]["layers"][1]["monthly"] = 500000
        r = check(deal)
        self.assertEqual(r.status(), "failed")
        self.assertTrue(failing(r, "brand"))
        self.assertTrue(any("999,999" in x for x in failing(r, "prose")))
        self.assertTrue(failing(r, "quotes"))
        self.assertTrue(any("proof" in x for x in failing(r, "schema")))
        self.assertTrue(any("below 10%" in x for x in failing(r, "fee band")))
        self.assertTrue(any("500,000" in x for x in failing(r, "evidence")))

    def test_a_general_deal_may_not_carry_a_margin(self):
        deal = general_deal()
        deal["roi"]["margin_pct"] = 18
        self.assertTrue(failing(check(deal), "general"))

    def test_a_blind_deal_may_not_carry_a_funnel(self):
        deal = blind_deal(funnel=specific_deal()["funnel"])
        self.assertTrue(failing(check(deal, text=None), "blind"))

    def test_fill_is_counted_and_named_and_leaves_the_draft_usable(self):
        deal = specific_deal()
        deal["cost"]["close"] = "FILL"
        deal["client_role"] = "FILL"
        r = check(deal)
        self.assertEqual(r.fills, 2)
        self.assertEqual(sorted(r.fill_fields), ["client_role", "cost.close"])
        self.assertTrue(r.ok)
        self.assertEqual(r.status(), "needs_input")

    def test_a_blank_is_named_the_way_the_cockpit_fills_it(self):
        deal = specific_deal()
        deal["investment"]["rows"][3]["amount"] = "FILL"
        deal["terms"][1] = "The ad account is yours from day FILL."
        r = check(deal)
        self.assertEqual(r.fill_fields, ["investment.rows.3.amount", "terms.1"])

    def test_a_missing_company_is_a_gap_for_the_closer_not_a_failed_draft(self):
        r = check(specific_deal(client_company="FILL"))
        self.assertEqual(r.status(), "needs_input")
        self.assertEqual(r.errors(), [])
        self.assertTrue(any(w.startswith("identity") for w in r.warnings()))

    def test_an_expired_date_fails_only_the_send_gate(self):
        r = check(specific_deal(valid_until="1 January 2000"))
        self.assertTrue(r.ok)
        self.assertFalse(r.send_ready)
        self.assertEqual(r.status(), "needs_input")

    def test_an_arabic_date_and_arabic_digits_are_read(self):
        r = check(specific_deal(valid_until="15 يناير 2099"))
        self.assertTrue(any(x["status"] == "PASS" for x in r.rows if x["check"] == "dates"))
        said = validate.transcript_numbers("متوسط المشروع "
                                           "٤٥٠٬٠٠٠ وثمانية")
        self.assertIn(450000, said)
        self.assertIn(8, said)

    def test_the_render_check_reads_the_rendered_page(self):
        over = check(specific_deal(), renderer=FakeRenderer(over=[[4]]))
        self.assertTrue(any("overflow" in x for x in failing(over, "render")))
        skipped = check(specific_deal(), dom=False)
        self.assertTrue(warning(skipped, "render"))
        self.assertEqual(skipped.status(), "ready")

    def test_machine_values_are_not_prose(self):
        self.assertTrue(validate.MACHINE_VALUE.match("/assets/logo.png"))
        self.assertTrue(validate.MACHINE_VALUE.match("MM-2099-0101-TST"))
        self.assertTrue(validate.MACHINE_VALUE.match("fahad@mirage-test.example"))
        self.assertFalse(validate.MACHINE_VALUE.match("general"))

    def test_an_english_line_in_an_arabic_document_is_flagged(self):
        deal = specific_deal(lang="ar")
        self.assertTrue(warning(check(deal), "language"))


class OfferCheckTests(unittest.TestCase):
    def plan_deal(self, choice: dict[str, Any], rows: list[str], total: str) -> dict[str, Any]:
        deal = with_offer(specific_deal(), choice)
        r = resolved(choice)
        deal["roi"]["fee_usd"] = r["price"]
        deal["investment"]["rows"][0]["amount"] = offer.money(r["price"])
        deal["investment"]["rows"][1] = {"item": "Payment structure", "detail": rows[0], "amount": rows[1]}
        deal["investment"]["total_amount"] = total
        return deal

    def test_paid_in_full_with_a_split_printed_fails(self):
        deal = specific_deal()
        deal["investment"]["rows"][1]["amount"] = "2 x USD 3,000"
        r = check(deal)
        self.assertTrue(any("chose payment in full" in x for x in failing(r, "offer")))
        self.assertTrue(any("3,000" in x for x in warning(r, "offer")))

    def test_the_chosen_plan_printed_right_passes(self):
        deal = self.plan_deal({"payment": "two_payments"},
                              ["USD 3,000 at the start and USD 3,000 45 days after the start.", "2 x USD 3,000"],
                              "USD 3,000")
        r = check(deal)
        self.assertEqual(failing(r, "offer"), [])
        self.assertEqual(r.status(), "ready")

    def test_a_plan_that_does_not_add_up_fails(self):
        deal = self.plan_deal({"payment": "two_payments"},
                              ["Two payments after the deposit.", "2 x USD 2,500"], "USD 2,500")
        fails = failing(check(deal), "offer")
        self.assertTrue(any("adds up to 5,000" in x for x in fails))
        self.assertTrue(any("not printed: USD 3,000" in x for x in fails))

    def test_a_price_the_closer_set_is_the_price_checked(self):
        deal = self.plan_deal({"payment": "two_payments", "price": 7500},
                              ["USD 3,750 at the start and USD 3,750 45 days after the start.", "2 x USD 3,750"],
                              "USD 3,750")
        self.assertEqual(failing(check(deal), "offer"), [])
        deal["roi"]["fee_usd"] = 6000
        self.assertTrue(any("roi.fee_usd" in x for x in failing(check(deal), "offer")))

    def test_advertising_must_be_its_own_line(self):
        deal = specific_deal()
        deal["investment"]["rows"].pop(2)
        self.assertTrue(any("advertising" in x for x in failing(check(deal), "offer")))

    def test_a_deposit_that_is_not_the_offer_fails(self):
        self.assertTrue(any("deposit" in x for x in failing(check(specific_deal(deposit_amount="USD 900")), "offer")))

    def test_the_guarantee_when_chosen_and_when_not(self):
        on = with_offer(specific_deal(), {"guarantee": True})
        on["terms"].append(fakes.GUARANTEE)
        self.assertEqual([x["status"] for x in check(on).rows if x["check"] == "guarantee"], ["PASS"])

        missing = with_offer(specific_deal(), {"guarantee": True})
        self.assertTrue(warning(check(missing), "guarantee"))

        unchosen = specific_deal()
        unchosen["terms"].append(fakes.GUARANTEE)
        self.assertTrue(failing(check(unchosen), "guarantee"))

        just_the_word = specific_deal()
        just_the_word["terms"].append("We do not guarantee revenue, only meetings booked and attended.")
        r = check(just_the_word)
        self.assertFalse(failing(r, "guarantee"))
        self.assertTrue(warning(r, "guarantee"))

    def test_an_arabic_promise_of_free_work_is_caught(self):
        deal = specific_deal()
        deal["terms"].append("إذا ما وصلنا نستمر "
                             "بالشغل مجاناً")
        self.assertTrue(failing(check(deal), "guarantee"))


# ---------------------------------------------------------------------------
class BuildTests(unittest.TestCase):
    def test_the_deal_goes_into_the_template_and_comes_back_out(self):
        deal = specific_deal(subhead="Nothing can close the script: </script><b>x</b>")
        html = build.html(deal)
        self.assertNotIn("</script><b>x</b>", html)
        back = build.data_of(html)
        self.assertEqual(back["subhead"], deal["subhead"])
        self.assertTrue(back["logo"].startswith("data:image/png;base64,"))
        self.assertEqual(back["client_company"], "Mirage Test Contracting")
        self.assertEqual(html.count("/* @data-start */"), 1)

    def test_only_our_own_assets_are_ever_inlined(self):
        out = build.inline_images({"a": "../../../../etc/hosts.png", "b": "/etc/passwd.png", "c": "assets/mahara-logo.png"})
        self.assertEqual(out["a"], "../../../../etc/hosts.png")
        self.assertEqual(out["b"], "/etc/passwd.png")
        self.assertTrue(out["c"].startswith("data:image/png"))


class ExtractReferenceTests(unittest.TestCase):
    def test_a_built_document(self):
        deal = general_deal(quotes=[{"en": "x", "ar": "y", "who": "z"}])
        clean, notes = extract_reference.clean(extract_reference.extract(build.html(deal)))
        self.assertNotIn("quotes", clean)
        self.assertIsNone(clean["logo"])
        self.assertEqual(clean["variant"], "general")
        self.assertTrue(any("quotes" in n for n in notes))

    def test_the_template_s_own_javascript_object(self):
        deal = extract_reference.extract(build.TEMPLATE.read_text(encoding="utf-8"))
        self.assertEqual(len(deal["funnel"]["stages"]), 4)
        self.assertEqual(deal["solution"][0]["problem"], "Slow first contact")

    def test_comments_single_quotes_and_trailing_commas(self):
        src = "/* @data-start */ const PROPOSAL = { a: 'it\\'s', // note\n b: [1, 2,], c: {d: \"x\",}, }; /* @data-end */"
        self.assertEqual(extract_reference.extract(src), {"a": "it's", "b": [1, 2], "c": {"d": "x"}})


# ---------------------------------------------------------------------------
class PromptTests(unittest.TestCase):
    def test_the_system_prompt_carries_the_offer_and_no_loose_token(self):
        s = prompt.system_for("general", resolved({"payment": "two_payments"}), TEST_OFFER, None, None)
        self.assertNotIn("{{", s)
        self.assertIn("USD 3,000 at the start; USD 3,000 45 days after the start", s)
        self.assertIn("75 qualified enquiries a month", s)
        self.assertIn("There is no reference deal on this machine", s)

    def test_a_reference_teaches_the_shape_and_not_the_identity(self):
        ref = general_deal(quotes=[{"en": "x"}], logo="data:image/png;base64,AAAA")
        ref["roi"]["margin_pct"] = 12
        shape = prompt.shape_of(ref)
        self.assertNotIn("quotes", shape)
        self.assertEqual(shape["logo"], prompt.LOGO)
        self.assertIn("never FILL", shape["client_company"])
        self.assertEqual(shape["roi"]["margin_pct"], 0)
        s = prompt.system_for("general", resolved(), TEST_OFFER, ref, {"file": "general.json", "variant": "general", "matched": True})
        self.assertIn("The exact shape to return, for the general variant", s)
        self.assertNotIn("Mirage Test Contracting", s)

    def test_a_reference_of_another_variant_says_so(self):
        s = prompt.system_for("specific", resolved(), TEST_OFFER, general_deal(),
                              {"file": "general.json", "variant": "general", "matched": False})
        self.assertIn("There is no specific reference on this machine", s)

    def test_references_are_found_by_variant(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "a.json").write_text(json.dumps(general_deal()), encoding="utf-8")
            (Path(tmp) / "specific.json").write_text(json.dumps(specific_deal()), encoding="utf-8")
            _d, info = prompt.load_reference(Path(tmp), "general", lambda _m: None)
            self.assertEqual((info["file"], info["matched"]), ("a.json", True))
            _d, info = prompt.load_reference(Path(tmp), "blind", lambda _m: None)
            self.assertFalse(info["matched"])
            self.assertEqual(prompt.load_reference(Path(tmp) / "none", "general", lambda _m: None), (None, None))

    def test_an_unknown_token_is_an_error(self):
        with self.assertRaises(ValueError):
            prompt.render("{{nope}}", {})

    def test_the_tighten_message_names_the_sheet_and_its_blocks(self):
        text = prompt.tighten_user({"a": 1}, [4])
        self.assertIn("sheet 4 overflows", text)
        self.assertIn("arithmetic, cost", text)


# ---------------------------------------------------------------------------
class EngineTests(unittest.TestCase):
    def run_engine(self, replies: list[Any], over: list[list[int]], **kw: Any) -> tuple[engine.Outcome, FakeProvider]:
        tmp = tempfile.mkdtemp()
        cfg = cfg_in(tmp)
        p = FakeProvider(replies)
        call = engine.Call(transcript_text=transcript(), client_company="Mirage Test Contracting")
        out = engine.run(call, lang="en", resolved=resolved(), offer=TEST_OFFER, p=p, cfg=cfg, log=lambda _m: None,
                         workdir=Path(tmp) / "work", renderer=FakeRenderer(over=over), **kw)
        return out, p

    def test_an_overflowing_sheet_is_handed_back_until_it_fits(self):
        tighter = specific_deal(subhead="Shorter.")
        out, p = self.run_engine([triage_answer(), specific_deal(), tighter], over=[[4], []])
        self.assertEqual((out.rounds, out.overflow_first, out.overflow_last), (1, [4], []))
        self.assertEqual(out.deal["subhead"], "Shorter.")
        self.assertIn("sheet 4 overflows", p.calls[2]["user"])
        self.assertEqual(p.calls[2]["temperature"], 0.2)
        self.assertEqual((p.calls[0]["temperature"], p.calls[1]["temperature"]), (0, 0.3))
        self.assertEqual(out.result.status(), "ready")

    def test_a_round_that_does_not_help_keeps_the_best_draft(self):
        out, _ = self.run_engine([triage_answer(), specific_deal(), specific_deal(subhead="Worse.")], over=[[4], [4, 5]])
        self.assertEqual(out.rounds, 1)
        self.assertNotEqual(out.deal["subhead"], "Worse.")
        self.assertEqual(out.overflow_last, [4])
        self.assertTrue(failing(out.result, "render"))

    def test_rounds_continue_while_each_one_helps(self):
        out, _ = self.run_engine([triage_answer(), specific_deal(), specific_deal(), specific_deal()],
                                 over=[[4, 5], [4], []])
        self.assertEqual((out.rounds, out.overflow_last), (2, []))

    def test_the_file_says_what_code_decided(self):
        out, p = self.run_engine([triage_answer(margin=None), general_deal(variant="specific", lang="ar")], over=[[]])
        self.assertEqual(out.variant, "general")
        self.assertEqual(out.deal["variant"], "general")
        self.assertEqual(out.deal["lang"], "en")
        self.assertEqual(out.deal["offer"]["payment"], "pif")
        self.assertEqual(out.deal["logo"], prompt.LOGO)
        self.assertIn("Write the general variant", p.calls[1]["user"])
        self.assertIn("No reference deal on this machine", out.notes[0])

    def test_an_unreadable_triage_drafts_the_blind_one(self):
        out, p = self.run_engine(["garbled", "garbled", blind_deal()], over=[[]])
        self.assertEqual(out.variant, "blind")
        self.assertIn("Write the blind variant", p.calls[2]["user"])


# ---------------------------------------------------------------------------
class RecordingTests(unittest.TestCase):
    LEADS = {"fahad@mirage-test.example": {"contact_id": "c-1", "email": "Fahad@Mirage-Test.example"}}
    APPTS = [
        {"appointment_id": "a-1", "contact_id": "c-1", "call_type": "demo", "start_at": "2099-01-01T10:05:00Z",
         "assigned_user_id": "u-rep"},
        {"appointment_id": "a-2", "contact_id": "c-2", "call_type": "demo", "start_at": "2099-01-01T12:00:00Z",
         "assigned_user_id": "u-other"},
        {"appointment_id": "a-3", "contact_id": "c-3", "call_type": "demo", "start_at": "2099-01-01T12:10:00Z",
         "assigned_user_id": "u-rep"},
    ]

    def test_an_invitee_email_matches_its_lead_in_any_case(self):
        m = fakes.meeting("1", start="2099-01-01T10:00:00Z", invitees=[
            {"email": "rep.one@maharamedia.com", "is_external": False},
            {"email": "FAHAD@mirage-test.example", "is_external": True}])
        self.assertEqual(recordings.match(m, leads=self.LEADS, appointments=self.APPTS), ("c-1", "a-1", "email"))

    def test_an_appointment_within_half_an_hour_matches_and_one_further_does_not(self):
        m = fakes.meeting("2", start="2099-01-01T10:25:00Z")
        self.assertEqual(recordings.match(m, leads={}, appointments=self.APPTS), ("c-1", "a-1", "appointment"))
        far = fakes.meeting("3", start="2099-01-01T10:45:00Z")
        self.assertEqual(recordings.match(far, leads={}, appointments=self.APPTS)[2], "none")

    def test_two_leads_at_once_match_nobody_unless_the_rep_settles_it(self):
        m = fakes.meeting("4", start="2099-01-01T12:05:00Z")
        self.assertEqual(recordings.match(m, leads={}, appointments=self.APPTS)[2], "none")
        self.assertEqual(recordings.match(m, leads={}, appointments=self.APPTS, rep_user_ids=["u-rep"]),
                         ("c-3", "a-3", "appointment"))

    def test_the_index_asks_per_rep_skips_what_is_not_sales_and_keeps_earlier_matches(self):
        pg = FakePostgrest()
        pg.put("cockpit_sales_people", {"email": "rep.one@maharamedia.com", "name": "Rep One",
                                        "fathom_email": "rep.one@maharamedia.com", "ghl_user_id": "u-rep"})
        pg.put("cockpit_sales_leads", {"contact_id": "c-1", "email": "Fahad@Mirage-Test.example"})
        pg.put("cockpit_sales_appointments", {"appointment_id": "a-9", "contact_id": "c-9", "call_type": "intro",
                                              "start_at": "2099-01-02T09:00:00Z", "assigned_user_id": "u-rep"})
        pg.put("cockpit_sales_recordings", {"recording_id": "5", "contact_id": "c-7", "appointment_id": None,
                                            "matched_by": "email"})
        now = datetime.now(timezone.utc).replace(microsecond=0)
        at = lambda h: (now - timedelta(hours=h)).isoformat().replace("+00:00", "Z")  # noqa: E731
        f = FakeFathom(meetings={
            None: [fakes.meeting("1", start=at(5), invitees=[{"email": "fahad@mirage-test.example", "is_external": True}]),
                   fakes.meeting("2", start=at(6), title="Client onboarding call",
                                 invitees=[{"email": "someone@else.example", "is_external": True}])],
            "rep.one@maharamedia.com": [
                fakes.meeting("3", start=at(7)),  # nobody from outside, no appointment: a team meeting
                fakes.meeting("5", start=at(8), invitees=[{"email": "gone@nowhere.example", "is_external": True}]),
                fakes.meeting("1", start=at(5))],
        })
        sb = Supabase("https://example.supabase.co", "service-test")
        with mock.patch.object(http, "request", pg):
            out = recordings.index(sb, f, lambda _m: None, days=14)
        self.assertEqual(f.asked, [None, "rep.one@maharamedia.com"])
        self.assertEqual((out["seen"], out["not_sales"], out["team"], out["indexed"]), (4, 1, 1, 2))
        self.assertEqual(pg.one("cockpit_sales_recordings", recording_id="1")["matched_by"], "email")
        self.assertEqual(pg.one("cockpit_sales_recordings", recording_id="1")["contact_id"], "c-1")
        kept = pg.one("cockpit_sales_recordings", recording_id="5")
        self.assertEqual((kept["contact_id"], kept["matched_by"]), ("c-7", "email"))
        self.assertIsNone(pg.one("cockpit_sales_recordings", recording_id="3"))

    def test_the_newest_long_enough_recording_is_picked(self):
        pg = FakePostgrest()
        pg.put("cockpit_sales_recordings", {"recording_id": "10", "contact_id": "c-1", "started_at": "2099-01-03T10:00:00Z"})
        pg.put("cockpit_sales_recordings", {"recording_id": "11", "contact_id": "c-1", "started_at": "2099-01-02T10:00:00Z"})
        f = FakeFathom(transcripts={"10": fakes.fathom_turns("Rep: short call"), "11": fakes.fathom_turns(transcript())})
        sb = Supabase("https://example.supabase.co", "service-test")
        with mock.patch.object(http, "request", pg):
            picked = recordings.pick(sb, f, lambda _m: None, contact_id="c-1", min_chars=5000)
        self.assertEqual(picked.recording["recording_id"], "11")
        self.assertEqual(f.read, ["10", "11"])

    def test_no_recording_is_one_sentence_the_closer_can_act_on(self):
        pg = FakePostgrest()
        sb = Supabase("https://example.supabase.co", "service-test")
        looked = []
        with mock.patch.object(http, "request", pg), self.assertRaises(Refused) as e:
            recordings.pick(sb, FakeFathom(), lambda _m: None, contact_id="c-1", reindex=lambda: looked.append(1))
        self.assertEqual(str(e.exception), recordings.NO_RECORDING)
        self.assertEqual(looked, [1])

    def test_filler_turns_are_dropped_but_never_a_number(self):
        text = fathom.flatten([{"speaker": {"display_name": "A"}, "text": "OK"},
                               {"speaker": {"display_name": "B"}, "text": "ok 5"},
                               {"speaker": {"display_name": "B"}, "text": "We sign two a month."}])
        self.assertEqual(text, "B: ok 5\nB: We sign two a month.")


# ---------------------------------------------------------------------------
class QueueTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.cfg = cfg_in(self.tmp)
        self.pg = FakePostgrest()
        self.sb = Supabase(self.cfg.supabase_url, self.cfg.supabase_key)
        self.patch = mock.patch.object(http, "request", self.pg)
        self.patch.start()
        self.addCleanup(self.patch.stop)
        self.pg.put("cockpit_sales_leads", {"contact_id": "c-1", "name": "Fahad Sample", "email": "fahad@mirage-test.example",
                                            "company": "Mirage Test Contracting", "country": "Saudi Arabia"})
        self.pg.put("cockpit_sales_people", {"email": "rep.one@maharamedia.com", "name": "Rep One",
                                             "fathom_email": "rep.one@maharamedia.com"})
        self.pg.put("cockpit_sales_recordings", {"recording_id": "100", "contact_id": "c-1", "matched_by": "email",
                                                 "recorded_by": "rep.one@maharamedia.com",
                                                 "started_at": "2099-01-01T10:00:00Z"})
        self.fathom = FakeFathom(transcripts={"100": fakes.fathom_turns(transcript())})

    def queue(self, rid: str = "req-1", pid: str = "p-1", params: Any = None, **row: Any) -> None:
        self.pg.put(REQ, {"id": rid, "kind": "proposal", "contact_id": "c-1",
                          "params": params if params is not None else
                          {"lang": "en", "proposal_id": pid, "offer": {"payment": "pif", "guarantee": False}},
                          "status": "queued", "requested_by": "rep.one@maharamedia.com",
                          "requested_at": "2099-01-01T11:00:00Z", "claimed_at": None, "claimed_by": None,
                          "attempts": 0, "finished_at": None, "error": None, "result": None, **row})
        if self.pg.one(PROP, id=pid) is None:
            self.pg.put(PROP, {"id": pid, "request_id": rid, "contact_id": "c-1", "lang": "en", "status": "drafting",
                               "deal": None, "validation": None, "html_path": None, "pdf_path": None,
                               "created_by": "rep.one@maharamedia.com", "created_at": "2099-01-01T11:00:00Z",
                               "updated_at": "2099-01-01T11:00:00Z"})

    def worker(self, provider: Any = None, renderer: Any = None, fathom_client: Any = None) -> queue.Worker:
        return queue.Worker(self.cfg, lambda _m: None, self.sb, host="test-box",
                            provider=provider or fakes.never,
                            fathom=fathom_client or (lambda cfg, log: self.fathom),
                            renderer=renderer or FakeRenderer(), offer=TEST_OFFER)

    def test_a_request_is_claimed_once(self):
        self.queue()
        row = self.pg.one(REQ, id="req-1")
        first = self.sb.claim(dict(row), "box-a")
        second = self.sb.claim(dict(row), "box-b")
        self.assertEqual((first["status"], first["attempts"], first["claimed_by"]), ("running", 1, "box-a"))
        self.assertIsNone(second)
        self.assertEqual(self.pg.one(REQ, id="req-1")["claimed_by"], "box-a")

    def test_a_draft_with_gaps_needs_input_and_says_where(self):
        self.queue()
        deal = specific_deal()
        deal["cost"]["close"] = "FILL"
        prov = FakeProvider([triage_answer(), deal])
        out = self.worker(provider=lambda c, l: prov).run()
        self.assertEqual((out["done"], out["statuses"]), (1, {"needs_input": 1}))
        p = self.pg.one(PROP, id="p-1")
        self.assertEqual((p["status"], p["variant"], p["fill_count"]), ("needs_input", "specific", 1))
        self.assertEqual(p["html_path"], "proposals/p-1/v1.html")
        self.assertIsNone(p["pdf_path"])
        self.assertEqual(p["model"], "fake:fake-model-1")
        v = p["validation"]
        self.assertTrue(v["ok"])
        self.assertEqual(v["errors"], [])
        self.assertEqual(v["fills"], ["cost.close"])
        self.assertEqual((v["variant"], v["offer"]["payment"], v["offer"]["guarantee"]), ("specific", "pif", False))
        self.assertIsInstance(v["warnings"], list)
        self.assertEqual(p["deal"]["offer"]["price_usd"], 6000)
        self.assertEqual(self.pg.objects["sales-proposals/proposals/p-1/v1.html"][0], "text/html")
        req = self.pg.one(REQ, id="req-1")
        self.assertEqual((req["status"], req["result"]["status"], req["attempts"]), ("done", "needs_input", 1))
        self.assertIn("USD 6,000", prov.calls[1]["system"])
        self.assertIn("Mirage Test Contracting", prov.calls[1]["user"])

    def test_a_clean_draft_is_ready_with_its_pdf(self):
        self.queue()
        prov = FakeProvider([triage_answer(), specific_deal()])
        self.worker(provider=lambda c, l: prov).run()
        p = self.pg.one(PROP, id="p-1")
        self.assertEqual((p["status"], p["pdf_path"]), ("ready", "proposals/p-1/v1.pdf"))
        self.assertEqual(self.pg.objects["sales-proposals/proposals/p-1/v1.pdf"][0], "application/pdf")

    def test_no_browser_still_gives_the_html_and_says_the_pdf_was_skipped(self):
        self.queue()
        prov = FakeProvider([triage_answer(), specific_deal()])
        self.worker(provider=lambda c, l: prov, renderer=FakeRenderer(works=False, pdf_ok=False)).run()
        p = self.pg.one(PROP, id="p-1")
        self.assertEqual((p["status"], p["html_path"], p["pdf_path"]), ("ready", "proposals/p-1/v1.html", None))
        self.assertTrue(any("The PDF was skipped" in n for n in p["validation"]["notes"]))

    def test_a_lead_with_no_recording_is_told_once_what_to_do(self):
        self.pg.tables["cockpit_sales_recordings"].clear()
        self.queue()
        prov = FakeProvider([])
        out = self.worker(provider=lambda c, l: prov, fathom_client=lambda c, l: FakeFathom()).run()
        self.assertEqual(out["failed"], 1)
        req = self.pg.one(REQ, id="req-1")
        self.assertEqual((req["status"], req["error"]), ("failed", recordings.NO_RECORDING))
        self.assertEqual(self.pg.one(PROP, id="p-1")["status"], "failed")
        self.assertEqual(self.pg.one(PROP, id="p-1")["error"], recordings.NO_RECORDING)
        self.assertEqual(prov.calls, [])

    def test_an_offer_option_that_does_not_exist_is_refused(self):
        self.queue(params={"lang": "en", "proposal_id": "p-1", "offer": {"payment": "weekly"}})
        self.worker(provider=lambda c, l: FakeProvider([])).run()
        req = self.pg.one(REQ, id="req-1")
        self.assertEqual(req["status"], "failed")
        self.assertIn("Choose one of", req["error"])

    def test_a_missing_key_leaves_the_queue_untouched_with_the_reason(self):
        self.queue()

        def no_key(cfg: Any, log: Any) -> Any:
            raise model.ModelUnreachable("OPENAI_API_KEY is not set, so the openai provider cannot draft.")

        out = self.worker(provider=no_key).run()
        req = self.pg.one(REQ, id="req-1")
        self.assertEqual((req["status"], req["attempts"], req["claimed_by"]), ("queued", 0, None))
        self.assertIn("OPENAI_API_KEY is not set", req["error"])
        self.assertIn("OPENAI_API_KEY", out["blocked"])

    def test_a_missing_bucket_blocks_before_anything_is_drafted(self):
        self.queue()
        self.pg.buckets.clear()
        prov = FakeProvider([])
        out = self.worker(provider=lambda c, l: prov).run()
        req = self.pg.one(REQ, id="req-1")
        self.assertEqual((req["status"], req["attempts"]), ("queued", 0))
        self.assertIn("bucket is missing", req["error"])
        self.assertEqual((prov.calls, out["waiting"]), ([], 1))

    def test_a_failed_try_goes_back_in_the_queue_and_the_fourth_is_parked(self):
        self.queue()
        broken = lambda: FakeProvider([triage_answer(), "garbled", "garbled"])  # noqa: E731
        self.worker(provider=lambda c, l, p=broken(): p).run()
        req = self.pg.one(REQ, id="req-1")
        self.assertEqual((req["status"], req["attempts"]), ("queued", 1))
        self.assertIn("draft call failed", req["error"])
        self.assertIn("Try 1 of 4 failed", self.pg.one(PROP, id="p-1")["error"])
        self.assertEqual(self.pg.one(PROP, id="p-1")["status"], "drafting")

        req["attempts"] = 3
        self.worker(provider=lambda c, l, p=broken(): p).run()
        req = self.pg.one(REQ, id="req-1")
        self.assertEqual((req["status"], req["attempts"]), ("failed", 4))
        self.assertEqual(self.pg.one(PROP, id="p-1")["status"], "failed")

    def test_a_run_that_died_is_reaped_and_a_live_one_is_not(self):
        old = (datetime.now(timezone.utc) - timedelta(minutes=45)).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        fresh = (datetime.now(timezone.utc) - timedelta(minutes=5)).replace(microsecond=0).isoformat().replace("+00:00", "Z")
        self.queue("req-1", "p-1", status="running", claimed_at=old, claimed_by="dead-box", attempts=2)
        self.queue("req-2", "p-2", status="running", claimed_at=old, claimed_by="dead-box", attempts=4, error="timed out")
        self.queue("req-3", "p-3", status="running", claimed_at=fresh, claimed_by="live-box", attempts=1)
        self.assertEqual(self.worker().reap(), 2)
        r1, r2, r3 = (self.pg.one(REQ, id=i) for i in ("req-1", "req-2", "req-3"))
        self.assertEqual((r1["status"], r1["claimed_by"], r1["attempts"]), ("queued", None, 2))
        self.assertEqual(r2["status"], "failed")
        self.assertIn("timed out", r2["error"])
        self.assertEqual(self.pg.one(PROP, id="p-2")["status"], "failed")
        self.assertEqual((r3["status"], r3["claimed_by"]), ("running", "live-box"))

    def test_nothing_queued_is_nothing_done(self):
        self.worker().run()  # the first run writes the cockpit's offer setting, once
        self.pg.calls.clear()
        out = self.worker().run()
        self.assertEqual((out["seen"], out["done"], out["reaped"]), (0, 0, 0))
        self.assertEqual(self.pg.writes(), [])

    def test_the_cockpit_offers_exactly_what_offer_json_holds(self):
        self.assertTrue(queue.sync_offer(self.sb, TEST_OFFER, lambda _m: None))
        row = self.pg.one("cockpit_sales_settings", key="offer")
        self.assertEqual([p["key"] for p in row["value"]["payments"]], ["pif", "two_payments", "monthly", "fixed"])
        self.assertEqual(row["value"]["payments"][0]["label"], "Paid in full at the start")
        self.assertEqual(row["value"]["guarantee"]["label"],
                         "Include the guarantee (30 qualified appointments in 90 days, or we work for free until we deliver)")
        self.assertEqual((row["value"]["source"], row["updated_by"]), ("hermes/sales-desk/offer.json", "sales-desk"))
        self.assertFalse(queue.sync_offer(self.sb, TEST_OFFER, lambda _m: None))
        changed = copy.deepcopy(TEST_OFFER)
        changed["payment"]["options"]["pif"]["label"] = "Paid in full"
        self.assertTrue(queue.sync_offer(self.sb, changed, lambda _m: None))
        self.assertEqual(self.pg.one("cockpit_sales_settings", key="offer")["value"]["payments"][0]["label"], "Paid in full")

    def test_the_real_offer_json_gives_the_three_keys_the_cockpit_was_seeded_with(self):
        value = offer.cockpit_setting(offer.load())
        self.assertEqual([p["key"] for p in value["payments"]], ["pif", "two_payments", "monthly"])
        self.assertTrue(value["guarantee"]["label"].startswith("Include the guarantee (30 qualified appointments"))

    # ---- the rebuild after the closer filled the gaps ----
    def filled(self, pid: str = "p-9", choice: Any = None, deal: Any = None, **prop: Any) -> dict[str, Any]:
        deal = deal if deal is not None else with_offer(specific_deal(), choice or {"payment": "pif"})
        row = {"id": pid, "request_id": "req-0", "contact_id": "c-1", "lang": "en", "status": "drafting",
               "variant": "specific", "deal": deal, "validation": {"offer": offer.stamp(resolved(choice))},
               "html_path": f"proposals/{pid}/v1.html", "pdf_path": None, "model": "openai:gpt-5",
               "recording_id": "100", "created_by": "rep.one@maharamedia.com",
               "created_at": "2099-01-01T11:00:00Z", "updated_at": "2099-01-01T11:00:00Z"}
        row.update(prop)
        return self.pg.put(PROP, row)

    def test_a_rebuild_uses_neither_the_model_nor_fathom(self):
        self.filled()
        self.queue("req-5", "p-9", params={"proposal_id": "p-9", "rebuild": True, "lang": "en"})
        out = self.worker(provider=fakes.never, fathom_client=fakes.never).run()
        self.assertEqual(out["done"], 1)
        p = self.pg.one(PROP, id="p-9")
        self.assertEqual((p["status"], p["html_path"], p["pdf_path"]), ("ready", "proposals/p-9/v2.html", "proposals/p-9/v2.pdf"))
        self.assertTrue(p["validation"]["rebuild"])
        self.assertTrue(p["validation"]["ok"])
        self.assertEqual(p["model"], "openai:gpt-5")
        self.assertIn("sales-proposals/proposals/p-9/v2.html", self.pg.objects)
        self.assertEqual(self.pg.one(REQ, id="req-5")["result"]["version"], 2)
        evidence = [r for r in p["validation"]["rows"] if r["check"] == "evidence"]
        self.assertEqual(evidence[0]["status"], "PASS")

    def test_a_rebuild_with_gaps_left_still_needs_input(self):
        deal = with_offer(specific_deal(), {"payment": "pif"})
        deal["client_role"] = "FILL"
        self.filled(deal=deal)
        self.queue("req-5", "p-9", params={"proposal_id": "p-9", "rebuild": True, "lang": "en"})
        self.worker(provider=fakes.never, fathom_client=fakes.never).run()
        p = self.pg.one(PROP, id="p-9")
        self.assertEqual((p["status"], p["fill_count"], p["pdf_path"]), ("needs_input", 1, None))
        self.assertEqual(p["validation"]["fills"], ["client_role"])

    def test_a_rebuild_finds_the_offer_on_the_first_request_when_the_deal_lost_it(self):
        choice = {"payment": "two_payments", "guarantee": False}
        deal = specific_deal()
        deal["investment"]["rows"][1] = {"item": "Payment structure",
                                         "detail": "USD 3,000 at the start and USD 3,000 45 days after the start.",
                                         "amount": "2 x USD 3,000"}
        deal["investment"]["total_amount"] = "USD 3,000"
        self.filled(deal=deal, validation=None)
        self.pg.put(REQ, {"id": "req-0", "kind": "proposal", "contact_id": "c-1", "status": "done",
                          "params": {"lang": "en", "proposal_id": "p-9", "offer": choice},
                          "requested_at": "2099-01-01T10:00:00Z", "attempts": 1})
        self.queue("req-5", "p-9", params={"proposal_id": "p-9", "rebuild": True, "lang": "en"})
        self.worker(provider=fakes.never, fathom_client=fakes.never).run()
        p = self.pg.one(PROP, id="p-9")
        self.assertEqual(p["validation"]["offer"]["payment"], "two_payments")
        self.assertEqual(p["status"], "ready")
        self.assertEqual(p["deal"]["offer"]["instalments_usd"], [3000, 3000])

    def test_a_rebuild_of_a_proposal_never_drafted_is_refused(self):
        self.pg.put(PROP, {"id": "p-8", "request_id": "req-8", "status": "drafting", "deal": None, "lang": "en"})
        self.queue("req-8", "p-8", params={"proposal_id": "p-8", "rebuild": True})
        self.worker().run()
        self.assertEqual(self.pg.one(REQ, id="req-8")["status"], "failed")
        self.assertIn("Draft it first", self.pg.one(PROP, id="p-8")["error"])


# ---------------------------------------------------------------------------
def load_cli():
    spec = importlib.util.spec_from_file_location("desk_cli", ROOT / "desk.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class CliTests(unittest.TestCase):
    def test_doctor_names_each_blocker_in_a_sentence(self):
        cli = load_cli()
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(os.environ, {"SALES_DESK_HOME": tmp}):
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                code = cli.main(["doctor", "--offline"])
        self.assertEqual(code, 1)
        self.assertIn("OPENAI_API_KEY is not set, so the openai provider cannot draft.", buf.getvalue())
        self.assertNotIn("sk-", buf.getvalue())

    def test_requests_is_quiet_when_nothing_is_queued_and_says_so_on_the_status_row(self):
        cli = load_cli()
        pg = FakePostgrest()
        env = {"SALES_DESK_HOME": tempfile.mkdtemp(), "DESK_SUPABASE_URL": "https://example.supabase.co",
               "DESK_SUPABASE_KEY": "service-test"}
        with mock.patch.dict(os.environ, env), mock.patch.object(http, "request", pg):
            buf = io.StringIO()
            with contextlib.redirect_stdout(buf):
                code = cli.main(["--quiet", "requests"])
        self.assertEqual((code, buf.getvalue()), (0, ""))
        row = pg.one("cockpit_sales_worker_status", worker="sales-desk", job="requests")
        self.assertEqual((row["ok"], row["detail"]), (True, "nothing queued"))

    def test_validate_by_hand(self):
        cli = load_cli()
        with tempfile.TemporaryDirectory() as tmp:
            deal_path = Path(tmp) / "deal.json"
            call_path = Path(tmp) / "call.txt"
            deal_path.write_text(json.dumps(with_offer(specific_deal())), encoding="utf-8")
            call_path.write_text(transcript(), encoding="utf-8")
            buf = io.StringIO()
            with mock.patch.dict(os.environ, {"SALES_DESK_HOME": tmp}), contextlib.redirect_stdout(buf):
                code = cli.main(["validate", str(deal_path), "--transcript", str(call_path), "--skip-render", "--send"])
        self.assertEqual(code, 0, buf.getvalue())
        self.assertIn("Ready to send.", buf.getvalue())


if __name__ == "__main__":
    unittest.main()
