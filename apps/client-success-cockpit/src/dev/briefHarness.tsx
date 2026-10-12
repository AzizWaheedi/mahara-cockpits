/**
 * The client page's "Before the call" brief from stored reads, to check it at
 * phone and laptop widths without signing in. `bunx vite`, then open
 * /client-success/brief-harness.html (light: ?theme=light).
 *
 * The fixture lives in tmp/harness/briefs.json (ignored by git and Vercel):
 * an array of { row, timeline, digests, profile } per client.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ClientBrief } from "@/components/ClientBrief";
import { ClientWhatsApp } from "@/components/ClientWhatsApp";
import type { ClientWhatsAppDay } from "@/lib/clientWhatsApp";
import "@/index.css";

type Fixture = {
  row: Record<string, unknown>;
  timeline: never;
  digests: never;
  teamActors?: string[];
  profile: Record<string, unknown>;
};

/** A made-up day on WhatsApp (?wa=1), to see the card and its brief lines. */
function demoDay(clientName: string): ClientWhatsAppDay {
  const now = Date.now();
  const at = (minsAgo: number) => now - minsAgo * 60_000;
  const m = (
    id: string,
    direction: "inbound" | "outbound",
    body: string | null,
    minsAgo: number,
    kind = "text",
  ) => ({
    id,
    direction,
    body,
    kind,
    speaker: null,
    at: at(minsAgo),
    status: null,
    today: minsAgo < 300,
  });
  return {
    configured: true,
    ready: true,
    stale: false,
    syncedAt: at(6),
    note: null,
    dayStart: at(300),
    taskId: "demo",
    clientName,
    threads: [
      {
        threadId: "demo-1",
        name: "Client contact",
        isGroup: false,
        archived: false,
        awaitingUs: true,
        lastInboundAt: at(40),
        lastAt: at(40),
        today: { inbound: 2, outbound: 1 },
        messages: [
          m("a", "inbound", "Thanks for the report yesterday.", 2000),
          m("b", "outbound", "You're welcome, talk on Thursday.", 1990),
          m("c", "inbound", "صباح الخير، متى تنزل الفيديوهات الجديدة؟", 180),
          m("d", "outbound", "صباح النور، نرسلها لك اليوم إن شاء الله", 170),
          m("e", "inbound", null, 40, "audio"),
        ],
        draft: {
          ar: "أكيد، الفيديوهات جاهزة ونرسلها لك قبل الساعة ٥.",
          en: "Sure, the videos are ready and we will send them before 5.",
          why: "They asked when the new videos go live.",
          sentAt: null,
        },
        contextKey: "0123456789abcdef0123456789abcdef",
        sendSupported: true,
        replyState: null,
      },
    ],
  };
}

function Harness({ fixtures }: { fixtures: Fixture[] }) {
  const wa = new URLSearchParams(window.location.search).get("wa") === "1";
  const [i, setI] = useState(
    Number(new URLSearchParams(window.location.search).get("i") ?? 0),
  );
  const f = fixtures[i];
  useEffect(() => {
    const u = new URL(window.location.href);
    u.searchParams.set("i", String(i));
    window.history.replaceState(null, "", u);
  }, [i]);
  return (
    <main className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6 lg:p-8">
      <select
        className="rounded-md border bg-card px-2 py-1 text-sm"
        value={i}
        onChange={e => setI(Number(e.target.value))}
      >
        {fixtures.map((x, k) => (
          <option key={String(x.row.taskId)} value={k}>
            {String(x.row.name)}
          </option>
        ))}
      </select>
      <ClientBrief
        key={String(f.row.taskId)}
        client={null}
        row={f.row}
        timeline={f.timeline}
        notes={{ digests: f.digests, teamActors: f.teamActors ?? [] }}
        otherClients={fixtures.map(x => String(x.row.name))}
        profile={f.profile}
        whatsapp={wa ? demoDay(String(f.row.name)) : undefined}
        onOpenCalls={() => {}}
      />
      {wa ? (
        <ClientWhatsApp
          client={{} as SupabaseClient}
          taskId={String(f.row.taskId)}
          clientName={String(f.row.name)}
          data={demoDay(String(f.row.name))}
          error={null}
          loading={false}
          reload={() => {}}
        />
      ) : null}
    </main>
  );
}

async function main() {
  if (new URLSearchParams(window.location.search).get("theme") === "light")
    document.documentElement.classList.remove("dark");
  const fixtures = (await fetch(
    `${import.meta.env.BASE_URL}tmp/harness/briefs.json`,
  ).then(r => r.json())) as Fixture[];
  createRoot(document.getElementById("root") as HTMLElement).render(
    <StrictMode>
      <Harness fixtures={fixtures} />
    </StrictMode>,
  );
}

void main();
