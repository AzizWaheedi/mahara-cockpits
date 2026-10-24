# Brand Blueprint: the build spec

Spec, 2026-10-22, for branch `blueprint-1022` (from `origin/main` 396aee7d, with the kickoff-in-the-onboarding-deck WIP at 387b7220). Built from `PLAN.md` (decided), `form-map.md`, `call-map.md`, `cd-map.md`, `docs/csm-forms/KICKOFF.md`, the deck engine in `apps/client-success-cockpit/src/present`, the form panel in `src/forms`, `supabase/functions/cockpit-creative-api`, and the three style mockups in `notes/brand-blueprint-1022/` (studio, editorial, cinematic). People are named by role. No client's answers appear here; every example is labelled as one.

Nothing in this spec is built, applied, deployed or sent. Every write outside Supabase sits behind the creative outbox, with a rehearsal that shows the plan from reads only.

---

## 0. What this is, in one screen

| | Decision |
|---|---|
| The form | Native, saved to Supabase `cockpit_blueprints`, one row per client card. Typeform `oYZKtogO` is retired, never edited. **33 visible questions in 3 parts, 21 required** (10 come prefilled or as a summary to confirm, 3 start from a seeded default). The 14-field offer worksheet stays in the client's Offer Cheat Sheet doc. |
| Where it is filled | On the call, inside the Blueprint deck: client-facing answers are typed on the slide (the client watches their words land), private ones in the notes window. Before the call, part 1 is confirmed in the prep view with one press. Part 3 is finished in the creative director (CD) cockpit 1 to 2 days later. |
| The three presses | **Send to media** (part 1, by minute 10), **Close the call** (part 2, slide 14), **Lock the offer** (part 3, CD cockpit). Each queues one `cockpit_creative_outbox` row that `cockpit-creative-api` runs, exactly as the outbox runs a video request today. |
| Part 1 effect | The media buyer's "{card} - New Client Campaign Launch 🚀" task on list `901816723196` from template `t-86ex8xaf1` (or a comment on an open one), tagged, assigned, due in 2 working days, with the brief; Templated Ads Status set; Creative Onboarding step 4 ticked. Never Launch Date, never Daily Budget. |
| Make 14 "COCKPIT CLOSE" | **Not created.** The close has a switch, `close_route`, that starts at `card_only`: the cockpit writes the card fields and comments, and gives the CSM the phase 5 WhatsApp text to paste. `slack` (later, once the bot is in #media-general) adds the cockpit's own Slack post. `make` is built and tested but cannot fire until the route exists and the server flag is on. |
| Rehearsal | `?rehearse=1`, admins and the CEO: answers stay in memory and each press shows the planned ClickUp changes, built from ClickUp GETs only. |
| The deck | A third deck kind, `blueprint`, in the existing engine (canvas, notes window, prep, EN/AR, still mode, harness). **14 slides, 45 minutes**, presented by the creative director. |
| The look | **The Studio Wall, tamed**, with five grafts from the Editorial Issue (section 5.4). This overrides PLAN 3.6's editorial default, as both judges chose. |
| Where it is served | The client success app's deck engine at `/client-success/clients/:taskId/present/blueprint` (deck, `/notes`, `?view=prep`), gated for creative and CSM seats; the CD cockpit opens it by name. The CSM can read and rehearse it, never press a part. |
| Backend | One migration (2 tables, 7 functions for signed-in seats, the gate and one settle function for the server, 5 internal helpers, audit triggers, grants), three outbox kinds in `cockpit-creative-api`, two small read operations there, one generic read-back check in `cockpit-media-api/execute.ts`. |

### 0.1 Where this spec departs from PLAN.md, and why

1. **Look:** Studio Wall tamed, not Editorial (the CEO's judges, 2026-10-22).
2. **Make 14:** no new route. The close switch and its fallback replace PLAN 2.3's step 1 (the task's instruction).
3. **Parts are one jsonb column** (`parts`) with per-part status and timestamps, not six columns (the task's instruction). Behaviour is PLAN's.
4. **Saves are optimistic per field.** PLAN 4.2's whole-row revision would conflict on every keystroke that the deck window and the notes window both save. The row keeps `revision`; the server compares only the fields a save touches, and only across browsers (section 2.4).
5. **3.1 is one question with three short lines** (name, what they get, the free first step). The read-back reads them as one sentence; the editorial graft needs them apart for the feature headline and its who/what/first-step table. "Who it is for" is 2.1, already answered, so nothing new is typed.
6. **Prefills are suggestions until confirmed.** The prep view's "Confirm part 1" writes every prefill the CD leaves ticked in one press, so on the call part 1 needs only capacity and the pack approval.
7. **Close the call needs part 1 sent first**, and Lock the offer needs part 2 closed. The media team must never hear about a close before the launch task exists.
8. **What the code proves impossible in PLAN:**
   - PLAN 3.3 frames the pack "in phones (AdsStage)". The ads tray (`cockpit_csm_launch_ads`) is CSM-gated and holds per-client files, while packs are per service, so the phones cannot hold the pack's own files. Score round 1 (2026-10-23) settled it: slide 5's first stop draws **example ads for the lit service**, from the CSM decks' per-service example set, each tagged "Example ad" / إعلان للتوضيح; since the design pass's score round 2 they are pinned to the wall as prints, no longer drawn in the launch deck's phones (re-drawn app chrome, Hallmark gate 47). Drive's folder view is never framed on the canvas (its raw grid read as a file browser, and an unshared folder shows Google's sign-in page): the real pack opens in its own window, from the notes window or the slide's quiet "Open the pack".
   - The deck's existing reads (`cockpit_csm_deck_sources`, `cockpit_csm_onboarding_read`, the tray) are CSM-gated, so a creative seat cannot use them. `cockpit_blueprint_sources` returns everything the Blueprint deck needs itself, in the same shapes, so `deckData()` runs unchanged.
   - `BookCallButton` books through CSM-gated calls. As PLAN 6.11 already decided, slide 14 opens the GHL launch booking page in its own window and reads the booking back.
   - The full ClickUp field UUIDs for Templated Ads Status, Can Self-Record?, Ad Approval Needed? and Offer Creation are not in the repo (only their 8-character prefixes). The build reads `GET list/901816559981/field` once, pins the full IDs in `blueprintBrief.ts`, and the executor re-checks each ID and name on the card before it writes. Dropdown option IDs are read live from the card, as `board.setAdStatus` does.

---

## 1. The form

### 1.1 How to read the tables

- **Key** is the stable answer key in `cockpit_blueprints.answers` and in the server's allow-list.
- **Type**: `text` (one line, at most 300 characters), `long` (at most 4,000), `choice` (one of the listed values), `ticks` (a boolean), `lines` (a list of short lines), `money` (`{amount, currency}`), `usd` (`{usd, said}`), `url`, `date` (`YYYY-MM-DD`), `names` (a list of `{name, lose}`), `rules` (`{always[], never[], neverShow[]}`), `offer` (`{name, what, firstStep}`).
- **Req**: yes, no, or the condition.
- **Prefill**: the source, then the fallback. **P** = prefilled, confirm with one tap. **S** = summary of the client's own words, accept with one tap or type over. **D** = a seeded default the CD confirms. **N** = new, asked on the call. Kickoff refs are `tG7dnxBn`'s, onboarding refs are `KFRCXPFx`'s, card fields are list `901816559981`'s.
- **Where**: `slide N` means typed or tapped on the shared slide (the client sees it); `notes N` means the notes window while slide N is on (the client never sees it); `prep` means the prep view; `CD` means the CD cockpit.
- **AR** is given wherever the client sees the label. Arabic follows `docs/csm-decks/CONTENT-AR.md` (white Gulf on slides, the client in the plural, Arabic-Indic digits, no guillemets, no em dashes) and was written under the aziz-kuwaiti-voice skill's slide register.

### 1.2 Part 1, "Starter ads" (prep and slides 2, 4, 5; sent by about minute 10)

| # | Key | Question (EN) | AR (client sees) | Type | Req | Prefill | Where |
|---|---|---|---|---|---|---|---|
| 1.1 | `service` | The one service this campaign sells | الخدمة اللي نعلن عنها | choice: `design-build`, `interior`, `architecture`, `fitout`, `construction` | yes | **P**: kickoff "Which service are we advertising?" (`c0000001-…`, choices are the five) → onboarding deck prep `service_focus` with `service_chosen_at` → onboarding `6271b610` mapped by `serviceOfText()`. Two kickoff choices: no value, the slide asks which goes first. "Other" or nothing: no value. | slide 4 (the fan) |
| 1.2 | `capacity`, `capacity_note` | Capacity to take more of it; when Tight or No, one line for the CSM | | choice `yes`, `tight`, `no` + text | yes (note when tight or no) | **N** | notes 4 |
| 1.3 | `starter` | Start with our starter ads while we make yours? | نبدي بإعلانات البداية لين نجهز إعلاناتكم الخاصة؟ | choice `yes`, `no` | yes | **P**: kickoff Templated Ads Status (`eb7ed18c`): Approved → yes, Declined → no. **D** otherwise: yes (starter first is the default), marked "Starter first: confirm with them" | slide 5 |
| 1.4 | `pack_url` | Which pack (a Drive folder) | | url (Drive folder) | when 1.3 = yes | **P**: Settings `pack.<service>`. Unset: empty, and the notes say "No starter pack for {service} in Settings yet: paste its Drive folder." | notes 5 |
| 1.5 | `pack_approval`, `pack_changes` | The client approved the pack | وافقتوا على إعلانات البداية؟ options: شفناها ووافقنا عليها بهالمكالمة · وافقنا عليها من قبل · نبي تعديلات | choice `on_call`, `before`, `wants_changes` + text | when 1.3 = yes (text when wants_changes) | **D**: `before` when the kickoff said Approved; otherwise **N** | slide 5 (one tap) |
| 1.6 | `daily_budget` | Daily budget | (never on a slide) | usd `{usd, said}` | yes | **P**: kickoff "What is your daily budget for the ads?" (`cf53482c`), first number read as USD, the text kept in `said` → card Daily Budget (`539743c2`, `handover.daily_budget`) | notes 2 (confirm), notes 5 |
| 1.7 | `destination` | Where the ad sends people | | choice `lead_form`, `landing_page` | yes | **P**: `lead_form` when 1.3 = yes; **N** otherwise | notes 5 |
| 1.8 | `identity` | Publishing identity | | choice `their_page`, `our_page` | yes | **P**: kickoff Facebook Access Status (`6fcbd33c`): Using Ours → `our_page`; Access Confirmed or Their Page Our Ad Acc → `their_page`; anything else → **N** | notes 5 |
| 1.9 | `red_lines` | Red lines for any ad | الخطوط الحمراء بأي إعلان | lines (at most 12 of 200) | no | **S**: onboarding deck prep `red_lines` (or `red_lines_ar` on an Arabic deck), then the card's Do's & Don'ts DON'T lines (`editor_clients.dos_donts`, split as the launch deck splits them) | slide 2, read again on slide 5 |

AUTO, never asked, carried into the brief: platforms (`7d16afbb`), the exact ad account and Page names (`e4b9dbd3`, `940f494c`), card linked with funds (`8bee68fc`), consultation types (`c0000001-…0008`), the card's CSM, and the Drive, Brand DNA, Offer Cheat Sheet and Market Research links.

### 1.3 Part 2, "Brand and money" (slides 6 to 14; ends with Close the call)

| # | Key | Question (EN) | AR (client sees) | Type | Req | Prefill | Where |
|---|---|---|---|---|---|---|---|
| 2.1 | `best_client` | The clients you want more of | العملاء اللي تبون منهم أكثر | long | yes | **S**: onboarding "Please describe your ideal project" (`6c819933`) | slide 2 (correct), slide 6 |
| 2.2 | `not_for` | Who you don't want | العملاء اللي ما تبونهم | long | no | **N** | slide 6 |
| 2.3 | `method` | How a project runs with you, first call to handover, in your words | كيف يمشي المشروع معكم، من أول مكالمة لين التسليم | long | yes | **N** | slide 6 (the pull quote) |
| 2.4 | `city_cant` | What most firms in your city can't do | اللي أغلب الشركات بمدينتكم ما تقدر تسويه | long | no | **N** | slide 6 |
| 2.5 | `pricing` | How you price, and where most projects land | كيف تسعرون، وقيمة أغلب مشاريعكم | long | yes | **S**: onboarding "What services do you offer … price" (`d976036f`) | slide 7 |
| 2.6 | `minimum` | The smallest project you take | أصغر مشروع تقبلونه | money | yes | **N** | slide 7 |
| 2.7 | `anchor` | The project size your ads point to | حجم المشروع اللي تركز عليه إعلاناتكم | money | yes | **N** | slide 7 |
| 2.8 | `terms` | Deposit and payment terms | الدفعة الأولى وطريقة الدفع | long | no | **S**: onboarding payment options (`ee25f923`) | slide 7 |
| 2.9 | `margin` | Margin on this service (a % or a range) | | text | no | **N** | notes 7 |
| 2.10 | `competitors` | Who you're up against, and who you actually lose to | مين تنافسون بالسوق | names (at most 15; each can be marked "we lose to them", with one line, at most 160 characters, on what they are known for) | yes (at least 1) | **S** when the card's Market Research doc exists (`7489dbcc`, `links.market_research`): the CD's starting list from the doc, shown in notes only, never on the slide until the client names them. Research is never an approved offer. | slide 8 |
| 2.11 | `why_us` | Why people pick you instead | ليش العملاء يختارونكم بدالهم | long | no | **N** | slide 8 |
| 2.12 | `approval` | How you approve your own ads | كيف توافقون على إعلاناتكم: كل فيديو · أول مجموعة وبعدها نكمل · نشغلها ونوريكم بعدين | choice `every`, `first_batch`, `run_then_show` | yes | **D**: `first_batch` when the kickoff said Wants To See Them First; otherwise **N** | slide 10 (three cards) |
| 2.13 | `dna_status`, `dna_missing` | Brand DNA doc status, and what is missing | | choice `complete`, `small_gaps`, `big_gaps` + text | yes (text when gaps) | **N**. The doc link is AUTO (card `89bbb8b0`). "Not opened" is no longer an answer. | notes 11 |
| 2.14 | `rules` | What must always appear, never appear, and never be shown (projects, names) | لازم يكون بإعلاناتكم · ممنوع بإعلاناتكم · مشاريع وأسماء ما تنعرض | rules (each list at most 12 of 200) | yes (at least 1 line in any list) | **S**: 1.9's lines under "never", the card's DO lines under "always" | slide 11 |
| 2.15 | `camera` | On camera, and how | بتطلعون بالفيديو؟ نعم، مع مصور أو في استوديو · نعم، بالجوال · لا · مو متأكدين للحين | choice `yes_studio`, `yes_phone`, `no`, `unsure` (the card's four) | yes | **D**: card Can Self-Record? (`39839c9d`) when set | slide 12 |
| 2.16 | `content_rating` | Their existing content | | choice `strong`, `usable`, `weak`, `none` | no | **S**: the links only (kickoff `3418ef58`, onboarding Drive `64d23c81`), shown as links to open | notes 12 |
| 2.17 | `shot_list` | Shot list given; due 72 hours after the call | أربع لقطات منكم، لين {date} | ticks; `shot_list_due` is set by the server when ticked | no | **AUTO** date: the call's start (the Blueprint booking, else the tick's time) plus 72 hours | slide 12 (date), notes 12 (tick) |
| 2.18 | `events` | Events coming up to script for | | long | no | **N** | notes 12 |
| 2.19 | `readback_yes` | They said yes to the read-back | | ticks | yes | **N** | notes 13 |
| 2.20 | `csm_signals` | Capacity, UGC or upsell signals for the CSM | | long | no | **N** | notes 14 |
| 2.21 | `anything_else` | Anything else the team should know | | long | no | **N** | notes 14 |

AUTO, never asked: the launch call booking (`cockpit_csm_calls`, next `launch`), and the Fathom link when the call store matches one (never required: 0 of 9 Blueprint calls has a matched recording).

### 1.4 Part 3, "The offer" (slide 9 drafts it, slide 13 reads it back, locked in the CD cockpit)

| # | Key | Question (EN) | AR (client sees) | Type | Req | Prefill | Where |
|---|---|---|---|---|---|---|---|
| 3.1 | `offer` | Your offer: its name, what they get, and the free first step (and who gives it) | عرضكم: اسمه، اللي يحصلون عليه، والخطوة الأولى مجاناً | offer `{name ≤ 80, what ≤ 200, firstStep ≤ 160}` | yes | **N**, with one suggestion for `firstStep` (**S**): onboarding "Do you offer free consultations?" (`ec89854f`) and appointment types (`b370341c`), shown in notes 9 | notes 9 (the CD's draft), slide 13 (typed live), CD |
| 3.2 | (link) | The Offer Cheat Sheet | ملف العرض | AUTO: card `43ca3d4c` | | | slide 9 (opens in its own window), CD |
| 3.3 | (the press) | **Offer locked in the doc** | | the part 3 press | yes | | CD |
| 3.4 | `scripts_status`, `scripts_date` | Custom scripts: In progress / With the editors, and a date | | choice `in_progress`, `with_editors` + date | no | **N** | CD |

**Count:** 9 + 21 + 3 = 33 visible questions (3.2 is a link, not a question). **Required:** part 1: 6 always (1.1, 1.2, 1.3, 1.6, 1.7, 1.8) plus 2 when starter = yes (1.4, 1.5); part 2: 11 (2.1, 2.3, 2.5, 2.6, 2.7, 2.10, 2.12, 2.13, 2.14, 2.15, 2.19); part 3: 2 (3.1, 3.3). 21 in all.

### 1.5 Prefill, summaries and confirming

- **One module:** `src/present/blueprintPrefill.ts`, pure. It reads kickoff and onboarding answers **by ref prefix** from `FormEntry.answers[].ref` (refs listed above; the kickoff's own choices are the five services word for word, so `KICKOFF_CHOICE` maps them), the card facts, `editor_clients`, and the onboarding deck's prep. It returns, per key: `{value, from, sourceLabel, date, kind: "P" | "S" | "D"}`, or nothing.
- **Budget parse:** the first number in the kickoff text is the USD figure (`$40 a day`, `40 دولار`, `٤٠`); a range ("40 to 50") or another currency ("KWD", "دينار", "ريال") gives no number, keeps the text in `said`, and the notes say "The kickoff said {said}: confirm it in dollars."
- **Summaries (S)** are deterministic in v1, as `clientBrief.ts` does: the client's words cut to about 160 characters on a whole word, with the source and date ("Onboarding form, 13 Oct") and "Show all". Arabic stays as typed, in `<bdi dir="auto">`. Accepting writes the text (or the full text, if "Show all" was open) as the answer. Only an accepted value ever reaches a slide.
- **Suggestions are not answers.** A prefill is shown beside its question with its source until the CD confirms it. Confirming writes the value and records `from` in the field's meta (section 2.4), so the brief can say "from the kickoff".
- **Prep's "Confirm part 1"** shows part 1 with every P and D ticked, and writes all ticked ones in one save. On the call, part 1 is then capacity and the pack approval.
- **Two services in the kickoff:** `service` stays empty; slide 4 lights both strips amber with "Which one goes first?" and the CD taps the client's pick. The other goes to the parking lot.
- **No kickoff on record:** part 1 starts empty, slide 2 shows only what the onboarding form holds, and the notes window says "No kickoff on record: ask the service and the budget."

### 1.6 Conditional rules (the browser mirrors the server)

- 1.4 and 1.5 show and are required only when `starter = yes`. A `starter = no` clears neither (an edit back to yes keeps them), but the server ignores them in part 1's check and payload.
- `capacity_note` is required when `capacity` is `tight` or `no`; `pack_changes` when `pack_approval = wants_changes`; `dna_missing` when `dna_status` is not `complete`.
- 1.7 defaults to `lead_form` only when starter = yes.

### 1.7 The registry

`src/present/blueprintForm.ts`, pure, is the one list of questions: key, number, part, type, required (a boolean or a function of the answers), placement (slide id or notes), EN label, AR label (client-facing ones), the prefill it uses, and the client-side mirror of the server's checks (`missing(part, answers): string[]`). The SQL allow-list and required keys are tested against it (section 7).

---

## 2. Data

### 2.1 The migration

`supabase/migrations/20261024a_brand_blueprints.sql`: one transaction, applies twice without error (`CREATE TABLE IF NOT EXISTS`, `CREATE OR REPLACE`, `DROP TRIGGER IF EXISTS`), row security and grants in the same file. It touches no existing function.

```sql
CREATE TABLE IF NOT EXISTS public.cockpit_blueprints (
  task_id        text PRIMARY KEY CHECK (task_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  client_name    text NOT NULL CHECK (btrim(client_name) <> ''),
  answers        jsonb NOT NULL DEFAULT '{}'::jsonb
                 CHECK (jsonb_typeof(answers) = 'object' AND octet_length(answers::text) <= 65536),
  -- per key: {by: email, at, session, from}; by is never returned to a browser, only a first name
  answer_meta    jsonb NOT NULL DEFAULT '{}'::jsonb
                 CHECK (jsonb_typeof(answer_meta) = 'object' AND octet_length(answer_meta::text) <= 65536),
  -- {"1": {...}, "2": {...}, "3": {...}}, a part absent is open (section 2.5)
  parts          jsonb NOT NULL DEFAULT '{}'::jsonb
                 CHECK (jsonb_typeof(parts) = 'object' AND (parts - '1' - '2' - '3') = '{}'::jsonb
                        AND octet_length(parts::text) <= 131072),
  revision       integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  launch_task_id text CHECK (launch_task_id IS NULL OR launch_task_id ~ '^[A-Za-z0-9]{4,20}$'),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     text NOT NULL CHECK (btrim(updated_by) <> '')
);

CREATE TABLE IF NOT EXISTS public.cockpit_blueprint_settings (
  key        text PRIMARY KEY CHECK (key ~ '^(pack\.(design-build|interior|architecture|fitout|construction)|launch_assignee|close_route)$'),
  value      text NOT NULL CHECK (char_length(value) BETWEEN 1 AND 500),
  label      text CHECK (label IS NULL OR char_length(label) <= 120),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL CHECK (btrim(updated_by) <> '')
);
INSERT INTO public.cockpit_blueprint_settings(key, value, updated_by)
VALUES ('close_route', 'card_only', 'migration') ON CONFLICT (key) DO NOTHING;

CREATE INDEX IF NOT EXISTS cockpit_creative_outbox_task_kind
  ON public.cockpit_creative_outbox (task_id, kind, created_at DESC);

ALTER TABLE public.cockpit_blueprints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cockpit_blueprint_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cockpit_blueprints, public.cockpit_blueprint_settings
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.cockpit_blueprints, public.cockpit_blueprint_settings TO service_role;
```

No policies: the browser reaches both tables only through the functions below. The pack settings start empty (no rows); `launch_assignee` starts empty; `close_route` starts `card_only`.

### 2.2 Functions

Every function is `SECURITY DEFINER SET search_path = ''`. Public ones: `REVOKE ALL … FROM PUBLIC, anon, service_role; GRANT EXECUTE … TO authenticated`. Internal ones: `REVOKE ALL … FROM PUBLIC, anon, authenticated`; the gate is also granted to `service_role`, as the CSM gate is. Nothing is granted on the tables.

| Function | Who | What it does |
|---|---|---|
| `cockpit_blueprint_gate_for_actor(p_actor uuid, p_task_id text, p_write boolean) → jsonb` | internal (and `service_role`) | 1. Task ID pattern. 2. An active seat, confirmed address, email matching, as `cockpit_csm_client_gate_for_actor` checks. 3. **Creative path:** roles hold `creative` or `admin`, or the founder addresses the CSM gate lists; the card's name is the one current row of `cockpit_creative_sources` table `clients` with `data->>'taskId' = p_task_id` (current = `cockpit_creative_source_current`); `cockpit_ask_ai_owner_allowed(p_actor, 'creative', name)` must be true. 4. **CSM path, read only:** when `p_write` is false and the creative path refused, `cockpit_csm_client_gate_for_actor(p_actor, p_task_id)`. 5. Returns `{actorId, email, firstName, taskId, clientName, write, rehearse}`; `write` is true only on the creative path, `rehearse` only for admins and the founders. Refusals: "That client is not on your access list" (42501), "This client is not in the creative roster yet. Refresh the creative sync, then open the deck again." |
| `cockpit_blueprint_read(p_task_ids text[]) → jsonb` | creative or CSM | At most 200 cards, each gated (read); a refused card is left out, not an error, so the dashboard reads every card it may. Returns `{rows: [row json], now}`; each row has the latest outbox row per part. |
| `cockpit_blueprint_sources(p_task_id text) → jsonb` | creative or CSM | Everything the deck reads, read only (section 2.3). |
| `cockpit_blueprint_save(p_task_id text, p_changes jsonb, p_session text, p_base_revision integer) → jsonb` | creative (write) | Autosave per field with conflict detection (section 2.4). |
| `cockpit_blueprint_part_done(p_task_id text, p_part integer, p_request_id uuid) → jsonb` | creative (write) | Checks, stamps, queues one outbox row, one audit row (section 2.5). |
| `cockpit_blueprint_rehearse_payload(p_task_id text, p_part integer, p_answers jsonb) → jsonb` | admins and the founders | `STABLE`, writes nothing: validates `p_answers` with the same value checks, returns `{missing, payload}` exactly as part_done would queue it, for the Edge rehearsal (section 3.7). |
| `cockpit_blueprint_settings_read() → jsonb` | creative, CSM, admin, founders | `{packs: {service: url or null}, assignee: {id, label} or null, closeRoute}`. |
| `cockpit_blueprint_settings_set(p_key text, p_value text, p_label text) → jsonb` | creative, admin, founders; `close_route` admins and founders only | Validates (below), upserts, writes one `blueprint.setting` audit row. A null or blank `p_value` deletes the key (never `close_route`). |
| `cockpit_blueprint_outbox_settled(p_request_id uuid, p_launch_task_id text) → void` | `service_role` only | Called by the Edge Function after a part 1 run: sets `launch_task_id` when it is null. |

Internal helpers (no grants): `cockpit_blueprint_value(p_key text, p_value jsonb) → jsonb` (validate and normalise one answer, null removes), `cockpit_blueprint_missing(p_part integer, p_answers jsonb) → text[]` (required keys, with the conditions in 1.6), `cockpit_blueprint_payload(p_gate jsonb, p_part integer, p_answers jsonb, p_row jsonb) → jsonb` (section 3.2), `cockpit_blueprint_json(p_row cockpit_blueprints) → jsonb` (first names only, never an address), `cockpit_blueprint_audit() → trigger`.

**Settings validation:**
- `pack.<service>`: `^https://drive\.google\.com/drive/(u/[0-9]/)?folders/[A-Za-z0-9_-]{10,100}(\?[A-Za-z0-9=&_.-]{0,100})?$`.
- `launch_assignee`: `^[0-9]{3,12}$`, with `p_label` the member's ClickUp name as the picker showed it. The executor re-checks membership of list `901816723196` before every assignment.
- `close_route`: `card_only`, `slack` or `make`.

**Answer validation (`cockpit_blueprint_value`):** the key must be on the allow-list (the keys in 1.2 to 1.4 plus `capacity_note`, `pack_changes`, `dna_missing`, `scripts_date`); text trimmed, a blank removes the key, `text` ≤ 300, `long` ≤ 4,000; choices exactly as listed; `lines` ≤ 12 items of ≤ 200, duplicates dropped; `money.amount` a number from 1 to 100,000,000 and `currency` one of `KWD`, `SAR`, `AED`, `QAR`, `BHD`, `OMR`, `USD`; `usd.usd` from 1 to 100,000, `said` ≤ 200; `pack_url` the Drive folder pattern; dates `YYYY-MM-DD` and real; `names` ≤ 15 of `{name ≤ 120, lose boolean}`; `rules` three lists of ≤ 12 lines of ≤ 200; `offer` as in 3.1, each part trimmed. `shot_list_due` and the meta are never accepted from a browser.

### 2.3 What `cockpit_blueprint_sources` returns

```
{
  taskId, clientName, at: now(), can: {write, rehearse},
  presenter: {firstName},
  deck: {            -- DeckSources-shaped, so deckData() runs unchanged
    taskId, clientName, at, presenter,
    client: {stage, service, launchDate, bucket},        -- cockpit_csm_sources clients
    logo, ghl: {name, country, city, language, serviceMode},
    editor: {offer, offerUrl, brandDna, brandDnaUrl, driveUrl, website, instagram},
    dosDonts: {text, source, syncedAt},
    kit: {onboardingCallOn, launchOn, signupOn, links},
    calls: {next, last},                                 -- cockpit_csm_calls, as the deck reads them
    prep: {onboarding: {overrides: <only goals, red_lines(_ar), services(_ar),
           service_focus(_ar), service_chosen_at, starter_pack, dialect, language, service_model>}},
    launchAds: [], notes: [...]
  },
  kit: {             -- the OnboardingRow fields the deck needs, nothing else
    clickup_task_id, client_name, client_status, csm, links,
    handover: {closer, closer_notes, handoff_risks, go_live, client_profile, daily_budget, service},
    forms: {onboarding, kickoff (without payment)}
  },
  card: {templatedAds, canSelfRecord, adApproval, offerCreation},   -- creative snapshot clients row
  creativeOnboarding: {parentId, steps: {"2": {taskId, status}, "3": {...}, "4": {...}}} or null,
  settings: {packs, assignee, closeRoute},
  blueprint: <row json> or null,
  outbox: {"1": latest or null, "2": ..., "3": ...}
}
```

Left out on purpose: billing notes, the payment plan, contract fields, the next payment amount, the kickoff's payment, the sales transcript, Meta ads and spend, leads and cost per lead. The Creative Onboarding steps come from `cockpit_creative_sources` table `creativeTasks`: the newest parent of kind `onboarding` whose `client_names` holds the card's name, then its children by `parentId` whose names start "2 ·", "3 ·" and "4 ·".

### 2.4 Autosave per field, with conflict detection

- **The browser** saves typed fields 600 ms after the last key and ticks or buttons at once, through `BlueprintSaver` (`src/present/blueprintSaver.ts`, built on `PrepSaver`'s queue: one save in flight, what arrives meanwhile goes in the next). It refuses a key the registry does not know before anything is sent.
- **`p_changes`** is `{key: {value, seen, from?}}`: `seen` is the value this browser last had confirmed by the server for that key (`null` when it never had one), `from` the prefill source when the CD confirmed a suggestion. At most 40 keys.
- **`p_session`** is one ID per browser profile (`localStorage["mahara-bp-session"]`, 22 random characters, a fresh one per window when storage throws), so the deck window and the notes window of one call share it.
- **The server**, under `pg_advisory_xact_lock(hashtextextended('cockpit_blueprints:'||task, 0))` and `FOR UPDATE`:
  1. If `p_base_revision` equals the row's revision, every change applies (nothing moved since this browser last read).
  2. Otherwise, per key: when the stored meta's `session` differs from `p_session`, **and** the stored value differs from `seen`, **and** it differs from the new value, that key is a **conflict** and is not applied. Every other key applies.
  3. Applied keys get meta `{by: gate email, at: now(), session, from}`; `revision` goes up once if anything changed; one audit row through the trigger (changed keys only, as deck prep's trigger records them).
  4. Returns `{row: <row json>, applied: [keys], conflicts: [{key, theirs, by: first name, at}]}`.
- **On a conflict** the browser takes the stored value, keeps what was typed in the notes window under the field ("Changed in another window by {first name} at 14:12. Yours was: '…' · Use mine"), and "Use mine" saves again with `seen` = theirs. Nothing is lost and nothing is silently overwritten across two people.
- **Between windows of one call** values travel over the hub at once (`prep` message, deck `blueprint`), and every confirmed save posts `bp-saved {values, revision}` so the other window updates its `seen`.
- Edits after a part is sent are saved normally. The part then reads "Changed since sent" (the browser compares the part's keys with `parts.N.sent`) and its button reads "Send the changes".

### 2.5 Parts, the press, and its guards

`parts.N` (absent while open):

```
{status: "done", firstAt, firstBy, lastAt, lastBy, presses, lastRequestId, sent: {<that part's answers as sent>}}
```

`cockpit_blueprint_part_done(task, part, request_id)`:
1. Gate (write). Lock the row as in 2.4.
2. **Order:** part 2 needs `parts.1`; part 3 needs `parts.2`. Refusals: "Send part 1 to media first." / "Close the call first."
3. **Required:** `cockpit_blueprint_missing(part, answers)`; when not empty, `RAISE EXCEPTION 'Still missing' USING DETAIL = <comma-separated keys>` (the browser names them from the registry and jumps to the first).
4. **Same request again:** an outbox row with `id = request_id` exists → it must match kind, task, client and actor (else "This request does not match its first send"), and it is returned as it is. No new row, no audit row.
5. **Nothing changed since the last press:** when the part's answers equal `parts.N.sent` and the latest outbox row for this part is `pending`, `sending` or `done`, it is returned with `duplicate: true` ("Already sent at 14:12. Nothing has changed since."). A double click, or both windows pressing, makes one row.
6. Build the payload (`cockpit_blueprint_payload`, section 3.2) and insert one `cockpit_creative_outbox` row: `id = request_id`, `kind` `blueprintLaunch` / `blueprintClose` / `blueprintOffer`, `task_id` = the card ID, `client_name` = the gate's name, `actor_id`, `actor_email`, `payload`. The outbox's own audit trigger fires.
7. Stamp `parts.N`: `firstAt`, `firstBy` the first time only; always `lastAt`, `lastBy`, `presses + 1`, `lastRequestId`, `sent`.
8. Insert one `cockpit_audit_log` row: `action 'blueprint.part_done'`, `entity_type 'cockpit_blueprints'`, `entity_id` = task, `actor_email`, `source_app 'creative'`, `source_system 'supabase'`, `metadata {part, client_name, request_id, second: presses > 1}`.
9. Return `{id, state: 'pending', part, firstAt, presses}`.

**`shot_list_due`** is set by `cockpit_blueprint_save` when `shot_list` turns true: the Blueprint call's start from `cockpit_csm_calls` (kind `blueprint`, today) or now, plus 72 hours.

### 2.6 Audit, in full

- `cockpit_blueprint_audit()` on both tables, `AFTER INSERT OR UPDATE OR DELETE`: one `cockpit_audit_log` row per write, the action from the transaction-local `cockpit.blueprint_action` (`blueprint.save`, `blueprint.part`, `blueprint.launch_task`, `blueprint.setting`), changed answer keys only, `source_app 'creative'`.
- `blueprint.part_done`: one per press that queued a row (2.5 step 8).
- The outbox row's existing trigger; `cockpit_media_actions` journals each executor run and `cockpit_media_provider_health` each provider call, as the runner already does.

---

## 3. Partial submit: the three presses

### 3.1 How a press runs (the existing outbox, followed exactly)

1. **Notes window or CD cockpit:** a request ID is made once per press and kept in `localStorage` under a hash of `(task, part, the part's answers)`, as `queueClientAction` does, so a retry after a dropped connection reuses it.
2. `rpc('cockpit_blueprint_part_done', {p_task_id, p_part, p_request_id})`.
3. `functions.invoke('cockpit-creative-api', {operation: 'clientAction', args: {id}, apply: true})`. `runClientAction` loads the row through `cockpit_creative_client_action('get')` (creative or the CEO; admins pass `cockpit_has_role`), fences it, journals it in `cockpit_media_actions`, claims it (`pending → sending`), runs the plan, and settles it (`done`, or `reconcile` once anything was written).
4. **The browser shows the run** (notes window, CD cockpit): "Sent 10:12 · Making the launch task…" → "Launch task ready · Open it" (link), or "Saved, not confirmed · Run it again" (a `pending` row whose run never finished: the same ID runs again), or "Needs a look: {error}" (`reconcile`, never retried by itself).
5. **On the slide** the Part 1 stamp fires when step 2 returns, from the record's stamp, not from ClickUp's speed (section 5.5).

**Code changes** in `supabase/functions/cockpit-creative-api`:
- `outbox.ts`: `prepareOutbox` dispatches `blueprintLaunch`, `blueprintClose` and `blueprintOffer` to `prepareBlueprint` **before** its `sourceTask` check (a client card is not a creative task). `executeOutbox` runs the returned `MultiPlan` with `executePlan`, as it does for video requests. After a `blueprintLaunch` run, `runClientAction` calls `cockpit_blueprint_outbox_settled` with the admin client.
- `blueprint.ts` (new): `prepareBlueprint(row, provider, env, now)`, `describePlan(plan)` (plain sentences for the notes window, the CD cockpit and rehearsal), and the GET-only provider guard. It imports the pure `apps/client-success-cockpit/src/present/blueprintBrief.ts`, as `cockpit-csm-api` imports `checkInCore.ts`, so the brief the notes window previews is the brief ClickUp gets.
- `index.ts`: two operations beside `clientAction`: `blueprintRehearse` (3.7) and `blueprintMembers` (returns `[{id, name}]` of list `901816723196` for the Settings picker, after `cockpit_blueprint_settings_read` admits the seat; GET only).

**One generic addition** in `supabase/functions/cockpit-media-api`: `Plan.has?: {path: "assignees" | "tags"; key: "id" | "name"; value: string}[]`, checked in `executePlan` on the read-back object after `expected` (a tag or an assignee must be present; the rest of the list is ClickUp's). Tested in `core.test.ts`.

### 3.2 The payloads (built in SQL, so the record is the source)

Common: `{v: 1, part, press, card: {id, name}, answers: <that part's keys>, from: <meta.from of those keys>, previous: <parts.N.sent or null>, launchTaskId, sentAt, sentBy: first name, links: {drive, driveFolder, brandDna, offerSheet, research}}`.

- **`blueprintLaunch`** adds `kickoff: {budgetSaid, platforms, adAccount, pageName, cardFunded, consultTypes, templatedStatus, facebookAccess}` (raw strings by ref), `cardBudget` (`handover.daily_budget`), `settings: {assignee, pack: pack.<service>}`, `step4: {taskId, parentId} or null`.
- **`blueprintClose`** adds `service`, `offer` (3.1 if typed), `step2`, `launchCall: {startsAt} or null`, `closeRoute` (the setting at the press), `mapUrl` (`https://mahara-onboarding-map.vercel.app/?phase=5&cid=<card id>`, the form verified against Make 14 module [8] at build time), `csmFirstName`.
- **`blueprintOffer`** adds `dna_status`, `dna_missing`, `step3`, `offerSheet`.

### 3.3 "Send to media" (`blueprintLaunch`)

**Preparation (GETs only):**
1. `GET task/{card}`: the name must match the row's client name (case and spaces ignored), else "The card's name changed since the press. Refresh, then send again." Read the CSM user ID (field `68ff84db-6c66-4e70-8e72-15d70828fda6`, a users field), the Templated Ads Status field and its options (by its pinned ID, name checked), and nothing else.
2. **Find the launch task.** In order: the payload's `launchTaskId` if it is still open; else open tasks on `901816723196` tagged with the card name in lower case (`list/901816723196/task?tags[]=<tag>&include_closed=false`); else up to 3 pages of open tasks there whose normalised name holds the normalised card name and the word "launch" (this catches hand-made ones like "{client} | Launch campaigns after launch call"). **One** → comment there, create nothing. **None** → create. **Two or more** → refuse before any write: "Two open launch tasks match {client}: {links}. Close the extra one in ClickUp, then press Send to media again." (the row stays `pending`).
3. When an assignee is set: `GET list/901816723196/member`; not a member → refuse: "The launch media buyer in Settings is not on Marketing/ADs any more. Choose another in Settings."
4. Step 4: `GET task/{step4}`; its parent must be the payload's `parentId` and its name must start "4 ·". Not found → the step is left out and the brief says so.

**Steps (apply):**

| # | Step | When | Verified by |
|---|---|---|---|
| 1 | `POST list/901816723196/taskTemplate/t-86ex8xaf1` `{name: "{card name} - New Client Campaign Launch 🚀"}` | creating | read-back of `task/$id`: name and list. (The response's task ID is checked against ClickUp's "create task from template" docs and Make 14 module [3]'s output during the build.) |
| 2 | `POST task/$step0.id/tag/{lower-case card name}` | creating | `has` tag |
| 3 | `PUT task/$step0.id` `{assignees: {add: [id]}, due_date, due_date_time: false}` | creating | `expected` due date, `has` assignee. No assignee set → due date only, and the brief's first line says "Unassigned: set the launch media buyer in Settings." |
| 4 | Comment "Brand Blueprint, starter ads" (first press) or "Updated from the Blueprint" (later presses) on the launch task | always | `clickupComment` read-back |
| 5 | Card Templated Ads Status := Approved (starter yes, approval `on_call` or `before`), Wants To See Them First (starter yes, `wants_changes`), Declined (starter no) | when different | `expected` field with option aliases; `precondition` the value read in prep |
| 6 | Creative Onboarding step 4 → the list's done status | starter yes, step found, not already done | as `complete` does: the list's real done status, never a cancelled one; `precondition` current status |
| 7 | Comment on the client card, assigned to the CSM: "Capacity: {Tight or No}. {note}" | capacity tight or no, first press or changed | `clickupComment` read-back |

- **Due date:** the second working day after the press's Kuwait date, Saturday to Thursday (Friday off), 09:00 Kuwait, `due_date_time: false` (the `due()` helper's format). Pressed Wednesday → due Saturday.
- **Assigning** is what makes the hermes task-assignment worker post the task to #client-ads-general (`C0C8DLZGTMZ`), and ClickUp notifies the assignee. No new Slack code.
- **Never written:** Launch Date (`2e744484-…`), Next Payment Date (`669ae046…`), Daily Budget (`539743c2-…`). A corrected budget goes in the brief and is said in the card comment only. A test refuses any plan that names those fields.
- **The brief** (`launchBrief()` in `blueprintBrief.ts`), plain lines, no em dashes:
  ```
  Brand Blueprint, starter ads
  Client: {card name}, {card link}
  Service: Interior design
  Starter ads: Yes. Pack: {link}. Approved on the Blueprint call, 22 Oct 10:11 (Kuwait).
  Offer: the starter pack's own. Their custom offer is locked within 1 to 2 days.
  Daily budget: 40 USD a day (the kickoff said 50; corrected on the call).
  Sends people to: Lead form
  Publishing: Their Page "{page name}" · Ad account "{ad account}" · Card with funds: Yes
  Platforms: Meta (Facebook/Instagram)
  Red lines:
  - …
  Capacity: Yes
  Links: Drive · Brand DNA · Offer Cheat Sheet
  Sent from the Brand Blueprint by {first name}.
  ```
  Starter = no: "No starter ads: build the account and wait for custom ads." in place of the starter and offer lines. The approval line names the assets (the pack), the offer (the pack's own) and the publishing identity, which is what the fast-launch guide counts as approval.
- **A later press** creates no task. Its comment lists only what changed from `previous` ("Daily budget: 50 → 40 USD a day"; "Red lines: added '…'"), and steps 5 to 7 run only when their value changed.

### 3.4 "Close the call" (`blueprintClose`)

Preparation reads the card (Ad Approval Needed?, Can Self-Record?, Onboarding Map, the CSM), the launch task (`launchTaskId`, else found as in 3.3; none → the launch-task comment is skipped and the CSM comment says so) and step 2.

| # | Step | When |
|---|---|---|
| 1 | Card **Ad Approval Needed?** := Yes for `every` or `first_batch`, No for `run_then_show` (the three-way answer stays in the record and the comments) | changed |
| 2 | Card **Can Self-Record?** := `yes_studio` → "Yes - studio/cameraman", `yes_phone` → "Yes - phone only", `no` → "No", `unsure` → "Unsure" | `close_route` is not `make` (in `make`, Make stays this field's one writer) |
| 3 | Card **Onboarding Map** := `mapUrl` | first press, `close_route` not `make` |
| 4 | Creative Onboarding step 2 → done | not already done |
| 5 | Launch-task comment: approval mode, camera, content rating, shot list and its due date, the minimum project and the ad anchor (in the client's currency), the offer line if typed, events | always ("Updated from the Blueprint" on a later press) |
| 6 | Client-card comment assigned to the CSM: 2.20 and 2.21, "Launch call booked for {day, time}" or "Launch call not booked yet", and, when `close_route` is not `make`, "Paste this in the client's WhatsApp group:" followed by the phase 5 message (3.6) | always ("Updated…" later, without the message again) |
| 7 | Slack `chat.postMessage` to #media-general `C0AE8G5MT7Y`: "Brand Blueprint completed: {client}. Scripts and custom creative can start. {launch task link}" (`slackMessage` read-back) | first press, `close_route = slack` |
| 8 | Make: `POST` to `MAKE_BLUEPRINT_HOOK` with `{source: "mahara-cockpit", key: MAKE_BLUEPRINT_KEY, event: "blueprint.call_closed", task_id, card_name, can_self_record, slack_text}`, exactly seven keys | first press, `close_route = make`, **and** the env flag `BLUEPRINT_MAKE_CLOSE = on`, **and** both secrets set |

- **The Make step has no read-back.** It is the last step, sent once; a network failure after sending moves the row to `reconcile`, never to a retry, so a WhatsApp is never sent twice. The provider tool gains a `make` provider that posts only to the exact hook URL from the env, never a path from the payload.
- **`make` chosen but not live** (flag off or a secret missing): the plan falls back to `card_only` (steps 2, 3 and 6's paste text) and its first line says "Make close is chosen but not switched on in the server: the CSM pastes the WhatsApp." No WhatsApp is ever lost.
- **A later press** never posts to Slack, never calls Make and never repeats the WhatsApp text.

### 3.5 "Lock the offer" (`blueprintOffer`)

| # | Step | When |
|---|---|---|
| 1 | Card **Offer Creation** := Done | not already Done |
| 2 | Creative Onboarding step 3 → done | `dna_status = complete` and not already done |
| 2' | Comment on step 3: "Brand DNA still missing: {dna_missing}" | `dna_status` is not complete |
| 3 | Launch-task comment: "Offer locked: {name}: {what}. First step: {firstStep}. Offer sheet: {link}. Custom ads in production." plus the scripts status and date when set | always ("Offer updated: …" on a later press) |

The editor desk's rule (section 4.6) then reads the offer and Brand DNA doc text.

### 3.6 The close switch and its fallback

| `close_route` | Slack post | Card fields 2 and 3 | Phase 5 WhatsApp |
|---|---|---|---|
| `card_only` (default) | none | the cockpit writes them | the CSM pastes it (card comment and the CSM cockpit's copy button) |
| `slack` (once the bot is in #media-general) | the cockpit, through the outbox | the cockpit | the CSM pastes it |
| `make` (once Make 14's route exists and `BLUEPRINT_MAKE_CLOSE = on`) | Make | Make | Make sends it |

- Only admins and the founders change it (CD Settings shows it read-only to the CD).
- **The phase 5 text** is Make 14 module [7]'s Arabic (its whapi-cloud text), copied verbatim from a read-only export of the scenario blueprint on 2026-10-22 into `PHASE5_WHATSAPP` in `blueprintBrief.ts`. Make's `{{9.custom_fields.`Onboarding Map`}}` (the card's map field) is the cockpit's map link (`?phase=5&cid=<card>`):
  ```
  أكملنا المرحلة الرابعة: بناء الهوية والعرض.
  المرحلة التالية: مكالمة الإطلاق.

  اطّلع على المطلوب منك وما سنعمل عليه بعد ذلك:
  <map link>
  ```
  Make always followed it with the content-folder block live since 2026-09-17, filled from the Client Data sheet's folder column; the cockpit adds it, after a blank line, only when the card has a Drive folder, so an empty link is never sent:
  ```
  *إذا ما رفعتوا المحتوى للحين:*
  ارفعوا كل الصور والفيديوهات في مجلد المحتوى الموحد عشان توصل مباشرة لفريق الإبداع والمونتاج:
  <client Drive folder URL>
  ```
  The ship gate test (`blueprint-brief.test.ts`, "PHASE5_WHATSAPP holds Make 14 module [7]'s text") fails if the text is ever taken out again.

### 3.7 Rehearsal (admins and the CEO)

- **Where:** the deck, notes and prep with `?rehearse=1`, and the CD client page with `?rehearse=1`. The seat must have `rehearse` from the gate; otherwise the flag is ignored.
- **Saves stay in memory:** `io.blueprint.save` is an in-memory store seeded from the record; nothing reaches `cockpit_blueprint_save`.
- **Each press** calls `cockpit-creative-api` `blueprintRehearse {taskId, part, answers}`. The Edge Function checks the seat (`cockpit_blueprint_rehearse_payload` refuses anyone else), gets `{missing, payload}`, builds a fake outbox row from it and runs `prepareBlueprint` with the **GET-only provider** (any other method throws "Rehearsal reads only"). It returns `{dryRun: true, plan, lines}`, nothing journalled, nothing queued.
- **The lines** read, for example: "Would create '{card} - New Client Campaign Launch 🚀' on Marketing/ADs from template t-86ex8xaf1", "would tag it '{tag}'", "would assign it to {name}, due Sat 24 Oct", "would comment the brief (14 lines): show", "would set Templated Ads Status: Wants To See Them First → Approved", "would complete '4 · Select Templated Creatives So They Can Launch'". Or "Would comment on the open task '{name}' and create nothing".
- The notes window and prep say "Rehearsal: nothing is saved or sent" at the top. The canvas never says it; the stamp fires as on a real call, so the CEO sees what the client would see.

---

## 4. The creative director cockpit

### 4.0 Design plan (the cockpit's own system, not the deck's)

- **Subject and job.** One client's Blueprint, read by the creative director a day after the call. The card has one job: get the offer locked. Everything else on it is a status he glances at.
- **Tokens.** The cockpit's own, nothing new: Deep Space canvas, cards one step lighter, Geist for words, Geist Mono for times and part numbers, teal only on the one next action (Run the Blueprint call before part 1, Lock the offer after part 2) and the caret, `--success` for sent, `--warning` (orange) for "waiting over 48 hours" and "saved, not confirmed", `--destructive` for "needs a look". No new colour or font.
- **Layout.** A run sheet of three rows (the parts are a real sequence, so they are numbered): mono number, part name, one state with its dot, the time in mono at the end, one action. Part 3 opens under its row into the offer slip.
- **Signature.** The offer slip: the deck's ruled-line typing carried into the cockpit (three labelled lines, a hairline under each, a teal caret, no boxes), so the words he locks look like the words the client saw being typed. The rest stays quiet.
- **Folded.** Once all three parts are sent and nothing changed, the card is one line ("Brand Blueprint: done 24 Oct") with Open.
- **Dashboard and Settings** use the cockpit's existing rows and sections: the sign-off keeps its three-step list; "Offers to lock" is one flush section of rows, orange after 48 hours; Settings gets one "Brand Blueprint" section with three groups.

### 4.1 The Blueprint card (client page)

`src/components/BlueprintCard.tsx` on `ClientPage.tsx`, under the doc chips, for clients in onboarding or with a part open (folded to one line, "Brand Blueprint: done 24 Oct", once all three are done).

```
Brand Blueprint                                   [Run the Blueprint call]
1  Starter ads       Sent Wed 22 Oct 10:12 · Launch task ↗
2  Brand and money   Call closed 10:44
3  The offer         Waiting · 1 day       [Open the offer sheet ↗]
   Your offer  [ name                    ]
               [ what they get           ]
               [ the free first step     ]
   Custom scripts ( In progress | With the editors )  [ date ]
                                                  [Lock the offer]
```

- Each part shows one state: Not started · `In progress · n of m` · Ready to send · Sending… · Sent {time} · Saved, not confirmed (Run it again) · Needs a look: {error} (link to the outbox row) · Changed since sent (Send the changes).
- **Run the Blueprint call** opens the prep view by name (`mahara-prep-{taskId}-blueprint`) at `${portalUrl()}/client-success/clients/{taskId}/present/blueprint?view=prep`, with the deck's `openNamed` logic copied into `src/lib/blueprint.ts` (15 lines; not pinned).
- **Finish part 2** appears when part 2 is open after the call's time: it opens the same prep view at `#part2`, the whole form.
- **Lock the offer** saves 3.1 and 3.4 through `cockpit_blueprint_save` (the same `p_changes` shape and session ID) and presses part 3 as in 3.1. Disabled with the reason while part 2 is open or 3.1 is incomplete.
- `src/lib/blueprint.ts` holds the zod-checked calls (`readBlueprints`, `saveBlueprint`, `blueprintPartDone`, `runBlueprintPart`, `rehearseBlueprintPart`, `readBlueprintSettings`, `setBlueprintSetting`, `blueprintMembers`) and the part 3 labels.

### 4.2 The dashboard sign-off

- `useCreativeSnapshot` reads `cockpit_blueprint_read` for the snapshot's client task IDs beside its own read and hands the rows to `buildSnapshot` as table `blueprints`, mapped to `{_id: taskId, client, parts, offerLine, approval, dnaStatus, dnaMissing}`. A failed read keeps today's "not tracked" note.
- In `creativeSourceModels.ts` the third sign-off becomes **"Brand Blueprint"**, done when parts 2 and 3 are done. Its note: "Starter ads sent 22 Oct · call closed · offer locked 24 Oct", or what is next. `blueprintExpected` keeps the 2026-09-05 cutoff; `tracked` is "the read succeeded", not "rows exist".
- **The offer row:** when part 2 is done and part 3 is not, the client's row reads "Offer waiting · Open the offer sheet · Lock the offer" (the last opens the client page at `#blueprint`). After 48 hours it turns orange. No new notification.
- `brandDnaStatus`, `stillMissing`, `approvalNeeded` and `offerSheet` read the record (2.13, 2.12, the card link).

### 4.3 Settings: Starter packs, the launch media buyer, the close switch

A "Brand Blueprint" section in `SettingsPage.tsx`:
- **Starter packs:** five rows, one per main service in the kickoff's order and words, each a Drive folder link field with Save, "Preview" (the Drive folder view in a 480 x 300 frame, so the CD sees it render), and its last change ("Set 22 Oct by {first name}"). The hint: "Share each folder as Anyone with the link, Viewer, or the deck shows Open the pack instead." Until a service has one, part 1 asks for the link.
- **Launch media buyer:** a picker of list `901816723196`'s members (`blueprintMembers`), saved as ID and name. Empty: "Launch tasks go out unassigned, so nobody is pinged."
- **After Close the call:** the switch, read-only for the CD, editable for admins and the founders, with each option's line from 3.6.

### 4.4 The Links page fix

In `src/lib/creativeLinks.ts`, group "The Brand Blueprint call": remove the bare Typeform row and its "client fills it before the call" label; add "The Blueprint call deck: open it from the client's page (Run the Blueprint call). You fill it with the client on the call; the client never fills a form." with no URL (a row without a link renders as a note). The framework doc and the booking link stay.

### 4.5 The sync's card fields

`hermes/cockpit-sync/creativeProducer.ts` `CLIENT_FIELDS` gains `offerCreationStatus: "Offer Creation"`, `templatedAdsStatus: "Templated Ads Status"`, `canSelfRecord: "Can Self-Record?"`, `adApprovalNeeded: "Ad Approval Needed?"` (dropdowns resolve to their labels in `fieldsOf`). They are reads, so the cockpit and `cockpit_blueprint_sources` see what the outbox wrote. A VPS deploy of the sync, done by the person who ships.

### 4.6 The editor desk (hermes)

`hermes/editor-desk/desk.py`'s doc sync reads the Brand DNA and offer text for clients whose `parts.3.firstAt` is within 14 days, as well as those with open video jobs. Its own test; a VPS deploy. Step 7 of the build order.

Built (2026-10-23): `Supabase.blueprint_parts` reads `task_id, parts` from `cockpit_blueprints` (service key, rows changed in the window), `clients.offers_locked_since` keeps the cards whose part 3 was first sent in the last `OFFER_RECENT_DAYS = 14`, and `clients.docs_wanted` adds those roster rows to the companies with live work, each once. A failed read (or the table not applied yet) is a warning and the sync goes on as before. Tests: `BlueprintOfferDocsTests` in `tests/test_desk.py`. The VPS deploy is the shipper's.

### 4.7 Where the call window is served, and the gate

- In the client success app (`AuthenticatedAppRoutes.tsx`), a route group before the CSM one:
  ```tsx
  <Route element={<RoleRoute anyOf={["csm", "creative"]} />}>
    <Route path="/clients/:key/present/blueprint" element={…<PresentPage deck="blueprint" />…} />
    <Route path="/clients/:key/present/blueprint/notes" element={…<PresentPage deck="blueprint" notes />…} />
  </Route>
  ```
  The static segment outranks `:deck`, so `/present/onboarding` and `/present/launch` stay CSM-only. Admins and the CEO pass `RoleRoute` as today. Both apps share the portal origin and the Supabase session, so a CD signed into `/creative/` is signed in here.
- The server decides: `cockpit_blueprint_gate_for_actor` (2.2). A CSM opens the deck read-only: fields disabled, the three buttons replaced by "Only the creative director sends the parts."

---

## 5. The call deck

### 5.1 Engine integration (files)

| File | Change |
|---|---|
| `src/present/sources.ts` | `DeckKind = "onboarding" \| "launch" \| "blueprint"`; `prepRow`'s enum unchanged (the server sends only the CSM decks). |
| `src/present/decks.ts` | `DECKS.blueprint = blueprintSlides`; `TARGET_MINUTES.blueprint = 45`. |
| `src/present/content.ts` | `DECK_NAME.blueprint = {en: "Brand Blueprint", ar: "بناء الهوية والعرض"}`. Nothing else: the Blueprint's words live in `blueprintContent.ts`. |
| `src/present/blueprintContent.ts` (new) | Every on-screen string EN/AR, the 14 titles, the per-slide notes (`SlideNotes`), tags. Added to `scripts/deck-copy.test.ts`'s scanned files. |
| `src/present/blueprintForm.ts`, `blueprintPrefill.ts`, `blueprintBrief.ts` (new, pure) | Sections 1.7, 1.5, 3.3 to 3.6. `blueprintBrief.ts` imports only pure relative files (the Edge Function bundles it). |
| `src/present/blueprintData.ts` (new, pure) | `blueprintData(d, loaded, answers, lang, now)`: the parts' states, prefills per key, the wall's frames (empty or filled), the parked services, the pack, the booking, the stamp, the dates (shot list, offer lock, launch). |
| `src/present/blueprintDeck.tsx` (new) | The 14 `SlideDef`s (5.3). |
| `src/present/BlueprintNotes.tsx` (new) | The notes window's Blueprint section: the parts bar, the slide's private fields, the mirror of what is typed on the slide, "What media gets" (the brief preview), the part buttons and their runs, conflicts, "Check the booking". |
| `src/present/BlueprintPrep.tsx` (new) | The prep view (5.7). |
| `src/present/blueprintSources.ts` (new) | zod-checked calls: `readBlueprintSources`, `saveBlueprint`, `blueprintPartDone`, `runBlueprintPart`, `rehearseBlueprintPart`. Errors in plain sentences, through `problem()`. |
| `src/present/blueprintSaver.ts` (new) | 2.4. |
| `src/present/deckData.ts` | `deck === "blueprint"` reads the service as the launch deck does (kickoff first); nothing else changes. |
| `src/present/useDeckModel.ts` | `prep.blueprint` (the answers) and a `BlueprintSaver` for it; `setPrep("blueprint", …)` goes through it; `bp-saved` and `bp-part` handled. |
| `src/present/channel.ts` | Messages: `prep` with deck `blueprint`; `bp-saved {values, revision}`; `bp-part {part, phase: "queued" \| "running" \| "done" \| "failed" \| "rehearsed", at, requestId, lines?, error?}`; `bp-conflict {key, theirs, by, at}`; `bp-reread`. |
| `src/present/PresentPage.tsx` | Accepts `deck` as a prop for the new routes; for `blueprint` builds `io` from `blueprintSources.ts` (and the in-memory store under `?rehearse=1` for admins and the CEO). No tray, no videos, no booking button. |
| `src/present/PresentApp.tsx` | For `blueprint`: `BlueprintNotes` in the notes window, `BlueprintPrep` in prep, and `ctx.bp` (the blueprint model and its actions) on every slide. |
| `src/present/NotesWindow.tsx`, `PrepView.tsx` | Mount the Blueprint sections when `deck === "blueprint"`, as they mount `LaunchControls` and the kickoff today. |
| `src/present/DeckShell.tsx` | `data-deck={deck}` on `.dk-root` (one attribute), so the Blueprint's tokens scope to it. |
| `src/present/present.css` | Section 24: the Blueprint's tokens on `.dk-root[data-deck="blueprint"]` and its `.dkb-*` rules (5.4, 5.5). In this file so the motion and token tests cover it. |
| `src/present/PresentButton.tsx` | `deckUrl` accepts `blueprint` (the CSM's "Open the Blueprint deck"). |

Byte-pinned files are not touched: `src/present/layout.ts`, `figure.ts`, `fig.tsx`, `platforms.tsx`, and the shared `src/lib` files in `scripts/check-shared.sh`.

### 5.2 The call: 14 slides, 45 minutes

Part 1 is sent by minute 10, at the end of slide 5. Minutes add up to 45; the run sheet (slide 3) shows the same starts.

| # | id | Start · min | Title EN / AR | What the client sees | Form typed or tapped on the slide | Private in notes | Stops | Notes line |
|---|---|---|---|---|---|---|---|---|
| 1 | `cover` | 0 · 1 | {Company} · "Brand Blueprint call · {date} · 45 minutes" / مكالمة بناء الهوية والعرض، {date}، ٤٥ دقيقة | Their name as the display line (Arabic name under it), the lead line, "With {first name}, our creative director" (the role alone when the record has no name, or a CSM seat reads the deck), the **three frames waiting** (Your words · Your look · Your offer): open frames of teal tape on the felt, four thin strips crossing at the corners and the wall showing through, each label stuck inside its top edge and its hint on the felt under it, as the Studio Wall mockup had them (design pass, score round 2: blank paper mats with crop marks read as empty upload fields), in one tight cluster with 60 px gutters; their logo, when verified, pinned inside "Your look" in its hint's place (score round 2: the hint stayed printed over it and the crop marks poked out beside it); under it the **photo print** (their own upload when the record has one, "From your photos", else their service's example render, "Example photo"); the amber sticky "Have your price list near you. We'll ask for real numbers." under the byline, so the title column runs to the wall's foot as the frames do. Once part 1 went (sent, closed, locked), the cover shows the wall as far as it got: their method's first line pinned in "Your words", the offer's name in "Your offer" (design pass, score round 1). | none | the prep check: part 1 confirmed? offer sheet open with your draft? | 1 | Join 5 minutes early. Introduce yourself as the creative director; the CSM is not on this call, by design. |
| 2 | `so-far` | 1 · 1 | What you've told us / اللي قلتوه لنا | Their 90-day goal as the onboarding deck shows it (`shownGoals`: a goal that counts enquiries or appointments is held back), **the service as one teal chip** on its card, "The service we start with" (the fan is slide 4's moment, never repeated here), "The clients you want more of" (2.1 summary), "Never in an ad" (1.9) on ruled paper, each line in its own direction (an English line in the Arabic deck reads left to right), the red lines' card as tall as its lines, its slot for the next line out of sight at rest (a faint pencilled "+ Add a line" under the presenter's pointer only; gone after the call), sticky "Anything wrong? Say it now. It saves as we talk." pinned under it at the column's end; one piece of tape on every card. A card with nothing of theirs is not drawn: with neither the clients nor a red line on file, one large amber sticky says "The clients you want more of, and what never goes in an ad: we write them together now."; the first words typed in the notes window pin their card, live. The two columns are centred together between the title and the foot. Every source mark one style (teal dot, mono). No money. | 2.1 corrected on ruled lines; 1.9 lines added | 1.1, 1.3, 1.6 confirms | 1 | Read it back. Fix anything wrong on the slide now; it saves as you type. |
| 3 | `today` | 2 · 1 | The next 45 minutes / ٤٥ دقيقة، خطوة بخطوة | The **run sheet**, counted by the minute (5.3), each part with its own bracket in the margin (none inside another; part 3 dashed, on a last row "After · Your offer, locked with you"), and a card of three rules at 40 px on the sheet's foot: "We'll push back when something won't sell. Be specific on money. 'I don't know' is a fine answer." | none | | 1 | Three minutes at most, then straight into their business. |
| 4 | `one-service` | 3 · 3 | One service. One offer. / خدمة وحدة. عرض واحد. | **The fan's moment.** Stop 1: the **paint fan** large: the five main services, the kickoff's pick lit teal (two picks: both amber, "Which one goes first?"), the kraft "Parked for later" tag, its middle on the fan's (y 560), holding the other services they offer in their words. Stop 2: the strips not chosen slide off the fan into the tag, which is lifted and pinned again as they set off; each is written on the tag only as its strip lands there, its label fading as it nears (design pass, score round 2: the flying label printed over a row already written), the four parked main services, then "Also on your list" and their words; the pick rises, the fan folded under it, the pick and its line centred on the tag's middle: two blades fanned a few degrees down, the stubs of their labels at their far ends, and the line 32 px under the fold. Nothing lit and no two asked: the tag is titled "Also on your list", and the slide is one stop until a strip is tapped. "One service per campaign. The others wait their turn." | 1.1 (the pick) | 1.2 capacity (+ note) | 2 | One service. Margin wins over capacity; a capacity risk goes to the CSM in writing, never into this conversation. |
| 5 | `first-ads` | 6 · 4 | Your first ads, while we make yours / إعلانات البداية، لين نجهز إعلاناتكم الخاصة | Stop 1: **the starter ads, shown as ads pinned to the wall as prints** (design pass, score round 2: hand-drawn phones with a notch, a status bar and a tab bar were re-drawn app chrome, Hallmark gate 47): three prints, each the lit service's example picture over the ad's own strip (the client's Page name, then the ad's one line: their selling line, else our example caption), each tagged "Example ad" / إعلان للتوضيح on a paper label under it, with the place it runs under that (the Instagram feed, Stories and Reels, the Facebook feed, each with its mark); beside them three short lines on what the pack is ("Ready-made ads for {service}, from our templates." · "You see them, and say yes, before they run." · "They run while we make yours, from your photos and your words.") (the real pack opens from the notes window, in its own window; no button on the canvas, and Drive is never framed); under the Stories and Reels print, "Stories and Reels" on one line. Stop 2: the **Part 1 sheet** (straight, flat paper, as tall as its rows, in the middle of its room) with the service chip "From your kickoff", **Yes / No and the approval answered in pen** (each answer a small paper chip in ink, theirs circled with a pen loop in the stamp's teal ink; never a segmented control nor grey words: design pass, score round 2), the red lines on ruled lines as slide 2 writes them (never a boxed field; none yet, the presenter's pencil note "We write this now"; no service yet, "We pick it now") with one grey helper line under them ("Our media team gets this when we send it."), the fold "Kept in our notes, off this screen: {n} answers for our media team", and the stamp's place beside the red lines (no box). The parts list beside the sheet is drawn as the run sheet draws the parts (a teal rail, "Part 1" in mono, part 3's rail dashed), never numbered circles; it ticks part 1 in pen with the stamp, its line turning to "Sent to our media team" as the stamp lands, never before. | 1.3, 1.5 | 1.4, 1.6, 1.7, 1.8; **Send to media**; "What media gets" | 2 | Show the pack, get their yes, then press Send to media before you leave this slide. |
| 6 | `best-at` | 10 · 6 | What you're actually best at / اللي تتميزون فيه فعلاً | The **"Your words" frame fills**: the method card is the frame (its label on the paper's edge, no outline), in one row with three taped notes beside it, the row as tall as its taller side. Stop 1, **their method typed on the paper** (ruled lines growing with the words; nothing typed yet, blank paper with the presenter's pencil note "We write this together", never rules or a grey example: design pass, score round 2), the struck line on its own small note pinned across the paper's top-end corner (their own earlier line when the record has one, tagged "Your words before" / كلامكم من قبل; else the generic "Quality work, delivered on time.", tagged Example / مثال), and "The clients you want more of" beside it; each paper as tall as its words. Each stop lifts the paper it asks about (6 px, a deeper shadow, its tape tugged) and sinks the rest into the wall (5.5): stop 1 the method, stop 2 "The clients you want more of" and "Who you don't want", stop 3 "What most firms in your city can't do". The row sits in the middle of its room and ends by y 940 in both languages. The first time the method is let go of, a copy of its first line flies into the wall map (5.5). | 2.3, 2.1, 2.2, 2.4 | | 3 | A method, not an adjective. Type their words, not yours. |
| 7 | `pricing` | 16 · 5 | Your projects, in numbers / مشاريعكم بالأرقام | A **steel tape drawn to their numbers**: from nothing to a round number past the highest; the smallest project and where the ads point each a mark at its value; the range typed for where most land a shaded band with its two numbers and "Most projects" over it. A few round values are printed along the tape, each on its own long tick, none inside a band that prints its own numbers nor beside a mark (design pass, score round 2: past the band's ends the ruler had no numbers). The amounts are typed on two kraft **swing tags** under the tape, the offer tag's material (score round 2: a paler manila made two materials for one object), **each tied by its string from the tag's hole to its own mark** (the tag is the mark's flag; design pass, score round 1: the strings dropped at fixed places and reached no number). An amount not typed yet hangs at its example value, a dashed mark, its tag saying "e.g. 60,000 SAR" as the presenter's pencil note, never an input's grey placeholder (in their currency); an example that does not fit the range they gave is left off, its string tied to the tape straight above its tag. Between the tags "How you price, and where most projects land", their onboarding form's words in full ink, marked "From your onboarding form" until corrected here (the tape draws the form's range). Stop 2 lifts what is on the wall from stop 1, sunk: deposit terms (none yet: blank paper with a pencilled "30 / 40 / 30?" tagged Example, never two empty rules) and the call centre's filter line as an example ("Our projects start from {minimum}. Is that within what you had in mind?", tagged Example wording / صياغة للتوضيح; with no minimum yet, the tag's example amount, never a blank to fill), ending above y 960. | 2.6, 2.5, 2.7, 2.8 | 2.9 margin | 2 | Specific numbers for the minimum and the anchor; a range only for where most land. Ask for a photo of a real quotation into their Drive. |
| 8 | `competitors` | 21 · 3 | Who you're up against / مين تنافسون بالسوق | Each name is a **clipping** pinned to the wall (straight paper torn at its foot, one piece of tape; typed live, so never turned): the name as its headline, a small kraft "We lose to them" tag when they do (a tap on the name; never amber, which is the client's to-do on slide 14: design pass, score round 2), and "What they're known for" typed under it (none yet: the pencil note). The next name is typed straight over an example clipping, its example name and note struck through as slide 6's line is (score round 2: a blank clipping with pencilled rules read as an input). A clipping is as tall as what it holds. While the call is on, five across the wall: example clippings, ours, in full ink and each labelled Example, fill the row's free places (design pass, score round 1: four notes left a 340 px hole, and faded examples read as disabled). A long name steps down a size, then another, to three lines, and is never cut. After the call: only theirs, as wide as the row allows, no blank clipping and no empty "known for" line. At most ten on the wall, the rest counted. Under them, "Why people pick you instead" on ruled lines, on the wall from stop 1, stepped back; stop 2 lifts it and the clippings step back. | 2.10, 2.11 | the Market Research list (S), to add from | 2 | Who do they actually lose to, and why? |
| 9 | `offer` | 24 · 9 | Let's build your offer / خلونا نبني عرضكم | The **kraft offer tag** as a checklist of its five ingredients (the pattern, its name, two or three bonuses, the price your ads point to, the free first step and who gives it): each line a hole punched in the tag, the wall through it; a line the record holds is written on it and ticked in pen in its hole's place (design pass, score round 2: the hole showed through the tick) (the name and first step from the 3.1 draft, the price from slide 7); the foot says once where the rest is; "Draft · locks in 1 to 2 days". The tag is a quarter larger than it was and toward the wall's middle (score round 2: the left half stood empty), its labels 28 px and more; the lead (46 px) sits beside it, its middle on the tag's. Stop 2, while the CD shares the sheet's own window: the lead says "Now we open your offer sheet together. It locks in 1 to 2 days, with you." and the tag lifts (no card for the sheet on the canvas: design pass, score round 1). | 3.2 (Share the offer sheet, from notes) | the 3.1 draft; the first-step suggestion | 2 | Share the offer sheet window; start from your pre-written draft, so they correct it instead of facing a blank page. |
| 10 | `how-ads-work` | 33 · 3 | How paid ads work / كيف تشتغل الإعلانات المدفوعة | Stop 1, the launch deck's **two roads** as paper strips, "Someone referred to you · They trust you before they call." and "Someone who saw your ad · They meet you for the first time.", meeting at one card, "The same client": "Same person, same money. The only difference is trust." on the strips' edge. Everything lands in the argument's order: the referral, the ad, the curves, the client, the conclusion, the tape, the choices. Stop 2, a roll of kraft tape comes on at the strip's start, rolls along the line and is gone at its end as the tape unrolls behind it (scale and translate only; the roll is on the wall only for the unroll, never parked on stop 1: design pass, score round 2, Hallmark gate 45; a second step before it ends lands the tape at once), sixty day ticks, "Your ads learn for 30 to 60 days. Volume beats luck." (slide 7's steel tape stays the only ruler). Stop 3, **three paper tabs held in one steel clip** at their foot, on the wall from stop 1 stepped back; their pick is pulled up out of the clip and its name circled in pen (never a radio). No results promise. | 2.12 | | 3 | Hold the frame: volume beats luck. Let them choose how they approve. |
| 11 | `brand` | 36 · 2 | Your brand, on one page / هويتكم بصفحة وحدة | One stop, one page, the cover's promise kept: the **"Your look" frame fills** as the Studio Wall had it: a **material board** (four swatches cut close from their own project photos, else from their service's example renders, each named by its material, "Example materials"), a **type specimen** ("Aa", their name in Latin and Arabic; when their Brand DNA doc names a serif for the wordmark, "Aa" and the Latin name set in a system serif and the foot "Set as your doc describes", else the deck's own faces and "Example pairing": design pass, score round 2, an example grotesque beside a doc naming a serif contradicted it), **named colour chips with their codes** (the names and hex codes from their Brand DNA doc, "From your Brand DNA doc"; with none, an example palette so labelled), their logo as a print (none: a blank print with crop marks), and the Brand DNA doc pinned beside it with what it says about type. The frame is the board's height, so its corner tape holds the board. The doc's type line is its label alone ("In your doc" / بملف هويتكم), then their own words on a line of their own in their own direction. Beside them the three short lists as chips, as the Studio mockup had them: Always (a tick), Never (a cross; a chip is never struck through, since a struck "No discounts" reads as a rule taken back), Never show; each list's slot for the next line is out of sight at rest. With nothing on any list yet the three fold into one card, each list a dashed chip "We add these together" (score round 2: three empty white boxes read as textareas); after the call, only the lists that hold lines. The Never list starts from their red lines and says them once ("Your 3 red lines, from the start of this call", opened on the presenter's hover), keeping "From your onboarding call" until a line is changed here. | 2.14 | 2.13 DNA status (+ missing) | 1 | If a Brand DNA section is blank, open their doc in its own window and say what is missing. |
| 12 | `content` | 38 · 2 | What we need in 72 hours / اللي نحتاجه منكم خلال ٧٢ ساعة | Four polaroids (You, talking to camera · Your site or workshop · A finished project, walked through · Before and after), each holding a plain example still of their service tagged Example (a before and after split on the last; no drawn overlay), across the wall; under them **a paper card with the camera question, its four answers small paper chips in a row**, theirs circled in pen ("Yes, with a camera crew or a studio" first; design pass, score round 2: four options on an amber card read as a radio question, and amber is the client's to-do alone), on the wall from stop 1 sunk and not tappable, lifted on stop 2; the polaroids hold the full renders, never the soft tiles; beside it the amber due sticky "By {day, date} · Four shots from you, in your Drive folder. A phone is fine." Their Drive folder opens from the notes window (no button on the canvas; the link is never shown). Nothing moves between the stops. | 2.15; the due date shows when 2.17 is ticked | 2.16, 2.17 tick, 2.18 | 2 | If the 72 hours slip, the starter ads keep running and we swap theirs in. |
| 13 | `read-back` | 40 · 2 | Here's what we're building / هذا اللي بنبنيه لكم | **The wall, full**, its three frames growing out of the wall map on arrival (5.5): Your words (the method, one line, on its own paper; blank, the cover's open frame holding the amber note), Your look (small: their logo or the specimen's "Aa", the named colours, two swatches, each example labelled where it sits), Your offer (paper as tall as its rows, the offer as a **feature headline** and a **who / what / first step** table under it, typed live; not built yet, only what exists, a row with words, and the amber note "We finish this in your offer sheet." set large across the paper; nothing at all yet, no paper: the cover's open frame, as tall as the two beside it, with the note in its middle (design pass, score round 2: a 960 x 580 white card held one sticky); never empty rows or placeholders), the money lines right under it. A blank method shows the amber note "Your method, in one line: we write it with you." in its open frame, never a grey placeholder. In Arabic each table value starts beside its label, whatever its own direction (score round 2: English values sat 500 px from their labels). Tape only where paper meets felt. Under them, two short ruled lines: "Projects from {minimum}. Your ads point near {anchor}." and "Starter ads: live once your account is ready." (no starter ads: "Your own ads: at your launch call."; unset reads as starter ads, as slide 14 does), and the amber sticky "You send us four shots by {day}." | 3.1 | 2.19 the yes | 1 | Read it out loud, then wait for a yes. Tick it in your notes. |
| 14 | `next` | 42 · 3 | What happens next / الخطوات الجاية | Stop 1, the **clothesline**: Today ("Part 1 sent. Your starter ads are with our media team." only when part 1 is done on the record or this call's press landed; else "Part 1: we send it before we hang up.") · {date} your offer, locked with you · {date} your four shots (amber, yours) · once your account is ready, starter ads go live · {date} "Launch call: your own ads, your form and our questions." (not booked: headed "Launch call", its line "Your own ads, your form and our questions.", so it never says "To book" over the booking card: design pass, score round 2). The line runs from margin to margin (x 120 to 1800) and hangs lower; under it, from stop 1, the launch call waits as an open frame with its name (score round 2: a sunk card with big bold words read as a disabled control). Stop 2 lifts the launch card off its peg (straight, 10 px up; never a ring) and pins the call card into the frame: the booked day and time, or "We book it together now". | the booking (opens GHL's launch booking page in its own window) | 2.20, 2.21; "Check the booking"; **Close the call** | 2 | Book it now, in its own window, together. Then press Close the call. |

Starter = no changes four lines: slide 5's stop 1 becomes "Your own ads first" with the four-shot list's preview; slide 13's starter line drops; slide 14's first card reads "Part 1 sent. Our media team sets up your account." and the "starter ads go live" card drops.

No kickoff: slide 2 shows only what the onboarding form holds; slide 4's fan has no lit strip and asks "Which service do we start with?".

### 5.3 Slide by slide: layout and live fields

The canvas is 1920 x 1080 with 120 px side margins and the chrome (logo at the start, "n / 14" in mono at the end) at the foot. Positions below are the English layout; Arabic mirrors every horizontal position (`inset-inline-start`), the fan's pivot, the tape and the clothesline's order.

1. **Cover.** Dateline in mono at y 150; the name at 128 px (two lines at most; a longer name steps down to 104 px, as the CSM covers do); the Arabic name at 46 px; the lead at 38 px, width 780. Right half, one cluster with 60 px gutters: Your words (1000, 140, 440 x 290) over Your offer (1000, 490, 440 x 270), Your look (1500, 140, 300 wide, 400 tall with a logo under it, 620 without). Each frame waits open (`.dkb-outline`): four strips of `--dkb-tape-frame` 18 px wide along its edges, crossing 16 px past its corners, the felt showing through, its dymo label at (30, 34) inside the top edge and its hint at 27 px in `--dkb-vinyl-2` on the felt under it; the strips, the label and the hint share one arrival, so no label floats alone before its frame (design pass, score round 2: pale paper mats with crop marks read as empty upload fields, and the label had arrived first). A frame that holds something (`holds`) shows it in its hint's place: the verified logo, a print 220 x 150 inside Your look (score round 2: the hint stayed printed over it and the crop marks poked out beside it). Filled (once part 1 went), the client's paper is the frame, as on slides 6, 11 and 13. The sticky (440 wide) under the byline. Byline: "With {first name}, our creative director" when the record names the presenter and the seat is a creative one; else "With our creative director". In Arabic the named byline puts the name with the team, «مع {first name}، من فريقنا الإبداعي», never beside a gendered role (score round 2: «مع Sara، المدير الإبداعي»); the unnamed one keeps the shared word, «مع المدير الإبداعي». Teal area on the cover: twelve thin strips, the photo's tape and three labels, about 4.5 % (the shot check holds it under 5 %).
2. **So far.** Left: the goal card (790 x 320, its source as a teal mark beside its label) and the clients card (790 x 336, live, straight, ruled; ends at y 966). Right: the service card (790 x 170) with the lit service as one teal chip (two asked: two amber chips and "Which one goes first?"; none: "We pick it together in a minute." as the presenter's pencil note), the sticky on its end corner, then the red-lines card (790 x 486, live, straight, ending at y 966): its lines on 56 px rules, each line `dir="auto"` (an English line in the Arabic deck is laid out left to right, its dash on its left; a hyphen never breaks it), five shown at most; the slot for the next line keeps its room under them but is out of sight at rest, a faint pencilled "+ Add a line" only under the presenter's pointer or with focus, and gone after the call (design pass, score round 1: "Add a line" in grey read as a web input on the client's screen). The two columns are one grid (790 + 100 + 790) centred between the title and the foot; a card with nothing of theirs is not drawn (one large sticky instead, 2 above). With no red lines on file the second column, its sticky set larger (600 wide, 34 px), sits on the first column's middle (design pass, score round 2: it ended at y 640 with 800 x 330 of bare wall under it). The wall map in the foot is named once, here: "Your wall" / جداركم in mono at 18 px, just before it.
3. **Run sheet.** A paper sheet 1040 x 870 pinned at 0.6 degrees, mono minutes in a 112 px column, 72 px rows, one rule per row, each part its own teal bracket in the end margin, none inside another: "Part 1 · Starter ads · sent by minute 10" (rows 1 to 2), "Part 2 · Brand and money" (rows 3 to 8), "Part 3 · after the call, in 1 to 2 days" (dashed) against a ninth row under a dashed rule, "After · Your offer, locked with you" / "بعدها · عرضكم، نثبته معكم". The rules card (580 wide, 0.8 degrees) is as tall as its three rules, each at 40 px on its own rule, its top on the sheet's first row (y 272) (design pass, score round 2: equal thirds of a 668 px card left 150 px of blank paper between rules); in Arabic the card and its tape start 24 px lower, clear of the title's descenders. Rule 3 reads "It's fine to say you don't know." (no quotation marks at 40 px; copy rule 9 keeps quotes plain). Rows:

   | Min | EN | AR |
   |---|---|---|
   | Start | What you've told us | اللي قلتوه لنا |
   | 3 | One service, and your first ads | خدمة وحدة، وإعلانات البداية |
   | 10 | What you're best at, and your numbers | اللي تتميزون فيه، وأرقامكم |
   | 21 | Who you're up against | مين تنافسون بالسوق |
   | 24 | Your offer | عرضكم |
   | 33 | How ads work, and your brand | كيف تشتغل الإعلانات، وهويتكم |
   | 38 | What we need, and the read-back | اللي نحتاجه، ونراجع كل شي |
   | 42 | What happens next | الخطوات الجاية |

   Arabic minutes in Arabic-Indic digits; the first row says "Start" / البداية, never a lone ٠.
4. **One service.** Two stops. The fan at full size (pivot 180, 760), the lit strip 820 x 96 at 38 px; the kraft "Parked for later" tag (1120, 680 wide, 0.8 degrees, its middle at y 560, on the fan's) lists the other services they offer in their words (`<bdi dir="auto">`, any that is the lit service left out). Stop 2: the strips not chosen slide off toward the tag and are gone (`data-gone`), and the tag names them first, the four parked main services, then "Also on your list" over their words; nothing parks until a service is lit or two are asked. Once the others have left, the lit strip rises at 1.1, folded over two blades whose far ends and label stubs show, and its line follows 32 px under the fold, the two centred on the tag's middle (design pass, score round 2: they sat high, 300 px of wall under them; score round 2 of the deck: a lone strip in the bottom corner read as a failed load; design pass, score round 1: one grey slab read as a button's shadow). The tag is lifted and pinned again as the strips set off, and each parked service is written on it only as its strip lands there, the strip's own label fading as it nears the tag (score round 2: the flying label printed over a row already written); their own words land after the four (transform and opacity only: it never grows by animating heights). Tapping a strip on the canvas sets 1.1 (with "Launch with this"-style confirm in notes: one tap, Undo for 10 s).
5. **First ads.** Stop 1: the title column (600 wide) holds three numbered lines on what the pack is, over hairlines; the pack itself opens from the notes window ("Open the pack", its own window), never from a button on the canvas (design pass, score round 1). The prints row (780 to 1800, 40 px clear of the title in both languages): three prints 300 wide, 60 apart, each pinned with its own tape at under 1 degree (`.dkb-adprint`): the example picture of the lit service's scenes cut 4:5 (`SCENES`, lead then alternates; with nothing lit, the deck's own pick; the full feed and story renders), under it the ad's own strip in print ink, the client's Page name in kraft and the ad's one line, their selling line or, with none, our example caption "{Service}, from the first call to the handover." (never empty); under each print its "Example ad" label on paper, then the platform mark and the place it runs (the Instagram feed, Stories and Reels, the Facebook feed). Never a hand-drawn phone, status bar or tab bar (design pass, score round 2: re-drawn app chrome, Hallmark gate 47); the pictures hold still (no slow drift on this deck, `--dk-t-drift: 0`). The pictures are fetched while slide 4 is up. Never a Drive frame, never a city landmark (the example set has none). Stop 2: the sheet 1040 wide in its room (760, 104, 856 tall), straight, **as tall as its rows and centred in the room** (design pass, score round 1: a sparse sheet held a blank half), so the fold row is never cut in either language (score round 2), its two blank back sheets at 0.3 and 0.9 degrees following it and arriving with it (never a grey slab first); no tabs, since the parts list beside it names the three parts; fields as in the Studio mockup's slide 3, each with its source mark ("From your kickoff"; amber "Just now" while it is being saved, then teal "Said on this call"); Yes / No and the approval are answered in pen: each answer a small paper chip in ink, theirs circled with a pen loop (`.dkb-pen[data-chips]`, `.dkb-ring`; design pass, score round 1: segmented controls read as a web form; score round 2: grey words in a row read as a form's options); a row not answered yet is the presenter's pencil note ("We pick it now", "We write this now"), never grey options or blank rules; the sheet and its back sheets arrive with the press itself; one grey helper line under the red lines, its room kept after the press so the sheet never moves; the stamp lands beside the red lines, 20 px under their source mark, and the parts list's part 1 ticks as it lands (the number held, then the tick, after the stamp's 240 ms). Declined (starter = no): "Your own ads first" is stuck on the four shots' top edge, as a frame's label is on its paper.
6. **Best at.** The method card is the "Your words" frame (1060 wide from x 120, the row centred in y 268 to 940; its height its words'; its label and tape land with the paper): the label on its top edge, tape across its top-end and bottom-start corners, no outline. On it, the **live ruled lines** (48 px, 64 px rule, teal caret) for 2.3, growing with the words from one row (design pass, score round 1: seven empty rules read as a textarea); past four rows the text steps to 40 px. Nothing typed yet: blank paper and the presenter's pencil note "We write this together" (`Prompt`), on the three notes too (score round 2: rules and a grey example read as inputs and a placeholder). The struck line is on its own small note (`.dkb-eg-note`, 340 wide, paper a shade darker, 0.9 degrees, its own tape) pinned across the method paper's top-end corner, the label keeping clear of it: their own earlier line, tagged "Your words before", when the record has one (the selling line typed in prep), else the generic example, tagged Example. Each paper is as tall as its words, the two sides on one middle. Beside it, all three notes from stop 1, at 27 px on 40 px rules so the row ends by y 940 in Arabic too. Each stop lifts its paper (`data-active`: `translate: 0 -6px`, a deeper shadow, the tape tugged 3 px) and sinks the rest (`data-dim`, 5.5); the pin's arrival now fills backwards only, so it never holds an opacity or a transform over them. The method's flight into the map lifts a paper copy 600 px wide at 40 px for its first 300 ms before it flies small.
7. **Pricing.** A steel tape 1680 x 96 at y 316, **drawn to the numbers** (score round 1: marks at fixed places drew an anchor inside the typical range at the tape's far end): it runs from nothing at its start to a round number past the highest value (`tapeMarks`: 1.12 times the highest, rounded up; one amount alone sits a quarter of the way); the smallest project is a print mark and where the ads point a teal mark, each at its value, each tied by a string from its swing tag's hole to the mark's foot, with a teal tack there (`.dkb-strings`, drawn once the tags have landed; the tag is the mark's flag, so the marks carry no flags of their own); the range read from "where most land" (`bandOf`: the first two amounts in their words, "180,000 and 260,000", "180k", "١٨٠ ألف") is a shaded band with its two numbers on it and "Most projects" over it. The amounts are typed into labelled cards under the tape (Geist with tabular figures, 44 px, as are the flags and the band's numbers: score round 2, Geist Mono drew "60 , 000"; the currency from the client's country, changeable in notes; empty, the example "e.g. 60,000 SAR" by currency, the presenter's pencil note at 30 px on the tag, never the field's grey placeholder). An amount not typed yet hangs at its tag's example value as a dashed mark, its tag saying "e.g." in pencil, with no rule under it (an example that does not fit the range they gave is left off, its string tied to the tape straight above its tag). A band too narrow for its two numbers says them on its flag instead ("Most projects: 180,000 to 260,000"). The scale: the round step (1, 2, 2.5 or 5 of a power of ten) that prints closest to four values short of the tape's end, each at 19 px under its own 28 px tick (`.dkb-tape-num`), none within 72 px of a mark nor inside a band that prints its numbers (design pass, score round 2). The two tags are kraft (`--dkb-kraft`, the hole ringed in `--dkb-kraft-edge`): one material for every tag on the wall. The tags' labels start under their holes, so a string never crosses their words; the client's own words (their form's) are in full ink. Amounts in Arabic: Arabic-Indic digits, no thousands mark up to ٩٩٩٩, from ١٠ آلاف in words ("٧٥ ألف دينار"); on the tape without the currency ("٢٢٠ ألف"). "Where most land" (2.5) is the ruled card between them. The tape at y 186, the cards on one grid from y 428: the top row's three (440, the rest, 440; 60 px gutters) share the tallest one's height, 194 at least; stop 2's row follows 16 px under it, on the wall from stop 1 stepped back, "How you're paid" (560 wide, three lines at most) and the example filter line sharing its top, ending by y 960 in both languages; nothing on the slide is turned.
8. **Competitors.** Clippings in rows of five across the wall (the row's free places held by example clippings while the call is on), each a straight paper clipping torn at its foot with one piece of tape (typed live: `data-live`, no tilt), its name (`<bdi dir="auto">`, never cut: a long name steps down to 26 then 22 px and runs to three lines) and a small kraft "We lose to them" tag when set (pointed at its start with a punched hole; never amber: design pass, score round 2); its small cross shows only on its hover or its own keyboard focus. A clipping is as tall as what it holds (136 at least; score round 2: a name alone sat on 200 px of paper). The next name is typed straight over an example clipping, its example name and note struck through (the field lies under the struck name and takes the caret from a click on it; typed, the example is gone). After the call: theirs only, as wide as the row allows, no empty "known for" line. The ruled "Why people pick you instead" card is on the wall from stop 1, stepped back; stop 2 lifts it and steps the clippings back. The group sits in the middle of its room.
9. **Offer.** The kraft tag 720 wide (760 tall at least), hung from one tack at (1320, 40), 0.8 degrees, toward the wall's middle (design pass, score round 2: a 560 px tag left the left half bare), its five ingredients a checklist at 28 px and more (a hole punched for each, no blank dashes, never a radio ring): the name and the first step from the 3.1 draft and the price the ads point to (slide 7's anchor) are written on it, ticked in pen in the hole's place (print ink on kraft; score round 2: the hole showed through the tick), when the record holds them; the kraft stays flat, no grain, since the client's words are written on it (5.4); the pattern and the bonuses (and anything not typed yet) show their name alone, by their hole, and the tag's foot says once "The rest is in your offer sheet." over "Draft · locks in 1 to 2 days" (score round 2: "In your offer sheet" five times over). The tag's height is its words' (760 at least) and a line's value is two lines at most, so its clip-path never cuts its foot (score round 2, Arabic). The notes window's **Share the offer sheet** opens the card's Offer Cheat Sheet as `mahara-offer-{taskId}` in its own window (never framed; the internal pricing doc is never linked anywhere in the deck). The lead (46 px, 740 wide) sits beside the tag, its middle on the tag's (y 500); stop 2 swaps it for "Now we open your offer sheet together. It locks in 1 to 2 days, with you." and lifts the tag. No card for the sheet on the canvas (design pass, score round 1: an empty ruled card with a presenter's instruction on it); the tag starts at y 80 so its foot ends by y 960 in Arabic with every line written.
10. **How ads work.** The two roads: two paper strips 1080 x 104 (a dashed centre line along each), the referral and the ad, each with its trust line, joined by two string curves to one card, "The same client"; "Same person, same money. The only difference is trust." under them, on the strips' edge at x 120 (design pass, score round 2: 40 px in, it lined up with nothing; score round 2 of the deck: centred on the canvas). Arrivals in the argument's order (`--i`): strip 1 (0), strip 2 (1), the curves (2), the client card (3), the conclusion (4), the tape (5), the choices (6). The 30-to-60-day strip waits rolled up and out of sight on stop 1 (design pass, score round 2: a roll parked at its start meant nothing yet, Hallmark gate 45); the step to stop 2 unrolls it (`scale` from 0 at its start) while a roll of kraft tape comes on at its start, travels along the line and is gone at its end (`.dkb-learn-roll`, drawn only for that step, never on a step back; a second step before it ends lands the tape at once, `data-landed`), kraft masking tape with sixty day ticks (a longer tick every ten days), never a second steel ruler. The approval: three paper tabs 540 x 192 held in one steel clip bar at their foot (y 916 to 960), on the wall from stop 1 stepped back and not tappable; on stop 3 a tap pulls the pick up 28 px out of the clip and circles its title in pen; each title one line ("Every video", "The first batch", "Run, then show you" / «كل فيديو»، «أول مجموعة»، «نشغلها ونوريكم»). No radio, no lit edge.
11. **Brand.** One stop. The material board (`--dkb-board`, 580 wide, its height its contents') is the "Your look" frame (label on its edge, tape across two corners): the logo (the verified one, else "Your logo files: in your Brand DNA doc"), up to four colour chips with their hex in mono (read from the Brand DNA text by `#?[0-9A-Fa-f]{6}` under its colours heading), "From your Brand DNA doc" as a teal mark. No colours found: no empty chips; one paper card instead, "We open your Brand DNA doc together", the doc's name when the card links it, and what it is opened for as three ruled rows, each with a ring: "Your logo files", "Your colours", "Your type" (score round 2: one card over an empty board). The rules beside it from the start: three straight cards, Always (a teal tick), Never (an ink cross; a line is never struck), Never show (a dash), each label in a 360 px column with its source mark under it (score round 2: at 260 px the mark ran under the list's first line); the lines are chips (a tick, a cross, a dash leading each); each list's "+ Add a line" keeps its room out of sight at rest, shown only under the presenter's pointer or with focus, gone after the call. A list with no line is one dashed chip, "We add these together" / «نضيفها مع بعض»; with all three empty, the three fold into one card (`data-fold`) (design pass, score round 2: three empty white boxes read as textareas); after the call only the lists that hold lines are on the wall. The specimen follows their Brand DNA doc's type line when it names a serif for the wordmark (`--dkb-face-serif`, a system serif, never a client face loaded: "Aa" and the Latin name; foot "Set as your doc describes" / «على وصف ملف هويتكم»), else the deck's faces, "Example pairing". The look frame is the board's height (620), so its bottom-start tape holds the board's corner (design pass, score round 1: it hung 50 px under it on the felt). Never's source mark is the red lines' ("From your onboarding call") while it is still their list, and the rules' own once changed here.
12. **Content.** One layout on both stops. Four polaroids (390 x 336, 430 apart) at ±0.8 degrees across the wall with their labels, each a plain example still of their service (the full render, `feedUrl`, cut by `object-fit`; design pass, score round 2: the 216 px tiles were soft), tagged Example, the last a before and after (the start half dimmed and grey, a paper split); no drawn overlay (design pass, score round 1: the tripod read as clip art). Under them, the camera question on a paper card (120, 676, 1040 wide): its question, then its four answers as small paper chips in a row, theirs circled in pen; on the wall from stop 1 sunk and not tappable, lifted on stop 2 (design pass, score round 2: on an amber card, dimmed to brown beside the amber due sticky, it read as a radio question; amber is the client's to-do alone). Beside it the amber due sticky (1240, 684, 560 wide). No button: their Drive folder opens from the notes window.
13. **Read-back.** The three frames from the cover, now the client's own paper, each one straight because the offer is typed live in the third, growing out of the wall map on arrival (5.5): Your offer (from 120, 236, 960 wide, as tall as its rows: flat paper, no texture under text; the offer's name as the **feature headline** at its top at 88 px, two lines at most, then 72, 60 and 52; 40 px under its rule (which is the table's top) the table's rows that hold words, Who it's for (2.1's first clause) · What they get · The first step, free; the money lines 34 px under the paper. Not built yet (design pass, score round 1: placeholders over empty rows read as an unfilled form): the paper is 580 tall with only what exists and "We finish this in your offer sheet." set large across it; with nothing at all, not even who it is for, no paper: the open frame (`holds`) 580 tall with the note in its middle (design pass, score round 2: a 960 x 580 white card holding one sticky); its words are typed in the notes window (3.1), and the headline and rows come onto the paper as they are), Your words (1140, 236, 660 x 260: the method's first line at 36 px on its paper; blank, the open frame holding the amber note), Your look (1140, 556, 660 x 260: the board, small, or the DNA card). Tape only on paper. In Arabic each table value starts beside its label (`text-align: right` whatever the value's own direction; score round 2: English values sat 500 px from their labels). Under them, two short ruled lines (the money; the ads) and the sticky.
14. **Next.** Titled "What happens next". The string drawn across at y 376 from the wall's margin to its margin, x 120 to 1800 (design pass, score round 1: the lower third stood empty; score round 2: it started at x 98) with five pegs and cards 300 x 270 (`--dkb-amber` for the client's own), each card pegged as the string's draw reaches its peg (from 60 ms, 900 ms across 1680 px; a 360 ms drop), never before it (score round 2 of the deck: the first card hung from nothing). The first card reads part 1 from the record (`parts.1` done) or this call's stamp: sent, "Part 1 sent. …"; not yet, "Part 1: we send it before we hang up." The launch call waits under the line from stop 1 as an open frame (800 x 180 at y 772, `.dkb-call-wait`) with its name on the felt (design pass, score round 2: a sunk card with big bold words read as a disabled control); stop 2 pins the call card into it and lifts the launch card off its peg (`rotate` undoes its turn, `translate: 0 -10px`; the peg stays on the line; never a teal ring), with the booked day and time in the client's time zone, or "We book it together now" (the CD opens `https://api.leadconnectorhq.com/widget/booking/5E1EVxLJbGiDM3iYl2kL` from notes, its own window, to share).

**Live typing everywhere follows one rule:** the field sits on flat paper, straight, `font: 400 48px/64px`, ruled every 64 px with `--dkb-ruled`, `caret-color: var(--dkb-caret)`, `dir` from the text (empty: the deck's direction). Enter commits a one-line field; a long field grows. The shell already ignores navigation keys while a field has focus; Esc lets go of the field.

### 5.4 The visual system: Studio Wall, tamed, in tokens

**Tamed, as decided:** straight cards wherever text is typed live (the competitor chips included); at most 1 degree of tilt on any other card, print, label, tag or tape (two figures keep their own angle: the fan, whose strips fan by meaning, and the stamp at -3 degrees); teal under 5 % of the cover; no Marcellus or any client face; no pin-hole dots; felt texture at most 4 % and never under client text (paper is flat everywhere); slide 11 thinned to about 8 items; entrances end within 1.5 s; the stamp fired only by the real Send to media press.

**The grafts from the Editorial Issue:** the agenda counted by the minute on a pinned run sheet (slide 3); live typing on ruled lines at 48 px with a teal caret (slides 2, 6, 7, 8, 11, 13); the offer as a feature headline with a who / what / first-step table (slide 13); the struck-through line with the agreed one under it (slide 6: the generic claim struck, their method under it); flat paper under client text.

Section 24 of `present.css`, on `.dk-root[data-deck="blueprint"]` (every colour a token, as the engine's rule says):

| Token | Value | Use |
|---|---|---|
| `--dkb-wall` | `var(--dk-space)` | the wall |
| `--dkb-felt` | the Studio mockup's `--tex-wall` noise, alpha **0.04** | the wall only |
| `--dkb-vinyl`, `--dkb-vinyl-2`, `--dkb-vinyl-3` | `var(--dk-ink)`, `var(--dk-ink-2)`, `var(--dk-ink-3)` | lettering on the wall |
| `--dkb-paper` | `#eef2f5` | cards, sheets (flat) |
| `--dkb-paper-shade` | `#dbe2e8` | the sheets behind, the fold |
| `--dkb-tape-frame` | `rgba(0,207,200,.46)` | an empty frame's open outline: four 18 px strips on the felt (the cover, a read-back part still waiting, slide 14's launch call) |
| `--dkb-pencil-ink` | `rgba(9,19,51,.6)` | the presenter's pencil note (`Prompt`): what is not answered yet, at 24 px and more |
| `--dkb-shadow-flat` | a 1 px rule and a 5 px blur | a piece sunk into the wall, a stop that is not its own |
| `--dkb-face-serif` | `ui-serif, Georgia, serif` | slide 11's specimen when their Brand DNA doc names a serif wordmark (a system face, never a client face loaded) |
| `--dkb-band`, `--dkb-band-edge` | `rgba(9,19,51,.16)`, `rgba(9,19,51,.32)` | slide 7's band for where most projects land |
| `--dkb-field` | `#f8fafc` | a typing well |
| `--dkb-board` | `#c3ccd3` | the material board |
| `--dkb-kraft` | `#bb9a6e` | every tag (the offer tag, slide 7's swing tags, slide 8's loss tags), the parked card, the tape roll, the pegs: one material (design pass, score round 2: a paler manila made two), flat, no grain, since client words are written on it |
| `--dkb-print`, `--dkb-print-2`, `--dkb-print-3` | `#091333`, `rgba(9,19,51,.72)`, `rgba(9,19,51,.62)` | ink on paper (≥ 4.5:1 on paper and on kraft) |
| `--dkb-rule`, `--dkb-rule-strong`, `--dkb-ruled` | `rgba(9,19,51,.14)`, `rgba(9,19,51,.3)`, `rgba(9,19,51,.22)` | rules, the ruled lines |
| `--dkb-tape`, `--dkb-tape-paper`, `--dkb-tape-edge` | `rgba(0,207,200,.52)`, `rgba(0,207,200,.46)`, `rgba(190,255,252,.28)` | tape (ours) |
| `--dkb-teal-ink` | `#007a74` | the stamp, source marks on paper |
| `--dkb-caret` | `#0a8f8a` | the caret, a lit edge on paper |
| `--dkb-amber`, `--dkb-amber-shade` | `var(--dk-leak)`, `#e3a43a` | what is the client's to do |
| `--dkb-string` | `#c4cdd6` | the clothesline, cords |
| `--dkb-shadow-paper`, `--dkb-shadow-chip` | the mockup's two shadows | pinned things |
| `--dkb-ink-mask` | the mockup's `--tex-ink` speckle | the stamp's ink |
| `--dkb-tilt-max` | `1deg` | the cap |
| `--dkb-pen`, `--dkb-t-ring` | `var(--dkb-teal-ink)` (print ink on kraft), `420ms` | a pen loop round a chosen answer, a pen tick |
| Type | display 128/0.98 700, title 64/1.06 700, lead 38/1.36, words 40/1.24, live 48/64, feature 88/0.95 700, label 26/1.3 600, mono 24 | Geist, Geist Mono, IBM Plex Sans Arabic (`--dk-font`, `--dk-mono`, `--dk-font-ar`) |

**The seven signatures, as classes:** `.dkb-frame` (the three frames, `data-filled`: empty, a `.dkb-mount` with its dashed well; filled, the client's paper is the frame, its label on the paper's edge and the tape across its corners where paper meets felt; on the read-back `data-assemble`), `.dkb-map` (the wall's map in the foot: the read-back's three frames drawn small, each filled as its part is said), `.dkb-fan` and `.dkb-strip` (`data-lit`, `data-ask`), `.dkb-board` (the material board), `.dkb-tag` (the kraft tag, `data-draft` or `data-live`), `.dkb-line` and `.dkb-peg` (the clothesline), `.dkb-stamp` (`data-fired`). Shared: `.dkb-card`, `.dkb-sticky`, `.dkb-dymo`, `.dkb-tape`, `.dkb-ruled` (a live field), `.dkb-chip`, `.dkb-print`, `.dkb-sheet`. A card with `data-live` forces `--r: 0deg` and has no texture.

### 5.5 Motion, within the engine's rules

- **Once per entry:** the shell remounts a slide per slide and language, so each build runs once on entry and holds. Nothing loops.
- **The switch:** every duration and delay is `calc(<token> * var(--dk-m))`, so `?still=1` and reduced motion show the end state at once.
- **Tokens:** `--dkb-t-peg: 360ms` (slide 14's cards, each from the string's draw at its peg: the last ends by 1.5 s); the example ads' drift is off on this deck (`--dk-t-drift: 0ms`); the ordinary arrivals start with the press and settle by about 850 ms (design pass, score round 2: the wall stood empty but for the title 100 to 150 ms after a press on slides 5 to 14, and slide 11 took 1.3 s): `--dkb-t-pin: 420ms` (drop 24 px with its tilt, settle), `--dkb-t-lead: 0ms`, steps of `--dkb-t-step` (70 ms) capped at 6 (`--dkb-i-max`), so the last arrival ends by 0 + 420 + 420 = 840 ms, each slide's first piece at index 0; `--dkb-t-tape: 280ms` (scale from 0.25 on its own axis) from `--dkb-t-tape-at: 200ms` after its paper; `--dkb-t-hint-at: 160ms`. The long choreographies are the signature beats' own: `--dkb-t-fan: 760ms` (strips open from closed, 70 ms apart: 1,160 ms); `--dkb-t-string: 900ms` (the line draws from its start at 60 ms: 960 ms); the park, the unroll and the read-back's assembly below; `--dkb-t-stamp: 240ms` (from 1.5 scale and -6 degrees to 1 and -3, ease-in).
- **No simulated typing.** Words appear because someone types them.
- **The presenter's chrome** starts out of sight and comes back only on a real pointer move, never on a key (DESIGN 12.1), so the client never sees web buttons as the share starts.
- **The stamp** fires only on `bp-part {part: 1, phase: "queued"}` from this call's press (or a rehearsal's plan). On entry or reload with `parts.1` done, it is drawn already set, without motion. A test advances fake timers and asserts no stamp without the message.
- **Filling a frame** (slides 6, 11, 13): the content pins in with the arrival; the frame's tape does not move again.
- **A tap on a choice** (1.3, 1.5, 2.12, 2.15): a pen loop is drawn round the word (`--dkb-t-ring: 420ms`, `stroke-dashoffset`, at once when the tap was on this call, else with its paper's arrival); the fan's strips keep `--dk-t-tick`.
- **A stop's focus** (design pass, score round 1): the paper the stop asks about lifts (`translate: 0 -6px`, a deeper shadow on an `::after` faded in, its tape tugged 3 px); the rest sink into the wall, in `--dk-t-stage`: the whole piece, its tape and label too, at opacity 0.7 so the felt shows through, `scale: 0.98`, a flatter shadow (`--dkb-shadow-flat`), never a colour laid over it; amber never sinks by opacity (design pass, score round 2: washed to 0.55, paper read as disabled controls and amber turned a muddy brown). Opacity, translate and scale only, on attributes (`data-active`, `data-dim`) the pin's arrival never holds: `.dkb-pin` and `.dkb-arrive` fill backwards, so once pinned the paper's own opacity and translate apply. No filter transitions remain on the deck.
- **Transform and opacity only:** slide 4's parked lines slide in (`dkb-arrive-line`) and the tag is pinned again at its full height (`dkb-repin`), never grown by animating heights; slide 10's tape unrolls by `scale`.
- **Three moments that pay off the cover's empty frames** (score round 1), each done within 1.5 s, each from a press or from typing, never a timer, and each gone under reduced motion and in still shots (their resting state is the end state):
  - **Slide 4's park** (the CD's step to stop 2): the strips not chosen slide off toward the tag and fade (`--dkb-t-park: 520ms`, 70 ms apart), each strip's own label fading by 60 % of its flight; each parked service is written on the tag as its strip lands (82 % of its flight, `--dkb-t-land: 240ms`), never before, their own words after the four; from 360 ms (`--dkb-t-park-at`) the lit strip rises at 1.1 with its line (520 ms): done by about 1.2 s.
  - **Slide 6's flight** (the first time their method is let go of on the slide, when it opened empty): a paper copy of its first line lifts off the card and flies into the wall map's "Your words" (`--dkb-t-fly: 900ms`), which is filled from then on.
  - **The read-back's assembly** (on arrival): each of the three frames grows out of its copy in the wall map, where it sat on the slide before (`--dkb-t-assemble: 700ms`, a step apart: done by 940 ms); what a frame holds comes with it, without its own drop.

### 5.6 English and Arabic

- `blueprintContent.ts` holds every string as `L` (`{en, ar}`), read with `t()` and `tf()` so Latin runs are isolated and numbers held. Client words are shown as typed, in `<bdi dir="auto">`.
- The copy rules hold, pinned by `deck-copy.test.ts`: sentence case; no exclamation marks; no em dashes; no results promise; no leads, cost per lead or ad money on any slide; the five main services by their kickoff names; anything not the client's own tagged (Example / مثال, Example wording / صياغة للتوضيح, Starter ads, from our templates / إعلانات البداية، من قوالبنا); roles, never names, except the presenter's first name in notes; unconfirmed claims ("over ten years", "well over a million dollars in this region", "worked with X companies") only in notes, behind "Confirm before you say this".
- Arabic: CONTENT-AR's shared vocabulary (مكالمة بناء الهوية والعرض، إعلانات البداية، المدير الإبداعي، فريق الإعلانات، مجلد الدرايف، الخطوط الحمراء، ملف العرض), no Kuwaiti-only or Saudi-only words on slides, Arabic-Indic digits through `digits()`, money words from ١٠ آلاف, the stamp's clock in Latin digits like the Drive box's (DESIGN 13.4). The client's currency word is theirs (دينار، ريال، درهم). Every Arabic string gets the frontier-model check the decks' copy gets before ship.
- **Slide strings (the client sees):**

  | Where | EN | AR |
  |---|---|---|
  | cover lead | Today we put your brand on one wall: how you talk, how you look, and what your ads offer. | اليوم نجمع هويتكم على جدار واحد: كيف تتكلمون، وكيف تظهرون، والعرض اللي تقدمه إعلاناتكم. |
  | cover byline | With our creative director · With {first name}, our creative director | مع المدير الإبداعي · مع {first name}، من فريقنا الإبداعي |
  | frames | Your words · Your look · Your offer | كلامكم · هويتكم البصرية · عرضكم |
  | frame hints | How you describe your work, in your own words · Materials, colours and type · What your ads offer | كيف توصفون شغلكم، بكلامكم · الخامات والألوان والخطوط · العرض اللي تقدمه إعلاناتكم |
  | cover sticky | Have your price list near you. We'll ask for real numbers. | خلوا قائمة أسعاركم قريبة منكم. بنسألكم عن أرقام حقيقية. |
  | slide 2 sticky | Anything wrong? Say it now. It saves as we talk. | فيه شي غلط؟ قولوه الحين، ينحفظ وإحنا نتكلم. |
  | source marks | From your kickoff form · From your onboarding call · From your onboarding form · Said on this call · Just now · From your Brand DNA doc | من نموذج بداية الشغل · من مكالمة التعريف · من نموذج التعريف بالنشاط · قلتوه بهالمكالمة · انكتب الحين · من ملف هويتكم |
  | rules | We'll push back when something won't sell. · Be specific on money. · It's fine to say you don't know. | بنقول لكم بصراحة إذا شفنا شي ما يبيع. · خلونا دقيقين بالأرقام. · عادي تقولون ما نعرف. |
  | wall map's name (slide 2) | Your wall | جداركم |
  | slide 7 narrow band's flag | Most projects: {lo} to {hi} | أغلب المشاريع: {lo} إلى {hi} |
  | slide 5 example caption | {Service}, from the first call to the handover. | {service}، من أول مكالمة لين التسليم. |
  | slide 4 line | One service per campaign. The others wait their turn. | خدمة وحدة لكل حملة، والباقي ياخذ دوره بعدين. |
  | parked | Parked for later | نرجع لها بعدين |
  | two picks | Which one goes first? | أي وحدة نبدي فيها؟ |
  | slide 5 stop 1 lines | Ready-made ads for {service}, from our templates. · You see them, and say yes, before they run. · They run while we make yours, from your photos and your words. | إعلانات {service} جاهزة، من قوالبنا. · تشوفونها وتوافقون عليها قبل لا تنزل. · تشتغل لين نجهز إعلاناتكم الخاصة، من صوركم وكلامكم. |
  | slide 5 prints' tag | Example ad | إعلان للتوضيح |
  | slide 5 approval | Approved on this call · Approved before the call · We want changes | وافقنا عليها بهالمكالمة · وافقنا عليها من قبل · نبي تعديلات |
  | sheet fold (none: no fold) | Kept in our notes, off this screen: 1 answer · 2 answers · {n} answers for our media team | محفوظة بملاحظاتنا، مو على الشاشة: جواب واحد · جوابين · {n} أجوبة لفريق الإعلانات |
  | stamp | Part 1 done · On its way to our media team at {time} | الجزء الأول تم · انرسل لفريق الإعلانات الساعة {time} |
  | slide 6 struck | Quality work, delivered on time. (Example) · their own earlier line (Your words before) | شغل بجودة عالية، وتسليم بالوقت. (مثال) · (كلامكم من قبل) |
  | slide 7 marks | The smallest project you take · Where most projects land · Where your ads point | أصغر مشروع تقبلونه · قيمة أغلب المشاريع · القيمة اللي تركز عليها إعلاناتكم |
  | filter line | Our projects start from {minimum}. Is that within what you had in mind? | مشاريعنا تبدي من {minimum}. هذا ضمن اللي في بالكم؟ |
  | slide 8 mark | We lose to them | نخسر قدامهم |
  | tag lines | The pattern · Its name · Two or three bonuses · The price your ads point to · The free first step, and who gives it | الفكرة · اسمه · إضافتين أو ثلاث مع العرض · السعر اللي تركز عليه إعلاناتكم · الخطوة الأولى المجانية، ومين يقدمها |
  | tag foot | The rest is in your offer sheet. · Draft · locks in 1 to 2 days | الباقي بملف العرض. · مسودة، ونثبت العرض معكم خلال يوم أو يومين |
  | approval titles | Every video · The first batch · Run, then show you | كل فيديو · أول مجموعة · نشغلها ونوريكم |
  | DNA card rows | Your logo files · Your colours · Your type | ملفات الشعار · ألوانكم · خطوطكم |
  | slide 10 | Same person, same money. The only difference is trust. · Your ads learn for 30 to 60 days. Volume beats luck. | نفس الشخص، ونفس المبلغ اللي بيدفعه. الفرق الوحيد هو الثقة. · أول ٣٠ إلى ٦٠ يوم نكتشف اللي يشتغل بإعلاناتكم. كثرة الإعلانات هي اللي تعلمنا، مو الحظ. (score round 1 of the design pass: «الكمية تغلب الحظ» read as a translation) |
  | slide 12 shots | You, talking to camera · Your site or workshop · A finished project, walked through · Before and after | أنتم تتكلمون للكاميرا · موقع العمل أو ورشتكم · جولة بمشروع خلصتوه · قبل وبعد |
  | slide 13 lines | Projects from {minimum}. Your ads point near {anchor}. · Starter ads: live once your account is ready. (none: Your own ads: at your launch call.) · You send us four shots by {day}. | مشاريعكم من {minimum}، وإعلاناتكم تركز على حدود {anchor}. · إعلانات البداية: تنطلق أول ما يجهز حسابكم. (بدونها: إعلاناتكم الخاصة: بمكالمة الإطلاق.) · ترسلون لنا أربع لقطات لين {day}. |
  | slide 13 table | Who it's for · What they get · The first step, free | لمين · اللي يحصلون عليه · الخطوة الأولى، مجاناً |
  | slide 13 headline placeholder | The offer's name, typed together | اسم العرض، نكتبه مع بعض |
  | cover photo print | From your photos · Example photo | من صوركم · صورة للتوضيح |
  | pencil notes, what is not answered yet (design pass, score round 2) | We write this together · We write this now · We pick it now · We add these together | نكتبها مع بعض · نكتبها الحين · نختارها الحين · نضيفها مع بعض |
  | slide 7 terms, not said yet (tagged Example) | 30 / 40 / 30? | ٣٠ / ٤٠ / ٣٠؟ |
  | slide 11 specimen from their doc | Set as your doc describes | على وصف ملف هويتكم |
  | slide 14 launch card, not booked | Launch call · Your own ads, your form and our questions. | مكالمة الإطلاق · إعلاناتكم الخاصة، ونموذج إعلانكم، وأسئلتنا. |
  | slide 3 part 3 | Part 3 · After the call · in 1 to 2 days | الجزء الثالث، بعد المكالمة، خلال يوم أو يومين |
  | slide 6 example method | A fixed price before we start, one person in charge, and a weekly update until handover. (Example) | سعر ثابت قبل لا نبدي، وشخص واحد مسؤول، وتحديث أسبوعي لين التسليم. (مثال) |
  | slide 8 clippings | What they're known for · and {n} more | اللي يتميزون فيه · وغيرهم ({n}) |
  | slide 8 example clippings | The studio you lose to most (Quick quotes) · A firm that wins on price (Lower prices) · A name clients compare you with (A big showroom) · The big firm in your city (A known name) · A designer known online (Striking renders) | الاستوديو اللي تخسرون قدامه أكثر (عروض أسعار سريعة) · شركة تكسب بالسعر (أسعار أقل) · اسم يقارنكم فيه العملاء (معرض كبير) · الشركة الكبيرة بمدينتكم (اسم معروف) · مصمم معروف أونلاين (تصاميم تلفت النظر) |
  | slide 11 board | Materials from your projects · Example materials · Example pairing · Example palette · In your doc: {type} | خامات من مشاريعكم · خامات للتوضيح · خطوط للتوضيح · ألوان للتوضيح · بملف هويتكم: {type} |
  | slide 11 materials (examples) | Travertine · Bouclé · Oak · Brass · Timber fins · Walnut · Stone pavers · Marble · Timber ceiling · Limestone · Granite · Oak slats · Carpet tile · Concrete · Blockwork · Rebar · Sand | ترافرتين · قماش بوكليه · خشب بلوط · نحاس · شرائح خشب · خشب جوز · بلاط حجري · رخام · سقف خشب · حجر جيري · جرانيت · شرائح بلوط · موكيت · خرسانة · طابوق · حديد تسليح · رمل |
  | slide 11 example palette | Sand · Oak · Brass · Night | رملي · بلوطي · نحاسي · ليلي |
  | slide 11 red lines, said once | Your red line, from the start of this call · Your {n} red lines, from the start of this call | خطكم الأحمر، من بداية المكالمة · خطوطكم الحمراء ({n})، من بداية المكالمة |
  | slide 13 blank offer | We finish this in your offer sheet. | نكمله معكم بملف العرض. |
  | slide 14 title | What happens next | الخطوات الجاية |
  | slide 14 cards | Part 1 sent. Your starter ads are with our media team. (not sent yet: Part 1: we send it before we hang up.) · Your offer, locked with you in your offer sheet. · Your four shots, in your Drive folder. · Starter ads go live, once your account is ready. · Launch call: your own ads, your form and our questions. | انرسل الجزء الأول، وإعلانات البداية عند فريق الإعلانات. (ما انرسل: الجزء الأول: نرسله قبل لا نسكر.) · عرضكم، نثبته معكم بملف العرض. · أربع لقطات منكم، بمجلد الدرايف. · إعلانات البداية تنطلق أول ما يجهز حسابكم. · مكالمة الإطلاق: إعلاناتكم الخاصة، ونموذج إعلانكم، وأسئلتنا. |
  | legend | Amber cards are yours to do | البطاقات الصفرا عليكم |
  | booking | We book it together now · Booked: {day, time} | نحجزها مع بعض الحين · محجوزة: {day, time} |
  | slide 2, nothing on file | The clients you want more of, and what never goes in an ad: we write them together now. | العملاء اللي تبون منهم أكثر، واللي ما ينحط بأي إعلان: نكتبها مع بعض الحين. |
  | slide 5 Reels caption | Stories and Reels | ستوري وريلز |
  | slide 9 stop 2 lead | Now we open your offer sheet together. It locks in 1 to 2 days, with you. | الحين نفتح ملف العرض مع بعض، ونثبته معكم خلال يوم أو يومين. |
  | slide 11 doc's type line | In your doc (their words on a line of their own) | بملف هويتكم |
  | slide 13 blank method | Your method, in one line: we write it with you. | طريقتكم، بسطر واحد: نكتبها معكم. |

- **Notes lines** are English, with an Arabic "Said in Arabic" line per slide where the CD says something to the client (the CSM decks' `sayAr` pattern).

### 5.7 The prep view (15 minutes before)

`BlueprintPrep.tsx`, in the existing prep window:
1. **Ready check:** "Part 1 confirmed", "Starter pack for {service} set", "Launch media buyer set", "Offer sheet on the card", "Brand DNA doc on the card", each with its fix.
2. **Part 1, confirm:** every part 1 question with its prefill, source and date, ticked when P or D; **Confirm part 1** writes them in one save.
3. **Still missing:** what the call must ask, in the call's order.
4. **What they've told us (read only):** the kickoff and onboarding answers the Blueprint uses, the closer's notes and handoff risks from the card, folded.
5. **Links:** Brand DNA, Offer Cheat Sheet (with "Write your offer guess in it before the call"), Market Research, Drive. The internal pricing doc is never linked.
6. **The whole form** (`#part1`, `#part2`, `#part3`): all 33 questions by part, private and client-facing together, for finishing part 2 later the same day. The part buttons are here too.
7. **The slides:** the 14 with their readiness, as the CSM decks' prep shows them.

### 5.8 Harness and shots

- `src/dev/presentHarness.tsx` accepts `deck=blueprint` and `bp=<state>`; fixtures in `src/dev/deck/blueprintFixtures.ts`, synthetic only (a made-up firm, labelled):
  - `full` (kickoff, onboarding, deck prep red lines, all five packs, assignee, Market Research, a verified logo, a Brand DNA with four hex codes),
  - `sparse` (onboarding only, no packs),
  - `nokickoff`,
  - `two` (the kickoff picked two services),
  - `declined` (starter = no),
  - with `bp=open | part1 | sent | closed | locked` for the record's state, and `rehearse=1`.
  Saves stay in memory; the outbox and the Edge Function are stand-ins that return a plan after 1.5 s; nothing frames Drive (slide 5 pins example ads as prints).
- `scripts/deck-shots.mjs --deck blueprint --fixtures full,sparse,two,declined --langs en,ar --sizes 1920x1080`, plus `bp=sent` and `bp=locked` passes, the notes window at 520 x 820 and prep at 1440 x 900, JPEG at quality 75 (a new `--type jpeg` flag). Its measures hold, plus the Blueprint checks in `scripts/blueprint-shots.mjs`: teal pixels on the cover under 5 %; no rotated element with `data-live`; nothing else past 1 degree but the fan and the stamp; no text past the canvas or in the foot; no card, sheet, tag, sticky or tape ending below y 960 (design pass, score round 1: Arabic cards ended at 990 to 998, on the logo, under the old 1004 line); the read-back's headline box holding its words; and (score round 1) **the title's words never within 24 px of a print, the ad prints, the sheet, the run sheet or the offer tag** (in Arabic slide 5's print had touched the title's second line). Score round 2 (the run printed 0 hits over four cut or covered lines) added the text checks, each a hit that fails the run: two runs of text in different blocks overlapping (deck-shots.mjs's check); a run covered by something painted over it (sampled with `elementFromPoint` at its ends and middle); a run cut by a box that clips it (overflow, or a polygon clip-path read point by point, as the offer tag's); a run reaching past the paper it is printed on (its nearest opaque or clip-pathed box); and a card, sheet, tag or sticky that hides its overflow holding more than it shows (`scrollHeight` within 2 px). The fan's strips (turned by meaning) are left out; slide 5's ad prints are checked as any paper is (design pass, score round 2); the foot check covers the sheet, the tag and the sticky too. `--save no` measures without writing shots; `--slides <ids>` walks only those slides.
- The CD cockpit's Blueprint card, dashboard row and Settings section are shot at 1440 x 900 from a `blueprint-harness.html` with the same fixtures.
- The Hallmark slop test (`references/slop-test.md`, all 58 gates) is run on the shots before the slides are called done, and every interactive element in the notes window and the CD card has its eight states.

---

## 6. The CSM side

### 6.1 The Onboarding panel's line

In `OnboardingKit.tsx` the "Brand Blueprint form" item becomes "Brand Blueprint", read through `cockpit_blueprint_read([taskId])`:
- "Blueprint: starter ads sent 10:12 · call closed 10:44 · offer locked Sat 24 Oct", each part's time or "not yet", in the client's time zone.
- "Open the Blueprint deck" (prep view, read-only for the CSM).
- When part 2 is done and `close_route` is not `make`: "Copy the phase 5 message for the group" (the same text as the card comment, from `blueprintBrief.ts`).
- A Typeform Blueprint already on record (`forms.blueprint`, the older clients) keeps its "Read it".
- The booking buttons stay as they are.

### 6.2 What the launch deck reads

`launchData.ts` gains `blueprint: {offer, approval, packUrl, rules, parts} | null`, from `cockpit_blueprint_read` beside the deck's own read (`load.ts`; a failed read is a notes line, never an empty slide):
- **The offer (3.1):** the selling point's order becomes prep's `selling_point` → the Blueprint's offer as one sentence → the Brand DNA and offer doc text, as today.
- **The approval (2.12):** the creative-freedom slide's line names their choice ("You chose to approve the first batch, then we run."), notes only until CONTENT.md adds the slide line.
- **The pack (1.4):** notes show "Starter pack: open it", and the starter stop's tag reads "From our {service} pack".
- **The rules (2.14):** red lines become `told` (the onboarding deck's) plus the Blueprint's never and never show, and `always` plus the Blueprint's always, deduplicated.

---

## 7. Tests, verification and shipping

### 7.1 Tests (synthetic fixtures, no client data)

**Client success app (`bun test`):**
- `scripts/blueprint-form.test.ts`: 33 visible questions, 21 required with the conditions; the registry's keys equal the migration's allow-list (parsed from the SQL); `missing()` equals `cockpit_blueprint_missing` on 20 answer sets (run in PGlite).
- `scripts/blueprint-prefill.test.ts`: the five-service mapping from the kickoff's own words and from onboarding text (EN and AR); two services; no kickoff; budget parse (`$40 a day`, `40 دولار`, `٤٠`, `40 to 50`, `KWD 15`); card budget fallback; Templated Ads Status and Facebook Access mappings; Do's & Don'ts split; summaries cut on a whole word at about 160, Arabic kept as typed.
- `scripts/blueprint-brief.test.ts`: the brief's lines for starter yes and no; the budget appears only in the brief, never in any slide's text (every slide rendered with `full`); the update comment lists only changes; the mappings (Templated Ads Status, Ad Approval Needed?, Can Self-Record?); the due date over a week of press days; the Make payload has exactly its seven keys; the phase 5 text is not the placeholder.
- `scripts/blueprint-deck.test.tsx`: 14 slides in order; minutes sum to 45; `TARGET_MINUTES.blueprint = 45`; EN and AR titles; no private key's value is on the canvas (2.9, 1.6, 2.20, 2.21, 1.2's note, 1.4, 1.7, 1.8); `data-live` cards carry no rotation; no rotation over 1 degree outside the fan and the stamp; the stamp only after `bp-part` (fake timers); still mode shows end states; a CSM seat gets disabled fields and no part buttons.
- `scripts/blueprint-saver.test.ts`: the 600 ms pause, one save in flight, `seen` per key, conflicts shown and "Use mine", `bp-saved` between windows, offline retry.
- `scripts/deck-motion.test.ts` (extended): `.dkb-*` animations run on `--dk-m`, nothing loops, every entrance ends by 1,500 ms by the tokens, `--dkb-felt` alpha ≤ 0.04, no "Marcellus" in `present.css`.
- `scripts/deck-copy.test.ts` (extended to `blueprintContent.ts`).
- `scripts/csm-page.test.tsx` (extended): the panel's line and the phase 5 copy button.
- `scripts/deck-launch.test.tsx` (extended): the four launch reads, and the launch deck unchanged with no Blueprint.

**Edge Functions (`bun test supabase/functions/cockpit-creative-api supabase/functions/cockpit-media-api`):**
- `blueprint.test.ts`: create when no open task (template path, tag, assignee, due date, brief); comment only when a tagged or named open task exists; two matches refuse before any write; a second press makes one "Updated" comment and no task; no step names Launch Date, Next Payment Date or Daily Budget; step 4 only for starter yes; the CSM comment only for Tight or No; the close's steps per `close_route` (`card_only`, `slack`, `make` with and without the flag); Make has no read-back and a send failure goes to `reconcile`; a later close never posts Slack or Make; the offer's step 3 rule; `describePlan` sentences; the GET-only provider throws on any other method; an unknown field ID or a renamed field refuses.
- `core.test.ts` (extended): `has` for tags and assignees.

**SQL, PGlite (`apps/media-buyer-cockpit/scripts/blueprints-supabase.test.ts`, with `supabaseDefaultPrivileges`):**
- no table grants to `anon` or `authenticated`; RLS on; each public function executable by `authenticated` only, internal ones by nobody but the owner (and the gate by `service_role`);
- a creative seat with the client off its list is refused; a CSM reads but cannot save, press or set; `anon` gets nothing; an admin and a founder pass;
- unknown key, oversize text, a bad choice, a bad Drive link, a bad assignee are refused; `close_route` by a creative seat is refused;
- required keys per part, with the conditions; part order;
- a repeat request ID writes no row and no audit row; an unchanged second press returns the first row; one press writes exactly one `blueprint.part_done` audit row and one outbox row;
- conflict detection: two sessions on one key conflict, one session never does, a matching `seen` applies, `p_base_revision` equal applies everything;
- `cockpit_blueprint_rehearse_payload` refuses a creative seat and leaves every row count unchanged for an admin;
- `cockpit_blueprint_sources` leaves out billing, payment and the sales transcript.

**CD cockpit:** `scripts/creative-source-models.test.ts` (in media-buyer-cockpit, extended): the sign-off reads the parts, the 48-hour orange, "not tracked" only on a failed read; a Links page test that no row links `oYZKtogO`; a hermes test that `CLIENT_FIELDS` holds the four new names.

### 7.2 Verification with nothing submitted and nothing sent

1. **Local:** the harness for every fixture and state, in both languages; the shots read and deleted; the slop test on them.
2. **PGlite:** the SQL suite above. The migration is never applied to the live database by the builder.
3. **After the person who ships applies the migration and deploys** (section 7.3), on production, as an admin or the CEO with `?rehearse=1`:
   - one client in onboarding **with** a kickoff: Confirm part 1 in prep (in memory), present, press Send to media, Close the call and Lock the offer: each returns its plan; check the plan's task name, list, template, tag, assignee, due date, the field changes and the comments;
   - one client **without** a kickoff: the same, with the notes saying "No kickoff on record";
   - confirm in `cockpit_audit_log`, `cockpit_creative_outbox` and `cockpit_media_actions` that nothing was written (row counts before and after, `sq.py` reads), and in `cockpit_media_provider_health` that only GETs went out.
4. **ClickUp:** reads only (the plan's GETs). Nothing is created, edited or commented by the verification.
5. **Make:** nothing. The route does not exist and `close_route` stays `card_only`.
6. **The first real Blueprint call is the end-to-end test,** checked afterwards with reads: one `blueprint.part_done` row per part; one launch task, tagged, assigned, due; Templated Ads Status set and step 4 done; the media buyer cockpit shows the client as launching; after the close, Ad Approval Needed?, Can Self-Record? and Onboarding Map phase 5 on the card, step 2 done, the CSM's comment with the paste-ready WhatsApp; after part 3, Offer Creation = Done.

### 7.3 Ship steps (for the person who ships; the builder runs none of them)

1. Merge `blueprint-1022` after the kickoff work it sits on.
2. Read `GET list/901816559981/field` once and pin the four field IDs in `blueprintBrief.ts`; read Make 14's blueprint (GET) once and copy module [7]'s phase 5 text and module [8]'s map URL form. Both are reads; both have tests that fail until done.
3. Apply `20261024a_brand_blueprints.sql` through the coordinated procedure.
4. Deploy `cockpit-creative-api` (it now bundles `blueprintBrief.ts` and the `execute.ts` change; `cockpit-media-api` is deployed in the same step because it shares `execute.ts`).
5. `scripts/ship.sh client-success` and `scripts/ship.sh creative` (check-shared, tests, build, deploy).
6. Deploy the hermes cockpit-sync with the four `CLIENT_FIELDS` on the VPS, and run one creative sync.
7. The CD fills Settings: five Drive folder links, shared as Anyone with the link, Viewer, and the launch media buyer.
8. Rehearse (7.2 step 3) on two clients.
9. The first real call.
10. Later, each on its own say-so: invite the Slack bot to #media-general and set `close_route = slack`; if the CEO approves Make 14's route, build it, set `MAKE_BLUEPRINT_HOOK`, `MAKE_BLUEPRINT_KEY` and `BLUEPRINT_MAKE_CLOSE = on`, read the scenario back, then set `close_route = make`. The editor desk rule (4.6) ships when ready.

### 7.4 Build order

1. Migration and its PGlite suite.
2. `blueprintForm.ts`, `blueprintPrefill.ts`, `blueprintBrief.ts` and their tests.
3. The outbox kinds, `blueprint.ts`, the Edge operations, the `execute.ts` `has` check, their tests (rehearsal plans only).
4. The deck: `DeckKind`, routes, model, saver, sources, the 14 slides in EN and AR, notes, prep, CSS section 24, harness fixtures, shots. The worktree stays buildable after every save (the dev server on :5183 serves it).
5. The CD cockpit: Settings, the Blueprint card, the dashboard sign-off, the Links fix, the snapshot read, `CLIENT_FIELDS`.
6. The CSM side: the panel's line, the launch deck's reads.
7. The editor desk rule.

### 7.5 Not in v1

AI one-liners for the summaries (phase 2, through the Ask AI queue, each accepted before it shows); Make 06's AI recap; any Typeform edit; Make 14's route; the shared Instagram identity; a pack picker that reads the Drive folder's files.

### 7.6 Defaults the CEO can correct

1. Studio Wall, tamed, with the five grafts.
2. 45 minutes, 14 slides; Part 1 by minute 10.
3. Starter first: 1.3 is seeded Yes unless the kickoff said Declined.
4. Close needs part 1 sent; Lock needs the call closed.
5. `close_route = card_only` until the Slack bot is in #media-general.
6. A launch task goes out unassigned (with a loud line) rather than blocking the call when no launch media buyer is set.
7. Specific numbers for the minimum and the anchor; a range only for where most projects land.
8. 3.1 in three short lines, read back as one sentence.
9. Deterministic summaries in v1.
10. The CD presents; the CSM reads the deck and pastes the phase 5 WhatsApp until Make sends it.
