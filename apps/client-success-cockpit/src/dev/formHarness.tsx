/**
 * The kickoff window from invented fixtures, to see and screenshot every
 * state without signing in (docs/csm-forms/KICKOFF.md 2.5 and 4.1 to 4.4).
 * `bunx vite`, then open /client-success/scripts/form-preview.html?state=open
 * (state: open | missing | long | changed | held | after | done | late-make |
 * late-typeform | note-failed | slow | loading | blocked-list |
 * blocked-roster | blocked-identity | unreadable | unread; sharing=1;
 * rehearse=1; theme=light). state=panel and state=panel-sent draw the
 * client page's Onboarding panel before and after a kickoff sent from the
 * window (KICKOFF.md 1, step 10).
 *
 * Typeform is a stand-in drawn here: no Typeform page loads and nothing is
 * submitted anywhere. Its "submit" only calls the panel's own handler, and
 * the harness's record and checks stay in memory.
 */

import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import { OnboardingKit } from "@/components/OnboardingKit";
import { Button } from "@/components/ui/button";
import type { BookProps, CreateWidget, FormIO } from "@/forms/FormPanel";
import {
  blockedFor,
  FormWindowView,
  type WindowState,
} from "@/forms/FormWindow";
import type { FormContext } from "@/forms/formConfig";
import { KICKOFF } from "@/forms/formConfig";
import {
  FULL_ANSWERS,
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
import "@/index.css";

const params = new URLSearchParams(window.location.search);
const scenario = params.get("state") ?? "open";
const sharing = params.get("sharing") === "1";
const rehearse = params.get("rehearse") === "1";
if (params.get("theme") === "light")
  document.documentElement.classList.remove("dark");

const RESPONSE = "harnessresp0001";
const minutes = (iso: string, m: number) =>
  new Date(Date.parse(iso) + m * 60_000).toISOString();

/** Typeform's stand-in: plain DOM in the container, as the SDK's iframe would be. */
function standIn(opts: { autoSubmit: boolean; fail?: boolean }) {
  return async (): Promise<CreateWidget> => {
    if (opts.fail) throw Error("The stand-in was told not to load.");
    return (_formId, options) => {
      const box = document.createElement("div");
      box.setAttribute("data-typeform-stand-in", "");
      box.style.cssText =
        "position:absolute;inset:0;display:grid;place-content:center;gap:18px;padding:32px;background:#0b1740;color:#f2f6fa;font:16px/1.5 Geist,'IBM Plex Sans Arabic',sans-serif;text-align:left";
      const h = options.hidden ?? {};
      const say = (html: string) => {
        box.innerHTML = html;
      };
      const question = () =>
        say(`
          <div style="font:11px 'Geist Mono',monospace;letter-spacing:.08em;text-transform:uppercase;color:rgba(242,246,250,.55)">Typeform stand-in (harness) · nothing loads or submits</div>
          <div style="font-size:22px;font-weight:600;max-width:560px">1 → Are the business details still correct?</div>
          <div style="max-width:560px;color:rgba(242,246,250,.75);white-space:pre-line">${[
            h.legal_name,
            h.phone,
            h.email,
            h.address,
          ]
            .filter(Boolean)
            .map(v => String(v).replace(/</g, "&lt;"))
            .join("\n")}</div>
          <div style="display:flex;gap:10px">
            <button data-act="start" style="padding:8px 16px;border-radius:6px;border:0;background:#00cfc8;color:#091333;font-weight:600">Yes</button>
            <button data-act="submit" style="padding:8px 16px;border-radius:6px;border:1px solid rgba(255,255,255,.3);background:transparent;color:#f2f6fa">Stand-in submit (nothing is sent)</button>
          </div>`);
      const ending = () =>
        say(`
          <div style="font-size:20px;font-weight:600;max-width:520px">Kickoff notes received. The client will receive their summary shortly.</div>
          <div style="color:rgba(242,246,250,.75)">Next step is the Brand Blueprint call. Book it now if it isn't booked already.</div>
          <div><button data-act="ending" style="padding:8px 16px;border-radius:6px;border:0;background:#00cfc8;color:#091333;font-weight:600">Book the Brand Blueprint call</button></div>`);
      box.addEventListener("click", e => {
        const act = (e.target as HTMLElement).getAttribute("data-act");
        if (act === "start")
          options.onStarted?.({ formId: "tG7dnxBn", responseId: RESPONSE });
        if (act === "submit") {
          options.onSubmit?.({ formId: "tG7dnxBn", responseId: RESPONSE });
          ending();
        }
        if (act === "ending")
          options.onEndingButtonClick?.({ formId: "tG7dnxBn" });
      });
      question();
      options.container.style.position = "relative";
      options.container.append(box);
      const ready = window.setTimeout(() => {
        options.onReady?.({ formId: "tG7dnxBn", isClosed: false });
        if (opts.autoSubmit) {
          options.onSubmit?.({ formId: "tG7dnxBn", responseId: RESPONSE });
          ending();
        }
      }, 250);
      return {
        unmount: () => {
          window.clearTimeout(ready);
          box.remove();
        },
      };
    };
  };
}

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
function after(ctx: FormContext, sentAt: string): FormContext {
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
            blueprint_form: `https://maharamedia.typeform.com/to/oYZKtogO#onboarding_client_id=${TASK}`,
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

/** The client page's Onboarding panel, before and after a cockpit send. */
function PanelHarness() {
  const kit = fixtureRow();
  const sent = scenario === "panel-sent" ? fixtureSend({ sentAt: NOW }) : null;
  return (
    <div className="min-h-dvh bg-background p-6 text-foreground">
      <div className="mx-auto max-w-6xl">
        <OnboardingKit
          client={{
            name: NAME,
            taskId: TASK,
            bucket: "onboarding",
            stage: "Onboarding Booked",
          }}
          kit={kit}
          page={{ rows: [kit], last: null, lastOk: null, now: NOW }}
          error={null}
          refreshing={false}
          onRefresh={() => {}}
          kickSend={sent}
        />
      </div>
      <Toaster />
    </div>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    {scenario.startsWith("panel") ? <PanelHarness /> : <Harness />}
  </StrictMode>,
);
