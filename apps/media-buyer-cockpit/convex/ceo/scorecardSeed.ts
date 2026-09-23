import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { rest } from "./sbWrite";

/**
 * The role scorecards, typed once from Aziz's own documents.
 *
 * Six of them existed as Google Docs: media buyer, client success manager,
 * client sales rep (the call-centre agent), systems manager, creative
 * director and video editor. They are the working document of a monthly
 * one-to-one, so they are reproduced as written — the mission, the
 * accountabilities, what A, B, C and D actually mean, and the prompts in the
 * comments column that tell the reviewer what to collect before the call.
 *
 * They are seeded, not hard-coded: the cockpit reads them from the database
 * and Aziz edits them there. Running this again restores the original wording
 * for a role, which is why every field is upserted on `role_key`.
 */

type Item = {
  key: string;
  accountability: string;
  lookingAt: string[];
  scale: { a: string; b: string; c: string; d: string };
  prompts: string[];
};

type Template = {
  roleKey: string;
  title: string;
  mission: string;
  items: Item[];
  competencies: string[];
  bonus?: string;
};

/** The list every scorecard ends with, shared by all of them. */
const COMMON = [
  "Intelligence. Learns quickly, and absorbs new information without being walked through it.",
  "Enthusiasm. Passion and excitement over the work. A can-do attitude.",
  "Attention to detail. Does not let important details slip through the cracks.",
  "Persistence. Goes the distance to get something finished.",
  "Creativity and innovation. Generates new approaches to problems.",
  "Efficiency. Significant output with little wasted effort.",
  "Organisation and planning. Runs the day around the few things that matter.",
  "High standards. Expects their own work and the team's to be nothing short of the best.",
  "Communication. Speaks and writes clearly without being verbose, in every channel.",
  "Teamwork. Reaches out to peers and cooperates to serve clients properly.",
  "Analytical skill. Processes data and draws a conclusion from it.",
  "Proactivity. Acts without being told. Brings new ideas to the company.",
  "Flexibility. Adjusts quickly to changing priorities and conditions.",
  "Work ethic. Willing to work hard, and long when it is needed.",
  "Honesty and integrity. Does what is right, does not cut corners, speaks plainly.",
];

const CLIENT_FACING = [
  "Follow through on commitments. Lives up to what was agreed, whatever it costs them.",
  "Openness to criticism. Reacts calmly to negative feedback and asks for it.",
  "Persuasion. Able to convince somebody to take a course of action.",
  "Calm under pressure. Holds performance steady under stress.",
];

const TEMPLATES: Template[] = [
  {
    roleKey: "media-buyer",
    title: "Media buyer",
    mission:
      "Innovate the Premium Projects System to generate high-quality leads for our clients and push to a $15 average cost per lead on your accounts, while overcommunicating with clients and the team about what is working and what is not.",
    items: [
      {
        key: "churn",
        accountability: "Under 7% client churn in the month",
        lookingAt: [
          "Keeping cost per lead low",
          "Telling the team early when a client is not hitting their booking goal",
          "Talking to clients about changes, wins and updates, ideally one touchpoint a week",
        ],
        scale: {
          a: "Under 7% churn",
          b: "7% to 10%",
          c: "10% to 14%",
          d: "15% or more",
        },
        prompts: [
          "Client churn, %",
          "Revenue churned, $",
          "Clients churned and why",
          "Churn attributable to the ads, per client",
        ],
      },
      {
        key: "cpl",
        accountability: "Assigned clients hitting their cost per lead",
        lookingAt: ["Strategy", "Creatives", "Copy", "Headlines", "Targeting"],
        scale: {
          a: "Under $10 a lead",
          b: "$10 to $15",
          c: "$15 to $20",
          d: "Over $20",
        },
        prompts: [
          "Average cost per lead across clients, $",
          "Best client and their cost per lead",
          "Worst client, their cost per lead, and why",
          "Clients above the gate and the fix in progress",
        ],
      },
      {
        key: "booking_flow",
        accountability: "Monitoring the booking flow",
        lookingAt: [
          "Watching each client's booking metrics and telling the fulfilment manager the moment a client falls behind their booking goal",
        ],
        scale: {
          a: "Every struggling client flagged promptly, with evidence and a suggested fix",
          b: "80% to 99% flagged, with slight delays or thin evidence",
          c: "60% to 79% flagged, with noticeable delays or inconsistent follow-up",
          d: "Under 60% flagged, or the silence led to an escalation or a churn",
        },
        prompts: [
          "Struggling clients this month",
          "Flagged to the fulfilment manager, with the date for each",
          "Evidence and a solution provided, yes or no",
        ],
      },
      {
        key: "onboarding",
        accountability: "Client onboarding efficiency",
        lookingAt: [
          "Campaigns set up and ready for the launch call, on the deadline, with no errors",
        ],
        scale: {
          a: "Every campaign ready in time with zero mistakes",
          b: "Every campaign ready in time, with very minor errors",
          c: "Some deadlines missed and consistent errors",
          d: "Most deadlines missed, frequent mistakes",
        },
        prompts: [
          "Campaigns launched",
          "On time, per campaign",
          "Errors at launch",
        ],
      },
      {
        key: "info_diet",
        accountability: "Information diet and ideas",
        lookingAt: [
          "Bringing insight, strategy or tools from their own learning into the team",
        ],
        scale: {
          a: "Two or more actionable ideas in the month that show real insight",
          b: "At least one useful idea, with evidence of ongoing learning",
          c: "Occasional contribution, not consistent",
          d: "No contribution and no evident learning",
        },
        prompts: [
          "Ideas brought",
          "Which were implemented",
          "Source: book, podcast or course",
        ],
      },
      {
        key: "errors",
        accountability: "Zero unnecessary errors",
        lookingAt: [
          "Wrong address on an ad, a typo on a creative, the wrong budget",
        ],
        scale: {
          a: "No unnecessary errors",
          b: "One error",
          c: "Two errors",
          d: "Three or more, a repeated error, or an ad spend error",
        },
        prompts: [
          "Errors this month, and what each cost",
          "Ad spend errors, $",
          "Repeated from last month, yes or no",
        ],
      },
      {
        key: "team_comms",
        accountability: "Team communication",
        lookingAt: [
          "Overcommunicating about what to test, new ideas, and how new campaigns are going",
        ],
        scale: {
          a: "Brings ideas constantly and raises concerns early",
          b: "Effective communication with the team",
          c: "Mediocre. Room for improvement",
          d: "Poor. Little on concerns or on what to test",
        },
        prompts: [
          "Tests proposed",
          "Wins shared with the team",
          "Concerns raised early",
        ],
      },
      {
        key: "client_comms",
        accountability: "Client communication and support",
        lookingAt: [
          "Proactive WhatsApp and Zoom contact about wins, progress, changes and fixes",
          "Overcommunication is what keeps a client, and silence is what loses one",
        ],
        scale: {
          a: "Two touchpoints a week per client, every issue answered in time",
          b: "One touchpoint a week per client, sometimes reactive",
          c: "Gaps that leave the client confused or waiting",
          d: "No touchpoints, escalations or dissatisfaction",
        },
        prompts: [
          "Average touchpoints per client per week",
          "Clients under one a week",
          "Issues resolved and how fast",
        ],
      },
    ],
    competencies: COMMON,
    bonus: "To qualify, be managing at least 20 campaigns.",
  },
  {
    roleKey: "client-success-manager",
    title: "Client success manager",
    mission:
      "Reduce churn below 10% by giving the best business coaching, experience and customer service in the industry. Grow existing accounts, get referrals, testimonials and reviews. Know every client's goals, satisfaction and numbers at all times, and be proactive. Operate as if we could only grow because your clients go out of their way to refer their colleagues.",
    items: [
      {
        key: "churn",
        accountability: "Keep churn as low as possible on your pod",
        lookingAt: [
          "Client experience: the wow factor, being a friend, never making them feel like a number",
          "Client results: the offer, a sub-$60 cost per booking, a show rate over 70%, sales coaching, problem-solving, holding them accountable",
        ],
        scale: {
          a: "Under 7%",
          b: "7% to 10%",
          c: "11% to 15%",
          d: "15% or more",
        },
        prompts: [
          "Client churn, %",
          "Revenue churned, $",
          "Clients cancelled and why",
        ],
      },
      {
        key: "upsells",
        accountability:
          "Three or more upsells or reactivations, 10% upsell rate",
        lookingAt: [
          "Website, SEO and GEO, social media management",
          "Reactivating lost clients",
          "Average price point above $2,500",
        ],
        scale: {
          a: "15% or better",
          b: "10% to 14%",
          c: "5% to 9%",
          d: "0% to 4%",
        },
        prompts: [
          "Upsell revenue, $",
          "Reactivation revenue, $",
          "Upsells closed: client and offer",
          "Upsell rate, upsells over active clients",
        ],
      },
      {
        key: "touchpoints",
        accountability: "Client touchpoints",
        lookingAt: [
          "The client knows every change we have made",
          "Wins are highlighted",
          "At least two touchpoints are about numbers and strategy",
        ],
        scale: {
          a: "Two strategic touchpoints per client, 70% with a scheduled Zoom, notes current and summaries in Slack",
          b: "Two per client, 60% with a scheduled Zoom",
          c: "Two per client, 50% with a scheduled Zoom",
          d: "One per client and notes out of date",
        },
        prompts: [
          "Strategic touchpoints per client",
          "Share with a scheduled Zoom",
          "Notes up to date, yes or no",
        ],
      },
      {
        key: "calls",
        accountability: "Client communication on the call",
        lookingAt: [
          "Coaching, setting expectations, urgency, rapport, problem-solving, with conviction",
          "World-class onboarding, pre-launch calls, fortnightly Zooms",
        ],
        scale: {
          a: "90% or better on call coaching",
          b: "80% to 89%",
          c: "70% to 79%",
          d: "Under 70%",
        },
        prompts: ["Average call coaching score, %", "Calls reviewed"],
      },
      {
        key: "proof",
        accountability: "Two or more Google reviews and video testimonials",
        lookingAt: [
          "Spotting the clients who are happy and performing, and asking them",
        ],
        scale: {
          a: "Two reviews or video testimonials",
          b: "One",
          c: "None",
          d: "None, two months running",
        },
        prompts: ["Reviews collected, with links", "Video testimonials"],
      },
      {
        key: "referrals",
        accountability: "Two or more referrals a month",
        lookingAt: [
          "Asking for referrals",
          "Whether clients are actually referring",
        ],
        scale: {
          a: "Two referrals",
          b: "One",
          c: "None",
          d: "None, two months running",
        },
        prompts: ["Referrals: who, and which client sent them"],
      },
      {
        key: "launch",
        accountability: "Time to launch a new client",
        lookingAt: [
          "Auditing the journey from signature to launch and keeping it short",
        ],
        scale: {
          a: "Under 3 days",
          b: "3 to 5 days",
          c: "5 to 10 days",
          d: "Over 10 days",
        },
        prompts: ["Average days to launch", "Slowest launch and why"],
      },
      {
        key: "info_diet",
        accountability: "Information diet",
        lookingAt: ["What went in, and what was done with it"],
        scale: {
          a: "Books, courses, podcasts or videos on being an A-player manager, with something applied",
          b: "Consumed something, little applied",
          c: "Occasional",
          d: "Not continuing to learn",
        },
        prompts: ["Consumed this month", "Applied to what"],
      },
    ],
    competencies: [...COMMON, ...CLIENT_FACING],
    bonus:
      "To qualify, be managing at least 20 clients. The upsell and testimonial commissions do not need that.",
  },
  {
    roleKey: "call-centre-agent",
    title: "Client sales rep (call centre)",
    mission:
      "Call, qualify, schedule and get new leads in the door for our clients. Execute the funnel with confidence and conviction while delivering industry-leading customer service. Exceed the booking and show quota every month and be accountable for the decisions made on the phone.",
    items: [
      {
        key: "activity",
        accountability:
          "100+ dials a day, under a minute of gap between calls, 220+ minutes of talk time",
        lookingAt: [
          "Are the leads being dialled enough",
          "Is the day being used, or is time being lost between calls",
        ],
        scale: {
          a: "Over 100 dials a day with 250+ minutes of talk time",
          b: "100 dials a day with 200 to 250 minutes",
          c: "50 to 100 dials, a gap over a minute, 100 to 200 minutes",
          d: "Under 50 dials, gaps over two minutes, under 100 minutes — or time fraud",
        },
        prompts: [
          "Average dials a day",
          "Average talk time a day, minutes",
          "Average gap between calls",
          "Where they stand on the leaderboard",
        ],
      },
      {
        key: "conversation",
        accountability: "30%+ conversation rate",
        lookingAt: [
          "Turning a cold answer into a real conversation in the first 30 to 60 seconds",
          "A conversation is a call over 90 seconds",
        ],
        scale: {
          a: "40% or better",
          b: "35% to 39%",
          c: "30% to 34%",
          d: "Under 30%",
        },
        prompts: [
          "Conversation rate, %",
          "Answered calls",
          "Conversations over 90 seconds",
        ],
      },
      {
        key: "booking",
        accountability: "40%+ booking rate, six or more appointments a day",
        lookingAt: [
          "Following the sales process and turning four in ten qualified conversations into a booked appointment that shows",
        ],
        scale: {
          a: "40%+ and 8 or more a day",
          b: "30% to 39% and 5 to 6 a day",
          c: "20% to 29% and 3 to 4 a day",
          d: "Under 20% and 2 or fewer a day",
        },
        prompts: [
          "Booking rate, %",
          "Total booked",
          "Average appointments a day",
          "Show rate, %",
        ],
      },
      {
        key: "invalid",
        accountability: "Invalid bookings kept to a minimum",
        lookingAt: [
          "Leads booked for a client that did not meet the qualifying requirements",
        ],
        scale: {
          a: "No invalid bookings",
          b: "One or two",
          c: "Three to five",
          d: "More than five, or booking regardless of the requirements",
        },
        prompts: [
          "Invalid bookings: client and reason for each",
          "Caught by a client complaint or by our own audit",
        ],
      },
      {
        key: "script",
        accountability: "Script execution with conviction",
        lookingAt: [
          "Rapport, qualifying, rebuttals, confidence, tonality, tempo, empathy, conviction",
        ],
        scale: {
          a: "90%+ average call audit",
          b: "80% to 89%",
          c: "70% to 79%",
          d: "60% to 69%",
        },
        prompts: [
          "Average call audit score, %",
          "Calls audited",
          "Weakest area: rapport, rebuttals or tonality",
        ],
      },
      {
        key: "standards",
        accountability: "Team standards executed correctly",
        lookingAt: [
          "Call frequency, double dials, texting when needed",
          "End of day filled in daily and honestly",
          "Shift start and stop posted, on time to calls, engaged",
        ],
        scale: {
          a: "No process errors",
          b: "One or two",
          c: "Three or more, or repeated",
          d: "Many, repeated, or an inaccurate end of day",
        },
        prompts: [
          "Process errors",
          "End-of-day accuracy check",
          "Repeated from last month, yes or no",
        ],
      },
      {
        key: "contribution",
        accountability: "Team support and spotting system problems",
        lookingAt: [
          "Ideas in the product improvement channel",
          "Raising a ticket when something is broken",
          "Contributing on team calls",
        ],
        scale: {
          a: "Constant ideas and tickets, engaged in every meeting, detailed end of day",
          b: "Some good ideas, contributes now and again",
          c: "Occasional idea, listens but does not engage",
          d: "Late, disengaged, no input",
        },
        prompts: [
          "Ideas submitted",
          "Tickets raised",
          "Engagement on team calls",
        ],
      },
      {
        key: "service",
        accountability: "Industry-leading customer service",
        lookingAt: [
          "Talking to clients quickly and well, following the communication process",
        ],
        scale: {
          a: "Consistent, professional, no errors, gets it done",
          b: "Consistent and professional, could explain more",
          c: "Typos, delayed responses",
          d: "No rapport, poor communication, cold",
        },
        prompts: [
          "Communication errors",
          "Average response time",
          "Client feedback received",
        ],
      },
    ],
    competencies: [...COMMON, ...CLIENT_FACING],
  },
  {
    roleKey: "systems-manager",
    title: "Systems manager",
    mission:
      "Make sure the tech team onboards clients and clears the daily fires on time, and build new systems when problems appear, so the client base can grow without operational drag caused by a lack of preparation.",
    items: [
      {
        key: "projects",
        accountability: "The month's agreed projects finished, ClickUp current",
        lookingAt: [
          "Keeping the operations manager up to date on deadlines, progress and the week's focus",
          "The biggest problems in the business prioritised first",
        ],
        scale: {
          a: "Every big project done and every deadline current",
          b: "85% to 90% done, deadlines and updates current",
          c: "70% done, some deadlines stale",
          d: "Most not done, deadlines completely out of date",
        },
        prompts: [
          "Projects agreed at the start of the month",
          "Finished",
          "Still open and why",
        ],
      },
      {
        key: "automations",
        accountability: "Scenarios and automations all active and working",
        lookingAt: [
          "Auditing and fixing broken scenarios",
          "A long-term fix for anything that breaks repeatedly",
        ],
        scale: {
          a: "Everything back on within 24 business hours, with long-term fixes in place",
          b: "Back on within 24 hours, some long-term fixes",
          c: "Some missed or delayed past 24 hours, affecting the team",
          d: "Repeated failures with no lasting fix",
        },
        prompts: [
          "Automations that broke",
          "Time to fix each",
          "Long-term fixes put in",
        ],
      },
      {
        key: "onboarding",
        accountability: "Client onboarding efficiency",
        lookingAt: [
          "Tech set up and ready for the launch call, with no errors",
        ],
        scale: {
          a: "Every client ready in time with zero errors",
          b: "Ready in time, very minor errors",
          c: "Some deadlines missed, consistent errors",
          d: "Most deadlines missed, frequent errors",
        },
        prompts: [
          "Clients onboarded",
          "On time, per client",
          "Errors at launch",
        ],
      },
      {
        key: "fires",
        accountability: "Fixing and delegating the daily fires",
        lookingAt: [
          "Anything that slows the team down, fixed as fast as possible",
        ],
        scale: {
          a: "Resolved the same day, within 12 hours, with no chasing",
          b: "Within 24 hours, occasional chasing",
          c: "Two days or more, several chases",
          d: "Unresolved, or escalated because nothing happened",
        },
        prompts: ["Fires raised", "Average time to fix", "Anything still open"],
      },
      {
        key: "sops",
        accountability: "SOP documentation",
        lookingAt: ["What was written down so the team can do it without them"],
        scale: {
          a: "Every new or outdated process written and filmed, and uploaded",
          b: "Most written up",
          c: "Did the work but documented nothing",
          d: "Nothing documented that needed to be",
        },
        prompts: ["SOPs written", "Videos recorded", "Where they live"],
      },
      {
        key: "rnd",
        accountability: "Two R&D tests a month",
        lookingAt: [
          "Always testing ways to make things easier for the team and the clients",
        ],
        scale: {
          a: "Two tests with results linked",
          b: "One test with results linked",
          c: "None",
          d: "None, two months running",
        },
        prompts: ["Tests run", "What each one showed"],
      },
      {
        key: "info_diet",
        accountability: "Information diet",
        lookingAt: ["What went in on AI, automation and new ways of working"],
        scale: {
          a: "Learning and applying something new to the agency",
          b: "Learning, little applied",
          c: "Occasional",
          d: "Not continuing to learn",
        },
        prompts: ["Consumed this month", "Applied to what"],
      },
    ],
    competencies: COMMON,
    bonus: "To qualify, have been with the company more than 90 days.",
  },
  {
    roleKey: "creative-strategist",
    title: "Creative director and strategist",
    mission:
      "Own every creative asset that leaves Mahara: four or more scripts a day, editors on deadline at four videos a day, every new client's brand identity ready before the launch call. The creative engine is never the bottleneck, and creative fatigue never kills a working campaign.",
    items: [
      {
        key: "scripts",
        accountability: "Four or more client ad scripts a day, on time",
        lookingAt: [
          "Daily script output across clients: ads, reels, hooks",
          "New-client long scripts such as VSLs count as two",
          "Delivered on schedule for every launch and refresh",
        ],
        scale: {
          a: "Four or more a day on average, all on time, nothing rejected",
          b: "Three to four a day, or one late delivery",
          c: "Two to three a day, or two to three late",
          d: "Under two a day, or consistently late",
        },
        prompts: [
          "Scripts this month",
          "Daily average",
          "Long scripts for new clients",
          "Late, and why",
          "Rejected or rewritten, and why",
        ],
      },
      {
        key: "brand",
        accountability: "Brand identity done before the launch call",
        lookingAt: [
          "Brand kit built: colours, fonts, templates, story icons",
          "Ad creative direction set from the client's portfolio",
          "Nothing launches without it",
        ],
        scale: {
          a: "Every new client had a full identity before the launch call",
          b: "Ready, but one cut close to the deadline",
          c: "One launch call happened without it",
          d: "Several launches delayed or launched without it",
        },
        prompts: [
          "New clients onboarded",
          "Identity ready before the launch call, per client",
          "Delays and the cause",
        ],
      },
      {
        key: "concepts",
        accountability: "New creative ideas and concepts",
        lookingAt: [
          "New angles, hooks and formats, ahead of creative fatigue rather than after it",
        ],
        scale: {
          a: "Four or more concepts, at least two tested live",
          b: "Two or three concepts, one tested",
          c: "One concept, none tested",
          d: "No new ideas, only executing requests",
        },
        prompts: ["Concepts proposed", "Tested live, and the result"],
      },
      {
        key: "revisions",
        accountability: "Revision turnaround",
        lookingAt: ["How fast a requested change comes back finished"],
        scale: {
          a: "Every revision within 24 hours",
          b: "Within 48 hours",
          c: "Three to four days",
          d: "Longer, or revisions get lost",
        },
        prompts: [
          "Revisions requested",
          "Average turnaround",
          "Longest and why",
        ],
      },
      {
        key: "editors",
        accountability: "Managing the video editors and their deadlines",
        lookingAt: [
          "Clear briefs, deadlines assigned, work reviewed before it goes out",
          "The editors hitting four videos a day is his number too",
        ],
        scale: {
          a: "Everything on time, briefed and reviewed, editors at four or more a day",
          b: "90% on time, editors near quota",
          c: "75% to 89% on time, rework from unclear briefs",
          d: "Under 75%, or editors idle and confused",
        },
        prompts: [
          "Deliverables due",
          "Delivered on time",
          "Editors' daily average",
          "Rework caused by unclear briefs",
        ],
      },
      {
        key: "market",
        accountability: "Information diet and market awareness",
        lookingAt: [
          "Studying winning ads, competitors and top creators, and feeding it into our creative",
        ],
        scale: {
          a: "Weekly review with takeaways applied to scripts",
          b: "Regular review, some application",
          c: "Occasional review, no application",
          d: "Not studying the market",
        },
        prompts: ["Reviewed this month", "Applied to which scripts"],
      },
    ],
    competencies: [...COMMON, ...CLIENT_FACING],
  },
  {
    roleKey: "video-editor",
    title: "Video editor",
    mission:
      "Deliver four publish-ready videos a day, on deadline, every time. Quality high enough that a client never sees a mistake, speed high enough that a launch is never blocked on editing.",
    items: [
      {
        key: "output",
        accountability: "Four new videos a day",
        lookingAt: [
          "Finished, publish-ready edits across assigned clients: ads, reels, stories",
        ],
        scale: {
          a: "Four or more a day with quality held",
          b: "Three to four a day",
          c: "Two to three a day",
          d: "Under two a day",
        },
        prompts: [
          "Videos this month",
          "Daily average",
          "Best day and worst day",
        ],
      },
      {
        key: "deadlines",
        accountability: "Every edit delivered on deadline",
        lookingAt: ["The deadline set by the creative director"],
        scale: {
          a: "Everything on time",
          b: "90% to 99% on time",
          c: "75% to 89%",
          d: "Under 75%, consistently late",
        },
        prompts: ["Edits assigned", "Delivered on time", "Late and why"],
      },
      {
        key: "quality",
        accountability: "Edit quality and brand standards",
        lookingAt: [
          "Clean cuts, correct Arabic captions, brand colours and fonts, hook timing, sound levels — ready to publish",
        ],
        scale: {
          a: "No revisions needed for quality",
          b: "One or two minor revision rounds",
          c: "Three or more, or the same mistake again",
          d: "Constant fixing, or a client noticed",
        },
        prompts: [
          "Average revision rounds per edit",
          "Quality errors",
          "Repeated from last month, yes or no",
        ],
      },
      {
        key: "revision_speed",
        accountability: "Revision speed",
        lookingAt: [
          "Changes turned around fast enough that a launch is never blocked",
        ],
        scale: {
          a: "Within 24 hours",
          b: "Within 48 hours",
          c: "Three days",
          d: "Longer, or revisions get lost",
        },
        prompts: ["Revisions requested", "Average turnaround"],
      },
      {
        key: "briefs",
        accountability: "Following briefs and process",
        lookingAt: [
          "Right hook, right format, right dimensions per platform, files named and delivered properly, first time",
        ],
        scale: {
          a: "No misses",
          b: "One or two",
          c: "Three or more, or rework from not reading the brief",
          d: "Constant rework, briefs ignored",
        },
        prompts: ["Brief misses", "Rework hours caused"],
      },
      {
        key: "ideas",
        accountability: "Ideas and initiative",
        lookingAt: [
          "Better hooks, transitions and formats from studying what performs, not just executing",
        ],
        scale: {
          a: "Two or more suggestions, at least one used",
          b: "One suggestion",
          c: "Rarely contributes",
          d: "Never contributes",
        },
        prompts: ["Suggestions made", "Used in the final edits"],
      },
    ],
    competencies: COMMON,
  },
];

export const seed = internalAction({
  args: { by: v.optional(v.string()) },
  returns: v.any(),
  handler: async (_ctx, a): Promise<{ roles: string[] }> => {
    const by = a.by ?? "aziz@maharamedia.com";
    const body = TEMPLATES.map(t => ({
      role_key: t.roleKey,
      title: t.title,
      mission: t.mission,
      items: t.items,
      competencies: t.competencies,
      bonus: t.bonus ?? null,
      updated_by: by,
      updated_at: new Date().toISOString(),
    }));
    await rest("cockpit_scorecard_templates?on_conflict=role_key", {
      method: "POST",
      body,
      prefer: "resolution=merge-duplicates,return=minimal",
    });
    return { roles: TEMPLATES.map(t => t.roleKey) };
  },
});
