import { useMutation, useQuery } from "convex/react";
import { ExternalLink, FileText, Film, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AnimatedSelect } from "@/components/ui/animated-select";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { api } from "../../convex/_generated/api";

/**
 * Script task review and editor handoff.
 *
 * Completed ClickUp script-request cards are a source, not proof that their
 * description contains the final script. The director deliberately pastes or
 * adopts final text, checks approval, and sends it to the editors. No AI studio
 * is involved (Aziz, 2026-09-18). The existing ClickUp form remains below.
 *
 * Read-only against ClickUp: the source text is synced by the media buyer.
 * Editing the outgoing brief does not change the ClickUp task.
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
    <div className="mx-auto w-full max-w-5xl">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <FileText className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-[15px] font-bold tracking-tight">Script handoff</h2>
        <span className="text-[13px] text-muted-foreground">
          {data
            ? `${data.rows.length} completed script tasks on the creative board`
            : "Loading…"}
        </span>
      </div>
      <p className="mb-3 text-[13px] text-muted-foreground">
        A completed request may contain only a brief, not the finished script.
        Open its ClickUp card, check the final wording and client approval, then
        paste the approved script into the editor handoff. The source text below
        refreshes from ClickUp every 15 minutes; this handoff does not edit it.
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <AnimatedSelect
          value={client}
          onChange={e => setClient(e.target.value)}
          aria-label="Client"
          className="h-7 rounded-md border bg-background px-2 text-[12px]"
        >
          <option value="">Every client</option>
          {clients.map(c => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </AnimatedSelect>
        <div className="ml-auto flex items-center gap-1.5 rounded-md border px-2 py-1">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search titles, clients and script text"
            className="w-64 bg-transparent text-[13px] outline-none"
          />
        </div>
      </div>

      {data === undefined ? (
        <p className="text-[13px] text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">
          {q.trim() || client
            ? "No completed script matches."
            : "No script request is marked complete on the creative board yet."}
        </p>
      ) : (
        <div className="divide-y rounded-lg border">
          {rows.map((r: Row) => (
            <ScriptRow key={r.taskId} r={r} />
          ))}
        </div>
      )}

      <section className="mt-6 rounded-lg border p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Film className="h-4 w-4" />
          <h3 className="text-[14px] font-bold">
            The ClickUp video request form
          </h3>
          <span className="text-[12px] text-muted-foreground">
            the same form the editors read, right here
          </span>
          <button
            type="button"
            onClick={() => setShowForm(v => !v)}
            aria-expanded={showForm}
            className="ml-auto rounded border px-2 py-0.5 text-[12px] font-semibold text-muted-foreground hover:bg-muted"
          >
            {showForm ? "Hide" : "Open the form"}
          </button>
          <a
            href={FORM_URL}
            target="_blank"
            rel="noreferrer"
            className="rounded border px-2 py-0.5 text-[12px] font-semibold text-muted-foreground hover:bg-muted"
          >
            <ExternalLink className="mr-1 inline h-3 w-3" />
            In ClickUp
          </a>
        </div>
        {showForm ? (
          <iframe
            title="ClickUp video request form"
            src={FORM_URL}
            className="mt-2 h-[900px] w-full rounded border bg-white"
            loading="lazy"
          />
        ) : null}
      </section>
    </div>
  );
}

function ScriptRow({ r }: { r: Row }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [approvalSource, setApprovalSource] = useState("");
  const [approvalChecked, setApprovalChecked] = useState(false);
  const [type, setType] = useState("New Video Request 🎥");
  const [due, setDue] = useState("");
  const [footage, setFootage] = useState<string>(String(r.drive ?? ""));
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [copied, setCopied] = useState(false);
  const queue = useMutation(api.clients.queueAction);

  const send = async () => {
    const brief = text.trim();
    if (!brief || !approvalSource.trim() || !approvalChecked) {
      toast.error("Paste the final script and record its approval first.");
      return;
    }
    setBusy(true);
    try {
      await queue({
        kind: "videoRequest",
        payload: {
          client: r.client ?? "",
          type,
          brief: `${brief}\n\nScript task: ${r.url ?? r.name}\nClient script approval: ${approvalSource.trim()}`,
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
      <div className="flex items-start gap-3 px-3 py-2 hover:bg-muted/50">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
            <span className="font-semibold" dir="auto">
              {r.name}
            </span>
            {r.client ? (
              <span className="rounded-full border px-2 py-0.5 text-[11px] font-medium">
                {r.client}
              </span>
            ) : null}
            {Array.isArray(r.otherClients) && r.otherClients.length ? (
              <span className="text-[11px] text-muted-foreground">
                also {r.otherClients.join(", ")}
              </span>
            ) : null}
            <span className="rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground">
              {r.status}
            </span>
          </div>
          <div className="text-[12px] text-muted-foreground">
            {r.updatedAt ? `updated ${fmtDay(r.updatedAt)}` : ""}
            {Array.isArray(r.assignees) && r.assignees.length
              ? ` · ${r.assignees.join(", ")}`
              : ""}
            {typeof r.script === "string" && r.script
              ? ` · ${r.script.length.toLocaleString("en-US")} source characters`
              : " · no description on the task"}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          {r.url ? (
            <a
              href={r.url}
              target="_blank"
              rel="noreferrer"
              className="rounded border px-2 py-0.5 text-[12px] font-semibold text-muted-foreground hover:bg-muted"
            >
              <ExternalLink className="mr-1 inline h-3 w-3" />
              ClickUp
            </a>
          ) : null}
          <button
            type="button"
            onClick={() => setOpen(o => !o)}
            className="rounded border px-2 py-0.5 text-[12px] font-semibold text-muted-foreground hover:bg-muted"
          >
            {open ? "Hide" : "Open"}
          </button>
        </div>
      </div>
      {open ? (
        <div className="space-y-3 border-t bg-muted/30 px-3 py-3 text-[13px]">
          <div className="rounded border bg-background p-2.5">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2 font-semibold">
              <span>ClickUp task description · source only</span>
              {r.script ? (
                <button
                  type="button"
                  onClick={() => {
                    setText(String(r.script));
                    setApprovalChecked(false);
                  }}
                  className="text-[12px] underline underline-offset-2"
                >
                  Use as draft
                </button>
              ) : null}
            </div>
            <pre
              className="max-h-48 overflow-auto whitespace-pre-wrap font-sans text-[12px] text-muted-foreground"
              dir="auto"
            >
              {r.script ||
                "No description on this task. Open ClickUp for the final script or document."}
            </pre>
          </div>
          <label
            className="block font-semibold"
            htmlFor={`script-handoff-${r.taskId}`}
          >
            Final approved script for the editor
          </label>
          <textarea
            id={`script-handoff-${r.taskId}`}
            value={text}
            onChange={e => {
              setText(e.target.value);
              setApprovalChecked(false);
            }}
            dir="auto"
            rows={Math.min(28, Math.max(8, text.split("\n").length + 2))}
            className="w-full rounded border bg-background px-2 py-1.5 font-mono text-[13px] leading-relaxed"
            placeholder="Paste the final script here after review"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(text).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1800);
                });
              }}
              className="rounded border px-2 py-0.5 text-[12px] font-semibold text-muted-foreground hover:bg-muted"
            >
              {copied ? "Copied" : "Copy the script"}
            </button>
            {text ? (
              <button
                type="button"
                onClick={() => {
                  setText("");
                  setApprovalChecked(false);
                }}
                className="rounded border px-2 py-0.5 text-[12px] font-semibold text-muted-foreground hover:bg-muted"
              >
                Clear handoff draft
              </button>
            ) : null}
          </div>
          <label
            className="block font-semibold"
            htmlFor={`script-approval-${r.taskId}`}
          >
            Where the client approved this script
          </label>
          <input
            id={`script-approval-${r.taskId}`}
            value={approvalSource}
            onChange={e => {
              setApprovalSource(e.target.value);
              setApprovalChecked(false);
            }}
            placeholder="ClickUp comment/link or WhatsApp group and date"
            className="w-full rounded border bg-background px-2 py-1.5 text-[13px]"
          />
          <label className="flex items-start gap-2 text-[12px]">
            <input
              type="checkbox"
              checked={approvalChecked}
              onChange={e => setApprovalChecked(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              I checked the final script and confirmed the client's approval is
              recorded on the ClickUp task or in the client conversation.
            </span>
          </label>
          <div className="space-y-2 rounded-lg border bg-background p-2.5">
            <h4 className="font-semibold">
              <Film className="mr-1.5 inline h-3.5 w-3.5" />
              Send to the editors{r.client ? ` for ${r.client}` : ""}
            </h4>
            <div className="grid gap-2 sm:grid-cols-2">
              <AnimatedSelect
                value={type}
                onChange={e => setType(e.target.value)}
                className="rounded border bg-transparent px-2 py-1.5 text-[13px]"
              >
                <option>New Video Request 🎥</option>
                <option>Edit Video Request 🎥</option>
              </AnimatedSelect>
              <DateInput
                value={due}
                onChange={e => setDue(e.target.value)}
                className="rounded border bg-transparent px-2 py-1.5 text-[13px]"
              />
            </div>
            <input
              value={footage}
              onChange={e => setFootage(e.target.value)}
              placeholder="Raw footage folder link"
              className="w-full rounded border bg-transparent px-2 py-1.5 text-[13px]"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                disabled={
                  busy ||
                  sent ||
                  !text.trim() ||
                  !approvalSource.trim() ||
                  !approvalChecked ||
                  !r.client
                }
                onClick={() => void send()}
              >
                {sent
                  ? "Sent to the editors"
                  : busy
                    ? "Sending…"
                    : "Send to the editors"}
              </Button>
              {!r.client ? (
                <span className="text-[12px] text-muted-foreground">
                  This task has no client tag in ClickUp, so the request cannot
                  be tagged. Add the tag there, or use the form below.
                </span>
              ) : (
                <span className="text-[12px] text-muted-foreground">
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
