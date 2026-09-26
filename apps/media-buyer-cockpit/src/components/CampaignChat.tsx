import { useMutation, useQuery } from "convex/react";
import { Check, Clock, X } from "lucide-react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { Button } from "./ui/button";

/**
 * The conversation and the activity log for one campaign, in one place.
 *
 * Aziz, 2026-09-07: going back and forth was hard because nothing showed what
 * was happening: whether a message had been picked up, whether an action had
 * worked. So every message now carries its own state (queued → sent →
 * answered), and every button press on this campaign is written into the same
 * thread with its result. The thread is the campaign's history, not a comment
 * box.
 *
 * It remains a relay rather than a chatbot: a question goes to Aziz's Slack DM
 * with the numbers attached and he answers there, because inventing answers
 * about a live ad account is worse than waiting for a real one.
 */

type Msg = {
  _id: string;
  author: string;
  authorName?: string;
  text: string;
  status?: string;
  kind?: string;
  ok?: boolean;
  pending?: boolean;
  deliveredAt?: number;
  at: number;
};

function when(t: number) {
  return new Date(t).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatusLine({ m }: { m: Msg }) {
  if (m.author !== "her") return null;
  if (m.kind === "action") {
    const failed = m.ok === false;
    return (
      <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
        {failed ? (
          <X className="size-3.5 shrink-0 txt-bad" aria-hidden />
        ) : (
          <Check className="size-3.5 shrink-0 txt-good" aria-hidden />
        )}
        {failed ? "Did not go through" : "Done"}
      </div>
    );
  }
  const status = m.status ?? "queued";
  const map: Record<string, { label: string; icon: "wait" | "ok" | "bad" }> = {
    queued: {
      label:
        "Sending to Aziz on Slack (retried for a few minutes if Slack is slow)",
      icon: "wait",
    },
    sent: {
      label: `Delivered to Aziz on Slack${m.deliveredAt ? ` at ${when(m.deliveredAt)}` : ""}. He answers there.`,
      icon: "ok",
    },
    answered: { label: "Answered", icon: "ok" },
    failed: {
      label:
        "Could not reach Slack after three tries. Say it in Slack instead.",
      icon: "bad",
    },
  };
  const s = map[status] ?? map.queued;
  return (
    <div className="mt-1 flex items-start gap-1 text-xs text-muted-foreground">
      {s.icon === "ok" ? (
        <Check className="mt-px size-3.5 shrink-0 txt-good" aria-hidden />
      ) : s.icon === "bad" ? (
        <X className="mt-px size-3.5 shrink-0 txt-bad" aria-hidden />
      ) : (
        <Clock className="mt-px size-3.5 shrink-0" aria-hidden />
      )}
      <span>{s.label}</span>
    </div>
  );
}

export function CampaignChat({
  campaignId,
  campaignName,
  client,
  who,
}: {
  campaignId: string;
  campaignName: string;
  client?: string;
  who?: string;
}) {
  const messages = useQuery(api.chat.thread, { campaignId }) as
    | Msg[]
    | undefined;
  const ask = useMutation(api.chat.ask);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const rows = messages ?? [];
  // Pending means not yet delivered; it clears once the DM has landed.
  const waiting = rows.some(m => m.author === "her" && m.pending);

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await ask({
        campaignId,
        campaignName,
        client,
        text: body,
        authorName: who,
      });
      setText("");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mt-4 rounded-xl bg-muted/40 p-3 sm:p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold">Conversation and history</div>
        {waiting && (
          <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium">
            <span
              aria-hidden
              className="size-1.5 rounded-full"
              style={{ backgroundColor: "var(--warning)" }}
            />
            Still sending
          </span>
        )}
      </div>

      {rows.length > 0 && (
        <div className="mb-2 max-h-72 space-y-2 overflow-y-auto pr-1">
          {rows.map(m => {
            const isAction = m.kind === "action";
            return (
              <div
                key={m._id}
                className={
                  isAction
                    ? "rounded-lg border-l-2 border-muted-foreground/40 bg-background/60 p-2"
                    : m.author === "her"
                      ? "rounded-lg bg-background/60 p-2"
                      : "rounded-lg border-l-2 border-primary bg-primary/5 p-2"
                }
              >
                <div className="text-xs font-medium text-muted-foreground">
                  {isAction
                    ? "Action"
                    : m.author === "her"
                      ? (m.authorName ?? "You")
                      : "Answer"}
                  {" · "}
                  {when(m.at)}
                </div>
                <div className="whitespace-pre-wrap text-sm" dir="auto">
                  {m.text}
                </div>
                <StatusLine m={m} />
              </div>
            );
          })}
        </div>
      )}

      <div className="flex gap-1.5">
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            // Enter sends, Shift+Enter for a new line.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={2}
          placeholder="Ask about this campaign, or say what you want done with it."
          className="min-h-[38px] min-w-0 flex-1 resize-y rounded-lg border bg-background px-2 py-1.5 text-sm"
        />
        <Button
          size="sm"
          className="h-8 self-end px-3 text-xs"
          disabled={!text.trim() || sending}
          onClick={() => void send()}
        >
          {sending ? "Sending…" : "Send"}
        </Button>
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        Messages go straight to Aziz on Slack with this campaign's spend, leads,
        CPL and days live attached, and he answers there. Every message shows
        whether it was delivered, and every change made here is logged above
        with whether it worked.
      </p>
    </div>
  );
}
