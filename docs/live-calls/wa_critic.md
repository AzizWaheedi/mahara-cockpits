# Review of the Project 4 spec: WhatsApp groups from the setter's phone (2026-10-03)

**Verdict.** The design is sound and the recommended mode is right, but the spec should not be built as written. Four things are wrong:
1. **The lead's group is muted.** WhatsApp silences group notifications when a stranger adds you, so the reminders may never ring.
2. **Leads who said yes may get no group.** The setter asks for a yes before the system has chosen which test group the lead is in.
3. **The volume no longer exists.** The spec assumes about 2 groups a day. Demos fell from 275 in June to 17 in September, and none are booked ahead now.
4. **The Zoom fact is out of date.** The spec says the closer's Zoom is Basic. The CEO says the closer has premium Zoom, and the 2026-10-03 update file says the closer was set to Licensed at 10:04 UTC.

I worked read-only: no sends, no writes, no commits.

## 1. Coverage against the CEO's words

| CEO's words | Covered? | Note |
|---|---|---|
| "the setter can make a WhatsApp group" | Yes | Assisted mode |
| "with the closer" | Yes | The closer is admin from the first minute. The closer's own number going to every lead was never approved (gap G11). |
| "that gets created automatically" | Partly | Day 1 is by hand. Automatic comes only on a work number, after a gate. That is defensible, but the spec never tells the CEO plainly that his word "automatically" is deferred (G10). |
| "with the lead" | Partly | The lead is muted by default (G1). About 3 in 10 demos have no call on which to ask (G5). |
| "so we can increase the show rate" | Partly | There is a test, but it cannot be read at today's volume (G3), and the outcome measure is weak (G9). |
| "and contact them there" | Partly | The closer "owns replies", but nobody is prompted when a lead writes in a group. The cockpit cannot see the groups. |
| "just for a set amount of time" | Yes | The group closes 2 days after the demo, or when the deal is won or lost, with exit and delete steps. |
| "personal phone should be fine of the setter" | Yes | The spec reads this as the personal number. It may also mean the setter's own phone with a work number (improvement 3). |
| "the closer has premium zoom" | No | The spec still says the closer is Basic (G4). |

## 2. Is it simple enough for a busy setter?

As written: **6 out of 10.** The work per group is:
- **On the call:** one consent tap.
- **Making the group:** about 9 phone actions (create, add 2 people, make admin, 3 settings, post the welcome, mark it in the cockpit).
- **Before the demo:** 1 or 2 posts.
- **Two days later:** a 5-action close.

At 1 to 3 groups a day this is manageable. Three things make it hard:
- **Two screens.** The dialer is on the desktop and the group is on the phone, so the Copy buttons on the desktop do not reach the phone.
- **Finding the group.** "Open WhatsApp" opens a chat picker that grows with every group.
- **No alerts.** Nothing tells a rep a step is due unless the cockpit is open. The only notifications today are in-page, in `DialerPage.tsx:631-668`.

With improvements 1, 6 and 7 below, it is about 8 out of 10.

## 3. Is the recommended mode right?

**Yes. Start assisted.**
- **The ban cost is too high.** A ban on the personal number wipes the setter's own WhatsApp, chats and backups.
- **Automation does not pay back yet.** It costs about $45 to $51 a month: Whapi at $29 to $35, plus a KD 5 eSIM (about $16). It also needs 4 build days. It saves about 10 minutes a group, so at 15 groups a month it saves about 2.5 hours.

The one fix: give the CEO a plain yes or no on automation on the setter's personal number, with the ban consequence in one sentence. Do not list it as an assumed decision.

## 4. Are the numbers, costs and timeline realistic?

**Volume.** Demos per month on both demo calendars (read-only SQL, 2026-10-03):

| Month | Demos | Booked under 1 hour ahead | Booked under 3 hours ahead |
|---|---|---|---|
| June | 275 | 1 | 15 |
| July | 154 | 6 | 18 |
| August | 81 | 11 | 19 |
| September | 17 | 3 | 5 |

- None are booked ahead now.
- Leads tagged roas-qualified or roas-unqualified dropped to 0 in the week of 28 September (updates.md).
- The spec's "about 2 groups a working day" and "60 demos a month" do not hold.
- The update file says the follow-up agent goes first. The spec does not reflect that.

**Statistics.**
- I recomputed the minimum-lift table: about 34, 24 and 17 points, and about 329 demos per arm for a 10-point lift. The maths is right.
- The time column assumes 60 demos a month. At September's pace (about 14 eligible demos a month after removing the "too soon" ones), reaching 120 per arm takes about 17 months.
- The early stop rule ("15 or more points lower after 30 demos per arm") fires about 11% of the time even when groups have no effect.
- The first-month percentage targets are noise below about 20 groups. "Fewer than 1 lead in 20 leaving" cannot be measured in month one.

**Costs.**
- $0 in tools is right.
- "About 4 setter minutes a group" counts only making the group. Adding 3 posts and the close gives about 9 to 12 minutes per group, shared between two reps (my estimate).
- Whapi's price page on 2026-10-03 shows "$29 / month", with $40 struck out and "33% off". The spec says $35 a month, or $29 paid yearly. Whether $29 needs yearly billing is UNVERIFIED. https://whapi.cloud/price
- The "Samsung Galaxy A07S" model name and its KD 49 price are UNVERIFIED.

**Timeline.**
- 5 days is tight for the full scope: 4 tables with row security and column grants, the planner, the tick and cron job, mirror hooks, the desk hold with Python tests, a 6-state card, the Today strip, the Team card, a Numbers tile with intervals, the harness, a live test on three phones, and two deploys beside the parallel session. 6 to 7 days is more realistic.
- A 3-day core is enough for today's volume.
- Phase 1 also waits on things outside the build:
  - two signed house-rule agreements;
  - both reps' privacy settings;
  - the Arabic copy review;
  - the decision on the closer's number;
  - the official line's `wa.me` link.

## 5. Scored gaps (10 = fix before building)

| # | Score | Gap |
|---|---|---|
| G1 | 9 | **The lead's group is muted by default.** Meta: when someone not in your contacts adds you to a group, "notifications from the group will be silenced until you mark that you want to stay" (https://about.fb.com/news/2025/08/new-whatsapp-tools-tips-beat-messaging-scams, VERIFIED). The setter is not in the lead's contacts, so the reminders, the whole point of the group, may arrive silently. The setter tapping "They're in" does not mean the lead will be notified. House rule 9 also hides the setter's photo, so the safety screen shows an unknown number with no face. |
| G2 | 9 | **Leads are asked before their test group is known.** The setter reads the consent line on the call (step 1). The tick assigns the arm minutes later (step 2). Half the leads who say yes land in the comparison arm and get no group, a broken promise in the first contact. |
| G3 | 8 | **The volume premise is out of date.** The spec assumes 2 groups a day and 60 demos a month. The real numbers are in section 4. It also ignores the update that the follow-up agent goes first. |
| G4 | 7 | **The Zoom fact contradicts the CEO.** The "Closer's Zoom" edge case and CEO "Do" item 4 ("put a paid Zoom licence on the closer") are out of date. The update file says the plan was raised to 2 licences and the closer set to Licensed (not re-checked by me). Remove both. Zoom's participant report then becomes a second source for shows. |
| G5 | 7 | **There is no consent path for about 3 in 10 demos.** In the last 90 days, 66 of 236 demos had no connected Maqsam call over 60 seconds in the 45 minutes before booking. 38 had no intro appointment at all. `consent_source='lead_wrote'` exists in the data model, but there is no flow for it, and no rule for who makes the group when no setter was involved. |
| G6 | 7 | **Step ownership contradicts itself.** "Who does what" says the setter posts the reminders. The copy assigns the evening, hour and join-now messages to the closer. A 30-minute handover cannot work for steps due 60 or 5 minutes before the demo. |
| G7 | 6 | **The timing rules collide.** Quiet hours are 21:00 to 09:00, but house rule 5 says 09:00 to 18:00, Sunday to Thursday. The 18:00 evening step, and a Saturday evening step before a Sunday demo, break rule 5. HighLevel's own reminders still go to group-arm leads, so a lead may get two "one hour before" messages. Which demo reminders HighLevel sends is UNVERIFIED. |
| G8 | 6 | **Setter minutes are understated, and the screens are split.** See section 2. |
| G9 | 6 | **The test outcome is weak.** The group's evening check produces more "confirmed" statuses by design. Under the B2B rule, a confirmed call counts as shown until it is marked, and the spec relies on marking within 24 hours. Read the test on the marked outcome (showed or no-show) or the Zoom join, with the B2B figure beside it. A "yes" in a group must never be written to the HighLevel status. Also fix the stop rule (section 4). |
| G10 | 5 | **"Automatically" is not delivered, and the CEO is not told plainly.** The recommendation is right. It needs one sentence and an explicit yes or no from the CEO. |
| G11 | 5 | **The closer's number was not approved.** The CEO approved only the setter's personal phone, yet the closer's number reaches every lead. "Decide 3" is a blocker for phase 1, not a later choice. |
| G12 | 5 | **Adding a lead by typed number without saving them is unproven.** I could not re-open faq.whatsapp.com/841426356990637: WhatsApp's pages returned errors on 2026-10-03, so this is UNVERIFIED by me. If the app needs a saved contact, house rule 2 breaks. The private invite for a privacy-blocked add is a one-to-one message from the personal number, which house rule 6 forbids. |
| G13 | 4 | **Over-built for the volume.** 4 tables, 9 states, versioned writes, a Team card, a Numbers tile with intervals, 11 signed rules, and `group.prepare` as the only way to get the closer's number. Fewer states would do: ask, to_make, open (with invited and replied flags), close_due, closed. The checklist can drop to 1 setting (the closer is admin). "Approve new members" only matters once an invite link exists. |
| G14 | 4 | **The observer phone (about KD 109 in year one) is replaceable.** With a work number on the Business app, the manager links WhatsApp Web as a companion device at no cost. |
| G15 | 3 | **The join-now short link is a hard dependency.** It waits on the foundation's room service and the `address` field, which is UNVERIFIED. On day 1, the closer pastes the meeting link; add the short link later. |
| G16 | 3 | **Nothing happens after a group closes.** The follow-up agent cannot draft: the VPS sign-in has lapsed since 2026-09-27. The closing line sends the lead to the official line, where 40% of replies get no human answer today. |
| G17 | 2 | **"Setter away" reuses the closers' live-handover availability.** A "hand my groups to the closer today" button is enough. |

## 6. The 8 most valuable improvements

1. **Ask only in the group arm, on the call, with one tap.** The arm is a pure hash of `contact_id`, so the dialer can show "Group test: offer the WhatsApp group" during the intro call. Comparison-arm leads are never asked. Yes and No sit on the after-call panel. This fixes G2 and removes the separate ask state and its timeout. About half a day.
2. **Beat the mute.**
   - Add to the consent line: "It'll come from my number ending in {last 2 digits}. WhatsApp shows a safety screen; tap Stay."
   - End the welcome with: "Reply OK so I know it reached you."
   - Change "lead in" to "lead replied".
   - If the lead has not replied by the evening check, the setter makes a 30-second Maqsam call.

   This costs nothing and fixes G1.
3. **Offer the CEO a Mahara work number on the setter's own phone.** It runs on the WhatsApp Business app with a KD 5 eSIM. Eligibility for the eSIM, and running it beside the personal WhatsApp, are UNVERIFIED. It still honours "personal phone". The gains:
   - a Mahara name and logo on the safety screen;
   - quick replies on "/" and labels in the Business app (https://blog.whatsapp.com/celebrating-one-year-of-whats-app-business-with-new-web-and-desktop-features, VERIFIED);
   - a manager-linked device instead of the observer phone;
   - the number and chats stay with Mahara when the setter leaves;
   - no personal account used for business;
   - any later automatic pilot runs on this number, never the personal one.

   If the CEO prefers the personal number, run the spec as written.
4. **Right-size and sequence.**
   - Build a 3-day core: the groups and events tables, the planner and its tests, the lead card, the Today strip, due-step alerts reusing the `DialerPage.tsx:631` notification pattern, and the close list.
   - Defer the Numbers tile, the observer phone and automatic mode.
   - Start when demos are being booked again, or in the week the follow-up agent ships.
5. **An honest test for low volume.**
   - Primary outcome: marked showed, or a Zoom join (possible now that the closer is licensed). The B2B figure sits beside it.
   - Group taps never touch HighLevel.
   - Below about 40 demos a month, keep a 20% holdout as a harm check.
   - Decide on early signals: reply rate, demos moved before the time against no-shows, and rep minutes.
   - State the date the 120-per-arm read implies.
   - Replace the 11%-false-alarm stop rule with the safety triggers plus a 25-point floor.
6. **One owner per step and one time rule.**
   - The setter posts the welcome and the evening check.
   - The closer posts the hour-before message (skipped if HighLevel already sends one), join-now, holding and the closing line.
   - Steps due within 2 hours go to both reps at once.
   - One window, 09:00 to 21:00 lead time on any day, for messages about the booked call. Join-now can go at any time.
7. **A phone-first card.**
   - "Open on phone" (a QR code) on the desktop card opens the same group card in the cockpit on the setter's phone.
   - The buttons follow the order of the taps: Copy group name, Copy closer number, Copy lead number, Copy welcome, Group made, Paste invite link.
   - Phase 0 times the gap from prepare to made, replacing the 4-minute guess with a measured number.
   - With a work number, WhatsApp Desktop at the desk keeps the whole flow beside the dialer.
8. **Make the group earn the show.**
   - The closer's evening check carries one line from the intro notes (`cockpit_sales_call_notes`): "You mentioned {goal}; I'll show how we'd do that for {company}."
   - An optional 20-second voice note from the closer.
   - An easy move: "If tomorrow is hard, reply with a time and I'll move it." This turns a no-show into a reschedule.
   - Keep it tied to the booked call and never promotional, because of the UAE rule. Track demos moved before the time against no-shows.

## 7. How I checked

- **Code anchors.** I checked these in `scratchpad/im` and all hold: `clients.ts:13`, `lib.ts:428`, `index.ts:873`, `index.ts:4263`, `index.ts:5011`, `index.ts:5085`, `LeadPage.tsx:334`, `followups.py` `pick`, the `stage_role` field in `dialer.ts`, `cockpit_sales_deals`, and the `20261002e` migration pattern.
- **Data.** Read-only SQL on `cockpit_sales_calendar` and `cockpit_sales_dials` on 2026-10-03. September's 11 of 17 under the B2B rule is confirmed.
- **Opened today:**
  - about.fb.com (VERIFIED);
  - blog.whatsapp.com (VERIFIED);
  - whapi.cloud/price (VERIFIED);
  - TechCrunch, 5 August 2025 (VERIFIED).
- **UNVERIFIED by me:**
  - the WhatsApp FAQ pages, which returned errors, so the spec's VERIFIED marks on them rest on the earlier pass;
  - the closer's Zoom licence, taken from updates.md;
  - running two WhatsApp accounts on one phone;
  - HighLevel's demo reminder workflows.

Files read:
- /private/tmp/claude-501/-Users-abdulazizwaheedi-mahara-cockpits/1742ac47-cfcd-4db7-b565-33e64c239220/scratchpad/plan-wf/context.md
- /private/tmp/claude-501/-Users-abdulazizwaheedi-mahara-cockpits/1742ac47-cfcd-4db7-b565-33e64c239220/scratchpad/plan-wf/r5.md
- /private/tmp/claude-501/-Users-abdulazizwaheedi-mahara-cockpits/1742ac47-cfcd-4db7-b565-33e64c239220/scratchpad/plan-wf/r2.md
- /private/tmp/claude-501/-Users-abdulazizwaheedi-mahara-cockpits/1742ac47-cfcd-4db7-b565-33e64c239220/scratchpad/plan-wf/r4.md
- /private/tmp/claude-501/-Users-abdulazizwaheedi-mahara-cockpits/1742ac47-cfcd-4db7-b565-33e64c239220/scratchpad/plan-wf/updates.md