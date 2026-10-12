import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";

type Panel = {
  taskId: string;
  title: string;
  client: string;
  status: string;
  sourceUrl: string | null;
  review: {
    token: string;
    sourceUrl: string;
    readyAt: string | null;
    error: string | null;
    decision: string | null;
  } | null;
};

/** A Slack link opens the exact video, never a client-name lookup. */
export function VideoTaskReview() {
  const [params] = useSearchParams();
  const task = params.get("videoTask");
  const currentTask = useRef(task);
  currentTask.current = task;
  const [panel, setPanel] = useState<Panel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const load = useCallback(async () => {
    if (!task) return;
    const { data, error: failure } = await supabase
      .rpc("cockpit_video_review_panel", { p_task: task })
      .abortSignal(AbortSignal.timeout(15_000));
    if (currentTask.current !== task) return;
    if (failure) {
      setError(failure.message);
      setPanel(null);
      return;
    }
    setPanel(data as Panel);
    setError(null);
  }, [task]);
  useEffect(() => {
    setPanel(null);
    setCopied(false);
    void load();
    const timer = window.setInterval(() => void load(), 10_000);
    return () => window.clearInterval(timer);
  }, [load]);
  if (!task) return null;
  const ready =
    panel?.review?.readyAt && panel.review.sourceUrl === panel.sourceUrl;
  const url = panel?.review
    ? `https://cockpit.maharamedia.com/editor/review/${panel.review.token}?lang=ar`
    : null;
  const message = `مرحبًا، الفيديو جاهز لمراجعتكم.\n\n${panel?.title ?? ""}\n${url ?? ""}\n\nشاهدوا الفيديو واضغطوا «موافقة» إذا كان مناسبًا، أو «طلب تعديل» لكتابة ملاحظاتكم. تصل ملاحظاتكم مباشرة إلى فريقنا.`;
  async function prepare() {
    setBusy(true);
    setError(null);
    try {
      const { error: failure } = await supabase.rpc(
        "cockpit_video_review_create",
        { p_task: task },
      );
      if (failure) throw failure;
      await load();
    } catch (e) {
      setError(
        (e as { message?: string }).message ??
          "The review could not be prepared.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="rounded-2xl border border-border bg-card p-5 shadow-sm"
      aria-label="Video approval handoff"
    >
      <p className="text-xs font-medium text-muted-foreground">
        VIDEO APPROVAL
      </p>
      <h2 className="mt-2 text-lg font-semibold" dir="auto">
        {panel?.title ?? "Loading video…"}
      </h2>
      {panel && (
        <p className="mt-1 text-sm text-muted-foreground">
          {panel.client} · {panel.status}
        </p>
      )}
      <p className="mt-3 text-sm">
        Approve the cut as Internal Approved in ClickUp. Prepare its client link
        here, then send the message in the client’s WhatsApp group. Client
        feedback returns to this same task.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button asChild variant="outline">
          <a
            href={`https://app.clickup.com/t/${encodeURIComponent(task)}`}
            target="_blank"
            rel="noreferrer"
          >
            Open video task
          </a>
        </Button>
        {panel?.sourceUrl?.startsWith("https://") && (
          <Button asChild variant="outline">
            <a href={panel.sourceUrl} target="_blank" rel="noreferrer">
              Watch approved cut
            </a>
          </Button>
        )}
        {!ready && (
          <Button
            disabled={
              busy ||
              !panel?.sourceUrl ||
              panel?.status.toLowerCase() !== "internal approved"
            }
            onClick={() => void prepare()}
          >
            {busy ? "Preparing…" : "Prepare client link"}
          </Button>
        )}
      </div>
      {panel && !panel.sourceUrl && (
        <p className="mt-3 text-sm">
          Add the approved cut to Edited Video Link on the ClickUp task first.
        </p>
      )}
      {panel?.review && !ready && (
        <p role="status" className="mt-3 text-sm">
          {panel.review.error ??
            "Checking the current cut and updating the task. This normally takes up to two minutes."}
        </p>
      )}
      {ready && url && (
        <div className="mt-4 space-y-3 rounded-xl bg-muted/40 p-4">
          <p className="whitespace-pre-wrap text-sm leading-7" dir="rtl">
            {message}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                void navigator.clipboard.writeText(message).then(
                  () => setCopied(true),
                  () =>
                    setError("Copy failed. Select and copy the message above."),
                );
              }}
            >
              {copied ? "Message copied" : "Copy client message"}
            </Button>
            <Button asChild variant="outline">
              <a href={url} target="_blank" rel="noreferrer">
                Preview client page
              </a>
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Preparing or copying does not send a message. Send it through the
            existing WhatsApp desk. The media buyer is notified only after
            client approval.
          </p>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
