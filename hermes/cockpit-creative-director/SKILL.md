---
name: cockpit-creative-director
description: Use for client scripts and VSLs in the creative cockpit.
version: 1.0.0
author: Faris (Mahara Media)
license: MIT
metadata:
  hermes:
    tags: [creative, scripts, vsl, direct-response, client-ads]
    related_skills: [script-engine, direct-response-ad-scripting, humanizer]
---

# Creative Director Cockpit Agent

Writes scripts and VSLs **for Mahara's clients**, built on their offer.

## When to Use

Client ad scripts, client VSLs, client video briefs, anything where the person
on camera is the client rather than Aziz.

**Not for Aziz's personal brand.** That is Muse, and it uses his Kuwaiti voice
and his locked script archive. Mixing them is how a Saudi contractor's ad ends
up sounding like a Kuwaiti founder's reel.

## Start from the offer, never from a blank page

A script that does not know the offer is a guess. Before writing anything, pull
the client's offer from ClickUp, which is the source of truth for everything.

```bash
# the client list
curl -s -H "Authorization: $CLICKUP_API_KEY" \
  "https://api.clickup.com/api/v2/list/901816559981/task?include_closed=true"
```

Read the task's description and custom fields. The offer creation cheat sheet
and knowledge base live on the board, attached to the client.

If the offer is not documented, **stop and ask**. Do not infer an offer from the
client's website or from what similar clients sell. An invented offer produces a
script that promises something the client does not deliver, and that lands on
the client, not on us.

## Then pull what was actually said

Fathom holds the call recordings. The client's own words about their business
are the safest source material, because they are pre-approved by definition.

```bash
curl -s -H "X-Api-Key: $FATHOM_API_KEY" \
  "https://api.fathom.ai/external/v1/meetings?limit=25"
```

Look for how the client describes their own work, the objections they say they
hear, and the results they claim. Those three things are the spine of a good
script and you do not have to invent any of them.

## Then look at what already works

The creative cockpit keeps two libraries next to the winning ads. The
**Ideation board** (`/ideation`) holds posts that ran far above their
account's normal, from our industry and others, with the transcript, the
on-screen text, the hook and why it works, plus trends (the same format on
several accounts inside two weeks) and paid ads ranked by how long they have
run. **Scripts we made** (`/scripts`) holds every finished script from the
creative board, word for word. Use them for structure, hooks and pacing.
Never lift a competitor's claim, number or offer into a client's script: the
claim has to be the client's own, from the sections above.

## The structure

Direct response, in this order. Full rules in the
`direct-response-ad-scripting` skill.

**Hook, first three seconds.** Open on the concept or an open loop. Never open
on a statistic and never name the audience in the script. "If you own a villa in
Riyadh" tells everyone who is not a villa owner to scroll, and tells the
algorithm nothing it did not already know.

**The problem, made concrete.** Not "many people struggle with renovation
costs". A specific moment the viewer has lived.

**The mechanism.** Why this is different, in one idea. Not three.

**Proof.** This is where a number goes, if the client approved one. Mid-script,
as the proof beat, never as the hook.

**The offer and one CTA.** The CTA in the script must match the CTA on the ad.
No CTA in the video means no CTA in the caption. Never bolt one on.

## Length by format

| Format | Length |
|---|---|
| Reel or short ad | 20 to 40 seconds |
| Standard VSL | 3 to 6 minutes |
| Long-form VSL, high ticket | 8 to 15 minutes |

A confusing ad is usually too long. A weak ad is usually too short to give
context. Both show up as a low stop rate, so check the first three seconds
before rewriting the whole thing.

## Hooks first, always

Three to five hook options before any body copy. The client or Aziz picks, then
you write the body. Writing a full script around an unapproved hook wastes the
script when the hook gets cut, which it usually does.

## Language

The **client's** dialect, not Aziz's. A Jeddah client reads Hejazi (إيش), a
Najdi client reads Najdi (وش), a Kuwaiti client reads Kuwaiti. Getting this
wrong is instantly obvious to a native speaker and makes the client's own ad
feel foreign to their own market.

Never use Aziz's Kuwaiti voice on a client script.

## Hard limits

Never state a number the client has not given you. Never promise a regulatory
approval, a permit outcome or a delivery date. Never put a guarantee in an ad
for a licensed profession. Never imply a one-man team when the client is a firm.

Every money figure in USD.

No em-dashes anywhere, Arabic or English.

## Before delivery

Run `creative/humanizer` on the whole script, then a hostile pass:

- Does the first line stop the scroll, or is it runway before the hook
- Is every number on the approved list
- Does it read aloud like the client talks, or like an agency wrote it
- Is the CTA the same one that is in the video
- Any em-dash, any bolted-on CTA, any invented claim

## When the client edits it

Their pasted version is final. Do not improve it. Archive it as ground truth for
that client's voice, so the next script starts from what they actually approved
rather than from the house default.

## Diagnosing a creative that is not working

Creative problems show up as specific metrics. Full ladder in
`client-launch-campaign/references/diagnostics.md`.

| Symptom | Cause | Fix |
|---|---|---|
| Low stop rate | hook failing, or ads saturated | change the first three seconds |
| Low CTR | angle not resonating | new angle, not a new edit of the same one |
| Leads but wrong ones | script not explicit about the service | say plainly what is sold |
| Was fine, now fading | creative fatigue | four to eight new videos a month |

Creative volume is the most common miss. The client films raw, Mahara edits. If
talking heads are flat, test B-roll. If B-roll is flat, test AI video.
