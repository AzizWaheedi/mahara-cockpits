# webby-live-training — Vercel handlers for the live-training funnel

Two serverless functions + placeholder pages.

| Route | What it does |
|---|---|
| `POST /api/register` | Upserts the contact in GHL with tag `webby-registered` (+ round fields) and books them on the **WEBBY · Live Training (internal)** calendar at `WEBINAR_START`. That fires W1 and W2. |
| `POST /api/survey` | Typeform webhook. Upserts by email, tag `webby-survey-done`, writes Webinar Profit Band + Webinar Survey Notes. Fires W5. |
| `GET /api/health` | Shows which settings are present (never values). |
| `/` `/thanks.html` | Placeholder pages until the designed landing page replaces them. |

## Environment variables (Vercel → Project → Settings → Environment Variables)

| Name | Required | Value |
|---|---|---|
| `GHL_TOKEN` | yes | Private Integration token. GHL → Settings → Private Integrations → New → scopes: contacts (write), calendars/events (write), locations/customFields (read). |
| `WEBINAR_START` | yes | Round date/time with offset, e.g. `2026-09-24T20:00:00+03:00`. **The only place the date lives.** |
| `WEBINAR_ROUND` | no | default `sep-2026` → tag `webby-sep-2026` + Webinar Round field |
| `WEBINAR_MINUTES` | no | default 90 |
| `THANKS_URL` | no | default `/thanks.html` |
| `TYPEFORM_SECRET` | no | if set, Typeform webhook signatures are verified |
| `GHL_LOCATION_ID`, `WEBBY_CALENDAR_ID` | no | defaults are the live IDs |

After adding or changing a variable, redeploy (Deployments → ⋯ → Redeploy).

## Wiring
- Landing page form → `POST /api/register` with `first_name, phone, email` (JSON or form-encoded).
- Typeform → Workflows → "WEBBY · Survey submitted → GHL (W5)" → Webhook step → `https://<deployment>/api/survey` → Publish.

## Test
`curl -X POST https://<deployment>/api/register -H 'Content-Type: application/json' -d '{"first_name":"Test","email":"you@example.com","phone":"+965XXXXXXXX"}'`
→ contact appears in GHL with tag webby-registered and an appointment on the Live Training calendar.
