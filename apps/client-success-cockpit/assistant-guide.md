# Client success cockpit: how it works

Written from the code on main, 2026-11-04.

## Who uses it

Client success managers use it to look after each client's relationship, onboarding, calls, meetings and billing.
The CEO also opens it to review client health, money and churn.

## Today (address /dashboard)

What it shows:
The working day for your own clients, in Kuwait time, with the last sync time.
Three tiles count who needs you today, new signups and invoices past due, and a fold holds the other totals.
Below them sit the day's alert bands, your calls, the clients who need a message or a call, commitments from calls, tickets, loose ends, the Client Success board and the day plan.
A fold at the bottom holds the week's calendar and the data fixes.

Buttons and actions:
- "End of day": opens the end of day page.
- "File my end of day": opens the end of day page from the reminder at the bottom.
- "Show the other": reveals the remaining rows in a short list. "Show fewer" hides them again.
- "Clear these (money stays)": clears the loose ends that are not about money and keeps the money ones.
- "Open the client": opens that client's page.
- "ClickUp card": opens the client's ClickUp card in a new tab.
- "Write 1-1 notes": opens the notes window for that client's last call.
- "Review messages": opens the daily ad billing review page.
- "Confirm churn", "Not leaving", "Pause this client", "Resume this client", "Give more time", "Client is leaving", "Open the review ticket" and "Open the receipt check": act on a notice, review or payment check in the bands. These show only when the related form is switched on for your seat.
- The create button on a promise from a call creates it on the Client Success board. "All done already" closes the promise as done.

How to:
- Start the day: read the first line, then work the first client in the list.
- Help a client who needs you: 1. Click the client row. 2. On their page press "Message" or "Log a call". 3. Finish the panel that opens.
- See the rest of the numbers: 1. Open the fold "The rest of the numbers".
- File your end of day: 1. Press "End of day" at the top. 2. Fill the form. 3. Press "File my EOD".

## Inbox (address /inbox)

What it shows:
The client WhatsApp conversations that are waiting on a reply, each with a reply already drafted.
The last few messages sit above the draft so you can judge it without opening WhatsApp.
A fold holds quiet clients and every thread's history, and another fold holds the form for sending a video cut for review.

Buttons and actions:
- "Send": sends the drafted reply to that WhatsApp conversation.
- "Archive": removes a thread from the waiting list without sending anything.
- "العربية" and "English": switch the draft language. An edited draft is never replaced by the switch.
- "Other conversations": opens the folded list of team chats, other groups and people who are not clients.
- "Send a form": opens the form panel for the conversation when that feature is on.
- "Show less" and "Read all": expand or shorten a long quoted message.

How to:
- Reply to a client: 1. Read the draft in the waiting thread. 2. Edit it if needed. 3. Press "Send".
- Clear a thread that needs no reply: press "Archive".
- Find a client's own thread: open the client from Clients, or press Ctrl K and type the name.

## Clients (address /clients)

What it shows:
Every client you look after, one row each, with a colour dot, the name, the stage and the next step.
The row also shows the last message, the last call, the next call and the report clock.
Four view buttons filter the list, and a search box finds a client by name.
The Results view swaps the rows for a performance table with each client's leads, bookings, attendance, closes and ads.

Buttons and actions:
- "All", "Onboarding", "Live" and "Results": change the view. Each button shows its count.
- "Find a client…": filters the list as you type.
- "Practice a call": opens the practice client. It is only on the full Clients page, not inside Money or another tab.
- "Open": opens a client from the Results table with the period you picked.
- A client row opens that client's page at /clients/:key.

On the client's own page:
- "All clients": goes back to the list.
- "Present": opens the client's next deck in its own window. The menu beside it opens the other deck or a preparation view.
- "Write 1-1 notes": opens the notes window for the last call.
- "Make a proposal": opens a menu of offers to start a new proposal.
- "Book a call": opens the booking dialog. It books the call in GoHighLevel at a free time.
- "Message": opens the message templates. You copy a message or log that you sent it.
- "Log a call": opens the call panel with a note box, "Write 1-1 notes", "Log the call without notes", "Log a message" and "Book the next touchpoint".
- "Update the board": changes the client's stage, service model or happiness on the ClickUp card.
- "Add a task": opens the request form for another team, a reminder for you, and a task for the client's portal.
- "Ask for a review or referral": opens the ask panel.
- "Leave it": records a reason and hides the client for a chosen time.
- "Send a form": opens the form panel when the feature is on.
- "Give more time", "Pause this client", "Resume this client" and "Client is leaving": open the matching form and update the client's card.
- "Log a win": records a review, referral or upsell.
- "Overview", "Results", "Ads", "Onboarding & files" and "Money": the client page's five tabs.
- "Open billing" and "Plan the renewal": jump to the matching Money tab for this client.

How to:
- Find one client: 1. Open Clients. 2. Type the name in "Find a client…". 3. Click the row.
- Log a call: 1. Open the client. 2. Press "Log a call". 3. Type the summary. 4. Press "Log the call without notes" or "Write 1-1 notes".
- Send a message: 1. Press "Message". 2. Pick the template and language. 3. Press "Copy the message". 4. Send it in WhatsApp yourself.
- Book the next call: 1. Press "Book a call". 2. Pick the call type and day. 3. Pick a free time. 4. Confirm.
- Ask another team for work: 1. Open the client. 2. Press "Add a task". 3. Fill the request form. 4. Send it.
- Change a plan: 1. Press "Give more time", "Pause this client" or "Client is leaving". 2. Check the prefilled form. 3. Send it.

## Money (address /money)

What it shows:
Eight tabs in one place: Billing, Hot list, Projections, Churn, My money, Invoices, Offers and Wins.
Billing shows who pays next, how they pay and what the billing rules say to do.
Hot list shows your own follow-up list plus suggestions from live client data.
Projections shows the week's targets, the renewal window, the history and a library of recorded calls.
Churn shows the month's churn figure, the register of departures and the rules.
My money shows your target, your base, retention and commission, and the four Rs.
Invoices makes a client invoice and shows the page the client receives. Pay online invoices get an Ecom link, or a Whop or Tap link as a backup when Ecom does not work for the client.
Offers holds pitch decks, the price list, offer videos and the pitch log.
Wins holds your logged wins and the button to add one.

Buttons and actions:
- "Billing", "Hot list", "Projections", "Churn", "My money", "Invoices", "Offers" and "Wins": switch tab. The address keeps the tab.
- "Save": saves a changed billing account row.
- "Confirm paid": confirms a signed client's payment and sends it to the billing inbox.
- "Read billing again": reads the latest payments into Projections.
- "Save": saves a projection number or a written reason.
- "Log a departure": opens the form for a client who left.
- "Save my plan": saves your target, your qualifying client count and your four Rs numbers.
- "Add a row": adds a blank row to your hot list.
- "Add to my list": takes a suggested opportunity into your hot list.
- "Issue invoice": issues the invoice number and sends it to the invoice worker.
- "Ecom link (KWD)", "Whop link (USD)", "Tap link (KWD)" and "Paste a link": the Pay online link. Tap asks for the "Client email", which Tap shows on its payment page. Tap sends the client nothing.
- "Confirm paid", "Copy PDF link" and "Copy payment link": act on an invoice after it is issued.
- "Same invoice with Ecom", "Same invoice with Whop" and "Same invoice with Tap": fill the form with the same invoice and another link, when the client cannot pay the one they have.
- "Use an Ecom link instead", "Use a Whop link instead" and "Use a Tap link instead": send a failed invoice out with another link, while no link was made for it.
- "Log a win": records a review, referral, upsell or renewal.

How to:
- Log a payment: 1. Open Money. 2. Stay on "Billing". 3. Open the client row. 4. Fill the payment. 5. Save.
- Plan a renewal: 1. Open the "Projections" tab. 2. Find the client in the renewal window. 3. Write the reason or book the call.
- Record a client who left: 1. Open the "Churn" tab. 2. Press "Log a departure". 3. Fill the form. 4. Save.
- Make an invoice: 1. Open the "Invoices" tab. 2. Pick the client. 3. Fill the form. 4. Press "Issue invoice".

## Links (address /links)

What it shows:
Every link a client success manager needs in a day, grouped by job.
The groups cover how the cockpit works, logging money and client changes, booking links, call SOPs, forms to send to clients, communication and content, the four Rs, changing a client's plan, and boards and trackers.
Some rows play a short how-to video in place.

Buttons and actions:
- "Copy": copies that link so you can paste it in a message or a browser.
- A video row: plays the walkthrough video in the page.
- A link row: opens the document, board or booking page in a new tab.

How to:
- Send a booking link: 1. Open "Booking links". 2. Press "Copy" on the right call. 3. Paste it to the client.
- Learn a call: 1. Open "Call SOPs, the framework and the video, per call". 2. Pick the call. 3. Read the SOP or watch its video.
- Find a tracker: 1. Open "Boards and trackers". 2. Click the board or sheet you need.

## Pages you reach from other pages

- /clients/:key: one client's page. Open it from a Clients row or from the search box.
- /clients/:key/research: the client's market research. Open "Open research" from "Market research" on the client's Onboarding tab. A completed run shows competitor candidates and links to the available report. Missing values say "Not checked". The CEO or an admin can use "Run research again" or mark a candidate "Not a competitor"; the server checks access. Research can be off or still in progress.
- /clients/:key/proposals/:id: a proposal for one client. Open it from "Make a proposal" or the proposals card on the client's Money tab.
- /clients/:key/present/offer/:offer: an offer deck. Open it from the Offers tab or the proposal flow.
- /clients/:key/present/:deck: an onboarding, launch or Blueprint deck. Open it from "Present".
- /clients/:key/forms/:form: a client form in its own window. Open it from "Write 1-1 notes", "Send a form" or the kickoff button.
- /practice: the practice client. Open it from "Practice a call" on Clients.
- /practice/present/:deck: a practice deck. Open it from the practice client.
- /eod: the end of day form. Open it from "End of day" on Today or from "File my end of day".
- /backlog: the data fixes list. Open the fold "Calendar and data fixes" on Today.
- /settings: your account, theme, Slack notices and the client forms link. Open it from the account menu at the foot of the side rail.
- /invoices: the invoice desk without the side rail. A sales seat opens it from the sales cockpit. A client success manager uses the Invoices tab under Money instead.
- /ad-billing: the daily ad billing review. Open it from "Review messages" on Today. Only a client success or media buyer seat may open it.
- /notices: the notices and routing page. Open it from the notices area in Settings. Any signed-in seat may open it, and the page itself decides what it shows.
- /forms-editor: the forms editor. Open it from "Open the forms editor" in Settings. Only an admin or the CEO may edit there.
- /forms-editor/:key: one form in the forms editor, opened from the same page.
- /tasks: an old address. It sends you to Today.
- /meetings: an old address. It sends you to Inbox.
- /performance: an old address. It sends you to the Results view of Clients.
- /billing: an old address. It sends you to the Billing tab of Money.
- /projections: an old address. It sends you to the Projections tab of Money.
- /churn: an old address. It sends you to the Churn tab of Money.
- /hotlist: an old address. It sends you to the Hot list tab of Money.

## While a page loads

- When a page or section first loads, placeholder blocks show its layout. The blocks are not data and hold no numbers.
- On a refresh in the background, data you already saw stays on screen. This applies to pages whose data hook keeps the last data.
- Save, upload and send actions show progress while they run. Wait for the result before you act on it.

## Everywhere in the cockpit

- The side rail: Today, Inbox, Clients, Money and Links sit at the top. The bottom group holds "How to use this cockpit", "Team meetings", "Ask a team" and "Client performance", then the doors to other cockpits.
- "How to use this cockpit": opens this cockpit's SOP in a new tab.
- "Team meetings": opens the portal's team meetings page.
- "Ask a team": opens the portal's requests page, where you ask another team for work.
- "Client performance": opens the portal's client performance page.
- "Admin" and "Data": admin doors in the side rail. Only an admin sees them.
- "Media buyer", "Creative director", "Editor desk" and "Sales": doors to the other cockpits. Each shows only to a seat that has that role or to an admin.
- The chat button at the bottom right is "Anchor", the client success assistant. It opens a chat panel. "New chat" clears the thread. "Copy answer" copies a reply. "Helpful" and "Not helpful" rate it. The box at the bottom sends your question, and the answer appears in the panel. On a client's page it answers about that client.
- Now and then a small bubble above the chat button suggests one question for the page you are on: click it to ask that question, or press the X to hide it. It shows at most once per page a day, and two dismissals in a row hide it for a week.
- The search field at the top of the rail says "Search clients, links…". It opens the search box, and Ctrl K does the same from any page.
- The account menu at the foot of the rail holds "Settings", "Dark mode" or "Light mode", "Mahara portal" and "Sign out".
