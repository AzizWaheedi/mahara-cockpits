# Break-it review: Project 4 spec, WhatsApp groups from the setter's phone (2026-10-03)

The spec has five breaks that need fixing before Phase 1:

1. The closer cannot remove the group creator.
2. Group names collide, so reps will post in the wrong group.
3. Rebooked demos are dropped by the one-open-group index.
4. Marking differs between the two arms, which moves the show-rate test.
5. Booked-room deadlines kill the join link.

Evidence used:
- Read-only SQL on Creative Triage on 2026-10-03, over `cockpit_sales_appointments` and `cockpit_sales_leads`.
- Code in `/Users/abdulazizwaheedi/mahara-worktrees/sales-cockpit`.
- The four input files.

Nothing was written or sent.

## A. Wrong lead in a group, and privacy leaks

**A1. Group names collide, so reps post into the wrong group.** Severity: Critical.
- **Section:** Screens and copy (group name), and Flow step 6 ("Open WhatsApp").
- **Scenario:**
  - 425 of 480 demo leads (89%) have no company, so the name falls back to the first name.
  - In 120 days, two different leads with the same first name had demos on the same Kuwait day 35 times. There were 339 same-name pairs within 3 days. The Arabic forms of Mohammed (66 demos) and Ahmed (51) lead.
  - `wa.me/?text=` opens a picker with no fixed target (https://faq.whatsapp.com/5913398998672934, VERIFIED).
  - The closer's phone also keeps read-only copies of closed groups with the same names.
  - So lead B can get lead A's name, time and short link, and join lead A's Zoom.
- **Fix:**
  - Put a unique 3 to 4 character code at the start of every group name, for example "K7Q · Ahmed + Mahara Media · Sun 5 Oct".
  - Print the code on the card ("Search K7Q in WhatsApp") and at the end of every copied message.
  - The Posted tap asks the rep to confirm the code.

**A2. The setter adds the wrong number.** Severity: High.
- **Section:** Flow step 4.
- **Scenario:**
  - Two bookings come back to back, and the setter pastes a stale number from the clipboard.
  - A stranger then sees the lead's name, company, number and demo time.
- **Fix:**
  - The card shows the lead's name and the last 4 digits of their number.
  - "Group made" asks the setter to type the last 4 digits of the number they added. A mismatch refuses the tap and says "Remove that person now."
  - Warn when the HighLevel phone differs from the number Maqsam connected on the intro call.

**A3. Lead data stays on the closer's phone after the close.** Severity: Medium.
- **Section:** Flow step 7 and house rule 8.
- **Scenario:**
  - The setter removes the closer, then deletes the group. The closer keeps a read-only copy with the lead's number and the history, because deleting only clears the deleting phone (https://faq.whatsapp.com/498814665492149, VERIFIED).
  - The private-invite path also leaves a 1:1 chat with the lead on the setter's phone.
- **Fix:**
  - Close needs a tap from each phone: the closer taps "Deleted from my phone" and the setter taps "Invite chat deleted".
  - Both reps turn on end-to-end encrypted backup (https://faq.whatsapp.com/490592613091019, UNVERIFIED: seen in search only).

## B. Setter leaves, phone lost or dead, ban

**B1. The closer cannot remove the setter, because the setter created the group.** Severity: Critical.
- **Section:** Edge cases (phone lost), setter away, house rules 10 and 11, Risks table.
- **Scenario:**
  - WhatsApp says "group creators can no longer be removed from the group they started" (https://blog.whatsapp.com/10000640/?l=en, VERIFIED. This is a 2018 post, so test it in Phase 0).
  - So "the closer removes the setter from open groups" fails. A lost phone keeps receiving every open group until the SIM is blocked and the number re-registered (https://faq.whatsapp.com/1007324800132703, VERIFIED).
  - A setter who leaves without exiting stays in every group.
  - The closer can never delete a group for everyone, because that needs every member removed first (https://faq.whatsapp.com/498814665492149, VERIFIED).
- **Fix (preferred):**
  - The company "Mahara Media" Business-app number creates every group. The research prices it at KD 49 for the phone plus KD 5 a month for the line.
  - It then adds the setter's personal number, the closer and the lead. The setter's personal phone still does the talking, which the CEO allowed.
- **Fix (if the CEO declines):**
  - Rewrite the lost-phone and leaver steps: the only cut-off is SIM block and re-registration, and a leaver exits each group in front of the manager.
  - Add a `creator_email` column. Only the creator's card shows "Delete for everyone".

**B2. Steps go to an email with no seat.** Severity: High.
- **Section:** Data model (`owner_email`, `setter_email`).
- **Scenario:** The setter's seat is removed, so welcome and close prompts reach no one and groups never close.
- **Fix:**
  - Every tick moves open groups and future steps away from any email with no active seat, or with `group_reps.link_state` not ok, to the closer.
  - The manager card lists them.
  - Add a matching exit checklist for the closer.

**B3. The closer's personal number carries ban risk without a CEO decision.** Severity: Medium.
- **Section:** Who does what, and Phases.
- **Scenario:**
  - The CEO's words cover the setter's phone only.
  - The spec makes the closer an admin who posts 4 of the 6 steps from a personal phone.
  - Phase 1 starts once both reps sign.
- **Fix:**
  - Gate Phase 1 on CEO decision 3 being recorded.
  - Until then, the closer joins from a work line or the company number. `number_kind` must be `work` unless that yes is stored.

**B4. Adding the lead after the call shows the stranger screen.** Severity: Medium.
- **Section:** Flow step 4.
- **Scenario:**
  - An add up to 30 minutes after the call shows "Stay" or "Exit group" with a report option (https://faq.whatsapp.com/424124173736394, VERIFIED).
  - A vendor claims 3 to 5 reports can trigger enforcement (https://docs.periskope.app/get-started/best-practices.md, a vendor claim only).
- **Fix:**
  - The setter makes the group while still on the intro call and says the group name aloud.
  - The card works from the booking, keyed by contact, before the mirror sees the demo.

**B5. Duplicate groups and double posts.** Severity: Medium.
- **Section:** States (`to_make`: "the closer sees it too" at 30 minutes) and step reassignment.
- **Scenario:**
  - The setter makes the group at minute 29 and taps at minute 33. The closer has already made a second group.
  - A forgotten Posted tap moves the step to the closer, who posts the same message again.
- **Fix:**
  - Add an "I'm making it" claim: state `making`, a `making_by` column, and a version check.
  - The second owner's card says "Check the group first. If it is there, tap Already posted."

**B6. The closer's phone dies near the call.** Severity: Low.
- **Section:** Setter away.
- **Scenario:** Join-now only falls back after 30 minutes, which is after the demo has started.
- **Fix:** Join-now and holding fall back to the setter after 2 minutes. HighLevel's reminder keeps the raw Zoom link.

## C. Lost leads and stuck rows

**C1. The one-open-group index drops rebooked demos.** Severity: High.
- **Section:** Data model (`groups`) and close rules.
- **Scenario:**
  - In 120 days there were 47 repeat demos. 31 were booked within 2 days after the previous demo, while its group would still be open. 5 were booked before the previous demo happened.
  - The insert hits the partial unique index on contact (error 23505). The tick fails every 2 minutes, the demo is in neither arm, and no group exists for the new time.
  - A cancel and rebook in HighLevel makes a new appointment id, which hits the same index.
- **Fix:**
  - Split the table:
    - `group_demos` holds one row per demo seen, with arm, eligibility and outcome. It is unique on `appointment_id`.
    - `groups` holds one row per WhatsApp group. It is unique per contact only while open, with the predicate `arm='group' and closed_at is null`.
  - A new demo for a lead with an open group attaches to that group and plans the "moved" step.

**C2. Comparison leads hear the promise.** Severity: High.
- **Section:** Flow steps 1 and 3.
- **Scenario:**
  - The consent line is read on the intro call. The arm appears only after the mirror and the tick see the demo, up to 5 minutes later.
  - Half of the leads who heard "I'll make a group" are in the comparison arm. They never get a group, or the setter makes one off the record.
- **Fix:**
  - A `group.arm` read uses the same hash and shows the arm on the booking screen: "Group demo: ask" or "Comparison demo: do not offer a group".
  - Groups made for comparison leads count as protocol breaks on the tile.

**C3. A promised group is never made.** Severity: Medium.
- **Section:** States. `not_made` is a skip, and "Not on WhatsApp" has no state.
- **Fix:**
  - Add states `no_whatsapp` and `not_made`. Both put a "Confirm the demo" item in the dialer at once.
  - The card says "{first name} was promised a group. Call or message on the official line."

**C4. The agent's confirm drafts are held for leads who never joined.** Severity: Medium.
- **Section:** Ties to P3.
- **Scenario:** "While a group is open" includes `made`, `invited` and `never_joined`, so these leads get neither the group nor the agent's confirm draft.
- **Fix:** Hold confirm drafts only in `lead_in`.

**C5. Gaps in the state table.** Severity: Low.
- **Scenario:**
  - `never_joined` leaves "at demo end" but goes nowhere.
  - A lead who joins at 3 minutes past the start cannot reach `lead_in`.
  - `comparison` has no target state.
- **Fix:** Add `never_joined` to `lead_in` on a tap, any open state to `close_due` on a close rule, and `comparison` to `closed` (`two_days_after`).

## D. Double or missing messages

**D1. The join-now link dies, or is never made.** Severity: Critical.
- **Section:** Ties to P2, and the foundation's room deadlines.
- **Scenario:**
  - A `purpose=booked` room is made 5 minutes before the call. It expires 600 seconds after the link goes out (`lead_by`), or at `host_by` after 15 minutes.
  - The holding line at 5 minutes past the start reposts the same link. It now opens "This call has ended" while the closer waits in Zoom.
  - 159 of 473 non-cancelled demos (34%) start within 60 minutes of the same host's previous demo. That room stays open until `meeting.ended`, or up to 90 minutes. So `rooms_one_per_host` refuses the next demo's room and join-now has no link.
- **Fix:**
  - Anchor booked rooms to the appointment. Make the room at the hour-before step and set `lead_by` to the demo's end.
  - The short link redirects to the appointment's Zoom link until the demo end plus 15 minutes, whatever the room state.
  - Booked rooms are exempt from `rooms_one_per_host`, because they wrap an existing meeting. With no room, the card uses the raw Zoom link.

**D2. "Same group, same link" is false after a reschedule.** Severity: Medium.
- **Section:** The "Moved" message.
- **Scenario:** The old short link may already have expired.
- **Fix:** Reword to "I'll post the link here a few minutes before," and make a new room for the new time.

**D3. Group-arm leads get three confirmations.** Severity: Medium.
- **Section:** Flow step 6, against existing code.
- **Scenario:**
  - The dialer already queues "Confirm the demo" for demos booked over 24 hours ahead. It starts at 18:00 Kuwait the evening before a morning demo, or at 09:00 on the day otherwise (`dialer.ts:392-395` and `438-449`), and retries every 2 hours (every 30 minutes near the call).
  - HighLevel's demo reminders run in both arms. Which reminders exist is UNVERIFIED.
  - A lead who answered "yes" in the group is still called.
- **Fix:**
  - A [They confirmed] button writes `cockpit_sales_confirmations` with `result=confirmed`. This is not a HighLevel status, so the B2B count is untouched.
  - That row clears the dialer item (`a.confirmed`) and the agent's confirm draft (`followups.py:547`).
  - The group's evening step uses the dialer's `confirmFrom` time.
  - Build day 1 lists HighLevel's demo reminder workflows.

**D4. The closer is in another demo when the hour-before is due.** Severity: Medium.
- **Section:** Who does what.
- **Scenario:** 34% of demos are back to back for the same host, so the hour-before falls inside the previous demo.
- **Fix:** The setter owns the welcome, evening and hour-before steps. The closer owns join-now and holding only.

## E. Time zones and hours

**E1. Two hour rules conflict, and both clash with when demos happen.** Severity: High.
- **Section:** Edge cases (quiet 21:00 to 09:00) against house rule 5 (09:00 to 18:00, Sunday to Thursday).
- **Scenario (120-day data):** 102 of 622 demos fall on Friday or Saturday (78 on Saturday), 106 start at 18:00 Kuwait or later, and 8 start at 21:00. So:
  - The hour-before for a 19:00 demo breaks rule 5.
  - The evening-before for every Saturday and Sunday demo falls on a weekend.
  - The holding line for a 21:00 Kuwait demo (22:00 in the UAE) is blocked.
  - The hour-before for a demo before 10:00 lead time has no rule.
- **The UAE weekend:** the UAE public sector weekend has been Saturday and Sunday since 2022 (https://www.pinsentmasons.com/out-law/news/uae-move-weekend-saturday-and-sunday, VERIFIED). That most private firms followed is UNVERIFIED. So "Sunday to Thursday" is wrong for UAE leads.
- **The existing setting:** the follow-ups setting uses `quiet_days: ["friday"]`.
- **Fix:**
  - One `contact_hours` setting covers both the planner and the house rules.
  - Steps tied to the call (hour-before, join-now, holding, moved) may go at any hour within 2 hours of the call.
  - Other staff messages go 09:00 to 21:00 lead time, on any day.
  - The hour-before moves to the later of start minus 60 minutes and 09:00, and is dropped if that lands within 20 minutes of join-now.
  - Add a Ramadan profile. The 2027 start in early February is UNVERIFIED and falls inside the read window.

**E2. Two sources for the lead's clock.** Severity: Medium.
- **Section:** Edge cases and tests ("by phone prefix").
- **Scenario:**
  - The existing `leadHour` (`index.ts:1821`) reads the ISO `country` field.
  - 31 of 480 demo leads disagree between that field and the phone prefix, for example GB with +971, SG with +974, EG with +20.
  - About 13 non-Gulf demo leads get Kuwait time.
- **Fix:**
  - One shared `leadClock()`: the country field first, the phone prefix second, Kuwait last.
  - Print the GMT offset for any country outside the six.
  - When the fallback was used, the welcome asks "Is that right for where you are?"

**E3. Zoneless times from HighLevel.** Severity: Medium.
- **Section:** Ties to P2 (the worker reads the HighLevel appointment).
- **Scenario:** `GET /contacts/{id}/appointments` returns zoneless Kuwait wall times (team note, sales-cockpit memory). Read as UTC, every step moves 3 hours.
- **Fix:**
  - Take times from the mirror only.
  - Read the link from `GET /calendars/events/appointments/{id}`.
  - Add a test with a zoneless fixture.

**E4. The close date lands on a weekend.** Severity: Low.
- **Scenario:** 2 days after a Thursday demo is Saturday, so the "closed within a day" goal fails by design.
- **Fix:** If the close date falls on the owner's day off, close at 09:00 Kuwait on their next working day.

**E5. The evening-step rule is ambiguous.** Severity: Low.
- **Scenario:** "At least 20 hours away" could be measured from the booking or from 18:00.
- **Fix:** Use `confirmFrom` for the time and "booked more than 24 hours ahead" for eligibility.

## F. Counting errors in the show-rate test

**F1. Marking differs between arms, and the tile adds a second definition.** Severity: Critical.
- **Section:** How it counts.
- **Scenario:**
  - Under the B2B rule, a past demo that is "confirmed" or "invalid" counts as shown, and "new" does not (`index.ts:1581`).
  - In the last 120 days, 149 of 527 past demos were still "confirmed" and 34 were "new".
  - The group arm prompts more (`never_joined`, holding, "is the lead in?"), so its no-shows get marked. Comparison no-shows stay "confirmed" and count as shown.
  - A gap of 5 marks per 30 demos is 17 points, which is the size of effect the test can see.
  - The spec's "unmarked listed apart" adds a second definition beside the B2B rule.
- **Fix:**
  - Keep the B2B rule as the one rate, as the CEO set.
  - Show the same "Mark this demo" prompt for every demo in both arms at start plus 15 minutes.
  - Read the test only when no past test demo in either arm is still "confirmed" or "new". Show this as a neutral line per arm.
  - Check each demo against Zoom's participant report as a second source, not a second rate.

**F2. The coin is per lead but the count is per demo.** Severity: High.
- **Section:** How it counts.
- **Scenario:**
  - 236 demos came from 210 leads in 90 days.
  - A cancel and rebook adds a row, and the B2B rule counts the cancelled one as due and not shown.
  - A P2 live call booked as a new appointment adds a shown row, and the original demo becomes a no-show.
  - Repeat rows also make the intervals too narrow.
- **Fix:**
  - Count one outcome per lead: the first eligible demo, followed through any reschedule or rebook within 14 days.
  - P2 moves the existing appointment (start now, status showed) and never books a second one.

**F3. Arms flip when the share changes, and the hash direction is not stated.** Severity: Medium.
- **Section:** How it counts (drop the comparison share to 20%) and the arm rule.
- **Scenario:**
  - A lead who rebooks after the change can flip arms and count in both.
  - The spec does not say which side of the share is comparison. The test contact's hash value is 0.64.
- **Fix:**
  - Store the arm once in `group_arms` (`contact_id` as primary key, arm, share, `assigned_at`) and never recompute it.
  - State the direction: a value below the share means comparison.

**F4. The early stop fires by chance, and the read date is optimistic.** Severity: Low.
- **Scenario:**
  - At 30 demos per arm, a 15-point gap appears about 11% of the time with no real effect. The standard error of the gap is about 12 points.
  - 120 per arm assumes 60 demos a month. September had 17, which puts the read about 14 months out.
- **Fix:**
  - The harm stop needs a gap of 20 points or 2 standard errors.
  - The tile shows a projected read date from the last 30 days' volume.

## G. Phase 0, Zoom and copy

**G1. Phase 0 cannot run as written.** Severity: Medium.
- **Scenario:** The test contact is email-only and do-not-disturb, so eligibility marks it `excluded`.
- **Fix:**
  - The `allow` list overrides eligibility and forces the group arm.
  - Test rows stay off the tile.
  - Adding a staff phone to the test contact is a HighLevel write that needs the CEO's yes.

**G2. Zoom: the CEO's "premium" claim against the account check.** Severity: Medium.
- **Scenario:**
  - The 2026-10-03 account check found the closer's Mahara Zoom user on Basic.
  - If the "premium" Zoom is a separate personal account and HighLevel is re-linked to it, webhooks stop. They fire only for hosts in the account (https://developers.zoom.us/docs/api/meetings/events/, VERIFIED). The holding signal and the report check are lost.
  - The foundation also refuses rooms for Basic hosts.
- **Fix:**
  - Put the licence on the closer's Mahara user.
  - The card reads `room_hosts.zoom_status` daily and warns that Basic demos end at 40 minutes (https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0067966, VERIFIED).
  - Booked rooms that wrap an existing meeting skip the Basic refusal and only warn.

**G3. Compound Arabic first names are cut in half.** Severity: Medium.
- **Section:** `{first name}` in the copy.
- **Scenario:**
  - Today's template code keeps only the first word (`index.ts:1183`).
  - 26 of 480 demo leads start with a compound, such as "عبد ..." or "أبو ...".
  - "Hi Abd" reads as rude in Arabic.
- **Fix:**
  - A shared `greetName()` keeps these prefixes with the next word, with fixtures in the tests.
  - The Arabic copy is written under the voice skill.
  - Tell the parallel session, because today's template sends have the same bug.

**G4. No proof of consent.** Severity: Low.
- **Scenario:** The yes is a tap made after the call.
- **Fix:** Store the Maqsam attempt id as `consent_call_id`, so the recording is the evidence for the Saudi PDPL record.

## Top 5 fixes

1. **Company number as creator.** The company "Mahara Media" number creates every group, while the setter's personal phone does the talking. Otherwise, rewrite the lost-phone and leaver steps around the fact that the creator cannot be removed. This covers B1 and B2.
2. **A unique code in every group name and message, plus a last-4-digits check on "Group made".** This covers A1 and A2.
3. **Separate `group_demos` from `groups`.** Store the arm per contact and show it at booking, and count one outcome per lead. This covers C1, C2, F2 and F3.
4. **The same "Mark this demo" prompt in both arms.** Read only when no past test demo is still "confirmed" or "new", and keep the B2B rule as the one rate. This covers F1.
5. **One hours rule, booked rooms tied to the appointment, and a [They confirmed] button.** Call-tied steps are exempt from quiet hours. Booked rooms are made at the hour-before step, live until the demo ends, and are exempt from the one-room-per-host limit. The button writes a cockpit confirmation. This covers D1, D3 and E1.