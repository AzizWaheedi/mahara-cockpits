# Sales cockpit: everything Aziz sent

Word for word from the Claude Code session, 24–25 September 2026, Kuwait time. Pasted blocks are quoted. The HighLevel token in the first message is not repeated. The proposal example attached to the brief is `~/Downloads/2026-09-05-baras.html` on Aziz's Mac. The plan built from this is `SALES_COCKPIT_PLAN.md`.

## 1. The brief (24 September, 09:30)

(Attached: `/Users/abdulazizwaheedi/Downloads/2026-09-05-baras.html`, the AI proposal example.)

Now what I want to build is a sales rep dir cockpit. This is going to be for B2B closers and setters, where they can log in. This is some stuff I'm going to work on.

I have a folder where all sales calls are pulled in, but I want to also just have that happen with Obsidian, where sales calls are pulled in from Fathom. They have a framework, a scripting framework as well, that they can go off of that's part of this cockpit, and it walks them through it, sort of like an AI script.  https://docs.google.com/document/d/1E3RI0eWa0JHjoXYm0iag4ZmIvrNLGyXTUSHFP7Gakjw/edit?tab=t.0
https://docs.google.com/document/d/1EtAtB_vwr0zZU1_jasFL96JOmoaM-Kl5KB4qKUo-_W0/edit?tab=t.0
So, like this Google Doc, but it would walk them through the flow and they can choose the type they want, where it's word for word or bullet points. They can keep notes on every single lead based on the script, and it fills in automatically to make the qualitative pain and all that stuff easy for them. A dialing system for both closers and setters, the same way we used a dialer for our call center, where it prioritizes leads for them so they can power dial all the leads in our CRM. It would be even better because it's literally just on one sub-account. 
https://docs.google.com/document/d/1jvi73ryikhFV4AEAZmf7KmO0pFrpdleOgGMJtsz9FUo/edit?tab=t.0#heading=h.jmy8oapp9hsz
https://docs.google.com/document/d/1S-XGlwvBqOv7mvAHMYf3M1CDX0o97SwL3GEhRfF5igg/edit?tab=t.0

> We would have a key link section which includes:
>
> * the pitch deck
> * the closer
> * the new client form that they fill out after closing
>
>  We can even develop a new pitch deck if needed, because I feel like ours is kind of outdated. That we can even integrate it into their system

 
https://maharamedia.typeform.com/to/BTzMwXiw
https://pitch.com/v/maharamedia-startup-deck-2aba8c
It builds off all of the latest sales calls we had. We can even have a training agent that trains them on each call, and they can put a call for it to review. It puts what the most frequent questions, objections, problems, and expectations are from prospects for the last week or last 30 days, or whatever it is. 
We can embed both of their end-of-day sheets, and they pull into the spreadsheet and Slack like we do with the other roles.  SALES REP (CLOSER) EOD:
https://form.typeform.com/to/BfnrbVWJ
SETTER EOD:
https://form.typeform.com/to/x0FWfEpA

 

> They can easily track their metrics, and it pulls in from their end as well. We can track them both by just calendars and metrics. Maybe if it wasn't on their calendar or they have a specific thing as well, they can see their qualified rate and their close rate. They can update the status on each appointment.
>
> Instead of them, before, having to go into the CRM on GoHighLevel and mark that there was no show, it would just be in the call calendar. It would remind them if they haven't marked anybody as no-show, canceled, showed, or all that stuff. They need to disposition every one, or if they're disqualified, they just mark them as invalid.
>
> That's our logic for somebody who's disqualified, so you already know that in the CEO cockpit as well. We can have an even better source of truth for the CEO cockpit they can look at:
>
> * their cash per call
> * cash per show
> * close rate
> * qualified close rate
> * all of that stuff
> * their projections
>
>  They can set goals and projections for each week on a weekly and a monthly basis, and they can see if they're going to hit their units and cash collection projections and if they're on track or not

  

> it tracks the setter's dials, call gap time, and speed to lead, because sometimes we do a two-call process. It would automatically prioritize the people, for example, that have intro calls booked, but it's still in the dialer system.
>
> The same way the dialer system works for the call center (where new leads will come up, or if they have a callback request, it comes up), the same thing for the intro calls. That way, the intro calls can prioritize the freshest leads in the CRM, and the setter has no I- and anybody who replies to one of our messages and all that stuff can actually do it  and a super easy and frictionless way to do follow-up straight, with recommended templated texts that are just approved by the closer or the setter, and can go out by an AI that follows up with the leads for them. All they have to do is approve it, and it can send the follow-ups for these leads on both WhatsApp and email

  https://app.maharamedia.com/v2/location/7NI8yyJtwsh2OOWA5Icr/conversations/conversations/VLH3MluVOF6cU6Mv2ztK  here is the CRM we use for sales, the subaccount specifically .  you can also have something where we literally do research on each lead's emails and stuff  [the sub-account token, kept in ~/.config/mahara/ghl_b2b_pit and not repeated here] here is also our PIT token for that subaccount.  we need to also pull in all the sales calls instead of on Google Drive. I think if we did it in Obsidian, it would probably be better, but I'll give you the current folder we had that was pulling in sales calls. It's through a Zapier automation. On the research of the sales calls, this can also help us with the marketing side, so it can pull in from there https://drive.google.com/drive/u/0/folders/14bPwPNPuq32Jpl4M4DWjcjx-w8SZVTDF  it should obviously bias toward the last 30 days or something if it's in terms of marketing, frequently asked questions, and objections, so we can focus on those. The more recent sales calls can also help us with the marketing side and feed into that.  and the agent can be on the VPS and stuff, because I already think I have somewhat of a sales agent that I'm going to keep feeding sales assets and stuff like that.

Also, the sales assets part was on our old CEO cockpit we're recommending to them the specific sales assets we send based on the content we have and all of that stuff, like YouTube videos, reels, backend VSLs, all that stuff  proof pages, all that good stuff . I also want the closers to be able to see, specifically, which ad they came from. Obviously, their form answers would be really easy to see, and what they answer in the conversation as well for each of their calls. I also want them to be able to see the ads and the funnel that these leads came from exactly, the same way they can see the preview using the Graph API  which is on the same ad account for setters as well   follow-up should be extremely easy for them too  and they should have a really neat pipeline that's easy to take care of They should also have a hot list there where they can put their hot leads, when they're going to follow up with them next, and all of that stuff, and the last objection .  it should automatically be able to take notes. If you look at our Slack, there's a thing called Sales AI Notes. It takes notes from the intro call and automatically makes notes for the closer from the demo call, and has a doc for each closer. We already have something like this, but I'll show you how we did it. I'm not sure if you can look at the backend of this if you have access to it as well  https://docs.google.com/document/d/1L1mxDomUCyP4mR631C9snqs_zYxKOH1sHXtCravHZvI/edit?usp=drivesdk&tab=t.lw5ojhwklm4a  but it basically took notes and actually qualified leads for every single closer based on the intro call and marked them if they're good, and took notes like this: very simple and easy  and we had the same bot do a proposal generation, so I'll give you an example of a proposal it's made. It has a very good structure. We should be able to do that in the cockpit as well.  

> also, for the key links, it can have access to our clients and testimonials, and they can give leads references if they need to, as well, based on their specific situation  make the entire plan. I don't want this to be a light build. This is a big build. I want it to be absolutely amazing because we're going to turn back on sales, and we're going to take a lot of people. I want this to be absolutely perfect, so plan it out first. Do all the research you need to. If you have any questions you need from me, let me know immediately, and let's get to building  if you need to use workflows, you can just use whatever you need. I need this to be absolutely perfect and have a really solid backend as well, and feed into the rest of our data for the rest of the cockpits, the CEO cockpit, and all that stuff

.  they can't even track their commissions and stuff like that .

## 2. Which proposal (24 September, 09:42)

The proposal generator? No, that's a client proposal generator. That's different than the AI proposal. The AI proposal was the HTML I gave you.

## 3. Obsidian, and proposals in our cockpit (24 September, 10:20)

I'm currently using my VPS to sync all the things to Obsidian, so don't worry about that. We can still draft proposals, and I want to make it in the CEO cockpit here instead of on Muhammed's account.

## 4. Your answers to my eleven questions (24 September, 11:14)

My questions, sent at 11:04 (short form):
1. Which people get a seat (send names and emails).
2. Should marking a call in the cockpit also update HighLevel?
3. Which AI key pays for proposals and Arabic follow-ups (VPS OpenAI by default)?
4. Is the offer the same for the relaunch ($6,000 for three months, $1,000–1,500 ads budget, $500 deposit, 30 qualified meetings)?
5. Which lines follow-ups go out on (official WhatsApp +965 9005 4963; email per rep)?
6. Maqsam: one seat per rep, caller ID by the lead's country?
7. Reps see their own numbers plus a team board of rates, nobody else's pay?
8. Pay plans and goals.
9. Closers record in Fathom and share to the team?
10. Hidden fields on the New Client Form; the EOD filled in inside the cockpit?
11. Rotating exposed keys.

Your answers:

1. Just let me add them like the main cockpit easily
2. Yes
3. VPS
4. Yes but could change should be flexible and depends if we’re giving a guarantee or not or payment plans
5. Official line
6. Yes one seat per rep
7. Yes
8. Right now it’s 10% cash collected on contract so if it’s $2k upfront and $6k contracted they get $200 now and the $400 while we collect it’s and $250 pif bonus but pay should be flexible. For setters it’s different
9. Yes
10. Ok add it. Yes EOD
11. Stop annoying me with this

## 5. The first version (24 September, 15:24)

It's not loading anything. It's just a blank screen.

## 6. The second list (24 September, 15:47)

What about their goals section? The dialer has to be built out. For the setter, use Tahrir or use my account so we can test out the dialer on Maqsam and for today, it should only show the calls that are assigned to whoever that person is specifically. We should be able to put projections and past numbers, and it should also be pulling in all the sales calls. If you check Obsidian now, all the sales calls are pulling in, so you should have all of that as well. Make sure it's extremely solid and has a great backend.  And there should be a call reviewer here that's on the VPS from the VPS's call reviewer. Forgot what his name was called also, in the dialer, they should be able to talk to the lead, and in the lead section as well, using the GoHighLevel integration the same way it is on the dialer. for our cal lcenter. On the sales intelligence section as well also, a lead researcher where you can have an agent go ahead and research the person, search them up on LinkedIn, Google, and everything about the person as well if they trigger and I want to make an agent as well that goes into our CRM and actually follows up using Kit and HighLevel for WhatsApp, and Kit for emails, with context on their specific situation, with the history, the call we had, and anything it has in terms of data. Also, it should be able to do that for the first few days with approval, and even for long-term leads as well, until it's fully trained. They can just approve it, and it goes straight up. The sales manager should be able to see it as well.

## 7. The end of day and messaging (24 September, 15:49)

The end-of-day should be integrated into the thing, the same way the media buyer and the client success have that thing, and the touch point, the same way you can send messages straight away.

## 8. The dialer, and the webinar handover (25 September, 11:31)

Okay, what's missing for us to get? I want to hand over the webinar metrics thing to another LLM. Let's continue the sales thing. Give me the handover. It already has access to the repo, but just give me the handover so it can edit it and all that stuff for the webinar funnel metrics. Let's continue with the sales thing right now. For the dialer, it works as smoothly as it should be at the call center and all that stuff.
