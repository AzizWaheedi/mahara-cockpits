# Client page design decision (CSM calls, 2026-10-11)

Audience: Mahara CSMs reading one client's complete history before the next call. Single job: show which calls happened, what was said, which forms were filed and what the media buyer changed, without treating a stale source as an empty one.

Existing cockpit decisions win over a new theme. The app already uses Geist, Geist Mono, IBM Plex Sans Arabic, Deep Space #091333, card #0f1b45, teal #00CFC8, quiet hairline borders and rounded-2xl panels. One teal glow is reserved for the next booked call. No generic hero, page-wide gradient, serif, or decorative animation. The soft-floating library's rounded thin-border panel direction agrees; its archival motion components are not installed because this is a dense working screen, not a visual retrofit.

Layout: existing header with one next/last-call line, then `Calls` and `Forms` in the existing Overview structure, with Results using the same source for dated changes. Calls are upcoming first, then newest. A thin left rail is a real timeline, not arbitrary numbering. The next booked call is the only teal dot/glow; held and cancelled calls use the cockpit's status chips. A detail disclosure reveals the full summary, transcript and linked form answers rather than forcing a long scroll. On a phone, rows wrap rather than shrinking text. Source gaps appear as one plain sentence in each affected section. The unmatched queue is a separate, quiet disclosure; an assignment is one click and audited.

```
Client name     Next: Blueprint Tue 13:00   Last: Check-in 7 Oct
[Calls (12)                   | stale-source line if needed]
  o-- Next call, join link
  |
  o-- Held call, recording, summary (expand)
[Forms (8)                   | answers (expand)]
[Changes since last call     | dated items, never "none" while stale]
[Matched no client          | assign only items this CSM may see]
```

Critique: a giant all-purpose activity stream would hide form history and conflate a scheduled call with a recorded one. Three distinct sections with the call rail let a CSM find the next appointment quickly while preserving full evidence. No second primary action was added. The UI still needs a rendered 390/820/1440-width inspection in a signed-in session before it can be called visually complete.
