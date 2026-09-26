import { ArrowLeft, CircleCheck, Send, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import AddRule from "../components/AddRule";
import Ask from "../components/Ask";
import {
  Empty,
  FIELD,
  Fold,
  KICKER,
  Out,
  Page,
  PageHeader,
  Problem,
  Prose,
  Section,
  Spinner,
  StateBadge,
} from "../components/bits";
import Footage from "../components/Footage";
import MoveCard from "../components/MoveCard";
import { Button, buttonClass } from "../components/ui/button";
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
import type { Job, Note } from "../lib/types";

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <dt className={KICKER}>{label}</dt>
      <dd className="mt-1 text-sm">{children}</dd>
    </div>
  );
}

/** The board's own status, read as words: "waiting on footage" -> "Waiting on footage". */
function sentence(s: string | null | undefined): string {
  const t = (s ?? "").trim().toLowerCase();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "No status";
}

/**
 * The cut in Frame.io, when there is one.
 *
 * Absent for a job nobody has uploaded there, which is every job today and
 * will be most of them for a while. That is the point: Frame.io is added
 * beside the Drive link below, never in place of it, so a job without it
 * is exactly the page it was before and nothing here can become the reason
 * an editor cannot deliver.
 */
function FrameioCut({ job, openNotes }: { job: Job; openNotes: number }) {
  if (!job.frameio_url) return null;
  const withClient = Boolean(job.frameio_share_url);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl bg-muted/40 px-4 py-3">
      <span className="text-sm font-medium">
        {job.frameio_version ? `v${job.frameio_version}` : "In review"}
      </span>
      <span className="text-xs text-muted-foreground">
        {withClient
          ? `With the client${job.frameio_seen_at ? ` since ${moment(job.frameio_seen_at)}` : ""}`
          : "Not shared with the client yet"}
      </span>
      {openNotes ? (
        <span className="txt-warn text-xs font-medium">
          {openNotes} {openNotes === 1 ? "note" : "notes"} open
        </span>
      ) : null}
      <span className="ml-auto text-xs font-medium">
        <Out href={job.frameio_url}>Open in Frame.io</Out>
      </span>
    </div>
  );
}

/**
 * A note's timecode, which opens the cut at that frame when it came from
 * Frame.io and is plain text when it did not.
 *
 * `at_sec` is null more often than not, and that is deliberate on the
 * worker's side: a note at the wrong second sends the editor to the wrong
 * part of the cut and looks certain doing it.
 */
function At({ note, url }: { note: Note; url: string | null }) {
  if (note.at_sec === null || note.at_sec === undefined) return null;
  const shown = clock(note.at_sec);
  if (!url || note.source !== "frameio")
    return <span className="mr-2 font-mono text-xs text-primary">{shown}</span>;
  return (
    <a
      href={`${url}${url.includes("?") ? "&" : "?"}t=${Math.floor(note.at_sec)}`}
      target="_blank"
      rel="noreferrer noopener"
      className="mr-2 font-mono text-xs text-primary underline underline-offset-2"
    >
      {shown}
    </a>
  );
}

/** Where a note came from. "The client said this" and "Sabry said this"
 *  should not look the same. */
function whose(note: Note): string {
  if (note.source === "frameio") return " · Frame.io";
  if (note.source === "clickup") return " · from the card";
  return "";
}

export default function JobPage() {
  const { taskId = "" } = useParams();
  const { email, name } = useWho();
  const job = useJob(taskId);
  const client = useClient(job.data?.client_task_id);
  const assets = useAssets(taskId);
  const versions = useVersions(taskId);
  const notes = useNotes(taskId);
  // How many notes are still open, which is the number that tells an
  // editor whether the cut is waiting on them.
  const openNotes = (notes.data ?? []).filter(n => !n.done).length;
  const requests = useRequests(taskId);

  const [link, setLink] = useState("");
  const [noteText, setNoteText] = useState("");
  const [saying, setSaying] = useState<string | null>(null);
  const [noteSaid, setNoteSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Only the first read shows the spinner. A reload after a move or an
  // ask keeps the page up, so the "Queued" line that answered it stays.
  if (job.loading && job.data?.task_id !== taskId)
    return (
      <Page>
        <Spinner what="Opening the job" />
      </Page>
    );
  if (job.error)
    return (
      <Page>
        <Problem>{job.error}</Problem>
      </Page>
    );
  if (!job.data)
    return (
      <Page>
        <Empty>
          That job is not on the desk. It may have been closed on the board.
        </Empty>
      </Page>
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
    setNoteSaid(null);
    const err = await addNote(taskId, noteText.trim(), { email, name });
    setBusy(false);
    if (err) setNoteSaid(`That note was not saved: ${err}`);
    else {
      setNoteText("");
      notes.reload();
    }
  }

  return (
    <Page>
      <Link
        to="/"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" />
        All jobs
      </Link>

      <PageHeader
        dir="auto"
        title={c?.name ?? j.client ?? "No client tag"}
        sub={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
            <span>
              {j.request_type ?? "Video"} · {sentence(j.status)}
            </span>
            {/* When it is blocked, the panel below says so and says why. */}
            {blocked ? null : <StateBadge state={j.state} />}
          </span>
        }
        actions={<MoveCard job={j} onMoved={() => job.reload()} />}
      />

      <dl className="mb-6 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        <Fact label="Editor">{j.editor ?? "Nobody assigned"}</Fact>
        <Fact label="Due">
          <span className={due.late ? "txt-bad font-medium" : ""}>
            {due.text}
          </span>
          {j.due_at ? (
            <span className="text-muted-foreground"> · {day(j.due_at)}</span>
          ) : null}
        </Fact>
        <Fact label="Footage">
          {j.files ? (
            <span className="tabular-nums">
              {j.files} file{j.files === 1 ? "" : "s"} · {minutes(j.seconds)}
            </span>
          ) : (
            <span className="text-muted-foreground">None found</span>
          )}
        </Fact>
        <Fact label="Links">
          {j.url || j.footage_url ? (
            <span className="flex flex-wrap gap-x-3 gap-y-1">
              {j.url ? <Out href={j.url}>Job card</Out> : null}
              {j.footage_url ? (
                <Out href={j.footage_url}>Footage folder</Out>
              ) : null}
            </span>
          ) : (
            <span className="text-muted-foreground">Not set</span>
          )}
        </Fact>
      </dl>

      <div className="space-y-4 sm:space-y-6">
        {blocked ? (
          <section className="callout-warn rounded-2xl border p-4 sm:p-6">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
              <TriangleAlert aria-hidden className="size-4 shrink-0" />
              Not ready to start
            </h2>
            <ul className="mt-3 space-y-1.5 text-foreground">
              {j.missing?.map(m => (
                <li key={m} className="flex gap-2.5 text-sm leading-relaxed">
                  <span
                    aria-hidden
                    className="mt-2 size-1.5 shrink-0 rounded-full"
                    style={{ background: "var(--warning)" }}
                  />
                  <span>{m}</span>
                </li>
              ))}
            </ul>
            <div
              className="mt-4 border-t pt-4"
              style={{ borderColor: "inherit" }}
            >
              <p className={`${KICKER} mb-3`}>Ask for it</p>
              <Ask job={j} onSent={() => job.reload()} />
            </div>
          </section>
        ) : null}

        <Section
          title="The cut"
          side={
            // Making the client's review link is its own page; this card
            // moves the ClickUp card. Two different things, two names.
            <Link
              to="/send-review"
              className={buttonClass({
                variant: "outline",
                size: "sm",
                className: "pointer-coarse:h-10",
              })}
            >
              <Send aria-hidden />
              Make a review link
            </Link>
          }
        >
          <div className="space-y-4">
            <FrameioCut job={j} openNotes={openNotes} />
            <div>
              <label
                htmlFor="cut-link"
                className="mb-1.5 block text-sm font-medium"
              >
                Link to the cut in Drive
              </label>
              <input
                id="cut-link"
                value={link}
                onChange={e => setLink(e.target.value)}
                placeholder={
                  j.edited_url ?? "https://drive.google.com/file/d/…"
                }
                className={`${FIELD} h-10`}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => send("check")}
              >
                Check it first
              </Button>
              <Button disabled={busy} onClick={() => send("deliver")}>
                Move to client review
              </Button>
              {j.edited_url ? (
                <span className="text-sm sm:ml-auto">
                  <Out href={j.edited_url}>Current cut</Out>
                </span>
              ) : null}
            </div>
            {saying && (
              <p role="status" className="text-sm text-muted-foreground">
                {saying}
              </p>
            )}
            {waiting.length > 0 && (
              <p className="text-sm text-muted-foreground">
                The desk has {waiting.length} job
                {waiting.length === 1 ? "" : "s"} queued here. It picks work up
                every few minutes.
              </p>
            )}

            {versions.data?.length ? (
              <ul className="space-y-2">
                {versions.data.map(v => (
                  <li key={v.id} className="rounded-xl bg-muted/40 px-4 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium">
                        Version {v.n} · {moment(v.at)}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                          v.passed ? "txt-good" : "txt-warn"
                        }`}
                      >
                        {v.passed ? (
                          <CircleCheck aria-hidden className="size-3.5" />
                        ) : (
                          <TriangleAlert aria-hidden className="size-3.5" />
                        )}
                        {v.passed ? "Everything checked out" : "Worth a look"}
                      </span>
                    </div>
                    <ul className="mt-2 space-y-1">
                      {(v.checks ?? []).map(ch => (
                        <li key={ch.name} className="flex gap-2 text-xs">
                          {ch.ok ? (
                            <CircleCheck
                              aria-label="Passed"
                              className="txt-good mt-px size-3.5 shrink-0"
                            />
                          ) : (
                            <TriangleAlert
                              aria-label="Worth a look"
                              className="txt-warn mt-px size-3.5 shrink-0"
                            />
                          )}
                          <span className="text-muted-foreground">
                            {ch.detail}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </Section>

        <Section
          title="The brand"
          side={
            c?.docs_read_at || c?.url ? (
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                {c?.docs_read_at ? (
                  <span className="text-muted-foreground">
                    Read {moment(c.docs_read_at)}
                  </span>
                ) : null}
                {c?.url ? <Out href={c.url}>Client card</Out> : null}
              </span>
            ) : undefined
          }
        >
          {client.loading && <Spinner what="Reading the client card" />}
          {!client.loading && !c && (
            <p className="text-sm text-muted-foreground">
              The tag on this card does not match a company on Clients - Mahara,
              so the brand rules could not be found. Fixing the tag on the card
              is enough.
            </p>
          )}
          {c && (
            <div>
              {c.dos_donts ? (
                <div className="pb-3">
                  <p className={`${KICKER} mb-2`}>Do's and don'ts</p>
                  <Prose text={c.dos_donts} />
                </div>
              ) : (
                <p className="pb-3 text-sm text-muted-foreground">
                  No do's and don'ts written for this client yet.
                </p>
              )}
              {c.brand_dna ? (
                <Fold title="Brand DNA">
                  <Prose text={c.brand_dna} />
                </Fold>
              ) : c.brand_dna_url ? (
                <div className="border-t py-3 text-sm">
                  <Out href={c.brand_dna_url}>Brand DNA document</Out>
                </div>
              ) : null}
              {c.offer ? (
                <Fold title="Offer cheat sheet">
                  <Prose text={c.offer} />
                </Fold>
              ) : c.offer_url ? (
                <div className="border-t py-3 text-sm">
                  <Out href={c.offer_url}>Offer cheat sheet</Out>
                </div>
              ) : null}
              <div className="border-t pt-4">
                <AddRule
                  clientTaskId={c.task_id}
                  clientName={c.name}
                  onSent={() => client.reload()}
                />
              </div>
              {c.website || c.instagram || c.docs_error ? (
                <p className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-3 text-xs">
                  {c.website ? <Out href={c.website}>Website</Out> : null}
                  {c.instagram ? <Out href={c.instagram}>Instagram</Out> : null}
                  {c.docs_error ? (
                    <span className="txt-warn">
                      A document could not be read: {c.docs_error}
                    </span>
                  ) : null}
                </p>
              ) : null}
            </div>
          )}
        </Section>

        {j.script || j.brief ? (
          <Section title="What to make">
            {j.brief ? (
              <div className="pb-3">
                <p className={`${KICKER} mb-2`}>Brief on the card</p>
                <Prose text={j.brief} />
              </div>
            ) : null}
            {j.script ? (
              <Fold title="Script" open={!j.brief}>
                <Prose text={j.script} />
              </Fold>
            ) : null}
          </Section>
        ) : null}

        <Section title="Footage">
          {assets.loading ? (
            <Spinner what="Reading the footage" />
          ) : (
            <Footage assets={assets.data ?? []} />
          )}
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
                aria-label="New note"
                value={noteText}
                onChange={e => setNoteText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") say();
                }}
                placeholder="Add a note for this job"
                className={`${FIELD} h-10 min-w-0 flex-1`}
              />
              <Button variant="outline" size="lg" disabled={busy} onClick={say}>
                Add
              </Button>
            </div>
            {noteSaid ? (
              <p role="alert" className="txt-bad text-sm">
                {noteSaid}
              </p>
            ) : null}

            {notes.loading && <Spinner what="Reading the notes" />}
            {!notes.loading && !notes.data?.length && (
              <Empty>No notes on this job yet.</Empty>
            )}
            <ul className="divide-y">
              {(notes.data ?? []).map(n => (
                <li key={n.id} className="flex items-start gap-3 py-2.5">
                  <input
                    type="checkbox"
                    id={`note-${n.id}`}
                    aria-label="Done"
                    checked={Boolean(n.done)}
                    onChange={async e => {
                      await markNoteDone(n.id, e.target.checked);
                      notes.reload();
                    }}
                    className="mt-1 size-4 shrink-0 accent-primary"
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      dir="auto"
                      className={`rtl-safe text-sm ${n.done ? "text-muted-foreground line-through" : ""}`}
                    >
                      <At note={n} url={j.frameio_url} />
                      {n.text}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {n.by_name || n.by_email || "Someone"} · {moment(n.at)}
                      {whose(n)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </Section>

        {j.error ? (
          <p className="px-1 text-xs text-muted-foreground">
            Last read reported: {j.error}
          </p>
        ) : null}
      </div>
    </Page>
  );
}
