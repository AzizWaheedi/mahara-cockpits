import type { SupabaseClient } from "@supabase/supabase-js";
import { ArrowUpRight, Handshake, PenLine } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import { Chip, ExtLink } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  type AskKind,
  askStatus,
  type ClientAsk,
  type ClientAsksView,
  clientSteps,
  kwDay,
  latestAsk,
  pushLine,
  readClientAsks,
  sendClientAsk,
  withdrawClientAsk,
} from "@/lib/clientAsks";

/**
 * Ask a client for a Google review or a referral in their Mahara OS portal
 * (Aziz, 2026-10-29: "press a button ... it comes up with a really clean
 * pop-up without annoying them"). The portal shows it the next time someone
 * from the client opens it, at most once a day and twice in all, and sends one
 * phone alert to people with task alerts on. Everything they do with it comes
 * back here. docs/client-asks/PLAN.md.
 */

const PORTAL = "https://portal.maharamedia.com";
/** Where a seat logs a review for the four Rs (csmLinks, "Money, the four Rs"). */
const REVIEW_FORM = "https://maharamedia.typeform.com/to/ETEynRgb";

const KINDS: {
  kind: AskKind;
  title: string;
  icon: typeof PenLine;
  button: string;
  reads: string;
}[] = [
  {
    kind: "review",
    title: "Google review",
    icon: PenLine,
    button: "Ask for a review",
    reads:
      "“Would you review Mahara on Google?” A few honest lines, about a minute, one button to Google's review form.",
  },
  {
    kind: "referral",
    title: "Referral",
    icon: Handshake,
    button: "Ask for a referral",
    reads:
      "“Know a firm that could use more projects?” The referral rewards, one button to the programme and one to WhatsApp us.",
  },
];

const PROBLEM: Record<string, string> = {
  no_workspace:
    "This client has no Mahara OS workspace yet, so there is nowhere to show an ask.",
  two_workspaces:
    "Two Mahara OS workspaces carry this client card. Fix the Client Data sheet before asking.",
  workspace_closed: "This client has left. Asks go to current clients only.",
};

type Rpc = Pick<SupabaseClient, "rpc">;

export function ClientAsks({
  taskId,
  rpc,
}: {
  taskId: string;
  /** A stand-in for the harness; the page uses the seat's own client. */
  rpc?: Rpc;
}) {
  const auth = useCockpitAuth();
  const client = rpc ?? auth.client;
  const [view, setView] = useState<ClientAsksView | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setError("");
    readClientAsks(client, taskId)
      .then(setView)
      .catch((e: Error) => setError(e.message));
  }, [client, taskId]);
  useEffect(load, [load]);

  const location = view?.workspace?.locationId;
  return (
    <div className="space-y-4 rounded-2xl border bg-card p-4 text-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <h2 className="text-[15px] font-semibold">Ask in their portal</h2>
          <p className="text-xs text-muted-foreground">
            It pops up the next time someone from {view?.clientName ?? "them"}{" "}
            opens Mahara OS. Once a day at most, twice in all, never again after
            No thanks.
          </p>
        </div>
      </div>

      {error ? (
        <p className="txt-bad" role="alert">
          {error}{" "}
          <button type="button" className="underline" onClick={load}>
            Try again
          </button>
        </p>
      ) : !view ? (
        <p className="text-muted-foreground">Reading their asks…</p>
      ) : (
        <>
          {view.problem ? (
            <p className="rounded-xl bg-muted px-3 py-2">
              {PROBLEM[view.problem]}
            </p>
          ) : null}
          <div className="grid gap-3 md:grid-cols-2">
            {KINDS.map(k => (
              <AskTile
                key={k.kind}
                spec={k}
                view={view}
                blocked={!!view.problem}
                previewHref={
                  location
                    ? `${PORTAL}/?${new URLSearchParams({ clientId: location, askPreview: k.kind })}`
                    : null
                }
                onView={setView}
                client={client}
              />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Ask every client for a review, not only the happy ones. Google
            removes reviews from businesses that choose who to ask, and never
            offer anything for one.
          </p>
        </>
      )}
    </div>
  );
}

function AskTile({
  spec,
  view,
  blocked,
  previewHref,
  onView,
  client,
}: {
  spec: (typeof KINDS)[number];
  view: ClientAsksView;
  blocked: boolean;
  previewHref: string | null;
  onView: (v: ClientAsksView) => void;
  client: Rpc | null;
}) {
  const { ask, earlier } = latestAsk(view, spec.kind);
  const open = ask?.state === "open";
  const reviewed =
    spec.kind === "review" &&
    view.asks.some(a => a.kind === "review" && a.state === "done");
  const [compose, setCompose] = useState(false);
  const [note, setNote] = useState("");
  const [push, setPush] = useState(true);
  const [busy, setBusy] = useState(false);
  // One id per compose, so a retry after a dropped answer sends one ask.
  const request = useRef<string | null>(null);
  const Icon = spec.icon;
  const pushId = useId();

  const send = async () => {
    request.current ??= crypto.randomUUID();
    setBusy(true);
    try {
      onView(
        await sendClientAsk(client, {
          taskId: view.taskId,
          kind: spec.kind,
          note,
          push,
          requestId: request.current,
        }),
      );
      request.current = null;
      setCompose(false);
      setNote("");
      toast.success(
        spec.kind === "review"
          ? "Review ask sent to their portal"
          : "Referral ask sent to their portal",
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const withdraw = async (a: ClientAsk) => {
    setBusy(true);
    try {
      onView(await withdrawClientAsk(client, view.taskId, a.id));
      toast.success("Withdrawn. It no longer shows in their portal.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const status = ask ? askStatus(ask) : null;
  const steps = ask ? clientSteps(ask) : [];
  return (
    <section
      aria-label={spec.title}
      className="flex min-w-0 flex-col gap-3 rounded-xl border p-3 sm:p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="inline-flex items-center gap-2 font-medium">
          <Icon aria-hidden className="size-4 text-primary-ink" />
          {spec.title}
        </h3>
        {status ? (
          <Chip tone={status.tone}>{status.line}</Chip>
        ) : (
          <Chip dot={false}>Not asked yet</Chip>
        )}
      </div>

      {ask ? (
        <div className="space-y-1 text-xs text-muted-foreground">
          <p>
            Sent {kwDay(ask.askedAt)} by {ask.askedBy}
            {earlier
              ? ` · asked ${earlier} ${earlier === 1 ? "time" : "times"} before`
              : ""}
          </p>
          <p>{pushLine(ask)}</p>
          {ask.note ? (
            <p className="text-foreground" dir="auto">
              Your line: {ask.note}
            </p>
          ) : null}
          {steps.length ? (
            <ul className="space-y-0.5 pt-1 text-foreground">
              {steps.slice(0, 4).map(s => (
                <li key={s.key} className="break-words">
                  {s.line}
                </li>
              ))}
              {steps.length > 4 ? (
                <li className="text-muted-foreground">
                  and {steps.length - 4} earlier
                </li>
              ) : null}
            </ul>
          ) : null}
          {ask.state === "done" && spec.kind === "review" ? (
            <ExtLink href={REVIEW_FORM} className="pt-1">
              Log it in the client review form
            </ExtLink>
          ) : null}
        </div>
      ) : null}

      {!ask && !compose ? (
        <p className="text-xs text-muted-foreground">{spec.reads}</p>
      ) : null}

      {compose ? (
        <div className="space-y-3 border-t pt-3">
          <p className="text-xs text-muted-foreground">
            They read: {spec.reads}
          </p>
          <Textarea
            placeholder="Add a line from you (optional), for example: Thanks for a great month."
            value={note}
            onChange={e => setNote(e.target.value.slice(0, 280))}
            rows={2}
            dir="auto"
            aria-label="A line from you"
          />
          <div className="flex items-start gap-2 text-xs">
            <Checkbox
              id={pushId}
              checked={push}
              onCheckedChange={v => setPush(v === true)}
              className="mt-0.5"
            />
            <label htmlFor={pushId}>
              Also send a phone alert to people who turned on task alerts
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={send} disabled={busy}>
              {busy ? "Sending…" : "Send to their portal"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setCompose(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            {previewHref ? (
              <a
                href={previewHref}
                target="_blank"
                rel="noopener"
                className="inline-flex items-center gap-1 text-xs text-primary-ink underline-offset-4 hover:underline"
              >
                See what they see
                <ArrowUpRight aria-hidden className="size-3.5" />
              </a>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="mt-auto flex flex-wrap items-center gap-2">
          {open ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => withdraw(ask)}
              disabled={busy}
            >
              Withdraw
            </Button>
          ) : reviewed ? (
            <p className="text-xs text-muted-foreground">
              They are not asked for a second review.
            </p>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setCompose(true)}
              disabled={blocked}
            >
              {ask ? `${spec.button} again` : spec.button}
            </Button>
          )}
          {previewHref ? (
            <a
              href={previewHref}
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-1 text-xs text-primary-ink underline-offset-4 hover:underline"
            >
              See what they see
              <ArrowUpRight aria-hidden className="size-3.5" />
            </a>
          ) : null}
        </div>
      )}
    </section>
  );
}
