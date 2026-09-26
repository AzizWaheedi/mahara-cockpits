import { ExternalLink, Pencil, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link } from "react-router";
import { api } from "../lib/api";
import { usePeople } from "../lib/data";
import { day } from "../lib/format";
import { toast } from "../lib/toast";
import type { CoachReview, Me } from "../lib/types";
import { button, buttonPrimary, EmptyState, field, StatusChip } from "./kit";
import { Prose } from "./Prose";

/**
 * Aziz's own call reviews (the ones on Skool, or written here), for the team
 * to learn from. Anyone with a seat reads them; only a manager adds, edits or
 * removes one.
 */

const CALL_TYPES: [string, string][] = [
  ["", "Any call"],
  ["intro", "Intro"],
  ["demo", "Demo"],
  ["phone", "Phone call"],
  ["other", "Other"],
];

export function CoachReviewList({
  me,
  reviews,
  onChange,
  showCall = true,
}: {
  me: Me;
  reviews: CoachReview[];
  onChange: () => void;
  showCall?: boolean;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  if (!reviews.length)
    return (
      <EmptyState
        compact
        title="No reviews from Aziz yet"
        text={
          me.manager
            ? "Add the link to a review on Skool, or write what the team should take from a call."
            : "Aziz's own call reviews appear here as he adds them."
        }
      />
    );
  return (
    <ul className="divide-y hairline">
      {reviews.map(r =>
        editing === r.id ? (
          <li key={r.id} className="py-3">
            <CoachReviewForm
              me={me}
              review={r}
              onDone={() => {
                setEditing(null);
                onChange();
              }}
              onCancel={() => setEditing(null)}
            />
          </li>
        ) : (
          <li key={r.id} className="space-y-1.5 py-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold" dir="auto">
                  {r.title}
                </p>
                <p className="muted text-xs">
                  {[
                    day(r.created_at),
                    r.call_type
                      ? (CALL_TYPES.find(([k]) => k === r.call_type)?.[1] ??
                        null)
                      : null,
                    r.for_email
                      ? `for ${r.for_email.split("@")[0]}`
                      : "for the team",
                    r.score !== null ? `${r.score}/100` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {r.url ? (
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className={button}
                  >
                    <ExternalLink className="size-3.5" aria-hidden />
                    {/skool\.com/i.test(r.url) ? "Open on Skool" : "Open"}
                  </a>
                ) : null}
                {me.manager ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setEditing(r.id)}
                      className={button}
                      aria-label="Edit this review"
                    >
                      <Pencil className="size-3.5" aria-hidden />
                    </button>
                    <DeleteButton id={r.id} onDone={onChange} />
                  </>
                ) : null}
              </div>
            </div>
            {r.tags.length ? (
              <div className="flex flex-wrap gap-1">
                {r.tags.map(t => (
                  <StatusChip key={t} tone="neutral" label={t} />
                ))}
              </div>
            ) : null}
            {r.lessons ? <Prose text={r.lessons} /> : null}
            {showCall && r.recording_id ? (
              <Link
                to={`/recording/${encodeURIComponent(r.recording_id)}`}
                className="muted text-xs underline underline-offset-2"
              >
                The call this is about
              </Link>
            ) : null}
          </li>
        ),
      )}
    </ul>
  );
}

function DeleteButton({ id, onDone }: { id: string; onDone: () => void }) {
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  async function remove() {
    setBusy(true);
    try {
      await api("coach.delete", { id });
      toast.success("Removed.");
      onDone();
    } catch (e) {
      toast.error(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
      setSure(false);
    }
  }
  return sure ? (
    <button
      type="button"
      onClick={remove}
      disabled={busy}
      className={`${button} border-[color:var(--destructive)]`}
    >
      {busy ? "Removing…" : "Remove it"}
    </button>
  ) : (
    <button
      type="button"
      onClick={() => setSure(true)}
      className={button}
      aria-label="Remove this review"
    >
      <Trash2 className="size-3.5" aria-hidden />
    </button>
  );
}

export function CoachReviewForm({
  me,
  review,
  recordingId,
  contactId,
  onDone,
  onCancel,
}: {
  me: Me;
  review?: CoachReview;
  recordingId?: string | null;
  contactId?: string | null;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const people = usePeople();
  const [title, setTitle] = useState(review?.title ?? "");
  const [url, setUrl] = useState(review?.url ?? "");
  const [lessons, setLessons] = useState(review?.lessons ?? "");
  const [callType, setCallType] = useState(review?.call_type ?? "");
  const [forEmail, setForEmail] = useState(review?.for_email ?? "");
  const [tags, setTags] = useState((review?.tags ?? []).join(", "));
  const [score, setScore] = useState(
    review?.score !== null && review?.score !== undefined
      ? String(review.score)
      : "",
  );
  const [busy, setBusy] = useState(false);
  if (!me.manager) return null;

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api("coach.save", {
        id: review?.id ?? null,
        title,
        url,
        lessons,
        call_type: callType,
        for_email: forEmail,
        tags,
        score,
        recording_id: review?.recording_id ?? recordingId ?? null,
        contact_id: review?.contact_id ?? contactId ?? null,
      });
      toast.success(review ? "Saved." : "Added. The team sees it now.");
      onDone();
    } catch (err) {
      toast.error(String((err as Error).message ?? err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="muted block text-xs">Title</span>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            required
            dir="auto"
            placeholder="Handling 'let me think about it'"
            className={field}
          />
        </label>
        <label className="block space-y-1">
          <span className="muted block text-xs">
            Link (Skool post or video)
          </span>
          <input
            value={url}
            onChange={e => setUrl(e.target.value)}
            type="url"
            inputMode="url"
            placeholder="https://www.skool.com/…"
            className={field}
            dir="ltr"
          />
        </label>
        <label className="block space-y-1">
          <span className="muted block text-xs">Kind of call</span>
          <select
            value={callType}
            onChange={e => setCallType(e.target.value)}
            className={field}
          >
            {CALL_TYPES.map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="muted block text-xs">For</span>
          <select
            value={forEmail}
            onChange={e => setForEmail(e.target.value)}
            className={field}
          >
            <option value="">The whole team</option>
            {(people.data ?? []).map(p => (
              <option key={p.email} value={p.email}>
                {p.name ?? p.email}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="muted block text-xs">Tags (comma between)</span>
          <input
            value={tags}
            onChange={e => setTags(e.target.value)}
            placeholder="price, discovery, closing"
            className={field}
            dir="auto"
          />
        </label>
        <label className="block space-y-1">
          <span className="muted block text-xs">Score out of 100 (if any)</span>
          <input
            value={score}
            onChange={e => setScore(e.target.value)}
            inputMode="numeric"
            className={field}
          />
        </label>
      </div>
      <label className="block space-y-1">
        <span className="muted block text-xs">What to take from it</span>
        <textarea
          value={lessons}
          onChange={e => setLessons(e.target.value)}
          rows={4}
          dir="auto"
          className={`${field} h-auto py-2 leading-relaxed`}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className={buttonPrimary}>
          {review ? (
            busy ? (
              "Saving…"
            ) : (
              "Save"
            )
          ) : (
            <>
              <Plus className="size-3.5" aria-hidden />
              {busy ? "Adding…" : "Add the review"}
            </>
          )}
        </button>
        {onCancel ? (
          <button type="button" onClick={onCancel} className={button}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}
