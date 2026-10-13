/** Development preview. Synthetic data, no provider calls, not a production route. */
import { type ReactNode, useState } from "react";
import { createRoot } from "react-dom/client";
import { clientMessage } from "../../../../hermes/ad-billing-guard/core";
import {
  AdBillingSummary,
  type BillingPanel,
  BillingUnavailable,
} from "../components/AdBillingWatch";
import type { StripCampaign } from "../lib/adBillingStrip";
import "../index.css";

// ?theme=light previews the light theme; dark is the default, as in the app.
if (new URLSearchParams(location.search).get("theme") !== "light")
  document.documentElement.classList.add("dark");

const NOW = Date.now();
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const accepted = (channel: string, extra = {}) => ({
  channel,
  state: "accepted",
  error: null,
  providerId: "demo",
  ...extra,
});

type B = BillingPanel["bindings"][number];
const binding = (over: Partial<B> & Pick<B, "id" | "client">): B => ({
  clientTaskId: `task-${over.id}`,
  accountId: `10${over.id.length}0000000${over.id.charCodeAt(0)}`,
  signal: "healthy",
  enabled: true,
  ready: true,
  checkedAt: ago(2),
  lastGoodAt: ago(2),
  error: null,
  deliveries: [],
  review: null,
  ...over,
});

const flagged: B[] = [
  ["a", "Studio Example", "unsettled"],
  ["b", "Example Construction", "unsettled"],
  ["c", "Villa Builders", "unsettled"],
  ["d", "شركة المثال", "unsettled"],
  ["e", "North Example", "unsettled"],
  ["f", "Harbour Homes", "unsettled"],
  ["g", "Desert Interiors", "unsettled"],
  ["h", "Gulf Fitouts", "restricted"],
  ["i", "Pearl Design", "payment_grace"],
  ["j", "Coast Kitchens", "payment_grace"],
].map(([id, client, signal]) =>
  binding({
    id,
    client,
    signal,
    review:
      signal === "restricted"
        ? null
        : { state: "pending", reason: null, decidedAt: null },
    deliveries: [
      accepted("slack", { channelLabel: "Media announcements" }),
      accepted("slack", { channelLabel: "CSM general" }),
      accepted("clickup", { commentRole: "client" }),
      accepted("clickup", { commentRole: "ads" }),
      { channel: "slack", state: "skipped", error: null, providerId: null },
    ],
  }),
);
flagged[1].deliveries.push({
  channel: "whatsapp",
  state: "unknown",
  error: "Check provider history before retrying.",
  providerId: null,
});
const healthy = ["k", "l", "m", "n", "o", "p"].map(id =>
  binding({ id, client: `Healthy client ${id.toUpperCase()}` }),
);

const roster = (missing: boolean) => [
  ...[...flagged, ...healthy].map(b => ({
    client: b.client,
    clientTaskId: b.clientTaskId,
    enrolled: true,
  })),
  ...(missing
    ? [
        {
          client: "Brillant Touch Company",
          clientTaskId: "demo-bt",
          enrolled: false,
        },
      ]
    : []),
];

// The snapshot's campaigns: three flagged accounts last spent four days ago.
// The restricted account has no campaign on the board (as Marble and more on
// 13 October), so its count opens the panel; the others turn on the filter.
const day = (back: number) =>
  new Date(NOW - back * 86_400_000).toISOString().slice(0, 10);
const ISSUE: Record<string, string> = {
  unsettled: "Ad account unsettled: an unpaid Meta balance.",
  payment_grace: "Ad account in payment grace period.",
};
const campaigns: StripCampaign[] = [...flagged, ...healthy]
  .filter(b => b.id !== "h")
  .map((b, i) => ({
    metaAccountId: b.accountId,
    dataThrough: ["a", "c", "e"].includes(b.id) ? day(4) : day(i % 2 ? 1 : 2),
    accountIssue: ISSUE[b.signal],
  }));

const busy: BillingPanel = {
  apply: true,
  finishedAt: ago(3),
  error: null,
  bindings: [...flagged, ...healthy],
  roster: roster(true),
};
const STATES: {
  title: string;
  data?: BillingPanel;
  open?: boolean;
  down?: "failed" | "refused";
}[] = [
  { title: "Folded (production today)", data: busy },
  { title: "Opened", data: busy, open: true },
  {
    title: "Only messages to review",
    data: {
      ...busy,
      bindings: [
        binding({
          id: "q",
          client: "Pearl Design",
          signal: "payment_grace",
          review: { state: "pending", reason: null, decidedAt: null },
        }),
        ...healthy,
      ],
      roster: roster(false),
    },
  },
  {
    title: "Checks overdue: the counts give way to a sentence",
    data: { ...busy, finishedAt: ago(48) },
  },
  {
    title: "The worker reported an error",
    data: { ...busy, error: "Meta source read timed out" },
    open: true,
  },
  { title: "The panel could not be read", down: "failed" },
  { title: "The seat cannot read billing", down: "refused" },
  {
    title: "Everything healthy: nothing is drawn",
    data: { ...busy, bindings: healthy, roster: roster(false) },
  },
];

function Preview({ data, initial }: { data: BillingPanel; initial: boolean }) {
  const [open, setOpen] = useState(initial);
  return (
    <AdBillingSummary
      data={data}
      now={NOW}
      campaigns={campaigns}
      open={open}
      onOpenChange={setOpen}
      onShowOnBoard={() => alert("Turns on the Payment problem filter")}
      onRefresh={() => {}}
    />
  );
}

function Frame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
        {title}
      </h2>
      {children}
      <div className="rounded-2xl border bg-card p-4 text-sm text-muted-foreground">
        The KPI tiles follow here.
      </div>
    </section>
  );
}

createRoot(document.getElementById("root")!).render(
  <main className="mx-auto max-w-[1440px] space-y-10 p-4 sm:p-8">
    <header>
      <h1 className="text-2xl font-semibold tracking-tight">Payments strip</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Synthetic preview of the ad billing watch. No messages were sent.
      </p>
    </header>
    {STATES.map(s => (
      <Frame key={s.title} title={s.title}>
        {s.down ? (
          <BillingUnavailable reason={s.down} onRefresh={() => {}} />
        ) : s.data ? (
          <Preview data={s.data} initial={Boolean(s.open)} />
        ) : null}
      </Frame>
    ))}
    <section className="rounded-2xl border bg-card p-5 sm:p-6">
      <h2 className="mb-4 text-[15px] font-semibold">
        Client WhatsApp preview
      </h2>
      <div
        dir="rtl"
        lang="ar"
        className="whitespace-pre-line rounded-xl bg-muted/40 p-5 text-right text-base leading-8"
      >
        {clientMessage("payment_grace", "1234")?.replaceAll("*", "")}
      </div>
    </section>
  </main>,
);
