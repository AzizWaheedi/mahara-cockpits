# The kickoff form inside the client success cockpit

Spec and design plan, 2026-10-22, branch `kickoff-embed-1022`. Built from the
four read-only maps of the same day (code and data, Typeform, Make, prefill)
and the cockpit as it stands at `a2ad9154`. Built on this branch, with the
review's fixes (2026-10-22). Nothing has been submitted or deployed, and the
migration is not applied.

The CEO's ask (2026-10-21): embed the kickoff form in the cockpit, tied to
each client by the client ID the onboarding link carries, picking up the
offer and the rest, with a backend that works. The next ask (2026-10-22)
reuses it: the Brand Blueprint form in the creative director cockpit,
prefilled from the kickoff, with a partial submit. So this ships as a
reusable **form panel** with the kickoff as its first configuration.

**Never submit a kickoff to test it.** One submission runs Make 12
(`8925654`: card comment, In Progress, a Technical and a Creative onboarding
task, the Blueprint link, Brand Blueprint Booked, the phase-4 WhatsApp to the
client's group), Make 06 (`9209179`: an AI WhatsApp summary held for approval
in Slack, until the CEO's A3 takes the kickoff's `postcallsummary` webhook
off) and, since Stage 1, the cockpit's own notice in #csm-general, which tags
the creative director. A second submission does all of it again. Every test
below works without a submit.

**Stage 1 of the forms program (2026-10-25,
`docs/forms/STAGE1-CONTRACT.md`) changed this spec in five places.** The
window tells the truth: Make updates the card and books nothing, so the CSM
books the Brand Blueprint call. The trail gains a fifth stop, the team's
notice in #csm-general. The link stop's button opens the cockpit's own Brand
Blueprint, never the retired Typeform `oYZKtogO`. The window shows its own
link to copy. The notice is sent by the Edge Function `cockpit-notices`
(5.2), and where it posts and who it tags are set in the client success
cockpit, Settings, Notices and routing, never in code. Sections 0, 1, 2, 4
and 5 below say so where it matters.

---

## 0. Decisions in one screen

| Decision | Choice |
|---|---|
| Where it opens | Its own window, `/clients/:key/forms/kickoff`, outside the app shell (like the decks). One click from the Onboarding panel and the client page header. |
| Shared screen | A "Just me / Sharing" switch in the window; Sharing hides the whole side panel. |
| The form | Typeform's own `tG7dnxBn`, embedded with `@typeform/embed@6.0.0` (the sales cockpit's version). Make sees an ordinary response. |
| The client ID | `onboarding_client_id` is always the record's `clickup_task_id`, never read from a link or a form. The window shows it before anything else. |
| The other 22 hidden fields | Rebuilt from the client's newest completed onboarding response (Make 13's mapping, below). Make's card link is a cross-check and nothing more. |
| A second kickoff | Warned and held behind a deliberate second click. |
| After submit | "Kickoff sent. Make is updating the card. Book the Brand Blueprint call below." and a five-stop trail (sent, Typeform, the card, the Brand Blueprint link, the #csm-general notice), confirmed by one-card refreshes at 45 s, 2 min and 5 min and by reading the notice. The header's "Open in Typeform" goes, so no fresh form for the same client is one click away. |
| The team hears | The cockpit posts in #csm-general once Make has updated the card ("Kickoff complete", tagging the creative director), or 20 minutes after the kickoff if it has not ("Kickoff in, card not updated", tagging the CSM and the systems manager). Sent by `cockpit-notices` (5.2); the channel, the tags and on or off are rows editors change in Settings, Notices and routing. |
| Make late | After 5 minutes, the headline says who is late, and one plain sentence with a link to the ClickUp card. |
| Backend | One table and two gated functions (record a send, read sends), one audit row per send. No new Edge Function operation: the one-card refresh is the existing `onboarding.refresh`. Since Stage 1, the notices outbox and its sender (`20261025n_slack_notices.sql`, `cockpit-notices`). The Make and Typeform changes A2 and A3 are the CEO's batch (5.4). |
| CSP | Add `https://form.typeform.com` to `frame-src` in `apps/client-success-cockpit/vercel.json`, and `frame-ancestors 'self'` to both cockpit headers (5.3). |

---

## 1. What the CSM does, and where the form opens

### Before the call
1. Client page, **Onboarding & files** tab. "Before the call" shows whether
   the onboarding form (`KFRCXPFx`) is in. If not, **Copy their link**: it
   carries the client ID, so their answers land on this client and later
   fill the kickoff. (This is the CEO's "check the onboarding link first".)
2. Optionally open **Fill the kickoff** ahead of the call. The side panel's
   **Still missing** list (call recording link, contract status, service,
   onboarding answers, payment amount) is what to chase before the client
   joins. Each line is a short pointer: a click scrolls to its row, where the
   full sentence is. The onboarding answers line carries **Copy their
   onboarding link** itself. Opening the form saves nothing. Only Typeform's
   Start does.

### On the call
3. Present the onboarding deck as today. Slide 4's service pick saves to
   prep. The kickoff window reads prep, the call store and the client's row
   again whenever it gets focus (at most every 10 seconds), so the pick shows
   up in the side panel, and onboarding answers that came in after the
   window opened are said over the form (2.1).
4. **Fill the kickoff**: one click, from either place:
   - the Onboarding panel, step "On the call": this replaces today's "Open
     the kickoff form" button and stays the step's one teal button. The
     column follows the call: the onboarding deck (outline), then the
     kickoff, then the onboarding call booking;
   - the client page header, an outline **Fill the kickoff** button beside
     Present (one name for the action everywhere), shown only while the
     client is in onboarding, no kickoff is on record and none was sent
     from the cockpit.

   The window opens by name (`mahara-form-<taskId>-kickoff`, reusing
   `openNamed` from `PresentButton.tsx`) as a window of its own, not a tab
   (`popup`, sized to the screen, 1440 × 900 when the screen does not
   say), so Zoom's "share this window" shares the form alone. A second click
   brings the same window forward and never reloads a half-filled form.
5. Reading their details back to them? Share **this window only** and flip
   the switch to **Sharing**. The side panel disappears, so payment, billing
   and closer notes never reach the client's screen. Flip back to **Just
   me** to read the panel.
6. Walk the form. Groups 1 to 4 already read back their onboarding answers.
   In the form's order, the panel suggests the service (one of the five)
   and the consultation types, and gives the card's contract status and
   daily budget.
7. At the end, copy the **call recording link** and the **payment amount**
   from the panel into the last two questions, then press Typeform's Submit.

### After the call
8. The window shows **"Kickoff sent. Make is updating the card. Book the
   Brand Blueprint call below."** (once Make has done its part: "Kickoff
   sent. The card is updated. Book the Brand Blueprint call below."), with
   "The team hears in {#channel} once the card is updated." under it while
   the notice waits, and the trail: sent, Typeform has it, Make updated the
   card, the card has the Brand Blueprint link, the team hears in Slack. The
   channel is the one Settings, Notices and routing names for the notice
   (the server gives it for a queued notice too), or "Slack" until a notice
   is on record: no channel is written in code. Make books nothing: the CSM books the Brand
   Blueprint call (step 9). Once the link stop is done its button, **Open the
   Brand Blueprint**, opens the cockpit's own Blueprint prep view
   (`/client-success/clients/{taskId}/present/blueprint?view=prep`), never
   the retired Typeform `oYZKtogO`. The stop itself still reads the card's
   Brand Blueprint link, because that is what shows Make got that far.
9. Typeform's ending button ("Book the Brand Blueprint call") opens the
   cockpit's own **Book the Brand Blueprint call** dialog for this client
   (`BookCallButton kind="blueprint"`, the same HighLevel calendar
   `x84ET6KnA8odlsjYiVLq`) instead of leaving the window.
9a. **The team hears in Slack** (#csm-general unless Settings says
   otherwise). Once Make has updated the card (the Kickoff Handoff comment
   is there **and** the card is at Brand Blueprint Booked, both), the cockpit
   posts "Kickoff complete: {client}" and tags the creative director, who
   runs the Brand Blueprint call. If either half is missing 20 minutes after
   the kickoff, it posts "Kickoff in, card not updated: {client}" instead
   and tags the CSM and the systems manager. A reply "Card updated at
   14:31. It has the Kickoff Handoff comment and shows Brand Blueprint
   Booked." follows in its thread once the card changes after that notice
   and has both halves; no reply comes after 48 hours. A second kickoff adds
   a line and tags the CSM.
   The trail's last stop reads "Posted in #csm-general at 14:03" with **Open
   in Slack**. The notice is posted whether or not the window stays open.
10. The cockpit tab gets the same news (a toast and a re-read of the
    Onboarding panel) through a `BroadcastChannel("mahara-forms")` message,
    and a second message (`noted`) once the cockpit has noted the send, so
    the tab's read of the sends never races the note.
    Until Make or the 10-minute sync puts the kickoff on the record, the
    kickoff row reads as sent and pending: a teal dot, "Sent from the
    cockpit today at 14:02 by Lina.", and a quiet **Open the kickoff
    window** link (the window shows the trail, or holds a second kickoff).
    The header's Fill the kickoff is gone. One read of the sends
    (`useFormSend`) serves the header and the panel, so they never
    disagree. Once the kickoff is on record the panel moves to "After the
    call".
11. **The window's own link.** The window shows a quiet line, "This
    kickoff's window", with a copy button for its address, and the
    Onboarding panel's kickoff item has **Copy the kickoff window's link**
    ("Link copied. It opens this client's kickoff window."). The card's
    Kickoff Form Link field is not touched: it keeps Make's prefilled
    Typeform link, which the prefill reads (2.2).

### On the onboarding deck's last slide (2026-10-22)
The CEO: "embed the kick off form at the end of the onboarding
presentation ... just make it easy for them at the end so they can submit
it." The deck's last slide (`docs/csm-decks/DESIGN.md` 23) holds the same
form: `useFormPanel` with this config, read through `useLiveForm`, the card
ID from the record, the same guard and the same trail. The form sits in a
frame on the shared canvas; everything this window keeps in its side panel
(the seal, Still missing, the facts in the form's order, the trail, the
booking) is in the deck's notes window, never on the shared screen. A
kickoff already on record shows "Kickoff on record" with what was filled and
no form; a second kickoff, if ever needed, is this window's. The send
reaches the cockpit tab the same way (`announceForm`), and ticks the deck's
checklist ("Blueprint call").

### Full window, not a sheet
The window is the "full-screen" option the CEO allowed: it can be shared on
its own, it survives navigating the cockpit, and nothing from the app shell
(sidebar, Ask Hermes, Cmd+K) can take focus mid-call. `FormPanel` itself is
layout-free, so the creative director cockpit can mount it in a large
sheet (the sales cockpit's `ClientFormSheet` frame) if that suits the
Blueprint call better.

---

## 2. The reusable FormPanel contract

### Files (client success, `src/forms/`)

| File | What it holds |
|---|---|
| `formConfig.ts` | The contract, types only: `FormConfig`, `FormContext`, `RailPart`, `RailRow`, `Already`, `FormSend`, `SendInput`, `FormNews`. No value, no React, no I/O (split 2026-10-22). |
| `kickoff.ts` | The `KICKOFF` config and the registry of the forms this cockpit opens (`FORM_CONFIGS`, `formConfig(key)`). Pure. |
| `prefill.ts` | Hidden-field builders, the Typeform hash parser and the cross-check, with the kickoff's hidden-field spec (`KICKOFF_HIDDEN`, Make 13's refs). Pure. |
| `formRail.ts` | The kickoff's side-panel facts from the reads (`kickoffRail`). Pure. |
| `formStatus.ts` | The after-submit trail as a function of the reads and the time. Pure. |
| `formTime.ts` | Kuwait's clock for the trail and the panel. Pure. |
| `formClient.ts` | The two new RPCs, zod-checked, with the same sign-in guard as `onboardingClient.ts`. |
| `useFormPanel.ts` | The panel's state without a layout: the guard, the frozen hidden object, the embed, the one note per response, the checks and the trail (split out 2026-10-22, so the onboarding deck's last slide draws the same panel). |
| `FormPanel.tsx` | The kickoff window's layout of that state: the form, the side panel (`RailView`), the guard, the trail (`AfterSend`), the answers (`AnswersSheet`) and the seal (`Seal`). Takes a config and a context. |
| `useLiveForm.ts` | One client's reads for a form (row, deck sources, timeline, sends), the focus re-read, the io and the plain blocked sentences (`blockedFor`), behind injectable reads (`formReads(client, taskId, form)`). |
| `FormWindow.tsx` | The route page: header, seal, Sharing switch, plain states. |
| `OpenFormButton.tsx` | `openForm(taskId, key)` (a window of its own), the button used in the two entry points, and the news between windows. |
| `useFormSend.ts` | The newest send of one form for one client, read once for the client page's header and its Onboarding panel. |

Route: `/clients/:key/forms/:form` with `:form` limited to configured keys,
lazy-loaded, inside `RoleRoute role="csm"` (admins and the CEO pass), outside
`AppLayout`, wrapped in the same error boundary pattern as the decks.

Package: `bun add @typeform/embed@6.0.0` in `apps/client-success-cockpit`
(exact version, matching the sales cockpit).

### The config

```ts
type FormKey = "kickoff" | "blueprint" | "checkin";

interface FormConfig {
  key: FormKey;
  formId: string;                 // "tG7dnxBn"
  title: string;                  // "Kickoff"
  idField: "onboarding_client_id" | "task_id";
  resultsUrl: string;             // Typeform's results, for a response gone astray
  /** The 23 (kickoff) hidden values, with where each came from. */
  hidden(ctx: FormContext): Prefill;
  /** Side-panel parts, in the form's order. */
  rail(ctx: FormContext, prefill: Prefill): RailPart[];
  /** A response already on record for this client, or null. */
  already(ctx: FormContext): Already | null;
  /** What a second send repeats, for the warning before it. */
  again: string;
  /** What the form's submit sets off, after a send. */
  makeDoes: string[];
  /** The ending's button opens the cockpit's own booking; its label is the ending's words. */
  ending: { book: "blueprint"; label: string } | null;   // "Book the Brand Blueprint call"
  /** Partial submit point (Blueprint only): see section 2.6. */
  partial?: { afterRef: string; say: string };
  after: {
    say: string;                  // "Kickoff sent. Make is updating the card. Book the Brand Blueprint call below."
    doneSay: string;              // once the card stops are done: "Kickoff sent. The card is updated. Book the Brand Blueprint call below."
    sub(where: string): string;   // the muted line while the notice waits: "The team hears in {where} once the card is updated."
    lateSay: { make: string; typeform: string };  // the headline once a step is late
    lateMake: string;             // Make is late, in full: names the card comment Make writes
    checksAtSec: number[];        // [45, 120, 300]
    lateAfterMin: number;         // 5
    cardDone(row: OnboardingRow, sentAt: string): boolean;
    cardLine(row: OnboardingRow): string;         // "The card is at Brand Blueprint Booked."
    linkBack?: {                  // a stop that reads a link Make writes back
      key: LinkKey;               // "blueprint_form": the stop reads links[key]
      label: string;              // done: "The card has the Brand Blueprint link"
      pending: string;            // waiting: "Make adds the Brand Blueprint link to the card"
      short: string;              // folded summary: "the Blueprint link"
      open: string;               // the button: "Open the Brand Blueprint"
      href?: (taskId: string) => string;  // the button's target: the cockpit's Blueprint prep view
    };
    notice?: {                    // the Slack stop, after the link stop (Stage 1)
      kind: "kickoff";
      pending(where: string): string; // "The team hears in {where}": the notice's channel, else "Slack"
      line: string;               // "Once Make has updated the card, usually within a few minutes."
    };
  };
}

interface FormContext {
  taskId: string;                 // the route key, already gated
  row: OnboardingRow;             // cockpit_csm_onboarding_read, this card
  deck: DeckSources | null;       // cockpit_csm_deck_sources: offer, HighLevel, prep
  timeline: ClientTimeline | null;// cockpit_csm_client_timeline: calls, form history
  sends: FormSend[];              // cockpit_csm_form_sends_read
  me: { email: string; firstName: string | null };
  notices: NoticeRead | null;     // cockpit_slack_notice_read, this card (Stage 1)
  now: string; readAt: number;    // the server's clock at the last read
  failed: { deck?: string; timeline?: string; sends?: string; notices?: string };
}

interface Prefill {
  values: Record<string, string>;                // empty values left out
  from: Record<string, "record" | "onboarding form" | "card link" | "card name">;
  notes: string[];                               // plain sentences for the panel
  noOnboarding: string | null;                   // said in the "Onboarding answers" row
  linkChars: number;                             // the public link's length
  onboarding: FormEntry | null;
  copy?: { label: string; value: string; done: string };  // their onboarding link
}
```

Nothing in `FormPanel` names a form: every sentence that does (the late
headline and sentence, the booking label, the link Make writes back and its
wording) is the config's, so the Blueprint brings its own.

The kickoff is one object of this shape. The Blueprint and check-in are two
more objects (sections 2.6 and 2.7). Everything form-specific lives in the
config; `FormPanel` never names a form.

### 2.1 How the link is built

- The **embed**: `createWidget(formId, { container, hidden: prefill.values,
  inlineOnMobile: true, medium: "mahara-client-success", redirectTarget:
  "_blank", onReady, onStarted, onSubmit, onEndingButtonClick, enableSandbox:
  rehearse, iframeProps: { title: "Kickoff form for <client>" } })`. The SDK
  puts hidden fields in the iframe's URL hash, which never reaches a server.
- **`redirectTarget: "_blank"`** is required. The kickoff's ending
  (`d6cdedfc…`) redirects to the GHL booking page, and the SDK's default
  `_parent` would navigate the whole window away on submit. With
  `onEndingButtonClick` set, the SDK does not redirect and the cockpit opens
  its own booking dialog. `_blank` stays as the belt and braces.
- The **fallback** link ("Open in Typeform", and the "not loading" message):
  `https://maharamedia.typeform.com/to/tG7dnxBn#` + `new
  URLSearchParams(prefill.values)`. It is never joined by hand: phones start
  with `+`, which has to go out as `%2B`. If the record cannot be read, the
  fallback is today's plain `kickoffFormLink(taskId)` (card ID only).
- **Frozen at open.** The hidden object is built once when the widget mounts
  and is never rebuilt under a form being filled. The window reads the
  client's row again on focus (a failed read, or no row, keeps the row it
  has). If newer onboarding data arrives, a strip across the top of the form
  column (where the rehearsal banner sits, and not while Sharing) says:
  "Their onboarding answers changed after this form opened. Reload the form
  to use them." with a **Reload the form** button. It never reloads by
  itself. So a CSM who opened the kickoff before the client filled the
  onboarding form, and clicks Fill the kickoff again, sees the strip.
- **No preselect.** The SDK can preselect only the first question, so the
  service and the other choices are suggested in the panel, not set in the
  form.

### 2.2 Hidden fields: sources and fallbacks (kickoff)

The onboarding refs are Make 13's (module 29), read 2026-10-22. They match
the refs stored in `forms.onboarding.answers` for all seven clients in
onboarding. Values are taken as the mirror stores them (`answerValue`):
multi-choice joined with `", "`, numbers as text with `"0"` kept, Arabic and
line breaks as typed.

| Hidden | Source (onboarding ref) | Fallback |
|---|---|---|
| `onboarding_client_id` | the record's `clickup_task_id`, which must equal the route key | none: without it the form stays closed |
| `legal_name` | `514bfd3f` Business name | the card name (so Make 12's task names and the Blueprint link are never blank) |
| `email` | `7994f0d2` | card link value |
| `phone` | `64f2fb80` Phone (not `282dac48` front desk, not `09d2e62a` personal) | card link value |
| `address` | `e5caee43` | card link value |
| `maps_link` | `f7f9f2eb` | card link value |
| `instagram` | `adecfe45` | card link value |
| `website` | `454a425f` | card link value |
| `facebook` | `575d17ed` | card link value |
| `booking_platform` | `7a120dbb` | card link value |
| `hours` | `b7873d40` | card link value |
| `consultants` | `0a80a0a8` | card link value |
| `service_focus` | `6271b610` (free text, often Arabic) | card link value |
| `consultation_types` | `b370341c`, labels joined `", "` | card link value |
| `payment_options` | `ee25f923` | card link value |
| `last_revenue` | `7ff5d37a`, `"0"` kept (Make writes a blank) | card link value |
| `goal_90d` | `791b99b8` | card link value |
| `goal_12_24` | `f4b96a9b` | card link value |
| `marketing_tried` | `bf8c7c7b` | card link value |
| `challenges` | `fcf43e6a` | card link value |
| `why_joined` | `7426c6c5` | card link value |
| `client_notes` | `41d2d5bb` (optional) | card link value |
| `content_drive` | `64d23c81` (optional) | card link value |

Rules, in order:
1. **The ID.** `onboarding_client_id = row.clickup_task_id`. If the route key,
   the gated roster ID and the row disagree, the form stays closed (see
   2.5). A card link carrying another ID is marked out of date and never
   used for any value.
2. **The onboarding response** is the newest *completed* one on record
   (`forms.onboarding`, already newest-by-card). An unfinished onboarding
   form never fills a kickoff.
3. **The card link** (`links.kickoff_form`) is read only if its path is
   `/to/tG7dnxBn` and its ID is this card's. Its values fill a key only when
   the onboarding response has none for it, or when the mirror's value is
   exactly 4,000 characters long (the mirror's cut) and the link's value is
   longer and starts with it. A value at the cut with no such link goes as
   it is, and the panel says so: 'Their "Top challenges" answer is longer
   than the cockpit keeps, so the form carries its first 4,000 characters.'
   (No onboarding answer of the 46 reaches 4,000 characters today.)
4. **Cross-check.** Compare the build with the card link after allowing for
   `","` versus `", "` and a blank versus `"0"`. A difference becomes a
   panel note ("The card's kickoff link differs on 2 fields. The form uses
   their onboarding answers."). It never blocks the form.
5. **No onboarding response** (one of seven today): the form opens with the
   ID and `legal_name` from the card only. The panel's "Onboarding answers"
   row in Still missing says so ("<Client> has not filled the onboarding
   form, so the kickoff opens with their name and card only.") and holds
   **Copy their onboarding link**.
6. **Length.** No value is cut. Built links (`URLSearchParams` encoding) run
   about 2,720 characters at the median and 13,893 at most (90th percentile
   6,111; 11 of 46 over 4,000); 3,168 is the longest proven end to end. Over
   4,000 characters the panel adds: "Their answers are long. If the form
   opens empty, use Open in Typeform." Section 7 proves the longest live
   onboarding client, 86eyew6mt (4,499 characters as built; Make's card
   link is 4,783), before launch.

### 2.3 The side panel's facts (the contract; content in section 3)

A `RailPart` is `{ title, rows: RailRow[] }`. A `RailRow` is `{ label, value |
null, source, copy?: boolean, copyValue?: string, missing?: string }`, and
optionally:
- `href` and `linkLabel` (a link; when the value is the link, only the link
  shows, on one line);
- `suggest` (the "Suggest" tag: the value comes from the client's words or
  the deck, and the CSM picks in the form);
- `recheck` ("Check again", shown only while the value is missing);
- `choices` (the form's options, the suggestion ringed);
- `anchor` (a Still missing pointer: the row it scrolls to) and `action` (a
  copy action in the row itself);
- `empties` (several empty rows in one line);
- `carries`, `carriesFrom` and `blank` ("What the form carries").

`source` is a short tag ("Onboarding form, 13 Oct", "ClickUp card", "Slide
4, onboarding deck", "Fathom, today 13:10"). A row with no value always shows
its `missing` sentence ("Not on record."), never a zero or a dash. Two or
more plain empty rows in a row are said once: "Not on record: Daily budget,
Facebook access, Calendar, Content." A row Still missing points to always
stays its own.

### 2.4 Submit detection

- `onSubmit({ responseId })` is the only trigger. In rehearsal (Typeform's
  sandbox) the ID is `"__sandbox"` and nothing is recorded.
- The panel then calls `cockpit_csm_form_sent` with the card ID, the form
  key, the response ID, the names of the hidden fields that went filled, a
  SHA-256 of the canonical hidden object, and the ID the form carried. The
  server re-checks everything and writes one row and one audit row (section 5).
- If that call fails, Typeform still has the response and Make has
  started. The panel says: "The kickoff went to Typeform, but the cockpit
  could not note it. <reason>." with **Try again**, and the trail's first
  stop reads "Sent at 13:30. Not noted in the cockpit yet." Retrying is
  safe: the response ID is the key. The trail keeps the submit's own clock
  after a retry (the server stamps `sent_at` at the retry, and Make's change
  to the card comes seconds after the submit), so a late note never makes
  Make look late.
- `onStarted` marks the form as in progress. From then until submit, closing
  the window asks the browser's "Leave site?" question.

### 2.5 Empty and error states (plain words)

| State | What the window says | What still works |
|---|---|---|
| Loading | "Loading the form…" | |
| Form not loaded after 20 s | "The form has not loaded here. Open it in Typeform: it carries the same client and answers." | Open in Typeform |
| Client not on your list (gate) | "This client is not on your list, so the kickoff cannot open here. Ask your lead to add this client, then try again." | Close this window |
| Roster refreshing (gate) | "The client list is refreshing. Try again in a minute." | Try again |
| Card name and roster disagree | "The card's name and the client list disagree, so the kickoff stays closed. Refresh the client list, then try again." | |
| Card never read | "This card has not been read yet. Refresh reads ClickUp and Typeform now." | Refresh |
| Record unreadable | "The client's record could not be read, so the kickoff stays closed: a form without the right card ID reaches no client." | Open the plain kickoff (card ID only) |
| No onboarding answers | "<Client> has not filled the onboarding form, so the kickoff opens with their name and card only." | Copy their onboarding link |
| Kickoff already on record | see 4.4 | Read what was filled; Open a second kickoff anyway |
| A side-panel read failed | that part only: "The offer and HighLevel details could not be read just now." | The form, and every other part |
| The cockpit's own sends could not be read | over the side panel: "The cockpit could not check for a kickoff already sent from here: <reason>. Look at the client's Onboarding panel before you send." (the guard still reads the record and the form history) | The form; the server still marks a second send |

The plain states (loading, blocked, unread) show no Just me / Sharing
switch, since there is nothing to hide, and their sentence is balanced so
no word is left alone on its line.

### 2.6 How the Brand Blueprint will use it (not built here)

- **Where:** the creative director cockpit, gated for its seats plus admin
  and the CEO. Apps cannot import from each other, so the core of
  `src/forms/` is copied byte for byte and pinned in
  `scripts/check-shared.sh`, with only the config files, the reads and the
  gate differing.
- **The core and the rest.** The core is six files: `formConfig.ts` (the
  contract, types only), `useFormPanel.ts`, `FormPanel.tsx`,
  `formStatus.ts`, `formTime.ts` and `prefill.ts`. The rest is the
  kickoff's or this cockpit's own and is not copied: `kickoff.ts` (the
  config and the registry; the Blueprint brings `blueprint.ts`),
  `formRail.ts` (the kickoff's side panel), `formClient.ts` and
  `useLiveForm.ts` (this cockpit's gated calls), `FormWindow.tsx`,
  `OpenFormButton.tsx` and `useFormSend.ts`. `kickoffAlready`,
  `kickoffCardDone` and `KICKOFF_HIDDEN` ride along inside the core files
  unused. `scripts/form-contract.test.ts` pins the list below against the
  core's imports.

#### The core's dependencies on the client success app

Everything the six core files import from outside themselves. The creative
director cockpit has, or copies, each one:

| Import | What the core uses |
|---|---|
| `react` | hooks |
| `sonner` | `toast` (copy confirmations, the rehearsal's booking note) |
| `lucide-react` | `Check`, `ChevronRight`, `Copy`, `RefreshCw`, `RotateCcw` |
| `@typeform/embed` | `createWidget` and `WidgetOptions`, loaded on demand, version 6.0.0 |
| `@typeform/embed/build/css/widget.css` | the SDK's stylesheet, loaded with it |
| `@/components/kit` | `Dot`, `ExtLink`, `Kicker` |
| `@/components/ui/button` | `Button` |
| `@/components/ui/popover` | the seal's popover |
| `@/components/ui/sheet` | the answers sheet |
| `@/lib/utils` | `cn` |
| `@/lib/format` | `shortDay` (formTime) |
| `@/lib/onboardingCore` | `FORMS` (the onboarding form's ID); the types `OnboardingRow`, `FormEntry`, `LinkKey` |
| `@/lib/csmCalls` | the types `Timeline`, `TimelineForm` |
| `@/present/sources` | the type `DeckSources` (the context's deck read) |

And the CSS the panel's class names need, beyond Tailwind's own:

| Class or token | Defined in |
|---|---|
| `txt-warn`, `txt-good`, `callout-warn`, `glow-teal`, `no-marker` | `src/index.css` |
| `text-primary-ink` (`--primary-ink`), `bg-success`, `bg-warning`, `border-warning`, `bg-primary/…`, `ring-primary` | the theme tokens in `src/index.css` |
| `animate-in`, `fade-in`, `zoom-in-50` | `tw-animate-css` |
- **Form:** `oYZKtogO`, `idField: "onboarding_client_id"`.
- **Hidden fields, from the kickoff first:**

  | Hidden | Source, then fallback |
  |---|---|
  | `onboarding_client_id` | the record |
  | `legal_name` | the kickoff's hidden `legal_name` → onboarding `514bfd3f` → card name |
  | `service_focus` | the kickoff's "Which service are we advertising?" (`c…07`) → onboarding `6271b610` |
  | `daily_budget` | kickoff Q22 (`cf53482c`) → card Daily Budget (`539743c2`) |
  | `consultation_types` | kickoff Q11 (`c…08`) → onboarding `b370341c` |
  | `website`, `instagram` | kickoff hidden → onboarding `454a425f`, `adecfe45` |
  | `csm_name` | the card's CSM, first name (Make 12 always leaves it empty) |
  | `brand_dna_link` | the card's Brand DNA link `89bbb8b0` (Make 12 always leaves it empty) |

- **Shorter:** the panel lists what is already known beside each question, so
  less is typed. Removing questions is a Typeform edit for the Blueprint's
  own spec.
- **Partial submit:** the form already has a partial submit point after
  `bb0018…` and sends partials to integrations, and Make 14 already routes
  `form_response_partial` to "New Client Campaign Launch". But the
  "blueprint" webhook subscribes to `form_response` only, so that route never
  fires. Turning it on is one Typeform webhook setting, which is the
  Blueprint build's decision. The panel's part is config: `partial: {
  afterRef: "bb0018…", say: "Starter ads brief sent to media." }`. When
  `onQuestionChanged` leaves `bb0018`, the panel records a `partial` send and
  confirms it with a read of Typeform's partial responses.
- `ending: null`, `after.cardDone`: Make 14's complete route sets "Can
  Self-Record?" and Onboarding Map phase 5. Its own `after.lateMake` names
  what Make 14 leaves on the card (there is no "Handoff" comment there), and
  its own `linkBack`, if any.
- Before it ships, `scripts/kickoff-prefill-check.ts`'s declared-keys check
  is run against `oYZKtogO` for the Blueprint's hidden keys: Typeform drops a
  value whose key the form does not declare.

### 2.7 The check-in form, for completeness
`fRokTITH`, `idField: "task_id"`. Its history shows typed IDs gone wrong
("test", "CLIENT-DEMO-001"); the record-built ID fixes that. `after.cardDone`:
the card's Client Happiness or Last POC changed after the send (Make 06,
route 1).

Superseded: the 1-1 notes are native (PLAN D7, docs/forms/STAGE2-CONTRACT.md).

---

## 3. The side panel during the call

Parts are in this order. In **Sharing** mode the whole panel is hidden.

**Still missing** (shown only when something is missing; orange dots).
Short pointers: each line is a button that scrolls to its row and marks it a
moment, where the full sentence is said once.
- Call recording link (required): "Not in the call store yet." → the
  recording row.
- Contract status (required): "Ask on the call." → the contract row.
- Service (required): "Ask on the call." → Q10.
- Onboarding answers: "<Client> has not filled the onboarding form, so the
  kickoff opens with their name and card only." with **Copy their
  onboarding link** in the same row (no pointer: the row is the answer).
- Payment amount: "Not on the card." → the payment row.

**The client**

| Fact | Shown as | Source, in order | When missing |
|---|---|---|---|
| Offer | the offer line, with "Offer cheat sheet" as an external link | `editor_clients.offer` / `offer_url` (deck sources) → card Offer Cheat Sheet link | "Not on record." |
| Area | city and country by name ("Salmiya, Kuwait", `Intl.DisplayNames`), then their service areas answer | HighLevel `ghl_clients` country and city (deck sources) → onboarding "Service areas" answer | "Not on record." |

The five services are drawn once, on Q10 below, not again here. The card's
"Service Advertised" field (`bab9a58b`) is never read: Make 12's switch never
matches the multi-select answer, so it is empty on every card.

**In the form's order**

| Kickoff question | Panel row | Source, in order | When missing |
|---|---|---|---|
| Q10 Which service are we advertising? | the five main services as the form's exact labels (Design and build, Interior design, Architectural design, Fit out and renovation, Construction only), the suggested one ringed in teal, their own words under each; "In their words: …" for Other | `resolveService` in the onboarding deck's order: slide 4's choice (prep `service_focus` with `service_chosen_at`) → prep → onboarding `6271b610` and "What services do you offer" | "Not on record. Ask which of the five they want first." |
| Q11 Consultation types | "Suggest" and the onboarding labels | onboarding `b370341c` | "Not on record." |
| Q15 Contract status | the card's status, mapped to the form's five choices (a fact, no tag) | card Contract Status `ac976d4a` → Contract Signed `91e9e408` | "Not on record. Ask on the call." |
| Q22 Daily budget | "$40 a day"; the copy button copies "40" | card Daily Budget `539743c2` (a ClickUp currency field in USD) | "Not on record." |
| G7 Facebook access | their Business Manager answer | onboarding `ddf2767d` | "Not on record." |
| G8 Calendar | booking platform and appointment length | onboarding `7a120dbb`, `a20cfc1a` | "Not on record." |
| Q32 Content | their Drive link | onboarding `64d23c81` | "Not on record." |
| Q44 Call recording link (required) | "Open the recording ↗" on one line, with a copy button (copies the URL) | today's onboarding call with a recording in the call store (`cockpit_csm_client_timeline`, Fathom, Kuwait day) | "Not in the call store yet. It arrives a few minutes after the call ends. Check again, or paste it from Fathom." with **Check again** (only while missing) |
| Q45 Payment amount | "$1,000"; the copy button copies "1000" | card Next Payment Amount `f071ee8f` (new in `onboardingCore.F`; a ClickUp currency field in USD) → the card's Billing lines as a hint, not a number → Payment Plan as context | "Not on record." |
| Groups 1–4, the read-backs | last, folded (never open by default): "What the form carries · 22 of 22 · onboarding form, 13 Oct". The shared source is said once in the title; only a value from elsewhere (the card link, the card name) is tagged. Blank keys are one line: "Left blank: Anything else." ("Not on record: …" without onboarding answers) | the prefill (2.2) | as said |

Typeform reads the carried values back itself, so they sit after Payment,
and the rows the CSM needs on the call stay above the fold at 1440 and 1920.
Two or more plain empty rows in a row are one line ("Not on record: Daily
budget, Facebook access, Calendar, Content."). A row Still missing points to
always stays its own.

The cockpit never computes a payment. Today Next Payment Amount is filled on
3 of the 7 onboarding cards, Billing on 5 and Payment Plan on 6. Both money
fields are ClickUp currency fields whose `currency_type` is USD (read
2026-10-22), so the panel writes dollars; Typeform's number field gets the
digits only.

**From the sale** (fold): closer, closer's notes, handoff risks
(`handover`). These are what the panel already shows on "Before the call".

Each row's copy button toasts "<Label> copied." On failure: "The browser
would not copy. Select the text instead." (the row's text is on screen).
The trail's own copy of the window's link shows the link in a read-only box
when the browser will not copy: "The browser would not copy. Select the link
below instead."

---

## 4. After submit

### 4.1 What the window shows
Above the trail, in a teal-ringed strip: **"Kickoff sent. Make is updating
the card. Book the Brand Blueprint call below."**, and once the card and
link stops are done, **"Kickoff sent. The card is updated. Book the Brand
Blueprint call below."** (the late sentence when a step is late). Under it,
while the Slack notice still waits, a muted line: "The team hears in
{#channel, or Slack} once the card is updated." It goes once the notice is
posted, off, skipped or stopped: the Slack stop says that itself. (Make books
nothing, and the old line about Make's WhatsApp summary is gone: that draft
never reached a client, and A3 takes its webhook off.) The header's "Open in
Typeform" is gone from here on: it would open a fresh form for the same
client, a second kickoff without the guard.

The trail, a thin vertical line with five stops. Each stop is written in the
tense of its state; a pending stop says only what is useful next, only on
the current stop, and not once that step is late. The current stop carries
the window's one teal glow:

| Stop | Done when | Pending | Done |
|---|---|---|---|
| Sent | the send row exists | | "Sent from the cockpit at 14:02." ("Sent at 14:02. Not noted in the cockpit yet." while the note has failed) |
| Typeform | `row.forms.kickoff.response_id` equals the send's ID, or the timeline's form history has its token | "Typeform lists it", "Usually within a minute." | "Typeform has it", "Submitted at 14:02." |
| Card | `client_status` is Brand Blueprint Booked♠️ (or a later stage: LAUNCH BOOKED, Ready For Launch🚀, Active) **and** `card_updated_at` is at or after the submit | "Make updates the card", "Usually within a minute of Typeform." | "Make updated the card at 14:03", "The card is at Brand Blueprint Booked." |
| Link | the card stop is done and `links.blueprint_form` is present | "Make adds the Brand Blueprint link to the card" | "The card has the Brand Blueprint link", then **Book the Brand Blueprint call** (teal) and **Open the Brand Blueprint** (the cockpit's own Blueprint prep view, `linkBack.href`; never the retired Typeform) |
| Slack | the `kickoff` notice whose `responseId` is the send's is `posted` (`muted` and `skipped` count as done, quietly) | "The team hears in {#channel}" (the notice's channel as Settings names it; "Slack" before a notice is on record), "Once Make has updated the card, usually within a few minutes." | "Posted in #csm-general at 14:03", with **Open in Slack** when Slack gave a link. A late notice adds "It says the card was not updated, so the team checks it." |

The Slack stop reads `cockpit_slack_notice_read(taskId)` with the window's
other reads and on every check, and, while it is pending or its last read
failed and the window is visible, again every 60 seconds for 25 minutes (a
kickoff waits for Make up to 20 minutes by design; one failed read never ends
the watch). It is written from the notice's state:
- `queued` or `sending`, or no notice yet: the pending words above.
- `failed`: "Not posted. {Reason}. Tell the tech lead.", with a warning dot.
  "Not posted." is drawn in the warning tone and the reason as a plain
  sentence after it; the reason never carries a label of its own.
- `unknown`: "Not confirmed. {Reason}. Tell the tech lead.", the same way.
  An unknown may already be in Slack, so it never says "not posted"; the
  sender never posts it twice.
- "Tell the tech lead." is left off when the reason already names the tech
  lead.
- `muted`: "Not posted: the kickoff notice is off in Settings." (done,
  quietly).
- `skipped`: "Not posted. {Reason}." (done, quietly), for example a kickoff
  more than 48 hours old when the mirror listed it.
- The read failed: "The cockpit could not read the Slack notice just now.
  Check now reads it again." (not done, and not the current stop).

When every stop is done, the line under the trail says "All five steps are
done." A notice that was off or skipped is done but not a success: the line
says "The card's steps are done. The Slack notice was not posted." instead.
The folded summary (below 1024 px) reads "Kickoff sent · posted in Slack"
(or "· not posted in Slack" when the notice was off or skipped). A notice
that needs a person outranks every wait there: "Not posted in Slack · tell
the tech lead" (or "Not confirmed"), with the warning dot; it fits at 320 px
and wraps rather than lose its instruction, and the fold opens by itself, as
it does for a late step. When "Kickoff complete" posts while the window's copy
of the card still waits, the window reads the card once, so the trail never
says "Make is late" beside a complete notice. The deck's last
slide shows the same trail without the Slack stop: the deck is on the
client's screen.

The Onboarding Map phase is not used as a signal: three GHOSTED cards
already sit at phase 5 without a kickoff.

A fold, **What Make does now**, lists `makeDoes`, as the card shows it:
"The Kickoff Handoff comment, with every answer, on the client's ClickUp
card."; "A Technical Onboarding task and a Creative Onboarding task."; "The
Brand Blueprint link on the card, and the card at Brand Blueprint Booked.";
"The Onboarding Map at phase 4."; "The phase 4 WhatsApp to the client's
group." Make books nothing, and Make 06's summary is no longer listed.

Below 1024 px the panel is a fold above the form. After a send its summary
carries the trail ("Kickoff sent · waiting for Make", "Kickoff sent · Make
is late" with a warning dot), and it opens on its own when a step is late.
Every nested fold has its own named group, so a chevron turns only with its
own fold.

### 4.2 How it refreshes the client
- **One-card refresh**: the existing `onboarding.refresh` operation with
  `taskIds: [taskId]`, at 45 s, 2 min and 5 min after the send, and on **Check
  now**. Each run writes a `cockpit_client_onboarding_runs` row
  (`trigger='one'`) and the row change. The existing audit triggers
  (`cockpit_audit_csm_state`) leave an audit row for both. The panel reads the
  timeline again at the same times for the form history and the recording.
- After 5 minutes the window stops asking. The 10-minute cron sync carries on,
  and every later read (window, Onboarding panel) works the trail out again
  from the same data. The trail's state is never stored.
- While a check runs, the Check now icon spins (motion-safe). The line under
  the trail says "Checked ClickUp and Typeform at 14:04." A failed check says
  "The cockpit could not read ClickUp and Typeform just now: <reason>. The
  kickoff is safe in Typeform; the 10-minute sync will catch up." (the
  reason's own full stop is dropped, so the sentence never reads "..").

### 4.3 When Make has not updated the card after 5 minutes
The headline changes, so the window never says "all fine" and "not fine" at
once, and the current stop's dot turns `--warning` with no glow. The
sentence sits in a callout in `--foreground` ink with a warning dot, its
first sentence in bold:
- Typeform has it, the card has not changed: headline **"Kickoff sent. Make
  has not updated the card yet."**; **"Make has not updated the card in 5
  minutes.** The kickoff is safe in Typeform. Open the card and look for the
  Kickoff Handoff comment; if it is not there, tell the tech lead. Do not
  send the kickoff again." with **Open the ClickUp card** (`links.clickup`,
  one trailing ArrowUpRight). Both are the config's (`after.lateSay`,
  `after.lateMake`): the "Kickoff Handoff" comment is Make 12's.
- Typeform does not list it either: headline **"Kickoff sent. Typeform has
  not listed it yet."**; **"Typeform has not listed this kickoff after 5
  minutes.** Look for it in Typeform's results before anything else, and do
  not send it again." with **Open Typeform's results**.

The Onboarding panel's kickoff row shows the same one-line state, with the
day, so it reads right the next day too: "Sent from the cockpit today at
14:02 by Lina. Make updated the card at 14:03." (on another day: "on 15 Oct
at 14:02").

The team does not depend on this window being open. The cockpit's notice
waits for the card for 20 minutes, not 5: Make takes at most about 2.5
minutes and the mirror publishes every 10, so 20 is the line where the card
is late. "Kickoff complete" needs both halves of Make's run: the Kickoff
Handoff comment (module [11], written first) and the card at Brand Blueprint
Booked (module [21], later). At 20 minutes without both it posts "Kickoff
in, card not updated: {client}. Open the card and check it." in the
kickoff's channel and tags the CSM and the systems manager ("Do not send the
kickoff again." is in it too). The line says which half is missing: no
Kickoff Handoff comment; the comments could not be read; or the comment is
there but the card shows another stage (a run that broke after its first
step). This is the check that Make's status step (module [21]) still
completed. A reply "Card updated at 14:31. It has the Kickoff Handoff comment
and shows Brand Blueprint Booked." follows in that thread only once the card
has changed after the late notice and has both halves (the sender checks the
comment again every 10 minutes); 48 hours after the kickoff it stops
waiting and posts nothing, and the late notice stands.

### 4.4 A second kickoff
`already` is true when any of these holds: `forms.kickoff` on the record
(either form version), a kickoff send row for the card, or a kickoff in the
timeline's form history. Four of the seven clients in onboarding have one
today. The window then holds the form behind this warning:

> A kickoff for <Client> went in on 15 Oct. Sending another runs Make again:
> a second Kickoff Handoff comment, a second Technical and Creative task and
> a second WhatsApp to the client's group. Fix a wrong answer in Typeform's
> results instead.

(The day can read "on 15 Oct from <who>" when the cockpit's own send row
names who sent it. The text after "Sending another runs Make again:" is
`KICKOFF.again`, which a test pins.)

It reads as a stop, not a note: the kicker is "● Already sent" in the
warning ink. The actions are laid out on purpose: first **Read what was
filled** and **Open Typeform's results**; under a hairline, a muted "Only if
the first one cannot be fixed:" and the outline **Open a second kickoff
anyway**, which loads the form. The answers sheet is titled "Kickoff for
<Client>", and an answer that is a link opens as one. The server marks any
send after the first as `second`, whatever the browser says.

---

## 5. Backend

### 5.1 Supabase (one migration, e.g. `20261023a_csm_form_sends.sql`)

```sql
create table public.cockpit_csm_form_sends (
  response_id   text primary key check (response_id ~ '^[A-Za-z0-9]{8,64}$'),
  form_key      text not null check (form_key in ('kickoff','blueprint','checkin')),
  form_id       text not null,
  task_id       text not null check (task_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  client_name   text not null,
  hidden_keys   text[] not null,      -- names only; the values live in Typeform
  hidden_sha256 text not null check (hidden_sha256 ~ '^[0-9a-f]{64}$'),
  second        boolean not null,
  sent_by       uuid not null,
  sent_by_email text not null,
  sent_at       timestamptz not null default now()
);
create index on public.cockpit_csm_form_sends (task_id, form_key, sent_at desc);
alter table public.cockpit_csm_form_sends enable row level security;
revoke all on public.cockpit_csm_form_sends from public, anon, authenticated;
grant all on public.cockpit_csm_form_sends to service_role;
```

- **`cockpit_csm_form_sent(p_task_id, p_form_key, p_response_id,
  p_hidden_keys, p_hidden_sha256, p_carried_id) returns jsonb`**, `SECURITY
  DEFINER`, `search_path=''`:
  - `ctx := cockpit_csm_client_gate(p_task_id)`.
  - Accepts `kickoff` only for now. Each later form adds its own line and
    gate.
  - `form_id` comes from a constant in the function (`tG7dnxBn`), never from
    the browser.
  - Refuses `__sandbox` and any ID that fails the pattern.
  - Refuses `p_carried_id <> p_task_id`: "The form carried another card's ID.
    Find this response in Typeform before anything else."
  - Sets `second` itself: an earlier send for the card, or `forms.kickoff` in
    `cockpit_client_onboarding`.
  - Inserts `on conflict (response_id) do nothing`. Only when it inserted, it
    writes one `cockpit_audit_log` row: `action 'csm_form.sent'`,
    `entity_type 'cockpit_csm_form_sends'`, `entity_id` = the response ID,
    `actor_email` = the gate's email, `source_app 'client-success'`,
    `source_system 'typeform'`, `after` = the row, `metadata {client_name,
    form_key, second}`.
  - Returns `{ send, noted }`.
  - `GRANT EXECUTE` to `authenticated`; revoked from `PUBLIC`, `anon` and
    `service_role`.
- **`cockpit_csm_form_sends_read(p_task_id, p_form_key) returns jsonb`**,
  `STABLE SECURITY DEFINER`: gated the same way; returns the card's newest 10
  sends for that form plus the server's `now()`. Granted the same way.
- Both return a send as `cockpit_csm_form_send_json` draws it: the sender's
  first name (`sentBy`), never their address. `sent_by_email` stays in the
  table and in the audit row's `after`, which only the service key reads.

This is a server-gated action with its own audit row. It calls no provider,
so it needs no Edge Function. Nothing is granted on the table itself.

### 5.2 Edge Functions
- **No new operation for the window.** The one-card refresh is
  `cockpit-csm-api` `onboarding.refresh` (gate, ClickUp and Typeform through
  `tools.ts`, health ledger, run row, publish).
- **`cockpit-notices` (Stage 1, new), the #csm-general notice.**
  - Queued in the database, not by the window: a trigger on
    `cockpit_client_onboarding` queues one `kickoff` row in
    `cockpit_slack_notices` (`dedupe_key = kickoff:{response_id}`) when the
    mirror or the one-card refresh lists a new kickoff response; a sweep on
    every run is the second source. A kickoff more than 48 hours old when it
    is listed is `skipped`, never posted (the migration seeds every kickoff
    already on record that way). `second` is set when the card had another
    response or the send row says so.
  - Sent by pg_cron `mahara-slack-notices` every minute (only when there is
    work) through the function, with `x-cron-secret` (JWT check off). It
    claims a kickoff once the card looks done (the `BLUEPRINT_ON` stages and
    `card_updated_at` at or after the submit, the trail's own rule, pinned by
    a test) or 20 minutes have passed. It then reads the card's comments
    through the `tools.ts` ClickUp helper: a "Kickoff Handoff" comment dated
    at or after the submit gives "Kickoff complete"; none yet within 20
    minutes waits a minute (never counted as a try); after 20 minutes it is
    "Kickoff late".
  - Posts as mahara-club-bot with `slackTools` (appended to
    `cockpit-csm-api/tools.ts`). Every call has an intent and a response row
    in `cockpit_csm_provider_health`. A post counts only when Slack's receipt
    names the channel it asked for; anything else is `unknown` and is never
    sent again (a person looks for its `Ref CN-` marker; the RUNBOOK's "Slack
    notices" section).
  - The text names roles, never people ("Filled by the CSM", the creative
    director tagged), and never carries answers, prices, budgets, phone
    numbers or emails. Links are the cockpit's onboarding tab and the
    ClickUp card.
  - **Where it posts and who it tags are rows, not code (D17).**
    `cockpit_slack_notice_settings` holds on or off, the channel (from
    `cockpit_slack_channels`, each checked by the sender before it can be
    chosen) and the tags (a seat rule, or named people from the team list)
    for `kickoff`, `kickoff.late`, `kickoff.second` and `kickoff.updated`.
    The CEO, an admin, or a seat they add changes them in the client success
    cockpit, Settings, Notices and routing; each change is an audit row with
    the old and new value, and applies to the next notice. Tags are worked
    out at send time; a seat that finds nobody is written as the role in
    plain text and leaves a warning row.
  - The window reads it with `cockpit_slack_notice_read(taskId)`: the
    client's CSM, a creative seat with the client, admins and the CEO; it
    returns each notice's state, time, channel, link and reason, never its
    text or facts.
- **It has never been seen working natively in production**: the only
  `trigger='one'` run is from 2026-10-05, the Convex era. Proving it is the
  first build step (section 7, check 5) before anything depends on it.
- `onboardingCore.ts` gains `F.nextPayment = "f071ee8f-b7ce-49e8-899b-6bef649d86ba"`
  and `handover.next_payment_amount` (a number, kept only when above 0, like
  the daily budget), plus the matching key in `onboardingClient.ts`. Both
  `cockpit-csm-api` and `onboarding-sync` bundle this file, so both are
  redeployed in the same ship. Until then, the panel says "Not on record."

### 5.3 CSP
In `apps/client-success-cockpit/vercel.json`, add `https://form.typeform.com`
to `frame-src` (the SDK's iframe host; its CSS is bundled). On
`cockpit.maharamedia.com` today, the media buyer project's header (only
`connect-src`) is what reaches the browser, so frames are not restricted
there. The app's own header applies on `mahara-client-success.vercel.app`.
Add it anyway, so the embed survives either header. No `connect-src` change:
the sales embed has worked under the same `connect-src` since 2026-10-02 (3
`client_form.sent` audit rows).

Add `frame-ancestors 'self'` to both headers (the client success app's and
the media buyer project's, which is the one browsers get on
`cockpit.maharamedia.com`). A live curl showed neither host sends
`frame-ancestors` or `X-Frame-Options`, so any site could frame the window,
and the window now holds a submit that sets off Make 12. Nothing in the repo
frames a cockpit page from another origin (the cockpits' own frames are
`srcdoc` or external). `scripts/test_cockpit_connect_policy.py` now pins
`connect-src` exactly and allows only `frame-src` and `frame-ancestors
'self'` beside it. After the next ship: `curl -sI
https://cockpit.maharamedia.com/client-success/` shows `frame-ancestors`.

### 5.4 Make and Typeform
The build changes neither. Two changes are in the CEO's batch
(`docs/forms/PLAN.md` 5.2), carried out by the build session through the
APIs on his yes:

- **A2, Make `8925654` module [21]**, in this order: an Ignore error
  handler on [21], so a failure there no longer stops [22] [23] [26] [25];
  the cockpit's Brand Blueprint URL written into the card's Brand Blueprint
  link field (`1b7a4a74`); Service Advertised set from the first chosen
  service by option ID (left unset for "Other"); and Client Status forward
  only (Brand Blueprint Booked only from Onboarding Booked, Needs
  Contacting, SALES TEAM TO CONTACT, DELAY OUT OF OUR CONTROL or empty).
  Kickoff Form Link `87d7d889` keeps Make's prefilled Typeform link.
- **A3, Typeform `tG7dnxBn`:** the `postcallsummary` webhook off (Make 06,
  `9209179`, drafted a summary for every kickoff and none was ever sent), and
  the ending's sentence "Kickoff saved. The team hears in #csm-general once
  Make updates the card." Until A3 is done, an APPROVE card may still appear
  in #csm-general after a kickoff: deny it, never approve it.

The open questions (section 8) list the Typeform settings that may need
changing, each with its default.

---

## 6. Design plan

**Subject.** A CSM's call sheet for one client's onboarding call. Audience:
Mahara CSMs on a laptop (1440) or a desk monitor (1920), often screen-sharing
over Zoom. Single job: fill this client's kickoff on the call, with
everything the cockpit knows beside it, and send it once to the right card.

**Tokens** (the cockpit's own; no new palette):

| Role | Token | Dark |
|---|---|---|
| Canvas | `--background` | Deep Space `#091333` |
| Side panel | `--card` | `#0f1b45` |
| Ink / muted | `--foreground` / `--muted-foreground` | oklch 0.95 / 0.68 |
| Accent: the seal's lamp, the current trail stop, the one primary | `--mahara-teal` | `#00CFC8` |
| Missing, late | `--warning` | orange-400 |
| Done | `--success` | emerald-400 |
| Lines | `--border` | 10% white |
| Teal as text (links, small type) | `--primary-ink` (new) | `#00CFC8` (light: `#00807b`) |

Light mode uses the cockpit's light tokens as they are, plus one: teal text.
`#00CFC8` reads at about 1.9:1 on white, so links in the form window and the
quiet "Fill the kickoff" link use `text-primary-ink`, `#00807b` in light
mode (4.8:1). Fills and rings keep `#00CFC8`.

**Type.**
- Geist throughout: the title at 18px/600; values at 14px; labels at 12px/500
  muted.
- Geist Mono for the kickers (11px uppercase, 0.06em), the source tags (11px)
  and the card ID in the seal (13px).
- Arabic values in IBM Plex Sans Arabic through the stack, inside `<bdi
  dir="auto">`.
- No display face: the repo's standing rule (Geist only inside the cockpits)
  wins over the skill's suggestion.

**Layout at 1440 × 900.** No app shell. Header 56px. Body is a grid of
`minmax(0,1fr) 400px`, so the form gets about 1,040px. The two columns scroll
on their own. The side panel is `bg-card` with a hairline on its left.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ Kickoff  Smmim studio  (● SENDS TO 86eyew6mt · Onboarding Booked)          │
│                          [Just me | Sharing]  Open in Typeform ↗   [×]      │
├──────────────────────────────────────────────────────┬──────────────────────┤
│                                                      │ ● STILL MISSING · 2  │
│                                                      │ ● Call recording ›   │
│            Typeform tG7dnxBn (iframe)                │ ● Payment amount ›   │
│            about 1,040 px                            │ THE CLIENT           │
│                                                      │ Offer  …             │
│                                                      │ Area   Riyadh, Saudi │
│                                                      │ IN THE FORM'S ORDER  │
│                                                      │ Which service… [5 ○] │
│                                                      │ Consultation types   │
│                                                      │ …                    │
│                                                      │ Recording ↗  [copy]  │
│                                                      │ Payment $1,000 [copy]│
│                                                      │ ▸ What the form      │
│                                                      │   carries · 22 of 22 │
│                                                      │ ▸ From the sale      │
└──────────────────────────────────────────────────────┴──────────────────────┘
```

- **1920 × 1080.** The side panel widens to 460px. "What the form carries"
  stays folded, last: Typeform already reads those values back, and the
  rows needed on the call (Q10 to Payment) stay above the fold. The form
  column takes the rest; Typeform centres its own content.
- **Sharing.** The side panel collapses instantly (no width animation, which
  would make the iframe reflow on a shared screen). The header keeps only
  "Kickoff · <client>" and the switch. The choice is remembered per browser
  (`localStorage`, in try/catch). The "answers changed" strip is not drawn
  while Sharing.
- **After submit.** The trail replaces "Still missing" at the top of the side
  panel. The form column keeps Typeform's own ending.
- **Below 1024px**, the side panel becomes a fold above the form ("What the
  cockpit knows · 2 missing"; after a send, the trail's state, 4.1). The
  form is inline (`inlineOnMobile`). Check it at 390, 820 and 1440, per
  `docs/DESIGN.md`.

**Signature: the "Sends to" seal.** A rounded-full pill in the header: a teal
lamp dot, "Sends to", the client's name, and the card ID in Geist Mono, on
`bg-primary/10 ring-1 ring-primary/40` with `glow-teal`. A tap explains, in
a popover (no second, native tooltip): "From the client record. Make writes
everything from this form to this card." In rehearsal the seal reads
"Rehearsal · <client> <id>" on a warning ring with no glow, and its popover
says nothing is saved and nothing reaches the card.

It is the one bold thing in the window. The real danger is a response
landing on the wrong card, and the client ID is the CEO's own anchor ("it has
the client ID"), so the window makes it the most visible fact. After submit,
the glow moves from the seal to the trail's current stop. The stops are a
real sequence, so they sit on a line with dots, not numbers. Everything else
is quiet: rows, not cards inside cards; one teal button at a time.

**Critique of the plan.** The first draft was the generic "form left, list of
fields right" layout. Two changes make it this brief's:
- the seal makes the join key the headline;
- the side panel follows the kickoff's own order with a source on every row
  (a call sheet, not a profile dump).

A progress bar and stat tiles were considered and dropped: Typeform already
shows progress, and counts add nothing on a call.

**Motion.**
- A trail dot fades and scales in (180ms ease-out) when its stop is confirmed.
- The Check now icon spins only while a check runs.
- Nothing loops or pulses, because the window may be on Zoom.
- `prefers-reduced-motion`: no motion at all.

**Copy (EN; the CSM cockpit is English).**
- Buttons: "Fill the kickoff" (the Onboarding panel and the header), "Open
  the kickoff window" (once sent), "Open in Typeform", "Just me" /
  "Sharing", "Check now", "Copy", "Read what was filled", "Open a second
  kickoff anyway", "Reload the form", "Book the Brand Blueprint call" (the
  trail and the Onboarding panel, the same words as Typeform's ending),
  "Open the Brand Blueprint" (the cockpit's own Blueprint), "Open in Slack",
  "Open the ClickUp card", "Open Typeform's results", "Open the recording",
  "Check again", "Try again", "Close this window", "Copy the kickoff
  window's link".
- Kickers: "Still missing", "The client", "In the form's order", "From the
  sale", "Already sent". The "Suggest" tag marks the rows the cockpit
  suggests from the client's words or the deck.
- Toast (cockpit tab): "Kickoff sent for <client>. Make is updating the card.
  Book the Brand Blueprint call below."
- Rehearsal banner (admin and CEO only, `?rehearse=1`): "Rehearsal in
  Typeform's sandbox: nothing is saved and Make does not run. Walk the form;
  do not press Submit."
- No new Arabic. The kickoff's Arabic welcome screen is Typeform's own and
  stays as it is.

**Accessibility.**
- The side panel is `<aside aria-label="What the cockpit knows">`.
- The trail is `role="status" aria-live="polite"`.
- Focus lands on the window title when it opens.
- The iframe has a `title`.
- Keyboard focus is visible on every control.
- Copy buttons have names: "Copy the call recording link".

---

## 7. Tests, and verifying on production without a submit

### Tests to add (`bun test` in the app unless noted)
- `scripts/form-prefill.test.ts`, on synthetic fixtures only (no client data):
  - all 23 keys are built from an onboarding entry;
  - `legal_name` falls back to the card name;
  - with no onboarding response, only the ID and name go;
  - `"0"` is kept and multi-choice joins with `", "`;
  - Arabic, line breaks and a leading `+` survive the `URLSearchParams`
    round trip;
  - the ID is always the row's, and a card link with another ID or another
    form is ignored;
  - the 4,000-character cut prefers the card link, and a cut value with no
    such link is said;
  - the cross-check ignores join and blank-versus-zero differences;
  - the length note appears above 4,000 characters.
- `scripts/form-status.test.ts`:
  - each trail stop, using the server's `now` and `sent_at`, labelled in the
    tense of its state, with no "Waiting for…" lines;
  - a send the cockpit could not note says so on its first stop;
  - the two late sentences at 5 minutes (Make's is the config's);
  - the folded summary for each state;
  - the Onboarding panel's line with its day, the next day too;
  - a status that was already Brand Blueprint Booked counts only with a newer
    `card_updated_at`;
  - `already` from each of its three sources.
- `scripts/form-rail.test.ts`:
  - every fact's source order and its "Not on record." sentence;
  - Still missing as short pointers to their rows, the onboarding link in
    its own row;
  - the five services on Q10 only; the country by name;
  - empty rows in a row folded into one line, never a row Still missing
    points to;
  - dollars shown, digits copied;
  - "What the form carries" last, its shared source in the title;
  - the service follows slide 4, then prep, then the form;
  - the Service Advertised field is never read;
  - the payment is never computed.
- `scripts/form-panel.test.tsx`, with `@typeform/embed` mocked to capture the
  options:
  - the hidden object, `redirectTarget: "_blank"`, `onEndingButtonClick` and
    the sandbox flag only in rehearsal;
  - `onSubmit` calls `cockpit_csm_form_sent` once with the right arguments,
    and `"__sandbox"` is never sent;
  - a failed note says what still happened, without a doubled full stop,
    and a retry keeps the submit's clock (Make's update just after the
    submit still completes the card stop, and nothing says Make is late);
  - the second-kickoff click is required, and the hold reads as a stop;
  - a kit re-read does not remount the widget;
  - Sharing hides the side panel;
  - the header's "Open in Typeform" is gone after a send;
  - the rehearsal seal sends to no one;
  - a Still missing pointer scrolls to its row;
  - the ending button opens the booking dialog, under the ending's own
    name;
  - the plain states: the access block offers Close this window, and no
    switch shows.
- `scripts/onboarding.test.ts`: `cardRow` maps Next Payment Amount.
- `supabase/functions/onboarding-sync/sync.test.ts` and
  `cockpit-csm-api/onboarding.test.ts`: unchanged and passing.
- SQL (`supabase/migrations/tests/`), for `cockpit_csm_form_sent`:
  - it refuses another seat's client, an unknown form key, `__sandbox` and a
    carried ID that is not the card's;
  - a repeat response ID writes neither a row nor an audit row;
  - one send writes exactly one audit row;
  - `second` is set by the server;
  - `anon` has no grant, and `authenticated` has EXECUTE on the two functions
    and nothing on the table.
- `vercel.json`: `frame-src` includes `https://form.typeform.com`, and
  `frame-ancestors 'self'` is set (`scripts/test_cockpit_connect_policy.py`
  checks both cockpit headers).
- `scripts/csm-page.test.tsx`: the header and the Onboarding panel both say
  Fill the kickoff and open the same named window as a popup.
- The existing suites stay green: `bun run test`, `bun run test:csm`,
  `typecheck`, `lint`, `scripts/check-shared.sh`.
- A harness, `scripts/form-preview.html` (like `check-in-preview`): the window
  with fixtures for all the states in 2.5 and 4.1 to 4.4, and a fake widget.
  Shots are JPEG at 1440 × 900 and 1920 × 1080, dark and light.

### On production, with nothing submitted
1. **Prefill, field by field, read-only.** A script,
   `scripts/kickoff-prefill-check.ts`, reads each onboarding client's record
   (`sq.py`), its onboarding response (Typeform API GET), its card link, and
   the hidden object the panel builds.
   - First it reads the kickoff's definition and checks that it declares
     all 23 hidden keys the build sends (Typeform drops an undeclared key
     without a word); exit 1 if not.
   - It prints counts and key names only: "86ey3303x: 23 of 23 match the
     onboarding response; 2 differ from the card link as written
     (consultation_types, last_revenue), 0 after normalising". A
     `legal_name` taken from the card name is the designed fallback (Make
     10's plain link carries the ID only): it is said, not counted.
   - For a client whose kickoff is on record, it compares the build with
     the hidden values Typeform stored on that submission (the end-to-end
     proof): "exact", or the keys that match only after normalising.
   - Expected: every value matches, except the documented `", "` join and
     `"0"`.
2. **In the window, in rehearsal.** Use `?rehearse=1` (Typeform's sandbox: no
   saves, no tracking, no Make) for a client with onboarding answers and no
   kickoff (86ey3303x).
   - In DevTools, decode the iframe's `src` hash and compare it with step 1's
     object.
   - Start, and check that group 1 reads back their name, phone, email and
     address.
   - Do not press Submit.
3. **The longest link.** Do the same for 86eyew6mt (4,499 characters as
   built; Make's card link is 4,783), above the 3,168 proven so far.
4. **The guard.** Open the window for a client with a kickoff (z8xmdvh0k9),
   see the warning, and do not open the second kickoff.
4a. **The deck's last slide, scaled** (score round 1 of the Blueprint deck,
   2026-10-23: the harness stand-in cannot test typing inside the deck's
   scaled canvas). Present the onboarding deck at 1366 x 768 (a laptop
   share), open its kickoff stop with `?rehearse=1` (Typeform's sandbox), and
   check that a field takes typing and focus where it is clicked, a long
   choice list scrolls inside the frame, and the deck's keys do not move the
   slide while a field has focus. Do not press Submit.
5. **The one-card refresh.** Press Refresh on one client's Onboarding panel,
   then check with `sq.py` that a new `cockpit_client_onboarding_runs` row has
   `trigger='one'` and `ok=true`, and that it has an audit row. This writes
   cockpit tables only.
6. **Autosave.** In rehearsal, answer group 1 for client A, close, then open
   client B. If A's answers come back, apply open question 3.
7. **Headers.** `curl -sI` both hosts: `frame-ancestors 'self'` is there.
   The embed loads on `cockpit.maharamedia.com/client-success/`.
8. **End to end.** The CSM's next real onboarding call is the end-to-end test.
   Check:
   - one `csm_form.sent` audit row;
   - the trail reaches the Blueprint stop within 2 minutes;
   - Make 12 shows one run (read in Make), and Make 06 none once A3 is done;
   - one Technical and one Creative task exist;
   - one `kickoff` notice in `cockpit_slack_notices` reaches `posted` in
     #csm-general (variant `complete`), and the trail's Slack stop says so.

### Not in scope
- Changes to Make or to Typeform forms.
- Building the Blueprint and check-in panels.
- The creative director cockpit.
- Preselecting answers.
- Fixing Make 12's Service Advertised switch.
- The Convex leftovers.
- The 14 "SALES TEAM TO CONTACT" cards, which are not on the roster.

### How we know it works
- Prefill check: 23 of 23 per client.
- Rehearsal: the read-backs show the client's details.
- The refresh run row is ok.
- The first real kickoff leaves one send row, one audit row, one Make 12 run
  and a complete trail.

---

## 8. Open CEO questions (each has a default; the build goes ahead on it)

1. **Own window or a large sheet?** Default: own window, shareable on its
   own. `FormPanel` can also sit in a sheet.
2. **A second kickoff: warn or block?** Default: warn, and require a second
   click. Fixes go in Typeform's results.
3. **Typeform autosave could carry one client's half-filled answers into the
   next client's form.** Default: test it in rehearsal (check 6). If it
   carries over, switch off "Autosave progress" on `tG7dnxBn`. That is one
   Typeform setting, not Make.
4. **The ending's "Book the Brand Blueprint call".** Default: the cockpit's
   own booking dialog for this client, on the same calendar.
5. **Payment Amount.** Default: the card's Next Payment Amount, with Billing
   lines as a hint. The cockpit never computes one.
6. **Call recording link.** Default: today's Fathom onboarding call from the
   call store; otherwise the CSM pastes it.
7. **Make 12 never fills Service Advertised.** Default: leave Make alone. The
   cockpit reads the kickoff answer. Fix the switch in Make later if wanted.
8. **Blueprint partial submit.** Default: decide in the Blueprint build. It
   needs the "blueprint" Typeform webhook to include partial responses.
9. **May builders press Submit in Typeform's sandbox?** Default: no. Rehearsal
   is for walking the form only.
10. **Who can open it?** Default: CSM seats, admins and the CEO (the client
    page's gate). Rehearsal is admins and the CEO only.
