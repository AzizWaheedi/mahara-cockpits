import { useState } from "react";
import { Link, useParams } from "react-router";
import AddRule from "../components/AddRule";
import Ask from "../components/Ask";
import {
  Empty,
  Fold,
  Out,
  Problem,
  Prose,
  Section,
  Spinner,
  StateBadge,
} from "../components/bits";
import Footage from "../components/Footage";
import MoveCard from "../components/MoveCard";
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

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="muted text-[11px] uppercase tracking-wide">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

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
      <div className="mx-auto max-w-3xl p-4">
        <Problem>{job.error}</Problem>
      </div>
    );
  if (!job.data)
    return (
      <div className="mx-auto max-w-3xl p-4">
        <Empty>
          That job is not on the desk. It may have been closed on the board.
        </Empty>
      </div>
    );

  const j = job.data;
  const c = client.data;
  const due = whenDue(j.due_at);
  const waiting = (requests.data ?? []).filter(
    r => r.status === "queued" || r.status === "running",
  );
  const blocked = Boolean(j.missing?.length);

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
    <div className="mx-auto w-full max-w-3xl px-4 pt-6 pb-16">
      <Link
        to="/"
        className="muted mb-4 inline-block text-sm hover:text-[color:var(--foreground)]"
      >
        ← All jobs
      </Link>

      <header className="mb-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">
              {c?.name ?? j.client ?? "No client tag"}
            </h1>
            <p className="muted mt-1 text-sm">
              {j.request_type ?? "Video"} · {(j.status ?? "").toLowerCase()}
            </p>
          </div>
          <StateBadge state={j.state} />
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          <Fact label="Editor">{j.editor ?? "nobody"}</Fact>
          <Fact label="Due">
            <span
              style={due.late ? { color: "var(--destructive)" } : undefined}
            >
              {due.text}
              {j.due_at ? (
                <span className="muted"> · {day(j.due_at)}</span>
              ) : null}
            </span>
          </Fact>
          <Fact label="Footage">
            {j.files ? (
              <span className="tabular-nums">
                {j.files} file{j.files === 1 ? "" : "s"} · {minutes(j.seconds)}
              </span>
            ) : (
              <span className="muted">none found</span>
            )}
          </Fact>
          <Fact label="Links">
            <span className="flex flex-wrap gap-x-3">
              <Out href={j.url}>Card</Out>
              <Out href={j.footage_url}>Folder</Out>
            </span>
          </Fact>
        </dl>
      </header>

      <div className="space-y-4">
        {blocked ? (
          <section
            className="overflow-hidden rounded-[calc(var(--radius)+0.25rem)] border"
            style={{
              borderColor:
                "color-mix(in oklch, var(--destructive) 35%, transparent)",
              background:
                "color-mix(in oklch, var(--destructive) 7%, transparent)",
            }}
          >
            <div className="px-4 py-3.5">
              <h2 className="text-sm font-semibold tracking-tight">
                Not ready to start
              </h2>
              <ul className="mt-2 space-y-1.5">
                {j.missing?.map(m => (
                  <li key={m} className="flex gap-2 text-sm leading-relaxed">
                    <span aria-hidden style={{ color: "var(--destructive)" }}>
                      •
                    </span>
                    <span>{m}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div
              className="border-t px-4 py-3.5"
              style={{ borderColor: "inherit" }}
            >
              <p className="muted mb-2.5 text-xs uppercase tracking-wide">
                Ask for it
              </p>
              <Ask job={j} onSent={() => job.reload()} />
            </div>
          </section>
        ) : null}

        <Section
          title="The brand"
          side={
            <span className="flex items-center gap-3 text-xs">
              {c?.docs_read_at ? (
                <span className="muted">read {moment(c.docs_read_at)}</span>
              ) : null}
              {c ? <Out href={c.url}>Client card</Out> : null}
            </span>
          }
        >
          {client.loading && <Spinner what="Reading the client card" />}
          {!client.loading && !c && (
            <p className="muted text-sm">
              The tag on this card does not match a company on Clients - Mahara,
              so the brand rules could not be found. Fixing the tag on the card
              is enough.
            </p>
          )}
          {c && (
            <div>
              {c.dos_donts ? (
                <div className="pb-3">
                  <p className="muted mb-1.5 text-[11px] uppercase tracking-wide">
                    Do's and don'ts
                  </p>
                  <Prose text={c.dos_donts} />
                </div>
              ) : (
                <p className="muted pb-3 text-sm">
                  No do's and don'ts written for this client yet.
                </p>
              )}
              {c.brand_dna ? (
                <Fold
                  title="Brand DNA"
                  hint={`${Math.round(c.brand_dna.length / 1000)}k characters`}
                >
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
              <div className="border-t hairline pt-3">
                <AddRule
                  clientTaskId={c.task_id}
                  clientName={c.name}
                  onSent={() => client.reload()}
                />
              </div>
              <p className="muted border-t hairline pt-2.5 text-xs">
                The desk re-reads these whenever the document changes.
                {c.website ? (
                  <>
                    {" "}
                    <Out href={c.website}>Website</Out>
                  </>
                ) : null}
                {c.instagram ? (
                  <>
                    {" · "}
                    <Out href={c.instagram}>Instagram</Out>
                  </>
                ) : null}
                {c.docs_error ? (
                  <span> · a document could not be read: {c.docs_error}</span>
                ) : null}
              </p>
            </div>
          )}
        </Section>

        {j.script || j.brief ? (
          <Section title="What to make">
            {j.brief ? (
              <div className="pb-3">
                <p className="muted mb-1.5 text-[11px] uppercase tracking-wide">
                  Brief on the card
                </p>
                <Prose text={j.brief} />
              </div>
            ) : null}
            {j.script ? (
              <Fold
                title="Script"
                hint={`${j.script.length} characters`}
                open={!j.brief}
              >
                <Prose text={j.script} />
              </Fold>
            ) : null}
          </Section>
        ) : null}

        <Section
          title="Footage"
          side={
            assets.data?.length ? (
              <span className="muted tabular-nums text-xs">
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

        <Section title="Where it is">
          <MoveCard job={j} onMoved={() => job.reload()} />
        </Section>

        <Section title="The cut">
          <div className="space-y-3">
            <label
              htmlFor="cut-link"
              className="muted block text-[11px] uppercase tracking-wide"
            >
              Link to the cut in Drive
            </label>
            <input
              id="cut-link"
              value={link}
              onChange={e => setLink(e.target.value)}
              placeholder={j.edited_url ?? "https://drive.google.com/file/d/…"}
              className="raised h-11 w-full rounded-[var(--radius-md)] border hairline px-3 text-sm"
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => send("check")}
                className="raised rounded-[var(--radius-md)] border hairline px-3 py-2 text-sm disabled:opacity-50"
              >
                Check it first
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => send("deliver")}
                className="rounded-[var(--radius-md)] bg-[color:var(--primary)] px-3 py-2 text-sm font-medium text-[color:var(--primary-foreground)] disabled:opacity-50"
              >
                Send to client review
              </button>
              {j.edited_url ? (
                <span className="ml-auto text-sm">
                  <Out href={j.edited_url}>Current link on the card</Out>
                </span>
              ) : null}
            </div>
            {saying && <p className="muted text-sm">{saying}</p>}
            {waiting.length > 0 && (
              <p className="muted text-sm">
                The desk has {waiting.length} job
                {waiting.length === 1 ? "" : "s"} queued here. It picks work up
                every few minutes.
              </p>
            )}

            {versions.data?.length ? (
              <ul className="space-y-2 pt-1">
                {versions.data.map(v => (
                  <li
                    key={v.id}
                    className="raised rounded-[var(--radius-md)] px-3 py-2.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium">
                        Version {v.n} · {moment(v.at)}
                      </span>
                      <span
                        className="text-xs"
                        style={{
                          color: v.passed ? "var(--success)" : "var(--warning)",
                        }}
                      >
                        {v.passed ? "everything checked out" : "worth a look"}
                      </span>
                    </div>
                    <ul className="mt-1.5 space-y-0.5">
                      {(v.checks ?? []).map(ch => (
                        <li key={ch.name} className="flex gap-2 text-xs">
                          <span
                            style={{
                              color: ch.ok
                                ? "var(--success)"
                                : "var(--warning)",
                            }}
                          >
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

        {!blocked ? (
          <Section title="Need something?">
            <Ask job={j} onSent={() => job.reload()} />
          </Section>
        ) : null}

        <Section title="Notes">
          <div className="space-y-3">
            <div className="flex gap-2">
              <input
                id="new-note"
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") say();
                }}
                placeholder="Add a note for this job"
                className="raised h-10 min-w-0 flex-1 rounded-[var(--radius-md)] border hairline px-3 text-sm"
              />
              <button
                type="button"
                disabled={busy}
                onClick={say}
                className="raised rounded-[var(--radius-md)] border hairline px-3 text-sm disabled:opacity-50"
              >
                Add
              </button>
            </div>

            {notes.loading && <Spinner what="Reading the notes" />}
            {!notes.loading && !notes.data?.length && (
              <Empty>No notes on this job yet.</Empty>
            )}
            <ul className="space-y-1.5">
              {(notes.data ?? []).map(n => (
                <li key={n.id} className="flex items-start gap-2.5 py-1">
                  <input
                    type="checkbox"
                    id={`note-${n.id}`}
                    checked={Boolean(n.done)}
                    onChange={async e => {
                      await markNoteDone(n.id, e.target.checked);
                      notes.reload();
                    }}
                    className="mt-1 accent-[color:var(--primary)]"
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
                    <p className="muted mt-0.5 text-[11px]">
                      {n.by_name || n.by_email || "someone"} · {moment(n.at)}
                      {n.source === "clickup" ? " · from the card" : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </Section>

        {j.error ? (
          <p className="muted px-1 text-xs">Last read reported: {j.error}</p>
        ) : null}
      </div>
    </div>
  );
}
