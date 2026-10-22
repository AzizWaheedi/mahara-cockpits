import { Play, Plus } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DECK_NAME } from "./content";
import type { SlideDef } from "./deckContext";
import type { DeckData } from "./deckData";
import {
  type DeckKind,
  VIDEOS_NOT_LIVE,
  type VideoLang,
  type VideoRow,
  VideoSaveError,
} from "./sources";
import type { DeckIO, DeckModel } from "./useDeckModel";
import { CheckPlayer } from "./VideoPlayer";
import { VideoPoster } from "./VideoPoster";
import {
  clock,
  deckSlots,
  hiddenWhy,
  LANG_NAME,
  parseClock,
  rowTitle,
  saveRevision,
  shortLink,
  slotId,
  slotTitle,
  type VideoSlot,
  videoMode,
} from "./videos";

/**
 * Prep's Videos section (DESIGN 21.5): every slot of this deck in slide
 * order, recorded or not, saved and cleared through the gated functions
 * (VIDEOS.md 4). A slot is the same for every client, so a link saved here
 * shows on every deck of this kind. An empty slot is one row; its fields
 * open only when the CSM asks for them. Videos never count in readiness.
 */

const LANG_OPTIONS: { value: VideoLang; label: string }[] = [
  { value: "any", label: "Any" },
  { value: "en", label: "English" },
  { value: "ar", label: "Arabic" },
];

type Field = "link" | "title" | "length" | "language";

interface Draft {
  lang: VideoLang;
  url: string;
  length: string;
  title: string;
}

/** The fields for one recording, with Save and its states. */
function VideoForm({
  slot,
  deck,
  free,
  initial,
  live,
  revisionOf,
  io,
  onDone,
  onConflict,
}: {
  slot: VideoSlot;
  deck: DeckKind;
  /** The languages still free for this slot (a recorded one is changed by Clear). */
  free: VideoLang[];
  initial: Partial<Draft>;
  /** False when the server does not know this slot yet: Save stays off. */
  live: boolean;
  revisionOf: (lang: VideoLang) => number;
  io?: DeckIO;
  onDone: () => void;
  onConflict: (message: string) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState<Draft>({
    lang: initial.lang ?? free[0] ?? "any",
    url: initial.url ?? "",
    length: initial.length ?? "",
    title: initial.title ?? "",
  });
  const [phase, setPhase] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<{
    field: Field | null;
    text: string;
  } | null>(null);
  const link = useRef<HTMLInputElement>(null);
  useEffect(() => {
    link.current?.focus();
  }, []);
  const set = (patch: Partial<Draft>) => {
    setDraft(d => ({ ...d, ...patch }));
    setError(null);
  };
  const seconds = parseClock(draft.length);
  const save = async () => {
    if (!io?.saveVideo) {
      setError({
        field: null,
        text: "Saving videos needs your cockpit sign-in.",
      });
      return;
    }
    if (Number.isNaN(seconds)) {
      setError({
        field: "length",
        text: "Type the length as minutes and seconds, like 2:40.",
      });
      return;
    }
    setPhase("saving");
    try {
      await io.saveVideo({
        deck,
        slotKey: slot.key,
        lang: draft.lang,
        url: draft.url.trim(),
        title: draft.title.trim() || null,
        durationSeconds: seconds,
        revision: revisionOf(draft.lang),
      });
      setPhase("saved");
      window.setTimeout(onDone, 2000);
    } catch (e) {
      setPhase("idle");
      if (e instanceof VideoSaveError && e.code === "40001") {
        onConflict(e.message);
        return;
      }
      setError({
        field: e instanceof VideoSaveError ? e.field : null,
        text: e instanceof Error ? e.message : String(e),
      });
    }
  };
  const hint = (field: Field, text: string) => {
    const mine = error?.field === field;
    return (
      <div
        id={`${id}-${field}`}
        className={cn("text-xs", mine ? "txt-bad" : "text-muted-foreground")}
      >
        {mine ? error?.text : text}
      </div>
    );
  };
  const input =
    "w-full rounded-lg border bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary/50 aria-[invalid=true]:border-destructive";
  return (
    <div className="space-y-2.5 rounded-lg border p-2.5">
      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">Link</span>
        <input
          ref={link}
          className={input}
          dir="ltr"
          inputMode="url"
          placeholder="https://www.loom.com/share/…"
          value={draft.url}
          aria-invalid={error?.field === "link" || undefined}
          aria-describedby={`${id}-link`}
          onChange={e => set({ url: e.target.value })}
        />
        {hint(
          "link",
          "Loom, YouTube, Wistia, Vimeo or Google Drive. Mahara's own recordings only.",
        )}
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">
            Language
          </span>
          <select
            className={input}
            value={draft.lang}
            aria-invalid={error?.field === "language" || undefined}
            aria-describedby={`${id}-language`}
            onChange={e => set({ lang: e.target.value as VideoLang })}
          >
            {LANG_OPTIONS.filter(o => free.includes(o.value)).map(o => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {hint("language", "Any: it shows on both languages' decks.")}
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">
            Length
          </span>
          <input
            className={input}
            dir="ltr"
            placeholder="2:40"
            value={draft.length}
            aria-invalid={error?.field === "length" || undefined}
            aria-describedby={`${id}-length`}
            onChange={e => set({ length: e.target.value })}
          />
          {hint("length", "Optional, as m:ss.")}
        </label>
      </div>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">Title</span>
        <input
          className={input}
          dir="auto"
          maxLength={60}
          placeholder={slotTitle(slot).en}
          value={draft.title}
          aria-invalid={error?.field === "title" || undefined}
          aria-describedby={`${id}-title`}
          onChange={e => set({ title: e.target.value })}
        />
        {hint(
          "title",
          "Optional, at most 40 characters. Blank: the slot's own title, in the deck's language.",
        )}
      </label>
      {error && error.field === null ? (
        <div className="text-xs txt-bad" role="alert">
          {error.text}
        </div>
      ) : null}
      {live ? null : (
        <div className="text-xs txt-warn">
          This slot is not live on the server yet.
        </div>
      )}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={!draft.url.trim() || phase === "saving" || !live}
          onClick={() => void save()}
        >
          {phase === "saving"
            ? "Saving…"
            : phase === "saved"
              ? "Saved"
              : "Save"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * A long link cut in the middle, so both its host and its end show on one
 * line (the whole link is the row's tooltip).
 */
function middle(text: string, max = 44): string {
  if (text.length <= max) return text;
  const head = Math.ceil((max - 1) * 0.6);
  return `${text.slice(0, head)}…${text.slice(text.length - (max - 1 - head))}`;
}

/** One recorded language of a slot: its link, length, check and Clear. */
function RecordedRow({
  slot,
  row,
  io,
  deck,
  onCleared,
  onConflict,
}: {
  slot: VideoSlot;
  row: VideoRow;
  io?: DeckIO;
  deck: DeckKind;
  onCleared: (undo: () => Promise<void>) => void;
  onConflict: (message: string) => void;
}) {
  const [check, setCheck] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clear = async () => {
    if (!io?.clearVideo) {
      setError("Clearing videos needs your cockpit sign-in.");
      return;
    }
    try {
      await io.clearVideo({
        deck,
        slotKey: slot.key,
        lang: row.lang,
        revision: row.revision,
      });
      // Undo saves the same link, language, length and title again, as a
      // new revision with its own audit row (the slot is cleared now: 0).
      onCleared(async () => {
        await io.saveVideo?.({
          deck,
          slotKey: slot.key,
          lang: row.lang,
          url: row.url,
          title: row.title,
          durationSeconds: row.durationSeconds,
          revision: 0,
        });
      });
    } catch (e) {
      if (e instanceof VideoSaveError && e.code === "40001")
        onConflict(e.message);
      else setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="space-y-1.5 ps-3">
      <VideoPoster title={rowTitle(slot, row, "en")} row={row} size="prep" />
      {/* One line: the link cut in the middle, the length its own item. */}
      <div className="flex items-baseline gap-x-2 text-xs">
        <span className="w-14 shrink-0 font-medium">
          {row.lang === "any" ? "Any" : LANG_NAME[row.lang]}
        </span>
        <span
          className="min-w-0 truncate text-muted-foreground"
          title={row.url}
        >
          {middle(shortLink(row.url))}
        </span>
        {row.durationSeconds ? (
          <span className="shrink-0 tabular-nums text-muted-foreground">
            · {clock(row.durationSeconds)}
          </span>
        ) : null}
        {row.title ? (
          <span className="min-w-0 truncate text-muted-foreground">
            · "{row.title}"
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2 ps-16">
        <Button size="sm" variant="outline" onClick={() => setCheck(v => !v)}>
          <Play aria-hidden />
          {check ? "Hide the check" : "Check it plays"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void clear()}>
          Clear
        </Button>
      </div>
      {error ? <div className="text-xs txt-bad">{error}</div> : null}
      {check ? (
        <div className="ps-16">
          <CheckPlayer row={row} title={rowTitle(slot, row, "en")} />
        </div>
      ) : null}
    </div>
  );
}

function SlotRow({
  d,
  deck,
  slot,
  number,
  io,
  reread,
}: {
  d: DeckData;
  deck: DeckKind;
  slot: VideoSlot;
  number: number | null;
  io?: DeckIO;
  reread: () => Promise<void>;
}) {
  const read = d.videos.videos;
  const rows = (read?.rows ?? []).filter(
    r => r.deck === deck && r.slotKey === slot.key,
  );
  const refused = (read?.refused ?? []).filter(r => r.slotKey === slot.key);
  const live = read ? read.slots.includes(slotId(slot)) : false;
  const taken = new Set<VideoLang>(rows.map(r => r.lang));
  const free = (["any", "en", "ar"] as VideoLang[]).filter(l => !taken.has(l));
  // The deck's language when it is free, else Any.
  const first: VideoLang[] = [
    ...(free.includes(d.lang) ? [d.lang] : []),
    ...free.filter(l => l !== d.lang),
  ];
  const [open, setOpen] = useState<VideoLang | null>(
    refused[0] && free.includes(refused[0].lang) ? refused[0].lang : null,
  );
  const [note, setNote] = useState<{
    text: string;
    undo?: () => Promise<void>;
  } | null>(null);
  useEffect(() => {
    if (!note?.undo) return;
    const t = window.setTimeout(() => setNote(null), 10_000);
    return () => window.clearTimeout(t);
  }, [note]);
  const why = hiddenWhy(slot, videoMode(d));
  const conflict = (message: string) => {
    setNote({ text: message });
    void reread();
  };
  const done = () => {
    setOpen(null);
    void reread();
  };
  return (
    <li className="space-y-1.5 py-2.5">
      {/* The title wraps in its own cell; "Add a link" stays on its row. */}
      <div className="flex items-baseline gap-2">
        <div className="min-w-0 flex-1">
          <span className="text-sm font-medium">
            {number ? `${number} · ` : ""}
            {slotTitle(slot).en}
          </span>
        </div>
        {!rows.length && open == null ? (
          <Button
            size="sm"
            variant="outline"
            className="shrink-0"
            onClick={() => setOpen(first[0] ?? "any")}
          >
            Add a link
          </Button>
        ) : null}
      </div>
      {/* An empty slot is the poster card that says so (DESIGN 22.5.3). */}
      {rows.length ? null : (
        <VideoPoster title={slotTitle(slot).en} row={null} size="prep" />
      )}
      {why ? (
        <div className="text-xs text-muted-foreground">
          {why === "dwy"
            ? "Done with you: not shown for this client."
            : "Not shown until Mahara OS is approved for this client."}
        </div>
      ) : null}
      {refused.length ? (
        <div className="text-xs txt-warn">
          This video's link was refused. Save it again in prep.
        </div>
      ) : null}
      {rows.map(r => (
        <RecordedRow
          key={r.lang}
          slot={slot}
          row={r}
          io={io}
          deck={deck}
          onConflict={conflict}
          onCleared={undo => {
            setNote({ text: "Cleared.", undo });
            void reread();
          }}
        />
      ))}
      {rows.length && free.length && open == null ? (
        <button
          type="button"
          className="inline-flex items-center gap-1 ps-3 text-xs text-primary underline-offset-4 hover:underline"
          onClick={() => setOpen(first[0] ?? "any")}
        >
          <Plus aria-hidden className="size-3.5" />
          Add a link for{" "}
          {free.length === 1 ? LANG_NAME[free[0]] : "another language"}
        </button>
      ) : null}
      {note ? (
        <div className="flex items-center gap-2 text-xs" role="status">
          <span className={note.undo ? "text-muted-foreground" : "txt-warn"}>
            {note.text}
          </span>
          {note.undo ? (
            <button
              type="button"
              className="text-primary underline-offset-4 hover:underline"
              onClick={() => {
                const undo = note.undo;
                setNote(null);
                void undo?.()
                  .then(reread)
                  .catch((e: unknown) =>
                    setNote({
                      text: e instanceof Error ? e.message : String(e),
                    }),
                  );
              }}
            >
              Undo
            </button>
          ) : null}
        </div>
      ) : null}
      {open != null ? (
        <VideoForm
          key={open}
          slot={slot}
          deck={deck}
          free={first}
          initial={{ lang: open }}
          live={live}
          revisionOf={l => saveRevision({ rows, refused }, slot, l)}
          io={io}
          onDone={done}
          onConflict={conflict}
        />
      ) : null}
    </li>
  );
}

export function PrepVideos({
  model,
  deck,
  all,
  io,
}: {
  model: DeckModel;
  deck: DeckKind;
  all: SlideDef[];
  io?: DeckIO;
}) {
  const d = model.data;
  if (!d) return null;
  const reread = async () => {
    await model.reload();
    model.hub.post({ type: "videos" });
  };
  const read = d.videos;
  const slideNumber = (s: VideoSlot) => {
    const i = all.findIndex(x => x.id === s.slide);
    return i >= 0 ? i + 1 : null;
  };
  const name = DECK_NAME[deck].en.toLowerCase();
  return (
    <section className="space-y-2 border-t pt-3">
      <h3 className="text-xs font-medium text-muted-foreground">
        Videos for the {name} deck
      </h3>
      <p className="text-xs text-muted-foreground">
        Shared by every client's deck: a link saved here shows on every {name}{" "}
        deck. Mahara's own recordings only. Nothing that shows another client.
      </p>
      {!read.videos ? (
        <div className="space-y-2">
          <div className="text-xs txt-bad">
            {read.problem === VIDEOS_NOT_LIVE
              ? VIDEOS_NOT_LIVE
              : `Videos could not be read${read.problem ? `: ${read.problem.replace(/\.$/, "")}` : ""}.`}
          </div>
          <Button size="sm" variant="outline" onClick={() => void reread()}>
            Try again
          </Button>
        </div>
      ) : (
        <ul className="divide-y">
          {deckSlots(deck).map(slot => (
            <SlotRow
              key={slot.key}
              d={d}
              deck={deck}
              slot={slot}
              number={slideNumber(slot)}
              io={io}
              reread={reread}
            />
          ))}
        </ul>
      )}
      {deck === "launch" ? (
        <p className="text-xs text-muted-foreground">
          A video in their own thank-you or booking message is set on slides 2
          and 5.
        </p>
      ) : null}
    </section>
  );
}
