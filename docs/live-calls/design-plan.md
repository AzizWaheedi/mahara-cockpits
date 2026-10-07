# Design plan: live rooms in the sales cockpit

Subject: a rep mid-call who needs one glance to know "is my room ready, did the lead open it, are they in". Audience: the setter and the closer, on a laptop or a phone, often while talking. The single job of every new surface: say the live state in one line and offer the one right action.

## Tokens (extend the app's system; no second palette)
- **Now / live:** `--mahara-teal` #00cfc8 (`var(--now)`). Used only on the current step and the live countdown.
- **Canvas and ink:** the app's `--background`, `--card`, `--foreground` and `--muted-foreground`. Deep Space #091333 is the dark canvas.
- **Good:** `--won` (success) for "joined" and "shown".
- **Owed:** `--owed` (warning) for "nobody joined" and "not confirmed".
- **Error:** `--destructive` only for a failed room or a refused action.
- **Type:**
  - Geist for words;
  - Geist Mono only for codes (K7Q2MX), times (14:03) and countdowns (9:12), through `font-mono`;
  - never `.tabular-nums` on a sentence, because in this app it switches the face.
  - Sizes: 13 px for strip lines, 14 to 15 px for panel lines, 12 px uppercase-free labels.
- **Shape:** radius 12 px (`rounded-lg`), 1 px `border-border`, cards on `bg-card`.

## Signature: the room line
A single horizontal line of four steps:
- Link sent
- Opened
- You're in
- Lead in

Each step shows its time in Geist Mono under the word. Done steps are solid ink. The current step has a teal dot with one soft pulse, and the countdown sits at the right ("9:12 left"). This is the only animation, and it is off under `prefers-reduced-motion`. On a phone the line wraps to two rows, two steps each.

## Surfaces
1. **`SalesBanner.tsx`** (the banner slot in `App.tsx`). It shows one thing, in priority order:
   1. an offer;
   2. my open room;
   3. a handover I started;
   4. a reply alert;
   5. the portal banner.

   It is 44 px tall: a presence dot, one sentence, and one primary button on the right. An offer turns it into a card with a teal outline, a 2-minute bar draining left to right, and [Take it] as the primary button with [Not now] quiet beside it.
2. **`AvailabilityStrip.tsx`** (inside the banner). States and copy come from `final_spec_foundation.md` "Availability strip". The presence dot colours are:
   - away: muted;
   - available: teal outline;
   - ready: teal;
   - on call: won.
3. **`RoomPanel.tsx`** (dialer and lead page; P1 places it). The card holds, top to bottom:
   - a title line: "Video room on Meet" plus the code in mono;
   - the room line;
   - the status sentence (copy from the specs);
   - the actions: one primary button (Open my room, or The lead is in), the rest as quiet buttons (Copy link, Also send by email, End room).

   Refusals and failures show in place as one sentence with what to do next.
4. **Health line:** one sentence with a coloured dot. It sits on the Team page and on the panel when red.

## Behaviour
- **Polling.** `live.status` every 4 s, or every 30 s when Away. `room.status` every 2 s while a room is creating, else 4 s.
- **Feedback.**
  - Optimistic local state only for presses that have an Undo (the 5-second strip pattern in `MarkControls.tsx`).
  - Every button shows its pending state and is disabled while pending.
  - A double press sends the same `request_id`.
- **Accessibility.**
  - Status sentences sit in an `aria-live="polite"` region.
  - Buttons are at least 44 px tall on touch.
  - Visible focus rings (`ring-ring`).
  - Every icon has a label.
- **Mobile.** The banner stays one row up to 375 px wide. The panel's buttons stack.
- **Empty and failure states.** They say what to do next, never just "Error".
