import {
  ArrowUpRight,
  Check,
  ChevronRight,
  Copy,
  RefreshCw,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { BookCallButton, MainContact } from "@/components/ClientCheckIn";
import { Chip, Dot, ExtLink, Kicker, type Tone } from "@/components/kit";
import { PortalTasksButton } from "@/components/PortalTasks";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { shortDay } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  type FormEntry,
  type KitsPage,
  kickoffFormLink,
  type OnboardingRow,
  onboardingFormLink,
  type Step,
  stepOf,
} from "../../convex/onboardingCore";

/**
 * One client's onboarding, in the order it happens (Aziz, 2026-10-05: "the
 * kickoff form as well linked for any people in onboarding ... their call
 * recording and all of that stuff. Prior to the onboarding call, their
 * onboarding form and everything").
 *
 * Three steps around the onboarding call. The step the client is on carries
 * the teal glow and the one teal button; the others are quiet. Every link
 * comes from the ClickUp card or the Typeforms (cockpit_client_onboarding);
 * nothing is typed here, so a missing link says where it comes from.
 */

type Client = {
  name: string;
  taskId: string;
  bucket?: string;
  stage?: string;
  nextCallAt?: string;
  nextCallKind?: string;
  sheetLink?: string | null;
  taskUrl?: string | null;
};

/** Stages where the onboarding call is already on the calendar or behind them. */
const PAST_ONBOARDING_BOOKING =
  /onboarding booked|blueprint|launch booked|ready for launch|active/i;

type Reading =
  | { kind: "form"; title: string; entry: FormEntry; link?: string }
  | { kind: "text"; title: string; sub: string; text: string; link?: string };

const isUrl = (s: string) => /^https?:\/\/\S+$/i.test(s.trim());

function ago(iso: string | null | undefined, now: string): string {
  if (!iso) return "";
  const min = Math.round((Date.parse(now) - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(min)) return "";
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h} h ago` : `on ${shortDay(iso)}`;
}

const filled = (e: FormEntry | undefined) =>
  e ? `Filled ${shortDay(e.submitted_at)}` : null;

/** "-Cash collected: 500" lines as the card has them, without the dashes. */
const lines = (s: string | undefined) =>
  (s ?? "")
    .split("\n")
    .map(l => l.replace(/^\s*[-•]\s*/, "").trim())
    .filter(Boolean);

function Item({
  tone,
  label,
  status,
  children,
}: {
  tone: Tone;
  label: string;
  status?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-sm font-medium">
        <Dot tone={tone} />
        {label}
      </div>
      {status ? (
        <div className="mt-0.5 pl-3 text-xs text-muted-foreground">
          {status}
        </div>
      ) : null}
      {children ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 pl-3 text-xs">
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** Opens something inside the app: one trailing chevron. */
function Read({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
    >
      {children}
      <ChevronRight aria-hidden className="size-3.5 shrink-0" />
    </button>
  );
}

function CopyLink({ url, children }: { url: string; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(url).then(
          () => toast.success("Link copied, send it from WhatsApp"),
          () =>
            toast.error(
              "The copy did not work. Open the card and copy it there.",
            ),
        );
      }}
      className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
    >
      <Copy aria-hidden className="size-3.5 shrink-0" />
      {children}
    </button>
  );
}

function StepPanel({
  title,
  state,
  children,
}: {
  title: string;
  state: "now" | "done" | "later" | "plain";
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "min-w-0 space-y-3 rounded-xl bg-muted/40 p-4",
        state === "now" && "glow-teal bg-primary/5",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <Kicker>{title}</Kicker>
        {state === "now" ? (
          <Chip tone="accent">You are here</Chip>
        ) : state === "done" ? (
          <Chip tone="good">Done</Chip>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** The three forms in a line, for the client's row before it is opened. */
export function KitSummary({ kit }: { kit: OnboardingRow }) {
  const f = kit.forms ?? {};
  const items: [string, FormEntry | undefined][] = [
    ["Onboarding form", f.onboarding],
    ["Kickoff", f.kickoff],
    ["Blueprint", f.blueprint],
  ];
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {items.map(([label, e]) => (
        <span key={label} className="inline-flex items-center gap-1">
          {e ? (
            <Check aria-hidden className="size-3 shrink-0 txt-good" />
          ) : (
            <Dot tone="neutral" />
          )}
          {label}
          <span className="sr-only">{e ? " filled" : " not filled yet"}</span>
        </span>
      ))}
    </div>
  );
}

export function OnboardingKit({
  client,
  kit,
  page,
  error,
  refreshing,
  onRefresh,
}: {
  client: Client;
  /** undefined while loading, null when the table has no row for the card. */
  kit: OnboardingRow | null | undefined;
  page: KitsPage | null;
  error: string | null;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const [reading, setReading] = useState<Reading | null>(null);
  const track = kit ? kit.in_onboarding : client.bucket === "onboarding";
  const step: Step | null = track ? stepOf(kit ?? { forms: {} }) : null;
  const order: Step[] = ["before", "call", "after"];
  /** Past onboarding: the forms are history, nothing to chase or open. */
  const live = step === null;
  /** Booked if the card has the day, the calendar has the call, or the board is past it. */
  const onboardingBookedText = kit?.onboarding_call_on
    ? `On ${shortDay(kit.onboarding_call_on)}`
    : client.nextCallKind === "onboarding" && client.nextCallAt
      ? `On ${shortDay(client.nextCallAt)}`
      : PAST_ONBOARDING_BOOKING.test(client.stage ?? "")
        ? "Booked, by the board's stage."
        : null;
  const onboardingBooked = onboardingBookedText !== null;
  const stateOf = (s: Step) =>
    step === null
      ? "plain"
      : s === step
        ? "now"
        : order.indexOf(s) < order.indexOf(step)
          ? "done"
          : "later";

  const links = kit?.links ?? {};
  const h = kit?.handover ?? {};
  const f = kit?.forms ?? {};
  const salesCall = links.sales_call ?? links.fathom;
  const kickoffLink = links.kickoff_form ?? kickoffFormLink(client.taskId);
  const notes = h.closer_notes
    ? h.closer_notes
    : [
        h.handoff_risks ? `Handoff risks: ${h.handoff_risks}` : "",
        h.go_live ? `Go live: ${h.go_live}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");
  const payment = lines(h.billing_notes);
  const lastOk = page?.lastOk ?? null;
  const problem = error ?? page?.problem ?? page?.last?.problem ?? null;
  const files: [string, string | null | undefined][] = [
    ["Drive folder", links.drive_folder ?? links.drive],
    ["Report sheet", links.report_sheet ?? client.sheetLink],
    ["Market research", links.market_research],
    ["Client history", links.history_doc],
    ["HighLevel", links.ghl],
    ["Website", links.website],
    ["ClickUp card", links.clickup ?? client.taskUrl],
  ];
  const shownFiles = files.filter(
    (x): x is [string, string] => typeof x[1] === "string" && isUrl(x[1]),
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">
          {kit === undefined
            ? "Reading the card and the forms…"
            : lastOk
              ? `From the ClickUp card and Typeform, updated ${ago(lastOk.finished_at ?? lastOk.started_at, page?.now ?? new Date().toISOString())}`
              : "Not read yet. Refresh reads the card and the forms now."}
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={onRefresh}
          disabled={refreshing}
        >
          <RefreshCw
            aria-hidden
            className={cn(refreshing && "motion-safe:animate-spin")}
          />
          {refreshing ? "Refreshing" : "Refresh"}
        </Button>
      </div>

      {problem ? (
        <div className="callout-warn rounded-xl border px-3 py-2 text-xs">
          {problem}
        </div>
      ) : null}

      {kit === null ? (
        <div className="text-sm text-muted-foreground">
          This card has not been read yet. Refresh reads it now.
        </div>
      ) : null}

      <div className="@container">
        <div className="grid gap-3 @3xl:grid-cols-3">
          <StepPanel title="Before the call" state={stateOf("before")}>
            <Item tone="neutral" label="Their contact in HighLevel">
              <MainContact taskId={client.taskId} />
            </Item>
            <Item
              tone={f.onboarding ? "good" : live ? "neutral" : "warn"}
              label="Their onboarding form"
              status={
                filled(f.onboarding) ??
                (live ? "Not on record" : "Not filled yet")
              }
            >
              {f.onboarding ? (
                <Read
                  onClick={() =>
                    setReading({
                      kind: "form",
                      title: `${client.name}, onboarding form`,
                      entry: f.onboarding as FormEntry,
                    })
                  }
                >
                  Read their answers
                </Read>
              ) : live ? null : (
                <CopyLink url={onboardingFormLink(client.taskId)}>
                  Copy their link
                </CopyLink>
              )}
            </Item>
            <Item
              tone={salesCall ? "good" : "neutral"}
              label="Sales call"
              status={
                salesCall
                  ? h.closer
                    ? `Closed by ${h.closer}`
                    : null
                  : "No recording on the card. It comes from the closer's New Client Form."
              }
            >
              {salesCall ? (
                <ExtLink href={salesCall}>Watch the sales call</ExtLink>
              ) : null}
              {kit?.sales_transcript ? (
                <Read
                  onClick={() =>
                    setReading({
                      kind: "text",
                      title: `${client.name}, sales call`,
                      sub: "The transcript the closer put in the New Client Form.",
                      text: kit.sales_transcript ?? "",
                      link: salesCall,
                    })
                  }
                >
                  Read the transcript
                </Read>
              ) : null}
            </Item>
            <Item
              tone={
                h.contract_signed === "Signed" ||
                h.contract_status === "Signed" ||
                h.contract_status === "NA - already signed"
                  ? "good"
                  : links.contract
                    ? "warn"
                    : "neutral"
              }
              label="Contract"
              status={
                h.contract_signed ??
                h.contract_status ??
                (links.contract ? null : "No contract link on the card yet.")
              }
            >
              {links.contract ? (
                <ExtLink href={links.contract}>Open the contract</ExtLink>
              ) : null}
            </Item>
            {payment.length || h.payment_plan ? (
              <Item tone="neutral" label="Payment">
                <div className="space-y-0.5 text-muted-foreground" dir="auto">
                  {h.payment_plan && !payment.length ? (
                    <div>{h.payment_plan}</div>
                  ) : null}
                  {payment.map(l => (
                    <div key={l}>{l}</div>
                  ))}
                </div>
              </Item>
            ) : null}
            {notes ? (
              <details className="pl-3 text-xs">
                <summary className="cursor-pointer text-sm font-medium">
                  Closer's notes
                </summary>
                <div
                  className="mt-1.5 whitespace-pre-line break-words text-muted-foreground"
                  dir="auto"
                >
                  {notes}
                </div>
              </details>
            ) : null}
          </StepPanel>

          <StepPanel title="On the call" state={stateOf("call")}>
            <Item
              tone={f.kickoff ? "good" : step === "call" ? "warn" : "neutral"}
              label="Kickoff form"
              status={
                filled(f.kickoff) ??
                (live
                  ? "Not on record"
                  : f.onboarding
                    ? "Not filled yet. It opens with their onboarding answers."
                    : "Not filled yet. Their onboarding answers are not in, so it opens without them.")
              }
            >
              {f.kickoff ? (
                <Read
                  onClick={() =>
                    setReading({
                      kind: "form",
                      title: `${client.name}, kickoff form`,
                      entry: f.kickoff as FormEntry,
                    })
                  }
                >
                  Read what was filled
                </Read>
              ) : live ? null : step === "call" ? (
                <Button size="sm" asChild>
                  <a href={kickoffLink} target="_blank" rel="noreferrer">
                    Open the kickoff form
                    <ArrowUpRight aria-hidden />
                  </a>
                </Button>
              ) : (
                <ExtLink href={kickoffLink}>Open the kickoff form</ExtLink>
              )}
            </Item>
            {live ? null : (
              <Item
                tone={
                  onboardingBooked
                    ? "good"
                    : step === "before"
                      ? "warn"
                      : "neutral"
                }
                label="Onboarding call"
                status={onboardingBookedText ?? "Not booked yet."}
              >
                <BookCallButton
                  taskId={client.taskId}
                  clientName={client.name}
                  stage={client.stage}
                  kind="onboarding"
                  variant={
                    !onboardingBooked && step === "before"
                      ? "default"
                      : "outline"
                  }
                >
                  {onboardingBooked
                    ? "Book another time"
                    : "Book the onboarding call"}
                </BookCallButton>
              </Item>
            )}
            {links.onboarding_map ? (
              <Item
                tone="neutral"
                label="Their onboarding map"
                status="The page the client sees, with what is next."
              >
                <ExtLink href={links.onboarding_map}>Open the map</ExtLink>
              </Item>
            ) : null}
          </StepPanel>

          <StepPanel title="After the call" state={stateOf("after")}>
            <Item
              tone={f.kickoff?.recording ? "good" : "neutral"}
              label="Onboarding call recording"
              status={
                f.kickoff?.recording
                  ? f.kickoff.payment
                    ? `Payment on the call: ${f.kickoff.payment}`
                    : null
                  : f.kickoff
                    ? "The kickoff form went in without a recording link."
                    : live
                      ? "Not on record"
                      : "Comes with the kickoff form."
              }
            >
              {f.kickoff?.recording ? (
                <ExtLink href={f.kickoff.recording}>
                  Watch the onboarding call
                </ExtLink>
              ) : null}
            </Item>
            <Item
              tone={
                f.blueprint
                  ? "good"
                  : !live && links.blueprint_form
                    ? "warn"
                    : "neutral"
              }
              label="Brand Blueprint form"
              status={
                filled(f.blueprint) ??
                (live
                  ? "Not on record"
                  : links.blueprint_form
                    ? "Not filled yet."
                    : "Appears on the card after the kickoff form.")
              }
            >
              {f.blueprint ? (
                <Read
                  onClick={() =>
                    setReading({
                      kind: "form",
                      title: `${client.name}, Brand Blueprint`,
                      entry: f.blueprint as FormEntry,
                    })
                  }
                >
                  Read it
                </Read>
              ) : step === "after" && links.blueprint_form ? (
                <Button size="sm" asChild>
                  <a
                    href={links.blueprint_form}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open the blueprint form
                    <ArrowUpRight aria-hidden />
                  </a>
                </Button>
              ) : !live && links.blueprint_form ? (
                <ExtLink href={links.blueprint_form}>
                  Open the blueprint form
                </ExtLink>
              ) : null}
            </Item>
            {live ? null : (
              <Item tone="neutral" label="Blueprint and launch calls">
                <BookCallButton
                  taskId={client.taskId}
                  clientName={client.name}
                  stage={client.stage}
                  kind="blueprint"
                  variant="outline"
                >
                  Book the Blueprint call
                </BookCallButton>
                <BookCallButton
                  taskId={client.taskId}
                  clientName={client.name}
                  stage={client.stage}
                  kind="launch"
                  variant="outline"
                >
                  Book the launch call
                </BookCallButton>
              </Item>
            )}
            {links.brand_dna || links.offer_sheet ? (
              <Item tone="neutral" label="Brand DNA and offer">
                {links.brand_dna ? (
                  <ExtLink href={links.brand_dna}>Brand DNA</ExtLink>
                ) : null}
                {links.offer_sheet ? (
                  <ExtLink href={links.offer_sheet}>Offer cheat sheet</ExtLink>
                ) : null}
              </Item>
            ) : null}
          </StepPanel>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <BookCallButton
          taskId={client.taskId}
          clientName={client.name}
          stage={client.stage}
          variant="outline"
        >
          Book a call
        </BookCallButton>
        <PortalTasksButton taskId={client.taskId} clientName={client.name} />
      </div>

      {shownFiles.length ? (
        <div className="space-y-1.5">
          <Kicker>Files</Kicker>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
            {shownFiles.map(([label, url]) => (
              <ExtLink key={label} href={url}>
                {label}
              </ExtLink>
            ))}
          </div>
        </div>
      ) : null}

      <Sheet open={Boolean(reading)} onOpenChange={o => !o && setReading(null)}>
        <SheetContent
          side="right"
          className="w-full overflow-y-auto sm:max-w-xl"
        >
          {reading ? (
            <>
              <SheetHeader className="text-left">
                <SheetTitle className="text-lg">{reading.title}</SheetTitle>
                <SheetDescription>
                  {reading.kind === "form"
                    ? `Filled ${shortDay(reading.entry.submitted_at)}, ${reading.entry.answers.length} answers.`
                    : reading.sub}
                </SheetDescription>
              </SheetHeader>
              {reading.link ? (
                <div className="mt-4 text-sm">
                  <ExtLink href={reading.link}>Watch the call</ExtLink>
                </div>
              ) : null}
              {reading.kind === "form" ? (
                <dl className="mt-4 divide-y">
                  {reading.entry.answers.map(a => (
                    <div key={a.ref} className="py-3">
                      <dt className="text-xs text-muted-foreground">
                        {a.title}
                      </dt>
                      <dd
                        className="mt-1 whitespace-pre-line break-words text-sm"
                        dir="auto"
                      >
                        {isUrl(a.value) ? (
                          <ExtLink href={a.value} className="break-all">
                            {a.value}
                          </ExtLink>
                        ) : (
                          a.value
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <div
                  className="mt-4 whitespace-pre-line break-words text-sm leading-relaxed"
                  dir="auto"
                >
                  {reading.text}
                </div>
              )}
            </>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
