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
 * The waves 1-2 staff forms (docs/forms/WAVE12-CONTRACT.md section 5, for the
 * 375 and 1280 px, light and dark checks): state=staff&form=extension |
 * pause | resume | churn_confirm | mrr draws FormSheet over formSheetFixtures
 * (prefill=loading | failed; trail= a TRAIL_ROWS key for what the trail reads
 * after Save: held, the default, queued, delivered, failed, skipped, voided);
 * inline=1 draws it as the billing sheet's inline FormBody (no ticket handler).
 * state=bands draws the client page's three doors and Today's four bands, and
 * state=checks the shared Checks waiting (as=viewer: a success manager's read),
 * both over a stand-in client answering from BAND_RPCS. The client page makes
 * its Supabase client when it loads, so state=bands needs the project's public
 * address and any anon text (nothing is called; the bands read the stand-in):
 * `VITE_SUPABASE_URL=https://bldgtotkfmhoxmlzowdx.supabase.co
 * VITE_SUPABASE_ANON_KEY=harness bunx vite`.
 *
 * Waves 3-4 (docs/forms/WAVE34-CONTRACT.md 5.0 to 5.4, the 375 and 1280 px,
 * light and dark checks), over clientFormsFixtures and a stand-in FormsIO:
 * state=forms draws Send a form (send=0 to close it; view= recent | none |
 * closed | notReported | quiet | membersOnly | leaving | empty; preset=
 * exit_survey) beside Forms out and Today's form bands; state=voice draws the
 * Client voice card (empty=1 | failed=1 | low=1); state=consent draws Pause
 * this client with the consent live (consent= none | sent | signed |
 * dates_wrong | expired; live=0 draws the old two ticks).
 *
 * Typeform is a stand-in drawn here: no Typeform page loads and nothing is
 * submitted anywhere. Its "submit" only calls the panel's own handler, and
 * the harness's record and checks stay in memory.
 */

import {
  lazy,
  StrictMode,
  Suspense,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import {
  type ChecksApi,
  ChecksWaitingView,
} from "@/components/billing/ChecksWaiting";
import {
  FormBands,
  FormsOut,
  PauseConsentRow,
  SendFormSheet,
  useInviteView,
} from "@/components/ClientForms";
import { ClientVoiceCard } from "@/components/ClientVoice";
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
import { FormBody, FormSheet } from "@/forms/staff/FormSheet";
import { FORM_DEFS, pauseConsentDef } from "@/forms/staff/formDefs";
import {
  CONSENT_WAIT,
  type FormKey,
  kuwaitIso,
} from "@/forms/staff/formSheetCore";
import { checkManualPayment, manualPaymentsToCheck } from "@/lib/paymentChecks";
import { standIn } from "@/practice/fixtures/typeformStandIn";
import {
  CONSENTS,
  NAME as FORMS_NAME,
  NOW as FORMS_NOW,
  TASK as FORMS_TASK,
  fakeFormsIO,
  LOW_SCORES,
  TODAY_ROWS,
  VIEWS,
  VOICE_FULL,
  VOICE_NONE,
} from "./clientFormsFixtures";
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
  BAND_RPCS,
  CALLS,
  CHURN_PREFILL,
  CLIENT,
  CLIENT_ARABIC,
  EXTENSION_READ,
  MRR_PREFILL,
  TRAIL_ROWS,
} from "./formSheetFixtures";
import {
  fakeNoticesIO,
  kickoffNotice,
  MEDIA_GENERAL,
  noticeFixture,
  noticeRead,
  settingsReadFixture,
} from "./noticesFixtures";
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

/** A Supabase stand-in for the bands and Checks waiting: answers from BAND_RPCS, a little late. */
const standInClient: any = {
  rpc: async (name: string) => {
    await new Promise(r => setTimeout(r, 250));
    return name in BAND_RPCS
      ? { data: BAND_RPCS[name], error: null }
      : { data: null, error: { message: `Not in the harness: ${name}` } };
  },
};

const STAFF_PREFILL: Record<FormKey, typeof EXTENSION_READ.prefill> = {
  extension: EXTENSION_READ.prefill,
  pause: [
    { key: "pauseKind", value: "client_request", source: "the pause request" },
  ],
  resume: [
    {
      key: "nextDate",
      value: "2026-11-20",
      source: "the old date moved by the pause's length",
    },
  ],
  churn_confirm: CHURN_PREFILL,
  mrr: MRR_PREFILL,
};

/** One staff form, in the sheet or inline, before and after Save. */
function StaffHarness() {
  const form = (params.get("form") ?? "extension") as FormKey;
  const def = FORM_DEFS[form] ?? FORM_DEFS.extension;
  const trail = TRAIL_ROWS[params.get("trail") ?? "held"] ?? TRAIL_ROWS.held;
  const read = params.get("prefill");
  const [open, setOpen] = useState(true);
  const props = {
    def,
    client: params.get("arabic") === "1" ? CLIENT_ARABIC : CLIENT,
    prefill: read ? [] : STAFF_PREFILL[form],
    calls: CALLS,
    hints: form === "extension" ? EXTENSION_READ.hints : [],
    status: "Active · due 2 Nov",
    loading: read === "loading",
    prefillError:
      read === "failed"
        ? "The card could not be read (Failed to fetch)."
        : null,
    submit: async () => {
      await new Promise(r => setTimeout(r, 600));
      return { message: "Saved in the harness", ref: { eventId: 1 } };
    },
    trail: async () => trail,
  };
  return (
    <div className="min-h-dvh bg-background p-4 text-foreground sm:p-6">
      <div className="mx-auto w-full max-w-2xl space-y-4">
        {params.get("inline") === "1" ? (
          <div className="rounded-xl border bg-card p-4">
            <FormBody {...props} />
          </div>
        ) : (
          <>
            <Button variant="outline" onClick={() => setOpen(true)}>
              Open {def.title}
            </Button>
            <FormSheet
              {...props}
              open={open}
              onOpenChange={setOpen}
              onTicket={() => {}}
            />
          </>
        )}
      </div>
      <Toaster />
    </div>
  );
}

/** The client page's doors and Today's bands, as a finance or CEO seat sees them (loaded only here). */
const BandsHarness = lazy(async () => {
  const { ClientDoors, TodayBands, useDoors, useTodayBands } = await import(
    "@/pages/CsmPage"
  );
  return {
    default: () => (
      <Bands {...{ ClientDoors, TodayBands, useDoors, useTodayBands }} />
    ),
  };
});

function Bands({
  ClientDoors,
  TodayBands,
  useDoors,
  useTodayBands,
}: Pick<
  typeof import("@/pages/CsmPage"),
  "ClientDoors" | "TodayBands" | "useDoors" | "useTodayBands"
>) {
  const doors = useDoors(standInClient);
  const bands = useTodayBands(standInClient, doors, true, true, 0);
  return (
    <div className="min-h-dvh bg-background p-4 text-foreground sm:p-6">
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <ClientDoors
          c={{
            taskId: CLIENT.taskId,
            name: CLIENT.name,
            stage: "Active",
            paymentDate: "2026-11-04",
          }}
          doors={doors}
          life={null}
          onOpen={() => {}}
        />
        <TodayBands
          client={standInClient}
          doors={doors}
          bands={bands}
          types={new Set(["client_pause", "client_offboarding"])}
          clients={[{ taskId: CLIENT.taskId, name: CLIENT.name }]}
          checker
          onDoor={() => {}}
          onTicket={() => {}}
          onChanged={() => {}}
        />
      </div>
      <Toaster />
    </div>
  );
}

/** The shared Checks waiting on its own, framed as on the billing page. */
function ChecksHarness() {
  const api = useMemo<ChecksApi>(
    () => ({
      door: async () => true,
      list: () => manualPaymentsToCheck(standInClient),
      check: p => checkManualPayment(standInClient, p),
      ticketType: async () => false,
    }),
    [],
  );
  return (
    <div className="min-h-dvh bg-background p-4 text-foreground sm:p-6">
      <div className="mx-auto w-full max-w-3xl">
        <ChecksWaitingView api={api} canCheck={params.get("as") !== "viewer"} />
      </div>
      <Toaster />
    </div>
  );
}

/** Send a form, Forms out and Today's form bands over a stand-in FormsIO (5.1 to 5.3). */
function FormsHarness() {
  const view = VIEWS[params.get("view") ?? "recent"] ?? VIEWS.recent;
  const io = useMemo(() => fakeFormsIO({ view, delay: 250 }), [view]);
  const read = useInviteView(io, FORMS_TASK, true);
  const [open, setOpen] = useState(params.get("send") !== "0");
  const preset = params.get("preset");
  return (
    <div className="min-h-dvh bg-background p-4 text-foreground sm:p-6">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <Button variant="outline" onClick={() => setOpen(true)}>
          Send a form
        </Button>
        <FormsOut io={io} read={read} onSend={() => setOpen(true)} />
        <FormBands
          io={io}
          bands={{
            invites: { rows: TODAY_ROWS, error: null },
            low: { rows: LOW_SCORES, error: null },
            reload: () => {},
          }}
          ticketTypes={new Set(["client_low_score"])}
          onSend={() => setOpen(true)}
          onOpenClient={() => {}}
          onTicket={() => {}}
          onChanged={() => {}}
        />
        <SendFormSheet
          io={io}
          open={open}
          taskId={FORMS_TASK}
          clientName={FORMS_NAME}
          now={FORMS_NOW}
          preset={preset ? { formKey: preset, origin: "churn" } : undefined}
          onClose={() => setOpen(false)}
        />
      </div>
      <Toaster />
    </div>
  );
}

/** The Client voice card (5.4). */
function VoiceHarness() {
  const low = params.get("low") === "1";
  const voice =
    params.get("empty") === "1"
      ? VOICE_NONE
      : low
        ? {
            ...VOICE_FULL,
            nps: {
              ...VOICE_FULL.nps,
              latest: VOICE_FULL.nps.latest
                ? { ...VOICE_FULL.nps.latest, score: 4 }
                : null,
            },
          }
        : VOICE_FULL;
  return (
    <div className="min-h-dvh bg-background p-4 text-foreground sm:p-6">
      <div className="mx-auto w-full max-w-2xl">
        <ClientVoiceCard
          state={
            params.get("failed") === "1"
              ? { status: "failed", error: "Failed to fetch" }
              : { status: "ready", voice }
          }
        />
      </div>
    </div>
  );
}

/** Pause this client with the pause consent live (4.3.6, 5.2). */
function ConsentHarness() {
  const key = (params.get("consent") ?? "sent") as keyof typeof CONSENTS;
  const consent = CONSENTS[key] ?? CONSENTS.sent;
  const live = params.get("live") !== "0";
  const io = useMemo(() => fakeFormsIO({ delay: 300 }), []);
  const [open, setOpen] = useState(true);
  const today = kuwaitIso();
  const def = live ? pauseConsentDef(consent) : FORM_DEFS.pause;
  return (
    <div className="min-h-dvh bg-background p-4 text-foreground sm:p-6">
      <div className="mx-auto w-full max-w-2xl space-y-4">
        <Button variant="outline" onClick={() => setOpen(true)}>
          Open Pause this client
        </Button>
        <FormSheet
          open={open}
          onOpenChange={setOpen}
          def={def}
          client={CLIENT}
          prefill={[
            {
              key: "pauseKind",
              value: "client_request",
              source: "the pause request",
            },
            {
              key: "restart",
              value: consent.restart ?? "2026-11-20",
              source: "the consent",
            },
          ]}
          calls={CALLS}
          status="Active · due 2 Nov"
          submit={async () => {
            await new Promise(r => setTimeout(r, 600));
            return {
              message: "from today, restarts 20 Nov",
              ref: { eventId: 1 },
            };
          }}
          trail={async () => TRAIL_ROWS.held}
          onTicket={() => {}}
          after={
            live
              ? a =>
                  a.pauseKind === "client_request" ? (
                    <PauseConsentRow
                      io={io}
                      taskId={CLIENT.taskId}
                      consent={consent}
                      answers={a}
                      today={today}
                      onSent={() => {}}
                    />
                  ) : null
              : undefined
          }
          blocked={
            live
              ? a =>
                  a.pauseKind === "client_request" && consent.state !== "signed"
                    ? CONSENT_WAIT
                    : null
              : undefined
          }
        />
      </div>
      <Toaster />
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    {scenario === "forms" ? (
      <FormsHarness />
    ) : scenario === "voice" ? (
      <VoiceHarness />
    ) : scenario === "consent" ? (
      <ConsentHarness />
    ) : scenario === "staff" ? (
      <StaffHarness />
    ) : scenario === "bands" ? (
      <Suspense fallback={null}>
        <BandsHarness />
      </Suspense>
    ) : scenario === "checks" ? (
      <ChecksHarness />
    ) : scenario === "notices" ? (
      <NoticesHarness />
    ) : scenario.startsWith("panel") ? (
      <PanelHarness />
    ) : (
      <Harness />
    )}
  </StrictMode>,
);
