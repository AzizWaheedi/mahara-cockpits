# Video editor cockpit: how it works

Written from the code on main, 2026-11-04.

## What this desk is for

Video editors use this desk. They cut ads and social videos for Mahara's clients, read the client's brand rules, work through comments, and hand the cut to the client for a decision.

The work starts as a card on the Video Pipeline in ClickUp. The desk reads that board every few minutes and shows each card as a job. A job belongs to an editor, has a due date, and moves through the board's own statuses.

The left rail holds the places. It folds to icons from the button at its top, or with Ctrl B on Windows and Cmd B on a Mac. The portal's door lands on /dashboard, which opens Jobs.

## Jobs (address /)

What it shows:
Jobs is the home page. It lists the work in the order an editor thinks about it, under headings such as "Ready to start", "Waiting on something", "Not read yet", "In review", "On hold", "Finished" and "Off the board". Each row shows the client, the request type, the editor, the due date, the file count and the length. A warning line names the first thing that blocks a job. The page opens with the day in four numbers: "Ready", "Waiting", "Late" and "Due today". It also lists the editor's other open tasks from ClickUp.

Buttons and actions:
- "List" and "Board": show the jobs as a list or as board columns.
- "End of day": opens the day's report.
- "Refresh": reads the board again.
- "Assigned to me": shows only the jobs where the person is an editor.
- "Include finished and removed": shows the jobs that are usually hidden.
- "Report an issue": opens a small box for a fault on the screen. "Send the report" files it.
- A job row: opens that job's page.

How to:
- Find your work: press "Assigned to me", then read "Ready to start" first.
- See the board: press "Board". The board columns are ClickUp's statuses in their order. A green dot means ready to start, and an orange dot means waiting on someone.
- Report a wrong screen: press "Report an issue", write what is wrong, then press "Send the report".

## A job's page (address /job)

What it shows:
The job page is one card from the Video Pipeline. The header shows the client, the request type, the board status, the editor, the due date, the files and the links. The page has five parts: "The cut", "Footage", "Notes", "The brand" and "What to make". "Not ready to start" lists what is missing and offers "Ask for it".

Buttons and actions:
- "All jobs": returns to Jobs.
- "I've started": moves the card to In progress.
- "Needs changes": moves the card to Update required.
- "Report an issue": records a fault on this page.
- "Link to the cut in Drive": the box for the cut's link.
- "Check it first": asks the desk to read the cut and report back.
- "Request internal review": asks the desk to put the cut on the card and send it for internal review.
- "Current cut": opens the cut that is on the job.
- "Open in Frame.io": opens the cut in Frame.io when the job has one.
- "Job card" and "Footage folder": open the card and the Drive folder.
- "Open in Drive": plays a footage file in Drive.
- "Search the transcripts": finds words across the job's footage.
- "Add a note for this job": writes a note in "Notes".
- "Add": saves the note.
- The tick beside a note: marks it "Done".
- "Brand DNA", "Offer cheat sheet" and "Script": fold open the reference text.
- "Add a rule": adds a do or a don't to the client's rules.
- "Put it on the card": sends a request to the ClickUp card.

How to:
- Start a job: open it from Jobs, read "Not ready to start" and "What to make", then press "I've started".
- Read the client's rules: open "The brand" and read "Do's and don'ts".
- Find a line in the footage: type in "Search the transcripts" under "Footage", then press a result to open that file at the second.
- Hand the cut to the desk: paste the link in "Link to the cut in Drive", press "Check it first" when you want a check, then press "Request internal review".

## Footage (address /videos)

What it shows:
Footage is every clip the desk has read, across all jobs, as a wall of frames. Each card shows the client, the file name, the shape, whether there is sound, whether there is speech, and how many shots it has. A clip opens the job it belongs to. A section called "Not read yet" lists the open jobs with no footage and says what fixes each one.

Buttons and actions:
- "Find a clip: a name, or words said in it": searches the file names, the clients and the transcripts.
- "All clients": filters the wall by client.
- "Someone speaks": shows only the clips with speech.
- "Not read yet": folds open the list of jobs with no footage.
- "Show the other": shows the rest of the jobs under one reason.
- A clip card: opens its job page.

How to:
- Find b-roll: type a word in the search box, then open a card.
- Check what a client has: pick the client in "All clients" and read the wall.
- Ask why footage is missing: open "Not read yet" and read the reason under each job.

## Send for review (address /send-review)

What it shows:
Send for review makes one public link for a whole delivery. A client opens the link without an account, watches each cut, and either approves it or asks for a change. The page has "Delivery" for the name, the client and the line for them, "Videos" for the cuts, and "Sent already" for the links already made. Each sent row says how many cuts were decided, how many need a change, when it was made, when it was opened and whether it was revoked.

Buttons and actions:
- "What this delivery is": the name the client sees.
- "Client (required)": the client's name.
- "A line for them": a short note for the client.
- "Upload": puts a video file in the review store and fills its link.
- "Add a thumbnail": shows the box for a thumbnail image.
- "Add another video": adds a second cut to the same link.
- "Remove": takes a cut out of the delivery.
- "Make the link": creates the review link.
- "The link is ready": the box under the button, with "Copy" and "Open it".
- "Copy link": copies an older link again.
- "Revoked": says the link no longer opens.

How to:
- Send a delivery: type the delivery name and the client, add one or more cuts with "Upload" or a pasted link, then press "Make the link".
- Share it: press "Copy" under "The link is ready", then paste it in the client's message.
- Check a delivery: read "Sent already" for the decisions, the changes and the open date.

## The Library (address /winners, /ideas and /swipe)

What it shows:
Library holds three pages with tabs at the top: "What works", "Ideation" and "Swipe file". Each page has its own address, but the tabs stay above all three.

"What works" at /winners lists the ads that already paid, cheapest cost per lead first. Each card shows the client, the service line, the cost per lead, the leads, the spend, the hook, the "Ad copy" and "What is said in it". The client chips filter the list.

"Ideation" at /ideas holds the idea library. The tabs are "Saved ideas", "Proposed by the scan", "Trends", "Fetching", "Failed" and "Dismissed". "Add ideas" opens "Add a post", a scrape box, the watchlist and Foreplay. A saved idea can be read, kept or dismissed.

"Swipe file" at /swipe lists the ads the team saved in Foreplay, longest running first. The board strip filters by board. The "On air 60+ days" chip keeps the ads that have run for two months or more. Each card shows the days on air, the copy and the links.

Buttons and actions:
- "What works", "Ideation" and "Swipe file": switch the three pages.
- "All" and the client chips on "What works": filter the winners.
- "Add ideas": opens the ways to add an idea.
- "Add a post": takes a link for the radar to fetch.
- "Fetch and save": queues the post.
- "Keep it", "Dismiss", "Try again" and "Restore": work an idea.
- "Watchlist": edits the accounts and keywords the radar watches.
- "Scrape": asks the radar to read a page or an ad library.
- "Send to ideation" on a swipe ad: puts the ad on the ideation board.
- "Open in Foreplay" and "Landing page": open the source.

How to:
- Learn from a winning ad: open "What works", pick the client, then read the hook and the copy.
- Add an idea: open "Ideation", press "Add ideas", paste the link, then press "Fetch and save".
- Save a swipe ad for the team: open "Swipe file", find the ad, then press "Send to ideation".

## The board view (address /pipeline)

The Pipeline address opens the board view of Jobs. The card columns are ClickUp's own statuses, so the board here and the board in ClickUp show the same work. A card carries a dot when it is ready to start or waiting on someone. Press "List" on Jobs to go back to the list.

## Meetings (address /meetings)

What it shows:
Meetings lists the team meetings recorded by Fathom, with what came out of each one. "What came out of them" collects the action items from the meetings on screen. Each meeting row shows the title, the date, the length, the host, a "Watch" link and a fold with the "Summary". The last two weeks show first.

Buttons and actions:
- "Watch": opens the recording.
- "Summary": folds open the written summary.
- "Show older": shows the meetings older than two weeks. The button then folds the list back to the last 14 days.

How to:
- Check what a meeting decided: open "Meetings" and read "What came out of them".

## End of day (address /eod)

What it shows:
End of day is the editor's daily report. It asks the team's seven questions in three blocks: "What you did", "What got in the way" and "What is next". The questions are "Videos completed", "In progress or pending", "Revisions handled", "Blockers", "Recommendations", "Tomorrow's plan" and "Day summary". The answers go to the EOD Reports sheet, on the Video Editors tab.

Buttons and actions:
- "Change" beside the name: files the report under another name.
- "File the day": sends the report.
- "Already filed today": says a report is already in, with its state and the time it was filed.

How to:
- Write the EOD: open "End of day", fill the seven boxes, starting with "Day summary", then press "File the day".

## How to use this desk (address /guide)

What it shows:
"How to use this desk" holds the demo video and the four guides: "The simple SOP", "The in-depth SOP", "Editor desk, how to use it" and "Raise a ticket (the SOP for every team)". Each opens in a new tab.

How to:
- Learn the day: watch the demo once, then keep "The simple SOP" open while you work.

## The client review link (public, address /review)

What it shows:
The review link is the page the client gets. It is public: whoever holds the link can watch the cuts without an account. The link is built as a screening, with the video as the main surface and the decision right under it. Each cut can be approved or sent back with a note. A note can be typed for the whole cut or for a slide.

Buttons and actions:
- "Approve this video": approves a video.
- "Approve this image": approves an image.
- "Ask for a change": opens the note box.
- "Send this note": sends a change request.
- "Watch one again": replays a decided cut.
- "What should change?": the label on the note box.
- "Approved", "Change asked" and "Everything is approved.": the states the client sees.

How to:
- Ask the client to review: make the link in "Send for review", then send it. The client opens it, presses "Approve this video" or "Ask for a change", and the decision comes back to the job.

## The chat assistant

The round button at the bottom right opens the chat assistant, Frame. Type a question and send it. Frame answers how-to questions from this guide. It reads the desk's guide, the page you are on and the data on that page, such as a job, its footage, its notes and its review links. It can read a file you attach. It cannot move a card, upload a cut, approve a review, send a link or change a record.

Ask Frame where a page or a button is, what a page shows, or how a task is done. For a change, Frame points to the place in the desk and the editor does it.

## The foot of the rail

Three links at the foot open the portal. "Team meetings" is the team's schedule, agendas and shared notes. "Ask a team" asks another team for something and turns the request into a ClickUp task with its steps and an owner. "Client performance" shows every active client against its targets.

## Common tasks

Open a job:
1. Open "Jobs".
2. Press "Assigned to me" to narrow the list.
3. Open the job row, or press "Board" and open a card.

Upload a version:
1. Open the job.
2. Paste the new cut's link in "Link to the cut in Drive".
3. Press "Check it first" for a check, or "Request internal review" to hand it over.
4. Read the version list when the desk reports back.

Read review notes:
1. Open the job.
2. Open "Notes".
3. Read the notes from the card, the client review and Frame.io.
4. Press "Add" to add your own note.
5. Tick a note when it is "Done".

Send for review:
1. Open "Send for review".
2. Type the delivery name and the client.
3. Add each cut with "Upload" or a pasted link.
4. Press "Make the link".
5. Press "Copy" and send the link to the client.

Write the end of day:
1. Open "End of day".
2. Fill "Videos completed", "In progress or pending" and "Revisions handled".
3. Fill "Blockers" and "Recommendations".
4. Fill "Tomorrow's plan" and "Day summary".
5. Press "File the day".

## Who to ask for what

- The creative director: a missing brief, script, footage or brand asset, or a decision on a cut. Use "Ask for it" on the job, or "Ask a team".
- A manager: a wrong due date, a job on the wrong card, or a seat that cannot open the desk.
- The portal admin: a new seat or a missing role.
- The editor desk: a cut that was not read, a version that did not appear, or a review link that does not open.
