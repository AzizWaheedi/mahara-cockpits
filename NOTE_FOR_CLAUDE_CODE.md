# Note for Claude Code working on the cockpits

From Faris, the Hermes agent on Aziz's VPS. Written 2026-09-10.

## What changed

I committed a new playbook at
`hermes/cockpit-ask-ai/references/mahara-context/client-launch-campaign/`
and added a "Media buyer questions" section to `hermes/cockpit-ask-ai/SKILL.md`
pointing at it.

It lives under the existing cockpit-ask-ai references on purpose, so the worker
picks it up with no code change on your side.

## Why it matters for the chat

`apps/media-buyer-cockpit/convex/hermes.ts` already sends exactly the right
context. `contextFor()` passes `cpl`, `costPerBooking`, `bookings7d`, `leads7d`,
`spend7d`, `daysLive`, `constraint` and `action` per campaign.

Those last two fields are the interesting part. The cockpit was built expecting
a diagnosis, and until now the model answering had no Mahara-specific standard
to diagnose against. It would answer from general Meta knowledge, which
contradicts the house rules in several places.

Now it has the real numbers:

| Metric | Mahara target |
|---|---|
| Cost per lead | under $15 |
| Cost per booking | under $60 |
| Lead to booking | 25% or more |
| Pickup rate | 35% or more |
| Show rate on confirmed | 75% or more |
| Close rate | 20% to 30% |

And the diagnostic order: macro before micro. If every metric is bad at once
that is one problem, almost always the offer or the messaging, not five
problems to fix separately.

## What is in the playbook

- **SKILL.md** - the launch structure. One CBO campaign, one ad set, five ads,
  each ad carrying three primary texts and three headlines through
  `asset_feed_spec`. Naming convention, UTM template, six pitfalls.
- **references/intake.md** - the questions to ask before building anything,
  including the radius rule by consultation type.
- **references/diagnostics.md** - the KPI ladder and ordered fix lists, from
  Mahara's own SOP.
- **references/question_library.md** - the Arabic lead form question library
  with GHL field names already mapped.
- **references/form_template.md** - lead form construction, flow before
  friction, greeting card carrying the offer.
- **references/assets.md** - reading client Drive assets before writing copy.
- **scripts/** - `launch.py` builds the campaign, `verify.py` reads back what
  Meta actually stored, `make_form.py` creates lead forms.

## Graph API facts worth having, all tested live

These cost real time to discover. None came from documentation.

- `BOOK_NOW` is **rejected** on lead-gen creatives. Use `BOOK_TRAVEL`, which
  renders as Book Now. Verified working: `BOOK_TRAVEL`, `LEARN_MORE`, `SIGN_UP`,
  `APPLY_NOW`, `GET_QUOTE`, `GET_OFFER`, `SUBSCRIBE`, `DOWNLOAD`. Verified
  rejected: `BOOK_NOW`, `CONTACT_US`, `GET_STARTED`, `SEE_MORE`, `REQUEST_TIME`,
  `SCHEDULE_NOW`.
- `lead_gen_form_id` goes in `call_to_actions[0].value`, never in `link_urls`.
  `link_urls` still needs one entry with a `website_url` or SINGLE_IMAGE is
  rejected.
- `standard_enhancements` is deprecated and now returns a hard error.
- Lead forms require a **Page** access token, not a system user token.
- Lead forms cannot be deleted, only archived, and a form created as `DRAFT`
  can read back as `ACTIVE`. There is no safe staging state.
- Form names must be unique per page.
- Privacy policy cannot be omitted through the API even when the Ads Manager
  toggle is off. You must pass a URL or a `legal_content_id`.
- Always resolve city keys through the search endpoint. Meta accepts a wrong key
  silently. A Taif key that actually pointed at a village called Saq passed
  without complaint and would have sent a fifth of the budget nowhere.

## One thing I could not verify

I confirmed the chat relay exists in `hermes.ts` and that it sends campaign
context. I did **not** verify whether that relay loads skills the way the cron
worker does.

If it does not, the chat gets the campaign numbers but not this playbook, and
the answers will keep coming from general Meta knowledge. Worth checking on your
side, since you can see the worker end.

## Token note

The GitHub token I have is fine-grained and only carries `metadata=read` for the
git-data API, so I cannot use `/git/blobs` or `/git/trees`. The contents API
works fine, which is what I used. If you want me pushing larger changesets
cleanly, the token needs Contents write on this repo.
