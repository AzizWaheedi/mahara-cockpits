/**
 * The client page's "Ask for a review or referral" panel against an
 * in-memory stand-in of the three RPCs, to check it at phone and laptop
 * widths without signing in. `bunx vite`, then open
 * /client-success/asks-harness.html (?theme=dark, ?problem=no_workspace).
 * Every client, seat and person here is invented.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";
import { ClientAsks } from "@/components/ClientAsks";
import type { ClientAsk, ClientAsksView } from "@/lib/clientAsks";
import "@/index.css";

const q = new URLSearchParams(location.search);
if (q.get("theme") === "dark") document.documentElement.classList.add("dark");
const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const asks: ClientAsk[] = [
  {
    id: "10000000-0000-4000-8000-000000000001",
    kind: "referral",
    state: "open",
    note: "Thanks for a great month with us.",
    link: "https://docs.google.com/document/d/x/edit",
    push: true,
    pushState: "sent",
    pushResult: { devices: 2, accepted: 2 },
    pushAt: ago(30),
    askedAt: ago(30),
    askedBy: "Noura Example",
    closedAt: null,
    closedBy: null,
    events: [
      {
        at: ago(30),
        source: "cockpit",
        event: "asked",
        person: "noura@example.test",
        detail: {},
      },
      {
        at: ago(29),
        source: "push",
        event: "push",
        person: null,
        detail: { devices: 2, accepted: 2 },
      },
      {
        at: ago(26),
        source: "portal",
        event: "shown",
        person: "owner@acme.example",
        detail: { via: "push" },
      },
      {
        at: ago(26),
        source: "portal",
        event: "opened",
        person: "owner@acme.example",
        detail: { target: "whatsapp", via: "push" },
      },
      {
        at: ago(3),
        source: "portal",
        event: "shown",
        person: "partner@acme.example",
        detail: {},
      },
      {
        at: ago(3),
        source: "portal",
        event: "later",
        person: "partner@acme.example",
        detail: {},
      },
    ],
  },
];
let view: ClientAsksView = {
  taskId: "demo",
  clientName: "Acme Interiors",
  workspace: {
    locationId: "locDemo",
    name: "Acme Interiors",
    status: "Active",
  },
  problem: (q.get("problem") as ClientAsksView["problem"]) ?? null,
  links: {
    review: "https://g.page/r/x/review",
    referral: "https://docs.google.com/document/d/x/edit",
  },
  asks,
  now: new Date().toISOString(),
};
const rpc = {
  rpc: async (name: string, args: Record<string, unknown>) => {
    await new Promise(r => setTimeout(r, 300));
    if (name === "cockpit_csm_client_ask_send") {
      if (view.asks.some(a => a.kind === args.p_kind && a.state === "open"))
        return {
          data: null,
          error: {
            message:
              "A review ask is already waiting in their portal. Withdraw it to send a new one",
          },
        };
      const at = new Date().toISOString();
      view = {
        ...view,
        asks: [
          {
            id: String(args.p_request_id),
            kind: args.p_kind as ClientAsk["kind"],
            state: "open",
            note: (args.p_note as string | null) ?? null,
            link: "https://g.page/r/x/review",
            push: Boolean(args.p_push),
            pushState: args.p_push ? "waiting" : "off",
            pushResult: null,
            pushAt: null,
            askedAt: at,
            askedBy: "Noura Example",
            closedAt: null,
            closedBy: null,
            events: [
              {
                at,
                source: "cockpit",
                event: "asked",
                person: "noura@example.test",
                detail: {},
              },
            ],
          },
          ...view.asks,
        ],
      };
    }
    if (name === "cockpit_csm_client_ask_withdraw")
      view = {
        ...view,
        asks: view.asks.map(a =>
          a.id === args.p_ask_id
            ? {
                ...a,
                state: "withdrawn",
                closedAt: new Date().toISOString(),
                closedBy: "noura@example.test",
              }
            : a,
        ),
      };
    return { data: view, error: null };
  },
} as unknown as Pick<SupabaseClient, "rpc">;

const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <StrictMode>
      <main className="mx-auto max-w-4xl space-y-4 bg-background p-4 text-foreground sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          Acme Interiors
        </h1>
        <ClientAsks taskId="demo" rpc={rpc} />
      </main>
      <Toaster />
    </StrictMode>,
  );
