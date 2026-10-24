import type { Lane, LaunchClient, LaunchPipeline } from "@/lib/launchModel";

const now = new Date().toISOString();
const account = (id: string, status: number | null = 1, currency = "USD") => ({
  id,
  name: "Client advertising account",
  status,
  currency,
  lastRan: "2026-10-16",
  hasHistory: true,
  readAt: now,
});
const brief = {
  sentAt: "2026-10-23T09:00:00Z",
  answers: {
    service: "fitout",
    daily_budget: 30,
    destination: "lead_form",
    identity: "their_page",
    red_lines:
      "Use completed client projects. No price promises or invented offers.",
  },
};
function client(
  id: string,
  name: string,
  lane: Lane,
  extra: Partial<LaunchClient> = {},
): LaunchClient {
  return {
    id,
    locationId: `location-${id}`,
    name,
    lane,
    status: lane === "onboarding" ? "Launching" : "Active",
    stage: lane === "onboarding" ? "Brand Blueprint booked" : "Active",
    serviceMode: "DFY",
    ghosted: false,
    readOnly: false,
    accounts: [account(`111111${id.replace(/\D/g, "").padStart(5, "0")}`)],
    brief: lane === "onboarding" ? null : brief,
    caller: lane !== "onboarding",
    cards: [],
    tasks: [],
    mediaTasks:
      id === "1"
        ? [
            {
              id: "task:fictional",
              version: "1",
              kind: "task",
              title: "Review the new client creatives",
              body: "Assigned to the media buyer",
              clientId: id,
              clientName: name,
              href: "https://app.clickup.com/t/fictional-preview",
              read: false,
              priority: 2,
              task: { status: "in progress" },
            },
          ]
        : [],
    actionHistory: [
      {
        id: "fixture-action",
        operation: "launch.copy",
        state: "confirmed",
        at: now,
        actor: "Mahara buyer",
        campaign: "Fictional client campaign",
        did: "Campaign created paused",
      },
    ],
    launches: [],
    waiting: false,
    inAds: lane === "ads",
    history: [],
    people: [{ name: "Mahara buyer", kind: "mahara" }],
    ...extra,
  };
}
const history = [
  {
    account_id: "11111100003",
    campaign_id: "222222",
    name: "Harbour |MAHARA| 16\\8",
    creator: "Mahara buyer",
    leads: 148,
    cpl: 9.16,
    last_ran: "2026-10-16",
  },
  {
    account_id: "11111100003",
    campaign_id: "222223",
    name: "Harbour |MAHARA| 3\\7",
    creator: "Mahara buyer",
    leads: 64,
    cpl: 12.4,
    last_ran: "2026-08-19",
  },
];
export function launchFixture(state = "all"): LaunchPipeline {
  let clients: LaunchClient[] = [
    client("1", "Harbour Fitout", "ready", {
      history: history.map(h => ({ ...h, account_id: "11111100001" })),
    }),
    client("2", "Dune Interiors", "onboarding", {
      accounts: [],
      stage: "Brand Blueprint booked",
    }),
    client("3", "Cedar Architecture", "nothing", {
      accounts: [account("11111100003", 3)],
      history,
    }),
    client("4", "Palm Design Studio", "nothing", {
      accounts: [account("11111100004", 1)],
      history,
    }),
    client("5", "Luma Construction", "nothing", { accounts: [] }),
    client("6", "Coast & Stone", "onboarding", {
      accounts: [],
      stage: "Ready for launch",
    }),
    client("7", "Horizon Projects", "ads"),
    client("8", "North Studio", "ads"),
  ];
  for (let i = 0; i < 4; i++)
    clients.push(
      client(
        `ghost-${i}`,
        ["Safa Living", "Juniper Homes", "Vista Design", "Nook Interiors"][i],
        "onboarding",
        { ghosted: true, accounts: [], stage: "Ghosted" },
      ),
    );
  clients.push(
    client("stopped", "Atlas Build", "nothing", {
      lane: "search",
      readOnly: true,
      status: "Stopped",
      stage: "Stopped",
      history,
    }),
  );
  const waiting = (state: string, hours: number) =>
    client("waiting", "Bay Projects", "waiting", {
      waiting: true,
      launches: [
        {
          id: "00000000-0000-4000-8000-000000000005",
          campaign_name: "Bay Projects |MAHARA| 24\\10",
          account_id: "11111100000",
          state: state as any,
          created_at: new Date(Date.now() - hours * 3600000).toISOString(),
          switched_on_at:
            state === "built"
              ? undefined
              : new Date(Date.now() - hours * 3600000).toISOString(),
          meta_campaign_id: "888888",
          inAds: false,
          hasImpressions: false,
          budget_usd: 30,
        },
      ],
    });
  clients.push(waiting("built", 1));
  const selected = clients[0];
  if (state === "ready-no-account" || state === "active-no-account")
    clients = [
      {
        ...selected,
        accounts: [],
        lane: state === "active-no-account" ? "nothing" : "ready",
      },
    ];
  if (state === "onboarding-booked") clients = [clients[1]];
  if (state === "onboarding-ghosted") clients = clients.filter(c => c.ghosted);
  if (
    state === "paused-unpaid-compromised" ||
    state === "paused-unpaid-collision"
  )
    clients = [clients[2]];
  if (
    state === "paused-healthy-not-spending" ||
    state === "paused-healthy-relaunch"
  )
    clients = [clients[3]];
  if (state === "not-in-hourly-read")
    clients = [{ ...selected, accounts: [account("11111100001", null)] }];
  if (state === "sar-account" || state === "kwd-account")
    clients = [
      {
        ...selected,
        accounts: [
          account("11111100001", 1, state === "sar-account" ? "SAR" : "KWD"),
        ],
      },
    ];
  if (state === "two-accounts")
    clients = [
      {
        ...clients[2],
        accounts: [
          account("11111100003", 3),
          {
            ...account("99999900003"),
            name: "Clean client account",
            lastRan: null,
            hasHistory: false,
          },
        ],
      },
    ];
  if (state.startsWith("waiting-") || state === "just-launched")
    clients = [
      waiting(
        state === "waiting-built" ? "built" : "switched_on",
        state === "waiting-stuck" ? 26 : 2,
      ),
    ];
  if (state === "just-launched") {
    clients[0].launches[0].hasImpressions = true;
    clients[0].waiting = false;
  }
  if (state === "stopped") clients = [clients.find(c => c.readOnly)!];
  if (state === "no-clients" || state === "empty-lanes")
    clients = state === "no-clients" ? [] : [clients[6]];
  if (
    [
      "ready-brief",
      "sar-account",
      "kwd-account",
      "two-accounts",
      "apply-off",
      "meta-refused",
    ].includes(state) &&
    state !== "two-accounts" &&
    !["sar-account", "kwd-account"].includes(state)
  )
    clients = [selected];
  const lanes = { onboarding: 0, ready: 0, nothing: 0, waiting: 0, ads: 0 };
  for (const c of clients) {
    if (c.readOnly) continue;
    if (c.lane !== "search" && c.lane !== "waiting") lanes[c.lane]++;
    if (c.waiting) lanes.waiting++;
  }
  return {
    asOf: now,
    sources: {
      board: { ok: true, at: now },
      media: {
        boardCards: { ok: true, at: now },
        onboardings: { ok: true, at: now },
      },
    },
    clients,
    lanes,
  };
}
export function fixtureReadiness(
  c: LaunchClient,
  accountId: string,
  state: string,
) {
  const a = c.accounts.find(a => a.id === accountId) ?? c.accounts[0];
  const bad = a?.status === 3;
  const currency = a?.currency ?? "USD";
  const candidates = (
    c.history.length
      ? c.history
      : [
          {
            campaign_id: "222222",
            name: `${c.name} |MAHARA| 16\\8`,
            creator: "Mahara buyer",
            leads: 148,
            cpl: 9.16,
          },
        ]
  ).map(h => ({
    ...h,
    id: h.campaign_id,
    account_id: a?.id,
    status: state === "paused-healthy-not-spending" ? "ACTIVE" : "PAUSED",
    owner: { kind: "mahara", name: h.creator },
  }));
  return {
    ok: true,
    applyEnabled: false,
    readAt: now,
    account: {
      id: `act_${a?.id}`,
      name: a?.name ?? `${c.name} advertising`,
      account_status: a?.status ?? 1,
      currency,
      funding_source_details: bad ? null : { id: "fictional-payment" },
      balance: bad ? "42000" : "0",
    },
    candidates,
    best: candidates[0],
    budget: {
      contractedUsd: 30,
      source: "Blueprint part 1",
      cap: 60,
      currency,
    },
    checks: [
      {
        key: "account",
        state: bad ? "block" : a?.status === null ? "unknown" : "ok",
        sentence: bad
          ? "This ad account owes Meta a payment. Meta refuses every change on it, pausing included, until the client pays in Ads Manager."
          : a?.status === null
            ? "Not in Meta’s hourly read. Account access needs a live check."
            : "Meta confirms this account is available.",
        owner: "Client",
        fix: "Open Ads Manager",
      },
      {
        key: "ownership",
        state: bad ? "block" : "ok",
        sentence: bad
          ? "People outside Mahara made campaigns on this account and some are switched on. Move the client to a clean ad account first."
          : "Campaign ownership is verified from creator records.",
        owner: "CEO",
        fix: "Link a clean account",
      },
      {
        key: "brief",
        state: c.brief ? "ok" : "warn",
        sentence: c.brief
          ? "Blueprint part 1 has been sent to media."
          : "Blueprint part 1 has not been sent to media.",
        owner: "Creative director",
        fix: "Send part 1",
      },
      {
        key: "caller",
        state: c.caller ? "ok" : "warn",
        sentence: c.caller
          ? "A caller is assigned."
          : "No caller is assigned yet.",
        owner: "CSM",
        fix: "Assign a caller in the dialer",
      },
      {
        key: "currency",
        state: currency === "KWD" ? "block" : "ok",
        sentence:
          currency === "KWD"
            ? "This ad account is in KWD. Change the budget in Ads Manager."
            : `${currency} account. Budgets are entered in dollars.`,
        owner: "Media buyer",
        fix: "Choose another account",
      },
    ],
    waitingBudgets: bad
      ? [
          {
            id: "outsider",
            name: "Unverified campaign",
            usd: 420,
            owner: { name: "Unverified creator", kind: "outsider" },
          },
        ]
      : [],
    routes: [
      ["switchOn", "Switch back on"],
      ["copy", "Copy a past campaign"],
      ["rebuild", "Rebuild on a clean account"],
      ["new", "New from the brief"],
    ].map(([id, label]) => ({
      id,
      label,
      available:
        !bad &&
        !c.readOnly &&
        currency !== "KWD" &&
        (id !== "new" || !!c.brief),
      reason: bad
        ? "Move to a clean account first."
        : currency === "KWD"
          ? "This currency needs review in Ads Manager."
          : c.readOnly
            ? "Stopped clients are read-only."
            : id === "new" && !c.brief
              ? "Send Blueprint part 1 first."
              : null,
    })),
    fixture: state,
  };
}
