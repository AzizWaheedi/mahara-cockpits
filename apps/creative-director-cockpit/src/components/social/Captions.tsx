import { useAction } from "convex/react";
import { Facebook, Instagram, LoaderCircle, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { useConfirm } from "./Confirm";
import { PLATFORMS, type Platform } from "./media";

/**
 * The words, one per platform.
 *
 * Instagram and Facebook read differently -- hashtags work on one and
 * look like spam on the other, and Facebook shows the whole thing where
 * Instagram cuts it at two lines -- so each gets its own caption. The AI
 * writes both (from what is said in the video, when there is one); either
 * can be typed over, and is saved when you leave the box.
 */

const ICON = { instagram: Instagram, facebook: Facebook } as const;

function message(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e ?? "");
  const m = /Uncaught Error: ([^\n]+)/.exec(raw);
  return (
    (m ? m[1] : raw).replace(/\s+at .*$/s, "").trim() || "That did not work."
  );
}

export function Captions({
  post,
  platforms,
  writing,
  onChanged,
}: {
  post: { id: string; caption: string | null; caption_facebook: string | null };
  platforms: Platform[];
  writing: boolean;
  onChanged: () => Promise<void>;
}) {
  const update = useAction(api.social.updatePost);
  const write = useAction(api.social.writeCaption);
  const shown = PLATFORMS.filter(p => platforms.includes(p.key));
  const [tab, setTab] = useState<Platform>(shown[0]?.key ?? "instagram");
  const server = {
    instagram: post.caption ?? "",
    facebook: post.caption_facebook ?? "",
  };
  const [text, setText] = useState(server);
  const [dirty, setDirty] = useState<Record<Platform, boolean>>({
    instagram: false,
    facebook: false,
  });
  const [saved, setSaved] = useState<"idle" | "saving" | "saved">("idle");
  const lastId = useRef(post.id);
  const [confirm, confirmDialog] = useConfirm();

  // A different post, or new words arriving from the AI: show them --
  // but never over words somebody is in the middle of typing.
  useEffect(() => {
    if (lastId.current !== post.id) {
      lastId.current = post.id;
      setText({
        instagram: post.caption ?? "",
        facebook: post.caption_facebook ?? "",
      });
      setDirty({ instagram: false, facebook: false });
      setSaved("idle");
      return;
    }
    setText(cur => ({
      instagram: dirty.instagram ? cur.instagram : (post.caption ?? ""),
      facebook: dirty.facebook ? cur.facebook : (post.caption_facebook ?? ""),
    }));
  }, [post.id, post.caption, post.caption_facebook, dirty]);

  useEffect(() => {
    if (!shown.some(p => p.key === tab) && shown[0]) setTab(shown[0].key);
  }, [shown, tab]);

  async function save(p: Platform) {
    if (!dirty[p]) return;
    setSaved("saving");
    try {
      await update(
        p === "instagram"
          ? { postId: post.id, caption: text.instagram }
          : { postId: post.id, captionFacebook: text.facebook },
      );
      // Reload before letting go of the typed words, or the box would
      // flash back to the old caption until the new one arrived.
      await onChanged();
      setDirty(d => ({ ...d, [p]: false }));
      setSaved("saved");
    } catch (e) {
      setSaved("idle");
      toast.error(message(e));
    }
  }

  async function writeAgain() {
    const hasWords = Boolean(server.instagram || server.facebook);
    if (
      hasWords &&
      !(await confirm({
        title: "Write both captions again?",
        body: "This replaces what is there now.",
        action: "Write them again",
      }))
    )
      return;
    try {
      await write({ postId: post.id });
      setDirty({ instagram: false, facebook: false });
      toast.success("Writing the captions. They land here in a few seconds.");
      await onChanged();
    } catch (e) {
      toast.error(message(e));
    }
  }

  const limit = PLATFORMS.find(p => p.key === tab)?.limit ?? 2200;
  const value = text[tab];
  const empty = !server.instagram && !server.facebook;

  return (
    <div>
      <div className="mb-1.5 flex flex-wrap items-center gap-1">
        <span className="mr-1 text-sm font-medium">Caption</span>
        {shown.length > 1 ? (
          <div
            role="tablist"
            className="inline-flex gap-0.5 rounded-lg border p-0.5"
          >
            {shown.map(p => {
              const Icon = ICON[p.key];
              return (
                <button
                  key={p.key}
                  type="button"
                  role="tab"
                  aria-selected={tab === p.key}
                  onClick={() => setTab(p.key)}
                  className={`inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium ${
                    tab === p.key
                      ? "bg-primary/15 text-foreground ring-1 ring-inset ring-primary/40"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {p.label}
                </button>
              );
            })}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">
            {shown[0]?.label}
          </span>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {saved === "saving" ? "Saving" : saved === "saved" ? "Saved" : ""}
        </span>
        <button
          type="button"
          disabled={writing}
          onClick={() => void writeAgain()}
          className="ml-1 inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-primary hover:bg-muted disabled:opacity-50"
        >
          {writing ? (
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {writing ? "Writing" : empty ? "Write with AI" : "Write again"}
        </button>
      </div>

      {empty && writing ? (
        <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          The captions are being written, from the brief and from what is said
          in any video.
        </p>
      ) : (
        <>
          <textarea
            aria-label={`${tab === "instagram" ? "Instagram" : "Facebook"} caption`}
            value={value}
            readOnly={writing}
            onChange={e => {
              setText(t => ({ ...t, [tab]: e.target.value }));
              setDirty(d => ({ ...d, [tab]: true }));
              setSaved("idle");
            }}
            onBlur={() => void save(tab)}
            rows={8}
            dir="auto"
            placeholder={
              tab === "facebook" && server.instagram
                ? "Empty, so Facebook gets the Instagram caption."
                : "Type the caption, or let the AI write it."
            }
            className={`w-full rounded-lg border bg-background p-3 text-sm leading-relaxed focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              writing ? "opacity-60" : ""
            }`}
          />
          <p
            className={`mt-1 text-right text-xs tabular-nums ${
              value.length > limit
                ? "text-destructive"
                : "text-muted-foreground"
            }`}
          >
            {value.length.toLocaleString("en-GB")} /{" "}
            {limit.toLocaleString("en-GB")}
          </p>
        </>
      )}
      {confirmDialog}
    </div>
  );
}
