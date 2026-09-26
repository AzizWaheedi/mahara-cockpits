import { useMutation, useQuery } from "convex/react";
import { ArrowUpRight, ChevronRight, Film, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { AnimatedSelect } from "@/components/ui/animated-select";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "../../convex/_generated/api";

/**
 * Scripts we made.
 *
 * Every script task marked complete on the ClickUp creative board, with its
 * text as it stands in ClickUp. He edits it in place, presses one button and
 * the video request goes to the editors with the script as the brief, the
 * client's raw footage folder already filled in (Aziz, 2026-09-18: no AI
 * studio, he writes with his own LLM; this is the hand-off). The ClickUp form
 * is embedded below for the times he wants the form itself.
 *
 * Read-only against ClickUp: the text here is the synced copy, refreshed
 * every 15 minutes by the media buyer's sync. Editing here changes the brief
 * sent to the editors, not the ClickUp task.
 */

// biome-ignore lint/suspicious/noExplicitAny: query rows are untyped
type Row = any;

const FORM_URL =
  "https://forms.clickup.com/90182518398/f/2kzmr1ky-1058/E1LP6F3OHFC3WACLU8";

function fmtDay(ms: number | null | undefined): string {
  if (!ms) return "";
  return new Date(ms).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function serverMessage(e: unknown): string {
  // biome-ignore lint/suspicious/noExplicitAny: ConvexError data is untyped
  const data = (e as any)?.data;
  if (typeof data === "string") return data;
  const msg = String((e as Error)?.message ?? e);
  return msg.replace(/^.*Uncaught Error: /, "").split("\n")[0];
}

export function ScriptsPage() {
  const data = useQuery(api.scripts.list, { limit: 300 });
  const [q, setQ] = useState("");
  const [client, setClient] = useState("");
  const [showForm, setShowForm] = useState(false);

  const rows: Row[] = useMemo(() => {
    const all: Row[] = data?.rows ?? [];
    const needle = q.trim().toLowerCase();
    return all.filter(
      (r: Row) =>
        (!client || r.client === client) &&
        (!needle ||
          [r.name, r.client, r.script]
            .filter(Boolean)
            .some((x: string) => String(x).toLowerCase().includes(needle))),
    );
  }, [data, q, client]);

  const clients: string[] = data?.clients ?? [];

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader
        title="Scripts we made"
        sub={
          data
            ? `${data.rows.length} completed on the creative board`
            : "Loading…"
        }
      />
      <details className="-mt-3 mb-6 text-xs text-muted-foreground">
        <summary className="w-fit">How this works</summary>
        <p className="mt-1 max-w-prose">
          Every script marked complete in ClickUp, word for word. Open one,
          change what you want, and send it to the editors: the video request is
          filled from the client record. The text here refreshes from ClickUp
          every 15 minutes; editing here changes the brief you send, not the
          ClickUp task.
        </p>
      </details>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <AnimatedSelect
          value={client}
          onChange={e => setClient(e.target.value)}
          aria-label="Client"
          className="h-8 rounded-md border bg-background px-3 text-xs"
        >
          <option value="">Every client</option>
          {clients.map(c => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </AnimatedSelect>
        <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border px-3 sm:ml-auto sm:max-w-80">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="sr-only">Search</span>
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search titles, clients and script text"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </label>
      </div>

      {data === undefined ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {q.trim() || client
            ? "No completed script matches."
            : "No script is marked complete on the creative board yet. When one is, it shows here with its text."}
        </p>
      ) : (
        <div className="divide-y rounded-xl border">
          {rows.map((r: Row) => (
            <ScriptRow key={r.taskId} r={r} />
          ))}
        </div>
      )}

      <section className="mt-8 rounded-2xl border bg-card p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Film className="size-4 shrink-0 text-muted-foreground" />
          <h2 className="text-[15px] font-semibold">
            The ClickUp video request form
          </h2>
          <span className="text-xs text-muted-foreground">
            The same form the editors read
          </span>
          <a
            href={FORM_URL}
            target="_blank"
            rel="noreferrer"
            className="ml-auto inline-flex items-center gap-1 text-sm text-primary hover:underline"
          >
            Open the form
            <ArrowUpRight className="size-3.5" />
          </a>
        </div>
        {/* Heavy on a phone, so the embedded copy only loads when asked. */}
        <button
          type="button"
          onClick={() => setShowForm(v => !v)}
          aria-expanded={showForm}
          className="mt-3 text-xs text-muted-foreground hover:text-foreground hover:underline"
        >
          {showForm ? "Hide the form" : "Show the form here"}
        </button>
        {showForm ? (
          <iframe
            title="ClickUp video request form"
            src={FORM_URL}
            className="mt-3 h-[900px] w-full rounded-xl border bg-card"
            loading="lazy"
          />
        ) : null}
      </section>
    </div>
  );
}

function ScriptRow({ r }: { r: Row }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string>(String(r.script ?? ""));
  // The value is ClickUp's own option name, emoji and all; only the label
  // on screen is plain.
  const [type, setType] = useState("New Video Request 🎥");
  const [due, setDue] = useState("");
  const [footage, setFootage] = useState<string>(String(r.drive ?? ""));
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [copied, setCopied] = useState(false);
  const queue = useMutation(api.clients.queueAction);

  const send = async () => {
    const brief = text.trim();
    if (!brief) {
      toast.error("The brief is empty. Paste or write the script first.");
      return;
    }
    setBusy(true);
    try {
      await queue({
        kind: "videoRequest",
        payload: {
          client: r.client ?? "",
          type,
          brief: `${brief}\n\nScript task: ${r.url ?? r.name}`,
          footage,
          due,
        },
      });
      setSent(true);
      toast.success(
        "Sent. The editors get a tagged task on the Video Pipeline within 15 minutes.",
      );
    } catch (e) {
      toast.error(serverMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {/* The row itself opens the script: one action per row. */}
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted/40"
      >
        <ChevronRight
          aria-hidden
          className={`mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform ${
            open ? "rotate-90" : ""
          }`}
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            <span className="min-w-0 font-medium" dir="auto">
              {r.name}
            </span>
            {r.client ? (
              <span className="inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-xs font-medium">
                <span className="truncate">{r.client}</span>
              </span>
            ) : null}
            {Array.isArray(r.otherClients) && r.otherClients.length ? (
              <span className="text-xs text-muted-foreground">
                also {r.otherClients.join(", ")}
              </span>
            ) : null}
            <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
              {r.status}
            </span>
          </span>
          <span className="mt-0.5 block text-xs text-muted-foreground">
            {r.updatedAt ? `completed ${fmtDay(r.updatedAt)}` : ""}
            {Array.isArray(r.assignees) && r.assignees.length
              ? ` · ${r.assignees.join(", ")}`
              : ""}
            {typeof r.script === "string" && r.script
              ? ` · ${r.script.length.toLocaleString("en-US")} characters`
              : " · no text on the task"}
          </span>
        </span>
      </button>
      {open ? (
        <div className="space-y-4 border-t bg-muted/30 px-4 py-4 text-sm">
          {!r.script ? (
            <p className="text-muted-foreground">
              This task has no text in ClickUp. Paste the script below, or open
              the task and add it there so it syncs.
            </p>
          ) : null}
          <Textarea
            value={text}
            onChange={e => setText(e.target.value)}
            dir="auto"
            rows={Math.min(28, Math.max(8, text.split("\n").length + 2))}
            className="bg-background font-sans text-sm leading-relaxed"
            placeholder="The script"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(text).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1800);
                });
              }}
            >
              {copied ? "Copied" : "Copy the script"}
            </Button>
            {text !== String(r.script ?? "") ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setText(String(r.script ?? ""))}
              >
                Back to the ClickUp text
              </Button>
            ) : null}
            {r.url ? (
              <a
                href={r.url}
                target="_blank"
                rel="noreferrer"
                className="ml-auto inline-flex items-center gap-1 text-sm text-primary hover:underline"
              >
                Open in ClickUp
                <ArrowUpRight className="size-3.5" />
              </a>
            ) : null}
          </div>
          <div className="space-y-3 rounded-xl bg-background/60 p-4">
            <h3 className="flex items-center gap-2 text-[15px] font-semibold">
              <Film className="size-4 text-muted-foreground" />
              Send to the editors{r.client ? ` for ${r.client}` : ""}
            </h3>
            <div className="grid gap-2 sm:grid-cols-2">
              <AnimatedSelect
                value={type}
                onChange={e => setType(e.target.value)}
                aria-label="Kind of request"
                className="h-9 rounded-md border bg-transparent px-3 text-sm"
              >
                <option value="New Video Request 🎥">New video</option>
                <option value="Edit Video Request 🎥">Edit video</option>
              </AnimatedSelect>
              <DateInput
                value={due}
                onChange={e => setDue(e.target.value)}
                className="h-9 rounded-md border bg-transparent px-3 text-sm"
              />
            </div>
            <Input
              value={footage}
              onChange={e => setFootage(e.target.value)}
              placeholder="Raw footage folder link"
            />
            <div className="flex flex-wrap items-center gap-3">
              <Button
                disabled={busy || sent || !text.trim() || !r.client}
                onClick={() => void send()}
              >
                {sent
                  ? "Sent to the editors"
                  : busy
                    ? "Sending…"
                    : "Send to the editors"}
              </Button>
              {!r.client ? (
                <span className="min-w-0 flex-1 text-xs text-muted-foreground">
                  This task has no client tag in ClickUp, so the request cannot
                  be tagged. Add the tag there, or use the form below.
                </span>
              ) : (
                <span className="min-w-0 flex-1 text-xs text-muted-foreground">
                  The script above becomes the brief; the footage folder comes
                  from the client record. A tagged task lands on the Video
                  Pipeline within 15 minutes.
                </span>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
