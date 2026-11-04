/**
 * The funnel sheet and form editor from a stored read, so they can be
 * checked at phone and laptop widths without signing in. `bun run harness`,
 * then open /funnel-harness.html (light: ?theme=light).
 *
 * The fixture lives in tmp/harness/funnel.json (ignored by git and Vercel):
 *   funnel - a cockpit-media-api funnel.read result
 *   stats  - { total, rows, hasData } as useFunnelStats returns it
 * Checking with Meta fails here on purpose: there is no session.
 *
 * ?case=page: a website campaign whose ads open Merge Studio's lead page,
 * shown as the instant form is. Its questions are the page's own form.json,
 * copied to tmp/harness/mergestudio-form.json; the live page draws in the
 * phone in its preview mode (it takes this harness's :5179 as a preview
 * origin); the page's server and its visits are made up (pageFormFake.ts).
 */
import { type ReactElement, StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { FunnelSheet } from "@/components/funnel/FunnelSheet";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import type { FunnelRead, FunnelStats } from "@/lib/funnelClient";
import { visitDays } from "@/lib/leadPageFunnel";
import type { PageFormSpec } from "@/lib/pageForm";
import { type LeadPageRead, useLeadPage } from "@/lib/pageFormClient";
import type { Range } from "@/lib/range";
import { supabase } from "@/lib/supabase";
import { ThemeProvider } from "@/lib/theme";
import "@/index.css";
import { answerWith, fakeServer } from "./pageFormFake";

type Fixture = { funnel: FunnelRead; stats: FunnelStats };

const RANGE: Range = {
  key: "7d",
  label: "Last 7 days",
  start: "2026-10-04",
  end: "2026-10-10",
};

function Demo({ fixture, lead }: { fixture: Fixture; lead?: LeadPageRead }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="p-6">
      <Button onClick={() => setOpen(true)}>Open funnel</Button>
      <FunnelSheet
        open={open}
        onOpenChange={setOpen}
        campaignName={fixture.funnel.campaignName}
        range={RANGE}
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
        lead={lead}
      />
    </div>
  );
}

const PAGE_SITE = "https://merge.projectpromos.com";
const PAGE_ADS = [
  { id: "900001", name: "AD 2" },
  { id: "900002", name: "ProjectDesign | Video | v3 | 04-10-26" },
  { id: "900003", name: "AD 1" },
];
/** Made-up numbers for the three ads; the page's own visits come from pageFormFake.ts. */
const PAGE_FIXTURE: Fixture = {
  funnel: {
    campaign: "120000000000000001",
    campaignName: "Leads_Web_Form_Merge Studio_25/10",
    destinations: [
      {
        kind: "website",
        url: `${PAGE_SITE}/`,
        pageId: null,
        ads: PAGE_ADS.map(a => ({ ...a, status: "ACTIVE", creativeId: null })),
      },
    ],
    readAt: new Date().toISOString(),
  },
  stats: {
    rows: PAGE_ADS.map((a, i) => ({
      adId: a.id,
      spend: [9.4, 7.1, 4.8][i],
      impressions: [520, 330, 170][i],
      linkClicks: [9, 5, 3][i],
      leads: [1, 1, 0][i],
    })),
    calls: [],
  },
};

function PageDemo() {
  const lead = useLeadPage([`${PAGE_SITE}/`], visitDays(RANGE));
  return <Demo fixture={PAGE_FIXTURE} lead={lead} />;
}

async function main() {
  const page =
    new URLSearchParams(window.location.search).get("case") === "page";
  let root: ReactElement;
  if (page) {
    const built = (await fetch("/tmp/harness/mergestudio-form.json").then(r =>
      r.json(),
    )) as PageFormSpec & { version: string };
    answerWith(fakeServer(built, PAGE_SITE, "Merge Studio form page"));
    // The board's list of client pages, as cockpit_page_forms_listed returns it.
    Object.assign(supabase, {
      rpc: async (name: string) =>
        name === "cockpit_page_forms_listed"
          ? {
              data: [
                {
                  slug: "mergestudio",
                  client: "mergestudio.kw",
                  title: "Merge Studio form page",
                  siteUrl: PAGE_SITE,
                },
              ],
              error: null,
            }
          : { data: null, error: { message: `${name} is not in the harness` } },
    });
    root = <PageDemo />;
  } else {
    const fixture = (await fetch("/tmp/harness/funnel.json").then(r =>
      r.json(),
    )) as Fixture;
    root = <Demo fixture={fixture} />;
  }
  // The theme provider reads its stored choice, so the switch is stored first.
  const light =
    new URLSearchParams(window.location.search).get("theme") === "light";
  window.localStorage.setItem("mahara-cockpit-theme", light ? "light" : "dark");
  createRoot(document.getElementById("root") as HTMLElement).render(
    <StrictMode>
      <ThemeProvider>
        <Toaster />
        {root}
      </ThemeProvider>
    </StrictMode>,
  );
}

void main();
