import { Copy, Play, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { DeckHub, VideoPhase } from "./channel";
import type { DeckData } from "./deckData";
import { VIDEOS_NOT_LIVE, type VideoRow } from "./sources";
import { VideoPoster } from "./VideoPoster";
import {
  clock,
  LANG_NAME,
  rowTitle,
  type SlotState,
  slideVideos,
  slotId,
  slotTitle,
  type VideoSlot,
} from "./videos";

/**
 * The notes window's Video section (DESIGN 21.4): one block per slot on
 * the slide, after the talk track and before "Only you see this". Cockpit
 * UI, in English. It says what the client is seeing, and never "Playing"
 * before the provider says so.
 */

/** What the deck window last said about its player. */
export interface PlayerAt {
  slot: string;
  phase: VideoPhase;
}

/** The Zoom tip: tick on the call's first play, untick once that video closes. */
export type ZoomTip = "tick" | "untick" | null;

const WHY: Record<"dwy" | "os", string> = {
  dwy: "Done with you: not shown, because this video shows how we work done for you.",
  os: "Not shown until Mahara OS is approved for this client.",
};

/**
 * Above the notes window's sticky foot (its height, measured there): the
 * row scrolls into view clear of it, and so does each button when the
 * keyboard reaches it (focus scrolls by the focused element's own margin).
 */
const CLEAR_FOOT = {
  scrollMarginBottom: "calc(var(--notes-foot, 9rem) + 16px)",
};

function CopyLink({ url }: { url: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      style={CLEAR_FOOT}
      onClick={() => {
        void navigator.clipboard?.writeText(url).then(() => {
          setDone(true);
          window.setTimeout(() => setDone(false), 2000);
        });
      }}
    >
      <Copy aria-hidden />
      {done ? "Copied" : "Copy link"}
    </Button>
  );
}

/** The state line for a slot's recorded video, and what the CSM can do. */
function Recorded({
  slot,
  row,
  player,
  hub,
  offer,
}: {
  slot: VideoSlot;
  row: VideoRow;
  player: PlayerAt | null;
  hub: DeckHub;
  /** The other language's recording, offered by name. */
  offer?: string;
}) {
  const id = slotId(slot);
  const mine = player && player.slot === id ? player.phase : null;
  const play = () => hub.post({ type: "video", slot: id, lang: row.lang });
  const close = () => hub.post({ type: "video", slot: null });
  const open = mine === "loading" || mine === "ready" || mine === "playing";
  // Once the video opens, its Close and Copy row is brought clear of the
  // window's sticky foot (score round 3: the foot covered it).
  const controls = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) controls.current?.scrollIntoView?.({ block: "nearest" });
  }, [open]);
  const line = offer
    ? offer
    : `Recorded · ${LANG_NAME[row.lang]}${row.durationSeconds ? ` · ${clock(row.durationSeconds)}` : ""}`;
  return (
    <div className="space-y-1.5">
      <div className="text-xs text-muted-foreground">{line}</div>
      {mine === "loading" ? (
        <div className="text-sm">Opening on screen</div>
      ) : mine === "ready" ? (
        <div className="text-sm">
          On screen, not started. Click play in the deck window.
        </div>
      ) : mine === "playing" ? (
        <div className="text-sm txt-good">Playing on screen</div>
      ) : mine === "failed" ? (
        <div className="text-sm txt-warn">
          Didn't load on screen. Check the connection and press Play on screen
          again, or copy the link into the group.
        </div>
      ) : mine === "blocked" ? (
        <div className="text-sm txt-warn">
          The provider says it can't play here (its privacy or sharing setting).
          Copy the link into the group, and fix the sharing in prep.
        </div>
      ) : null}
      {open ? (
        <div className="text-xs text-muted-foreground">
          Esc, V or Close closes it; a deck key closes it too.
        </div>
      ) : null}
      <div
        ref={controls}
        className="flex flex-wrap gap-2"
        // The sticky foot's height, measured by the notes window.
        style={CLEAR_FOOT}
      >
        {open ? (
          <Button
            size="sm"
            variant="outline"
            style={CLEAR_FOOT}
            onClick={close}
          >
            <X aria-hidden />
            Close the video
          </Button>
        ) : mine === "blocked" ? null : (
          <Button size="sm" variant="outline" style={CLEAR_FOOT} onClick={play}>
            <Play aria-hidden />
            Play on screen
          </Button>
        )}
        <CopyLink url={row.url} />
      </div>
    </div>
  );
}

function SlotBlock({
  d,
  slot,
  state,
  player,
  hub,
}: {
  d: DeckData;
  slot: VideoSlot;
  state: SlotState;
  player: PlayerAt | null;
  hub: DeckHub;
}) {
  const title =
    state.kind === "filled"
      ? rowTitle(slot, state.row, "en")
      : slotTitle(slot).en;
  const deckLang = d.lang === "ar" ? "Arabic" : "English";
  return (
    <div className="space-y-1.5">
      <div className="text-sm font-medium">{title}</div>
      {state.kind === "filled" || (state.kind === "empty" && !state.other) ? (
        <VideoPoster
          title={title}
          row={state.kind === "filled" ? state.row : null}
          size="notes"
        />
      ) : null}
      {state.kind === "hidden" ? (
        <div className="text-xs text-muted-foreground">{WHY[state.why]}</div>
      ) : state.kind === "unread" ? (
        <div className="text-xs txt-bad">
          {state.reason === VIDEOS_NOT_LIVE
            ? VIDEOS_NOT_LIVE
            : `Videos could not be read${state.reason ? `: ${state.reason.replace(/\.$/, "")}` : ""}. The deck shows none.`}
        </div>
      ) : state.kind === "refused" ? (
        <div className="text-xs txt-warn">
          This video's link was refused. Save it again in prep.
        </div>
      ) : state.kind === "empty" ? (
        state.other ? (
          <Recorded
            slot={slot}
            row={state.other}
            player={player}
            hub={hub}
            offer={`Not recorded in ${deckLang} yet. The ${LANG_NAME[state.other.lang]} one:`}
          />
        ) : null
      ) : (
        <Recorded slot={slot} row={state.row} player={player} hub={hub} />
      )}
    </div>
  );
}

export function NotesVideos({
  d,
  slideId,
  player,
  hub,
  zoom,
}: {
  d: DeckData;
  slideId: string;
  player: PlayerAt | null;
  hub: DeckHub;
  zoom: ZoomTip;
}) {
  const items = slideVideos(d, slideId);
  if (!items.length) return null;
  const anyFilled = items.some(v => v.state.kind === "filled");
  return (
    <section className="space-y-3 border-t pt-3">
      <h3 className="text-xs font-medium text-muted-foreground">Video</h3>
      {/* The skip line leads (score round 2): at the window's foot it sat
          under the sticky Back/Next bar until the CSM scrolled. */}
      {anyFilled ? (
        <div className="text-xs text-muted-foreground">
          If you skip this, say the video is in your group.
        </div>
      ) : null}
      {items.map(v => (
        <SlotBlock
          key={v.slot.key}
          d={d}
          slot={v.slot}
          state={v.state}
          player={player}
          hub={hub}
        />
      ))}
      {zoom === "tick" ? (
        <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
          Zoom: while it plays, tick 'Optimize for video clip' in the share's
          More menu. Untick it after, or the slides blur.
        </div>
      ) : zoom === "untick" ? (
        <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
          Untick 'Optimize for video clip' now.
        </div>
      ) : null}
    </section>
  );
}

/** The slide's first recorded video shown for this client, for V in the notes window. */
export function firstFilled(d: DeckData, slideId: string): string | null {
  const v = slideVideos(d, slideId).find(x => x.state.kind === "filled");
  return v ? slotId(v.slot) : null;
}
