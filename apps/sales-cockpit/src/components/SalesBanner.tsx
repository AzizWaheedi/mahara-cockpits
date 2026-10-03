import { Loader2 } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { ApiError } from "../lib/apiErrors";
import { useNow } from "../lib/data";
import {
  activeFlash,
  bannerRoomAction,
  bannerRoomSentence,
  bannerSlot,
  errorText,
  type LiveStatus,
  myRoom,
  type Offer,
  offerGone,
  openHostRoom,
  type ReplyAlert,
  replySentence,
  roomMoment,
  roomsApi,
  STALE_MS,
  type StripActionKey,
  type StripFlash,
  standbyRoom,
  stripLine,
  useLiveStatus,
  withRoom,
} from "../lib/rooms";
import { AvailabilityStrip, PresenceDot, StaleNote } from "./AvailabilityStrip";
import { button, buttonPrimary } from "./kit";
import { Spoken } from "./RoomLine";

/**
 * The one banner above every page (the slot in App.tsx). It shows one
 * thing, in this order: a live lead offered to this seat, the seat's own
 * open room, a handover the setter started, a reply alert, and then the
 * seat's availability with the portal's banner. The portal's banner stays
 * mounted underneath the whole time, because it signs a person in from the
 * portal; it is only hidden while something above it shows.
 *
 * One poll feeds it (`live.status`, every 4 s, every 30 s when Away). When
 * that read is refused (live calls switched off, or no seat) the strip
 * stays out of the way and only the portal's banner can show.
 */

export type BannerAction =
  | StripActionKey
  | "open_room"
  | "open_lead"
  | "reply_open"
  | "reply_offer";

export interface SalesBannerViewProps {
  data: LiveStatus | null;
  now: number;
  flash?: StripFlash | null;
  busy?: BannerAction | null;
  /** When the last good read landed, if the reads since have failed. */
  staleSince?: number | null;
  hidden?: readonly string[];
  kept?: readonly string[];
  portal?: ReactNode;
  handover?: ReactNode;
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

export function SalesBannerView({
  data,
  now,
  flash = null,
  busy = null,
  staleSince = null,
  hidden = [],
  kept = [],
  portal = null,
  handover = null,
  replyAlert = null,
  onAction = () => undefined,
}: SalesBannerViewProps) {
  const strip = data
    ? stripLine({
        me: data.me,
        rooms: data.rooms,
        offers: data.offers,
        health: data.health,
        now,
        flash,
        hidden,
        kept,
      })
    : null;
  const room = data ? myRoom(data.rooms, now) : null;
  const slot = bannerSlot({
    strip,
    room,
    handover: Boolean(handover),
    reply: Boolean(replyAlert),
  });
  const presence = data?.me.state ?? null;
  const urgent =
    slot === "offer" ||
    (slot === "room" &&
      room !== null &&
      ["waiting_room", "opened"].includes(roomMoment(room, now)));

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
  else if (slot === "room" && room) {
    const go = bannerRoomAction(room);
    body = (
      <Row
        staleSince={staleSince}
        dot={<PresenceDot state={presence} stale={staleSince !== null} />}
        sentence={
          <Spoken
            s={bannerRoomSentence(room, now)}
            className="text-[13px] leading-5"
          />
        }
      >
        <button
          type="button"
          onClick={() => onAction(go.key)}
          disabled={busy !== null}
          aria-busy={busy === go.key}
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
  else if (slot === "reply" && replyAlert)
    body = (
      <Row
        dot={<PresenceDot state={presence} />}
        sentence={
          <Spoken
            s={replySentence(replyAlert, now)}
            className="text-[13px] leading-5"
          />
        }
      >
        {/* On a phone the row keeps one button; the lead page offers the call too. */}
        {replyAlert.closer_free ? (
          <button
            type="button"
            onClick={() => onAction("reply_offer")}
            className={`${button} ${TOUCH} max-sm:hidden`}
          >
            Offer a call now
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => onAction("reply_open")}
          className={`${buttonPrimary} ${TOUCH}`}
        >
          Open
        </button>
      </Row>
    );

  return (
    <>
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
    </>
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
  /** The setter's handover strip (project 2), while one is running. */
  handover?: ReactNode;
  /** A lead's reply waiting on an answer (project 3). */
  replyAlert?: ReplyAlert | null;
  /** "Offer a call now" on a reply alert. */
  onOfferCall?: (alert: ReplyAlert) => void;
  /** False keeps the strip off and its poll quiet (live calls switched off). */
  enabled?: boolean;
}

export function SalesBanner({
  portal,
  handover = null,
  replyAlert = null,
  onOfferCall,
  enabled = true,
}: SalesBannerProps) {
  const live = useLiveStatus(enabled);
  const data = enabled && !live.off ? live.data : null;
  // Countdowns tick each second; a switched-off strip has nothing to count.
  const now = useNow(enabled ? 1000 : 60_000);
  const navigate = useNavigate();
  const [flash, setFlash] = useState<StripFlash | null>(null);
  const [busy, setBusy] = useState<BannerAction | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [kept, setKept] = useState<string[]>([]);
  const busyRef = useRef(false);
  const answered = useRef(new Set<string>());
  const seenOffers = useRef<Offer[] | null>(null);
  const { set: setLive, reload } = live;

  // An offer that left the strip without this seat answering it: missed
  // (the seat is now Away) or closed (someone else took it).
  useEffect(() => {
    if (!data) return;
    const prev = seenOffers.current;
    seenOffers.current = data.offers;
    if (!prev) return;
    const gone = offerGone(
      prev,
      data.offers,
      data.me,
      answered.current,
      Date.now(),
    );
    if (gone) setFlash(gone);
  }, [data]);

  const shown = activeFlash(flash, data, now);
  const staleSince =
    data && live.error && live.okAt !== null && now - live.okAt > STALE_MS
      ? live.okAt
      : null;

  async function run(key: BannerAction, work: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(key);
    try {
      await work();
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
    if (out.kind === "blocked")
      setFlash({
        kind: "error",
        at: Date.now(),
        text: "Your browser blocked the new tab. Allow pop-ups for the cockpit and press again.",
      });
  }

  function onAction(key: BannerAction) {
    if (!data && key !== "reply_open" && key !== "reply_offer") return;
    const room = data ? myRoom(data.rooms, Date.now()) : null;
    const line = data
      ? stripLine({
          me: data.me,
          rooms: data.rooms,
          offers: data.offers,
          health: data.health,
          now: Date.now(),
          flash: shown,
          hidden,
          kept,
        })
      : null;
    const offer = line?.offer ?? null;
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
        answered.current.add(offer.id);
        void run(key, async () => {
          try {
            const out = await roomsApi.take(offer);
            setFlash({ kind: "taken", at: Date.now() });
            const taken = out.room;
            if (taken) setLive(prev => (prev ? withRoom(prev, taken) : prev));
          } catch (e) {
            // A clear no is the claim lost to another seat; anything else
            // may have gone through and is said as such.
            if (e instanceof ApiError && e.kind === "refused")
              setFlash({
                kind: "lost",
                at: Date.now(),
                by: null,
                text: e.message,
              });
            else throw e;
          }
        });
        return;
      case "decline":
        if (!offer) return;
        answered.current.add(offer.id);
        setHidden(h => [...h, offer.id]);
        void run(key, async () => {
          await roomsApi.decline(offer);
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
      hidden={hidden}
      kept={kept}
      portal={portal}
      handover={handover}
      replyAlert={replyAlert}
      onAction={onAction}
    />
  );
}
