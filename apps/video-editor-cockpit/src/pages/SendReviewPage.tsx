import { useCallback, useEffect, useState } from "react";
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

type Draft = { title: string; video_url: string; poster_url: string };

const BLANK: Draft = { title: "", video_url: "", poster_url: "" };

function reviewUrl(token: string): string {
  return `${window.location.origin}/editor/review/${token}`;
}

function when(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

export default function SendReviewPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [title, setTitle] = useState("");
  const [client, setClient] = useState("");
  const [note, setNote] = useState("");
  const [drafts, setDrafts] = useState<Draft[]>([{ ...BLANK }]);
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.rpc("review_list", { p_limit: 25 });
    setRows((data as Row[]) ?? []);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const ready = title.trim() && drafts.some(d => d.video_url.trim());

  async function create() {
    setBusy(true);
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
      window.alert(e instanceof Error ? e.message : "That did not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-5">
      <h1 className="text-lg font-semibold tracking-tight">Send for review</h1>
      <p className="muted mt-1 max-w-prose text-sm">
        One link for the whole delivery. The client watches, approves each cut
        or says what to change, and their notes land back here with the second
        they were talking about.
      </p>

      {made ? (
        <div className="mt-4 rounded-lg border p-3">
          <p className="text-sm font-medium">The link is ready</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-[var(--muted,#f3f4f6)] px-2 py-1 text-xs">
              {made}
            </code>
            <button
              type="button"
              className="rounded-md border px-2.5 py-1 text-xs font-medium"
              onClick={() => {
                void navigator.clipboard?.writeText(made);
              }}
            >
              Copy
            </button>
            <a
              href={made}
              target="_blank"
              rel="noreferrer noopener"
              className="rounded-md border px-2.5 py-1 text-xs font-medium"
            >
              Open it
            </a>
          </div>
          <p className="muted mt-1.5 text-xs">
            Send it on WhatsApp from the client success cockpit, or paste it
            wherever you talk to them. It works for 30 days.
          </p>
        </div>
      ) : null}

      <div className="mt-5 grid gap-3 md:max-w-2xl">
        <label className="grid gap-1 text-sm">
          What this delivery is
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="October films"
            className="h-9 rounded-md border px-2.5 text-sm"
          />
        </label>
        <label className="grid gap-1 text-sm">
          Client
          <input
            value={client}
            onChange={e => setClient(e.target.value)}
            placeholder="Qatar Technology"
            className="h-9 rounded-md border px-2.5 text-sm"
          />
        </label>
        <label className="grid gap-1 text-sm">
          A line for them
          <input
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Three cuts from the Lusail shoot."
            className="h-9 rounded-md border px-2.5 text-sm"
          />
        </label>

        <div className="grid gap-2">
          {drafts.map((d, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a row is its position
            <div key={i} className="grid gap-1.5 rounded-lg border p-2.5">
              <div className="flex gap-2">
                <input
                  value={d.title}
                  onChange={e =>
                    setDrafts(
                      drafts.map((x, j) =>
                        j === i ? { ...x, title: e.target.value } : x,
                      ),
                    )
                  }
                  placeholder={`Title of video ${i + 1}`}
                  className="h-9 min-w-0 flex-1 rounded-md border px-2.5 text-sm"
                />
                {drafts.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => setDrafts(drafts.filter((_, j) => j !== i))}
                    className="muted rounded-md border px-2 text-xs"
                  >
                    Remove
                  </button>
                ) : null}
              </div>
              <input
                value={d.video_url}
                onChange={e =>
                  setDrafts(
                    drafts.map((x, j) =>
                      j === i ? { ...x, video_url: e.target.value } : x,
                    ),
                  )
                }
                placeholder="Link to the video file the client can play"
                className="h-9 rounded-md border px-2.5 text-sm"
              />
              <input
                value={d.poster_url}
                onChange={e =>
                  setDrafts(
                    drafts.map((x, j) =>
                      j === i ? { ...x, poster_url: e.target.value } : x,
                    ),
                  )
                }
                placeholder="Thumbnail link (optional)"
                className="h-9 rounded-md border px-2.5 text-sm"
              />
            </div>
          ))}
          <button
            type="button"
            onClick={() => setDrafts([...drafts, { ...BLANK }])}
            className="justify-self-start rounded-md border px-2.5 py-1 text-xs font-medium"
          >
            Add another video
          </button>
        </div>

        <button
          type="button"
          disabled={busy || !ready}
          onClick={() => void create()}
          className="justify-self-start rounded-md bg-[var(--fg,#111)] px-3 py-2 text-sm font-semibold text-[var(--bg,#fff)] disabled:opacity-50"
        >
          Make the link
        </button>
      </div>

      <h2 className="mt-8 text-sm font-semibold">Sent already</h2>
      {rows === null ? (
        <p className="muted mt-2 text-sm">Loading</p>
      ) : rows.length === 0 ? (
        <p className="muted mt-2 text-sm">
          Nothing sent yet. The first link you make appears here with what the
          client did about it.
        </p>
      ) : (
        <ul className="mt-2 grid gap-1.5">
          {rows.map(r => (
            <li key={r.token} className="rounded-lg border p-2.5 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{r.title}</span>
                {r.client_name ? (
                  <span className="muted text-xs">{r.client_name}</span>
                ) : null}
                <span className="muted ml-auto text-xs">
                  {r.decided} of {r.items} decided
                  {r.changes ? `, ${r.changes} needing a change` : ""}
                </span>
              </div>
              <div className="muted mt-0.5 flex flex-wrap gap-3 text-xs">
                <span>made {when(r.created_at)}</span>
                <span>
                  {r.opened_at
                    ? `opened ${when(r.opened_at)}`
                    : "not opened yet"}
                </span>
                <button
                  type="button"
                  className="underline underline-offset-2"
                  onClick={() => {
                    void navigator.clipboard?.writeText(reviewUrl(r.token));
                  }}
                >
                  copy the link
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
