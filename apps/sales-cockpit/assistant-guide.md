# Sales cockpit: how it works

Written from the code on main, 2026-11-04.

## What the cockpit is for

The sales team uses this cockpit. Setters call new leads, qualify them, and book intro calls. Closers run demos, send proposals and contracts, and close the deal. Mahara sells its ad and sales service to construction and design businesses in the Gulf.

A rep sees their own day and their own leads. A manager can switch to the whole team on most pages. A seat is linked to a HighLevel user and to a B2B rep before calls, goals and pay can be matched to the person.

The left menu groups the day, the numbers and the rest. A narrow screen shows a dock at the bottom. Search opens with Ctrl K on Windows or Cmd K on a Mac. The portal's door lands on /dashboard, which opens Today.

## Today (address /)

What it shows:
Today is the rep's day. It starts with the date and a line that says when calls and leads were last copied from the CRM. Then comes the day line, the calls the rep still has to mark, the calls that need a lead rating, and the week against goal. The right side has the rep's own open tasks, "Coming up" for the next 36 hours, the leads waiting on a reply, and "New leads" from the last 48 hours.

Buttons and actions:
- "All owed": opens the Owed list on the Calendar.
- "Showed": marks the call as held. The mark waits five seconds with "Undo", then goes to HighLevel.
- "Didn't happen": marks a no-show. Inside the five seconds "They cancelled instead" changes it to a cancellation, and "Undo" drops it.
- "Disqualify": asks why first, then offers the reasons, such as "No budget", "Not the decision maker" and "Wrong or fake details".
- "Reschedule": opens the time picker for that call.
- "Tell them": opens the message for the lead, with the call time and the meeting link.
- "Done": closes the message panel after the rep sends it.
- "Change": opens the lead rating and the reason again.
- "How good is this lead?": the 1 to 10 scale for a call the rep held.
- "No demo booked. Why?": the reasons a held intro did not book a demo.
- "Next": moves to the next part of the call script.
- "Numbers": opens the Numbers page.
- "Book intro", "Book demo" and "Book a follow-up call": open the picker for that kind of call on a lead.

How to:
- Start the day: read the date line, then work down the calls to mark and the leads to rate.
- Mark a call: press "Showed", "Didn't happen" or "Disqualify". If the press was wrong, press "Undo" inside the five seconds.
- Book the next call: open the lead, choose "Intro", "Demo" or "Follow-up call", pick a time, then save.
- Finish the day: open "End of day" and send the report.

## Calendar (address /calendar)

What it shows:
Every call in Kuwait time, in three views. "Upcoming" covers the next two weeks, "Past" covers the last two weeks, and "Owed" lists calls that still need a mark in the last 30 days. The type chips filter by "All", "Intro", "Demo", "Follow-up" and "Callback". Each day is its own card, and each row shows the time, the lead, the call type and its state, such as "Owed a mark", "Not marked", "Showed", "No-show", "Cancelled" or "Disqualified".

Buttons and actions:
- "Upcoming", "Past" and "Owed": switch the view.
- The call type chips: filter the list, with a count beside each type.
- The mark buttons: the same three marks as on Today, with the same five second undo.
- "Reschedule": opens the picker under the row.
- "Tell them": opens the message for that call.
- "Show the skipped leads" is not here. It belongs to the Dialer.

How to:
- Clear the calls owed a mark: open "Owed", mark each call, then check that the list is empty.
- Find a call from last week: open "Past", pick the type, then open the lead.
- Move a call: open "Upcoming", press "Reschedule" on the row, then pick the new time.

## Leads (address /leads) and a lead's page (address /lead)

What it shows:
The Leads page lists every contact in the sales sub-account. The columns are name, created, class, stage, revenue band and country. The search box takes a name, an email, a company or a phone. The stage picker groups HighLevel stages under their pipeline. The created picker offers "Created in the last 7 days", "Created in the last 30 days", "Created in the last 90 days", "Created in the last year" and "Created any time". The class chips are "All", "Qualified", "Unqualified", "Not ready" and "No lead tag".

Opening a lead opens its page. The header shows the name, the class, the owner, the company and the country. Under it are the buttons for the work: "Open the intro script" or "Open the demo script", the Zoom link, "Copy the number", "Copy the email", "New client form", "Open in the dialer" and "Open in HighLevel". An active client is labelled "Active client", and the sales actions are hidden.

The page then shows the Calls card, "What they told us", "Where they came from", "Conversation", "Everything so far", "Recorded calls", "Proof to send", "What the calls told us", "Research", "Notes", "Proposal", "Contract" and "New client form".

Buttons and actions:
- "Intro", "Demo" and "Follow-up call": start the booking picker for that call.
- "Reschedule" and "Tell them": work on the next call or a past one.
- "Open the intro script" or "Open the demo script": open the guided call at /call.
- "Open in the dialer": opens the Dialer with this lead in its panel.
- "Open in HighLevel": opens the contact in HighLevel.
- "Copy the number" and "Copy the email": put the detail on the clipboard.
- "New client form": opens the form for closers and managers.
- "Draft proposal": asks the writer for a proposal from the demo call.
- "Create the draft": makes a contract draft in HighLevel.
- "Send by email" and "Send as a link": send the contract.
- "Send by email and WhatsApp" and "Send on WhatsApp only": the same send when the template is one that also goes on WhatsApp.
- "Copy the link" and "Put it in WhatsApp": share a contract that is already sent.
- "Make another contract" and "Edit in HighLevel": add a second contract or change the draft.
- "Add" in "Notes": saves a note on the lead.

How to:
- Work a new lead: open it from "New leads", read "What they told us", then open the intro script.
- Book a call: press "Intro" or "Demo", pick the day and time, then save.
- Move a call: press "Reschedule" on the row, pick the new time, then save.

## Messages (address /messages)

What it shows:
Messages holds the conversations on the sales sub-account: WhatsApp, email, Instagram and Facebook, with SMS when a real one exists. The list can be filtered by the person, the channel and the state. Opening a conversation shows the thread and the reply box, and the row clock runs against the team's one hour reply standard.

How to:
- Answer a lead: open the conversation, type in the reply box, then send.
- Find a waiting reply: filter to the waiting state, then open the oldest row.

## Dialer (address /dialer)

What it shows:
The Dialer works one lead at a time from a queue. A setter sees the setter queue and a closer sees the closer queue; a person who does both can switch between "Setter queue" and "Closer queue". The queue is ordered for the work: new leads, replies, missed calls and due call-backs. The page shows the day's numbers, the leads to call now, the queue, the open call and the lead's details. Maqsam places the call and its record is read back while the call runs.

Buttons and actions:
- "Turn on alerts" and "Alerts on": switch the sound and the desktop notice.
- "Call": places the call through Maqsam. While it runs the button reads "On the call".
- "Skip": moves the lead out of the queue for half an hour.
- "Next lead": opens the next lead. Enter does the same when the button has focus.
- The outcome buttons, such as "No answer", "Answered", "Call back" and "Booked": pick how the call went.
- "Save how it went": saves the outcome and the note.
- "Save and next": saves and opens the next lead.
- "Book the demo": opens the booking picker for a demo.
- "Save and WhatsApp them" and "Save and email them": save a no-answer and open a message.
- "Show the skipped leads": brings back the leads skipped in this session.
- "Back to outcomes": returns from a booking or a move to the outcome list.

How to:
- Call the next lead: read the queue, press "Call", talk, then pick the outcome and press "Save and next".
- Log a call made elsewhere: open the lead, pick the outcome, write the note, then press "Save how it went".
- Book a demo while the lead is warm: press "Book the demo", pick the time, then save.

## Pipeline (address /pipeline)

What it shows:
The Pipeline is a board of HighLevel stages in their own order. Each card shows the lead, the class, the next step or the last touch, and the owner. Quiet leads, with no touch for 60 days, are counted under their stage and hidden until asked for. Signed clients stay in the Closed column with the day they signed, the value and who closed them.

Buttons and actions:
- "Mine" and "Team": choose whose leads the board shows.
- "Board" and "Hot list": switch between the stage board and the ranked hot list.
- "Show quiet leads" and "Hide quiet leads": show or hide the leads with no touch for 60 days.
- A card: opens the lead.
- The "Move to…" picker on a card: moves the lead to another stage in HighLevel.
- Dragging a card: also moves the lead in HighLevel.
- The refresh button: reads the board again.

How to:
- Move a lead: drag its card to the new stage, or pick the stage from "Move to…".
- Find the leads closest to signing: open "Hot list".
- Check a signed client: open the Closed column and read the card.

## Intelligence (address /intelligence)

What it shows:
Intelligence answers what prospects keep saying, from the notes of recorded sales calls. It ranks objections, questions, problems and expectations, with the answer that worked and content ideas for marketing. The window is "Last 7 days" or "Last 30 days". The cards are "Objections", "Questions they ask", "Problems that bring them", "What they expect from us" and "For marketing".

How to:
- Prepare for calls: open "Last 30 days" and read the objections and the answers that worked.
- Brief marketing: open "For marketing" and pick an idea from the list.

## Proposals (address /proposals)

What it shows:
Proposals lists the proposals in flight. "Waiting on you" holds the ones that need figures, a send, or a new draft. "Everything else" holds the rest. Opening a proposal opens its page at /proposal/:id, where the closer fills any blanks, reads the document, downloads the PDF and marks it sent.

Buttons and actions:
- "Draft proposal" on the lead's page: asks the writer for a proposal.
- "Stop drafting": cancels a draft that has not started.
- "Save and rebuild": saves the figures that replace a blank and rebuilds the document.
- "Full screen" and "Close full screen": show the document large.
- "Mark sent": records that the proposal went to the client.

How to:
- Make a proposal: open the lead after the demo, pick the language, the payment and the guarantee, then press "Draft proposal".
- Send a proposal: open it when it is "Ready to send", fill any blank, press "Save and rebuild", then download the PDF and press "Mark sent".

## Contracts (address /contracts)

What it shows:
Contracts lists every client contract in HighLevel. "Waiting for a signature" holds the ones sent in the last 60 days. "Drafts not sent" holds the drafts from the last 30 days. "Signed in the last 30 days" holds the signed ones. Each row shows the lead, how the contract was made and the trail from draft to signed. A manager also sees "Templates the team can use".

Buttons and actions:
- "Choose the templates": reads the HighLevel templates for a manager.
- "Save the templates": saves the templates the team may use.
- "Staff contract": marks a template as a staff contract, which never shows on a client.
- "Payment structure" and "Daily ad spend": choose what the template prints.
- "Create the draft": makes the draft in HighLevel.
- "Send by email", "Send as a link", "Send by email and WhatsApp" and "Send on WhatsApp only": send the contract.
- "Not yet": closes the send question.
- "Copy the link" and "Put it in WhatsApp": share a sent contract.

How to:
- Make a contract: open the lead, open "Contract", pick the template, fill the company and the terms, then press "Create the draft".
- Send a contract: press "Send by email" or "Send as a link", read the question, then confirm.

## Invoices (address /invoices)

What it shows:
Invoices makes the deposit and payment invoices the same way the client success cockpit does. A closer picks the client, the type and the amount, and sees the page the client gets as it is typed. The invoice is numbered, filed in the client's Drive folder and given an Ecom or Whop link. The list below shows the invoices the person may see, with their status and payment state.

Buttons and actions:
- "Invoice type": "Pay online", "Paid" or "Card on file".
- The payment link choices: "Ecom link", "Whop link" or "Paste a link".
- "Amount (USD)" and "Description": the amount and what it is for.
- "Due date": the day the payment is due.
- "More on the invoice": opens the location, the tax number, the period and the note.
- "Make the invoice": checks the form, then asks "Make this invoice?".
- "PDF", "PDF link" and "Payment link": open or copy what the client needs.
- "Use a Whop link instead" and "Same invoice with Whop": make the same invoice with a Whop link.
- "Try again" and "Cancel": retry or cancel an invoice that failed.
- "Read again": reads the list again.

How to:
- Make a deposit invoice: pick the client, keep "Pay online", choose "Ecom link", type the amount and the description, set the due date, then press "Make the invoice".
- Send the invoice: when it is "Ready", copy the "Payment link" and the "PDF link" into the client's message.

## Numbers (address /numbers)

What it shows:
Numbers shows the scorecard for a window, the Maqsam dials beside it, the pace against goals, the pay estimate and the team board. A rep sees their own numbers. A manager can choose "Team total" or one person in "Whose numbers". The windows are "Today", "This week", "This month", "Last month", "Last 30 days" and "Last 90 days".

Buttons and actions:
- The window buttons: change the period.
- "Whose numbers" for a manager: picks the team or one rep.
- The intros and demos tiles: show the calls in the window.
- The dials card: shows connected calls, talk time and the gap between calls.
- The goals card: shows the pace against each goal.
- The pay card: shows the estimate from the deposits on the New Client Form.

How to:
- Check the week: open "This week" and read the calls, the shows, the closes and the deposits.
- Check one rep as a manager: pick the rep in "Whose numbers".

## Goals (address /goals)

What it shows:
Goals shows the month by rep: the goal, the pace, the forecast, the actual and the verdict. Managers can choose "The whole team" or one rep in "Whose goals" and can move between months. A rep can set their own forecast. The goals themselves are set by a manager. "The months before" lists the months behind the current one.

Buttons and actions:
- "Whose goals" for a manager: picks the team or one rep.
- The month arrows: move to the month before or after.
- "Goal" and "Forecast": the two number boxes on each line. A goal saves for a manager; a forecast saves for the rep or a manager.
- The copy button under the card: copies the goals from the month before when the month has none.

How to:
- Set a goal: a manager opens the rep, types the number in "Goal", then presses Enter or leaves the box.
- Set a forecast: the rep types the number in "Forecast" on their own line.

## End of day (address /eod)

What it shows:
End of day is the day's report, filed in the cockpit instead of the form. It goes to the EOD Reports sheet and to #eods-salesreps. The page shows the day's calls and ratings, then "Today's numbers" with what the cockpit counted beside each question, then "In words". A person with both roles can switch "Which end of day" between "Setter" and "Closer". The day picker offers the last seven working days.

Buttons and actions:
- "Use" beside a counted number: puts the cockpit's count in the box.
- "Send my end of day": files the report.
- "Post again": sends a filed report again when Slack or the sheet refused it.

How to:
- Write the EOD: open "End of day", check "Today's numbers", correct any number, write the words, then press "Send my end of day".
- Fix a refused report: read the reason, then press "Post again".

## Follow-ups (address /followups)

What it shows:
Follow-ups holds the drafts the follow-up agent wrote for leads. "Waiting" shows the drafts hottest first. "Sent" shows the last 30 days. "How it works" explains the agent. "WhatsApp library" holds the templates. A manager can switch between "The whole team" and "Mine". Each card shows the lead, the kind, the channel, the reason and the draft. The kinds are "They wrote", "Confirm the call", "Missed their call", "Cancelled", "New lead", "Good intro, no demo", "After the demo" and "Long-term".

Buttons and actions:
- "Approve and send": sends the draft as written.
- "Send my version": sends the draft after the rep changes it.
- "Send on WhatsApp": sends the draft on WhatsApp when the lead's window is open.
- "Skip": opens the skip reasons, such as "Already handled" and "Too soon".
- "What it used": shows the lead details and the calls the draft was written from.
- The tabs "Waiting", "Sent", "How it works" and "WhatsApp library": switch the view.

How to:
- Send a follow-up: open "Waiting", read the draft, change it if needed, then press "Approve and send" or "Send my version".
- Drop a draft: press "Skip" and pick a reason.

## Recordings (address /recordings)

What it shows:
Recordings lists every recorded sales call, video and phone, newest first. The tabs are the calls, the reviews and the coach's own reviews. The calls list filters by "Everyone's calls", "Video and phone", "Video calls" and "Phone calls". A row shows the day, the length, the lead and the review grade when there is one. Opening a call opens its page at /recording/:id with the review, the summary, the action items and the transcript.

Buttons and actions:
- "Show hidden recordings": shows the second recording of a meeting and the phone calls whose transcript is only the network message.
- "Newer" and "Older": page through the calls.
- "Add a review": adds the coach's own review, for a manager.
- "Watch in Fathom": opens the video call in Fathom.
- "Show the transcript": reads the transcript and searches it.
- The review button on a call: asks the reviewer to review that call.

How to:
- Review a call: open it from the list, read the review and the transcript, then add your own review if you are a manager.
- Find a call: search by the call's title, or pick the rep and the call type.

## Links (address /links)

What it shows:
Links holds the kit a rep opens on a call: the deck, the forms, the calculators, the proof and the scripts. Each link opens in a new tab. The page also holds "Sales assets: proof to send", "Reference calls asked for" for a manager, and "Client references". A manager can add, edit and hide links; a hidden link can come back.

Buttons and actions:
- "Add a link" and "Add link": add a link.
- "Edit" and "Hide": change or hide a link.
- "Hidden links" and "Show": bring a hidden link back.
- "Save link": saves a changed link.
- "Deck", "Forms", "Calculators", "Proof", "Library", "Scripts" and "Other": the groups.
- "the simple SOP" and "Raise a ticket": open the guides.

How to:
- Add a link: a manager presses "Add a link", fills the name, the address, the kind and the note, then presses "Add link".
- Hide a link: press "Hide" on its row, then open "Hidden links" to bring it back.

## The pitch deck (address /deck)

What it shows:
The deck is the sales presentation, in English or Arabic, with the prospect's own numbers from the call. It opens from a demo with the lead in the address. The arrow keys or a clicker move between slides. F goes full screen, L changes the language, O shows all slides, Q opens the questions and G shows the guarantee on the investment slide.

Buttons and actions:
- "Present the deck" on the demo script: opens the deck for that lead.
- The slide controls: move, change language, show the questions, show all slides and close.
- The budget calculator: types a budget and shows the plan.

How to:
- Present a demo: open the demo script, press "Present the deck", then move through the slides.
- Send the deck ahead: copy the address with the lead in it and the language you want.

## Team meetings, Ask a team and Client performance

These three are links to the portal, at the foot of the left menu.

- "Team meetings": the team's meetings, their agendas and the shared notes.
- "Ask a team": asks another team for something. The request becomes a ClickUp task with its steps and an owner.
- "Client performance": every active client against its targets, with the whole board and one client.

## The team page (address /team)

What it shows:
The team page is for a sales manager. It lists every seat with what it is linked to, each person's pay rule and goals, and the health of the copy from B2B and the sales desk. Seats are made on the portal's admin page, not here.

Buttons and actions:
- "Send marks to HighLevel": switches whether a mark on a recent call goes to HighLevel.
- The backlog days box: sets how old a call may be before its mark goes to HighLevel without its automations.
- "Save": saves the backlog days.
- "Mark them on the Calendar": opens the unmarked calls.

How to:
- Check a seat: open the person's card and read the links, the goals and the pay rule.
- Check the desk: read "Copy from B2B", "The sales desk" and "Health".

## How to use this cockpit

"How to use this cockpit" at the foot of the left menu opens the sales SOP in a new tab. It holds the day step by step, the in-depth guide and the ticket guide.

## The chat assistant

The round button at the bottom right opens the chat assistant, Ace. Type a question and send it. Ace answers how-to questions from this guide. It also reads the page you are on and the data that page holds, such as the lead, the call, the proposal or the day's numbers. It can read a file you attach. It cannot send a message, change a record, move a card or send a proposal.

Now and then a small bubble above the chat button suggests one question for the page you are on: click it to ask that question, or press the X to hide it. It shows at most once per page a day, and two dismissals in a row hide it for a week.

Ask Ace where a page or a button is, what a page shows, or how a task is done. For anything that needs a change, Ace points to the place in the cockpit and the person does it.

## Common tasks

Log a call outcome:
1. Open Today, or the lead's page.
2. Find the call under "Mark these calls" or in the Calls card.
3. Press "Showed", "Didn't happen" or "Disqualify".
4. If you pressed the wrong mark, press "Undo" inside the five seconds.
5. When the call is held, rate the lead under "Rate these leads".

Mark a no-show:
1. Find the call.
2. Press "Didn't happen".
3. If the lead cancelled instead, press "They cancelled instead" inside the five seconds.
4. Book the next call if the lead wants one.

Book or move a call:
1. Open the lead.
2. Press "Intro", "Demo" or "Follow-up call" to book, or "Reschedule" to move.
3. Pick the day, the time and the host.
4. Save.

Send a follow-up:
1. Open "Follow-ups".
2. Read the draft under "Waiting".
3. Change the words if they need it.
4. Press "Approve and send", or "Send my version" after a change.
5. If the draft is wrong, press "Skip" and pick a reason.

Make and send a proposal:
1. Open the lead after the demo.
2. In "Proposal", pick the language, the payment and the guarantee.
3. Press "Draft proposal".
4. When it is "Ready to send", open it.
5. Fill any blank and press "Save and rebuild".
6. Download the PDF and press "Mark sent".

Send a contract:
1. Open the lead and open "Contract".
2. Pick the template, the company and the terms.
3. Press "Create the draft".
4. Press "Send by email" or "Send as a link".
5. Read the question and confirm.

Write the end of day:
1. Open "End of day".
2. Check "Today's numbers" and correct anything the cockpit counted differently.
3. Write "In words".
4. Press "Send my end of day".
5. Read "Filed" and the two status chips.

Set goals:
1. A manager opens "Goals".
2. Pick the rep in "Whose goals".
3. Type the number in "Goal" and press Enter.
4. A rep types their own number in "Forecast".

## Who to ask for what

- A manager: a seat, a goal, a template, a mark setting, or a call that looks wrong.
- The portal admin: a new seat, the link to a HighLevel user, or a missing role.
- The sales desk: a proposal that stays in draft, a follow-up that does not arrive, or a recording that is missing.
- The admin: a page that will not open, a search that finds nothing, or a fault on the screen.
