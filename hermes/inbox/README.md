# Hala, the WhatsApp desk

Scans the Mahara client account in GoHighLevel, keeps what moved since the
watermark, and drafts a reply in Arabic and English for every thread where
the client spoke last. It never sends. A person reads the draft, edits it,
and presses the button in their cockpit.

```bash
python inbox.py --doctor
python inbox.py
```

The default run is read-only. It reports planned writes and skips model calls.
The target must be Creative Triage. The configured CSM location and switch-on watermark must match.
Required names are `GHL_MAHARA_PIT`, `GHL_MAHARA_LOCATION`, `DESK_SUPABASE_URL` and `DESK_SUPABASE_KEY`.
`DEEPSEEK_API_KEY` is required only for an explicitly approved `--apply` run.
Do not schedule applied runs until the native schema and host locking are verified.

Native publication uses service-only atomic thread and draft CAS functions.
Human client assignments and archive choices survive provider updates.
Pending or unknown outbound status never counts as delivery.
Accepted messages use their recorded provider IDs for later delivery observations.
Only real `delivered` or `read` status confirms delivery.
External reads and model calls go through `tools.py` into the CSM health ledger.

Offline regression command:
```bash
python -m unittest discover -s hermes/inbox -p test_inbox.py
bun test scripts/native-whatsapp.test.ts
```

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
the client is waiting and drafts a reply to a colleague. The team post
under their own names ("Rasem Abdel all", "Nada | MaharaMedia",
"DANIYA"), so each run reads every name in `cockpit_people` and
`cockpit_members`, and a group message counts as us having spoken when the
speaker is the team:

- the name has Mahara in it (any case, or مهارة);
- or it has two or more words and its first two match a team member's first
  two by consonant skeleton, so "Rasem Abdel all" is Rasem Abdel All but
  "Ahmed Salama" is not a team "Ahmed Fathy";
- or it is one word equal, letter for letter, to one of a team member's
  names ("DANIYA" is Daniya Ziad, "Sabry" is Ahmed Sabry, "Aziz" is
  Abdulaziz), or an Arabic spelling of a team member's English first name by
  consonant skeleton ("دانيا"). Within one script a lone name is never
  matched by consonants, so "Umar" is not Maria. A name under three letters
  such as "M" never is.

Both the speaker and the team names are read the way the cockpit's
`clean()` reads them first: a markdown link becomes its text, and `**`,
`__` and backticks go.

A thread waits on us only when the newest message from the client's people
is newer than every message from us: a delivered or read reply, or a team
member writing in the group. Hala drafts a reply to that message and never
to a team member's. This is the cockpit's `teamSpeaker` and `clientWaiting`
in `apps/client-success-cockpit/src/lib/clientBrief.ts`; change both
together. When the team names cannot be read, the run says so and only a
Mahara name counts as the team.

Known gap, in both: "عزيز" (an Arabic one-word nickname of Abdulaziz) is
not caught. A one-word client name that is exactly a team member's name
("Ahmed" when the team has Ahmed Sabry) counts as the team.

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
