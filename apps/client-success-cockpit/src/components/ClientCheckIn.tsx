import { useAction } from "convex/react";
import { CalendarPlus, Check, Copy, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { api } from "../../convex/_generated/api";
import type { prepareCheckIn } from "../../convex/checkInCore";
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

type Prepared = Awaited<ReturnType<typeof prepareCheckIn>>;
type Receipt = { appointmentId: string; startTime: string };
type Props = {
  taskId: string;
  clientName: string;
  nextCallAt?: string;
  prepare: (args: { taskId: string; day: string }) => Promise<Prepared>;
  book: (args: {
    taskId: string;
    contactId: string;
    startTime: string;
  }) => Promise<Receipt>;
};
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

export function ClientCheckInCard({
  taskId,
  clientName,
  nextCallAt,
  prepare,
  book,
}: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [day, setDay] = useState(today);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [lastBooked, setLastBooked] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const submitting = useRef(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh intentionally reloads availability after a provider error
  useEffect(() => {
    if (!open || !day || receipt) return;
    let current = true;
    setLoading(true);
    setPrepared(null);
    setSelected("");
    setError("");
    void prepare({ taskId, day })
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
  }, [open, day, taskId, prepare, receipt, refresh]);

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
      });
      setReceipt(booked);
      setLastBooked(booked.startTime);
      toast.success("Check-in call booked");
    } catch (e) {
      setError(errorMessage(e));
      setSelected("");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  const upcoming = [nextCallAt, lastBooked]
    .filter((s): s is string => !!s && Date.parse(s) > Date.now())
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0];
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card p-4">
      <div className="min-w-0">
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
        {upcoming && Date.parse(upcoming) > Date.now() ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Next call: {when(upcoming)} Kuwait
          </p>
        ) : null}
      </div>
      <Dialog
        open={open}
        onOpenChange={value => {
          if (!submitting.current) {
            if (value) setReceipt(null);
            setOpen(value);
          }
        }}
      >
        <DialogTrigger asChild>
          <Button>
            <CalendarPlus aria-hidden />
            Book next check-in
          </Button>
        </DialogTrigger>
        <DialogContent
          className="max-h-[90dvh] overflow-y-auto sm:max-w-lg"
          showCloseButton={!busy}
        >
          <DialogHeader>
            <DialogTitle>
              {receipt ? "Check-in booked" : "Book next check-in"}
            </DialogTitle>
            <DialogDescription>{clientName}</DialogDescription>
          </DialogHeader>
          {receipt ? (
            <div className="space-y-4">
              <p className="text-sm">{when(receipt.startTime)} Kuwait time</p>
              <p className="text-sm text-muted-foreground">
                Saved in the Mahara Media calendar. The calendar's usual
                confirmations and reminders apply.
              </p>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label
                  htmlFor={`check-in-day-${taskId}`}
                  className="text-sm font-medium"
                >
                  Day
                </label>
                <Input
                  id={`check-in-day-${taskId}`}
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
                  <Loader2 className="size-4 animate-spin" />
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
                    <p className="mt-1 text-xs text-muted-foreground">
                      Matched by client ID · {prepared.calendar.minutes}-minute
                      check-in
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
                    <Loader2 className="animate-spin" aria-hidden />
                  ) : (
                    <CalendarPlus aria-hidden />
                  )}
                  {busy ? "Booking…" : "Confirm booking"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function ClientCheckIn(
  props: Pick<Props, "taskId" | "clientName" | "nextCallAt">,
) {
  const prepare = useAction(api.checkIns.prepare);
  const book = useAction(api.checkIns.book);
  return (
    <ClientCheckInCard
      key={props.taskId}
      {...props}
      prepare={prepare}
      book={book}
    />
  );
}
