import {
  ArrowUpRight,
  CalendarPlus,
  Check,
  Copy,
  Loader2,
  UserRound,
} from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import {
  bookClientCheckIn,
  type ClientCallReceipt,
  type ClientContact,
  type PreparedClientCall,
  prepareClientCheckIn,
  readClientContact,
} from "@/lib/checkInClient";
import { CALLS, type CallKind, suggestedCall } from "@/lib/checkInCore";
import { Pill } from "./kit";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Input } from "./ui/input";

/**
 * Booking a client's calls straight into the Mahara Media client account in
 * GoHighLevel: the onboarding, Brand Blueprint, launch and check-in calls,
 * each on its own calendar, always for the one contact whose Client ID is
 * this ClickUp card (Aziz, 2026-10-06: "book all the types of calls, not just
 * check-in calls ... link their main contact ... so they can just do
 * everything from there").
 */

type Prepare = (args: {
  taskId: string;
  day: string;
  kind: CallKind;
}) => Promise<PreparedClientCall>;
type Book = (args: {
  taskId: string;
  contactId: string;
  startTime: string;
  kind: CallKind;
}) => Promise<ClientCallReceipt>;
type LoadContact = (args: { taskId: string }) => Promise<ClientContact>;

const today = () =>
  new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const when = (value: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuwait",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
const timeLabel = (value: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kuwait",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
const errorMessage = (e: unknown) =>
  (e as { data?: { message?: string } })?.data?.message ||
  (e instanceof Error ? e.message : "That did not work. Please try again.");
/** "Brand Blueprint Booked♠️" reads "Brand Blueprint booked" in a sentence. */
const stageWords = (stage: string) =>
  stage
    .replace(/\p{Extended_Pictographic}|\u{FE0F}/gu, "")
    .trim()
    .toLowerCase()
    .replace(/^./, c => c.toUpperCase());
/** The picker's short names, in journey order. */
const SHORT: Record<CallKind, string> = {
  onboarding: "Onboarding",
  blueprint: "Brand Blueprint",
  launch: "Launch",
  checkin: "Check-in",
};

/**
 * The booking dialog. `trigger` opens it; `kind` picks the call it opens on,
 * otherwise the one the client's stage says comes next.
 */
export function BookCallDialog({
  taskId,
  clientName,
  stage,
  kind: initialKind,
  trigger,
  prepare,
  book,
  onBooked,
  defaultOpen,
  onAutoOpenConsumed,
}: {
  taskId: string;
  clientName: string;
  stage?: string;
  kind?: CallKind;
  trigger: ReactNode;
  prepare: Prepare;
  book: Book;
  onBooked?: (
    receipt: ClientCallReceipt,
    kind: CallKind,
  ) => void | Promise<void>;
  /** Open on arrival, when the search box's "Book a call" brought you here. */
  defaultOpen?: boolean;
  onAutoOpenConsumed?: () => void;
}) {
  const suggested = suggestedCall(stage);
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const [kind, setKind] = useState<CallKind>(initialKind ?? suggested);
  const [day, setDay] = useState(today);
  const [prepared, setPrepared] = useState<PreparedClientCall | null>(null);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<ClientCallReceipt | null>(null);
  const [refresh, setRefresh] = useState(0);
  const submitting = useRef(false);
  const call = CALLS[kind];

  useEffect(() => {
    if (!defaultOpen) return;
    setOpen(true);
    setReceipt(null);
    setKind(initialKind ?? suggested);
    onAutoOpenConsumed?.();
  }, [defaultOpen, onAutoOpenConsumed, initialKind, suggested]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh intentionally reloads availability after a provider error
  useEffect(() => {
    if (!open || !day || receipt) return;
    let current = true;
    setLoading(true);
    setPrepared(null);
    setSelected("");
    setError("");
    void prepare({ taskId, day, kind })
      .then(result => {
        if (current) setPrepared(result);
      })
      .catch(e => {
        if (current) setError(errorMessage(e));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [open, day, kind, taskId, prepare, receipt, refresh]);

  async function confirm() {
    if (!prepared || !selected || submitting.current || loading) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      const booked = await book({
        taskId,
        contactId: prepared.contact.id,
        startTime: selected,
        kind,
      });
      setReceipt(booked);
      await onBooked?.(booked, kind);
      toast.success(`${call.label} booked`);
    } catch (e) {
      setError(errorMessage(e));
      setSelected("");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={value => {
        if (!submitting.current) {
          if (value) {
            setReceipt(null);
            setKind(initialKind ?? suggested);
          }
          setOpen(value);
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"
        showCloseButton={!busy}
      >
        <DialogHeader>
          <DialogTitle>
            {receipt ? `${call.label} booked` : "Book a call"}
          </DialogTitle>
          <DialogDescription>{clientName}</DialogDescription>
        </DialogHeader>
        {receipt ? (
          <div className="space-y-4">
            <p className="text-sm">{when(receipt.startTime)} Kuwait time</p>
            <p className="text-sm text-muted-foreground">
              Saved in the Mahara Media calendar. The calendar's usual
              confirmations and reminders apply.
              {receipt.stage
                ? ` The board moves to ${stageWords(receipt.stage)}.`
                : ""}
            </p>
            <Button onClick={() => setOpen(false)}>Done</Button>
          </div>
        ) : (
          <div className="space-y-4">
            <fieldset disabled={busy} className="space-y-1.5">
              <legend className="text-sm font-medium">Which call</legend>
              <div className="flex flex-wrap gap-1">
                {(Object.keys(CALLS) as CallKind[]).map(k => (
                  <Pill
                    key={k}
                    active={kind === k}
                    onClick={() => {
                      setPrepared(null);
                      setSelected("");
                      setKind(k);
                    }}
                  >
                    {SHORT[k]}
                    {k === suggested ? (
                      <span className="ml-1.5 text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
                        Next
                      </span>
                    ) : null}
                  </Pill>
                ))}
              </div>
            </fieldset>
            <div className="space-y-1.5">
              <label
                htmlFor={`book-day-${taskId}`}
                className="text-sm font-medium"
              >
                Day
              </label>
              <Input
                id={`book-day-${taskId}`}
                type="date"
                min={today()}
                value={day}
                disabled={busy}
                onChange={e => {
                  setPrepared(null);
                  setSelected("");
                  setDay(e.target.value);
                }}
              />
              <p className="text-xs text-muted-foreground">
                All times are Kuwait time (UTC+3).
              </p>
            </div>
            {loading ? (
              <p
                role="status"
                className="flex items-center gap-2 text-sm text-muted-foreground"
              >
                <Loader2 className="size-4 motion-safe:animate-spin" />
                Finding the client and available times…
              </p>
            ) : null}
            {!loading && prepared ? (
              <>
                <div className="rounded-lg bg-muted/50 p-3 text-sm">
                  <p>
                    Booking for{" "}
                    <span className="font-medium" dir="auto">
                      {prepared.contact.name}
                    </span>
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span>
                      Matched by client ID · {prepared.calendar.minutes}-minute{" "}
                      {call.label.toLowerCase()}
                    </span>
                    <a
                      href={prepared.contact.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                    >
                      Open in HighLevel
                      <ArrowUpRight aria-hidden className="size-3.5" />
                    </a>
                  </p>
                </div>
                <fieldset disabled={busy}>
                  <legend className="mb-2 text-sm font-medium">
                    Available times
                  </legend>
                  {prepared.slots.length ? (
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                      {prepared.slots.map(slot => (
                        <Button
                          type="button"
                          key={slot}
                          size="sm"
                          variant={selected === slot ? "default" : "outline"}
                          aria-pressed={selected === slot}
                          onClick={() => setSelected(slot)}
                        >
                          {timeLabel(slot)}
                        </Button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      No available times on this day. Choose another day.
                    </p>
                  )}
                </fieldset>
                {selected ? (
                  <p className="text-sm">
                    {when(selected)} Kuwait, {prepared.calendar.minutes}{" "}
                    minutes.
                  </p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  Confirming books the call for this contact. The calendar's
                  usual confirmations and reminders apply.
                </p>
              </>
            ) : null}
            {error ? (
              <div
                role="alert"
                className="space-y-2 rounded-lg border border-destructive/30 p-3 text-sm"
              >
                <p>{error}</p>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => setRefresh(x => x + 1)}
                >
                  Refresh available times
                </Button>
              </div>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button
                disabled={!prepared || !selected || loading || busy}
                onClick={() => void confirm()}
              >
                {busy ? (
                  <Loader2 className="motion-safe:animate-spin" aria-hidden />
                ) : (
                  <CalendarPlus aria-hidden />
                )}
                {busy ? "Booking…" : `Book the ${call.label.toLowerCase()}`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The client's main contact in the client account, or why it cannot be shown. */
function useMainContact(taskId: string, load: LoadContact) {
  const [state, setState] = useState<{
    contact: ClientContact | null;
    error: string;
    loading: boolean;
  }>({ contact: null, error: "", loading: true });
  useEffect(() => {
    let current = true;
    setState({ contact: null, error: "", loading: true });
    void load({ taskId })
      .then(contact => {
        if (current) setState({ contact, error: "", loading: false });
      })
      .catch(e => {
        if (current)
          setState({ contact: null, error: errorMessage(e), loading: false });
      });
    return () => {
      current = false;
    };
  }, [taskId, load]);
  return state;
}

/** One line: who the client's contact is, and a link to them in HighLevel. */
export function MainContactLine({
  taskId,
  load,
  className,
}: {
  taskId: string;
  load: LoadContact;
  className?: string;
}) {
  const { contact, error, loading } = useMainContact(taskId, load);
  if (loading)
    return (
      <p className={`text-xs text-muted-foreground ${className ?? ""}`}>
        Finding their contact in HighLevel…
      </p>
    );
  if (!contact)
    return (
      <p className={`text-xs text-muted-foreground ${className ?? ""}`}>
        {error}
      </p>
    );
  return (
    <p
      className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-sm ${className ?? ""}`}
    >
      <UserRound aria-hidden className="size-4 text-muted-foreground" />
      <span className="font-medium" dir="auto">
        {contact.name}
      </span>
      {contact.phone ? (
        <span className="text-xs text-muted-foreground" dir="ltr">
          {contact.phone}
        </span>
      ) : null}
      <a
        href={contact.url}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-xs text-primary underline-offset-4 hover:underline"
      >
        Open in HighLevel
        <ArrowUpRight aria-hidden className="size-3.5" />
      </a>
    </p>
  );
}

type Props = {
  taskId: string;
  clientName: string;
  nextCallAt?: string;
  stage?: string;
  prepare: Prepare;
  book: Book;
  loadContact: LoadContact;
  /** Open the booking on arrival. */
  autoOpen?: boolean;
  onAutoOpenConsumed?: () => void;
  /** Anything else that belongs beside the booking button. */
  extra?: ReactNode;
};

/** The client's ID, their main contact and booking, at the top of their profile. */
export function ClientCheckInCard({
  taskId,
  clientName,
  nextCallAt,
  stage,
  prepare,
  book,
  loadContact,
  autoOpen,
  onAutoOpenConsumed,
  extra,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [lastBooked, setLastBooked] = useState<string | null>(null);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2200);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function copyId() {
    try {
      await navigator.clipboard.writeText(taskId);
      setCopied(true);
    } catch {
      toast.error(
        "Copy was unavailable. Select the client ID and copy it manually.",
      );
    }
  }
  const upcoming = [nextCallAt, lastBooked]
    .filter((s): s is string => !!s && Date.parse(s) > Date.now())
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0];
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card p-4">
      <div className="min-w-0 space-y-2">
        <div>
          <p className="text-xs text-muted-foreground">
            Client ID · ClickUp client board
          </p>
          <div className="mt-1 flex items-center gap-2">
            <code className="select-all break-all text-sm">{taskId}</code>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void copyId()}
              aria-label="Copy client ID"
            >
              {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
              <span aria-live="polite">{copied ? "Copied" : "Copy ID"}</span>
            </Button>
          </div>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">
            Main contact · Mahara Media client account
          </p>
          <MainContactLine
            taskId={taskId}
            load={loadContact}
            className="mt-1"
          />
        </div>
        {upcoming && Date.parse(upcoming) > Date.now() ? (
          <p className="text-xs text-muted-foreground">
            Next call: {when(upcoming)} Kuwait
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <BookCallDialog
          taskId={taskId}
          clientName={clientName}
          stage={stage}
          prepare={prepare}
          book={book}
          defaultOpen={autoOpen}
          onAutoOpenConsumed={onAutoOpenConsumed}
          onBooked={r => setLastBooked(r.startTime)}
          trigger={
            <Button>
              <CalendarPlus aria-hidden />
              Book a call
            </Button>
          }
        />
        {extra}
      </div>
    </div>
  );
}

export function ClientCheckIn(
  props: Pick<
    Props,
    | "taskId"
    | "clientName"
    | "nextCallAt"
    | "stage"
    | "autoOpen"
    | "onAutoOpenConsumed"
    | "extra"
  >,
) {
  const auth = useCockpitAuth();
  const prepare = useCallback<Prepare>(
    args => prepareClientCheckIn(auth.client, args),
    [auth.client],
  );
  const book = useCallback<Book>(
    args => bookClientCheckIn(auth.client, args),
    [auth.client],
  );
  const loadContact = useCallback<LoadContact>(
    args => readClientContact(auth.client, args),
    [auth.client],
  );
  return (
    <ClientCheckInCard
      key={`${auth.session?.user.id ?? "signed-out"}:${props.taskId}`}
      {...props}
      prepare={prepare}
      book={book}
      loadContact={loadContact}
    />
  );
}

/** A button that books one of this client's calls, for any screen. */
export function BookCallButton({
  taskId,
  clientName,
  stage,
  kind,
  children,
  variant,
  onBooked,
}: {
  taskId: string;
  clientName: string;
  stage?: string;
  kind?: CallKind;
  children: ReactNode;
  variant?: "default" | "outline" | "ghost";
  /** After HighLevel confirms, with its receipt (Projections records the time). */
  onBooked?: (
    receipt: ClientCallReceipt,
    kind: CallKind,
  ) => void | Promise<void>;
}) {
  const auth = useCockpitAuth();
  const prepare = useCallback<Prepare>(
    args => prepareClientCheckIn(auth.client, args),
    [auth.client],
  );
  const book = useCallback<Book>(
    args => bookClientCheckIn(auth.client, args),
    [auth.client],
  );
  return (
    <BookCallDialog
      taskId={taskId}
      clientName={clientName}
      stage={stage}
      kind={kind}
      prepare={prepare}
      book={book}
      onBooked={onBooked}
      trigger={
        <Button size="sm" variant={variant}>
          <CalendarPlus aria-hidden />
          {children}
        </Button>
      }
    />
  );
}

/** The client's main contact with its HighLevel link, for any screen. */
export function MainContact({
  taskId,
  className,
}: {
  taskId: string;
  className?: string;
}) {
  const auth = useCockpitAuth();
  const loadContact = useCallback<LoadContact>(
    args => readClientContact(auth.client, args),
    [auth.client],
  );
  return (
    <MainContactLine taskId={taskId} load={loadContact} className={className} />
  );
}
