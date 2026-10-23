import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { supabase } from "./supabase";

const text = z.string().nullable();
export const AppointmentFeedbackSchema = z.object({
  appointmentId: z.string().min(1),
  contactId: text.optional(),
  contactName: text,
  startAt: text,
  attendance: text,
  deal: text,
  leadQuality: z.number().min(1).max(10).nullable(),
  feedback: text,
  consultationFeedback: text,
  notClosedReason: text,
  updatedAt: text,
  deliveryState: z
    .enum(["pending", "leased", "succeeded", "failed", "review"])
    .nullable(),
  adName: text.optional(),
  campaignName: text.optional(),
  source: text.optional(),
});
export type AppointmentFeedback = z.infer<typeof AppointmentFeedbackSchema>;
export const FeedbackPageSchema = z.object({
  locationId: z.string().min(1),
  generatedAt: z.string(),
  total: z.number().int().nonnegative(),
  items: z.array(AppointmentFeedbackSchema),
  hasMore: z.boolean(),
});
export type FeedbackPage = z.infer<typeof FeedbackPageSchema>;
export type FeedbackScope = {
  locationId?: string | null;
  taskId?: string | null;
  from?: string | null;
  to?: string | null;
  offset?: number;
};
export const FEEDBACK_PAGE_SIZE = 5;

/** Only a client card ID is an identity. Client names never select feedback. */
export function clickupTaskId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "app.clickup.com")
      return undefined;
    return /^\/t\/([a-zA-Z0-9]+)\/?$/.exec(url.pathname)?.[1];
  } catch {
    return undefined;
  }
}

export function feedbackScopeKey(scope: FeedbackScope): string {
  return JSON.stringify([
    scope.locationId || null,
    scope.taskId || null,
    scope.from || null,
    scope.to || null,
    scope.offset || 0,
  ]);
}

export function feedbackQuality(row: AppointmentFeedback): number | null {
  return row.attendance === "no_show" ? null : row.leadQuality;
}

export function feedbackDelivery(
  state: AppointmentFeedback["deliveryState"],
): string | null {
  if (state === "review")
    return "Feedback saved. Follow-up delivery needs a team check.";
  if (state === "failed")
    return "Feedback saved. Follow-up delivery will retry.";
  if (state === "pending" || state === "leased")
    return "Feedback saved. Follow-up delivery is in progress.";
  return null;
}

export async function readAppointmentFeedback(
  scope: FeedbackScope,
  signal: AbortSignal,
): Promise<FeedbackPage> {
  let data: unknown;
  try {
    const result = await supabase
      .rpc("cockpit_client_appointment_feedback", {
        p_location: scope.locationId || null,
        p_task_id: scope.taskId || null,
        p_from: scope.from || null,
        p_to: scope.to || null,
        p_limit: FEEDBACK_PAGE_SIZE,
        p_offset: scope.offset || 0,
      })
      .abortSignal(signal);
    if (result.error) throw result.error;
    data = result.data;
  } catch {
    throw new Error(
      "Client feedback could not be read. Check your connection and try again.",
    );
  }
  const parsed = FeedbackPageSchema.safeParse(data);
  if (
    !parsed.success ||
    (scope.locationId && parsed.data.locationId !== scope.locationId)
  )
    throw new Error(
      "Client feedback could not be verified. Try again or contact the team.",
    );
  return parsed.data;
}

export type FeedbackRead = {
  key: string;
  status: "loading" | "ready" | "error";
  data?: FeedbackPage;
  message?: string;
  refreshing: boolean;
  readAt?: number;
};
export type FeedbackReader = typeof readAppointmentFeedback;

/** No persistent cache: only this exact client, period and page can remain visible. */
export function useAppointmentFeedback(
  scope: FeedbackScope,
  reader: FeedbackReader = readAppointmentFeedback,
) {
  const key = feedbackScopeKey(scope);
  const enabled = Boolean(scope.locationId || scope.taskId);
  const [state, setState] = useState<FeedbackRead>({
    key,
    status: "loading",
    refreshing: false,
  });
  const reloadRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let busy = false;
    let controller: AbortController | undefined;
    const [locationId, taskId, from, to, offset] = JSON.parse(key);
    const captured: FeedbackScope = { locationId, taskId, from, to, offset };
    const refresh = async () => {
      if (!active || busy) return;
      busy = true;
      controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 20_000);
      setState(prior => ({
        key,
        status: prior.key === key && prior.data ? "ready" : "loading",
        data: prior.key === key ? prior.data : undefined,
        refreshing: true,
        readAt: prior.key === key ? prior.readAt : undefined,
      }));
      try {
        const data = await reader(captured, controller.signal);
        if (active)
          setState({
            key,
            status: "ready",
            data,
            refreshing: false,
            readAt: Date.now(),
          });
      } catch (error) {
        if (active)
          setState(prior => ({
            key,
            status: "error",
            data: prior.key === key ? prior.data : undefined,
            refreshing: false,
            readAt: prior.key === key ? prior.readAt : undefined,
            message:
              error instanceof Error
                ? error.message
                : "Client feedback could not be read. Try again.",
          }));
      } finally {
        clearTimeout(timeout);
        busy = false;
      }
    };
    const visibleRefresh = () => {
      if (document.visibilityState !== "hidden") void refresh();
    };
    reloadRef.current = () => void refresh();
    void refresh();
    const timer = setInterval(visibleRefresh, 15_000);
    window.addEventListener("focus", visibleRefresh);
    document.addEventListener("visibilitychange", visibleRefresh);
    return () => {
      active = false;
      controller?.abort();
      clearInterval(timer);
      window.removeEventListener("focus", visibleRefresh);
      document.removeEventListener("visibilitychange", visibleRefresh);
      reloadRef.current = () => undefined;
    };
  }, [enabled, key, reader]);
  // A changed client must clear synchronously, before the effect starts its next read.
  const visible =
    state.key === key
      ? state
      : { key, status: "loading" as const, refreshing: false };
  return { ...visible, enabled, reload: () => reloadRef.current() };
}
