/** Fictional data only. Runs real read models in the local fake database. No provider calls. */

import { type Account, buildSheet } from "../../convex/billingCore";
import { makeApp, restoreGlobals, setNow, web } from "../usage/fakeCtx";

const now = Date.parse("2026-10-03T08:00:00Z");
setNow(now);
const app = await makeApp(undefined, {
  env: {
    SUPABASE_URL: "https://preview.invalid",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic",
  },
});
web.on("https://preview.invalid/", () => []);
const user = await app.makeUser({
  email: "csm@example.test",
  name: "Demo CSM",
});
app.seed("portalMembers", [
  {
    email: "csm@example.test",
    name: "Demo CSM",
    roles: ["csm"],
    clients: [],
    at: now,
  },
]);
const clients = [
  {
    name: "Example Design",
    taskId: "demo-client-001",
    stage: "Active",
    bucket: "management",
    todo: "Book the next check-in and review this month's progress.",
    rank: 10,
    level: "amber",
    launchDate: "2026-09-03",
    liveDays: 30,
    lastPoc: "2026-09-29",
    silentDays: 4,
    lastCall: "2026-09-20",
    callDays: 13,
    renewalDate: "2026-11-03",
    renewalTracked: true,
    happiness: "Happy",
    service: "DFY",
    reportDue: true,
    reportTracked: true,
  },
  {
    name: "Sample Build Co",
    taskId: "demo-client-002",
    stage: "Needs Contacting",
    bucket: "onboarding",
    todo: "Confirm onboarding access and the launch checklist.",
    rank: 12,
    level: "amber",
    onboarding: true,
    signupDays: 3,
    newSignup: true,
    service: "DFY",
  },
  {
    name: "Demo Interiors",
    taskId: "demo-client-003",
    stage: "Active",
    bucket: "management",
    todo: "Next call is booked. Review the latest client feedback.",
    rank: 50,
    level: "green",
    lastPoc: "2026-10-02",
    silentDays: 1,
    nextPoc: "2026-10-05",
    nextCallAt: "2026-10-05T10:00:00Z",
    liveDays: 60,
    launchDate: "2026-08-04",
    renewalDate: "2026-10-30",
    renewalTracked: true,
    service: "DWY",
    happiness: "Happy",
  },
].map(c => ({
  stageRank: 1,
  hot: [],
  loose: [],
  changes: [],
  newSignup: false,
  onboarding: false,
  csmAssigned: "Demo CSM",
  syncedAt: now,
  ...c,
}));
app.seed("clients", clients);
app.seed(
  "clientProfiles",
  clients.map((c, i) => ({
    clientName: c.name,
    taskId: c.taskId,
    stage: c.stage,
    service: c.service,
    liveDays: c.liveDays,
    happiness: c.happiness,
    links: {},
    ghlName: c.name,
    ads: [],
    calls: [],
    gaps:
      i === 0
        ? [
            {
              gap: "sheet_link",
              label: "No stat sheet on the ClickUp card",
              fix: "Link the client performance sheet on the client card.",
            },
          ]
        : [],
    syncedAt: now,
    performance:
      i === 1
        ? {}
        : {
            month: {
              spend: 630,
              leads: 36,
              booked: 12,
              shows: 9,
              noshows: 1,
              deals: 2,
              revenue: 15000,
            },
            lastMonth: {
              spend: 600,
              leads: 30,
              booked: 10,
              shows: 7,
              noshows: 2,
              deals: 1,
            },
            allTime: { spend: 1230, booked: 22, shows: 16, deals: 3 },
            stale: [],
            staleCount: 0,
            byAd: [],
            source: "Fictional preview",
            daily: [],
          },
  })),
);
app.seed("syncRuns", [
  { role: "csm", at: now, campaigns: 3, ok: true, ads: 0, offBoard: 0 },
  {
    role: "csm",
    kind: "health",
    at: now,
    ok: true,
    campaigns: 3,
    profiles: 3,
    ads: 0,
    offBoard: 0,
  },
]);
app.seed(
  "checks",
  [
    {
      key: "01",
      block: "sprint_am",
      label: "Review the clients who need a follow-up",
      detail: "Open Clients and work from the top.",
      done: false,
    },
    {
      key: "02",
      block: "work_am",
      label: "Complete the priority client tasks",
      done: false,
    },
    {
      key: "03",
      block: "sprint_midday",
      label: "Review replies and appointments",
      done: false,
    },
    {
      key: "04",
      block: "work_pm",
      label: "Follow up on the team's open tasks",
      done: false,
    },
    {
      key: "05",
      block: "sprint_pm",
      label: "Save your end-of-day report",
      done: false,
    },
  ].map(c => ({ role: "csm", day: "2026-10-03", ...c })),
);
app.seed("csTasks", [
  {
    taskId: "demo-task-001",
    name: "Review Example Design strategy",
    status: "to do",
    assignee: "Demo CSM",
    dueDate: "2026-10-03",
    syncedAt: now,
  },
]);
app.seed("calendarEvents", [
  {
    eventId: "demo-event",
    calendarId: "demo-calendar",
    title: "Example Design check-in",
    start: "2026-10-03T13:00:00+03:00",
    end: "2026-10-03T13:30:00+03:00",
    allDay: false,
    clientName: "Example Design",
    attendees: [],
    kind: "client",
    syncedAt: now,
  },
]);
const data: Record<string, unknown> = {};
for (const name of [
  "roles:me",
  "csm:snapshot",
  "csm:performanceOverview",
  "csm:syncStatus",
  "comms:overview",
  "gaps:list",
  "projections:page",
  "churn:page",
])
  data[name] = await app.run(name, {}, { as: user });
for (const c of clients)
  data[`profile:${c.name}`] = await app.run(
    "csm:clientProfile",
    { clientName: c.name },
    { as: user },
  );
data["auth:currentUser"] = { name: "Demo CSM", email: "csm@example.test" };
data["billing:sheet"] = buildSheet(
  clients.map(
    (c, i) =>
      ({
        taskId: c.taskId,
        name: c.name,
        group: i === 1 ? "pipeline" : "active",
        stage: c.stage,
        method: "bank_transfer",
        plan: "monthly",
        nextDate: "2026-10-10",
        nextUsd: 1500,
        mrrUsd: 1500,
        extensionWeeks: 0,
        notes: [],
        syncedAt: new Date(now).toISOString(),
      }) as unknown as Account,
  ),
  [],
  [],
  "2026-10-03",
);
data["wa:inbox"] = {
  threads: [
    {
      id: "demo-thread",
      client_name: "Example Design",
      contact_name: "Example Owner",
      desk: "csm",
      is_group: false,
      phone: null,
      last_inbound_at: "2026-10-03T07:40:00Z",
      messages: [
        {
          direction: "inbound",
          body: "Can we review the strategy together this week?",
          at: "2026-10-03T07:40:00Z",
          speaker: "Example Owner",
          kind: "text",
        },
      ],
      draft: {
        ar: "يسعدنا مراجعة الاستراتيجية معك هذا الأسبوع. سأرسل لك موعد المكالمة بعد تأكيده.",
        en: "Of course. Let's review the strategy together this week. I'll confirm an available time for our check-in.",
        why: "The client asked to review the strategy.",
        sent_at: null,
        sent_by: null,
      },
    },
  ],
};
await Bun.write(
  new URL("./fixtures.json", import.meta.url),
  JSON.stringify(data, null, 2),
);
restoreGlobals();
console.log(
  "Fictional preview fixtures generated from the actual read models.",
);
