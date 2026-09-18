import { useState } from "react";
import { Link, useParams } from "react-router";
import {
  Empty,
  Fold,
  Out,
  Problem,
  Prose,
  Row,
  Section,
  Spinner,
  StateBadge,
} from "../components/bits";
import Footage from "../components/Footage";
import { useWho } from "../lib/auth";
import {
  addNote,
  askFor,
  markNoteDone,
  useAssets,
  useClient,
  useJob,
  useNotes,
  useRequests,
  useVersions,
} from "../lib/data";
import { clock, day, minutes, moment, whenDue } from "../lib/format";

export default function JobPage() {
  const { taskId = "" } = useParams();
  const { email, name } = useWho();
  const job = useJob(taskId);
  const client = useClient(job.data?.client_task_id);
  const assets = useAssets(taskId);
  const versions = useVersions(taskId);
  const notes = useNotes(taskId);
  const requests = useRequests(taskId);

  const [link, setLink] = useState("");
  const [noteText, setNoteText] = useState("");
  const [saying, setSaying] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (job.loading) return <Spinner what="Opening the job" />;
  if (job.error)
    return (
      <div className="mx-auto max-w-5xl p-4">
        <Problem>{job.error}</Problem>
      </div>
    );
  if (!job.data) {
    return (
      <div className="mx-auto max-w-5xl p-4">
        <Empty>That job is not on the desk. It may have been closed on the board.</Empty>
      </div>
    );
  }

  const j = job.data;
  const c = client.data;
  const due = whenDue(j.due_at);
  const waiting = (requests.data ?? []).filter(
    (r) => r.status === "queued" || r.status === "running",
  );

  async function send(kind: "deliver" | "check") {
    if (!link.trim()) {
      setSaying("Paste the link to the cut first.");
      return;
    }
    setBusy(true);
    const err = await askFor(kind, taskId, link.trim(), { email, name });
    setBusy(false);
    setSaying(
      err
        ? `That could not be queued: ${err}`
        : kind === "check"
          ? "Queued. The desk will read the cut and report back here."
          : "Queued. The desk will put the link on the card and move it to client review.",
    );
    if (!err) requests.reload();
  }

  async function say() {
    if (!noteText.trim()) return;
    setBusy(true);
    const err = await addNote(taskId, noteText.trim(), { email, name });
    setBusy(false);
    if (err) setSaying(`That note was not saved: ${err}`);
    else {
      setNoteText("");
      notes.reload();
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-6">
      <nav>
        <Link to="/" className="muted text-sm underline underline-offset-4">
          ← All jobs
        </Link>
      </nav>

      <header className="panel px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight">
              {c?.name ?? j.client ?? "No client tag"}
            </h1>
            <p className="muted mt-0.5 text-sm">
              {j.name} · {j.request_type ?? "Video"}
            </p>
          </div>
          <StateBadge state={j.state} />
        </div>

        <div className="mt-3 grid gap-x-8 gap-y-0 sm:grid-cols-2">
          <Row label="Editor">{j.editor ?? "Nobody assigned"}</Row>
          <Row label="Due">
            <span style={due.late ? { color: "var(--destructive)" } : undefined}>
              {due.text} {j.due_at ? `· ${day(j.due_at)}` : ""}
            </span>
          </Row>
          <Row label="Board status">{(j.status ?? "--").toLowerCase()}</Row>
          <Row label="Read">
            {j.prepared_at ? moment(j.prepared_at) : "not yet"}
            {j.files ? ` · ${j.files} files · ${minutes(j.seconds)}` : ""}
          </Row>
          <Row label="Card">
            <Out href={j.url}>Open in ClickUp</Out>
          </Row>
          <Row label="Footage">
            <Out href={j.footage_url}>Open the folder</Out>
          </Row>
        </div>
      </header>

      {j.missing?.length ? (
        <Section title="Not ready to start">
          <ul className="space-y-1.5">
            {j.missing.map((m) => (
              <li key={m} className="flex gap-2 text-sm">
                <span style={{ color: "var(--destructive)" }}>•</span>
                <span>{m}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="The brand" side={c ? <Out href={c.url}>Client card</Out> : undefined}>
        {client.loading && <Spinner what="Reading the client card" />}
        {!client.loading && !c && (
          <p className="muted text-sm">
            The tag on this card does not match a company on Clients - Mahara, so the brand rules
            could not be found. Fixing the tag on the card is enough.
          </p>
        )}
        {c && (
          <div className="space-y-0">
            {c.dos_donts ? (
              <div className="pb-3">
                <p className="muted mb-1.5 text-xs uppercase tracking-wide">Do's and don'ts</p>
                <Prose text={c.dos_donts} />
              </div>
            ) : (
              <p className="muted pb-3 text-sm">No do's and don'ts written for this client yet.</p>
            )}
            {c.brand_dna ? (
              <Fold title="Brand DNA" hint={`${Math.round(c.brand_dna.length / 1000)}k characters`}>
                <Prose text={c.brand_dna} />
              </Fold>
            ) : c.brand_dna_url ? (
              <div className="border-t hairline py-2.5 text-sm">
                <Out href={c.brand_dna_url}>Brand DNA document</Out>
              </div>
            ) : null}
            {c.offer ? (
              <Fold
                title="Offer cheat sheet"
                hint={`${Math.round(c.offer.length / 1000)}k characters`}
              >
                <Prose text={c.offer} />
              </Fold>
            ) : c.offer_url ? (
              <div className="border-t hairline py-2.5 text-sm">
                <Out href={c.offer_url}>Offer cheat sheet</Out>
              </div>
            ) : null}
            <div className="muted border-t hairline pt-2.5 text-xs">
              {c.website ? <Out href={c.website}>Website</Out> : null}
              {c.website && c.instagram ? " · " : null}
              {c.instagram ? <Out href={c.instagram}>Instagram</Out> : null}
              {c.docs_error ? <span> · a document could not be read: {c.docs_error}</span> : null}
            </div>
          </div>
        )}
      </Section>

      {j.script || j.brief ? (
        <Section title="What to make">
          {j.brief ? (
            <div className="pb-3">
              <p className="muted mb-1.5 text-xs uppercase tracking-wide">Brief on the card</p>
              <Prose text={j.brief} />
            </div>
          ) : null}
          {j.script ? (
            <Fold title="Script" hint={`${j.script.length} characters`} open={!j.brief}>
              <Prose text={j.script} />
            </Fold>
          ) : null}
        </Section>
      ) : null}

      <Section
        title="Footage"
        side={
          assets.data?.length ? (
            <span className="muted text-xs">
              {assets.data.length} files · {minutes(j.seconds)}
            </span>
          ) : undefined
        }
      >
        {assets.loading ? (
          <Spinner what="Reading the footage" />
        ) : (
          <Footage assets={assets.data ?? []} />
        )}
      </Section>

      <Section title="The cut">
        <div className="space-y-3">
          <label className="block">
            <span className="muted mb-1.5 block text-xs uppercase tracking-wide">
              Link to the cut in Drive
            </span>
            <input
              id="cut-link"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder={j.edited_url ?? "https://drive.google.com/file/d/…"}
              className="raised w-full rounded-md border hairline px-3 py-2 text-sm"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => send("check")}
              className="raised rounded-md border hairline px-3 py-1.5 text-sm disabled:opacity-50"
            >
              Check it first
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => send("deliver")}
              className="rounded-md bg-[color:var(--primary)] px-3 py-1.5 text-sm font-medium text-[color:var(--primary-foreground)] disabled:opacity-50"
            >
              Send to client review
            </button>
            {j.edited_url ? <Out href={j.edited_url}>Current link on the card</Out> : null}
          </div>
          {saying && <p className="muted text-sm">{saying}</p>}
          {waiting.length > 0 && (
            <p className="muted text-sm">
              The desk has {waiting.length} job{waiting.length === 1 ? "" : "s"} queued here. It
              picks work up every few minutes.
            </p>
          )}

          {versions.data?.length ? (
            <ul className="space-y-2 pt-2">
              {versions.data.map((v) => (
                <li key={v.id} className="raised rounded-md px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium">
                      Version {v.n} · {moment(v.at)}
                    </span>
                    <span
                      className="text-xs"
                      style={{ color: v.passed ? "var(--success)" : "var(--warning)" }}
                    >
                      {v.passed ? "everything checked out" : "worth a look"}
                    </span>
                  </div>
                  <ul className="mt-1.5 space-y-0.5">
                    {(v.checks ?? []).map((ch) => (
                      <li key={ch.name} className="flex gap-2 text-xs">
                        <span style={{ color: ch.ok ? "var(--success)" : "var(--warning)" }}>
                          {ch.ok ? "ok" : "!"}
                        </span>
                        <span className="muted">{ch.detail}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </Section>

      <Section title="Notes">
        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              id="new-note"
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") say();
              }}
              placeholder="Add a note for this job"
              className="raised min-w-0 flex-1 rounded-md border hairline px-3 py-2 text-sm"
            />
            <button
              type="button"
              disabled={busy}
              onClick={say}
              className="raised rounded-md border hairline px-3 py-1.5 text-sm disabled:opacity-50"
            >
              Add
            </button>
          </div>

          {notes.loading && <Spinner what="Reading the notes" />}
          {!notes.loading && !notes.data?.length && <Empty>No notes on this job yet.</Empty>}
          <ul className="space-y-2">
            {(notes.data ?? []).map((n) => (
              <li key={n.id} className="raised rounded-md px-3 py-2">
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    id={`note-${n.id}`}
                    checked={Boolean(n.done)}
                    onChange={async (e) => {
                      await markNoteDone(n.id, e.target.checked);
                      notes.reload();
                    }}
                    className="mt-1"
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      dir="auto"
                      className={`rtl-safe text-sm ${n.done ? "muted line-through" : ""}`}
                    >
                      {n.at_sec !== null && n.at_sec !== undefined ? (
                        <span
                          className="mr-2 font-mono text-xs"
                          style={{ color: "var(--primary)" }}
                        >
                          {clock(n.at_sec)}
                        </span>
                      ) : null}
                      {n.text}
                    </p>
                    <p className="muted mt-0.5 text-xs">
                      {n.by_name || n.by_email || "someone"} · {moment(n.at)}
                      {n.source === "clickup" ? " · from the card" : ""}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      {j.error ? <p className="muted px-1 text-xs">Last read reported: {j.error}</p> : null}
    </div>
  );
}
