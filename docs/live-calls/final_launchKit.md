# Launch kit: video rooms, live handover, follow-up agent and demo chat

Written 2026-10-03 from origin/main `9670e5b` and read-only checks run today. The specs are F (foundation), P1 (video link when a call fails), P2 (live handover), P3 (follow-up agent) and P4 (demo chat). `api/` means `supabase/functions/sales-api/`.

## Five facts checked today that shape this plan

1. **Nothing is booked ahead.** B2B `calls` holds 0 upcoming intros and 0 upcoming demos. The last intro was booked on 28 September and the last demo on 21 September. New tagged leads per week since 24 August were 65, 55, 21, 4, 1 and 0. For the first two weeks, the machinery is proven on test contacts and on the backlog. Effects on rates need 4 weeks or more, and the ads need to be running.
2. **The cockpit dialer has never placed a call.** All 12 attempts ever (26 to 27 September) have `manual=true`. That flag means "a call made outside the dialer" (`api/index.ts:2917`). Maqsam's result is read only for calls placed from the dialer (`api/index.ts:3365`). So P1's trigger has never been able to fire, and the adoption gate starts at 0%. Every seat does have a Maqsam address through the B2B rep directory, so the Call button can work today.
3. **The VPS sign-in is still lapsed.** The `followups` status row at 13:07 today says so. The doctor last ran on 27 September. There have been 81 drafts ever: all expired, none sent, the last on 26 September.
4. **The intro calendar labels contradict each other.** B2B `calendar_call_type_map` labels `cFeDl0FY8iaXll61lus8` "(qualified)" and `dsqmJ393Dwl9fDSbIVOI` "(unqualified)". The cockpit `calendars` setting and the brief say the opposite.
5. **The test contact cannot exercise every path.** `VjPfR4Cc1Y0OFvaqeor5` has do-not-disturb on, no phone, and the tags `cockpit-test` and `unqualified`, with no roas tag. Three consequences:
   - `countLive` would refuse it as `not_a_lead`.
   - No Maqsam call can reach it.
   - A second test contact on the CEO's phone is needed for every dialer and WhatsApp test, and the booking path needs a test-only rule (Decision T).

## Spec conflicts this kit settles

| Conflict | This kit uses |
|---|---|
| Foundation build days: 7 (F) or 6 (P1, P2) | 7 |
| Google: per-rep tokens (F) vs a "Sales rooms" calendar (P1) vs the CEO's calendar first (P2) | Per-rep `calendar.events` tokens (F, H9). The room goes on each rep's own calendar with no attendees and `sendUpdates=none`. Because the rep is the organiser, the rep can admit a Meet knock. |
| Migration names | F `20261003a`, P3 `20261003c` (F's rule; P3's `20261003f` is dropped), P4 `20261003d`. Check the folder on the day. |
| Watchdog alert route: the CEO's DM (F) or #sales-alerts (P3) | One incoming webhook from the "Mahara Sales" Slack app into a private channel #sales-alerts (the CEO and the manager). The URL is kept in Supabase Vault. |
| `/away` or `/unavailable` | `/unavailable` from the start. Slack has its own `/away`. |
| `sales-live` secrets | F's list: `ZOOM_WEBHOOK_SECRET`, `SLACK_SIGNING_SECRET`, `IP_SALT`, `CRON_SECRET` |
| `call_link` text (F, P1 and P4 differ) | P1's reviewed version, which names the lead and does not end in a variable (section 2, template 7) |
| Test bookings when the test contact has no roas tag | Decision T: in `test_only` mode, contacts listed in `test_contacts` take the booking path, onto the test calendar only |
| "One hooks commit" while P4 is built in week 3 | One deploy on Day 6 carries every change to existing code that F, P1, P3 and P4 share (see below). P4 later adds one line for its action spread. |

The Day 6 hooks commit holds:
- `quiet` on `markAppointment`;
- `source` and `signAs` on `convoSend` and `sendTemplate`;
- the source filter on `whatsappHealth`;
- the read-back that matches the message text;
- `call_time` and `join_code` in `TEMPLATE_VARIABLES`;
- `thread` in the messages source check;
- the two new follow-up kinds;
- the `CRON_ACTIONS` and `DESK_ACTIONS` names.

---

## 1. The first two weeks, day by day

**How the two weeks run**
- People work Saturday to Thursday, with Fridays (9 and 16 October) off. Day 1 is Sunday 4 October.
- Two build sessions run in parallel:
  - **Track A** is P3, mostly in `hermes/sales-desk`.
  - **Track B** is F, then P1.
- P2 and P4 are built in weeks 3 and 4. Their setup steps for the CEO happen in these two weeks, so nothing waits on them later.

**Every deploy**
1. Use a fresh worktree of the latest main.
2. Tell the parallel cloud session first.
3. Check the live sales-api version before and after.
4. Deploy `sales-api` with `--verify-jwt`.
5. Add a runbook row and record the session in `shared/sessions/`.

### Day 1, Sunday 4 October

**Build A.** P3 phase 0, day 1:
- Fix the three faults: a reply is missed when the last inbox message is outbound; the brief cut drops the newest messages; `after_call` must read the B2B rule.
- Add the `--contact` test flag.

**Build B.** F day 1:
- Write `20261003a_sales_rooms.sql`, `roomlogic.ts` and its tests, on a Supabase branch only.
- Send the CEO the template sheet with the Arabic for `call_link_ar` and `demo_host_ar`, written under aziz-kuwaiti-voice.

**CEO.** Sitting 1 (about 60 minutes, section 2).

**Setter**
- From today, every call starts from the cockpit Dialer's **Call** button. Save each outcome.
- A call made from the softphone or a mobile can never offer a video link.

**Closer.** Clear Calendar > **Owed**: mark every past demo as Showed, No-show, Cancelled or Disqualified. In September, 0 of 17 demos were marked showed.

**Gate.** The `followups` status row reads ok after the next run. This proves the sign-in works.

### Day 2, Monday 5 October

**Build A**
- P3 phase 0, day 2: `desk.py doctor` hourly with a model probe, the `health.watch` watchdog (pg_cron every 5 minutes), honest status rows, and the stop rule (pause, never do-not-disturb).
- Restore a count of every outbound Maqsam call per seat. B2B `maqsam_calls` stopped syncing at 2026-09-20 16:02 UTC. Without that count, the 80% adoption gate has no denominator.

**Build B.** F day 2: `desk/rooms.py`, the doctor, the systemd unit `sales-desk-rooms`, the flock restart line and the runbook row.

**CEO.** Sitting 2 (about 75 minutes): the Google OAuth client, six templates, the wallet, and the Meta checks.

**Setter.** Accept Zoom's email invite.

**Both reps.** A 30-minute habits session with the manager:
- dial from the cockpit;
- mark every call within 2 hours;
- answer every reply within 5 minutes in working hours.

**Gate.** The 24-hour clock for G0 (doctor ok) starts.

### Day 3, Tuesday 6 October

**Build A.** P3 phase 0, day 3:
- Write the baselines into `cockpit_metric_values`. Recompute "never booked, then booked in 30 days", because it shows the same 3.6% as the no-show row.
- Run the desk tests.
- Ship phase 0 to the desk only.
- Refusal test: `--contact VjPfR4Cc1Y0OFvaqeor5 --segment no_show`, then approve. Expect "This lead asked not to be contacted."

**Build B**
- F day 3: `api/rooms.ts` and the message service.
- Create the Vercel project for `call.maharamedia.com`, so the CEO has the CNAME value.
- Produce the Google consent link.

**CEO.** Sitting 3 (about 20 minutes): the CNAME, the `call_link` templates, and the setter's Google account.

**Setter and closer.** Press Allow on the Google consent link (2 minutes each).

### Day 4, Wednesday 7 October

**Build A.** P3 phase 1, day 1: the `reactivate` kind (no model), waves, a 10% holdout by contact hash, and pacing (30 s between sends, with 10 slots of the sender ceiling left for P4).

**Build B.** F day 4: `countLive` with Decision T, and the harness.

**CEO.** Sitting 4 (about 50 minutes, once Meta approves the templates): eight workflows, and paste their ids.

**Gate G0.** The doctor reads ok for 24 hours. Meta's approval time is UNVERIFIED; plan for up to 48 hours.

### Day 5, Thursday 8 October

**Build A.** P3 phase 1, day 2: the WA Connector block in code, per-source health, the text-matched read-back, HighLevel notes and the levels table.

**Build B.** F day 5:
- `sales-live` (`/zoom`, `/slack`, `/open`, `/go`), the short page, the sweep and the watchdog.
- Assemble the single hooks commit.

**Manager.** Scorecard 1 (baselines only).

**Gate.** All unit tests are green, and a second session has reviewed the hooks commit.

### Day 6, Saturday 10 October

**Build A and Build B: one deploy**
1. Deploy `sales-api`, then `sales-live` with `verify_jwt=false`.
2. Run the single-copy test: one `opener_en` to the second test contact. Pass means exactly 1 message arrives. Then set `wa_connector_off` true.
3. Track B adds `AvailabilityStrip.tsx` and `RoomPanel.tsx`.

**CEO.** Sitting 5 (about 40 minutes): the Slack app, the Zoom event subscription, and witnessing the single-copy test.

**Gate G1 (first wave).** All three hold: the opener templates are live, the single-copy test passed, and the wallet holds at least $50.

### Day 7, Sunday 11 October

**Build A**
- First wave: 40 a day from the 438 no-shows and 87 cancellations, newest first, with 10% held out.
- Start P3 phase 2: `good_intro`, owners by call type, 30-day `after_call`, and `signAs`.

**Build B.** F day 7: the live test (section 5). Then set `rooms.enabled` true and `test_only` true.

**Setter**
- At 09:00, approve the batch on Follow-ups > Waves > **Approve all 40**.
- Answer every reply within 5 minutes.

**Gate F.** The section 5 acceptance list passes.

### Days 8 to 11, Monday 12 to Thursday 15 October

**Build B.** P1 days 1 to 4:
- **Day 8:** the dialer button, `AfterMissStep`, and the automatic strip (off).
- **Day 9:** `room.joined`, `room.settle`, the quiet mark, `autoMove` and the queue hold.
- **Day 10:** panel copy, the lead page, the Team card, the harness and the tests.
- **Day 11:** the P1 live test, then deploy dark.

**Build A.** The wave runs daily, and phase 2 continues. On Day 11, phase 2 drafts start reaching the closer.

**Reps.** A 60-minute training on Day 8 (section 3), with a role-play where the CEO plays the lead.

**Manager.** Scorecard 2 on Day 11.

### Day 12, Saturday 17 October

The P1 pilot starts only if all of these hold:
- the setter placed 80% of their calls from the cockpit in the past week (measurable only once the Day 2 count exists);
- both rep tokens are connected;
- F's daily checks show 0 mix-ups;
- the CEO said yes to Decision S.

### Weeks 3 and 4

| Work | Days | Starts when |
|---|---|---|
| P2 live handover | 7 | Slack IDs linked, Zoom events arriving, test calendar exists, decision 1 made |
| P4 demo chat | 8 (days 1 to 3 run beside P2) | `demo_host_*` approved, WA Connector off, single-copy test passed |
| P3 phase 3 (`watch`, reply door, push, `call_now`) | 6 | G2: median first answer under 15 minutes for 2 weeks |
| P1 phases 2 to 5 | gated | Section 5 |

---

## 2. The CEO's setup checklist (merged, in order)

**Ground rules**
- Never paste a key, token or secret into chat. Put each one in `/opt/data/bibi/api-keys.env` over SSH. The build copies it where it is needed without printing it.
- Click paths come from the platforms' help pages. Any path not checked on screen is marked UNVERIFIED.

### Sitting 1, Day 1 (about 60 minutes)

| # | Step | Where to click | Time | Unblocks |
|---|---|---|---|---|
| 1 | Sign Claude in on the VPS | SSH to the VPS with your own login, run `claude`, type `/login`, finish in the browser | 5 min | P3, reviews, notes, digests |
| 2 | Answer the decisions in the table below | Reply in the session | 20 min | Everything |
| 3 | Settle the intro calendar labels | HighLevel > Calendars > Calendar Settings. Open `cFeDl0FY8iaXll61lus8` and `dsqmJ393Dwl9fDSbIVOI`, read each name and booking page, and say which is the qualified one. The build fixes the cockpit; the B2B owner fixes B2B's map. | 5 min | P1 "any lead", P2 intros, P3 |
| 4 | Create the test calendar "Cockpit test (not counted)" | HighLevel > Calendars > Calendar Settings > Create Calendar. 15 minutes long, you as the team member, on no page or funnel. Send its id. (Path UNVERIFIED.) | 10 min | All live tests. It stays outside B2B's map, which holds only the 4 sales calendars (checked today). |
| 5 | Create the second test contact | Contacts > Add Contact. Name "Cockpit Test WhatsApp (ignore)", your WhatsApp number, a staff email, tag `cockpit-test`, no roas tag. | 3 min | Dialer, WhatsApp and single-copy tests |
| 6 | Read the first test contact's do-not-disturb | Contacts > "Cockpit Test (ignore)" > DND. Note whether it covers all channels or some. | 2 min | Tests A and B |
| 7 | Switch off the WA Connector | Where it was installed, likely App Marketplace > Installed apps > Uninstall (UNVERIFIED) | 5 min | Every WhatsApp send |
| 8 | Invite the setter and the closer to Slack, and create the private channel #sales-alerts with the manager | Slack > workspace menu > Invite people; then Channels > Create > Private | 5 min | P2; watchdog alerts |
| 9 | Zoom account security | zoom.us > Admin > Account Management > Account Settings > Meeting > Security. Turn **Waiting Room** on > Edit Options > "Users not in your account". Turn on **Embed passcode in invite link for one-click join**. ([waiting room](https://teamdynamix.umich.edu/TDClient/30/Portal/KB/Article/3004/Zoom-Enable-and-Configure-Waiting-Rooms), [passcode](https://webmeetings.unm.edu/advanced-topics/one-click-join.html)) | 5 min | All Zoom rooms |
| 10 | If decision 1 is "licence": license the closer | zoom.us > Admin > User Management > Users > the closer > Edit > Licensed. Add a licence under Billing if none is spare. (UNVERIFIED) | 5 min plus cost | Demos past 40 minutes |

**Decisions** (mark yes or no; every recommendation is yes)

| # | Decision | Recommendation |
|---|---|---|
| 1 | The closer's room | A paid Zoom licence. Basic ends at 40 minutes; demos run 45. |
| 2 | A live call is booked and marked shown in HighLevel when the lead joins | Yes, quietly. Undo deletes it. Tagged leads only. |
| 3 | WhatsApp group route | C now: one chat on the official line. Request the OBA in parallel. Reject B. |
| 4 | Demo chat lifetime | Until 2 days after the demo, the deal won or lost, or the `client` tag |
| 5 | Waits | 120 s to take, 120 s into the room, 600 s for the lead |
| 6 | Meet's own API permission | Later |
| A, B, C | Rooms are made on the VPS; per-rep Google tokens; the lead's email is not added as a Meet guest | Yes |
| D | Live hours | Saturday to Thursday, 10:00 to 20:00 Kuwait time |
| E | The WhatsApp test contact is on the CEO's phone | Yes |
| P1 | Meet by default with Zoom offered; automatic mode after the pilot; an expired booked intro becomes a no-show; a 10-minute wait | Yes |
| P3 | Every kind can reach "Sends by itself", with 80 decided drafts for demo kinds; first messages 09:00 to 18:00; templates $100 a month; an Anthropic API key as backup model; web push for reps now; do-not-disturb only on an explicit unsubscribe a rep confirms | Yes |
| P4 | 80/20 split, decided at 120 demos; the setter can override; accept `demo_host` as marketing if Meta reclassifies it (at most $0.079 a send at Kuwait's rate) | Yes |
| T | In test mode, test contacts take the booking path onto the test calendar only | Yes. Otherwise no live test can prove a booking. |
| S | P1 pilot scope `any` (any tagged lead the setter dials), not only booked intros | Yes. There are 0 booked intros, so scope `intro` would make no rooms. |

### Sitting 2, Day 2 (about 75 minutes)

| # | Step | Where to click | Time |
|---|---|---|---|
| 11 | Google OAuth client | console.cloud.google.com, project 824095651303 (its current consent type is UNVERIFIED): (a) APIs & Services > Library > Google Calendar API > Enable, if it is not on. (b) Google Auth Platform > Audience > User type **Internal**. (c) Branding: app name "Mahara sales rooms", support email. (d) Data access: add `.../auth/calendar.events`. (e) Clients > Create client > Web application > name "Mahara sales rooms" > the redirect address the build gives you > Create. (f) Put the client id and secret in the VPS env file. ([guide](https://var.gg/en/blog/gcp-oauth-consent-client-id)) | 15 min |
| 12 | Six WhatsApp templates | HighLevel > Settings > WhatsApp > Templates > Create Template ([help](https://help.gohighlevel.com/support/solutions/articles/155000000861-how-to-create-a-whatsapp-template-)). Templates 1 to 6 in the list below. | 30 min |
| 13 | Top up the WhatsApp wallet to $100 | HighLevel > Settings > WhatsApp > wallet (path UNVERIFIED) | 3 min |
| 14 | Meta business verification | business.facebook.com > Settings > Security Centre > Start verification (if not done) | 5 min to start |
| 15 | Request the OBA | Business Settings > All tools > WhatsApp Manager > Phone numbers > the number > Profile > **Submit request**. This needs two-step verification on, an approved display name and a verified business. A refusal means waiting 30 days. ([Meta](https://developers.facebook.com/docs/whatsapp/official-business-accounts/)) | 10 min |
| 16 | Check the number's setup | WhatsApp Manager: is the number also on the WhatsApp Business app, and how many partners are connected? (UNVERIFIED path) | 5 min |
| 17 | Two new contact fields: `cockpit_join_code` and `cockpit_demo_time` | HighLevel > Settings > Custom Fields > Add Field > Contact > Single line. Skip this if the build already created them through the API. | 4 min |

**Templates** (exact names, category and text)

| # | Name | Category | Body and buttons |
|---|---|---|---|
| 1 | `cockpit_opener_en` | Marketing | "Hi {{1}}, it's {{2}} from Mahara Media. How are you?" |
| 2 | `cockpit_opener_ar` | Marketing | «السلام عليكم {{1}}، معاك {{2}}. كيف حالك؟» (the CEO's own wording) |
| 3 | `cockpit_line_en` | Marketing | "Hi {{1}}, it's {{2}} from Mahara Media. {{3}} Just reply here if you'd like to continue." Each sentence on its own line. This is the text already saved in the cockpit's WhatsApp library. |
| 4 | `cockpit_line_ar` | Marketing | The library's text: «هلا {{1}}، معاك {{2}} من مهارة ميديا. {{3}} إذا حاب نكمل، رد علي هني.» Each sentence on its own line. |
| 5 | `cockpit_demo_host_en` | Utility | "Hi {{1}}, this is {{2}} from Mahara Media. I'll host your demo on {{3}}. I'll send the Zoom link here 15 minutes before. Can you still make it?" Quick replies: "Yes, I'll be there" and "I need another time". |
| 6 | `cockpit_demo_host_ar` | Utility | The build's Arabic from Day 1 |
| 7 | `cockpit_call_link_en` | Utility (Sitting 3) | "Hi {{1}}, your call with {{2}} from Mahara Media is ready now. Tap the button below to join." Button: Visit website, "Join the call", dynamic URL `https://call.maharamedia.com/{{1}}`, sample `K7Q2MX`. |
| 8 | `cockpit_call_link_ar` | Utility (Sitting 3) | The build's Arabic from Day 1 |

**Sample values for Meta:** any first name for {{1}}, a rep's first name for {{2}}, and for {{3}} "Sunday 5 October at 4:00 pm (Saudi time)" on the demo templates or a short sentence on the line templates.

### Sitting 3, Day 3 (about 20 minutes)

| # | Step | Where to click | Time |
|---|---|---|---|
| 18 | CNAME | GoDaddy > My Products > maharamedia.com > DNS > Add New Record > CNAME, Name `call`, Value from Vercel, TTL 1 hour > Save (path UNVERIFIED) | 5 min |
| 19 | Templates 7 and 8 | Same path as step 12, once `call.maharamedia.com` opens | 10 min |
| 20 | Check the setter has a maharamedia.com Google account (UNVERIFIED today), then send both reps the consent link | admin.google.com > Directory > Users | 5 min |

### Sitting 4, Day 4 or 5, after Meta approves (about 50 minutes)

| # | Step | Where to click | Time |
|---|---|---|---|
| 21 | Eight one-step workflows, one per template | Automation > Workflows > Create Workflow > Start from scratch. Name it "Cockpit · {template}". No trigger (the cockpit enrols by API). One action: WhatsApp > Template > the template. Then: Settings tab > **Allow Re-entry** on > Publish ([WhatsApp in workflows](https://help.gohighlevel.com/support/solutions/articles/155000001624-whatsapp-workflow-integration), [re-entry](https://help.vintory.com/allow-re-entry-setting-inside-the-workflows)) | 40 min |
| 22 | Paste each workflow id | Cockpit > Follow-ups > WhatsApp library > the route > Edit > workflow > Save | 10 min |

**Variable mapping for step 21**
- {{1}} is the contact's first name, and {{2}} is `cockpit_rep_name` (every template).
- {{3}} is `cockpit_whatsapp_line` on the line templates and `cockpit_demo_time` on the demo templates.
- The call_link button variable is `cockpit_join_code`.

**Rules for step 21**
- Add no wait step. A contact still inside a workflow is skipped on re-entry, so the workflow must finish at once.
- Whether a workflow can fill a URL button from a contact field is UNVERIFIED. If the Day 4 test shows it cannot, resubmit the call_link templates with this body: "Hi {{1}}, your call with {{2}} from Mahara Media is ready. Join here: {{3}} The room is open for 10 minutes."

### Sitting 5, Day 6, after `sales-live` is deployed (about 40 minutes)

| # | Step | Where to click | Time |
|---|---|---|---|
| 23 | Slack app "Mahara Sales" | api.slack.com/apps > Create New App > From a manifest > MaharaMedia > paste the build's manifest > Next > Create > Install to Workspace > pick #sales-alerts for the webhook > Allow. Put the Signing Secret (Basic Information), the Bot User OAuth Token (OAuth & Permissions) and the webhook URL in the VPS env file. ([Slack](https://docs.slack.dev/app-manifests/configuring-apps-with-app-manifests)) | 15 min |
| 24 | Zoom event subscription | marketplace.zoom.us > Develop > Build App (or Manage) > the Server-to-Server app > Features > Access > Event Subscription on > Add ([steps](https://docs.stackone.com/connectors/zoom/guides/webhook-setup)). See the order below. | 15 min |
| 25 | Slack IDs and Zoom users on each seat | Cockpit > Team > the seat > Links | 5 min |
| 26 | Witness the single-copy test | Your phone: exactly 1 message | 2 min |

**Step 24, in order:**
1. Copy the Secret Token into the VPS env file as `ZOOM_WEBHOOK_SECRET`, and tell the build.
2. Wait while the build copies it into the function.
3. Enter the URL `https://bldgtotkfmhoxmlzowdx.supabase.co/functions/v1/sales-live/zoom` and press Validate.
4. Add the seven events: meeting started, meeting ended, participant joined, participant left, participant joined waiting room, jbh waiting, jbh joined.
5. Save.

### Week 2 (about 30 minutes)

| # | Step | Where | Time |
|---|---|---|---|
| 27 | Add the consent line to the lead forms | HighLevel > Sites > Forms > each form. The number of forms is UNVERIFIED. | 10 min per form |

**Total:** about 4.5 hours across five sittings, plus Meta's review time.

---

## 3. Rep training

### The setter's one-page guide

**Once**
- Accept Zoom's invite.
- Press Allow on the Google link.
- Join Slack.

**Every day:** start every call from the Dialer's **Call** button. The cockpit can only offer a video link on calls it placed.

**When to send a video link**

| Send it | Do not send it |
|---|---|
| A booked intro rang out, was busy or failed | The lead is on the phone with you (use **Bring in a closer** when P2 is live) |
| The number does not work, but the lead has WhatsApp or email (lead page header) | The cockpit refuses: client, do not disturb, or a booked demo (its Zoom link comes from HighLevel) |
| The lead writes that they cannot talk on the phone | You cannot be in the room within 2 minutes |

**How to send one**
1. Press **Send a video link**.
2. Keep **Meet** (the default) or pick **Zoom instead**.
3. Press **Open my room** at once.
4. On Meet, press **I'm in the room**. Zoom marks this by itself.

**How to read the room panel**

| The panel says | You do |
|---|---|
| "Making your Meet room..." | Wait. Under 15 s is normal. |
| "Link sent on WhatsApp at 14:03. Waiting for {first name} (9:59 left)." | Be in the room. |
| "Not sent: {reason}. Read it out: call.maharamedia.com/K7Q2MX" | Call or text the code by hand. |
| "{first name} opened the link at 14:05. Join now." | Get in the room now. |
| "{first name} is in the waiting room. Admit them in Zoom." | Zoom > Participants > Admit. |
| "{first name} joined. Booked as a live intro and marked shown." | Run the intro. |
| "Nobody joined in 10 minutes. The room is closed. Mark the intro:" | Press **No-show** or **We spoke on the phone**. |
| "Rooms are down..." | Call again or book a time. Tell the manager. |

**When the lead knocks on Meet**
1. Meet shows that someone wants to join. Press **Admit**.
2. In the cockpit, press **The lead is in**. You have 5 seconds to undo.
3. If you see no knock, or cannot admit, press **I can't let them in**. The room moves to Zoom and a new link goes.
4. If a colleague came in instead of the lead, press **That was not the lead** within 5 minutes.

**If the lead calls back on the phone:** press **We are on the phone**. The room closes.

**After a held intro:** press **Held it**, then **Book the demo** or set a call-back.

**What to say before a handover (from P2, week 3)**
- While searching: "I'm bringing in one of our closers now. It takes a minute or two. While we wait, how many projects are you running this quarter?"
- When the closer is ready: "I've just sent you a link. Tap it and you'll be with our closer straight away."
- When nobody takes it: "Our closers are all on calls right now. What works better, today at {time} or tomorrow at {time}?"
- When the lead's WhatsApp window is closed: "Can you send 'hi' to our WhatsApp now? The link comes straight back."

### The closer's one-page guide

**Once**
- Join Slack and open the Mahara Sales app.
- Press Allow on the Google link.
- Keep your Zoom linked in HighLevel.

**Going available**
- Press **I'm available**: on the strip at the top of every cockpit page, by typing `/available` in Slack, or on the app's Home.
- It lasts 2 hours. Press it only when you can take a call within 2 minutes.
- The system closes an empty room 10 minutes before your next booked call.

**Waiting in the room**
- Press **Join my room**. The strip then reads "In your room until 16:30. The next live lead comes to you."
- Keep Zoom open with sound on. Start no other Zoom meeting, because Zoom allows one meeting per host.
- At 35 minutes you get a fresh room. Press **Open my room** again.

**Taking a call-out**
1. The offer shows the kind, the country, the setter's note and a 2-minute countdown. Read the note.
2. Press **Take it** or **Not now**. If you ignore it, you go Away.
3. After **Take it**, the link goes to the lead, who has 10 minutes.
4. When the lead is in the waiting room, press **Admit**.
5. If Zoom says nothing for 30 seconds, press **They joined**.
6. If you admitted the wrong person, press **That was not the lead** within 5 minutes.
7. Never end a room with the lead still in it.

**After the call**
- Save the outcome and mark the call on the lead page.
- Answer "Call finished. Ready for the next one?" with **I'm available** or **Not now**.
- Each morning, approve your follow-up drafts (good intro, demo no-show, after the demo) and answer demo-chat replies.

**Words in the room:** "Hi {first name}, thanks for jumping on so quickly. {setter first name} told me a little about {note}. Do you have about 45 minutes now?"

### Exact words to a lead (English)

- **On the phone, the line is bad:** "The line is breaking up. I'll send you a video link on WhatsApp now. Tap it and you'll see me in a minute."
- **The lead asks what the link is:** "It's a private video room for our call. It opens in your browser or the app. There's nothing to sign up for."
- **Meet instructions:** "When it opens, press 'Ask to join' and I'll let you in."
- **Zoom instructions:** "It opens in Zoom or your browser. You'll wait a moment, then I'll let you in."
- **The lead replied in chat:** "Thanks {first name}. Are you free for a quick video call now? {rep} is ready: {link}"
- **After a missed booked intro** (the automatic WhatsApp): "Hi {first name}, it's {setter} from Mahara Media. I just tried to call you for your intro call and couldn't get through. We can do it on video now instead: {link} I'll wait for you for the next 10 minutes."

Never promise results. Never quote leads or cost per lead to a lead.

---

## 4. The manager's daily routine

**Morning, 09:00 Kuwait time (15 minutes)**
1. **Health:** the Team page health line ("Rooms: working. Last run..."), the follow-up status row, and anything posted overnight in #sales-alerts.
2. **Mix-ups:** F's daily SQL check must read 0. A mix-up is two open rooms for one lead or host, a double claim, or a link sent to another contact.
3. **Rooms yesterday:** each one ended in a named state with a reason. Ask the setter about any Meet room left unmarked.
4. **Second sources:**
   - Zoom joins match the participant report.
   - "Live ·" appointments in HighLevel match `count_result`.
   - Marks match the HighLevel status.
5. **Owed marks:** Calendar > Owed. Target 0 by noon.
6. **Follow-ups:**
   - drafts waiting, and yesterday's expired share (target under 20%);
   - wave sent, replies and stops;
   - templates not confirmed;
   - template spend against $100.
7. **Replies:** any reply unanswered for more than 15 minutes, and yesterday's median first answer.
8. **Dialing:** the setter's calls placed from the cockpit, divided by all their Maqsam calls.

**Evening, 18:30 (10 minutes)**
1. Today's rooms, links, opens and joins. Once P2 is live, also offers made, taken and expired, and offers nobody took.
2. Clear the drafts, so nothing expires overnight.
3. Tomorrow's intros, demos and planned demo chats.
4. Today's owed marks should be 0.
5. Every red alarm is closed or has an owner.

**Alarms**

| Alarm | Where | Do |
|---|---|---|
| "Rooms are down" (red within 90 s; Slack within 10 min) | Health line, #sales-alerts | SSH and run `systemctl status sales-desk-rooms`. Reps read links out or book times. |
| "The follow-up agent cannot write" | #sales-alerts | Sign Claude in on the VPS again |
| "The HighLevel wallet is empty" | #sales-alerts | Top it up |
| Two identical outbound messages within 60 s | Banner | WhatsApp sends pause. Check the WA Connector. |
| A template route turned itself off | Follow-ups | Republish the workflow and check re-entry |
| "Zoom and the cockpit disagree on 1 room" | Health line | Open the room's timeline and mark it by hand |
| A reply unanswered for 10 minutes | Slack | Answer it, or reassign it |
| A stop request task | Tasks | Confirm or dismiss it the same day |
| "Shown not written" | Live page | Book and mark it in HighLevel by hand |

---

## 5. Go-live checklists per project

**F: Foundation.** Kill switch: `rooms.enabled=false`.
- **Before:** the hooks commit is deployed, `sales-live` is live, the Zoom events validate, and both rep tokens are connected.
- **Acceptance**, on the two test contacts and the test calendar:
  - [ ] 20 rooms each get a link within 15 s.
  - [ ] A guest not signed in knocks and is admitted.
  - [ ] Zoom events land within 10 s and match the participant report.
  - [ ] Two tabs press Take, and exactly one wins.
  - [ ] The "Live ·" booking lands on the test calendar, not in B2B `calls`, and is then deleted.
  - [ ] The audit query shows 0 sends to other contacts.
  - [ ] Stopping the worker turns the line red within 90 s and posts to Slack within 10 minutes.
- **Turn on:** `enabled` and `test_only`.

**P1: Video link.**
- **Before:** F passed; the setter dialed 80% of calls from the cockpit for a week; the CEO said yes to Decision S.
- **Acceptance:**
  - [ ] 10 Meet rooms from a phone not signed in to Google: knock, admit, one open counted, no preview counted, a booking with no workflow in the history, expiry, and the ended page.
  - [ ] 10 Zoom rooms on the CEO's licensed user: `host_in` and `lead_in` within 10 s, and the report matches.
  - [ ] A cockpit call to the second test contact rings out, and **Send a video link** appears.
  - [ ] The test appointments are deleted.
- **Turn on, in this order:**
  1. Pilot: Meet, email and read-out.
  2. WhatsApp text, after the single-copy test.
  3. `auto_on_miss`, after 1 clean week.
  4. Zoom for the setter.
  5. Templates.

**P2: Live handover.**
- **Before:**
  - the Slack app is installed;
  - both reps are in Slack, with IDs on the Team page;
  - decision 1 is made;
  - the cockpit-dialing gate holds.
- **Acceptance:**
  - [ ] The CEO is ready within 10 s of pressing Available.
  - [ ] The offer arrives in under 2 s.
  - [ ] A private window is admitted, and `lead_joined` follows within 10 s.
  - [ ] The HighLevel appointment is on the test calendar, marked showed, with no workflow in the history.
  - [ ] Each of these cases behaves as specified: two phones press Take at once; nobody takes it; a no-show; a cancel; "That was not the lead"; a stopped webhook; the Meet admit test.
- **Turn on:** dialer demos with email and read-out for 1 week, then the lead page, intros, Meet and WhatsApp.

**P3: Follow-up agent.**
- **G0:** the doctor reads ok for 24 hours.
- **Acceptance:**
  - [ ] The refusal test shows "This lead asked not to be contacted."
  - [ ] The single-copy test shows exactly 1 message.
  - [ ] The watchdog alerts within 10 minutes of a stale row.
  - [ ] 0 real leads were messaged during the tests.
  - [ ] `reactivate` never calls the model.
  - [ ] The holdout is stable.
- **G1 for waves:** the templates are live and the wallet holds at least $50.

**P4: Demo chat.**
- **Before:** `demo_host_*` approved, the WA Connector off, and the day-1 checks done:
  - the calendar events query;
  - quick replies through a workflow;
  - a URL button filled from a contact field;
  - whether `address` comes back through the API;
  - whether HighLevel's Zoom hosts are in Mahara's account;
  - that no workflow fires on "Note added".
- **Acceptance:**
  - [ ] A 3-day dry run threads every demo within 4 minutes.
  - [ ] No step falls in quiet hours.
  - [ ] Nothing can be sent to clients or do-not-disturb contacts.
  - [ ] Tests A, B and C pass on the test contacts.
- **Turn on:** dry run, then test contacts only, then all demos at 80/20.

---

## 6. The weekly scorecard

**Read the volume first** (checked today):
- New tagged leads per week: 65, 55, 21, 4, 1, 0.
- Upcoming intros and demos: 0 and 0.
- Cockpit dials: 12 ever, all saved by hand.
- Maqsam outbound calls, 1 to 20 September: 36, of which 23 were completed or serviced. Nothing is recorded after the sync stopped on 20 September.

No effect is claimed before 4 weeks. Every rate shows its counts.

| Project | Weekly number | Baseline today | Target |
|---|---|---|---|
| F | Rooms with a link within 15 s | new | 95% |
| F | Mix-ups (daily SQL) | new | 0 |
| F | Rooms ending in a named state | new | 100% |
| F | Zoom joins matching the report | new | 100% |
| P1 | Setter's calls placed from the cockpit | 0% (0 of 12 attempts placed) | 80% |
| P1 | Unconnected booked intros given a room | none | 60% |
| P1 | Links opened (previews excluded) / joined | none | 40% / 20% |
| P1 | Intro show rate, B2B rule | 54% (40 of 74 in September: 22 showed, 13 confirmed, 5 disqualified) | 60% on intros booked ahead |
| P1 | Intro show rate with evidence (marked showed) | 30% (22 of 74) | rising |
| P2 | Shown intro to held demo within 24 h | about half (spec: 35 shown, 17 demos) | 60% |
| P2 | Press to rep in the room, median | none | under 90 s with a ready closer, under 3 min otherwise |
| P2 | Join rate of handover links | none | 70% |
| P2 | Joined handovers with an appointment in HighLevel | none | 100% |
| P3 | First human answer, median / never answered | 4.7 h / 40% of 2,729 | under 5 min / under 5% (90 days) |
| P3 | Never booked, then booked in 30 days | 3.6% (recompute in week 1) | 10% |
| P3 | No-show rebooked within 14 days and kept | 3.6% | 10% |
| P3 | Good intro with a demo within 14 days | 50.5% | 65% |
| P3 | Demo closed within 30 days | 4.8% | 8% |
| P3 | Cancellation rebooked within 14 days | 13.6% | 25% |
| P3 | Drafts that expire | 100% (81 of 81) | under 20% |
| P3 | Wave bookings above the holdout | none | positive, with a range |
| P3 | Template spend | $0 | at most $100 a month |
| P4 | Demo show rate by arm, B2B rule | 65% (11 of 17: 11 confirmed, 4 no-shows, 2 cancelled) | toward 75% |
| P4 | Demo show rate with evidence | 0 of 17 marked showed | rising |
| P4 | Replies before the demo / opt-outs | none | 50% / under 2% |
| P4 | Templates failed or not confirmed | none | under 10% |

The September rates reproduce only when B2B counts disqualified intros as shown and keeps cancellations in the denominator. That gives 40 of 74 = 54% and 11 of 17 = 65%. This settles P1's "35 of 68" note, and the scorecard shows that denominator.

---

## Sources checked today (read-only)

**Code and data**
- **Seat and dial data:** `cockpit_sales_attempts` and `cockpit_sales_worker_status`; `api/index.ts:2917` and `:3365`; `api/lib.ts:37-39` (`maqsam_from`).
- **Follow-ups:** `cockpit_sales_followups`; `cockpit_sales_wa_templates` holds `line_en` and `line_ar`, both inactive, with no workflow.
- **Calendars and calls:** B2B `calls`, `calendar_call_type_map` and `maqsam_calls` (last synced 2026-09-20 16:02 UTC).
- **Test contact and seats:** the test contact's row in `cockpit_sales_leads`; seats in `cockpit_sales_people`. No seat has a Slack ID; all four have Maqsam addresses through `cockpit_sales_reps`.
- **Dialer labels:** `apps/sales-cockpit/src/pages/DialerPage.tsx:229-339`.

**Platform pages**
- [Zoom event subscriptions](https://docs.stackone.com/connectors/zoom/guides/webhook-setup)
- [Zoom waiting room](https://teamdynamix.umich.edu/TDClient/30/Portal/KB/Article/3004/Zoom-Enable-and-Configure-Waiting-Rooms)
- [Zoom embedded passcode](https://webmeetings.unm.edu/advanced-topics/one-click-join.html)
- [Google Auth Platform](https://var.gg/en/blog/gcp-oauth-consent-client-id)
- [HighLevel templates](https://help.gohighlevel.com/support/solutions/articles/155000000861-how-to-create-a-whatsapp-template-)
- [HighLevel WhatsApp in workflows](https://help.gohighlevel.com/support/solutions/articles/155000001624-whatsapp-workflow-integration)
- [Allow re-entry](https://help.vintory.com/allow-re-entry-setting-inside-the-workflows)
- [Slack manifests](https://docs.slack.dev/app-manifests/configuring-apps-with-app-manifests)
- [Meta OBA](https://developers.facebook.com/docs/whatsapp/official-business-accounts/)

**Still UNVERIFIED**
- The GoDaddy, wallet, WA Connector and HighLevel calendar click paths.
- Meta's approval time for the templates.
- Whether a workflow can fill a URL button from a contact field.
- Whether B2B drops deleted appointments.
- The Zoom end-meeting and report paths.
- Whether the closer's HighLevel Zoom is inside Mahara's account.
- Whether the test contact's do-not-disturb covers every channel.