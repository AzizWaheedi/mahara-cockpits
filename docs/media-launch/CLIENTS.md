# Clients workspace follow-up, 24 October 2026

Aziz replaces Launch as the main navigation with Clients. Every accessible client is visible by default, including clients whose campaigns are running and stopped clients. The existing launch planner stays inside each profile. Old /launch links remain valid. Aziz explicitly authorizes enabling LAUNCH_APPLY; this does not authorize launching an arbitrary client's campaign as a test.

Design: existing Mahara navy #091333, card #0f1b45, teal #00CFC8, muted foreground and semantic status tokens. Geist headings and body, Geist Mono for IDs. A quiet client directory uses a status spine per row, searchable accounts and a single Open client action. Filter pills replace the process diagram. Profiles separate Overview, Launch & relaunch, Tasks and Activity, while keeping the account and brief context beside the work. A compact Alerts tray shows new tasks and client action notices throughout the media workspace.

Not in scope: new Slack/WhatsApp delivery, changes to the CSM or creative apps, automatic campaign launches, new cron services or provider writes during tests. Existing task assignments are read from the verified media work feed; the interface calls them media tasks, not an invented personal assignment list.

How we know it works: database tests cover access isolation, same-user seen state, changing notices, unavailable task sources and scoped activity. UI tests cover the full client directory, filters, details and task links. Provider tests retain paused creation, audit/readback, retry prevention and budget controls. Browser verification covers desktop and phone, plus live read-only checks after the guarded ship. Activation is verified by server readiness, with no launch press during testing.
