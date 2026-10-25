import type { NoticesIO } from "@/components/NoticesRouting";
import type { NoticeRead, NoticeView } from "@/forms/formConfig";
import {
  NoticeError,
  type SettingsPatch,
  type SettingsRead,
} from "@/lib/notices";

/**
 * Invented notices for the kickoff trail, the Onboarding panel and the
 * Notices and routing card (docs/forms/STAGE1-CONTRACT.md 6), for the
 * harness and the tests. No real person, client or Slack message: the
 * permalinks point at an example workspace, the people are made up.
 */

export const NOTICE_NOW = "2026-10-22T10:30:00.000Z"; // 13:30 in Kuwait
export const CSM_GENERAL = { id: "C09RZ0GS0V9", name: "csm-general" };
export const MEDIA_GENERAL = { id: "C0AE8G5MT7Y", name: "media-general" };

let n = 0;
export function noticeFixture(
  over: Partial<NoticeView> & Pick<NoticeView, "kind">,
): NoticeView {
  n += 1;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    state: "posted",
    variant: null,
    responseId: null,
    outboxId: null,
    parentKind: null,
    channel: CSM_GENERAL,
    at: "2026-10-22T11:03:00.000Z",
    dueAt: null,
    permalink:
      "https://example-workspace.slack.com/archives/C09RZ0GS0V9/p1792872070187739",
    reason: null,
    ...over,
  };
}

/** The send's kickoff notice in one of its states, or none yet. */
export function kickoffNotice(
  state: string,
  responseId: string,
  sentAt: string,
): NoticeView | null {
  const base = { kind: "kickoff", responseId, variant: null };
  const later = (m: number) =>
    new Date(Date.parse(sentAt) + m * 60_000).toISOString();
  switch (state) {
    case "posted":
      return noticeFixture({ ...base, variant: "complete", at: later(1) });
    case "late":
      return noticeFixture({ ...base, variant: "late", at: later(21) });
    case "queued":
      return noticeFixture({
        ...base,
        state: "queued",
        channel: null,
        permalink: null,
        at: sentAt,
        dueAt: later(20),
        reason: "Waiting for Make to update the card.",
      });
    case "failed":
      return noticeFixture({
        ...base,
        state: "failed",
        permalink: null,
        at: later(2),
        reason:
          "Slack refused it: mahara-club-bot is not in #csm-general. Invite it there, then ask the tech lead to requeue this notice.",
      });
    case "unknown":
      return noticeFixture({
        ...base,
        state: "unknown",
        permalink: null,
        at: later(2),
        reason:
          "Slack did not confirm the post; it is not sent again in case it arrived.",
      });
    case "muted":
      return noticeFixture({
        ...base,
        state: "muted",
        channel: null,
        permalink: null,
        at: later(1),
        reason: "Turned off in Settings, Notices and routing.",
      });
    case "skipped":
      return noticeFixture({
        ...base,
        state: "skipped",
        channel: null,
        permalink: null,
        at: sentAt,
        reason:
          "This kickoff was more than 48 hours old when the mirror listed it, so it was not posted.",
      });
    default:
      return null;
  }
}

export function noticeRead(
  taskId: string,
  notices: (NoticeView | null)[],
  now = NOTICE_NOW,
): NoticeRead {
  return {
    taskId,
    now,
    notices: notices.filter((x): x is NoticeView => x !== null),
  };
}

const ago = (now: string, hours: number) =>
  new Date(Date.parse(now) - hours * 3_600_000).toISOString();

/** The Notices and routing read, as an editor (or a viewer) would get it. */
export function settingsReadFixture(
  opts: { edit?: boolean; editors?: boolean; now?: string } = {},
): SettingsRead {
  const now = opts.now ?? NOTICE_NOW;
  const edit = opts.edit ?? true;
  const editors = opts.editors ?? edit;
  const migration = { updatedBy: "the migration", updatedAt: ago(now, 72) };
  const seat = (rule: string, found = true, slackKnown = true) => ({
    rule,
    found,
    slackKnown,
  });
  return {
    can: { edit, editors },
    notices: [
      {
        kind: "kickoff",
        shape: "post",
        on: true,
        fixedOn: false,
        channel: CSM_GENERAL,
        mentionRule: ["seat:creative"],
        mentionPeople: [],
        tags: [seat("seat:creative")],
        updatedBy: "the systems manager",
        updatedAt: ago(now, 2),
        last: noticeFixture({
          kind: "kickoff",
          variant: "complete",
          at: ago(now, 26),
        }),
      },
      {
        kind: "kickoff.late",
        shape: "variant",
        on: true,
        fixedOn: true,
        channel: null,
        mentionRule: ["seat:csm", "seat:systems_manager"],
        mentionPeople: [],
        tags: [seat("seat:csm"), seat("seat:systems_manager")],
        ...migration,
        last: null,
      },
      {
        kind: "kickoff.second",
        shape: "variant",
        on: true,
        fixedOn: true,
        channel: null,
        mentionRule: ["seat:csm"],
        mentionPeople: [],
        tags: [seat("seat:csm")],
        ...migration,
        last: null,
      },
      {
        kind: "kickoff.updated",
        shape: "reply",
        on: true,
        fixedOn: false,
        channel: null,
        mentionRule: [],
        mentionPeople: [],
        tags: [],
        ...migration,
        last: null,
      },
      {
        kind: "blueprint.close",
        shape: "post",
        on: true,
        fixedOn: false,
        channel: CSM_GENERAL,
        mentionRule: ["seat:csm"],
        mentionPeople: [
          { id: 41, label: "Rana, Project manager", slackKnown: false },
        ],
        tags: [seat("seat:csm")],
        ...migration,
        last: noticeFixture({
          kind: "blueprint.close",
          state: "failed",
          permalink: null,
          at: ago(now, 5),
          reason:
            "Slack refused it: mahara-club-bot is not in #csm-general. Invite it there, then ask the tech lead to requeue this notice.",
        }),
      },
      {
        kind: "blueprint.updated",
        shape: "reply",
        on: false,
        fixedOn: false,
        channel: null,
        mentionRule: [],
        mentionPeople: [],
        tags: [],
        updatedBy: "the CEO",
        updatedAt: ago(now, 30),
        last: null,
      },
      {
        kind: "blueprint.media",
        shape: "post",
        on: true,
        fixedOn: false,
        channel: MEDIA_GENERAL,
        mentionRule: [],
        mentionPeople: [],
        tags: [],
        ...migration,
        last: noticeFixture({
          kind: "blueprint.media",
          variant: "new",
          channel: MEDIA_GENERAL,
          at: ago(now, 5),
        }),
      },
      {
        kind: "blueprint.offer",
        shape: "reply",
        on: true,
        fixedOn: false,
        channel: null,
        mentionRule: ["seat:systems_manager"],
        mentionPeople: [],
        tags: [seat("seat:systems_manager", false, false)],
        ...migration,
        last: null,
      },
    ],
    channels: [
      {
        ...CSM_GENERAL,
        private: true,
        state: "ok",
        note: "Seeded: mahara-club-bot was a member on 2026-10-25.",
        checkedAt: ago(now, 72),
        inUse: true,
      },
      {
        ...MEDIA_GENERAL,
        private: true,
        state: "ok",
        note: "Seeded: mahara-club-bot was a member on 2026-10-25.",
        checkedAt: ago(now, 72),
        inUse: true,
      },
      {
        id: "C0EXAMPLE01",
        name: "client-call-feedback",
        private: true,
        state: "refused",
        note: "Invite @mahara-club-bot to #client-call-feedback, then add it again.",
        checkedAt: ago(now, 1),
        inUse: false,
      },
    ],
    people: edit
      ? [
          { id: 41, label: "Rana, Project manager" },
          { id: 42, label: "Omar, Creative strategist" },
          { id: 43, label: "Sara, Account manager" },
        ]
      : [],
    editors: editors
      ? [
          {
            memberId: "11111111-0000-4000-8000-000000000001",
            label: "Hala, Systems manager",
          },
        ]
      : [],
    members: editors
      ? [
          {
            memberId: "11111111-0000-4000-8000-000000000001",
            label: "Hala, Systems manager",
          },
          {
            memberId: "11111111-0000-4000-8000-000000000002",
            label: "Lina, CSM",
          },
        ]
      : [],
    test: null,
    now,
  };
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/**
 * The settings in memory, answering as the RPCs do: the same refusal
 * sentences, a channel that turns ready (or refused, for an ID ending in X)
 * a few reads later, a test that posts a few reads later. Nothing leaves
 * the page.
 */
export function fakeNoticesIO(
  start: SettingsRead,
  opts: { delay?: number; settleAfterReads?: number } = {},
): NoticesIO & { calls: { fn: string; args: unknown[] }[] } {
  const mem = clone(start);
  const calls: { fn: string; args: unknown[] }[] = [];
  const delay = opts.delay ?? 0;
  const settle = opts.settleAfterReads ?? 1;
  let reads = 0;
  const pause = () => new Promise(r => setTimeout(r, delay));
  const refuse = (m: string, code = "22023") => {
    throw new NoticeError(m, code);
  };
  const out = () => {
    mem.now = new Date(Date.parse(mem.now) + 1000).toISOString();
    return clone(mem);
  };
  return {
    calls,
    read: async () => {
      calls.push({ fn: "read", args: [] });
      await pause();
      reads += 1;
      if (reads >= settle) {
        for (const c of mem.channels)
          if (c.state === "checking") {
            c.state = c.id.endsWith("X") ? "refused" : "ok";
            c.note =
              c.state === "ok"
                ? "mahara-club-bot is in it."
                : `Invite @mahara-club-bot to #${c.name ?? c.id}, then add it again.`;
          }
        if (mem.test && mem.test.state === "queued") {
          mem.test.state = "posted";
          mem.test.at = mem.now;
        }
      }
      return out();
    },
    set: async (kind: string, patch: SettingsPatch) => {
      calls.push({ fn: "set", args: [kind, patch] });
      await pause();
      if (!mem.can.edit)
        refuse(
          "Only the CEO, an admin or someone they add can change notices and routing.",
          "42501",
        );
      const row = mem.notices.find(x => x.kind === kind);
      if (!row) return refuse(`There is no notice called ${kind}.`);
      if (patch.on !== undefined) {
        if (row.fixedOn)
          refuse(
            "This one is part of the kickoff notice and stays on. Turn the kickoff notice off instead.",
          );
        row.on = patch.on;
      }
      if (patch.channel !== undefined) {
        if (row.shape !== "post")
          refuse("Replies post in their first notice's thread.");
        const c = mem.channels.find(
          x => x.id === patch.channel && x.state === "ok",
        );
        if (!c)
          refuse(
            "Add that channel under Channels first; the cockpit checks the bot is in it.",
          );
        row.channel = { id: c?.id ?? "", name: c?.name ?? null };
      }
      if (patch.mentionRule) {
        row.mentionRule = [...new Set(patch.mentionRule)];
        row.tags = row.mentionRule.map(rule => ({
          rule,
          found: true,
          slackKnown: true,
        }));
      }
      if (patch.mentionPeople) {
        if (patch.mentionPeople.length > 10)
          refuse("Choose people from the team list.");
        row.mentionPeople = patch.mentionPeople.map(id => ({
          id,
          label: mem.people.find(p => p.id === id)?.label ?? `Person ${id}`,
          slackKnown: true,
        }));
      }
      row.updatedBy = "the systems manager";
      row.updatedAt = mem.now;
      return out();
    },
    addChannel: async (id: string, name: string | null) => {
      calls.push({ fn: "addChannel", args: [id, name] });
      await pause();
      const have = mem.channels.find(c => c.id === id);
      if (have?.state === "ok") refuse("That channel is already on the list.");
      const row = {
        id,
        name,
        private: null,
        state: "checking" as const,
        note: "Checking that mahara-club-bot is in it.",
        checkedAt: null,
        inUse: false,
      };
      mem.channels = [...mem.channels.filter(c => c.id !== id), row];
      reads = 0;
      return out();
    },
    removeChannel: async (id: string) => {
      calls.push({ fn: "removeChannel", args: [id] });
      await pause();
      const user = mem.notices.find(x => x.channel?.id === id);
      if (user)
        refuse(
          `The ${user.kind} notice posts there. Choose another channel for it first.`,
        );
      const c = mem.channels.find(x => x.id === id);
      if (c) c.state = "removed";
      return out();
    },
    rehearse: async (kind: string) => {
      calls.push({ fn: "rehearse", args: [kind] });
      await pause();
      if (mem.test && ["queued", "sending"].includes(mem.test.state))
        refuse("A test is already on its way. Wait for it, then send another.");
      const id = `22222222-0000-4000-8000-${String(calls.length).padStart(12, "0")}`;
      mem.test = { id, kind, state: "queued", at: mem.now, reason: null };
      reads = 0;
      return {
        id,
        state: "queued",
        note: "Your test reaches your Slack direct messages within a minute.",
      };
    },
    setEditor: async (memberId: string, on: boolean) => {
      calls.push({ fn: "setEditor", args: [memberId, on] });
      await pause();
      if (!mem.can.editors)
        refuse(
          "Only the CEO or an admin chooses who changes notices and routing.",
          "42501",
        );
      const m = mem.members.find(x => x.memberId === memberId);
      if (!m) refuse("Choose an active seat.");
      mem.editors = on
        ? [
            ...mem.editors.filter(e => e.memberId !== memberId),
            m as { memberId: string; label: string },
          ]
        : mem.editors.filter(e => e.memberId !== memberId);
      return out();
    },
  };
}
