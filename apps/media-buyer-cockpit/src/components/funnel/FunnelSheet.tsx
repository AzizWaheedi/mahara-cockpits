import "@/components/ceo/ceo.css";
import {
  ArrowUpRight,
  ClipboardList,
  Globe,
  Instagram,
  Loader2,
  MessageCircle,
  Phone,
  RefreshCw,
  Route,
  TriangleAlert,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { type FunnelStep, FunnelStrip } from "@/components/ceo/FunnelStrip";
import { count, money, relative } from "@/components/ceo/format";
import { Kicker } from "@/components/ceo/Kicker";
import { StatusChip } from "@/components/ceo/StatusChip";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  checkSwitch,
  type FunnelDestination,
  type FunnelKind,
  type FunnelRead,
  type FunnelStats,
  leftOut,
  type PageForm,
  switchForms,
  totalsFor,
  useFunnel,
  useFunnelStats,
} from "@/lib/funnelClient";
import { filteringCount, frictionSteps } from "@/lib/leadForm";
import type { Range } from "@/lib/range";
import { cn } from "@/lib/utils";
import { ChangeReview } from "./ChangeReview";
import { FormEditor } from "./FormEditor";
import { FormPreview, type FormScreen } from "./FormPreview";
import { JourneyRail } from "./JourneyRail";

const KIND: Record<
  FunnelKind,
  { name: string; icon: typeof Globe; opened: string }
> = {
  form: {
    name: "Instant form",
    icon: ClipboardList,
    opened: "Opened the form",
  },
  website: { name: "Website", icon: Globe, opened: "Clicked through" },
  whatsapp: {
    name: "WhatsApp",
    icon: MessageCircle,
    opened: "Opened the chat",
  },
  messenger: {
    name: "Messenger",
    icon: MessageCircle,
    opened: "Opened the chat",
  },
  instagram: { name: "Instagram", icon: Instagram, opened: "Clicked through" },
  call: { name: "Phone call", icon: Phone, opened: "Tapped to call" },
  unknown: {
    name: "Somewhere Meta did not say",
    icon: Route,
    opened: "Clicked",
  },
};

type Loaded = ReturnType<typeof useFunnel>;

/** One line per destination, for the campaign panel. */
function summary(d: FunnelDestination): string {
  const ads = `${d.ads.length} ad${d.ads.length === 1 ? "" : "s"}`;
  if (d.kind !== "form")
    return `${KIND[d.kind].name}${d.url ? ` · ${shortUrl(d.url)}` : ""} · ${ads}`;
  if (!d.form) return `Instant form · Meta would not show it · ${ads}`;
  const spec = d.form.spec;
  const filters = filteringCount(spec);
  const extra = frictionSteps(spec).filter(s => !/filtering/.test(s));
  return [
    `Instant form “${d.form.name}”`,
    `${spec.questions.length} question${spec.questions.length === 1 ? "" : "s"}${filters ? ` (${filters} filtering)` : ", none filtering"}`,
    ...extra,
    ads,
  ].join(" · ");
}

/**
 * The destination doing the work first: the most spend in this range, then
 * the most live ads, then the most ads. Without numbers, live ads lead.
 */
function ordered(
  list: FunnelDestination[],
  stats?: FunnelStats,
): FunnelDestination[] {
  const live = (d: FunnelDestination) =>
    d.ads.filter(a => a.status === "ACTIVE").length;
  const spend = (d: FunnelDestination) => totalsFor(stats, d.ads)?.spend ?? -1;
  return [...list].sort(
    (a, b) =>
      spend(b) - spend(a) || live(b) - live(a) || b.ads.length - a.ads.length,
  );
}

/** The window in words: "4–10 Oct", or "28 Sep – 4 Oct" across a month. */
function span(range: Range): string {
  const at = (iso: string) => new Date(`${iso}T12:00:00Z`);
  const a = at(range.start);
  const b = at(range.end);
  const month = (x: Date) =>
    x.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
  if (range.start === range.end) return `${b.getUTCDate()} ${month(b)}`;
  return month(a) === month(b)
    ? `${a.getUTCDate()}–${b.getUTCDate()} ${month(b)}`
    : `${a.getUTCDate()} ${month(a)} – ${b.getUTCDate()} ${month(b)}`;
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host.replace(/^www\./, "")}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return url;
  }
}

/**
 * Where this campaign's ads lead, in one quiet line on the campaign panel,
 * and the full funnel in a sheet: the path from seeing the ad to booking a
 * call, the form exactly as a lead sees it, and the way to change it.
 */
export function FunnelLine({
  campaignName,
  range,
}: {
  campaignName: string;
  range: Range;
}) {
  const [open, setOpen] = useState(false);
  const funnel = useFunnel(campaignName);
  // Read once here and handed to the sheet, so the line and the sheet put
  // the same destination first.
  const stats = useFunnelStats(campaignName, range);
  const d = ordered(funnel.data?.destinations ?? [], stats.data);
  return (
    <div className="ceo-root mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-3 py-2.5 text-sm sm:px-4">
      <Route className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="shrink-0 font-medium">Leads to</span>
      <span className="min-w-0 flex-1 text-xs text-muted-foreground" dir="auto">
        {funnel.loading && !funnel.data ? (
          <span className="inline-flex items-center gap-1.5">
            <Loader2 className="size-3.5 animate-spin" />
            Reading the ads from Meta…
          </span>
        ) : funnel.error && !funnel.data ? (
          <span>Could not read where the ads lead. {funnel.error}</span>
        ) : d.length === 0 ? (
          "No live ads in this campaign."
        ) : (
          d.map(summary).join("   /   ")
        )}
      </span>
      {funnel.error && !funnel.data ? (
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={funnel.reload}
        >
          Try again
        </Button>
      ) : (
        <Button
          size="sm"
          variant="teal"
          className="h-7 text-xs"
          disabled={!funnel.data}
          onClick={() => setOpen(true)}
        >
          Open funnel
        </Button>
      )}
      <FunnelSheet
        open={open}
        onOpenChange={setOpen}
        campaignName={campaignName}
        range={range}
        funnel={funnel}
        stats={stats}
      />
    </div>
  );
}

export function FunnelSheet({
  open,
  onOpenChange,
  campaignName,
  range,
  funnel,
  stats: given,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignName: string;
  range: Range;
  funnel: Loaded;
  /** Numbers already read by the campaign line, or stored ones (the dev harness). */
  stats?: ReturnType<typeof useFunnelStats>;
}) {
  const own = useFunnelStats(open && !given ? campaignName : null, range);
  const stats = given ?? own;
  const read: FunnelRead | undefined = funnel.data;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="ceo-root w-full overflow-y-auto p-0 sm:max-w-[900px]"
      >
        <header className="sticky top-0 z-10 border-b bg-background/95 px-5 py-4 pr-12 backdrop-blur">
          <Kicker>Funnel</Kicker>
          <SheetTitle
            className="mt-1 truncate text-lg font-semibold tracking-tight"
            dir="auto"
          >
            {campaignName}
          </SheetTitle>
          <SheetDescription className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span>
              Where its ads lead, read from Meta{" "}
              {read ? relative(Date.parse(read.readAt)) : "now"}. The numbers
              cover {span(range)}.
            </span>
            <button
              type="button"
              onClick={() => {
                funnel.reload();
                stats.reload();
              }}
              className="inline-flex items-center gap-1 font-medium text-foreground hover:underline"
              disabled={funnel.loading}
            >
              <RefreshCw
                className={cn("size-3", funnel.loading && "animate-spin")}
              />
              Refresh
            </button>
          </SheetDescription>
        </header>
        <div className="space-y-6 px-5 py-5">
          {funnel.error && (
            <Notice>
              Could not read where the ads lead. {funnel.error}{" "}
              <button
                type="button"
                className="font-medium underline"
                onClick={funnel.reload}
              >
                Try again
              </button>
            </Notice>
          )}
          {!read && funnel.loading && (
            <p className="text-sm text-muted-foreground">
              Reading the ads from Meta…
            </p>
          )}
          {read?.destinations.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No live ads in this campaign, so there is nothing for them to lead
              to yet.
            </p>
          )}
          {read && stats.data && (
            <LeftOut
              stats={stats.data}
              ads={read.destinations.flatMap(d => d.ads)}
            />
          )}
          {ordered(read?.destinations ?? [], stats.data).map(d => (
            <Destination
              key={`${d.kind}:${d.formId ?? d.url ?? ""}`}
              d={d}
              campaignName={campaignName}
              range={range}
              stats={stats.data}
              statsError={stats.error}
              onChanged={() => {
                funnel.reload();
                stats.reload();
              }}
            />
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** One quiet line for what the paths below cannot include. */
function LeftOut({
  stats,
  ads,
}: {
  stats: FunnelStats;
  ads: { id: string }[];
}) {
  const out = leftOut(stats, ads);
  const spent = out.spend >= 0.5 || out.leads > 0;
  const parts: string[] = [];
  if (spent)
    parts.push(
      `${money(out.spend)} of spend${out.leads ? ` and ${count(out.leads)} lead${out.leads === 1 ? "" : "s"}` : ""} came from ads that no longer run`,
    );
  if (out.calls > 0)
    parts.push(
      `${count(out.calls)} booked call${out.calls === 1 ? "" : "s"} could not be tied to one of these ads`,
    );
  if (!parts.length) return null;
  const one = spent ? !out.leads && !out.calls : out.calls === 1;
  return (
    <p className="text-xs leading-relaxed text-muted-foreground">
      In these dates, {parts.join(", and ")}. The paths below leave{" "}
      {one ? "it" : "them"} out.
    </p>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <p
      className="flex items-start gap-2 rounded-lg border border-dashed p-3 text-sm text-muted-foreground"
      role="status"
    >
      <TriangleAlert className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function Destination({
  d,
  campaignName,
  range,
  stats,
  statsError,
  onChanged,
}: {
  d: FunnelDestination;
  campaignName: string;
  range: Range;
  stats?: FunnelStats;
  statsError: string | null;
  onChanged: () => void;
}) {
  const [screen, setScreen] = useState<FormScreen>("questions");
  const [editing, setEditing] = useState(false);
  const kind = KIND[d.kind];
  const Icon = kind.icon;
  const t = totalsFor(stats, d.ads);
  // Click-through is always the lowest rate, so the bars start at the click:
  // the biggest leak they mark is then a real step of the funnel.
  const steps: FunnelStep[] = t
    ? [
        { label: kind.opened, value: t.linkClicks },
        {
          label: d.kind === "form" ? "Sent the form" : "Became a lead",
          value: t.leads,
        },
        { label: "Booked a call", value: t.booked },
        {
          label: "Showed up",
          value: t.shown,
          rateFromPrevious: t.due ? t.shown / t.due : null,
        },
      ]
    : [];
  const live = d.ads.filter(a => a.status === "ACTIVE").length;

  return (
    <section className="rounded-2xl border bg-card">
      <div className="flex flex-wrap items-start gap-3 border-b px-4 py-3.5 sm:px-5">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted">
          <Icon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <Kicker>{kind.name}</Kicker>
          <p className="mt-0.5 truncate text-[15px] font-semibold" dir="auto">
            {d.form?.name ?? (d.url ? shortUrl(d.url) : kind.name)}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {d.ads.length} ad{d.ads.length === 1 ? "" : "s"} lead here
            {d.ads.length ? `, ${live} live` : ""}
            {d.form?.leadsAllTime !== null && d.form?.leadsAllTime !== undefined
              ? ` · ${count(d.form.leadsAllTime)} leads through this form all time`
              : ""}
            {d.pageName ? ` · ${d.pageName}` : ""}
          </p>
        </div>
        {d.form && (
          <StatusChip
            tone={d.form.status === "ACTIVE" ? "good" : "neutral"}
            label={
              d.form.status === "ACTIVE"
                ? "Live form"
                : sentenceCase(d.form.status)
            }
          />
        )}
        {d.kind !== "form" && d.url && (
          <a
            href={d.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            Open the page
            <ArrowUpRight className="size-3.5" />
          </a>
        )}
      </div>

      <div className="space-y-6 px-4 py-4 sm:px-5">
        <div>
          <Kicker className="mb-3">The path, {span(range)}</Kicker>
          {t ? (
            <>
              <FunnelStrip
                steps={steps}
                rateNoun="went on"
                ariaLabel={`From the click to showing up, ${range.label}`}
                context={[
                  { label: "Spend", value: money(t.spend) },
                  { label: "Saw the ad", value: count(t.impressions) },
                  {
                    label: "Clicked",
                    value: t.impressions
                      ? `${((t.linkClicks / t.impressions) * 100).toFixed(1)}%`
                      : "No views",
                  },
                  {
                    label: "Cost per lead",
                    value: t.leads ? money(t.spend / t.leads) : "No leads",
                  },
                  {
                    label: "Cost per booking",
                    value: t.booked ? money(t.spend / t.booked) : "No bookings",
                  },
                ]}
              />
              {t.booked > 0 && (
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                  Showed up counts calls marked showed, and calls still marked
                  confirmed once their time has passed. Its rate is{" "}
                  {count(t.shown)} of the {count(t.due)} call
                  {t.due === 1 ? "" : "s"} whose time has passed
                  {t.booked > t.due
                    ? `; ${count(t.booked - t.due)} more ${t.booked - t.due === 1 ? "is" : "are"} still to come`
                    : ""}
                  .
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {statsError
                ? `The numbers did not load: ${statsError}`
                : stats
                  ? `None of these ads spent or booked a call in ${span(range)}.`
                  : "Loading the numbers…"}
            </p>
          )}
        </div>

        {d.kind === "form" && d.unreadable && <Notice>{d.unreadable}</Notice>}

        {d.form && (
          <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_300px]">
            <div className="min-w-0">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <Kicker>What a lead goes through</Kicker>
                <Button size="sm" onClick={() => setEditing(true)}>
                  Edit form
                </Button>
              </div>
              {!d.form.full && (
                <p className="mb-3 text-xs text-muted-foreground">
                  Meta did not share this form's greeting, review step and
                  thank-you screen, so they show as off.
                </p>
              )}
              <JourneyRail
                spec={d.form.spec}
                screen={screen}
                onScreen={setScreen}
              />
              {d.versions && d.versions.length > 1 && (
                <Versions
                  versions={d.versions}
                  current={d.form.id}
                  campaignName={campaignName}
                  onChanged={onChanged}
                />
              )}
            </div>
            <FormPreview
              spec={d.form.spec}
              pageName={d.pageName ?? undefined}
              screen={screen}
              onScreenChange={setScreen}
            />
          </div>
        )}

        {d.kind === "website" && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            The thank-you page and any form on it live on the site itself, so
            the cockpit cannot read them. Open the page to check the steps a
            lead takes there.
          </p>
        )}

        <div>
          <Kicker className="mb-2">The ads</Kicker>
          <ul className="flex flex-wrap gap-1.5">
            {d.ads.map(a => (
              <li
                key={a.id}
                className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs"
                dir="auto"
              >
                <span
                  aria-hidden
                  className={cn(
                    "size-1.5 rounded-full",
                    a.status === "ACTIVE"
                      ? "bg-[color:var(--mahara-teal)]"
                      : "bg-muted-foreground/40",
                  )}
                />
                {a.name}
                {a.status !== "ACTIVE" && (
                  <span className="text-muted-foreground">
                    · {sentenceCase(a.status)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {d.form && editing && (
        <FormEditor
          open={editing}
          onOpenChange={setEditing}
          campaignName={campaignName}
          form={d.form}
          pageName={d.pageName}
          adCount={d.ads.length}
          onPublished={onChanged}
        />
      )}
    </section>
  );
}

function Versions({
  versions,
  current,
  campaignName,
  onChanged,
}: {
  versions: PageForm[];
  current: string;
  campaignName: string;
  onChanged: () => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <div className="mt-6">
      <Kicker className="mb-2">Versions on the Page</Kicker>
      <ul className="divide-y rounded-xl border">
        {versions.map(v => {
          const isCurrent = v.id === current;
          const archived = v.status && v.status !== "ACTIVE";
          return (
            <li key={v.id} className="px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span
                  aria-hidden
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    isCurrent
                      ? "bg-[color:var(--mahara-teal)]"
                      : "border border-muted-foreground/50",
                  )}
                />
                <span className="min-w-0 flex-1 truncate text-sm" dir="auto">
                  {v.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {isCurrent
                    ? "These ads use it"
                    : archived
                      ? "Archived"
                      : "Not used here"}
                  {v.leadsAllTime !== null
                    ? ` · ${count(v.leadsAllTime)} leads`
                    : ""}
                </span>
                {!isCurrent && !archived && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => setPicked(picked === v.id ? null : v.id)}
                  >
                    {picked === v.id ? "Cancel" : "Use this version"}
                  </Button>
                )}
              </div>
              {picked === v.id && (
                <div className="mt-3 pl-5">
                  <ChangeReview
                    verb="Switch"
                    check={() =>
                      checkSwitch({
                        campaignName,
                        toFormId: v.id,
                        fromFormId: current,
                      })
                    }
                    apply={adIds =>
                      switchForms({
                        campaignName,
                        toFormId: v.id,
                        fromFormId: current,
                        adIds,
                      })
                    }
                    onDone={() => onChanged()}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function sentenceCase(s: string) {
  const t = s.toLowerCase().replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}
