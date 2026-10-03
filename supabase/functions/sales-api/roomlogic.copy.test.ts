// Every sentence the room logic shows, pinned word for word (review F26).
//
// ROOM_COPY holds the specs' own sentences. On 2026-10-03 all 159 were
// checked against final_spec_foundation.md, final_spec_p1.md,
// final_spec_p2.md, final_consistency.md and contract.md (each sentence's
// literal pieces found, in order, on one spec line; C43's "Mahara Media"
// for "Mahara" and C24's one call_link body are the only changes). The
// specs are not in the repo, so this pin is how a change to a spec sentence
// shows up: change the spec first, then this list, then the code.
//
// LANE_COPY holds the sentences the specs did not set, written in the same
// voice for review. They are pinned too, so a change is a decision.

import { describe, expect, test } from "bun:test";
import { LANE_COPY, ROOM_COPY } from "./roomlogic.ts";

const SPEC_SENTENCES = {
  refusals: {
    lead_has_room: "This lead already has a room open. Open it.",
    lead_has_room_fallback: "A video room is already open for this lead. Use that one.",
    host_has_room: "You already have a room open. End it first.",
    taken: "Someone else took this lead.",
    live_call_open: "You already have a live call.",
    stale: "This changed a moment ago.",
    not_host: "This room belongs to {host}.",
    confirm_end: "The lead is still in this room. End it anyway?",
    zoom_busy: "Your Zoom is in another meeting. End it or use Meet.",
    zoom_basic_demo: "The closer's Zoom is Basic and ends at 40 minutes. Use Meet for this demo.",
    zoom_pending: "Your Zoom seat is not active yet. Accept Zoom's email invite. Meet works now.",
    no_google: "Connect your Google calendar on the Team page first.",
    meet_pending: "Google did not make the Meet link. Try Zoom.",
    client: "This contact is an active client. Client success looks after them.",
    dnd: "Do not disturb is on in HighLevel. No link can go.",
    booked_demo: "This lead has a booked demo. Its Zoom link comes from HighLevel, so no new room is made.",
    phone_call: "This call is on the phone. There is no link to send.",
    handover_open: "A live call for this lead is already open, started by {setter} at {time}.",
    offer_taken: "{rep} took this lead at {time}.",
    offer_closed: "This offer closed at {time}. Nothing to do.",
    outside_hours: "Live calls run Saturday to Thursday, 10:00 to 20:00 Kuwait time.",
    nobody_took: "Book a demo instead.",
    not_in_highlevel: "Not in HighLevel: book and mark it by hand.",
    zoom_failed_handover: "Zoom did not open your room: {error}. Use Meet.",
  },
  panel: {
    making: "Making your {provider} room...",
    ready: "Room ready.",
    link_sent: "Link sent on {channel} at {time}.",
    not_confirmed: "Not confirmed on WhatsApp. Sent by email too.",
    not_sent: "Not sent: {reason}. Read it out: {link}",
    opened: "The lead opened the link at {time}{device}.",
    waiting_room: "The lead is in the waiting room. Admit them in Zoom.",
    host_in: "You are in. Waiting for the lead ({left} left).",
    joined_counted: "The lead joined at {time}. Booked and marked shown in HighLevel.",
    joined_not_lead: "The lead joined at {time}. Not counted: this contact is not a tagged lead.",
    no_join: "The lead did not join in {minutes} minutes. Room closed. Call again or send a message.",
    end_with_lead: "The lead is still in this room. End it anyway?",
    phone_call: "This call is on the phone. There is no link to send.",
    still_on_call: "Still on the call?",
    no_end_signal: "No end signal from Zoom",
    no_end_signal_any: "No end signal",
  },
  panel_fallback: {
    making: "Making your {provider} room...",
    sent: "Link sent on {channel} at {time}. Waiting for {name} ({left} left).",
    not_sent: "Not sent: {reason}. Read it out: {link}",
    not_confirmed: "HighLevel did not confirm the WhatsApp template. The link went by email.",
    opened: "{name} opened the link at {time}. Join now.",
    waiting_room: "{name} is in the waiting room. Admit them in Zoom.",
    host_in: "You are in. Waiting for {name} ({left} left).",
    joined_marked: "{name} joined at {time}. The intro is marked shown.",
    joined_booked: "{name} joined. Booked as a live intro and marked shown.",
    joined_not_lead: "{name} joined. Not booked: this contact is not a tagged lead.",
    expired: "Nobody joined in {minutes} minutes. The room is closed. Mark the intro:",
    failed: "{provider} did not make the room: {reason}. Try {other}, or call again.",
    zoom_pending: "Your Zoom seat is not active yet. Accept Zoom's email invite. Meet works now.",
    zoom_busy: "Your Zoom is in another meeting. End it or use Meet.",
  },
  buttons: {
    open_room: "Open my room",
    copy_link: "Copy link",
    end_room: "End room",
    lead_is_in: "The lead is in",
    not_the_lead: "That was not the lead",
    available: "I'm available",
    join_room: "Join my room",
    go_away: "Go away",
    take: "Take it",
    not_now: "Not now",
    keep_available: "Keep me available",
    stop: "Stop",
    send_video_link: "Send a video link",
    meet: "Meet",
    zoom_instead: "Zoom instead",
    in_the_room: "I'm in the room",
    on_the_phone: "We are on the phone",
    cant_let_in: "I can't let them in",
    also_email: "Also send by email",
    finished: "Finished",
    no_show: "No-show",
    spoke_on_phone: "We spoke on the phone",
    im_in: "I'm in",
    they_joined: "They joined",
    use_meet: "Use Meet",
    open_lead: "Open lead",
    book_demo: "Book a demo",
    book_slot: "Book a slot",
    send_message: "Send a message",
    yes_cancel: "Yes, cancel",
    keep_it: "Keep it",
    send_when_they_write: "Send when they write",
    message_us: "Message us on WhatsApp",
    video_call: "Video call",
    demo_now: "Demo now with a closer",
    intro_now: "Intro now with me",
  },
  strip: {
    away: "Away",
    available: "Available until {until}. Join your room to get leads first.",
    ready: "In your room until {until}. The next live lead comes to you.",
    offer: "Live lead: {kind}, {country}, on the line with the setter. Note: {note}. {left} left.",
    taken: "Taken. Sending the link...",
    lost: "{name} took this one.",
    missed: "You missed a live lead at {time} and are now Away.",
    refresh: "Zoom closes a room 40 minutes after only one person is left. Stay available?",
    booked_call: "Your booked demo starts at {time}, so your room is closed. Press I'm available after it.",
  },
  strip_fallback: {
    room: "Video room: {name}, {left} left. Open",
    update: "{name} {what}. Open",
    lead_page: "Video room on {provider}: sent {sent}, opened {opened}, joined {joined}.",
    team_zoom_ready: "Zoom: ready",
    team_zoom_pending: "Zoom: the setter's seat is pending",
  },
  setter_strip: {
    searching: "Finding a closer: {left} left.",
    ready: "The closer is in the room. Link sent by {channel} at {time}.",
    window_closed: "WhatsApp is closed for this lead. Ask them to send 'hi' to our WhatsApp and the link goes as soon as they do.",
    read_out: "Read this out: {link}",
    nobody: "Nobody could take it. Book a slot instead.",
    joined: "They are in the room. You can end your call.",
    no_join: "They did not join in {minutes} minutes. The room is closed. Nothing was booked.",
    cancel: "Cancel? The room closes and nothing is booked.",
  },
  health: {
    working: "Rooms: working. Last run {time}. {rooms} today, {failed} failed.",
    down: "Rooms are down. The room worker last ran at {time}. Call the lead on the phone, or send your own Zoom or Meet link.",
    mismatch: "Zoom and the cockpit disagree on {rooms} today. Open its timeline.",
  },
  slack: {
    app_home: "Live calls. You are away.",
    app_home_ready: "Ready now: {closers} closers, {setters} setters.",
    available: "You are available until {until}. Opening your room...",
    room_open: "Your room is open. Join it so live leads can come straight to you.",
    in_room: "You are in your room. Ready until {until}.",
    offer: "Live demo for you: {name}, {company}, {country}. On the phone with the setter now. Note: {note}. Take it within 2 minutes.",
    taken: "You took it at {time}. Link sent by {channel}. They have 10 minutes to join.",
    lost: "{rep} took this lead at {time}.",
    waiting_room: "{name} is in your waiting room. Admit them in Zoom.",
    joined: "They joined at {time}. Booked and marked shown in HighLevel.",
    no_event: "Zoom has not told us yet. Press when it happens.",
    refresh: "You have waited 35 minutes. Zoom closes a room after 40 minutes alone, so here is a fresh one.",
    booked_empty: "Your booked demo starts at {time}, so your empty room is closed. Press I'm available after it.",
    booked_lead_in: "Your booked demo starts at {time} and this call is still running. Tell the setter if you need cover.",
    missed: "This offer ended at {time}. You are now away. Type /available when you are back.",
    after_call: "Call finished. Ready for the next one?",
    unavailable: "You are away. Live leads will not come to you.",
    unlinked: "Your Slack is not linked to a sales seat. Ask the manager to add your Slack ID on the Team page.",
    watchdog: "The room worker has not run since {time}. New video rooms cannot be made.",
  },
  dialer: {
    nobody_spoke: "Nobody spoke. Save it as No answer or Call back, or send a video link.",
    auto: "Sending a video link to {name} in 10 s.",
    picker: "The lead gets the link on {channel}.",
    picker_none: "No message can reach this lead. You can still make the room and read the link out.",
  },
  short_page: {
    opening: "Opening your call with {rep}...",
    zoom_hint: "No Zoom app? Tap Join from your browser.",
    meet_hint: "Meet needs iOS 17 or the Meet app.",
    ended: "This call has ended. Reply to our last message and we will find a new time.",
    ended_fallback: "This call has ended. Reply to our last message, or message us on WhatsApp, and we will find a new time.",
    unknown: "This link is not valid. Reply to our message and we will send a new one.",
  },
  lead_en: {
    manual_whatsapp: "Hi {first_name}, your call with {rep} from Mahara Media is ready now. Join here: {link}",
    manual_email_subject: "Your Mahara Media call is ready",
    manual_email_body: "Hi {first_name}, your call with {rep} is ready now. Join here: {link}. If it does not open, reply to this email and we will call you.",
    call_link_template: "Hi {{1}}, your call with {{2}} from Mahara Media is ready now. Tap the button below to join.",
    call_link_button: "Join the call",
    call_link_fallback: "Hi {{1}}, your call with {{2}} from Mahara Media is ready. Join here: {{3}} See you there.",
    fallback_booked: "Hi {first_name}, it's {rep} from Mahara Media. I just tried to call you for your intro call and couldn't get through. We can do it on video now instead: {link} I'll wait for you for the next 10 minutes. On a phone it opens in the {provider} app or your browser.",
    fallback_unbooked: "Hi {first_name}, it's {rep} from Mahara Media. I tried to call you just now and couldn't get through. If you have 15 minutes, we can talk on video now: {link} I'll be there for the next 10 minutes.",
    fallback_email_subject: "I tried to call you: join on video now",
    fallback_email_sign: "{rep}, Mahara Media",
    handover_zoom: "Hi {first_name}, {rep} from Mahara Media is ready for you now: {link} It opens in Zoom or your browser. They will let you in within a minute.",
    handover_meet: "Hi {first_name}, {rep} from Mahara Media is ready for you now: {link} Press 'Ask to join' and they will let you in.",
    after_reply: "Thanks {first_name}. Are you free for a quick video call now? {rep} is ready: {link}",
    handover_email_subject: "Your call with {rep} is ready",
    handover_email_tail: "If now is not good, reply and we will find a time.",
  },
};

const LANE_SENTENCES = {
  disabled: "Video rooms are off for now. Call or message the lead instead.",
  provider_off: "{provider} rooms are off for now. Use {other}.",
  test_only: "Video rooms are in testing, so they work only for the test contact for now.",
  no_contact: "Choose a lead first.",
  contact_unread: "HighLevel did not answer, so we cannot check this lead yet. Try again in a minute.",
  fallback_scope: "For now, video links after a missed call are only for booked intros. Call again or send a message.",
  fallback_pilot: "Video links after a missed call are in a pilot that does not include your seat yet. Ask the manager to add you.",
  wrap_too_early: "This call's room opens at {time}, 30 minutes before it starts. Try again then.",
  host_link: "This call's link in HighLevel is the host's start link, which must never reach the lead. Put the meeting's join link in HighLevel, then try again.",
  zoom_missing: "Your Zoom user is not set up on Mahara's account yet. Ask the manager to add it on the Team page. Meet works now.",
  zoom_missing_no_meet: "Your Zoom user is not set up on Mahara's account yet. Ask the manager to add it on the Team page.",
  zoom_pending_no_meet: "Your Zoom seat is not active yet. Accept Zoom's email invite.",
  zoom_busy_no_meet: "Your Zoom is in another meeting. End it first.",
  zoom_basic_demo_no_meet: "The closer's Zoom is Basic and ends at 40 minutes, too short for a demo. Ask the manager for a Zoom licence.",
  ended_mark_intro: "Nobody joined. The room is closed. Mark the intro:",
  offer_intro: "Live intro for you: {name}, {company}, {country}. On the phone with the setter now. Note: {note}. Take it within 2 minutes.",
  app_home_ready: "Ready now: {closers}, {setters}.",
  not_lead_late: "They joined more than {minutes} minutes ago, so this cannot be undone here. Fix the call in HighLevel.",
  too_early: "The room is not ready yet. Try again in a moment.",
  final: "This room has closed.",
  no_lead: "This room has no lead yet.",
  not_standby: "This room already has a lead.",
  not_requested: "Another worker already took this room.",
  not_claimed: "Claim the room before saving its link.",
  already_open: "This room is already open.",
  bad_link: "The room link is not a web address.",
  bad_input: "Something in this request is not right. Reload the page and try again.",
  call_over: "This call has already ended. There is no link to send.",
  call_nearly_over:
    "This call ends in under {minutes} minutes, so a room would close before the lead could join. Send the lead the call's own link.",
  take_host_busy: "You already have a live call or room open. End it, then take the next lead.",
  booked_other_rep: "This call is booked with another rep. Only they or a manager can make a room for it.",
  worker_late: "The room worker did not pick this room up in time.",
  worker_lost: "The room worker stopped half way through making this room.",
  worker_failed: "The room could not be made.",
  room_closed: "Room closed.",
  joined: "{name} joined at {time}.",
  health_never: "Rooms are down. The room worker has not run yet. Call the lead on the phone, or send your own Zoom or Meet link.",
  worker_down: "Video rooms are down right now. Call the lead on the phone, or send your own Zoom or Meet link.",
  health_working_no_counts: "Rooms: working. Last run {time}.",
  health_mismatch_many: "Zoom and the cockpit disagree on {rooms} today. Open their timelines.",
  watchdog_never: "The room worker has never run. New video rooms cannot be made.",
  why_wa_off: "WhatsApp is off for video links",
  why_no_phone: "the lead has no phone number",
  why_wa_dnd: "do not disturb is on for WhatsApp",
  why_wa_gate: "WhatsApp waits for the single-copy test",
  why_wa_paused: "WhatsApp is paused after two identical messages",
  why_wa_health: "WhatsApp video links are failing",
  why_window: "the WhatsApp window is closed",
  why_no_template: "no call link template is live",
  why_template_waiting: "an earlier WhatsApp template to this lead has not arrived yet",
  why_no_short_link: "the short link is not live yet",
  why_email_off: "email is off for video links",
  why_no_email: "the lead has no email address",
  why_email_dnd: "do not disturb is on for email",
};

describe("every sentence, word for word", () => {
  test("the 159 spec sentences", () => {
    expect(Object.values(SPEC_SENTENCES).reduce((n, g) => n + Object.keys(g).length, 0)).toBe(159);
    expect(ROOM_COPY).toEqual(SPEC_SENTENCES);
  });

  test("the lane's own sentences, for review", () => {
    expect(LANE_COPY).toEqual(LANE_SENTENCES);
  });

  test("plain copy rules: no em or en dash, no double space, a capital or a placeholder first, ends in a stop or a colon", () => {
    const groups: Record<string, Record<string, string>> = { ...(ROOM_COPY as unknown as Record<string, Record<string, string>>), lane: LANE_COPY };
    for (const [g, entries] of Object.entries(groups))
      for (const [k, s] of Object.entries(entries)) {
        const id = `${g}.${k}`;
        expect([id, /[\u2013\u2014]/.test(s)]).toEqual([id, false]);
        expect([id, /\S {2,}\S/.test(s)]).toEqual([id, false]);
        expect([id, s.trim() === s]).toEqual([id, true]);
        if (!k.startsWith("why_")) expect([id, /^[A-Z{"']/.test(s)]).toEqual([id, true]);
      }
    // Whole sentences (not the timeline's labels, button labels or the "why" clauses) end in a stop, a question
    // mark, a colon, or the link a rep reads out.
    const ends = /([.?:]|\{link\})$/;
    for (const [k, s] of Object.entries(ROOM_COPY.refusals)) expect([k, ends.test(s)]).toEqual([k, true]);
    for (const [k, s] of Object.entries(ROOM_COPY.panel)) if (!k.startsWith("no_end_signal")) expect([k, ends.test(s)]).toEqual([k, true]);
    for (const [k, s] of Object.entries(LANE_COPY)) if (!k.startsWith("why_")) expect([k, ends.test(s)]).toEqual([k, true]);
  });
});
