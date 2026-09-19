# Social media management for clients

The workflow Aziz locked on 2026-09-18, and what is built of it.
`Creative_Director_Cockpit_Social_Media_Workflow.docx` is the session
spec; this is the build brief it ends by asking for, plus what has since
been answered or built.

## Decisions taken 2026-09-19

- **It lives in the creative director cockpit.** The doc's actors are
  CSMs, but the content tooling -- Ideation, Scripts, the swipe file, the
  client database -- is already there, and splitting a workflow across two
  cockpits to match job titles would be the worse trade.
- **Images come off the existing Higgsfield subscription through its MCP**,
  not the metered API. Higgsfield does now have a real pay-as-you-go REST
  API at `cloud.higgsfield.ai`, which the earlier research predates, but
  Mahara already pays $804/month for the subscription and Aziz's answer was
  MCP. That single choice decides the architecture: **an MCP tool cannot be
  called from a Convex action**, so the cockpit never generates anything.
  It writes a job and an agent that can speak MCP drains it -- the same
  outbox pattern as every other thing that leaves a cockpit.

## Two of the doc's open items, answered from the books

- **GHL tier.** The card statements show **GoHighLevel CRM at $497/month**,
  which is the Agency Pro subscription. Social Planner is included at that
  agency tier. What still needs checking is each of the 12 sub-accounts
  individually, because the plan is assigned per location, not inherited.
- **Higgsfield already costs $804/month**, which is the argument for MCP
  over a second metered bill, not against generation itself.

## The API, grounded

GHL is already reachable from a Convex action -- `convex/ghlCalendar.ts`
has been calling `services.leadconnectorhq.com` with a bearer token for
months, so there is no new integration to stand up, only new endpoints.

| what | call |
| --- | --- |
| mint a sub-account token from the agency one | `POST /oauth/locationToken` |
| the month's posts, for the unified calendar | `GET /social-media-posting/{locationId}/posts` |
| queue a post for the client to approve | `POST /social-media-posting/{locationId}/posts` |
| change one | `PUT /social-media-posting/{locationId}/posts/{id}` |
| drop one | `DELETE /social-media-posting/{locationId}/posts/{id}` |

Header `Version: v3` on the Social Planner calls, which is not the
`2021-04-15` the calendar code sends -- the same base URL, two different
versions.

The field that makes the client-approval step work without building
anything is `status: "in_review"` with `postApprovalDetails`: GHL holds the
post, generates the password-protected approval link, and publishes
natively on approval. `scheduleDate` is ISO 8601 and required for
`scheduled` and `in_review`.

**`POST /oauth/locationToken` is the multi-client hinge.** One agency-level
token mints a token per sub-account, so twelve clients need one credential,
not twelve.

## Built, 2026-09-19

**The data model** (`supabase/migrations/20260919f_social.sql`). Six tables,
all keyed on `client_task_id` -- the ClickUp client card, the same key
`editor_clients` uses, so the brand DNA, the do's and don'ts and the offer
are already on file and are not copied.

| table | what it is |
| --- | --- |
| `social_clients` | who is on the package, their pillars, dialect, batch day, GHL sub-account, and the four onboarding steps |
| `social_assets` | the real photographs. Not stock: headshot-only degrades likeness on lifestyle images |
| `social_bank` | the Content Bank -- questions, objections, and every correction anybody has made |
| `social_batches` | one client, one month, the pillar mix and where it has got to |
| `social_posts` | one post, which exists as a topic and a caption direction long before it is a picture |
| `social_jobs` | work for an agent that can reach Higgsfield |

Row security on, no policies and no grants: everything goes through a
Convex action holding the service key. The moment a browser needs one of
these directly, its policy and its grant go in together -- a policy without
a grant does nothing, which cost a day on the ideation board.

**The backend** (`apps/creative-director-cockpit/convex/social.ts`). The
roster, the pending dashboard, a month's batch, the Content Bank, the
active flag, the per-client configuration, the onboarding steps, the pillar
mix, and plan approval. Two rules are enforced here rather than in the UI:
a batch cannot be approved unless it has a plan in it, and a mix cannot be
changed once the month has moved past planning, because it would no longer
describe what was made.

**The screen** (`src/pages/SocialPage.tsx`, `/social`). The roster grouped
by batch day, the waiting dashboard, and a per-client panel with the
pillars, the configuration, the onboarding checklist and the Content Bank.

The grouping is the point, not a display preference: one reviewer does
every client on batch day 3 in one sitting rather than taking each client
end to end, which is what makes twenty minutes a client a month possible at
twelve clients.

## What is left

| | needs |
| --- | --- |
| Phase 2, plan generation | a decision on which model writes the plan. Extraction and drafting is DeepSeek work; the Arabic captions are not |
| Phase 4, generation | the MCP job runner, and which agent owns it |
| Phase 5, internal review | the screen, once there is something to review |
| Phase 6, GHL push and the unified calendar | the agency token, and the per-location tier check |
| the ClickUp form that seeds a calendar | the pattern exists in client-launch-campaign; nobody has said what the form asks |
| LinkedIn | a live test before it is promised |
| pricing to the client | Aziz's target margin |

Nothing above is blocked on code except the last three.
