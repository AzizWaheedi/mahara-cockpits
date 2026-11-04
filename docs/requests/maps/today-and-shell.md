# Today and the shell: where "Your tasks", the alerts bell and the focus view go

Read-only map, written 2026-10-26 in worktree `forms-1025`, branch
`tickets-1026` from main `86ee4e84`. Nothing was built, applied, deployed,
posted or changed: files were read with `cat`, `sed` and `grep`, Supabase
with `SELECT` through `sq.py`, ClickUp with one MCP read
(`clickup_get_workspace_members`). Staff are named by role. No email
addresses or personal names are written here.

It serves PLAN.md D18 and D19 ("Your tasks" on every Today, at most five
rows, an alerts bell, a focus view with the SOP checklist, writes through the
ClickUp writeback queue) and D17 (routing and alert rules edited in the
cockpit, behind `cockpit_forms_editor_gate`). Sources are `file:line` from
the repo root unless stated. "CT" means `docs/forms/maps/clickup-ticketing.md`.

---

## 1. What matters most

1. **Six homes, five apps, two kinds of shell.** The media buyer (the portal),
   client success and creative apps use the shadcn sidebar, Radix, sonner and
   framer-motion. The editor desk and sales use hand-built rails with no
   Radix popover, no zod, no sonner and no happy-dom (section 3). A shared
   component set therefore has to be dependency-free: React, react-router,
   lucide-react and its own small dialog. That is possible, and all five apps
   share one biome config and the `@/` alias, so the set can be pinned byte
   for byte, imports included (section 6).
2. **No seat knows its ClickUp user.** No column in `cockpit_members`,
   `cockpit_people`, `team_people` or `editor_people` holds a ClickUp user id
   (information_schema read, section 5). Matching the seat's email to a
   ClickUp member's email works for 8 of 13 active seats and **0 of 2 call
   centre seats and 0 of 1 sales seat**. Without an explicit link these seats
   would see an empty "Your tasks" that looks like "nothing to do". The link
   is a backend row; the screen must say "Your seat is not linked to ClickUp
   yet", never show zero.
3. **The model is one person's feed.** The media buyer's `ClientAlerts.tsx`
   reads `cockpit_media_client_notices()`, whose task rows come from
   `cockpit_media_sources` table `inbox`, built by
   `hermes/cockpit-sync/calculator.ts:2955-3045` for **one fixed ClickUp user**
   (`calculator.ts:34`) on two fixed lists (`calculator.ts:37`). The second
   media buyer seat gets none of its own assignments. The pattern (poll,
   versioned read marks, popover) is the model; the feed is not reusable.
4. **The media buyer already has a bell.** `AppLayout.tsx:88` mounts
   `ClientAlerts` above every media buyer page, labelled "Alerts". A second
   bell would make two. The shared bell must take over that spot and carry
   the launch notices too (section 7.1).
5. **The systems manager lands on `/admin`, not a Today.** `PortalHome.tsx:84-85`
   sends every admin seat to `/admin`. The systems manager owns most request
   types (PLAN.md 3.3), so "Your tasks" must also sit on `/admin`.
6. **The call centre seats are two seats, two logins.** SQL: 2 active
   `call_center` seats, 2 distinct emails, 2 distinct auth users, both with a
   client list. CT section 8 says the two agents "share a login"; the memory
   note's "one login" means each agent's dialer and cockpit share an account.
   Their home is `/team` (`apps/media-buyer-cockpit/src/auth/supabaseAccess.ts:22`).
7. **The editor's Jobs are already ClickUp tasks.** The Jobs page lists the
   Video Pipeline board (`video-editor-cockpit/src/pages/JobsPage.tsx:175-325`).
   "Your tasks" on the editor desk must leave Video Pipeline tasks out, or
   every job shows twice.
8. **Four writers raise team requests today, two of them live.** CSM "Ask a
   team" (decision log, then the writeback queue: 7 delivered), CSM "Add a
   task" (straight to ClickUp through `cockpit-csm-api`), the media buyer
   reroute (decision log, 11 rows all `dry_run`) and the media buyer
   offboarding (straight to ClickUp through `cockpit-media-api`, Tech only).
   Section 9 maps each and how it moves to one request backend.
9. **`?task=` is taken.** `pages/data/DataViewPage.tsx:353` reads `?task=` on
   the portal's `/data`. The focus view should open on `?focus=<taskId>`,
   which no app reads (grep across `apps/*/src`).
10. **Proposal in one line:** seven shared files copied byte for byte into all
    five apps and pinned in `scripts/check-shared.sh`, one small adapter per
    app (`src/lib/taskSeat.ts`), and per-app placement edits listed in
    section 7.

---

## 2. The six homes

| Seat | Home route (base) | Today file | Shell files | Phone | Seat hook |
|---|---|---|---|---|---|
| Media buyer | `/dashboard` (portal root `/`) | `apps/media-buyer-cockpit/src/pages/CockpitPage.tsx` (`TodayPage` 977, body `Cockpit` 999) | `components/AppLayout.tsx`, `components/AppSidebar.tsx` | `components/MobileTabBar.tsx` | `useCockpitAuth()` (`auth/SupabaseAuthProvider.tsx:152`) |
| Client success | `/client-success/dashboard` | `apps/client-success-cockpit/src/pages/CsmPage.tsx` (`TodayPage` 4018, body `CsmContent` 1231) | `components/AppLayout.tsx`, `components/AppSidebar.tsx` | slim bar, no tab bar | `useCockpitAuth()` |
| Creative director | `/creative/dashboard` | `apps/creative-director-cockpit/src/pages/DashboardPage.tsx` (`DashboardPage` 180, body `Creative` 207) | `components/AppLayout.tsx`, `components/AppSidebar.tsx` | slim bar, no tab bar | `useCockpitAuth()` |
| Video editor | `/editor/` (`/dashboard` redirects to `/`) | `apps/video-editor-cockpit/src/components/Places.tsx` `JobsHome` (16) → `pages/JobsPage.tsx` (175) | `src/App.tsx` `Shell` (34), `components/Sidebar.tsx` | slim bar, no tab bar | `useWho()` (`lib/auth.tsx:96`) |
| Sales | `/sales/` (`/dashboard` redirects) | `apps/sales-cockpit/src/pages/TodayPage.tsx` (65) | `src/App.tsx` `Shell` (66), `components/Sidebar.tsx`, `components/MacOSMenuBar.tsx` | `MacOSDock` tab bar (`App.tsx:374-395`) | `useWho()` (`lib/auth.tsx`, identical to the editor's) |
| Call centre (team-only) | `/team` in the portal | `apps/media-buyer-cockpit/src/pages/team/TeamPage.tsx` (50) | the portal's `AppLayout`, `AppSidebar` | the portal's `MobileTabBar`, non-media-buyer branch | `useCockpitAuth()` |

The portal root `/` is `PortalHome` inside `PublicLayout`
(`auth/authenticated/AuthenticatedAppRoutes.tsx:49-51`). It never shows a
page of its own to a signed-in seat: the CEO goes to `/ceo`, an admin to
`/admin`, a one-cockpit seat to that cockpit, a team-only seat to its home
(`pages/PortalHome.tsx:84-95`). So "Your tasks" never goes on `/`; the bell
lives in `AppLayout`, which `/` does not mount.

All five apps sit on one origin, `cockpit.maharamedia.com`: the portal
rewrites `/client-success`, `/creative`, `/editor` and `/sales` to their own
Vercel projects (`apps/media-buyer-cockpit/vercel.json` rewrites), and each
app sets its base (`vite.config.ts` `base:` in each; BrowserRouter
`basename` in each `main.tsx`). A portal link from another cockpit is
`${portalUrl()}/requests`, as every rail already builds `${portal}/team`.

### 2.1 Media buyer, `/dashboard`

Order on Today (`CockpitPage.tsx:4018-4129`):

| Part | Line |
|---|---|
| Header: "Today", date, sync line, End of day, Report a problem | 4021-4048 |
| `ViktorStatus` (only when stale) | 4051 |
| `AdBillingWatch` | 4057 |
| `WhatsAppDesk desk="ads"` | 4074 |
| Left column: `ExceptionAlerts` | 4086 |
| Morning sprint (`sprint`, built at 2050) | 4087 |
| `#tasks`: `LaunchToday`, `Onboardings`, **"Your ClickUp tasks"** (`tasksCard`, built at 2342-2446) | 4088-4103 |
| `#touchpoints` (`touch`, 2479) | 4104-4106 |
| `watch` (review queue, 2171), `accounts` | 4107-4108 |
| Right column: `TodayMeetings`, What you planned, Change log | 4111-4113 |
| Tiles, `PortfolioTrends`, End of day prompt | 4116-4126 |

"Your ClickUp tasks" today lists every `inbox` row, unlimited, each with an
"Ask someone on this task" form that calls `cockpit.askForDetail`
(`CockpitPage.tsx:2342-2446`; the operation runs in
`supabase/functions/cockpit-media-api/index.ts:63,151`, gated by
`cockpit_media_task_scope`). The old `/tasks` address redirects to
`/dashboard#tasks` (`AuthenticatedAppRoutes.tsx:66`), so the anchor must stay.

**"Your tasks" goes** in the left column directly under `ExceptionAlerts`
(4086), replacing `tasksCard` (4102), and keeps `id="tasks"`. The ask form
moves into the focus view as its comment box.

### 2.2 Client success, `/client-success/dashboard`

Order on Today (`CsmPage.tsx:2704-3158`):

| Part | Line |
|---|---|
| `PageHeader` "Today", End of day, Report | 2706-2737 |
| `SyncStrip only="feed"` | 2739 |
| One sentence: who needs you, invoices past due | 2741-2750 |
| Three `StatTile`s and a fold with four more | 2752-2788 |
| `AdBillingDailyTask` | 2790 |
| `TodaysCalls` | 2792 |
| `CallList` | 2794 |
| `#who-needs-you`: Onboarding, Management | 2796-2811 |
| Commitments from calls | 2815-2830 |
| Tickets raised today (decision rows of kind `ticket`/`rerouted`) | 2832-2895 |
| Loose ends | 2897-2950 |
| **Client Success board** (every due, overdue or undated task on the Client Success list, up to 20) | 2952-3005 |
| Day plan (five blocks of checks) | 3008-3133 |
| Fold: Calendar and data fixes | 3135-3145 |
| End of day prompt | 3147-3158 |

The "Client Success board" rows are `csTasks`, all tasks on list
`901816723211` with no assignee filter (`hermes/cockpit-sync/csmProducer.ts:284`,
read at `apps/client-success-cockpit/src/lib/csmReadModel.ts:253`).

**"Your tasks" goes** right after the tiles (after 2788), before
`AdBillingDailyTask`. The "Client Success board" card stays until the
per-seat read is shown to hold the same open tasks (open decision 11.3),
then goes. "Tickets raised today" becomes "Requests you raised today", read
from the request rows.

### 2.3 Creative director, `/creative/dashboard`

Order (`DashboardPage.tsx:265-700`): `PageHeader` with Send for review,
Meetings, End of day (276); a contents bar Morning, Scripting, Videos,
Touchpoints (`PARTS` 167-172, drawn at 308); `SyncHealth` (321); `#morning`
(326): "Late and blocking a client" (331-401, only when something is late),
`WhatsAppDesk desk="creative"` (403), morning checklist (404-408);
`#scripting` (413): checklist, Brand DNA rows (424), clients in creative
onboarding (497), **Script requests** (527-578, the Media/Creative list,
first 8); `#videos` (580); `#touchpoints` (636).

**"Your tasks" goes** in `#morning` after the late section (after 401),
before `WhatsAppDesk`. No new contents-bar part. New Script Request tickets
assigned to the creative seat will show in both "Your tasks" and "Script
requests"; open decision 11.4.

### 2.4 Video editor, `/editor/`

`JobsHome` (`components/Places.tsx:16-59`) shows `JobsPage` (list) or
`PipelinePage` (`?view=board`). `JobsPage` order (`pages/JobsPage.tsx:228-325`):
`PageHeader` "Jobs" with Refresh and Report (229-241); four tiles Ready,
Waiting, Late, Due today (244-263); a line on what they count; chips
"Assigned to me" and "Include finished" (267-285); a read error (287); job
groups (300-322). "Mine" is matched by the assignee's email
(`JobsPage.tsx:23-27`).

**"Your tasks" goes** after the tally block (before the chips at 267), on
the list view only, and its feed leaves out list `901816720767` (Video
Pipeline), which the Jobs list already owns. On the board view it is not
shown.

### 2.5 Sales, `/sales/`

Order (`pages/TodayPage.tsx:112-244`): header with the date, mirror line and
the scope switch (113-125); "not linked to HighLevel" warning (127-134); "Your
day" panel (135-155); a 12-column grid: left `OwedCard` (158), `WeekCard`
(168); right (170) Coming up, `RepliesCard` (228), `NewLeadsCard` (234).

**"Your tasks" goes** at the top of the right column (line 170), above
"Coming up". The unlinked-seat sentence follows the HighLevel one's pattern
("Your seat is not linked to your HighLevel user yet ... Ask Aziz to link it
on the Team page", 127-134), but names the role: "Ask the systems manager".

### 2.6 Call centre, `/team` in the portal

`TeamPage.tsx:142-200`: header "Team meetings" with New meeting (144-157),
`WeekView` (171), prizes, the purpose note, filters. The seat has no cockpit
(`supabaseAccess.ts:89-91`: `cockpits` holds only cockpit roles), so
`access.cockpits.length === 0` and `home === "/team"` identify it, as
`PortalHome.tsx:93` does.

**"Your tasks" goes** under the header (after 157), only when the seat has
no cockpit of its own; other seats have it on their own Today. Today the two
seats' emails match no ClickUp member (section 5), so until they are linked
the card shows the "not linked" sentence.

### 2.7 Admin seats, `/admin` in the portal

`pages/AdminPage.tsx:294-312` is the header. Admin seats (3 active, the
systems manager among them) land here (`PortalHome.tsx:85`). **"Your tasks"
goes** under the header (after 312) for admin seats. The CEO's `/ceo` gets
the bell but not the card (open decision 11.1).

---

## 3. The shells side by side

| | Media buyer (portal) | Client success | Creative | Editor | Sales |
|---|---|---|---|---|---|
| Layout | `components/AppLayout.tsx` | `components/AppLayout.tsx` | `components/AppLayout.tsx` | `src/App.tsx` `Shell` | `src/App.tsx` `Shell` |
| Rail | `components/AppSidebar.tsx` (shadcn `Sidebar`) | `components/AppSidebar.tsx` | `components/AppSidebar.tsx` | `components/Sidebar.tsx` (hand-built) | `components/Sidebar.tsx` (hand-built) |
| Rail places | `navItems` 55-85; groups in `SidebarNav` 296-411 | `navItems` 55-59 | `navItems` 59-64 | `PLACES` 59-76 | `lib/pages.ts` `PAGES` 39+ (also the dock, menu bar and search) |
| Team meetings row | in-app `NavLink` 345-353; CEO rail `elsewhere` 174-185 | `PortalGroup` rows 156-170 (team 164) | rows 165-179 (team 173) | `footLinks` 139-158 (team 150) | `doors` 178-202 (team 188) |
| Laptop top bar | none (`AppLayout.tsx:81-85`) | none | none | none | `MacOSMenuBar` (`App.tsx:277`; right group `MacOSMenuBar.tsx:95-121`) |
| Phone top | none; page starts at the top | slim bar `AppLayout.tsx:88-104` (menu, wordmark, Search) | slim bar `AppLayout.tsx:90-106` | slim bar `App.tsx:228-251` | header `App.tsx:287-315` (wordmark, owed chip, Search) |
| Phone tab bar | `MobileTabBar.tsx` (media buyer: Today, Clients, Ads, Library, Search, More; others: CEO, Admin, Data, Team, Clients, More) | none | none | none | `MacOSDock` + More (`App.tsx:374-395`) |
| Main padding | `AppLayout.tsx:86` (`pb-28` for the tab bar) | `AppLayout.tsx:105` | `AppLayout.tsx:113` | `App.tsx:252` | scroll div `App.tsx:272` (`pb` clears the dock) |
| Floating | `CommandPalette`, `HermesChat`, `MobileTabBar` (110-112) | `CommandPalette`, `HermesChat` (111-112) | `HermesChat` (128), `CommandPalette` (130) | `SearchBox` (315) | `SearchBox` (368) |
| Existing bell | `ClientAlerts` (88), media buyer pages only (`ClientAlerts.tsx:16-21`) | none | none | none | none |
| Card kit | `components/ceo/{SectionCard,StatTile,StatusChip,EmptyState}.tsx` | `components/kit.tsx` (PageHeader, StatTile, Chip...); `SectionCard` is local to `CsmPage.tsx:268` | none shared; local `Section`, `StatusChip` in `DashboardPage.tsx:86-160` | `components/bits.tsx` (StatTile, StatusChip, Section, Empty) | `components/kit.tsx` (SectionCard, StatusChip, StatTile, EmptyState) |
| ui primitives | full shadcn set incl. `popover`, `sheet`, Radix `dialog` | same | same | `animated-select`, `button`, `dialog` (own), `label`, `textarea` | `animated-select`, `dialog` (own) |
| Toasts | `sonner` | `sonner` | `sonner` | `lib/toast.tsx` (`toast.success/error`) | `lib/toast.tsx` |
| lucide-react | 0.562.0 | 0.562.0 | 0.562.0 | 1.47.0 | 1.48.0 installed |
| happy-dom for render tests | yes | yes | no | no | no |

Sources: `ls apps/*/src/components/ui`; each `package.json`; `node_modules/*/package.json`;
the files and lines named. The "CEO kit" is therefore not one import path:
only the portal has `components/ceo/`. A shared set must draw its own card
and chip to the DESIGN.md spec instead of importing a kit.

Every icon the proposal needs (Bell, BellDot, Check, CheckCheck, ChevronRight,
ExternalLink, X, ListTodo, Inbox, Ticket, MessageSquare, CircleCheck,
SquareCheck, Send, Clock) was found in all five installed lucide packages
(file grep; not checked by a build). DESIGN.md asks for ArrowUpRight on
external links; it is already used in both lucide lines
(`creative-director-cockpit/src/pages/DashboardPage.tsx:574`; sales and editor
not checked).

Tokens: `--card`, `--border`, `--muted-foreground`, `--primary`,
`--background`, `--warning`, `--destructive`, `--success` and `--mahara-teal`
exist in all five `src/index.css`. `--primary-ink` exists only in client
success and creative (grep counts 3, 3, 0, 0, 0), so a shared stylesheet
writes `var(--primary-ink, var(--primary))`.

---

## 4. What is shared and pinned today

From `scripts/check-shared.sh` (it runs in `ship.sh` before a build, per its
own header lines 1-8). `same` compares bodies with import lines dropped
(24-46); a few files are also checked with `cmp` (byte for byte).

| File | Apps | Rule |
|---|---|---|
| `src/lib/cockpits.ts` (cockpit icons, SOP links) | all five | body (`check-shared.sh:91-96`); md5 identical today |
| `src/lib/clarity.ts` | all five | body (91-96) |
| `src/lib/search.ts` | all five | body (84-87) |
| `src/auth/supabaseAccess.ts` | all five | byte for byte (`check-shared.sh:234-240`) |
| `src/components/ui/dialog.tsx` (dependency-free) | editor, sales | body (99) |
| `src/pages/IdeationPage.tsx`, `SwipePage.tsx`, `components/Foreplay.tsx`, `lib/foreplay.ts` | creative, media buyer, editor | body (49-53) |
| `src/lib/appointmentFeedback.ts`, `components/AppointmentFeedback.tsx` | media buyer, client success, creative | body (242-245) |
| `src/lib/askAiClient.ts`, `src/lib/personalEod.ts` | media buyer, client success, creative | body (202-205) |
| `clientUpdate.ts`, `lostNotes`, projections set, `reportPeriod.ts`, `kpi.ts`, `callCentre.ts`, `callRecording.ts`, billing set, deck parts | pairs of apps | as written in 59-252 |
| `@biomejs/biome` version | all five | one exact pin (226-232); `biome.json` is md5-identical in all five |

Identical but **not** pinned: `src/auth/SupabaseAuthProvider.tsx` in the
portal, client success and creative (one md5); `src/lib/auth.tsx` in the
editor and sales (`diff` empty). `lib/portal.ts` differs per app.

---

## 5. Who the signed-in seat is, and who that is in ClickUp

- **Portal, client success, creative:** `useCockpitAuth()` gives `client`
  (a Supabase client), `access`, `ready`, `email`, `roles`, `clients`,
  `cockpits`, `home`, `isAdmin`, `isCeo` (`SupabaseAuthProvider.tsx:22-38`).
- **Editor, sales:** `useWho()` gives `session`, `email`, `name`, `roles`,
  `cockpits`, `isAdmin`, `isCeo`, `ready`, `error` (`lib/auth.tsx:19-33`);
  the client is the module `supabase` (`lib/supabase.ts:4`).
- **Access itself** comes from `cockpit_get_my_access` and is checked
  against the verified auth user (`supabaseAccess.ts:141-202`). `home` is
  `/ceo` for the CEO, `/admin` for an admin, otherwise the first role's home
  (`supabaseAccess.ts:14-23, 102-109`).

None of this carries a ClickUp user. Read on 2026-10-26:

| Check | Result |
|---|---|
| Columns named `%clickup%` on seat tables | none on `cockpit_members`, `cockpit_people`, `team_people`; `editor_people` has only `via_clickup` and `clickup_seen_at` |
| ClickUp workspace members | 12 (MCP `clickup_get_workspace_members`; CT section 8 counted 10) |
| Active seats whose email equals a ClickUp member's email, by role set | admin+ceo+…: 1 of 2; admin+media_buyer+csm+creative+editor: 1 of 1; call_center: **0 of 2**; creative: 1 of 1; csm: 1 of 1; editor: 2 of 3; media_buyer: 2 of 2; sales: **0 of 1**. Total 8 of 13 |

The SQL compared emails inside the query and returned counts only. The
editor desk already relies on email matching for "Assigned to me"
(`JobsPage.tsx:23-27`), and `task-assignment-alerts` matches Slack people by
exact email (`hermes/task-assignment-alerts/README.md`, Behavior). So the
backend needs a per-seat ClickUp link, filled by email where it matches and
set by an editor (D17) where it does not. The shell only needs to know three
answers: linked, not linked, or the source could not be read.

---

## 6. Proposal: one shared set, pinned byte for byte

### 6.1 The files

Copied into **all five apps** at the same paths, byte for byte:

| File | Job | May import |
|---|---|---|
| `src/lib/tasksCore.ts` | Types; the order (overdue, then due today, then newest, D19); the first five; due words in Kuwait time ("2 days late", "Today 15:00", "Fri 31 Oct"); alert labels; the sentences for not linked, not read and empty | nothing (as `kpi.ts` is kept import-free, `check-shared.sh:111-121`) |
| `src/lib/tasksClient.ts` | The reads and writes against the RPCs in 6.3; one shared poll per tab (120 s, plus focus and visibility, never faster than 30 s, as `ClientAlerts.tsx:34-70`) so the card and the bell make one request | `type SupabaseClient` from `@supabase/supabase-js`, `./tasksCore` |
| `src/components/tasks/TaskPanel.tsx` | A dependency-free dialog: centred panel from `sm`, full-height sheet on a phone; Escape, click outside, focus kept inside and handed back. Built the way the editor and sales `ui/dialog.tsx` is (`video-editor-cockpit/src/components/ui/dialog.tsx:1-30`) | `react`, `react-dom`, `lucide-react` |
| `src/components/tasks/YourTasks.tsx` | The Today card: at most five rows, one line each, "See all n" | `react`, `react-router`, `lucide-react`, `@/lib/taskSeat`, `@/lib/tasksClient`, `@/lib/tasksCore`, `./tasks.css` |
| `src/components/tasks/AlertsBell.tsx` | The bell: unread count, the alert list in `TaskPanel`, Mark all read; `variant="row"` (a right-aligned row at the top of main, as `.client-alert-bar` in `components/launch/launch.css:20`) or `variant="icon"` (a 40px button for a phone bar or the sales menu bar); an optional `extra` list for the portal's launch notices | as above, plus `./TaskPanel` |
| `src/components/tasks/TaskFocus.tsx` | `TaskFocusHost`: opens when the address has `?focus=<taskId>`, closes on Escape or Back; the view itself (section 10.3) | as above |
| `src/components/tasks/tasks.css` | Classes for the card, rows, due spine, panel and checklist, on the shared tokens only | none |

Per app, **not shared**, one file each:

| File | Gives the shared set |
|---|---|
| `src/lib/taskSeat.ts` | `useTaskSeat()` → `{ client, ready, signedIn, cockpit, portalHref(path), inPortal }` and `toast`. Portal, client success, creative: from `useCockpitAuth()` and `sonner`. Editor, sales: from `useWho()`, `lib/supabase`, `lib/toast`, `lib/portal`. `cockpit` is `media_buyer`, `csm`, `creative`, `editor`, `sales` or `portal`; the server uses it to leave out a board that already has its own screen (editor: Video Pipeline). |

And one line in the already-pinned `src/lib/cockpits.ts` (all five): a
`requests` icon in `COCKPIT_ICON` (`cockpits.ts:20-32`), so "Ask a team"
carries the same mark in every rail, menu and search box.

Why a fresh `TaskPanel` instead of `ui/dialog.tsx`: the portal, client
success and creative `dialog.tsx` is Radix with another API
(`media-buyer-cockpit/src/components/ui/dialog.tsx:18,192`), so one body
cannot call both.

### 6.2 Pinning in `scripts/check-shared.sh`

Add one block before the summary (after line 252):

```bash
# Your tasks, the alerts bell and the focus view (PLAN.md D19): one set in
# all five apps, byte for byte, imports included. Each app's own adapter is
# src/lib/taskSeat.ts; nothing else in the set differs.
for f in src/lib/tasksCore.ts src/lib/tasksClient.ts \
         src/components/tasks/TaskPanel.tsx src/components/tasks/YourTasks.tsx \
         src/components/tasks/AlertsBell.tsx src/components/tasks/TaskFocus.tsx \
         src/components/tasks/tasks.css; do
  for app in "$MB" "$CD" "$ED" "$SA"; do
    if ! cmp -s "$CS/$f" "$app/$f"; then
      echo "DRIFTED  $f: copy $CS/$f to $app/"; fails=$((fails + 1))
    fi
  done
done
if grep -qE '^(import |export .* from )' "$CS/src/lib/tasksCore.ts"; then
  echo "IMPORTS  tasksCore.ts must stay import-free"; fails=$((fails + 1))
fi
for app in "$CS" "$MB" "$CD" "$ED" "$SA"; do
  [ -f "$app/src/lib/taskSeat.ts" ] || { echo "MISSING  $app/src/lib/taskSeat.ts"; fails=$((fails + 1)); }
done
```

plus an allow-list check on the component imports (react, react-dom,
react-router, lucide-react, `@supabase/supabase-js` types, `@/lib/taskSeat`,
`@/lib/tasksClient`, `@/lib/tasksCore`, `./…`), written the way the
`callCentre.ts` allow-list is (`check-shared.sh:134-140`). The variables
`CD`, `MB`, `ED`, `SA` are set at lines 17-20 and `CS` at 109.

### 6.3 What the shell needs from the backend (PROPOSAL, for the backend map)

Names are proposals; the backend part decides them. Every function is
`SECURITY DEFINER SET search_path = ''`, gates first (an active seat; a task
read or write only when the task is assigned to that seat's linked ClickUp
user, or the seat is admin or CEO), and returns plain states, never a bare
zero.

| Call | Returns | Used by |
|---|---|---|
| `cockpit_my_tasks(p_cockpit text)` | `{ asOf, sourceAt, ready, link: 'linked' \| 'not_linked', tasks: [{ taskId, title, clientName, clientTaskId, listName, status, dueAt, dueHasTime, overdue, priority, url, createdAt, checklist: { done, total } }] }` | `YourTasks`, "See all" |
| `cockpit_task_alerts(p_cockpit text)` | `{ asOf, sourceAt, ready, link, alerts: [{ id, version, kind: 'assigned' \| 'due_today' \| 'overdue' \| 'comment' \| 'mention' \| 'status', taskId, title, body, clientName, at, read }] }` | `AlertsBell` |
| `cockpit_task_alerts_seen(p_alerts jsonb)` | `{ ok }`; marks `{id, version}` read, as `cockpit_media_notices_seen` does (`supabase/migrations/20261024125012_media_clients_workspace.sql:68-82`) | `AlertsBell` |
| `cockpit_task_detail(p_task_id text)` | title, client, list, due, status, description excerpt, `sop_url`, checklists with items, the latest comments, the pending writes for this task | `TaskFocus` |
| `cockpit_task_act(p_task_id text, p_op text, p_payload jsonb, p_request_id uuid)` | `{ id, state: 'queued' }`; `p_op` is `tick`, `untick`, `comment` or `done`; it queues a ClickUp writeback row (D19) and an audit row; the view polls `cockpit_task_detail` until the read-back settles it | `TaskFocus` |

Alert rules per seat (which events, quiet hours, Slack DM on or off) are
read on the server; the bell only shows a link "Alert settings" to
`/requests/settings` for seats that pass the editor gate.

### 6.4 Tests (no installs)

- `apps/media-buyer-cockpit/scripts/tasks-core.test.ts`: order, first five,
  due words across Kuwait midnight, the three sentences.
- `apps/media-buyer-cockpit/scripts/your-tasks.test.tsx`: happy-dom render,
  as `scripts/appointment-feedback.test.tsx:1-30` does. At most five rows; the
  not-linked, not-read and empty sentences; `?focus=` opens the view, Escape
  closes it; a tick goes queued, then saved.
- The same render test may run in client success (happy-dom installed). The
  editor, sales and creative have no happy-dom; `check-shared.sh` keeps their
  copies equal to the tested one.
- Harness: the portal's `bun run harness` takes `?path=` (`src/dev/adsPageHarness.ts:8-9,129`)
  and already fakes `cockpit_media_client_notices` (`src/dev/launchHarness.ts:81`);
  fixtures for the 6.3 calls go beside it so `/dashboard`, `/team`, `/admin`
  and `/requests` render signed out at 390, 820 and 1440 (DESIGN.md,
  Checking a screen).

---

## 7. Exact changes per app

### 7.1 Media buyer and the portal (`apps/media-buyer-cockpit`)

| File | Change |
|---|---|
| shared set (6.1) + `src/lib/taskSeat.ts` | add |
| `src/components/AppLayout.tsx:88` | Replace `<ClientAlerts />` with `<AlertsBell variant="row" extra={launchNotices} />`, shown on every page in the layout (Today, Clients, Ads, Library, `/team`, `/performance`, `/requests`, `/admin`, `/ceo`, `/settings`), not only on the media buyer's (`ClientAlerts.tsx:16-21` limits it today). Mount `<TaskFocusHost />` next to `CommandPalette` (110). |
| `src/components/launch/ClientAlerts.tsx` | Keep its read of `cockpit_media_client_notices` and `cockpit_media_notices_seen` as the `extra` source, for media buyer, admin and CEO seats only (its own gate, 16-21). Once the shared feed is live, that function's `work` (task) half goes, so a task shows once (backend note, `20261024131543_launch_creative_imports.sql:81-136`). |
| `src/pages/CockpitPage.tsx` | `<YourTasks />` under `<ExceptionAlerts />` (4086) inside `id="tasks"`; remove `tasksCard` (2330-2446) and its ask form state; the ask becomes the focus view's comment. |
| `src/pages/team/TeamPage.tsx` | `<YourTasks />` after the header (157) when `cockpits.length === 0`. |
| `src/pages/AdminPage.tsx` | `<YourTasks />` after the header (312) for admin seats. |
| `src/auth/authenticated/AuthenticatedAppRoutes.tsx:119-126` | Add `/requests`, `/requests/settings` beside `/team` inside `AppLayout`, with no `RoleRoute` (every seat; the database gates). |
| `src/pages/requests/RequestsPage.tsx`, `RequestForm.tsx`, `RequestsSettings.tsx` | add (the queue and form screens belong to the requests part; listed here for the route) |
| `src/components/AppSidebar.tsx` | "Ask a team" `NavLink` to `/requests` after Team meetings (353), for every signed-in seat; the same row in the CEO rail's `elsewhere` (174-185). |
| `src/components/MobileTabBar.tsx:152-167` | In the non-media-buyer branch, a "Requests" cell after Team. The media buyer's bar is full (Today, Clients, Ads, Library, Search, More, 84-121); it reaches Requests through More. |
| `src/components/CommandPalette.tsx:105-110` | An "Ask a team" entry beside Team meetings, words "request ticket ask tech creative call centre". |
| `vite.config.ts:48-53` | No change: `/requests` is not on the service worker's denylist, so the portal app serves it. |

### 7.2 Client success (`apps/client-success-cockpit`)

| File | Change |
|---|---|
| shared set + `src/lib/taskSeat.ts` | add |
| `src/components/AppLayout.tsx` | `<AlertsBell variant="icon" />` in the slim bar before Search (95); `<AlertsBell variant="row" />` at the top of main (after 105), hidden below `lg`; `<TaskFocusHost />` beside `CommandPalette` (111). |
| `src/pages/CsmPage.tsx` | `<YourTasks />` after the tiles (2788). "Tickets raised today" (2832-2895) reads request rows. The Ask a team panel (2303-2340) and `TICKETS` (157-203) write through the request backend (section 9). "Client Success board" (2952-3005) stays until 11.3 is settled. |
| `src/pages/ClientPerformancePage.tsx:776-832` (`AddTask`) | Its team choices write a request, not a direct ClickUp task (section 9). |
| `src/components/CommandPalette.tsx:160-164` | "Add a task or raise a ticket" opens the same panel; no change to its words. |
| `src/components/AppSidebar.tsx:156-170` | "Ask a team" row to `${portal}/requests` after Team meetings (164). |

### 7.3 Creative director (`apps/creative-director-cockpit`)

| File | Change |
|---|---|
| shared set + `src/lib/taskSeat.ts` | add |
| `src/components/AppLayout.tsx` | bell icon in the slim bar before Search (97); row at the top of the content div (113), hidden below `lg`; `<TaskFocusHost />` beside `CommandPalette` (130). |
| `src/pages/DashboardPage.tsx` | `<YourTasks />` in `#morning` after 401. |
| `src/components/AppSidebar.tsx:165-179` | "Ask a team" row after Team meetings (173). |

### 7.4 Video editor (`apps/video-editor-cockpit`)

| File | Change |
|---|---|
| shared set + `src/lib/taskSeat.ts` | add |
| `src/App.tsx` | bell icon in the phone header before Search (241); row at the top of `<main>` (252), hidden below `lg`; `<TaskFocusHost />` beside `<SearchBox />` (315). |
| `src/pages/JobsPage.tsx` | `<YourTasks />` after the tally (before 267), list view only; the feed is asked with `cockpit = 'editor'` so Video Pipeline tasks stay on Jobs. |
| `src/components/Sidebar.tsx:139-158` | "Ask a team" in `footLinks` after Team meetings (150). |
| `src/components/SearchBox.tsx:148-176` | an "Ask a team" hit beside `page:team`. |

### 7.5 Sales (`apps/sales-cockpit`)

| File | Change |
|---|---|
| shared set + `src/lib/taskSeat.ts` | add |
| `src/components/MacOSMenuBar.tsx:95-121` | bell icon in the right group, before the theme button (laptop). |
| `src/App.tsx` | bell icon in the phone header's right group (292-314); `<TaskFocusHost />` beside `<SearchBox />` (368). The dock keeps its items (`lib/pages.ts`). |
| `src/pages/TodayPage.tsx` | `<YourTasks />` at the top of the right column (170). |
| `src/components/Sidebar.tsx:178-202` | "Ask a team" door after Team meetings (188). |
| `src/components/SearchBox.tsx` | an "Ask a team" hit (not read in detail). |

The sales app has its own `/team` route for managers
(`App.tsx:344-354`); the portal's Team meetings is `${portalUrl()}/team`, and
"Ask a team" is likewise `${portalUrl()}/requests`.

---

## 8. Where `/requests` lives

- **Route:** the portal (media buyer app), beside `/team` and
  `/performance` inside `AppLayout` and outside every `RoleRoute`
  (`AuthenticatedAppRoutes.tsx:119-126`), as PLAN.md 3.3 says. Settings at
  `/requests/settings` (PLAN.md 4.8).
- **From other cockpits:** a plain link `${portalUrl()}/requests`, the same
  origin, so the Supabase session carries over (`cockpitNavigation.ts:11`
  says same-origin navigation reuses the persisted session; each rail
  already links `${portal}/team` this way, section 3).
- **From Today:** "See all n" → `/requests?view=assigned` (portal) or
  `${portalUrl()}/requests?view=assigned`.
- **The focus view does not navigate.** It opens on `?focus=<taskId>` in
  whatever cockpit you are in. A Slack DM or an alert can link
  `{cockpit}/dashboard?focus=<taskId>`.
- **The Stage 1 settings page** for notices is in client success at
  `/client-success/notices`, open to every seat
  (`apps/client-success-cockpit/src/auth/authenticated/AuthenticatedAppRoutes.tsx:75-81`,
  `pages/NoticesPage.tsx`). `/requests/settings` and it should link to each
  other with one line each, so an editor finds both.

---

## 9. Requests raised from the cockpits today

| # | Where it is pressed | What it writes | Lands | Request Type | Owner | Live? |
|---|---|---|---|---|---|---|
| A | CSM client page "Ask a team" select (`CsmPage.tsx:2303-2340`, choices `TICKETS` 157-203); also the "Ask a team" link under commitments (1824-1829) and the palette's "Add a task or raise a ticket" (`CommandPalette.tsx:160-164`) | `cockpit_log_decision` with role `csm`, kind `ticket`, `metadata.reroutedTo` = the team (`useCsmSnapshot.ts:350-366`, routed there by `performAct` 380-396) | The writeback queue turns it into a task on the team's list plus a link comment on the client card (`supabase/functions/clickup-writeback/queue.ts:104,196-228`; lists `rules.ts:68-74`) | only for Tech, by fixed option id (`rules.ts:59-66`, two of them wrong per CT section 7); none for pause, relaunch or offboard | none | yes: 7 rows `delivered`, last 2026-10-21 (SQL on `cockpit_clickup_writeback_queue`) |
| B | CSM "Anything else, for you or a team" (`AddTask`, `ClientPerformancePage.tsx:776-832`, shown in the same panel at `CsmPage.tsx:2343-2350`) | `cockpit-csm-api` `act`, kind `ticket`, `department` (`lib/performance.ts:81-102`) | The function creates the task at once on the department list (`supabase/functions/cockpit-csm-api/core.ts:34-38,47`) | looked up by name (`core.ts:6-14,37`); only for the seven names there | none | reachable; not counted |
| C | Media buyer campaign panel "Send to …" (`CockpitPage.tsx:3400-3430`, choices `REQUESTS` 128-159) | `cockpit_log_decision` role `media_buyer`, kind `rerouted` | The writeback queue: a comment on the ads card, a task on the team's list, a link comment (`queue.ts:104-157`) | Tech only, same fixed ids | none | **no**: all 11 media buyer decision rows are `dry_run`, last 2026-10-21 |
| D | Media buyer "Card declined form" (`CockpitPage.tsx:3031-3053`) | opens the ClickUp form `2kzmr1ky-1218` in a new tab and logs a `rerouted` decision to client success | the form's own list rules on Marketing / ADs (CT F3: assign, a webhook, rename) | the list field "Request Type" `09abf737-…`, not the folder field | by the list rule | the form: yes; the decision: `dry_run` |
| E | Media buyer client page, Service tab, "Pause or offboard" (`components/launch/ClientService.tsx:146-390`) | `cockpit-media-api` `client.offboard` (`supabase/functions/cockpit-media-api/clientLifecycle.ts:35-47,68`) | one task on Operations / Tech `901816723190`, steps written in the description, client tag | "Client Offboarding Request 🔴", set in the create call by name | none | reachable behind the launch switch (`launchEnabled`, line 52); `cockpit_client_holds` has 0 rows today |
| F | Same tab, pause (`client.pause`) | pauses the Mahara campaigns and records the hold | no ClickUp task | none | none | as E |

`RequestCreativeButton` (`components/RequestCreativeButton.tsx`) writes the
creative request queue in Supabase, not ClickUp; it is not a team ticket and
stays as it is.

**How each moves to the request backend** (the backend part owns the
functions; the shell changes are in section 7):

- **A and B become one action.** The panel picks a request type (filtered to
  the types a CSM raises) instead of a free label, the client is the card,
  and it calls the request create function with the browser's request id.
  The function writes the request row, its audit row and a writeback row of
  kind `request` in one transaction (PLAN.md 3.3 "Write"); the queue creates
  from the template, sets owner, tag, due and priority, Request Type last,
  and links the client card. `csmTicketSteps` (`queue.ts:196-228`) and the
  `core.ts` ticket branch (34-38, 47) then retire, so one press is one
  ticket.
- **C** calls the same create function with the campaign's client. It goes
  live with the request switch, not with the media buyer decision switch
  that keeps 11 rows in `dry_run`.
- **D** stays as it is until the Marketing / ADs list rule's webhook is
  known (CT F3 and F12: the target of "call a webhook" was not read).
- **E** creates request type 10 ("Client Offboarding Request 🔴") with both
  tasks, Tech and Media, from `t-86ex629ve` and `t-86ex629x6` (PLAN.md 3.3
  row 10), deduped against a CSM offboarding by client tag and type (PLAN.md
  3.4). `offboardTask` (`clientLifecycle.ts:35-47`) is replaced by a request
  row written with the lifecycle intent; the media API stops calling
  ClickUp for it.
- **F** needs no new request: the CSM's confirmed pause opens the Tech and
  Media tickets (PLAN.md 3.2), and the media buyer's pause opens the hold.
  The Media pause ticket can show "the hold is on" in its focus view.

---

## 10. Design notes for the build (to follow PLAN.md 4.7)

Read for this map: `~/.cache/mahara-ship/mc/skills/frontend-design/SKILL.md`
and `~/.cache/mahara-ship/skills/hallmark/SKILL.md`. The cockpits' locked
system is `docs/DESIGN.md`; Hallmark treats such a file as overriding its own
picks (Hallmark, Pre-flight scan, item 0). These three pieces are
component-scope in Hallmark's terms: every interactive part ships default,
hover, focus-visible, active, disabled, loading, error and success.

### 10.1 Design plan

- **Tokens:** the cockpit's own, nothing new: `--card`, `--border`,
  `--muted-foreground`, `--primary` (Mahara teal, the one primary action),
  `--warning` (orange, due today), `--destructive` (late), `--success`
  (done), `var(--primary-ink, var(--primary))` for teal text in light mode.
- **Type:** Geist. Card title `text-[15px] font-semibold`, rows 13 to 14px,
  due words with tabular figures; Geist Mono only for the "Checked 14:02"
  timestamp (DESIGN.md, Brand). Titles in `dir="auto"`, Arabic falls back to
  IBM Plex Sans Arabic through the font stack.
- **Layout:** a card `rounded-2xl border bg-card`, a flush list, one line per
  row; no card inside a card (DESIGN.md, Cards).

```
┌ Your tasks  3 ─────────────────────────────────────────┐
│▌ Client Pause ⏸️ (Tech)        Client A    2 days late │
│▌ New Script Request✍️          Client B      Today     │
│  General Tech Request                          Fri 31  │
│ See all 8                                            › │
└────────────────────────────────────────────────────────┘
```

- **Signature:** the due spine, a 3px bar at each row's left edge, red when
  late, orange when due today, none otherwise. It is the media buyer's own
  client-state spine (`launch.css:20`, `.client-state-spine`), reused rather
  than invented, so the card reads as part of the cockpit.

### 10.2 "Not too busy"

- At most five rows, in the D19 order. A row is the title, then the client
  (hidden below `sm`), then the due word. One action: the row opens the
  focus view. No buttons on the row.
- The count sits beside the title only when above zero. "See all n" shows
  only when there are more than five.
- Sentences, each saying what to do next:
  - empty: "Nothing is assigned to you. New tasks show here within two minutes."
  - not linked: "Your seat is not linked to a ClickUp user, so your tasks cannot show here. Ask the systems manager to link it."
  - not read: "Your tasks could not be read just now. They are still in ClickUp. Try again in a minute."
  - stale: "Last read at 14:02." (only when older than the poll window)

### 10.3 The focus view

One task only, in `TaskPanel`: the title; one line with client, list and due;
the SOP checklist with ticks and "3 of 8 done"; the description folded; the
latest comments with "Show the rest"; a comment box; at the foot "Mark done"
(teal, the one primary) and "Open in ClickUp" (outline, ArrowUpRight).
States: "Opening…", "Saving…" on the item, "Saved", "Not saved: ClickUp
refused it. Try again.", "Waiting for ClickUp to confirm", "This task is not
assigned to you.", "This task was closed or moved in ClickUp." Copy keeps one
verb through the flow ("Mark done", then "Done").

### 10.4 The bell

"Alerts" with the unread count, as the media buyer's button reads today
(`ClientAlerts.tsx:107-120`); icon-only with an `aria-label` that says the
count in the phone bars and the sales menu bar. The list: newest first, a
dot for unread, the task title and one line ("Assigned to you", "Due today",
"2 days late", "A teammate commented", "Moved to review required"); a press
opens the focus view and marks it read. "Mark all read". The footer keeps
the media buyer's honest line about when it checks.

---

## 11. Open decisions, with the default this map proposes

1. **The CEO's `/ceo`:** the bell, no card. The CEO Today stays as it is.
2. **Seat link screen:** the per-seat ClickUp link is set on
   `/requests/settings` (editor gate, D17), filled by email where it
   matches; `/admin` shows "ClickUp: linked" or "not linked" beside each
   seat.
3. **Client success board card:** keep it below "Your tasks" until a week of
   reads shows the per-seat feed holds every open task the board showed for
   the CSM, then remove it.
4. **Creative script tickets twice:** show them in "Your tasks" too. The
   "Script requests" section is the client-by-client board; "Your tasks" is
   the person's list.
5. **Editor desk:** leave Video Pipeline tasks out of "Your tasks"
   (section 2.4).
6. **One "Ask a team" row, not two.** It opens `/requests`, whose first part
   is the form and the second "My requests".

---

## 12. Not verified

- No screen was built or rendered; the 390, 820 and 1440 checks are for the
  build.
- Icon names were found by grepping the installed lucide packages, not by
  compiling each app. ArrowUpRight was not checked in the editor and sales.
- Which ClickUp member each unmatched seat is. Two ClickUp members use
  personal addresses that may be the call centre agents; not matched here on
  purpose.
- That the creative-only seat is the ClickUp "creative strategist"
  (`113520400`) the plan's owner rules use. Its email matches a ClickUp
  member; which one was not written down.
- Whether `cockpit-csm-api`'s direct ticket path (row B) has been pressed
  since the queue path went live; its rows were not counted.
- The sales `SearchBox.tsx` entry list was not read.
- The "call a webhook" target of the Marketing / ADs Payment Failure rule
  (row D; CT F12).
- How many browser tabs the team keeps open, so the load of a 2-minute poll
  per tab per seat is estimated, not measured.
- Whether the installed portal app (PWA) can show an unread badge on the
  home-screen icon; not looked at.
