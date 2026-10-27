/**
 * The creative director's Brand Blueprint pieces (docs/brand-blueprint
 * SPEC.md 4): the parts' states, the autosave, the press's words, the card,
 * the Settings section, the Links page fix and the dashboard's read; and
 * (docs/forms/STAGE1-CONTRACT.md 6.2) the nudge for a held call with no
 * close, the close's Slack stops, the server drain's refusals, and
 * Settings without a close route to choose. Synthetic records only.
 *
 * Run: bun test scripts/blueprint.test.tsx
 */

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { BlueprintCard, callLink } from "../src/components/BlueprintCard";
import { BlueprintSettings } from "../src/components/BlueprintSettings";
import {
  callFor,
  fakeBlueprintIO,
  fakeSettingsIO,
  MEMBERS,
  NAME,
  noticesFor,
  OFFER,
  OFFER_SHEET,
  PART1,
  PART2,
  rowFor,
  settingsFixture,
  TASK,
} from "../src/dev/blueprintFixtures";
import * as lib from "../src/lib/blueprint";
import {
  type BlueprintRow,
  FieldSaver,
  missing,
  offerLine,
  offerWait,
  partState,
  problem,
  required,
  type SaveResult,
  SERVICES,
} from "../src/lib/blueprint";
import { LINK_GROUPS } from "../src/lib/creativeLinks";
import { readNotices } from "../src/lib/notices";
import { readBlueprintRows } from "../src/lib/useCreativeSnapshot";

const H = 3_600_000;
const NOW = Date.parse("2026-10-24T09:00:00Z");
const at = (hoursAgo: number) => new Date(NOW - hoursAgo * H).toISOString();

function row(over: Partial<BlueprintRow> = {}): BlueprintRow {
  return {
    taskId: TASK,
    clientName: NAME,
    answers: {},
    parts: {},
    revision: 1,
    launchTaskId: null,
    outbox: { "1": null, "2": null, "3": null },
    can: { write: true },
    ...over,
  };
}
const stamp = (when: string, sent: Record<string, unknown>) => ({
  status: "done",
  firstAt: when,
  lastAt: when,
  presses: 1,
  sent,
});
const box = (
  state: string,
  createdAt: string,
  error: string | null = null,
) => ({
  id: "11111111-2222-4333-8444-555555555555",
  state,
  error,
  createdAt,
});

test("the part rules: conditions switch keys on and off as the server's do", () => {
  expect(required(1, { starter: "no" })).toEqual([
    "service",
    "capacity",
    "starter",
    "daily_budget",
    "destination",
    "identity",
  ]);
  expect(required(1, { starter: "yes", capacity: "tight" })).toContain(
    "capacity_note",
  );
  expect(
    required(1, { starter: "yes", pack_approval: "wants_changes" }),
  ).toContain("pack_changes");
  expect(missing(1, PART1)).toEqual([]);
  expect(missing(2, PART2)).toEqual([]);
  expect(
    missing(2, { ...PART2, dna_status: "big_gaps", dna_missing: "" }),
  ).toEqual(["dna_missing"]);
  expect(missing(3, { offer: { name: "A", what: "B" } })).toEqual(["offer"]);
  expect(
    missing(3, { offer: { name: "A", what: "B", firstStep: "  " } }),
  ).toEqual(["offer"]);
  expect(missing(3, { offer: OFFER })).toEqual([]);
  expect(offerLine(OFFER)).toBe(
    "The whole-floor refresh: Design, materials and fit-out for one floor, in ten weeks. First step: A free site visit with our lead designer.",
  );
});

test("each part has one state, from the record and what this window is doing", () => {
  expect(partState(null, 1, {}, NOW).kind).toBe("not_started");
  expect(partState(null, 1, { service: "interior" }, NOW)).toEqual({
    kind: "in_progress",
    done: 1,
    of: 6,
  });
  expect(partState(null, 1, PART1, NOW).kind).toBe("ready");
  expect(partState(null, 3, { offer: { name: "A", what: "B" } }, NOW)).toEqual({
    kind: "in_progress",
    done: 2,
    of: 3,
  });

  const sent = row({
    answers: PART1,
    parts: { "1": stamp(at(2), PART1) },
    outbox: { "1": box("done", at(2)), "2": null, "3": null },
  });
  expect(partState(sent, 1, sent.answers, NOW)).toMatchObject({ kind: "sent" });
  // An edit after the send: "Changed since sent", naming what moved.
  const moved = { ...PART1, daily_budget: { usd: 50 } };
  expect(partState(sent, 1, moved, NOW)).toMatchObject({
    kind: "changed",
    keys: ["daily_budget"],
  });
  // A press whose run never finished: young, it is still running somewhere;
  // after a minute, "Saved, not confirmed".
  const pending = row({
    outbox: { "1": box("pending", at(0.005)), "2": null, "3": null },
  });
  expect(partState(pending, 1, {}, NOW).kind).toBe("sending");
  const stuck = row({
    outbox: { "1": box("pending", at(0.5)), "2": null, "3": null },
  });
  expect(partState(stuck, 1, {}, NOW).kind).toBe("unconfirmed");
  const broken = row({
    outbox: {
      "1": null,
      "2": null,
      "3": box("reconcile", at(1), "ClickUp said no"),
    },
  });
  expect(partState(broken, 3, {}, NOW)).toMatchObject({
    kind: "needs_look",
    error: "ClickUp said no",
  });
  expect(partState(null, 2, {}, NOW, { running: true }).kind).toBe("sending");
});

test("the offer waits from the call's close, and is late after 48 hours", () => {
  const closed = (h: number) =>
    row({ parts: { "1": stamp(at(h + 1), {}), "2": stamp(at(h), {}) } });
  expect(offerWait(closed(20), NOW)).toMatchObject({ late: false });
  expect(offerWait(closed(49), NOW)).toMatchObject({ late: true });
  expect(
    offerWait(
      row({
        parts: {
          "1": stamp(at(60), {}),
          "2": stamp(at(59), {}),
          "3": stamp(at(1), {}),
        },
      }),
      NOW,
    ),
  ).toBeNull();
});

test("the autosave: one save in flight, seen per key, nothing typed is lost", async () => {
  const calls: {
    changes: Record<string, { value: unknown; seen: unknown }>;
    base: number | null;
  }[] = [];
  let fail = true;
  let release: () => void = () => {};
  let stored: Record<string, unknown> = { offer: { name: "Old" } };
  const saver = new FieldSaver(
    {
      save: async (changes, base) => {
        calls.push({ changes, base });
        if (fail) {
          fail = false;
          throw new Error("offline");
        }
        await new Promise<void>(r => {
          release = r;
        });
        stored = {
          ...stored,
          ...Object.fromEntries(
            Object.entries(changes).map(([k, c]) => [k, c.value]),
          ),
        };
        return {
          row: row({ answers: { ...stored }, revision: 3 }),
          applied: Object.keys(changes),
          conflicts: [],
        } satisfies SaveResult;
      },
    },
    row({ answers: { offer: { name: "Old" } }, revision: 2 }),
    { saved: () => {}, failed: () => {} },
    5,
  );
  saver.set("offer", { name: "New" });
  await saver.flush();
  // The first save failed: what was typed is still waiting.
  expect(saver.dirty).toBe(true);
  // No base revision: the server checks each key against what was seen.
  expect(calls[0]).toEqual({
    changes: { offer: { value: { name: "New" }, seen: { name: "Old" } } },
    base: null,
  });
  const second = saver.flush();
  await new Promise(r => setTimeout(r, 5));
  saver.set("scripts_status", "in_progress");
  expect(calls).toHaveLength(2);
  release();
  await second;
  await new Promise(r => setTimeout(r, 20));
  release();
  await saver.flush();
  expect(calls).toHaveLength(3);
  // The next save carries only the value the server confirmed, never the revision.
  expect(calls[2]?.base).toBeNull();
  expect(Object.keys(calls[2]?.changes ?? {})).toEqual(["scripts_status"]);
  expect(saver.answers.offer).toEqual({ name: "New" });
  saver.dispose();
});

test("the autosave never lets a line this card still shows overwrite another seat's change", async () => {
  // The server's per-key rule (cockpit_blueprint_save without a base revision).
  let stored: Record<string, unknown> = {
    offer: { name: "Old" },
    scripts_status: "in_progress",
  };
  let theirs = new Set<string>();
  const conflicts: string[] = [];
  const save = async (
    changes: Record<string, { value: unknown; seen: unknown }>,
  ): Promise<SaveResult> => {
    const applied: string[] = [];
    const out: SaveResult["conflicts"] = [];
    for (const [k, c] of Object.entries(changes)) {
      const same = (a: unknown, b: unknown) =>
        JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
      if (
        theirs.has(k) &&
        !same(stored[k], c.seen) &&
        !same(stored[k], c.value)
      ) {
        out.push({ key: k, theirs: stored[k], by: "Omar", at: null });
        continue;
      }
      applied.push(k);
      stored = { ...stored, [k]: c.value };
      theirs.delete(k);
    }
    return {
      row: row({ answers: { ...stored }, revision: 9 }),
      applied,
      conflicts: out,
    };
  };
  const saver = new FieldSaver(
    { save },
    row({ answers: { ...stored }, revision: 2 }),
    {
      saved: r => conflicts.push(...r.conflicts.map(c => c.key)),
      failed: () => {},
    },
    1,
  );
  // Another seat changes the offer; the card saves the scripts' status,
  // whose returned row holds the new offer the card never showed.
  stored = { ...stored, offer: { name: "Their offer" } };
  theirs = new Set(["offer"]);
  saver.set("scripts_status", "with_editors", true);
  await saver.flush();
  // Then the card edits the offer it still shows: a conflict, not an overwrite.
  saver.set("offer", { name: "Old, edited here" }, true);
  await saver.flush();
  expect(conflicts).toEqual(["offer"]);
  expect(stored.offer).toEqual({ name: "Their offer" });
  expect(stored.scripts_status).toBe("with_editors");
  // Use mine still wins.
  saver.insist("offer", { name: "Old, edited here" }, { name: "Their offer" });
  await saver.flush();
  expect(stored.offer).toEqual({ name: "Old, edited here" });
  saver.dispose();
});

test("a refusal reads as a sentence, and Still missing names the answers", () => {
  expect(problem({ message: "Still missing", details: "offer" })).toBe(
    "Still missing: the offer's name, what they get and the free first step.",
  );
  expect(problem({ message: "Close the call first." })).toBe(
    "Close the call first.",
  );
});

/** The card sits in the cockpit's router: its ways into the call are links. */
const routed = (el: ReactElement) =>
  renderToStaticMarkup(createElement(MemoryRouter, null, el));

test("Run the Blueprint call opens the call in this cockpit, at a part when asked (EMBED.md 4.1)", () => {
  expect(callLink(TASK, "part2", true, NAME, "Launch Booked")).toEqual({
    to: {
      pathname: "/blueprint/86exmpl01",
      search: "?rehearse=1",
      hash: "#part2",
    },
    state: { clientName: NAME, status: "Launch Booked" },
  });
  expect(callLink(TASK, undefined, false, NAME, null).to).toEqual({
    pathname: "/blueprint/86exmpl01",
    search: "",
    hash: "",
  });
  // Links (Cmd-click still gives a tab), never a window of the other cockpit.
  const open = card("open");
  expect(open).toMatch(
    /<a (?=[^>]*href="\/blueprint\/86exmpl01")(?=[^>]*title="Opens the call here: prepare it, then Present")[^>]*>(?:(?!<\/a>).)*Run the Blueprint call<\/a>/,
  );
  const part1 = card("part1");
  expect(part1).toContain("Ready: Send to media on the call");
  expect(part1).not.toContain("from the call window");
  expect(part1).toMatch(
    /href="\/blueprint\/86exmpl01#part1"[^>]*>Open part 1</,
  );
  expect(card("sent")).toMatch(
    /href="\/blueprint\/86exmpl01#part2"[^>]*>Finish part 2</,
  );
  // A rehearsal stays one on the call page.
  expect(card("part1", { rehearse: true })).toMatch(
    /href="\/blueprint\/86exmpl01\?rehearse=1#part1"/,
  );
  for (const html of [open, part1, card("sent"), card("closed")])
    expect(html).not.toContain("/client-success/");
  // Nothing on the card opens a window or names the other cockpit's deck.
  const source = readFileSync(
    new URL("../src/components/BlueprintCard.tsx", import.meta.url),
    "utf8",
  );
  expect(source).not.toMatch(/window\.open|openNamed|openPrep|client-success/);
  expect("openPrep" in lib).toBe(false);
  expect("prepUrl" in lib).toBe(false);
});

const card = (state: string, extra: Record<string, unknown> = {}) =>
  routed(
    createElement(BlueprintCard, {
      taskId: TASK,
      clientName: NAME,
      status: "Launch Booked",
      offerSheet: OFFER_SHEET,
      io: fakeBlueprintIO(rowFor(state)),
      initial: { row: rowFor(state), now: new Date().toISOString() },
      ...extra,
    }),
  ).replace(/<!-- -->/g, "");

test("the card: three parts, the offer slip, and Lock the offer only after the call", () => {
  const open = card("open");
  expect(open).toContain("Run the Blueprint call");
  expect(open).toContain(
    "Not started · confirm it in the prep before the call",
  );
  expect(open).toContain("Opens when the call closes");
  // Before the call closes, part 3 is one quiet line: no slip to type in.
  expect(open).not.toContain('id="bp-offer-name"');
  expect(open).not.toContain("Lock the offer");

  const closed = card("closed");
  for (const label of ["Offer name", "What they get", "Free first step"])
    expect(closed).toContain(label);
  // The lines grow with what is typed, on a phone too.
  expect(closed).toMatch(/<textarea[^>]*id="bp-offer-what"/);
  expect(closed).toContain("Launch task");
  expect(closed).toContain("https://app.clickup.com/t/86exlaunch1");
  expect(closed).toContain("Call closed");
  expect(closed).toMatch(/Waiting · under a day · 2 of 3 lines/);
  expect(closed).toContain("Write the offer&#x27;s three lines first.");
  expect(closed).toContain(OFFER_SHEET);

  expect(card("late")).toMatch(/Waiting · 2 days/);
  expect(card("unconfirmed")).toContain("Run it again");
  expect(card("unconfirmed")).toContain(
    "it reuses the same request, so nothing is made twice.",
  );
  expect(card("changed")).toContain("Changed since sent");
  expect(card("changed")).toContain("Send the changes");
  expect(card("changed")).toContain("Changed: the daily budget.");
  const needs = card("needs");
  expect(needs).toContain("Needs a look:");
  expect(needs).toContain("ask an admin to reconcile");
});

test("the card folds to one line once all three are sent, and says so in rehearsal", () => {
  const locked = card("locked");
  expect(locked).toContain("Brand Blueprint:");
  expect(locked).toMatch(/done \d{1,2} [A-Z][a-z]{2}/);
  expect(locked).not.toContain("Lock the offer");
  expect(card("closed", { rehearse: true })).toContain(
    "Rehearsal: nothing is saved or sent.",
  );
  // In rehearsal the press reads as a plan, not a real lock.
  expect(card("closed", { rehearse: true })).toContain("Show the Lock plan");
  // An active client with no Blueprint on record gets no card at all.
  expect(
    routed(
      createElement(BlueprintCard, {
        taskId: TASK,
        clientName: NAME,
        status: "Active",
        io: fakeBlueprintIO(null),
        initial: { row: null, now: new Date().toISOString() },
      }),
    ),
  ).toBe("");
});

test("Settings: five packs in the kickoff's order and words; the close is fixed and points to the notices", () => {
  const html = (admin: boolean) =>
    renderToStaticMarkup(
      createElement(BlueprintSettings, {
        io: fakeSettingsIO(settingsFixture(admin)),
        initial: { settings: settingsFixture(admin), members: MEMBERS },
      }),
    );
  const cd = html(false);
  let last = -1;
  for (const s of SERVICES) {
    const i = cd.indexOf(s.label);
    expect(i).toBeGreaterThan(last);
    last = i;
  }
  expect(SERVICES.map(s => s.label)).toEqual([
    "Design and build",
    "Interior design",
    "Architectural design",
    "Fit out and renovation",
    "Construction only",
  ]);
  expect(cd).toContain("Not set: part 1 asks for the link on the call.");
  expect(cd).toContain("Share each folder as Anyone with the link can view.");
  expect(cd).toContain("Example media buyer");
  // No route to choose, for anyone (docs/forms/PLAN.md D5).
  for (const page of [cd, html(true)]) {
    expect(page).toContain("After Close the call");
    // No channel named in code (D17): Notices and routing says where.
    expect(page).toContain(
      "The cockpit writes the card and its comments, and the CSM pastes the phase 5 WhatsApp from the card comment. The client success and media teams hear in Slack through the notices; where they post and who they tag is set on Notices and routing.",
    );
    expect(page).not.toMatch(/#csm-general|#media-general/);
    expect(page).toContain("Open Notices and routing");
    // One line at 320 px: short words, no wrap, the arrow kept beside them,
    // teal text in the ink that reads on white.
    expect(page).toMatch(
      /<a [^>]*class="[^"]*whitespace-nowrap[^"]*text-primary-ink[^"]*"[^>]*>Open Notices and routing<svg[^>]*shrink-0/,
    );
    // The page every seat may open; the server decides what it shows.
    expect(page).toContain(
      'href="https://cockpit.maharamedia.com/client-success/notices"',
    );
    expect(page).not.toContain('name="bp-close-route"');
    expect(page).not.toMatch(/Card and Slack|Make 14|Card only/);
  }
  expect("CLOSE_ROUTES" in lib).toBe(false);
  expect(lib.NOTICES_SETTINGS_URL).toBe(
    "https://cockpit.maharamedia.com/client-success/notices",
  );
});

test("the nudge: a held Blueprint call with no close says so and opens the call page", () => {
  const at = (state: string, over: Record<string, unknown> = {}) =>
    routed(
      createElement(BlueprintCard, {
        taskId: TASK,
        clientName: NAME,
        status: "Brand Blueprint Booked♠️",
        offerSheet: OFFER_SHEET,
        io: fakeBlueprintIO(rowFor(state)),
        initial: {
          row: rowFor(state),
          now: new Date().toISOString(),
          call: callFor("nudge"),
          ...over,
        },
      }),
    ).replace(/<!-- -->/g, "");
  const held = callFor("nudge")?.heldAt as string;
  const html = at("nudge");
  expect(html).toContain(
    `Blueprint call held ${lib.dayWeek(held)}. No Blueprint record yet.`,
  );
  expect(html).toMatch(
    /<a [^>]*href="\/blueprint\/86exmpl01"[^>]*>Open the call page\.<\/a>/,
  );
  // Legible on the warning banner in light theme: the ink teal, underlined.
  expect(html).toMatch(
    /<a [^>]*class="[^"]*text-primary-ink underline[^"]*"[^>]*>Open the call page\.<\/a>/,
  );
  const css = readFileSync(
    new URL("../src/index.css", import.meta.url),
    "utf8",
  );
  expect(css).toContain("--primary-ink: #00807b;");
  expect(css).toContain("--color-primary-ink: var(--primary-ink);");
  expect(lib.dayWeek("2026-10-18T10:00:00Z")).toBe("Sun 18 Oct");
  // The server says no nudge, or the call is closed: no nudge.
  expect(
    at("nudge", { call: { ...callFor("nudge"), nudge: false } }),
  ).not.toContain("Blueprint call held");
  expect(at("closed")).not.toContain("Blueprint call held");
});

test("the close's Slack stops: where and when each posted, and what to do when one did not", () => {
  const at = (state: string, notices: unknown) =>
    routed(
      createElement(BlueprintCard, {
        taskId: TASK,
        clientName: NAME,
        status: "Launch Booked",
        offerSheet: OFFER_SHEET,
        io: fakeBlueprintIO(rowFor(state)),
        initial: { row: rowFor(state), now: new Date().toISOString(), notices },
      }),
    ).replace(/<!-- -->/g, "");
  const posted = at("posted", noticesFor("posted"));
  // Dated against the close on the row's own line ("Call closed 15:57"):
  // "at 16:03" on the close's Kuwait day, else "on Mon 26 Oct 09:00", the
  // card's one day format. Never against the read's clock, which made a
  // post read as earlier than the close the day after.
  const closedAt = rowFor("posted").parts?.["2"]?.lastAt as string;
  const stopTime = (iso: string, anchor: string) => {
    const w = lib.whenNear(iso, anchor);
    return /^\d\d:\d\d$/.test(w) ? `at ${w}` : `on ${w}`;
  };
  for (const n of noticesFor("posted").notices)
    expect(posted).toContain(
      `Posted in #${n.channel?.name} ${stopTime(n.at, closedAt)}`,
    );
  expect(posted).not.toMatch(/on \w{3} \d{1,2} \w{3}, \d\d:\d\d/);
  // A post a day after the close says its day, in the card's format.
  const nextDay = new Date(Date.parse(closedAt) + 26 * 3600_000).toISOString();
  const later = noticesFor("posted");
  const dayAfter = at("posted", {
    ...later,
    notices: later.notices.map(n => ({ ...n, at: nextDay })),
  });
  expect(dayAfter).toContain(
    `Posted in #csm-general on ${lib.whenLong(nextDay)}`,
  );
  expect(posted).toContain(
    'href="https://example-workspace.slack.com/archives/C09RZ0GS0V9/p1"',
  );
  expect(posted).toContain("Open in Slack");
  // The lead carries the warning; the reason is a plain sentence after it,
  // with one label, never two.
  const refused = at("notposted", noticesFor("notposted"));
  expect(refused).toContain(
    '<span class="txt-warn font-medium">Not posted in #csm-general.</span><span class="text-foreground"> Slack says mahara-club-bot is not in that channel. Ask the tech lead to add it there and send the notice again.</span>',
  );
  expect(refused).not.toMatch(/: Slack (says|refused it):/);
  // Beside wrapped text the dot sits on the first line.
  expect(refused).toContain('<span class="mt-[5px] flex self-start">');
  // Nothing on record, or a failed read: said, never blank.
  const none = at("closed", {
    taskId: TASK,
    now: new Date().toISOString(),
    notices: [],
  });
  expect(none).toContain(
    "No client success notice is on record for this close.",
  );
  expect(none).toContain("No media notice is on record for this close.");
  expect(none).not.toMatch(/#csm-general|#media-general/);
  expect(at("closed", null)).toContain(
    "The cockpit could not read the Slack notices just now.",
  );
  // Part 3's post, dated against the offer on its own line: "Reply posted"
  // only when it went in the close's thread.
  const offeredAt = rowFor("needs").parts?.["3"]?.lastAt as string;
  const reply = noticesFor("locked").notices[0];
  expect(at("needs", noticesFor("locked"))).toContain(
    `Reply posted in #csm-general ${stopTime(reply.at, offeredAt)}`,
  );
  const older = noticesFor("olderreply").notices[0];
  expect(at("needs", noticesFor("olderreply"))).toContain(
    `Reply posted in #csm-general on ${lib.whenLong(older.at)}`,
  );
  // The close did not post (turned off), so the offer went top level: it
  // says "Posted", never "Reply posted" under a thread that does not exist.
  const top = at("needs", noticesFor("offertop"));
  const topAt = noticesFor("offertop").notices[0].at;
  expect(top).toContain(`Posted in #csm-general ${stopTime(topAt, offeredAt)}`);
  expect(top).not.toContain("Reply posted");
  // Queued: where it is set to post (the server names Settings' channel).
  expect(at("posted", noticesFor("queued"))).toContain(
    "Waiting to post in #csm-general.",
  );
  // Before the close there is nothing to say about Slack.
  expect(at("sent", noticesFor("posted"))).not.toContain("#csm-general");
});

test("the server drain's refusals: one state while it tries again; the two ends name the press and open its part", () => {
  // Trying again: one state, no button to press, the cause and its fix first.
  const refused = card("refused");
  expect(refused).toContain(">Refused, trying again<");
  // Its reason sits under the state it explains, as the notice stops do.
  expect(refused).toContain(
    '<p role="status" class="mt-1 pl-8 text-xs txt-warn sm:pl-48">',
  );
  expect(refused).toContain(
    "The Marketing/ADs list has two open launch tasks for this client. Close one in ClickUp. The cockpit tries again in 2 minutes (1 of 3).",
  );
  expect(refused).not.toContain("Saved, not confirmed");
  expect(refused).not.toContain("Run it again");
  // Three refusals, or 30 minutes: the press by name, and the way to it.
  const refused3 = card("refused3");
  expect(refused3).toContain(
    "This press was refused: The Marketing/ADs list has two open launch tasks for this client. Close one in ClickUp. Fix it, then press Send to media on the call again.",
  );
  expect(refused3).not.toContain("Needs a look:");
  expect(refused3).toMatch(
    /<a [^>]*href="\/blueprint\/86exmpl01#part1"[^>]*>Open part 1<\/a>/,
  );
  const timedout = card("timedout");
  expect(timedout).toContain(
    "This press did not finish within 30 minutes. Press Send to media on the call again.",
  );
  expect(timedout).not.toContain("Needs a look:");
  expect(timedout).toContain(">Open part 1</a>");
  // A press stopped part way still needs a person.
  expect(card("needs")).toContain("Needs a look:");
});

test("the reads: the call's nudge, the outbox's attempts, the Slack notices", async () => {
  const rpc = (answer: unknown, error: unknown = null) => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      seen.push([name, args]);
      return { data: answer, error };
    },
    functions: {} as never,
    auth: {} as never,
  });
  const seen: [string, Record<string, unknown>][] = [];
  const call = await lib.readBlueprintCall(
    rpc({ clientName: NAME, blueprintCall: callFor("nudge") }) as never,
    TASK,
  );
  expect(call?.nudge).toBe(true);
  expect(seen[0]).toEqual(["cockpit_blueprint_sources", { p_task_id: TASK }]);
  expect(
    await lib.readBlueprintCall(rpc({ clientName: NAME }) as never, TASK),
  ).toBeNull();
  const refused = rowFor("refused") as BlueprintRow;
  const { rows } = await lib.readBlueprints(
    rpc({ rows: [refused], now: new Date().toISOString() }) as never,
    [TASK],
  );
  expect(rows[0]?.outbox?.["1"]?.attempts).toBe(1);
  const read = await readNotices(rpc(noticesFor("posted")) as never, TASK);
  expect(read.notices.map(n => n.kind)).toEqual([
    "blueprint.media",
    "blueprint.close",
  ]);
  expect(seen.at(-1)).toEqual([
    "cockpit_slack_notice_read",
    { p_task_id: TASK },
  ]);
  await expect(
    readNotices(
      rpc(null, {
        message: "That client is not on your access list",
        code: "42501",
      }) as never,
      TASK,
    ),
  ).rejects.toThrow("That client is not on your access list");
});

test("the client's brief no longer lists the old Brand blueprint form", () => {
  const source = readFileSync(
    new URL("../src/lib/creativeSourceModels.ts", import.meta.url),
    "utf8",
  );
  expect(source).not.toContain('line("Brand blueprint form"');
});

test("the Links page no longer sends the bare Typeform; the deck is a note", () => {
  const rows = LINK_GROUPS.flatMap(g => g.rows);
  expect(rows.some(r => (r.url ?? "").includes("oYZKtogO"))).toBe(false);
  expect(rows.some(r => /client fills it before the call/i.test(r.label))).toBe(
    false,
  );
  const deck = rows.find(r => r.label === "The Blueprint call deck");
  expect(deck?.url).toBeUndefined();
  expect(deck?.note).toContain("the client never fills a form");
});

test("the dashboard reads the record beside the source; a failed read is null", async () => {
  const fake = (rows: unknown[] | Error) => ({
    rpc: async (name: string, args: { p_task_ids: string[] }) => {
      expect(name).toBe("cockpit_blueprint_read");
      if (rows instanceof Error)
        return { data: null, error: { message: rows.message } };
      expect(args.p_task_ids).toEqual(["86exmpl01"]);
      return { data: { rows, now: new Date().toISOString() }, error: null };
    },
    functions: {} as never,
    auth: {} as never,
  });
  const clients = [
    { taskId: "86exmpl01", name: NAME },
    { taskId: "86exother", name: "Somebody else" },
  ];
  const r = rowFor("closed") as BlueprintRow;
  const mapped = await readBlueprintRows(fake([r]) as never, clients, [NAME]);
  expect(mapped).toEqual([
    {
      _id: TASK,
      taskId: TASK,
      client: NAME,
      parts: {
        "1": { at: r.parts["1"].firstAt, lastAt: r.parts["1"].lastAt },
        "2": { at: r.parts["2"].firstAt, lastAt: r.parts["2"].lastAt },
      },
      offerLine:
        "The whole-floor refresh: Design, materials and fit-out for one floor, in ten weeks.",
      approval: "first_batch",
      dnaStatus: "small_gaps",
      dnaMissing: "Their colour codes and the logo files",
    },
  ]);
  const quiet = console.warn;
  console.warn = () => {};
  try {
    expect(
      await readBlueprintRows(
        fake(new Error("permission denied")) as never,
        clients,
        [NAME],
      ),
    ).toBeNull();
  } finally {
    console.warn = quiet;
  }
});
