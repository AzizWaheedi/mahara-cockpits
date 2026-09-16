import { useMutation, useQuery } from "convex/react";
import {
  Activity,
  AlertTriangle,
  Bot,
  Check,
  ExternalLink,
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

const ROLE_META: { key: string; label: string; hint: string }[] = [
  {
    key: "admin",
    label: "Admin",
    hint: "This view, every cockpit, every client.",
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
];

/** Cockpit key → the app name its smoke check reports under. */
const APP_KEY: Record<string, string> = {
  media_buyer: "media-buyer",
  csm: "client-success",
  creative: "creative",
};

const agoAt = (now: number, ms?: number | null) => {
  if (!ms) return "never";
  const m = Math.round((now - ms) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
};

function RoleChip({ role }: { role: string }) {
  const tone =
    role === "admin"
      ? "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
      : role === "media_buyer"
        ? "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100"
        : role === "csm"
          ? "bg-teal-100 text-teal-900 dark:bg-teal-900/40 dark:text-teal-100"
          : "bg-violet-100 text-violet-900 dark:bg-violet-900/40 dark:text-violet-100";
  return (
    <span
      className={`rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${tone}`}
    >
      {ROLE_META.find(r => r.key === role)?.label ?? role}
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

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[12px] font-bold uppercase tracking-widest text-teal-600">
            Mahara portal
          </p>
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
      <section className="grid gap-3 md:grid-cols-3">
        {Object.entries(COCKPIT_META).map(([key, meta]) => {
          const h = healthFor(APP_KEY[key]);
          const ok = h ? h.ok : undefined;
          return (
            <Card key={key} className="relative overflow-hidden">
              <div
                className={`absolute inset-x-0 top-0 h-1 ${ok === false ? "bg-red-500" : ok ? "bg-emerald-500" : "bg-muted"}`}
              />
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-base">
                  {meta.label}
                  <span
                    className={`inline-flex items-center gap-1 text-[11px] font-medium ${ok === false ? "text-red-600" : ok ? "text-emerald-600" : "text-muted-foreground"}`}
                  >
                    <span
                      className={`size-2 rounded-full ${ok === false ? "bg-red-500" : ok ? "bg-emerald-500" : "bg-muted-foreground/40"}`}
                    />
                    {ok === false
                      ? `failing: ${(h.failing ?? []).join(", ")}`
                      : ok
                        ? `healthy, checked ${ago(h.at)}`
                        : "no check yet"}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">{meta.blurb}</p>
                <Button size="sm" variant="outline" asChild>
                  <Link to={meta.to}>
                    Open <ExternalLink className="size-3.5" />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </section>

      {/* Numbers that say whether the machine is running. */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
          value={overview?.hermes ? `${overview.hermes.queued} waiting` : "…"}
          hint={
            overview?.hermes
              ? `${overview.hermes.doneToday} done today, last ${ago(overview.hermes.lastDone)}`
              : ""
          }
          bad={(overview?.hermes?.queued ?? 0) > 5}
        />
      </section>

      {/* The team. */}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <CardTitle className="text-base">Team members</CardTitle>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-2.5 size-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Find a person"
              className="h-9 w-56 pl-8"
            />
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
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
                        <div className="text-xs text-muted-foreground italic">
                          {m.note}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {m.roles.map((r: string) => (
                          <RoleChip key={r} role={r} />
                        ))}
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

      {/* Every outside system, with the fix next to it when it is down. */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="size-4 text-teal-600" /> Data sources
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              Three failures in a row send one Slack message with the fix. Green
              means the last call worked. Repeated successful checks are
              recorded at most every 5 minutes.
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {(overview?.sources ?? []).map((src: Any) => {
            const down = src.ok === false && src.streak >= 3;
            const blip = src.ok === false && src.streak < 3;
            return (
              <div
                key={src.source}
                className={`rounded-lg border p-3 text-sm ${down ? "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/30" : ""}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{src.label}</span>
                  <span
                    className={`inline-flex items-center gap-1 text-[11px] ${down ? "text-red-600" : blip ? "text-amber-600" : src.ok ? "text-emerald-600" : "text-muted-foreground"}`}
                  >
                    <span
                      className={`size-2 rounded-full ${down ? "bg-red-500" : blip ? "bg-amber-500" : src.ok ? "bg-emerald-500" : "bg-muted-foreground/40"}`}
                    />
                    {down
                      ? `down, ${src.streak} in a row`
                      : blip
                        ? `failed ${src.streak}×, watching`
                        : src.ok
                          ? `ok ${ago(src.at)}`
                          : "not used yet"}
                  </span>
                </div>
                {src.ok === false ? (
                  <>
                    <p
                      className="mt-1 truncate font-mono text-[11px] text-muted-foreground"
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
        </CardContent>
      </Card>

      {/* The clockwork: every job's last run and whether it is failing. */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="size-4 text-teal-600" /> Scheduled jobs
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              A job that fails three times in a row files a fix job for Hermes
              and sends one message. One that stops running is flagged within
              the hour.
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
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
                          late ? "text-red-600" : "text-muted-foreground"
                        }
                      >
                        {ago(j.at)}
                        {j.everyMin < 5 && (
                          <span className="block text-[11px]">
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
                          <span className="text-emerald-600">ok</span>
                        ) : late ? (
                          <span className="text-red-600">not running</span>
                        ) : (
                          <span className="text-red-600" title={j.error}>
                            failing ({j.streak} in a row)
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
        </CardContent>
      </Card>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4 text-amber-500" /> Recent alerts
            </CardTitle>
          </CardHeader>
          <CardContent>
            {overview?.alerts?.length ? (
              <ul className="space-y-2 text-sm">
                {overview.alerts.map((a: Any) => (
                  <li
                    key={`${a.at}${a.text.slice(0, 20)}`}
                    className="flex gap-3"
                  >
                    <span className="w-16 shrink-0 text-xs text-muted-foreground">
                      {ago(a.at)}
                    </span>
                    <span className="whitespace-pre-wrap">{a.text}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                Nothing has failed a check lately.
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Bot className="size-4 text-teal-600" /> What Hermes did today
            </CardTitle>
          </CardHeader>
          <CardContent>
            {overview?.hermes?.actions?.length ? (
              <ul className="space-y-2 text-sm">
                {overview.hermes.actions.map((a: Any) => (
                  <li key={`${a.at}${a.note}`} className="flex gap-3">
                    <span className="w-16 shrink-0 text-xs text-muted-foreground">
                      {ago(a.at)}
                    </span>
                    {a.ok ? (
                      <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-600" />
                    ) : (
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-red-500" />
                    )}
                    <span>{a.note}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                No ad account actions in the last day.
              </p>
            )}
          </CardContent>
        </Card>
      </section>

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
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div
          className={`rounded-lg p-2 ${bad ? "bg-red-100 text-red-700" : "bg-muted"}`}
        >
          <Icon className="size-4" />
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            {label}
          </div>
          <div className="text-lg font-semibold leading-tight">{value}</div>
          {hint ? (
            <div className="truncate text-xs text-muted-foreground">{hint}</div>
          ) : null}
        </div>
      </CardContent>
    </Card>
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
                  className={`flex cursor-pointer items-start gap-2 rounded-md border p-2.5 text-left ${roles.includes(r.key) ? "border-primary bg-primary/5" : ""}`}
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
