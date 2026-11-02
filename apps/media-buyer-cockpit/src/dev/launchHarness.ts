import type { SupabaseClient } from "@supabase/supabase-js";
import { fixtureReadiness, launchFixture } from "./launchFixture";
/** Fictional data only. Every Launch RPC and invoke is intercepted; none fall through. */
export function installLaunchHarness(client: SupabaseClient) {
  const params = new URLSearchParams(window.location.search),
    state = params.get("fixture") ?? "all";
  const fixture = launchFixture(state);
  const imports: any[] = [];
  const holds = new Map<string, any>();
  const paused = new Set<string>();
  const notices = {
    asOf: new Date().toISOString(),
    sourceAt: new Date().toISOString(),
    tasksReady: true,
    notices: fixture.clients.flatMap(c => [
      ...(!c.readOnly && c.lane === "nothing"
        ? [
            {
              id: `client:${c.id}`,
              version: "1",
              kind: "relaunch",
              title: c.name,
              body: "Review the account and next launch.",
              href: `/clients?client=${c.id}&tab=launch`,
              clientId: c.id,
              priority: 1,
              read: false,
            },
          ]
        : []),
      ...(c.mediaTasks ?? []),
    ]),
  };
  const rpc = client.rpc.bind(client),
    invoke = client.functions.invoke.bind(client.functions);
  client.rpc = ((name: string, args: any = {}) => {
    if (
      name === "cockpit_launch_pipeline" ||
      name === "cockpit_media_clients"
    ) {
      if (state === "read-failed")
        return Promise.resolve({
          data: null,
          error: { message: "Fictional source unavailable" },
        });
      const data = args.p_clickup_id
        ? {
            ...fixture,
            clients: fixture.clients.filter(c => c.id === args.p_clickup_id),
          }
        : fixture;
      return Promise.resolve({ data, error: null });
    }
    if (name === "cockpit_client_lifecycle_action") {
      const h = holds.get(args.p_client);
      if (!h || h.revision !== args.p_revision)
        return Promise.resolve({
          error: { message: "Refresh the fictional record." },
        });
      h.revision++;
      if (args.p_action === "release") h.state = "released";
      if (args.p_action === "complete") h.state = "complete";
      if (args.p_action === "check")
        h.checks[args.p_step] = {
          note: args.p_note,
          at: new Date().toISOString(),
          confirmation: "team",
        };
      return Promise.resolve({
        data: { ok: true, lifecycle: { ...h } },
        error: null,
      });
    }
    if (name === "cockpit_launch_imports")
      return Promise.resolve({
        data: imports.filter(
          x => x.clickupId === args.p_client && x.accountId === args.p_account,
        ),
        error: null,
      });
    if (name === "cockpit_media_client_notices")
      return Promise.resolve({ data: notices, error: null });
    if (name === "cockpit_media_notices_seen") {
      for (const n of notices.notices)
        if (
          args.p_notices?.some(
            (x: any) => x.id === n.id && x.version === n.version,
          )
        )
          n.read = true;
      return Promise.resolve({ data: { ok: true }, error: null });
    }
    if (name === "cockpit_launch_action")
      return Promise.resolve({ data: { ok: true }, error: null });
    return rpc(name, args);
  }) as any;
  client.functions.invoke = ((fn: string, options: any) => {
    if (
      fn === "cockpit-media-api" &&
      options?.body?.operation?.startsWith("client.")
    ) {
      const { operation, args, apply } = options.body,
        c = fixture.clients.find(x => x.id === args.clickupId)!;
      if (!c)
        return Promise.resolve({
          data: { ok: false, error: "No fictional client" },
          error: null,
        });
      const campaign = {
        id: "222222",
        name: `${c.name} |MAHARA| approved campaign`,
        accountId: c.accounts[0]?.id ?? "111111",
        status: "ACTIVE",
        owner: { kind: "mahara" },
      };
      if (operation === "client.stopReview")
        return Promise.resolve({
          data: {
            ok: true,
            accounts: c.accounts,
            active: paused.has(c.id) ? [] : [campaign],
            unverified: [],
            errors: [],
            fingerprint: paused.has(c.id) ? "paused" : "active",
            checkedAt: new Date().toISOString(),
            lifecycle: holds.get(c.id) ?? null,
            canRelease: true,
            applyEnabled: !args.rehearse,
          },
          error: null,
        });
      if (!apply || args.rehearse)
        return Promise.resolve({
          data: {
            ok: false,
            dryRun: true,
            message: "Fictional rehearsal only",
          },
          error: null,
        });
      paused.add(c.id);
      const h = {
        mode: operation === "client.offboard" ? "offboard" : "pause",
        state: "active",
        reason: args.reason,
        checks: {},
        revision: 1,
        task_id: operation === "client.offboard" ? "demo-offboard" : null,
      };
      holds.set(c.id, h);
      return Promise.resolve({
        data: {
          ok: true,
          did:
            operation === "client.offboard"
              ? "Demo: campaigns paused and offboarding task saved. Access removal is pending."
              : "Demo: campaigns paused. Client access is unchanged.",
        },
        error: null,
      });
    }
    if (
      fn === "cockpit-media-api" &&
      options?.body?.operation?.startsWith("launch.")
    ) {
      const { operation, args } = options.body;
      const c =
        fixture.clients.find(x => x.id === args.clickupId) ??
        fixture.clients[0];
      if (!c)
        return Promise.resolve({
          data: { ok: false, error: "No fictional client" },
          error: null,
        });
      if (operation === "launch.importCreatives") {
        if (args.rehearse)
          return Promise.resolve({ data: { dryRun: true }, error: null });
        const id = "demo-import";
        imports.push({
          id,
          clickupId: args.clickupId,
          accountId: args.accountId,
          status: "ready",
          media: [{ name: "Approved interior.jpg", imageHash: "sampleimage" }],
        });
        return Promise.resolve({ data: { ok: true, id }, error: null });
      }
      if (operation === "launch.readiness" && args.availableAccounts)
        return Promise.resolve({
          data: {
            ok: true,
            applyEnabled: false,
            accounts: [
              {
                id: "888888",
                name: "Harbour new account",
                account_status: 1,
                currency: "USD",
              },
            ],
          },
          error: null,
        });
      if (operation === "launch.readiness" && args.sourceCampaignId)
        return Promise.resolve({
          data: {
            ok: true,
            adsets: [{ id: "333333", name: "Client city audience" }],
          },
          error: null,
        });
      if (operation === "launch.readiness" && args.catalog)
        return Promise.resolve({
          data: args.geoQuery
            ? {
                ok: true,
                cities: [
                  {
                    key: "12345",
                    name: "Dubai",
                    region: "Dubai",
                    country_code: "AE",
                  },
                ],
              }
            : args.pageId
              ? {
                  ok: true,
                  forms: [{ id: "555555", name: "Client enquiry form" }],
                }
              : {
                  ok: true,
                  pages: [{ id: "777777", name: "Harbour Fitout" }],
                  media: [
                    {
                      key: "sampleimage",
                      imageHash: "sampleimage",
                      name: "Client interior",
                    },
                  ],
                },
          error: null,
        });
      if (operation === "launch.readiness" && args.cardDetails)
        return Promise.resolve({
          data: {
            ok: true,
            options: {
              serviceType: [
                "Construction",
                "Architectural Design",
                "Design & Build",
                "Renovation/Fit Out",
                "Interior Design",
              ],
              priority: ["High", "Medium", "Low"],
              funnelType: ["Landing Page", "Lead Form"],
            },
            defaults: {
              serviceType: "Renovation/Fit Out",
              priority: "Medium",
              funnelType: "Lead Form",
              landingUrl: null,
              dailyAdSpendUsd: 30,
              launchDay: new Intl.DateTimeFormat("en-CA", {
                timeZone: "Asia/Kuwait",
              }).format(new Date()),
              dos: "",
            },
            sources: {
              serviceType: "Last ads card",
              priority: "Last ads card",
              funnelType: "Campaign",
              dailyAdSpendUsd: "Campaign budget",
            },
            fixed: {
              tag: c.name.toLowerCase(),
              platform: "Meta",
              metaAccountUrl: `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${args.accountId}&business_id=767701513092162`,
              crmUrl: `https://app.maharamedia.com/v2/location/${c.locationId}/dashboard`,
              cities: ["AE - Dubai"],
            },
            campaign: null,
          },
          error: null,
        });
      if (operation === "launch.readiness") {
        const ready = fixtureReadiness(c, args.accountId, state);
        // A campaign switched on in Ads Manager with no card, for Log a launch.
        const logged =
          state === "log-launch" || state === "interactive"
            ? [
                {
                  id: "919191",
                  name: `${c.name} |MAHARA| 26\\10`,
                  status: "ACTIVE",
                  owner: { kind: "mahara", name: "Mahara buyer" },
                },
              ]
            : [];
        return Promise.resolve({
          data: {
            ...ready,
            candidates: [...ready.candidates, ...logged],
            applyEnabled: state === "interactive",
          },
          error: null,
        });
      }
      if (operation === "launch.logCampaign")
        return Promise.resolve({
          data: {
            ok: false,
            dryRun: true,
            plan: {
              steps: [
                {
                  provider: "clickup",
                  path: "list/fixture/task",
                  body: {
                    name: `${c.name} |MAHARA| 26\\10`,
                    tags: [c.name.toLowerCase()],
                  },
                },
              ],
              result: { campaignName: `${c.name} |MAHARA| 26\\10` },
            },
            message: "Rehearsal. No changes will be made to Meta or ClickUp.",
          },
          error: null,
        });
      if (operation === "launch.copyIdeas")
        return Promise.resolve({
          data: {
            ok: true,
            variants: [
              {
                headline: "A home shaped around you",
                primaryText: "Plan your next project with our design team.",
              },
            ],
          },
          error: null,
        });
      const name = `${c.name} |MAHARA| 24\\10`;
      const data = {
        ok: false,
        dryRun: true,
        plan: {
          steps:
            operation === "launch.attachAccount"
              ? []
              : [
                  {
                    provider: "meta",
                    path: "act_fixture/campaigns",
                    body: { name, status: "PAUSED" },
                  },
                  {
                    provider: "meta",
                    path: "act_fixture/adsets",
                    body: { name: "Client audience", status: "PAUSED" },
                  },
                  {
                    provider: "meta",
                    path: "act_fixture/ads",
                    body: {
                      name: "Approved client creative",
                      status: "PAUSED",
                    },
                  },
                  // A build makes no card; Switch on makes it.
                  ...(operation === "launch.switchOn"
                    ? [
                        {
                          provider: "clickup",
                          path: "list/fixture/task",
                          body: { name },
                        },
                      ]
                    : []),
                ],
          result: {
            campaignName: name,
            budgetWords: args.dailyBudgetUsd
              ? `$${args.dailyBudgetUsd} a day${c.accounts[0]?.currency === "SAR" ? ` = ${(args.dailyBudgetUsd * 3.751).toFixed(2)} SAR` : ""}`
              : undefined,
          },
          ...(state === "meta-refused"
            ? {
                check: {
                  ready: false,
                  steps: [{ ok: false, message: "Fictional Meta refusal" }],
                },
              }
            : {}),
        },
        message: "Rehearsal. No changes will be made to Meta or ClickUp.",
      };
      return Promise.resolve({ data, error: null });
    }
    return invoke(fn, options);
  }) as any;
  if (params.get("path")?.match(/^\/(launch|clients)/)) {
    const note = document.createElement("div");
    note.textContent =
      "Design preview · Fictional clients · No provider writes";
    note.style.cssText =
      "position:fixed;bottom:8px;right:12px;z-index:9999;font:10px monospace;background:var(--card);color:var(--muted-foreground);padding:6px 10px;border-radius:8px;pointer-events:none";
    document.body.appendChild(note);
  }
}
