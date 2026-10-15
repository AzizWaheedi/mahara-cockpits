/**
 * A client's page in the layout harness, to look at its Calls part: the
 * real AccountView over the stand-in campaigns in portalFixtures.ts, with
 * the call centre reads answered by callCentreHarness.ts. Since the Supabase
 * cutover the harness cannot draw /ads itself (its snapshot reads have no
 * fixtures), so this route stands in for /ads?account=. The account's own
 * numbers show their "could not be read" states here; that is the harness,
 * not the page. Open:
 *
 *   /harness.html?path=%2Fcalls%3Faccount%3DLiwan%2520Limited&calls=on_track
 *
 * Never imported by the production app.
 */
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { AccountView } from "@/components/AccountView";
import { PRESETS, type Range } from "@/lib/range";
import { portalFixtures } from "./portalFixtures";

type Row = Record<string, any>;

export function CallsHarnessPage() {
  const [params] = useSearchParams();
  const client = params.get("account") ?? "Liwan Limited";
  const snap = useMemo(() => portalFixtures()["cockpit:snapshot"] as Row, []);
  const campaigns = (snap.campaigns as Row[]).filter(
    c => String(c.clientName ?? c.accountName) === client,
  );
  const names = new Set(campaigns.map(c => c.campaignName));
  const [range, setRange] = useState<Range>(
    () => PRESETS.find(p => p.key === "30d")?.make() as Range,
  );
  return (
    <div className="mx-auto w-full max-w-6xl">
      <AccountView
        client={client}
        campaigns={campaigns}
        tree={(snap.metaTree as Row[]).filter(t => names.has(t.campaignName))}
        verdicts={snap.ads as Row[]}
        range={range}
        onRangeChange={setRange}
        selected={null}
        onSelect={() => {}}
        renderPanel={() => (
          <p className="text-sm text-muted-foreground">
            The campaign panel is not drawn in this harness.
          </p>
        )}
        onClose={() => {}}
      />
    </div>
  );
}
