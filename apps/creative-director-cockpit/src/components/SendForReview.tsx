import { useAction } from "convex/react";
import { ArrowUpRight, Check, Copy, LoaderCircle, Plus, X } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { AnimatedSelect } from "@/components/ui/animated-select";
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

const files = (n?: number) => `${n ?? 0} file${n === 1 ? "" : "s"}`;

/**
 * `folded` puts the whole thing behind one closed row ("Send something for
 * review"), for a daily screen where it is used now and then rather than
 * all day. It opens by itself while a link is being made or is ready.
 */
export function SendForReview({ folded = false }: { folded?: boolean }) {
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
  const foldRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if ((made || importing) && foldRef.current) foldRef.current.open = true;
  }, [made, importing]);

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
              st.found ? `Copying ${files(st.found)}` : "Reading the folder",
            );
          if (st.status === "failed")
            throw new Error(st.error ?? "That folder did not work.");
          if (st.status === "done" && st.url) {
            setMade(st.url);
            setCopied(false);
            setFolder("");
            setTitle("");
            setNote("");
            toast.success(`${files(st.copied)} ready for the client.`);
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

  const body: ReactNode = (
    <>
      {made ? (
        <div className="mb-4 rounded-xl bg-muted/40 p-3">
          <p className="text-xs font-medium">Ready to send</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 basis-48 truncate rounded-md bg-background px-2 py-1.5 text-xs">
              {made}
            </code>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard?.writeText(made);
                setCopied(true);
                toast.success("Copied. Send it on WhatsApp.");
              }}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground"
            >
              {copied ? (
                <Check className="size-3.5" />
              ) : (
                <Copy className="size-3.5" />
              )}
              {copied ? "Copied" : "Copy"}
            </button>
            <a
              href={made}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium hover:bg-muted"
            >
              See what they see
              <ArrowUpRight className="size-3.5" />
            </a>
          </div>
        </div>
      ) : null}

      <div className="grid gap-2 md:max-w-xl">
        {links.map((l, i) => (
          <div key={`link-${i}`} className="flex gap-2">
            <input
              value={l}
              onChange={e =>
                setLinks(links.map((x, j) => (j === i ? e.target.value : x)))
              }
              placeholder={
                i === 0 ? "Link to a video or an image" : "Another one"
              }
              className="h-9 min-w-0 flex-1 rounded-lg border bg-background px-3 text-sm"
            />
            {links.length > 1 ? (
              <button
                type="button"
                aria-label="Remove"
                onClick={() => setLinks(links.filter((_, j) => j !== i))}
                className="inline-flex w-9 items-center justify-center rounded-lg border text-muted-foreground hover:bg-muted"
              >
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>
        ))}
        <button
          type="button"
          onClick={() => setLinks([...links, ""])}
          className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <Plus className="size-3.5" />
          Add another
        </button>

        <div className="my-1 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          or a whole folder
          <span className="h-px flex-1 bg-border" />
        </div>
        <input
          value={folder}
          onChange={e => setFolder(e.target.value)}
          placeholder="Paste a Google Drive folder, every video and image in it goes in"
          className="h-9 rounded-lg border bg-background px-3 text-sm"
        />

        <div className="mt-1 grid gap-2 text-sm sm:grid-cols-2">
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="What this is (optional)"
            className="h-9 rounded-lg border bg-background px-3 text-sm"
          />
          {/* The clients are the ClickUp cards. Typing a name invents a
              client that matches nothing when somebody looks later. */}
          <AnimatedSelect
            value={client}
            onChange={e => setClient(e.target.value)}
            className="h-9"
          >
            <option value="">Which client</option>
            {clients.map(c => (
              <option key={c.task_id} value={c.task_id}>
                {c.name}
              </option>
            ))}
          </AnimatedSelect>
        </div>
        <input
          value={note}
          onChange={e => setNote(e.target.value)}
          placeholder="A line for them (optional)"
          className="h-9 rounded-lg border bg-background px-3 text-sm"
        />

        <button
          type="button"
          disabled={busy || !ready}
          onClick={() => void (folder.trim() ? pullFolder() : send())}
          className="mt-1 inline-flex h-9 w-fit items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
          {importing ?? "Make the link"}
        </button>
        {importing ? (
          <p className="text-xs text-muted-foreground">
            Copying them out of Drive so the client can actually open them.
            Leave this open.
          </p>
        ) : null}
      </div>

      <h3 className="mt-6 text-xs font-medium text-muted-foreground">Sent</h3>
      {rows === null ? (
        <p className="mt-2 text-xs text-muted-foreground">Loading</p>
      ) : rows.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Nothing sent yet. Every link you make stays here with whether the
          client has opened it and what they decided.
        </p>
      ) : (
        <ul className="mt-2 divide-y">
          {rows.slice(0, 8).map(r => (
            <li
              key={r.token}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-xs"
            >
              <span className="font-medium">{r.title}</span>
              {r.client_name ? (
                <span className="text-muted-foreground">{r.client_name}</span>
              ) : null}
              <span className="text-muted-foreground">
                {r.opened_at ? `Opened ${ago(r.opened_at)}` : "Not opened yet"}
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
                Copy
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );

  if (folded)
    return (
      <details ref={foldRef} className="rounded-2xl border bg-card">
        <summary className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-3 sm:px-6 sm:py-4">
          <span className="text-[15px] font-semibold">
            Send something for review
          </span>
          <span className="text-xs text-muted-foreground">
            Videos or images, one link for the client
          </span>
        </summary>
        <div className="border-t px-4 py-4 sm:px-6 sm:py-6">{body}</div>
      </details>
    );

  return (
    <section>
      <div className="mb-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h2 className="text-[15px] font-semibold tracking-tight">
          Send for review
        </h2>
        <span className="text-xs text-muted-foreground">
          Videos or images, one link for the client
        </span>
      </div>
      {body}
    </section>
  );
}
