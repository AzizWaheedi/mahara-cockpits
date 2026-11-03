# Market research (hermes/market-intel)

Researches every new client's market once their onboarding answers arrive: their own presence (Maps, website,
Instagram, Facebook, TikTok, Snapchat, their Meta ads), who their direct rivals are, what those rivals advertise and
charge, what their customers praise and complain about, and where the client can win. It replaces the teammate's
`market_intel_job.py` (CEO decision 1, 2026-11-02: "replicate and improve it with a better scraper"; design
`next-design/market-intel.md`, plan build MI-1, contract `docs/forms/WAVE56-CONTRACT.md` 4.23).

**This release (MI-1) is dark.** A run writes its rows to Supabase (`cockpit_market_intel_*`, migration
`20261103i`) and its files to its run folder, and nothing else: no Google Doc, no card field, no comment, no
call-center guide. Publishing comes later (MI-1b the card field through `clickup-writeback`, MI-3 the Doc, MI-4 the
guide), behind the setting `market_intel` and the worker's own `MARKET_INTEL_APPLY`.

## Why this shape

- **Code does every pull; the model only judges, with no tools.** The old job let an agent plan its own pulls
  (65 to 67 turns). Here the pulls are fixed plans with caps, a spend meter and fallbacks, and every item becomes
  numbered evidence (`E12`) with its URL, source and time. The model gets the evidence fenced as data and returns
  JSON: which candidates are real rivals, then the findings, each claim pointing at evidence ids. Scraped text cannot
  make it run anything.
- **The model never types a number.** A finding names a metric (`{"metric": "maps.rating", "of": "C3"}`) and the
  renderer fills the pulled value with its evidence id and date (`mi/facts.py`). Missing renders `[ ]`, never 0.
- **A second source for the numbers that ship** (CLAUDE.md): rating and review count of the client and the top three
  rivals from the place pull and again from the reviews actor's header; the client's Instagram followers again through
  ScrapeCreators. Values more than 2 percent apart ship as a range, "two sources differ".
- **Money is capped in code before any pull.** Every pull reserves its estimate on the meter first; one that would
  pass the run cap (USD 2) or the month cap (USD 25, summed from every run since the 1st) is refused and the report
  says "Not checked: ...". Apify runs also carry `maxItems` and `maxTotalChargeUsd`, and the meter holds that
  ceiling while the run is in flight, so runs side by side share what is left instead of each being given all of
  it (a pull that fits once a hold comes back waits for it). A run aborted at the 15-minute deadline still counts
  what it spent. At most 40 actor runs a report, 4 at a time, one report at a time. The lower of the setting's caps
  and this worker's own wins, read again at every save: a lowered cap applies to the next pull.
- **Resume never pays twice.** The run folder keeps the raw result of every finished pull and every model answer; an
  Apify run id is recorded before polling, so a worker that dies mid-pull reads the same run again, and each
  finished run's cost is saved with the spend it explains, so reading it again never counts it twice. Which Maps
  place is the client is decided once and kept, so a resume (whose cache holds no phone) never loses a listing
  matched by name and phone.
- **Direct website reads stay on the public internet.** Only http and https on ports 80 and 443, to a host whose
  every address is public; every redirect is checked again, and a connection that lands on a loopback, private or
  link-local address is refused. Nothing on the VPS (the Claude proxy, another worker) can be read this way.
- **No contact data leaves the database.** `cockpit_market_intel_input` never returns the five contact answers (full
  name, phone, email, front desk phone, personal phone). Whether the Maps listing's phone equals the front desk phone
  is answered inside the database (`cockpit_market_intel_nap`: match, differs, not_checked). Reviewer names are never
  copied, and the raw cache drops reviewer and contact keys before it touches disk.

## The run

| Stage | What | Source |
|---|---|---|
| A | The client's Maps listing (its own link, else a search matched by two identifiers: the name and the website or the phone), reviews (100, newest first), brand search (3 queries, ads read), website (12 pages read directly: services, prices, calls to action, booking widget, Meta Pixel, GTM, GA4, TikTok and Snap pixels), Instagram, Facebook, its Meta ads with running days, TikTok and Snapchat when the site or the Instagram bio names them, NAP | Apify (`compass/crawler-google-places`, `compass/Google-Maps-Reviews-Scraper`, `apify/google-search-scraper`, `apify/instagram-profile-scraper`, `apify/facebook-pages-scraper`, `clockworks/tiktok-profile-scraper`, `tri_angle/snapchat-scraper`), ScrapeCreators (Ad Library), direct fetch |
| B | Discovery: Maps searches by what they sell where they sell it (English and Arabic, 4 queries x 15 places), the local search with its paid ads, who advertises the service on Meta now; code scores every candidate (category, distance within the client's "max distance", reviews, rating, website, advertising, named in the Blueprint) and keeps 25; the model picks 6 and 2 reserves (a pick outside the 25 is refused and filled by score) | Apify, ScrapeCreators |
| C | The 6 in depth: websites (8 pages), reviews (40), Instagram, Facebook, Meta ads (20), TikTok when found | as A |
| D | English findings for the 13 sections, the eight checks (`mi/check.py`), one repair; the Arabic edition with the same ids, checked again | the engine |
| E | The three tabs (Arabic, English, Onboarding Answers) rendered as text and as the Docs requests MI-3 will send; the card field value and the comment written to `outputs.json` marked not sent; findings and competitors stored | code |

A run ends `done`, `needs_person` (the first failing rule as a sentence, e.g. "Research finished, but 2 claims cite
evidence or pages this run never opened. Open the evidence or run it again."), or goes back to the queue. Waiting
is not a try: when the engine is down or the month's spend cannot be read the run waits (an hour for the engine,
doubling to 4 hours) and resumes from its folder without pulling again; after 24 hours of waiting it ends
`needs_person`. Turning `market_intel.on` off stops a run before its next pull or model call; it waits, paused,
and resumes when research is on again. Only an unexpected error or a lost lease is a try (three, then `failed`).
Findings that failed the checks are stored for a person but never shown in the cockpit.

## Files

```
mi.py                 the command line
mi/config.py          every knob and key name
mi/supabase.py        PostgREST and the worker's functions (Home)
mi/ledger.py          the provider ledger (intent before, response after; no call without its intent row)
mi/meter.py           the run and month caps
mi/apify.py           actor runs: caps, ceilings, resume
mi/scrapecreators.py  the Ad Library and followers, credits reserved first
mi/sources/*.py       one adapter per source: input, recorded shape, evidence
mi/discover.py        the search plan, the score, the shortlist
mi/facts.py           the numbers a report may show, with the second source
mi/model.py           the engine switch (vps, cli), no tools, Claude only
mi/prompts.py         pick, write_en, write_ar, repair
mi/check.py           the eight rules
mi/render.py          the three tabs, the Docs requests, the field and the comment
mi/pipeline.py        one run, staged and resumable
mi/plan.py            the dry run's plan and cost
mi/store.py           the run folder
tests/                python3 -m unittest discover -s tests -t .   (fakes and recorded shapes; no network)
```

## Keys and settings

Read by name from the environment, then `~/.market-intel/env` (mode 600), then the Hermes key files. Never printed.
`env.example` lists the names.

| Name | For |
|---|---|
| `MARKET_INTEL_SUPABASE_URL`, `MARKET_INTEL_SUPABASE_KEY` | Creative Triage and its service key (required) |
| `MARKET_INTEL_APIFY_KEY` (else `APIFY_API_KEY`, with a doctor warning: the radar's Starter credit is shared) | every actor (required) |
| `SCRAPECREATORS_API_KEY` | the Meta Ad Library and the second follower count (without it: the Apify ads actor, one source) |
| `MARKET_INTEL_MODEL_PROVIDER` | `vps` (default: the Claude proxy on the VPS, 127.0.0.1:3456, the CEO's sign-in, no key) or `cli` (`claude -p`, every tool off, with `CLAUDE_CODE_OAUTH_TOKEN`; `ANTHROPIC_*` removed so it never falls back to API billing). `anthropic` is refused in this release |
| `MARKET_INTEL_MODEL_PICK` (`sonnet`), `MARKET_INTEL_MODEL_WRITE` (`opus`) | Claude models only; DeepSeek or a router variant is refused |
| `MARKET_INTEL_USD_CAP_RUN` (2), `MARKET_INTEL_USD_CAP_MONTH` (25) | the worker's own caps; the lower of these and the setting wins |
| `MARKET_INTEL_ACTOR_<NAME>` | a different actor id (`MAPS`, `REVIEWS`, `SERP`, `WEB`, `INSTAGRAM`, `FACEBOOK`, `ADS`, `TIKTOK`, `SNAPCHAT`) |
| `MARKET_INTEL_GOOGLE_KEY_FILE`, `MARKET_INTEL_TEMPLATE_DOC`, `MARKET_INTEL_APPLY` | MI-3, not read in shadow |
| `FOREPLAY_API_KEY` | optional, not used in this release |

The setting `cockpit_settings` `market_intel` (seeded off by `20261103i`): `on`, `mode` (`shadow`), `apply_drive`,
`apply_clickup`, `apply_kb` (all false), `only_cards`, `usd_cap_run` 2, `usd_cap_month` 25, `refresh_on_kickoff`
false, `shadow_since` (the apply time: the scan researches answers stored after it).

## Commands

```bash
python3 mi.py doctor                        # every key by name, Supabase and the setting, Apify and its month, ScrapeCreators credits, the engine (one word)
python3 mi.py run --task <card> --dry-run   # the pull plan and its estimated cost for the card's newest answer; pulls nothing
python3 mi.py pending                       # the cron: scan, claim one, research it, one health row (cockpit_sync_state market-intel)
python3 mi.py pending --dry-run             # the setting and the open runs; writes nothing
python3 mi.py shadow                        # this month's runs, spend and sentences (read only)
python3 mi.py backfill --task <card> --note "October client, no report yet"   # queue a run for an older answer
python3 mi.py resend --run <run id>         # render a finished run again from its rows; no pull, no model, nothing sent
python3 mi.py prune --days 180              # evidence bodies and run folders older than 180 days
```

A run folder (`~/.market-intel/runs/<run id>/`, mode 700): `pulls/` (raw results, sanitised), `evidence.json`,
`facts.json`, `model/` (each answer), `check.json`, `report.ar.md`, `report.en.md`, `report.answers.md`,
`docs-requests.json`, `outputs.json` (the field and the comment, `sent: false`), `presence.json`, `not_checked.json`,
`warnings.json`, `progress.json`.

## Install on the VPS (MI-1 install step; not done by this branch)

As the radar's user (`hermes`), after the migration is applied:

```bash
cd ~/mahara-cockpits && git pull --ff-only
mkdir -p ~/.market-intel && chmod 700 ~/.market-intel
cp hermes/market-intel/env.example ~/.market-intel/env && chmod 600 ~/.market-intel/env   # fill the values there
cd hermes/market-intel && python3 mi.py doctor     # "No blocker."
python3 mi.py run --task 86eywg1cq --dry-run       # the test card's plan and cost
```

Then the two lines in `crontab.manifest` (a crontab backup first), and the same lines in
`hermes/cockpit-guardian/crontab.manifest`. Shadow starts when the CEO sets `market_intel.on` true (MI-2).

## Tests

`python3 -m unittest discover -s tests -t .` (Python 3.10 or later). Every provider is faked (`tests/fakes.py`) with
recorded response shapes (`tests/fixtures/`, invented businesses); a test that reached a real host would fail.
