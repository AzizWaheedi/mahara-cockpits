import { ClipboardList } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { openNamed } from "@/present/PresentButton";
import type { FormKey, FormNews } from "./formConfig";

/**
 * The ways into a form window (KICKOFF.md 1), light on purpose: nothing of
 * the form panel loads until its window opens (the route is lazy). The
 * window is asked for by name, so a second click brings the same window
 * forward and never reloads a half-filled form.
 */

/** The app's base path; read when used (tests run without Vite's env). */
const base = () =>
  (import.meta.env?.BASE_URL ?? "/client-success/").replace(/\/$/, "");

export function formUrl(taskId: string, form: FormKey) {
  return `${base()}/clients/${encodeURIComponent(taskId)}/forms/${form}`;
}

/** The window's name: one per client per form. */
export const formWindowName = (taskId: string, form: FormKey) =>
  `mahara-form-${taskId}-${form}`;

/**
 * A window of its own, not a tab: Zoom's "share this window" then shares
 * the form alone, never the cockpit tab beside it. As large as the screen
 * allows, 1440 x 900 when the screen does not say.
 */
export function formWindowFeatures(
  screen:
    | { availWidth?: number; availHeight?: number }
    | undefined = typeof window !== "undefined" ? window.screen : undefined,
) {
  const w = Math.round(screen?.availWidth || 1440);
  const h = Math.round(screen?.availHeight || 900);
  return `popup,width=${w},height=${h},left=0,top=0`;
}

const OPENED_HERE = "mahara-form-opened-here";

/**
 * The form's own window; when the browser blocks it, the form opens in this
 * tab instead (the record never waits on a popup setting), and says so
 * there once it has loaded.
 */
export function openForm(taskId: string, form: FormKey) {
  const url = formUrl(taskId, form);
  const opened = openNamed(
    url,
    formWindowName(taskId, form),
    formWindowFeatures(),
  );
  if (opened) return opened;
  try {
    sessionStorage.setItem(OPENED_HERE, "1");
  } catch {
    // It still opens here; only the line saying why is lost.
  }
  window.location.assign(url);
  return null;
}

/** On a form window that opened in the cockpit's tab: say why, once. */
export function useOpenedHere() {
  useEffect(() => {
    try {
      if (!sessionStorage.getItem(OPENED_HERE)) return;
      sessionStorage.removeItem(OPENED_HERE);
    } catch {
      return;
    }
    toast("Your browser blocked the window, so it opened here.");
  }, []);
}

/** "Fill the kickoff": the step's one teal button, or a quiet one. */
export function FillFormButton({
  taskId,
  form,
  variant = "default",
  children,
}: {
  taskId: string;
  form: FormKey;
  variant?: "default" | "outline" | "link";
  children: ReactNode;
}) {
  if (variant === "link")
    return (
      <button
        type="button"
        className="text-xs text-primary-ink underline-offset-4 hover:underline"
        onClick={() => openForm(taskId, form)}
      >
        {children}
      </button>
    );
  return (
    <Button
      size="sm"
      variant={variant}
      onClick={() => openForm(taskId, form)}
      title="Opens the form in its own window, beside what the cockpit knows"
    >
      <ClipboardList aria-hidden />
      {children}
    </Button>
  );
}

// --------------------------------------------------- news between windows

export type { FormNews } from "./formConfig";

const CHANNEL = "mahara-forms";

export function announceForm(news: FormNews) {
  if (typeof BroadcastChannel === "undefined") return;
  try {
    const ch = new BroadcastChannel(CHANNEL);
    ch.postMessage(news);
    ch.close();
  } catch {
    // another tab will catch up on its own next read
  }
}

/** Listens for form windows; the cockpit tab re-reads the Onboarding panel. */
export function useFormNews(onNews: (news: FormNews) => void) {
  const ref = useRef(onNews);
  ref.current = onNews;
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(CHANNEL);
    ch.onmessage = e => {
      const n = e.data as FormNews | null;
      if (n && typeof n === "object" && typeof n.taskId === "string")
        ref.current(n);
    };
    return () => ch.close();
  }, []);
}
