import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "../../convex/_generated/api";
import { Button } from "./ui/button";

/**
 * The conversation and the activity log for one campaign, in one place.
 *
 * Aziz, 2026-09-07: going back and forth was hard because nothing showed what
 * was happening — whether a message had been picked up, whether an action had
 * worked. So every message now carries its own state (queued → sent →
 * answered), and every button press on this campaign is written into the same
 * thread with its result. The thread is the campaign's history, not a comment
 * box.
 *
 * It remains a relay rather than a chatbot: in-app generation runs through the
 * Viktor tool gateway, which is down, and inventing answers about a live ad
 * account is worse than waiting for a real one.
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
    return (
      <div
        className={`mt-0.5 text-[11px] font-semibold ${m.ok === false ? "txt-bad" : "txt-good"}`}
      >
        {m.ok === false ? "✕ did not go through" : "✓ done"}
      </div>
    );
  }
  const status = m.status ?? "queued";
  const map: Record<string, { label: string; cls: string }> = {
    queued: {
      label: "◷ Queued — waiting for the next relay (runs every 2 hours)",
      cls: "text-muted-foreground",
    },
    sent: {
      label: `✓ Delivered${m.deliveredAt ? ` at ${when(m.deliveredAt)}` : ""} — answer will appear here`,
      cls: "txt-good",
    },
    answered: { label: "✓ Answered", cls: "txt-good" },
    failed: {
      label: "✕ Could not be delivered — say it in Slack instead",
      cls: "txt-bad",
    },
  };
  const s = map[status] ?? map.queued;
  return <div className={`mt-0.5 text-[11px] ${s.cls}`}>{s.label}</div>;
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
    <div className="mt-3 rounded-lg border bg-background p-3">
      <div className="mb-1 flex items-center justify-between">
        <div className="text-[12px] font-bold uppercase tracking-wide text-muted-foreground">
          This campaign · conversation and history
        </div>
        {waiting && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold uppercase text-amber-800">
            waiting for an answer
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
                    ? "rounded-md border-l-2 border-muted-foreground/40 bg-muted/30 p-2"
                    : m.author === "her"
                      ? "rounded-md bg-muted/60 p-2"
                      : "rounded-md border-l-2 border-primary bg-primary/5 p-2"
                }
              >
                <div className="text-[11px] font-semibold text-muted-foreground">
                  {isAction
                    ? "Action"
                    : m.author === "her"
                      ? (m.authorName ?? "You")
                      : "Answer"}
                  {" · "}
                  {when(m.at)}
                </div>
                <div className="whitespace-pre-wrap text-[13px]">{m.text}</div>
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
          className="min-h-[38px] flex-1 resize-y rounded-md border bg-background px-2 py-1.5 text-[13px]"
        />
        <Button
          size="sm"
          className="h-8 self-end px-3 text-[12px]"
          disabled={!text.trim() || sending}
          onClick={() => void send()}
        >
          {sending ? "Sending…" : "Send"}
        </Button>
      </div>

      <p className="mt-1.5 text-[11px] text-muted-foreground">
        Messages go to Aziz in Slack with this campaign's spend, leads, CPL and
        days live attached. Every message shows whether it has been picked up,
        and every change made here is logged above with whether it worked.
      </p>
    </div>
  );
}
