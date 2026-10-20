# CSM decks: design plan

The onboarding deck and the launch deck, presented by the client success
manager from a client's page in the client success cockpit. This is the
design plan the build follows: tokens, type, every slide's layout and motion,
the signature element, the mockups, the ads upload, the example call, the
presenter's own views, RTL, empty states, accessibility, and what is reused.
It ends with the self-critique against the CEO's brief (section 18) and the
Hallmark audit of this file (section 19).

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
- **Launch (10 slides, about 22 minutes of a 30-minute slot).** Before a single enquiry arrives,
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
| `--dk-leak-soft` | `rgba(245,184,75,.14)` | Amber's fill twin, exactly as `--dk-teal-soft` is teal's. For "to give us" slots, "To do" chips and the red-lines panel. |
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
| Launch slides with the mini rail (3 to 7) | 96, 136, 132 | y 96 to 948 |
| Slides without a rail (covers, journey, 8 to 10, all onboarding) | 112, 136, 104 | y 112 to 976 |

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
| Preview | Every ad mockup shown on its own. On the ads slide it sits once, after the title on its baseline (`CONTENT.md` L3), and the three phones carry none, so the slide does not say "Preview" four times |
| Starter, from our templates | Every starter ad, on the phone and on its tray thumbnail |
| Your form | The instant form, drawn from their confirmed form |
| Example form | The drawn example form, when no form is confirmed |
| Example | The queue card, the calendar entry, the appointment card |
| Example wording | The WhatsApp confirmation |
| Example written from our script | The call transcript |
| Illustration | Creative freedom's test tiles |
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
|   |                                                       We call during working hours,    |
|  (v) Answers your questions                               10 to 6, Saturday to Thursday.   |
|     \________                                             New enquiries go to the top of   |
|#             (o) We call                                  the list. Anything that comes in |
|               |  \___________________________________ .   at night is called from 10 the   |
|               :  Booked, confirmed, reminded          \   next working morning.            |
|               :.......                                 \  [ Up to 4 tries over 3 working   |
|                       ( ) Lands with you                \   days ]                         |
|                        :  You meet                       > +--------------------------+    |
|                        :  You mark it                      | New enquiry · Kitchens   |    |
|                                                            |       [Top of the list]  |    |
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
| 3 | We call | Our team | You | The call queue card (6.5) | Home of the hours, the list, the tries and "not every enquiry books" |
| 4 | Booked, confirmed, reminded | Our team | You | The five-dot strip (6.5), no words | Thin (slide 6, stop 7) |
| 5 | Lands with you | You | You | The calendar entry (6.5); the amber "Connect Google Calendar" line when the kickoff says it is not connected | Home of the calendar, Mahara OS and the alert |
| 6 | You meet | You | You | `meeting-table.webp` cropped across the top of the stage, with no scrim, and the fork's two cards beneath it (6.4) | Home of the no-show rule |
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

Two cards side by side, under the meeting render (cards floated over a
dimmed photo would murk both in a share):

- **"Didn't show?"** Ours. We call to rebook.
- **"Came, and thinking it over?"** Yours. Follow up, then mark it.

This is the one place either deck says who owns a no-show. It matches the
Client Process Map and the lead's rule. The portal slide keeps only "mark it,
the same day".

### 6.5 The drawn cards (our own UI, so deck tokens)

**The call queue card (stop 3).** A `--dk-panel` card at the stage's width,
drawn as a simplified version of our dialer's list: four rows, no names, no
phone numbers, services from their own chips (fallback "your service").

1. "New enquiry · {service}", with a teal chip "Top of the list". On arrival
   it drops in from above and pushes the others down.
2. "Try 2 of 4 · {service} · 5 pm"
3. "Callback · {service} · 10 am"
4. "Not reached after 4 tries · reason noted", in ink-3.

The new row carries no time and no "Calling" chip: the card shows the order,
never a speed. Under it, one ink-2 line, with no glyph (a moon would be
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

### 6.7 The mini rail (the journey at the foot of slides 3 to 7)

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

It sits at the foot (bottom 44, height 56) where the sales deck's pillar rail
sits. It is not shown on the covers, the journey itself, or slides 8 to 10.
The green light slide draws it large and fully lit (8.10).

**No hand-off animation.** The first plan scaled the lit node from the lanes
down into slide 3's rail. That is a showpiece transition the engine cannot
do without mounting two slides, and the rail already makes the callback by
being the same drawing in the same place. On slide 3 the rail is simply
there.

### 6.8 Done with you

When `serviceModel()` says DWY, stops 3 and 4 sit in the "You" lane, their
words become the client's team's job ("Your team calls", "Your team books"),
the queue card's chip reads "Your team: call now" instead of "Top of the
list", the line visibly stays in the client's column for those steps, and the
fork's dotted curve stays in the "You" lane. Unknown service model: done for
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
during working hours." No button. A video frame (a 16:9 poster with a play
glyph) shows only when `prep.welcome_video` is on.

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
  Illustration.
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

Ten slides, about 22 minutes of a 30-minute slot. Every slide in English and
Arabic. The order: cover, journey, your ads, creative freedom, your form, the
call, your portal, your part, the first 90 days, green light.

### 8.0 One home per fact

The decision table in `CONTENT.md` ("Decision table, binding for both files")
is the one list of homes, and this file follows it. In short:

- the hours, the list, the tries and "not every enquiry books" live on
  journey stop 3;
- the confirmation and the reminders live on the call's stop 7, and journey
  stop 4 is one line and five unlabelled dots;
- what lands with the client lives on journey stop 5, and the call's stop 8
  shows what it carries;
- the no-show fork lives on journey stop 6;
- the thank-you screen lives on the form slide;
- "the numbers decide" lives on creative freedom, once;
- marking outcomes ends the portal slide;
- group hours live on onboarding slide 3; the green light's hours card shows
  only for a client who never saw the onboarding deck.

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
- **Stop 1:** the L3 feed phone at 520 px with their creative and one leader
  on "Sponsored". No profile grid: we do not have their grid, and drawing one
  would be invented content.
- **Stop 2:** the amber panel (`--dk-leak-soft` fill, 16 px radius, no edge
  bars and no bar on any item; the items are 24 px apart and their wording
  marks them). DO items as "Always …", DON'T items as "Never …",
  picked in prep; NOTES never show (they are internal). Red lines typed on
  onboarding slide 7 lead the list, introduced by "You told us: …". No Do's &
  Don'ts and no typed lines: the panel reads "No red lines written yet. Tell
  us now and we'll add them to your card." with an input the CSM types into
  live; it saves to prep, and prep reminds the CSM to copy it to the card.
- **Stop 3:** the chips, their starred pick as a thumbnail, and the lines
  from `CONTENT.md` L4.
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
|                  At 30, 60 and 90 days, that check-in looks back over the month.           |
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
  The first check-in is a bracket (day 7 to 14), then a diamond every two
  weeks. The check-ins nearest day 30, 60 and 90 carry a ring, and one line
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
  explain (the check-in diamond, the ringed diamond), and the dashed open end
  is labelled where it is drawn: "Can run longer".
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
|  Starter ads go live first, from our ready     Your red lines stay fixed. Tell us now      |
|  templates. Your own ads, made from your       what we must never say or show.             |
|  content, follow.                              Everything else, we test.                   |
|  Your first ads go live only once you've       +- amber panel -------------------+         |
|  approved them.                                | Never show prices  (typed live) |         |
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
   17.5 is checked, the notes say "Present maximised, not full screen".
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

- **Stop 7, the home of the reminders.** The transcript dims to 35%. The
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
movement:

- **Top start:** "Back to <client>". It closes the deck window (Present opened
  it) and focuses the cockpit window that opened it. It never navigates the
  shared window to the client page, which holds results, ads, money and
  internal notes. If the window cannot close itself (it was opened by hand),
  it goes to a neutral "Deck closed" screen on the deck route.
- **Top end:** ع / EN, Notes (opens the notes window), All slides, Full screen.
- **Foot centre:** the ← n / N → pill.

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
| - Asked for changes? Note them; slide 4 covers how we test.      |
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
- **Temp check:** every three to four slides, as the framework asks.
- **Timer:** elapsed against the deck's target (10 minutes onboarding, 25
  launch); amber past the target, never red.
- **Booking buttons:** Brand Blueprint (onboarding) and first check-in
  (launch), through the existing `BookCallButton` (real GHL bookings; never
  tested on a real client).
- **Uploads:** add, progress, "Saved", errors and Undo (section 10).
- **Agreement and their pick:** the creative freedom stamp and the L3 star
  (8.3, 8.4).
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

- "No logo. Upload one, or the deck shows their initials."
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
therefore uses Latin digits in both languages, as a phone's call timer reads.
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
| Logo | `cockpit_client_logos`, then a prep upload | Monogram (7.7); a dark logo sits on an `--dk-ink` plate | "No logo. Upload one, or the deck shows their initials." |
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
| Their pick | The L3 star | Creative freedom reads "The ones you'd pick run too…" | |
| Page name | Prep, then the kickoff "Facebook page" | The client name | |
| Primary text, headline | Per creative, prep | Caption shows the page name only | Missing, Add |
| Call to action | Per creative | "Learn more" (Default) | Default, Change |
| Form questions | The confirmed form (exact form id, CSM tick), then prep | Slide hidden; journey stop 2 shows the example form, tagged | "No form confirmed…" |
| Thank-you text | The confirmed form's thank-you | "Thank you. Our team will call you during working hours." | Default |
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
| M | Mark the selected creative as their pick (slide 3) |
| A | Record the client's agreement (creative freedom) |
| Esc | Close an open panel, then the overview. Nothing more: Esc never leaves the deck |

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
| `interior-majlis.webp` | The client saw it on the pitch, and behind their name it reads as their project. Both covers use the faint lanes |
| Wistia `ti2alygqn0` and callcenter.maharamedia.com | Real calls with no consent record |
| The speed slide, "within 5 minutes", the MIT figures | Contradicted by measured data |
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
| Tests in `apps/client-success-cockpit/scripts/` | Slide order; the copy rules (no leads, no cost per lead, no "5 minutes", no "just now", no ROI, no guarantee, no "every" on process steps, no em dash in Arabic); the banned asset names (16.2); Esc never navigates; one home per fact (each decision-table fact's key appears on one slide only); the slot table; the upload state machine |
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
   "Calling" chip, which drew a speed claim the words avoid.
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
    title, as `CONTENT.md` L3 has it (5.4, 8.3).
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
| 6.3 stop 3 | The stop's words say the hours, the top of the list and the night rule (copy rule 1), so the card does not repeat them: no "Top of the list" chip and no night line. The tries are the card's legend under it, on the start side, with the Example tag on the end corner. The rows carry their place in the queue (1 to 4, the first in teal on the row band); no ring per row. The card is set so its first row is level with the lit row when the words leave room, and the leader runs straight into that row. A long service name wraps; it is never cut. |
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
| 6.2, 6.3, 6.5 | A no-show has one name: "Didn't show?" on the fork, as the CRM's stage "Didn't show". Done with you, the no-show's branch, mark and card are the client's ink, not our teal, and the queue's "Your team: call now" chip is outlined in ink like "You do this". The queue keeps one script per card (an Arabic service name is left off an English row, and the other way round). Stop 2's phone shows the questions screen from its top (it had opened on question 2, or on a cropped option); with no service known, the example form leaves its service question out. Stop 5's calendar starts at the booked hour, the appointment its first row, level with the lit row. Done with you, stop 7's CRM stages are set level with "You mark it" (the leader ran into empty space), and each stage name has a clear gap before the next. |
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
| 6.3 stop 5, 6.4 | The two outcomes are drawn in the lanes' line language, not as cards: the leader runs into the meeting's line, which goes on, solid, to a node ahead ("Came, and thinking it over?" · yours) and drops, dotted, to the lanes' rebook mark ("Didn't show?" · ours in teal; theirs in ink done with you), each end's name and line beside it. The lanes draw the fork from the next stop on, so it is never named twice on one screen. |
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
