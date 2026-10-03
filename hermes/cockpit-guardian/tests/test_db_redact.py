"""The database doors, the migration, and redaction."""
import unittest
from pathlib import Path
from unittest import mock

from tests import fakes
from guard import db as db_mod
from guard import http
from guard.model import ago, parse_time
from guard.redact import clean, plain, scrub

MIGRATION = Path(__file__).resolve().parents[3] / "supabase" / "migrations" / "20261003e_guardian_incidents.sql"


def norm(s: str) -> str:
    return " ".join(s.split())


class Migration(unittest.TestCase):
    def setUp(self):
        self.sql = MIGRATION.read_text()

    def test_probe_body_is_the_same_text_as_the_code(self):
        body = self.sql.split("$probe$")[1]
        self.assertEqual(norm(body), norm(db_mod.PROBE_SQL))

    def test_probe_never_returns_the_cron_command(self):
        # The command is only ever tested inside one boolean, never returned.
        self.assertEqual(db_mod.PROBE_SQL.count("command"), 1)
        self.assertIn("'has_literal_auth', j.command ~* 'Bearer [A-Za-z0-9_.-]{20,}')", db_mod.PROBE_SQL)
        self.assertNotIn("'command'", db_mod.PROBE_SQL)

    def test_service_role_only_with_rls(self):
        self.assertIn("alter table public.cockpit_guardian_incidents enable row level security;", self.sql)
        self.assertIn("revoke all on table public.cockpit_guardian_incidents from public, anon, authenticated;", self.sql)
        self.assertIn("grant select, insert, update on table public.cockpit_guardian_incidents to service_role;", self.sql)
        self.assertNotIn("create policy", self.sql.lower())
        self.assertIn("grant execute on function public.cockpit_guardian_probe() to service_role;", self.sql)
        self.assertIn("security definer", self.sql)
        self.assertIn("set search_path = ''", self.sql)

    def test_one_open_incident_per_check(self):
        self.assertIn("on public.cockpit_guardian_incidents (check_id) where status = 'open'", self.sql)

    def test_columns_match_what_the_store_writes(self):
        from guard.store import ROW_COLUMNS
        for col in ROW_COLUMNS:
            self.assertRegex(self.sql, rf"\n  {col}\s", col)


class RestDoor(unittest.TestCase):
    def test_query_building(self):
        d = db_mod.RestDb("https://x.supabase.co", "k")
        q = d._query("worker,job", [("worker", "eq", "sales-desk"), ("resolved_at", "is", None),
                                    ("job", "in", ["a", "b"])], "at.desc", 5)
        self.assertEqual(q, 'select=worker,job&worker=eq.sales-desk&resolved_at=is.null&job=in.("a","b")'
                            '&order=at.desc.nullslast&limit=5')

    def test_names_are_checked(self):
        d = db_mod.RestDb("https://x.supabase.co", "k")
        with self.assertRaises(db_mod.DbError):
            d._query("a;drop table x", [], None, None)

    def test_missing_table_reads_as_absent(self):
        d = db_mod.RestDb("https://x.supabase.co", "k")
        with mock.patch.object(http, "get", return_value=fakes.resp(404, '{"code":"PGRST205","message":"Could not find the table"}')):
            self.assertFalse(d.exists("cockpit_sales_rooms"))
        with mock.patch.object(http, "get", return_value=fakes.resp(200, "[]")):
            self.assertTrue(d.exists("cockpit_sections"))
        with mock.patch.object(http, "get", return_value=fakes.resp(500, "boom")):
            with self.assertRaises(db_mod.DbError):
                d.exists("cockpit_sections")

    def test_probe_missing(self):
        d = db_mod.RestDb("https://x.supabase.co", "k")
        with mock.patch.object(http, "request", return_value=fakes.resp(404, '{"code":"PGRST202"}')):
            with self.assertRaises(db_mod.ProbeMissing):
                d.probe()


class MgmtDoor(unittest.TestCase):
    def test_sql_is_quoted_and_read_only(self):
        sent = []

        class M(db_mod.Mgmt):
            def __init__(self):
                pass

            def sql(self, query):
                sent.append(query)
                return [{"n": 3}]

        d = db_mod.MgmtDb(M())
        d.rows("cockpit_sales_settings", "key,value", [("key", "eq", "it's"), ("key", "in", ["a", "b"])], "key.asc", 2)
        self.assertEqual(sent[-1], "select key, value from public.cockpit_sales_settings where key = 'it''s' and key in ('a', 'b') "
                                   "order by key asc nulls last limit 2")
        self.assertFalse(d.can_write)
        with self.assertRaises(db_mod.DbError):
            d.upsert("x", [{}], "id")


class Redaction(unittest.TestCase):
    def test_keys_phones_emails_and_dashes(self):
        text = ("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZSJ9.abcdefghij token=abc123 "
                "call +965 5555 1234 or 96555551234, mail ali@example.com — on 2026-10-03 13:45:00")
        out = clean(text, 1000)
        for bad in ("eyJ", "abc123", "5555", "96555551234", "ali@example.com", "—"):
            self.assertNotIn(bad, out)
        self.assertIn("2026-10-03 13:45:00", out)

    def test_brief_error(self):
        from guard.redact import brief_error
        raw = 'Meta 400: {"error":{"message":"API access blocked.","type":"OAuthException","code":200,"fbtrace_id":"AjpNPI"}}'
        self.assertEqual(brief_error(raw), "Meta 400: API access blocked. (code 200)")
        self.assertEqual(brief_error("plain words"), "plain words")

    def test_key_names_stay(self):
        self.assertIn("DEEPSEEK_API_KEY is empty", clean("DEEPSEEK_API_KEY is empty in /opt/data/bibi/api-keys.env"))

    def test_scrub_and_plain(self):
        self.assertNotIn("sk-live", scrub("key sk-liveabcdef1234"))
        self.assertEqual(plain("a — b"), "a, b")


class Times(unittest.TestCase):
    def test_parse(self):
        for v in ("2026-10-03 20:20:51.312+03", "2026-10-03T17:20:51.312Z", 1791047627945, 1791047627,
                  "2026-10-03 20:20:52.38+03", "2026-10-03 13:38:05.365404+03"):
            self.assertIsNotNone(parse_time(v), v)
        self.assertEqual(parse_time("2026-10-03 20:00:00+03").hour, 17)
        self.assertIsNone(parse_time("not a time"))

    def test_ago(self):
        self.assertEqual(ago(None), "an unknown time")
        self.assertEqual(ago(45), "45 min")
        self.assertEqual(ago(150), "2.5 h")
        self.assertEqual(ago(6.2 * 1440), "6.2 days")


if __name__ == "__main__":
    unittest.main()
