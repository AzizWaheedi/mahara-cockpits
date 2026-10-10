/**
 * The funnel sheet and form editor from a stored read, so they can be
 * checked at phone and laptop widths without signing in. `bun run harness`,
 * then open /funnel-harness.html (light: ?theme=light).
 *
 * The fixture lives in tmp/harness/funnel.json (ignored by git and Vercel):
 *   funnel - a cockpit-media-api funnel.read result
 *   stats  - { total, rows, hasData } as useFunnelStats returns it
 * Checking with Meta fails here on purpose: there is no session.
 */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { FunnelSheet } from "@/components/funnel/FunnelSheet";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import type { FunnelRead, FunnelStats } from "@/lib/funnelClient";
import { ThemeProvider } from "@/lib/theme";
import "@/index.css";

type Fixture = { funnel: FunnelRead; stats: FunnelStats };

function Demo({ fixture }: { fixture: Fixture }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="p-6">
      <Button onClick={() => setOpen(true)}>Open funnel</Button>
      <FunnelSheet
        open={open}
        onOpenChange={setOpen}
        campaignName={fixture.funnel.campaignName}
        range={{
          key: "7d",
          label: "Last 7 days",
          start: "2026-10-04",
          end: "2026-10-10",
        }}
        funnel={{
          data: fixture.funnel,
          error: null,
          loading: false,
          reload: () => {},
        }}
        stats={{
          data: fixture.stats,
          error: null,
          loading: false,
          reload: () => {},
        }}
      />
    </div>
  );
}

async function main() {
  const fixture = (await fetch("/tmp/harness/funnel.json").then(r =>
    r.json(),
  )) as Fixture;
  // The theme provider reads its stored choice, so the switch is stored first.
  const light =
    new URLSearchParams(window.location.search).get("theme") === "light";
  window.localStorage.setItem("mahara-cockpit-theme", light ? "light" : "dark");
  createRoot(document.getElementById("root") as HTMLElement).render(
    <StrictMode>
      <ThemeProvider>
        <Toaster />
        <Demo fixture={fixture} />
      </ThemeProvider>
    </StrictMode>,
  );
}

void main();
