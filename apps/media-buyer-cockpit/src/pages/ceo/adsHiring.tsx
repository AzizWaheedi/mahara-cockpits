/**
 * Hiring ads on the CEO Ads tab (Aziz, 2026-10-20: "applications for hiring
 * ads"). One row per hiring campaign in the picked days: spend, the
 * applications its role's form received, and spend over those applications.
 *
 * An application carries no ad id, so the count is every application the
 * role's form got in those days, from any source. The card says so. The
 * role comes from the campaign name; a campaign whose role it cannot tell is
 * shown with its spend and no application count, never a guessed one.
 */
import { useEffect, useState } from "react";
import { count, money } from "@/components/ceo/format";
import { Na } from "@/components/ceo/Na";
import { SectionCard } from "@/components/ceo/SectionCard";
import { supabase } from "@/lib/supabase";
import type { B2bAdsPayload } from "@/types/ceo/payloads";
import { isHiringCampaign, roleOf } from "./hiringRoles";

type Win = "w7" | "w30";
type Counts = { from: string; to: string; roles: Record<string, number> };

function useApplications(from: string | null, to: string | null) {
  const [state, setState] = useState<{
    data: Counts | null;
    error: string | null;
  }>({ data: null, error: null });
  useEffect(() => {
    if (!from || !to) return;
    let live = true;
    supabase
      .rpc("cockpit_hiring_applications_window", { p_from: from, p_to: to })
      .then(({ data, error }) => {
        if (!live) return;
        if (error) setState({ data: null, error: error.message });
        else setState({ data: data as Counts, error: null });
      });
    return () => {
      live = false;
    };
  }, [from, to]);
  return state;
}

export function HiringAdsCard({
  p,
  win,
  from,
  to,
  order,
}: {
  p: B2bAdsPayload;
  win: Win;
  from: string | null;
  to: string | null;
  order?: number;
}) {
  const campaigns = p.campaigns.filter(
    c => isHiringCampaign(c.name) && c[win].spend > 0,
  );
  const apps = useApplications(
    campaigns.length ? from : null,
    campaigns.length ? to : null,
  );
  if (!campaigns.length) return null;
  return (
    <SectionCard
      kicker="Mahara's own account"
      title="Hiring ads"
      description="Not in lead-gen spend or any cost per lead. Applications are every application the role's form received in these days, from any source: an application carries no ad id."
      order={order}
    >
      {() => (
        <div className="ceo-table-scroll overflow-x-auto">
          <table className="w-full min-w-max text-xs tabular-nums">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Campaign</th>
                <th className="px-2 py-2 font-medium">Role</th>
                <th className="px-2 py-2 text-right font-medium">Spend</th>
                <th
                  className="px-2 py-2 text-right font-medium"
                  title="What Meta counts for the campaign"
                >
                  Meta results
                </th>
                <th className="px-2 py-2 text-right font-medium">
                  Applications
                </th>
                <th className="px-2 py-2 text-right font-medium">
                  $/application
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {campaigns.map(c => {
                const w = c[win];
                const role = roleOf(c.name);
                const n =
                  role && apps.data ? (apps.data.roles[role.key] ?? 0) : null;
                return (
                  <tr key={c.id}>
                    <td className="max-w-[16rem] truncate py-2 pr-3 font-medium text-foreground">
                      {c.name}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-muted-foreground">
                      {role ? (
                        role.label
                      ) : (
                        <Na hint="The campaign name does not say which role it hires for." />
                      )}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right">
                      {money(w.spend)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right">
                      {count(w.metaLeads)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right">
                      {n !== null ? (
                        count(n)
                      ) : apps.error ? (
                        <Na hint={apps.error} />
                      ) : role ? (
                        "…"
                      ) : (
                        <Na hint="No role, so no form to count." />
                      )}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-right">
                      {n ? (
                        money(w.spend / n)
                      ) : n === 0 ? (
                        <Na hint="No application in these days." />
                      ) : (
                        <Na hint="Needs an application count." />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}
