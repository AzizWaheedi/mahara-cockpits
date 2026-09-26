import { useMutation, useQuery } from "convex/react";
import {
  Activity,
  AlertTriangle,
  Bot,
  Check,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useNow } from "@/lib/useNow";
import { usePageVisible } from "@/lib/usePageVisible";
import { api } from "../../convex/_generated/api";
import { COCKPIT_META } from "./PortalHome";

// biome-ignore lint/suspicious/noExplicitAny: admin rows
type Any = any;

/**
 * The roles an admin can hand out. The CEO cockpit is not among them and must
 * not be added: it is Aziz's own and is decided by the address on the account
 * (Aziz, 2026-09-22, "even admins can't assign themselves the CEO position").
 * The server refused the word already; showing the tick box only taught people
 * to ask for something that never worked.
 */
const ROLE_META: { key: string; label: string; hint: string }[] = [
  {
    key: "admin",
    label: "Admin",
    hint: "People and access. Every cockpit, every client. Not the CEO view.",
  },
  {
    key: "media_buyer",
    label: "Media buyer",
    hint: "Ads, launches, budgets, tracking.",
  },
  {
    key: "csm",
    label: "Client success",
    hint: "Clients, calls, reports, WhatsApp.",
  },
  {
    key: "creative",
    label: "Creative director",
    hint: "Briefs, scripts, winners, brand DNA.",
  },
  {
    key: "editor",
    label: "Editor desk",
    hint: "Video jobs, footage, brand rules, cuts.",
  },
  {
    key: "sales",
    label: "Sales",
    hint: "Calls, leads, scripts, follow-ups, pay.",
  },
];

type SalesRole = "setter" | "closer" | "both" | "manager";

/**
 * What a person with the Sales seat does there, chosen in the same form as
 * the seat (Aziz, 2026-09-24: "Just let me add them like the main cockpit
 * easily"). The portal pushes it to the sales cockpit's seat list.
 */
const SALES_ROLE_META: { key: SalesRole; label: string; hint: string }[] = [
  { key: "setter", label: "Setter", hint: "Calls new leads and books intros." },
  { key: "closer", label: "Closer", hint: "Runs demos and closes deals." },
  { key: "both", label: "Both", hint: "Books intros and closes deals." },
  {
    key: "manager",
    label: "Manager",
    hint: "Sees every rep's numbers and edits seats, links and settings.",
  },
];

const salesRoleLabel = (role: unknown) =>
  SALES_ROLE_META.find(s => s.key === role)?.label;

/** Cockpit key → the app name its smoke check reports under. */
const APP_KEY: Record<string, string> = {
  media_buyer: "media-buyer",
  csm: "client-success",
  creative: "creative",
  editor: "video-editor",
  sales: "sales",
};

const agoAt = (now: number, ms?: number | null) => {
  if (!ms) return "never";
  const m = Math.round((now - ms) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
};

/** A seat, as a neutral pill: the name says which one, no colour code to learn. */
function RoleChip({ role }: { role: string }) {
  return (
    <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium">
      {ROLE_META.find(r => r.key === role)?.label ?? role}
    </span>
  );
}

const DOT: Record<"good" | "warn" | "bad" | "idle", string> = {
  good: "var(--success)",
  warn: "var(--warning)",
  bad: "var(--destructive)",
  idle: "color-mix(in oklch, var(--muted-foreground) 50%, transparent)",
};

/** A status line: the colour on a small dot, the words muted. */
function Dot({
  tone,
  children,
}: {
  tone: keyof typeof DOT;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <span
        aria-hidden
        className="size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: DOT[tone] }}
      />
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

/**
 * The admin view: who is on the team, which cockpit and which clients each
 * person gets, and whether every cockpit is healthy. Aziz, 2026-09-12: "give
 * me an admin view, make it completely amazing, and combine them all in one
 * project so I can switch to them whenever I want."
 */
function useRetained<T>(
  value: T | undefined,
  key: string | undefined,
): T | undefined {
  const saved = useRef<{ key: string | undefined; value: T } | undefined>(
    undefined,
  );
  useEffect(() => {
    if (value !== undefined) saved.current = { key, value };
    else if (saved.current?.key !== key) saved.current = undefined;
  }, [value, key]);
  return (
    value ?? (saved.current?.key === key ? saved.current?.value : undefined)
  );
}

export function AdminPage() {
  const me = useQuery(api.roles.me, {});
  const visible = usePageVisible();
  const now = useNow();
  const ago = (ms?: number | null) => agoAt(now, ms);
  const [editing, setEditing] = useState<Any | null | "new">(null);
  const [query, setQuery] = useState("");
  const args = visible ? {} : "skip";
  const cacheKey = me?.email ?? undefined;
  const members = useRetained(useQuery(api.portal.members, args), cacheKey);
  const cockpitHealth = useRetained(
    useQuery(api.portal.adminHealth, args),
    cacheKey,
  );
  const sources = useRetained(
    useQuery(api.portal.adminSources, args),
    cacheKey,
  );
  const scheduled = useRetained(useQuery(api.portal.adminJobs, args), cacheKey);
  const activity = useRetained(
    useQuery(api.portal.adminActivity, args),
    cacheKey,
  );
  const actions = useRetained(
    useQuery(api.portal.adminActions, args),
    cacheKey,
  );
  const counts = useRetained(useQuery(api.portal.adminCounts, args), cacheKey);
  const quarterHour = 15 * 60_000;
  const since =
    Math.floor(now / quarterHour) * quarterHour - 86400_000 - quarterHour;
  const hermes = useRetained(
    useQuery(api.portal.adminHermes, visible ? { since } : "skip"),
    cacheKey,
  );
  const clientNames = useQuery(
    api.portal.clientNames,
    visible && editing ? {} : "skip",
  );
  const remove = useMutation(api.portal.removeMember);
  const overview = useMemo(
    () => ({
      health: cockpitHealth,
      sources,
      scheduled,
      ...activity,
      counts,
      hermesWaiting: hermes
        ? { queued: hermes.queued, claimed: hermes.claimed }
        : undefined,
      hermes: hermes
        ? {
            queued: hermes.queued,
            doneToday: hermes.recentDone.filter(at => at > now - 86400_000)
              .length,
            lastDone: hermes.lastDone,
            actions: (actions ?? []).filter(a => a.at > now - 86400_000),
          }
        : undefined,
    }),
    [cockpitHealth, sources, scheduled, activity, counts, hermes, actions, now],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (members ?? []).filter(
      m =>
        !q || m.email.includes(q) || (m.name ?? "").toLowerCase().includes(q),
    );
  }, [members, query]);

  const health = (overview?.health ?? []) as Any[];
  const healthFor = (app: string) => health.find(h => h.app === app);

  const sourcesDown = ((overview?.sources ?? []) as Any[]).filter(
    src => src.ok === false && src.streak >= 3,
  ).length;
  const jobsFailing = ((overview?.scheduled ?? []) as Any[]).filter(
    j => !j.ok || now - j.at > Math.max(3 * j.everyMin, 45) * 60_000,
  ).length;
  const healthLine = [
    sourcesDown
      ? `${sourcesDown} data source${sourcesDown === 1 ? "" : "s"} down`
      : "",
    jobsFailing
      ? `${jobsFailing} job${jobsFailing === 1 ? "" : "s"} failing`
      : "",
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Admin</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            One sign-in for the whole team. Add a person, give them a seat, and
            the right cockpit opens for them the moment they log in.
          </p>
        </div>
        <Button onClick={() => setEditing("new")}>
          <Plus className="size-4" /> Add a team member
        </Button>
      </header>

      {/* Cockpits: switch, and see at a glance that each one is alive. */}
      <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Object.entries(COCKPIT_META).map(([key, meta]) => {
          const h = healthFor(APP_KEY[key]);
          const ok = h ? h.ok : undefined;
          return (
            <div
              key={key}
              className="flex flex-col gap-3 rounded-2xl border bg-card p-4 sm:p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold">{meta.label}</div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {meta.blurb}
                  </p>
                </div>
                <Button size="sm" variant="outline" asChild>
                  <Link to={meta.to}>Open</Link>
                </Button>
              </div>
              <Dot tone={ok === false ? "bad" : ok ? "good" : "idle"}>
                {ok === false
                  ? `Failing: ${(h.failing ?? []).join(", ")}`
                  : ok
                    ? `Healthy, checked ${ago(h.at)}`
                    : "No check yet"}
              </Dot>
            </div>
          );
        })}
      </section>

      {/* The team. */}
      <Card className="gap-0 py-0">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0 p-4 sm:p-6">
          <CardTitle className="text-[15px]">
            Team members{" "}
            <span className="font-normal text-muted-foreground">
              {overview?.counts?.members ?? ""}
            </span>
          </CardTitle>
          <div className="relative w-full sm:w-56">
            <Search className="pointer-events-none absolute left-2 top-2.5 size-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Find a person"
              className="h-9 w-full pl-8"
            />
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto border-t p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead>Seats</TableHead>
                <TableHead>Clients</TableHead>
                <TableHead>Last seen</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {members === undefined ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    Loading…
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    Nobody matches.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map(m => (
                  <TableRow key={m._id}>
                    <TableCell>
                      <div className="font-medium">
                        {m.name || m.email.split("@")[0]}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {m.email}
                      </div>
                      {m.note ? (
                        <div className="text-xs text-muted-foreground">
                          {m.note}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {m.roles.map((r: string) =>
                          r === "sales" && salesRoleLabel(m.salesRole) ? (
                            // Kept together, so the role never wraps away from its seat.
                            <span key={r} className="inline-flex gap-1">
                              <RoleChip role={r} />
                              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                                {salesRoleLabel(m.salesRole)}
                              </span>
                            </span>
                          ) : (
                            <RoleChip key={r} role={r} />
                          ),
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {m.roles.includes("admin") || m.clients.length === 0 ? (
                        <span className="text-muted-foreground">
                          All clients
                        </span>
                      ) : (
                        <span title={m.clients.join(", ")}>
                          {m.clients.length} client
                          {m.clients.length === 1 ? "" : "s"}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {ago(m.lastSeenAt)}
                      {m.lastCockpit ? (
                        <span className="block text-xs">
                          {COCKPIT_META[m.lastCockpit]?.label ?? m.lastCockpit}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Edit"
                          onClick={() => setEditing(m)}
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Remove"
                          disabled={m.email === me?.email}
                          onClick={() => {
                            if (
                              confirm(`Remove ${m.email} from every cockpit?`)
                            )
                              void remove({ email: m.email });
                          }}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* The machine's health, the same story the CEO cockpit's Machine tab
          tells in full. Folded, so the page stays about people and access;
          the summary line says when something is wrong. */}
      <details className="group rounded-2xl border bg-card">
        <summary className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 sm:px-6 sm:py-4">
          <span className="text-[15px] font-semibold">System health</span>
          <Dot tone={healthLine ? "bad" : "good"}>
            {healthLine ||
              (overview?.lastSync
                ? `All running, last sync ${ago(overview.lastSync.at)}`
                : "Reading…")}
          </Dot>
        </summary>
        <div className="space-y-6 border-t p-4 sm:p-6">
          {/* Numbers that say whether the machine is running. */}
          <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat
              icon={Users}
              label="Team"
              value={overview?.counts?.members ?? "…"}
              hint={`${overview?.counts?.admins ?? 0} admin${overview?.counts?.admins === 1 ? "" : "s"}`}
            />
            <Stat
              icon={Activity}
              label="Last data sync"
              value={overview?.lastSync ? ago(overview.lastSync.at) : "…"}
              hint={
                overview?.lastSync?.problems?.length
                  ? `${overview.lastSync.problems.length} problem(s)`
                  : overview?.lastSync
                    ? "clean"
                    : "no run yet"
              }
              bad={Boolean(overview?.lastSync && !overview.lastSync.ok)}
            />
            <Stat
              icon={ShieldCheck}
              label="Live campaigns"
              value={overview?.counts?.liveCampaigns ?? "…"}
              hint={`${overview?.counts?.campaigns ?? 0} on the board, ${overview?.counts?.clients ?? 0} clients`}
            />
            <Stat
              icon={Bot}
              label="Hermes"
              value={
                overview?.hermes ? `${overview.hermes.queued} waiting` : "…"
              }
              hint={
                overview?.hermes
                  ? `${overview.hermes.doneToday} done today, last ${ago(overview.hermes.lastDone)}`
                  : ""
              }
              bad={(overview?.hermes?.queued ?? 0) > 5}
            />
          </section>

          {/* Every outside system, with the fix next to it when it is down. */}
          <section>
            <h2 className="text-[15px] font-semibold">Data sources</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Three failures in a row send one Slack message with the fix. Green
              means the last call worked. Repeated successful checks are
              recorded at most every 5 minutes.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(overview?.sources ?? []).map((src: Any) => {
                const down = src.ok === false && src.streak >= 3;
                const blip = src.ok === false && src.streak < 3;
                return (
                  <div
                    key={src.source}
                    className={`rounded-xl p-3 text-sm ${down ? "callout-bad border" : "bg-muted/40"}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-medium">
                        {src.label}
                      </span>
                      <Dot
                        tone={
                          down
                            ? "bad"
                            : blip
                              ? "warn"
                              : src.ok
                                ? "good"
                                : "idle"
                        }
                      >
                        {down
                          ? `down, ${src.streak} in a row`
                          : blip
                            ? `failed ${src.streak}×, watching`
                            : src.ok
                              ? `ok ${ago(src.at)}`
                              : "not used yet"}
                      </Dot>
                    </div>
                    {src.ok === false ? (
                      <>
                        <p
                          className="mt-1 truncate font-mono text-[11px] opacity-80"
                          title={src.lastError}
                        >
                          {src.lastError}
                        </p>
                        <p className="mt-1 text-xs">
                          <span className="font-semibold">{src.owner}:</span>{" "}
                          {src.fix}
                        </p>
                      </>
                    ) : (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {src.lastFailAt
                          ? `last failed ${ago(src.lastFailAt)}`
                          : "no failures recorded"}
                        {src.source === "hermes" && overview?.hermesWaiting
                          ? ` · ${overview.hermesWaiting.queued} waiting, ${overview.hermesWaiting.claimed} in progress`
                          : ""}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* The clockwork: every job's last run and whether it is failing. */}
          <section>
            <h2 className="text-[15px] font-semibold">Scheduled jobs</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              A job that fails three times in a row files a fix job for Hermes
              and sends one message. One that stops running is flagged within
              the hour.
            </p>
            <div className="mt-4 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Job</TableHead>
                    <TableHead>Every</TableHead>
                    <TableHead>Last run</TableHead>
                    <TableHead>Took</TableHead>
                    <TableHead>State</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(overview?.scheduled ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-muted-foreground">
                        No job has reported yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    (overview.scheduled as Any[]).map(j => {
                      const late =
                        now - j.at > Math.max(3 * j.everyMin, 45) * 60_000;
                      return (
                        <TableRow key={j.job}>
                          <TableCell className="font-medium">{j.job}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {j.everyMin >= 1440
                              ? `${Math.round(j.everyMin / 1440)} d`
                              : j.everyMin >= 60
                                ? `${Math.round(j.everyMin / 60)} h`
                                : `${j.everyMin} min`}
                          </TableCell>
                          <TableCell
                            className={
                              late ? "txt-bad" : "text-muted-foreground"
                            }
                          >
                            {ago(j.at)}
                            {j.everyMin < 5 && (
                              <span className="block text-xs">
                                Successful checks saved every 5 min
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {j.ms >= 1000
                              ? `${Math.round(j.ms / 1000)} s`
                              : `${j.ms} ms`}
                          </TableCell>
                          <TableCell>
                            {j.ok && !late ? (
                              <Dot tone="good">ok</Dot>
                            ) : late ? (
                              <Dot tone="bad">not running</Dot>
                            ) : (
                              <span title={j.error}>
                                <Dot tone="bad">
                                  failing ({j.streak} in a row)
                                </Dot>
                              </span>
                            )}
                            {!j.ok && j.error ? (
                              <div
                                className="max-w-md truncate font-mono text-[11px] text-muted-foreground"
                                title={j.error}
                              >
                                {j.error}
                              </div>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </section>

          <section className="grid gap-6 lg:grid-cols-2">
            <div>
              <h2 className="flex items-center gap-2 text-[15px] font-semibold">
                <AlertTriangle className="size-4 txt-warn" aria-hidden />
                Recent alerts
              </h2>
              {overview?.alerts?.length ? (
                <ul className="mt-3 space-y-2 text-sm">
                  {overview.alerts.map((a: Any) => (
                    <li
                      key={`${a.at}${a.text.slice(0, 20)}`}
                      className="flex gap-3"
                    >
                      <span className="w-16 shrink-0 text-xs text-muted-foreground">
                        {ago(a.at)}
                      </span>
                      <span className="min-w-0 whitespace-pre-wrap">
                        {a.text}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">
                  Nothing has failed a check lately.
                </p>
              )}
            </div>
            <div>
              <h2 className="flex items-center gap-2 text-[15px] font-semibold">
                <Bot className="size-4 text-muted-foreground" aria-hidden />
                What Hermes did today
              </h2>
              {overview?.hermes?.actions?.length ? (
                <ul className="mt-3 space-y-2 text-sm">
                  {overview.hermes.actions.map((a: Any) => (
                    <li key={`${a.at}${a.note}`} className="flex gap-3">
                      <span className="w-16 shrink-0 text-xs text-muted-foreground">
                        {ago(a.at)}
                      </span>
                      {a.ok ? (
                        <Check className="mt-0.5 size-3.5 shrink-0 txt-good" />
                      ) : (
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 txt-bad" />
                      )}
                      <span className="min-w-0">{a.note}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-muted-foreground">
                  No ad account actions in the last day.
                </p>
              )}
            </div>
          </section>
        </div>
      </details>

      {editing ? (
        <MemberDialog
          member={editing === "new" ? null : editing}
          clientNames={clientNames ?? []}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  hint,
  bad,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: React.ReactNode;
  hint?: string;
  bad?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-xl bg-muted/40 p-3">
      <div
        className={`shrink-0 rounded-lg p-2 ${bad ? "tone-bad" : "bg-background/60"}`}
      >
        <Icon className="size-4" />
      </div>
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-lg font-semibold leading-tight tabular-nums">
          {value}
        </div>
        {hint ? (
          <div className="truncate text-xs text-muted-foreground">{hint}</div>
        ) : null}
      </div>
    </div>
  );
}

function MemberDialog({
  member,
  clientNames,
  onClose,
}: {
  member: Any | null;
  clientNames: string[];
  onClose: () => void;
}) {
  const upsert = useMutation(api.portal.upsertMember);
  const [email, setEmail] = useState<string>(member?.email ?? "");
  const [name, setName] = useState<string>(member?.name ?? "");
  const [note, setNote] = useState<string>(member?.note ?? "");
  const [roles, setRoles] = useState<string[]>(member?.roles ?? []);
  // An admin given the Sales seat is most likely running the team, so the
  // choice starts at Manager for them and at Setter for everyone else.
  const [salesRole, setSalesRole] = useState<SalesRole>(
    salesRoleLabel(member?.salesRole)
      ? member.salesRole
      : member?.roles?.includes("admin")
        ? "manager"
        : "setter",
  );
  const [allClients, setAllClients] = useState<boolean>(
    !member || member.clients.length === 0,
  );
  const [clients, setClients] = useState<string[]>(member?.clients ?? []);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const toggle = (list: string[], v: string) =>
    list.includes(v) ? list.filter(x => x !== v) : [...list, v];
  const shown = clientNames.filter(c =>
    c.toLowerCase().includes(filter.trim().toLowerCase()),
  );

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {member ? "Edit team member" : "Add a team member"}
          </DialogTitle>
          <DialogDescription>
            They sign in at this address with this email. New people create
            their password on the sign-up page; the seats below decide what
            opens.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="m-email">Email</Label>
              <Input
                id="m-email"
                value={email}
                disabled={Boolean(member)}
                onChange={e => setEmail(e.target.value)}
                placeholder="name@maharamedia.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-name">Name</Label>
              <Input
                id="m-name"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="First Last"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Seats</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {ROLE_META.map(r => (
                <button
                  type="button"
                  key={r.key}
                  aria-pressed={roles.includes(r.key)}
                  onClick={() => setRoles(toggle(roles, r.key))}
                  className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-left ${roles.includes(r.key) ? "border-primary/40 bg-primary/15" : ""}`}
                >
                  <Checkbox
                    checked={roles.includes(r.key)}
                    tabIndex={-1}
                    aria-hidden
                    className="pointer-events-none mt-0.5"
                  />
                  <span>
                    <span className="block text-sm font-medium">{r.label}</span>
                    <span className="block text-xs text-muted-foreground">
                      {r.hint}
                    </span>
                  </span>
                </button>
              ))}
            </div>
            {roles.includes("sales") ? (
              <div className="space-y-2 rounded-md border p-2.5">
                <Label id="m-sales-role">Sales role</Label>
                <div
                  role="group"
                  aria-labelledby="m-sales-role"
                  className="grid grid-cols-2 gap-1.5 sm:grid-cols-4"
                >
                  {SALES_ROLE_META.map(s => (
                    <button
                      type="button"
                      key={s.key}
                      aria-pressed={salesRole === s.key}
                      onClick={() => setSalesRole(s.key)}
                      className={`cursor-pointer rounded-lg border px-2 py-1.5 text-sm ${salesRole === s.key ? "border-primary/40 bg-primary/15 font-medium" : "text-muted-foreground"}`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  {SALES_ROLE_META.find(s => s.key === salesRole)?.hint}
                </p>
              </div>
            ) : null}
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Client access</Label>
              <span className="flex items-center gap-2 text-sm">
                <Switch
                  checked={allClients}
                  onCheckedChange={setAllClients}
                  aria-label="All clients"
                />
                All clients
              </span>
            </div>
            {!allClients ? (
              <div className="rounded-md border">
                <div className="border-b p-2">
                  <Input
                    value={filter}
                    onChange={e => setFilter(e.target.value)}
                    placeholder="Filter clients"
                    className="h-8"
                  />
                </div>
                <div className="max-h-48 overflow-y-auto p-2">
                  {shown.length === 0 ? (
                    <p className="p-2 text-xs text-muted-foreground">
                      No client matches.
                    </p>
                  ) : (
                    shown.map(c => (
                      <button
                        type="button"
                        key={c}
                        aria-pressed={clients.includes(c)}
                        onClick={() => setClients(toggle(clients, c))}
                        className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1 text-left text-sm hover:bg-muted"
                      >
                        <Checkbox
                          checked={clients.includes(c)}
                          tabIndex={-1}
                          aria-hidden
                          className="pointer-events-none"
                        />
                        {c}
                      </button>
                    ))
                  )}
                </div>
                <div className="border-t px-3 py-1.5 text-xs text-muted-foreground">
                  {clients.length} selected
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                They see every client in the cockpits they have.
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="m-note">Note</Label>
            <Input
              id="m-note"
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="e.g. joined September, covers Kuwait accounts"
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={saving || !email.includes("@") || roles.length === 0}
            onClick={async () => {
              setSaving(true);
              setError("");
              try {
                await upsert({
                  email,
                  name: name || undefined,
                  roles,
                  clients: allClients ? [] : clients,
                  note: note || undefined,
                  salesRole: roles.includes("sales") ? salesRole : undefined,
                });
                onClose();
              } catch (e) {
                setError(String((e as Error).message ?? e));
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Saving…" : member ? "Save" : "Add"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
