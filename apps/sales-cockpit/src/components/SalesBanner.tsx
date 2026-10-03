import { Loader2 } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useNow } from "../lib/data";
import {
  activeFlash,
  alertWhileHidden,
  bannerRoomAction,
  bannerRoomSentence,
  bannerSlot,
  DECLINE_AGAIN,
  declineFailure,
  errorText,
  forgetRequests,
  type LiveStatus,
  liveNews,
  myRoom,
  type Offer,
  offerGone,
  openHostRoom,
  primeAlerts,
  type ReplyAlert,
  readIsOld,
  readLive,
  replySentence,
  roomMoment,
  roomsApi,
  type Sentence,
  type StripActionKey,
  type StripFlash,
  type StripLine,
  scopeRequests,
  sentenceText,
  standbyRoom,
  stripLine,
  takeFailure,
  useFocusRescue,
  useLiveStatus,
  withRoom,
} from "../lib/rooms";
import { AvailabilityStrip, PresenceDot, StaleNote } from "./AvailabilityStrip";
import { button, buttonPrimary } from "./kit";
import { LiveBoundary, Spoken } from "./RoomLine";

/**
 * The one banner above every page (the slot in App.tsx). It shows one
 * thing, in this order: a live lead offered to this seat, the seat's own
 * open room, a handover the setter started, a reply alert, and then the
 * seat's availability with the portal's banner. The portal's banner stays
 * mounted underneath the whole time, because it signs a person in from the
 * portal; it is only hidden while something above it shows.
 *
 * One poll feeds it (`live.status`, every 4 s, every 30 s when Away, and
 * on in a hidden tab, so an offer reaches a closer sitting in Zoom). When
 * that read is refused (live calls switched off, or no seat) the strip
 * stays out of the way and only the portal's banner can show. With rooms on
 * and live calls off (`live_enabled: false`) the seat's own room still
 * shows, without presence or offers.
 */

export type BannerAction =
  | StripActionKey
  | "open_room"
  | "open_lead"
  | "reply_open"
  | "reply_offer"
  | "reload";

export interface SalesBannerViewProps {
  data: LiveStatus | null;
  now: number;
  flash?: StripFlash | null;
  busy?: BannerAction | null;
  /** When the last good read landed, if the reads since have failed. */
  staleSince?: number | null;
  /** No read has landed and the reads are failing (not refused). */
  readFailed?: boolean;
  hidden?: readonly string[];
  kept?: readonly string[];
  portal?: ReactNode;
  handover?: ReactNode;
  /** The handover strip has something to say; a mounted one that is idle does not take the slot. */
  handoverActive?: boolean;
  replyAlert?: ReplyAlert | null;
  onAction?: (key: BannerAction) => void;
}

const TOUCH = "h-8 pointer-coarse:h-11 shrink-0 whitespace-nowrap";

const STRIP_KEYS: ReadonlySet<string> = new Set([
  "available",
  "away",
  "join",
  "take",
  "decline",
  "keep",
  "stop",
]);

function stripKey(key: BannerAction | null): StripActionKey | null {
  return key && STRIP_KEYS.has(key) ? (key as StripActionKey) : null;
}

/** Presence lines that say only how the seat stands: not announced. */
const IDLE = new Set(["away", "available", "ready", "on_call", "making"]);

/** What the banner says to a screen reader, and how urgently. */
function spokenOf(
  slot: string | null,
  strip: StripLine | null,
  room: Sentence | null,
  reply: Sentence | null,
): { text: string; assertive: boolean } {
  if ((slot === "offer" || slot === "presence") && strip) {
    if (slot === "presence" && IDLE.has(strip.moment))
      return { text: "", assertive: false };
    const text = [sentenceText(strip.sentence, true), strip.note ?? ""]
      .filter(Boolean)
      .join(" ");
    return { text, assertive: strip.moment === "offer" };
  }
  if (slot === "room" && room)
    return { text: sentenceText(room, true), assertive: false };
  if (slot === "reply" && reply)
    return { text: sentenceText(reply, true), assertive: false };
  return { text: "", assertive: false };
}

export function SalesBannerView({
  data: raw,
  now,
  flash = null,
  busy = null,
  staleSince = null,
  readFailed = false,
  hidden = [],
  kept = [],
  portal = null,
  handover = null,
  handoverActive = false,
  replyAlert = null,
  onAction = () => undefined,
}: SalesBannerViewProps) {
  // Whatever came in, the banner draws a shape it can read, or nothing.
  const data = raw ? readLive(raw) : null;
  const liveOn = data?.live_enabled !== false;
  const strip =
    data && liveOn
      ? stripLine({
          me: data.me,
          rooms: data.rooms,
          offers: data.offers,
          health: data.health,
          now,
          flash,
          hidden,
          kept,
          standbyError: data.standby_error ?? null,
        })
      : null;
  const room = data ? myRoom(data.rooms, now) : null;
  const slot = bannerSlot({
    strip,
    room,
    handover: handoverActive && handover != null,
    reply: Boolean(replyAlert),
  });
  const presence = liveOn ? (data?.me.state ?? null) : null;
  const roomSentence = room ? bannerRoomSentence(room, now) : null;
  const replyWords = replyAlert ? replySentence(replyAlert, now) : null;
  const urgent =
    slot === "offer" ||
    (slot === "room" &&
      room !== null &&
      ["waiting_room", "opened"].includes(roomMoment(room, now)));
  const spoken = spokenOf(slot, strip, roomSentence, replyWords);
  const zone = useRef<HTMLDivElement>(null);
  useFocusRescue(
    zone,
    [
      slot,
      strip?.moment,
      strip?.primary?.key,
      strip?.quiet.map(a => a.key).join(","),
      busy,
    ].join("|"),
  );

  let body: ReactNode = null;
  if ((slot === "offer" || slot === "presence") && strip)
    body = (
      <AvailabilityStrip
        line={strip}
        presence={presence}
        now={now}
        busy={stripKey(busy)}
        staleSince={staleSince}
        onAction={onAction}
      />
    );
  else if (slot === "room" && room && roomSentence) {
    const go = bannerRoomAction(room);
    body = (
      <Row
        staleSince={staleSince}
        dot={<PresenceDot state={presence} stale={staleSince !== null} />}
        sentence={
          <Spoken
            s={roomSentence}
            live={false}
            className="text-[13px] leading-5"
          />
        }
      >
        <button
          type="button"
          onClick={() => onAction(go.key)}
          disabled={busy !== null}
          aria-busy={busy === go.key}
          data-key={go.key}
          className={`${go.key === "open_room" ? buttonPrimary : button} ${TOUCH}`}
        >
          {busy === go.key ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : null}
          {go.label}
        </button>
      </Row>
    );
  } else if (slot === "handover") body = handover;
  else if (slot === "reply" && replyAlert && replyWords)
    body = (
      <Row
        dot={<PresenceDot state={presence} />}
        sentence={
          <Spoken
            s={replyWords}
            live={false}
            className="text-[13px] leading-5"
          />
        }
      >
        {/* On a phone the row keeps one button; the lead page offers the call too. */}
        {replyAlert.closer_free ? (
          <button
            type="button"
            onClick={() => onAction("reply_offer")}
            data-key="reply_offer"
            className={`${button} ${TOUCH} max-sm:hidden`}
          >
            Offer a call now
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => onAction("reply_open")}
          data-key="reply_open"
          className={`${buttonPrimary} ${TOUCH}`}
        >
          Open
        </button>
      </Row>
    );
  else if (slot === null && !data && readFailed)
    // Ours: the strip could not be read at all, so it says so.
    body = (
      <Row
        dot={<PresenceDot state={null} stale />}
        sentence={<StaleNote since={null} className="text-[13px] leading-5" />}
      >
        <button
          type="button"
          onClick={() => onAction("reload")}
          data-key="reload"
          className={`${button} ${TOUCH}`}
        >
          Try again
        </button>
      </Row>
    );

  return (
    <div ref={zone} className="contents">
      {/* Always mounted, so a new offer is announced when its words arrive. */}
      <p className="sr-only" aria-live="assertive" aria-atomic>
        {spoken.assertive ? spoken.text : ""}
      </p>
      <p className="sr-only" aria-live="polite" aria-atomic>
        {spoken.assertive ? "" : spoken.text}
      </p>
      {body ? (
        <div
          role="region"
          aria-label="Live calls"
          className={`border-b hairline bg-[color:var(--card)] pt-[env(safe-area-inset-top,0px)] lg:pt-0 ${
            urgent ? "sticky top-0 z-20" : ""
          }`}
        >
          <div
            className={`mx-auto w-full max-w-[1440px] px-4 md:px-6 ${slot === "offer" && strip?.moment === "offer" ? "py-2.5" : "py-0.5"}`}
          >
            {body}
          </div>
        </div>
      ) : null}
      {/* The portal's banner signs a person in; it stays mounted. */}
      <div hidden={slot !== null && slot !== "presence"}>{portal}</div>
    </div>
  );
}

function Row({
  dot,
  sentence,
  staleSince = null,
  children,
}: {
  dot: ReactNode;
  sentence: ReactNode;
  staleSince?: number | null;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-11 min-w-0 items-center gap-3">
      {dot}
      <div className="min-w-0 flex-1 py-1">
        {sentence}
        {staleSince !== null ? <StaleNote since={staleSince} /> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The connected banner
// ---------------------------------------------------------------------------

export interface SalesBannerProps {
  /** What the slot showed before: the portal's sign-in banner. */
  portal: ReactNode;
  /** The setter's handover strip (project 2). */
  handover?: ReactNode;
  /** True while a handover is running; only then does the strip take the slot. */
  handoverActive?: boolean;
  /** A lead's reply waiting on an answer (project 3). */
  replyAlert?: ReplyAlert | null;
  /** "Offer a call now" on a reply alert. */
  onOfferCall?: (alert: ReplyAlert) => void;
  /** False keeps the strip off and its poll quiet (live calls switched off). */
  enabled?: boolean;
}

/**
 * The banner, behind its own boundary: if it ever throws while drawing,
 * the portal's banner shows instead and the rest of the cockpit carries on
 * (the slot sits above the routes' boundary). It tries again after 30 s.
 */
export function SalesBanner(props: SalesBannerProps) {
  return (
    <LiveBoundary fallback={props.portal}>
      <LiveBanner {...props} />
    </LiveBoundary>
  );
}

function LiveBanner({
  portal,
  handover = null,
  handoverActive = false,
  replyAlert = null,
  onOfferCall,
  enabled = true,
}: SalesBannerProps) {
  const live = useLiveStatus(enabled);
  const data = enabled && !live.off ? live.data : null;
  // Countdowns tick each second; a switched-off strip has nothing to count.
  const localNow = useNow(enabled ? 1000 : 60_000);
  // The server's clock, for every countdown and gate.
  const now = localNow + live.offset;
  const navigate = useNavigate();
  const [flash, setFlash] = useState<StripFlash | null>(null);
  const [busy, setBusy] = useState<BannerAction | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [kept, setKept] = useState<string[]>([]);
  const busyRef = useRef(false);
  const answered = useRef(new Set<string>());
  const seen = useRef<LiveStatus | null>(null);
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden;
  const { set: setLive, reload } = live;

  // Held request ids belong to this seat: forgotten when another signs in
  // on this tab, and when the banner goes (sign-out).
  const email = data?.me.email ?? null;
  useEffect(() => scopeRequests(email), [email]);
  useEffect(() => () => forgetRequests(), []);

  // An offer that left the strip without this seat answering it: missed
  // (the seat is now Away for it) or closed (someone else took it). And,
  // with the tab hidden, news worth calling the rep back for.
  useEffect(() => {
    if (!data) return;
    const prev = seen.current;
    seen.current = data;
    const at = Date.now() + live.offset;
    const news = liveNews(prev, data, at, hiddenRef.current);
    if (news) alertWhileHidden(news.key, news.text);
    if (!prev) return;
    const gone = offerGone(
      prev.offers,
      data.offers,
      data.me,
      answered.current,
      at,
    );
    if (gone) setFlash({ ...gone, at: Date.now() });
  }, [data, live.offset]);

  const shown = activeFlash(flash, data, localNow);
  const old = data ? readIsOld(live, localNow) : null;
  const staleSince = old?.since ?? null;
  const readFailed =
    enabled && !live.off && !data && live.failures >= 2 && live.error !== null;

  async function run(key: BannerAction, work: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(key);
    try {
      await work();
      // A press that went through answers the error an earlier one left.
      setFlash(f => (f?.kind === "error" ? null : f));
    } catch (e) {
      setFlash({ kind: "error", at: Date.now(), text: errorText(e) });
    } finally {
      busyRef.current = false;
      setBusy(null);
      reload();
    }
  }

  async function openRoom(roomId: string) {
    const out = await openHostRoom(roomId);
    // Said as the press's failure, so run() puts it on the strip.
    if (out.kind === "blocked")
      throw new Error(
        "Your browser blocked the new tab. Allow pop-ups for the cockpit and press again.",
      );
  }

  function hide(id: string) {
    setHidden(h => (h.includes(id) ? h : [...h, id]));
  }

  function onAction(key: BannerAction) {
    if (key === "reload") {
      reload();
      return;
    }
    if (!data && key !== "reply_open" && key !== "reply_offer") return;
    const at = Date.now() + live.offset;
    const room = data ? myRoom(data.rooms, at) : null;
    const line =
      data && data.live_enabled !== false
        ? stripLine({
            me: data.me,
            rooms: data.rooms,
            offers: data.offers,
            health: data.health,
            now: at,
            flash: shown,
            hidden,
            kept,
            standbyError: data.standby_error ?? null,
          })
        : null;
    const offer: Offer | null = line?.offer ?? null;
    switch (key) {
      case "open_lead":
        if (room?.contact_id) navigate(`/lead/${room.contact_id}`);
        return;
      case "reply_open":
        if (replyAlert) navigate(`/lead/${replyAlert.contact_id}`);
        return;
      case "reply_offer":
        if (replyAlert) onOfferCall?.(replyAlert);
        return;
      case "open_room":
        if (room) void run(key, () => openRoom(room.id));
        return;
      case "join": {
        const sb = data ? standbyRoom(data.rooms) : null;
        if (sb) void run(key, () => openRoom(sb.id));
        return;
      }
      case "available":
      case "keep":
      case "away":
      case "stop": {
        const state =
          key === "available" || key === "keep" ? "available" : "away";
        // The press is the gesture a browser needs before it may ask.
        if (state === "available") primeAlerts();
        const sb = data ? standbyRoom(data.rooms) : null;
        void run(key, async () => {
          const out = await roomsApi.availability(state);
          setLive(prev => (prev ? { ...prev, me: out.me } : prev));
          if (key === "keep" && sb) setKept(k => [...k, sb.id]);
          if (state === "available") setFlash(null);
        });
        return;
      }
      case "take":
        if (!offer) return;
        // Answered here: if it leaves the strip it is not news, whoever won.
        answered.current.add(offer.id);
        void run(key, async () => {
          try {
            const out = await roomsApi.take(offer);
            hide(offer.id);
            setFlash({ kind: "taken", at: Date.now() });
            const taken = out.room;
            if (taken) setLive(prev => (prev ? withRoom(prev, taken) : prev));
          } catch (e) {
            const why = takeFailure(e);
            // The offer changed under the press: read again, keep it up.
            if (why === "stale") return;
            // A clear no is the claim lost to another seat.
            if (why === "lost") {
              hide(offer.id);
              setFlash({
                kind: "lost",
                at: Date.now(),
                by: null,
                text: errorText(e),
              });
              return;
            }
            // Anything else may have gone through: the offer stays up with
            // the sentence under it, and a second press is the same request.
            throw e;
          }
        });
        return;
      case "decline":
        if (!offer) return;
        answered.current.add(offer.id);
        hide(offer.id);
        void run(key, async () => {
          try {
            await roomsApi.decline(offer);
          } catch (e) {
            if (declineFailure(e) === "gone") return;
            // Not recorded: the offer comes back, because when it ends
            // unanswered this seat would be set Away as a miss.
            answered.current.delete(offer.id);
            setHidden(h => h.filter(x => x !== offer.id));
            throw new Error(DECLINE_AGAIN);
          }
        });
        return;
    }
  }

  return (
    <SalesBannerView
      data={data}
      now={now}
      flash={shown}
      busy={busy}
      staleSince={staleSince}
      readFailed={readFailed}
      hidden={hidden}
      kept={kept}
      portal={portal}
      handover={handover}
      handoverActive={handoverActive}
      replyAlert={replyAlert}
      onAction={onAction}
    />
  );
}
