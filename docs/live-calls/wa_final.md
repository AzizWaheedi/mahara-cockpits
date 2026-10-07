# Project 4 spec: WhatsApp groups from the setter's phone (final, 2026-10-03)

The CEO wants a group "with the closer that gets created automatically with the lead, so we can increase the show rate". On 2026-10-03 he added: "for whatsapp groups personal phone should be fine of the setter". This spec replaces routes A, B and C. The names the consistency check gave to `threads` now become `groups`. VERIFIED means a research or review pass opened the page on 2026-10-02 or 2026-10-03. UNVERIFIED means a search snippet, a vendor claim or an inference.

## What changed after review

**Break-it review (R1):**
- A1: every group gets a code, and the rep confirms it when tapping Posted. The code stays out of lead messages, so they read naturally. A2: a last-4-digits check and a phone-mismatch warning. A3: a "cleared my copy" tap, and encrypted backup as a house rule.
- B1: the lost-phone and leaver steps now allow for the fact that nobody can remove the group creator. Making a Mahara number the creator is offered as decision 1, not imposed, because the CEO chose the personal phone. B2: steps move off emails that no longer have a seat. B3: Phase 1 waits on the CEO's decision about the closer's number. B4: the group is made during the call. B5: a `making` state. B6: call steps pass to the setter after 2 minutes.
- C1: `group_demos` is split from `groups`. C2: the arm is shown during the intro call. C3: a promised group that was never made puts a confirm call in the dialer. C4: confirm drafts are held only after the lead replies. C5: the states are rebuilt.
- D1: day 1 uses the meeting's own link, and `room.wrap` comes later. D2: the "Moved" message is reworded. D3: a [They confirmed] button. D4: the setter owns the welcome, evening and hour steps.
- E1 to E5: one hours rule, `leadClock()`, times from the mirror only, closes that land on a weekend move, and `confirmFrom`.
- F1: one mark prompt for both arms, with the B2B rule as the only rate. F2: one outcome per lead. F3: `group_arms`. F4: a 25-point stop and a projected read date.
- G1: the `allow` list forces the group arm. G2: the closer has been Licensed on Zoom since 2026-10-03, so the licence step is gone. G3: `greetName()`. G4: `consent_call_id`.

**Second review (R2):**
- G1: the consent line warns about the safety screen, the welcome asks "Reply OK", and silence triggers a call. G3: the build waits until demos are booked again, and a 20% comparison share serves as a harm check. G5: a path for consent in writing. G6: one owner per step. G7: the hour step gives way to HighLevel's own reminder.
- G8: WhatsApp Desktop, "Open on phone" and browser alerts. G10: the CEO gets a plain yes-or-no question on automation. G12: tested again in Phase 0, and one private invite is allowed. G13: 6 states and no events table; `group.prepare` stays because it guards the closer's number. G14: no observer phone. G15: no short link on day 1. G16: the closer covers the official line. G17: one handover button.
- Improvements 1 to 8 are applied, except that the hour step stays with the setter (R1 D4).

**Not applied:** the research's observer phone. The work-number option replaces it.

## Outcome and success numbers

**Goal.** Raise the demo show rate (B2B rule) from 65% (11 of 17 in September) toward 75%. Each demo lead who agrees gets a small group, which closes 2 days after the demo.

**Volume.** Demos fell from 275 in June to 17 in September. None are booked ahead, and new roas-tagged leads hit 0 in the week of 28 September. The follow-up agent goes first. This build starts when demos are booked again, or when the agent ships.

**First 20 groups:**
- 18 made within 30 minutes.
- 14 with a reply from the lead.
- Steps and closes on time.
- No warnings or bans.
- At most 1 lead leaving early.

### Which mode

| | Assisted (day 1) | Automatic (if earned) |
|---|---|---|
| Who makes it | The setter, in WhatsApp or WhatsApp Desktop | A linked-device service |
| Number | Setter's personal WhatsApp, or a work number (decision 1) | Work number only |
| Risk | Lead reports; business use of a consumer account | Linking "may result in a temporary or permanent account ban" |
| Cost | $0; 9 to 12 rep minutes a group (estimate) | About $29 to $35 plus KD 5 a month |

Platform facts, all VERIFIED:
- Unofficial linking breaks WhatsApp's terms and risks a ban (https://faq.whatsapp.com/1217634902127718, https://faq.whatsapp.com/378279804439436).
- No groups may be made "in unauthorized or automated ways" (https://faq.whatsapp.com/361005896189245).
- No "non-personal use" of a consumer account (https://www.whatsapp.com/legal/terms-of-service).
- A ban removes access to chats and backups (https://faq.whatsapp.com/465883178708358).

**Recommendation: assisted.** Automatic mode would save about 2.5 hours a month, and it risks a ban. Switch only if all of these hold after 4 weeks:
- Over 20% of steps are posted late.
- No rep's number has had a warning.
- A work number exists, and the risk is accepted in writing.
- A 20-group pilot passes.

## Who does what

- **Setter:** offers the group (group arm only), makes it, posts the welcome, evening and hour messages, and closes it.
- **Closer:** admin from the first minute. Posts the prep note, the join link and the holding message, owns replies and marks the demo.
- **Lead:** says yes or no, replies, and can leave any time.
- **Manager or CEO:** registers the reps, holds the switches, and reads open and overdue groups each morning.
- **System:** stores each lead's arm, links groups to demos, plans steps on the lead's clock, prompts the reps and flags closes. It never posts in a group.

## The flow, step by step

### Assisted happy path

1. **Intro call.** Before booking, the dialer shows the lead's arm. In the group arm, the setter reads the consent line. [They said yes] or [They said no] stores the time, the seat, the script version and the Maqsam attempt (`consent_call_id`).
2. **Make it during the call**, or within 30 minutes. The setter taps [I'm making it], then:
   - creates the group with the card's name, and adds the closer and the lead by typing their numbers, without saving the lead (https://faq.whatsapp.com/841426356990637, VERIFIED);
   - makes the closer admin, and sets editing info and adding members to admins only (https://faq.whatsapp.com/526742385997912, VERIFIED);
   - tells the lead to tap Stay on WhatsApp's safety screen (https://faq.whatsapp.com/424124173736394, VERIFIED);
   - posts the welcome, taps [Group made] and types the last 4 digits of the number added.

   If the lead's privacy setting blocks the add, WhatsApp offers a private invite valid for 3 days (https://faq.whatsapp.com/1131457590844955, VERIFIED). The setter sends it and taps [Invite sent].
3. **Link to the demo.** The Yes creates a `groups` row keyed by contact. Within about 5 minutes the mirror copies the demo. `group.tick` then links it, writes the `group_demos` row and plans the steps.
4. **Replied.** A group added by someone who is not a contact stays silent until the person taps Stay (https://about.fb.com/news/2025/08/new-whatsapp-tools-tips-beat-messaging-scams, VERIFIED). So the welcome ends with "Reply OK", and [They replied] records it. If there is no reply by the evening step, the dialer queues a 30-second Maqsam call.
5. **Steps** show on the owner's Today strip. Within 2 hours of the call they show to both reps.

| Step | Owner | When |
|---|---|---|
| welcome | setter | at [Group made] |
| prep (optional) | closer | before the evening step; one line from `cockpit_sales_call_notes`; a short voice note is allowed |
| evening | setter | at `confirmFrom` (`dialer.ts:393`); only for demos booked over 24 hours ahead |
| hour | setter | the later of 60 minutes before the start and 09:00; dropped if within 20 minutes of join_now, or if HighLevel sends its own reminder |
| join_now, holding | closer | 5 minutes before the start; 5 minutes after the start if the lead is absent; passes to the setter after 2 minutes |
| moved, close_line | setter | on a reschedule; on the close date |

   On day 1 the join link is the meeting's own, read from `GET /calendars/events/appointments/{id}` (the field name is UNVERIFIED). Later it becomes the `room.wrap` short link. That link is made at the hour step and stays live until the demo ends, under the foundation's rule for booked rooms.
6. **They confirmed.** This button writes `cockpit_sales_confirmations` with `result=confirmed`. That clears the dialer item (`dialer.ts:438`) and the agent's confirm draft (`followups.py:547`). It never writes the HighLevel status.
7. **Mark.** 15 minutes after the start, every demo in both arms gets the same "Mark this demo" prompt.
8. **Close.** At 09:00 lead time on the close date, the setter:
   - posts the closing line;
   - removes the lead, then the closer;
   - deletes the group for everyone and taps [Closed].

   The closer taps [Cleared from my phone]. The lead keeps a read-only copy. If the only admin just leaves, WhatsApp makes a random member admin (https://faq.whatsapp.com/498814665492149, VERIFIED).

### Close rules

A group closes at whichever comes first:
- 2 days after the demo;
- the deal is won or lost (the stage role in `dialer.ts`, a `cockpit_sales_deals` row or the `client` tag);
- the demo is cancelled with no new time within 2 days;
- the lead says stop or leaves.

A close date on the owner's day off moves to 09:00 Kuwait time on their next working day. A reschedule or rebook moves the close date, attaches the new demo to the open group and plans the "moved" step.

### Consent without an intro call

About 3 in 10 demos had no connected call before booking. If the lead's 24-hour window is open, the card offers the consent question as text on the official line (`convo.send`). A yes is recorded with [Said yes in writing] (`lead_wrote`). Otherwise the demo is marked `not_asked`.

### Automatic mode

Automatic mode uses the same record and screens. A VPS worker does the taps on a work number, through Whapi.Cloud (https://whapi.cloud/how-to-automate-whatsapp-groups-api, VERIFIED) or the free Evolution API (https://github.com/EvolutionAPI/evolution-api, VERIFIED). It makes at most 5 groups a day. Linked devices log out after 14 days without the phone (https://faq.whatsapp.com/378279804439436, VERIFIED). When that happens, the health line turns red and the reps get the manual prompts again.

### Never joins, leaves, setter away

- **No reply 3 hours before the demo:** the owner is told. If the lead wrote to the official line in the last 24 hours, `group.invite` sends the invite link there.
- **Promised, but not made:** "Confirm the demo" goes to the dialer at once.
- **Leaves or says stop:** the lead is never contacted again, and the group closes as `lead_left`.
- **Setter away:** [Hand my groups to the closer today]. Steps not posted within 30 minutes (2 for call steps) move to the other rep. Steps also move off any email without a seat.

### Ties to live handover (P2) and the follow-up agent (P3)

- **Live call:** [Offer a call now] calls `live.ask` with `entry='group'` and shows the link for the rep to paste. P2 moves the booked demo and never books a second one.
- **Follow-up agent:** the `confirm` draft is held only after the lead has replied in the group. At close, the agent's `no_show`, `after_call` or `cancelled` segment takes over on the official line. The VPS sign-in has been lapsed since 2026-09-27. Until it is back, the closer answers there by hand.

## States and transitions

| State | Entered when | Left when | Timeout |
|---|---|---|---|
| to_make | [They said yes] | [I'm making it] | 30 min: the other rep sees it; 30 min before the demo: skipped as `not_made` |
| making | the claim, with `making_by` | [Group made] | 15 min: back to to_make |
| open | [Group made]; flags `invited_at`, `lead_in_at`, `replied_at`, `confirmed_at` | a close rule | none |
| close_due | a close rule is met | [Closed] | 24 h: the manager's Overdue list |
| closed, skipped | final; `close_reason` or `skip_reason` (no, not_made, no_whatsapp, too_soon) | never | none |

Comparison demos and `not_asked` demos live only in `group_demos`. Every write carries `version` and adds an audit row.

## Edge cases and failure handling

- **Demo within 60 minutes of the Yes:** no group (`too_soon`). The demo still counts in its arm.
- **Lead's clock:** `leadClock()` reads the country field, then the phone prefix, then falls back to Kuwait. UAE and Oman are UTC+4 (`followups.py:105`), and other countries show their GMT offset. When the fallback was used, the welcome asks "Is that right for where you are?"
- **Hours:** messages go 09:00 to 21:00 lead time, any day (`followups.quiet`). Call steps may go at any hour within 2 hours of the call. "Any day" because the UAE public-sector weekend is Saturday and Sunday (https://www.pinsentmasons.com/out-law/news/uae-move-weekend-saturday-and-sunday, VERIFIED). A Ramadan profile comes later (2027 dates UNVERIFIED).
- **Times without a zone:** HighLevel's contact appointment list carries no time zone, so step times come from the mirror only.
- **Host change:** add the new closer as admin, then remove the old one.
- **Phone lost:** WhatsApp has no remote logout. The setter blocks the SIM and re-registers the number (https://faq.whatsapp.com/1007324800132703, VERIFIED). "Group creators can no longer be removed from the group they started" (https://blog.whatsapp.com/10000640/?l=en, VERIFIED; a 2018 post, retested in Phase 0). So re-registering is the only way to cut the lost phone off. The closer takes over the open groups.
- **Warning or ban:** groups move to the closer the same day, and no new groups are made until the CEO decides.
- **Mirror stale for over 15 minutes:** "The calendar copy is {n} minutes old: Yes groups are not linking to demos."
- **Zoom:** the card warns if `room_hosts.zoom_status` returns to Basic, which cuts meetings at 40 minutes (https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0067966, VERIFIED).

## Data model and settings

The migration is `20261003d_sales_groups.sql` (the P4 slot, renamed), copied from `20261002e_sales_client_forms.sql`. All tables carry the `cockpit_sales_` prefix.

- **`group_arms`:** `contact_id` pk, `arm`, `share`, `assigned_at`. Written once and never recomputed. The value is the first 4 hex characters of sha256('groups:'||contact_id), divided by 65,536. A value below `comparison_share` means comparison.
- **`group_demos`:** one row per demo seen. Columns: `appointment_id` (unique), `contact_id`, `arm`, `eligible`, `consent` (yes, no, not_asked), `group_id`, `outcome_key`, `is_test`. `outcome_key` is the lead's first eligible demo, followed through any moves within 14 days.
- **`groups`:** one row per WhatsApp group.
  - Identity and status: `request_id` and `code` (both unique), `contact_id`, `appointment_id`, `state`, `version`, `mode` (assisted, automatic, official).
  - People and details: the consent fields, the four role emails plus `making_by`, `tz`, `lead_last4`, `invite_link`, `service_group_id`.
  - Times and outcome: the flag and close times, and the reasons.
  - Index `groups_one_open_per_lead`: unique on `contact_id` while the group is not closed or skipped.
- **`group_steps`:** `group_id`, `appointment_id`, `step`, `due_at`, `state` (planned, due, posted, skipped), `owner_email`, `posted_by`, `request_id` (unique). Index `group_steps_once` on (`group_id`, `step`, `appointment_id`).
- **`group_reps`:** `email` pk, `wa_number`, `number_kind` (personal, work), `agreed_at`, `ceo_ok_at` (required before a closer uses a personal number), `privacy_checked_at`, `days_off`, `link_state`.
- **No events table:** `cockpit_audit_log` records every write. It never holds message text or phone numbers.

**Security, in the same migration:**
- RLS is on for all five tables.
- Seats read arms, demos, groups and steps through `cockpit_sales_seat()`, granted by column so `invite_link` is left out.
- On `group_reps`, each rep reads their own row and managers read all rows. There is no grant on `wa_number`.
- Revoke all from public, anon and authenticated; grant all to service_role; end with `notify pgrst`.
- Writes go only through sales-api.

**Setting `groups`.** It holds no secrets and replaces `threads`. `enabled` is the kill switch, and hours come from `followups.quiet`. The `allow` list forces the group arm and marks those rows `is_test`.
```json
{"enabled":false,"mode":"assisted","test_only":true,"allow":["VjPfR4Cc1Y0OFvaqeor5"],
 "calendars":["jQqXS1YuFnmGZKLkrE62","NDBNz6Og4yfpdpWmHrue"],"comparison_share":0.2,"salt":"groups",
 "close_after_days":2,"steps":{"prep":true,"evening":true,"hour":true},"handover_min":{"call":2,"other":30},
 "max_new_per_day":5,"official_line":null,"automatic":{"send":false,"reps":[]}}
```

## Integrations and calls

- **Tick:** `group.tick` joins `DESK_ACTIONS` and `CRON_ACTIONS` (`index.ts:5076`, `5085`). The pg_cron job `mahara-sales-groups */2` posts to `sales-live/cron`. That route allows only `group.tick` through and forwards it with the project key and `x-cron-secret`. The tick writes the status row (sales-api, groups), and the watchdog alerts after 10 minutes.
- **Code:** `sales-api/groupplan.ts` holds the pure logic and its tests; `sales-api/groups.ts` holds the input and output. Both are spread into `ACTIONS` (`index.ts:5011`). `leadClock()` and `greetName()` go in a shared module. Tell the parallel session, because today's template code keeps only a name's first word (`index.ts:1183`).
- **Seat actions, all audited:**
  - `group.arm`, `group.consent`;
  - `group.prepare`, the only way the maker gets the closer's number;
  - `group.mark` {making, made, invite_sent, lead_in, replied, confirmed, no_whatsapp, left, stop, cleared};
  - `group.step`, `group.invite`, `group.close`, `group.handover`;
  - `group.reassign` (manager only).
- **HighLevel:** `GET /contacts/{id}`, `GET /calendars/events/appointments/{id}`, and `convo.send`.
- **Automatic, later:** `hermes/sales-desk/desk/groups.py` under flock, with a doctor, tests and a runbook row. Webhooks reach `sales-live` on a secret path, because whether Whapi signs its webhooks is UNVERIFIED.

## Screens and copy

**Dialer:** "Group test: offer the WhatsApp group" or "Comparison: do not offer a group", then [They said yes] [They said no].

**Lead page card "WhatsApp group"**, under Conversation (`LeadPage.tsx:334`):
- **To make:** "Make it now, while {first name} is on the line."
  - Copy rows in tap order: group name, closer's number, lead's number (last 4 digits in bold), welcome.
  - A warning if Maqsam reached a different number.
  - A 2-item checklist.
  - [I'm making it] [Group made] and [Open on phone] (a QR code).
- **Open:** "Group K7Q made {ago}. Has {first name} replied?" [They replied] [Invite sent] [Not on WhatsApp] [They confirmed].
- **Due:** "{step} is due. Paste it into group K7Q." [Copy] [Open WhatsApp] [Posted] [Skip].
- **Close:** "Close group K7Q today: post the closing line, remove {first name} then {closer}, delete for everyone." [Closed]. The closer sees [Cleared from my phone].
- **Comparison:** "This lead is in the comparison group, so no WhatsApp group. HighLevel's usual reminders go out."

**Today strip:** "Groups: {n} to make, {n} steps due, {n} to close", or "No group work right now". Due steps also raise browser alerts (`DialerPage.tsx:631`).

**Team card:** the switches, the reps and overdue groups. When the job is stale: "The group job has not run since {time}. No prompts are going out."

**Consent line** (also used for the written ask): "Would it help if I made a small WhatsApp group with you, me and {closer}, who hosts your demo? Only for this call: the link, questions and changes. We close it two days after. It comes from my number ending in {last 2}; WhatsApp shows a safety screen, so tap Stay. Is that OK?"

**Group setup:**
- **Name:** "{code} · {company or first name} + Mahara Media", within WhatsApp's 100 characters (https://faq.whatsapp.com/3242937609289432, VERIFIED). It has no date, so a reschedule needs no rename.
- **Photo:** the Mahara logo.
- **Description:** "For your Mahara Media demo, hosted by {closer}. We reply 09:00 to 21:00 your time and close this group two days after the demo. Leave any time."

**Lead messages.** These are in English. The Arabic is written under `aziz-kuwaiti-voice` and reviewed by the CEO. `greetName()` keeps "عبد" and "أبو" together with the next word.
- **Welcome:** "Hi {first name}, as promised, here's our group for your demo on {day} at {time} ({country} time). {Closer} will host. Reply OK so I know it reached you."
- **Prep:** "{Closer} here. You mentioned {goal}; I'll show how we'd do that for {company}."
- **Evening:** "Quick check for tomorrow at {time} ({country} time). Still good? If not, reply with a time and we'll move it."
- **Hour:** "See you in an hour. {Closer} will post the link here shortly before."
- **Join now:** "I'm in the room now: {link}"
- **Holding:** "I'm holding the call for you: {link} If now isn't good, reply with a better time."
- **Moved:** "Done: your demo is now {day} at {time} ({country} time)."
- **Closing:** "Thanks {first name}. We're closing this group now, as planned. For anything else, message Mahara Media here: {official line}."
- **Invite (official line):** "Here's the link to your demo group with {closer}: {invite link}"

## How it counts in the numbers

- **No side effects:** a group books, marks and moves nothing in HighLevel.
- **One rate, the B2B rule:** a demo counts as shown when it is marked showed, or confirmed once its time has passed. The read waits until no past test demo in either arm is still "confirmed" or "new". At that point the B2B rule equals the marked outcome. Each arm shows "{n} demos still to mark".
- **Units:** intention to treat, with one outcome per lead. A lead who said No, or whose group was never made, stays in the group arm. A group made for a comparison lead counts as a protocol break.
- **Second sources:** HighLevel marks, and Zoom's participant report.
- **Size:** with a 50/50 split, 80% power and a two-sided 5% test, the smallest lift the test can see is:
  - about 34 points at 30 demos per arm;
  - about 24 points at 60;
  - about 17 points at 120.

  At about 14 eligible demos a month, 120 per arm takes about 17 months. So the 20% comparison share is a harm check, not a test. The tile projects the read date.
- **Early signals:** reply rate, demos moved before their time against no-shows, and rep minutes per group.
- **Stop at once if any of these happens:**
  - a rep is warned or banned;
  - more than 1 lead in 20 leaves (counted from 20 groups);
  - at 30 demos per arm, the group arm is 25 or more points lower (about 2 standard errors).
- **Tile note:** "Groups run by hand. Made, replied and posted are the reps' taps; the cockpit cannot read WhatsApp."

## Security and privacy

- **Consent:** no yes, no group. The yes, with its call recording or written reply, is the processing record. WhatsApp asks users to get permission before adding someone to a group (https://faq.whatsapp.com/361005896189245, VERIFIED).
- **Saudi Arabia** (about 65% of leads): the PDPL requires consent, limits on purpose and an easy opt-out. A breach that could cause harm must be reported to SDAIA within 72 hours (https://www.lw.com/en/insights/2023/12/Saudi-Arabias-data-protection-law-enters-into-force, VERIFIED; SDAIA's own text UNVERIFIED). A lost, unlocked phone counts as a possible breach.
- **UAE:** Resolution 56/2024 bars telemarketing from personal numbers for UAE-licensed firms (https://www.clydeco.com/en/insights/2024/07/uae-tightens-telemarketing-regulations-what-you-ne, VERIFIED). Whether Mahara holds a UAE licence is UNVERIFIED.
- **Exposure:** the lead sees both reps' numbers, and WhatsApp cannot hide them (https://faq.whatsapp.com/3307102709559968, VERIFIED).
- **Work number:** a WhatsApp Business app number can be linked to the manager's WhatsApp Web (https://faq.whatsapp.com/647349420360876, VERIFIED). Two accounts on one phone are supported (https://faq.whatsapp.com/492167569769444, VERIFIED). Whether the setter's phone can take a second eSIM is UNVERIFIED.

## House rules for reps (one page)

Each rep signs these before their first group.

**Making it**
1. One group per booked demo, only when the dialer says "Group test" and the lead gave a clear yes. Nothing promotional.
2. Make it while the lead is on the line, and tell them to tap Stay.
3. Never save a lead to your contacts; type the number. One private invite message is allowed when WhatsApp offers it.
4. Use the card's name and the Mahara logo. Make the closer admin. Only admins edit group info and add members. If you make an invite link, turn on "Approve new members".
5. At most 5 new groups a day. Too many adds can force a 24-hour wait (https://faq.whatsapp.com/841426356990637, VERIFIED).

**While it is open**
6. Message 09:00 to 21:00 in the lead's time, any day. Messages about the call itself may go at any hour within 2 hours of it.
7. At most 4 staff messages before the join link. Check the group code before you tap Posted.
8. No one-to-one chats with leads. Decline WhatsApp calls and call back on Maqsam.
9. A lead who leaves or says stop is never contacted again.
10. No broadcast lists, copy-paste blasts, modified WhatsApp apps, or screenshots shared outside the company.

**Closing**
11. On the close date: post the closing line, remove the lead and then the others, delete for everyone and tap Closed. Never just walk out.
12. Closer: delete your copy and tap "Cleared from my phone". Setter: delete any invite chat.

**Your phone**
13. Set last seen to Nobody, and About and status to My contacts. Your photo is either professional or set to My contacts. Use a screen lock, a two-step PIN and encrypted backup (the help pages for these are UNVERIFIED).
14. Mute groups after hours. Nobody expects night replies.
15. If a lead is rude: exit, block, report and tell the manager. The company backs you.

**Incidents and leaving**
16. Phone lost: tell the manager within 1 hour, block the SIM and re-register your number.
17. Any warning or ban: tell the manager that day. Your groups move to the closer, and nobody carries on with an account at risk.
18. Changing your number: tell the manager first and hand over your groups. WhatsApp announces the change in every group (https://faq.whatsapp.com/498754122134583, VERIFIED).
19. Leaving Mahara: post a handover line, then exit every group in front of the manager, because nobody else can remove the creator. Do not contact leads afterwards.

## Tests and acceptance criteria

- **Unit tests (`groupplan.test.ts`):**
  - demos booked 3 days, 4 hours and 50 minutes ahead;
  - a booking at 23:00 for 09:30;
  - moves and rebooks;
  - the hour step;
  - closes that land on a weekend;
  - `leadClock()`, with a fixture that has no time zone;
  - `greetName()`;
  - arms split about 80/20 over 10,000 ids;
  - names under 100 characters, and no `{` left in any copy;
  - every close rule;
  - owners whose seat was removed.
- **SQL:** a second open group for the same lead is refused, and a rebooked demo attaches to the open group. Seats cannot read `invite_link` or `wa_number`.
- **Desk (`tests/fakes.py`):** no `confirm` draft once `replied_at` is set, and a confirmation row clears the dialer item.
- **Harness:** `group=to_make|making|open|due|close|comparison` on the lead page, and `group=offer|comparison` on the dialer.
- **Phase 0 live test** on three staff phones, one acting as the lead, recorded on `VjPfR4Cc1Y0OFvaqeor5`. It must show:
  - an add by typed number, without saving the contact;
  - the safety screen and the muted group;
  - the closer failing to remove the creator;
  - an add blocked by privacy;
  - every step, a leave and a full close;
  - the minutes each group takes, timed.

  No real lead is ever part of a test.

## Rollout and build days

Start when demos are booked again, or in the week the follow-up agent ships.

**Core, 4 days:**
1. List HighLevel's demo reminders and check who hosts its demo Zoom meetings. Migration, planner and tests.
2. `groups.ts`, the tick, the cron route, consent in the dialer, [They confirmed], and the hold on the agent's confirm drafts.
3. Lead card, Today strip, alerts and Team card.
4. Phase 0 and fixes. Ship with `scripts/ship.sh sales` from the latest main. Deploy `sales-api` from a fresh worktree with `--verify-jwt`. Record the session in mahara-context.

**Later, 2 days:** the Numbers tile with intervals, and the `room.wrap` short link once the foundation ships. Automatic mode adds 4 days, and only after the switch rule is met.

**Phases:**
- **Phase 0:** staff phones only.
- **Phase 1:** real demos, with a 20% comparison share. It starts once:
  - the house rules are signed;
  - the CEO's decision on the closer's number is recorded;
  - the Arabic copy is reviewed;
  - the `wa.me` link is set;
  - Phase 0 has passed.
- **Phase 2 (week 4):** review the results and decide on the work number.
- **Phase 3:** the read.

### Costs

Prices seen on 2026-10-03.
- **Assisted:** $0 in tools. The setter's allowance is KD 5 a month.
- **Work number:** an stc "go 5" prepaid line at KD 5 a month (https://www.stc.com.kw/en/prepaid-plans, VERIFIED; the SIM fee is UNVERIFIED). A separate phone adds about KD 49 (UNVERIFIED).
- **Automatic:** Whapi.Cloud shows $29 a month, with $40 struck out; whether that price needs yearly billing is UNVERIFIED (https://whapi.cloud/price). Evolution API is free.

### Later option: the official Groups API

It needs an Official Business Account. Leads join only by invite link, and a group holds up to 8 people (https://developers.facebook.com/documentation/business-messaging/whatsapp/groups, VERIFIED). HighLevel shows no groups feature (UNVERIFIED). Request the Official Business Account in parallel. If Meta grants it, groups run as `mode='official'`.

## What the CEO must do and decide

**Do:**
1. Get both reps' written yes to the house rules.
2. Record whether the closer joins from a personal number or a work line. Phase 1 waits on this.
3. Give the official line's `wa.me` link.
4. Approve the consent line and the copy. The Arabic comes to you for review.
5. Allow a staff phone number on the test contact. This is a HighLevel write.

The Zoom step is done: the closer is Licensed.

**Decide:**
1. **Number.** Your choice, the setter's personal WhatsApp, works as written. The recommended upgrade before Phase 1 is a Mahara work number on the WhatsApp Business app, as a KD 5 eSIM on the setter's phone. It:
   - keeps leads with Mahara when people leave;
   - shows Mahara on the safety screen;
   - gives the manager web access;
   - is the only number automation may ever use.
2. **"Automatically."** Day 1 is by hand. Automation needs an unofficial linked device. WhatsApp says that breaks its terms and can get the number banned, which would lock the setter out of their own WhatsApp. Yes or no to automation on the personal number? Recommended: no.
3. **Comparison share:** 20% now (recommended), or 50% if demos pass about 40 a month.
4. **Close rule:** 2 days after the demo, or when the deal is won or lost (recommended).
5. **Allowance:** KD 5 a month for the setter.
6. **UAE licence:** whether Mahara holds one.

## Risks and mitigations

- **A ban, the wrong lead or a lost phone:** consent on the call, at most 5 groups a day, the group code and last-4 checks, blocking the SIM, and the work-number option.
- **A test that cannot be read:** a harm check, with every demo marked.
- **The parallel session overwrites `index.ts`:** new files only, and deploys from the latest main with `--verify-jwt`.