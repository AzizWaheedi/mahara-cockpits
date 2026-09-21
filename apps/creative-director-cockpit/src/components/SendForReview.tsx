import { useAction } from "convex/react";
import { Check, Copy, ExternalLink, LoaderCircle, Plus, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";

/**
 * Send a finished video to a client for review.
 *
 * One field matters: the link to the video. Everything else has a
 * sensible answer already, because anything more is a form standing
 * between somebody and sending a video, and a form is how this ends up
 * unused and the cuts keep going out on WhatsApp.
 */

type Sent = {
  token: string;
  url: string;
  title: string;
  client_name: string | null;
  created_at: string;
  opened_at: string | null;
  items: number;
  decided: number;
  changes: number;
};

function ago(iso: string | null): string {
  if (!iso) return "";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

export function SendForReview() {
  const create = useAction(api.review.create);
  const listSent = useAction(api.review.sent);

  const [links, setLinks] = useState<string[]>([""]);
  const [title, setTitle] = useState("");
  const [client, setClient] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [rows, setRows] = useState<Sent[] | null>(null);

  const load = useCallback(async () => {
    try {
      setRows((await listSent({})) as Sent[]);
    } catch {
      setRows([]);
    }
  }, [listSent]);
  useEffect(() => {
    void load();
  }, [load]);

  const ready = links.some(l => l.trim());

  async function send() {
    setBusy(true);
    try {
      const out = (await create({
        title: title.trim() || "Videos for review",
        note: note.trim() || undefined,
        client: client.trim() || undefined,
        videos: links.filter(l => l.trim()).map(url => ({ url })),
      })) as { url: string };
      setMade(out.url);
      setCopied(false);
      setLinks([""]);
      setTitle("");
      setNote("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <h2 className="text-[15px] font-semibold tracking-tight">
          Send for review
        </h2>
        <span className="text-[12px] text-muted-foreground">
          Paste the video, send the client one link
        </span>
      </div>

      {made ? (
        <div className="mb-3 rounded-lg border bg-muted/30 p-3">
          <p className="text-[12px] font-medium">Ready to send</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <code className="min-w-0 flex-1 truncate rounded bg-background px-2 py-1 text-[12px]">
              {made}
            </code>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(made);
                setCopied(true);
                toast.success("Copied. Send it on WhatsApp.");
              }}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-primary px-2.5 text-[12px] font-semibold text-primary-foreground"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              {copied ? "Copied" : "Copy"}
            </button>
            <a
              href={made}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[12px] font-medium hover:bg-muted"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              See what they see
            </a>
          </div>
        </div>
      ) : null}

      <div className="grid gap-1.5 md:max-w-xl">
        {links.map((l, i) => (
          <div key={`link-${i}`} className="flex gap-1.5">
            <input
              value={l}
              onChange={e =>
                setLinks(links.map((x, j) => (j === i ? e.target.value : x)))
              }
              placeholder={i === 0 ? "Link to the video" : "Another video"}
              className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2.5 text-[13px]"
            />
            {links.length > 1 ? (
              <button
                type="button"
                aria-label="Remove"
                onClick={() => setLinks(links.filter((_, j) => j !== i))}
                className="rounded-md border px-2 text-muted-foreground hover:bg-muted"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        ))}
        <button
          type="button"
          onClick={() => setLinks([...links, ""])}
          className="inline-flex w-fit items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
        >
          <Plus className="h-3 w-3" />
          Add another
        </button>

        <div className="mt-1 grid gap-1.5 sm:grid-cols-2">
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="What this is (optional)"
            className="h-9 rounded-md border bg-background px-2.5 text-[13px]"
          />
          <input
            value={client}
            onChange={e => setClient(e.target.value)}
            placeholder="Client (optional)"
            className="h-9 rounded-md border bg-background px-2.5 text-[13px]"
          />
        </div>
        <input
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="A line for them (optional)"
          className="h-9 rounded-md border bg-background px-2.5 text-[13px]"
        />

        <button
          type="button"
          disabled={busy || !ready}
          onClick={() => void send()}
          className="mt-0.5 inline-flex h-9 w-fit items-center gap-1.5 rounded-md bg-primary px-3 text-[13px] font-semibold text-primary-foreground disabled:opacity-50"
        >
          {busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}
          Make the link
        </button>
      </div>

      {rows?.length ? (
        <>
          <h3 className="mt-5 text-[12px] font-medium text-muted-foreground">
            Sent
          </h3>
          <ul className="mt-1.5 grid gap-1">
            {rows.slice(0, 8).map(r => (
              <li
                key={r.token}
                className="flex flex-wrap items-center gap-2 text-[12px]"
              >
                <span className="font-medium">{r.title}</span>
                {r.client_name ? (
                  <span className="text-muted-foreground">{r.client_name}</span>
                ) : null}
                <span className="text-muted-foreground">
                  {r.opened_at
                    ? `opened ${ago(r.opened_at)}`
                    : "not opened yet"}
                </span>
                <span className="ml-auto tabular-nums text-muted-foreground">
                  {r.decided} of {r.items} decided
                  {r.changes ? `, ${r.changes} to change` : ""}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(r.url);
                    toast.success("Copied.");
                  }}
                  className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
                >
                  copy
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
