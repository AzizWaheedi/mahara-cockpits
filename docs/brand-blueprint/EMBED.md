# The Brand Blueprint inside the creative director cockpit

Design, 2026-10-24, for branch `bp-embed-1024` (from `origin/main` bbe66326, which has the live Brand Blueprint of `SPEC.md`). Nothing here is built, deployed or sent. People are named by role.

The CEO's ask (2026-10-24, verbatim): "And make the Brand Blueprint part not redirect them to the CSM cockpit, so it's actually part of the creative-director cockpit and doesn't have to redirect them every time. It's embedded into it."

---

## 0. The decision in one screen

| | Decision |
|---|---|
| What | The Blueprint call (prep, the shared deck, the notes window) opens **inside the creative director cockpit**, in the same tab, at `/creative/blueprint/:taskId`. The client success app's deck engine still draws it, inside a same-origin frame on a creative director (CD) page. No code is copied. |
| Why this and not a second copy of the engine | The engine is 74 files and about 54,500 lines (`apps/client-success-cockpit/src/present`), plus 21 other client success modules it imports. `scripts/ship.sh` deploys each app from its own folder (`vercel deploy --archive tgz` in `apps/<app>`), so the CD build on Vercel never sees the client success sources: a shared alias cannot build there, and a copy would be about 95 files (the engine and what it imports) pinned in `check-shared.sh`, with every deck fix made twice. Section 3. |
| Why it works | Both apps are on one origin in production (`cockpit.maharamedia.com`), keep the Supabase session under the same `localStorage` key, and get one header that allows same-origin framing (`frame-ancestors 'self'`, no `X-Frame-Options`, no `frame-src`). Checked on production on 24 Oct (section 2). A frame of `/client-success/...` on a `/creative/...` page is signed in, gated by the same seat rules, and shares `BroadcastChannel` with the notes window. |
| The flow | Client page, **Run the Blueprint call** → the call page in the same tab: the CD's header (back to the client, the three parts, Open the notes window) over the prep view. **Present** (in prep) → the deck takes the whole tab; **Full screen** (F) fills the monitor. **Notes** (N) → a small popup at `/creative/blueprint/:taskId/notes`. **End the deck** (the deck's Back) → "Deck closed", then Back to prep or Present again. The browser's Back while presenting keeps the deck up. |
| What changes | Client success app: a dormant "host mode" read from `?host=creative` inside a same-origin frame, only for the Blueprint deck (about 150 lines). CD app: two routes, the call page, the notes page, the card's buttons, a dev proxy, the harness (about 450 lines). One new 80-line import-free file, `deckHost.ts`, pinned byte for byte in both apps. One header line: the CD project's own policy gains `frame-ancestors 'self'` (its direct host could be framed by any site; nothing changes on the portal, which sends the media buyer's header). No SQL, no Edge Function. |
| What does not change | The CSM's onboarding and launch decks, their windows and routes; the server gate (`cockpit_blueprint_gate_for_actor`); every write path (`cockpit_blueprint_*` from the seat's own client); the CSM's own "Open the Blueprint deck". |
| Size | About half a day for one builder (client success part about 2 hours, CD part about 3, tests and shots about 1.5), or two builders in parallel. |

---

## 1. How the creative director reaches the Blueprint today

### 1.1 The path, window by window

| Step | Where | What happens | Source |
|---|---|---|---|
| 1 | CD client page `/creative/clients/:name` | The Blueprint card under the doc chips. **Run the Blueprint call** (teal before part 1 is sent), **Open part 1** (when part 1 is ready), **Finish part 2** (part 2 open after the call's time). | `src/components/BlueprintCard.tsx` 563 to 671 |
| 2 | New window `mahara-prep-{taskId}-blueprint` | `openPrep()` opens `${portalUrl()}/client-success/clients/{taskId}/present/blueprint?view=prep` (plus `#part1`/`#part2`, plus `&rehearse=1` and a `-rehearse` name in a rehearsal). `openNamed()` brings an open window forward instead of reloading it. | `src/lib/blueprint.ts` 495 to 562 |
| 3 | That window, client success app | `RoleRoute anyOf csm, creative` → `PresentPage deck="blueprint"` → `PresentApp view="prep"` → `PrepView` + `BlueprintPrep`. Its header has "← {client}" to `/client-success/clients/{taskId}?tab=onboarding`, a CSM-only page: a creative seat that clicks it gets "This cockpit isn't yours". | `src/auth/authenticated/AuthenticatedAppRoutes.tsx` 71 to 96, `src/present/PresentPage.tsx` 45 to 73, `src/present/PrepView.tsx` 150 to 191 |
| 4 | New window `mahara-deck-{taskId}-blueprint` | Prep's **Present** flushes the saves and opens the shared deck (`PresentApp` 249 to 263). The CD shares that window on the call. | `src/present/PresentApp.tsx` |
| 5 | Popup `mahara-notes-{taskId}-blueprint`, 520 x 820 | The deck's **Notes** button or N opens `/client-success/clients/{taskId}/present/blueprint/notes`: the private fields, the part buttons, "What media gets". Its footer says "Share the deck window only, maximised rather than full screen, so you can reach this window." | `PresentApp.tsx` 115 to 118, `NotesWindow.tsx` 818 to 821 |
| 6 | Back on the deck | `window.close()` and focus the opener; a window opened by hand shows "Deck closed". | `PresentApp.tsx` 119 to 131 |
| 7 | The CD card | Reads `cockpit_blueprint_read` on focus (5 s throttle) and at once when `BroadcastChannel("mahara-deck:{taskId}:blueprint")` carries `bp-part` (queued, done, failed, reconcile). | `BlueprintCard.tsx` 398 to 439 |
| 8 | Part 3 | Stays on the card: the offer slip and **Lock the offer**. The dashboard's "Lock the offer" lands on the client page at `#blueprint`. | `BlueprintCard.tsx`, `BlueprintSignoff.tsx` 142, 201 |

So one call puts the CD in three windows whose addresses read `/client-success/...`, with the client success app's sidebar skeleton showing while the sign-in is checked (`ProtectedRoute.tsx` 79 to 81), and a back link into the CSM cockpit that refuses him.

### 1.2 Rehearsal, the harnesses, the gates

- **Rehearsal:** `?rehearse=1` on the client page, for admins and the CEO (`BlueprintCard.tsx` 176 to 180). The flag rides in every window's address; each window reads it from its own address (`PresentApp.tsx` 87 to 95), and the deck honours it only when the server says the seat may rehearse (`can.rehearse` from `cockpit_blueprint_sources`, `useBlueprint.ts` 229). Rehearsal windows have their own names and their own channel (`…:rehearse`), so they never reach a real window.
- **CD harness:** `apps/creative-director-cockpit/blueprint-harness.html?view=card|dashboard|settings&bp=…` (`src/dev/blueprintHarness.tsx`) draws the card, the dashboard rows and Settings from `src/dev/blueprintFixtures.ts`. It cannot show the call.
- **Deck harness:** `apps/client-success-cockpit/present-harness.html?deck=blueprint&view=prep|present|notes&fixture=…&bp=…` (`src/dev/presentHarness.tsx`) draws every view from `src/practice/fixtures/blueprintFixtures.ts`, saves in memory.
- **Gates:** the CD app's routes sit behind `ProtectedRoute` and `RoleRoute role="creative"` (admins and the CEO pass). The deck's routes sit behind `RoleRoute anyOf={["csm","creative"]}`; `/present/onboarding` and `/present/launch` stay `RoleRoute role="csm"`. The server decides every read and write (`cockpit_blueprint_gate_for_actor`, `cockpit_blueprint_sources`, `cockpit_blueprint_save`, `cockpit_blueprint_part_done`).

---

## 2. Auth, the session and the headers across `/creative` and `/client-success`

- **One sign-in already.** Both apps build the Supabase client with `createCockpitSupabaseClient()` (`src/auth/supabaseAccess.ts`, identical in both apps) with no `storageKey`, so the session lives in `localStorage` under supabase-js's default key `sb-bldgtotkfmhoxmlzowdx-auth-token`. `localStorage` is per origin, not per path, and `/creative`, `/client-success` and the media buyer's `/` share the origin `cockpit.maharamedia.com` through the media buyer project's rewrites (`apps/media-buyer-cockpit/vercel.json`). `SupabaseAuthProvider.tsx` is identical in the CD, client success and media buyer apps (154 lines each). The theme is shared the same way (`localStorage["theme"]`, `ThemeContext.tsx` identical).
- **A same-origin frame is the same storage.** A frame whose origin equals its top page's origin gets the top page's storage partition, so the frame reads the same session and signs in nobody. Two auth clients (the page and the frame) refresh the token under supabase-js's per-key lock, as the CD tab and the client success windows already do today.
- **What browsers get on production** (`curl -D -` on 24 Oct, `/creative/`, `/client-success/`, `/client-success/clients/x/present/blueprint`): one header, from the media buyer project, on every path:
  `content-security-policy: connect-src 'self' https://bldgtotkfmhoxmlzowdx.supabase.co wss://bldgtotkfmhoxmlzowdx.supabase.co; frame-ancestors 'self'`
  No `X-Frame-Options`. No `frame-src` and no `default-src`, so a `/creative` page may frame `/client-success`, and `/client-success` accepts a same-origin parent. The client success project's own `frame-src` list (Loom, YouTube, Wistia and the rest, in its `vercel.json`) is not what the portal sends.
- **Two traps this design pins with a test (section 7):** if someone later adds `frame-src` to the media buyer header, it must include `'self'`, or the call page goes blank; and `X-Frame-Options: DENY` (which the editor and sales apps send on their own projects) must never reach `/creative` or `/client-success`.
- **The direct hosts** (`mahara-creative-director.vercel.app`, `mahara-client-success.vercel.app`) are separate origins with separate storage. On them the call page says the Blueprint opens on the portal (state "wrong host", 4.6). `portalUrl()` already sends cross-cockpit links to the portal for the same reason.

**Probes run for this design on 24 Oct** (system Chrome through Playwright, throwaway pages in the scratchpad, nothing in the repo, everything deleted after):
1. A same-origin frame without an `allow` attribute can call `requestFullscreen()` on its own document; so can a frame with `allow="fullscreen"`; the parent reports the frame as its fullscreen element.
2. A click inside the frame gives the parent page transient activation: a `postMessage` from the click made the parent's `requestFullscreen()` on the frame succeed.
3. `BroadcastChannel` messages and `localStorage` values cross between the page and its frames.
4. With a dev proxy (`/client-success` on the CD dev server forwarded to the client success dev server), a `/creative/` page framed `/client-success/present-harness.html?deck=blueprint&view=prep&fixture=full&bp=part1`: the Blueprint prep drew in 1.1 s, same-origin access worked, no page errors.

Headless Chrome; the headed check is in section 8.

---

## 3. The options, weighed

| Criterion | **A. Same-origin embed** of the deck routes in a CD page | B1. Compile the engine into CD by alias | B2. Copy the engine into CD, pinned | B3. A shared workspace package | C. Rewrite `/creative/blueprint/*` to the client success app | D. Keep the windows, give them `/creative` addresses |
|---|---|---|---|---|---|---|
| No jump to another cockpit, no new tab for the call | Yes | Yes | Yes | Yes | Address only: the page is still the client success app, no CD sidebar | No: still three windows |
| One sign-in | Yes (2) | Yes | Yes | Yes | Yes | Yes |
| A creative-only seat works | Yes: both route gates already pass it | Needs the client success auth context mounted inside CD | Same as B1 | Same as B1 | Yes | Yes |
| Full screen, notes, `BroadcastChannel` | Yes, probed (2) | Yes | Yes | Yes | Yes | Yes |
| Rehearsal | Unchanged | Unchanged | Unchanged | Unchanged | Unchanged | Unchanged |
| No code drift | One 80-line protocol file, pinned | None, if it built | About 95 files pinned; every fix twice | None | None | None |
| Builds on today's deploy | Yes | **No**: `ship.sh` uploads only `apps/creative-director-cockpit`; the deck's `@/` imports would also resolve to CD's `src`, and its `useCockpitAuth` is a different React context | Yes | **No** without moving the deploy to the monorepo root and a workspace install | Needs a media buyer rewrite and a client success router that accepts two base paths | Yes |
| CD harness without signing in | Yes, framing the deck harness | Yes | Yes | Yes | Hard | Yes |
| A few hours | Yes | No | No (days) | No (days, and every CSM deck re-tested) | Close, but not what was asked | Yes, but fails the ask |
| CSM's decks unchanged | Yes: host mode only for the Blueprint deck in a frame | Risky (moved imports) | Yes | Every deck re-tested | Yes | Yes |

**A wins.** Its costs, said plainly: the CD page loads a second app in the frame (the client success shell and the deck chunk, about 1 s cold in dev, cached after, the same bytes the windows load today); two apps must agree on five messages (kept in one pinned file); and the call page works only on the portal origin (and in dev through the proxy). B3 is the right long-term shape if a second cockpit ever needs the engine; it is not needed for this ask.

---

## 4. The design

### 4.1 Routes and addresses

| Address | App | Inside | What it is |
|---|---|---|---|
| `/creative/blueprint/:taskId` | CD | `ProtectedRoute` → `AppLayout` → `RoleRoute role="creative"` | The call page: the CD header over the prep frame, and the presenting layer over everything. `#part1`, `#part2`, `#part3` go to the frame; `?rehearse=1` goes to every frame (the server's `can.rehearse` decides, admins and the CEO). |
| `/creative/blueprint/:taskId/notes` | CD | `ProtectedRoute` → `RoleRoute role="creative"`, **outside** `AppLayout` | The notes popup: a frame of the notes view that fills the window. |
| `/client-success/clients/:taskId/present/blueprint?view=prep&host=creative&notes=…` | client success | unchanged routes | The prep, in host mode. |
| `/client-success/clients/:taskId/present/blueprint?host=creative&notes=…` | client success | unchanged | The shared deck, in host mode. |
| `/client-success/clients/:taskId/present/blueprint/notes?host=creative` | client success | unchanged | The notes view, in host mode. |

- Keyed by the ClickUp task ID, as the record, the deck, its channel and every window name already are: the frame starts at once (no 1 s `cockpit_creative_source_read` to turn a name into an ID), a renamed client card never breaks an open call, and the client success side can build the notes address from its own key.
- `AppSidebar.tsx`'s `INSIDE` map gains `"/clients": ["/blueprint"]`, so **Clients** stays lit: the call is visibly part of the client.
- `:taskId` must match `^[A-Za-z0-9_-]{1,40}$` (the rule `readBlueprints` already applies); anything else draws the "no such card" state and loads no frame.
- The card hands the client's name and status in router state (`navigate(path, { state: { clientName, status } })`). `history.state` survives a reload, so F5 mid-call keeps the name at once; a pasted address takes the name from the record (`cockpit_blueprint_read` → `clientName`), then from the frame's `ready` message.

### 4.2 The call page

**Design plan** (the cockpit's own system, `docs/DESIGN.md`; nothing new):
- **Subject and job.** The CD, 15 minutes before and during a 45-minute call. The page has one job: take him from prep to presenting without leaving the cockpit, and keep prep off the client's screen.
- **Tokens.** Deep Space ground (`--background`), cards one step lighter, `--border` hairlines; Geist for words, Geist Mono for part numbers and times; the card's dots (`--success` sent, `--primary` live or ready, `--warning` changed or unconfirmed, `--destructive` needs a look, muted for not yet). Teal stays on one action, Present, which lives in the prep toolbar inside the frame. No new colour, font or radius.
- **Layout.** The header block at the stage's width (built: see 11; the same back link as `ClientPage.tsx`), then the stage, full-bleed: negative margins cancel `AppLayout`'s padding below the header, and the frame's height is the viewport below its own top edge (measured on mount and resize, at least 560 px), so the frame scrolls inside and the page never shows two scrollbars. The frame reaches the window's right edge, so its scrollbar is where every cockpit page has one; a wheel over the header scrolls the prep (11.1).
- **Signature: the seam.** The frame sits flush under one hairline that runs the page's width, with no card around it, so the prep reads as the lower half of the CD page, not a box inside it. The one other new thing is the parts rail: the card's three rows folded into one line. Everything else is quiet.

```
┌ rail ───┬──────────────────────────────────────────────────────────────────────┐
│ Today   │ ← Noor Studio Interiors                                              │
│ Clients●│ Brand Blueprint call                          [Open the notes window]│
│ Library │ 1 Starter ads ● Sent Wed 22 Oct 10:12   2 Brand and money ● In       │
│ Social  │   progress (1 of 11)   3 The offer ○ Opens when the call closes      │
│ …       │ Present fills this tab with the deck. Share only this tab on the call.│
│         ├──────────────────────────────────────────────────────────────────────┤ ← the seam
│         │ (frame) 14 of 14 slides ready          English | العربية   [Present] │
│         │ ┌ live preview of the deck ──────────────┐ ┌ slide 1 · settings ────┐│
│         │ │                                        │ │ The parts …            ││
│         │ └────────────────────────────────────────┘ └────────────────────────┘│
│         │ [Back] [Next]  Slide 1 of 14     1 · 2 · 3 … the strip               │
│         │ Ready check · Confirm part 1 · Still missing · The whole form …      │
└─────────┴──────────────────────────────────────────────────────────────────────┘
```

- **The parts rail** says only what the record holds and the prep cannot see: where each part was sent (11.1). A part sent, sending, changed or needing a look reads in the card's own words and dots (`stateView` and `Dot`, exported from `BlueprintCard.tsx`); a part not sent yet says "Not sent yet", "Call not closed yet", "Opens when the call closes" or "Not locked yet" (`railView`). Progress ("In progress · 5 of 8") is the prep's "The parts" panel's alone. No buttons. It reads the record (`readBlueprints`) on mount, on window focus (5 s throttle), and at once on `bp-part` and `bp-saved` from the call's channel (not in a rehearsal), exactly as the card does. It says what the record holds; the prep's "The parts" panel says what is typed in this call, in the one format `In progress · n of m` (that panel's old "In progress (n of m)" changed with it, for the CSM's windows too). A failed read shows the card's sentence ("The Blueprint record could not be read: … Read it again"), never "Not started".
- **Open the notes window** (outline) opens the popup from the page itself, so the CD can put it on his second screen before the call. Same window name as the deck's N (`mahara-notes-{taskId}-blueprint`, `-rehearse` in a rehearsal), so there is only ever one.
- **In the frame (host mode)** the prep toolbar drops its "← {client}" link and its "Prepare the Brand Blueprint deck" title (the CD header holds both) and keeps the ready count, the language switch and **Present**. It has no rule of its own (the seam is the one rule), sticks to the top as the prep scrolls, and ends where the CD header ends (11.1). Its explanatory line ends at "Back, Next and the strip move it.": the CD header already says what Present does.
- A hash on the CD address (`#part2` from **Finish part 2**) is passed in the frame's address; a later change is forwarded to the frame's `location.hash`. The Blueprint prep scrolls to `#part1` to `#part3` once its data is drawn and on `hashchange` (a fix that also helps the CSM's windows, which today land at the top).

### 4.3 Present, full screen, and back

- **Present** (prep toolbar) flushes the prep's saves, then asks the host to present. The host shows the **presenting layer**: a `fixed inset-0` layer above everything (`z-[60]`, over HermesChat's `z-40` and dialogs' `z-50`; `AppLayout`'s page wrapper animates opacity only, so `position: fixed` reaches the viewport) on the deck's ground (the `--deck-ground` token, Deep Space), holding a second frame with the shared deck. The prep frame stays mounted beneath it, `inert`, so it keeps its place and no key reaches it. When the deck says `ready`, the host focuses the deck frame, so arrows, Space, N, F and L go to the deck. While the layer is up, the browser's Back (a trackpad swipe, the mouse's back button, Cmd+[) does nothing: a guard history entry with the router's own state is pushed and pushed again on each Back, and taken off when the layer goes, as the old deck window had no history to go back to.
- **The tab is the shared screen.** Present fills the tab, not the monitor, so the notes popup stays reachable on one screen. This keeps the deck's standing advice ("maximised rather than full screen, so you can reach this window"); the CD shares the tab ("Share this tab" in Chrome and Meet) instead of a window, and the client sees only the deck.
- **Full screen** (the deck's own button and F) works unchanged: the deck frame calls `requestFullscreen()` on its own document, which a same-origin frame may do (probe 1); the layer carries `allow="fullscreen"` and `allowfullscreen` anyway. Esc leaves full screen and the deck still fills the tab.
- **End the deck** (the deck's Back, which in host mode reads "End the deck" / "سكّر العرض", since it never goes to the client) leaves full screen if it is on, shows the deck's existing closed screen ("Deck closed" / "انتهى العرض"), and tells the host, which puts two small buttons on it, in the deck's language (the deck frame's document carries it): **Back to prep** and **Present again** ("رجوع للتحضير", "اعرض مرة ثانية"). Prep never appears on a shared tab by surprise: leaving takes a second, deliberate press. **Back to prep** removes the deck frame; its `pagehide` posts `closed` on the channel, and the notes window shows its recap, as when the deck window closes today. **Present again** draws a fresh deck at the cover; the notes window rejoins mid-call as it does today.
- Leaving the page mid-prep keeps typed answers: removing a frame fires `pagehide`, and the Blueprint saver already flushes on it (`useBlueprint.ts` 419 to 430).

### 4.4 The notes window

- Opened by the deck (N, Notes) or by the CD header, always at `/creative/blueprint/:taskId/notes` (plus `?rehearse=1`), named `mahara-notes-{taskId}-blueprint(-rehearse)`, `popup,width=520,height=820` as today.
- The CD page fills the popup with one frame of `/client-success/clients/:taskId/present/blueprint/notes?host=creative`, no sidebar, and titles the window "Notes · {client}". The notes view itself is unchanged; its talk track, part buttons, Open the pack and Check the booking (GHL, in its own window, as SPEC 0.1 decided) all work as they do.
- In host mode its two window-shaped lines change: the footer reads "Share only the Blueprint's tab on the call. The deck fills it; this window stays private." and the header's "open the deck window to follow it here" reads "press Present to follow it here".
- The documents the script shares mid-call (the offer sheet, the starter pack, Brand DNA, Drive) still open in their own windows: they are Google's pages and are never framed (SPEC 0.1 8). Only the call itself stays in the cockpit.

### 4.5 The frame protocol (`deckHost.ts`)

One import-free file, byte for byte in both apps: `apps/client-success-cockpit/src/present/deckHost.ts` and `apps/creative-director-cockpit/src/lib/deckHost.ts`, pinned by a new line in `scripts/check-shared.sh` (the same `same` + `cmp` pair the deck's layout files use).

```ts
export const DECK_HOST = "mahara-deck-host";   // envelope source
export const DECK_HOST_V = 1;
export type FrameMessage =
  | { type: "ready"; view: "prep" | "present" | "notes"; name: string } // data drawn
  | { type: "failed"; message: string }   // the deck's own sentence (server refusal, read failed, crash)
  | { type: "present" }                   // prep's Present
  | { type: "end" }                       // the deck's Back
  | { type: "signed-out" };               // the frame has no session
export function frameMessage(m: FrameMessage): object;          // adds {source, v}
export function readFrameMessage(data: unknown): FrameMessage | null; // validates, else null
export const isTaskId = (s: string) => /^[A-Za-z0-9_-]{1,40}$/.test(s);
export function creativePath(p: string | null): string | null;  // only "/creative/…", no "//", "\", spaces; ≤ 400 chars
export function blueprintFrame(taskId: string, o: {
  view: "prep" | "present" | "notes"; rehearse?: boolean; notes?: string; at?: "part1" | "part2" | "part3";
}): string;                                // "/client-success/clients/{id}/present/blueprint…?…&host=creative"
export function blueprintCall(taskId: string, rehearse?: boolean): { call: string; notes: string };
                                           // "/creative/blueprint/{id}" and "/creative/blueprint/{id}/notes"
export const notesWindowName = (taskId: string, rehearse = false) =>
  `mahara-notes-${taskId}-blueprint${rehearse ? "-rehearse" : ""}`;
```

- **Host mode** is on only when all hold: `?host=creative` in the frame's address, the deck is `blueprint`, the window is framed (`window.parent !== window`), and the parent is same-origin (reading `window.parent.location.origin` does not throw and equals ours). Anything else is today's behaviour, so the onboarding and launch decks, and a host-mode address pasted into a tab, behave as now.
- **Posting:** `window.parent.postMessage(frameMessage(m), location.origin)`. **Receiving:** the host accepts a message only when `e.origin === location.origin`, `e.source` is that frame's `contentWindow`, and `readFrameMessage` returns a value.
- **The notes address** in host mode is `creativePath(searchParams.get("notes")) ?? blueprintCall(taskId, rehearse).notes`. The override exists for the CD harness (6), which opens its own notes view; it can only name a `/creative/` path on this origin.
- **The host also watches the frame's own address.** On each frame `load` it reads `contentWindow.location.pathname` (same origin); if the frame is anywhere but its Blueprint path (a sign-in page, a CSM page), the host hides it and shows its own state. The CSM cockpit can never show inside the CD page, even through an unforeseen redirect.

### 4.6 States

| State | Where | What shows |
|---|---|---|
| Loading | Call page stage | The CD header draws at once (name from router state, or a skeleton line). The stage says "Opening the Blueprint…" on the cockpit ground; the frame fades in (140 ms, none under reduced motion) on `ready`. |
| Slow or never opened | Stage, after 15 s with no `ready` | "The Blueprint did not open." · "Reload it. Nothing you saved is lost." · **Reload** (mounts the frame again). |
| Refused or failed | Stage, on `failed` | "The Blueprint did not open." over the deck's own sentence as the quiet line (the server's refusal through `problem()`, a read that failed, the deck's crash screen, or the client success app's root crash in a host frame) · **Reload** · "Back to {client}" ("All clients" with no name). |
| No seat | Call page | The CD's `RoleRoute`: "This cockpit isn't yours" (unchanged). A CSM keeps her own route at `/client-success/…`. |
| Signed out | Call page and frames | The CD's `ProtectedRoute` sends the page to `/creative/login?next=…` (unchanged). A frame in host mode never shows the client success sign-in or its sidebar skeleton: while the session is checked it says "Opening…", and with no session it says "Sign in to the cockpit again." and posts `signed-out`. The page then shows that line with **Sign in** (signs this browser out, so the CD's own gate sends him to `/login?next=/blueprint/:taskId` and back) and a quiet Reload. |
| Offline when opening | Stage | "You're offline. The Blueprint opens when the connection is back." The frame mounts on the `online` event. |
| Offline mid-call | Header chip, only once the prep is open | "Offline: what you type saves when the connection is back." (the saver retries; `blueprint-saver.test.ts` covers it). The prep and the open deck keep working. Offline before the prep opens, only the stage line shows. |
| Present while offline, or the deck fails | Presenting layer | "The deck did not open." · **Back to prep**. |
| Wrong host (a `*.vercel.app` address or a preview) | Call page | "The Blueprint opens on cockpit.maharamedia.com." · **Open it there** (the same path on the portal). |
| Not a card ID | Call page | "No client card with that ID." · "All clients". |
| Rehearsal | Header | The card's callout: "Rehearsal: nothing is saved or sent. Each press shows its plan." The rail reads the real record; the channel is not listened to. |
| Read only (a CSM or a seat that may not write) | Header | The card's line: "Only the creative director sends the parts." |

### 4.7 Copy, in full

| Where | Text |
|---|---|
| Card, **Run the Blueprint call** (a link now, so Cmd-click still opens a tab if he wants one) | title: "Opens the call here: prepare it, then Present" |
| Card, part 1 ready | "Ready: Send to media on the call" (was "… from the call window") |
| Call page, back link | "{client}" with the leading `ArrowLeft`, as `ClientPage.tsx` writes "All clients" |
| Call page, title | "Brand Blueprint call" |
| Call page, hint | "Present fills this tab with the deck. Share only this tab on the call." |
| Call page, button | "Open the notes window" |
| Deck (host mode), its Back | "End the deck" · "سكّر العرض" |
| Presenting layer, after End the deck | "Back to prep" · "Present again" (Arabic deck: "رجوع للتحضير" · "اعرض مرة ثانية") |
| Prep (host mode), explanatory line | "The preview is live: tick, type and pick on it as you will on the call. Back, Next and the strip move it." |
| Notes (host mode), footer | "Share only the Blueprint's tab on the call. The deck fills it; this window stays private." |
| Notes (host mode), header | "press Present to follow it here" |
| Frame (host mode), session | "Opening…" · "Sign in to the cockpit again." (the page adds **Sign in** · Reload) · a crash: "The Blueprint could not be drawn." |
| Notes page | window title "Notes · {client}"; "Opening the notes…"; "The notes did not open. Reload this window." · **Reload** |
| States | as in 4.6 |

---

## 5. What changes, app by app

### 5.1 Client success app (`apps/client-success-cockpit`)

| File | Change |
|---|---|
| `src/present/deckHost.ts` (new) | 4.5, pinned twin. |
| `src/present/useHost.ts` (new, about 30 lines) | `useHost(taskId, deck)`: the host-mode test of 4.5 (memoised), `post(m)`, and `notes` (the address and window name). Returns `null` when host mode is off. |
| `src/present/PresentApp.tsx` | With a host: `openNotes` opens `host.notes` under `notesWindowName`; `back` leaves full screen, sets `closed`, and posts `end`; prep's `links.present` flushes and posts `present` (no window); posts `ready` when the data is first drawn and `failed` when `model.error` has no data. Hands `host` to `PrepView` and `NotesWindow`. Without a host, nothing changes. |
| `src/present/PrepView.tsx` | With a host: hide the back link and the title; the explanatory line of 4.7. For the Blueprint, scroll to `#part1` to `#part3` after drawing and on `hashchange`. |
| `src/present/NotesWindow.tsx` | With a host: the two lines of 4.4. |
| `src/components/ProtectedRoute.tsx`, `src/components/FrameLine.tsx` (new) | In a host-mode frame: "Opening…" instead of `AppSkeleton`; "Sign in to the cockpit again." and `post signed-out` instead of `Navigate` to `/login`. |
| `src/components/ErrorBoundary.tsx` | The root boundary in a host frame (a stale chunk after a deploy): posts `failed` and draws one plain line, never the stack trace. |
| `src/present/DeckBoundary.tsx` | `DeckRouteBoundary` posts `failed` in host mode; reports from a host frame carry `p_app` and `p_role` creative (`cockpit_submit_issue_report` takes an app only with its own role). |
| `src/present/DeckShell.tsx`, `src/present/content.ts` | `endsInPlace`: the deck's Back reads "End the deck" / "سكّر العرض" (`CHROME.end`) in host mode. |
| `src/present/BlueprintFields.tsx` | "In progress · n of m", the one progress format. |
| `src/dev/presentHarness.tsx` | The doc comment lists `host=creative` and `notes=`; `PresentApp` reads them itself, so the harness needs no code. |
| `scripts/blueprint-host.test.tsx` (new) | Section 7. |

Not touched: full screen in `DeckShell.tsx` (it works from a frame as it is), `PresentPage.tsx`, the routes, `useDeckModel.ts`, `channel.ts`, every slide, `present.css`, the byte-pinned deck files (`layout.ts`, `figure.ts`, `fig.tsx`, `platforms.tsx`) and every `src/lib` file in `check-shared.sh`.

### 5.2 Creative director app (`apps/creative-director-cockpit`)

| File | Change |
|---|---|
| `src/lib/deckHost.ts` (new) | 4.5, pinned twin. |
| `src/components/DeckFrame.tsx` (new, about 110 lines) | The `<iframe>` (`title`, `allow="fullscreen"`, `allowfullscreen`, no sandbox: it needs storage, scripts and popups on our own origin), the message bridge (origin, source and envelope checks), the 15 s `ready` timer, the address watch of 4.5, the offline wait, `inert` when told, and the fade-in. |
| `src/pages/BlueprintCallPage.tsx` (new, about 220 lines) | 4.2, 4.3, 4.6: the header, the parts rail, the stage, the presenting layer with its two buttons, the states, the Back guard and `--host-end`. Reads `?rehearse=1` for admins and the CEO, as the card does. |
| `src/components/AppLayout.tsx`, `src/lib/blueprint.ts` | No Ask Hermes on the call (`isBlueprintCall`). |
| `src/components/ProtectedRoute.tsx`, `src/components/RoleRoute.tsx` | The notes popup keeps one centred "Opening the notes…" while the sign-in and the seat are checked (`isNotesPopup`, `NotesOpening`); `NotYourCockpit` exported for the harness. |
| `src/index.css` | `--deck-ground`, `--deck-ink` (Tailwind `deck-ground`, `deck-ink`) for the presenting layer. |
| `vercel.json` | `frame-ancestors 'self'` added to the project's own policy (its direct host). |
| `src/pages/BlueprintNotesPage.tsx` (new, about 50 lines) | 4.4. |
| `src/pages/index.ts` | Exports both. |
| `src/auth/authenticated/AuthenticatedAppRoutes.tsx` | `/blueprint/:taskId` inside `AppLayout`'s `RoleRoute role="creative"`; `/blueprint/:taskId/notes` in its own `RoleRoute role="creative"` outside `AppLayout`. |
| `src/components/AppSidebar.tsx` | `INSIDE["/clients"] = ["/blueprint"]`. |
| `src/components/BlueprintCard.tsx` | **Run the Blueprint call**, **Open part 1**, **Finish part 2** become links to `/blueprint/{taskId}` (`#part1`, `#part2`, `?rehearse=1` carried) with router state `{clientName, status}`; the copy of 4.7; export `stateView` and `Dot` for the rail. |
| `src/lib/blueprint.ts` | Remove `prepUrl` and `openPrep`; keep `openNamed` (the header's notes button uses it). The header comment says the call opens in the cockpit. |
| `vite.config.ts` | `server.proxy` for `/client-success` (with `ws`) to `process.env.CS_DEV` when set, so dev mirrors the portal's one origin. Nothing changes for the build. |
| `src/dev/blueprintHarness.tsx`, `src/dev/blueprintFixtures.ts` | Section 6. |
| `scripts/blueprint.test.tsx` | The window test ("Run the Blueprint call opens the prep window by name…") is replaced by the link test of section 7. |
| `scripts/blueprint-call.test.tsx` (new), `scripts/blueprint-call-shots.mjs` (new) | Sections 7 and 6. |

### 5.3 Elsewhere

- `scripts/check-shared.sh`: one pin, `same deckHost` plus a `cmp` (both copies import-free, byte for byte).
- No change to `apps/media-buyer-cockpit/vercel.json` or the client success `vercel.json`, any migration, any Edge Function, hermes or the reliability monitor's profile (no new public path, cron or worker; the call page sits behind sign-in). One hardening line in the CD's `vercel.json`: `frame-ancestors 'self'`, as the client success and media buyer policies have; the portal keeps sending only the media buyer header, so `cockpit.maharamedia.com` is unchanged.

---

## 6. The harness

- **Run:** in `apps/client-success-cockpit`, `bunx vite --port 5191 --strictPort`; in `apps/creative-director-cockpit`, `CS_DEV=http://localhost:5191 bunx vite --port 5192 --strictPort`. Open `http://localhost:5192/creative/blueprint-harness.html?view=call&fixture=full&bp=part1`.
- **`view=call`** draws `BlueprintCallPage` inside a stand-in of the CD shell (the rail and the page padding), with the rail fed by `fakeBlueprintIO(rowFor(bp))` and the frames pointed at the deck harness, same origin through the proxy:
  - prep: `/client-success/present-harness.html?deck=blueprint&view=prep&fixture={f}&bp={bp}&host=creative&notes={enc(notes view)}`
  - deck: the same with `view=present`
  - notes view: `/creative/blueprint-harness.html?view=notes&fixture={f}&bp={bp}`, which frames `…present-harness.html?deck=blueprint&view=notes&…&host=creative`.
  So Present, Back, Present again, N and the notes popup all run against fixtures, with nothing signed in and nothing saved outside the page.
- **`state=`** forces the host's states without a server: `loading` (never `ready`), `slow` (timer at 0), `failed` (a sample sentence), `offline`, `signedout`, `wronghost`, `badid`, `noseat` (the CD's own "This cockpit isn't yours" in the shell); `view=notes&state=checking|noseat` for the popup's own lines; `rehearse=1` and `readonly=1` as the card's harness has them; `theme=light`. The shell shows Ask Hermes where `AppLayout` would (never on the call).
- The existing views (`card`, `dashboard`, `settings`) stay as they are.
- **Shots:** `scripts/blueprint-call-shots.mjs` (Playwright and system Chrome, both already in the CD app) at 1440 x 900, JPEG quality 75: the call page per `bp` (`open`, `part1`, `sent`, `closed`) in English and Arabic deck language; presenting (after pressing Present in the frame); the closed deck with its two buttons; full screen; the notes popup at 520 x 820; every `state=`; light theme once. Its checks fail the run: the top page's address never leaves `/creative/` from the first click to the last; the only new page in the browser context is the notes popup, at a `/creative/` address; no frame ever sits on a path other than its Blueprint path; the prep frame is `inert` while presenting and the deck frame has focus; the browser's Back while presenting leaves the deck up and the address unchanged; F puts the deck frame full screen; Present ends under Open the notes window (at 1024, 1440 and 1920), the prep frame reaches the window's edge, and its toolbar draws no second rule; a wheel over the header scrolls the prep and Present stays under the seam; an Arabic deck's Back reads "سكّر العرض" and the closed screen's buttons are Arabic; Ask Hermes is not on the call; the stage has no horizontal scroll at 1024, 1440 and 1920 wide. Scrollbars are drawn as a desktop browser draws them (Playwright's `--hide-scrollbars` is dropped).

---

## 7. Tests

**Client success app** (`bun test scripts/blueprint-host.test.tsx`, happy-dom as the deck tests use):
1. Host mode is off without `host`, off when not framed, off when the parent is another origin, off for the onboarding and launch decks even with `host=creative`, and on only for the Blueprint deck in a same-origin frame.
2. `creativePath` accepts `/creative/blueprint/86exmpl01/notes?rehearse=1` and refuses `//evil`, `/creative//x`, `/client-success/…`, `https://…`, `\`, spaces, dot segments plain or percent-encoded (`%2e%2e`, `.%2e`, `%2E%2E`) and 401 characters.
3. In host mode: prep's Present posts `present`, flushes, and opens no window (spy `window.open`); the deck's N opens `/creative/blueprint/{id}/notes` under `mahara-notes-{id}-blueprint`; Back posts `end` and draws "Deck closed"; the first drawn data posts `ready` with the view and the name; `model.error` with no data posts `failed` with the sentence; a rehearsal keeps `-rehearse` and `?rehearse=1`.
4. Without a host, the Blueprint and both CSM decks open exactly today's windows and addresses (`mahara-deck-…`, `/client-success/…/notes`).
5. `ProtectedRoute` in a host frame: "Opening…" and no sidebar skeleton while not ready; "Sign in to the cockpit again." and `signed-out`, no redirect to `/login`, when signed out. Outside a frame: today's behaviour. The root `ErrorBoundary` in a host frame posts `failed` and draws one line; a deck crash report from a host frame sends `p_app` and `p_role` creative, and client-success with csm elsewhere. The hosted prep toolbar has no rule and sticks; the deck's Back reads "End the deck" hosted and "Back to {client}" otherwise; the hosted deck's document carries its language.
6. Prep scrolls to `#part2` after drawing and on `hashchange`.
7. The headers stay frameable: `apps/media-buyer-cockpit/vercel.json`'s policy has `frame-ancestors 'self'` and either no `frame-src` or one that lists `'self'`; no `X-Frame-Options` in the media buyer, client success or CD `vercel.json`; the client success and CD projects' own policies refuse other sites' frames (`frame-ancestors 'self'`).
8. The existing deck suites (`scripts/deck-*.test.ts(x)`, `scripts/blueprint-*.test.ts(x)`) pass unchanged; `ship.sh` runs them.

**CD app** (`bun test scripts/blueprint-call.test.tsx scripts/blueprint.test.tsx`):
1. The routes: `/blueprint/:taskId` under `AppLayout` and `RoleRoute role="creative"`; `/blueprint/:taskId/notes` outside `AppLayout`, under `ProtectedRoute` and `RoleRoute role="creative"` (rendered with `MemoryRouter` and a fake auth for a creative seat, a CSM seat and an admin).
2. `blueprintFrame` and `blueprintCall` build the addresses of 4.1 (hash, rehearsal, notes override encoded); a bad task ID builds nothing and draws "No client card with that ID."
3. The bridge ignores a message from another origin, from another frame, or without the envelope; `present` draws the layer with the deck frame and makes the prep frame `inert`; `ready` from the deck focuses it; `end` shows Back to prep and Present again; Back to prep removes the deck frame; Present again mounts a fresh one.
4. The states of 4.6, each from a fake: slow (fake timers), failed, offline then `online`, signed out, wrong host, read only, rehearsal.
5. The card: the three buttons are links to `/blueprint/86exmpl01`, `#part1`, `#part2`, with `?rehearse=1` in a rehearsal and router state; nothing calls `window.open`. The copy of 4.7.
6. The rail: where each part was sent for each `rowFor(state)` fixture (the card's words for a part sent, sending, changed or needing a look; "Not sent yet" and the rest otherwise; no count); a failed read shows the card's sentence, never "Not started"; a `bp-part` on the channel reads the record again.
7. `isActive("/blueprint/86exmpl01", "/clients")` is true.
8. While the sign-in is checked, the notes popup shows one centred "Opening the notes…" and no sidebar; the call page keeps the skeleton. No Ask Hermes on the call (`isBlueprintCall`). The presenting layer has no hex colour, only the `deck-ground` and `deck-ink` tokens. The rail says where each part was sent (`railView`), never a count. Failed, signed out (Sign in, Reload), the offline chip only once the prep is open, and "All clients" for the client list.

**Repo:** `scripts/check-shared.sh` passes with the new pin, and fails if one copy of `deckHost.ts` changes alone.

---

## 8. How to verify

### 8.1 Locally (nothing leaves the machine)

1. Both test suites above, and `bunx tsc -b` in both apps.
2. The harness (6) in system Chrome, **headed**: press Present in the frame, F (full screen), Esc, N (the popup opens at `/creative/…`), type in a notes field and watch it land on the deck (the channel), Back, Back to prep, Present again; the same in a rehearsal.
3. The shots script: read every shot, then delete them. Stop both dev servers.
4. Optional, real data read only: sign in on `http://localhost:5192/creative/` (the proxy shares the session with `/client-success`), open a client in onboarding with `?rehearse=1` as an admin, look, press nothing outside the rehearsal.

### 8.2 On production, with nothing sent

After the ship of 9:
1. `curl -s -D - -o /dev/null https://cockpit.maharamedia.com/creative/blueprint/x` and `…/client-success/clients/x/present/blueprint`: 200, the same single policy with `frame-ancestors 'self'`, no `X-Frame-Options`.
2. As the CEO or an admin, a client in onboarding, with `?rehearse=1` on its client page: **Run the Blueprint call**. The address becomes `/creative/blueprint/{id}?rehearse=1` in the same tab; Clients stays lit; the rehearsal callout shows; the prep draws in the stage with no back link and no second title.
3. Present, F, Esc, N (the popup's address is `/creative/blueprint/{id}/notes?rehearse=1`), a field typed in the notes appears on the deck; in the rehearsal, press **Send to media**: the plan shows; Back, Back to prep, Present again. No tab opens at any step, and no address shows `/client-success`.
4. Read-only counts for that task before and after (the SPEC 7.2 method, `sq.py` reads): `cockpit_blueprints` (revision), `cockpit_audit_log`, `cockpit_creative_outbox`, `cockpit_media_actions` all unchanged; `cockpit_media_provider_health` shows only GETs.
5. The CSM's decks: as the CEO, `/client-success/clients/{id}/present/onboarding?view=prep` → Present opens its own window as before; close it on the cover (stepping to the team slide stamps "presented").
6. A creative-only seat: the creative director opens one client's call page on his own machine before his next call and only looks (no press, no typing). His seat passes the CD's `RoleRoute role="creative"` and the deck's `anyOf csm, creative`, and the server gate is unchanged.

---

## 9. Ship order and rollback

1. `scripts/ship.sh client-success` first. Host mode stays dormant until a `/creative` page frames the deck, so the CSM sees no change; check 8.2 step 5.
2. `scripts/ship.sh creative`. If the CD shipped first, its frame would hold a deck without host mode: Present would open a window and the back link would lead to the CSM cockpit. Hence the order.
3. Verify (8.2), record the session in mahara-context `shared/sessions/`, and log the decision (10.3).
4. **Rollback:** redeploy the previous CD build. The card's buttons go back to the windows; the client success host mode stays dormant and harmless.

---

## 10. Scope, proof, record

### 10.1 Not in scope

- Moving the deck engine into a shared package, or copying any of it into the CD app.
- The CSM's onboarding and launch decks, and the CSM's own "Open the Blueprint deck" (they keep their windows).
- Any change to the server, the gate, the SQL, the outbox or ClickUp.
- A "present in its own window" escape hatch in the CD (an admin can still open the client success address directly).
- Framing Google documents (the offer sheet, the pack, Brand DNA, Drive) or the GHL booking page: they keep their own windows.
- Presenting from a phone or a tablet, and polish for Safari and Firefox beyond the fallbacks in 4.3 and 4.6 (the CD presents from Chrome).
- Clarity (off today; when it is switched on, the frame should skip it so one session is not recorded twice).

### 10.2 How we know it works

- The tests of 7 pass, including the header pins and the CSM decks' unchanged windows.
- The shots script's checks pass: the top address never leaves `/creative/`, the only new page is the `/creative/` notes popup, no frame shows a non-Blueprint path.
- 8.2 passes on production with every count unchanged.
- The creative director runs his next real Blueprint call without leaving the CD tab, and the card shows each part's press from the same channel as before.

### 10.3 Decision record (for `context/DECISIONS.md` in mahara-context, on ship)

> **2026-10-24 | The Brand Blueprint call runs inside the creative director cockpit.** Decision: The creative director prepares, presents and takes notes for the Blueprint call at `/creative/blueprint/:taskId` (notes at `/creative/blueprint/:taskId/notes`), in the cockpit's own tab. The client success deck engine draws it in a same-origin frame, in a host mode that only the Blueprint deck has; the CSM decks keep their own windows. Rejected: copying the engine into the CD app (about 95 files to pin, every fix twice), a shared alias (the CD deploy uploads only its own folder), a shared package (a monorepo deploy, not needed for this ask), and keeping the three windows under `/creative` addresses. Why: the CEO asked that the Blueprint stop sending the creative director to the CSM cockpit. Source: chat with Aziz, 2026-10-24; `mahara-cockpits/docs/brand-blueprint/EMBED.md`.

---

## 11. As built (2026-10-24)

Built on `bp-embed-1024` as designed, with these choices made while building and checked on the shots:

- **The header spans the stage, not `max-w-6xl`.** At 1920 wide a `max-w-6xl` header floated centred over a full-bleed prep and read as a second page. The header now takes the page's width, and the frame sits in by the page's padding less the prep's own 16 px (`sm:inset-x-2 lg:inset-x-4`), so the header's edges meet the prep's at every width (the back link over the prep's ready count, Open the notes window over Present). The hairline still runs the page's full width.
- **A save on the channel reads the record within 2 s, not at once.** `bp-saved` arrives every few keystrokes; the rail reads once per 2 s while typing goes on. `bp-part` still reads at once.
- **A bad card ID builds nothing:** `blueprintFrame` and `blueprintCall` return `null` for an ID `isTaskId` refuses.
- **The back link waits:** with no name from the card, the record or the frame yet, it is a quiet line; once all have answered with no name, it reads "All clients".
- **The presenting layer is portalled to `<body>`** and the cockpit's `#root` is `inert` while it is up, so neither the rail nor the chat nor a dialog can sit over the deck or take a key, whatever the page's fade wrapper does to stacking.
- **The frame's address is checked on each load and every second** (the deck is a single-page app: a redirect inside it fires no load event).
- **The first `#part` rides in the frame's own address; only a later one is passed to the frame**, and never while the frame is still on `about:blank` (a hash set there would cancel its load).
- **Prep's Present waits for the saves at most 1.5 s**, then tells the page, so a slow connection never holds the call up.
- **Harness:** `view=notes` frames the deck harness's notes view; `theme=light` reaches the deck harness too.

### 11.1 After review (2026-10-24)

- **Crash reports land.** A deck crash in the creative director's frame files as `p_app` creative with `p_role` creative; the server pairs app and role before it checks the seat, so the earlier client-success-with-creative pair was refused for every seat.
- **Back keeps the deck up.** The browser's Back while presenting no longer takes the shared tab to the client page (4.3).
- **One seam.** The hosted prep toolbar has no rule of its own, sticks under the seam as the prep scrolls, and ends where the CD header ends. The frame reaches the window's right edge (its scrollbar where every cockpit page has one); the page measures how far the prep must pad its right side (the header's right edge, less the frame's own scrollbar) and sets `--host-end` on the frame's document, since the frame's breakpoints are its own width, not the page's (at 1024 to 1279 wide a fixed `lg:` padding missed by 8 px). A wheel over the header scrolls the prep.
- **One job each.** The rail says where each part was sent; the prep's panel says how far each part has got, in one format (`In progress · 5 of 8`).
- **The shared tab.** The deck's Back reads "End the deck" hosted; the closed screen's two buttons speak the deck's language and show a visible focus ring (offset from the teal fill).
- **States.** Failed reads as slow does (a headline, then the sentence); every stage line sits at the notices' height (`pt-24`); "All clients" everywhere for the client list; Sign in on the signed-out line; the offline chip only once the prep is open; the client success root crash screen never draws in the frame; the notes popup shows one centred "Opening the notes…" while the sign-in and the seat are checked (not the cockpit's sidebar skeleton).
- **Quiet.** Ask Hermes is not on the call page; the presenting layer's colours are tokens (`--deck-ground`, `--deck-ink`).
- **Safety.** `creativePath` refuses percent-encoded dot segments (`/creative/%2e%2e/…` is `/…` to the browser); the CD project's own header refuses other sites' frames.
