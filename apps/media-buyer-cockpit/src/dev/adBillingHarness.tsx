/** Development preview. Synthetic data, no provider calls, not a production route. */
import { createRoot } from "react-dom/client";
import {
  AdBillingSummary,
  type BillingPanel,
} from "../components/AdBillingWatch";
import { clientMessage } from "../../../../hermes/ad-billing-guard/core";
import "../index.css";
const now = new Date().toISOString();
const data: BillingPanel = {
  apply: false,
  finishedAt: now,
  error: null,
  roster: [
    { client: "Studio Example", clientTaskId: "demo1", enrolled: true },
    { client: "Example Construction", clientTaskId: "demo2", enrolled: true },
    { client: "New client", clientTaskId: "demo3", enrolled: false },
  ],
  bindings: [
    {
      id: "one",
      client: "Studio Example",
      clientTaskId: "demo1",
      accountId: "123456789",
      signal: "payment_grace",
      enabled: true,
      ready: true,
      checkedAt: now,
      lastGoodAt: now,
      error: null,
      deliveries: [
        {
          channel: "whatsapp",
          state: "accepted",
          error: null,
          providerId: "demo",
        },
        {
          channel: "slack",
          state: "accepted",
          error: null,
          providerId: "demo",
        },
        {
          channel: "clickup",
          commentRole: "client",
          state: "accepted",
          error: null,
          providerId: "demo",
        },
        {
          channel: "clickup",
          commentRole: "ads",
          state: "accepted",
          error: null,
          providerId: "demo",
        },
      ],
    },
    {
      id: "two",
      client: "Example Construction",
      clientTaskId: "demo2",
      accountId: "987654321",
      signal: "unsettled",
      enabled: true,
      ready: true,
      checkedAt: now,
      lastGoodAt: now,
      error: null,
      deliveries: [
        {
          channel: "whatsapp",
          state: "unknown",
          error: "Check provider history before retrying.",
          providerId: null,
        },
        {
          channel: "slack",
          state: "accepted",
          error: null,
          providerId: "demo",
        },
      ],
    },
  ],
};
createRoot(document.getElementById("root")!).render(
  <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-8">
    <header>
      <p className="text-sm font-medium text-primary">MAHARA · MEDIA BUYER</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">
        Ad billing watch
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Synthetic preview. No messages were sent.
      </p>
    </header>
    <section className="rounded-2xl border bg-card p-5 sm:p-6">
      <AdBillingSummary data={data} />
    </section>
    <section className="rounded-2xl border bg-card p-5 sm:p-6">
      <h2 className="mb-4 text-lg font-semibold">Client WhatsApp preview</h2>
      <div
        dir="rtl"
        lang="ar"
        className="whitespace-pre-line rounded-xl bg-primary/5 p-5 text-right text-base leading-8"
      >
        {clientMessage("payment_grace", "1234")?.replaceAll("*", "")}
      </div>
    </section>
  </main>,
);
