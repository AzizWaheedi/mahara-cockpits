# Worked example: interior design studio

A fictional but realistic build, showing what the skill produces end to end.

## Intake answers

| Question | Answer |
|---|---|
| Client | Nuzul Interiors |
| Service | Full villa interior design and fit-out |
| What they get on the call | Room-by-room concept direction, a materials shortlist, and a scope with a price band |
| Consultation type | In-office, they want people to visit the showroom |
| Office location | Riyadh, Al Olaya |
| Radius | 25km, per the in-office rule |
| Budget | $40 a day |
| Language | Arabic, Najdi register, the client is Riyadh-based |
| Lead form | Existing form, reused, confirmed Active |
| Assets | Drive folder, 5 photos of completed villas |
| Approved numbers | 9 years in business, 140 villas delivered |
| Off limits | No pricing in the ad, no delivery timeline promises |

## Naming

```
Campaign   Nuzul Interiors | VillaInterior | Leads | Sep2026 | MHM™
Ad set     VillaOwners | Broad | Lead Form
```

Ads:

```
EmptyVilla    | StaticImage | v1 | 10-09-26
ThreeQuotes   | StaticImage | v1 | 10-09-26
RegretLayout  | StaticImage | v1 | 10-09-26
HandoverGap   | StaticImage | v1 | 10-09-26
ShowroomVisit | StaticImage | v1 | 10-09-26
```

The HOOK token names the angle, not the photograph. Six weeks later `ThreeQuotes`
tells you the price-comparison angle won. `LivingRoomPhoto` would tell you
nothing.

## Assets to angles

Each photo was opened and read before any copy was written.

| Asset | What it shows | Angle | Layer |
|---|---|---|---|
| 01 | Empty villa, keys handed over, no furniture | You have the villa, now what | awareness |
| 02 | Two contrasting fit-out finishes side by side | Three quotes, three different scopes | consequence |
| 03 | Badly proportioned majlis with poor flow | The layout mistake you live with | consequence |
| 04 | Finished villa interior, warm evening light | The finished result | offer |
| 05 | The showroom itself, materials on display | Come see the materials | offer |

Two awareness and consequence ads, two offer ads, one bridge. A villa owner in
Riyadh already knows interior designers exist, so this set weights toward offer
more than a category that needs explaining would.

## Ad 02, all three copy variants

Angle: the prospect is collecting quotes and cannot tell why they differ.

**a, emojis as structure, 168 characters**

```
🏡 ثلاث عروض لنفس الفيلا، وكل واحد بسعر مختلف تماماً؟

الفرق غالباً مو بالسعر، الفرق بنطاق الشغل اللي داخل فيه.

✅ نجلس معك ونوضح إيش يشمل كل بند
✅ زيارة المعرض وتشوف الخامات بنفسك
```

**b, no emojis, 171 characters**

```
ثلاث عروض لنفس الفيلا، وكل واحد بسعر مختلف تماماً.

الفرق غالباً مو بالسعر نفسه، الفرق بنطاق الشغل اللي داخل فيه وبالخامات.

تعال المعرض، نمر على مشروعك ونوضح لك إيش يشمل كل بند.
```

**c, long form, 487 characters**

```
أصعب شي بمشروع الفيلا مو اختيار التصميم.

أصعب شي إنك تقارن بين ثلاث عروض مكتوبة بطرق مختلفة، وما تعرف ليش واحد أغلى من الثاني بمئة ألف.

والسبب غالباً إن العروض ما تتكلم عن نفس الشغل. واحد حاسب الخامة الأساسية، والثاني حاسب النجارة المفصلة، والثالث ما ذكر الإضاءة أصلاً. نفس الفيلا، ثلاث نطاقات.

إحنا نشتغل بطريقة ثانية. تعال المعرض، نمر على مخطط فيلتك غرفة غرفة، نوضح لك إيش يحتاج شغل وإيش يقدر ينتظر، وتشوف الخامات بيدك قبل ما تقرر.

تسع سنوات و١٤٠ فيلا في الرياض.
```

Notes on the set:

The 140 villas and 9 years appear only in (c), and only because both were on the
approved numbers list. Nothing else numeric appears anywhere. No pricing, no
timeline, both were ruled out at intake.

(a) and (b) are within three characters of each other on purpose. The test is
emojis, so length is held constant.

(c) opens on the prospect's real problem, which is not choosing a designer but
comparing quotes they cannot read. It earns the showroom invitation by the time
it asks.

## Brief

```json
{
  "client": "Nuzul Interiors",
  "ad_account_id": "act_XXXXXXXXXXXX",
  "page_id": "XXXXXXXXXXXXXXX",
  "lead_form_id": "XXXXXXXXXXXXXXX",
  "daily_budget_usd": 40,
  "cta": "BOOK_TRAVEL",
  "age_min": 25,
  "age_max": 65,
  "consultation_type": "in-office",
  "geo": {
    "country": "SA",
    "radius_km": 25,
    "cities": [{ "name": "Riyadh", "radius": 25 }]
  },
  "names": {
    "campaign": "Nuzul Interiors | VillaInterior | Leads | Sep2026 | MHM™",
    "adset": "VillaOwners | Broad | Lead Form"
  },
  "assets_dir": "/opt/data/bibi/workspace/clients/nuzul/ads",
  "ads": [
    {
      "name": "ThreeQuotes | StaticImage | v1 | 10-09-26",
      "image": "02-three-quotes.png",
      "description": "الرياض",
      "variants": [
        { "style": "a", "headline": "ثلاث عروض بأسعار مختلفة؟", "primary": "..." },
        { "style": "b", "headline": "ليش الفرق بالسعر كبير؟", "primary": "..." },
        { "style": "c", "headline": "قارن النطاق مو السعر", "primary": "..." }
      ]
    }
  ]
}
```

## Build and verify

```bash
python3 scripts/launch.py brief.json
python3 scripts/verify.py brief.json
```

Expected result: one campaign at $40 a day, one ad set at 25km around Riyadh
with no interest targeting, five ads each carrying three bodies and three
titles, everything PAUSED.

Read the city line in the verify output rather than skimming it. Meta accepts a
wrong city key silently, and a launch that targets the wrong Riyadh spends real
money before anyone notices.
