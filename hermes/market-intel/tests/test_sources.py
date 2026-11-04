"""The adapters read recorded response shapes, copy only the keys they name, warn on a missing field instead of
crashing, and the two-identifier place rule."""
import unittest
from datetime import datetime, timezone

from mi import discover
from mi.evidence import Draft, Pack
from mi.sources import adlibrary, facebook, handle, instagram, maps, name_match, reviews, serp, snapchat, tiktok, web
from mi.ledger import memory_ledger
from tests import fakes

NOW = datetime(2026, 11, 2, tzinfo=timezone.utc)


class Maps(unittest.TestCase):
    def test_a_place_and_a_missing_field(self):
        p = maps.parse(fakes.fixture("maps_place.json"))[0]
        self.assertEqual((p.name, p.rating, p.reviews_n, p.place_id), ("Cedar Invented Interiors", 4.6, 87, "ChIJcedarInvented"))
        self.assertNotIn("phone", p.facts())
        self.assertNotIn("+965", str(maps.draft(p, "client").body))
        q = maps.parse([{"title": "No Numbers Invented"}])[0]
        self.assertEqual(q.warnings, ["Maps place No Numbers Invented: no rating field",
                                      "Maps place No Numbers Invented: no review count field"])

    def test_two_identifiers_or_not_found(self):
        places = maps.parse(fakes.fixture("maps_search.json"))
        hit, why = maps.identify(places, business_name="Cedar Invented Interiors", website="https://cedar-invented.example",
                                 from_link=False, phone_matches=lambda p: "differs")
        self.assertEqual((hit.place_id, why), ("ChIJcedarInvented", "name and website match"))
        miss, why = maps.identify(places, business_name="Cedar Invented Interiors", website=None, from_link=False,
                                  phone_matches=lambda p: "differs")
        self.assertIsNone(miss)
        self.assertIn("two identifiers are needed", why)
        by_phone, why = maps.identify(places, business_name="Rival One Invented Studio", website=None, from_link=False,
                                      phone_matches=lambda p: "match" if p == "+96522001111" else "differs")
        self.assertEqual(why, "name and phone match")
        self.assertIsNone(maps.identify(places[:2], business_name="x", website=None, from_link=True, phone_matches=None)[0])


class Reviews(unittest.TestCase):
    def test_no_reviewer_is_ever_copied_and_the_header_is_the_second_source(self):
        items, header = reviews.parse(fakes.fixture("reviews.json"))
        self.assertEqual(len(items), 3)
        for r in items:
            self.assertEqual(set(r), {"text", "stars", "date", "lang", "ownerReplied"})
        self.assertEqual(header["rating"], 4.6)
        self.assertEqual(header["reviewsN"], 88)
        self.assertTrue(items[0]["ownerReplied"])
        self.assertFalse(reviews.job_input("https://maps.example/x", 40)["personalData"])
        p = Pack()
        with self.assertRaises(ValueError):
            p.add(Draft(kind="review", subject="client", source="x", body={"text": "ok", "reviewerName": "Someone"}))


class Search(unittest.TestCase):
    def test_organic_ads_and_questions(self):
        page = serp.parse(fakes.fixture("serp.json"))[0]
        self.assertEqual(page["query"], "interior design Hawalli")
        self.assertEqual(len(page["ads"]), 1)
        self.assertEqual(page["peopleAlsoAsk"], ["How much does interior design cost in Kuwait?"])


class Web(unittest.TestCase):
    def test_audit_finds_tags_booking_prices_and_handles(self):
        page = web.audit(fakes.SITE["https://cedar-invented.example"], "https://cedar-invented.example/")
        self.assertTrue(page.tracking["metaPixel"])
        self.assertTrue(page.tracking["gtm"])
        self.assertFalse(page.tracking["ga4"])
        self.assertTrue(page.booking["whatsapp"])
        self.assertIn("KWD 1,500", page.prices)
        self.assertIn("Book a consultation", page.ctas)
        self.assertEqual(web.socials([page]), {"instagram": "cedar.invented", "tiktok": "cedar.invented",
                                               "snapchat": "cedarinvented", "facebook": None})

    def test_robots_txt_is_respected_and_the_crawl_stays_on_the_site(self):
        seen = []
        ledger_rows = []
        from mi.ledger import Ledger
        f = web.Fetcher(Ledger(ledger_rows.append), get=fakes.web_get(seen), resolve=fakes.public_dns)
        self.assertFalse(f.allowed("https://cedar-invented.example/private/x"))
        pages, warns = f.crawl("https://cedar-invented.example", 5)
        self.assertEqual([p.url for p in pages], ["https://cedar-invented.example", "https://cedar-invented.example/services"])
        self.assertTrue(all("instagram.com" not in u for u in seen))
        self.assertTrue(all(r["provider"] == "web" for r in ledger_rows))
        pages, warns = f.crawl("https://gone.example", 3)
        self.assertEqual(pages, [])
        self.assertIn("could not be read directly", warns[0])


class WebAddresses(unittest.TestCase):
    """The fetcher never reads the VPS itself or a private network, however the address arrives."""

    DNS = {"cedar-invented.example": ["93.184.216.34"], "inside.example": ["127.0.0.1"],
           "mixed.example": ["93.184.216.34", "10.0.0.7"], "v6.example": ["::1"], "mapped.example": ["::ffff:127.0.0.1"],
           "meta.example": ["169.254.169.254"], "cgnat.example": ["100.64.0.9"]}

    def resolve(self, host):
        if host not in self.DNS:
            raise OSError("no such host")
        return self.DNS[host]

    def test_only_public_hosts_on_80_and_443(self):
        web.check_url("https://cedar-invented.example/services", self.resolve)
        web.check_url("http://cedar-invented.example:80/", self.resolve)
        for url in ("http://inside.example/", "http://mixed.example/", "http://v6.example/", "http://mapped.example/",
                    "http://meta.example/latest/", "http://cgnat.example/", "http://127.0.0.1/", "http://[::1]/",
                    "http://10.1.2.3/", "http://cedar-invented.example:3456/", "http://cedar-invented.example:8080/",
                    "file:///etc/passwd", "ftp://cedar-invented.example/", "http://nowhere.example/", "http:///x"):
            with self.subTest(url=url), self.assertRaises(web.Blocked):
                web.check_url(url, lambda h: [h] if h[0].isdigit() or ":" in h else self.resolve(h))

    def test_a_blocked_start_page_is_never_fetched_and_says_why(self):
        seen = []
        f = web.Fetcher(memory_ledger()[0], get=fakes.web_get(seen), resolve=self.resolve)
        pages, warns = f.crawl("http://inside.example:80/", 3)
        self.assertEqual((pages, seen), ([], []))
        self.assertIn("points at a private or local address", warns[0])

    def test_every_redirect_is_checked_again(self):
        import urllib.request
        handler = web._PublicRedirect(self.resolve)
        req = urllib.request.Request("https://cedar-invented.example/")
        with self.assertRaises(web.Blocked):
            handler.redirect_request(req, None, 302, "Found", {}, "http://inside.example/admin")
        with self.assertRaises(web.Blocked):
            handler.redirect_request(req, None, 302, "Found", {}, "http://cedar-invented.example:3456/")
        nxt = handler.redirect_request(req, None, 302, "Found", {}, "https://cedar-invented.example/en/")
        self.assertEqual(nxt.full_url, "https://cedar-invented.example/en/")
        opener = web.public_opener(self.resolve)
        self.assertTrue(any(isinstance(h, web._PublicRedirect) for h in opener.handlers))
        self.assertFalse(any(type(h) is urllib.request.HTTPHandler for h in opener.handlers))

    def test_a_connection_that_lands_on_a_private_address_is_refused(self):
        from unittest import mock

        class Sock:
            def __init__(self, ip):
                self.ip = ip

            def getpeername(self):
                return (self.ip, 80)

        for ip, refused in (("127.0.0.1", True), ("10.0.0.7", True), ("93.184.216.34", False)):
            def connect(conn, ip=ip):
                conn.sock = Sock(ip)
            with self.subTest(ip=ip), mock.patch("http.client.HTTPConnection.connect", connect):
                conn = web._PublicHTTPConnection("cedar-invented.example")
                if refused:
                    with self.assertRaises(web.Blocked):
                        conn.connect()
                else:
                    conn.connect()


class Social(unittest.TestCase):
    def test_instagram_facebook_tiktok_snapchat(self):
        ig = instagram.parse(fakes.fixture("instagram.json"), NOW)["cedar.invented"]
        self.assertEqual((ig["followers"], ig["posts30d"]), (5200, 1))
        self.assertEqual(instagram.sc_followers(fakes.fixture("sc_instagram_profile.json")), 5230)
        fb = facebook.parse(fakes.fixture("facebook.json"))[0]
        self.assertEqual((fb["pageId"], fb["runningAds"]), ("100000000000001", True))
        self.assertNotIn("email", fb)
        self.assertNotIn("phone", fb)
        tt = tiktok.parse(fakes.fixture("tiktok.json"), "@cedar.invented")
        self.assertEqual(tt["followers"], 900)
        sn = snapchat.parse(fakes.fixture("snapchat.json"), "cedarinvented")
        self.assertIsNone(sn["subscribers"])
        self.assertTrue(sn["subscribersHidden"])
        self.assertIsNone(snapchat.parse([], "x"))

    def test_handles(self):
        self.assertEqual(handle("instagram", "https://instagram.com/p/abc"), None)
        self.assertEqual(handle("facebook", "https://www.facebook.com/profile.php?id=1"), None)
        self.assertEqual(handle("tiktok", "see tiktok.com/@a.b_c"), "a.b_c")


class Ads(unittest.TestCase):
    def test_running_days_ticks_and_a_checked_zero(self):
        ads = adlibrary.parse(fakes.fixture("sc_company_ads.json")["results"], NOW)
        self.assertEqual([a["runningDays"] for a in ads], [458, 366])
        self.assertEqual(adlibrary.summary(ads), {"activeN": 2, "longestDays": 458, "over": {"7": 2, "21": 2, "60": 2}})
        self.assertEqual(adlibrary.summary([]), {"activeN": 0, "longestDays": None, "over": {"7": 0, "21": 0, "60": 0}})
        self.assertIsNone(adlibrary.pick_page([{"page_id": "9", "name": "Someone Else"}], "Cedar Invented", name_match))


class Discovery(unittest.TestCase):
    def test_the_plan_the_score_and_the_exclusions(self):
        a = fakes.INPUT["answers"]
        plan = discover.search_plan(a, fakes.INPUT["card"], None, 4)
        self.assertEqual(plan[0], {"query": "Interior design", "location": "Hawalli, Kuwait", "language": "en"})
        self.assertEqual(plan[1]["query"], "تصميم داخلي")
        self.assertLessEqual(len(plan), 4)
        places = [p.facts() | {"url": p.url} for p in maps.parse(fakes.fixture("maps_search.json"))]
        ads = adlibrary.parse(fakes.fixture("sc_search_ads.json")["searchResults"], NOW)
        cands = discover.build(places, serp.parse(fakes.fixture("serp.json")), ads, client_name="Cedar Invented Interiors",
                               client_site="https://cedar-invented.example", client_place={"location": {"lat": 29.33, "lng": 48.02}},
                               client_categories=["Interior designer"], service=["Interior design"],
                               blueprint_text="Rival Four Invented Villas",
                               not_competitors=[{"name": "Rival Eight Invented Works"}], max_distance="30 km", limit=25)
        names = [c.name for c in cands]
        self.assertNotIn("Cedar Invented Interiors", names)
        self.assertNotIn("Closed Invented Office", names)
        self.assertNotIn("Rival Eight Invented Works", names)
        self.assertEqual(names[0], "Rival Four Invented Villas")
        self.assertIn("named by the client", cands[0].why)
        self.assertEqual([c.kid for c in cands], [f"K{i}" for i in range(1, len(cands) + 1)])
        self.assertEqual(discover.country_of({"country": None, "phoneCountry": "SA"}),
                         ("SA", "the front desk phone's country code (assumed)"))
        self.assertEqual(discover.country_of({}), (None, "not on the card"))


if __name__ == "__main__":
    unittest.main()
