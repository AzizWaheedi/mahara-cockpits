# CSM decks: design plan

The onboarding deck and the launch deck, presented by the client success
manager from a client's page in the client success cockpit. This is the
design plan the build follows: tokens, type, every slide's layout and motion,
the signature element, the mockups, the ads upload, the example call, the
presenter's own views, RTL, empty states, accessibility, and what is reused.
It ends with the self-critique against the CEO's brief (section 18), the
Hallmark audit of this file (section 19), and the Gamma pass of 2026-10-20
(section 20: the partnership pie, the sales training, good to know; the
launch deck is thirteen slides since then), and the creative flexibility and
video slots pass of the same day (section 21: creative freedom in five stops
around a field of ad tiles, the video control, its player, and the notes and
prep views for it; the backend contract is `VIDEOS.md`), revised by its spec
review the same day (21.10 is the change log; training's Academy
screenshots are in 20.5). Section 22 is the visual pass of the same day:
the onboarding deck redesigned slide by slide around the call's own
checklist, one motion system for both decks, example ads drawn with
Higgsfield wherever a deck had only a logo, designed placeholder states, the
launch fixes from the last score round, and the frontend of the Drive link
import (its backend contract is `DRIVE-IMPORT.md`), revised by its spec
review the same day (22.10 is the change log). Where section 22 and an
earlier section disagree, section 22 wins.

Written 2026-10-19 on branch `csm-decks-1019`, following
`mahara-context/skills/frontend-design/SKILL.md` (brainstorm, plan, critique,
revise). Inputs: the CEO brief and the lead's decisions, the four scout
reports, the two inherited template decks (structure ideas only), the sales
deck at HEAD (`deck.css`, `DeckPage.tsx`, `journeys.tsx`, `parts.tsx`,
`content.ts`, `proof.ts`, `tour.ts`), `apps/client-success-cockpit/src/index.css`,
the voice skill and the client-facing Arabic reference, `client-comms/`,
`tools/fast-client-launch/`, the dialer's booking script, and the memory notes
on the guarantee, no leads in client messages, roles not names, brand assets,
the pitch deck and call centre data.

Copy in this file shows size and tone. The final words are in `CONTENT.md`,
`CONTENT-AR.md` and `EXAMPLE-CALL.md`; where a wireframe and those files
differ, the content files win.

Revised the same day after the critique. Where this file and `CONTENT.md`
once gave the same fact different homes, the decision table in `CONTENT.md`
now rules, and section 8.0 points to it. Section 16.2 (pictures never reused)
is binding on both files. `CONTENT.md` ends with the revision notes.

Then audited against Hallmark (section 19) for anything that would make the
decks look generated: the gradient, the glows, the side bars, the eyebrows,
the tile grid, the chat-style call, the stock motion. The fixes are written
into the sections below; section 19 lists each one and why. On words,
`CONTENT.md` still wins. On how a word is drawn (its size, colour, place and
container), this file rules, including where `CONTENT.md` names a
presentation ("eyebrow", "cards", "tiles").

---

## 1. Ground it in the subject

**Who is watching.** The owner (or a partner) of a renovation, interior,
fit-out, construction or engineering firm in the Gulf, over half of them in
Saudi Arabia. They signed days ago. They are on Zoom, usually on a laptop,
sometimes on a phone, watching a shared tab. They read drawings, programmes
and responsibility matrices for a living. They have been burned by agencies
that "just ran ads", and the most common reason a launch goes wrong is that
the client expected something different from what happens.

**Each deck's single job.**

- **Onboarding (7 slides, about 10 minutes of a 45 to 60 minute call).**
  Leave the call knowing the road, the one service we launch with, and what
  they owe us this week. The setup itself happens live; the deck is the frame
  around it.
- **Launch (13 slides since 2026-10-20, about 28 minutes of a call of about 45; section 20).** Before a single enquiry arrives,
  the client sees exactly what their customer will see and hear, who does
  each step, and agrees to the two things that decide a launch: letting us
  test creative, and marking every outcome. Then the green light.

**The subject's own world,** where the distinctive choices come from:

- the **responsibility matrix**: who does what, step by step, in columns.
  Every engineering office knows one from a project spec;
- the **programme of works**: a bar chart over real calendar weeks, with
  milestones as diamonds;
- the **drawing callout**: a leader line with a dot at one end and a label at
  the other, pointing at the part it names;
- the **customer's phone**, where every one of these steps actually lands.

### Screen-share realities (design inputs, not afterthoughts)

1. **Zoom scales the canvas down.** A 1920 x 1080 canvas shown in a 1280 px
   Zoom window is drawn at about 0.67. A 24 px label arrives at about 16 px,
   a 20 px one at 13 px. Floors are set in section 4.
2. **Zoom compresses fine detail.** Hairlines at 10% white and text in ink-3
   blur first. Anything the client must read is ink or ink-2; lines that must
   survive are at least 2 px and 22% white.
3. **Zoom sends a shared screen at a low frame rate** unless the presenter
   ticks "Optimize for video clip". Long smooth motion arrives as a few jumpy
   frames, and anything moving makes the encoder blur the text around it. So:
   motion is stepped by the presenter, short, and stops. **Nothing loops or
   pulses on any slide.** Videos play only on the phone in focus.
4. **The client cannot click.** Every interactive moment is done by the CSM,
   on purpose, as a demonstration ("watch: I put your video on the phone").
   Nothing on the canvas tells the client to click, drag or agree. Links the
   client needs go to the WhatsApp group (the notes window copies them).
5. **Everything on the shared tab is seen.** CSM-only facts never touch the
   canvas or its chrome. They live in the notes window and the prep view.

---

## 2. Brainstorm: three directions, one chosen

| Direction | The idea | Verdict |
|---|---|---|
| A. The site walk | The launch as a walk through a building: each room is a step of the system, drawn as a floor plan. | Rejected. A metaphor the client has to decode; it says nothing about who does what. Cute, not useful. |
| B. The responsibility matrix | The customer's journey drawn as a swimlane: three columns (your customer, our team, you), one line passing between them like a baton. Each step lights with this client's real asset. | **Chosen.** It is the client's own vernacular, and it encodes the launch call's real job: who does each step. The done-with-you variant falls out for free (the call steps move into the "You" column), and so does the no-show rule (a dotted line back to our column). |
| C. The customer's phone | One big phone centre stage the whole deck; the deck is a day in the customer's life. | Merged into B as the stage. On its own it hides the client's part and the team's part, and the portal and calendar do not live on the customer's phone. |

**What the chosen direction spends its boldness on:** one element, the
journey lanes, which also appear faintly on both covers and as a miniature at
the foot of every slide that zooms into one of its stops. Everything else is quiet: the sales deck's
ground, face and surfaces, the client's own words and pictures, and drawing
callouts (leaders) where a part of a mockup needs naming.

**One line language.** The lanes are drawn with three marks: a node (a ring
when ahead, a ring with a check when passed, a solid fill when current), a
line (solid teal when lit, dotted when not) and a leader. The onboarding road,
the cover's road strip, the mini rail, the reminder timeline and the green
light draw their paths with the same marks, so both decks read as one
drawing. No mark glows, no line carries a gradient, and nothing is drawn that
the subject's own drawings would not contain.

**Generic-default check.** A templated client deck in this space would be: a
logo cover, agenda bullets, an icon grid of "what's included", a horizontal
numbered stepper, a big-number stats slide, and a thank-you slide. The plan
has no stats slide, no icon grid and no thank-you slide. The stepper became
the responsibility lanes, and the one stepper left, the onboarding road, is
drawn in the lanes' own marks rather than as a web progress bar. The two
slides most decks fill with icons (goals, the service) carry the client's own
words and their own services instead.
The palette and the faces are pinned by the brand (Brand Guidelines v1.0, the
sales deck's `--dk-*` tokens), so they are followed exactly; the free axes
(layout, weights, signature, motion, and which brand tokens a slide uses at
all) are where the choices are made.

---

## 3. Tokens

### 3.1 Reused as they are (`.dk-root` in the sales `deck.css`)

| Token | Value | Use in these decks |
|---|---|---|
| `--dk-space` | `#091333` | Slide ground |
| `--dk-deep` | `#060d24` | Deep slides, video and frame grounds |
| `--dk-panel` | `#0e1a42` | Cards, the tray, the group panel |
| `--dk-panel-2` | `#132253` | Monogram ground, raised rows |
| `--dk-teal` | `#00cfc8` | The one accent: lit, ours, done, focus |
| `--dk-teal-soft` | `rgba(0,207,200,.14)` | "Ours" chips, the calendar entry's block |
| `--dk-blue` | `#2e5bd6` | Not used. It lives only inside the gradient, and the gradient is not used |
| `--dk-grad` | 135deg blue 0%, teal 65%, teal 100% | Not used on either deck. A blue-to-teal gradient on a line or a headline is the most recognised generated look, and solid teal already says "lit". The brand shows in the Mahara logo file and in the teal itself |
| `--dk-ink` | `#f2f6fa` | Primary text, and the plate behind a dark client logo |
| `--dk-ink-2` | `rgba(242,246,250,.7)` | Secondary text, anything the client must still read |
| `--dk-ink-3` | `rgba(242,246,250,.54)` | Future and inactive states only, never essential text |
| `--dk-line` | `rgba(255,255,255,.1)` | Card borders |
| `--dk-leak` | `#f5b84b` | Amber: needs the client (to give us, to do, red lines) |
| `--dk-good` | `#3ed598` | Not used. Done is teal; a second "good" colour would split the meaning |
| `--dk-ease` | `cubic-bezier(0.2,0.7,0.2,1)` | The one ease-out curve, for everything that arrives (5.3) |
| `--dk-edge` | `rgba(0,207,200,.72)` | The one hover signal on the canvas: a border turning teal |
| `--dk-hover-ms`, `--dk-halo`, `--dk-drop` | as defined | Not used. The sales hover lifts a card, rings it, haloes it in teal and drops a shadow at once: four effects, one of them a glow on a dark ground, and the client watches every hover the presenter makes |

**Colour meanings, kept to three:** teal is lit, done and ours; amber is
anything that needs the client; ink tiers carry everything else. The
"You" column is plain ink, not amber, so the client's steps never read as a
warning. Nothing borrows teal for decoration: the client's name, the client's
logo and monogram and the client's own words are ink, because teal means
ours or lit.

### 3.2 Added (on `.dk-root` in the CSM deck's own `present.css`)

| New token | Value | Why |
|---|---|---|
| `--dk-leak-soft` | `rgba(245,184,75,.14)` | Amber's fill twin, exactly as `--dk-teal-soft` is teal's. For "to give us" slots and "To do" chips. Not the red-lines panel since the visual review of 2026-10-20: over navy it rendered as a neutral charcoal (42, 42, 54), a grey card from another palette; the panel is `--dk-panel` with a 1 px `--dk-leak-line` hairline, and the amber marks say "theirs" (21.1). |
| `--dk-teal-faint` | `rgba(0,207,200,.08)` | The band behind the current journey row. Teal-soft at full row width was heavier than the content in it. |
| `--dk-lane` | `rgba(255,255,255,.045)` | The swimlane columns. A panel fill would be too heavy for three full-height columns; below .04 the band vanishes in Zoom. The column heads and node positions carry the meaning; the band only supports it. |
| `--dk-line-strong` | `rgba(255,255,255,.22)` | Lines that must survive Zoom compression: the unlit journey path, leaders, phone edges. `--dk-line` at .1 disappears in a share. |
| `--dk-draw-ms` | `520ms` | The journey line drawing to the next stop. |
| `--dk-swap-ms` | `240ms` | A creative swapping inside a phone. |
| `--dk-beat-ms` | `260ms` | A turn of the example call arriving. |
| `--dk-cut-ms` | `200ms` | A slide arriving: one opacity crossfade of the whole slide. |
| `--dk-hover-canvas-ms` | `120ms` | The border turning `--dk-edge` on hover. |

No new hue, and no gradient. Royal Blue stays unused with the gradient it
lives in.

**Locked values.** Every colour on the canvas is one of these tokens or a
mockup colour from 3.3. Anything drawn on teal (the current node's dot, a
Done chip's text) uses `--dk-deep`; there is no separate dark-on-teal hex.
Translucent fills are only the `-soft`, `-faint` and `--dk-lane` tokens
above. Outside a mockup nothing on the canvas is see-through and nothing is
blurred; inside one, only what the real app does (the Reels scrim and button,
7.3).

### 3.3 Mockup fidelity colours (scoped, never deck colours)

The phone and message mockups use the real apps' dark-mode colours, scoped to
`.dkc-app[data-app="…"]` and never used outside a mockup. They exist so the
chrome is honest; they are not part of the deck palette.

| Scope | Values |
|---|---|
| `ig` (Instagram dark) | ground `#000000`, text `#f5f5f5`, secondary `#a8a8a8`, separators `#262626` |
| `fb` (Facebook dark) | feed `#18191a`, card `#242526`, text `#e4e6eb`, secondary `#b0b3b8`, button `#3a3b3c` |
| `form` (Meta instant form, dark) | ground `#0e1013`, option border `#2d3035`, text `#f5f5f5`, button `#0866ff` |
| `wa` (WhatsApp dark) | ground `#0b141a` (already the sales `.dk-chat`), incoming `#202c33`, text `#e9edef`, time `#8696a0` |

---

## 4. Type

Geist for words and figures; Geist Mono for one job only, the labels of
record (provenance tags, the cover datelines, times and durations, the slide
count); IBM Plex Sans Arabic for Arabic (Geist has no Arabic). Fonts load from a `<link>`
in `apps/client-success-cockpit/index.html`, never `@import` (the trap that
broke the sales deck on 2026-10-13; the CSM `index.css` still imports Geist
that way and gains the Plex `<link>` beside it).

### 4.1 The scale (canvas pixels at 1920 x 1080)

| Role | English | Arabic |
|---|---|---|
| Display (covers, the green light question) | Geist 700, 118/1.02, -0.035em | Plex 700, 112/1.2 |
| H1 | Geist 700, 80/1.06, -0.03em | Plex 700, 84/1.25 |
| H2 (slide titles) | Geist 700, 56/1.12, -0.025em | Plex 700, 60/1.3 |
| H3 | Geist 700, 40/1.2 | Plex 700, 42/1.35 |
| Lead | Geist 400, 40/1.38, ink-2 | Plex 400, 40/1.6 |
| Body | Geist 400, 30/1.45 | Plex 400, 32/1.65 |
| Small | Geist 400, 24/1.4 | Plex 400, 26/1.55 |
| Owner line (`CONTENT.md`'s `*.eyebrow`, see 8.3) | Geist 500, 24/1.3, sentence case, in its lane's tone | Plex 500, 26 |
| Dateline (the two covers) | Geist Mono 24, ink-2 | Plex 500, 26 |
| **New:** client's words (goals) | Geist 400, 60/1.18, -0.02em, ink | Plex 400, 60/1.5 |
| **New:** journey row name | Geist 600, 26/1.2 | Plex 600, 28/1.35 |
| **New:** lane head, column head | Geist 500, 24, sentence case | Plex 500, 26 |
| **New:** speaker name (the call) | Geist 500, 24/1.3 | Plex 500, 26 |
| **New:** call line (Arabic, in both decks) | Plex 500, 32/1.6 | same |
| **New:** call subtitle (English) | Geist 400, 24/1.4, ink-2 | hidden by default |
| **New:** call clock | Geist 600, 72, tabular, Latin digits in both languages (see 13.4) | same |
| **New:** callout label (leader) | Geist 500, 24/1.3, ink | Plex 500, 26/1.45 |
| **New:** provenance tag | Geist Mono 24, ink-2, no pill | Plex 500, 26 |
| Chip, status | Geist 600, 24 | Plex 600, 26 |

**Rules the table follows.**

- Headings are 700 over body at 400: a 300-unit step. The sales deck's 600
  over 400 reads as a default setting rather than a choice. Labels and chips
  sit between, at 500 and 600.
- The client's own words are set at 400, lighter than every heading. Their
  voice is quieter than ours on purpose, and that weight, with the source
  line under it, is what marks them as theirs (9.2).
- No italic anywhere, headings included. No `text-transform` and no tracked
  capitals: Arabic has no case, so a design that leans on capitals would
  look different in the other language. Everything is sentence case.
- Geist Mono has one job, the labels of record. It is never set above a
  title, never on a lane or column head, and never on a speaker's name.
- At most five sizes on any one slide. Lead and H3 share 40: they differ by
  weight and ink, not by a 2 px step.
- `font-variant-numeric: tabular-nums` on every figure that changes or lines
  up: the call clock, the week dates, the reminder times, tray durations and
  the slide count.

### 4.2 Floors for a shared screen

- Anything the client must read: at least 24 px English, 26 px Arabic, in ink
  or ink-2.
- Secondary, nice-to-read (sources, the mini rail's label): 20 to 21 px,
  never carrying a fact that matters.
- Provenance tags carry the honesty of a picture, so they are held to the
  24 px floor everywhere, not to the secondary floor. So are chips and
  callout labels: the client reads all three.
- Text inside phone mockups is set in the phone's own logical units (section
  7.1), at 1.25x the real app's size, so it survives the share in focus mode.

### 4.3 Numbers

Every figure goes through the copied `Fig` / `figure.ts`: Arabic-Indic digits
in Arabic, Plex 700 at 1.17x, never `٬`, money from 10,000 up in words (no
money appears in these decks anyway). Step numerals are written from the
string `"١٢٣٤٥٦٧٨٩"`, never with a leading `٠`. No Arabic time or date is ever
set at headline size (a `٠` beside a colon reads as a dot); dates on covers
use the month name, and the call clock uses Latin digits (13.4).

---

## 5. Layout and motion system

### 5.1 The canvas

The sales engine as it is: a 1920 x 1080 `.dk-canvas` scaled to the window and
centred by hand, one slide mounted at a time, keyed by slide and language so
the entrance replays on a language switch. Because a slide unmounts when the
CSM moves on, anything typed, placed or uploaded lives in the deck context at
shell level, not in the slide (16.4).

Padding by slide kind:

| Slide kind | Padding (top, inline, bottom) | Content box |
|---|---|---|
| Launch slides with the mini rail (3 to 6, 8 and 9 since 2026-10-20) | 96, 136, 132 | y 96 to 948 |
| Slides without a rail (covers, journey, 7 and 10 to 13, all onboarding) | 112, 136, 104 | y 112 to 976 |

The slide count sits at the foot, end side (`.dk-count`), on every slide but
the covers.

### 5.2 Stops

Every slide declares `stops`. → and ← (and a clicker, Space, PageUp/Down)
walk a slide's stops before leaving it, and coming back lands on the last
stop, exactly as the sales engine does. A stop is the unit of motion: one
press, one change, then stillness.

### 5.3 Motion vocabulary (all of it)

| Motion | Duration | Where |
|---|---|---|
| Slide arrival | `--dk-cut-ms` 200 ms, opacity only, the whole slide at once | Every slide |
| Stage swap | 420 ms, opacity only | A stop's picture changing |
| Line draw | `--dk-draw-ms` 520 ms | The journey line to the next node; the road's line to "Today" |
| Leader move | 300 ms | The journey's leader following the lit node |
| Row band slide | 300 ms | The current journey row moving |
| Creative swap | `--dk-swap-ms` 240 ms, opacity only | Inside a phone screen |
| Call turn | `--dk-beat-ms` 260 ms, opacity and a 12 px rise | The example call |
| Bar drawing | 600 ms, a `scaleX` from the inline-start edge | The 90-day programme |
| Canvas hover | `--dk-hover-canvas-ms` 120 ms, border colour only | Canvas controls (12.1) |

**What the vocabulary leaves out on purpose.** No per-block entrance
stagger: blocks rising one after another on every slide is the stock deck
entrance, and on a share sent at a few frames a second it is the blur
section 1 warns about. No typing dots (11.2), no cross-slide hand-off (6.7),
no scale on a swap, no lift, shadow or glow on hover. Every motion that is
left carries meaning: a line reaching the next step, a picture changing, a
turn of the call, the programme's first bar. One press makes one change, then
everything is still.

Animated properties are `transform` and `opacity` only; a drawn line uses
`stroke-dashoffset`. Everything arrives on `--dk-ease`, and an exit, where
there is one, takes 75% of its entrance. Nothing loops, pulses, drifts or
autoplays off-focus. The sales deck's `LogoRiver`, count-ups, `dk-up` rise
and hover halo are not used.

### 5.4 Provenance tags

Every picture that could be mistaken for live data carries a small tag
(Geist Mono 24 in ink-2, set as a caption, with no pill, fill or border;
generalised from the sales `.dk-demo-badge`). It sits outside the picture's
frame, above its end corner, so it never covers a phone's status bar. Because
it never sits on a picture, it needs no ground of its own; a translucent pill
there would be glass for its own sake.

| Tag | On |
|---|---|
| Preview | Every ad mockup shown on its own. On the ads slide it sits once, after the title on its baseline (`CONTENT.md` L4), and the three phones carry none, so the slide does not say "Preview" four times |
| Starter, from our templates | Every starter ad, on the phone and on its tray thumbnail |
| Your form | The instant form, drawn from their confirmed form |
| Example form | The drawn example form, when no form is confirmed |
| Example | The queue card, the calendar entry, the appointment card |
| Example wording | The WhatsApp confirmation |
| Example written from our script | The call transcript |
| Illustration | Creative freedom's field of ad tiles (stops 1 to 5, section 21.1) |
| Academy screenshot | Training's two masked screenshots (stops 1 and 2, section 20.5) |
| Demo workspace | Mahara OS screenshots (fictional "Demo Studio") |

The tag is the structure telling the truth about each picture.

---

## 6. The signature: the journey lanes

One enquiry's path from their ad to their answer, drawn as a responsibility
matrix. Rows are the seven steps in order. Three columns are who does the
step: **your customer**, **our team**, **you**. One line, the enquiry, passes
between the columns like a baton, and it lights as the presenter walks it.
Each row's name sits beside its node, inside the owner's lane, so the words
step across the columns as ownership passes. Each stop's stage shows this
client's own asset, joined to the lit node by a drawing-callout leader.

### 6.1 Wireframe (English, stop 3 of 7)

```text
1920 x 1080, 1 char ~ 20 px wide, 1 row ~ 40 px tall
x 136       x 336 348      x 548 560      x 760  x 832                                    x 1784
+--------------------------------------------------------------------------------------------+
| Your customer's journey                                   (H2, y 112)                      |
| From your ad to your meeting, step by step.               (lead, y 186)                    |
|                                                                                            |
|  Your customer      Our team           You                (lane heads, Geist 500 24, y 252)|
|  :             :    :             :    :             :    (the lane bands start here)      |
|  (v) Sees your ad                                         [ Our team does this ]           |
|   |                                                       We call new enquiries within 5   |
|  (v) Answers your questions                               minutes during working hours,    |
|     \________                                             10 to 6, Saturday to Thursday.   |
|#             (o) We call                                  Anything that comes in at night  |
|               |  \___________________________________ .   is called from 10 the next       |
|               :  Booked, confirmed, reminded          \   working morning.                 |
|               :.......                                 \  [ Up to 4 tries over 3 working   |
|                       ( ) Lands with you                \   days ]                         |
|                        :  You meet                       > +--------------------------+    |
|                        :  You mark it                      | New enquiry · Kitchens   |    |
|                                                            | Try 2 of 4 · Bathrooms   |    |
|                                                            | Callback · Villa fit-out |    |
|                                                            | Not reached · noted      |    |
|                                                            +--------------------------+    |
|   (v) passed node   (o) current node   ( ) future node      Not every enquiry books. ...   |
|   #   current row band (--dk-teal-faint fill only, no edge bar)                      02/10 |
+--------------------------------------------------------------------------------------------+
```

Geometry:

- Three lanes of 200 px with 12 px gaps: x 136 to 336, 348 to 548, 560 to
  760. There is no separate names column.
- A 72 px gap, then the stage, x 832 to 1784 (952 px).
- Seven rows of 92 px, y 300 to 944. Lane heads at y 252.
- Nodes are 28 px circles, centred 34 px in from their lane's inline-start
  edge (x 170, 382 and 594 in English).
- No foot rail on this slide: it is the rail.

### 6.2 Anatomy

- **Lane heads.** Geist 500 24, sentence case (Plex 500, 26): "Your
  customer" in ink-2, "Our team" in teal, "You" in ink. "Your customer" at
  24 px is about 170 px wide, so it fits its 200 px lane. No rule under the
  heads: three coloured underlines would be accent rules, and the band under
  each head already makes the column.
- **Lane bands.** Each lane is a full-height `--dk-lane` band with 12 px
  radius, starting just under its head, so ownership reads as columns at a
  glance.
- **Row names.** 26/600 (Plex 600, 28), set 16 px after the node on its
  centre line. A name may run on into the lanes to its inline-end side, which
  are always empty on that row, but never past x 800. Names in the "You" lane
  are kept to 14 characters (16 in Arabic). Past rows ink-2, current ink on
  the row band, future ink-3.
- **Nodes.** Future: 2 px ring in `--dk-line-strong`. Passed: 2 px teal ring
  with a teal check. Current: solid teal fill with an 8 px `--dk-deep` dot at
  its centre. No glow, no halo, no pulse. Fill against ring is the whole
  difference, and it survives a Zoom share, where a soft glow arrives as a
  blocky smudge around the one thing the client should read.
- **The line.** One SVG path through the node centres. Within a lane it is a
  straight vertical; at a handover it is an S curve between the two rows
  (cubic, control points half a row above and below). The lit part is 3 px
  solid teal, round-capped, with no glow and no gradient. The unlit part is
  2 px, round-capped dots (dash 2, gap 8) in `--dk-line-strong`.
- **Handover chevrons.** A 10 px chevron at the middle of each S curve, lit
  teal once passed.
- **The leader.** A 6 px teal dot on the lit node and a 2 px
  `--dk-line-strong` line that runs 22 px under the row name, along the row,
  to x 800, then straight to the nearest edge of the stage picture. It moves
  with the lit node (300 ms). This is the drawing-callout vernacular from
  section 1, so the picture visibly belongs to the step.
- **The fork (stop 6).** From the "You" node of "You meet", a dotted curve
  returns to the "Our team" lane and ends in a hollow node with a small
  rebook arrow. It appears from stop 6 on. Done with you: the curve returns
  within the "You" lane.
- **The SVG holds no text.** Every word is HTML positioned with logical
  properties, so the drawing mirrors cleanly in Arabic (6.9).

### 6.3 The stops: owner, stage picture, home of which fact

Words and fallbacks are in `CONTENT.md` L2. "Thin" stops have their own slide
later; on the journey they get one line and the picture. "Home" stops are the
one place a fact is explained (the decision table in `CONTENT.md`).

| # | Row name (EN) | Owner (done for you) | Owner (done with you) | Stage picture | Thin or home |
|---|---|---|---|---|---|
| 1 | Sees your ad | Customer | Customer | Their first ad in the Instagram feed phone (7.2), or the Reels phone if they only have video | Thin (slide 3) |
| 2 | Answers your questions | Customer | Customer | Their confirmed form's question screen in a phone (7.5), the example form tagged "Example form", or their landing page or WhatsApp destination | Thin (slide 5) |
| 3 | We call | Our team | You | The call queue card (6.5) | Home of the call within 5 minutes with the hours and the night rule, the list (the card), the tries and "not every enquiry books" |
| 4 | Booked, confirmed, reminded | Our team | You | The five-dot strip (6.5), no words | Thin (slide 6, stop 7) |
| 5 | Lands with you | You | You | The calendar entry (6.5); the amber "Connect Google Calendar" line when the kickoff says it is not connected | Home of the calendar, Mahara OS and the alert |
| 6 | You meet | You | You | `meeting-table.webp` cropped across the top of the stage, with no scrim, and the fork's two cards beneath it (6.4) | Home of who follows up after the meeting (the fork) |
| 7 | You mark it | You | You | `portal-outcome-{lang}.webp` as a plain figure (1 px `--dk-line-strong` edge, 16 px radius, no browser bar), cropped to the form (Demo workspace) | Thin (slide 7) |

**Stage layout.** Two kinds:

- **Phone pictures** (stops 1 and 2): the phone at the stage's inline-start,
  640 px tall (y 300 to 940, about 310 px wide), with the owner chip and the
  stop's words beside it in a 594 px column (x 1190 to 1784).
- **Card pictures** (stops 3, 5, 6 and 7): the owner chip and the words at the
  top of the stage, the card beneath, both the stage's width. Stop 4 is its
  line and the five-dot strip only.

The owner chips read "Your customer", "Our team does this" and "You do this".
Words people must read go on large cards, not inside phones, so they stay
legible in the share.

### 6.4 Stop 6, the fork

The meeting's two outcomes (drawn in the lanes' line language since 19.11):

- **"Didn't show?"** Ours. We call to rebook.
- **"Came, and thinking it over?"** Both of us. We call to follow up, and so
  do you: you know them best. Then mark it.

This is the one place either deck says who follows up after a meeting. The
no-show matches the Client Process Map: its dotted return and rebook mark are
ours, in teal. The customer thinking it over is shared done for you, by the
CEO's answer of 2026-10-20 ("We will call them to follow up to rebook but also
the client has the most context and should follow up as well"): that end keeps
the meeting's line and node, because the client still marks it, and its line
stays in the client's ink-2 with its first sentence, "Both of us.", in our
teal, so the drawing says the follow-up is shared. Done with you is unchanged:
their team makes the calls, and the whole fork stays in the "You" lane. The
portal slide keeps only "mark it, the same day".

Since score round 2 (21.13) the stop's words sit at the stage's top, where
stops 3 and 5 set theirs, and the fork alone is set level with "You meet":
the came end rises 84 px off the meeting's line (40 px over a one-line
line, done with you) and the no-show's end drops just clear of it, so the
whole fork ends above the lanes' foot in Arabic's taller lines too.

### 6.5 The drawn cards (our own UI, so deck tokens)

**The call queue card (stop 3).** A `--dk-panel` card at the stage's width,
drawn as a simplified version of our dialer's list: four rows, no names, no
phone numbers, services from their own chips (fallback "your service").

1. "New enquiry · {service}", first in the list, its place number in teal on
   the row band. No chip done for you (done with you, one ink chip, "Your
   team", 6.8). On arrival it drops in from above and pushes the others down.
2. "Try 2 of 4 · {service} · 5 pm"
3. "Callback · {service} · 10 am"
4. "Not reached after 4 tries · reason noted", in ink-3.

The new row carries no clock and no speed chip: the stop's words beside the
card already say the call within 5 minutes during working hours (copy rule
1), and the card shows the order, so a timer or a speed chip would only say
it a second time. Under it, one ink-2 line, with no glyph (a moon would be
decoration; the words say night): "Came in at night? Called from 10 the next
working morning." Tag: Example. It shows the true
mechanism without a fake caller ID on a phone.

**The five-dot strip (stop 4).** Five 12 px dots on a 2 px line, the first
teal, no labels. The call's stop 7 lights the same strip with its words
(11.5), so the client recognises it there.

**The calendar entry (stop 5).** A `--dk-panel` day column, 520 px wide: the
day's name at the top, then four hour lines in ink-3 from the hour the
example call books (4 pm, earlier for a client who closes earlier), the
first carrying one teal-soft block reading "Appointment · {place}", so the
block sits level with "Lands with you" and the leader ends on it, straight. No customer name and
no phone. Tag: Example. It is not `portal-overview`, which belongs to the
portal slide.

### 6.6 Motion

- **Arrival:** the slide crossfades in whole (5.3), with no stagger; stop 1
  is lit; the line has not started; the leader points at stop 1's picture.
  The first press is the first movement the client sees.
- **→:** the line draws from the current node to the next (520 ms); the
  chevron at a handover lights as the line passes it; the row band slides and
  the leader moves (300 ms); the stage crossfades (420 ms). Then nothing
  moves.
- **←:** the same in reverse, instantly for the line (no un-drawing
  animation).
- **Click a row** (or a node): jump there; the line draws in one go.
- **Reduced motion:** every state is set instantly, and the queue card's rows
  are already in place.

### 6.7 The mini rail (the journey at the foot of slides 3 to 6, 8 and 9)

Slides 3 to 7 each open one stop of the journey (ads: 1, creative freedom: 1,
form: 2, the call: 3, then 4 at its stop 7 and 5 at its stop 8, portal: 7).
Their foot carries the journey in miniature, so the client always sees where
the slide sits on the path. The rail is the callback: the presenter never
says "we'll look closer in a minute".

```text
x 136                                                                   x 1590      x 1784
  customer  o---o
  our team        \--o---o
  you                     \--o---o---o                                              05 / 10
            (rows 8 px apart, nodes 10 px, columns 182 px apart; only the current node
             is lit, with its short name to its inline-end side, Geist 20 ink-2)
```

Since 2026-10-20 (20.1) the training slide (8) lights stop 6, "You meet",
and the portal moved to slide 9; the partnership slide (7) carries no rail.

It sits at the foot (bottom 44, height 56) where the sales deck's pillar rail
sits. It is not shown on the covers, the journey itself, or slides 7 and 10
to 13.
The green light slide draws it large and fully lit (8.10).

**No hand-off animation.** The first plan scaled the lit node from the lanes
down into slide 3's rail. That is a showpiece transition the engine cannot
do without mounting two slides, and the rail already makes the callback by
being the same drawing in the same place. On slide 3 the rail is simply
there.

### 6.8 Done with you

When `serviceModel()` says DWY, stops 3 and 4 sit in the "You" lane, their
words become the client's team's job ("Your team calls", "Your team books"),
the queue card's new row carries one ink chip, "Your team" (who calls; the
words beside it say how fast), the line visibly stays in the client's column
for those steps, and the fork's dotted curve stays in the "You" lane. Unknown service model: done for
you, with a prep warning (section 12).

### 6.9 RTL

The lanes run from the right in the same order (customer, our team, you).
Each name starts after its node, on the node's left. The SVG layer, leader
included, is mirrored with `transform: scaleX(-1)` (it holds no text). The
line is solid teal, so nothing has a direction to keep. Chevrons point toward
the inline end.

---

## 7. Phone and message mockups

Honest and minimal: the parts of the real app that tell the client where the
ad will be, nothing invented. No like counts, comment counts, follower counts,
dates or fake comments. "Sponsored" is always shown, because it is true and
because it carries the point that paid ads do not appear on their page.

### 7.1 The shared frame

The sales `Phone` geometry (12 px bezel, 46 px radius, 35 px screen radius,
the island) holds every ad and form mockup. Its finish is flattened: a flat
`--dk-deep` bezel with a 1 px `--dk-line-strong` edge and one tight dark drop
shadow, in place of the sales phone's gradient bezel, inner highlight and
deep 80 px shadow. The phone is the subject of these slides (show the client
their ads as their customer will see them), so it is drawn; it is drawn as
plainly as the device, with no gloss, tilt, reflection or glow. Phones appear
only where the customer's screen is the point: the ads, the form and its
destination, the journey's first two stops, creative freedom's first stop,
the starter-ads stop and the cover's custom creative.

Inside, the screen is laid out in logical units on a 390u
wide, 845u tall screen (`1u = screen width / 390`), so one layout serves every
size. UI text is set at 1.25x the real app's size in those units, which keeps
it readable in focus mode on a share. Status bar: 47u, a fixed time "10:24"
at the inline start and a battery glyph at the end, nothing else.

**One app language for every phone on a slide.** The language most of the
client's creatives are in, else the deck's. A swap never flips it. Each ad's
own text keeps its own direction inside the chrome (an Arabic caption in
English chrome is set `dir=rtl`). Leader targets are computed from the
measured rects of the mockup's elements, so they point at the right part of a
mirrored phone. The deck's own words around the phone follow the deck.

**The avatar,** in this order:

1. The Facebook Page's own profile picture from Meta, through the ad's
   `page_id` and the media API, once Leadsie access exists. That is what
   customers will see.
2. The logo, fitted with `contain` on an `--dk-ink` plate when the logo is
   dark (or a `--dk-deep` plate when it is light; auto-detected by average
   luminance, overridable in prep). A wide wordmark is never cropped into the
   circle.
3. The monogram (7.7).

The avatar is a plain circle everywhere, inside app chrome and on deck
surfaces. It never takes a teal ring: teal means ours, and the logo is
theirs.

**The page name:** prep, then the kickoff form's Facebook page name, then the
client's name.

**The foot of the screen** shows the app's real bottom tab bar (icons only:
home, search, create, reels, profile on Instagram; the Facebook equivalents),
so no screen ends in a black void. It is true chrome, not invented content.

### 7.2 Instagram feed (dark)

```text
+------------------------+   logical units, 390u wide
| 10:24             [##] |   47u status
| (o) Page name      ... |   54u header: avatar 32u, name 17u/600, "Sponsored" 15u
|     Sponsored          |
| +--------------------+ |
| |                    | |   media 4:5 (390 x 487u) or 1:1 (390 x 390u)
| |   their creative   | |
| |                    | |
| +--------------------+ |
| Learn more           > |   44u call-to-action bar, 16u/600
| (heart)(talk)(send) (save)  46u actions, outline icons, no counts
| Page name Their primary|   caption: name 600 + primary text, 2 lines, 17u
| text runs to two... more|
|                        |
| (home)(search)(+)(reels)(me)  56u bottom tab bar, icons only
+------------------------+
```

### 7.3 Reels and Stories (one 9:16 frame)

Full-bleed creative (cover crop). A bottom scrim (black 0 to 60% over the last
30%) carries: avatar, page name, "Sponsored"; one caption line; a full-width
call-to-action pill (`rgba(255,255,255,.18)`, backdrop blur) "Learn more >".
The action rail (heart, comment, send, more) at the inline end, outline, no
counts. A 1:1 or 4:5 file placed here sits centred over a blurred copy of
itself, as Meta shows it. Label under the phone: "Reels and Stories".

### 7.4 Facebook feed (dark)

Header 56u (avatar 40u, page name 17u/600, "Sponsored · globe" 15u). Primary
text above the media, 3 lines, "See more". Media 1:1 or 4:5. Under the media
the link strip: headline 17u/600 and description 13u in secondary at the
inline start, the call-to-action button (`#3a3b3c`, 15u/600) at the end.
Actions row: Like, Comment, Share as icon plus word, no counts. The bottom tab
bar at the foot.

### 7.5 Meta instant form (dark)

Drawn from the form the CSM confirmed in prep (`prep.form_confirmed`, matched
by the exact Meta form id from this client's own campaigns), never from
another client's screenshot and never by a name match. Three screens:

- **Intro:** close mark, their avatar, page name, the form's headline and
  greeting.
- **Questions:** each question title (17u/600) and its options as rounded rows
  with a radio circle at the inline end (the look of the real form). Contact
  fields show as empty fields labelled "Full name", "Phone number" with a small
  "Filled in by Meta" note; no phone number is ever drawn. A blue "Next" button
  at the foot.
- **Thank-you:** avatar, the thank-you headline and text, and the button only
  if the form has one.

**The example form.** When no form is confirmed, the same three screens are
drawn with the example greeting and three generic questions from
`CONTENT-AR.md` (L5), the second marked "Filters", under their own avatar and
Page name. Tag: "Example form". Its thank-you is the default one.

**The default thank-you.** Their avatar and "Thank you. Our team will call you
within 5 minutes during working hours." No button. A video frame (a 16:9
poster with a play glyph) shows only when `prep.welcome_video` is on.

A WhatsApp destination draws a WhatsApp chat opening with the prefilled
message. A landing page shows a prep-uploaded phone screenshot of the page in
the phone, because this is the form slide and the phone is the subject; the
live pop-up opens only if the page can be framed. The sales `Devices` pair is
not used: its laptop half is a drawn browser bar (dots and an address), which
is chrome the client's own screen already has.

### 7.6 The WhatsApp confirmation card (not in a phone)

A large `.dk-chat`-style card, 620 px wide, on WhatsApp's dark ground: a
header with their avatar (7.1) and business name (the message comes from their
own WhatsApp number through Mahara OS), then one incoming bubble in the live
template's structure, as a live message shows it: an opening line, then the
date, the time and the location on their own lines, then a closing line. The
words are in `EXAMPLE-CALL.md`. The date and time keep the template's Latin
digits ("October 26, 2026", "4:00 PM") in both decks, a stated exception like
the call clock (13.4). The office location is drawn as link-styled text with
no real address or link. Body text 26 px canvas, the time stamp in `#8696a0`.
Nothing else from the app: no read ticks, no "online" line, no input bar, no
wallpaper pattern. It is in WhatsApp's colours because it is what the
customer receives, the same reason the ads are in phones. Tag: Example
wording, until the template's own text is copied word for word (section 17).

### 7.7 Monogram

**Superseded on 2026-10-20 by 22.5.1:** one letter in a rounded-square tile
on deck surfaces, one letter in a circle inside app chrome.

Logos exist for 10 of 55 clients, so the monogram is the deck's normal look
and is designed as one, not as a broken-logo fallback.

- A 112 px circle on `--dk-panel-2` with the initials in Geist 600 (Plex 700
  for Arabic). No ring anywhere (7.1): a 1 px `--dk-line-strong` edge on deck
  surfaces, nothing inside app chrome.
- The initials skip generic words: شركة، مؤسسة، مكتب، مجموعة and the ال
  prefix; The, Co, Company, Group, Est. Two initials for two remaining Latin
  words; the first letter of the first remaining word for an Arabic name.
- Never a broken image, never an empty circle.

### 7.8 Legibility in practice

| Where | Phone height | 1u in canvas px | Caption size |
|---|---|---|---|
| Journey stage | 640 | 0.76 | 13 px (a picture; the stage words carry the meaning) |
| Ads overview (three phones) | 760 middle, 680 sides | 0.82 to 0.73 | 12 to 14 px (the gestalt) |
| Ads focus | 852 | 1.0 | 17 px, with leaders naming the parts in deck type |
| Form focus | 812 (772 under its tag) | 0.93 (0.88) | 16 px, with the question list beside it in deck type; the phone ends 50 px above the mini rail's name |
| Creative freedom, stop 1 | 520 | 0.62 | a picture; one leader names "Sponsored" |
| Cover and onboarding starter stop | 640 to 760 | 0.76 to 0.9 | a picture |

### 7.9 Other drawn pieces

- **The WhatsApp group (onboarding slide 3).** A 1100 px deck panel
  (`--dk-panel`, 16 px radius), aligned to the content's inline start: a
  header with their avatar, the real WhatsApp mark (`platforms.tsx`) and
  "Your WhatsApp group", then five rows set as a two-column list, the role in
  26/600 ink in a 420 px column and its line in 26 ink-2. No role glyphs in
  circles, no faces, no names, no initials. It is not drawn in WhatsApp's
  colours or chrome: WhatsApp never shows a list of roles and what each one
  messages about, so drawing its screen would invent one. It is a diagram of
  their group, so it carries no tag and no fake messages.
- **The appointment card (the call's stop 8).** A `--dk-panel` card, 760 px
  wide: "New appointment" (H3), then customer, when, where and service as
  label and value rows, then "Our caller's notes" as a short list. Tag:
  Example. It is not drawn as a WhatsApp or Slack frame, because what the
  client's own alert looks like is not checked yet (section 17).
- **The test tiles (creative freedom, optional stop 4).** Twenty 120 px tiles
  in a 5 x 4 grid, `--dk-panel` with no image inside, each with a small toggle
  in Meta's on/off shape: 11 lit (teal toggle, full opacity) and 9 dimmed
  (toggle off, tile at 35%). No thumbnails, no columns, no money. Tag:
  Illustration. **Superseded 2026-10-20 by the field of ad tiles (21.1),** a
  core stop now: eighteen 4:5 tiles, most switching off.
- **The road strip (launch cover).** The onboarding road (9.5, in the
  journey's marks) at 40% scale under the go-live date, lit up to the
  launch call, its lit node named "Launch call · Today" under that node,
  starting at it. The strip's end (first appointments) is not named, so it
  never reads as today or as go-live. No other words.
- **The CRM stage list (portal slide, done with you).** Four `--dk-panel`
  rows: didn't show, showed, quote sent, closed, with a teal arrow between
  them. Drawn because no screenshot of the client's own CRM exists.

---

## 8. The launch deck, slide by slide

Thirteen slides since 2026-10-20, about 28 minutes of a call of about 45.
Every slide in English and Arabic. The order: cover, journey, your ads,
creative freedom, your form, the call, partnership, training, your portal,
your part, the first 90 days, good to know, green light. The subsections
below keep their numbers: 8.7 is slide 9, 8.8 slide 10 (its layout replaced
by 20.7), 8.9 slide 11, 8.10 slides 12 and 13 (20.9, 20.10). The new slides
are in section 20.

### 8.0 One home per fact

The decision table in `CONTENT.md` ("Decision table, binding for both files")
is the one list of homes, and this file follows it. In short:

- the call within 5 minutes with the hours and the night rule, the list, the
  tries and "not every enquiry books" live on journey stop 3 (the form slide
  repeats only "within 5 minutes during working hours", in its thank-you and
  its WhatsApp step);
- the confirmation and the reminders live on the call's stop 7, and journey
  stop 4 is one line and five unlabelled dots;
- what lands with the client lives on journey stop 5, and the call's stop 8
  shows what it carries;
- the fork lives on journey stop 6: a no-show is ours, and a customer
  thinking it over is followed up by both of us, done for you;
- the thank-you screen lives on the form slide;
- "the numbers decide" lives on creative freedom, once, and since
  2026-10-20 so does the rest of creative flexibility: the ads' job, the
  volume, the client's input first, the quick check and the content (21.1);
- marking outcomes ends the portal slide;
- the check-in rhythm (weekly or every two weeks after the first) lives on
  the 90 days;
- group hours and the reply time live on onboarding slide 3; the good-to-know
  slide's replies row shows only for a client who never saw the onboarding
  deck;
- who does what, as a share (the pie, the two roads), lives on the
  partnership slide; the sales training on the training slide; the money
  rows on the good-to-know slide (section 20).

Any other appearance is a picture or the mini rail, not a second explanation.

### 8.1 Cover: "<Client> goes live"

```text
+--------------------------------------------------------------------------------------------+
| [MAHARA logo, 64 px]  Launch call · 19 October           Presented by <First name>         |
|                       (dateline, Mono 24, ink-2)         Your client success manager       |
|                                                                                            |
|  [logo plate 120 px]                                         +------------+                |
|  <Client name>                                               |            |  their custom  |
|  goes live.        (display 118/700; "goes live." in teal)   |  Instagram |  creative, at  |
|                                                              |  feed      |  its own size, |
|  Go-live   Sunday 26 October   (Mono 24 ink-2, then 40/700)  |  phone     |  640 tall      |
|  (v)--(v)--(v)--(o)- - ( ) - - ( )   Launch call · Today     |            |                |
|  Everything your customers will see, before they see it.     +------------+                |
+--------------------------------------------------------------------------------------------+
```

- **Letterhead.** The dateline (`CONTENT.md`'s `cover.eyebrow`, "Launch call ·
  {today}") sits in the top row after the Mahara logo, the way a drawing's
  title block carries its date, not as a kicker above the title. The CSM's
  name and role sit at the row's end.
- **The go-live date** is set as type, not as a pill: "Go-live" in Mono 24
  ink-2, then the date at 40/700 in ink (`CONTENT.md`: "Date, large").
- **Motion:** the slide crossfade only (5.3). One stop.
- **Data:** client name; logo; go-live date; the presenting CSM's first name
  (the only person named in either deck); `prep.cover_creative`.
- **The creative.** Only a creative marked custom and chosen in prep. Never a
  starter: template imagery behind "<Client> goes live" would present it as
  their brand, which the fast-launch rules forbid. It shows at its own size
  inside an Instagram feed phone (7.2) on the end half, over the deep ground.
  It is never stretched full-bleed: a 1080 px wide 4:5 file at 1920 would be
  upscaled about 1.8x, and the first slide would look soft.
- **Default (most clients on launch day):** the deep ground with the journey
  lanes drawn large and faint across the end half, a quiet preview of slide 2.
- **The road strip** (7.9) under the date.
- **Fallbacks:** no go-live date: the date line is left out. No CSM name:
  "Your client success manager" alone.

### 8.2 The journey (signature)

Section 6. Seven stops, about 2.5 minutes. Owner lanes, the client's own
assets, the fork at stop 6. Thin stops get one sentence.

### 8.3 Your ads

```text
+--------------------------------------------------------------------------------------------+
| +- start column, 440 -------+   +- phones, 1180 ------------------------------------------+ |
| | Your customer sees this   |   |                                                         | |
| | Your ads  Preview   (H2)  |   |               +----------+                              | |
| | How your ads look in the  |   |  +--------+   |          |  +--------+                  | |
| | feed. We can show any...  |   |  |  IG    |   |  Reels   |  |   FB   |                  | |
| |                           |   |  |  feed  |   |  and     |  |  feed  |                  | |
| | Your creatives      6     |   |  |        |   |  Stories |  |        |                  | |
| | [Uploaded] [From Meta 3]  |   |  |        |   |          |  |        |                  | |
| | +----+ +----+ +----+      |   |  +--------+   |          |  +--------+                  | |
| | |img*| |vid1| |img |      |   |               +----------+                              | |
| | +----+ +----+ +----+      |   |  (IG mark)    (IG mark)     (FB mark)                    | |
| | +----+ +----+             |   |  Instagram    Reels and     Facebook                     | |
| | |vid | |Strt|             |   |  feed         Stories       feed                         | |
| | +----+ +----+             |   |  Previews. Meta fits each ad to the screen it shows on. | |
| +---------------------------+   +---------------------------------------------------------+ |
|  customer o-*-o ... (mini rail, stop 1 lit: "Sees your ad")                          03/10 |
+--------------------------------------------------------------------------------------------+
```

- **The owner line** (`CONTENT.md`'s eyebrow, "Your customer sees this").
  Not a kicker: no Mono, no capitals, no tracking, no accent of its own. It
  is set exactly as the journey's lane head for that lane (Geist 500 24,
  sentence case, in the lane's tone: ink-2 for your customer, teal for our
  team, ink for you), stacked directly above the title in the same column.
  So it reads as "this slide is that column of the journey", which is true,
  and the mini rail at the foot says the same thing in the drawing. The ads,
  form, call and portal slides carry their owner this way; creative freedom
  sets its "Creative freedom" the same way in ink-2. No other slide has a
  line above its title.
- **The title's tag.** "Preview" follows the title on its baseline, in the
  provenance tag style (5.4). The three phones carry no tag of their own.
- The start column and the phone area are regions of the slide, not cards:
  neither has a border or a fill.
- **Stops (4):** overview (three phones, the middle one 760 tall, the sides at
  90%); then Instagram feed, Reels and Stories, Facebook feed in focus.
- **Focus:** the chosen phone moves to the centre and grows to 852 tall
  (transform only, 420 ms); the other two slide outward and drop to 25%
  opacity; leaders appear on the free side, each a 2 px `--dk-line-strong`
  line with a 6 px teal dot on the part and a 24 px label: "Your page and
  logo", "Marked Sponsored", "Your picture or video", "Your words", "The
  button: Learn more". A 9:16 creative in a feed phone is centre-cropped to
  4:5, with a leader "Meta crops this to 4:5 in the feed". Videos play muted
  only in the phone in focus (or the Reels phone in the overview); the others
  show their poster (10.6).
- **Their pick.** The CSM marks the creative the client chose ("Which one
  would stop you scrolling?") with M or the star in the notes window. A small
  teal star sits on its tray thumbnail; it saves to prep and comes back on
  creative freedom.
- **The tray and the swap:** section 10.
- **Data:** creatives from `cockpit_csm_launch_ads` (uploads) and, when
  built, their Meta ads with stills; page name; avatar; primary text, headline
  and call to action per creative (edited in prep only).
- **Fallbacks:** no creatives: each phone shows a quiet frame in its own app
  chrome with their identity and, where the media goes, a `--dk-panel` block
  with "Your ad goes here" in 24 px ink-2; the tray's empty state (10.1). No
  primary text: the caption shows the page name only. No call to action set:
  "Learn more", marked "default" in prep.

### 8.4 Creative freedom

**Superseded on 2026-10-20 by 21.1** (five stops around the field of ad
tiles). Kept below as the record of the three-column plan.

```text
+--------------------------------------------------------------------------------------------+
| Creative freedom                (owner line, ink-2)                                        |
| Your red lines are fixed. The rest, we test.        (H2)                                   |
|                                                                                            |
|  Your page stays yours        Fixed: your red lines            Open: everything else       |
|  (520, on the ground)         +- amber panel, 600 ----------+  (400, on the ground)        |
|  +-------+                    | Never show prices           |  [Angles] [Hooks]            |
|  | feed  |  <- Marked         | No before-and-after of      |  [Formats] [Thumbnails]      |
|  | phone |     Sponsored      | client homes                |  [Who's on camera]           |
|  |  520  |                    | You told us: never show     |  (*) [their pick]            |
|  +-------+                    | prices.                     |  Your pick runs too, beside  |
|  Paid ads show in the feed,   | We never cross these. You   |  the ones you'd skip. The    |
|  marked Sponsored. They       | approve every fact, price   |  numbers tell us which       |
|  don't appear on your         | and claim. ...              |  work.                       |
|  page. ...                    +-----------------------------+  An ad waiting for ...       |
|  Prefer something different later? Ask in the group, and we'll launch it too.              |
|  customer o-*-o ... (mini rail, stop 1)                    Agreed to test this way · 19 Oct |
+--------------------------------------------------------------------------------------------+
```

- **Structure is the argument, concession first.** Three columns that build
  from the inline start, one per stop: what stays theirs, what is fixed, what
  is open. They are of unequal width, sized to what they hold (520 for the
  phone and its words, 600 for the red lines, 400 for the chips; 64 px
  apart), and they are not numbered: the order they light in already says
  concession first, and nothing here is a procedure. Only the fixed column is
  a surface, the amber panel. What stays theirs and what is open sit on the
  slide ground with no border, so the one thing that does not move is the one
  thing drawn solid, and no card sits inside another. A column not yet
  reached shows only its heading, in ink-3.
- **Stop 1:** the L4 feed phone at 520 px with their creative and one leader
  on "Sponsored". No profile grid: we do not have their grid, and drawing one
  would be invented content.
- **Stop 2:** the red-lines panel (since the visual review of 2026-10-20,
  `--dk-panel` with a 1 px `--dk-leak-line` hairline; it was a
  `--dk-leak-soft` fill; 16 px radius, no edge bars and no bar on any item; the items are 24 px apart and their wording
  marks them). DO items as "Always …", DON'T items as "Never …",
  picked in prep; NOTES never show (they are internal). Red lines typed on
  onboarding slide 7 lead the list, introduced by "You told us: …". No Do's &
  Don'ts and no typed lines: the panel reads "No red lines written yet. Tell
  us now and we'll add them to your card." with an input the CSM types into
  live; it saves to prep, and prep reminds the CSM to copy it to the card.
- **Stop 3:** the chips, their starred pick as a thumbnail, and the lines
  from `CONTENT.md` L3.
- **Stop 4 (optional, hidden by default):** "How a test runs". The test tiles
  (7.9) replace the three columns, with the caption. Never a screenshot of an
  ads account.
- **Agreement.** Nothing on the canvas asks the client to agree: they cannot
  click, and a button there reads like a terms box. The CSM records the yes
  from the notes window ("We agree to test this way") or with A. Then the
  quiet stamp "Agreed to test this way · 19 Oct" (Arabic date, Arabic-Indic
  digits) fades in at the foot end. One write with an audit row; the notes
  window can undo it. It records how we test, never a contract term.

### 8.5 Your form

```text
+--------------------------------------------------------------------------------------------+
| Your customer sees this     (owner line, ink-2)                                            |
| Your form   (H2)                                                                           |
|                                                                                            |
|   +------------+          +- The questions --------------------------------------------+   |
|   | [Your form]|          |  1  What service do you need?   Choice      [Filters]      |   |
|   |  instant   |  ------- |# 2  When do you want to start?  Choice      [Filters]      |   |
|   |  form,     |          |  3  What budget do you have in mind?  Choice  [Filters]    |   |
|   |  question  |          |  4  Full name                   Filled in by Meta          |   |
|   |  2 lit     |          |  5  Phone number                Filled in by Meta          |   |
|   |            |          |  Then: your thank-you screen                               |   |
|   +------------+          +------------------------------------------------------------+   |
|                                                                                            |
|  customer o-o-*-o ... (mini rail, stop 2 lit: "Answers your questions")              05/10 |
+--------------------------------------------------------------------------------------------+
```

- **Stops:** intro screen, then one per question (capped at 6), then the
  thank-you screen. Each → highlights the next question in the phone and its
  row in the list, joined by a leader. The thank-you screen is shown in full
  here and nowhere else.
- **Filtering questions** carry the word "Filters" in teal, set as a word
  (no pill, no fill). The CSM can add one line per gate question in prep
  ("Filters out people with no budget yet"); without it, the word stands
  alone.
- **The leader** leaves the phone 10 px outside its frame on the list's side,
  level with the lit question's first line, as the ads' leaders do, so its
  dot never sits on the app's words whatever their direction.
- **The intro** is headed by the ad's own picture, which takes the screen's
  free height up to the feed ad's 4:5; any height left sits above Next.
- **Other destinations:** WhatsApp or landing page per 7.5.
- **Data:** only a form the CSM confirmed in prep. A match by account name is
  never used: a near miss would draw another client's form as "Your form".
- **Fallback:** no confirmed form and no prep questions: the slide is hidden
  by default and prep says why. If the CSM shows it, the phone draws the
  example form (7.5), tagged "Example form" above the phone's outer corner
  (never on the title's line). Journey stop 2 uses the same example form
  with the same tag.

### 8.6 The example call

Section 11 has the full animation. Layout:

```text
+--------------------------------------------------------------------------------------------+
| Our team does this    (owner line, teal)                                                   |
| How we'll speak to your customers   (H2)                                                   |
| <Client name> · Kitchens   (line)                                                          |
|                                                     Example written from our script  (tag) |
| +- call card, 420 -----+   transcript, 1168, on the slide ground: no panel, no bubbles     |
| | [logo] Calling for   |   Customer                     (Geist 500 24, ink-2)              |
| |        <Company>     |   إيه نعم، أبو فهد معك                                            |
| |                      |   Yes, speaking.                                                  |
| |   2:41               |                                                                   |
| |   On the call        |                Our caller      (Geist 500 24, teal)               |
| |                      |                ... بخصوص [Kitchens] ...                           |
| |  v 1 The opening     |                ... about [Kitchens] ...                           |
| |  v 2 Their goal      |                                                                   |
| |  * 3 The details     |   Customer                                                        |
| |  o 4 What sets you   |   ...                                                             |
| |      apart           |                                                                   |
| |  o 5 The booking     |   (customer track at the start; caller track 160 px in)           |
| |  o 6 Locking it in   |                                                                   |
| +----------------------+                                                                   |
|  Words in teal came from your files. Anything marked 'To give us', we'll complete with you.|
|  customer o-o-o-* ... (mini rail, stop 3 lit: "We call")                             06/10 |
+--------------------------------------------------------------------------------------------+
```

- **Stops (8):** the six call stages; stop 7, after the call, where the
  WhatsApp confirmation lands and "What we do before the meeting" lights its
  five steps (11.5): this is the home of the reminders; stop 8, where the
  appointment card (7.9) shows what lands with the client. The mini rail
  lights stop 4 at stop 7 and stop 5 at stop 8.
- **The tag** sits outside the transcript, above its end corner, at 24 px,
  on its own row under the title, never beside the owner line.
- **The call card** is the slide's one container. The transcript has no
  panel around it, so no card sits inside another, and the clock and the
  stage rail are divided by space, not a rule.
- **Done with you:** title "How your team should call", tag "Our script, for
  your team". The sample script (`SCRIPTS_DOC`) and their playbook are linked
  from the notes window, not the canvas.

### 8.7 Your portal

The sales `tourSlide` pattern: stops down the start side (480 px), the screen
beside them as a plain figure: the screenshot itself with a 1 px
`--dk-line-strong` edge and a 16 px radius. No browser bar, no three dots, no
address: the client is already looking at a browser, and a drawn one inside
it is the clearest sign of a generated page. Owner line: "You do this" (in
the "You" lane's ink, 8.3).

| Stop | Name (EN) | Screen |
|---|---|---|
| 1 | Where things stand | `portal-overview-{lang}` |
| 2 | Your calls, recorded | `portal-calls-{lang}` |
| 3 | On your phone | `mahara-mobile-{lang}.mp4`, playing on this stop only: the screen recording at its own size with the phone screen's 35 px radius and a 1 px edge, no bezel and no island (this is our app, not the customer's screen, so the phone exception in 7.1 does not reach it) |
| 4 | Your number-one job: mark every meeting | `portal-outcome-{lang}`, with an amber tag "Your number-one job" |

- The slide ends on stop 4, the habit that matters most.
- Screens are cropped below the portal's own "lead" headings wherever the crop
  keeps them readable (`CONTENT.md` copy rule 3).
- **Left out on purpose:** `portal-results` and `portal-ads` (they show cost
  per lead) and `portal-leads` (lead counts). Client slides carry no leads and
  no cost per lead.
- Every screen carries "Demo workspace". Mini rail: stop 7 lit.
- **Done with you:** stop 2 is hidden. Until `prep.dwy_os_approved` is set,
  stops 1 and 3 are hidden too, the title is "Your CRM", and stop 4 shows the
  CRM stage list (7.9).

### 8.8 Your part

```text
+--------------------------------------------------------------------------------------------+
| Your part   (H2)                                                                           |
| Your five jobs, in one place.                                                              |
|                                                                                            |
|                                          Why it matters   (column head, once)              |
|  +--------+  Leave the ads running       Ads need time before we can tell which ones work. |
|  | tray   |  through the first weeks                                                       |
|  +--------+                                                                                |
|  +--------+  Mark every meeting, the     Your outcomes show which ads bring real projects. |
|  | outcome|  same day                                                                      |
|  +--------+                                                                                |
|  +--------+  Keep your Drive folder      Fresh projects keep your ads from tiring.         |
|  | Drive  |  fed                                                                           |
|  +--------+                                                                                |
|  +--------+  Keep the offer steady       A new offer mid-test starts the test again. If    |
|  | group  |  while we test. Want to      you ask first, we can plan it in.                 |
|  +--------+  change it? Ask in the                                                         |
|              group first.                                                                  |
|  +--------+  Block busy times and        Our callers book into the times you leave free.   |
|  | hatched|  holidays in your calendar                                                     |
|  +--------+                                                                                |
+--------------------------------------------------------------------------------------------+
```

- **The "You" column, pulled out on its own.** Five rows, not five tiles: a
  row of five equal cards, each a picture over a heading over a repeated
  label, is the stock feature grid, and this is a checklist. Each row has a
  192 x 108 picture crop at the inline start of where the job was shown (the
  ad tray, the outcome form, a Drive folder with their folder name, the
  onboarding group header, a calendar day with one hatched block), the job
  in 28/700 ink in a 560 px column, and its reason in 24 ink-2 in the column
  after it (about 816 px). Rows hug their content, 20 px apart.
- **"Why it matters"** (`CONTENT.md`'s `part.why`) heads the reasons column
  once, set as a column head (Geist 500 24, ink-2), instead of repeating in
  Mono inside five tiles. `CONTENT.md` L8 calls the rows tiles and the label
  teal; the words, the pictures and the recap card are unchanged, and the
  label is ink-2 because teal means ours or lit (3.1).
- Not numbered (they are not a sequence). No amber: nothing here is a
  warning. One stop and no stagger: the rows are simply there. No rail.
- The notes window has "Copy for the group", which posts this list as an
  image with its five lines as text, as the call's recap.

### 8.9 The first 90 days

```text
+--------------------------------------------------------------------------------------------+
| Your first 90 days   (H2)                                                                  |
|   Your 90-day goal, in your words: Two to three kitchen projects a month.  (Geist 400 40)  |
|   A target, not a promise of results.                                                      |
|                                                                                            |
|            |Go-live                                                                        |
|            26 Oct  2 Nov  9 Nov  16 Nov 23 Nov 30 Nov  7 Dec ... 18 Jan  (13 week columns)  |
| Finding what works [=======- - - - - - -]   (solid weeks 1 and 2, dashed open end to wk 5) |
| Check-ins        <--day 7-14-->   <>     <>   (<>)30  <>   (<>)60  <>  (<>)90              |
|                  Around 30, 60 and 90 days, that check-in looks back over the month.           |
|                                                                                            |
| In this order, not on a date:  First booking  >  First attended appointment  >             |
|                                First won project                                           |
| Dates depend on your market, your offer and your follow-up. We track them with you.        |
+--------------------------------------------------------------------------------------------+
```

- **The goal line** carries O2's look (the client's words in Geist 400, no
  bar), at 40 px, and is hidden while it holds a lead or appointment count
  the CSM has not cleared.
- **The programme of works** in the client's own vernacular. Week columns
  carry real dates counted from their go-live date (Arabic: day and month name,
  Gregorian calendar forced, see 13.3). A teal vertical rule marks go-live.
- **Honest edges:** the first window is a bar labelled "Finding what works",
  with no sentence, whose end is left open (it is "the first weeks", not a
  date): solid teal over weeks 1 and 2, then a 2 px dashed teal outline with
  no fill to week 5, ending without a cap. That is how a programme of works
  draws float; a gradient fading to nothing would be a glow by another name.
  The first check-in is a bracket (day 7 to 14), then the later check-ins as
  diamonds. The rhythm is "weekly or every two weeks", by the plan and how
  long the client has been with us (CEO, 2026-10-20), so the chart draws
  both: the check-ins every two weeks are solid diamonds, and the weeks
  between are open diamonds (`data-weekly`), smaller (14 px against 22) on
  the same centre line, so the first check-in before it is booked (open, full
  size) keeps its own look. The key line under the chart starts with both
  marks and names both ("Then weekly or every two weeks"), with the reason on
  its own ink-2 line under it ("Depending on your plan and how long you've
  been with us."). The drawing never stands for one rhythm alone. The check-ins nearest day 30, 60 and 90 carry a ring, and one line
  says they look back over the month. There is no separate review row: no SOP
  defines a review meeting. Milestones are an undated sequence under the
  chart, never placed on it.
- **Motion:** one stop. The bar draws from its inline-start edge (600 ms, a
  `scaleX` transform); the bracket, diamonds and rings appear together as it
  finishes (200 ms, opacity), not one after another. Reduced motion: drawn.
- No rule between the chart and the milestones: the space does it.
- **Fallback:** no go-live date: columns read 1 to 13 under the axis title
  "Week" (13 "Week n" labels crowd each other at 104 px a column). Every
  column's label sits the same 12 px after its line, the first included.
- **Keys:** the two lines under the chart each start with the mark they
  explain (the rhythm's two marks, solid and a smaller open one; the ringed
  diamond), and the dashed open end is labelled where it is drawn: "Can run
  longer".
- No rail.

### 8.10 Green light

```text
stop 1                                                  stop 2
+-----------------------------------------------+       +-----------------------------------------------+
| Before we go live   (H2)                      |       |  (housekeeping fades to 30%)                  |
| - Meta's first charges on your card are small.|       |                                               |
|   That's normal. Tell your bank...            |       |   Happy for us to go live?   (display 118)    |
| - Comments on your ads are yours to answer.   |       |                                               |
| - We reply 10 to 6, Saturday to Thursday.     |       |   customer o---o                              |
|   (only if the onboarding deck was never      |       |   our team      \--o---o                      |
|    presented)                                 |       |   you                   \--o---o---o  >       |
|                                               |       |                        Go-live · 26 Oct       |
| Happy for us to go live?  (H2, ink-2)         |       |   First check-in · Sunday 2 Nov, 1 pm         |
+-----------------------------------------------+       +-----------------------------------------------+
```

- **Title:** "Before we go live", then the question. The two never ask the
  same thing twice.
- **Stop 2** draws the journey's mini rail large (1400 px wide, rows 32 px
  apart) and fully lit in solid teal, ending at the go-live date: the system
  is ready. The question sits above it at display size. Both sit at the
  content's inline start, as the covers do; nothing on the slide is centred.
- **From stop 1 to stop 2** is a crossfade to the new composition, not the
  question scaling up from H2 to display: text scaled by a transform blurs on
  its way, and on a share the blur is what arrives.
- **The check-in:** booked from the notes window (`BookCallButton`
  kind=checkin). The canvas only shows the result line once the booking reads
  back; before that, nothing (no "to book" text in front of the client).

---

## 9. The onboarding deck, slide by slide

**Superseded on 2026-10-20 by 22.2** (the visual pass): each slide below is
kept as the record of the first plan. The onboarding deck is now about 22
minutes with the live setup on slide 6, and slides 4 and 6 carry the call's
checklist at the foot (22.2.0).

Seven slides, about 10 minutes. No foot rail (the road has its own slide and a
rail would repeat it); the count sits at the foot end.

### 9.1 Welcome

```text
+--------------------------------------------------------------------------------------------+
| [MAHARA logo]  Onboarding call · 14 October            Your client success manager         |
|                                                         <First name>                       |
|  (ground: the journey lanes, drawn large and faint across the end half)                    |
|                                                                                            |
|  [logo plate]                                                                              |
|  Welcome,                                                                                  |
|  <Client name>.            (display; "Welcome," 400 ink-2, the name 700 ink)               |
|                                                                                            |
|  By the end of this call:  (body 30, ink-2; a lead-in sentence, not a label)               |
|  1  Your launch service, chosen                                                            |
|  2  Your access, set up                                                                    |
|  3  Your Brand Blueprint call, booked     (body 30; numbered because it is today's order) |
+--------------------------------------------------------------------------------------------+
```

The faint lanes replace the sales deck's majlis render. The client saw that
render on the pitch, and behind "<Client>" for an interior firm it reads as
their own project. The lanes are the onboarding deck's quiet signature: the
same shape opens the launch deck a week later and becomes the journey. They
are drawn as bands and the unlit dotted line only, at most across the end
half: no lit segment, no nodes, nothing that could read as a texture.

The dateline (`CONTENT.md`'s `welcome.eyebrow`, "Onboarding call ·
{onboarding.date}") sits in the letterhead row after the Mahara logo, as on
the launch cover (8.1). "Welcome," is set at 400 in ink-2 and the client's
name at 700 in ink: weight carries the name, not teal, because teal means
ours. The agenda is numbered because it is the order of the call.

### 9.2 Your goals

```text
+--------------------------------------------------------------------------------------------+
| Your goals, as you wrote them   (H2)                                                       |
|                                                                                            |
|  Two to three kitchen and villa projects a month,                                          |
|  mostly in north Riyadh.          (client's words, Geist 400 60, ink; no bar, no quotes)   |
|  In 90 days                                            From your onboarding form           |
|  (Geist 500 24, ink-2)                                 (provenance tag, Mono 24, ink-2)    |
|                                                                                            |
|  In 12 to 24 months                   What's in the way                                    |
|  <stretch goal, body 30>              <challenge 1>                                        |
|                                       <challenge 2>                                        |
|  (640, on the ground)                 <challenge 3>       (880, on the ground)             |
|                                                                                            |
|  Why you joined: <one line>                                                                |
|  We'll track them with you. They're targets, not a promise of results.  (small, ink-2)    |
+--------------------------------------------------------------------------------------------+
```

- **No quote marks and no bar.** Their words are marked by how they are set
  and where they come from: Geist 400 at 60 px, lighter than every heading
  in the deck (700), then a caption row with "In 90 days" and, at its end,
  the provenance tag "From your onboarding form" (`CONTENT.md`'s
  `goals.eyebrow`), in the place an attribution takes. That avoids
  guillemets (client rule), the look of a testimonial, and the side-stripe a
  bar would draw.
- **The other answers sit on the ground, not in cards:** two columns of
  unequal width (640 and 880), each under a label in Geist 500 24 ink-2, the
  answers in body 30 ink. `CONTENT.md` O2 lists four cards; the words and the
  four answers are kept, and the 90-day goal leads because it is the one the
  launch is built around.
- **Data:** onboarding form answers (90-day goal, 12 to 24-month goal, top
  three challenges, why they joined) through `formAnswer` and `clean` from
  `clientBrief.ts`; phones, emails and prices stripped; every line editable in
  prep.
- **Fallback:** no answers: the slide shows the title, the question "What
  would make the next 90 days a win for you?" and an input styled as the 60 px
  line ("Your 90-day goal, in your words") for the CSM to type live. It saves
  to prep on change.

### 9.3 Your team, in your WhatsApp group

```text
+--------------------------------------------------------------------------------------------+
| Your team, in your WhatsApp group   (H2)                                                   |
| Your ads and funnel, our call centre and your success manager: one team, in one group.    |
|                                                                                            |
|  +- (avatar) (WhatsApp mark) Your WhatsApp group ---------------------------+              |
|  | Your client success manager     Your one point of contact, for anything. |              |
|  | The creative director           Your brand, your scripts and your ads.   |              |
|  | The media buyer                 Your campaigns.                          |              |
|  | The systems team                Mahara OS and your calendar.             |              |
|  | Your caller                     Questions from the calls: your hours, a  |              |
|  |                                 holiday, a service detail.               |              |
|  +--------------------------------------------------------------------------+              |
|  (a deck panel at the content's start: role 26/600 ink, its line 26 ink-2)                 |
|  We reply 10 to 6, Saturday to Thursday. If something worries you, we call you.           |
+--------------------------------------------------------------------------------------------+
```

- The group panel (7.9). No glyphs, no faces and no names: the presenting
  CSM is named on the cover alone. Five icons in five circles would be the
  icon-list template, and a role is better said by its name.
- No cadence and no "every" on this slide; the check-in rhythm belongs to the
  launch deck's 90 days.
- **Done with you:** row 5 becomes "New-enquiry alerts" · "New enquiries
  arrive here too, for your callers."
- One stop; the rows are simply there (no stagger).
- **Why the group and not the lanes here.** The lanes say who handles an
  enquiry, which matters once enquiries exist, on the launch call. Today the
  client needs the people they are about to meet, and the group also carries
  the hours. The faint lanes on the cover still introduce the shape.

### 9.4 One service per campaign

```text
+--------------------------------------------------------------------------------------------+
| One service per campaign   (H2)                                                            |
| We launch with one service, so the ads, the form questions and the calls... (lead)         |
|                                                                                            |
|                       Easiest to sell    Most profit    Least painful to deliver           |
|  Kitchens                  [v]               [ ]               [v]                         |
|  Bathrooms                 [v]               [ ]               [v]                         |
|  Full villa fit-out        [ ]               [v]               [ ]                         |
|  Interior design           [ ]               [v]               [v]                         |
|  [+ Add a service]                                                                         |
|                                            +- Your first campaign --------------------+    |
|                                            |  Kitchens          [ Launch with this ]  |    |
|                                            +------------------------------------------+    |
+--------------------------------------------------------------------------------------------+
```

- A decision matrix: rows are their services (chips from the form), columns
  the three qualifiers. The CSM taps cells on the shared screen as the client
  answers; ticks are teal. The row with the most ticks gets a `--dk-teal-faint`
  band and moves into "Your first campaign"; the CSM confirms with "Launch with
  this", which saves to prep (the launch deck and the call script use it).
- **Fallback:** no services in the form: one empty row with "+ Add a service"
  focused; the CSM types as the client speaks.

### 9.5 The road

```text
+--------------------------------------------------------------------------------------------+
| The road to your first appointments   (H2)                                                 |
|                                                                                            |
|    (v)-----------(v)-----------( * )-----------( )-----------( )-----------( )            |
|  Contract      Onboarding    Onboarding     Brand and     Launch        First              |
|  signed        form          call           offer         call          appointments       |
|  12 Oct        14 Oct        Today          Tue 21 Oct    20 to 30      After go-live      |
|                                             (once booked) minutes. We                      |
|                                                           walk you through everything      |
|                                                           that's going live.               |
|                                                                                            |
|  Each call is booked at the end of the one before.                                         |
+--------------------------------------------------------------------------------------------+
```

- **Drawn in the journey's marks, not as a web stepper.** The sales
  `.dk-path` (52 px gradient dots with arrowheads, labels centred under each
  dot, a glow on today) is the horizontal progress stepper section 2 set out
  to avoid. Here the road uses the lanes' own marks at full width: 28 px
  nodes (passed: teal ring and check; today: solid teal fill with the
  `--dk-deep` dot; ahead: a `--dk-line-strong` ring), the lit line in solid
  teal 3 px up to today and the journey's dotted unlit line after it, with no
  arrowheads, no gradient and no glow. Each label starts at its node's
  inline-start edge, as a drawing's callout does, instead of centring under
  it. The nodes are evenly spaced, because this is an order and not a
  calendar.
- The Onboarding Map's six phases, with their Arabic names from the map
  itself. Past phases show their real dates; future calls show a booked date
  when one exists, otherwise nothing. No launch-date promise.
- No Blueprint box: the Blueprint is described once, on slide 7's band.
- One stop; the lit line draws to "Today" on arrival (`--dk-draw-ms`, the
  journey's draw). The cover's road strip (7.9) is this drawing at 40%.

### 9.6 This week, from you

```text
+--------------------------------------------------------------------------------------------+
| What we need from you this week   (H2)                                                     |
| Most of it we'll do together, right now.                                                   |
|                                                                                            |
|  Meta access          Your Page and ad account, through one link. A card.  [ To do ]       |
|  Mahara OS            Sign in, then connect WhatsApp and Google Calendar.  [ Done ]        |
|  Your content         Before your Blueprint call: photos and videos...    [ Not checked yet ]|
|  Past enquiries       Have a list of old enquiries? Send it...            [ To do ]        |
|  The Academy          Courses for you and your team... the onboarding...  [ To do ]        |
+--------------------------------------------------------------------------------------------+
```

- **Statuses:** Done (teal fill, `--dk-deep` text), To do (amber outline and
  `--dk-leak-soft`), Not checked yet (`--dk-line-strong` outline, ink-2). An
  unknown is never shown as done or as to do: missing is never zero. Before
  the kickoff is filed, every row reads "Not checked yet".
- **Live:** the CSM clicks a chip to flip it as each step is done on the call
  (a 240 ms fill, no confetti). The chip gives up focus after the click (12.1).
  It saves to prep with an audit row; it does not write the kickoff form.
- **Data:** kickoff answers (Meta access, card, calendar, WhatsApp, content,
  pre-existing leads, Academy). The notes window has "Copy links for the
  group" (Leadsie, their Drive folder, the Academy) for the CSM to paste.

### 9.7 What to expect, and your next call

```text
+--------------------------------------------------------------------------------------------+
| What to expect, and what's next   (H2)                                                     |
|                                                                                            |
|  Your first ads   (880)                        The first weeks are a test   (672)          |
|  Starter ads go live first, from our ready     We test many ads, fast. Small style         |
|  templates. Your own ads, made from your       changes go into the next round, so your     |
|  content, follow.                              launch keeps moving. Your red lines stay    |
|  They go live only once you've approved       fixed: tell us now what we must never say   |
|  the facts, prices and claims in them.         or show.                                    |
|                                                +- amber panel -------------------+         |
|                                                | Never show prices  (typed live) |         |
|                                                | _______________                 |         |
|                                                +---------------------------------+         |
|  +- band, --dk-panel ------------------------------------------------------------------+   |
|  | Next: your Brand Blueprint call · 45 minutes with our creative director: your      |    |
|  | brand, your offer, your first ad scripts.          Tuesday 21 October, 4 pm        |    |
|  +------------------------------------------------------------------------------------+    |
+--------------------------------------------------------------------------------------------+
```

- **One row of two statements** of unequal width (880 and 672, 96 px apart),
  not cards, and no rule between them: the gap divides them.
- **Fit (the spec review, 2026-10-20).** Both statements grew: the
  approval line names the facts, prices and claims (two lines at 880), and
  the testing statement plants the small check (four or five lines at 672,
  30/1.4; Arabic Plex 32/1.6, five). The sizes stay; nothing shrinks to fit.
  `deck-shots.mjs` shoots O7 stop 1 in both languages with three typed red
  lines and fails when the amber panel's foot comes within 48 px of the
  band's top. If it does, the panel's live input moves beside the last red
  line instead of under it (the panel loses one row); the words are never
  cut on the slide.
- **The red lines input:** a small version of creative freedom's amber panel
  (`--dk-leak-soft`, no edge bars). The CSM types as the client speaks; Enter adds a line; each
  saves to prep on change (16.4) and comes back on the launch deck.
- **The band** (`--dk-panel`, 16 px radius) is the one place the Blueprint is
  described. It reads as `CONTENT.md`'s sentence, "Next: your Brand Blueprint
  call · …", with "Next: your Brand Blueprint call" at 30/700 and the rest at
  30/400. There is no separate "NEXT" label beside it: a tag to the side of a
  heading is the templated section head. The date appears
  once the booking reads back (`BookCallButton` kind=blueprint, notes window).
- **Stop 2 (optional):** "Your starter ads". The Instagram feed and Reels
  phones at 760 px with the starter creatives under their Page name and
  avatar, each tagged "Starter, from our templates" above the frame. No tray
  and no swap here; shown only when prep confirms a starter pack for the
  launch service.

---

## 10. The ads tray: upload and swap

The CEO's ask: show the client that the CSM "can easily upload and swap their
ads". On the call the swap is the demonstration, so it is instant and nothing
else on the canvas moves. Uploading happens in prep and, during the call, from
the notes window.

### 10.1 The tray

- **Place:** the start column of slide 3, under the title (440 px wide).
- **Head:** "Your creatives" and the count; a two-part switch "Uploaded" /
  "From your Meta ads (3)". The second part appears only when that source
  returns rows.
- **Grid:** three columns of 120 px square thumbnails, 12 px gaps. Each
  thumbnail: a centre crop; a shape badge (4:5, 9:16, 1:1) and, for video, a
  play glyph and duration in Mono 20, tabular; a language badge (AR / EN); a "Starter"
  chip on starter creatives; a teal star on their pick.
- **In use:** a 2 px teal ring and a small chip with the phone it is on
  (Feed, Reels, Facebook).
- **No add tile and no drop hint on the canvas.** The client cannot click or
  drop, so an instruction to them would be false. Adding is in the notes
  window (10.3).
- **Empty:** a dashed `--dk-line-strong` area with "Your first ads are being
  finished." The Meta tab with nothing: "Nothing built in Meta yet."

### 10.2 Placing a creative (the moment on the call)

- **Click a thumbnail:** it goes to the phone that suits its shape: 9:16 to
  Reels and Stories; 4:5 or 1:1 to Instagram feed, or to the phone in focus.
- **Number keys 1, 2, 3** place the selected thumbnail on phone 1, 2 or 3.
- **Drag a thumbnail** onto any phone to put it there.
- **The swap:** the old media fades out and the new one in (240 ms, opacity
  only, inside the screen; no scale, which would blur the creative mid-swap). The phone keeps its primary text,
  headline, call to action and app language unless the new creative has its
  own (prep marks each creative's text as its own or inherited). No toast on
  the canvas; Undo sits in the notes window for 10 seconds.
- **Shapes:** a 9:16 file in a feed phone is centre-cropped to 4:5, with the
  leader "Meta crops this to 4:5 in the feed". A 1:1 or 4:5 file in the Reels
  phone sits over a blurred copy of itself (7.3).

### 10.3 Adding a file during the call

1. **From the notes window:** "Add a file" opens the picker on the CSM's own
   screen, or the CSM drops the file on the notes window. Either way no folder
   list is ever on the share. The file is posted to the deck over the
   `BroadcastChannel` as a Blob (structured clone) and shows on the chosen
   phone, or the phone in focus, at once, from the local copy.
2. **Saving runs from the notes window:** reserve (gated, path
   `<taskId>/<uuid>.<ext>`), a signed upload with progress, verify, then
   ready with an audit row, as the scout's `launchAds.*` flow describes. On the
   canvas only a 4 px teal bar grows along the phone screen's bottom edge (a
   `scaleX` from the inline-start edge), then fades. No percentage and no "Saved" tag on the share; progress, "Saved" and
   errors show in the notes window.
3. **Dropping on a phone from Finder** works when the deck window is not in
   full screen. On macOS, full screen moves the browser into its own Space,
   where neither Finder nor the notes window can be reached. Until section
   17.5 is checked, the notes window's foot says it once: "Share the deck
   window only, maximised rather than full screen, so you can reach this
   window" (score round 2: no slide's notes and no panel
   repeats it).
4. **Prep is the main place to upload,** so on the call the tray is already
   full and the live moment is a click.

### 10.4 Errors (said plainly, in the notes window only)

| Case | On the canvas | Words (notes window) |
|---|---|---|
| Too big to save | The file still shows on the phone | "Shown, not saved: {name} is over 150 MB. Export a smaller copy to keep it." |
| Wrong type | Nothing changes | "{name} is a PDF. Add a picture (JPG, PNG, WebP) or a video (MP4, MOV, WebM)." |
| The browser can't play it | Nothing changes | "This browser can't play {name}. Export it as MP4." |
| Upload stopped | The preview stays; the tray tile turns amber | "Not saved. Add it again to retry." |
| Signed out or no access | Nothing changes | "Saving needs your cockpit sign-in. The preview still works." |

Anything the browser can show is shown; only the save is refused.

### 10.5 Text on the ads

Primary text, headline, call to action and language are edited per creative
in prep, never on the shared canvas, so the live demo stays clean. Prep marks
each creative's text as its own, or as inherited from the phone it lands on.

### 10.6 Loading client media

- **Signed URLs** (the scout's 3600 s) are signed when Present is pressed, not
  when prep opens, and re-signed on any image or video error. A deck opened in
  prep an hour early never shows broken pictures.
- **Stills and posters preload** when the deck opens, as the sales deck
  preloads its imports, so the one-slide-at-a-time mount never pops creatives
  in late.
- **Videos load poster-first** with `preload="metadata"` and play only on the
  stop that focuses them. Prep warns about any video over about 30 MB: "Large
  video ({size} MB). Export a lighter copy for the call."

### 10.7 What the tray never does

It never publishes to Meta, never writes Meta, and never shows another
client's creative or the winners archive. It never puts a toast, a percentage
or an instruction to the client on the canvas. Previews are labelled. The CSM
notes say "Showing a preview is not approval; approval happens in the group."

---

## 11. The example call: transcript animation

A written example, not a recording (there is no consent to play a real
customer's call). It is built from the dialer's booking script, sections 01 to
06, condensed. The customer is fictional and the caller is never named. The
call is personalised with this client's details, in a Kuwaiti or Saudi
variant. The words are in `EXAMPLE-CALL.md` and `CONTENT.md` Appendix A.

### 11.1 Data

Each turn has: speaker (`agent` or `lead`), call time (m:ss), stage (1 to 6),
the Arabic line in each dialect (`kw`, `sa`), the English subtitle, and its
slots. Four turns also carry the design and cost pain variants. Slots use the
dialer's own tokens:

| Slot | Filled from |
|---|---|
| `[اسم الشركة]` company | Client name |
| `[اسم الخدمة]` service | The service picked on onboarding slide 4, else the kickoff "service advertised", else the form's number-one service |
| `[اسم المهندس]` consultant | The client's call guide (Call Center Hub), else the form, else prep |
| consultation type, place | Onboarding form (office, at home, online) |
| `[الميزانية]` budget band | Prep, else by country and the service family's scale (`EXAMPLE-CALL.md`) |
| pain variant | Prep: delays, design or cost, shown beside the selling point |
| Instagram handle | Onboarding form; when missing, its turn is dropped |
| one selling point (stage 4) | Prep, from their call guide; never the script's own claims (no "we guarantee price, time and quality", no "hundreds of families") unless the client's guide says so |

The caller opens as "the appointments team at {Company}", as the script's own
coordinator line says. Timing follows `CONTENT.md` Appendix A, paced on the
measured median booking call (291 seconds; used for pacing, never printed as a
claim):

| Stage | Call time | Beats |
|---|---|---|
| 1 The opening | 0:00 to 0:30 | Greeting, the appointments team at <company>, "your enquiry about <service>", is now a good time |
| 2 Their goal | 0:34 to 1:09 | What matters most to them in the project, and what success looks like |
| 3 The details | 1:21 to 3:08 | How long they have planned it; worked with a firm before (the pain variant); a rough budget band |
| 4 What sets you apart | 3:16 to 3:35 | The summary in their words, and one selling point from the client's own material |
| 5 The booking | 3:41 to 4:23 | A consultation with <consultant>, morning or afternoon, the double tie-down |
| 6 Locking it in | 4:29 to 4:51 | Confirmed, a WhatsApp is coming, their Instagram to see projects |

### 11.2 Rhythm

`CONTENT.md` and `EXAMPLE-CALL.md` call each line of the call a bubble. Here
it is a turn, and it is not drawn as a bubble (11.3).

- **One → per stage.** The stage's turns then play on their own. Pressing →
  mid-stage completes it at once; pressing again goes to the next stage. P
  plays the whole call straight through (about two minutes) for a presenter
  who wants to talk over it. The transcript cursor drives the deck's `tour`,
  so P and → never disagree (16.4).
- **Line length.** No turn carries more than about 20 English words. Longer
  caller lines are split at the sentence break into two turns with their own
  times, as speech would be (the content already does this).
- **Pauses, not typing dots.** A caller turn follows a 500 ms pause and a
  customer turn a 700 ms pause. Nobody types on a phone call. Three bouncing
  or blinking dots are the chatbot's signature, and on this slide they would
  tell the client a bot answers their customers, when a person on our team
  does.
- **Gap after a turn:** in the English deck, 300 ms per English word; in the
  Arabic deck with subtitles off, 330 ms per Arabic word. Clamped to 1.2 to 6
  seconds, so the line can be read.
- **Turn entrance:** 260 ms, 12 px rise and opacity.
- **Scroll:** the transcript shows the last four to five turns. Older ones
  move up (transform, 300 ms) and drop to 35% opacity. No in-flow stage
  dividers; the stage rail says where we are.

### 11.3 Turns: a call record, not a chat

The call is drawn the way a call is written down: speaker, then words. No
bubbles, no tails, no fills, no typing dots. A chat skin on a phone call is
a template borrowed from chatbot demos, and it would also blur into the one
real chat on the slide, the WhatsApp confirmation that lands at stop 7. With
the call as a record, that card reads as the message it is.

| Part | Caller (our team, for the client) | Customer |
|---|---|---|
| Track | Starts 160 px in from the transcript's inline start | The transcript's inline start |
| Speaker name | Geist 500 24, teal: "Our caller" | Geist 500 24, ink-2: "Customer" |
| Ground | None: the slide ground | None |
| Arabic line | Plex 500, 32/1.6, `dir=rtl`, ink | same |
| English subtitle | Geist 24/1.4 ink-2, `dir=ltr`, directly under the Arabic line, no rule | same |

Two tracks keep the transcript two-sided (`CONTENT.md` L6): who is speaking
reads from the name and from the step in. Each line aligns to its own
script's start within its track. A turn's measure is at most 820 px, and
turns are 28 px apart. At 20 words or fewer a turn is at most about 190 px
tall (name, Arabic line, subtitle), so four to five stay on screen and the
thread is never lost. The current turn is ink; earlier ones step down as
they scroll (11.2).

**Slots inside the lines:**

- Filled from data: teal text with a 2 px teal underline.
- Missing: a dashed amber chip, "To give us: …", in place of the slot.

The legend under the transcript is `CONTENT.md`'s: "Words in teal came from
your files. Anything marked 'To give us', we'll complete with you."

### 11.4 The clock and the stage rail

- **The clock** (72 px Geist, tabular, Latin digits, see 13.4) jumps to each
  turn's timestamp as the turn arrives. It never counts on beside text the
  client is reading. Above it, "On the call"; after the last turn, "Call
  ended", and the clock stops at 4:51. The turns carry no time codes of their
  own: the clock is the one place time is shown.
- **The stage rail** is six rows in the call card, 64 px each, numbered (the
  order is the method). Current: teal number and ink name. Past: teal check,
  ink-2. Future: ink-3. Names: The opening, Their goal, The details, What sets
  you apart, The booking, Locking it in.

### 11.5 After the call (stops 7 and 8)

- **Stop 7, the home of the reminders.** The transcript goes (score round 2,
  21.13: it dimmed to 35%, a fourth thing to sort beside the call card that
  already says the call ended); the block starts level with the call card,
  which rests 72 px lower, where stop 8 keeps it. The
  WhatsApp confirmation card (7.6) lands at the inline end. Then "What we do
  before the meeting" lights top to bottom, 400 ms per step: five rows joined
  by the journey's line (dotted, turning solid teal as each row lights), each
  with its relative time in Mono and the channel's mark: the WhatsApp brand
  mark from `platforms.tsx`, and for the other four (a bell, a phone, a
  message, the meeting) lucide-react icons, already in the app, at one
  stroke weight in ink-2. One icon set, no emoji. Words from `CONTENT.md`
  L6. Worded as what we do, never "every" or "always", and no reply buttons
  are drawn (they run on some accounts only). Journey stop 4's five dots are
  this strip without its words.
- **Stop 8, what lands with you.** The confirmation and the timeline slide
  toward the inline start and shrink to 60%; the appointment card (7.9) takes
  the end side, with the caption "Our caller's notes come with it."
- **Done with you:** stop 7 reads "Book on the right calendar, and the
  confirmation goes out by itself", with the "Before the meeting" timeline;
  stop 8's notes are headed "Your caller's notes" and its caption is "It lands in your CRM."

### 11.6 Dialect, subtitles, pain, done with you

- **Dialect:** Saudi for clients in Saudi Arabia; Kuwaiti (the script's own
  dialect) for Kuwait, Qatar, the UAE and Bahrain. Unknown country: Kuwaiti,
  with a prep warning. Switched in prep or the notes window (D in the deck).
  The canvas does not label the dialect.
- **Subtitles:** on by default in the English deck, off in the Arabic deck;
  S toggles.
- **Pain variant and budget band:** picked in prep. Prep shows the pain story
  beside the selling point, so the two match.
- **Done with you:** see 8.6.

### 11.7 Reduced motion

A stage's turns appear together (opacity only, no rise);
the clock shows the stage's last time; the after-call stops are drawn at once.

---

## 12. Presenter chrome, notes window and prep view

### 12.1 The shared tab (what the client can see)

The canvas plus the sales chrome, which hides after 2.5 seconds without mouse
movement. It starts out of sight (score round 1 of the Blueprint deck's
design pass, 2026-10-23: a share that started on the deck showed the
presenter's buttons for its first seconds), and only a real move of the
pointer brings it back: a key never does, and neither does the mousemove a
browser sends from a still pointer when the slide changes under it (a move
counts once the pointer has travelled more than 3 px):

- **Top start:** "Back to <client>". It closes the deck window (Present opened
  it) and focuses the cockpit window that opened it. It never navigates the
  shared window to the client page, which holds results, ads, money and
  internal notes. If the window cannot close itself (it was opened by hand),
  it goes to a neutral "Deck closed" screen on the deck route.
- **Top end:** ع / EN, Notes (opens the notes window), All slides, Full screen.
- **Foot centre:** the ← n / N → pill.
- **Head centre, on a slide with a filled video slot:** the video control
  (21.2). It belongs to the chrome: it wakes with it and hides with it.

The "Deck closed" screen stays neutral: it says nothing about the recap,
because the client may still be looking at the shared window. The notes
window, which only the CSM sees, offers the recap once the deck closes
(21.4).

No prep link, no CSM-only data, no booking buttons and no upload controls on
the shared tab. The deck route sits outside `AppLayout`, so HermesChat and the
Cmd+K palette can never take focus during a call (scout).

**Canvas controls give up focus after a click** (blur on pointerup): tick
cells, status chips, journey rows and thumbnails. The next Space or clicker
press then moves the deck instead of toggling the control again (the engine
skips Space on a focused button, `DeckPage.tsx`).

**Hover on the canvas is one signal:** the control's border turns
`--dk-edge` in 120 ms. No lift, no scale, no shadow, no glow. The client sees
every hover the presenter makes, so a hover must never look like the deck
reacting to them.

### 12.2 The notes window (only the CSM sees it)

Opened with N or the Notes button: a 520 x 800 window at
`/clients/:key/present/:deck/notes`, kept in step with the deck through a
`BroadcastChannel` named for the client and deck. It works both ways: Next
and Back in the notes move the deck. Cockpit styling (Geist, the cockpit
theme, kit components), not the canvas.

```text
+- Notes · Launch · <Client> ---------------------- 12:40 / 25:00 -+
| 03 / 10  Your ads  ·  stop 3 of 4: Reels and Stories             |
| ---------------------------------------------------------------- |
| Say                                                              |
| - Point at their page name and logo.                             |
| - Put one video on the Reels phone, live.                        |
| - Asked for changes? Note them; slide 3 covered how we test.     |
| [!] Temp check: "Which one would stop you scrolling?"            |
| ---------------------------------------------------------------- |
| Only you see this                                                |
| Kickoff: templated ads "Wants to see them first"                 |
| Ads: 4 uploaded, 0 from Meta                                     |
| ---------------------------------------------------------------- |
| [ Add a file ]  [ Undo swap ]  [ * Their pick ]                  |
| Saving kitchen-reel.mp4 ......... 62%                            |
| ---------------------------------------------------------------- |
| [ Book the first check-in ]   [ We agree to test this way ]      |
| Call: [Kuwaiti | Saudi]  [Subtitles on]  [Play the call]         |
| [ Copy links for the group ]  [ Copy "Your part" for the group ] |
| ---------------------------------------------------------------- |
| Next: Creative freedom                                           |
| [ <- Back ]                                          [ Next -> ] |
+------------------------------------------------------------------+
```

- **Talk track:** three to five lines per slide or stop, from `CONTENT.md`.
  On a slide with stops, the lines that name another stop ("Stop 3, …" in
  English, "(Stop 3, …)" before the Arabic) step back to muted, and the
  current stop's first line scrolls into view on each press; lines that
  name no stop (the pushback, the close) stay as they are (the visual
  review, 2026-10-20: slide 4 had 17 lines at one weight). The pushback
  question that names the client's goal sets the goal on its own line,
  in `<bdi dir=auto>`, under "Their goal, in their words:", between the
  question's two halves.
- **Temp check:** every three to four slides, as the framework asks.
- **Timer:** elapsed against the deck's target (30 minutes onboarding since
  the kickoff joined its end, section 23; 28 launch; `TARGET_MINUTES` in
  `decks.ts`); amber past the target, never red.
- **Booking buttons:** Brand Blueprint (onboarding) and first check-in
  (launch), through the existing `BookCallButton` (real GHL bookings; never
  tested on a real client).
- **Uploads:** add, progress, "Saved", errors and Undo (section 10).
- **Agreement and their pick:** the creative freedom stamp and the L4 star
  (8.3, 8.4).
- **Videos:** a Video section per slide with a slot: Play on screen, Copy
  link, or why there is none (21.4).
- **One screen:** share the deck window, not the desktop, and float the notes
  window beside it, with the deck maximised rather than in full screen. The
  notes stay out of the share only if Zoom captures just that window; this is
  checked before the first real call (section 17).

### 12.3 The prep view (before the call, never shared)

`/clients/:key/present/:deck?view=prep`, opened from the client page. It
uses cockpit UI around a live, interactive canvas preview.

```text
1440 x 900, the CSM's laptop
+- <- <Client> -- [ Onboarding | Launch ] ------- 8 of 11 ready --------- [ Present ] -+
| +- canvas preview (scaled, interactive) ------------+ +- Slide 3 · Your ads -------+ |
| |                                                   | | Creatives        4  Ready  | |
| |                                                   | |  [upload area / tray]      | |
| |             (the deck, live)                      | | Page name   <name> Ready   | |
| |                                                   | |  from the kickoff form     | |
| |                                                   | | Call to action  Learn more | |
| +---------------------------------------------------+ |  Default       [Change]    | |
| [1 Cover *][2 Journey *][3 Ads *][4 Freedom !][5 Form x]| Primary text  Missing [Add]| |
| [6 Call !][7 Portal *][8 Part *][9 90 days *][10 Go *] | -------------------------- | |
|                                                       | Hide this slide   [ off ]  | |
| Deck: Language [EN|AR]  Dialect [KW|SA]  Model [DFY|DWY]                           | |
+--------------------------------------------------------------------------------------+
```

- **The slide strip:** each slide shows a dot. Teal: ready. Amber: something
  missing but the slide works. Struck through: hidden. Clicking a slide shows
  its slots in the panel.
- **Each slot:** label, value preview, source in plain words ("from the
  onboarding form"), a status chip (Ready, Missing, Edited, Default), and one
  action.
- **The readiness count** counts slots, so the CSM sees what is left at a
  glance. Present opens the shared deck in a new window and signs the media
  URLs then (10.6).

Slot copy (active, plain, says what to do):

- "No logo. Upload one, or the deck shows their first letter."
- "No go-live date on the card. Add it here; the cover and the 90 days use it."
- "Cover: pick one of their custom creatives, or the cover shows the lanes."
- "No ads yet. Upload them here so the tray is full before the call."
- "Large video (64 MB). Export a lighter copy for the call."
- "No form confirmed. Pick their form from their campaigns and tick 'This is
  their form', or type the questions. Otherwise the form slide stays hidden."
- "Starter pack for Kitchens? Tick it only if a ready pack exists. Otherwise
  slide 7 of onboarding doesn't name the service."
- "Consultant's name missing. The call shows 'To give us' in its place."
- "The call's story: delays. Their selling point: 'a site supervisor on every
  project'. Change the story if they don't match."
- "Budget band: riyals, works scale. Change it if it doesn't suit their
  projects."
- "Call guide not checked. Open it, and tick once it's the page the dialer
  reads."
- "Do's & Don'ts: 3 from the card, 2 typed on the onboarding call. Pick the
  ones to show, and copy the typed ones to the card."
- "Service model not set. The deck uses done for you. Change it if their team
  calls."
- "Done with you: Mahara OS not approved for this client. Its rows stay
  hidden."
- "Dialect from the country: Saudi. Change it if they speak Kuwaiti."

Everything prep saves goes to `cockpit_csm_deck_prep` (overrides, hidden
slides, language, dialect, service focus, agreed-at), gated and audited.
Video links are not prep: the Videos section (21.5) saves to
`cockpit_csm_deck_videos`, shared by every client's deck (`VIDEOS.md`).

---

## 13. RTL and Arabic

### 13.1 Mirroring

- `dir` and `lang` on the canvas. Logical properties everywhere
  (`inset-inline-*`, `margin-inline-*`, `text-align: start`).
- There are no gradients to flip (3.1). The journey's SVG layer mirrors with
  `scaleX(-1)`; no text lives in SVG.
- The tray, rails, stage rails and tables run from the right.
- Phones mirror only when the slide's app language is Arabic (7.1).
- The call: the two tracks mirror with the slide. In Arabic the customer's
  track starts at the right edge of the transcript and the caller's 160 px in
  from it (11.3).

### 13.2 Mixed text

- Client names, page names, handles and logos go in `<bdi>` with `dir=auto`.
- English inside an Arabic line is isolated (`⁦…⁩`).
- Arrows that mean "next" mirror. The `.dk-ltr` class is only for arrows
  pointing at something left to right (an English document).

### 13.3 Numbers and dates

- Arabic-Indic digits through `Fig`, never `٬`. Step numerals from
  `"١٢٣٤٥٦٧٨٩"`.
- Dates through `Intl.DateTimeFormat` with `calendar: "gregory"` and
  `numberingSystem: "arab"` forced. `ar-SA` defaults to the Hijri calendar,
  which would put the wrong dates on a Saudi client's 90 days.
- Month names as the Gulf writes them (أكتوبر, نوفمبر), with the day name
  (الأحد ٢٦ أكتوبر).
- Times and dates stay at body size or smaller in Arabic.

### 13.4 The call clock exception

The clock runs at 72 px from 0:00. In Arabic-Indic digits it would open on
`٠:٠٠`, the lone-zero trap at headline size (it reads as dots). The clock
therefore uses Latin digits in both languages while it runs, as a phone's
call timer reads. Once the call ends its label says "Call length" (مدة
المكالمة) and it is a length, not a timer: from then on (the end of stop 6,
and stops 7 and 8) it takes the deck's digits, ٤:٥١, beside stop 8's card
and its other Arabic-Indic numbers; 4:51 holds no ٠ (the fixer's round,
2026-10-20).
A video's length on a tray thumbnail (0:24) is a timer too, with the same
trap, and keeps Latin digits for the same reason. Every other number in the
Arabic deck is Arabic-Indic, the thumbnails' shapes included (٩:١٦, ٤:٥).

### 13.5 Register (for the copy pass)

- The Arabic is written under the voice skill, in the client-facing,
  warm-professional register: a white Gulf that a Saudi engineering office
  reads as serious.
- No ج/ي spelling swaps in slide text, and no strongly Kuwaiti markers (شنو,
  ييك) in headings.
- No exclamation marks, no em dashes (".." where a pause is needed), plain
  quotes rather than guillemets.
- Never مقاول for the client.
- The client is addressed in the plural in both decks, and the lanes read
  عميلكم / فريقنا / أنتم (`CONTENT-AR.md`, decision 1).
- On slides the test is الاختبار and نختبر, never فترة التجربة, which reads as
  a probation period (`CONTENT-AR.md`, decision 10).
- The call's own lines are dialect on purpose; the slides around them are not.
- Arabic sizes run a step up from English (section 4); headings at 700.

---

## 14. Empty and fallback states, every client-data slot

| Slot | Source, in order | On the canvas when missing | Prep says |
|---|---|---|---|
| Client name | Card name, then the form's business name | Always present | |
| Logo | `cockpit_client_logos`, then a prep upload | Monogram (7.7); a dark logo sits on an `--dk-ink` plate | "No logo. Upload one, or the deck shows their first letter." |
| Avatar inside ads | The Page's Meta profile picture, then the logo, then the monogram (7.1) | Monogram, plain, no ring | |
| Presenting CSM | The signed-in seat's first name | "Your client success manager" alone | |
| Go-live date | Card `launch_on` / `launchDate`, then prep | No date line; 90 days uses week numbers | Set date |
| Cover creative | A custom creative picked in prep | The faint lanes | "Cover: pick one of their custom creatives…" |
| Past phase dates (road) | Signed, form and call dates | The check without a date | |
| Next call dates | `nextCallAt` / `nextCallKind`, kit dates | Nothing shown until booked | Book from the notes |
| Goals | Onboarding form, prep edits | The question and a live input | "No goals in the form…" |
| Services | Form, prep chips | One empty row, "+ Add a service" | |
| Chosen service | Onboarding slide 4, then the kickoff, then the form | The call uses the kickoff service; the queue card uses "your service" | "Pick the launch service" |
| Starter pack | Prep tick | Onboarding slide 7 doesn't name the service; its starter stop is hidden | "Starter pack for…?" |
| Access statuses | Kickoff answers, live ticks | "Not checked yet" | |
| Red lines | Card Do's & Don'ts (DO and DON'T only), lines typed on onboarding slide 7 | The panel invites the CSM to type live | Pick items; copy typed lines to the card |
| Drive, Leadsie, Academy links | Kit links | The notes' copy list leaves that link out and says so | |
| Creatives | Uploads, then Meta ads | Identity frames with "Your ad goes here"; the empty tray | "No ads yet…" |
| Their pick | The L4 star | Creative freedom reads "The ones you'd pick run too…" | |
| Page name | Prep, then the kickoff "Facebook page" | The client name | |
| Primary text, headline | Per creative, prep | Caption shows the page name only | Missing, Add |
| Call to action | Per creative | "Learn more" (Default) | Default, Change |
| Form questions | The confirmed form (exact form id, CSM tick), then prep | Slide hidden; journey stop 2 shows the example form, tagged | "No form confirmed…" |
| Thank-you text | The confirmed form's thank-you | "Thank you. Our team will call you within 5 minutes during working hours." | Default |
| Consultant's name | Call guide, form, prep | Amber "To give us" chip | "Consultant's name missing…" |
| Consultation types | Onboarding form | "a consultation"; the place chip | |
| Instagram handle | Onboarding form | Its bubble (4:35) is dropped | |
| Selling point (call stage 4) | Prep | Amber "To give us" chip | Add, beside the pain variant |
| Pain variant | Prep | Delays | "The call's story…" |
| Budget band | Prep, then country and scale | The script's figures, no currency | "Budget band…" |
| Call guide checked | Prep tick | The "send us anything marked 'To give us'" line | "Call guide not checked…" |
| Dialect | Country | Kuwaiti | "Dialect from the country…" |
| Service model | `serviceModel()` | Done for you | "Service model not set…" |
| Mahara OS for DWY | Prep tick | Mahara OS rows hidden; CRM wording | "Done with you: Mahara OS not approved…" |
| Calendar connected | Kickoff | Journey stop 5's amber line | |
| First check-in | Booking read-back | Nothing until booked | Book from the notes |

**Rule:** a slide whose core data is missing is hidden by default and named
in prep, rather than shown half-empty to the client. The exceptions are the
ones an empty state turns into an action on the call: goals, services, red
lines and access ticks.

---

## 15. Accessibility

### 15.1 Keyboard (the shared tab)

| Key | Action |
|---|---|
| → ← Space PageDown PageUp | Walk stops, then slides (clickers work) |
| Home / End | First / last slide |
| F | Full screen |
| L | Language |
| O | All slides |
| N | Notes window |
| P | Play the call |
| S | Subtitles |
| D | Dialect |
| 1, 2, 3 | Place the selected creative |
| M | Mark the selected creative as their pick (slide 4, the ads) |
| A | Record the client's agreement (creative freedom) |
| V | Play the slide's video, or close it (21.6) |
| Esc | Close the video, then an open panel, then the overview. Nothing more: Esc never leaves the deck |

Esc never navigates, in or out of full screen. The start/stop button on many
clickers sends Esc, and leaving would put the cockpit's client page (results,
ads, money, internal notes) on the client's screen. A test pins this
behaviour (16.3). Leaving is only "Back to <client>" (12.1).

Typing in a field is never caught; modifier keys are ignored (the sales rules).

### 15.2 Focus

3 px teal outline, 4 px offset, on every control, journey row, node,
thumbnail, phone drop target, tick cell and status chip, for keyboard focus.
The ring appears at once: it is never transitioned or faded in.
Journey rows and portal stops are buttons with `aria-current="step"` on the
current one, not tabs in a tablist: the arrow keys belong to the deck's stops.
Canvas controls drop focus after a mouse click (12.1). The overview and the
notes window trap nothing; the live pop-up (reused) traps focus and closes on
Esc.

### 15.3 Drag and drop has a keyboard route

A selected thumbnail plus 1, 2 or 3 places it. "Add a file" in the notes
window opens the picker. Thumbnails have labels such as "Kitchen reel, video,
9:16, 0:24. On Reels and Stories."

### 15.4 Reduced motion

Every stop's end state is set instantly: no line drawing, no bar drawing, no
rise on the call's turns, and slides arrive without the crossfade. Videos
show their poster with a play button instead of autoplaying.

### 15.5 Screen readers

Each slide is a section with `aria-roledescription="slide"` and its title. A
polite live region announces "Slide 3 of 10, Your ads, Reels and Stories" on
each move. The transcript is an ordered list. Provenance tags are read with
their picture.

### 15.6 Contrast

Essential text is ink or ink-2 on Space or panel (at least 5.5:1). Amber text
on Space is about 9.9:1. Ink-3 is only for future and inactive states.

---

## 16. Reuse and build

### 16.0 Phase 0: the sales split ships first

Reuse depends on splitting `deck.css`, `journeys.tsx`, `parts.tsx` and
`DeckPage.tsx` inside the live pitch deck. That split is its own PR with no
visual change: the engine half of `deck.css` into `engine.css`, `DeckShell`
out of `DeckPage.tsx`, the generic media out of `journeys.tsx` and
`parts.tsx`. It is checked with the sales order tests (36 slides) and a
harness capture compared before and after, then shipped and verified on
production before the CSM app copies any file.

### 16.1 Reused from the sales deck

Copied and pinned by `check-shared.sh`, after phase 0.

| Piece | How |
|---|---|
| Tokens, canvas, type, figures, motion, surfaces, chrome, overview, interactions (`deck.css` engine half) | `engine.css`, copied, without what section 19 drops: the hover lift and halo, the node and path glows, `dk-up`'s rise, `.dk-grad-text` and `.dk-browser` |
| The shell (`DeckPage.tsx`: scale, keys, idle chrome, hash, `?lang`, swipe, preload, overview, full screen) | `DeckShell`, copied, with the CSM's Esc rule (15.1) and the deck context (16.4) |
| `figure.ts`, `fig.tsx`, `layout.ts`, `platforms.tsx` with `assets/brands/*` (Instagram, Facebook, Meta, WhatsApp marks) | Copied as they are |
| `Rv`, `Out` (from `parts.tsx`) | After the split |
| `useBox`, `Fit`, `Shot`, `Gallery`, `Phone`, `phoneHeight`, `StopList`, `Stage`, `tourSlide` (from `journeys.tsx`) | After the split into generic media and sales-only proof. `Phone` keeps its geometry with the flat finish (7.1); `tourSlide` shows its screens as plain figures (8.7). `Devices` is not used (7.5) |
| `.dk-chat` frame (for the WhatsApp confirmation card only), `.dk-stages` names | As they are. The onboarding road is not `.dk-path`: it is drawn new in the journey's marks (9.5) |
| `overlay.tsx` `LivePage` | Only for a landing page that can be framed |
| `portal-overview`, `portal-calls`, `portal-outcome` (EN and AR) | Copied, with the Demo workspace tag |
| `mahara-mobile-{lang}.mp4` | Linked, as the sales phone slide does |
| `meeting-table.webp` (journey stop 6, unused in sales today) | Copied |
| `SCRIPTS_DOC` (the clean sample script) | Linked for done with you, from the notes window |

### 16.2 Deliberately not reused (binding over every other file)

This table is binding: `CONTENT.md` copy rule 11 bans the same names, and the
copy test fails on them.

| Not reused | Why |
|---|---|
| `jr-form-1..3`, `jr-confirm`, `jr-landing*`, `jr-thanks-phone`, `jr-booked`, `jr-slack`, every `cc-*` | They show other clients' names and brands (The Circle Consulting Engineers, PIDCO Group, amheco), a real customer's project, budget and district, agent initials, a Slack frame clients are told they are not in, and a 24-hour promise. This deck draws this client's own assets from data |
| `ads-account`, `ads-twenty-on`, `ads-twenty-off` | Daily budgets, spend and a cost per result; other clients' ads, faces and logos. Creative freedom's proof is drawn (7.9) |
| `pcm-academy`, `pcm-lesson` as they are | The classroom's Project Closing Mastery cover carries a recognisable figure; the lesson shows a member's avatar and counts in its top bar and another client's name on the video's slide. Since 2026-10-20 (the CEO) training shows masked copies made from them, `pcm-academy-masked.webp` and `pcm-lesson-masked.webp` in the client success app (20.5); the copy test fails on the unmasked names there, and the sales deck's own files stay untouched |
| `interior-majlis.webp` | The client saw it on the pitch, and behind their name it reads as their project. Both covers use the faint lanes |
| Wistia `ti2alygqn0` and callcenter.maharamedia.com | Real calls with no consent record |
| The speed slide (21×) and the MIT figures (100×) | Statistics the CSM decks never quote. "Within 5 minutes" itself is now said in words (CEO, 2026-10-20; `CONTENT.md` copy rule 1): for our calls always beside "during working hours", and on stop 3 with the hours and the night rule; done with you, their own team's lines carry no hours |
| `portal-results`, `portal-ads`, `portal-leads` | Cost per lead and lead counts |
| The pillar `Rail`, `FaqPanel`, the problem picker, prospect numbers, budget, investment, guarantee | Sales-only |
| `LogoRiver`, count-ups | No ambient motion on a shared screen |

### 16.3 Built new (`apps/client-success-cockpit/src/present/`)

| File | What |
|---|---|
| `content.ts` | Every string as `L {en, ar}`, both decks, the call script turns and the pain variants |
| `onboardingDeck.tsx`, `launchDeck.tsx` | The slide lists |
| `JourneyLanes.tsx` | The signature, plus `MiniRail` |
| `Road.tsx` | The onboarding road and the cover's road strip, in the journey's marks (9.5) |
| `mockups/` | `IgFeed`, `ReelStory`, `FbFeed`, `InstantForm` (with the example form), `WhatsAppCard`, `WhatsAppGroup`, `QueueCard`, `CalendarEntry`, `ReminderList`, `AppointmentCard`, `TestTiles`, `CrmStages`, `Monogram`, `Avatar` |
| `AdTray.tsx`, `useLaunchAds.ts` | Tray, placement, the swap, the upload state machine (driven from the notes window) |
| `Transcript.tsx`, `callScript.ts` | The call, both dialects, the pain variants, slot filling, pacing |
| `ServiceMatrix.tsx`, `AccessList.tsx`, `RedLines.tsx`, `YourPart.tsx`, `Programme.tsx`, `GreenLight.tsx` | The remaining slides |
| `NotesWindow.tsx`, `PrepView.tsx`, `usePrep.ts`, `useDeckSources.ts`, `deckContext.ts` | Presenter views, data and the shared deck state |
| `present.css` | The CSM deck's own classes, prefixed `dkc-` so nothing collides with the sales `.dk-ig`, `.dk-chat`, `.dk-path`, `.dk-call` |
| Tests in `apps/client-success-cockpit/scripts/` | Slide order; the copy rules (no leads, no cost per lead; "within 5 minutes" only beside "during working hours", and no 21×, 100×, "instantly" or "same day" for our calls; the check-in rhythm only as "weekly or every two weeks"; the fork's "thinking it over" end shared done for you; no ROI, no guarantee, no "every" on process steps, no em dash in Arabic); the banned asset names (16.2); Esc never navigates; one home per fact (each decision-table fact's key appears on one slide only); the slot table; the upload state machine |
| A harness | `present-harness.html` with fixtures, in the brief harness pattern |

### 16.4 State held in the shell

The copied engine mounts only the current slide, keyed by slide and language,
so anything held inside a slide is lost on a slide change or on L. These live
in the deck context at `DeckShell` level, beside `lang` and `tour`:

- the launch ads state: the tray, what sits in each phone, pending uploads;
- prep drafts typed live: goals, red lines, access ticks;
- their pick and the creative freedom agreement;
- the transcript cursor, which drives `tour`, so P and → stay in step.

Typed fields save to prep on change with a 600 ms debounce, so a slide change
mid-sentence loses nothing. Media loading is in 10.6.

---

## 17. To check before shipping

These are facts the design depends on that nobody has verified yet.

1. **WhatsApp confirmation wording:** the exact text of the Booking Router
   confirmation template. The structure is known from a live message (7.6);
   the words are not.
2. **Meta's Arabic button labels:** the real Arabic strings for the call to
   action values ("Learn more", "Get quote", "Book now", "Send WhatsApp
   message"), read from a live preview (`previews.fresh`) rather than guessed.
3. **The bank line:** whether Meta's small first charges are worded as the
   framework says, and what the statement shows, before the green light
   repeats it.
4. **The sales proof screenshots: answered, no.** `ads-account` and
   `ads-twenty-*` show budgets, spend, a cost per result, other clients' ads,
   faces and a logo. They are never used; creative freedom's proof is drawn.
5. **Zoom and macOS:** whether a floating notes window stays out of a window
   share on macOS and Windows, and whether dragging from Finder works with the
   deck maximised. Until then, present maximised, not full screen.
6. **Instant form colours** against a current dark-mode form.
7. **Reminder buttons:** whether the day-before reminder has buttons on this
   client's account (Appointment AI is live on 8 accounts). None are drawn
   until this is known per client.
8. **The client's own booking alert:** what the WhatsApp alert and the Mahara
   OS appointment show, before the call's stop 8 is drawn as more than "our
   caller's notes" (`CONTENT.md` open question 21).
9. **The Page profile picture:** that the media API returns it through the
   ad's `page_id` once Leadsie access exists (7.1).
10. **Saturday hours:** whether "from 10 the next working morning" holds on a
    Saturday, when one caller starts at 12 (`CONTENT.md` open question 13).
11. **The frame policy, on production** (the spec review, 2026-10-20). After
    the ship, on cockpit.maharamedia.com: open a client's creative preview
    (Meta's frame), the Portal tasks sheet (ClickUp's form) and one
    launch-deck video. All three must load. The harness runs on Vite
    without `vercel.json`'s headers, so only this check sees the policy
    (`VIDEOS.md` 6).
12. **A real video over a real Zoom share** at 1280 and 1366 wide: the
    control wakes with the chrome and hides with it; "Optimize for video
    clip" ticked while it plays and unticked after, and the slides sharp
    again once it is unticked.
13. **Each provider's messages,** read from a real frame: YouTube's and
    Vimeo's ready, play and error; whether Wistia's iframe player posts
    play and error at all. The samples are pinned in `videos.test.ts`
    (`VIDEOS.md` 6). Loom and Drive with sharing turned off: what the frame
    shows, and that prep's "Check it plays" shows the same.
14. **The six seeded videos** watched once for another client's name,
    account, ads or calendar, and for their spoken language (`CONTENT.md`
    open question 30), the 11-second calendar Loom first.
15. **The masked screenshots** at full size: no face on the Project
    Closing Mastery cover, no member's avatar or counts, and no other
    client's name on the lesson's video frame, in Latin or Arabic.

---

## 18. Self-critique: what changed after checking against the brief

The first plan was checked against the CEO's words ("really visual", "show
them the customer journey", "remove any repetitive steps", "upload and swap
their ads", "the funnel", "an example call", "creative flexibility", "our own
version", "so they know everything beforehand") and the lead's rules. What
changed:

1. **The journey.** First drawn as the sales deck's horizontal numbered path
   with a stage below. That is generic, a copy of the sales filter slide, and
   it only encodes order. Now it is the responsibility lanes. They encode who
   does each step, which is what the launch call exists to settle. They make
   done with you honest without a second design, and they put the no-show
   rule on the drawing.
2. **Whose pictures.** The first plan reused the sales journey screenshots.
   Read closely, they carry other clients' names (a consulting engineers'
   form, PIDCO Group's WhatsApp confirmation). The brief says this client's
   real assets, so every customer-facing picture is now drawn from this
   client's data. Screenshots stay only where they are masked and labelled
   (Mahara OS, Demo workspace). After the critique this became binding: the
   `jr-*`, `cc-*`, `ads-account` and `ads-twenty-*` files are banned by name
   (16.2).
3. **Stop 4, the call.** First drawn as an incoming call on the customer's
   phone with the client's name as caller ID. That is a small lie: caller ID
   shows a number. It is now the call queue card, which shows a true mechanism
   (new enquiries jump to the top) and carries the hours and tries sentence
   the lead fixed. After the critique its new row lost "just now" and the
   "Calling" chip. Since the CEO's answer of 2026-10-20 the words beside it
   say the call within 5 minutes during working hours, so the card still
   carries no speed chip: it would say the same thing twice. Done with you,
   its one chip, "Your team", says who calls.
4. **The reminders.** First drawn as a phone lock screen with three
   notifications. That needed invented message text and caller IDs. It is now
   a plain timeline, worded as what we do, with no buttons drawn, and it lives
   after the example call (11.5), where the call's last line promises it.
5. **The ads slide on a shared screen.** Three equal phones put the page
   name and caption at about 11 px in a Zoom window. Overview plus focus stops
   were added, with drawing-callout leaders naming the parts in deck type and
   mockup text at 1.25x real.
6. **The launch cover.** First a Mahara villa render behind "<Client> goes
   live". That reads as their project, which the fast-launch rules forbid.
   After the critique it is a custom creative only, at its own size inside a
   phone, and the faint lanes by default. The render is not used on the
   onboarding cover either: the client saw it on the pitch.
7. **Repetition.** The lead's outline shows the confirmation and reminders
   both on the journey and after the call, and the ad and form both on the
   journey and on their own slides. The decision table in `CONTENT.md` now
   gives every fact one home (8.0). The journey is seven stops; the ones with a
   deep dive are thin (a picture and one line), and the mini rail makes the
   callback without words.
8. **Motion.** The first plan had the current node pulsing and the ads
   looping in every phone. On a Zoom share, moving pixels blur the text around
   them and arrive at a few frames a second. Now nothing loops; every motion
   is one press, short, then still, and only the phone in focus plays video.
9. **The call clock.** In Arabic-Indic digits it opened on `٠:٠٠` at 72 px,
   the lone-zero trap. It now uses Latin digits in both languages, a stated
   exception.
10. **Dates for Saudi clients.** `ar-SA` formats Hijri dates by default, which
    would have put the wrong weeks on the 90-day programme. The Gregorian
    calendar is now forced.
11. **The onboarding foot rail.** The first plan put the road at the foot of
    every onboarding slide. With seven slides and the road on its own slide,
    it only repeated it, so it was removed. The launch deck's mini rail stays
    only on slides 3 to 7, where it means "this slide opens stop N".
12. **Do's & Don'ts on screen.** First shown straight from the card. The card
    has a NOTES section for internal remarks, so only DO and DON'T items show,
    picked by the CSM in prep.
13. **The 90 days.** The first sketch placed "first booking" and "first
    project won" on the timeline, which reads as a dated promise. Milestones
    are now an undated sequence under the chart, and the test window has a
    fading end because "the first weeks" is not a date.
14. **"Agreed".** A tick next to rules can look like a contract term. It is
    now worded as agreeing how we test, recorded from the notes window with an
    audit row, and reversible. After the critique nothing on the canvas asks
    for it: the stamp appears only once the client has said yes.
15. **The call slide's columns.** The first layout had three columns (call
    card, transcript, a slot legend). It was too busy for a shared screen. The
    legend became one line under the transcript, and the slot colours carry
    the rest.
16. **Live upload risk.** Uploading in front of a client could stall on a slow
    connection. The preview now shows instantly from the local file and the
    save runs behind it. After the critique the on-call moment is a click from
    a tray prep filled; adding a file, its progress and its errors live in the
    notes window, so no picker, percentage or error is ever shared.
17. **Register.** The first drafts borrowed the sales deck's cheeky Kuwaiti.
    Over half the audience is Saudi and these are engineering firms, so the
    slides use the warm-professional client register. The dialect lives only
    inside the example call, where it is the point.
18. **The generic test.** Run against a templated client deck (logo cover,
    agenda bullets, icon grid, horizontal stepper, stats, thank-you), the plan
    keeps only the agenda, which is genuinely today's order. Everything else is
    either the client's own words and pictures or the lanes.

**One thing left as it is, on purpose:** the deck stays dark and in the sales
deck's palette, even though the cockpit around it has a light theme. The deck
is the brand on a shared screen (Brand Guidelines v1.0: dark by default for
web), and the lead ruled out a second palette.

---

## 19. Hallmark audit

Run on 2026-10-19 with this file as the target, before any code exists.
The method is Hallmark's audit verb: its six disciplines, its named
anti-patterns, the 58-gate slop test with the six-axis pre-emit critique, and
its typography, motion, colour, layout and slide references. Anthropic's
frontend-design skill was the second reader. The file was read as the design
system for a 1920 x 1080 canvas shown on a Zoom share, and no genre loosening
was applied to any gate.

**The two exceptions the lead set, and how they were graded instead.**

1. **Phone frames on the ad and form slides.** Gate 47 bans drawn device
   chrome. Here the phone is the subject of the brief: the client sees their
   ads as their customer will. So the phones were graded on honesty and
   minimalism instead: the geometry only, a flat finish, no invented counts,
   and only where the customer's screen is the point (7.1). The browser bar,
   the `Devices` pair, the phone around our own app's recording and the
   WhatsApp-styled group list were outside the exception, and were fixed.
2. **The Mahara brand tokens.** The palette is the sales deck's `--dk-*`
   tokens (Brand Guidelines v1.0; the repo rule is no second palette). So
   Hallmark's theme catalog, its OKLCH rule and its ban on pure black inside
   real-app mockups were not applied. What was graded is how the brand tokens
   are spent: one accent and one warning colour, no gradient, no glow, and
   every value a token.

**Pre-flight.** Faces: Geist, Geist Mono and IBM Plex Sans Arabic, loaded by
`<link>` (section 4). Palette: the sales `--dk-*` tokens plus 3.2. Motion
library: none, CSS only. Canvas: 1920 x 1080, scaled to the window. No earlier
Hallmark stamp exists in the project. The sales deck is the system these
decks extend, so Hallmark's variety rule is inverted, as it is for any project
with a design system: the decks share that system on purpose, and variety is
judged between slides.

### 19.1 Punch list, ranked as found

Each item gives the severity, the tell, where it was, why it reads as
generated, and the fix now written into the section named.

**Critical (ships as slop)**

1. **[critical] Gradient line and gradient accents.** 3.1 (`--dk-grad` for
   "the lit journey line, display accents"), 6.2, 6.9, 9.5 (the gradient
   road dots), 13.1. Blue to teal on the one line the client follows is the
   blue-to-cyan gradient generated pages carry, and "display accents" invites
   gradient text. → The gradient and Royal Blue are unused on both decks;
   every lit line, node and road segment is solid teal; no gradient text
   anywhere (3.1, 6.2).
2. **[critical] Re-drawn browser chrome.** 6.3 stop 7 and 8.7 asked for "a
   browser frame", and the sales deck's only one is `.dk-browser`: a bar with
   three dots and a Mono address. 7.5 used it through the `Devices` pair.
   Outside the phone exception, this draws a browser inside the client's real
   browser. → Screens are plain figures with a 1 px
   edge and a 16 px radius (6.3, 8.7); `Devices` is dropped (7.5); the
   portal's phone recording has no bezel (8.7).
3. **[critical] Side-stripe bars, in four places.** 6.1 (a 4 px teal bar on
   the current row), 8.4 (a 3 px amber bar on each red line), 9.2 and 8.9 (a
   teal bar beside the client's words), 9.7 (amber-barred inputs). The thick
   one-edge stripe is among the most recognised templated marks, and here it
   was the answer to four different jobs. → No bars. The row band's fill, the
   amber panel's fill, and the client's words marked by weight and source
   (6.2, 8.4, 9.2, 9.7).
4. **[critical] The uniform tile grid.** 8.8: five equal 312 px tiles, each a
   picture over the job over a Mono "WHY IT MATTERS" kicker. The stock feature
   grid with an eyebrow inside every card. → The matrix's "You" column as a
   five-row checklist, with "Why it matters" once as a column head (8.8).

**Major (looks AI-generated)**

5. **[major] Glow on a dark ground.** 6.2 (the current node with the sales
   30 px teal glow, and a glow on the lit line), the `--dk-halo` hover. A
   coloured halo on dark is the generic "premium" effect, and a share
   compresses it into blocks around the one thing the client should read.
   → No glow anywhere. Current is a solid fill with a `--dk-deep` dot (6.2).
6. **[major] Four hover effects at once.** 3.1, "the one hover and lift
   system": a lift, an edge ring, a teal halo and a drop shadow together
   (gate 13), on a canvas the client watches. → The border turns `--dk-edge`
   in 120 ms, nothing else (3.1, 5.3, 12.1).
7. **[major] An eyebrow on every slide.** 4.1 ("Label (eyebrow): Geist Mono
   24, teal"), 8.3 ("slides 3 to 7 all do this"), and Mono capitals in teal
   above the titles in 8.3 to 8.6, 8.10, 9.2 and 9.4; in 9.7 a "NEXT" tag
   beside its heading (gate 54). Nine kickers are a tic, not structure. →
   `CONTENT.md`'s strings are kept and set by what they mean: owner lines in
   the lane heads' own type and tone (8.3), datelines in a letterhead row
   (8.1, 9.1), the goals' source as a provenance tag (9.2). The kickers that
   only repeated a title are gone (8.10, 9.4), and "Next:" sits inside its
   sentence (9.7). No capitals, and no Mono above a title (4.1).
8. **[major] A chat skin on a phone call.** 11.2, 11.3, 13.1:
   WhatsApp-style bubbles with tails, outgoing on the end side, and three
   typing dots. That is the chatbot-demo look. It tells the client a bot
   answers their customers, and it blurs into the real WhatsApp card at
   stop 7. → A two-track call record: speaker name, Arabic line, subtitle,
   and a pause instead of dots (11.2, 11.3).
9. **[major] Stock motion.** 5.3 (a 620 ms rise-and-stagger on every slide),
   8.8, 8.9 and 9.3 (tile, diamond and row staggers), 10.2 (a scale on the
   swap), 6.7 (a cross-slide node hand-off). Everything animates, and on a
   share sent at a few frames a second that is the blur section 1 warns
   about. → One 200 ms crossfade per slide; motion only where it carries
   meaning; one change per press (5.3).
10. **[major] Three equal numbered columns, with a card inside a card.** 8.4:
    a 3-up grid numbered 1 to 3 though nothing is a procedure, and the amber
    panel nested inside a column card. → Unequal columns (520, 600, 400), no
    numbers, and only the fixed column drawn as a surface (8.4).
11. **[major] The generic stepper.** 9.5: the sales `.dk-path` (52 px
    gradient dots, arrowheads, centred labels, a glow on today), the very
    stepper section 2 named as the template to avoid. → The road is drawn in
    the journey's marks, each label starting at its node (9.5, 7.9).
12. **[major] Icons in circles, and a decorative glyph.** 7.9 and 9.3 (a role
    glyph in a circle on each group row), 6.5 (a moon on the night line). The
    icon-list template, and an ornament with no job. → No glyphs; one icon
    set (lucide-react, already in the app) for the few marks that do a job;
    no emoji (6.5, 9.3, 11.5).
13. **[major] A WhatsApp screen that does not exist.** 7.9: the group drawn as
    a WhatsApp-dark chat panel listing roles and what each one does, which
    WhatsApp never shows. → A deck panel headed by the real WhatsApp mark.
    WhatsApp's own colours stay only on the confirmation the customer
    receives (7.6, 7.9).
14. **[major] Weights that read as defaults.** 4.1: Geist 600 headings over 400
    body. → Headings 700, body 400, labels and chips 500 and 600, and the
    client's words at 400 (4.1).
15. **[major] Teal spent on decoration.** 9.1 (the client's name in teal), 7.1
    and 7.7 (teal rings on their avatar and monogram). Teal means ours or lit
    (3.1); on their name and logo it says something false. → Their name,
    logo and words are ink, with no rings (3.1, 7.1, 7.7, 9.1).
16. **[major] A gradient fade on the programme bar.** 8.9: "fading out over
    weeks 3 to 5". → Solid over weeks 1 and 2, then a dashed open outline,
    the way a programme of works draws float (8.9).
17. **[major] Values outside the token block.** 6.2 (`#04121d`), 5.4
    (`rgba(6,13,36,.82)`), 11.3 (`rgba(0,207,200,.35)`), 9.6 ("ink-dark",
    never defined), 7.1 (a white plate). This is improvising mid-render
    (gate 48). → `--dk-deep` on teal, `--dk-ink` plates, tags with no ground,
    and every value on the canvas a token (3.2).
18. **[major] A glossy phone.** 7.1: the sales phone's gradient bezel, inner
    highlight and 80 px shadow. The frame is allowed; the gloss is not
    minimal. → The same geometry with a flat `--dk-deep` bezel, a 1 px edge
    and one tight shadow (7.1).

**Minor (small taste issues)**

19. **[minor] Sizes under the deck's own floor.** 4.1 (chips and leader labels
    at 22, under the 24 px floor that 4.2 sets for anything the client reads),
    10.1 (tray durations in Mono 16). → Chips, labels and tags at 24;
    durations at 20 (4.1, 4.2, 10.1).
20. **[minor] Near-duplicate sizes.** 4.1: lead at 38 beside H3 at 40. → Lead
    at 40; weight and ink tell them apart (4.1).
21. **[minor] Mono in seven roles.** Section 4: eyebrows, lane heads, tags,
    speaker tags, times, durations and "why it matters", so the outlier face
    is in more than two places (gate 38). → Mono for the labels of record
    only (4).
22. **[minor] Decorative rules.** 6.2 (a coloured rule under each lane head),
    9.7 (a divider between two statements), 8.9 (a rule under the chart), 8.6
    (a rule inside the call card), 11.3 (a hairline over each subtitle). →
    Removed. Bands, gaps and alignment carry the structure.
23. **[minor] "Preview" four times on one slide.** 5.4, 8.3. → Once, after the
    title, as `CONTENT.md` L4 has it (5.4, 8.3).
24. **[minor] Translucent tag pills.** 5.4: glass with no purpose, since the
    tags sit outside the pictures. → Plain Mono captions (5.4).
25. **[minor] The date in a pill.** 8.1. → Set as type: "Go-live", then the
    date at 40/700 (`CONTENT.md`: "Date, large") (8.1).
26. **[minor] Cards floated over a scrimmed photo.** 6.3 stop 6, 6.4. → The
    render unscrimmed at the top of the stage, the fork's cards beneath it.
27. **[minor] A headline left to grow by itself.** 8.10: the question moves
    from H2 at stop 1 to display at stop 2 with nothing saying how, and a
    scale would blur on a share. → A crossfade between the stops, with the
    question and the rail held at the inline start (8.10).
28. **[minor] Capitals in the wireframes.** 8.3 to 8.10, 9.2, 9.4, 9.7. Arabic
    has no case, so capitals would make the two decks differ. → Sentence
    case everywhere; no `text-transform` (4.1).
29. **[minor] Tabular figures named only for the clock.** 4.1. → On every
    figure that lines up or changes (4.1).

**Summary: 4 critical · 14 major · 11 minor.** Verdict as found: reads as
AI-generated. The bones were specific to this brief: the lanes, the
programme, the provenance tags, no stats slide. The finish was the
template's: gradient, glow, side bars, kickers, a tile grid, chat bubbles
and a stagger on every slide.

### 19.2 What already passed, unchanged

- **No invented numbers** (gate 46). There is no stats slide. The 291-second
  median paces the call and is never printed. The test tiles are tagged
  Illustration, and every example picture is tagged.
- **No centred, full-height hero** (gate 6). Both covers are biased to the
  start, with a picture on the end half.
- **Faces** (gates 1 and 37). Geist, Geist Mono and Plex Arabic: three
  families, and the third is a script face, not a display face.
- **No service icon grid, no thank-you slide, no logo wall.**
- **One accent and one warning colour,** each with a stated meaning (3.1).
- **Motion stepped by the presenter.** Nothing loops, and reduced motion is
  specified for every moving part (gate 27).
- **Honest phones.** No counts, no fake comments, and "Sponsored" always
  shown.
- **Focus** is visible on every control, and Esc never leaves the deck.

### 19.3 What changed, by section

| Section | Change |
|---|---|
| Top, 2 | The audit noted; one line language (node, line, leader) for every path; the road no longer a web stepper; weights and token use named as free axes |
| 3.1, 3.2 | Gradient, Royal Blue, halo, drop and the sales hover unused; `--dk-edge` the one hover signal; teal never decorative; `--dk-cut-ms` and `--dk-hover-canvas-ms` added; locked values |
| 4 | Headings at 700; lead at 40; owner line, dateline, speaker name and column head rows; Mono for labels of record only; chips, labels and tags at the 24 px floor; no italic, no capitals, tabular figures |
| 5.3, 5.4 | Motion vocabulary rewritten around one slide crossfade; tags as plain captions; "Preview" once on the ads slide |
| 6 | No rule under lane heads; no bar on the current row; no glow on node or line; solid lit line; the meeting render unscrimmed; stop 7 as a plain figure; no moon; arrival by crossfade; no hand-off |
| 7 | A flat phone, and phones only where the customer's screen is the point; logo plates in tokens; no rings; no `Devices`; the WhatsApp card trimmed to header and message; the group panel deck-native; the road strip in the journey's marks |
| 8 | 8.1 letterhead and the date as type; 8.3 owner line and one "Preview"; 8.4 unequal, unnumbered columns; 8.6 the call slide's layout; 8.7 plain figures and no bezel; 8.8 the five-row checklist; 8.9 the open bar end; 8.10 crossfade and start-biased close |
| 9 | 9.1 letterhead and the name by weight; 9.2 their words by weight and source, answers on the ground; 9.3 no glyphs; 9.4 kicker removed; 9.5 the road redrawn; 9.6 token; 9.7 no rule and no "NEXT" tag |
| 10, 11 | Durations, swap and progress bar; the call as a two-track record with pauses |
| 12 to 16 | Canvas hover rule; RTL for the two tracks; logo plate and date line in the slot table; the focus ring never fades in; reduced motion; the reuse lines for `engine.css`, `Phone`, `tourSlide`, `Devices` and `Road.tsx` |

### 19.4 Pre-emit scores, before and after

| Axis | Before | After | Why it moved |
|---|---|---|---|
| Philosophy | 4 | 5 | The thesis was there from the start: the client's own drawing, their own assets, honest provenance. Now it reaches the finish: one line language taken from the subject's drawings, and teal kept to its meaning. |
| Hierarchy | 3 | 4 | Nine kickers, four "Preview" tags and a crowded cover competed with the titles. Now a slide has at most one line above its title, and the cover is a letterhead, a display line and a date. |
| Execution | 3 | 4 | Fixed: sizes under the floor, loose hex values, an undefined token, and glows a share turns to blocks. It earns a 5 only when it has been seen on a real Zoom share (17.5). |
| Specificity | 3 | 4 | The lanes were specific; the call, the road, Your part and the group were stock (a chat, a stepper, tiles, an icon list). Each now comes from the subject: a call record, the drawing's marks, the matrix's "You" column, a list of roles. |
| Restraint | 2 | 4 | Removed: the gradient, the glows, the halo hover, the stagger, the typing dots, the hand-off, the rings, the rules and the bars. What still moves carries meaning. |
| Variety | 4 | 4 | Slide shapes already varied. The decks share the sales system on purpose. |

Before: `P4 H3 E3 S3 R2 V4`. Restraint under 3 triggered the revision pass
above. After: `P5 H4 E4 S4 R4 V4`. When `present.css` is written, its first
line carries the stamp:

```css
/* Hallmark · pre-emit critique: P5 H4 E4 S4 R4 V4 · design system: DESIGN.md (audited 2026-10-19)
 * exceptions: phone frames on the ad and form slides; Mahara brand tokens (no catalog theme) */
```

### 19.5 Left for the build

- Run Hallmark's audit again on the built `present.css` and slides. The
  gates that can only be checked in code are 10 to 18, 26, 27, 40, 41 and 48.
- Capture the harness at 1280 x 720 (the size of a Zoom window) in both
  languages before the first real call. Section 17.5 already asks for a real
  share test, and the call record, the solid line and the flat phone are
  judged there.
- `CONTENT.md` names a presentation in a few places: O2's "four cards", L8's
  "five tiles" and "a teal 'Why it matters' line", and the "Eyebrow:" lines.
  The words stand; this file decides how they are drawn (see the top of the
  file). A later content pass could say "rows" and "owner line" so the two
  files read the same.

### 19.6 The critic pass on the built slides (2026-10-19)

A design critic scored the built slides on the six axes; seventeen came in
under 4. What changed, by section. Where this list and an earlier line
disagree, this list wins.

| Section | Change |
|---|---|
| 9.1, 8.1 | Both covers anchor their stack 72 px under a fixed 76 px letterhead, so the plate sits at the same height for every client. The name steps display → h1 past 20 characters → 60 px past 30 (Arabic: 14 and 20). The faint lanes are drawn as lane edges (1 px `--dk-line-strong`, open at the foot) under the journey's lane heads in ink-3, not three filled panels. The launch cover's phone sits on the content's end edge; its lead is balanced. |
| 9.2 | The provenance tag sits beside "In 90 days", not at the far end of a short line. Answers in the other script hug their own lines (`hug.ts`) against the label's edge, aligned to their own start. Nothing written: the title reads "Your goals, in your words". |
| 9.3 | The group panel runs the content width: the group's name with the hours line as its description, a hairline, then the five roles as a roster three across (role over line), not a two-column table. |
| 9.4 | "Launch with this" and "Add a service" are quiet text controls (ink-2 and ink-3, hairline or no underline), never a filled teal button. Confirmed: the result's lead-in as the label and the service alone in a `<bdi>`. The small line shows only beside a candidate. |
| 9.5 | The road spans the content width exactly (gap = (1648 − 272) / 5); its date captions are in the sans with the other captions. |
| 9.6 | Arabic rows close up (12 px, 7 px with six rows; reasons at 1.5) so the list ends level with the English; the Drive link is set as plain text. |
| 9.7 | No placeholder on the client's canvas: before a red line exists the input is a ruled line; after, it is hidden until the CSM points at the panel. The waiting variant of the first-ads line no longer says the approval twice. Stop 2 says "Starter, from our templates" once, under the title; the approval anchors the column's foot; the pair sits on the end edge; a placement caption's mark sits on its first line. |
| 6.2 | Row names in the "You" lane step down to the 24 px floor (Plex 26), so a 15-character done-with-you name ends clear of the stage. |
| 6.3, 6.5 | Stop 4's dots carry their names under them (the call slide's timeline words; four in done with you). Stop 3's night line is hidden done with you, and the Arabic queue uses one script. Stop 7, done with you without Mahara OS, shows their CRM's stages. |
| 6.7 | The mini rail's name sits above the line from the lit node's start edge, never on the rail. |
| 8.3 | Leader dots sit just outside the frame on the edge nearest their label, so no line crosses the app's UI; two parts on one row get two dots. No "Preview" tag beside the title (the foot says it). One caption voice under the thumbnails; no count beside an empty tray. Facebook's screen runs on into the next post's head. |
| 8.4 | Column one is 560, the panel 580, the open column 380. The page phone is 520 tall with the column's words beside it, under its leader's label. The card's "Never" lines join the told list when they say it themselves. "An ad waiting for the perfect version…" moved to the notes. |
| 8.5 | Stop 3 is "The thank-you screen": the question list stays, dimmed, and the step lights under it on the list's row band. The example form's line is "We're finishing yours." beside its tag. |
| 8.6, 11 | A "To give us" chip is one box. The legend is "Words in teal came from your files."; the one "To give us" sentence shows only when a slot is missing. The reminders' words start at one x, each time above its step as a Mono caption. Stop 8 keeps the call card and lays the appointment across the record's column (details, then the caller's notes beside them); the 60 % copy of stop 7 is gone. The call card's name may take three lines. |
| 8.7 | The overview and calls screens are cropped to the part their stop names (the appointment updates card; the recorded call and its player) at 1104 px, with a margin of the screen's own ground. "What isn't marked can't be improved." sits under its stop. The phone stop's still and poster are frames from inside the app (`portal-phone-*.webp`). Done with you, the CRM's stages are drawn in the journey's line language: "You meet" runs on to Showed, Quote sent, Closed, and "Didn't show" is a side branch that ends. |
| 8.8 | Row 4's job is "Keep the offer steady while we test"; the rest of its old wording leads its reason. No tile per row: the checklist (hairline rows, one column head) on the start side, and two large pictures on the end side, their creatives level with the first row (whole rows of three, or none) and a calendar day with a busy block level with the last. |
| 8.9 | See its keys and fallback lines. |

The pre-emit stamp at the top of `present.css` is unchanged: these fixes
bring the built slides up to it rather than past it.

### 19.7 The second critic pass (2026-10-19)

Visual, copy, backend and code reviewers walked every fixture in both
languages. What changed, by section. Where this list and an earlier line
disagree, this list wins.

| Section | Change |
|---|---|
| 7.2 to 7.5, 8.3 | No grey skeleton bars anywhere. With no primary text the Instagram caption keeps only the Page name; Reels and Facebook show no words; Facebook drops its empty headline slot. A Facebook screen ends at the action row and its gap between posts, never on a made-up next post. A form with no headline and no greeting shows the Page alone. |
| 7.5, 6.3 | A WhatsApp destination is drawn as a new chat with the business: its picture and name at the top of the chat, and the message the ad fills in waiting in the compose field with the send button lit, tagged "Example wording" (the template is not read yet). Journey stop 2 says "They message you on WhatsApp. The chat opens with their first message ready to send." The form slide's free column lists what happens next, numbered like the questions a form would have shown. |
| 8.3 | Leaders on "Your page and logo" and "Marked {word}" sit on the side where those parts are, stacked; the label quotes the word as the phone shows it, in the phone's language. "Starter, from our templates" is said once, in the foot under the phones, never per phone; in focus it is one line. The lead is one sentence ("We can show any of your creatives in the phones, right now."). Tray thumbnails: the short form "Template" (قالب) on starter creatives; the in-use chips read Feed · Reels · Facebook feed on one line; a shape in Arabic-Indic digits (13.4). |
| 8.4 | Column one sets its words at the column's full 560 px, with the page phone (400 tall) under them and its leader's label beside it. Column heads balance their lines. |
| 8.5 | The question list fades out above Next, so no label is cut through. The thank-you band carries the line alone (no repeated heading), and the thank-you screen sits in the middle of the form. |
| 8.6 | Each transcript track has one measure (820 px), so every Arabic line in a track starts on one right edge and every English line on one left. A slot under Arabic is underlined whole, below the letters' tails. Stop 8 shows one tag (the appointment's). A service not known yet shows the call's "To give us" chip, never a placeholder. The label reads "Written from our call script. The customer in it is made up." |
| 8.7 | The phone stop shows the app's own screen only: the still is cropped to the screen (586 x 1036) and the recording is cropped to the same box, so its title card and caption band never show. |
| 8.8 | One checklist across the slide. A picture sits at the end of the row it shows: three creatives on the ads row (none when fewer than three), and a calendar day (the day, three hours, one blocked) on the calendar row. |
| 6.2, 6.3 | The current row's band runs past x 800, so no name leaves it mid-word. Stop 4's names sit below and above the line in turn, each with two columns' room; the provisional bookings' dot carries its whole line. The strip sits under the lit row, never on its baseline. The queue card leaves a missing service out. |
| 6.7, 9.1 | The current node on the mini rail and the cover's road strip is a solid teal fill (a centre dot only on nodes large enough to show one). |
| 9.5 | The road's stops are one grid with a shared row for the names and one for what goes under them, so a wrapped name never pushes its date down. |
| 9.7 | Before a red line is typed, the ruled line carries a quiet ink-3 name ("Your red lines, in your words"). Both statements' bodies are ink. Stop 2 says what the phones show under its tag ("Our ready templates for {service}, under your Page name and logo.") instead of repeating the approval. |
| 12, 15 | The shared deck has its own error boundaries: a slide that throws shows "This slide could not be drawn." on the canvas and the deck goes on; a deck that cannot load at all shows a plain screen with a reload, never a stack trace. With motion reduced, a video waits on its poster with a play button (on the phone, and in the notes window). |

Copy rule 9 (plain quotes) stands: Hallmark's curly quotes were raised
again and are not used, as `CONTENT.md` records.

### 19.8 The third critic pass (2026-10-20)

A critic scored 25 slides and stops under 4 on the six axes (the AI-made
look, unfinished drawings, form fields on the client's screen, labels
leaving their lanes). What changed, by section. Where this list and an
earlier line disagree, this list wins.

| Section | Change |
|---|---|
| 6.1, 6.2 | The lanes are as wide as their names need (244, 312 and 260, 12 apart; 840 in all) and a name wraps to two balanced lines inside its own lane, never running into the next one. A wrapped name grows upwards from the node's centre line, away from the line leaving the node. The lanes end on the content's foot. The leader leaves the lit row's band at the matrix's end edge on the row's centre line and runs straight to the picture (the picture, not its tag). The rebook node is named "Didn't come?" beside it. |
| 6.3 | The stage is 756 wide. The phone stops set their words level with their own row. Stops 5 to 7 sit low in the stage, level with their rows. Stop 4's steps run down one dotted line under the words, every name at one x (no labels above and below in turn), the strip's middle on its row's centre line. Stop 6 draws the meeting's two outcomes as two cards with marks (the lanes' rebook mark on ours); the `meeting-table` render is dropped (a generic render read as AI-made, and was not the client's work). Stop 7's light screenshot is set in a dark bezel and taken down a step (brightness 0.92), as are the portal's. |
| 7.1 to 7.4 | Before a creative exists, the picture slot carries the client's mark on its ground (a brand card), never "Your ad goes here". Facebook's feed starts with its own composer row and gap, so the post fills the screen. |
| 8.3 | "Your page and logo" and "Marked Sponsored" share one leader and one dot, the label on two lines. Tray: teal only on the in-use edge; their pick's star in ink on a deep chip; the on-phone caption in ink-2; an empty tray says so in plain text, no dashed box. The foot sits under the phone labels. Platform logos stay in their own colours (Aziz, 2026-10-08: real logos, never recoloured). |
| 8.4 | Stop 1 is the page alone: its words, and the feed phone at 660 with one leader on "Sponsored". Stops 2 and 3: three columns of one height (460, 600, 460); the red lines on our panel ground, each with an amber mark and the line hugging its words (an English line in the Arabic deck reads as one block); what we test as the same kind of list with ink rings (two columns in English, one in Arabic); the approval and "Prefer something different later?" as one paragraph on the shared foot. No red lines: the card is only as tall as its sentence and the input is drawn under the CSM's pointer only. |
| 8.5 | The intro screen carries the ad's own picture as its cover (Meta's default), the avatar over its foot. The question rows are 76 tall. |
| 8.6, 11.3 | A turn is one block on its track's start edge: speaker, the line in the other script hugging its words (balanced, `useHug`), its subtitle right under it on the same edge, so the eye never crosses the track between a line and its translation. Turns are 30 apart; their parts sit close. A slot still to give us is amber words with a dashed underline inside the sentence (no box). The footnote sits under a hairline. Done with you, the label ends as a sentence before the legend. |
| 11.5 | The reminders are dots on the journey's line, one line each in the deck's face ("Booked · a WhatsApp confirmation"); no channel icons and no Mono. The block sits 60 px clear of the dimmed turn. |
| 8.7 | The screens sit in the middle of their column in the dark bezel; the calls crop ends in a gap of the waveform. Done with you, the CRM's stages light as the journey does (You meet passed, Showed lit, the rest ahead), names above the line so the no-show branch leaves the node clear, and no second "number-one job" tag (the stop says it). |
| 8.10 | Stop 1: the title on the start side, the things to know as ruled rows in the lead size beside it; the question is not shown greyed out ahead of time. Stop 2: the question and the road alone (the reminders are not repeated small above it). |
| 9.1 | The cover draws the whole journey quiet at 80% (lanes, the seven steps named in ink-3, the unlit line), not empty outlined lanes. "Welcome," is the name's own ink at 400. With no first name on the seat, the role is the presenter's one line, set as a name is. |
| 9.2 | Nothing from the form: the question is the slide (h1, in the middle of the page); the answer's line shows only under the CSM's pointer or once typed. No placeholder on the client's screen. |
| 9.3 | No card: the group's head (avatar, name, the hours) and its members as ruled rows across the content width, role beside what they message about. No WhatsApp mark (the title names it; it was the only green on the slide). |
| 9.4 | An unanswered test is a quiet ring in the line language, a yes the solid teal node with a check. The tests' heads sit on one line (264 each). The campaign card starts level with the first row. "Launch with this" is drawn only under the CSM's pointer. No services: the first row is the quiet "Add a service" control; the input's prompt shows only under the pointer. |
| 9.5 | The road runs down the page as an itinerary: one row per step (step, its date or "Today" or "After go-live", and the launch call's note), the node line at the start edge, today on the journey's row band, the footer under it. |
| 9.6 | The ticks sit under each row's words; the status column holds one chip on one line. Done is teal on its soft fill with a check (quieter than To do). The words run 820 wide. The Drive folder is a folder mark and its name in ink-2. |
| 9.7 | What to expect on the start side (two statements, a hairline between), what's next as the card beside it (name, what it is, the date on its foot once booked), both from just under the title. No red lines yet: nothing is drawn; the input shows under the CSM's pointer. |

### 19.9 The fourth critic pass (2026-10-20)

A critic scored 41 slides and stops under 4, the lowest at 2 (a cut-off
leader label, a slot spliced into a sentence, empty phones, an unfinished
form on the client's screen). What changed, by section. Where this list and
an earlier line disagree, this list wins. No copy changed.

| Section | Change |
|---|---|
| 4.2 | Every label the client reads is at the floor (24, Plex 26): the mini rail's step name, the 90 days' axis, go-live label and notes, the journey calendar's hours, the tray's captions and switch, Your part's calendar day and the slide count. The canvas still scales whole (no reflow), so at 1366 x 768 nothing outside a phone arrives under 17 px. |
| 6.1, 6.2 | Done with you, our team holds no step, so its lane narrows to its head (148) in ink-3, not teal, and the client's lane takes the room (424); the matrix stays 840 wide. The no-show branch stays in the client's lane, between "You meet" and "You mark it", out past the names, its name beside it inside that lane. |
| 6.3 stop 3 | The stop's words say the hours, the top of the list and the night rule (copy rule 1), so the card does not repeat them: no "Top of the list" chip and no night line. (Since 2026-10-20 the words say the 5 minutes, the hours and the night rule, and the top of the list is the card's own row order: 19.13.) The tries are the card's legend under it, on the start side, with the Example tag on the end corner. The rows carry their place in the queue (1 to 4, the first in teal on the row band); no ring per row. The card is set so its first row is level with the lit row when the words leave room, and the leader runs straight into that row. A long service name wraps; it is never cut. |
| 6.3 stop 4 | The steps before the meeting are drawn at the lanes' scale: nodes on the dotted line from the lit row down to "You meet" (the meeting's node level with that row), names at the row names' size and one x. The leader runs straight into the first node. |
| 6.3 stop 6 | The CRM's stage names keep one line each ("Quote sent" no longer wraps under its neighbours). |
| 7.1 | The island carries a 1 px `--dk-line` edge, so it shows on Instagram's black status bar as it does over a picture: the three phones read as one device. Before a creative exists, the picture is a brand card: the mark with the client's name under it, not a bare monogram. |
| 8.3 | With no creative anywhere, the overview is the feed phone alone in the middle, with the sentence in the tray. A phone in focus with no creative names only its page and its button (no leader on a brand card or on words it does not have). A leader's label wraps inside its side's room (266 start, 360 end) and the labels spread by their measured lines, so none is cut by the phone area's edge; the starter tag beside the phone in focus wraps in the same room. Tray: the count right after its title; the two sources as two words (the shown one in ink on a hairline), no segmented box and no count on the Meta tab; 128 px thumbnails; one caption voice at the floor (the phone it is on, or its shape), and "Template" on its own caption line instead of a chip on the picture. |
| 8.4 | Stop 1: the page's words take column one's place and size (30 px), the same at every stop, so one press changes one thing; the feed phone sits in the room the other columns take, with the label on the side where "Sponsored" is and the dot just outside the frame, the pair centred as one. Stops 2 and 3: no shrunken phone in column one; the columns hug their words, tops level (no band before a foot). At stop 2 the open column is drawn ahead, at 40%, head and list only, as the journey draws what is ahead. With no red lines the hidden input takes no room. |
| 8.6, 11.3 | A filled slot is teal with no underline (four underlined lines read as links). A name in the other script stays whole on one line. A slot still to give us is an editor's insertion in square brackets, amber, its label in the sentence's case ("At Atlas, [to give us: what makes you different, in one line]."). |
| 8.7 | Done with you without Mahara OS, the one stop's words are at the body size and the CRM drawing's branch runs deeper, so the drawing fills its column. |
| 8.9 | The first check-in before it is booked is the chart's own diamond, open (an outline), at day 10, its words starting under it; no bracket. With no goal line the chart sits in the middle of the room under the title. |
| 8.10 | Stop 2: the walked road is drawn level, as the cover's strip is (steps down toward its end read as a falling chart under the ask). Its end is always named: "Go-live", with the date once there is one. |
| 9.2 | Nothing from the form: the question alone in the middle of the page; the footnote ("They're targets…") comes once an answer is typed. |
| 9.4 | A ledger, not a form: ruled rows, the tests' heads centred over their columns (256 each), and in each cell a short stretch of the unlit dotted line; a yes is the teal node with a check. An unanswered cell shows nothing more; the CSM's pointer finds it. With no services, no heads: the three tests are said once as a line, and the quiet "Add a service" control sits under it. A service's name is never cut (two balanced lines at most). The campaign card is 360 wide and holds "Launch with this" in its bottom padding, so it has no empty half. |
| 9.5 | The road is as wide as its words (1080): the step, then its date in its own column; the launch call's note sits under its name, never in the date's column; today's band lights the row and no empty ground. |
| 9.6 | Status as words in their colour, not pills: Done teal with a check, To do amber with its dot, Not checked yet in ink-3. The parts under a row's words the same way, with no boxes. |
| 9.7 | A red line is set as on the launch deck: an amber mark, then the words in ink; no amber box around it. The next call's card is as tall as its words. |

Held, not changed: the WhatsApp confirmation in the Arabic deck prints its
date and time as the live template does ("October 21, 2026", "4:00 PM"),
as `EXAMPLE-CALL.md` and a test pin. The critic read it as a mismatch beside
the Arabic-Indic reminders. It changes when the live template text is read
(CONTENT open question 7).

### 19.10 The correctness pass (2026-10-20)

The third critic score listed what was wrong or contradictory on the
client's screen, apart from taste. Each is fixed below. Where this list and
an earlier line disagree, this list wins.

| Section | Change |
|---|---|
| 7.9, 8.1 | The cover's road strip names its lit node, "Launch call · Today", under that node; its end is not named (it had read as today, and the green light's "Go-live" named the same end another way). |
| 8.3 | The tray's count sits beside what it counts: beside the title when there is one list, beside each source when there are two ("Your creatives 6" had stood over five). With nothing in the tray, the lead is "How your ads will look on your customers' phones." ("right now" contradicted "We're finishing your first ads"). The in-use caption "Facebook feed" stays on one line (the tray's box now reaches into the gap before the phones). A leader's dot slides along its part to its label's line, and the labels spread about their middle, so the leaders run straight; a label that must sit past its part's edge gets a square elbow, never a diagonal (Reels' button leader was bent). |
| 6.2, 6.3, 6.5 | A no-show has one name: "Didn't show?" on the fork, as the CRM's stage "Didn't show". Done with you, the no-show's branch, mark and card are the client's ink, not our teal, and the queue's "Your team" chip is outlined in ink like "You do this" (it read "Your team: call now" until 2026-10-20, 19.13). The queue keeps one script per card (an Arabic service name is left off an English row, and the other way round). Stop 2's phone shows the questions screen from its top (it had opened on question 2, or on a cropped option); with no service known, the example form leaves its service question out. Stop 5's calendar starts at the booked hour, the appointment its first row, level with the lit row. Done with you, stop 7's CRM stages are set level with "You mark it" (the leader ran into empty space), and each stage name has a clear gap before the next. |
| 8.4 | A red line is set whole in its own direction: an English line in the Arabic card has its mark on its left and the English type, an Arabic line in the English card the other way round. |
| 8.6, 11.5 | The tag shows while the call plays; stops 7 and 8 carry their own tags only (stop 7 had three). The label no longer repeats the tag's provenance: "The customer in it is made up." Stop 7's steps keep the journey's tense: the booking now (solid), the rest ahead (teal rings on a dotted line). Stop 8's notes start on their label's edge. A line in the other script (the Arabic in the English deck, a subtitle in the Arabic one) wraps greedily, not balanced, so its first line is its longest and meets its block's far edge (a shorter first line had read as a stray indent). Done with you, the card reads اتصال باسم in Arabic, the notes are "Your caller's notes", the caption "It lands in your CRM.", and stop 7's block starts a line higher so the confirmation ends clear of the slide count. |
| 8.7 | The recorded call is cropped to its own row from its top edge (no white band beside the row's tint) and ends in the middle of a waveform gap. The phone's film sits in the same dark bezel as the other screens, its tag on the frame's corner. |
| 8.8 | The list ends well above the slide count in Arabic (the last rule ran through it): rows 96 high with 14 px padding, the calendar day's hours 34 apart. Done with you, row 5's why is "Your team books into the times you leave free." |
| 8.9 | The chart runs from go-live to day 90 and ends on a dashed line named "Day 90" with its date; the week heads stop at day 77, so none sits on it (the axis had stopped at day 84). |
| 9.2 | An answer in the other script is set in its own face and leading (an English answer in the Arabic deck read at 1.65). |
| 9.3 | Done with you, the lead does not name our call centre: "The people who run your ads and funnel and your success manager are all in this one group." |
| 9.4 | "Your #1" marks their #1 only while the card names another service (one service had been said three times). With no services, the tests' line and "Add a service" start on the title's edge. |
| Tests | `deck-launch.test.tsx` renders every slide and stop of both decks, in both languages, for the done-with-you client and the full client switched to done with you, and fails on any line saying our call centre, our callers or we call. `deck-shots.mjs` measures every shot and fails the run when anything painted on the slide comes within 4 px of the slide count, the mini rail or a slide's foot line. |

### 19.11 The composition pass (2026-10-20)

The third score passed the slides' content and finish but read the weakest
compositions as generated: onboarding slides 3 to 6 were four left-label
row lists in a row, several slides had no clear primary, and a few used
stock parts (the rounded "Next" card, icon-in-circle outcome cards, an
accordion of stop names, a two-column table). Each was recomposed against
Hallmark's structural variety and layout rules: its own structure, one
primary, no stock panels or icon tiles, no software chrome on a slide, the
canvas used, a measure of 75 characters or less. Copy changed only where a
composition split or cut it (`CONTENT.md` and `CONTENT-AR.md`, "Composition
pass"). Where this list and an earlier line disagree, this list wins.

| Section | Change |
|---|---|
| 9.2 | One label convention: every answer sits under its own label. The provenance tag sits once at the end of the title's line, never on a label's baseline. The 90-day goal leads at the client's-words size; the other answers sit side by side under one rule, a column each (a sentence, the challenges, why they joined), each list answer hugging its own lines on the label's edge. Nothing from the form: the question alone at the covers' display size is the slide's one heading (no title over it). |
| 9.3 | The group drawn as what it is: their avatar, the group's name and the hours on the start side, and one line from the avatar that runs straight into the middle member and branches, on rounded elbows, to each of the five; a teal dot for each of ours (an ink ring for done with you's alerts), the role and what they message about beside it. The lead keeps a 60-character measure. |
| 9.4 | The choice is the hero: "Your first campaign" and the service at display size (h1 past 14 characters) on the start side, level with the middle of their services, "Launch with this" in its bottom padding under the CSM's pointer. Their services sit beside it as a short scoreboard: the three tests head their columns once, a yes is the teal node with a check, and a test not answered shows nothing at all (no dotted line, no ring). "Your #1" is words beside the name, not a pill. No services: the three tests are the slide, at h1, one to a line, with the quiet "Add a service" under them. |
| 9.5 | The road runs across the content's whole width, as the cover's strip draws it small: six nodes evenly spaced (the last keeps a column's room for its words), each step's name from its node's start edge, what is known under it on one shared row (its date, "Today", "After go-live", the launch call's length until it is booked, "Done" for a passed step with no date), and the launch call's note on a third row running on to the content's end. The footer sits under the road; the drawing is in the middle of the page. |
| 9.6 | A checklist read down its start: each row's mark is the journey's node (done: teal with a check; to do: an amber ring; not checked yet: a quiet ring), the name with its state under it as plain words in their colour, and what it needs beside them at a 75-character measure. A done row keeps only its parts, so the slide gets lighter as the call goes on. Ruled rows, closer in Arabic and with six rows. |
| 9.7 | What to expect as two statements side by side under the title (no rule, no card). The close runs across the foot on its own rule: "Next: your Brand Blueprint call" at h1, what it is under it, and its date in teal at the end once booked. No rounded card. |
| 6.3 stop 3 | The stop's words sit directly on top of the reminder strip as one block, the strip's first node level with the lit row; each step says when it happens and what happens then ("The day before · a reminder"), in the call slide's words. |
| 6.3 stop 5, 6.4 | The two outcomes are drawn in the lanes' line language, not as cards: the leader runs into the meeting's line, which goes on, solid, to a node ahead ("Came, and thinking it over?" · yours; both of us done for you since 2026-10-20, 19.13) and drops, dotted, to the lanes' rebook mark ("Didn't show?" · ours in teal; theirs in ink done with you), each end's name and line beside it. The lanes draw the fork from the next stop on, so it is never named twice on one screen. |
| 8.4 | No eyebrow. Stop 1: one lead in ink at the lead's size with its foot line under it, in the middle of the phone's height; the feed phone on the content's end edge (stepped in by the label's room when the label sits on its far side). Stops 2 and 3: two columns, the red lines leading on our card at the start (880), what we test beside it; one top and one height. At stop 3 the approval and the footer run across under both on a hairline as one foot line. No red lines: the card's ask is set at the lead's size in ink, so the card leads before anything is written on it. |
| 8.7 | One stop at a time: its name (h3) and words under the title, its screen beside them; no list of the other stops. Stop 4 (done for you) shows no screenshot (the form is shown once, on the journey's last stop): the job is the stop's heading at h1, "A few taps, the same day." under it, its three questions as three taps on one line (ink rings), and the footer on a rule. Done with you keeps the CRM's stages. |
| 8.8 | No table: six cells on one grid, three across, the title and its line in the first, the five jobs in the rest, each the same thing (a 2 px rule, the job, why, its picture where it has one). The second row starts at one height for every client. The calendar's busy hour is a plain raised block, not hatched. |
| 8.9 | One primary: the programme, larger (96 px lanes, 36 px bar, 22 px diamonds) in the middle of the room, with its key and the milestones as its own last row (under a rule, past go-live's line). Their goal sits at the end of the title's row in their words, as the frame; an answer in the other script keeps its own leading. |

### 19.12 The form slide pass (2026-10-20)

The fourth score left one slide under 4, the form (L5), worst in Arabic.

| Section | Change |
|---|---|
| 8.5 | The leader's dot sits 10 px outside the phone's frame on the list's side, level with the lit question's first line (the ads' rule, 8.3). In Arabic the phone is on the right and an English question starts on its left edge, so the dot had landed on its first letter. |
| 8.5, 7.5 | The intro's cover, the ad's own picture, takes the screen's free height up to 4:5, the headline keeps its room under it, and any height left sits above Next; with no picture, the Page and its words sit in the middle of the screen as the thank-you sets them. It had been about 230 px of black between the headline and Next. |
| 7.8, 8.5 | The phone is 812 tall (772 under a tag), so it ends about 50 px above the mini rail's name instead of 27. |
| 5.4, 8.5 | "Example form" and "Example wording" sit above the phone's outer corner, on the eyebrow's line across the slide, not inline after "Your form". The phone is at the content's start with the words at its end, so its end corner would have set the tag on one line with the eyebrow across the gutter. |
| 8.5 | "Filters" is the word in teal, not a teal pill. |

### 19.13 The CEO's answers (2026-10-20)

The CEO answered `CONTENT.md` open questions 1 to 3, and its copy rules 1, 5
and 6 are rewritten to his words. Where this list and an earlier line
disagree, this list wins.

| Section | Change |
|---|---|
| 6.1, 6.3 stop 3, 8.0, 8.8 | "keep it 5 mins for all": the stop's words are "We call new enquiries within 5 minutes during working hours, 10 to 6, Saturday to Thursday. Anything that comes in at night is called from 10 the next working morning." (the UAE line adds its zone). "New enquiries go to the top of the list" left the words; the queue card's row order (the new enquiry first, in teal) shows the list. Done with you: "Call within 5 minutes.", and Your part's tile 2 is "Call within 5 minutes, note every try, keep every stage true". |
| 6.5, 18 | The old "never a speed" reason for the queue card is gone. The new row still carries no clock and no speed chip, because the words beside it say the 5 minutes with the hours. |
| 6.5, 6.8 | Done with you, the new row's chip reads "Your team" (فريقكم), not "Your team: call now": it says who calls, and the words beside it ("Call within 5 minutes.") say how fast, so the screen states one speed. The unused "Top of the list" string is gone from the code. |
| 7.5, 14, 8.5 | The default thank-you is "Thank you. Our team will call you within 5 minutes during working hours.", and the WhatsApp step "Our team calls them within 5 minutes during working hours." |
| 6.3 stop 6, 6.4, 19.11 | "We will call them to follow up to rebook but also the client has the most context and should follow up as well": the no-show stays ours (teal, the rebook mark). "Came, and thinking it over?" reads "Both of us. We call to follow up, and so do you: you know them best. Then mark it." That end keeps the meeting's line and node and its line in ink-2, with "Both of us." in our teal (`.dkc-fork-both`). Done with you is unchanged, all in the client's ink. |
| 8.9 | "for both put weekly-biweekly cause it depends on how long theyve been with us and what the offer": the key reads "Then weekly or every two weeks", the reason is its own ink-2 line under it and in the notes, and the chart draws both: solid diamonds every two weeks, smaller open diamonds on the weeks between (14 px against 22, so the unbooked first check-in, open at full size, keeps its own look), with both marks in the key. The first check-in, a week or two in, is unchanged. |
| 16.2, 16.3 | The 21× and 100× figures stay banned; "within 5 minutes" is allowed only beside "during working hours". The copy test (`deck-copy.test.ts`) moved with the rules: rule 1 pins the stop 3 lines (and the form's line, the thank-you and both slides' night notes) and allows only "within 5 minutes", beside "working hours" for our lines; rule 5 pins "weekly or every two weeks" and the reason, and fails either one alone; rule 6 pins "Both of us…" done for you and the unchanged done-with-you lines. |

The measured first-dial figures in `CONTENT.md` open question 1 are
unchanged by the answer.

---

## 20. The Gamma pass (2026-10-20): the pie, the training, and the slides around them

The CEO asked for the expectation setting in Mahara's own Gamma launch deck:
the sales training and "the piece of the pie", what we do against what they
do. `CONTENT.md` holds the words and the gap map ("From the Gamma decks");
this section is the design plan for the two new slides (partnership,
training), the new good-to-know slide and the changed ones (journey stop 5,
the portal's number-one job, Your part, the 90 days, the green light, O3).
It follows `mahara-context/skills/frontend-design/SKILL.md` (tokens, type,
layout, one signature, then the critique) and Hallmark (honest copy, locked
tokens, no italic headings, the slop test, structural variety between
neighbouring slides). Where this section and an earlier one disagree, this
section wins.

### 20.1 The deck now: order, rail, count, time

| # | Slide | Its design | Mini rail | Stops | Minutes |
|---|---|---|---|---|---|
| 1 | Cover | 8.1 | none | 1 | 1 |
| 2 | Journey | 6, 8.2 (stop 5's line, 20.11) | is the rail | 7 | 2.5 |
| 3 | Creative freedom | 21.1 (since 2026-10-20; was 8.4); before the ads since the fixer's round (21.12) | stop 1 | 5 | 3 (was 2.5) |
| 4 | Your ads | 8.3 | stop 1 | 4 | 2.5 |
| 5 | Your form | 8.5 | stop 2 | per form | 1.5 |
| 6 | The call | 8.6 | stops 3 to 5 | 8 | 4 |
| 7 | **Partnership (new)** | 20.3, 20.4 | none | 4 | 2.5 |
| 8 | **Training (new)** | 20.5 | stop 6, "You meet" | 3 (1 until the spec review of 2026-10-20 added the two Academy screenshots) | 2 (was 1.5) |
| 9 | Your portal | 8.7, 20.6 | stop 7 | 4 | 2.5 |
| 10 | Your part, "Your six jobs, in one place" | 20.7 (replaces 8.8's layout) | none | 1 | 2 |
| 11 | The first 90 days | 8.9, 20.8 | none | 1 | 1.5 |
| 12 | **Good to know (new)**, its title "Good to know" since the fixer's round | 20.9 | none | 1 | 1.5 |
| 13 | Green light | 20.10 (replaces 8.10's two stops) | none | 1 | 1 |

About 27 minutes before questions (about 28 since creative freedom's five
stops, 21.1, and training's two screenshot stops, 20.5), so O5 and the cover's frame now say the
call takes about 45 minutes (`CONTENT.md` open question 25). The slide
count reads "07 / 13" (`.dk-count`, tabular figures). Section 8's
subsection numbers stay as they are: 8.7 is slide 9, 8.8 slide 10, 8.9 slide
11, 8.10 slides 12 and 13.

**The rail.** Training lights journey stop 6, "You meet": the one stop that
had no slide of its own, and the meeting the course is for. Partnership
carries no rail, for the reason the journey carries none: the pie is the
whole split, not a zoom into one stop. So the rail lights stops 1, 1, 2,
3 to 5, then pauses on the pie, then 6 and 7 on slides 8 and 9: the client
sees the path walked to its end. Slides 3 to 6, 8 and 9 take the rail's
padding (5.1).

### 20.2 Tokens and type (the plan)

**No new hue and no new token.** Every value below is a 3.1 or 3.2 token.

| Piece | Tokens |
|---|---|
| Our piece of the pie (done with you, our half) | `--dk-teal-soft` fill, 3 px `--dk-teal` edge |
| Their piece, lit | `--dk-panel-2` fill, 3 px `--dk-ink` edge |
| Their piece, ahead (partnership stop 1) | no fill, 2 px `--dk-line-strong` edge, dotted as the lanes' unlit line (dash 2, gap 8) |
| The one cut between the two pieces | 8 px of the slide ground (`--dk-space`) between their edges, never a white rule |
| Leaders | 2 px `--dk-line-strong`, a 6 px dot in its piece's edge colour (8.3's leader) |
| The roads | 3 px `--dk-line-strong`, solid: the customer's path, not ours; nodes in the lanes' marks |
| The meeting and the signed project, lit (stop 4) | `--dk-ink` fill and the last segment in 3 px `--dk-ink` |
| The lit course | the journey's current row band (`--dk-teal-faint`), the current node (solid teal, `--dk-deep` dot) |
| What it teaches (the lit course's four words) | a 3 px teal line with 16 px nodes; "The close" in `--dk-ink` (theirs, as on the pie) |
| The calendar week | `--dk-panel` day columns; open slots as 2 px `--dk-teal` outlines (the times we book into); busy hours as `--dk-panel-2` blocks |

Colour keeps its three meanings (3.1): teal is ours or lit, ink is the
client's, amber is something the client must still give us. Nothing on the
new slides is amber: no line on them is a to-do on the client's screen.

**Type.** Section 4's scale, nothing new. The partnership title is H1
(80/700, Plex 84/1.25) in two lines, the first in teal because it is ours
(the cover's "goes live." precedent), the second in ink because it is
theirs. That colour split is the only accent in a title anywhere in the
deck, and it says what the pie draws. Piece names and road names are Geist
600 30 ink (Plex 600 32); their lines Geist 400 24 ink-2 (Plex 26); owner
names Geist 500 24 in their lane's tone, as the lane heads. No italic, no
capitals, no Mono above a title, at most five sizes on a slide.

### 20.3 Partnership, stops 1 and 2: the pie (the signature)

```text
1920 x 1080 · stop 2 of 4 (English)
x 136                                                                           x 1784
+--------------------------------------------------------------------------------------+
| We bring them to your door.           (H1, teal)                                     |
| You win the project.                  (H1, ink; appears at stop 2)                   |
|                                                                                      |
|  You (ink)          .-----.                                                          |
|  The meeting and   ( you   )   .-------------.                                       |
|  the close --------o      /   '               \                                      |
|                    '-----'   |                 |       Our team (teal)              |
|          (pulled 48 px)      |      ours       |  o----- Ads and enquiries          |
|                              |  (12 to 9, the  |         Calls and bookings         |
|                               \  long way)    /          Reminders and rebooking    |
|                                 '-----------'                                        |
|                                                                             07 / 13 |
+--------------------------------------------------------------------------------------+
```

- **Two pieces, as the Gamma draws it** (the spec review, 2026-10-20).
  Ours is one 270° piece, twelve to nine clockwise; theirs is the 90°
  piece, nine to twelve, on the upper start side, so when it is pulled out
  it moves toward the title's second line, "You win the project.": the
  drawing points at the sentence that names it. One 8 px cut between the
  two (each straight edge set 5.5 px back from its radius, so 8 px of
  ground shows between the 3 px edges), no inner gaps. Four equal pieces
  with a leader each, the plan before the review, was the stock
  segmented-cycle infographic, and clockwise journey order read as a loop
  from the meeting back to the ads.
- **Geometry.** The disc is 520 px across (r 260), centred at x 1060,
  y 680 (x 800 to 1320, y 420 to 940), on the slide's end half under the
  title, so the title's start edge leads. Theirs moves 48 px along its own
  bisector (34 px back, 34 px up); pulled, its top is at y 386, at least
  64 px under the Arabic title's second line and about 100 px under the
  English.
- **Labels, two leaders.** On the end side from x 1400: "Our team"
  (Geist 500 24 teal, the lane head) over a short stack of our three names
  (600 30 ink), centred on the disc's centre line, with one level leader
  from the stack's start edge into our piece, ending in a 6 px teal dot
  inside its edge ("Reminders and rebooking" measures 366 px at 600/30, so
  the stack fits the 384 px). On the start side, level with their pulled
  piece: "You" (500 24 ink) over "The meeting and the close" (600 30 ink),
  one leader into it ending in a 6 px ink dot. Those are the only words.
- **What it leaves out on purpose.** No percentages, no numbers, no legend
  box, no shadow, no 3D tilt, no gradient, no glow, no hover. A pie is a
  data form; this one carries no data: two pieces, names instead of
  values, and one moved piece as the only emphasis. The notes never say
  "three quarters of the work". It carries no provenance tag: like the O3
  group, it is a diagram of who does what, not a picture of a screen.
- **Motion.** Arrival: the slide's crossfade only; the pie is whole, our
  piece lit and named, theirs drawn ahead (dotted, unfilled, unnamed) in
  its place. Stop 2 (→): theirs takes its fill (240 ms, opacity), moves
  out along its bisector (420 ms, `transform`, `--dk-ease`), its leader
  and name arrive as it lands (200 ms, opacity), and the title's second
  line fades in (200 ms). One press, one meaning: their piece comes out.
  ← sets stop 1 again at once, with no reverse animation.
- **Reduced motion.** Every state is set at once: at stop 2 their piece is
  simply out, lit and named.
- **Done with you** (the spec review). The pie splits by owner, not by
  journey order: ours is the end half (twelve to six), "Ads and enquiries"
  and "Confirmations and reminders" under "Our team"; theirs is the start
  half (six to twelve), "Calls and bookings" and "The meeting and the
  close" under "Your team", drawn ahead at stop 1 and pulled out together
  at stop 2, 48 px along the nine o'clock bisector: one transform, one
  meaning. (The plan drew theirs as opposite quarters, each pulled along
  its own bisector, which read as a pinwheel, not a half.) Journey order
  lives on the lanes of slide 2. The title's second line, "Your team books
  them and wins the project.", measures about 1610 px at 80/700 against
  the 1648 px box, so `deck-shots.mjs` fails a shot where either title
  line wraps.
- **RTL.** The SVG holds no text and is mirrored with `scaleX(-1)` (6.9):
  their piece sits on the upper right, toward the Arabic title, and is
  pulled toward it. Labels are HTML with logical properties.

### 20.4 Partnership, stops 3 and 4: the two roads (the quiet second picture)

```text
stop 4 of 4
+--------------------------------------------------------------------------------------+
| We bring them to your door.                                                          |
| You win the project.                                                                 |
| The enquiries we bring take the longer road.          (lead 40/400, ink-2; stop 3)   |
|                                                                                      |
|  An enquiry from your ad   ( )--.  .--.  .--.  .--.                                  |
|  Meeting you for the first      |  |  |  |  |  |  |                                  |
|  time, and comparing you        '--'  '--'  '--'  |                                  |
|  with others.                                     |                                  |
|  A referral                ( )-------------------(●)-----------(●)                   |
|  Already trusts you.                         Your meeting   Signed project           |
|  ──────────────────────────────────────────────────────────────────────────────────  |
|  We can't close for you. We can help you get better at it.   (H3 40/700; stop 4)    |
+--------------------------------------------------------------------------------------+
```

- **Stop 3 (→).** The pie leaves by the stage swap (420 ms, opacity) and
  the roads arrive in the same band; the caption arrives under the title.
  The title stays: the roads explain why the client's piece takes work.
- **The roads are drawn, not illustrated.** Both are 3 px
  `--dk-line-strong` lines in the journey's line language. The referral
  road is one straight horizontal line. The ad road winds in hairpin
  switchbacks before it drops into the same meeting node from above,
  about twice the length: each turn is a half circle (60 px corners on
  120 px runs) and no two are the same depth, so it reads as a road taking
  the long way, not as a square signal trace (the visual review,
  2026-10-20; it had 24 px elbows on equal pulses). No question marks, no road texture, no cars, no
  spurs to "other firms" (a drawn count would stand for the Gamma's
  unsourced five), and, since the spec review, no length labels: the
  drawing, the caption and the notes already said it three ways. The
  length is the whole message.
- **Geometry** (the spec review: the referral road has to be visibly one
  straight line, so it runs at the node's height). The referral road
  starts at a lanes' "ahead" ring at x 560 on the node's line, runs
  straight to the meeting node at x 1440, then on to "Signed project" at
  x 1680. The ad road starts at its own ring at x 560, about 220 px above,
  winds right in six hairpins of different depths within a band about
  150 px deep, and
  drops into the meeting node from above with one vertical segment. Each
  road's words sit at its start, in the 384 px start zone, level with its
  own ring: the name (600 30 ink) and its line (400 24 ink-2). "Your
  meeting" and "Signed project" sit under their nodes (500 24 ink-2).
- **Motion.** The two roads draw at the same speed from their starts
  (`stroke-dashoffset`): the referral road lands in 520 ms and the ad road
  keeps drawing for about as long again. That is the one place in the deck
  where a draw runs past `--dk-draw-ms`, because the time it takes is the
  point. Then nothing moves.
- **Stop 4 (→).** Under a hairline at the foot, one line at H3 in ink:
  "We can't close for you. We can help you get better at it." On the
  roads, the meeting node and the signed project fill in `--dk-ink`, the
  segment between them turns solid ink and their names turn ink: the close
  is theirs. One change on the canvas, the line and the client's end of
  the road arriving together. "Marketing without sales won't grow your
  business." opens the stop's note, said, not shown (the title, a second
  H3 and the line all said the close is theirs).
- **Reduced motion.** At stop 3 both roads are drawn complete at once.
- **Done with you** and **RTL:** the same drawing (the roads run from the
  right in Arabic, the SVG mirrored).

### 20.5 Training: the course list, then the Academy's screens (three stops)

```text
stop 1 of 3 (English) · a rail slide: content y 96 to 948
+--------------------------------------------------------------------------------------+
| Your sales training   (H2)                                                           |
| The course for your meetings, in the Premium Projects Academy.   (lead, one line)    |
|                                                          Academy screenshot  (tag)   |
|  1      Introduction                                | +----------------------------+ |
|  2      Onboarding                                  | | the Academy's classroom,   | |
|  3      Google optimization                         | | masked: six course cards,  | |
|  4      Offer creation                              | | the fifth cover's figure   | |
|# 5 (●)  Project Closing Mastery     (H3 40/700)     | | blurred, its title kept    | |
|#        What it teaches                             | | 704 x 498                  | |
|#        o---------o---------o---------●             | +----------------------------+ |
|#        The consultation  ...  The close            |                                |
|  6      Team and operations                         |                                |
|  customer o-o ... you o-o-(●) You meet   (mini rail, stop 6)                 08 / 13 |
+--------------------------------------------------------------------------------------+
stop 2: the end column swaps to the lesson (masked, cropped: 704 x 502), same tag
stop 3: the end column swaps to the two statements and the link line
```

- **The signature is the one lit course opening into what it teaches.**
  Six ruled rows in the Academy's own order and numbers (the client finds
  them that way; numbering encodes something true here). The five quiet
  rows are the number (Geist 500 24 ink-3, tabular; Arabic ١ to ٦, never
  ٠١) and the name (30/400 ink-2), nothing more: since the spec review no
  ring sits on a quiet row (with them the slide carried about 17 marks).
  Project Closing Mastery is the current row: the journey's row band, the
  current node in the marker column, and its name at H3 40/700 ink, the
  slide's one primary. Under it, inside the band: the label "What it
  teaches" (500 24 ink-2), then a 3 px teal line with four 16 px nodes and
  their names under them (500 24 ink-2). "The close" ends in an ink node,
  the same ink as the client's piece of the pie, so the slide picks up
  where the partnership slide left the client. The four words are the
  sales deck's summary of the course, not its sections (a sales crash
  course, objections, follow-ups and bonus lessons), and the label says
  so. The list is drawn and stays put on all three stops: it is what the
  client can read on a shared screen.
- **Columns.** The title and the lead run across the top (the lead is one
  line, so the list starts higher). Under them the list takes the start
  column (x 136 to 1000) and the end column (x 1080 to 1784, 704 wide)
  holds one thing per stop, its top level with the list's first row.
- **The Academy's screens (stops 1 and 2; the CEO, 2026-10-20: "add
  screenshots of the project closing mastery in skool as well same as the
  sales pitch deck").** One screenshot per stop, as the sales deck shows
  them (its academy and mastery tour stops), never side by side: two at
  half the column's width would be unreadable on a share.
  - Stop 1: the classroom, `pcm-academy-masked.webp` (1456 x 1029, set at
    704 x 498). Masked: the figure on the Project Closing Mastery cover is
    blurred (a 24 px Gaussian on the cover's art, inside the card's own
    edges) and the title "PROJECT CLOSING MASTERY" kept sharp over it; the
    other five covers are generated art with no person who can be named,
    and stay as they are.
  - Stop 2: a Project Closing Mastery lesson, `pcm-lesson-masked.webp`,
    cropped from the sales deck's 1444 x 1807 to 1444 x 990 from y 150:
    the top bar (the Academy's name, the search, the message and alert
    counts and the member's avatar) and the tab row are cropped off, and
    the outline opens on "05: Project Closing Mastery" and "01: Sales
    Crash Course", and it ends on "04: Uncertainty Objections" (since
    the visual review, 40 px shorter, so "05: Closing Deposits" never
    reaches the client's screen: copy rule 7). The slide inside the video
    frame is blurred (24 px): it carries another client's name, in Latin
    and in Arabic. Set at 704 x 483.
  - Both are set as the portal's screens are (8.7): the screenshot itself,
    a 1 px `--dk-line-strong` edge, a 16 px radius, taken down a step
    (brightness 0.92), no browser bar and no shadow. The tag "Academy
    screenshot" (5.4) sits above the picture's end corner. Their `alt` is
    "The Academy's six courses" and "A lesson inside Project Closing
    Mastery" (`CONTENT-AR.md` has the Arabic).
  - The masked copies are made once, from the sales deck's files, which
    stay untouched (byte-pinned). They are WebP, at most 300 KB each, and
    the copy test pins their names and sizes (1456 x 1029, 1444 x 990).
- **Stop 3, the statements.** Two statements, each a head (600 30 ink)
  over its line (400 30 ink-2) at a 60-character measure, 48 px apart; the
  link line under them at 24 ink-2. They are statements on the slide
  ground, not cards: no border, no fill, no icon. Two, not three: "Before
  your first meetings" says who watches it and where to start, so the
  slide no longer reads as three bold-head statements (the humanizer's
  inline-header list). The slide ends on them: the ask (who watches it
  first) is the last thing the client sees.
- **Why the list stays drawn beside the screenshots.** The classroom
  screenshot is light, small text at 704 wide (about 470 px in a 1280
  window): it shows the Academy is real and what it looks like, and the
  drawn list says what to read in it. Nothing of Skool is redrawn (Hallmark
  gate 47): the screens are the real ones, masked and tagged.
- **Motion.** The slide's crossfade; at stops 2 and 3 the end column's
  stage swap (420 ms, opacity). The list never moves. Reduced motion: each
  stop is set at once.
- **Done with you** and **RTL:** the same; the list's numbers and nodes sit
  on the right in Arabic, the line under the lit course runs right to left,
  and the screenshots move to the left column unmirrored (they are pictures
  of an English page).

### 20.6 The portal's number-one job (slide 9, stop 4)

- The heading (h1) and "A few taps, the same day." are unchanged, except
  that the heading's measure is now the content width: at the old 1500 px
  "Your number-one job: mark every meeting" (1542 px in English) wrapped.
- The three taps stay one line-joined row at 40/600, the stop's primary
  sequence. Each question gets one caption under it, one line at 24 ink-2
  (the spec review: the plan's two- to three-line captions turned the row
  into three columns of text, one slide before Your part's three
  columns): "Running late isn't a no-show.", "Sent it later? Update it
  then.", "Add the value, or a line on why." "So we can call to rebook" is
  said, not shown: the no-show's home is the journey's stop 6.
- Under them, across the content width under a hairline, the "Cancelled
  or moved" row: the lanes' rebook mark in teal (we rebook) before its
  words at 400 30 ink. Then the footer on its rule, as before.
- Still one stop and no screenshot. Done with you: the CRM stages as now,
  with the late check as one line under them (400 24 ink-2); no moved row.

### 20.7 Your part (slide 10): three moments, two jobs each

*Score round 2 (22.13): the columns share their rows (a subgrid), so the three second jobs start on one line in both languages; the week closes the first column under its second job; the Drive pictures are their own creatives only (no starter), each picture once, feed-shaped first, three or two.*


```text
+--------------------------------------------------------------------------------------+
| Your six jobs, in one place   (H2, the slide's one heading)                          |
|                                                                                      |
| Before your meetings        After each meeting          Week to week                |
| ─────────────────────       ─────────────────────       ─────────────────────        |
| Keep at least 10 open       Mark every meeting the      Leave the ads running        |
| slots, at different times   same day, with the value    through the first weeks      |
| Our callers book into       when you win                Pausing early ends the test  |
| them. On a day off, block   Your outcomes show ...      before it tells us anything. |
| the hours, not the whole    ─────────────────────       [creative][creative][creat.] |
| day.                        Follow up the ones          ─────────────────────        |
|        Day off              thinking it over, and       Keep your Drive folder fed   |
| [ Sat Sun Mon Tue Wed Thu ] book the second meeting     Fresh projects keep ...      |
| [ the week, 4 hour rows  ]  You send the quote and set                               |
| ─────────────────────       the second meeting. Our                                  |
| Add each booking to your    caller checks in too.                                    |
| own system                                                                           |
| If your team plans ...                                                               |
+--------------------------------------------------------------------------------------+
```

- **Why the layout changed.** Six jobs under a title in a 3 by 2 grid of
  equal cells is the stock feature grid (19.1, item 4). Grouped by when
  they happen, the jobs read as a schedule: three heads that encode
  something true, two jobs under each, and pictures only where they show
  something. The three moments are the real ones, not a forced triad.
- **One heading** (the spec review): "Your six jobs, in one place", with
  no line under it, and the overview's title is the same. "Your part" over
  "Your six jobs, in one place." said it twice, and "your part" competed
  with the pie's "You" three slides before. Head 3 is "Week to week": it
  was "Through the first weeks", said again word for word in its own job,
  and keeping the folder fed is not a first-weeks job.
- **Geometry.** Three columns of 512 px, 56 apart (the content's 1648).
  Heads in the lane-head style (Geist 500 24, ink-2). Each job has a 2 px
  `--dk-line-strong` rule over it, the job at 28/700 ink, its why at
  24/400 ink-2. Built at these sizes, not 8.8's 30 and 26: measured at
  them, with job 1's why cut to two sentences, the first column ends near
  y 916 in English and 951 in Arabic, under the content box's 976.
  Columns end where their content ends: "After each meeting" has no
  picture and is shorter, which is honest.
- **The calendar week** (under job 1, 512 wide): six day columns, Saturday
  to Thursday (right to left in Arabic), four hour rows, no hours written.
  At least ten open slots as 2 px teal outlines at different hours, busy
  hours as raised blocks named "Busy" once, and one day off blocked hour
  by hour (four separate blocks), named "Day off" over its column: never
  one full-height block, because that is the mistake the job warns
  against. No dates, no customer, no names. It replaces 8.8's single day
  with one busy hour.
- **The creatives** (under "Leave the ads running"): three of their
  creatives, as 8.8 had them, only with three or more.
- **Done with you** (the spec review): no calling job under "After each
  meeting". Before your meetings: the open slots ("Your team books into
  them…") and "Call new enquiries within 5 minutes, and note every try",
  in place of the booking job (their team already books). After each
  meeting: "Move each meeting to the right stage the same day" and the
  follow-up job. Week to week: the same two. The copy test pins the
  head-to-job mapping in both modes.
- One stop, no stagger, no rail. The notes window's "Copy for the group"
  posts the six jobs as text, grouped under the three heads, then (since
  the spec review of creative flexibility) the testing line, "How we test
  your ads: …", then the course line, "Before your first meetings: Project
  Closing Mastery in the Academy: {academy url}", so the training is in the
  recap the client keeps, then the videos (21.4). The same button is on
  slide 13's notes and on the notes window once the deck closes.

### 20.8 The first 90 days (slide 11)

One line under the first bar's label: "Usually slower, while the ads find
your audience.", Geist 400 24 ink-2 (Plex 26), one line, on the bar's
row. The bar, its dashed open end and "Can run longer" are unchanged. If
the 96 px row cannot hold the label and the line, the row grows to 120
and the chart keeps its scale. The line arrives with the label when the
bar draws; reduced motion: drawn.

### 20.9 Good to know (slide 12): "Good to know" (it was "Before we go live" until the fixer's round, 21.12)

- **Why its own slide.** The Gamma's payment and reply facts, with the
  existing housekeeping, are five items: more than three calm cards on the
  green light. They take 8.10's first stop as their own slide, and the
  green light carries one thing.
- **Composition.** The title (H2) on the start side (x 136 to 560), the
  rows beside it (x 640 to 1784), as 19.8 set the green light's first
  stop: ruled rows, each a head (600 26 ink) stacked over its line (400 30
  ink-2, a 64-character measure). The head sits over its line, never
  beside it (Hallmark gate 54's hanging header). Rows hug their words and
  stack from the top, so the replies row hides without leaving a gap.
- No amber, no icons, no money figures, no card fills. One stop, no rail.

### 20.10 Green light (slide 13)

8.10's second stop, alone: the question at display (118/700) at the
content's inline start, the journey's rail drawn large (1400 px) and lit in
solid teal to "Go-live", with the date once there is one, and the check-in
line once booked. Arrival is the crossfade only; the rail is already lit.
The overview's title for the slide is the question.

### 20.11 Smaller changes

- **Journey stop 5** gains a sentence ("WhatsApp alerts tell you about new
  bookings, cancellations and changes."). The words column takes the extra
  line; the calendar entry stays level with "Lands with you" when it fits,
  and if the words push it down, the entry moves and the leader stays
  straight. No new picture: the alert's look is not confirmed (`CONTENT.md`
  open question 21).
- **Creative freedom:** no canvas change ("Keep the offer steady" is said,
  in the notes). Superseded the same day by 21.1: the offer is on stop 3.
- **O3:** the hours line under the group's name gains "within 2 working
  hours" and may wrap to two lines at its 60-character measure; nothing
  else moves. **O5:** the launch call's caption reads "About 45 minutes".

### 20.12 The critique, and the slop test on these slides

Checked against the plan before writing it down, as frontend-design asks:
the template answer for "what we do and what you do" is a two-column "We
do / You do" table with checkmarks, or two cards with icons. The plan
rejects both: the CEO's own picture is a pie with one piece out, and the
deck already has a line language to draw it in. The template answer for a
training slide is a screenshot of the course platform; the plan draws the
one course that matters as a road, in the same marks as the journey, and
(since the CEO's request of 2026-10-20) shows the platform's real screens
beside it, one per stop, masked and tagged, never as the slide's only
content.

Hallmark gates that these slides could fail, and how they pass:

- **No invented numbers (46).** No percentages on the pie, no "80% after
  the third contact", no "5 others", no close rate. "At least 10 open
  slots" is the Gamma's requirement, said as the client's job.
- **No re-drawn chrome (47).** No drawn Skool window, no phone, no
  WhatsApp screen on the new slides; training's two screens are the real
  ones (20.5).
- **Locked tokens (48).** Every colour is a 3.1 or 3.2 token (20.2).
- **No italic headings (38a), no eyebrows, no capitals.** The new slides
  have no line above their titles.
- **No stock grid, no icon tiles, no cards in cards.** Your part is
  recomposed (20.7); the statements on training and the rows on good to
  know sit on the ground.
- **Motion.** `transform`, `opacity` and `stroke-dashoffset` only, stepped
  by the presenter, nothing loops; reduced motion is set for every moving
  part (20.3, 20.4, 20.8).
- **Structural variety.** Call record (6), diagram (7), a list with one
  row opened (8), a job with its three taps (9), three columns by time
  (10), a programme (11), ruled rows (12), one question (13): no two
  neighbours share a structure, and each has one primary (the pie, then
  the roads; the lit course; the job; the three moments; the chart; the
  rows; the question).

Pre-emit, these slides: `P5 H4 E4 S5 R4 V4`. Specificity is 5 because the
two pictures are the CEO's own, redrawn in the subject's line language;
Execution stays at 4 until they are seen on a real Zoom share at 1280 and
1366 wide (17.5). The stamp at the top of `present.css` stays as it is:
these slides meet it.

### 20.13 For the build

- `content.ts` takes the words from `CONTENT.md` and `CONTENT-AR.md`:
  `LAUNCH.partner`, `LAUNCH.training` and `LAUNCH.know` are new; the
  portal's stop 4 gains its three captions and the moved row; `LAUNCH.part`
  gains its three heads and six jobs (with the done-with-you swaps);
  `LAUNCH.call.after` gains the one-voice line; `LAUNCH.days` gains its
  slow line; `GROUP_LINKS` gains the recap's course line;
  `L_TITLES` and `L_NOTES` gain `partnership`, `training` and
  `good-to-know`, and `green-light` takes the question as its title.
- Slide definitions: partnership has 4 stops and no `rail`; training has 1
  stop and `rail: () => 5` (3 stops since the spec review of creative
  flexibility, 20.5); good-to-know has 1 stop; the green light drops
  to 1. The two new slides live in `launchExpect.tsx`, beside
  `launchDeck.tsx`; their class prefixes (`dkc-partner`, `dkc-pie`,
  `dkc-route`, `dkc-train`, `dkc-course`, `dkc-teaches`, `dkc-know`, and
  `dkc-wk` for the calendar week) are new, because `dkc-road`,
  `dkc-week` and `dkc-cal` already name O5, O6 and the journey's calendar
  card.
- The copy test: rule 11 fails on the unmasked `pcm-academy` and
  `pcm-lesson` names in the client success app (the masked copies pass,
  20.5); rule 5 fails if the training
  slide states a cadence (its home is the 90 days); "within 2 working
  hours" is pinned on O3 and the good-to-know replies row; "Usually
  slower" is pinned and "always slower" fails.
- `deck-shots.mjs` covers the new slides in both languages, done for you
  and done with you, at 1920 x 1080, and the pie and the course list at
  1366 x 768.

### 20.14 The spec review (2026-10-20)

Applied before the build, in this section and in `CONTENT.md` and
`CONTENT-AR.md`:

1. The pie is two pieces with one cut and two leaders, centred lower
   (20.3); done with you it splits by owner, in halves, theirs pulled out
   together, and the shots check the title stays two lines.
2. The referral road is one straight line at the node's height, the ad
   road meanders above it and drops in; no length labels; stop 4 is one
   line (20.4).
3. The training list: quiet rows without rings, the lit course at H3, the
   four words under "What it teaches", one lead, two statements (20.5).
4. The portal's taps keep 40/600 with one-line captions; the heading takes
   the content width; the moved row splits moved from cancelled (20.6).
5. Your part: one heading, "Week to week", job 1's why in two sentences,
   built at 28 and 24, the done-with-you regroup, the recap's seventh line
   (20.7); 2 minutes, with 30 seconds each from slides 3 and 4 (20.1).
6. The call's stop 7, done for you, says under its heading that the
   messages before the meeting come from us (the launch call SOP's third
   expectation; `CONTENT.md` L6).

## 21. Creative flexibility and video slots (2026-10-20)

The CEO asked the same day for creative flexibility as a full expectation,
set before the ads exist, and for a video slot behind each main part of both
decks, so a part the CSM skips can still be watched. `CONTENT.md` holds the
words (L3, O7, "Video slots"), `CONTENT-AR.md` the Arabic, and `VIDEOS.md`
the backend and the frontend calls. This section is the design plan, written
as frontend-design asks (the plan, then the critique) and checked against
Hallmark. Where it and an earlier section disagree, this section wins. It
was revised the same day by the spec review (21.10 lists every finding).

### 21.0 The plan

- **Colour:** no new hue and no new colour token. The field and the video
  pieces use 3.1 and 3.2 only (21.7). Teal stays ours and lit, amber the
  client's red lines, ink the client's own (their style change).
- **Type:** section 4's scale. On creative freedom: H2 (56) for the title,
  H3 (40/700) for each stop's name, body 30 (400; 600 for the check's one
  line), small 24/400 ink-2, labels 500 24, Mono 24 for the tag and the
  stamp: four sizes. The video control: 500 24 and Mono 24.
- **Layout:** creative freedom keeps its title and gains two columns, the
  stop's words on the start side and the field on the end side, from the
  first stop. The video control sits in the canvas's head band, centred,
  and belongs to the presenter chrome: it shows only while the chrome is
  awake. The player covers the canvas.
- **Signature:** the field of ad tiles. It arrives all lit, most of it
  switches off at the next press, a few stay lit, and the next round waits
  under them. It is the one new drawing; everything else here is quiet
  text.

### 21.1 Creative freedom (slide 3 since the fixer's round; slide 4 before it): five stops, one field

```text
1920 x 1080 · stop 4 of 5 (English) · a rail slide: content y 96 to 948
x 136                                  x 952   x 1050                                    x 1784
+---------------------------------------------------------------------------------------------+
|        (> Watch: Why we test so many ads · 2:40   only while the chrome is awake, 21.2)       |
| Your red lines are fixed. The rest, we test.   (H2)      Agreed to test this way · 20 Oct  |
|                                                                             Illustration    |
|  Then a quick check, not a redesign   (H3)           [#][ ][ ][ ][#][ ]                      |
|                                                      [ ][ ][ ][ ][ ][ ]   the field:         |
|  Facts · Prices · Claims   (600 40, ink)             [ ][ ][#][ ][ ][ ]   18 tiles, 3 lit    |
|  You check these before an ad goes live.                                                     |
|                                                      Next round          Your style change   |
|  Small style changes go into the next round,         [:][:][:][:][:][=]                      |
|  so your launch doesn't wait.                        (dotted: ahead)     (solid ink: theirs) |
|  You approve your ads in the group.   (24 ink-2)                                             |
|                                                                                              |
|                                                                                              |
|  customer o-*-o ... (mini rail, stop 1)                                              04 / 13 |
+---------------------------------------------------------------------------------------------+
```

**Why one slide, not two.** One picture, the field, carries all five
stops, so each press changes one thing in a drawing that stays put: the
field arrives lit, most of it switches off, the next round appears, the
client's change takes its place in it, the round fills. Split over two
slides, the field would be drawn twice and the deal (input first, a small
check, content) would sit on a slide without the mechanism that explains
it. The deck stays at thirteen slides.

**Composition**
- The title stays (H2, one line, no eyebrow). Under it, two columns: the
  words from x 136 to 952 (816, about 54 characters at 30) and the field
  from x 1050 to 1784 (734). Both start at y 232.
- **The words column** holds one stop at a time: its name at H3 (40/700
  ink, one line in both languages; `deck-shots.mjs` fails a wrapped one),
  then its lines. It changes by the stage swap (420 ms, opacity) at each
  press. Stop by stop:
  - 1: the body (30/400 ink) and the small line (24 ink-2).
  - 2: the body, the small line, then their pick from L4 as today
    (`.dkc-open-pick`: the starred thumbnail, 96 px, and the pick line at
    24 ink-2). Without a pick, the line alone.
  - 3: creative freedom's red-lines panel (`--dk-panel` with a 1 px
    `--dk-leak-line` hairline, 16 px radius, 24 px padding, the column's
    width; the visual review replaced the `--dk-leak-soft` fill, which
    rendered as a neutral charcoal) with its head, the red lines (30/400;
    each row in the panel's direction with its amber mark on the panel's
    start edge, only the words isolated in their own direction and type,
    the same rule as O7's list) and "We never cross these."; the fallback and
    its live input as before. Under the panel, the input line (30/400 ink)
    and the offer line (24 ink-2). More than five red lines would push the
    column past the content box, so the slide's prep warning asks the CSM
    to hide some ("More than five red lines show on slide 3. Hide some in
    prep so the panel fits."), using the existing Do's & Don'ts toggles.
  - 4: the check as one line, `test.check.words` as `CONTENT.md` writes it,
    "Facts · Prices · Claims": Geist 600 40/1.25 ink (Plex 600 40/1.45),
    the middots in ink-3, 16 px under the H3. Since the visual review it is
    set larger than the sentence under it: it is the stop's one idea. No line and no nodes: facts,
    prices and claims are not steps, and a line-joined row is the deck's
    device for a sequence (slide 9's three taps). Under it "You check
    these before an ad goes live." (24 ink-2); then the style line (30/400
    ink) and the approval (24 ink-2).
  - 5: the body (30/400 ink) and the small line (24 ink-2).
- **The stamp** ("Agreed to test this way · {date}", Mono 24 ink-2, the
  tag style) sits on the title row since the visual review of 2026-10-20:
  at the row's inline end (x 1784; in RTL its left edge, x 136), on the
  title's baseline, on any stop once recorded, fading in over 400 ms. At
  the foot of the words column it read as a third line of the Arabic
  stop's paragraph (about 20 px under it) and floated alone at stop 1.
  On the title row it is never read as part of the stop's words and never
  near the mini rail's lit label below the content box; both titles leave
  550 px or more free there. The words column keeps its full height. No
  rule above it.
- **No phone on this slide** (since the spec review). Slide 3 has just
  shown the ads in the feed with the "Marked Sponsored" leader; stop 1's
  small line says it in words.

**The field (the signature)**
- **Eighteen tiles, 6 columns by 3 rows, each 104 x 130** (4:5, the shape
  of a feed ad), 22 px apart: 734 x 434, from y 252. A tile is `--dk-panel`
  with a 2 px inset edge and a 12 px radius. Nothing is pictured in it: no
  thumbnail, no face, no words, no money. The client's own creatives never
  go in the field, because dimming a real ad before launch reads as a
  verdict on it (the 2026-10-19 critique).
- **The edge never fades.** `--dk-panel` on `--dk-space` is about 1.08:1, so
  a tile is drawn only by its edge. Every tile keeps its 2 px inset edge at
  full opacity: `--dk-line-strong` when off, `--dk-teal` when lit. The teal
  edge is its own layer over the off edge, so switching off fades the teal
  layer out (opacity); the tile itself stays at 100%.
- **What varies,** drawn in ink-2 at 24 px, 12 px in from each tile's top
  start corner: a play triangle on six tiles (a video), two stacked edges on
  four (a carousel), nothing on eight (a picture). It is the only mark inside
  a tile, and it is why the field reads as different versions, not as one ad
  copied eighteen times. If 24 px crowds the 104 px tile in the shots, the
  marks go, and stop 2's small line carries the variety alone.
- **The toggle** in Meta's on/off shape at each tile's foot end corner
  (40 x 24): on, a `--dk-teal` track with a `--dk-deep` knob at the end;
  off, a `--dk-line-strong` track with an ink-2 knob at the start. The on
  track and knob are layers over the off ones, so a switch is the knob's
  slide (transform) and the layers' fade (opacity).
- **Lit and off.** At stop 1 all eighteen are lit. From stop 2, three stay
  lit, at row 1 column 1, row 1 column 5 and row 3 column 3 (never one row,
  one column or a diagonal, so the eye reads chance, not a pattern). The
  other fifteen are off: the off edge, and the toggle and the format mark at
  45% opacity. No star, crown, glow or badge on the lit ones. The field
  carries no count anywhere, said or drawn as a number.
- **Tag:** "Illustration" above the field's end corner (5.4), y about 210,
  from stop 1.
- **The next round** (stops 3 to 5): six outlines of the same size in one
  row, 90 px under the field (y 776 to 906). "Next round" (500 24 ink-2, the
  lane heads' style) sits over the row's first outline, at y 726. At stop
  3 the outlines are dotted (2 px `--dk-line-strong`, the lanes' unlit line,
  dash 2 and gap 8) and empty: ahead. At stop 4 the last outline turns solid
  2 px `--dk-ink`, and "Your style change" (500 24 ink) sits over it, level
  with "Next round", with a 2 px ink leader that ends on its edge (20 px,
  the same length at stop 5, where the tile is filled). At stop 5
  every outline takes the `--dk-panel-2` fill and a solid `--dk-line-strong`
  edge, and the client's keeps its ink edge: the round is made.

**Motion, stop by stop** (`transform` and `opacity` only; one press, one
change, then stillness; ← sets the previous stop at once, with no reverse;
nothing on the slide changes without a press)
- **Stop 1:** the slide's crossfade brings the field in, all eighteen lit,
  with its tag. Nothing moves after it.
- **Stop 2:** at the press, fifteen tiles switch off together: the knobs
  slide (`transform`), and the teal edge and track layers fade out while
  the toggles and marks go to 45% (`opacity`), all in `--dk-swap-ms` (240
  ms). The words swap with it. "All on" is a resting stop of its own, so
  the client sees it for as long as stop 1 lasts, whatever the share's
  frame rate.
- **Stop 3:** the field stays still. The dotted next round and its label
  fade in (240 ms). The words swap.
- **Stop 4:** the last outline's edge turns ink and its label and leader
  fade in (240 ms). The words swap.
- **Stop 5:** the next round's fill fades in (240 ms). The words swap.
- **Reduced motion** (the system setting or `?still=1`): every stop is set
  at once.

**Distinct from its neighbours.** Slide 3 is three phones in a row with a
tray; slide 5 is one phone walked screen by screen. Every stop of slide 4
is the field beside a column of words, which no other slide has (slide
10's calendar week is a grid of hours, six slides on), so the slide reads as
its own from its first frame, between two phone slides. One primary per
stop: the lit field at 1 (many versions), the switch-off at 2, the red lines
at 3, the check's one line at 4, the filled round at 5.

**Done with you:** the same slide. **RTL:** the words on the right, the
field on the left; the grid runs right to left, so the lit cells keep their
logical places; the toggles, the format marks and the leader mirror; the
check line reads right to left, and the stamp sits at the title row's
left edge.

**Notes and prep controls.** The agreement button and A stay as they are
(8.4). The "How a test runs" toggle is removed: the field is a core stop,
and a saved `test-proof` in `shown_slides` is ignored. The slide's prep
warnings gain the red-lines count above. The notes window's slide 4 gains
"Copy reply" (`CONTENT.md` L3: one line for pushback in the group, picked by
the client's goal), and prep's slide 4 panel the same button, because that
pushback comes after the call.

### 21.2 The video control on the canvas

**Place: the head band of the canvas, centred** (its box y 28 to 68,
centred on x 960, at most 960 wide), on every slide with a filled slot
shown for this client. Why there:
- The foot is taken: the slide count at the end (bottom 48), the mini rail
  at the start (bottom 44, its lit step's name above it), and the slides'
  own foot lines inside the content box.
- The two top corners belong to the rest of the presenter chrome (12.1),
  which wakes on the same mouse move the CSM makes to reach a control
  there, so a corner control would sit under it.
- The head band's centre is clear on every slide: nothing on any slide is
  drawn above y 96, and the chrome groups sit at the corners.
- At window widths of 1280 and up (a canvas scale of 0.67 or more), the
  control's 960 canvas px is at most 640 window px and clears both chrome
  groups. Below that the chrome can meet its ends while awake (section 17
  checks it at 1280 and 1366).

**Visibility: it is presenter chrome** (since the spec review). Opacity 0
at rest. It shows while the chrome is awake (12.1's mouse wake, hiding with
it after 2.5 s, in the chrome's own fade), or at once, with no fade, while
it has keyboard focus. It stays in the tab order at rest. Why:
- In a share the client cannot click it, and a control left up for a whole
  slide would advertise the part the CSM skipped for time.
- At rest it is not there, so it never reads as an eyebrow or a banner
  over the slide's title (8.3: only the owner line sits above a title).
- It now pairs truly with the nav pill: both are chrome, the pill on the
  window's foot centre line, the control on the canvas's head centre line,
  waking and hiding together.
- On the presenter's own screen Zoom docks its floating share controls at
  the top centre by default, over this place. V and the notes window's
  "Play on screen" are the main ways in; the control serves a mouse that is
  already up there.

The client hears about the video from the CSM, and gets its link in the
recap. The notes window's Video block ends with "If you skip this, say the
video is in your group." on every slide with a filled slot (21.4).

**Look.** Quiet text, not a button shape: "Watch:" first, unlined, then
each video as its own item: a 16 px play triangle (an SVG path, ink-2),
the title in Geist 500 24 ink-2 (Plex 500 26), " · " and the length in the
same face, tabular (in Arabic the length is in words, Plex 500 26,
`CONTENT-AR.md` decision 13), and a 2 px `--dk-line-strong` hairline under
the item, as onboarding's launch control (`.dkc-launch`). One grammar for
one video and for two (the visual review, 2026-10-20: "Watch:" inside a
single item's hairline, and Mono beside Geist reading as "2 : 40", are
gone). No fill, no box, no pill, no thumbnail. No length on file:
the title alone. Titles fit one line by rule (the registry's are at most 32
characters, a typed title at most 40).

**Two slots on one slide** (slide 6 of onboarding): "Watch:" once, then the
two items, each with its own triangle and its own hit area, 40 px apart,
exactly as one slot reads with one item.
V opens the first.

**States**

| State | What shows |
|---|---|
| Empty (no recording in the deck's language or for any language) | Nothing, awake or not. No placeholder, no "coming soon" on the client's screen |
| Videos not read yet, the read failed, or the row was refused | Nothing on the canvas; the notes window says which (21.4) |
| Not shown for this client (done with you) | Nothing |
| Filled, chrome asleep | Opacity 0, still in the tab order |
| Filled, chrome awake | The control as above, fading in and out with the chrome |
| Hover | The hairline turns `--dk-edge` in 120 ms and the text turns ink. Nothing grows: unlike `.dkc-launch`, a size change would move a centred control |
| Focus-visible | Shown at once, with no fade, and the 3 px teal outline, 4 px offset (15.2) |
| Active (pressed) | Text and hairline in ink for the press |
| Disabled | Never: an empty slot has no control |
| Its video open | Under the player's veil. On close, focus returns to it if it opened the player, else to the canvas |

The control lets go of focus after a mouse click (12.1), so Space moves the
deck once the player is closed. Its accessible name is "Watch the video:
{title}, {length}" in the deck's language. It shows in prep's preview on
hover, and in one chrome-awake shot per deck in `deck-shots.mjs`.

### 21.3 The player

- **Opens** from the control, with V (the slide's first filled slot), or
  from the notes window's "Play on screen". It is a dialog on the canvas,
  above the slide, the rail and the count: `--dk-deep`, opaque, over the
  whole canvas (no blur), the slide under it `inert`. Opaque since the
  visual review: the 0.97 veil left the slide's title a faint ghost under
  the player's head, and nothing under the player is meant to be read.
- **Geometry.** A head line at y 64 to 112: the title (Geist 600 30 ink,
  Plex 600 32) from x 240, then the length (500 24 ink-2, tabular); at x 1680, on
  the end, "Close" alone, in the control's quiet text style. No key hint on
  the canvas: the notes window says which keys close it. The frame: 1440 x
  810 (16:9) at x 240 to 1680, y 144 to 954, a `--dk-panel` ground, a 1 px
  `--dk-line-strong` edge and a 16 px radius, no shadow (only the phones
  carry one), so the frame is visible on the veil before the provider
  paints and in every state below. A portrait recording letterboxes inside
  the provider's own player.
- **Focus.** `role="dialog"`, `aria-modal="true"`, labelled by the title.
  On open, focus goes to the dialog itself (`tabindex="-1"`), not into the
  player, so Esc and the deck's keys still reach the deck; Tab reaches the
  player, then Close.
- **The frame.** The `src` is the server's embed address (`VIDEOS.md`), and
  only the deck adds the provider's autoplay (YouTube, Vimeo, Wistia) and,
  for YouTube, its `origin`, through `URL` and `searchParams`; prep's check
  never autoplays. `sandbox="allow-scripts allow-same-origin
  allow-presentation"`: no popups, no top navigation and no forms, so
  nothing in a player can open a tab in the shared window or move the deck.
  `allow="autoplay; fullscreen; picture-in-picture; encrypted-media"`: no
  camera, microphone, location or clipboard.
  `referrerpolicy="strict-origin-when-cross-origin"` (Vimeo and Wistia check
  the embedding domain), `title` the slot's title. `allow-same-origin` is
  safe only because every allowed host is another origin than the
  cockpit's; the server never stores a cockpit address. The cockpit's CSP
  names in `frame-src` the five embed hosts plus the hosts the app already
  frames (Meta previews, the ClickUp form), exactly as `VIDEOS.md` 6 gives
  it, so a link that slipped past the server still could not be framed.
- **Closing:** Esc, V again, "Close", a click on the veil around the frame,
  or "Close the video" in the notes window. A deck move key (→ ← Space
  PageDown PageUp, a clicker) closes it and does nothing else: one press,
  one change. Esc never leaves the deck (15.1). Once the CSM clicks inside
  the player, the player has the keyboard (another origin's frame keeps its
  keys); a click on the veil or "Close" hands the keys back. The notes say
  so.
- **States inside the frame**

| State | When | What shows |
|---|---|---|
| Loading | From opening until the frame's `load` event, or the provider's ready message, whichever comes first | The frame's ground with "Loading the video" (24 ink-2, centred), shown only after 400 ms so a quick load never flashes it. No spinner: nothing loops on the canvas (1) |
| Ready | The frame's `load` event fired, for every provider (a ready message only ends Loading sooner) | The provider's own player and its own controls (real, not redrawn), shown at once |
| Playing | The provider's play event: YouTube state 1, Vimeo `play`, Wistia's play | The same; the notes window now says "Playing on screen" |
| Didn't load | No `load` event within 15 s of opening, or the browser is offline | The frame is removed; its ground says "The video didn't load. We'll send you the link in the group." (30 ink, centred, balanced lines at most 1100 wide, so no word is left alone on a line). Under it, 40 px down, two quiet controls in Close's style, 48 px apart: "Try again" mounts a fresh frame (a new `load`, handshake and 15 s) and "Open the video" opens the row's `url`, the link people open, in a new tab (`noopener noreferrer`). Both hand the keys back to the dialog, never a blur: on the page, Quick pitch's Esc would close the whole pitch and Space would also move the slide. Quick pitch has no notes window, so this is its way back (live, 2026-10-28: a Wistia frame took over 15 s once, and only Close and Watch again recovered it). In the full deck, the notes window's "Play on screen" (21.4) also mounts a fresh player |
| Can't play here | Only an explicit error from the provider: YouTube `onError` 100, 101 or 150 (removed, private, embedding off), Vimeo `error`, or Wistia's error | "This video can't play here. We'll send you the link in the group." |
| Loaded, silent | The frame loaded and its provider sends nothing more (Loom and Drive always; any provider whose messages don't arrive) | The provider's own player stays, with its own error screen if it has one. Nothing is replaced |

  A missing message is never read as a block: a slow connection, or a
  provider that posts ready only after its own handshake, would otherwise
  show the client a false failure over a player that works. Loom and Drive
  cannot report a block at all (their sign-in or no-access page loads like
  a video); prep's "Check it plays" (21.5) is the guard for them. Messages
  are read only from that player's own frame and that provider's origin,
  and the deck posts to a provider only with its exact origin, never `"*"`
  (`VIDEOS.md` 6). The two failure lines speak to the client and promise
  only the link, which the recap carries anyway; the notes window tells the
  CSM what to do.
- **Motion:** the veil and the head arrive in `--dk-cut-ms` (opacity) and
  leave in 150 ms; with reduced motion, at once. No scale, no slide-in.
- **On Zoom:** video reaches the client in jumps unless the share has
  "Optimize for video clip" ticked, and left ticked it blurs the shared
  slides. The notes window says to tick it on the first play of the call
  and to untick it when that video closes (21.4).

### 21.4 The notes window

A "Video" section on each slide that has a slot, after the talk track and
the temp check, before "Only you see this". Cockpit UI (12.2), English.
Each block is headed by the video's title alone: the section's label
already says "Video" (the visual review, 2026-10-20).

```text
| Why we test so many ads                                             |
| Recorded · any language · 2:40                                      |
| [ Play on screen ]  [ Copy link ]                                   |
| If you skip this, say the video is in your group.                   |
```

| State | What it says | Actions |
|---|---|---|
| Recorded | "Recorded · {English, Arabic or any language} · {m:ss}" (no length: left out), then "If you skip this, say the video is in your group." | Play on screen · Copy link ("Copied" for 2 s; it copies the link people open) |
| Opening (the deck's player is loading) | "Opening on screen" | Close the video |
| On screen, not started (ready, no play event yet; always for Loom and Drive, which never report one) | "On screen, not started. Click play in the deck window." | Close the video |
| Playing (only after the provider's play event) | "Playing on screen" | Close the video |
| While the player is open | "Esc, V or Close closes it; a deck key closes it too." (muted, under the state line) | |
| First play of the call (or the first video already open when the notes window joins) | "Zoom: while it plays, tick 'Optimize for video clip' in the share's More menu. Untick it after, or the slides blur." | |
| When that first video closes (once per call) | "Untick 'Optimize for video clip' now." | |
| Not recorded | "Not recorded yet." (muted) | None here; prep adds it |
| Other language only | "Not recorded in Arabic yet. The English one:" | Play on screen · Copy link |
| Not shown for this client | "Done with you: not shown, because this video shows how we work done for you." or "Not shown until Mahara OS is approved for this client." | |
| Refused (the row failed the browser's shape check, `VIDEOS.md` 7) | "This video's link was refused. Save it again in prep." | |
| Read failed | "Videos could not be read: {reason}. The deck shows none." (bad tone) | |
| Didn't load on screen | "Didn't load on screen. Check the connection and press Play on screen again, or copy the link into the group." | Play on screen · Copy link |
| Can't play on screen | "The provider says it can't play here (its privacy or sharing setting). Copy the link into the group, and fix the sharing in prep." | Copy link |

Two slots on one slide: one block each. V in the notes window plays the
slide's first slot on screen, forwarded as the other deck keys are. The
deck window reports the player's state back (`video-state`, 21.9), so the
notes window says what the client is seeing, and never "Playing" before the
provider says so: an unmuted autoplay started from another window can be
refused, and Loom and Drive never start on their own.

**The recap, wherever the call ends** (the spec review). The launch recap
("Copy for the group": the six jobs, the testing line, the course line, the
videos) is on slide 10's notes, on slide 13's notes, and on the closing
panel below; the onboarding deck's "Copy links for the group" is on slide
6's notes and on the closing panel.

**When the deck closes.** The deck window posts `{type: "closed"}` on
`pagehide` ("Back to {client}", or the window closed). The notes window
then shows one panel in place of the talk track: "The deck is closed." and
the deck's recap button, plus "Copy reply" on the launch deck. Nothing of it
reaches the shared window, whose "Deck closed" screen stays neutral (12.1).

**Copy reply** (slide 4, and prep's slide 4 panel): copies one line for
pushback in the group, in the deck's language, chosen by the client's goal
(`CONTENT.md` L3: goal shown, held back, or none). "Copied" for 2 s.

### 21.5 Prep: the Videos section

A section under "The whole deck" in the prep aside (12.3), listing every
slot of this deck in slide order, whether it shows for this client or not.

```text
| Videos for the launch deck                                              |
| Shared by every client's deck: a link saved here shows on every launch  |
| deck. Mahara's own recordings only. Nothing that shows another client.  |
| ---------------------------------------------------------------------- |
| 2 · How it works, start to finish   Not recorded yet   [ Add a link ]   |
|     Done with you: not shown for this client.                           |
| 4 · Why we test so many ads         Not recorded yet   [ Add a link ]   |
| 9 · The Mahara OS guide                                                 |
|     English  fast.wistia.net/embed/iframe/lxlse6ckhf · 4:37             |
|              [Check it plays]  [Clear]                                  |
|     Arabic   fast.wistia.net/embed/iframe/hyuxh7skjv · 4:45             |
|              [Check it plays]  [Clear]                                  |
|     + Add a link for any language                                       |
| ---------------------------------------------------------------------- |
| A video in their own thank-you or booking message is set on slides 2    |
| and 5.                                                                  |
```

- **An empty slot is one row** (the spec review): "{slide} · {title}   Not
  recorded yet   [Add a link]". No fields until the CSM asks for them:
  recording videos is not this client's prep, and a column of open forms
  would read as homework and push "The whole deck" down. "Add a link" opens
  the fields under the row and moves focus to Link. It stays on the title's
  row whatever the title's length: the title wraps in its own cell (the
  visual review, 2026-10-20: the button had jumped to a row of its own).
- **Recorded rows,** one per recorded language, with its host and id, its
  length when there is one, "Check it plays" and "Clear". One line: a long
  link is cut in the middle (its host and its end both show, the whole
  link in the tooltip), and the length is its own item, never wrapped
  away from the link. "+ Add a link"
  opens the fields for a language still free.
- **Fields,** labels above (Hallmark's forms): Link (the placeholder shows
  the format, "https://www.loom.com/share/…"), Language (Any, English,
  Arabic; the default is the deck's language when it is free, else Any),
  Length (m:ss, optional; checked in the browser: "Type the length as
  minutes and seconds, like 2:40."), Title (optional, at most 40
  characters; "Blank: the slot's own title, in the deck's language.").
- **The revision** sent with a save or a clear is the read's for that slot
  and language, or 0 when the read left it out (`VIDEOS.md` 4). A row the
  browser refused keeps its revision from the read, so "Save it again in
  prep" saves over the row the server still holds instead of conflicting.
- **Save,** all eight states: default; hover; focus-visible; active;
  disabled while the link is empty; "Saving…" in flight; on an error, the
  server's sentence replaces the hint under the field it is about
  (`aria-invalid`, `aria-describedby`; the field comes from `VIDEOS.md` 4's
  table), and what was typed stays; on success, "Saved" for 2 s, the row
  shows as recorded, and the hub posts `{type: "videos"}` so the deck and
  the notes window read the videos again. An action keeps its name: Save,
  Saved; Clear, Cleared.
- **Check it plays:** the player inline under the row (352 x 198, no
  autoplay, the same sandbox, reading only its own frame's messages), with
  "If it asks for a sign-in or says you need access, change its sharing:
  'Anyone with the link' on Loom and Drive, embedding allowed for
  cockpit.maharamedia.com on Vimeo." under it. This is the check for Loom
  and Drive, which cannot report a block (21.3).
- **Clear:** at once, no confirm, then "Cleared. Undo" for 10 s; Undo saves
  the same link, language, length and title again with revision 0 (a new
  revision with its own audit row).
- **Someone else saved first** (`40001`): the server's sentence on the row,
  and the section reads the videos again.
- **Refused row:** "This video's link was refused. Save it again in prep."
  on the row, with "Add a link" open for the same language.
- **Read failed:** "Videos could not be read: {reason}." with "Try again",
  and no fields, so an unread slot never looks unrecorded.
- **Readiness:** a slot never counts in "8 of 11 ready" and never turns a
  slide amber. A deck without videos is complete.
- `welcome_video` and `booking_video` stay on the journey and form
  controls, worded as they are; the section's foot line points there.

### 21.6 Keys

| Key | Action |
|---|---|
| V | Play the slide's first filled video, or close the player |
| Esc | Close the player first, then a panel, then the overview; never leave the deck |
| → ← Space PageDown PageUp, with the player open | Close the player, nothing else |

`keyCommand` gains a "video" command, and the player counts as an open
panel, so the engine's existing Esc rule covers it. Typing in a field is
still never caught.

### 21.7 Tokens

| Piece | Tokens |
|---|---|
| A tile | `--dk-panel` fill, 2 px inset `--dk-line-strong` edge at full opacity, 12 px radius; off: toggle and mark at 45% |
| A lit tile | a 2 px `--dk-teal` edge layer over the off edge; toggle track `--dk-teal`, knob `--dk-deep` |
| A tile's format mark | `--dk-ink-2`, 24 px, 12 px in from the top start corner |
| The next round, ahead | 2 px `--dk-line-strong`, dash 2 gap 8, no fill |
| The client's style change | 2 px `--dk-ink` edge and leader, label in ink |
| The next round, made | `--dk-panel-2` fill, solid `--dk-line-strong` edge |
| The check's one line | ink text, `--dk-ink-3` middots |
| The video control | ink-2 text and triangle, 2 px `--dk-line-strong` hairline, `--dk-edge` on hover; opacity follows the chrome |
| The player | `--dk-deep` (opaque) over the canvas, `--dk-panel` frame ground, 1 px `--dk-line-strong` edge, 16 px radius |

No new duration and no new colour: every value is 3.1 or 3.2. (The
`--dk-settle-ms` of the first plan is gone with its timer.)

### 21.8 The critique, and the slop test

The template answer for "set creative expectations" is a "What you control /
What we control / What we test" grid, or a do and don't table with ticks.
The plan rejects both: the field shows the mechanism happening instead of
listing it, and the deal around it is said one stop at a time. The template
answer for videos is a grid of thumbnails with play buttons, or a modal with
a spinning loader. The plan uses one line of quiet text that is there only
for the presenter's hand, a still loading line, and nothing on the client's
screen when a slot is empty.

Hallmark gates these could fail, and how they pass:
- **No invented numbers (46):** the field has no count and no percentage,
  and is tagged Illustration; the caption that said "20 versions" is gone.
- **No re-drawn chrome (47):** the player is the provider's real one in a
  frame; the field is not drawn as Ads Manager.
- **Locked tokens (48):** 21.7.
- **No italic headings, no eyebrows, no capitals:** the H3s are sentence
  case, roman; the video control is not an eyebrow, since it is not there
  at rest.
- **Motion:** `transform` and `opacity` only, stepped by the presenter, no
  timer, nothing loops, reduced motion set for every moving part.
- **Eight states:** the video control (21.2) and prep's Save (21.5).
- **Structural variety:** as in 21.1.

Pre-emit, these pieces: `P5 H4 E4 S5 R4 V4`. Execution stays at 4 until a
real video plays over a real Zoom share at 1280 and 1366 wide (17.12).

### 21.9 For the build

- `content.ts`: `LAUNCH.test` gains `job`, `volume`, `input`, `round`,
  `check` and `content`, and loses `page.name`, `page.copy`, `page.foot`,
  `open.name`, `open.chips`, `footer`, `proof.name` and `proof.caption`
  (`open.pick`, `open.pickNone` and `open.approve` stay; `fixed.copy` is cut
  to its first sentence); `test.input.copy` names a new price;
  `O.next.approval` and `O.next.testLine` change; `L_NOTES["creative-
  freedom"]` takes `CONTENT.md`'s notes, with `{goalAsk}` picked from the
  three variants and `{goal}` filled from `d.launch.goal90`, and their
  Arabic; L4's notes gain their first line; O7's notes gain theirs; L11's
  and L13's notes change; the "Copy reply" lines (three, both languages);
  the recap's testing line; `LAUNCH.training` gains the screenshot tag and
  alt text; new `VIDEO` strings (the control, the Arabic lengths, the
  player's three lines, "Close", the recap's heading).
- `launchDeck.tsx`: `CreativeFreedom` becomes the two columns with the
  field from stop 1, five stops, and the five stop names; `SponsoredPhone`
  leaves slide 4; `mockups/Cards.tsx`'s `TestTiles` becomes the field
  (`AdField`, with the next round, the layered edges and toggles, and the
  24 px marks); `PROOF_ID` and its toggle go; the slide's `missing` gains
  the red-lines count; the check is one line.
- `launchExpect.tsx`: `Training` has three stops (20.5), with the two
  masked screenshots in `src/present/assets/`.
- New `videos.ts` (the registry `VIDEO_SLOTS`, twelve slots; the language
  lookup, the mode rule, the length text, the recap lines, the provider
  origins and message readers), `VideoControl.tsx` and `VideoPlayer.tsx`,
  both drawn by `DeckShell` beside the count, the control inside the
  chrome's wake state; `engine.ts` gains "video".
- `channel.ts` gains `{type: "video", slot: string | null, lang}` (notes to
  deck), `{type: "video-state", slot, phase}` (deck to notes; `phase` is
  `loading`, `ready`, `playing`, `failed`, `blocked` or `closed`, and
  `playing` only after the provider's play event), `{type: "videos"}` (read
  again) and `{type: "closed"}` (the deck window's `pagehide`). None of it
  goes in `LiveState`: a reloaded deck never reopens a player on its own,
  and autoplay needs the press.
- `sources.ts`, `load.ts`, `useDeckModel.ts`: the three calls, the stricter
  row shape and the read at load (`VIDEOS.md` 7).
- `NotesWindow.tsx`: the Video section, its states and the skip line; the
  closing panel; "Copy reply" on slide 4; the launch recap on slides 10 and
  13. `launchControls.tsx` and `controls.tsx`: `partText` gains the testing
  line and ends with the recap's video block; `groupLinks` ends with it.
  `PrepView.tsx`: the Videos section (empty slots as one row) and "Copy
  reply" in slide 4's panel.
- `decks.ts`: `TARGET_MINUTES.launch` stays 28.
- `vercel.json` (client success): the header value exactly as `VIDEOS.md`
  6 gives it.
- Tests: the copy test (the new strings; no count on the field; the recap
  block left out when no slot is filled; the testing line in the recap; an
  Arabic length never m:ss; `VIDEO_SLOTS` equals the migration's twelve;
  the unmasked `pcm-*` names absent from the client success app); the
  engine (V, Esc, a move key closing the player; a stubbed Wistia frame
  that loads and sends nothing stays up, and is never shown as failed or
  blocked; a message from another frame or origin is ignored); `videos.ts`
  (lookup order, the mode rule, the lengths, the goal variants, the
  recorded provider samples); the PGlite test (`VIDEOS.md` 8).
- `deck-shots.mjs`: slide 4's five stops in both languages, done for you
  and done with you, stop 3 with five red lines and the stamp; training's
  three stops; O7 stop 1 with three red lines (9.7); one chrome-awake shot
  per deck with a filled slot, and onboarding slide 6 with two; the
  player's loading, didn't-load and can't-play states with the frame
  stubbed, so no provider loads during shots.
- Section 17 has the checks only production and a real call can make
  (17.11 to 17.15).

### 21.10 Change log: the spec review (2026-10-20)

The findings on this section's first version, each applied unless the line
says otherwise, with the CEO's two requests made during the build. The list
reached this revision cut off inside its thirty-sixth finding; how that one
was read is at its row.

| # | Finding | Applied in |
|---|---|---|
| 1 | Seed the calendar-blocking Loom (the CEO) | `VIDEOS.md` 6 (six seeds, with lengths), 8; `CONTENT.md` L10, the registry, the Gamma table, open question 30; `CONTENT-AR.md` point 9 |
| 2 | Show the Project Closing Mastery screenshots, masked (the CEO) | `CONTENT.md` copy rule 11, L8; 16.2, 20.5, 20.13 |
| 3 | O7 sets the small check before any ad exists | `CONTENT.md` O7 (approval line, testing line, notes), L3's intro; 9.7's fit check |
| 4 | A slot on O7 | `onboarding:testing`: the registry, `VIDEOS.md` 3, 8 |
| 5 | The agreement in writing; the handle points to it | The recap's testing line (`CONTENT.md` L10, L13); L3's notes |
| 6 | Warmth around the handle | L3's notes (opener, close, way out, "Copy reply"); 21.4, 21.5 |
| 7 | Three goal variants | `CONTENT.md` L3, the data map; `CONTENT-AR.md` L3 |
| 8 | Why the check stays small | L3 stop 4's notes |
| 9 | "Off-brand" is no longer subjective | L3 stop 4's notes: red lines, or their name, logo or colours |
| 10 | The guard rail before the phones | `CONTENT.md` L4's first note |
| 11 | A slot on L11 | `launch:first-90-days`: the registry, `VIDEOS.md` 3, 8 |
| 12 | The recap without reaching L10 | L13's notes; 21.4's closing panel |
| 13 | A new price among the inputs; does the team ask first? | L3 stop 3; open question 34 |
| 14 | The CEO's contrast in stop 1's notes | L3's notes (the on-screen copy unchanged) |
| 15 | No timer: "all on" is a resting stop | 21.1 motion; 21.7 (`--dk-settle-ms` gone) |
| 16 | The video control is chrome | 21.2; 12.1; the skip line in 21.4 |
| 17 | No false "can't play" | 21.3 states; the engine test in 21.9 |
| 18 | Slide 4 opens on the field, not a phone | 21.1; 21.9 (`SponsoredPhone` leaves the slide) |
| 19 | A tile's edge never fades | 21.1, 21.7 |
| 20 | Format marks at 24 px ink-2 | 21.1, 21.7, with the fallback if they crowd |
| 21 | The check is one line, not a stepper | 21.0, 21.1, 21.7 |
| 22 | The stamp at the words column's end edge | 21.1 |
| 23 | The player's frame is visible on the veil | 21.3, 21.7 |
| 24 | No "Esc" on the canvas | 21.3; the notes window line in 21.4 |
| 25 | Untick "Optimize for video clip" | 21.3, 21.4 |
| 26 | "Playing" only after the play event | 21.4; the `ready` phase in 21.9 |
| 27 | An empty slot is one row in prep | 21.5 |
| 28 | The CSP keeps the frames the app already has | `VIDEOS.md` 6 (the exact header value); 21.3; 17.11 |
| 29 | Six seeds, six seed audit rows, the lengths | `VIDEOS.md` 6, 8; `CONTENT.md` open question 30 |
| 30 | The PGlite test loads the gate and counts the new functions | `VIDEOS.md` 8 |
| 31 | The revision is required; 0 means "I saw it empty" | `VIDEOS.md` 4, 7, 8; 21.5 |
| 32 | Null arguments get sentences; one slot list | `VIDEOS.md` 3, 4, 8 |
| 33 | The link parse, exactly | `VIDEOS.md` 3, 8 |
| 34 | Loom title slugs; Drive's `resourcekey` | `VIDEOS.md` 3, 8 |
| 35 | A stricter row shape in the browser | `VIDEOS.md` 7; the refused state in 21.4, 21.5 |
| 36 | Messages from a player (cut off after "The outbound Y…") | Read as: a message is credited to a player only when it comes from that player's own frame (`event.source`) and its provider's origin, and outbound messages (YouTube's `listening` handshake, Vimeo's `addEventListener`) name the provider's exact origin, never `"*"`. `VIDEOS.md` 6; 21.3; the engine test in 21.9 |

**Where a finding was applied differently, and why**
- **The read takes its deck** (32). The finding asked every function to
  refuse a null deck, and the read used null for "both decks". No window
  needs both (the deck, the notes window and prep each read their own), so
  the read now requires its deck like the others, and `readDeckVideos`
  takes it.
- **The skip line is said once** (16). "If you skip this, say the video is
  in your group." ends the notes window's Video block on every slide with a
  filled slot, instead of being copied into each slide's notes: one home,
  and it never shows where there is no video to point to.
- **"Copy reply" is in prep too** (6), because pushback in the group comes
  after the call, when the notes window is closed.
- **Training is three stops** (2): the classroom, the lesson, then the
  statements. Two screenshots side by side at the column's width would be
  unreadable on a share, and the slide ends on the ask.
- **`cockpit_csm_deck_video_json` is a definer** (30). The finding's
  exemption list named the three `IMMUTABLE` helpers; the row-to-JSON
  helper is `STABLE` and was not named, so it is `SECURITY DEFINER` like the
  audit function, revoked from every role, and the census's definer rule
  holds for it unchanged.
- **Every sentence the video functions raise ends with a full stop,**
  including "Choose the onboarding or the launch deck.", which the decks
  migration raises without one. They are new functions; prep shows them as
  sentences.
- **The clear's conflict says "clear it again"** where the save's says
  "save again", so the sentence names the action that failed.

### 21.11 Build notes (the frontend, 2026-10-20)

Where the build set something differently from 21.1 to 21.9, and why. The
shots are in the run's `cv-frontend` folder.
- **The red lines' panel head** is a label (600 24 ink, Plex 600 26), not
  the 30/700 column head: under the stop's own H3 it made two headings
  stacked, and five red lines with the stamp did not clear y 892. The red
  lines stay the stop's one primary. The panel is `--dk-leak-soft` as 21.1
  says; the lines are 30/1.25 (Arabic 30/1.4) with 2 px between them.
- **O7 in Arabic** (9.7): the plant made the test's line three lines, so
  with three typed red lines and a booked Blueprint the date met the slide
  count. In Arabic only, the statements start 48 px under the title (was
  64), the red lines are 30/1.4 with 4 px between them, and the band's rule
  is 36 px above it (was 44). English is unchanged and fits.
- **Media marks never mirror.** 21.1 mirrors the format marks in RTL; a
  play triangle points right in every language, so the field's marks and
  the video control's triangle stay as drawn. The toggles, the grid and the
  leader mirror.
- **Training's "What it teaches"** keeps its four words on one line: with
  the list column at 864 (20.5) the line's steps are 204 px apart (was 220)
  and the words do not wrap ("The close" broke onto two lines).
- **The players' messages** were read from real frames: `VIDEOS.md` 6 has
  the shapes, and a Vimeo `PlaybackError` is not read as a block.
- **A notes window opened mid-video** asks the deck (its `hello`) and is
  told what the player is doing, so it never offers "Play on screen" over a
  video already up.

### 21.12 The fixer's round (2026-10-20): every slide to at least 4

The score round's findings, as built. Each line is the change and why.

**Order.** Creative freedom is slide 3 and the ads slide 4 (they swapped).
The coach's point, which the CEO adopted, is to set the guard rails before
the client sees the ads: the first look is when the small-change requests
start. The ads slide's notes now point back ("As we just agreed"), and
creative freedom's stop 4 says "On the next slide you'll see your ads". The
`L3` and `L4` labels across these files follow the new order.

**Journey.**
- Stop 4's five dots (and L6 stop 7's timeline) lead every row with its time
  in bold: "Booked", "The day before", "Before the meeting" (the call to
  confirm; it had no lead), "2 hours before"; the meeting, the list's end,
  is bold whole (`.dkc-dot-when`, `.dkc-rem-end`).
- Stop 6's fork: each end's node sits on its name's first line (the block
  is lifted half the name's line, 19.5 px, 22.4 in Arabic), never between
  two lines. Done for you the shared end's two-line line would push the
  no-show to the slide's foot, so that end rises 50 px off the meeting's
  line, the solid line bending up into it, and the fork still ends above
  the foot. The name reads "Came, still thinking it over?".
- The rebook mark is one drawing (`RebookMark`, `JourneyLanes.tsx`): a ring
  with a circular arrow turning 270 degrees and a filled head. The open arc
  read as a copyright sign at Zoom size. It is used in the lanes, the
  fork and the portal's number-one job, and mirrors in Arabic.
- Stop 7's outcome form is two crops in one frame (`OUTCOME_PIECES`): the
  attended buttons, then where the deal stands, the empty band and the
  rule between them cut out, drawn 732 px wide (it was 660), so its labels
  read at about 16 px.

**Creative freedom (21.1).**
- Stops 1 and 2 carry no next round; the pair (words and field) sits 110 px
  lower, in the middle of the room between the title and the rail, and
  rises as the round arrives at stop 3. Stop 5's words sit in the middle of
  the field beside them.
- Stop 2: their pick, when marked, runs on tile 15 of the field (row 3,
  column 3, one of the three that stay lit), its picture under the teal
  edge, the star on its corner, from the switch-off on. The thumbnail
  beside the words is gone. A real creative is never on a dimmed tile.
- Stop 3's panel: its head at 28/600 in ink, its items at 26, and "You told
  us:" and "Always" the same small label with 12 px above each.
- Stop 4: "Facts · Prices · Claims" is the stop's hero (56/700), about 32 px
  under the stop's name, with one small line under it ("You check these in
  the group before an ad goes live."); the second small line is gone.

**The form's thank-you stop.** A leader from just outside the phone, level
with its thank-you message, into the band's start padding on the line that
holds "5 minutes", which is underlined in teal: the band reads as the
screen said large, not as a duplicate.

**The call's stop 8.** The caption under the card is the stop's lead over
it ("Everything our caller learned lands with you."), and the call card
and the appointment move down 72 px together, into the middle of the room
above the rail. Once the call has ended the clock is a length in the deck's
digits (٤:٥١ in Arabic); while it runs it keeps Latin digits (13.4).

**Partnership.** The pie's missing piece is dotted in ink-3 at 1.5 px (it
was line-strong at 2), so the gap reads before stop 2 pulls it out. On the
roads, the ad road's reasons sit on its own bends ("Meeting you for the
first time" over its first crest, "Comparing you with others" under its
third dip), fading in after the road draws; the line under its name is
gone.

**Training.** The lead says why ("Enquiries from ads are meeting you for
the first time. This course is how you win them."); "Premium Projects
Academy" is a small label over the list, on the tag's row, so the list and
the picture still start level. Stop 1 rings Project Closing Mastery's tile
(2 px teal, 7 px out) and draws one teal leader from the lit row, in at the
screenshot's margin and along the gap between the tiles' rows, so it never
crosses a tile. Stop 2 crops the lesson to its outline (to the first
objection) and its title, the cut in the video's dark ground, about 1.3
times larger.

**Portal.** The title spans the slide on one line; the stop's words sit
under it, the screen beside them. The phone stop stands the phone about
840 px tall (a 440 x 778 film in its bezel and tag) at the end margin,
beside the title. The screens are a step down and crisper
(`brightness(0.9) contrast(1.12)`; the phone's still had its capture's haze
lifted with a levels pass, since it is the client success app's own file).
The overview's demo row masks "Lead quality" and the item after it with
the screen's own white (`CropBox.masks`): the picture is the sales deck's,
byte-pinned, so it is never edited. A dark-mode capture of the portal was
asked for and is still open: it needs a sign-in to a demo workspace. The
number-one job numbers its three taps in their rings.

**Your part.** The three project pictures sit under "Keep your Drive folder
fed", the job they illustrate. The calendar's dark cells are named once,
in a key under the week ("Blocked", مسكّر); no cell carries a word. The
reviewer's suggestion to move "Leave the ads running" into the middle
column to balance it was not taken: it would put a week-to-week job under
"After each meeting".

**The first 90 days.** Every check-in after the first is one glyph, a small
open diamond, whichever rhythm it falls on; the ringed diamond marks the
look back at about 30, 60 and 90 days; the first is open at full size with
its own words. The key has one line per glyph.

**Good to know.** The title is "Good to know" (أشياء تهمكم); the rows sit
under two small heads, "Money" and "Messages", 30 px apart. The Arabic rows
run at 30/1.5 so five rows still end above the count.

**The notes window.** On a slide whose notes are led by two or more stops,
the talk track is grouped under the stops' names, the current stop open
and the others folded to their name (a click opens one). Creative
freedom's pushback handle (`SlideNotes.push`, `pushAr`) sits under one "If
they push back" disclosure that stays as the CSM left it across stops.

**The player.** The shots' stubbed frame is painted in the deck's panel,
#0e1a42 (it was #111, a second dark), so a stubbed frame sits in the same
palette as the loading and failure states, which already show the frame's
panel. A provider's own player paints its own ground.

**Prep.** "Not recorded yet" sits under every slot's title, however short.


### 21.13 The fixer's round, score round 2 (2026-10-20)

Score round 2's findings, as built. Each line is the change and why; where
it changes an earlier section, that section says so.

**Journey.**
- Stop 3's "5 minutes" carries the thank-you band's teal underline
  (`.dkc-thanks-mark`, `fiveMinutes()`), so the promise reads the same on
  both slides. The queue card names each row's own service and leaves a
  row past the list without one (it repeated the first: المطابخ three times
  in Arabic).
- Stop 6: the words at the stage's top (y 284, as stop 3), the fork alone in
  the `data-level` figure, level with "You meet" (6.4). It ends at y 968 in
  Arabic (it ran to 1002, past the lanes' foot at 975).

**Creative freedom (21.1).**
- Stop 3's panel: heads "Never" and "Always" (the spec's pair); a line typed
  on O7 carries "you told us" after it, 20 px in ink-3 (22 in Arabic); a card
  line in the other script than the deck's goes under a third head, "From
  your card" (من ملفكم), quoted as written (`redLineGroups()`); a typed line
  later copied to the card shows once, as theirs. Prep's Do's & Don'ts
  section says so in the Arabic deck.
- Stop 5's words sit on stops 3 and 4's anchor: the centring that dropped its
  name from y 255 to 493 is gone.
- The stamp is set in the text face (Geist, ink-2), not the mono tags'.

**The form's thank-you stop.** No leader: the band's highlight and its
underlined "5 minutes" pair it with the phone's message; the leader's
right-angle detour round the list was a second thing to follow.

**The call's stop 7 (11.5).** The transcript goes; the reminders and the
confirmation start level with the call card's top, and the card sits 72 px
lower, where stop 8 keeps it, so it no longer jumps between the two. The
reminders take 500 px (gap 48, the confirmation 620), so "Before the
meeting · a call to confirm" (437 px at 26) stays one line.

**Partnership.** In Arabic the roads sit 49 px lower (`[dir="rtl"]
.dkc-routes`): the two-line Arabic title and its caption stand 49 px taller
than the English, and the first crest's words were drawn on the caption.
They now keep the English 33 px under it. "Comparing you with others" sits
over the last crest (x 1130 to 1256, y 404): under the third dip it was
nearer the referral road than its own bend.

**Training.** Stop 1's leader runs from the lit course, level with its
name, to the screenshot's edge and stops there; the 2 px teal ring alone
marks the tile. Run on along the gap between the tiles' rows, it lay on the
neighbouring tile's top edge (Offer Creation in English, Team & Operations
in Arabic). The lead says "This course shows you how to win them."

**Portal.** The Arabic overview masks the row after ملاحظاتك (x 0.6355 to
0.7399 of the screen, the English mask's height), as the English ends at
"Your feedback". The recorded call is drawn at 880 px (0.74 of its crop),
by the stop's words, its tag on its own corner: the source's waveform was
caught mid-draw, so at 1080 it read soft. The phone stop adds the install
address under its words (small, ink-2) and stands the phone 400 px in from
the end margin, its middle at about 60% of the width.

**Your part.** The calendar week has three rows (eleven open slots, the day
off three blocked hours) and its key sits on the "Day off" line at the
week's start, so the first column ends at y 896 (it ran to 966).

**The first 90 days.** The weeks between, there only on a weekly rhythm,
are open diamonds edged in ink-3, so the axis shows both rhythms the key
names without a new glyph.

**Good to know.** Each money row's do-this is in ink inside its ink-2 line
(`.dkc-know-act`).

**Onboarding.** O3's Arabic reply hours run on a 560 px line. O7's testing
statement is three lines: the ads' job at the body's size; the volume small,
in ink-2; the ask small, in ink, over the list it fills; the list ends
29 px above the band's rule with three red lines.

**The chrome and the notes window.** "Back to {client}" is one run inside
its button (the flex gap and the space read as two spaces). The notes
window's video block leads with "If you skip this, say the video is in
your group.", so the sticky Back/Next bar never covers it.

**The shots.** `deck-shots.mjs` fails a run on any two runs of text in
different blocks that overlap by more than 2 px anywhere on the slide (each
run's line box taken in by a sixth of its height top and bottom), as well as
on anything near the foot: the Arabic roads' collision passed because only
the foot was checked.

**Not taken.** Journey stop 5's calendar stays four hours: cropped to 4 to
6 pm, its entry would leave the lit row's line, since the stage is set low.
Training stop 3's statements stay at the list's top: level with the lit
course they would run past the foot.

## 22. The visual pass (CEO, 2026-10-20)

The CEO, the same day, verbatim:

1. "make the onboarding presentation: look better. Add more visuals as well
   for the placeholders. You can use Higgsfield to add an example ad instead
   of just having the logo as well. Don't be afraid to do that and add really
   nice animations. The presentations are really cool things."
2. "for their ads allow just a drive link to work and it can work with folder
   or just the video. make it really easy for him to prepare"

The standing asks hold: the onboarding deck stays short, the launch deck is
visual, nothing is said twice, it must not look generated (Hallmark), and it
is presented straight from the cockpit. This section is the design plan,
written as frontend-design asks (the plan, then the critique) and checked
against Hallmark's motion reference and slop test. `CONTENT.md` and
`CONTENT-AR.md` hold the words ("The visual pass"), and `DRIVE-IMPORT.md`
the backend of the Drive link. Where this section and an earlier one
disagree, this section wins.

### 22.0 What the shots showed

Both decks shot at 1920 x 1080 in English, the full and sparse fixtures,
still (`vd-spec` run of 2026-10-20). Every onboarding slide and the launch
slides named in 22.6 were read.

- **O1.** A logo, a three-line agenda and the faint lanes on the end half.
  Correct, quiet, and the same shape as the launch cover. Sparse: a circle
  with two initials ("AF") on panel-2, which reads as an empty avatar.
- **O2.** The goal at 60 px works. The three other answers arrive with it,
  so the client reads four things at once and the goal is not given its
  moment.
- **O3.** The branching diagram reads well. The reply hours are a 26 px
  paragraph under the group's name: the promise the slide exists for is its
  smallest text.
- **O4.** A matrix with nothing ticked and "Kitchens" at display size on the
  start side. No picture of what the service becomes.
- **O5.** The road at y 424 and one footer line at y 690; the lower 300 px of
  the slide are empty.
- **O6.** Five ruled rows of equal weight. The two rows done on the call
  (Meta access, Mahara OS) look like the three left for the week.
- **O7.** The plant ("Your ads are there to bring in business…") sits at
  24 px under a band set at about 80 px; the band's size outweighs
  everything above it (the score round's 3). Stop 2's starter phones are
  fine.
- **Sparse launch deck.** Every phone (journey stop 1, the ads slide) shows a
  navy block with a monogram and the client's full name: the CEO's "just
  having the logo".
- **Launch, measured:** journey stop 6's statement at y 284 to 380 and its
  fork at y 740 to 930; creative freedom's field at y 362 on stops 1 and 2
  and y 252 from stop 3 (the 110 px jump); stop 3's panel holds a head, two
  group heads, five lines, two "you told us" tags and a closing sentence,
  with two more lines under it; the portal's figure is x 680 to 1784 and
  y 284 to 889 on stop 1, x 680 to 1584 and y 376 to 797 on stop 2, a phone
  at x 920 to 1384 and y 134 to 937 on stop 3, with its tag at y 249, 341
  and 112; the pie names theirs in one 30 px line at the slide's start edge
  against our three; training's lesson crop cuts the video player at the
  frame's end edge.

### 22.1 The plan

- **Colour.** No new hue and no new colour token. Teal is lit, done and
  ours; amber is what the client still owes; ink is the client's. The only
  new colour on the canvas is photography, and it lives only inside a phone
  screen or a field tile, never as a slide's ground.
- **Type.** Section 4's scale. One new role: the client's 90-day goal at
  Geist 400 80/1.12, -0.025em (Plex 400 76/1.45), on O2 only. Covers and
  the Blueprint stop keep display and H1.
- **Layout.** Each onboarding slide gets its own structure, and no two
  neighbours share one (22.8): a cover with a checklist (O1), a quotation
  set as type (O2), a hub with branches (O3), a decision matrix beside a
  product column with a phone (O4), a route (O5), a board of two cards over
  ruled rows (O6), two columns under a strip of example ads, then one
  statement (O7).
- **Signature (onboarding): the call's checklist.** The three things the
  call must finish ("Choose your launch service", "Set up your access",
  "Book your Brand Blueprint call") are introduced on the cover as a list of
  three rings with their numbers, tick at the foot of the two slides where
  they get done (O4, O6), and close the deck on O7's last stop with their
  true state. It is the deck's one drawing that persists, it carries the
  call's real job (PS §3: most clients leave with access open, which is
  what delays a launch), and every tick is driven by data, never by the
  deck's Next press: each is a recorded fact (the client's choice, a setup
  step, a booking). The faint lanes leave O1: they first appear on the launch cover a
  week later, where they belong.
- **Signature (launch):** unchanged, the journey lanes. The pass adds
  photography (example ads) and one motion system.
- **Motion.** One vocabulary for both decks (22.3): each press makes one
  change; arrivals are the slide's crossfade plus, on six stops only, one
  short sequence where the sequence is the point.

### 22.2 The onboarding deck, slide by slide

Seven slides, about 22 minutes of a 45 to 60 minute call: about 13 on the
slides and 9 for the live setup while slide 6 is up. `TARGET_MINUTES.
onboarding` becomes 22 (it was 10, which counted the slides only).

| # | Slide | Structure | Stops | Minutes |
|---|---|---|---|---|
| 1 | Welcome | the cover with the checklist | 1 | 1.5 |
| 2 | Your goals | their words set as type | 2 | 2.5 |
| 3 | Your team | the hub: their group, five roles join | 2 | 2 |
| 4 | One service per campaign | the matrix beside the product column | 1 | 3 |
| 5 | The road | a route lit to today | 1 | 1.5 |
| 6 | This week | a board: two cards, three rows | 1 | 9 (with the setup) |
| 7 | What to expect, and what's next | two columns under a strip of example ads, then the Blueprint | 2 (3 with starters) | 2.5 |

The content boxes are section 5.1's (no rail: y 112 to 976). Slides 4 and 6
also draw the checklist at the foot, in the launch mini rail's place
(bottom 44), so their content ends at y 948 as a rail slide's does.

#### 22.2.0 The call's checklist (`TodayList`, `dkc-today`)

Three items, in the call's order. Each is a ring (the lanes' marks) with its
number inside, and its name:

| Item | Long name (O1) | Short name (foot, O7) | Done when (data, not a press) |
|---|---|---|---|
| 1 | Choose your launch service | Launch service | `prep.service_chosen_at` is set: O4's "Launch with this" writes it (with `service_focus`), the notes window's Undo clears it |
| 2 | Set up your access | Your access | O6's Meta access and Mahara OS cards are both Done (done with you: Meta access and Your CRM; plus the callers' phones card when it shows) |
| 3 | Book your Brand Blueprint call | Blueprint call | `next.blueprint` reads back (the notes window's Book button), or the kickoff is sent: O8's Submit, or a kickoff on record (section 23) |

- **Proposed is not chosen.** A `service_focus` typed in prep before the
  call, with no `service_chosen_at`, is the column's proposal (22.2.4): item 1
  stays open, so its tick is the one the client watches happen when they
  choose. A choice made on an earlier showing of the deck is still a choice
  the client made, so the stamp is kept until Undo, not timed against the
  deck's open (`DRIVE-IMPORT.md` 9 has the key).
- **Marks.** Open: a ring (2 px `--dk-line-strong`) with its numeral in
  Geist 600, ink-2 (Plex 600, `"١٢٣"`). Done: the lanes' passed mark, a teal
  ring with a teal check, the numeral gone; the name turns ink. Never a
  half state and never a count ("2 of 3").
- **Large (O1, O7's last stop):** rings 44 px, numerals 22 px, names at
  40/600 (O1) or 30/600 (O7, in one row). On O1 the three are always open:
  it is the agenda, said before anything is done, even when prep already
  holds a service.
- **Foot (O4, O6):** "Today" (Geist 500 24 ink-2), then the three items in
  one line, rings 24 px with 14 px numerals, short names at 24/500: the
  slide's own item in ink-2 while open, the others in ink-3, a done item in
  ink. It sits at the content's inline start, bottom 44, and ends at least
  48 px before the slide count. It draws no line between its items (the
  road is O5's).
- **The tick.** Only a change seen on screen animates: when an item turns
  done while its slide is up, its check draws (`stroke-dashoffset`,
  `--dk-t-tick`) and the ring's teal layer fades in over the line-strong one
  (opacity, `--dk-t-tick`), then the name's ink layer (opacity,
  `--dk-t-swap`). A slide that opens on a done item shows it done, at once,
  with one exception: O7's last stop, where the deck closes, draws the
  checks of its done items in order on arrival (22.3.2).
- **RTL.** The list runs from the right; the check is drawn in the same
  hand in both languages (the existing `.dkc-check` rule).

#### 22.2.1 O1 · Welcome: the cover with the checklist

*Score round 2 (22.13): the phone is 760 tall (about y 200 to 960), its tag 24 px under its foot, end-aligned (over it, the tag stacked under the presenter as a third line); the rings draw at `--dk-t-ring` (240 ms each). L1 takes the same phone and tag.*


```text
1920 x 1080, English, the full client
+--------------------------------------------------------------------------------------------+
| [MAHARA logo 64]  Onboarding call · 19 October (Mono 24 ink-2)       Sara (600 30 ink)     |
|                                                                Your client success manager |
|                                                                                            |
|  +------+                                        Before we hang up, we'll: (30 ink-2)      |
|  | logo |  (plate 120, or the monogram tile)                                               |
|  +------+                                        (1)  Choose your launch service           |
|                                                   :                         (40/600 ink)   |
|  Welcome,                (80/400 ink-2)          (2)  Set up your access                   |
|  Noor Studio                                      :                                        |
|  Interiors               (96/700 ink, 2 lines)   (3)  Book your Brand Blueprint call       |
|                                                                                            |
|  x 136 ....................................... x 920  x 1040 ......................... x 1784|
+--------------------------------------------------------------------------------------------+
```

- **Start half (x 136 to 920).** The client's mark at y 252 (the logo plate,
  or the monogram tile, 22.5.1, 120 px); "Welcome," at 80/400 ink-2; the
  name at 96/700 ink, -0.03em, at most two lines in 784 px; a longer name
  steps to 80, then 64. Weight carries the name, never teal.
- **End half (x 1040 to 1784).** The checklist, large, vertically centred on
  the name block: the lead-in at 30/400 ink-2, then the three rows 112 px
  apart, the rings joined by the lanes' unlit dotted line (2 px
  `--dk-line-strong`, dash 2, gap 8), ring centre to ring centre.
- **Motion (arrival, one stop).** The slide's crossfade, then the three
  rings draw in order as one compound path, drawn once along its whole
  length (`stroke-dashoffset`, 480 ms, `--dk-ease`; 22.3.2's one path),
  each numeral and name fading in as its ring closes (opacity,
  `--dk-t-swap`, at 160, 320 and 480 ms), then the two dotted joins
  (opacity, `--dk-t-swap`). About 720 ms in all, then nothing moves.
- **Reduced motion / still:** set at once.
- **RTL:** the halves swap; the name block and the list both start at the
  inline start of their half.
- **Data and fallbacks:** as 9.1. No CSM name: the role line alone.

#### 22.2.2 O2 · Your goals: their words, set as type

*Score round 2 (22.13): a teal opening quotation mark (Geist 700, 160 px; « in Plex for words in Arabic letters, in either deck) hangs in the start margin of the words' own direction, top-aligned to the goal's capitals; stop 2's row is a grid of `auto` columns with `justify-content: space-between`, and a list's items are 16 px apart with a hairline between them.*


- **Stop 1, the goal alone.** The title (H2) and its provenance tag on the
  title row (as now). "In 90 days" (500 24 ink-2) at y 268, then the goal at
  80/400 ink (22.1), measure 1400, at most three lines; a longer goal steps
  to 64/1.18, then 56. Nothing else on the stage: the CSM reads it back.
- **Stop 2, what surrounds it.** Under a 2 px `--dk-line-strong` hairline
  (y about 640), the three other answers in one row of three columns of
  unequal width sized to their text (In 12 to 24 months, What's in the way,
  Why you joined): label 500 24 ink-2, answer 30/400 ink. The footnote
  ("targets, not a promise of results") arrives with them at the foot. The
  row arrives as one (opacity and a `--dk-rise` lift, `--dk-t-swap`); the
  goal does not move or shrink. As built (the fixer's round): the hairline
  40 px under the goal and the answers 24 px under it, the footnote at
  least 24 px under the row. A goal in Latin letters keeps the
  Latin sizes and leading in the Arabic deck (Arabic's 1.45 leading pushed
  the row into the foot).
- **Answers missing.** A column with no answer is left out and the others
  widen. No goal but other answers: stop 1 is the question and its input
  (below), stop 2 the row. No answers at all: one stop, the question as the
  slide's one heading (as now) and, under it, the input set as the 80 px
  line: a 2 px `--dk-line-strong` underline, its placeholder in ink-3
  ("Your 90-day goal, in your words"). Nothing on the canvas looks broken or
  empty; the prep line says what to do (22.5).
- **Reduced motion / still:** stop 2's row set at once.

#### 22.2.3 O3 · Your team: the group fills

*Score round 2 (22.13): the WhatsApp mark is a 36 px badge on their mark's bottom end corner, ringed in the ground; the hub column is 460 px with a 64 px gap and the bus sits 100 px before the roles, so the trunk is under 300 px; the trunk and each branch draw in 160 ms.*


- **Stage.** Start side: the client's mark (the logo plate or the monogram
  tile, 112 px) centred at y 600; under it, one row: the real WhatsApp mark
  (32 px, `platforms.tsx`) and beside it the label "Your WhatsApp group"
  (24/500 ink-2, `.dk-label`), not a heading, because the slide's title
  already says it. End side, x 800 to 1784: the five roles 110 px apart
  from y 360, each a 14 px teal node (ours), the role at 30/600 ink and its
  line at 26/400 ink-2. The trunk and branches from the mark to each node
  in 2 px `--dk-line-strong` (the current tree, kept).
- **Stop 1 (arrival): the people join.** The trunk and the five branches
  are one compound path (the trunk first, then each branch in the list's
  order), drawn once along its whole length (`stroke-dashoffset`, 640 ms,
  `--dk-ease`; 22.3.2's one path), so the trunk leaves the mark and each
  branch reaches its node in turn; each role fades in as its branch arrives
  (opacity, `--dk-t-swap`). About 760 ms with the last role, once, then
  still. It is the slide's point: one group, everyone in it.
- **Stop 2: the promise.** Under the label, at the start side, "We reply
  within 2 working hours." as the stop's H3 (40/700 ink), and under it the
  hours and the worry line at 26/400 ink-2 (UAE: the zone, per the data
  map), measure 560. Opacity and `--dk-rise`, `--dk-t-swap`. The reply time
  was the slide's smallest text; it is now its second beat, and nothing
  the same size sits over it.
- **The presenter.** The group fills in one burst as the slide opens
  (about 760 ms); the CSM then goes down the five roles on a still slide
  (`CONTENT.md`, O3's note).
- **What it leaves out.** No WhatsApp screen, no messages, no faces, no
  names (7.9's reasons stand): "living" is the group filling, not invented
  chat.
- **Done with you:** row 5 as 9.3. **RTL:** the mark on the right, the roles
  on the left, the tree mirrored (`scaleX(-1)`, no text in the SVG).
- **Reduced motion / still:** both stops set at once.

#### 22.2.4 O4 · One service per campaign: the product column

*Score round 2 (22.13): three services or fewer take 96 px rows with names at 36/600, and the table centres on the product column; while fewer than three are typed, the rows still to fill are ghosts (dashed rules, the rings at 0.35) with "Add a service" in the first one's name slot; the phone's picture fades in with its rise.*


```text
+--------------------------------------------------------------------------------------------+
| One service per campaign (H2)                                                              |
| We launch with one service, so the ads, the form questions and the calls are all          |
| written for one kind of customer.  (lead 40/400 ink-2, measure 1300, ends x 1436)           |
|                                                                          Example ad (y 316)|
|                     Easiest   Most     Least painful   Your first campaign  +-----------+  |
|                     to sell   profit   to deliver      Kitchens (H2)        | Instagram |  |
| ##Kitchens##########  (v)      ( )       (v) ######    Once it works, we    | feed      |  |
|   Bathrooms           (v)      ( )       (v)           can add the next     | phone     |  |
|   Full villa fit-out  ( )      (v)       ( )           one. (24 ink-2)      | 600 tall  |  |
|   Interior design     ( )      (v)       (v)           [Launch with this]   | y 340-940 |  |
|   + Add a service                                                           +-----------+  |
| Today (1) Launch service (2) Your access (3) Blueprint call                        04 / 07 |
+--------------------------------------------------------------------------------------------+
  x 136 ........ matrix ........ x 1000   x 1080 .. text .. x 1450  x 1498 . phone . x 1784
```

- **The matrix (x 136 to 1000).** As 9.4: the header row's three qualifiers
  (500 24 ink-2), service rows 72 px (30/600 ink), 40 px tick rings in the
  qualifier columns (a tick is the lanes' passed mark, teal), the leading
  row (most ticks) under the `--dk-teal-faint` band, "+ Add a service".
- **The product column, on the ground (x 1080 to 1784).** No panel: a card
  around a phone frame is the card-in-card tell, and it shrank the one
  photograph the CEO asked for to a thumbnail. Its text column (x 1080 to
  1450, from y 380, level with the matrix's header): "Your first campaign"
  (500 24 ink-2), the service at H2 (56/700 ink, at most two lines in
  370 px, else 44), "Once it works, we can add the next one." (24 ink-2),
  then the canvas control "Launch with this" (as now), ending by y 940.
  Its phone: the Instagram feed phone (7.2), 600 px tall (y 340 to 940),
  its end edge at x 1784, about 286 px wide at the frame's 0.477 ratio,
  showing the example ad for that service (22.4) under their Page name and
  avatar. The tag "Example ad" (5.4) sits over the phone's end corner, its
  baseline at y 316: clear of the lead, which ends at x 1436, and of the
  foot checklist, whose content ends at y 948. A client with a custom
  creative of their own shows it instead, untagged. The Hallmark stamp at
  the top of `present.css` adds O4 to its phone-frame exceptions.
- **Before a choice: the proposal.** The name in ink-2 is what the deck
  would launch with today: `prep.service_focus` (typed in prep, with no
  `service_chosen_at`), then the kickoff, then the form's #1 (22.4.2). As
  the client ticks, the leading row replaces it, still in ink-2. The phone
  shows the example for the proposal, and the button is live. With no
  services at all: the name reads "We'll pick it together" in ink-3, the
  phone shows the default example, and the button is disabled until a row
  exists.
- **On "Launch with this".** One prep save writes `service_focus` (and
  `service_focus_ar` when the row has its Arabic) and `service_chosen_at:
  true`. The name turns ink (opacity of its ink layer, `--dk-t-swap`); if
  the chosen service maps to another example, the phone's picture
  crossfades to it (`--dk-swap-ms`, inside the screen, only after the new
  picture's `decode()` resolves); the button becomes the quiet label
  "Chosen" with a teal check; the foot checklist ticks item 1 (22.2.0).
  The notes window's Undo puts the previous `service_focus` back and clears
  `service_chosen_at`, at once.
- **A tick.** Its check draws in `--dk-t-tick`; when the leader changes, the
  band moves to the new row (`translateY`, `--dk-t-move`, `--dk-ease-move`).
  The column's name follows in ink-2; the phone does not change until the
  choice is confirmed, so nothing in the phone moves while the client
  answers.
- **Arrival (one of the six sequences, 22.3.2).** The deck's first
  photograph is given its moment: 160 ms after the slide's crossfade, the
  phone rises in once (opacity, and `translateY` from `--dk-rise` to 0,
  `--dk-t-swap`, `--dk-ease`), then its picture fades in over the screen's
  own dark ground only once its `decode()` has resolved (opacity,
  `--dk-t-swap`). Then nothing moves.
- **Reduced motion / still:** every state set at once; the shot script
  waits for the picture's `decode()` before it shoots.
- **RTL:** the matrix on the right, the product column on the left; its
  phone at the column's inline end (the slide's left edge, x 136), its text
  column beside it; the tag over the phone's end corner; the phone's
  chrome follows the app language (7.1).

#### 22.2.5 O5 · The road: a route lit to today

*Score round 2 (22.13): the road ends at its payoff, the WhatsApp confirmation their customer gets (7.6), tagged "Example wording", under the last two stops (x 1214 to 1784), dated two working days after go-live (else a week after the booked launch call, else three weeks after this call); the launch call's line keeps to its own column; the foot line sits on the start half, level with the card's foot.*


- **The route.** One straight line at y 560 across the content width. The
  six stops sit on it at equal spacing (about 270 px apart, with the last
  stop's 300 px label column after it; see Labels), in the lanes' marks (passed: teal ring and check; today: solid
  teal with the `--dk-deep` dot; ahead: a `--dk-line-strong` ring). The lit
  part, from the first stop to today, is a 4 px teal line; the rest is 3 px
  `--dk-line-strong`, dash 3 and gap 9, which holds its dots through
  Zoom's compression better than 2 and 8. No bends: a curve that crested
  near today read as a road running downhill towards the launch, and it
  made the labels zig-zag above and below. The light to today and the
  token riding it are the signature, not the shape of the line.
- **Labels.** Every label sits below its node: the stop's name (30/600 ink,
  today's in ink with "Today" in teal under it; passed in ink-2) and its
  date or line (26/400 ink-2), at most 300 px wide, starting at the node's
  inline-start edge (the callout rule). The last stop keeps its own 300 px
  column: the stops are spaced over the width less 300 (about 270 px
  apart), so the last node sits 300 px short of the content's end and its
  label starts there like the others (the
  fixer's round: a label ending at a node at x 1768 ran into the launch
  call's label beside it). The classes are `dkc-way-*` (`dkc-route` is
  L7's).
  Launch call keeps "About 45 minutes" and its line, as now.
- **Motion (arrival).** The lit line draws from the first stop to today
  (`stroke-dashoffset`, the one path drawing on this stop), its length
  timed `min(1000, 400 + 160 x k)` ms for today at index k, on
  `--dk-ease-move`. The token (22.3.3) rides the head of the line; each
  passed stop's check draws as the line reaches it (its delay is its share
  of the length), and today fills as the token arrives, then "Today" fades
  in (`--dk-t-swap`). Then nothing moves.
- **The foot line** ("Each call is booked at the end of the one before.")
  120 px under the labels' last line.
- **Reduced motion / still:** the route drawn and lit, at once.
- **RTL:** the SVG mirrored (`scaleX(-1)`), labels with logical properties.

#### 22.2.6 O6 · This week: the board

*Score round 2 (22.13): the video guide sits on the card's head line before its status (on three cards to a row, the play mark and the length only); cards are at least 224 px; the homework rows are 88 px.*


```text
+--------------------------------------------------------------------------------------------+
| What we need from you this week (H2)                                                       |
| Now, on this call (500 24 ink-2, y about 232)                                              |
| +- Meta access ------------------ [ Done ] -+  +- Mahara OS --------------------- [ To do ] -+ |
| | Your Page and ad account, shared through  |  | Sign in, then connect WhatsApp and Google   | |
| | one link. And a card on the ad account... |  | Calendar, so bookings land in your real ... | |
| | (v) Access    (v) Card                    |  | (v) Signed in   ( ) WhatsApp   ( ) Calendar | |
| |                    > Video guide · 1:34   |  |                       > Video guide · 3:51  | |
| +-------------------------------------------+  +---------------------------------------------+ |
| This week, from you (500 24 ink-2)                                                         |
| Your content     Before your Blueprint call: photos and videos ...       [ Not checked yet ] |
| Past enquiries   Have a list of old enquiries? Send it, and ...                   [ To do ] |
| The Academy      Courses for you and your team ...                                [ To do ] |
| Today (v) Launch service (2) Your access (3) Blueprint call                        06 / 07 |
+--------------------------------------------------------------------------------------------+
```

- **Two groups, two weights.** "Now, on this call": the setup done live, as
  two `--dk-panel` cards side by side (x 136 to 944 and 976 to 1784, about
  280 tall, 16 px radius, 32 px padding). "This week, from you": the
  homework, as three ruled rows on the ground (name 28/600, line 24/400
  ink-2, status at the row's end; 80 px rows). The old list gave all five
  the same weight.
- **A card.** Name (30/700 ink) with its status chip at the head's end (9.6's
  three statuses); the line (26/400 ink-2, two lines at most); the steps as
  a row of checks, each a 28 px ring (the lanes' marks) and its name 26/500
  (ink when done, ink-2 open). Clicking a step's ring flips it (the CSM, on
  the shared screen, as the chips flip today); it writes `prep.access` with
  its audit row. The chip is Done only when every step is.
- **The video guide (only when that slot is recorded).** On the Meta access
  card (`meta-access`) and the Mahara OS card (`whatsapp-calendar`; done
  with you only once `dwy_os_approved`), at the card's foot end: a 16 px
  play triangle and "Video guide · {length}" (Geist 500 24 ink-3; in Arabic
  the length in words), a canvas control: the CSM's click opens the player
  (21.3), exactly as V does. Not recorded: nothing there. This departs from
  21.2 for these two cards only (22.8): the guides are what the client uses
  for whatever is left open after the call, so the client should see that a
  guide exists.
- **Done with you.** The second card is "Your CRM"; a third card, "Your
  callers' phones", joins "Now, on this call" (three cards of 528 px), and
  the item 2 rule counts it. In three cards the line is 24 (Arabic 25/1.45),
  three lines at most, with 24 px under the row instead of 40 (the fixer's
  round: at 26 and two lines the Meta card's line was cut at "And a card on
  the a…" in both languages).
- **Motion.** A step's tick: the check draws (`--dk-t-tick`) and the ring's
  teal layer fades in. When a card's last step turns done, its chip's Done
  layer crossfades in (`--dk-t-swap`) and the card's 1 px edge layer turns
  teal (opacity). When both cards are Done, the foot checklist ticks item 2.
  Nothing else moves.
- **No lead on the canvas.** "Most of it we'll do together, right now."
  (`week.line`) moves to the notes: the group head "Now, on this call" says
  it a few pixels below, and the slide is the deck's tightest.
- **Fit.** The title y 112 to about 184; "Now, on this call" at y about
  232, the cards under it; the rows end by y 940 in English, with about
  70 px more room than the lead left. `deck-shots.mjs` shoots it in Arabic
  and done with you, where it is tallest, and fails a collision as usual.
- **Reduced motion / still:** set at once.

#### 22.2.7 O7 · What to expect, then the Blueprint

*Score round 2 (22.13): the strip moved to the end column, under "We test many ads, fast", and the red lines' ask and list to the start column under the approval line; tiles 0 (their own service) and 4 stay lit, and on arrival all six are lit, then four switch off in a scattered order; the starter phones are 800 tall beside a 640 px words column; the close is one block centred on the stop, and before the booking the calendar card is drawn at full size as an empty day.*


The band that outweighed the plant is now a stop of its own, and the deck
ends on the next call with the checklist closed.

```text
+--------------------------------------------------------------------------------------------+
| What to expect (H2)         Example ads  [ ][#][ ][ ][#][ ]   (6 tiles 112 x 140, y 112-252) |
|                                                                                            |
| Your first ads (H3)                         The first weeks are a test (H3)     (y 280)    |
| Starter ads go live first, from our ...     Your ads are there to bring in business, ...   |
| They go live only once you've approved ...  We test many ads, fast. Small style changes ... |
|                                             Your red lines stay fixed: tell us now ...     |
|                                             ! Never show prices                            |
|                                             ! ...  [ type a red line ]                     |
+--------------------------------------------------------------------------------------------+
```

- **Stop 1, "What to expect".** The stop's title reads "What to expect"
  (H2). Two columns from y 280: start (x 136 to 880) "Your first ads" (H3
  40/700), its variant (30/400 ink), the approval line (26/400 ink-2); end
  (x 960 to 1784) "The first weeks are a test" (H3 40/700), then the plant
  at sizes a shared screen keeps: the ads' job (30/600 ink), the volume
  line (26/400 ink-2), the ask (26/600 ink) right over the red lines
  (30/400 ink, each with its amber mark) and the live input. No band on
  this stop.
- **The strip of example ads (the stop's picture).** The plant's point,
  many ads tested and most switched off, is what L3's field draws, so the
  stop carries a small still of it: six tiles in one row, 112 x 140 (4:5),
  12 px apart, in the title band (y 112 to 252), their end edge at x 1784
  (x 1052 to 1784), over the end column they illustrate. Tile `i` (0 to 5)
  shows `tile/<theme[(s + i) mod 12]>-a` (22.4.4's order, `s` the
  client's theme). Tiles 1 and 4 are lit (the photo at full opacity under
  the 2 px teal inset edge); the other four are off (the photo at 0.3 over
  `--dk-panel`, the edge at full strength), as 22.4.4. No toggles, no
  format marks, no star. *22.12: the strip left the title band for a 3 x 2
  grid under the first column, up to 150 x 188, tiles 1 and 5 lit.* The tag "Example ads" (5.4, Mono 24 ink-2) sits
  at the strip's inline start, 24 px before its first tile, its baseline
  on the tiles' foot (y 252). It is a still picture: nothing in it moves
  on arrival or between stops.
- **Stop 2 (optional), "Your starter ads".** As 9.7's stop 2: real starter
  templates only (22.4.6 says why no example ad stands in for them).
- **Last stop, "Next: your Brand Blueprint call".** The title's place holds
  "Next: your Brand Blueprint call" at H1 (80/700 ink), the line ("45
  minutes with our creative director: your brand, your offer, your first ad
  scripts.") at 40/400 ink-2, measure 1200, then the booked date at 48/700
  teal once it reads back. Under a hairline, the checklist, large, in one
  row (22.2.0), labelled "Today", each item in its true state. When the
  booking reads back while the stop is up, the date fades in
  (`--dk-t-swap`) and item 3 ticks.
- **The close (arrival, one of the six sequences, 22.3.2).** The checklist
  the cover opened as three rings closes here: on arrival, each item that
  is done draws its check in the list's order (the check's
  `stroke-dashoffset` and the ring's teal layer, `--dk-t-tick`, then the
  name's ink layer, `--dk-t-swap`), `--dk-stagger` apart, all of it under
  500 ms; then nothing moves. An open item stays open, in place.
- **Video slot:** `testing` stays on the slide.
- **Motion.** Between stops, the stage swap (opacity, `--dk-t-stage`).
- **Reduced motion / still:** set at once.
- **The fit check of 9.7** now applies to stop 1 alone: three typed red
  lines and the input end at least 48 px above the content's foot (y 928),
  in both languages. When they would not, the strip's tiles step to 96 x
  120 (y 112 to 232, the columns from y 260); when even that does not fit,
  the strip is left out and the columns start at y 240, as before.
  `deck-shots.mjs` measures it, the Arabic full fixture with three red
  lines being the tallest case.

### 22.3 The motion system

Hallmark's motion reference and section 5.3, made one system for both
decks. 5.3's table stands where this does not change it.

#### 22.3.1 Tokens (on `.dk-root` in `present.css`)

| Token | Value | Use |
|---|---|---|
| `--dk-m` | `1` | The motion switch: every duration and delay below is written `calc(<token> * var(--dk-m))`. `0` under `?still=1` (`.dk-root[data-still]`) and under `prefers-reduced-motion: reduce`, so every state is set at once. One switch replaces 15.4's per-class lists. It reaches what a class rule cannot: an inline duration is written `` animationDuration: `calc(${AD_MS}ms * var(--dk-m))` `` (the roads' `AD_MS` and `REF_MS` in `launchExpect.tsx`); a Web Animations duration is `duration: ctx.still \|\| reduced ? 0 : ms` (the journey token); a staggered delay is `calc(var(--i) * var(<token>) * var(--dk-m))`, never a literal such as `calc(var(--i) * 400ms)` |
| `--dk-ease` | as now | Arrivals |
| `--dk-ease-in` | `cubic-bezier(0.7, 0, 0.84, 0)` | Exits, at 75% of their entrance |
| `--dk-ease-move` | `cubic-bezier(0.65, 0, 0.35, 1)` | Something travelling from one place to another: the token, the row band, the pie's piece |
| `--dk-t-tick` | `160ms` | A check drawing, a toggle's knob |
| `--dk-t-join` | `200ms` | A branch or a short line drawing to a node |
| `--dk-t-swap` | `= --dk-swap-ms` (240ms) | A fill, a label, a picture inside a screen |
| `--dk-t-move` | `300ms` | The row band, a leader moving to its row |
| `--dk-t-stage` | `420ms` | A stop's picture changing (5.3's stage swap) |
| `--dk-draw-ms` | as now (520ms) | A line drawing to the next step |
| `--dk-stagger` | `80ms` | Items a person reads in order (O7's closing checklist, the reminders) |
| `--dk-stagger-fast` | `32ms` | Many like things changing (the field switching off) |
| `--dk-stagger-max` | `480ms` | The cap on any sequence's total delay: `min(i x stagger, max)` |
| `--dk-t-trunk`, `--dk-t-branch` | `160ms` each (score round 2; were 140 and 100) | O3's trunk, then each branch in turn, about 1 s in all |
| `--dk-t-ring` | `240ms` (score round 2) | Each of O1's checklist rings drawing, one at a time |
| `--dk-rise` | `12px` | The one arrival distance (a call turn, O2's row, O3's promise) |

No bounce, no overshoot, no scale on a picture, no blur or shadow in motion.

#### 22.3.2 Rules

- **One press, one change, then stillness.** A stop's sequence ends within
  about one second of the press and nothing loops, pulses or drifts.
- **What arrives is drawn at once; what changes while you watch animates.**
  A slide opens on its data's current state (a done item is already done);
  only a change made while the slide is up (a tick, a booking reading back,
  a swap) animates. The exceptions are six arrival sequences that are the
  stop's point: O1's rings, O3's joins, O4's phone rising with the deck's
  first photograph, O5's light to today, O7's last stop closing the
  checklist, and the journey's step (22.3.3). Each ends under one second
  and is set at once under `--dk-m` 0 and `still=1`.
- **Composited: `transform` and `opacity`.** One paint-only exception:
  `stroke-dashoffset` on SVG strokes, never on a filled shape and never on
  more than one path per stop at a time. Where several strokes draw in
  order (O1's three rings, O3's trunk and branches), they are one compound
  path drawn once along its total length, so its parts draw one after
  another. Two named exceptions: a check (a stroke under 40 px) may draw
  beside the path that reaches it (O5's passed stops, O7's closing
  checklist), and L7 stop 3's two roads draw together, because their race
  is the point (20.4). A change of colour is a second layer fading in over the first, as the
  field already does (21.1). One named exception besides: a single line of
  text may change `color` as a transition at `--dk-t-swap`, and a hover may
  change `border-color` at `--dk-hover-canvas-ms`, because the repaint is a
  few glyphs or a hairline.
- **Pictures swap after `decode()`.** A picture that crossfades in a phone
  or tile is decoded first, so a large photo never stalls a frame mid-fade.
- **No `will-change` anywhere.** Chrome promotes a running opacity or
  transform animation or transition on its own. A `data-moving` switch
  would stay on under `--dk-m` 0, where a 0 s transition fires no
  `transitionend`, and setting it at a sequence's start costs a layer on
  its first frame.
- **Containment.** The field, the board and the checklist get `contain:
  layout style`. No paint containment: it clips to the padding box, and on
  O6's board it would clip the 3 px teal focus outline of the step rings
  and the "Video guide" control at the card's edges.
- **JavaScript-driven motion** (the token, the field's order) reads `still`
  from the deck context and sets the end state when it is true; CSS reads
  `--dk-m`. The shot script's still end state and the reduced-motion end
  state are the same frame.
- **60 fps while sharing.** At most about 50 composited layers animate at
  once (the field's 15 tiles, three layers each, is the largest); nothing
  animates at rest, so Zoom's encoder has nothing to chase between presses.

#### 22.3.3 What moves, slide by slide

| Where | The move | Tokens |
|---|---|---|
| Every slide | The crossfade, as now | `--dk-cut-ms` |
| O1 | The rings draw in order (one compound path), names with them, then the dotted joins | `--dk-t-ring` (240 ms) each since score round 2, `--dk-t-swap` |
| O2 stop 2 | The row of answers arrives as one | `--dk-t-swap`, `--dk-rise` |
| O3 stop 1 / stop 2 | The trunk, then each branch and role (one compound path) / the promise | 640 ms draw, `--dk-t-swap` / `--dk-t-swap`, `--dk-rise` |
| O4 | Arrival: the phone rises once, 160 ms after the cut, and its picture fades in after `decode()`. Then: a tick; the band to the leading row; the phone's picture after "Launch with this"; the checklist's item 1 | `--dk-t-swap`, `--dk-rise`, `--dk-t-tick`, `--dk-t-move`, `--dk-swap-ms` |
| O5 | The light to today, the token, the checks, today filling | `--dk-draw-ms` scaled, `--dk-ease-move` |
| O6 | A step's tick; a card's Done; the checklist's item 2 | `--dk-t-tick`, `--dk-t-swap` |
| O7 | The stage swap; on stop 1's arrival (score round 2), all six tiles lit, then four switch off in a scattered order (3, 1, 5, 2), each picture to 0.3 and its teal layer out; on the last stop's arrival, each done item's check in order; the date and item 3 when the booking reads back | `--dk-t-stage`, `--dk-stagger`, `--dk-t-tick`, `--dk-t-swap` |
| O5 (score round 2) | After the light reaches today, the example confirmation rises once | `--dk-t-swap`, `--dk-rise`, delayed by the route's draw |
| L2, the journey | **The step, lane to lane.** The enquiry's token, a 15 px teal disc (`r` 7.5) with a 3 px `--dk-space` ring, rides the head of the line as it draws to the next node and is absorbed as the node fills (the token's opacity out, the node's fill in, `--dk-t-tick`). How: at mount, 24 points are sampled at equal lengths, `path.getPointAtLength(i / 23 x path.getTotalLength())` for i 0 to 23 (equal parameter steps would run ahead of or behind the stroke's head). As built (the fixer's round), the token is a `circle` inside the lanes SVG itself, so the sampled points are already in its coordinates and it mirrors with the SVG in RTL; no overlay and no `width - x` are needed. The token's Web Animation and the line's `stroke-dashoffset` share one duration (`--dk-draw-ms`) and one easing (`--dk-ease-move`), so the head and the token stay together. The leader is a straight HTML line moved to the lit row by `translateY` (`--dk-t-move`); its path `d` no longer animates | |
| L3 stop 2 | **The tiles switch off one by one,** in a fixed scattered order (by tile index: 8, 3, 12, 17, 6, 1, 10, 16, 5, 13, 2, 11, 7, 15, 9), each its knob, its teal layer and its photo, `--dk-stagger-fast` apart: about 720 ms. The three lit stay still | `--dk-t-tick`, `--dk-t-swap` |
| L3 stop 5 | The next round's photos fade in, `--dk-stagger-fast` apart | `--dk-t-swap` |
| L7 stop 2 | **The pie pulls apart:** their outline draws solid (`--dk-t-swap`), the piece moves out 48 px along its bisector (`--dk-t-stage`, `--dk-ease-move`), its leader draws from the piece to the label as it lands (`--dk-t-join`), then the title's second line | |
| L7 stop 3 | The roads draw, as 20.4 | |
| L4 | The swap (10.2), now after `decode()` | `--dk-swap-ms` |

Counters never: no number counts up anywhere.

#### 22.3.4 What the audit removes

- `.dkc-leader { transition: d … }`: a path morph, repainted every frame.
  Replaced by the moved straight leader above.
- Every transition of a paint property in `present.css` (line numbers as
  of b472bed7), each becoming a second layer fading in over the base unless
  22.3.2's text-colour exception covers it:
  - `background-color`: 1169, 1258 (`.dkc-tick::before`, O4's tick
    itself), 4109, 4193 (`.dkc-qlist li`), 4662 to 4664 (`.dkc-rem-mark
    i`, with its `border-color`);
  - `box-shadow`: 3172;
  - `stroke` and `fill`: 4119 (`.dkf-round-tile rect`), 5015
    (`.dkc-route-close`), 5024 (`.dkc-route-end`);
  - `color`: 654 (`.dkc-status`), 1882 (`.dkc-row-name`), 2556
    (`.dkc-col-head`), 4383 (`.dkc-stages li`), 5107 (`.dkc-route-node
    span`): each is a single line of text, so each may stay a `color`
    transition, at `--dk-t-swap` under `--dk-m` (it ran 300 ms or 200 ms);
  - `bottom 0ms` inside the transition list at 4415 (`.dkc-call-record`):
    removed (a layout property, and a 0 ms one does nothing).
- The reminders' delay at 4663 and 4664 (`calc(var(--i) * 400ms)`, five
  items, 1.6 s) breaks `--dk-stagger-max`: it becomes `min(var(--i) *
  var(--dk-stagger), var(--dk-stagger-max))` under `--dk-m`.
- Inline and scripted durations (22.3.1's `--dk-m` row): `launchExpect.tsx`
  lines 295 and 301, and the journey token.
- **The gate.** The copy test fails on any `\d+ms` literal in
  `present.css` outside the token block at the top of `.dk-root`, and on
  any inline style in `src/present/**/*.tsx` that writes a duration or
  delay in `ms` without `var(--dk-m)` in the same expression.
- 15.4's two per-class lists (`@media (prefers-reduced-motion)` and
  `[data-still]`): replaced by `--dk-m`. The shot script's `--still` default
  becomes `yes` for both decks, since the onboarding deck now moves.

### 22.4 Example ads (Higgsfield)

#### 22.4.1 The pictures

Twelve scenes from Mahara's own Higgsfield run (GPT Image 2.5, 2026-10-20),
each drawn twice (3:4 and 9:16): professional architectural or interior
photography of Gulf projects, with no people, no text, no logos and no
signage. They are no client's work, and every place they show says
"Example ad".

| Theme | The scene (its `alt`: `CONTENT.md`, "The visual pass") |
|---|---|
| `kitchen` | A finished kitchen with an oak and quartz island |
| `living` | A new villa living room |
| `majlis` | A contemporary majlis with carved wood and brass lanterns |
| `villa` | A new two-storey villa at golden hour |
| `construction` | A villa's concrete frame on a tidy site |
| `bathroom` | A marble bathroom with a stone bathtub |
| `pool` | A villa pool at dusk |
| `landscape` | A landscaped villa garden with a pergola |
| `bedroom` | A calm master bedroom |
| `office` | A fitted-out office with a glass meeting room |
| `facade` | A renovated villa facade in stone |
| `stairs` | An entrance hall with a floating marble staircase |

Checked against the contact sheet: every scene reads at feed size, none
carries text, a person or a mark, and the twelve cover the services in the
fixtures and the roster's families. No gap was found worth new credits.

**Files** in `apps/client-success-cockpit/src/present/assets/examples/`:

| File | Size | Made from | Budget |
|---|---|---|---|
| `<theme>-feed.webp` | 1080 x 1350 | the 3:4 picture, centre-cropped to 4:5 | 120 to 220 KB |
| `<theme>-story.webp` | 1080 x 1920 | the 9:16 picture, centre-cropped to exactly 9:16 | 120 to 220 KB |
| `tile/<theme>-a.webp` | 216 x 270 | the feed file, whole | at most 24 KB |
| `tile/<theme>-b.webp` | 216 x 270 | a detail of the feed file: its `TILE_B_FOCUS` box, about 2.2x | at most 24 KB |

**The detail tiles.** A `-b` tile cut from the story render was the same
scene drawn again, so L3's field showed six scenes twice and read as one
generated batch with duplicates. Each `-b` tile is instead a close detail of
its feed picture, so the field mixes wide shots and details, at different
angles, with no frame repeated and no new credits. The boxes, chosen by eye
from a gridded contact sheet of the twelve feed pictures (2026-10-20), are
`(x, y, w)` fractions of the 4:5 feed crop; each box is 4:5 too, so its
height is `w` of the crop's height:

| Theme | `(x, y, w)` | The detail |
|---|---|---|
| `kitchen` | 0.40, 0.02, 0.45 | the glass and brass pendants, the window's palms |
| `living` | 0.22, 0.48, 0.45 | the stone coffee table, its bowl and vase |
| `majlis` | 0.30, 0.00, 0.45 | the brass lantern and the carved ceiling |
| `villa` | 0.22, 0.28, 0.45 | the lit glass entrance and the tall timber door |
| `construction` | 0.18, 0.55, 0.45 | the rebar and block pallets in the foreground |
| `bathroom` | 0.00, 0.42, 0.45 | the brass tub filler and the tub's rim |
| `pool` | 0.55, 0.06, 0.45 | the lit terrace, its lounge and windows |
| `landscape` | 0.55, 0.12, 0.45 | the pergola and its seating |
| `bedroom` | 0.42, 0.36, 0.45 | the bedside lamp, the pillows and the bench |
| `office` | 0.02, 0.30, 0.45 | the meeting room through its glass |
| `facade` | 0.25, 0.36, 0.45 | the timber front door and the steps |
| `stairs` | 0.35, 0.00, 0.45 | the chandelier's glass drops |

**The build.** `apps/client-success-cockpit/scripts/build-examples.py
<originals dir> <scratch dir>`, run once by the builder with `/usr/bin/
python3` and Pillow (11.3.0 with libwebp 1.5.0 on this Mac, checked
2026-10-20; it is not a repository dependency, and nothing else here
encodes WebP: no cwebp, ImageMagick, ffmpeg, vips or sharp). It holds
`TILE_B_FOCUS` (the table above; only the build crops, so the runtime
never needs it). It opens each original by its bytes, not its name (the
`.jpg` originals are PNG data: feed 1744 x 2336, story 1520 x 2688), crops
the feed to 4:5 at its centre (1744 x 2180) and the story to exactly 9:16
at its centre (1512 x 2688), resizes with Lanczos, and saves WebP with
`method=6`. Quality is chosen per file: the highest of 82, 78, 74, 70, 66
and 62 that lands at or under 220 KB (tiles: the highest at or under
24 KB, from 72). Fine textures run large: the `landscape` story measured
329 KB at 62, so a file over budget at 62 keeps 62 and may reach 340 KB.
The build prints each file's quality and size, and writes a 24-tile
contact sheet (the twelve `-a` over the twelve `-b`) to the scratch dir
for a person to check before the files are committed. The copy test pins
the 48 names and their pixel sizes and fails any file over 340 KB (tiles
over 24 KB). The originals stay out of the repository.

**Loading.** `examples.ts` maps theme to URL with
`import.meta.glob("./assets/examples/**/*.webp", { eager: true, query:
"?url", import: "default" })`: the bundle gains a table of URLs, no bytes,
so the deck's first paint does not grow. The chosen theme's feed and story
are fetched and decoded after the first paint when the client has no
creatives; the 24 tiles when the launch deck opens (about 250 KB). The idle
call is guarded, since Safari lacks it in some versions and an unguarded
call throws: `const idle = window.requestIdleCallback ?? ((cb: () => void)
=> window.setTimeout(cb, 200));`, then `idle(load, { timeout: 2000 })`, and
each picture's `decode()` before its first use. `vite build`'s entry chunk may grow by the URL
table only (the shots run checks it within 2 KB).

#### 22.4.2 Which example: the service map

The deck picks one theme per client, from the first source that matches,
in this order: `prep.example_theme` (the CSM's switch, 22.4.5);
`prep.service_focus` and `service_focus_ar`; the kickoff's advertised
service; the form's #1 service; the form's services in order; the client's
name. Within one text, the families are tried in the table's order and the
first that matches wins. No match anywhere: `living`.

**One rule before the families.** A fit-out word (fit-out, fitout, fit
out, تشطيب, تشطيبات) or an interior word (interior, interiors, decor,
تصميم داخلي, ديكور; the fixer's round) together with a home word (villa,
home, house, residential, apartment, فيلا, فلل, بيت, منزل, شقه, شقق, سكني)
in the same text maps to `living`: a fit-out or the interior of a home is
an interior, and the villa theme is the house from outside. A fit-out word
alone, or with a commercial word, falls to the families and lands on
`office`.

Matching: lower case; Arabic with its diacritics and tatweel removed and
أ إ آ read as ا, ة as ه, ى as ي; an English word matches at a word's start
(so "kitchens" and "fit-outs" match); an Arabic word matches at a word's
start after its usual prefixes (و، ب، ف، ك، ل، ال، لل، وال، بال، فال، كال),
so مطابخنا and بالمطابخ match and a keyword inside another word does not. The table is `EXAMPLE_KEYWORDS` in
`examples.ts`, and its unit test runs every fixture's services and the
cases below.

| # | Theme | English | Arabic (normalised) |
|---|---|---|---|
| 1 | `kitchen` | kitchen, cabinet | مطبخ، مطابخ |
| 2 | `pool` | pool, swimming | مسبح، مسابح، حوض سباحه، سباحه |
| 3 | `bathroom` | bathroom, bath, washroom, toilet, wet area | حمام، حمامات، دوره مياه، دورات مياه |
| 4 | `landscape` | landscape, landscaping, garden, outdoor, hardscape, softscape, pergola | حديقه، حدائق، لاندسكيب، تنسيق حدائق |
| 5 | `majlis` | majlis, diwan, diwaniya, diwaniyah | مجلس، مجالس، ديوانيه |
| 6 | `bedroom` | bedroom, master suite, wardrobe | غرفه نوم، غرف نوم، غرف النوم |
| 7 | `stairs` | stair, staircase, entrance, lobby, foyer, marble, flooring | درج، سلالم، مدخل، مداخل، رخام، ارضيات |
| 8 | `villa` | villa, residential, palace | فيلا، فلل، قصر، قصور، سكني |
| 9 | `office` | office, commercial, retail, shop, showroom, restaurant, cafe, clinic, fit-out, fitout, fit out | مكتب، مكاتب، تجاري، محل، محلات، مطعم، مطاعم، كافيه، عياده، تشطيب، تشطيبات |
| 10 | `facade` | facade, façade, exterior, cladding, renovation, refurbishment, restoration, architecture, architectural | واجهه، واجهات، ترميم، تجديد، معماري |
| 11 | `construction` | construction, contracting, build, building, structure, structural, engineering, concrete | مقاولات، بناء، انشاء، انشاءات، عظم، هندسي، هندسيه، خرسان |
| 12 | `living` | interior, design, decor, furniture, furnishing, living, lighting | تصميم داخلي، ديكور، اثاث، تصميم، صاله، معيشه |

Pinned cases: "Kitchens" → kitchen; "Full villa fit-out" → living (the
rule before the families); "Office fit-out" → office; "تشطيب فلل" → living;
"Fit-Out & Renovation" → office; "Interior design" → living; "مطابخ" →
kitchen; "ترميم الواجهات" → facade; "مقاولات عامة" → construction; nothing
→ living. Added by the fixer's round: "حمام سباحة" and "حمامات السباحة" →
pool (the pool comes before the bathroom, since حمام سباحة is the usual Gulf
word for a pool and would otherwise match حمام); "Villa interior design",
"Luxury villa interiors" and "تصميم داخلي للفلل" → living; "Bathrooms" →
bathroom; "Swimming pools" → pool; "Majlis design" → majlis. مقاولات is a keyword for matching the client's own service text
only; the decks never call the client مقاول (13.5).

#### 22.4.3 Where it shows

Only while the client has **no creative at all** (no ready upload and no
Meta ad with a still). The moment one exists, the deck shows theirs, as
before. Examples never fill a phone beside a real creative of the client's.

| Place | What shows | Label |
|---|---|---|
| L2 journey stop 1 | The Instagram feed phone with the theme's feed picture | The picture's tag reads "Example ad" (it read "Preview") |
| L4 your ads | Feed: the feed picture; Reels and Stories: the story picture; Facebook feed: the feed picture: one ad in its three placements | The title's tag reads "Example ads" (it read "Preview"); the phones carry none; the foot drops "Previews."; the line under the owner chip is `ads.lineExample`, "Where your ads will show on your customers' phones.", never `ads.lineEmpty` ("How your ads will look…"), which would call the example their look. `lineEmpty` stays for the starter case (starter templates in the phones, no creative of their own) |
| L4's tray, on the canvas | One 120 px thumbnail of the feed picture with the short tag "Example" where a "Template" chip sits, and `ads.empty` unchanged ("We're finishing your first ads"): the title's tag and the chip already say what the phones show | as said |
| L5 your form, the intro screen (and any intro the journey shows) | The cover over the form's intro is the example's feed picture whenever the phones show the example, as Meta heads an instant form with the ad's own picture, so the line from ad to form holds. A creative of theirs on the phones covers it as now | `example.short` ("Example") as a chip on the cover's end corner; the form keeps its own tag ("Your form" or "Example form"), because the questions are theirs |
| L3's field | Every tile, for every client (22.4.4) | The field's tag reads "Example ads" (it read "Illustration"), or "Example ads, and your pick" when their pick is on tile 14 |
| O4's product column | The feed phone, 600 px tall, with the theme's feed picture | "Example ad" over the phone's end corner, baseline y 316 (22.2.4) |
| O7 stop 1 | The strip of six example tiles (22.2.7) | "Example ads" at the strip's inline start |
| Prep, the ads panel and the whole deck | The theme's feed picture at 96 x 120 beside the switch | cockpit UI |

**The phone's words around an example.** Page name and avatar as 7.1. The
caption's primary text is the client's own words only: `prep.selling_point`
(its `_ar` twin in the Arabic deck), else the chosen service as they wrote
it (sentence case, the score round 2 rule), else none (the caption shows
the Page name alone). The call to action is "Learn more"; the Facebook
headline is the service. Nothing is written for them.

**Reels chrome over a photograph.** The story renders are bright in their
top fifth (ceilings and sky: kitchen, living, bathroom, bedroom, stairs,
office), where the Reels phone draws its white status bar and, down the
side, its white icons. `.dkc-reel-top` gains `padding-bottom: calc(var(--u)
* 48); background: linear-gradient(to bottom, var(--app-scrim),
transparent);`, mirroring the foot's existing scrim, and `.dkc-reel-rail
svg` gains `filter: drop-shadow(0 0 calc(var(--u) * 3) var(--app-scrim))`.
Both reuse the app scope's `--app-scrim`, so no colour is added.
`deck-shots.mjs` shoots L4 with the `kitchen` and `stairs` themes to check
it.

**A creative arrives while an example shows** (an import or an upload
during the call): the phones keep the example until the CSM places a
creative or the slide is entered again; then the client's own fill them.
While some phones show an example and some a creative, the title's tag
reads "Preview", each example phone carries "Example ad" above its end
corner, and the line is `ads.line`.

#### 22.4.4 The field of example ads (L3)

The field keeps its geometry, its edges, its toggles and its marks (21.1)
and gains a photograph in every tile, under the tile's 2 px inset edge,
`object-fit: cover`, with a 12 px radius.

- **Which picture.** With the client's theme at index `s` in the order of
  22.4.1's table: tile `i` (0 to 17) shows `tile/<theme[(s + i) mod 12]>-a`
  for `i < 12` and `-b` for the rest. The next round's tile `j` (0 to 5)
  shows `tile/<theme[(s + 6 + j) mod 12]>-b`. So their own theme is on tile
  0 (lit), and no picture shows twice. Tiles 12 to 17 show the same twelve
  scenes as tiles 0 to 5 only as details (22.4.1's `-b` tiles: a lantern, a
  tap, a door), so no frame repeats and the field reads as different
  angles, not as one batch drawn twice.
- **Lit and off.** Lit: the photo at full opacity under the teal edge. Off:
  the photo's layer at 0.3 opacity over `--dk-panel` (the edge stays at
  full strength, as 21.1). Their pick, when marked, replaces tile 14's
  example (row 3, column 3, lit), with the star, as now.
- **The tag says whose.** "Example ads" (`test.field.tag`), or, when their
  pick is on tile 14, "Example ads, and your pick" (`test.field.tag.pick`):
  the field then holds one real ad of theirs, and the tag never calls it an
  example. The copy test pins both.
- **The marks over a photograph.** The format glyph and the toggle were
  drawn for an empty navy tile; over a lit photo (beige walls, white
  marble) the glyph disappears and the off-track grey switch loses its
  edge, and the glyph is what shows that the format varies. On a photo
  tile the glyph sits in a disc like the pick star's (18 px glyph, 5 px
  padding, radius 999px, background `var(--dk-deep)`, colour
  `var(--dk-ink)`), and every photo tile's `.dkf-switch` takes the 3 px
  ring pick tiles already carry (`box-shadow: 0 0 0 3px var(--dk-deep)`).
  Both are existing tokens and rules, reused.
- **The next round:** dotted and empty at stop 3; at stop 4 the client's
  style change tile is solid ink and still empty; at stop 5 all six take
  their photos (the round is made), the client's keeping its ink edge.
- **Why examples now.** 21.1 left the tiles empty so that no real ad of the
  client's would be dimmed. These are not theirs, they are tagged, and they
  make the stop's point visible: many different ads, most switched off. The
  rule that the client's own creatives never sit on a dimmed tile stands.

#### 22.4.5 The switch in prep

A new prep key, `example_theme` (one of the twelve, or absent for "match the
service"), saved on the onboarding deck's prep row beside `service_focus`
and read by both decks (`prepOf("onboarding")`); the launch prep writes it
there too (`saveTo("onboarding", …)`). The server learns the key in
`20261020160100_csm_deck_prep_dos_ar.sql` (`DRIVE-IMPORT.md` 9).

In prep, wherever an example shows (the ads panel and "The whole deck" in
both decks): the picture at 96 x 120, "Example ad: Kitchen, from
"Kitchens"" (or "chosen here"), and a native `<select>` with text options:
"Match their service" first, then the twelve theme names (`CONTENT.md`).
The 96 x 120 picture beside it changes on change, and it is the preview: a
native select cannot show pictures in its options outside Chrome's newest
customizable select, and a custom combobox with all its states is not
worth one prep control. It saves on change; the deck and the notes window
read it again through the hub.

#### 22.4.6 Where examples do not go

- **The covers.** An example behind "{Client} goes live" or "Welcome,
  {Client}" would present imagery as their brand: 8.1's rule for starters
  holds for examples. *Overturned by 22.12 (the fixer's round, 2026-10-21):
  the CEO asked, word for word, for "an example ad instead of just having
  the logo", and the cover is the screen he judges first. O1 now shows the
  example in a Reels phone, and L1 shows it in the feed phone while the
  client has no creative at all, both tagged "Example ad", in a phone,
  never behind the title.*
- **O7's starter stop.** It is labelled "Starter, from our templates" and
  describes what goes live; a generated picture there would misstate it.
  (O7's first stop carries the small strip of example tiles, tagged, over
  "The first weeks are a test", 22.2.7: it pictures the testing, not what
  goes live.)
- **L10's project pictures** (under "Keep your Drive folder fed"): they
  stand for the client's own projects. Without three creatives they stay
  out, as now.
- **The partnership roads.** They are a diagram of two paths; a photograph
  would turn the length into scenery.

### 22.5 Placeholder states

#### 22.5.1 No logo: the monogram, refined

- **Deck surfaces** (covers, O3's group, the call's card): a
  rounded-square tile, side S, radius 0.22 S, `--dk-panel-2` ground with a
  1 px inset `--dk-line-strong` edge; **one letter**, the first letter of
  the first word that is not generic (7.7's list), upper case, Geist 700 at
  0.5 S, -0.02em, optically centred (2% below the box's centre); Arabic in
  Plex 700 at 0.46 S. Never teal, never a ring, never two letters.
- **Inside app chrome** (avatars): the same letter in a circle on the app's
  own avatar ground (`ig`: #262626, `fb`: #3a3b3c, `wa`: #202c33, all 3.3
  scopes), Geist 600 at 0.46 of the diameter, because a profile picture is
  a circle in those apps.
- **Why.** A circle with initials on panel-2 reads as a missing avatar; a
  tile reads as a mark, the way an app icon does.

#### 22.5.2 Every empty slot, designed

| Slot | On the canvas | In prep (cockpit UI) |
|---|---|---|
| Creatives | The example ad (22.4.3) | "No ads yet, so the phones show an example ad ({Theme}). Paste a Drive link or add files here to show theirs." with the example's picture, its switch, the Drive box and "Add a file" |
| Logo | The monogram tile (22.5.1) | "No logo. Upload one, or the deck shows their first letter." |
| Goals | O2's question and its input, set as the 80 px line | "No goals in their onboarding form yet. The slide asks the question, and you type their answer on the call." |
| Services | O4: one empty row, "+ Add a service"; the column's name "We'll pick it together", the default example | as 12.3 |
| Video slot, empty | nothing (21.2) | the poster card "Not recorded yet" (22.5.3) |
| Video slot, recorded | O6's "Video guide" mark only (22.2.6) | the poster card with the video's own poster (22.5.3) |
| The canvas tray, empty | the empty line only (score round 2: the example the phones show, filed as a tile under "Your creatives", repeated the phones; the title's tag names it) | the Drive box first (22.7) |
| Do's & Don'ts in the Arabic deck | translated lines in their groups; untranslated card lines under "On your card, in English" (22.6.2) | one Arabic field per card line (22.6.2) |

#### 22.5.3 Video posters (prep and the notes window only)

*Score round 2 (22.13): a recorded slot with no picture yet is one 64 px row (the provider and the length over the title, a 32 px play button), not a 16:9 card; every picture sits under a 35% veil of the panel's ground; in the notes window the picture carries no words (the title is over it and the length on the line under it).*


A 16:9 card, 352 x 198 in prep's Videos section (21.5) and 240 x 135 in the
notes window's Video block (21.4), cockpit UI tokens, 8 px radius, 1 px
border.

- **Not recorded:** the muted ground, the slot's title (13/600, two lines at
  most) and "Not recorded yet" (12, muted) under it. No play glyph, so it
  never reads as a video that is there. *22.12: one quiet line, "Not
  recorded yet", under the slot's own title row, with no card: three blank
  16:9 boxes in a column read as an unfinished page.*
- **Recorded, with its poster (`posterUrl`).** Every recorded slot whose
  row carries `posterUrl` (`VIDEOS.md` 9: the worker fills it once from the
  provider's oEmbed; the migration fills the six seeds, three Loom and
  three Wistia) shows that picture, `object-fit: cover`, under a bottom
  scrim with the title and the length over it, and a 24 px play triangle.
  It is an image request only; the CSP sets no `img-src`.
- **Recorded, no `posterUrl` yet:** YouTube from
  `https://i.ytimg.com/vi/{id}/hqdefault.jpg`; Drive from
  `https://drive.google.com/thumbnail?id={id}&sz=w640`, which only answers
  for a file shared with anyone who has the link; Wistia's public swatch
  (`https://fast.wistia.com/embed/medias/{id}/swatch`, 100 x 56) as the
  card's ground, scaled and blurred 12 px under a 55% scrim. On an image
  error, and for Loom and Vimeo, the designed card.
- **The designed card:** the muted ground, the provider's name and the
  length in small type, the title, the play triangle.
- **Why the worker asks oEmbed, not the page.** Loom's and Wistia's oEmbed
  answer without a key (checked 2026-10-20), but the cockpit's
  `connect-src` allows only the app and Supabase, and widening it for three
  providers is a larger change than one column the worker fills.

### 22.6 The launch fixes (the last score round, all at 3)

#### 22.6.1 Journey stop 6: the statement tied to the fork

The words leave the stage's top on this stop only: the owner chip and the
statement ("You hold the meeting: …") sit directly above the fork, their
last line's baseline 40 px above the first end's name, both aligned to the
fork's inline-start edge (x 1028). The fork stays where 21.13 put it
(level with "You meet"). In Arabic a three-line statement starts no higher
than y 284. The swap from stop 5 is the stage swap, so the words arrive in
their new place with no visible jump. `deck-shots.mjs` fails a stop 6 shot
whose statement and fork are more than 64 px apart.

#### 22.6.2 Creative freedom stop 3: "Your input comes first"

- **Order of the column:** the stop's name (H3), the input line (30/400 ink,
  the stop's primary: "Ideas, a new offer, a new price, something to
  change? …"), the offer line (24/400 ink-2), then the red lines. The input
  now comes first in fact as well as in the name.
- **The panel, lighter.** Its head ("Fixed: your red lines") and its foot
  ("We never cross these.") leave the canvas: the slide's title already says
  "Your red lines are fixed". The panel keeps `--dk-panel` and its 1 px
  `--dk-leak-line` hairline. Inside: the two group heads, "Never" and
  "Always" (Geist 600 24 ink-2; Arabic «أبداً» and «دايماً», score round
  4), and the lines at 26/400 ink with their amber marks. With three or fewer "Always" lines and room in 816 px, the
  two groups sit side by side (Never 480 px, Always the rest); else
  stacked.
- **"Never" once.** A line under a head drops a leading word that repeats
  it: under "Never", English "Never", "Don't", "Do not" and "No"; under
  "Always", "Always" and "Do"; in Arabic, a leading «أبد» or «أبداً»
  under «أبد», and «دايماً» or «دائماً» under «دايماً» (a line's own «ما»
  or «لا» stays: «أبد» over «ما نعرض الأسعار» reads as one sentence, the
  way the heads were written, 21.13). The first remaining letter is
  upper-cased in English. A line that would be left with fewer than two
  words keeps its lead. So "Never show prices in an ad" reads "Show prices
  in an ad" under "Never".
- **"You told us" once.** The per-line tags go. Under the panel, one source
  line (24/400 ink-2): "From your card, and what you told us on the
  onboarding call." (or "From your card." or "What you told us on the
  onboarding call.", whichever is true).
- **The 110 px jump.** The field takes its stop 3 to 5 position (y 252)
  from stop 1, and the next round's band is reserved on stops 1 and 2: its
  six dashed slots are there from stop 1 at 35% with no label (score round
  4: an empty 260 px band stood above the rail), and stop 3 brings in "Next
  round" and full strength; the words column starts at y 232 on every stop. Nothing on the slide
  moves between stops but what the stop changes. (The fixer's round
  centred stops 1 and 2 in the room; the room under them is now where the
  next round arrives, which is where the eye already expects it.)
- **Arabic, the card's lines (`dos_donts_ar`).** A new launch prep key: a
  map from each card line, exactly as parsed (DO and DON'T items, the text
  after its tag), to its Arabic, typed by the CSM. The Arabic deck shows a
  translated line in its own group (Never or Always), in Arabic, like any
  other; an untranslated card line in the other script goes under the third
  head, now named "On your card, in English" (Arabic deck) or "On your
  card, in Arabic" (English deck), quoted as written. A key whose card line
  is gone is ignored and pruned on the next save. In prep's slide 3 panel,
  under each card line: a field labelled "In Arabic" (`dir=rtl`, Plex),
  saved on change (debounced 600 ms), with the hint "Write it without أبد
  or دايماً; the heading says it." The panel's prep line reads "{n}
  card lines have no Arabic yet. Type each one so the Arabic deck keeps it
  under Never or Always." The server learns the key in
  `20261020160100_csm_deck_prep_dos_ar.sql` (`DRIVE-IMPORT.md` 9).

#### 22.6.3 The portal: one stage, edges that stay

*Score round 2 (22.13): stop 2 shows the calls screen in two pieces in one frame, 960 px wide on the same top and end edges: the recorded call's row with its player, then the next call's row under the screen's own rule; the demo summary between them (it names a budget) is cut out.*


All four stops share one stage box, x 680 to 1784 and y 244 to 948 (1104 x
704), and every figure is fitted inside it, anchored to the box's top and
end edges (in Arabic, top and left). The tag "Demo workspace" sits above
the box's end corner at one place on every stop (baseline y 214). So the
top edge and the end edge, and the tag, never move; only a figure's own
size changes, by the stage swap. Sizes: the overview at the box's width
(about 590 tall), the recorded call at 880 wide, the phone at the box's
height (704 tall, from 840: the price of a fixed stage, accepted because
the phone's words are read in the notes, not on the screen). Stop 4 has no
figure and keeps its own layout.

As built (the fixer's round): each stop's figure sits in a `StageSwap`
layer, absolutely placed at the box's top and end; the tag is the figure's
`figcaption`, absolutely placed 8 px above it, so the tag can never push
the figure down (a 12 px move the shots' edge gate caught). The phone stop
plays the portal's own recording (`mahara-mobile-{lang}.mp4`, 1080 x 1920)
inside the phone, muted, once, from the sign-in to the app's last screen
(13.2 to 50.2 s in English, 13.7 to 49.8 s in Arabic): the file opens on a
title card and the install steps in Safari, whose menus are in Arabic in
the English file, with a phone inside the phone. A file of any other size
is not shown and the still stays. `deck-shots.mjs` measures the figure's
top and end edges on every stop (the `portalEdges` gate) and shoots the
film at three times (`--film`).

#### 22.6.4 The pie: their piece labelled as fully as ours

The two labels share one anatomy: the owner (Geist 500 24, "Our team" in
teal, "You" in ink) over the names, one per line, at 600 30 ink. Theirs
becomes two names, "The meeting" and "The close", so it is a stack like
ours, not one line. Their label is centred on the pulled piece's centre
height, its start at x 136, its leader running level into the piece and
ending in a 6 px ink dot; both leaders end the same distance inside their
pieces (24 px). Their piece, once lit, keeps its 3 px ink edge. Done with
you is unchanged (its halves carry two names each already).

#### 22.6.5 Training: the lesson crop keeps the player whole

Stop 2's crop is cut only across: at the top under the top bar, and at the
foot in the video's dark ground. The player's whole width and 16 px of the
page around it are kept, so no edge of the player is cut. It is scaled to
the column's 704 px, whatever that gives (about 1.15x, from 1.3x). The
masks (the blurred slide in the player, the top bar off, the outline ending
on "04: Uncertainty Objections") stand. `pcm-lesson-masked.webp` is cut
again from the sales deck's file, which stays untouched, and the copy test
pins its new size. As built (the fixer's round): the crop is applied in the
page (`LESSON_CROP`, the box 0.03, 0.01 to 0.969, 0.975 of the masked
file), and the file itself was not cut again; recutting it is the lead's
call.

#### 22.6.6 Training, Arabic: no Latin mid-sentence

`training.when.line` in Arabic ends on «ويبدي بأول قسم فيه، أساسيات البيع.»
in place of «ويبدي بقسم Sales crash course.». The screenshot shows the
section's English name; the line says what it is in Arabic
(`CONTENT-AR.md`, "The visual pass").

### 22.7 The Drive link, in prep and the notes window

The backend and the worker are `DRIVE-IMPORT.md`. This is what the CSM
sees.

- **Where.** The first block of the ads panel (`AdsControls`), above "Add a
  file", in prep (slide 4, "Your ads") and in the notes window. Never on the
  canvas: the client's screen shows the tray only.
- **The box.** "Bring in from Drive" (the block's title), then the field,
  label above it: "Paste a Drive link". The hint under it, on a reserved
  line: "A folder, or one video or picture. The first files arrive in the
  tray in about a minute." The button "Bring in", the field's height
  (Hallmark's forms: one base height, the focus ring an outline, the helper
  line never collapsing).
- **Paste, and it goes.** The CSM's usual move is to copy a link, or a
  whole WhatsApp message with several, and paste. A paste whose text holds
  at least one link that parses is sent at once, with no click: the button
  shows "Checking…", then "Started" for 2 s, and the progress appears
  below. Up to ten Drive links in one paste, split on spaces and new lines
  (`splitDriveLinks`, `DRIVE-IMPORT.md` 8), each its own import. Each link
  refused, by the parser or the server, gets its own line under the field
  (the link cut in the middle, then its sentence, in the warning tone), and
  the field keeps only those links so they can be fixed. *22.12: when at
  least one link of the paste started, the field is cleared instead and
  each link left out is a muted note under the box ("Skipped {link}: {its
  sentence}"), never a red field beside "Started"; the warning tone stays
  for a paste or a submit where nothing went.* Over ten: the
  first ten go, and a line says to paste the rest once these finish. Typed
  text still uses the button, with the same splitting.
- **Checks before sending.** Each piece runs through `parseDriveLink` (the
  same rules as the server's, `DRIVE-IMPORT.md` 2) on input; typed text
  that holds no link the parser takes shows the sentence under the field
  at once (`aria-invalid`, `aria-describedby`) and the button stays off.
  The server is still the authority.
- **The button's eight states.** Default; hover; focus-visible; active;
  disabled (empty field, or nothing in it parses); "Checking…" while the
  requests are in flight; error (each sentence on its line under the
  field, the refused links kept); success ("Started", 2 s, the field
  cleared of what went, the progress below). An action keeps its verb:
  Bring in, Bringing in, Brought in.
- **Progress, under the box, newest first:** every open import and the
  three newest finished ones (of the last 14 days). With two or more open,
  a head line first: "Bringing in {n} links from Drive…". Then each
  import's line (`CONTENT.md`, "The visual pass", e.g. "Bringing in 6 files
  from Drive…"), then one row per file, its name cut in the middle with the
  whole name in the tooltip and its state on the right: "Waiting",
  "Bringing in", "In the tray", "Already in the tray", or the file's
  sentence in the warning tone; a converted file's note in the muted tone.
  A link in the row opens the Drive link in a new tab (the CSM's own
  screen).
- **Polling.** `readDriveImports` every 5 s while any import of this client
  is queued or working, paused while the window is hidden, stopped when
  none is open. A read error shows "Couldn't check the import: {reason}.
  Trying again." and backs off to 10, 20, then 60 s. When the sum of files
  in the tray goes up, the panel reads the tray again (`model.reload()`)
  and posts `{type: "ads"}` on the hub, so the deck window and the other
  window show the new thumbnails.
- **When nothing picks it up.** Queued for more than 3 minutes while the
  worker was last seen more than 3 minutes ago (`workerSeenAt`, which a
  long download keeps fresh): "Nothing has picked this up yet. The Drive
  importer last ran {time}. Upload the files here for now." (never run:
  "The Drive importer hasn't run yet. Upload the files here for now.").
  Missing is never shown as "0 files".
- **The deck during an import.** New thumbnails join the tray as they land;
  the phones keep what they show (22.4.3); the canvas shows no progress.

### 22.8 The critique, the slop test and the departures

**Against the plan.** The template answer for an onboarding deck is an
agenda slide, an icon grid of the team, a horizontal stepper and a "next
steps" list; the plan replaces the agenda with the call's own checklist,
which then does work, the team with a group that fills, the stepper with a
route in the lanes' marks, and the list with a board split by when. The
template answer for "show their ad before they have one" is a grey box with
"Your ad here"; the plan shows a real-looking ad in their name, labelled
"Example ad", for their service.

**Hallmark gates these could fail, and how they pass.**
- **Invented content (46):** example ads are labelled wherever they show,
  carry only the client's own words, and never reach a cover; no number
  counts.
- **Re-drawn chrome (47):** the phones are 7.1's, unchanged in spirit (the
  subject of these slides); no WhatsApp screen is drawn on O3.
- **Locked tokens (48):** no colour outside 3.1, 3.2 and the 3.3 app scopes
  (the avatar grounds); photography only inside a phone or a tile.
- **Motion (10, 12, 14, 27):** properties named, no overshoot, no layout
  properties, every move under `--dk-m`; `stroke-dashoffset` is the one
  paint-only property, on strokes only and one path a stop (departure 10).
- **Eight states (26, 39):** the Drive box and its button; O6's step rings
  and the video guide mark as canvas controls (hover: `--dk-edge`; focus:
  the 3 px teal outline; active; disabled when not clickable).
- **Structural variety:** 22.1's list; no two neighbours share a structure.

**Pre-emit, the pass:** `P5 H4 E4 S5 R4 V5`. Execution stays at 4 until the
shots' motion pass (22.9) runs clean and the motion is seen through a real
Zoom share at 1280 and 1366 wide.

**Departures from the lead's direction, with reasons.**
1. **O3 draws no WhatsApp chrome or messages.** "Living" is the group
   filling and the reply time on its own beat; 7.9's reason (WhatsApp
   never shows roles, and messages would be invented) stands.
2. **O1 drops the faint lanes** for the checklist, and the onboarding deck's
   signature is the call's checklist (not the cover alone): it ticks on
   O4 and O6 and closes on O7, from data.
3. **No example ad on the covers, O7's starter stop, L10 or the roads**
   (22.4.6).
4. **The field's tiles show examples for every client**, not only when the
   client has no creatives: the field never held the client's creatives
   (but their pick), so the examples change nothing about whose ad is
   dimmed. Its tag becomes "Example ads".
5. **O6 shows a "Video guide" mark on two cards** (recorded slots only),
   against 21.2's chrome-only control, because those guides serve what is
   left open after the call.
6. **Video posters come from oEmbed through the worker,** not the page
   (22.5.3, `VIDEOS.md` 9): the CSP is not widened, and every recorded
   video, the six Loom and Wistia seeds included, gets its real poster.
7. **The onboarding deck's time** is 22 minutes with the setup, inside the
   20 to 25 asked, and `TARGET_MINUTES.onboarding` follows.
8. **The Drive import has seven worker functions** where three were named
   (plan, a per-file reserve before the upload, a per-file failure, and a
   heartbeat), and a one-row worker state table (`DRIVE-IMPORT.md` 1 says
   why). It also converts a video over 150 MB, in HEVC, ProRes, AVI or
   Matroska, or larger than 1080 on its short side, instead of refusing it
   (`DRIVE-IMPORT.md` 7), and takes up to ten links in one paste (22.7).
9. **`example_theme` rides in the second migration** with `dos_donts_ar`,
   under the name the lead gave it, and with `service_chosen_at` (22.2.0).
10. **Line draws use `stroke-dashoffset`,** against the brief's
    transform/opacity rule, because a masked translate cannot follow the
    lanes' elbows (O5's route is straight now, but the journey's lanes and
    O3's branches are not). They are paint-only, with no layout, and the
    deck has drawn its lanes this way since 2026-10-19 (`present.css`
    1434, 1924, 5011).

### 22.9 For the build

- `content.ts`: the strings in `CONTENT.md` and `CONTENT-AR.md`, "The visual
  pass": `TODAY` (the checklist's label, long and short names), O2's input
  placeholder, O3's split promise, O4's column strings and "Chosen", O6's
  two group heads and "Video guide" (`week.line` moves to the notes), O7's
  two stop titles (the band split in two), `EXAMPLE` (the tags, the alt
  texts), `ads.lineExample`, `test.field.tag.pick`, L3's source lines and
  the renamed third head, L7's two names, L8's Arabic line, and the prep
  and Drive lines (`ads.empty` is unchanged).
- New files: `TodayList.tsx` (22.2.0); `examples.ts` (the map with the
  fit-out rule, the keyword table, the field's tile order, the guarded
  idle loader); `driveLink.ts` (`parseDriveLink`, `splitDriveLinks`, its
  cases shared with the SQL test as `driveLink.cases.json`);
  `useDriveImports.ts` (the hook, `DRIVE-IMPORT.md` 8);
  `scripts/build-examples.py` (22.4.1).
- `onboardingDeck.tsx`: O1 to O7 as 22.2, with the stops in the table;
  `decks.ts`: `TARGET_MINUTES.onboarding` 22; `deckData.ts`:
  `serviceChosen` only when `service_chosen_at` is set, and the proposal
  otherwise; `prep.ts`: `PREP_KEYS` gains `dos_donts_ar`, `example_theme`
  and `service_chosen_at`, and `RESTAMPS` (`DRIVE-IMPORT.md` 9);
  `controls.tsx`: the "Launch service" hint for a proposal (`CONTENT.md`,
  prep lines).
- `launchDeck.tsx` (the form's cover, 22.4.3), `JourneyLanes.tsx` (the
  token, 22.3.3), `AdsStage.tsx`, `mockups/Cards.tsx` (`AdField`, the
  marks over a photo), `mockups/Phones.tsx` (the example media and words,
  the Reels scrim), `mockups/Form.tsx` (the cover's "Example" chip),
  `mockups/Identity.tsx` (the monogram), `launchExpect.tsx` (the pie, the
  lesson crop, the roads' inline durations under `--dk-m`): 22.4 and 22.6.
- `present.css`: 22.3's tokens, `--dk-m` everywhere a duration or delay is
  written, the audit of 22.3.4, no `will-change`, `contain: layout style`,
  the new classes `dkc-today`, `dkc-board`, `dkc-route`, `dkc-hub`,
  `dkc-product`, `dkc-strip`; the Hallmark stamp at its top names O4 among
  the phone-frame exceptions.
- `launchControls.tsx` and `PrepView.tsx`: the example switch (a native
  select), the Drive box and its progress (22.7), the `dos_donts_ar`
  fields; `VideoPrep.tsx` and `VideoNotes.tsx`: the poster cards, reading
  `posterUrl` first (22.5.3).
- `sources.ts`: `requestDriveImport`, `readDriveImports` and their zod
  shapes (`DRIVE-IMPORT.md` 8); the video row's `posterUrl` (`VIDEOS.md`
  7); `deckData.ts`: the example's theme and words, the red lines' grouping
  with the leading-word rule and `dos_donts_ar`, the checklist's three
  states.
- Assets: the 48 WebP files of 22.4.1; `pcm-lesson-masked.webp` cut again.
- Tests:
  - the copy test: the new strings; "Example ad" beside every example; no
    example on a cover; `ads.lineEmpty` never rendered beside an example
    phone (`ads.lineExample` there); the field's tag "Example ads, and your
    pick" when the pick shows and "Example ads" otherwise; the 48 files'
    names, sizes and budgets; no "Sales crash course" inside an Arabic
    string on the canvas; the motion gate of 22.3.4 (no `\d+ms` literal
    outside the tokens, no inline `ms` without `--dk-m`);
  - `examples`: the keyword cases, the fit-out rule's pinned cases;
  - the engine: O4's and O6's ticks only on change; item 1 open when prep
    set `service_focus` before the call, done after "Launch with this",
    open again after Undo; O7's last stop drawing done items in order and
    set at once under still; the field order; `--dk-m` under still;
  - `driveLink`: the shared cases and `splitDriveLinks`;
  - the PGlite test (`DRIVE-IMPORT.md` 10, `VIDEOS.md` 9).
- `deck-shots.mjs`:
  - `--still yes` by default for both decks; every new stop in both
    languages, done for you and done with you; the sparse fixture shows the
    examples; the checklist in each state; O6 with both guides recorded;
    journey stop 6's 64 px check; the portal's fixed top and end edges (a
    shot fails when a figure's top or end edge differs between stops by
    more than 2 px);
  - new cases: the sparse fixture on L5's intro shows the example cover
    with its "Example" chip; L4 with the `kitchen` and `stairs` themes
    (the Reels scrim); O7 stop 1 in Arabic with three red lines (the strip's
    fit ladder); O4 with a proposal from prep (item 1 open, the button
    live);
  - **the motion pass** (no installs): for each stop, open it without
    `still=1`, press, then `await page.waitForFunction(() =>
    document.getAnimations().every(a => a.playState !== "running"), null,
    { timeout: 1200 })`, and fail with "still moving 1.2 s after the press".
    Then shoot, and compare in the page with the same stop's `still=1` shot
    (`createImageBitmap` and `getImageData`): fail when more than 0.1% of
    the pixels differ by more than 8 in any channel;
  - **the Zoom pass:** `--sizes 1280x720`, each shot re-encoded with `sips
    -s format jpeg -s formatOptions 40`, then read for O5's unlit route,
    the foot checklist's ink-3 items and the field's off tiles.

### 22.10 Change log: the spec review of the visual pass (2026-10-20)

The review's findings on this section and on `DRIVE-IMPORT.md`, numbered in
the order they came, each applied unless its row says how and why it
changed. The list reached this revision cut off inside its forty-fifth
finding; how that one was read is at its row. Three builders work from the
result in parallel (the migrations and their test, the VPS worker, the
deck), so every name, argument, return, code, path and file location below
is final.

| # | Finding | Applied in, and any change |
|---|---|---|
| 1 | "Composited" was claimed for `stroke-dashoffset` | 22.3.2 (transform and opacity; one paint-only exception, strokes only, one path a stop); 22.8 departure 10, reworded because O5's route is straight now (row 25). Added so the rule can hold: O1's rings and O3's tree draw as one compound path each (22.2.1, 22.2.3), and two exceptions are named, the checks beside a line and L7's two roads, whose race is the point |
| 2 | Item 1 ticked by a service typed in prep | 22.2.0, 22.2.4; `DRIVE-IMPORT.md` 9 (`service_chosen_at` in the stamp branch, `PREP_KEYS`, `RESTAMPS`); `CONTENT.md` checklist and prep lines. Merged with 21: one server stamp, written by "Launch with this", cleared by Undo |
| 3 | Real posters for recorded videos | `VIDEOS.md` 9; 22.5.3; `DRIVE-IMPORT.md` 7 step 8. Corrected: the seeds are six, three Loom and three Wistia (not four Loom); all six are backfilled with the posters each provider's oEmbed gave on 2026-10-20, each checked to answer 200 `image/jpeg`. Added: `poster_checked_at`, so a slot whose oEmbed fails is asked once a day, not every minute; a trigger that clears both when the link changes; Drive left out (it has no oEmbed, and the card builds its thumbnail) |
| 4 | The form's cover with no creative | 22.4.3 (the L5 row); 22.9 (the sparse L5 shot) |
| 5 | Paste and go; several links at once | 22.7; `DRIVE-IMPORT.md` 8 (`splitDriveLinks`, the paste handler), 4 (ten open imports a client, from three, so one paste goes in whole; the read returns 20, from 10); `CONTENT.md` and `CONTENT-AR.md` (the plural line, the over-ten line) |
| 6 | Convert phone videos instead of refusing them | `DRIVE-IMPORT.md` 7 and 6. Changed: `-maxrate 3500k -bufsize 7000k` added, so five minutes stays under the bucket's 150 MB (CRF alone runs over it on a busy 1080 x 1920 clip); `min(1080, …)` in the scale, so a 720p source is never enlarged; the trigger is a short side over 1080, not a width over 1080 (a 1920 x 1080 landscape clip needs nothing); "one transcode per run" became "one at a time", because a second phone video in a folder would otherwise wait for a claim to expire; the scratch floor rises from 2 to 4 GB; `too_big` (video) and `unplayable` are reworded, since 150 MB and "export it" are no longer the reasons |
| 7 | Say what to do when a link is restricted | `DRIVE-IMPORT.md` 6 and its runbook row; `CONTENT-AR.md` |
| 8 | Resource keys per child; newest first | `DRIVE-IMPORT.md` 7 (`IMPORT_FIELDS`, the keys header on get, list and download), tests. Changed: subfolders are listed by their own query, so a large folder's newest files and its subfolders are both found |
| 9 | "The first files arrive…" | `CONTENT.md`, `CONTENT-AR.md`, 22.7, `DRIVE-IMPORT.md` 1 |
| 10 | A picture on O7's last content stop | 22.2.7, 22.4.3, 22.4.6; `CONTENT.md` decision table. Changed: a strip of six 112 x 140 tiles in the title band, over the end column it illustrates, not a 3 x 2 field of 120 x 150 above "The first weeks are a test": by the type sizes, the end column already runs about 560 px from y 240 against a foot at y 928, and a 3 x 2 with its tag needs about 370 px more. The title band beside "What to expect" is empty. A fit ladder (96 x 120, then no strip) keeps the 48 px check, and the shots measure it (estimated here, not yet built) |
| 11 | Two more arrival sequences | 22.2.4 (the phone rises, the picture after `decode()`), 22.2.7 (the checklist closes), 22.3.2 (six sequences), 22.3.3 |
| 12 | A villa fit-out is an interior | 22.4.2 (the rule before the families, with فلل and شقق added, and an Arabic pinned case) |
| 13 | No real city for a generated room | 22.4.1; `CONTENT.md` and `CONTENT-AR.md` alt tables |
| 14 | "How your ads will look" beside an example | 22.4.3 (`ads.lineExample`; `lineEmpty` for starters; `ads.line` when mixed); `CONTENT.md`, `CONTENT-AR.md`; the copy test (22.9) |
| 15 | O4's card around the phone | 22.2.4 (the product column on the ground, the 600 px phone, the tag at y 316); the Hallmark stamp (22.9) |
| 16 | Inline and scripted durations escape `--dk-m` | 22.3.1, 22.3.4 (and the gate). Added: a Web Animations duration is 0 under reduced motion as well as under `still` |
| 17 | The Reels chrome over bright photos | 22.4.3; 22.9 (the kitchen and stairs shots) |
| 18 | `-b` tiles repeated the scenes | 22.4.1: twelve detail boxes, chosen by eye on a gridded contact sheet and checked as a 24-tile sheet. Changed: `TILE_B_FOCUS` lives in the build script, not `examples.ts`: only the build crops, and the runtime would carry a table it never reads |
| 19 | The field's tag over their real pick | 22.4.3, 22.4.4; `CONTENT.md`, `CONTENT-AR.md` (`test.field.tag.pick`) |
| 20 | The format mark and toggle over photographs | 22.4.4 |
| 21 | Item 1 done before the client speaks | Merged into 2. Not taken: "later than the deck's open time", because a choice made on an earlier showing of the deck is still the client's, and a reload during the call would untick it |
| 22 | Paint transitions the audit missed | 22.3.4 (every line, by property); 22.3.2 (the text-colour and hover-border exception); the reminders' delay under `--dk-stagger-max` |
| 23 | `will-change` stuck on | 22.3.2 (none anywhere) |
| 24 | Paint containment clips focus rings | 22.3.2 (`contain: layout style`) |
| 25 | O5's crest said "downhill to launch" | 22.2.5 (straight at y 560, labels below, dash 3 gap 9). Added: the last stop's label ends at its node, so it stays inside the content box |
| 26 | O3's caption repeated the title | 22.2.3 (a label beside the mark; the promise as the stop's H3) |
| 27 | O3's note timed against a finished burst | `CONTENT.md`, `CONTENT-AR.md`; 22.2.3 |
| 28 | O6's lead said twice | 22.2.6 (off the canvas, into the notes); `CONTENT.md`, `CONTENT-AR.md` |
| 29 | "Example" said three times on L4 | 22.4.3; `ads.empty` unchanged in `CONTENT.md` and `CONTENT-AR.md` |
| 30 | How the journey token follows the line | 22.3.3 |
| 31 | No check ever ran the motion | 22.9 (the motion pass and the Zoom pass) |
| 32 | A select cannot show pictures | 22.4.5 |
| 33 | `requestIdleCallback` missing in Safari | 22.4.1 |
| 34 | No WebP encoder on this Mac | 22.4.1. Changed: Pillow 11.3.0 with libwebp 1.5.0 is on this Mac's `python3` (checked 2026-10-20), so the build is a Python script with Lanczos resampling and `method=6`, not Chromium's canvas encoder; it still detects each original's format by its bytes and renames nothing |
| 35 | A resumed import deadlocked on plan | `DRIVE-IMPORT.md` 4 (`resumed`, plan's `55000`, a resumed reserve), 7 (step 3, the upsert on a resumed upload), 10, tests. Added: `request_id` no longer includes `attempts`, so a resumed reserve finds its own row |
| 36 | One client's broken card blocked every import | `DRIVE-IMPORT.md` 4 (claim looks past it; `not_started` for a queued one, `stopped` for a working one, after 30 minutes), 3 (the code), 6, 10; `CONTENT.md`, `CONTENT-AR.md` |
| 37 | "Nothing has picked this up" while the worker worked | `DRIVE-IMPORT.md` 4 (`import_heartbeat`, `workerSeenAt`), 7, 10. Changed: a claim now expires 5 minutes after its last heartbeat, not 10, since a live run heartbeats every minute; and `attempts` counts takes in a row without a file landing (file landed resets it), so a long import that stops itself at 45 minutes is never `stopped` for it |
| 38 | Downloads with no total deadline; a hung run held the lock | `DRIVE-IMPORT.md` 7 (`deadline=` and `on_chunk=` on `http.download`, 15 minutes a file, the cron line's `timeout -k 30 50m`, the README sentence). Added: the run stops itself between files at 45 minutes, before the kill |
| 39 | ffmpeg decodes one tile of an iPhone photo | `DRIVE-IMPORT.md` 7 (`heif-convert` only, 120 s), the doctor's `deck-import heic` line, the fixture. The `ispe` check is not needed once ffmpeg is gone; the grid fixture is made with `sips`, which writes four 512 px tiles (checked) |
| 40 | The census breaks on the new functions | `DRIVE-IMPORT.md` 10. Changed: the count is 45, not 38 or 39, because `import_end`, the two drive helpers and the three poster functions join it |
| 41 | A streamed retry sent an empty body; duplicates misread | `DRIVE-IMPORT.md` 7 (`upload_file`) and tests |
| 42 | An unwrapped error killed the run mid-file | `DRIVE-IMPORT.md` 7 step 6 and tests |
| 43 | Heartbeats wrote audit rows | `DRIVE-IMPORT.md` 5 (the imports branch). Read as: `heartbeat_at` and `updated_at` alone are bookkeeping; the finding's "claimed_at-free" was taken to mean that `claimed_at` changing is an action and is audited |
| 44 | Worker writes could interleave; a racing reserve raised | `DRIVE-IMPORT.md` 4 (`FOR UPDATE` first in every worker function; `unique_violation` turns the entry `skipped`), 10 |
| 45 | Only finish() closed an import's files (cut off) | Read as: every way an import ends must fail its unfinished entries and remove their `uploading` rows, which otherwise show "Waiting" or "Bringing in" under a failed import and hold the `drive_once` index until the day-old sweep. `DRIVE-IMPORT.md` 4: one internal `cockpit_csm_launch_ads_import_end`, used by finish, claim (`stopped`, `access_revoked`, `not_started`) and file reserve (`access_revoked`); `finish` no longer accepts `access_revoked` from the worker |

### 22.11 The fixer's round (2026-10-21)

The visual review's findings, applied to the build; where the build parts
from 22.0 to 22.10 the section itself now says so ("the fixer's round").
What was not taken, or taken another way, and why:

| Finding | What the build does | Why |
|---|---|---|
| L3's field: examples only when the client has no creatives (departure 4 questioned) | Kept for every client, as departure 4 says | The field never held the client's creatives but their pick; the tag reads "Example ads, and your pick" whenever the pick is there, so no client creative is ever called an example or dimmed, and the notes stay true on every deck. For the CEO to confirm |
| O5's last label ending at its node at x 1768 | The last stop keeps its own 300 px column (22.2.5) | Ending at the node ran the label into the launch call's |
| Undo restoring the service prep had before | Undo clears `service_chosen_at` only | The service the client chose stays readable; only the checklist's tick is taken back. Prep's field changes the service |
| Re-record the English portal film (Arabic Safari menus, a phone inside the phone) | Played from the sign-in to the app's last screen (22.6.3) | A new recording needs the portal's owner; the cut part shows nothing the slide needs |
| Recut `pcm-lesson-masked.webp` | The crop is applied in the page (`LESSON_CROP`, 22.6.5) | Same picture on screen with no new file to mask again; recutting stays the lead's call |
| `cockpit_csm_launch_ad_accept` refusing Drive rows | Not done (optional) | The worker's own `file_landed` is the only path that turns a Drive row ready; an accept from the browser of an `uploading` Drive row is counted as landed by reserve (`DRIVE-IMPORT.md` 11) |
| 22.9's motion pass and Zoom pass in `deck-shots.mjs` | Not built | The still gates (collision, overlap, `nearTags`, `forkGap`, `portalEdges`) and the film pass run; a motion pass needs frame capture the shot script does not have yet |

### 22.12 The fixer's round, score round 1 (2026-10-21)

The first score round of the visual pass scored every slide; this round
brought each one under 4 to at least 4 and took the cheap clear wins. Shots
`vd-fixer-1021` (both decks, both languages, every fixture, still) and a
motion capture of O7's swap were read.

**The lead decision taken: examples on the covers.** 22.4.6 kept examples
off the covers; the CEO's words were "add an example ad instead of just
having the logo", and the cover is the first screen he judges. The rule is
now: a phone, never a picture behind the title, and always tagged.

- **O1.** The start half holds one block, centred on the phone: the mark
  (96), "Welcome," and the name, then the checklist under them (rings 36,
  numerals 18, names 32/600, rows 72 px apart; the lead-in at 26). The end
  half holds a Reels phone, 680 tall, its end edge at x 1784, showing the
  example's **story** picture full-bleed under their Page name and avatar,
  no caption words, "Example ad" over its end corner. The story render, so
  O4's feed phone shows a different picture of the same theme. The app's
  chrome follows the deck's language. A custom creative of their own (not
  a starter) shows instead, untagged. The phone rises once with the rings
  (`dk-rise`, `--dk-t-swap`, 160 ms in), then holds still.
- **L1.** While the client has no creative at all (22.4.3's rule), the feed
  phone shows the example's feed picture, tagged "Example ad" (their own
  cover creative keeps "Preview"); the faint lanes stay the default for a
  client with creatives and no cover pick.
- **L1, live.** Past go-live the rail is lit to its last node and its label,
  ending at that node, reads "Live since {date} · Launch call today"
  (`cover.roadLive`), so "is live" and the rail agree.

**The onboarding deck**

| Slide | What changed | Why |
|---|---|---|
| O2, no answers | The question, "In 90 days" and the 80 px line are one block on the slide's middle (only when no row follows on stop 2, so nothing moves) | The block sat in the top 45% over an empty half |
| O2, stop 2 | A list of answers is one box as wide as its widest line (`useHug` on the list, every item 100% wide); a single answer hugs its lines; neither runs past its column | Hugging each item gave one list two ragged edges in the Arabic deck |
| O3 | The lead under the title is said, not shown (the notes); the WhatsApp mark stands alone under their mark | "WhatsApp group" was said three times; the roles rise with the space |
| O4 | The phone is 640 tall, its tag at about y 273 (Arabic: y 301, under the one-line lead); the third test's column is 176 px, so "Least painful to deliver" takes two lines; an example's chrome follows the deck's language | The margin that was meant to lift the phone was overridden by `.dkc-tagged`'s, so the phone sat low; the starter's Arabic templates drew Arabic chrome in the English deck |
| O5 | The fourth stop reads "Brand Blueprint call" (one call, one name); the route, labels and foot line are one block on the slide's middle | Two names for one call; a 350 px void under the title |
| O7, stop 1 | The strip is a 3 x 2 grid under "Your first ads", up to 150 x 188 (a size container: the tiles take the column's free height, and the grid leaves under 260 px), tiles 1 and 5 lit, "Example ads" over it; the red lines' ask runs to the column's measure (`text-wrap: pretty`) | Six 112 x 140 tiles in the title band read as thumbnails on a share, over 450 px of empty column |
| O7, starter | The words are centred on the phones; the harness's starter pictures are two new kitchen renders | The column ended at y 340; a villa and a concrete frame sat under kitchen copy |
| O7, last stop | The booked call as their calendar shows it (the journey calendar's card, rows 100 px, the call a block 45 minutes long from its start, "Brand Blueprint call" and "45 minutes · Our creative director"), built from `next.blueprint` alone; not booked, an open ring and "We book it before we hang up"; the teal date line is gone (the card says it) | The deck closed text-only with its end half empty |
| O7, the swap | `StageSwap`'s `sequential` mode: the outgoing stop fades out over half the stage time on `--dk-ease-in`, then the incoming fades in (its delay is that half); the close's checks draw after the stop is in sight | The crossfade drew two different layouts over each other for about 300 ms |

**The launch deck**

| Slide | What changed | Why |
|---|---|---|
| L7, stop 1 | Their label is there from stop 1 as a quiet twin in ink-3 (aria-hidden) over the dotted slot; stop 2 crossfades it to the ink one as the piece is pulled | The start 40% of the slide opened empty |
| L9, phone | The install address at 40/600 with "Open this on your phone" over it, centred in the stage's free start; the small address left the words column; every stop's tag sits 20 px over its figure | An 870 px void; the phone's tag sat 12 px lower than the screens' |
| L4, example | An example with no service to name carries their Page name in the Facebook link bar | A blank dark strip beside "Learn more" |
| L4, starters | Unchanged, and now said: the phones keep the template's own language (7.1: the app's chrome follows the ad's language, so an Arabic template runs as an Arabic ad whatever the deck's language). Only an example follows the deck's language (O1, O4, L1) | The score round asked which rule holds |

**Prep and the notes window**

- The Drive box: a paste that starts at least one link clears the field;
  each link left out is a muted line, "Skipped {link}: {its sentence}"
  (`DRIVE_UI.skipped`), with no `aria-invalid`. The warning tone and the
  kept links stay for a paste or a submit where nothing went.
- Video slots not recorded are one line, "Not recorded yet", under the
  slot's title; the harness's six seeds carry the posters the migration
  seeds, so prep shows what production will.
- The notes' foot names the next stop ("Next: your Brand Blueprint call",
  else "Next: stop 2 of 3"), never "Next: the next stop".
- One note per fact: deckData's "Service mode not set…" left; slide 3's
  prep line says it. "Kickoff, templated ads:" sentence-cases a Title Case
  form value. The logo line says "their first letter", as 22.5.1 draws it.
- The presenter's chrome fades on `--dk-ease`, under `--dk-m`.

**Not taken, and why**

| Finding | Why |
|---|---|
| "إعلان مثال" read as a calque; نموذج suggested | نموذج is already the decks' word for a form (نموذج التعريف بالنشاط, the instant form), so "نموذج إعلان" would read as "ad form". Decision 14 (`CONTENT-AR.md`) stands for the lead to revisit; "مثال لإعلان" is the alternative if it changes |
| L3's tiles at 120 x 150 | Six columns of 120 do not fit the field's 734 px with its gaps without moving the words column; the slide scored 4 |
| L4's tray labels in one form | A placed tile names its phone and an unplaced one its shape; both are true and short, and the slide scored 4 |
| L7's roads at `--dk-line-strong`, 3 px | They already are |
| A QR code for the install address | No QR encoder in the repository, and none is installed; the address is set large instead |
| An example tile under O5's launch call | O1, O4 and O7 picture the example; a fourth on the route would repeat it |

### 22.13 The fixer's round, score round 2 (2026-10-21)

The second score round of the visual pass scored every slide; this round
brought each one under 4 to at least 4 and took the cheap clear wins. The
plan stays the cockpit's own system: Geist, `--dk-teal`, the `--dk-*`
tokens, no new colour. The signature of the onboarding deck is now O7's
strip switching off, L3's move in miniature, so the deck has one moment of
its own that a share at 10 to 15 frames a second still shows. Quick shots
of every changed slide in both languages and the full shot run
(`vd-fixer2-1021`) were read.

**Under 4, now at 4 or more**

| Slide | Was | What changed |
|---|---|---|
| O4, starter (two services) | 3 | Rows 96 px with names at 36/600 for three services or fewer, the table centred on the product column, a ghost row under the two with "Add a service" in its name slot |
| O4, no services | 2 | Three ghost rows: dashed `--dk-line-strong` rules, the three test rings at 0.35, "Add a service" at 30/600 ink-2 in the first one's name slot; a typed service takes a ghost's place (`ghostRows`, `rowHeight` in `onboardingDeck.tsx`) |
| O5, the road | 3 | The confirmation their customer gets when a first appointment is booked, tagged "Example wording", under the last two stops, the live template's lines in their name (`CONFIRMATION`), dated by `firstAppointmentDay` (go-live, else a week after the booked launch call, else three weeks after this call) and `bookedSlot`, so it never falls before the launch call; it rises once the line has lit to today. The launch call's line keeps to its column (two lines in Arabic, three in English); the foot line sits on the start half, level with the card's foot |
| O7, stop 1 | 3 | `STRIP_LIT` is tiles 0 and 4: their own service's tile stays lit, as L3's does. The strip sits under "We test many ads, fast" in the end column; the red lines' ask, list and input under the approval line in the start column. On arrival all six are lit, then tiles 3, 1, 5 and 2 switch off `--dk-stagger` apart after `--dk-t-stage` (about 900 ms in all), each picture dimming to 0.3 and its teal ring layer fading as one (opacity only); still and reduced motion paint the end at once |
| O7, last stop, not booked | 3 | The calendar card at full size as an empty day: the call's name on the day row, three hour lines with no times, one dashed 45-minute block holding the open ring and "We book it before we hang up". The booked card has the same geometry, so the day and time take its place when the booking reads back |
| L9, stop 2 | 3 | The calls screen in two pieces, one frame (`CALLS_PIECES`): the recorded call's row with its player, then the next call's row under the screen's own rule; the demo summary between them, which names a budget, is cut out. 960 px wide, the stage's top and end edges kept (`portalEdges` passes) |
| L10, your part | 3 | The columns share their rows (a subgrid), so the three second jobs start on one line in both languages; the week closes the first column under its second job; the Drive pictures are their own creatives only, feed-shaped first, each picture once, three or two (`partTiles`; the full client's feed post and its Reels crop no longer show as twins) |
| Prep, a pasted message with a link left out | 3 | Each "Skipped …" note on its own row, 6 px under the hint, "Skipped" and the cut link in medium weight, still muted (no `aria-invalid`) |
| Prep, a recorded video with no picture yet | 3 | One 64 px row: the provider and the length over the title, and a 32 px play button (22.5.3) |

**The cheap clear wins**

- **O1 and L1.** The phone is 760 tall, its tag 24 px under its foot,
  end-aligned (`PhoneFigure`'s `tagBelow`), so the top end corner holds only
  the presenter.
- **O2.** The hanging quotation mark; stop 2's columns sized to their words;
  the challenges separated by a hairline.
- **O3.** The WhatsApp badge on their mark; the trunk under 300 px.
- **O4.** The phone's picture fades in with its rise, never after it.
- **O6.** The video guide on the card's head line, so no card keeps a dead
  band at its foot; the homework rows take the room (88 px).
- **O7, starter.** Phones 800 tall, the words' measure 640 px.
- **O7, booked.** The block is centred on the stop, from about y 275 to 812.
- **Motion.** O3's trunk and branches at 160 ms each; O1's rings at 240 ms
  each (`--dk-t-ring`); O7's strip switching off.
- **L3, stops 3 and 4.** The switched-off examples step back to 0.15, and
  the notes give the CSM a line if the client points at the pictures:
  "These are examples, to show how testing works. Your ads use your
  projects."
- **L4, an example only.** The tray holds no tile, only "We're finishing
  your first ads".
- **The notes window.** The poster in the Video block carries no words; how
  to present ("Share the deck window only, maximised rather than full
  screen") is said once, in the foot: the welcome and cover notes and the
  ads panel no longer repeat it.
- **Prep posters.** A 35% veil of the panel's ground over every picture.

**Not taken, and why**

| Finding | Why |
|---|---|
| L2: each node on the first line of a two-line label | Taste; the lanes' measured leaders and the stage's anchors depend on the label boxes, and the slide scored 4 |
| L3, stops 1 and 2: the next round's dotted slots from stop 1 | The room under the field is the next round's, and showing the slots before stop 3 tells stop 3's point early |
| L3, stop 5: the next round ordered by the nearest themes | Taste; the field's fixed rotation keeps one picture per theme, and the slide scored 4 |
| L4: the tray's starter caption language | The stated rule (22.12) |
| L7: labels at 36/600, road labels at 28/500 | Taste; the pie's leaders are measured against the label boxes, and both stops scored 4 |
| L9, stop 4 and L10: "Mark every meeting" said in three places | The journey shows it, slide 9 makes it the number-one job, and slide 10 is the recap the group gets in writing; rewording job 2 to point back ("as on slide 9") reads as a slide reference on the client's screen. For the lead |
| L13: the ad that goes live in a 640 px phone | Taste; the close is the question, and the slide scored 4 |


### 22.14 The five main services, score round 3's fixes and the arrivals (2026-10-21)

The CEO's correction, word for word: "These are not kitchens. It is not one
of the services. If you look, we have the main services, which you can see
on the kickoff form. List them out: Architectural design, Interior design,
Fitout / renovation, Construction, Design-build." And of the motion: the
decks should have "really nice animations"; score round 3 found the motion
clean but too quiet (builds of 0.2 to 1.1 s, three plain crossfades, the
pictures never moving). The plan stays the cockpit's own system: Geist,
`--dk-teal`, the `--dk-*` tokens, no new colour; the five services and the
arrivals are built from what the decks already have.

#### 22.14.1 The five main services

The kickoff form (tG7dnxBn) asks "Which service are we advertising?" with
Design and build · Interior design · Architectural design · Fit out and
renovation · Construction only · Other; its hidden field `service_focus`
carries the onboarding answer. Those five are the service, everywhere
(`services.ts`, `SERVICES` in `content.ts`):

| Key | Kickoff choice | Label EN / AR | Inside a sentence EN / AR | Example scenes, lead first |
|---|---|---|---|---|
| `design-build` | Design and build | Design and build / تصميم وتنفيذ | design and build / التصميم والتنفيذ | designbuild, villa, pool, stairs |
| `interior` | Interior design | Interior design / تصميم داخلي | interior design / التصميم الداخلي | living, majlis, bedroom, bathroom, kitchen |
| `architecture` | Architectural design | Architectural design / تصميم معماري | architectural design / التصميم المعماري | architecture2, villa, facade, landscape |
| `fitout` | Fit out and renovation | Fit-out and renovation / تشطيب وترميم | fit-out and renovation / التشطيب والترميم | fitout2, fitout3, office, facade, kitchen |
| `construction` | Construction only | Construction / بناء وإنشاءات | construction / البناء والإنشاءات | construction, construction2, construction3 |
| `other` | Other | Other / خدمة أخرى (the row); their words elsewhere | their words | interior design's (the default) |

Construction is بناء وإنشاءات, never مقاولات (13.5: never مقاول; CONTENT-AR
decision 15). "Construction only" loses "only" on the canvas, where it read
as a limit. "Launch with this" saves the deck's English label
(`SERVICES[key].name.en`) and its Arabic twin, which `serviceOfText` reads
back as the same main service as the kickoff's choice.

**Reading a client's words** (`serviceOfText`). The kickoff's choices and the
decks' own names are read whole, in both languages. Free text is read by
keyword, in this order, the first match winning: design and build (turnkey,
a pool: the whole project); a building's shell (عظم, shell and core: so
"عظم وتشطيب" is construction, not a fit-out); fit-out and renovation (fit-out, renovation,
finishing, office, retail, restaurant, flooring, ترميم، تشطيب، تجديد); interior
design (interior, decor, kitchen, wardrobe, bathroom, bedroom, majlis,
ديكور، مطابخ، حمامات، مجالس); architectural design (architect, facade,
landscape, drawings, permit, consultancy, معماري، واجهات، حدائق، مخططات،
تصميم بيوت/فيلا/منازل/المباني، مكتب هندسي, the licensed design and supervision
office, read before a fit-out so مكاتب هندسية is not an office fit-out);
construction (construction, contracting, building, structure, مقاولات، بناء،
عظم، إنشاءات، تشييد، تنفيذ، عمارة: in Gulf use an apartment building); last,
a bare "design" or "studio" (تصميم، تصاميم، ديزاين) is an interior. Score
round 4 added التصميم والتنفيذ with ال on both words, تصاميم داخلية and
انتيريور, عيادات، مقاهي and فت اوت, each pinned. So
"Kitchens" is interior design, "Kitchen renovation" is fit-out and
renovation, "Villa interior design" is interior design, "Swimming pools" is
design and build. Arabic is read without its diacritics and tatweel, أ إ آ
as ا, ة as ه, ى as ي, after its prefixes (و، ب، ال، لل). مكتب alone is left
out on purpose: it starts a firm's name, not a service. "Other" with nothing
typed is read after the same normalising (أخرى، خدمة أخرى، غيرها، Other).

**The client's service** (`resolveService`). The onboarding deck asks, in
order: slide 4's choice (`service_chosen_at`), prep's `service_focus`, the
kickoff's answer, then the onboarding form's #1 and its services. A choice
(prep, the kickoff) is taken as it is, "Other" included; a form's line only
when it fits one of the five, and words that fit none wait until nothing
fits, then read "Other" in the client's own words. The launch deck asks the
kickoff first, then the choice, prep and the forms, so the service the
campaign was set up for is the one the launch call names.

**Slide 4.** The matrix's rows are the five in the kickoff's order, and a
sixth, "Other", only when some of the client's words fit none of the five
or their pick is Other (`serviceRows`). Rows are 92 px (84 with six). A row's
button holds the name (30/600 ink; 32 in Arabic) and, quiet under it (22/400
ink-3; 23 in Arabic), the client's own words that belong to it, on one line,
whole items only, the rest counted: "Villa interiors +2", the count
isolated left to right so the Arabic deck reads +٢ after their words
(`ownLine`). A word that is our label again is not repeated. "Your #1" sits
beside the row their #1 belongs to. The band starts on the CSM's pointer,
else the row with the most ticks (their #1 breaking a tie), else their
likely service; nothing on file lights no row. "Launch with this" saves
`service_focus` (the English label), `service_focus_ar` (the Arabic) and
stamps `service_chosen_at`; "Other" saves their words; a prep picture chosen
for another service is cleared (`chosenPatch`). The ghost rows and "Add a
service" (22.13) are gone: the five are the choice, and the client's own
words are typed in prep.

**Prep.** "Launch service" is a select: the five and "Other, in their
words", which opens the English and Arabic boxes. "Example ad" is two
selects, by service then by scene; `example_theme` saves a service key (its
lead picture) or a scene id, both on the server's allow-list
(`20261020160100_csm_deck_prep_dos_ar.sql`, pinned by `deck-examples`).

**Fixtures.** full is Noor Studio Interiors, interior design from its
kickoff; sparse reads as design and build from its name; dwy is
construction, with one service that fits none (so slide 4 shows Other);
starter is fit-out and renovation; architecture is seen with
`?service=architecture`. No fixture names kitchens or bathrooms as the
service, as their #1, or in a starter template's words or picture (pinned by
`deck-examples`); full's starter templates are a closer, mirrored majlis and
a bedroom (`starter-interior-*.webp`), its reel ending "…to the last
detail.": the starter client's #1 is "Villa fit-out", its own words
"Villa fit-out, Shop and office fit-out, Kitchen renovation" (the kitchen
only quietly under fit-out, as theirs), and its two starter templates are
fit-out pictures (`starter-fitout-feed.webp`, a closer, mirrored frame of
the restaurant; `starter-fitout-reel.webp`, the office's desk and partition
below its windows, so no skyline shows: the client is in Kuwait)
with fit-out words (the feed: نشطّب ونرمّم المحلات والمطاعم والمكاتب، من
المخطط لين التسليم. The reel: من أول معاينة للموقع لين آخر لمسة.), where they
were a kitchen and "we renovate your kitchen". `?service=<key>` in the harness shows any
service's pictures.

#### 22.14.2 Which picture where

Each main service's scenes, its lead first, then its alternates
(`SCENES`); a scene may serve two services. The six new scenes
(construction2, construction3, fitout2, fitout3, designbuild,
architecture2) are Mahara's own (Higgsfield, GPT Image 2.5), no people, no
text, no logos: feed 1080 x 1350 and story 1080 x 1920 webp, 150 to 220 KB,
and two 216 x 270 tile cuts each, like the twelve (72 files, pinned by
`deck-examples`).

| Place | Picture |
|---|---|
| O1, the Reels phone | the lead (story) |
| O4, the feed phone | the lead of the row on the band; prep's scene when it belongs to that row |
| O7, the strip | the two lit tiles their own: the lead on tile 0, the first alternate on tile 4; then their other scenes, the near ones, the fill-ins (22.15) |
| L1, the cover (no creative of their own; a starter template does not count) | the lead (feed), tagged Example ad |
| L1, the cover (creatives of their own, none picked) | their first ad (the feed phone's), tagged Preview (22.15) |
| L2, journey stop 1 | the first alternate; with ads of their own, the first of the Facebook phone, the Reels phone and the tray's own pictures that is not the cover's, their language first (one picture only: the same, the one exception) |
| L3, the field | no tile twice across the field and the round; the three kept tiles (0, 4, 14) their own scenes, the lead and the alternate as details (cut b), the third wide; then what is left of their scenes and the near ones in both cuts, then the fill-ins (wide cuts first). An interior or fit-out client's field never shows a building site, and a kitchen or a bathroom only as the client's own detail, last (22.16) |
| L3, the next round | their scenes in the cut the kept tiles did not show, then the near scenes' details; planned with the field, so never one of its tiles |
| L4, the phones | feed and Facebook the lead, Reels the alternate |
| L5, the form's cover | the third scene |

No picture shows twice in a row across consecutive slides: L1 the lead, L2
the alternate, L3 details, L4 the lead and the alternate, L5 the third.

#### 22.14.3 Score round 3's fixes

| Finding | What changed |
|---|---|
| must: a starter client's launch cover showed faint lanes | With no creative of their own (starter templates are ours), the cover shows the tagged example ad (`coverExample`) |
| must: a Latin Page name inside an Arabic caption read ".Al Reem … Co" | The Page name and the caption each sit in their own `dir="auto"` isolate (`Phones.tsx`); the client's words on slide 4 sit in `<bdi>` |
| should: « · » beside Arabic-Indic digits read as ٠ | Every Arabic separator is «، » (`sep(lang)` in code, every Arabic line in `content.ts`), pinned by `deck-copy` |
| should: the Reels who-row was hard to read over a light picture | The foot's scrim is `--app-scrim-deep` (0.82) under the who-row and button, fading out above them; a 6 px shadow on the name and caption |
| should: L9 stop 2's "Open this on your phone" floated mid-canvas | Anchored to the phone: end-aligned 72 px before the framed film, level with its first screen, a 44 px teal hairline running to the phone |
| should: prep's Loom slot with no thumbnail fell back badly | A designed poster: the dark ground, a teal play, the provider and length over the title in prep, no words in the notes window |
| should: the notes window's sticky foot covered the video's Close and Copy row | The foot is measured (`--notes-foot`); the page's last spacer and the row's scroll margin use it, and the row scrolls into view when the video opens |
| should: the fallbacks test rendered without a player, so a "{len}" could hide | `deck-fallbacks` renders every slide with `playVideo` and the seeded video slots |

#### 22.14.4 The three weak slides

- **O2, stop 1.** The goal is the stage's hero: it stands `--dk-lift`
  (150 px) lower and `--dk-hero-scale` (1.15) larger, over its 90 days
  drawn across the content, from today (a teal dot, "Today") to the 90th
  day (a teal ring, the goal's label). The goal grows from its foot and
  from the hung quotation mark's outer edge (80 px out), so the 90 days
  under it never move, the mark keeps its place in the margin and the
  words step 12 px in; the widest goal (1400 px) lands inside the content
  (56 + 1480 x 1.15 = 1758 of 1784, pinned by `deck-motion`). On stop 2
  the pair settles up and to its own size in one move (transform only) and
  the 90-day line becomes the rule the other answers sit under. With no
  other answers it sits in the stage's middle, at the hero's size.
- **O5.** The confirmation card hangs from the last stop by a dotted drop,
  so it belongs to "First appointments". The road's rule ("Each call is
  booked at the end of the one before.") is the slide's second statement,
  56/600 ink-2 (Arabic 56 at 1.4), its first line level with the card's top,
  so the band under the road reads as a statement and its proof instead of
  a line beside a 400 px void.
- **O6.** The setup cards carry a picture: on a two-card board, the video
  guide's poster (16:9, 200 px, a 42% veil of `--dk-deep`, the teal play,
  "Video guide · 1:34" under it), played by the CSM's click. When the
  Mahara OS guide is not recorded, the app itself: its first screen
  (`portal-phone-*.webp`, the portal slide's) on a phone rising out of the
  card's foot, tagged "Demo workspace". Three cards to a row (done with
  you) have no room for a poster: the guide's picture in small, 80 x 45 on
  the head's line under the same veil with the teal play, beside its length.

#### 22.14.5 The arrivals

Each slide builds its signature once on entry, confidently enough to read
on a Zoom share at 10 to 15 frames a second, then holds still. Eased, no
bounce, transform and opacity only (a line drawing is the one paint
exception, 22.3). Nothing loops while the presenter talks (checked: no
infinite animation on any stop). Every duration and delay is a token times
`--dk-m`, so `?still=1` and reduced motion paint the end state at once.

| Token | Value | Use |
|---|---|---|
| `--dk-t-arrive` | 560 ms | a figure or a line of words arriving |
| `--dk-t-step` | 120 ms | one beat between the parts of a build |
| `--dk-t-line` | 140 ms | between the lines of O2's goal |
| `--dk-t-sweep` | 900 ms | a line drawn across the slide (O2's 90 days) |
| `--dk-t-drift`, `--dk-ease-drift`, `--dk-drift-scale` | 9 s, a soft ease, 1.04 | an example picture's drift |
| `--dk-rise-far` | 64 px | a phone sliding up |
| `--dk-lift` | 150 px | O2's goal on its first stop |
| `--dk-hero-scale` | 1.15 | O2's goal on its first stop, as the hero |
| `--dk-t-trunk`, `--dk-t-branch` | 240, 200 ms | O3's group filling (were 160 each) |
| `routeMs(k)` | min(1400, 600 + 240 k) ms | O5's lit line to today (was min(1000, 400 + 160 k)) |

| Slide | The build (about) |
|---|---|
| O1 | their mark, then "Welcome," and their name a step apart, the phone sliding up 64 px with the example ad, then the agenda's lead and its three rings: 1.4 s |
| O2 | the goal setting in line by line at the hero's size (each word box learns its line once laid out), the 90 days drawing from today, the ring and the label at its end: 1.5 s; stop 2, the pair settling up and to its own size, the answers rising, then the foot: 1 s |
| O3 | their mark, the WhatsApp badge landing, the trunk, each branch with its role: 2 s |
| O4 | the head, the five rows setting in one after another, the phone sliding up with its example, the band landing with the column's name: 1.2 s, the picture's drift on |
| O5 | the stops appearing dot by dot with their names and dates, the lit line drawing to today, the drop and the card, the rule: 1.6 s |
| O6 | the cards rising in turn, the posters or the phone, what is already done ticking in order across the cards, the week's rows: 1.1 s |
| O7 | stop 1: the two columns in turn, the strip switching off; the starter stop: the phones sliding up one after the other; the booked call: its card rising beside its words; between stops the incoming one starts halfway through the outgoing one's fade (22.15) |

**The drift.** An example picture (never one of theirs) scales from 1.00 to
1.04 over 9 s, once, then holds (`img[data-example]`, in the phones and on
O4). Still and reduced motion show it at its end.

#### 22.14.6 Checked

All deck tests, both typechecks, `check-shared.sh` and Biome on the touched
files. `deck-motion` pins the arrivals from `present.css`: nothing loops,
the build tokens are long enough to read on a share, the drift is once,
slow, transform only and on `img[data-example]` alone, every animation that
uses the 22.14 tokens runs on `--dk-m`, and the hero goal fits. Shots read
at 1920 x 1080: the onboarding deck for all four clients in English and
Arabic, and the launch slides touched (the cover, the journey, the field,
the ads, the form, the call and the portal's phone stop, full and starter,
both languages). The arrivals were stepped through in the live harness,
each stop's own running animations paused and sought to its start, 40% and
end (three frames each; an earlier stop's finished animations are left
alone, or seeking them replays them), read and deleted: welcome 1.3 s,
goals 1.5 s then 1 s, team 2 s, one service 1.2 s, road 1.6 s, this week
1.1 s, what to expect 1.9 s, the starter phones 1.1 s, the Blueprint 0.9 s;
no infinite animation on any stop; the drift (9 s) only on O1's and O4's
example phones.

### 22.15 Score round 4's fixes (2026-10-21)

The fourth score round read every stop of both decks for all four clients
in both languages and scored the onboarding deck 3 to 4 a slide. Its musts
and shoulds are applied; taste where cheap and clearly better. Nothing new
in the palette or the type: the cockpit's own tokens.

#### 22.15.1 Pictures by service

| Finding | What changed |
|---|---|
| must: O7's lit tiles were a kitchen (interior, fit-out, design and build, architecture) or a living room (construction) | `stripTiles`: tile 0 is the service's lead and tile 4 its first alternate (`STRIP_LIT`, now in `examples.ts`); the other four are its remaining scenes, then the near ones, then the fill-ins. Pinned for all five: both lit tiles are the service's own and never a kitchen or a bathroom |
| must: L3's three kept tiles ("the few that work") were whatever scene landed on 0, 4 and 14 | `KEPT = [0, 4, 14]` in `examples.ts` (Cards.tsx lights them): the service's lead and alternate as details (cut b), its third wide; the other fifteen are the rest in `sceneOrder`, each once. Pinned for all five |
| should: an interior client's field showed cranes in rows 2 and 3, and its next round started with a building site | `NEAR` per service (interior: office, stairs, restaurant; fit-out: living, majlis, bathroom, stairs; construction: design and build, villa, modern villa, facade; design and build: modern villa, villa frame, facade, living; architecture: design and build, pool, stairs, garden). `sceneOrder` is the service's scenes, its near ones, then the fill-ins (finished rooms and the whole home, the other services' leads, the sites, and a kitchen or a bathroom last of all, even one of the service's own). The next round is the service's scenes in the cut the field did not show, then the near ones' details. Pinned: no building site in an interior or fit-out client's first twelve tiles or next round |
| must: full's starter templates were two kitchens, one captioned "…the last cabin…" | `starter-interior-feed.webp` (a closer, mirrored majlis) and `starter-interior-reel.webp` (the bedroom), the reel's words "…to the last detail."; the kitchen files are gone. The guard covers the starter pictures' files and words such as cabinet |
| should: the starter client (Kuwait) had Riyadh's Kingdom Centre in its office reel | `starter-fitout-reel.webp` re-cut to the desk and partition below the windows: no skyline |
| must: full's cover and journey stop 1 showed the same dining room | `useCreatives().journey`, with ads of their own: the first of the Facebook phone, the Reels phone and the tray's own pictures whose id and picture differ from the cover's (`coverShown`), their language first; the feed phone only when they have one picture (dwy: its one ad shows on both, the one exception). The harness's tall picture was a crop of the dining room; it is now an entrance hall (`custom-hall-tall.webp`). Pinned for full, starter and sparse in both languages |
| should: a client with ads of their own and no cover pick (dwy) kept the faint lanes | `coverShown`: the pick, else the example (no ad of their own), else their first ad on the feed phone (never a starter), tagged Preview; the lanes only when nothing exists. dwy's own ad is a villa they built (`dwy-villa.webp`), never a kitchen |
| must: prep still promised "the faint lanes" | Cover controls: "No ads of their own yet: the cover shows the example ad, labelled Example ad." with the example's switch under it; "No cover picked: it shows their first ad. Pick another here."; the empty choice reads "The example ad" or "Their first ad"; the prep check speaks only when there is an ad of theirs to pick; the ads panel counts own ads only (starters are ours) and says the phones show the starter templates. Pinned in `deck-launch` |
| should: the field's stops 1 and 2 left an empty band above the rail | The next round's six dashed slots are there from stop 1 at 35% with no label; stop 3 brings in "Next round" at full strength (22.6.2) |

#### 22.15.2 The onboarding deck

| Finding | What changed |
|---|---|
| must: a goal in the other script took the deck's metrics and hang (a one-word widow, touching lines, 260 px off the margin, sliding 220 px as it settled) | `wordsDir` sets `dir` on the goal block and the goal: an Arabic goal takes Plex 76/1.45 (60/1.5, 52/1.55), balanced, in either deck, and sits on the right margin with its « outside it; an English goal on the left. Physical margins and the origin at the mark's outer edge (`calc(100% + 80px)` or `-80px`), so nothing slides between stops. Pinned in `deck-motion` |
| must: one answer group filled 400 px and left 1250 px empty | `.dkc-goal-row[data-n="1"]`: the label spans the row and the items run across it, up to 520 px each, a hairline at each one's start |
| must: English answers sat on the far edge under Arabic labels | Each answer a block in the deck's direction, the words in a `<bdi>`, as O7's red lines |
| should: the no-goal state arrived with the crossfade alone | The question, its label and its line rise in turn, and the 90 days sweep under them (alone on the slide) |
| taste: the track's ends said only "Today" and "In 90 days" | Their dates under them in ink-3 22 (this call's day and the 90th after it), while the goal is the hero |
| should: O4 joined Arabic words with a Latin comma in the English deck | Arabic on both sides takes «، » |
| taste: the proposed service in ink-2 read as disabled | Ink, its name on a 2 px dashed `--dk-line-strong` underline, solid teal once chosen |
| taste: a caption-less feed phone showed a 70 px black band | The feed carries on: the next post's head and the top of its picture, cut by the tab bar |
| should: the WhatsApp letter avatar was invisible | `--app-avatar: #6a7175` (3.2:1 on the card) |
| should: the Arabic deck mirrored the play mark to ◀ | Media play never mirrors: the same ▶ and a physical 3 px optical offset in both decks |
| should: posters painted in after the build | The deck warms slide 6's guide posters when it opens; a poster shows only once decoded (`data-decoded`) |
| taste: "Done" landed before its ticks; "Not checked yet" headed a card with two of three ticked | The status chip fades in after the card's last tick (`--k-end`); `rowStatus` reads some done and the rest unchecked as To do |
| taste: an Arabic red line in the English deck had its bullet on the left | Each line's `dir` is set from its words (`dir="auto"` on the item skipped the words' own isolate) |
| should: O7's stops went blank for about 250 ms | The incoming stop starts halfway through the outgoing fade (`--dk-t-stage` x 0.375), about 100 ms of overlap, opacity only. Pinned in `deck-motion` |
| should: about 520 px between O1's name block and its phone | The phone and its tag stand 120 px in from the content's end |

#### 22.15.3 The launch deck, prep and the notes window

- **L3's panel.** The Arabic Never head is «أبداً». When the lines quoted
  from the card in the other script hold both kinds, they keep their own
  Never and Always heads, small in ink-3, run in beside each group's first
  line (a head on its own line pushed the source line into the rail).
- **L4's leaders.** Within 8 px of its label, a leader runs straight and the
  label moves to the dot's line (a 4 px elbow read as a glitch).
- **L13.** Their mark (96) is back from the cover, top start.
- **The notes window.** The Close, Play and Copy buttons each carry the
  sticky foot's scroll margin, so the keyboard never leaves one under it.
  The Arabic temp check is filled from the Arabic slots.
- **Prep's tray.** Newest first by when each file was made; today's paste
  reads "today, 08:15". The harness's tray and its pretend Drive worker run
  on the harness's clock (19 October, 09:00, plus the time since the page
  opened).

#### 22.15.4 Not changed, and why

- **O3, the trunk 96 px nearer the mark.** Tried: the bus then ran through
  stop 2's reply-time block, which fills the hub's 460 px column. The bus
  stays 100 px before the roles.
- **O7, hour labels on the unbooked day.** A labelled grid puts the dashed
  "We book it before we hang up" block at 10 am, a time nobody chose; the
  rule (and its test) is never a made-up time.
- **L6, the partnership roads.** Already `--dk-line-strong` at 3 px.
- **L10, an "Update outcome" chip.** New words for a CRM action the column
  already says; left for a content pass.
- **A scene two services share, chosen in prep under the second.** Saving
  `service:scene` needs the server's allow-list to change; documented in
  `examples.ts`.

#### 22.15.5 Checked

All deck tests, both typechecks, `check-shared.sh` and Biome on the touched
files; the PGlite suite (the provenance file applied twice, refused before
20261020160000, its class equal to the plan's, the join on the client's own
import, a title skipped in the importer's name); the worker suite (the probe
and the poster lock their input, a broken answer is `HttpError(0)`). Shots
at 1920 x 1080, read and deleted: the onboarding deck for full, dwy and
starter in both languages (no foot, wrap or overlap hits), and the launch
deck for full, dwy and starter in both languages (one hit, the L3 panel's
run-in heads, fixed and shot again clean).


### 22.16 The five main services, score round 1's fixes (2026-10-21)

Score round 1 of the five main services put six slides at 3; each is at
least 4 now. The rule behind most of them is the CEO's correction (22.14):
a kitchen or a bathroom is part of a service, never the service, and an
interior or fit-out client never sees another service's work as theirs.

| Finding | What changed |
|---|---|
| must: L2 stop 3's queue read "Callback · Kitchens and wardrobes" (المطابخ والخزائن) in an interior design campaign | `queueServices` (`services.ts`): the launch service's name, then the client's own words for that same service only (`serviceOfText(word)` is the launch key), in the deck's script; never a sub-trade (`isSubTrade`: kitchens, bathrooms, wardrobes, cabinets, in both languages) and never another service's words; "Other" keeps the words that fit none. Full reads Interior design · Villa interiors · Majlis design (تصميم داخلي · تصميم داخلي للفلل · تصميم المجالس). Pinned in `deck-launch` and `deck-examples` |
| should: L3 stop 1's field showed three building sites, a kitchen and a bathroom to an interior client | `tilePlan` (`examples.ts`) plans the field and the next round together, so no tile shows twice across the two: the kept tiles, then the round (their scenes in the cut the kept tiles did not show, then the near ones' details), then the field's fifteen from what is left of their scenes and the near ones in both cuts, then the fill-ins, wide cuts first. An interior or fit-out client's field never shows a building site; a kitchen or a bathroom only as the client's own detail, after everything else (none appears for the five leads). `NEAR`: interior adds the boutique; fit-out's bathroom (a sub-trade, never shown) gives way to the bedroom. The interior field's first row: living, office, stairs, restaurant, majlis, boutique. Pinned in `deck-examples` |
| should: full's own Facebook-feed ad was a large kitchen (L4, L10's Drive thumbnails) | `custom-square.webp` (harness only) is a mirrored crop of Mahara's own living room, 800 x 800, 100 KB |
| should: the starter's Reels template was a close crop of an office chair (O7's starter stop, L4) | `starter-fitout-reel.webp` (harness only) is the boutique's story cut whole, 608 x 1080: shelving, ceiling, glass front. The office scene shows a skyline through its windows (and the client is in Kuwait), so it was not re-cut; the feed template stays the restaurant |
| should: the call prep's project hint still said "your new kitchen" | "Blank uses the launch service's line: '{line}'.", the line read from the launch service (`familyOfKey`, else the label's family, else "your project") |
| should: the Drive box's stalled line had no card on the harness sheet | A `stalled` scenario (`driveFixtures.ts`): working, files part-way, the worker last seen 11 minutes before the harness's clock; `view=drive` shows it as a card, `?drive=stalled` in prep (DRIVE-IMPORT.md) |
| should: O2's no-goal state sat in the top of the stage | With other answers to come, the question block stands `--dk-lift` lower on stop 1, as the hero goal does, and settles up with the answers in one move (`.dkc-goal-asking[data-lift]`, transform only). Alone, it already sat on the stage's middle (measured 270 to 780 of 1080 for the starter client in both languages). Pinned in `deck-fallbacks` |
| taste: O4's Arabic deck showed the client's words in Latin under Arabic labels | The Arabic deck reads `services_ar` from either deck's prep (the same client's words), and prep has a field for it ("The same, in Arabic", onboarding side); with no Arabic list it shows their words as written. The launch deck also reads the onboarding prep's `services` when its own has none (prep only ever wrote them there). Pinned in `deck-examples` |
| taste: L4's leaders mixed scripts ("Marked مُموّل", "The button: إرسال رسالة واتساب") | "Marked {word}" names the mark in the deck's language (Marked Sponsored, مكتوب عليه مُموَّل), whatever the phone's; the button stays as the phone shows it, in its own isolate after the colon |
| taste, and the slide was at 3: L5 stop 5's thank-you phone was about 80% empty, its words about 17 canvas px | The thank-you screen at a reading size: the Page's avatar 76u (about 67 canvas px), its name 28u and the words 27u (about 24 px), the block centred in the screen's upper half (`padding-bottom: 240u`) |
| taste, and the slide was at 3: L10's six jobs read as a document | One sentence of why per job on the slide; a job's second sentence (`more`: the day off, "Our caller checks in too.") is said in the notes and kept in the recap the notes window copies. The moments at 28 px, the jobs at 32, the why at 26 (Arabic 30, 34, 28). Pinned in `deck-launch` and `deck-copy` |
| taste: the harness's pretend Drive worker landed site-walk.mov as a picture, and one file twice from two links | A video lands as `video/mp4` with its poster; a file another open import has already landed is skipped, as the server's unique index refuses it. The harness's Drive names no longer say kitchens |
| taste: CONTENT.md's sentence-case example was "templates for kitchens" | "templates for interior design" |

Not changed: O1's Arabic role line (نجاح العملاء under the presenter's
name) needs the presenter's gender from `cockpit_people` to say the role
(مديرة or مدير); left for the content pass that reads it. O2 stop 2's
single short group, O3's 2.0 s build and L7 stop 3's empty lower half were
optional and scored 4.

Checked: all deck tests (409), both typechecks (`tsc -b`, `tsc --noEmit`),
`check-shared.sh` and Biome on the touched files. Every other test file
passes on its own but three, which touch nothing here: two need
`convex/_generated`, missing in this worktree, and the auth race test. Shots at 1920 x 1080, read and deleted: L2 stop 3 (full, both
languages), L3 stop 1 (full, starter), L4 (starter stops 0 to 2, full stop
3), L5's thank-you (full, both languages), L10 (full in both languages,
dwy), O2 (sparse, starter in both languages), O4 (full, both languages),
O7 (starter), the Drive sheet's stalled card (both languages) and prep's
slide 4 and call sections.


### 22.17 The five main services, score round 2's fixes (2026-10-22)

Score round 2 put four slides at 3 (O2 for the one-group client, O7 in
the Arabic deck and for the done-with-you and starter clients, the Arabic
L3 panel and the WhatsApp L5) and named one must. The fixer that took the
round was cut off part-way; this records the whole round as finished.

| Finding | What changed |
|---|---|
| must: the starter pack was a yes with no service, so a different choice on slide 4 put "our ready templates for architectural design" over interior templates | `starter_pack` saves the main service the pack was made for (one of the five keys or `other`; the server's allow-list in `20261020160100`, its PGlite case); a yes saved before keys reads as the kickoff's service. `deckData` sets `starterPack` only while that key is the deck's service, so O7 falls back to the no-pack lines and drops the starter stop; prep says which service the tick was for beside it. Pinned in `deck-fallbacks` |
| should: O2's settle printed "Today" over "In 12 to 24 months" for two or three frames | The answers' rise waits for 0.8 of the stage's settle (`:is(.dkc-goal-stage, .dkc-goal-asking) + .dkc-goal-row`), opacity 0 until then. Pinned in `deck-motion` |
| should: one short answer group left O2 stop 2's lower 350 px empty (done with you) | With one group the goal and its 90 days hold `--dk-hold` (120 px) low on stop 2 too, and the row travels with them (the individual `translate`, so its rise still runs): one block from about y 390 to 715 between the title and the foot, in both decks. Pinned in `deck-motion` |
| should: red lines in the other script sat on their column's far edge (O7: English lines in the Arabic deck, an Arabic line in the English deck) | `.dkc-redlines ul` is a block at the column's start, as wide as its widest line (`width: max-content`), its direction set from its lines when they share one script, so its marks sit on its own start. A mixed list keeps each line's own |
| should: L5 for an ad that opens WhatsApp was titled "Your form" over an empty chat | "Your WhatsApp chat" (محادثة الواتساب); the phone shows the chat as sent, the ad it came from on top of the first message (WhatsApp's own look for a chat started from an ad), tagged "Example wording"; the three steps sit level with the phone's foot. No reply bubble: what the business answers is theirs, and the steps already say what happens |
| should: the Arabic L3 panel stacked its groups, then a third head with run-in heads | The English deck's two columns, أبداً and دايماً; each lists its Arabic lines, then its English card lines as one left-to-right block at the column's start (`.dkc-fixed-quoted`, `max-content`), its marks on its left; the first carries بملفكم، بالإنجليزي in ink-3, once. Pinned in `deck-launch` |
| should: prep's scene picker offered Kitchen and Bathroom as a client's example ad | `pickableScenes` leaves the sub-trades out of the select; a kitchen saved before is listed only while it is the choice ("a room, not the service"). Pinned in `deck-examples` |
| should: the harness's full form offered "Kitchens and wardrobes" (L2 stop 1, L5) | "A design consultation" |
| should (from O2 stop 1): the no-goal answer line ended about 250 px short of the 90 days under it | It spans the content (to 1784), as the track does |
| taste: the harness's pictures repeated the example scenes (the starter's templates were its example ad and the strip's lit tiles; full's own Facebook ad a mirrored crop of the example living room) | Re-cut from Mahara's own sales-deck pictures, none of the eighteen example scenes: `starter-fitout-feed.webp` an office desk under the Kuwait Towers (the client is in Kuwait), `starter-fitout-reel.webp` a materials board (stone, wood, fabric, brass), `custom-square.webp` a majlis at night. Harness only |
| taste: with no red lines, O7's start column ended on its sentence over 400 px of nothing (starter) | Three rows to fill, each a faint amber mark and a dashed amber line, the first the input itself |
| taste: O7's strip ended 320 px short of its column | Six tiles in one row across the column, about 127 x 159 at 1920 (a size container; under about 100 px a tile the strip leaves) |
| taste: the Drive box headed six link cards "Bringing in 3 links from Drive…" | "Bringing in 3 of 6 links from Drive…" (نجيب ٣ من ٦ روابط من الدرايف…) when finished links show under the open ones. Pinned in `deck-drive` |
| taste: prep's slide-4 instruction was set in coral and read as an error | A slide's on-the-call steps (`todo`) are muted, apart from what is missing |
| found in the shots: an empty answer field in the Arabic deck read left to right (O2's Arabic prompt sat on the left; O7's and L3's red-line fields too) | Empty, a field takes the deck's direction; once typed in, its words' own (`dir="auto"`) |

Not changed:

- **More indoor scenes for the L3 field** (interior and fit-out about half
  exteriors): new pictures need the Higgsfield pipeline and the CEO's eye
  on each; left for a picture round. The field stays honest (tagged, no
  building sites, no sub-trades).
- **O1, one baseline for the name block and the phone** (optional, "to
  reach 5"): the left block's place is set for the longest names across
  the fixtures; not moved without a pass over every fixture's cover.
- **O5's Arabic example message** keeps the Latin date and time: whether
  the reminder template renders an Arabic date is not known, and the card
  is labelled "Example wording".
- **L5's thank-you welcome bubble** (optional): the phone already reads
  as the form's last screen.
- **O4's Arabic headers**: already bottom-aligned (a one-line header sits
  on its two-line neighbours' second line).

Checked: all deck tests, both typechecks, `check-shared.sh`, Biome on the
touched files, the PGlite suite and the worker suite. Shots at 1920 x
1080, read and deleted: O2 (done with you in both languages, starter in
both), O4 (full, Arabic), O7 (full in both languages, done with you,
starter in both), O1 (full), L3 stop 3 (full in both languages), L4
(full, starter), L5 (starter in both languages, full stop 2), prep's
slide 4 (full, starter) and the Drive sheet.


### 22.18 The five main services, score round 2's fixes, the second fixer (2026-10-22)

Score round 2 of the five main services left seven slides under 4 (O2's
empty state and O7 stop 1 at 3; O4, O6 for done with you, O7 stop 2, the
WhatsApp L5 and L9's install stop at 3.5) and named one must. Each is
fixed below; the shoulds are applied but one, and the cheap taste wins.

**The rule this round adds: a starter template never reuses an example
render.** A starter template is ours and labelled "Starter, from our
templates"; an example render is labelled "Example ad(s)". One picture
under both labels on consecutive stops (O7 stop 1, then stop 2) says two
contradictory things. The harness's templates are cut from Mahara's own
sales-deck pictures, none of the eighteen scenes, and production is
guarded: `scenesNamed` reads an example scene's name from a starter's file
name ("majlis-feed.webp"), and O7's strip, L3's field and its next round
leave that scene out (their lit and kept tiles stay the service's own
work, or its nearest, never a kitchen or a bathroom). Pinned in
`deck-examples`.

| Finding | What changed |
|---|---|
| must: full's starter templates were crops of the example majlis and bedroom, an "Example ad" on O7 stop 1 and "Your starter ads" on stop 2 | `starter-interior-feed.webp` is the sales deck's studio table at its materials tray (marble, brass, oak, fabric under a room's render), `starter-interior-reel.webp` its villa model over the plan; the starter client's reel moved to the table's far end (rolled drawings, a contract and pen), so no two fixtures share a crop. The pretend Drive worker no longer lands the starter picture as their own. The guard above |
| should: O7 stop 1 left a 280 to 330 px empty band under both columns, its six tiles 127 x 159 | The strip is three across and two down, square, as large as the column's height allows (about 195 px, capped at 240), and runs to the column's foot; under about 100 px a tile the strip leaves. Lit tiles 0 and 4 sit on a diagonal; the scattered switch-off is unchanged |
| should: O2's empty state said 90 days four times, and the field's rule and the track drew two lines 52 px apart | The placeholder is "In your words" (بكلامكم); the "In 90 days" label over the field shows only when no track is under it; with the track there, the field's own rule shows only under the pointer or while typing (the field stands 64 px under the question) |
| should: O4's two-line service name took a dashed underline per line and read as two links; the column was empty under it | One rule under the whole name (`bdi` an inline block with a 2 px dashed bottom border, solid teal once chosen), hugged to its longest line (`useHug`: a wrapped inline block spans its column, so the rule ran 160 px past "design"); the text takes what the phone leaves and stands on the phone's middle |
| should: O4's Arabic lead said كل three times about our own process | نبدي بخدمة وحدة، عشان الإعلانات والأسئلة والمكالمات كلها تكلم نوع واحد من العملاء. |
| should: L5 for a WhatsApp ad had 360 px empty under the line, and the starter's picture sat under "Example wording" alone | The steps start 96 px under the line; the third (our call, its "5 minutes" underlined) is the thank-you stop's teal band, level with the chat's foot. The tag reads "Example wording, starter ad" (صياغة للتوضيح، إعلان بداية) when the chat's picture is a starter, on L5 and journey stop 2 |
| should: L9's install address floated mid-slide on a 44 px dash, far from "Install it like an app." | It sits under those words in the words column at 40 px on one line (it may run past the 480 px column into the stage's empty start), a teal leader running from its end to 16 px before the phone |
| should: L10's follow-up read as the client's alone | Done for you, its why on the slide is "You send the quote and set the second meeting. Our caller checks in too." (`moreShown` on that row); done with you, the first sentence alone |
| should: the Arabic L3 panel squeezed Always's English line into 256 px and tagged only the Never column's quoted block | Never takes what its lines need up to half the panel (`fit-content(50%)`; at `fit-content(480px)` the quoted English Never line still took 456 px and Always's line kept three lines) and Always the rest; each quoted block carries بملفكم، بالإنجليزي |
| taste: O6 for done with you put an 80 x 45 picture on each card's head line, read as a blank button | The play mark and the length alone there; the posters' veil is 0.55 (the pale Meta access frame read as a placeholder) |
| taste: O7's close showed the third ring's numeral and a half-drawn check together | The numeral leaves in one beat (`--dk-t-beat`), then the check draws |
| taste: the foot's rings (O4, O6) did not read on a share | 30 px rings, 17 px numerals |
| taste: O1's phone shared no edge with the presenter's name | The presenter ends 120 px in, on the phone's and its tag's end edge (O1 only; L1's phone and presenter already share the content's edge) |
| taste: three Arabic challenges ran left to right across the English deck's row | A list whose lines share one script takes its direction, as O7's red lines |
| taste: L12's Arabic glued و to Latin and its title read literal | ومنصة Mahara OS (and the same in the onboarding notes' line); the title is أشياء تهمكم |
| taste: prep and the notes said "goes live" and "Happy for us to go live?" for a client already live | `SlideDef.titleOf`: the cover's "is live" and the carry-on question, read by prep's strip, its panel head, the notes window and the live region |
| taste: the Arabic cover showed the picked English ad while an Arabic one of theirs exists | Prep's cover field says so and names their ad in the deck's language |
| taste: L13's upper 550 px read as unfinished | The question, the road and the check-in are one block on the stage's middle under their mark |
| taste: the Drive sheet read the wall clock | It reads the harness's 19 October, 09:00 (`HARNESS_NOW`, now in `driveFixtures.ts`), as prep does |

Not changed, and why:

- **L3's field for an interior or fit-out client** (should; about half
  exteriors). Seven indoor scenes give fourteen tiles, and the field and
  the next round need twenty-four different ones. Repeating tiles brings
  back the "one generated batch with duplicates" read that 22.4.1 removed,
  and twelve tiles moves the pick tile (14) and the field's place between
  stops. Left for the picture round (22.17); the field stays honest.
- **Straight quotes around 'Filters'** (taste). The copy rules ask for
  plain quotes (`deck-copy`), and without them the word reads as Title
  Case mid-sentence.
- **L4's Facebook phone repeating the feed's starter** (taste). Meta runs
  one ad in both feeds; that is what the placements show, and with two
  pictures and three phones one repeats either way.
- **L3's words column** (taste). The stamp's place on the title row was
  settled in score round 2; the source line shows on stop 2 only.
- **L1's phone 120 px in** (taste). Its edge is the presenter's; moving
  both would give the letterhead two margins on the cover the client sees
  first.
- **L4's starter tag above the phone** (taste). The focused phone runs
  the content's full height from its top margin (y 96), so a tag over it
  sits in the top band; in the callout column it stacked onto "Your page
  and logo" (score round 4), so it stays over the phone's corner.
- **O3's hub** (optional, scored 4).

Checked: all deck tests (with two new pins: the per-client titles, and the
WhatsApp chat's tag, band and waiting ad; and the O2 empty state's words),
both typechecks, `check-shared.sh` and Biome on the touched files. The
disk ran under 1 GB free for part of the round (another process filling
it), so the shots waited for it to come back over 3 GB. Shots at 1920 x
1080, read and deleted: O7 stops 1 to 3 (full, both languages), O2's empty
state (starter) and its one-group row (done with you), O4 (full, both
languages: the Arabic lead first wrapped onto two lines and pushed the
phone onto the count, so it says الأسئلة for أسئلة النموذج and runs one
line), O1 (full, both languages), O6 (done with you), L2 journey stop 2
and L5 (starter, both languages), L3 stop 2 (full, both languages: at
`fit-content(480px)` the Arabic Always line still took three lines, hence
half), L9 stop 2 (full, both languages), L10 (full), L12 (Arabic: a
no-break space between ومنصة and Mahara OS split the name into two
isolates and read "OS Mahara", so it is a plain space), L13 (full) and L4
stop 1 (starter).


### 22.19 Final score round 1's fixes (2026-10-22)

The final scoring round put three slides at 3.5 (O2, O4 and O7) and named
no must. Each is fixed below with every should, and the cheap taste wins.

| Finding | What changed |
|---|---|
| should: O2, Arabic deck: a single English answer was right-aligned (ragged left) beside a left-aligned English list | `AnswerText` takes its words' direction (`dir` from `wordsDir`), so the block stays at its label's edge and its lines start at their own |
| should: O2, English deck, one group of Arabic challenges: the row was packed to the left, its first item at x 1320 under a label at x 136 | One group whose words all run the other way (`data-cross` on `.dkc-goal-col`): the row spans the content (`useHug` off) and the label stands at the words' own start, over the first item |
| should: O4, English deck: the client's Arabic words were laid out left to right, the Arabic comma on the wrong word | `.dkc-service-own` takes the shown words' shared direction, so they read right to left with «،» in place |
| should: O4, Arabic deck with no Arabic list: "+٢ Villa fit-out" | A Latin line runs left to right with its count after it in Western digits ("Villa fit-out +2"); the starter fixture now has its services in Arabic (`services_ar`), which also gives L2's Arabic call rows their service |
| should: O7 stop 1, done with you: the words ended at y 540 beside a strip running to y 972 | Fewer than three red lines typed, the rows left to fill stay drawn under them (dashed, the first the input), and the ask with its list sits at the column's foot (`margin-top: auto` in a stretched section), its last row level with the strip's lower row |
| should: O7, full: the interior client's Reels starter was the villa model over its plan, read as architecture | `starter-interior-reel.webp` is a 9:16 cut of the sales deck's lit majlis (its sofa, lamp and screen), not one of the eighteen scenes nor the feed starter's table; L4's 9:16 starter thumbnail takes it too |
| should: O5 and O7 contradicted each other for the starter client (O5 showed the Blueprint done, O7 still booked it) | The starter fixture's onboarding deck is at its call's stage (Onboarding Booked). In code, opened after the Blueprint (`roadNow > 3`), O7's checklist ticks it and the card shows the held call from `last.blueprint`, or the block solid with a teal tick and "Done", never "We book it before we hang up" |
| should: L3's field for an interior or fit-out client was about half exteriors, and fit-out's next round a villa's front door | The seven indoor scenes (living, majlis, bedroom, office, stairs, fitout2, fitout3) gain two tiles cut from their story render (`-c` wide, `-d` a detail; a different shot of the same room from the feed's `-a` and `-b`). A room service's field and next round take rooms only: the feed's cuts first, then the story's, each cut across every room before the next, so one room's three pictures never stand side by side; an exterior only after every room (none is needed: 24 different rooms). Other services are unchanged. Pinned in `deck-examples` |
| taste: O6's Arabic content line broke after لا | A no-break space between لا and تفلترون |
| taste: O6, "Video guide · 3:51" sat on the ticks' baseline 28 px after the last tick | The guide's words stand over its poster |
| taste: O7's close titles split the call's name | The name never breaks: "Next: your / Brand Blueprint call", "الخطوة الجاية: / مكالمة بناء الهوية والعرض" |
| taste: L2 stop 4's example booking (Wed 21 October) fell before a 26 October go-live | The slot is counted from go-live while go-live is ahead (Wed 28 October), as O5 does |
| taste: L5's WhatsApp steps, 270 px between the second and the band | The band stands 32 px under the second step |
| taste: L4's Arabic tray chip read «٤:٥، EN» as one left-to-right run | The chip runs right to left, the ratio, the length and the language each isolated |
| taste: the Drive box's "last ran 09:49" | `timeLabel` says "today, 09:49" in English (the Arabic already says الساعة) |
| taste: L3's faint next-round row read as an empty band at stops 0 and 1 | Labelled "Next round" at the same 35% (hiding it brought back the empty band 22.15 removed) |
| taste: L8's "Google optimisation" beside the Academy's "Google Optimization" | "Google optimization", the Academy's spelling |
| optional: O1 broke "Saha / Construction" across two lines | The name's column is 920 px and the name hugs its longest line, so a Latin name in the Arabic deck stands at the start edge |

Not changed, and why:

- **L1's example ad with no caption** (taste). Copy rule: inside an example
  phone nothing is written for them (CONTENT, the example ads); the next
  post's head under the Page name is score round 4's fix for the black
  band, so it stays.
- **O5's example message date** (taste). It mirrors what the live reminder
  template prints ("November 11, 2026", "4:00 PM"); 22.17 keeps it.
- **L2 stop 2's Arabic underline** (taste). Measured: the mark spans
  «٥ دقايق» alone (x 344 to 437), with no trailing space, and في starts at
  344 after the space; nothing to trim.
- **O7's close title after the Blueprint** (the stage past it): the title
  still reads "Next: your Brand Blueprint call"; the card and the checklist
  now say Done. The onboarding deck is presented at the onboarding call;
  a title for the call after it is left for the content pass.
- **Optional items scored 4**: L9's install stop words, L10's starter
  grid, L5's band 16 px off the rail, O6's starter peek phone, and the
  starter's English WhatsApp line under an Arabic ad.

Checked: all deck tests, both typechecks, `check-shared.sh` and Biome on
the touched files. Shots at 1920 x 1080 (JPEG, the disk near full), read
and deleted: O2 stop 2 (full Arabic, done with you English), O4 (done with
you English, starter Arabic), O7 stop 1 (done with you English, full
Arabic), O7's starter stop (full), O7's close (full Arabic, starter), O5
(starter), O6 (full), O1 (done with you, starter, full Arabic, sparse
Arabic), L1 (starter), L2 stops 2 and 4 (full Arabic), L3 stops 0 (full)
and 2 (starter), L4 (full Arabic) and L5 (starter WhatsApp).

## 23. The kickoff form at the end of the onboarding deck (2026-10-22)

The CEO: "embed the kick off form at the end of the onboarding presentation,
since we do the kickoff form on the onboarding call, just make it easy for
them at the end so they can submit it." The kickoff is filled on this call
anyway; until now it lived in the CSM's own tab, then in the kickoff window
(`docs/csm-forms/KICKOFF.md`). Now it is the deck's last slide, O8.

### 23.1 Decisions

| Decision | Choice, and why |
|---|---|
| A stop on O7, or a slide | **A slide of its own, last** (`kickoff`). Filling a form together is a different activity from O7's expectations: it has its own overview title, notes, prep readiness and keys, and O7 still ends on the next call with the checklist closed. O7's last stop now says "We book it before we hang up"; the next slide is how. |
| The form | **The kickoff window's own**: `useFormPanel` (FormPanel's state, split out for this) with the `KICKOFF` config. The same hidden object from the record (the card ID is the record's `clickup_task_id`, the route key the gate checked), the same frozen-at-open rule, the same one note per response, the same checks at 45 s, 2 and 5 min and the same trail. The reads are `useLiveForm`'s, the kickoff window's. |
| The guard | **Never a fresh form here.** A kickoff on record, sent from the cockpit or in the form history shows "Kickoff on record" with what was filled. There is no "Open a second kickoff anyway" in the deck; the notes window links the kickoff window, which keeps its own guard. |
| What the canvas shows | The form in a frame, the client's name, "Sent at 2:02 pm" once Typeform has it, the checklist. **Never the side panel**: the seal and the card ID, Still missing, the offer and the area, the contract, the daily spend, the payment, the recording, the sale's notes, the trail and the booking are the notes window's (12.2: CSM-only facts and booking buttons never touch the canvas; the trail's late sentences tell the CSM what to do, not the client). |
| The notes window | Its **Kickoff** part is the kickoff window's side panel, drawn from a `KickoffView` the deck window posts on the hub (`kickoff`), with the panel's own components (`Seal`, `RailView`, `AfterSend`, `AnswersSheet`). Its presses (Check now, Try again, Check again, Reload the form, Refresh, the booking's auto-open) go back as `kickoff-act` and run in the deck window, which owns the form. |
| The checklist | Item 3, "Blueprint call", is the slide's own at the foot. It is done when the Blueprint is booked or held (as before), or when the kickoff is sent: this call's Submit (`kickoff-sent` on the hub, so every window ticks it) or a kickoff on record. Make 12's submit is what books the Blueprint on our side. Ticked by the kickoff alone (no call booked or held, `blueprintBooked` false), the item reads "Kickoff sent" / انرسل نموذج بداية الشغل (score round 1 of the Blueprint deck: "Blueprint call" ticked read as booked or held). O1's agenda stays open, always (22.2.1): it is the agenda. |
| O7's card | The kickoff sent and no time on the calendar: the block is ticked, solid, and says "We pick the time now", never "We book it before we hang up" beside a ticked checklist. |
| The timer | 30 minutes (22 of slides and setup, about 8 for the form). |
| Rehearsal | `?rehearse=1` on the deck, admins and the CEO: Typeform's sandbox, as in the kickoff window. The frame's head says "Rehearsal: nothing is sent"; a sandbox submit ticks nothing. |

### 23.2 The layout (1920 x 1080)

```text
+------------------------------------------------------------------------------------------+
| Before we hang up:            | +- Kickoff form   Noor Studio Interiors  (v) Sent at 2:02 pm -+ |
| your kickoff form  (H2 56)    | |                                                            | |
|                               | |            Typeform's form (the iframe), 968 x 748         | |
| Your details are already in,  | |                                                            | |
| from your onboarding form.    | |                                                            | |
| We check them together, then  | |                                                            | |
| send it.  (30 ink)            | |                                                            | |
| ----------------------------- | |                                                            | |
| Once it's sent, our team ...  | |                                                            | |
| (26 ink-2)                    | +------------------------------------------------------------+ |
|                               |                                                                |
| Today (1) Launch service (2) Your access (3) Blueprint call                          08 / 08  |
+------------------------------------------------------------------------------------------+
```

- **Start column**, x 136 to 736, as tall as the frame, read top down:
  the title and its line at the top, beside the frame's head; what sending
  it does right under the line, over a hairline, 48 px down (score round 1
  of the Blueprint deck, 2026-10-23: pinned to the column's foot it left a
  400 px gap). The lines swap (`--dk-t-swap`) when the form is sent or found
  on record; once sent the column keeps only its line ("Done. Your answers
  are with our team."), since the frame's card says what happens next.
- **The frame**, x 816 to 1784, y 112 to 852 (its foot on the column's
  last rule; score round 2 of the Blueprint deck's design pass: navy stood
  empty under the form): `--dk-panel`, a 1 px
  `--dk-line-strong` edge, radius 20, no shadow, no tilt, no texture. Its
  head (76 px): the client's name 24/600 ink (score round 1 of the Blueprint
  deck's design pass: the mono "Kickoff form" before it read as a window's
  redrawn chrome; the frame keeps it as its accessible name), and at the
  end the state: the checklist's
  done mark (28 px, teal, its check drawn in `--dk-t-tick`) and "Sent at
  {time}". Its body is `--dk-space`; the form fills it, left to right in
  both languages (Typeform's form is English). It is not a re-drawn
  browser: no dots, no address bar.
- **On record**, the body is the panel: the done mark at 44 px, "Kickoff on
  record" (H3 40/700), "Filled on {date}" (Mono 24 ink-2), then up to three
  ruled rows, label 24/500 ink-2 at 320 px, value 30/500 ink: the service
  (its name from the five), the Page name (as typed, `<bdi>`), starter ads.
  `recordRows` keeps to these three; the money, the card and the sale never
  reach the canvas. The panel is as tall as what it reads back, its top on
  the column's line under the title (`data-held`: `height: fit-content`,
  top y 298, 306 in Arabic; score round 2 of the Blueprint deck's design
  pass: set in the middle, its top lined up with nothing), and the column
  keeps the three steps, each ticked with the done mark, under "Now it's
  in" / «وصلنا، والحين» (score round 2: "Once it's sent" headed steps
  already done), then "Want to change an answer? Tell us in your WhatsApp
  group." (score round 1 of the Blueprint deck's design pass: 280 px of
  empty panel under the rows, and the column empty under one line).
- **Plain lines** in the body, 30 ink-2, centred: "Opening your kickoff
  form", or "We'll open your kickoff form from our side." when the record
  cannot be read, the card is unread or the form does not load. While the
  form opens the line lies on the panel's own ground over it, and the form
  is hidden; once Typeform is ready the line fades out (`--dk-t-swap`) and
  only then the form fades in, never the two at once (score round 2 of the
  Blueprint deck's design pass: the line crossfaded over the form's first
  question).
- **Once sent**, a card covers Typeform's own ending: the done mark at
  64 px, "Next: we pick the time for your Brand Blueprint call" (40/600),
  and what our team does now (32 ink-2). "Sent" is said once, in the head.
- **The checklist**: the foot variant of 22.2.0, item 3 `data-own`; ticked
  by the Submit with no Blueprint call booked or held yet, it reads
  "Kickoff sent" (`today.kickoffSent`), never as if the call were booked.
- **RTL**: the columns mirror; the frame's head runs right to left; the
  form inside stays left to right.

### 23.3 A form that survives the call

The engine mounts one slide at a time, keyed by slide and language (16.4),
so a form inside the slide would reload on L or a step back. The live form
is a **layer** the deck window keeps above the slides (`DeckShell`'s
`layer`, `KickoffLayer`): mounted on the first arrival at O8 and kept until
the deck closes, shown only on O8 (it cuts in with the slide, `--dk-cut-ms`,
and leaves at once), `inert` and hidden elsewhere, inert under the video
player. The slide draws its own still frame only where there is no layer
(prep's preview, the tests). A half-filled form asks before the deck window
closes, as the kickoff window does.

### 23.4 States, all drawn

Open (prefilled, or not), opening, sent (head and lines swap, item 3
ticks), on record (from the record, a cockpit send or the history), could
not open (blocked, unread, slow), rehearsal. The harness shows each:
`present-harness.html?fixture=full&deck=onboarding&lang=en#kickoff` with
`kickoff=open|sent|done|record|cockpit|blocked|slow` and `rehearse=1`,
Typeform's stand-in in the frame (`src/dev/typeformStandIn.ts`; nothing
loads or submits). Any scenario but `record` is the client before its
kickoff: no kickoff on record and no Blueprint booked.

### 23.5 Checked

`scripts/deck-kickoff.test.tsx` pins the slide, the states in both
languages, the read-back's three rows (never the money), the record's card
ID in the hidden object, one note per response, the tick and "Sent at", the
trail and the booking going to the notes window only, a notes press run on
the deck, the form surviving a step back and L, and no form ever created
for a kickoff on record. Shots at 1920 x 1080 (JPEG, read and deleted): the
open, sent, on-record and could-not-open states in English and Arabic, and
the notes window's part.
