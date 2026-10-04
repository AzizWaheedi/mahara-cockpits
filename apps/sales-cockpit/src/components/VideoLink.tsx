import { ChevronDown, Loader2, Video } from "lucide-react";
import { type CSSProperties, useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router";
import { api } from "../lib/api";
import { useNow, useSetting, useTemplates } from "../lib/data";
import {
  type CallKind,
  type CreateRoom,
  errorText,
  isFinal,
  type LiveStatus,
  newRequestId,
  type Presence,
  type Provider,
  providerName,
  type RoomView,
  refusalCode,
  roomsApi,
  useLiveStatus,
} from "../lib/rooms";
import {
  AUTO_SEND_S,
  autoLeft,
  autoParts,
  callLinkLive,
  choiceLabels,
  guardOpen,
  liveSwitchOn,
  type MenuKey,
  type ProviderChoice,
  type Reach,
  type RoomsSwitches,
  readRoomsSetting,
  roomForLead,
  type Trigger,
  videoMenu,
} from "../lib/videoLink";
import { button, buttonPrimary } from "./kit";
import { Say } from "./RoomLine";

/**
 * "Send a video link" (P1), where a page offers it: the dialer after a call
 * that did not connect, and the lead page's "Video call" menu. The pieces:
 *
 * - `useRoomsSetup` reads the switches the screens need once per page;
 * - `useLeadRoom` finds this seat's open room for the lead in the shared
 *   live.status read, and keeps a room once seen until the lead changes,
 *   so an expired room still asks for its mark;
 * - `VideoPicker` is P1's picker: where the link will go, [Meet] [Zoom
 *   instead], and the room.create press with its refusal said in place;
 * - `AutoVideoStrip` is automatic mode's ten seconds with Stop;
 * - `VideoCallMenu` is C42's one menu in the lead page's header.
 */

/** 44 px on touch, over the touch rule in index.css (outside the layers). */
const TOUCH = "pointer-coarse:min-h-11!";

/** Said where "Send a video link" would be when the setting could not be read. */
export const ROOMS_UNREAD =
  "Video links could not be checked. Reload the page, or call the lead.";

export interface RoomsSetup {
  rooms: RoomsSwitches | null;
  /** The `rooms` setting could not be read (it is tried again by itself). */
  error: string | null;
  /** live.enabled: live handover is switched on. */
  liveOn: boolean;
  /** The WhatsApp gate; null while it is read. */
  guard: boolean | null;
  /** The call link template is live; null while the templates are read. */
  templateLive: boolean | null;
}

/** The `rooms`, `live` and `whatsapp_guard` settings and the call link template. */
export function useRoomsSetup(): RoomsSetup {
  const rooms = useSetting<unknown>("rooms");
  const live = useSetting<unknown>("live");
  const guard = useSetting<unknown>("whatsapp_guard");
  const templates = useTemplates();
  const parsed = readRoomsSetting(rooms.data);
  return {
    rooms: parsed,
    error: rooms.error && !rooms.data ? rooms.error : null,
    liveOn: liveSwitchOn(live.data),
    guard: guard.error ? null : guardOpen(guard.data),
    templateLive: templates.error
      ? null
      : callLinkLive(templates.data, parsed?.template_route),
  };
}

/**
 * This seat's room for the lead: the newest one live.status lists, or the
 * one a press here just made. A room stays on screen once seen, final or
 * not, until another lead takes the page (the panel reads it until it is
 * final), so an expired intro still asks for its mark.
 */
export function useLeadRoom(contactId: string | null) {
  const live = useLiveStatus(Boolean(contactId));
  const listed = roomForLead(live.data?.rooms, contactId);
  const [held, setHeld] = useState<{ contact: string; room: RoomView } | null>(
    null,
  );
  const [request, setRequest] = useState<CreateRoom | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the room's identity
  useEffect(() => {
    if (listed && contactId && held?.room.id !== listed.id)
      setHeld({ contact: contactId, room: listed });
  }, [listed?.id, contactId]);
  const mine = held && held.contact === contactId ? held.room : null;
  return {
    room: mine,
    request,
    live: live.data as LiveStatus | null,
    presence: (live.data?.me ?? null) as Presence | null,
    /** A room a press made or changed (Try Zoom, I can't let them in). */
    setRoom: (room: RoomView, ask: CreateRoom | null = null) => {
      if (!contactId) return;
      setHeld({ contact: contactId, room });
      if (ask) setRequest(ask);
    },
    /** The rep put the room away (it is over and marked). */
    clear: () => setHeld(null),
    /** The room is still running: no second one is offered. */
    open: Boolean(mine && !isFinal(mine.state)),
  };
}

// ---------------------------------------------------------------------------
// The picker
// ---------------------------------------------------------------------------

export interface VideoPickerProps {
  contactId: string;
  purpose: "fallback" | "manual";
  callKind: CallKind;
  trigger: Trigger;
  attemptId?: string | null;
  appointmentId?: string | null;
  choice: ProviderChoice;
  /** "The lead gets the link on WhatsApp." or null when it cannot be said yet. */
  planLine: string | null;
  onRoom: (room: RoomView, ask: CreateRoom) => void;
  onCancel?: () => void;
  /** A failure to say at once (automatic mode's press that did not work). */
  initialError?: string | null;
  className?: string;
}

/** What room.create is asked for, from the picker's press. */
export function createAsk(
  p: Pick<
    VideoPickerProps,
    | "contactId"
    | "purpose"
    | "callKind"
    | "trigger"
    | "attemptId"
    | "appointmentId"
  >,
  provider: Provider,
): CreateRoom {
  const ask: CreateRoom = {
    contact_id: p.contactId,
    provider,
    call_kind: p.callKind,
    purpose: p.purpose,
    trigger: p.trigger,
  };
  if (p.attemptId) ask.attempt_id = p.attemptId;
  if (p.appointmentId) ask.appointment_id = p.appointmentId;
  return ask;
}

/**
 * P1's picker: the line saying where the link will go, then [Meet] and
 * [Zoom instead]. A press makes the room (the same request id again if the
 * first press may have gone through); a refusal is said in place with what
 * to do next, and the picker stays so the other provider is one tap away.
 */
export function VideoPicker(props: VideoPickerProps) {
  const { choice, planLine, onRoom, onCancel, className = "" } = props;
  const [busy, setBusy] = useState<Provider | null>(null);
  const [error, setError] = useState<{
    text: string;
    code: string | null;
  } | null>(
    props.initialError ? { text: props.initialError, code: null } : null,
  );
  const labels = choiceLabels(choice);
  const busyRef = useRef(false);
  const id = useId();
  // The seat's other open room, for "You already have a room open".
  const live = useLiveStatus(true);
  const elsewhere =
    error?.code === "host_has_room"
      ? ((live.data?.rooms ?? []).find(
          r =>
            !isFinal(r.state) &&
            r.contact_id &&
            r.contact_id !== props.contactId,
        ) ?? null)
      : null;

  async function make(provider: Provider) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(provider);
    setError(null);
    const ask = createAsk(props, provider);
    try {
      const out = await roomsApi.create(ask);
      onRoom(out.room, ask);
    } catch (e) {
      setError({ text: errorText(e), code: refusalCode(e) });
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  }

  return (
    <section
      aria-labelledby={id}
      className={`rounded-[var(--radius-md)] border hairline p-3 ${className}`}
    >
      <p id={id} className="text-sm font-medium">
        Send a video link
      </p>
      {planLine ? (
        <p className="muted mt-0.5 text-[13px] leading-5">{planLine}</p>
      ) : null}
      {choice.note ? (
        <p className="muted mt-0.5 text-[13px] leading-5">{choice.note}</p>
      ) : null}
      <div className="mt-2.5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void make(choice.first)}
          disabled={busy !== null}
          aria-busy={busy === choice.first}
          className={`${buttonPrimary} h-9 ${TOUCH}`}
        >
          {busy === choice.first ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <Video className="size-3.5" aria-hidden />
          )}
          {busy === choice.first
            ? `Making your ${providerName(choice.first)} room...`
            : labels.first}
        </button>
        {choice.other && labels.other ? (
          <button
            type="button"
            onClick={() => void make(choice.other as Provider)}
            disabled={busy !== null}
            aria-busy={busy === choice.other}
            className={`${button} h-9 ${TOUCH}`}
          >
            {busy === choice.other ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : null}
            {busy === choice.other
              ? `Making your ${providerName(choice.other)} room...`
              : labels.other}
          </button>
        ) : null}
        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            disabled={busy !== null}
            className={`muted inline-flex items-center px-1 text-sm underline-offset-2 hover:underline ${TOUCH}`}
          >
            Not now
          </button>
        ) : null}
      </div>
      {error ? (
        <p
          role="alert"
          className="callout-bad mt-2.5 rounded-[var(--radius-md)] border px-3 py-2 text-sm [overflow-wrap:anywhere]"
        >
          {error.text}
          {error.code === "host_has_room" ? (
            elsewhere?.contact_id ? (
              <>
                {" "}
                <Link
                  to={`/lead/${elsewhere.contact_id}`}
                  className={`inline-flex items-center font-medium underline underline-offset-2 ${TOUCH}`}
                >
                  Open that lead
                </Link>
              </>
            ) : (
              " Your other room is on the lead you sent it to."
            )
          ) : null}
        </p>
      ) : null}
    </section>
  );
}

/** The quiet "Send a video link" button that opens the picker. */
export function VideoLinkButton({
  onPress,
  primary = false,
  className = "",
}: {
  onPress: () => void;
  primary?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      className={`${primary ? buttonPrimary : button} ${TOUCH} ${className}`}
    >
      <Video className="size-3.5" aria-hidden />
      Send a video link
    </button>
  );
}

// ---------------------------------------------------------------------------
// Automatic mode
// ---------------------------------------------------------------------------

/**
 * Automatic mode's ten seconds (`fallback.auto_on_miss`): "Sending a video
 * link to Faisal in 7 s." with Stop, a bar draining under it. At zero it
 * presses once. It takes no focus: the dialer keeps Enter on Next lead, and
 * Stop is one Tab away.
 */
export function AutoVideoStrip({
  name,
  startedAt,
  onStop,
  onSend,
  className = "",
}: {
  name: string | null;
  startedAt: number;
  onStop: () => void;
  onSend: () => void;
  className?: string;
}) {
  const now = useNow(250);
  const left = autoLeft(startedAt, now);
  const sent = useRef(false);
  const send = useRef(onSend);
  send.current = onSend;
  useEffect(() => {
    if (left > 0 || sent.current) return;
    sent.current = true;
    send.current();
  }, [left]);
  return (
    <div
      className={`relative flex min-w-0 items-center gap-2 overflow-hidden rounded-[var(--radius-md)] border hairline px-3 py-2 text-sm ${className}`}
    >
      <span
        aria-hidden
        className="drain absolute inset-x-0 bottom-0 h-0.5"
        style={
          {
            background: "var(--now)",
            "--undo-ms": `${AUTO_SEND_S * 1000}ms`,
          } as CSSProperties
        }
      />
      <span className="min-w-0 flex-1" role="status">
        <Say s={autoParts(name, left)} />
      </span>
      <button
        type="button"
        onClick={onStop}
        className={`inline-flex shrink-0 items-center px-1 text-sm font-medium underline-offset-2 hover:underline ${TOUCH}`}
      >
        Stop
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The lead page's "Video call" menu (C42)
// ---------------------------------------------------------------------------

/**
 * One "Video call" menu in the lead page's header: "Send a video link",
 * then the two live options, disabled with "Live handover is not switched
 * on yet." until live handover is on. Nothing shows when none of it can
 * be offered.
 */
export function VideoCallMenu({
  linkShown,
  liveOn,
  onPick,
}: {
  linkShown: boolean;
  liveOn: boolean;
  onPick: (key: MenuKey) => void;
}) {
  const [open, setOpen] = useState(false);
  // The menu opens towards the side with room for it, so it is never cut
  // off at the window's edge.
  const [toLeft, setToLeft] = useState(false);
  const menu = videoMenu({ linkShown, liveOn });
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  if (!menu) return null;
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={e => {
          const r = e.currentTarget.getBoundingClientRect();
          setToLeft(r.left + 288 > window.innerWidth - 16);
          setOpen(o => !o);
        }}
        className={`${button} ${TOUCH}`}
      >
        <Video className="size-3.5" aria-hidden />
        Video call
        <ChevronDown className="size-3.5" aria-hidden />
      </button>
      {open ? (
        <div
          id={id}
          className={`panel absolute z-30 mt-1 w-72 max-w-[calc(100vw-2rem)] p-1.5 shadow-lg ${toLeft ? "right-0" : "left-0"}`}
        >
          <ul className="space-y-0.5">
            {menu.items.map(item => (
              <li key={item.key}>
                <button
                  type="button"
                  disabled={item.disabled}
                  aria-describedby={item.disabled ? `${id}-note` : undefined}
                  onClick={() => {
                    setOpen(false);
                    onPick(item.key);
                  }}
                  className={`w-full rounded-[var(--radius-md)] px-2.5 py-2 text-left text-sm ${TOUCH} ${
                    item.disabled
                      ? "muted cursor-not-allowed"
                      : "hover:bg-[color:var(--secondary)]"
                  }`}
                >
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
          {menu.note ? (
            <p
              id={`${id}-note`}
              className="muted border-t hairline px-2.5 pt-2 pb-1 text-xs"
            >
              {menu.note}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A live option from the menu, once live handover is on: project 2's
 * `live.ask`, with the one-line note P2's start sheet asks for.
 */
export function LiveAskForm({
  contactId,
  kind,
  onDone,
  onCancel,
}: {
  contactId: string;
  kind: "demo_now" | "intro_now";
  onDone: (line: string) => void;
  onCancel: () => void;
}) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(newRequestId());
  const label =
    kind === "demo_now" ? "Demo now with a closer" : "Intro now with me";
  async function send() {
    if (busy || note.trim().length < 3) return;
    setBusy(true);
    setError(null);
    try {
      await api("live.ask", {
        request_id: requestId.current,
        contact_id: contactId,
        kind: kind === "demo_now" ? "demo" : "intro",
        host: kind === "demo_now" ? "closer" : "me",
        note: note.trim(),
      });
      onDone(
        kind === "demo_now"
          ? "Finding a closer. The strip at the top says when one takes it."
          : "Making your room. The strip at the top says when it is ready.",
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={e => {
        e.preventDefault();
        void send();
      }}
      className="rounded-[var(--radius-md)] border hairline p-3"
    >
      <label className="block space-y-1 text-sm">
        <span className="font-medium">{label}</span>
        <span className="muted block text-xs">
          One line for whoever takes the call: what they want, and anything to
          know.
        </span>
        <input
          value={note}
          onChange={e => setNote(e.target.value)}
          className="w-full rounded-[var(--radius-md)] border hairline bg-transparent px-2.5 py-1.5 text-sm"
          maxLength={200}
          dir="auto"
        />
      </label>
      <div className="mt-2.5 flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={busy || note.trim().length < 3}
          className={`${buttonPrimary} h-9 ${TOUCH}`}
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : null}
          {busy ? "Asking..." : label}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className={`muted inline-flex items-center px-1 text-sm underline-offset-2 hover:underline ${TOUCH}`}
        >
          Not now
        </button>
      </div>
      {error ? (
        <p
          role="alert"
          className="callout-bad mt-2.5 rounded-[var(--radius-md)] border px-3 py-2 text-sm [overflow-wrap:anywhere]"
        >
          {error}
        </p>
      ) : null}
    </form>
  );
}

/** The conversation's channels, as the picker line reads them. */
export function reachOf(
  channels:
    | {
        whatsapp?: Reach | null;
        email?: Reach | null;
      }
    | null
    | undefined,
): { whatsapp: Reach | null; email: Reach | null } {
  return {
    whatsapp: channels?.whatsapp ?? null,
    email: channels?.email ?? null,
  };
}
