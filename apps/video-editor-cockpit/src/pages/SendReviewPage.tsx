import {
  ArrowUpRight,
  Check,
  Copy,
  ImagePlus,
  Loader2,
  Plus,
  Upload,
  X,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  FIELD,
  KICKER,
  Page,
  PageHeader,
  Section,
  Spinner,
} from "../components/bits";
import { Button, buttonClass } from "../components/ui/button";
import { day } from "../lib/format";
import { supabase } from "../lib/supabase";

/**
 * Making a review link, and watching what comes back.
 *
 * Deliberately not tied to one job card. A delivery is usually a few
 * cuts at once, and the client should get one link rather than three,
 * so this builds a bundle and hands back a single URL.
 */

type Row = {
  token: string;
  title: string;
  client_name: string | null;
  created_at: string;
  sent_at: string | null;
  opened_at: string | null;
  revoked: boolean;
  items: number;
  decided: number;
  changes: number;
};

type Draft = {
  title: string;
  video_url: string;
  poster_url: string;
  uploading?: number | null;
  /** The thumbnail field is open. On the screen only; never sent. */
  thumb?: boolean;
  /** Why the last upload failed, said under the video it belongs to. */
  problem?: string | null;
};

const BLANK: Draft = {
  title: "",
  video_url: "",
  poster_url: "",
  uploading: null,
};

/**
 * Put the cut somewhere the client's browser can actually play it.
 *
 * A Drive or Dropbox link does not play in a video tag -- it serves a
 * viewer page, not a file -- and a client who presses play and sees
 * nothing does not write in to say so, they just go quiet. So the file
 * goes into our own public bucket and the review points at that.
 */
async function upload(
  file: File,
  onProgress: (pct: number) => void,
): Promise<string> {
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);
  const path = `${Date.now()}-${safe}`;
  onProgress(1);
  const { error } = await supabase.storage
    .from("review-videos")
    .upload(path, file, { cacheControl: "31536000", upsert: false });
  if (error) throw error;
  onProgress(100);
  return supabase.storage.from("review-videos").getPublicUrl(path).data
    .publicUrl;
}

function reviewUrl(token: string): string {
  return `${window.location.origin}/editor/review/${token}`;
}

/** "24 Sept", Kuwait's day, the way every other date on the desk reads. */
const when = day;

/** Copy, then say so for two seconds on the button that did it. */
function useCopy(): [string | null, (text: string, key: string) => void] {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = useCallback((text: string, key: string) => {
    void navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(key);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(null), 2000);
      },
      () => setCopied(null),
    );
  }, []);
  return [copied, copy];
}

function Field({
  id,
  label,
  className = "",
  children,
}: {
  id: string;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium">
        {label}
      </label>
      {children}
    </div>
  );
}

export default function SendReviewPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [title, setTitle] = useState("");
  const [client, setClient] = useState("");
  const [note, setNote] = useState("");
  const [drafts, setDrafts] = useState<Draft[]>([{ ...BLANK }]);
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, copy] = useCopy();

  const load = useCallback(async () => {
    const { data } = await supabase.rpc("review_list", { p_limit: 25 });
    setRows((data as Row[]) ?? []);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const ready = title.trim() && drafts.some(d => d.video_url.trim());

  function patch(i: number, change: Partial<Draft>) {
    setDrafts(cur => cur.map((x, j) => (j === i ? { ...x, ...change } : x)));
  }

  async function create() {
    setBusy(true);
    setProblem(null);
    try {
      const items = drafts
        .filter(d => d.video_url.trim())
        .map(d => ({
          title: d.title.trim(),
          video_url: d.video_url.trim(),
          poster_url: d.poster_url.trim() || null,
        }));
      const { data, error } = await supabase.rpc("review_create", {
        p_title: title.trim(),
        p_note: note.trim(),
        p_client: client.trim() || null,
        p_client_task_id: null,
        p_by: (await supabase.auth.getUser()).data.user?.email ?? "unknown",
        p_items: items,
        p_days: 30,
      });
      if (error) throw error;
      const token = (data as { token: string }).token;
      setMade(reviewUrl(token));
      setTitle("");
      setClient("");
      setNote("");
      setDrafts([{ ...BLANK }]);
      await load();
    } catch (e) {
      setProblem(
        e instanceof Error
          ? `That did not save: ${e.message}`
          : "That did not save. Try once more.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page>
      <PageHeader
        title="Send for review"
        sub="One link for the whole delivery. The client approves each cut or asks for a change, and their notes land here."
      />

      <div className="space-y-4 sm:space-y-6">
        <Section title="Delivery">
          <div className="@container">
            <div className="grid gap-4 @lg:grid-cols-2">
              <Field id="review-title" label="What this delivery is">
                <input
                  id="review-title"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="October films"
                  dir="auto"
                  className={`${FIELD} h-10`}
                />
              </Field>
              <Field id="review-client" label="Client">
                <input
                  id="review-client"
                  value={client}
                  onChange={e => setClient(e.target.value)}
                  placeholder="Qatar Technology"
                  dir="auto"
                  className={`${FIELD} h-10`}
                />
              </Field>
              <Field
                id="review-note"
                label="A line for them"
                className="@lg:col-span-2"
              >
                <input
                  id="review-note"
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  placeholder="Three cuts from the Lusail shoot."
                  dir="auto"
                  className={`${FIELD} h-10`}
                />
              </Field>
            </div>
          </div>
        </Section>

        <Section title="Videos">
          <ol className="space-y-3">
            {drafts.map((d, i) => (
              // A row is its position: the drafts have no id of their own.
              <li key={i} className="rounded-xl bg-muted/40 p-4">
                <div className="flex min-h-8 items-center justify-between gap-2">
                  <p className={KICKER}>Video {i + 1}</p>
                  {drafts.length > 1 ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="-mr-2 text-muted-foreground hover:text-foreground"
                      onClick={() =>
                        setDrafts(cur => cur.filter((_, j) => j !== i))
                      }
                    >
                      <X aria-hidden />
                      Remove
                    </Button>
                  ) : null}
                </div>
                <div className="mt-2 space-y-3">
                  <input
                    aria-label={`Title of video ${i + 1}`}
                    value={d.title}
                    onChange={e => patch(i, { title: e.target.value })}
                    placeholder="The title the client sees"
                    dir="auto"
                    className={`${FIELD} h-10`}
                  />
                  <div className="flex gap-2">
                    <input
                      aria-label={`Link to video ${i + 1}`}
                      value={d.video_url}
                      onChange={e => patch(i, { video_url: e.target.value })}
                      placeholder="Paste a video link"
                      className={`${FIELD} h-10 min-w-0 flex-1`}
                    />
                    {/* The file field is hidden from sight, not from the
                        keyboard, so the label still takes focus. */}
                    <label
                      className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border px-4 text-sm font-medium transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-primary [&_svg]:size-4 ${
                        d.uploading
                          ? "cursor-default text-muted-foreground"
                          : "cursor-pointer hover:bg-muted"
                      }`}
                    >
                      {d.uploading ? (
                        <>
                          <Loader2 aria-hidden className="animate-spin" />
                          Uploading
                        </>
                      ) : (
                        <>
                          <Upload aria-hidden />
                          Upload
                        </>
                      )}
                      <input
                        type="file"
                        accept="video/*"
                        className="sr-only"
                        disabled={Boolean(d.uploading)}
                        onChange={async e => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          patch(i, { problem: null });
                          try {
                            const url = await upload(file, pct =>
                              patch(i, { uploading: pct }),
                            );
                            patch(i, {
                              video_url: url,
                              uploading: null,
                              title:
                                d.title || file.name.replace(/\.[^.]+$/, ""),
                            });
                          } catch (err) {
                            patch(i, {
                              uploading: null,
                              problem:
                                err instanceof Error
                                  ? `That did not upload: ${err.message}`
                                  : "That did not upload. Try the file again.",
                            });
                          }
                        }}
                      />
                    </label>
                  </div>
                  {/* Supabase does not report how far along an upload is,
                      so this turns rather than counting. */}
                  {d.uploading ? (
                    <p role="status" className="text-xs text-muted-foreground">
                      Uploading. Leave this page open until it finishes.
                    </p>
                  ) : null}
                  {d.problem ? (
                    <p role="alert" className="txt-bad text-xs">
                      {d.problem}
                    </p>
                  ) : null}
                  {d.thumb || d.poster_url ? (
                    <input
                      aria-label={`Thumbnail for video ${i + 1}`}
                      value={d.poster_url}
                      onChange={e => patch(i, { poster_url: e.target.value })}
                      placeholder="Link to a thumbnail image"
                      className={`${FIELD} h-10`}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => patch(i, { thumb: true })}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-primary underline-offset-4 hover:underline"
                    >
                      <ImagePlus aria-hidden className="size-3.5" />
                      Add a thumbnail
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ol>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => setDrafts(cur => [...cur, { ...BLANK }])}
          >
            <Plus aria-hidden />
            Add another video
          </Button>
        </Section>

        <div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Button
              size="lg"
              className="w-full pointer-coarse:h-11 sm:w-auto"
              disabled={busy || !ready}
              onClick={() => void create()}
            >
              {busy ? (
                <>
                  <Loader2 aria-hidden className="animate-spin" />
                  Making the link
                </>
              ) : (
                "Make the link"
              )}
            </Button>
            {!ready && !made ? (
              <p className="text-xs text-muted-foreground">
                Needs a name for the delivery and at least one video.
              </p>
            ) : null}
          </div>
          {problem ? (
            <p role="alert" className="txt-bad mt-2 text-sm">
              {problem}
            </p>
          ) : null}
        </div>

        {/* Right under the button that made it, so it is in view on a
            phone rather than at the top of a page scrolled past. */}
        {made ? (
          <section
            aria-live="polite"
            className="glow-teal rounded-2xl border bg-card p-4 sm:p-6"
          >
            <h2 className="text-[15px] font-semibold tracking-tight">
              The link is ready
            </h2>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 basis-full truncate rounded-lg bg-muted px-3 py-2 font-mono text-xs sm:basis-0">
                {made}
              </code>
              <Button variant="outline" onClick={() => copy(made, "made")}>
                {copied === "made" ? (
                  <>
                    <Check aria-hidden />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy aria-hidden />
                    Copy
                  </>
                )}
              </Button>
              <a
                href={made}
                target="_blank"
                rel="noreferrer noopener"
                className={buttonClass({
                  variant: "outline",
                  className: "pointer-coarse:h-10",
                })}
              >
                Open it
                <ArrowUpRight aria-hidden />
              </a>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Send it on WhatsApp from the client success cockpit, or paste it
              wherever you talk to them. It works for 30 days.
            </p>
          </section>
        ) : null}

        <Section title="Sent already">
          {rows === null ? (
            <Spinner what="Reading the links" />
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing sent yet. The first link you make appears here with what
              the client did about it.
            </p>
          ) : (
            <ul className="-my-3 divide-y">
              {rows.map(r => (
                <li key={r.token} className="py-3">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span dir="auto" className="min-w-0 font-medium">
                      {r.title}
                    </span>
                    {r.client_name ? (
                      <span
                        dir="auto"
                        className="text-xs text-muted-foreground"
                      >
                        {r.client_name}
                      </span>
                    ) : null}
                    {r.revoked ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        <span
                          aria-hidden
                          className="size-1.5 rounded-full bg-muted-foreground"
                        />
                        Revoked
                      </span>
                    ) : null}
                    <span className="basis-full text-xs tabular-nums sm:ml-auto sm:basis-auto">
                      {r.decided} of {r.items} decided
                      {r.changes ? `, ${r.changes} needing a change` : ""}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>Made {when(r.created_at)}</span>
                    {r.sent_at ? <span>Sent {when(r.sent_at)}</span> : null}
                    <span>
                      {r.opened_at
                        ? `Opened ${when(r.opened_at)}`
                        : "Not opened yet"}
                    </span>
                    {/* A revoked link no longer opens, so it is not offered
                        for copying into a message. */}
                    {r.revoked ? null : (
                      <button
                        type="button"
                        onClick={() => copy(reviewUrl(r.token), r.token)}
                        className="no-touch relative inline-flex items-center gap-1 font-medium text-primary underline-offset-4 after:absolute after:-inset-2 after:content-[''] hover:underline"
                      >
                        {copied === r.token ? (
                          <>
                            <Check aria-hidden className="size-3.5" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy aria-hidden className="size-3.5" />
                            Copy link
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </Page>
  );
}
