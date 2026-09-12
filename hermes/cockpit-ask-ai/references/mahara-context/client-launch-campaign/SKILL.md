---
name: client-launch-campaign
description: Use to launch a new client's first Meta lead-gen campaign.
version: 1.0.0
author: Faris (Mahara Media)
license: MIT
metadata:
  hermes:
    tags: [meta-ads, lead-gen, campaign-launch, client-onboarding, cbo]
    related_skills: [client-ads-audience-library, mahara-banner-design, humanizer]
---

# Client Launch Campaign

Build a brand new client's first Meta campaign: one CBO campaign, one ad set,
broad targeting, five ads, each carrying three primary texts and three headlines.

## When to Use

Use this when a client has been signed and needs their first Meta campaign
built, at a daily budget of $25 or more.

Do not use it for scaling a campaign that is already spending, for retargeting,
or for diagnosing a campaign that is underperforming. Those need different
structures and different skills.

Read `references/intake.md` first, `references/assets.md` before writing copy,
`references/question_library.md` and `references/form_template.md` when building
the lead form, and `references/diagnostics.md` once the campaign has data.

This skill is also the knowledge base for the media buyer agent in the Mahara
cockpit. Anything learned while running a real campaign belongs back in here.

## The structure, and why it does not change

At $25 to $50 a day there is not enough budget to learn anything from a split
test. Splitting into three ad sets means three learning phases on the same money
and none of them finish. So:

```
1 campaign (CBO, OUTCOME_LEADS)
  └── 1 ad set (broad, no interests, Advantage audience on)
        ├── ad 1  (3 primary texts + 3 headlines)
        ├── ad 2  (3 primary texts + 3 headlines)
        ├── ad 3  (3 primary texts + 3 headlines)
        ├── ad 4  (3 primary texts + 3 headlines)
        └── ad 5  (3 primary texts + 3 headlines)
```

Above $50 a day the structure stays identical, only the budget number changes.
Do not add ad sets because the budget went up.

The three texts and three headlines go on each ad through `asset_feed_spec`,
which is exactly what the plus button in Ads Manager creates. Five ads, not
fifteen. Meta rotates the combinations itself.

## Step 1: intake

Ask every question in `references/intake.md` before touching the API. Do not
guess an answer. A wrong radius or a wrong form quietly wastes the client's
first month of spend, and a new client has no patience for that.

The three that people get wrong most often:

**Consultation type sets the radius.**

| Consultation type | Radius |
|---|---|
| In-office only | 25km around the office |
| In-home only | 40km around the service area |
| Both office and home | 40km |
| Online | ask the client, never assume |

Online does not mean nationwide. Plenty of clients take the first call online
and still only want their own city, because the team cannot service further out
regardless of how the consultation happens. Ask which regions they want and
list them explicitly in the brief.

**The lead form.** Ask whether they want to reuse an existing form or build a
new one, and if it is new, build it with them from
`references/form_template.md`. Never invent a form ID and never silently reuse
an old one, because an old form can point at a disconnected CRM.

**The CTA button.** Ask, do not default. The button should match what the ad
actually promises, and a mismatch between the copy and the button is the
cheapest conversion loss there is.

| Ask for | Use | Renders as |
|---|---|---|
| A booked appointment or visit | `BOOK_TRAVEL` | Book Now |
| A price or a quote | `GET_QUOTE` | Get Quote |
| Applications, limited spots, qualification | `APPLY_NOW` | Apply Now |
| Softer entry, awareness-led, education first | `LEARN_MORE` | Learn More |
| Registration, signup, a free trial | `SIGN_UP` | Sign Up |
| A specific offer or discount | `GET_OFFER` | Get Offer |
| A guide, checklist or document | `DOWNLOAD` | Download |
| A recurring list or newsletter | `SUBSCRIBE` | Subscribe |

These eight are verified working on lead-gen creatives. **`BOOK_NOW`,
`CONTACT_US`, `GET_STARTED`, `SEE_MORE`, `REQUEST_TIME` and `SCHEDULE_NOW` are
rejected**, which is why Book Now is sent as `BOOK_TRAVEL`.

The CTA can differ per ad. An awareness ad whose copy teaches something is
better served by `LEARN_MORE` than by a booking button the reader is not ready
for. Set it per ad in the brief when it varies, or once at the top when it does
not.

If the client's video or image says something specific like احصل على عرض سعر,
the button has to say the same thing. Put `GET_QUOTE` on it.

**The assets.** Ask for a Google Drive link or a direct upload. This skill does
not generate images.

## Step 2: read every asset before writing a word

Images: look at each one. What is in the frame, what does the text on it say,
who is it obviously speaking to.

Videos: transcribe first. The `social-video-transcription` skill handles social
links, `apify-scraping` handles YouTube, and a Drive file can be pulled with the
Drive API and run through whisper.

The copy for each ad has to match the asset it sits on. An image showing a
finished building and an image showing a site under construction are speaking to
two different people at two different moments, and giving them the same body
text wastes both.

Never write five ads off one generic brief. Write one per asset.

## Step 3: write the copy

Three primary texts and three headlines per ad. The three texts are three
different registers, not three rewordings:

| Style | Shape |
|---|---|
| a | mid-short, emojis used as structure, 140-210 characters |
| b | mid-short, no emojis at all, same length as (a) |
| c | long form, 400-550 characters, teaches something before it asks |

Keeping (a) and (b) the same length is deliberate. It isolates one variable, so
the result tells you whether emojis help this audience rather than whether short
beats long.

Load `creative/humanizer` and run the whole set through it before it goes
anywhere near the API. The failure that shows up every time is the same
rhetorical move repeating across all five ads, three-item lists everywhere, and
an identical closing line on four of them.

Arabic copy loads the client's own dialect, not Aziz's Kuwaiti voice. A Saudi
client reads Hejazi or Najdi. Getting this wrong is instantly obvious to a
native reader and it makes the ad feel foreign.

Hard limits on claims: never state a number the client has not given you, never
promise a regulatory approval or a permit outcome, never invent a fine or a
penalty amount, and never put a guarantee in an ad for a licensed profession.

## Step 4: build it

`scripts/launch.py` does the whole build. Fill a brief JSON, run it once.

```bash
python3 scripts/launch.py brief.json
```

It writes `launch_state.json` next to the brief and is resumable, so if it
fails halfway you fix the cause and run it again without creating duplicates.

**Everything is created PAUSED.** The operator reviews in Ads Manager and turns
it on. Never launch a client's first campaign live from a script.

## Step 5: verify before you hand it over

Run `scripts/verify.py brief.json`. It re-reads what Meta actually stored rather
than trusting the create calls, and checks the budget, the geo, the age, the
form, the CTA, and that every ad carries three bodies and three titles.

Read the city names it prints. Meta accepts a wrong city key without complaint:
a Taif key that was actually a village called Saq passed silently and would have
sent a fifth of the budget nowhere.

## Naming

Consistent names are what make reporting possible three months later. This is
the Mahara convention, use it exactly.

```
Campaign   [Client] | [Service/Offer] | [OBJECTIVE] | [MMMYYYY] | MHM™
Ad set     [Service/Audience] | [TARGETING_TYPE] | [Funnel Type]
Ad         [HOOK] | [FORMAT] | [VERSION] | DD-MM-YY
```

Real examples:

```
Monshaat Khaldaa | SafetyPlans | Leads | Sep2026 | MHM™
PropertyOwners | Broad | Lead Form
MissedRequirement | StaticImage | v1 | 10-09-26
```

The client name leads the campaign name because some clients run more than one
ad account and some accounts hold more than one client's work. Reading a
campaign name should never require opening the account to find out whose it is.

The MHM™ suffix goes on the campaign name only, never on ad sets or ads. It
marks the campaign as Mahara-built inside a client's own ad account, which
matters when the client has run ads with someone else before.

For a broad launch campaign the ad set targeting type is always `Broad`, since
there is no interest stack to name. When a later campaign does use interests,
the token becomes `Interest Stack1` and so on.

The HOOK token on an ad is the angle in one or two words, not a description of
the picture. `MissedRequirement` tells you which message won. `BuildingPhoto`
tells you nothing useful at review time.

### UTM parameters

Set these on every creative through `url_tags`:

```
utm_source={{site_source_name}}&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&utm_term={{adset.name}}&utm_placement={{placement}}
```

**`{{site_source_name}}` is the one that matters.** Hardcoding
`utm_source=facebook` is wrong the moment an ad delivers on Instagram, which on
a broad campaign with automatic placements is most of the time. Meta fills this
token at delivery with where the impression actually happened:

| Value | Platform |
|---|---|
| `fb` | Facebook |
| `ig` | Instagram |
| `msg` | Messenger |
| `an` | Audience Network |

So a client asking whether Instagram or Facebook is producing their leads gets a
real answer instead of a guess.

`utm_medium=paid_social` rather than `cpc`, because these campaigns optimise for
leads on impression billing, not clicks. Calling it `cpc` misdescribes the buy
in every report that reads it. Keep one value across all clients so the channel
groups cleanly in analytics.

`{{placement}}` returns the specific surface, such as `Facebook_Mobile_Feed` or
`Instagram_Stories`. It goes in a custom `utm_placement` rather than overloading
one of the five standard parameters, which stay reserved for source, medium,
campaign, content and term.

Full list of dynamic tokens Meta supports:

```
{{campaign.name}}  {{campaign.id}}
{{adset.name}}     {{adset.id}}
{{ad.name}}        {{ad.id}}
{{site_source_name}}
{{placement}}
```

Prefer `.name` over `.id` for anything a human will read in a report, which is
exactly why the naming convention above has to be followed. The names become the
analytics data.

Know what this does and does not do. On an instant form ad there is no click
through to a website, so nothing ever reads these. Set them anyway, because the
moment a client sends traffic to a landing page the tracking is already correct
and nobody has to retrofit it. For real attribution on an instant form campaign,
the answer is hidden fields in the lead form, covered in
`references/form_template.md`.

## Pitfalls

Every one of these cost real time on a live build.

**`BOOK_NOW` is rejected with lead forms.** Use `BOOK_TRAVEL`, which renders as
Book Now on the button. Verified accepted: `BOOK_TRAVEL`, `LEARN_MORE`,
`SIGN_UP`, `APPLY_NOW`, `GET_QUOTE`, `GET_OFFER`, `SUBSCRIBE`, `DOWNLOAD`.
Verified rejected: `BOOK_NOW`, `CONTACT_US`, `GET_STARTED`, `SEE_MORE`,
`REQUEST_TIME`, `SCHEDULE_NOW`.

**Lead forms need a Page access token, not the system user token.** Pull it from
`me/accounts`, match on page id, and use that token for anything under
`/leadgen_forms`. The system token returns "This method must be called with a
Page Access Token".

**Lead forms cannot be deleted, only archived.** `DELETE` returns 400. Create
them as `DRAFT`, confirm with the client, then activate. A careless test form
sits on the client's page forever.

**`lead_gen_form_id` does not go in `link_urls`.** It belongs in
`call_to_actions[0].value`. `link_urls` still needs at least one entry with a
`website_url` or the SINGLE_IMAGE format is rejected.

**Do not send `standard_enhancements`.** It is deprecated and now returns a hard
error rather than a warning.

**A development-mode app cannot create creatives.** The error mentions app mode,
not permissions, and the fix is toggling the app to Live in the developer
dashboard. It also needs a privacy policy URL and a data deletion URL.

**Always confirm city keys with the search endpoint.** Never reuse a key from
memory or another account.

**UTM parameters do nothing on an instant form ad.** There is no click to a
website, so nothing ever reads them. Set them anyway for the day the client
sends traffic to a landing page, but if the client wants real attribution the
answer is hidden fields in the lead form capturing campaign, ad set and ad ID.

**Get the ad account from the client database sheet, not from the account list.**
Two accounts often have similar names and the wrong one belongs to a different
client.
