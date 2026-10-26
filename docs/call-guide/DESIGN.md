# The call guide and the practice client

Muhammed, 2026-10-26: Aziz's call updates for the CSM and the creative
director (the onboarding deck with the kickoff form, the launch deck, the
Brand Blueprint call with its three parts) work, but the order of windows
and presses is hard to learn. Two pieces make it familiar:

1. **The call guide** inside the real call: the steps of the call in order,
   each ticked by what really happened, with the next one lit. Built first.
2. **The practice client**: a made-up client in each cockpit that runs the
   same screens with the same guide, and saves or sends nothing. Built second.

Why this order: each person runs these calls a few times a month. Skills
used that rarely fade between uses (Arthur et al. 1998), so the help has to
be on the screen at the moment of the call, not only in a practice session
the week before. Practice and the real call use the same guide, so what is
learned in practice is what is seen on the call.

## Design plan

**Subject.** A presenter's run of show: three private screens (prep, the
notes window, the cockpit page) and one shared screen (the deck). The guide
lives only on the private screens. The client never sees it.

**Tokens.** The cockpit's own: Deep Space `#091333` canvas, card
`#0f1b45`, Mahara Teal `#00CFC8` for the step that is now and for the
beacon, `--success` for a done tick, muted foreground for later steps,
orange `--warning` only for a step that was missed. No new palette.

**Type.** Geist 13 and 14px for the steps, 12px for the one "how" line.
Geist Mono 11px uppercase for the three group labels and the step numbers
(numbers are true here: the steps are a sequence).

**Layout.** Prep, help on:

```
How this call runs                         Step 2 of 7   Hide help
BEFORE THE CALL      ON THE CALL                AFTER THE CALL
✓ 1 Check the slides   4 Walk them through       7 Close the deck
● 2 Open the notes     5 Fill the kickoff
    window             6 Book the Blueprint
    how: one line
  3 Present
```

Help off, and in the notes window's sticky header:

```
● Step 5 of 7 · Fill the kickoff form with them           Show help
```

The three groups mirror the "Before the call / On the call / After the
call" panels the CSM already knows from the client page.

**Signature: the beacon.** The real control for the step that is now wears
a slow teal ring (a still ring with reduced motion): Present in prep, Send
to media and Close the call where they are pressed, the Blueprint booking
in the notes window. The guide never adds a second button for something
the screen already has; it lights the one that is there. One beacon at a
time, only while help is on, never on the shared deck.

**Help on or off.** On for a person's first three real calls of each kind
(counted in this browser), then off; "Show help" and "Hide help" switch it
and the choice is kept. A rehearsal or a practice run never counts. This is
a per-viewer convenience in localStorage, read and written inside
try/catch; without storage the guide still renders, with help on.

## The steps and what ticks them

The guide reads only what the windows already say to each other on the
call's channel (the deck's position, the notes window's hello, the deck
closing) and what the record already holds (the kickoff, the bookings, the
Blueprint parts). It writes nothing.

| Call | Step | Ticked when |
|---|---|---|
| Onboarding | Check the slides | the notes window or the deck is open |
| | Open the notes window | a notes window answered |
| | Present, then share only the deck window | the deck posted where it is |
| | Walk them through the slides | the deck reached the kickoff slide |
| | Fill the kickoff form with them | the kickoff was sent (this call or on record) |
| | Book the Brand Blueprint call | a Blueprint booking is on record or was made |
| | Close the deck and send the group links | the deck window closed |
| Launch | Check the slides and their ads | the notes window or the deck is open |
| | Open the notes window | a notes window answered |
| | Present, then share only the deck window | the deck posted where it is |
| | Walk them through the slides | the deck reached the last slide |
| | Close the deck and send the summary | the deck window closed |
| Blueprint | Read the prep and draft the offer | the notes window or the deck is open, or part 1 went |
| | Open the notes window on your second screen | a notes window answered |
| | Present, then share this tab | the deck posted where it is |
| | Send the starter ads to media | part 1 is sent (or rehearsed) |
| | Build the offer with them | the deck reached the read-back slide, or part 2 went |
| | Book the launch call, then close the call | part 2 is sent (or rehearsed) |
| | Lock the offer once it is final | part 3 is sent (or rehearsed) |

The CSM's read-only view of the Blueprint shows no guide.

## The practice client

**Where.** The CSM: Clients, "Practice a call" (`/client-success/practice`),
and "Practice this call" under the onboarding deck on a client's
onboarding panel. The creative director: Clients, "Practice a Blueprint
call" (`/creative/blueprint/practice`, its notes at `.../practice/notes`).

**What.** Noor Studio Interiors, the deck harness's made-up firm
(`src/dev/deck`), under the card ID `practice-client`. The address, the
name and the creative director's frames live in `deckHost.ts`, the file
both apps already share byte for byte. The screens are the real ones
(prep, the notes window, the deck, the creative director's page) with
`practice` on, so the guide is the same one the real call shows.

**Where it starts.** The onboarding call before the kickoff, nothing
booked. The launch call as the fixture has it. The Blueprint as a good
prep leaves it: part 1 answered, with capacity and the starter pack's
approval left for the call, then Send to media.

**Nothing leaves the browser.**

| Real call | Practice |
|---|---|
| Reads the record | Reads the fixture |
| Saves prep | Keeps prep in `mahara-practice:v1:prep`, shared by the practice windows; Start over clears it |
| Uploads ads | Shows the file from this browser's copy |
| Kickoff in Typeform | A look-alike form (`practiceForm.ts`); Typeform never loads, since its sandbox reaches the live form (KICKOFF.md 9) |
| Books a call | Says a time and books nothing |
| Blueprint presses send | Run as a rehearsal and show their plan |
| The creative director's rail reads the record | Reads nothing; stays at "Not sent yet" |

One exception, on purpose: a crash in a practice window reports to the
issue queue like any deck crash, with its `/practice` address.

A practice run never counts towards help off. Its windows and channel
carry `practice-client`, never a client's ID, so they keep the plain names
(no `:rehearse` suffix).

## Not in scope

- Changes to the decks, the kickoff form, the Blueprint parts or their wording.
- A guide on the shared deck, or anything the client sees.
- Counting calls on the server; help on or off is a browser convenience.
- The media launch flow, training videos (team-videos project).
- Practice data on the server, more than one practice client, or a
  practice of the CSM's read-only Blueprint view.

## How we know it works

- Unit tests pin each call's steps against the facts that tick them, the
  "now" step, the help counter (three real calls, never a rehearsal or
  practice) and the beacon's one target.
- Render tests show the guide in prep and in the notes window, and none in
  the CSM's read-only Blueprint view or on the shared deck.
- The deck harness shows the guide at 390, 820 and 1440 wide in dark.
- `scripts/practice-client.test.tsx` pins the practice client: its
  addresses, its starting state, prep kept and cleared, the look-alike
  form, the practice line in prep and notes, the Blueprint as a rehearsal
  on the plain channel, no network call, never counted. The creative
  director's `scripts/blueprint-call.test.tsx` pins its routes and page.
- The deck harness draws it with `practice=1` (`view=page` for the
  practice page).
- After release: the kickoff is sent during the onboarding call and part 2
  is pressed during the Blueprint call more often, read from the audit rows
  the cockpits already write.
