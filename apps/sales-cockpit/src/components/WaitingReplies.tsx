import { MessagesSquare } from "lucide-react";
import { Link } from "react-router";
import { useInbox } from "../lib/data";
import { previewLine, waitTone, waitWords } from "../lib/messages";
import { ChannelGlyph } from "./ChannelGlyph";
import { EmptyState, Failed, Reading, SectionCard } from "./kit";

const TONE_COLOR = {
  fresh: "var(--mahara-teal)",
  due: "var(--warning)",
  late: "var(--destructive)",
  stale: "var(--muted-foreground)",
} as const;

/**
 * Today's "Waiting on a reply": the Messages page's Needs reply list (the
 * lead wrote last and no person has answered, SMS copies and automations
 * aside), the whole team's queue, newest first. Each row opens the
 * conversation with its reply box; the clock runs against the one-hour
 * reply standard.
 */
export function WaitingReplies({ now }: { now: number }) {
  const waiting = useInbox({
    person: "everyone",
    state: "reply",
    channel: null,
    account: null,
    q: "",
  });
  const rows = waiting.data?.rows ?? null;
  const more = waiting.data?.more ?? false;
  return (
    <SectionCard
      title="Waiting on a reply"
      side={
        <Link
          to="/messages"
          className="muted text-xs underline-offset-4 hover:underline"
        >
          {rows?.length
            ? `${rows.length}${more ? "+" : ""} · Open Messages`
            : "Open Messages"}
        </Link>
      }
      flush
    >
      {waiting.error && !rows ? (
        <div className="p-4">
          <Failed
            what="The waiting messages"
            error={waiting.error}
            retry={waiting.reload}
          />
        </div>
      ) : rows === null ? (
        <Reading what="the waiting messages" className="px-4 py-3 text-sm" />
      ) : rows.length ? (
        <ul className="divide-y hairline">
          {rows.slice(0, 6).map(r => {
            const tone = waitTone(r.last_in_at, now);
            return (
              <li key={r.conversation_id}>
                <Link
                  to={`/messages/${r.conversation_id}`}
                  className="flex gap-3 px-4 py-2.5 hover:bg-[color:var(--secondary)]"
                >
                  <ChannelGlyph
                    channel={r.last_in_channel ?? r.channels[0] ?? "whatsapp"}
                    className="mt-0.5 size-4 shrink-0"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-medium" dir="auto">
                        {r.name ?? "A lead"}
                      </span>
                      <span
                        className="shrink-0 font-mono text-[11px] font-medium"
                        style={{
                          color:
                            tone === "stale" ? undefined : TONE_COLOR[tone],
                        }}
                      >
                        <span className="sr-only">Waiting </span>
                        {waitWords(r.last_in_at, now)}
                      </span>
                    </span>
                    <span
                      className="muted mt-0.5 line-clamp-2 text-xs"
                      dir="auto"
                    >
                      {previewLine(r) || "A picture, a file or a call"}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState
          compact
          icon={MessagesSquare}
          title="Nobody is waiting on a reply"
          text="When a lead writes on WhatsApp, email, Instagram or Facebook and nobody has answered, they show here within a minute."
        />
      )}
    </SectionCard>
  );
}
