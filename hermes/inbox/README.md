# Hala, the WhatsApp desk

Scans the Mahara client account in GoHighLevel, keeps what moved since the
watermark, and drafts a reply in Arabic and English for every thread where
the client spoke last. It never sends. A person reads the draft, edits it,
and presses the button in their cockpit.

```bash
python3 inbox.py
```

Needs `GHL_MAHARA_PIT`, `GHL_MAHARA_LOCATION`, `DESK_SUPABASE_URL`,
`DESK_SUPABASE_KEY`, `DEEPSEEK_API_KEY`.

## What this account actually looks like

Five things, none of them documented, all found by reading the live data.

**WhatsApp arrives as `TYPE_CUSTOM_SMS`.** There is no `TYPE_WHATSAPP`
traffic at all -- a filter for it finds an empty account, which is exactly
the wrong conclusion. The bridge stamps its own markers into the body:
`🔁 Sent from another device` on anything typed on the phone, `>AUDIO<`
where a voice note was, `↩️ Replied to:` around a quote.

**Groups are in there, and GoHighLevel does not mark them.** Every group
is bridged through a **virtual Chinese number** the bridge allocates per
group -- a `+86` where a real contact would have a Gulf number -- and is
named with a 📢 by whoever set it up. Inside a group, each inbound message
is prefixed `👤 Name (+phone)` with whoever spoke. That prefix is the only
record of who said what.

**Our own people appear as inbound in groups.** Anything not sent through
GoHighLevel is reported as incoming, so a message Nada types into a group
on her phone arrives looking like the client. Left alone the desk decides
the client is waiting and drafts a reply to a colleague. A Mahara name on
a group message counts as us having spoken.

**A voice note is the commonest last message, and we cannot hear it.** No
draft is invented for one. The thread says plainly that somebody has to
listen in WhatsApp first, which is more useful than a guess.

**The history is not ours.** Aziz, 2026-09-20: everything before switch-on
belongs to a previous CSM. Drafting from it would answer somebody else's
conversation. `wa_state.scan_since` starts at switch-on and only moves
forward; there is deliberately no backfill.

## Dates

A conversation's `lastMessageDate` is **epoch milliseconds**. A message's
`dateAdded` is an **ISO string**. Reading one as the other silently drops
every message and looks like an empty account.
