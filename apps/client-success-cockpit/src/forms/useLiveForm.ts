import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readClientTimeline, type Timeline } from "@/lib/csmCalls";
import { readNotices } from "@/lib/notices";
import {
  readOnboardingKits,
  refreshOnboardingKits,
} from "@/lib/onboardingClient";
import type { KitsPage } from "@/lib/onboardingCore";
import { type DeckSources, readDeckSources } from "@/present/sources";
import { readFormSends, recordFormSend, type SendInput } from "./formClient";
import type {
  FormConfig,
  FormContext,
  FormKey,
  FormSend,
  NoticeRead,
} from "./formConfig";
import { announceForm, type FormNews } from "./OpenFormButton";
import { formLink } from "./prefill";
import type { FormIO } from "./useFormPanel";

/**
 * One client's record for a form, read and kept fresh (KICKOFF.md 2.5 and
 * 4.2): the card's row, the deck's sources, the call store and the cockpit's
 * own sends, read through the signed-in seat's client (the gate decides).
 * The kickoff window and the onboarding deck's last slide both open the
 * form through this, so both read the same things and say the same plain
 * sentence when a read fails. The reads are handed in, so the harnesses and
 * the tests run it on fixtures.
 */

export type WindowState =
  | { kind: "loading" }
  | {
      kind: "blocked";
      text: string;
      retry: boolean;
      plain: string | null;
      /** Nothing here will change it: offer to close the window. */
      close?: boolean;
    }
  | { kind: "unread" }
  | { kind: "ready"; ctx: FormContext };

/** What the form reads and writes, for one client and one form. */
export interface FormReads {
  /** cockpit_csm_onboarding_read, this card. */
  kits(): Promise<Pick<KitsPage, "rows" | "now">>;
  /** cockpit_csm_deck_sources: offer, HighLevel, prep. */
  deck(): Promise<DeckSources>;
  /** cockpit_csm_client_timeline: calls and form history. */
  timeline(): Promise<Timeline>;
  /** cockpit_csm_form_sends_read, newest first. */
  sends(): Promise<{ sends: FormSend[] }>;
  /** cockpit_csm_form_sent. */
  record(input: SendInput): Promise<{ send: FormSend }>;
  /** The one-card refresh (onboarding.refresh). */
  refresh(): Promise<Pick<KitsPage, "rows" | "now" | "problem">>;
  /**
   * cockpit_slack_notice_read, this card: the trail's Slack stop. Only the
   * kickoff window reads it; the deck, on the client's screen, does not.
   */
  notices?(): Promise<NoticeRead>;
  /** Tells the cockpit's own tab. */
  announce?(news: FormNews): void;
}

/** The reads through the seat's own Supabase client. */
export function formReads(
  client: SupabaseClient | null,
  taskId: string,
  form: FormKey,
  /** `notices: true`: the trail's Slack stop (the kickoff window only). */
  opts: { notices?: boolean } = {},
): FormReads {
  const need = () => {
    if (!client) throw Error("Sign in to the cockpit first.");
    return client;
  };
  const reads: FormReads = {
    kits: async () => readOnboardingKits(need(), [taskId]),
    deck: async () => readDeckSources(need(), taskId),
    timeline: async () => readClientTimeline(need(), taskId),
    sends: async () => readFormSends(need(), taskId, form),
    record: input => recordFormSend(client, input),
    refresh: async () => refreshOnboardingKits(need(), taskId, [taskId]),
    announce: announceForm,
  };
  if (opts.notices) reads.notices = async () => readNotices(need(), taskId);
  return reads;
}

const said = (e: unknown) => String((e as Error)?.message ?? e ?? "").trim();

/** Why the form stays closed, in plain words (KICKOFF.md 2.5). */
export function blockedFor(
  error: unknown,
  cfg: Pick<FormConfig, "title" | "formId" | "idField">,
  taskId: string,
): Extract<WindowState, { kind: "blocked" }> {
  const m = said(error);
  const name = cfg.title.toLowerCase();
  if (
    /not on your access list|access is required|access required|42501/i.test(m)
  )
    return {
      kind: "blocked",
      text: `This client is not on your list, so the ${name} cannot open here. Ask your lead to add this client, then try again.`,
      retry: false,
      plain: null,
      close: true,
    };
  if (/roster is incomplete|missing or ambiguous/i.test(m))
    return {
      kind: "blocked",
      text: "The client list is refreshing. Try again in a minute.",
      retry: true,
      plain: null,
    };
  if (/identity changed/i.test(m))
    return {
      kind: "blocked",
      text: `The card's name and the client list disagree, so the ${name} stays closed. Refresh the client list, then try again.`,
      retry: true,
      plain: null,
    };
  return {
    kind: "blocked",
    text: `The client's record could not be read, so the ${name} stays closed: a form without the right card ID reaches no client.`,
    retry: true,
    plain: formLink(cfg.formId, { [cfg.idField]: taskId }),
  };
}

export interface LiveForm {
  state: WindowState;
  io: FormIO;
  /** Reads everything again (Try again). */
  retry: () => void;
  /** The one-card refresh, then a fresh read (an unread card). */
  refresh: () => Promise<void>;
  refreshing: boolean;
}

export function useLiveForm({
  cfg,
  taskId,
  reads,
  me,
}: {
  cfg: FormConfig;
  taskId: string;
  reads: FormReads;
  me: FormContext["me"];
}): LiveForm {
  const [state, setState] = useState<WindowState>({ kind: "loading" });
  const [refreshing, setRefreshing] = useState(false);

  const update = useCallback((fn: (ctx: FormContext) => FormContext) => {
    setState(s => (s.kind === "ready" ? { kind: "ready", ctx: fn(s.ctx) } : s));
  }, []);

  const load = useCallback(async () => {
    const [kits, deck, timeline, sends, notices] = await Promise.allSettled([
      reads.kits(),
      reads.deck(),
      reads.timeline(),
      reads.sends(),
      reads.notices ? reads.notices() : Promise.resolve(null),
    ]);
    if (kits.status === "rejected") {
      setState(blockedFor(kits.reason, cfg, taskId));
      return;
    }
    const row = kits.value.rows.find(r => r.clickup_task_id === taskId);
    if (!row) {
      setState({ kind: "unread" });
      return;
    }
    setState({
      kind: "ready",
      ctx: {
        taskId,
        row,
        deck: deck.status === "fulfilled" ? deck.value : null,
        timeline: timeline.status === "fulfilled" ? timeline.value : null,
        sends: sends.status === "fulfilled" ? sends.value.sends : [],
        notices: notices.status === "fulfilled" ? notices.value : null,
        me,
        now: kits.value.now,
        readAt: Date.now(),
        failed: {
          deck: deck.status === "rejected" ? said(deck.reason) : undefined,
          timeline:
            timeline.status === "rejected" ? said(timeline.reason) : undefined,
          sends: sends.status === "rejected" ? said(sends.reason) : undefined,
          notices:
            notices.status === "rejected"
              ? said(notices.reason) || "No reason was given."
              : undefined,
        },
      },
    });
  }, [reads, taskId, cfg, me]);

  useEffect(() => {
    void load();
  }, [load]);

  // The notices again: a failed read keeps the last one and says so.
  const readNoticesAgain = useCallback(async () => {
    if (!reads.notices) return;
    try {
      const notices = await reads.notices();
      update(ctx => ({
        ...ctx,
        notices,
        failed: { ...ctx.failed, notices: undefined },
      }));
    } catch (e) {
      update(ctx => ({
        ...ctx,
        failed: { ...ctx.failed, notices: said(e) || "No reason was given." },
      }));
    }
  }, [reads, update]);

  // The client's row, prep (slide 4's service pick) and the call store are
  // read again when the window gets focus: a pick made on the deck shows up
  // here, and onboarding answers that came in after the window opened are
  // said over the form (the form itself stays as it opened until Reload).
  const lastFocusRead = useRef(Date.now());
  useEffect(() => {
    const onFocus = () => {
      if (Date.now() - lastFocusRead.current < 10_000) return;
      lastFocusRead.current = Date.now();
      void readNoticesAgain();
      void Promise.allSettled([
        reads.deck(),
        reads.timeline(),
        reads.kits(),
      ]).then(([deck, timeline, kits]) => {
        const row =
          kits.status === "fulfilled"
            ? kits.value.rows.find(r => r.clickup_task_id === taskId)
            : undefined;
        update(ctx => ({
          ...ctx,
          // A failed read, or no row, keeps the row the window has.
          ...(row && kits.status === "fulfilled"
            ? { row, now: kits.value.now, readAt: Date.now() }
            : {}),
          deck: deck.status === "fulfilled" ? deck.value : ctx.deck,
          timeline:
            timeline.status === "fulfilled" ? timeline.value : ctx.timeline,
          failed: {
            ...ctx.failed,
            deck: deck.status === "rejected" ? said(deck.reason) : undefined,
            timeline:
              timeline.status === "rejected"
                ? said(timeline.reason)
                : undefined,
          },
        }));
      });
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [reads, taskId, update, readNoticesAgain]);

  const io = useMemo<FormIO>(
    () => ({
      record: async input => {
        const { send } = await reads.record(input);
        update(ctx => ({
          ...ctx,
          sends: [
            send,
            ...ctx.sends.filter(s => s.responseId !== send.responseId),
          ],
        }));
        return send;
      },
      check: async () => {
        const page = await reads.refresh();
        const [timeline, sends] = await Promise.allSettled([
          reads.timeline(),
          reads.sends(),
          readNoticesAgain(),
        ]);
        update(ctx => ({
          ...ctx,
          row: page.rows.find(r => r.clickup_task_id === taskId) ?? ctx.row,
          timeline:
            timeline.status === "fulfilled" ? timeline.value : ctx.timeline,
          sends: sends.status === "fulfilled" ? sends.value.sends : ctx.sends,
          now: page.now,
          readAt: Date.now(),
          failed: {
            ...ctx.failed,
            sends: sends.status === "rejected" ? said(sends.reason) : undefined,
          },
        }));
        if (page.problem) throw Error(page.problem);
      },
      recheck: async () => {
        const timeline = await reads.timeline();
        update(ctx => ({
          ...ctx,
          timeline,
          failed: { ...ctx.failed, timeline: undefined },
        }));
      },
      announce: reads.announce,
      ...(reads.notices ? { notices: readNoticesAgain } : {}),
    }),
    [reads, taskId, update, readNoticesAgain],
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await reads.refresh();
      await load();
    } catch (e) {
      setState(blockedFor(e, cfg, taskId));
    } finally {
      setRefreshing(false);
    }
  }, [reads, load, cfg, taskId]);

  const retry = useCallback(() => {
    setState({ kind: "loading" });
    void load();
  }, [load]);

  return { state, io, retry, refresh, refreshing };
}
