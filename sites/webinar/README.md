# webinar.maharamedia.com

The live training's landing page, thank-you page and join link. Vercel
project `mahara-webinar` (team `team_CYujeiq6dPtfcUEHS14lcJuV`), no build:
the files here are the site.

| File | Served at | What it is |
| --- | --- | --- |
| `index.html` | `/` | The landing page with the GHL opt-in form (5wC0SkFcgCfFzbpOUBWk) |
| `thank-you.html` | `/thank-you.html`, `/thank-you` | Where the form sends a new registrant: calendar, email, WhatsApp group, the gift survey (Typeform) |
| `live.html` | `/live` | The join link in the WhatsApp reminders: records the click, then opens the Zoom meeting 88628953097 |
| `p1.html`, `p2.html` | `/p1`, `/p2` | The booking links to share at pitch 1 and pitch 2: record the click, then open funnel.maharamedia.com/intro-booking with `utm_content=pitch1` or `pitch2` |
| `mm-track.js` | `/mm-track.js` | Page events for the CEO cockpit's webinar funnel |
| `vercel.json` | | The two rewrites and cache headers |

Until 2026-09-23 the only copy was `~/mahara-webinar` on Aziz's Mac
(`landing.html`, deployed as `index.html`). This folder is now the source
of what is live; edit here and deploy from here.

## Deploy

From a commit that is on GitHub main:

```bash
scripts/vercel-deploy-composio.sh sites/webinar
```

It needs `sites/webinar/.vercel/project.json` (not in git):
`{"projectId":"prj_7771FRN52RdWFzMBUrxe07iNoSIs","orgId":"team_CYujeiq6dPtfcUEHS14lcJuV","projectName":"mahara-webinar"}`.
Then check the live page carries the change (`curl -s https://webinar.maharamedia.com/ | grep mm-track`).

## What the pages record

`mm-track.js` sends events to the Supabase Edge Function `webinar-events`
in Creative Triage (`supabase/functions/webinar-events`), which checks each
field and writes `cockpit_webinar_page_events`
(`supabase/migrations/20260923h_webinar_page_events.sql`). No cookies and
nothing personal: a random visitor id kept in the browser, a session that
ends after 30 idle minutes, and the visit's `utm_*` (kept 30 days, so the
thank-you page knows the ad).

| Event | When |
| --- | --- |
| `page_view` | Landing or thank-you page loads |
| `page_leave` | The page is hidden; value = seconds it was on screen, summed across returns |
| `scroll` | 25, 50, 75, 100% of the landing page reached |
| `cta_click` | A register button (`hero`, `middle`) |
| `form_view` | A quarter of the form, or 200 px of it, on screen |
| `form_focus` | The visitor clicks into the form (form started) |
| `form_submit` | GHL's form reports a lead collected (`set-sticky-contacts`) |
| `video_play`, `video_progress` | A Wistia video starts; 25, 50, 75, 95% watched (label = the video id) |
| `calendar_add` | Add to calendar on the thank-you page |
| `whatsapp_click` | The WhatsApp group button (label `placeholder` while the link is still `[WHATSAPP_LINK]`) |
| `survey_start`, `survey_submit` | The gift survey's Typeform embed starts and is sent |
| `join_click` | `/live` opened, from the reminders |
| `pitch_click` | `/p1` or `/p2` opened (label `pitch1`, `pitch2`) |

Registrations themselves are counted from HighLevel, never from the page;
the page's own `form_submit` and thank-you views are the second source.

## Before a round

- The countdown date (`COUNTDOWN_ISO` in `index.html`) and the date lines on
  both pages.
- The thank-you page's WhatsApp group link is still `[WHATSAPP_LINK]`.
- Every ad's URL carries `utm_content={{ad.id}}`.
