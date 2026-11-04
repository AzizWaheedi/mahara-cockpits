# Media buyer cockpit: how it works

Written from the code on main, 2026-11-04.

## Who uses it

Media buyers use this cockpit to run the clients' Meta ads, day by day.
The CEO also opens it, and a few screens appear only for the CEO or for admins.

## Today (address /dashboard)

What it shows:
Today is the working day in the order it should be done. It starts with the clients whose numbers broke, then your own open tasks, the morning checklist, new client launches, the messages clients should hear, the review queue and the accounts to work. The rest of the day sits folded under "More from today: meetings, what you planned, change log, the numbers". The header shows the date and when the numbers were last synced.

Buttons and actions:
- "End of day": opens the end of day report for today.
- The client picker in the header: pick a client to open that client's page in Ads.
- "Report a problem": opens a small box for a question or a fault on the screen. "Send" files the note and the reply comes back in Slack.
- Each numbered circle in the morning checklist: ticks that step done, or unticks it. "Open it" jumps to the part of Today that the step needs.
- "See all": opens the full list of your open tasks. Each task row opens that task in place.
- "Review": opens the campaign in Ads, ready for a decision.
- "Copy": copies the drafted message for the client.
- "I sent it, log it": records that you sent the message and takes that client off today's list.
- "Show" and "Hide" in the payments strip: open or fold the list of clients with a payment problem.
- "Remove from today" in the change log: takes that decision off today's log.
- "Open in Launch", "Checklist" and "Do it with me" on a new client launch: open the client in Clients, open the launch steps, or start a guided build.
- "Take it as far as you can": sends the launch brief to the assistant and shows the steps it finished.
- "Connect your Google Calendar": links your calendar so today's meetings appear. "Disconnect" removes the link.

How to:
- Start the day: tick the morning checklist from the top down, then press "See all" to work your tasks.
- Review a campaign that is due: in the review queue, press "Review", read the numbers, then choose an action in the panel.
- Tell a client what changed: in Proactive touchpoints, read the draft, press "Copy", send it in WhatsApp, then press "I sent it, log it".
- Open one client: use the client picker in the header.
- Finish the day: press "End of day".

## Ads (address /ads)

What it shows:
The board lists every campaign grouped by client, with spend, leads, cost per lead, bookings, cost per booking, budget and the call. Above the board are five number tiles, the lead sync warning, the tracking backlog and the middle of the day sweep. The range picker sets the window that the numbers and most filters use. Opening a client shows that client's own page in place of the board.

A campaign that started spending today or yesterday, and that the morning sync has not listed yet, still shows on the "Running" board under its client, on the "Everything" filter. A grey line under its name says "Started today", or "Started" with the first day, such as Started 4 Nov. Its row shows spend, leads and cost per lead since it started, from Meta's hourly read. Bookings, cost per booking and budget read n/a, and the call reads "Too early to call". Its row does not open a panel. It gets its 7-day numbers and a call once the sync lists it.

Buttons and actions:
- "How ads are judged": opens a small table that explains how cost per lead and cost per booking produce the call.
- "Running", "Nothing running" and "Off the board": switch which campaigns the board lists.
- The range picker: picks a preset window or a custom set of days.
- "Everything", "Critical" and "Below KPI": filter the board to one problem at a time. "Payment problem" appears too when a client's ad account has a payment warning.
- "More filters": shows the other filters, such as "Fatiguing", "Under the floor", "No bookings", "Not touched in 4+ days" and "Undecided today". "Fewer filters" hides them again.
- A campaign name or a table row: opens that campaign's panel below the row. The "What to do" button on the row does the same, and reads "Close" while the panel is open.
- The small on and off switch beside a campaign, ad set or ad: turns it off or on in Meta, then writes the change to the change log.
- "Open in Ads Manager": opens the same campaign in Meta's own tool.
- "ClickUp task": opens the campaign's card in ClickUp.
- The Ad Status picker: sets the card's status on the Ads Management board, and reads "No status" when the card has none yet.
- "Rename the card now": renames the ClickUp card to the campaign's current name.
- "Card declined form": opens the payment form and files the case to client success.
- "What to do" and "Changes and results": switch the two halves of the campaign panel.
- The two decision buttons at the top of "What to do": take the recommended action. The first one changes Meta straight away when the action can be done there, otherwise it is only logged.
- "Leave it": opens the reasons and the time to wait before the campaign comes back to the review queue. "Leave it" in that form saves the choice.
- "Send to another team": opens the request choices. Pick what needs to happen, add a note, then press the send button that names the team.
- "Make changes": opens four tools. "Test new copy", "Add a creative", "Add an ad set" and "Change a budget" each open their own form, and everything they create arrives paused.
- "Write me options": asks the assistant for draft copy. "Create the ads (paused)" makes the ads in Meta.
- "Create the ad set (paused)": copies a working ad set, paused.
- "Set" beside an ad set budget: changes that budget in Meta.
- "Get it from Drive": fetches a creative file into the ad account. "Use this" picks one of the fetched files. "Add it, paused" makes the ad.
- "Build a campaign": opens the builder. "Build it" asks for the draft and shows the copy to review, then "Launch it paused" creates the campaign in Meta, paused.
- "Send" in "Conversation and history": sends your question about the campaign to the CEO on Slack.
- "New creative": opens the creative request. Pick a reason, add a note, then press "Send to creative director".
- "Save as winner": saves an ad to What works with a note. "Add a note" edits that note later.
- "Add change" in "Changes and results": records a change that Meta's own log missed.
- "Calls for this client": opens the Calls part of the client's page.
- "The Ads Management board" on the "Off the board" tab: opens every card, old and paused. "Not live", "Live" and "All" filter it, and the box "Find a campaign or client" searches it.
- "Add to ClickUp": makes a board card for a campaign that spends with no card. "Not our campaign": removes that campaign from the list for good.
- "Show" and "Hide" in the tracking backlog: open or fold the list of ads with a missing tracking link or lead form.
- "Open" beside a client that spent in the range with no campaign running: opens that client's page.
- "Show the other" on the client page's ad wall: shows the remaining ads.
- "All accounts": goes back from one client's page to the whole board.

How to:
- Open a campaign and decide: press the campaign name or "What to do", read the reason and the numbers, then press the first decision button.
- Turn a campaign off: press its on and off switch, or use the same switch inside the panel.
- Ask for new creative: open the campaign, press "New creative", pick the reason, then press "Send to creative director".
- Change a budget: open the campaign, press "Change a budget", type the new amount, then press "Set".
- Open one client's full page: press the client's name above the campaign rows, or pick the client from Today.
- Move to another client's page from there: use "All accounts" first.

## Clients (address /clients)

What it shows:
The client book lists every client with its status, its ad accounts and the next step. Filters split the book into all clients, the ones that need attention, the ones in Ads, the ones still onboarding and the inactive ones. Opening a client shows its ad account, its launch brief, its history and the tabs for its next move.

Buttons and actions:
- "Find a client or account": searches the book by name, ID or ad account. "Clear" empties the search.
- "All clients", "Needs attention", "In Ads", "Onboarding" and "Inactive": filter the book.
- "Refresh": reads the client board again.
- "Open client": opens that client's page.
- "Open Ads": goes to the Ads board.
- "Overview", "Launch & relaunch", "Tasks", "Activity" and "Pause & offboard": switch the parts of a client's page.
- "Client card": opens the client's card in ClickUp. "View in Ads": opens the client on the Ads board.
- "Launch or relaunch": moves to the launch tab for that client.
- "Check again": reads the ad account's health and campaign ownership from Meta again.
- The launch choices "Switch back on", "Copy a past campaign", "Rebuild on a clean account" and "New from the brief": pick how the next campaign is made.
- "Preview the plan": builds a plan without changing anything.
- "Check with Meta": asks Meta whether the plan would be accepted.
- The main launch button: reads "Preview the plan" before a plan exists, then becomes the switch on or create action for the chosen route.
- "Dismiss paused build": clears a paused build from the launch history. Nothing is deleted in Meta.

How to:
- Find a client: type in the search box, or press one of the filters.
- Launch a campaign for a client: open the client, press "Launch or relaunch", pick a route, set the campaign daily budget, then press "Preview the plan" and review the steps. The kickoff budget covers all of the client's ads; the campaign limit checks this campaign only. Check the combined daily budget across the client's accounts and platforms before switching on. The switched-on list covers only the selected account and may omit some budgets.
- Check an old launch: open the client's "Activity" tab and read "Campaign and creative log".

## Library (address /playbook)

What it shows:
Library holds three tabs: "What works", "Ideation" and "Swipe file". "What works" shows which ad sets and creative patterns return cheap leads, and which ads are worth copying. "Ideation" collects posts and ideas from other accounts. "Swipe file" shows the ads the team saved from Foreplay, longest running first.

Buttons and actions:
- "What works", "Ideation" and "Swipe file": switch the three tabs.
- The service line and city boxes: filter the proven plays.
- "All", "Saved by the team" and "Found by the weekly check": filter the winning ads. The person box beside them filters by who saved an ad.
- "Read it" on a winning ad: opens its hook, its copy and, for video, what is said and shown.
- "Add ideas": opens the ways to add a post, scrape a page, use the watchlist or open Foreplay.
- "Add a post": paste a link and press "Fetch and save" to queue it for reading.
- "Saved ideas", "Proposed by the scan", "Trends", "Fetching", "Failed" and "Dismissed": switch the idea lists.
- "Keep it": saves a proposed idea. "Dismiss": drops it. "Restore": brings a dismissed idea back. "Try again": retries a failed fetch.
- "Watchlist": adds an account, a hashtag or a keyword to watch.
- "On air 60+ days": shows only the swipe ads that have run for two months or more.

How to:
- Copy a winning play: open "What works", pick the service line, then read the play's cost per lead and city.
- Save an ad for the team: on the Ads board or a client's page, press "Save as winner" and write why it works.
- Add an idea: open "Ideation", open "Add ideas", paste the link, then press "Fetch and save".

## Pages you reach from other pages

- /eod: the end of day report. You reach it with "End of day" at the top of Today.
- /ideation: the Ideation tab of Library. You reach it from the Library tabs.
- /swipe: the Swipe file tab of Library. You reach it from the Library tabs.
- /launch: an old address. It now opens the Clients page.
- /tasks: an old address. It now opens the tasks part of Today.
- /touchpoints: an old address. It now opens the touchpoints part of Today.
- /template: an old starter address. It now opens Today.
- /csm: an old address. It now opens the client success cockpit.
- /go: the address that opens another cockpit. The switch links in the menu use it, for example /go/csm.
- /settings: your account page. You reach it from your name at the bottom of the left menu.
- /requests/settings: the request settings. You reach it from the "Settings" link on the Requests page.
- /team/:id: one meeting's page. You reach it by opening a meeting in Team meetings.
- /admin: the admin page, for admins only. You reach it from "Admin" in the menu.
- /data: the leads and appointments view, for admins only. You reach it from "Data" in the menu or from the admin page.
- /ceo: the CEO cockpit, for the CEO seat only. You reach it from "CEO" in the menu.

## While a page loads

- When a page or section first loads, placeholder blocks show its layout. The blocks are not data and hold no numbers.
- On a refresh in the background, data you already saw stays on screen. This applies to pages whose data hook keeps the last data.
- Save, upload and send actions show progress while they run. Wait for the result before you act on it.

## Everywhere in the cockpit

- Ask a team (address /requests): the page where you ask another team for something. The request becomes a ClickUp task with its steps and an owner. The tabs "Ask a team", "My requests", "Assigned to me", "Team queue" and "All requests" show the form and the lists. The page's own "Settings" link opens the request types, the people and the alerts.
- Team meetings (address /team): every meeting the team holds, with its week view and its agenda. "New meeting" starts one, and "Yours" and "Everyone's" filter the list. Opening a meeting shows its page, where you can edit it, tick agenda items and write the notes.
- Client performance (address /performance): every active client against its targets. "Edit targets" changes the targets for the whole board or one client. "Columns" chooses the columns, and "Meeting view" makes the board easier to read in a meeting. "Add a lever" files the next task for a client, and "Preview the task" then "File the task" sends it.
- The chat button at the bottom right: opens the Signal chat. Type a question and press the send arrow, or press "New chat" to start again. The answers arrive in the panel, and the page you are on is sent with the question.
- Search: the box at the top of the left menu opens the search. It also opens with Ctrl K on Windows or Cmd K on a Mac, and with the slash key on most pages. It finds a client, a campaign and every page your seat can open.
- "How to use this cockpit" at the bottom of the left menu, for media buyer seats: opens a window with the demo video and four links. "The simple SOP" is the day step by step with a picture of every step. "The in-depth SOP" covers every screen. "The written SOP, in ClickUp" is the same day in ten steps. "Raise a ticket (the SOP for every team)" explains how to ask another team and how to work the tickets assigned to you.
- Your name at the bottom of the left menu: opens the account menu with "Settings", "Dark mode" or "Light mode", and "Sign out".
