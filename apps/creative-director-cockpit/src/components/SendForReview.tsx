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

type Client = { task_id: string; name: string };

export function SendForReview() {
  const create = useAction(api.review.create);
  const listSent = useAction(api.review.sent);
  const listClients = useAction(api.review.clients);
  const importFolder = useAction(api.review.importFolder);
  const importStatus = useAction(api.review.importStatus);

  const [links, setLinks] = useState<string[]>([""]);
  const [folder, setFolder] = useState("");
  const [title, setTitle] = useState("");
  const [client, setClient] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [rows, setRows] = useState<Sent[] | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [importing, setImporting] = useState<string | null>(null);

  /**
   * An import in flight, remembered outside React.
   *
   * The copy happens on the VPS and finishes whether or not this screen
   * is open, but the watching was a timer in a component: switch tabs
   * and the browser throttles it to a crawl, change page and it is gone
   * with the component. The link was made and nobody was told. The id
   * is kept here so the watch resumes wherever you come back.
   */
  const WATCH_KEY = "review:importing";

  const load = useCallback(async () => {
    try {
      setRows((await listSent({})) as Sent[]);
    } catch {
      setRows([]);
    }
  }, [listSent]);
  useEffect(() => {
    void load();
    void (async () => {
      try {
        setClients((await listClients({})) as Client[]);
      } catch {
        // The picker falls back to nothing rather than blocking the form.
      }
    })();
  }, [load, listClients]);

  const ready = links.some(l => l.trim()) || folder.trim();

  /**
   * A folder is copied by a worker, so the screen waits for it. Polling
   * rather than a subscription because it finishes in tens of seconds
   * and a socket for that is more machinery than the job deserves.
   */
  const watch = useCallback(
    async (id: number) => {
      setBusy(true);
      setImporting("Reading the folder");
      try {
        window.localStorage.setItem(WATCH_KEY, String(id));
      } catch {
        // Private browsing. The worst case is the watch not resuming.
      }
      try {
        // A wall-clock deadline, not a tick count: a throttled tab fires
        // the timer far less often, so counting ticks would give up
        // after minutes on one screen and hours on another.
        const until = Date.now() + 20 * 60_000;
        while (Date.now() < until) {
          await new Promise(r => setTimeout(r, 4000));
          const st = (await importStatus({ id })) as {
            status: string;
            url?: string;
            found?: number;
            copied?: number;
            error?: string;
          } | null;
          if (!st) continue;
          if (st.status === "working")
            setImporting(
              st.found ? `Copying ${st.found} file(s)` : "Reading the folder",
            );
          if (st.status === "failed")
            throw new Error(st.error ?? "That folder did not work.");
          if (st.status === "done" && st.url) {
            setMade(st.url);
            setCopied(false);
            setFolder("");
            setTitle("");
            setNote("");
            toast.success(`${st.copied} file(s) ready for the client.`);
            await load();
            return;
          }
        }
        throw new Error(
          "That folder is still copying. It will appear under Sent when it finishes.",
        );
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "That did not work.");
      } finally {
        try {
          window.localStorage.removeItem(WATCH_KEY);
        } catch {
          // nothing to clear
        }
        setBusy(false);
        setImporting(null);
      }
    },
    [importStatus, load],
  );

  // Pick an import back up after a tab switch, a route change or a reload.
  useEffect(() => {
    let kept: string | null = null;
    try {
      kept = window.localStorage.getItem(WATCH_KEY);
    } catch {
      kept = null;
    }
    if (kept) void watch(Number(kept));
  }, [watch]);

  async function pullFolder() {
    try {
      const chosen = clients.find(c => c.task_id === client);
      const { id } = (await importFolder({
        folder,
        title: title.trim() || undefined,
        note: note.trim() || undefined,
        client: chosen?.name,
        clientTaskId: chosen?.task_id,
      })) as { id: number };
      await watch(id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That did not work.");
    }
  }

  async function send() {
    setBusy(true);
    try {
      const chosen = clients.find(c => c.task_id === client);
      const out = (await create({
        title: title.trim() || "Videos for review",
        note: note.trim() || undefined,
        client: chosen?.name,
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
          Videos or images, one link for the client
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
              placeholder={
                i === 0 ? "Link to a video or an image" : "Another one"
              }
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

        <div className="my-1 flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          or a whole folder
          <span className="h-px flex-1 bg-border" />
        </div>
        <input
          value={folder}
          onChange={e => setFolder(e.target.value)}
          placeholder="Paste a Google Drive folder — every video and image in it goes in"
          className="h-9 rounded-md border bg-background px-2.5 text-[13px]"
        />

        <div className="mt-1 grid gap-1.5 sm:grid-cols-2">
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="What this is (optional)"
            className="h-9 rounded-md border bg-background px-2.5 text-[13px]"
          />
          {/* The clients are the ClickUp cards. Typing a name invents a
              client that matches nothing when somebody looks later. */}
          <select
            value={client}
            onChange={e => setClient(e.target.value)}
            className="h-9 rounded-md border bg-background px-2.5 text-[13px]"
          >
            <option value="">Which client</option>
            {clients.map(c => (
              <option key={c.task_id} value={c.task_id}>
                {c.name}
              </option>
            ))}
          </select>
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
          onClick={() => void (folder.trim() ? pullFolder() : send())}
          className="mt-0.5 inline-flex h-9 w-fit items-center gap-1.5 rounded-md bg-primary px-3 text-[13px] font-semibold text-primary-foreground disabled:opacity-50"
        >
          {busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}
          {importing ?? "Make the link"}
        </button>
        {importing ? (
          <p className="text-[11px] text-muted-foreground">
            Copying them out of Drive so the client can actually open them.
            Leave this open.
          </p>
        ) : null}
      </div>

      <h3 className="mt-5 text-[12px] font-medium text-muted-foreground">
        Sent
      </h3>
      {rows === null ? (
        <p className="mt-1.5 text-[12px] text-muted-foreground">Loading</p>
      ) : rows.length === 0 ? (
        <p className="mt-1.5 text-[12px] text-muted-foreground">
          Nothing sent yet. Every link you make stays here with whether the
          client has opened it and what they decided.
        </p>
      ) : (
        <>
          <h3 className="sr-only">Sent</h3>
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
      )}
    </section>
  );
}
