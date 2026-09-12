# Lead form

This is the media buyer's full reference for building a client's form. Every
field below was verified against a live form on the Graph API, not copied from
documentation.

## Flow before friction

The order of the form decides the completion rate.

Meta shows the intro card first, then the questions, then contact details, then
the thank you page. Work with that order rather than against it:

**Easy and relevant first.** The opening question should be one the prospect can
answer without thinking and that feels like it is about them. Service type,
project type, what stage they are at. Someone who answers one question is far
more likely to answer four.

**Qualifying questions in the middle**, once they are committed. Budget,
decision authority, timeline. These are the ones people drop out on, which is
the point, but they drop out less once they have already invested two taps.

**Contact details last**, which is where Meta puts them anyway. By then the
prospect has spent time on the form and the phone number feels like the natural
end of something rather than the price of entry.

Never open with budget. It reads as a filter before the prospect knows what they
would be paying for, and it costs you leads who would have qualified.

## How many questions

**Three to five, depending on the service.**

| Service shape | Questions |
|---|---|
| Simple, one clear offer, low ticket | 3 |
| Standard service business | 4 |
| High ticket, long sales cycle, or the client complains about lead quality | 5 |

Below three and anyone books, which fills the client's calendar with people who
were never going to buy. Above five and cost per lead climbs without a matching
lift in quality, because the drop-off starts coming from qualified people who
are simply busy.

If the client wants more qualification than five questions allows, the answer is
a better opening question, not more questions.

## Picking the questions

The full Arabic question library lives in `question_library.md`, organised by
category with GHL field names already mapped. Pick from it rather than writing
new ones, because those are already phrased in Gulf Arabic and already have
somewhere to land in the CRM.

A reliable four-question set for a construction or design client:

1. **Service or project type**, easy opener, tells you what they want
2. **Stage or readiness**, are they actually in motion
3. **Timeline**, when they intend to start
4. **Decision authority or budget**, the hard filter, last

Swap question 4 for budget when the client's problem is tyre-kickers, and for
decision authority when the client's problem is people who cannot sign.

## The fields, all verified

### Contact information

**Phone must be required.** Never mark it optional. A lead with no phone number
cannot be called, and a client paying for calls will not accept an email-only
lead.

Contact information description:

```
يرجى إدخال أفضل وسيلة للتواصل معك حتى يتمكن فريقنا من شرح العرض لك ومساعدتك بأفضل طريقة ممكنة
```

### Privacy policy

**Off**, unless the client's industry requires one or the account has been
restricted before. It adds a step and a link out of the form for no gain on a
standard service business.

### Intro card, `context_card`

Always include one. It is the greeting, and it is where the offer goes. A form
that opens straight into questions asks for something before it has given
anything.

Use `LIST_STYLE` with a check mark on each deliverable. This is the house
pattern:

```
Title    فحص جاهزية مشروعك مجاناً
Content  ✅ مراجعة وضع المشروع والمخططات الحالية
         ✅ تحديد النواقص والاشتراطات الأساسية
         ✅ شرح نطاق العمل قبل ما تلتزم
         ✅ قائمة واضحة تمشي عليها
Button   ابدأ
```

Three to five check marks. Each one is a deliverable the client actually
provides, phrased as something the prospect receives rather than something the
business does.

**The greeting has to match the ad that brought them here.** If the ad promised
a free readiness check, the card says free readiness check. A prospect who taps
an ad about one thing and lands on a form about another drops immediately, and
you pay for the tap either way.

`PARAGRAPH_STYLE` is the alternative when the offer is one idea rather than a
list of deliverables. `LIST_STYLE` is the default because most consultation
offers have deliverables worth showing.

### Custom headline, `question_page_custom_headline`

One line above the questions. Tell them what happens after they submit:

```
سجل بياناتك يتواصل معك فريقنا لحجز موعد استشارتك المجانية
```

### Thank you page

Standard copy, use this unless the client asks otherwise:

**Headline**

```
شكرًا لك 🙏 تم استلام طلبك وسنتواصل معك قريبًا
```

**Description**

```
لقد استلمنا طلبك وحجزنا لك مكان! فريقنا راح يتواصل معاك قريبًا علشان يفهم مشروعك أكثر، يساعدك في أي استفسار، ويحدد لك موعد الاستشارة. نتطلع تواصلك وراح نكون معاك قريب إن شاء الله
```

**The button depends on what the client actually has.** Ask, do not assume:

| Client has | Button type | Goes to |
|---|---|---|
| A website | `VIEW_WEBSITE` | their site |
| WhatsApp connected to the page | `MESSAGE_BUSINESS` | the WhatsApp thread |
| Neither | `VIEW_WEBSITE` | their Instagram or Facebook page |

WhatsApp is the strongest of the three when it is connected, because the
prospect can start the conversation while intent is still high rather than
waiting for a call. Check that it is actually connected to the page before
choosing it, since a broken button on the thank you page wastes the moment.

### Quality setting, `is_optimized_for_quality`

**Ask the client, do not assume.** This setting changes the shape of the whole
form, so it belongs in intake rather than being decided at build time.

| Setting | What happens | When |
|---|---|---|
| `false`, more volume | submits on one tap, no review step | default at launch |
| `true`, higher intent | adds a confirmation step before submitting | after a lead quality complaint |

**Default to volume at launch.** A new campaign has no data, and starving it of
leads to protect quality means you learn nothing about either. Get volume first,
look at what actually books, then tighten.

Switching to quality is a real trade. Meta's own framing is that higher intent
cuts lead volume, so the client has to accept fewer leads in exchange for better
ones. Say that out loud before flipping it, because a client who expected the
same volume will read the drop as the campaign breaking.

Before switching to quality, exhaust the cheaper fixes first: tighten the
questions, add one qualifier, narrow the radius. Those cost nothing. The quality
toggle is the last lever, not the first.

The greeting matters more when volume is on. With no review step the intro card
is the only thing filtering anyone, so the deliverables on it have to describe
the offer honestly. Overpromise there and you buy a pile of leads that book and
never close.

### Other settings, house defaults

| Setting | Value | Why |
|---|---|---|
| `block_display_for_non_targeted_viewer` | `false` | no reason to hide the form from someone who found it |
| `allow_organic_lead` | `true` | the client's organic posts can collect leads at no cost |
| `locale` | match the ad | Arabic ad means `AR_AR`, English ad means `en_US` |
| `tracking_parameters` | always set | stamps every lead with client and service |

`locale` is per campaign, not per client. The same client can run Arabic and
English ads in the same month, and the form has to match the ad that produced
the lead.

`tracking_parameters` takes arbitrary key value pairs that arrive with every
lead. Use it for the things the CRM needs to route on:

```json
{"client": "monshaat-khaldaa", "service": "safety-plans", "source": "meta-launch"}
```

### Hidden tracking fields

Add these as custom questions:

```
campaign_id
adset_id
ad_id
```

They flow through with the lead into the CRM and are the only attribution that
works on an instant form. UTM parameters do not, because there is no click to a
website for anything to read them.

### Other fields that exist

Worth knowing about, rarely changed:

| Field | What it does |
|---|---|
| `locale` | form language, set to match the ad |
| `follow_up_action_url` | where the thank you button points |
| `allow_organic_lead` | lets the form collect leads outside of ads |
| `block_display_for_non_targeted_viewer` | hides the form from people outside the targeting |
| `tracking_parameters` | key value pairs stored with every lead |
| `legal_content` | custom disclaimer, only if the industry requires it |

## Building it

```bash
python3 scripts/make_form.py form_spec.json
```

Creates it as `DRAFT`. Review with the client, then:

```bash
python3 scripts/make_form.py form_spec.json --activate FORM_ID
```

Three things that bite:

**Lead forms need a Page access token**, not the system user token. The script
pulls it from `me/accounts` automatically.

**Form names must be unique on the page.** A repeat name fails with "اسم
النموذج موجود بالفعل". Put the month in the name, and if you rebuild the same
form twice in a month add a version number.

**Forms cannot be deleted, only archived.** `DELETE` returns 400. Worse, a form
created as `DRAFT` can come back as `ACTIVE` when you read it, so there is no
safe staging state. Assume anything you create is live on the client's page from
the moment it exists, and only build a form you are willing to have seen.

## Reusing an existing form

If the client already has one, check three things before pointing a campaign at
it:

- Status is `ACTIVE`, not archived or draft
- The questions still match what this campaign sells
- The CRM integration is still connected

An old form can point at a CRM that was disconnected months ago. Leads land
nowhere and nobody notices until the client asks why there are no calls.
