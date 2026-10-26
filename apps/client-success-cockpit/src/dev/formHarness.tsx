/**
 * The kickoff window from invented fixtures, to see and screenshot every
 * state without signing in (docs/csm-forms/KICKOFF.md 2.5 and 4.1 to 4.4).
 * `bunx vite`, then open /client-success/scripts/form-preview.html?state=open
 * (state: open | missing | long | changed | held | after | done | late-make |
 * late-typeform | note-failed | slow | loading | blocked-list |
 * blocked-roster | blocked-identity | unreadable | unread; sharing=1;
 * rehearse=1; theme=light). After a send, slack= gives the trail's Slack
 * stop (docs/forms/STAGE1-CONTRACT.md 6.1): none (no row yet, the default)
 * | queued | posted | late | failed | unknown | muted | skipped | unread.
 * state=panel and state=panel-sent draw the client page's Onboarding panel
 * before and after a kickoff sent from the window (KICKOFF.md 1, step 10);
 * bp=none|sent|closed|locked|make|nudge gives the panel a Brand Blueprint
 * record (docs/brand-blueprint SPEC.md 6.1; nudge: a held call and no
 * close), and slack= the close's Slack stops (posted | failed | none).
 * state=notices draws Settings' Notices and routing card (as=viewer: read
 * only; read=failed: the failed read).
 *
 * Typeform is a stand-in drawn here: no Typeform page loads and nothing is
 * submitted anywhere. Its "submit" only calls the panel's own handler, and
 * the harness's record and checks stay in memory.
 */

import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import { NoticesRouting } from "@/components/NoticesRouting";
import { OnboardingKit } from "@/components/OnboardingKit";
import { Button } from "@/components/ui/button";
import type { BookProps, FormIO } from "@/forms/FormPanel";
import {
  blockedFor,
  FormWindowView,
  type WindowState,
} from "@/forms/FormWindow";
import type { FormContext } from "@/forms/formConfig";
import { KICKOFF } from "@/forms/kickoff";
import {
  FULL_ANSWERS,
  fixtureCall,
  fixtureContext,
  fixtureDeck,
  fixtureRow,
  fixtureSend,
  fixtureTimeline,
  NAME,
  NOW,
  onboardingEntry,
  TASK,
} from "./formFixtures";
import {
  fakeNoticesIO,
  kickoffNotice,
  MEDIA_GENERAL,
  noticeFixture,
  noticeRead,
  settingsReadFixture,
} from "./noticesFixtures";
import { standIn } from "./typeformStandIn";
import "@/index.css";

const params = new URLSearchParams(window.location.search);
const scenario = params.get("state") ?? "open";
const sharing = params.get("sharing") === "1";
const rehearse = params.get("rehearse") === "1";
if (params.get("theme") === "light")
  document.documentElement.classList.remove("dark");

const RESPONSE = "harnessresp0001";
const slack = params.get("slack") ?? "none";

/** The notices the window reads after the send, for ?slack=. */
function noticesAfter(ctx: FormContext, sentAt: string): Partial<FormContext> {
  if (slack === "unread")
    return {
      notices: null,
      failed: { ...ctx.failed, notices: "Failed to fetch" },
    };
  return {
    notices: noticeRead(
      TASK,
      [kickoffNotice(slack, RESPONSE, sentAt)],
      ctx.now,
    ),
  };
}
const minutes = (iso: string, m: number) =>
  new Date(Date.parse(iso) + m * 60_000).toISOString();

/** The record before any send, for each scenario. */
function before(): FormContext {
  const base = fixtureContext({ readAt: Date.now() });
  switch (scenario) {
    case "missing":
      return {
        ...base,
        row: fixtureRow({
          forms: {},
          handover: { closer: "Omar" },
          links: { clickup: `https://app.clickup.com/t/${TASK}` },
        }),
        deck: fixtureDeck({}),
        timeline: fixtureTimeline([]),
      };
    case "long":
      return {
        ...base,
        row: fixtureRow({
          forms: {
            onboarding: onboardingEntry({
              ...FULL_ANSWERS,
              marketing: `${FULL_ANSWERS.marketing}. ${"We tried a magazine ad, two exhibitions and a referral scheme. ".repeat(60)}`,
            }),
          },
        }),
      };
    case "held":
      return {
        ...base,
        row: fixtureRow({
          client_status: "Brand Blueprint Booked♠️",
          forms: {
            onboarding: onboardingEntry(),
            kickoff: {
              form_id: "tG7dnxBn",
              response_id: "oldresp000001",
              submitted_at: "2026-10-15T09:20:00Z",
              answers: [
                {
                  ref: "s",
                  title: "Which service are we advertising?",
                  value: "Interior design",
                },
                { ref: "c", title: "Contract status", value: "Signed" },
                {
                  ref: "r",
                  title: "Call Recording Link",
                  value: "https://fathom.example/share/old",
                },
              ],
            },
          },
        }),
      };
    default:
      return base;
  }
}

/** The record as the checks read it after the send. */
function after(read: FormContext, sentAt: string): FormContext {
  const ctx = { ...read, ...noticesAfter(read, sentAt) };
  const history = [
    {
      token: RESPONSE,
      formId: "tG7dnxBn",
      kind: "kickoff",
      submittedAt: sentAt,
      answers: [],
    },
  ];
  // The late scenarios: the checks read the record six minutes on.
  const later = scenario.startsWith("late")
    ? { now: minutes(sentAt, 6), readAt: Date.now() }
    : {};
  switch (scenario) {
    case "after":
      return { ...ctx, timeline: fixtureTimeline(undefined, history) };
    case "late-make":
      return {
        ...ctx,
        ...later,
        timeline: fixtureTimeline(undefined, history),
      };
    case "late-typeform":
      return { ...ctx, ...later };
    case "done":
      return {
        ...ctx,
        timeline: fixtureTimeline(undefined, history),
        row: {
          ...ctx.row,
          client_status: "Brand Blueprint Booked♠️",
          card_updated_at: minutes(sentAt, 1),
          links: {
            ...ctx.row.links,
            blueprint_form: `https://cockpit.maharamedia.com/client-success/clients/${TASK}/present/blueprint?view=prep`,
          },
        },
      };
    default:
      return ctx;
  }
}

function FakeBook(p: BookProps) {
  return (
    <div className="flex flex-col gap-1">
      <Button size="sm" variant={p.variant}>
        {p.label}
      </Button>
      {p.autoOpen ? (
        <button
          type="button"
          className="text-left text-xs text-muted-foreground underline"
          onClick={p.onAutoOpenConsumed}
        >
          The booking dialog opens here (harness stand-in). Close it.
        </button>
      ) : null}
    </div>
  );
}

/** The scenarios that start with a send, as if the CSM pressed Submit. */
const SENDS = ["after", "done", "late-make", "late-typeform", "note-failed"];
const embed = standIn({
  autoSubmit: SENDS.includes(scenario),
  fail: scenario === "slow",
  response: RESPONSE,
});

function Harness() {
  const [ctx, setCtx] = useState<FormContext>(before);
  const io = useMemo<FormIO>(
    () => ({
      record: async input => {
        await new Promise(r => setTimeout(r, 200));
        if (scenario === "note-failed")
          throw Error("The cockpit's form record is not live yet.");
        const sentAt = scenario.startsWith("late") ? NOW : minutes(NOW, 0);
        const send = fixtureSend({
          responseId: input.responseId,
          sentAt,
          hiddenKeys: input.hiddenKeys,
        });
        setCtx(c => ({ ...after(c, sentAt), sends: [send, ...c.sends] }));
        return send;
      },
      check: async () => {
        await new Promise(r => setTimeout(r, 400));
      },
      recheck: async () => {
        await new Promise(r => setTimeout(r, 400));
      },
      announce: () => {},
    }),
    [],
  );

  // The record changes under a form being filled: the panel says so.
  useEffect(() => {
    if (scenario !== "changed") return;
    const t = window.setTimeout(
      () =>
        setCtx(c => ({
          ...c,
          row: fixtureRow({
            forms: {
              onboarding: onboardingEntry({
                ...FULL_ANSWERS,
                hours: "Every day, 8 to 8",
              }),
            },
          }),
        })),
      600,
    );
    return () => window.clearTimeout(t);
  }, []);

  const state: WindowState =
    scenario === "loading"
      ? { kind: "loading" }
      : scenario === "unread"
        ? { kind: "unread" }
        : scenario === "blocked-list"
          ? blockedFor(
              Error("That client is not on your access list"),
              KICKOFF,
              TASK,
            )
          : scenario === "blocked-roster"
            ? blockedFor(
                Error("The client roster is incomplete"),
                KICKOFF,
                TASK,
              )
            : scenario === "blocked-identity"
              ? blockedFor(Error("Client card identity changed"), KICKOFF, TASK)
              : scenario === "unreadable"
                ? blockedFor(Error("Failed to fetch"), KICKOFF, TASK)
                : { kind: "ready", ctx };

  return (
    <>
      <FormWindowView
        cfg={KICKOFF}
        taskId={TASK}
        state={state}
        io={io}
        rehearse={rehearse}
        embed={embed}
        initialSharing={sharing}
        onRetry={() => {}}
        onRefresh={() => {}}
        book={p => <FakeBook {...p} />}
      />
      <Toaster />
    </>
  );
}

/** A Brand Blueprint record for the panel's line, held in this page. */
function blueprintStandIn(state: string | null) {
  if (!state) return undefined;
  const at = (minutesAgo: number) =>
    new Date(Date.parse(NOW) - minutesAgo * 60_000).toISOString();
  const parts =
    state === "none" || state === "nudge"
      ? null
      : {
          "1": { firstAt: at(48) },
          ...(state === "sent" ? {} : { "2": { firstAt: at(16) } }),
          ...(state === "locked" ? { "3": { firstAt: at(2) } } : {}),
        };
  return async () => ({
    parts,
    closeRoute: state === "make" ? "make" : "card_only",
    now: NOW,
  });
}

/** The panel's Slack notices: the kickoff's, and the close's two (?slack=). */
function panelNotices(sent: boolean) {
  const at = (minutesAgo: number) =>
    new Date(Date.parse(NOW) - minutesAgo * 60_000).toISOString();
  const kick = sent ? kickoffNotice("queued", "fixtureresp0001", NOW) : null;
  const close =
    slack === "none"
      ? []
      : [
          noticeFixture({
            kind: "blueprint.media",
            variant: "new",
            channel: MEDIA_GENERAL,
            at: at(15),
          }),
          slack === "failed"
            ? noticeFixture({
                kind: "blueprint.close",
                state: "failed",
                permalink: null,
                at: at(15),
                reason:
                  "Slack says mahara-club-bot is not in that channel. Ask the tech lead to add it there and send the notice again.",
              })
            : noticeFixture({ kind: "blueprint.close", at: at(15) }),
        ];
  return async () => noticeRead(TASK, [kick, ...close], NOW);
}

/** The client page's Onboarding panel, before and after a cockpit send. */
function PanelHarness() {
  const bp = params.get("bp");
  const kit = fixtureRow(
    bp === "nudge"
      ? {
          client_status: "Brand Blueprint Booked♠️",
          links: {
            clickup: `https://app.clickup.com/t/${TASK}`,
            onboarding_map: `https://mahara-onboarding-map.vercel.app/?phase=4&cid=${TASK}`,
          },
        }
      : {},
  );
  const blueprintRead = useMemo(() => blueprintStandIn(bp), [bp]);
  const sent = scenario === "panel-sent" ? fixtureSend({ sentAt: NOW }) : null;
  const noticesRead = useMemo(() => panelNotices(Boolean(sent)), [sent]);
  const timelineRead = useMemo(
    () => async () =>
      fixtureTimeline([
        fixtureCall({
          id: 7,
          kind: "blueprint",
          startsAt: "2026-10-18T10:00:00Z",
          status: "held",
        }),
      ]),
    [],
  );
  return (
    <div className="min-h-dvh bg-background p-6 text-foreground">
      <div className="mx-auto max-w-6xl">
        <OnboardingKit
          client={{
            name: NAME,
            taskId: TASK,
            bucket: "onboarding",
            stage:
              bp === "nudge" ? "Brand Blueprint Booked♠️" : "Onboarding Booked",
          }}
          kit={kit}
          page={{ rows: [kit], last: null, lastOk: null, now: NOW }}
          error={null}
          refreshing={false}
          onRefresh={() => {}}
          kickSend={sent}
          blueprintRead={blueprintRead}
          noticesRead={noticesRead}
          timelineRead={timelineRead}
        />
      </div>
      <Toaster />
    </div>
  );
}

/** Settings' Notices and routing card, on the Settings page's column. */
function NoticesHarness() {
  const viewer = params.get("as") === "viewer";
  const start = useMemo(
    () =>
      settingsReadFixture({
        edit: !viewer,
        editors: !viewer,
        now: new Date().toISOString(),
      }),
    [viewer],
  );
  const io = useMemo(() => {
    const fake = fakeNoticesIO(start, { delay: 300, settleAfterReads: 2 });
    return params.get("read") === "failed"
      ? {
          ...fake,
          read: async () => {
            throw Error("Failed to fetch");
          },
        }
      : fake;
  }, [start]);
  return (
    <div className="min-h-dvh bg-background p-4 text-foreground sm:p-6">
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px] sm:leading-9">
            Settings
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your account, how the cockpit looks, and where it posts in Slack
          </p>
        </header>
        <div className="max-w-2xl">
          <NoticesRouting io={io} />
        </div>
      </div>
      <Toaster />
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    {scenario === "notices" ? (
      <NoticesHarness />
    ) : scenario.startsWith("panel") ? (
      <PanelHarness />
    ) : (
      <Harness />
    )}
  </StrictMode>,
);
