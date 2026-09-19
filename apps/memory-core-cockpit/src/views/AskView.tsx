import { CornerDownLeft, Quote } from "lucide-react";
import { useState } from "react";
import { EmptyState } from "@/components/memory/EmptyState";
import { day, relative, sourceLabel } from "@/components/memory/format";
import { Notes } from "@/components/memory/Notes";
import { SectionCard } from "@/components/memory/SectionCard";
import { SourceBadge } from "@/components/memory/SourceBadge";
import { StatusChip } from "@/components/memory/StatusChip";
import {
  useAsk,
  useChatMessages,
  useChats,
} from "@/components/memory/useMemoryCore";
import { useNow } from "@/components/memory/useNow";

/**
 * Ask a question, get an answer with its receipts.
 *
 * The answer text carries numbered chips that point at the excerpts it was
 * written from. Clicking one lights the excerpt up. That pairing is the whole
 * point of this screen: an answer you cannot trace back is a rumour, and the
 * one sentence this app is allowed to say when it does not know is on the
 * screen in plain words.
 */
const NOT_FOUND = "I don't have that in your connected sources.";

export function AskView({ code }: { code: string }) {
  const [question, setQuestion] = useState("");
  const [chatId, setChatId] = useState<string | null>(null);
  const [activeCite, setActiveCite] = useState<number | null>(null);
  const { run, busy, answer, error } = useAsk();
  // The one sentence the memory core is allowed to say when it does not know.
  const refused = Boolean(answer?.answer.includes(NOT_FOUND));
  const chats = useChats(code);
  const history = useChatMessages(code, chatId);
  const now = useNow();

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (question.trim().length < 3) return;
    setActiveCite(null);
    const result = await run(code, question.trim(), chatId);
    if (result?.chatId) setChatId(result.chatId);
  };

  return (
    <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="min-w-0 space-y-5">
        <SectionCard
          kicker="Ask"
          title="A question, answered from your own material"
          notes={[
            {
              level: "info",
              text: "The answer is written only from what the search below finds. When nothing matches, the memory core says so instead of guessing.",
            },
          ]}
        >
          <form onSubmit={submit} className="space-y-3">
            <textarea
              value={question}
              onChange={event => setQuestion(event.target.value)}
              rows={3}
              placeholder="What did we agree with Atlantis Contracting about reporting?"
              aria-label="Your question"
              className="w-full resize-y rounded-xl border bg-background p-3 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs text-muted-foreground">
                {chatId
                  ? "Continuing this conversation."
                  : "A new conversation starts with this question."}
              </span>
              <div className="flex items-center gap-2">
                {chatId ? (
                  <button
                    type="button"
                    onClick={() => {
                      setChatId(null);
                      setActiveCite(null);
                    }}
                    className="h-9 rounded-lg border bg-card px-3 text-sm text-foreground transition-colors hover:bg-[var(--mc-emphasis-wash)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    Start a new one
                  </button>
                ) : null}
                <button
                  type="submit"
                  disabled={busy || question.trim().length < 3}
                  className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                >
                  <CornerDownLeft className="size-4" aria-hidden />
                  {busy ? "Asking" : "Ask"}
                </button>
              </div>
            </div>
          </form>
        </SectionCard>

        {error ? (
          <SectionCard
            kicker="Ask"
            title="That question did not go through"
            order={1}
          >
            <p className="text-sm text-foreground">{error}</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              The sources were not changed. Ask again, or search directly on the
              Search view to see what is there.
            </p>
          </SectionCard>
        ) : null}

        {answer ? (
          <SectionCard
            kicker="Answer"
            title={
              refused
                ? "Not in your connected sources"
                : answer.grounded
                  ? "Written from your sources"
                  : "Nothing to answer from"
            }
            order={2}
            actions={
              <span className="flex flex-wrap items-center gap-2">
                <StatusChip
                  tone={refused || !answer.grounded ? "warning" : "good"}
                  label={
                    refused
                      ? "Not found"
                      : answer.grounded
                        ? "Grounded"
                        : "Not grounded"
                  }
                  hint={
                    refused
                      ? `Searched ${answer.citations.length} item(s) and none answered the question`
                      : answer.grounded
                        ? `Written by ${answer.model} from ${answer.citations.length} item(s)`
                        : "No source matched, so no model was asked"
                  }
                />
                <span className="text-[11px] text-muted-foreground">
                  {answer.model}
                </span>
              </span>
            }
            notes={answer.warnings.map(text => ({
              level: "warn" as const,
              text,
            }))}
          >
            <AnswerText
              text={answer.answer}
              active={activeCite}
              onPick={setActiveCite}
            />

            {answer.citations.length ? (
              <div className="mt-5 space-y-2 border-t pt-4">
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {refused
                    ? "What it searched and did not find it in"
                    : "What it was written from"}
                </p>
                <ul className="min-w-0">
                  {answer.citations.map(citation => (
                    <li
                      key={citation.n}
                      data-active={activeCite === citation.n}
                      className="mc-excerpt flex min-w-0 gap-3 rounded-lg border border-transparent px-2 py-2"
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setActiveCite(
                            activeCite === citation.n ? null : citation.n,
                          )
                        }
                        className="mc-cite mt-0.5 size-5 shrink-0 rounded-md border text-[11px] font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        data-active={activeCite === citation.n}
                        aria-label={`Excerpt ${citation.n}`}
                      >
                        {citation.n}
                      </button>
                      <div className="min-w-0">
                        <span className="flex min-w-0 flex-wrap items-center gap-2">
                          <SourceBadge source={citation.source} />
                          {citation.url ? (
                            <a
                              href={citation.url}
                              target="_blank"
                              rel="noreferrer"
                              className="truncate text-sm font-medium text-foreground underline decoration-transparent decoration-1 underline-offset-4 hover:decoration-[color:var(--mc-emphasis)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              {citation.title}
                            </a>
                          ) : (
                            <span className="truncate text-sm font-medium text-foreground">
                              {citation.title}
                            </span>
                          )}
                        </span>
                        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                          {citation.snippet}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <p className="mt-4 border-t pt-3 text-xs leading-relaxed text-muted-foreground">
              {answer.retrieval.usedLive
                ? `Searched Notion, Gmail and Drive live, plus everything already remembered, in ${answer.retrieval.tookMs} ms. ${answer.retrieval.indexed} new item(s) joined the memory.`
                : `Answered from what was already remembered, in ${answer.retrieval.tookMs} ms. No outside call was made.`}
            </p>
            <Notes
              notes={answer.retrieval.perSource.map(source => ({
                level: source.ok ? ("info" as const) : ("warn" as const),
                text: `${sourceLabel(source.source)}: ${source.count} found — ${source.note}`,
              }))}
              className="mt-3"
            />
          </SectionCard>
        ) : null}

        {chatId && history?.length ? (
          <SectionCard
            kicker="This conversation"
            title={`${history.filter(row => row.role === "asker").length} question(s), oldest first`}
            order={3}
          >
            <ol className="space-y-4">
              {history.map(row => (
                <li key={row.id} className="min-w-0">
                  {row.role === "asker" ? (
                    <p className="text-sm font-medium text-foreground">
                      {row.text}
                    </p>
                  ) : (
                    <>
                      <p className="mc-answer text-sm text-foreground/90">
                        {row.text}
                      </p>
                      {row.citations.length ? (
                        <p className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                          {row.citations.map(citation => (
                            <span
                              key={citation.n}
                              className="inline-flex items-center gap-1"
                            >
                              <span className="font-mono tabular-nums">
                                [{citation.n}]
                              </span>
                              <SourceBadge source={citation.source} />
                            </span>
                          ))}
                          <span className="text-muted-foreground/70">
                            {row.model} · {relative(row.at, now)}
                          </span>
                        </p>
                      ) : null}
                    </>
                  )}
                </li>
              ))}
            </ol>
          </SectionCard>
        ) : null}
      </div>

      <SectionCard
        kicker="History"
        title="Recent questions"
        order={1}
        className="h-fit lg:sticky lg:top-4"
      >
        {chats?.length ? (
          <ul className="space-y-1">
            {chats.map(chat => (
              <li key={chat.id}>
                <button
                  type="button"
                  onClick={() => {
                    setChatId(chat.id);
                    setActiveCite(null);
                  }}
                  className={`w-full rounded-lg px-2 py-2 text-left transition-colors hover:bg-[var(--mc-emphasis-wash)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    chatId === chat.id ? "bg-[var(--mc-emphasis-wash)]" : ""
                  }`}
                >
                  <span className="line-clamp-2 block text-xs font-medium leading-5 text-foreground">
                    {chat.title}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    {day(chat.lastMessageAt)}
                    {chat.groundedBy !== null
                      ? ` · ${chat.groundedBy} source(s)`
                      : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title="No questions yet"
            text="Ask one above. Every answer is kept here with the items it came from."
            compact
          />
        )}
      </SectionCard>
    </div>
  );
}

/**
 * The answer, with each [n] turned into the chip that points at its excerpt.
 * The numbers in the text and the numbers in the list are the same numbers.
 */
function AnswerText({
  text,
  active,
  onPick,
}: {
  text: string;
  active: number | null;
  onPick: (n: number | null) => void;
}) {
  const parts = text.split(/(\[\d+\])/g);
  return (
    <div className="mc-answer text-sm text-foreground">
      {parts.map((part, index) => {
        const match = part.match(/^\[(\d+)\]$/);
        if (!match) {
          return <span key={index}>{part}</span>;
        }
        const n = Number(match[1]);
        return (
          <button
            key={index}
            type="button"
            onClick={() => onPick(active === n ? null : n)}
            data-active={active === n}
            className="mc-cite mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-md border px-1 align-[1px] text-[11px] font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Show excerpt ${n}`}
          >
            {n}
          </button>
        );
      })}
      {!text.includes("[") ? (
        <Quote className="mt-2 size-3.5 text-muted-foreground" aria-hidden />
      ) : null}
    </div>
  );
}
