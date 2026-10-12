/**
 * The client page's "Before the call" brief from stored reads, to check it at
 * phone and laptop widths without signing in. `bunx vite`, then open
 * /client-success/brief-harness.html (light: ?theme=light).
 *
 * The fixture lives in tmp/harness/briefs.json (ignored by git and Vercel):
 * an array of { row, timeline, digests, profile } per client.
 */
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { ClientBrief } from "@/components/ClientBrief";
import "@/index.css";

type Fixture = {
  row: Record<string, unknown>;
  timeline: never;
  digests: never;
  teamActors?: string[];
  profile: Record<string, unknown>;
};

function Harness({ fixtures }: { fixtures: Fixture[] }) {
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
        onOpenCalls={() => {}}
      />
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
