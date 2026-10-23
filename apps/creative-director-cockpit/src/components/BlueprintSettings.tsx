import { Presentation } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useCockpitAuth } from "@/auth/SupabaseAuthProvider";
import { AnimatedSelect } from "@/components/ui/animated-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  blueprintMembers,
  CLOSE_ROUTES,
  type CloseRoute,
  DRIVE_FOLDER,
  dayShort,
  folderView,
  problem,
  readBlueprintSettings,
  SERVICES,
  type ServiceKey,
  type BlueprintSettings as Settings,
  setBlueprintSetting,
} from "@/lib/blueprint";
import { cn } from "@/lib/utils";

/**
 * Settings, "Brand Blueprint" (docs/brand-blueprint SPEC.md 4.3): the five
 * starter packs, the launch media buyer, and what happens after Close the
 * call. Each change goes through cockpit_blueprint_settings_set, which
 * checks it and writes one audit row; the members list is read from ClickUp
 * with a GET through cockpit-creative-api.
 */

export type SettingsIO = {
  read: () => Promise<Settings>;
  set: (
    key: `pack.${ServiceKey}` | "launch_assignee" | "close_route",
    value: string | null,
    label?: string | null,
  ) => Promise<Settings>;
  members: () => Promise<{ id: string; name: string }[]>;
};

export function BlueprintSettings({
  io: given,
  initial,
}: {
  io?: SettingsIO;
  initial?: { settings: Settings; members?: { id: string; name: string }[] };
}) {
  const auth = useCockpitAuth();
  const io = useMemo<SettingsIO | null>(() => {
    if (given) return given;
    const client = auth.client;
    if (!client) return null;
    return {
      read: () => readBlueprintSettings(client),
      set: (key, value, label) =>
        setBlueprintSetting(client, key, value, label ?? null),
      members: () => blueprintMembers(client),
    };
  }, [given, auth.client]);

  const [settings, setSettings] = useState<Settings | { error: string } | null>(
    initial?.settings ?? null,
  );
  const reload = useCallback(async () => {
    if (!io) return;
    try {
      setSettings(await io.read());
    } catch (e) {
      setSettings({ error: e instanceof Error ? e.message : problem(e) });
    }
  }, [io]);
  useEffect(() => {
    if (!initial) void reload();
  }, [reload, initial]);

  return (
    <section
      aria-labelledby="bp-settings-title"
      className="rounded-2xl border bg-card"
    >
      <div className="p-4 sm:px-6 sm:pt-6">
        <h2
          id="bp-settings-title"
          className="flex items-center gap-2 text-[15px] font-semibold"
        >
          <Presentation className="size-4 text-muted-foreground" />
          Brand Blueprint
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          What the Blueprint call sends to media, and what happens after it.
        </p>
      </div>
      {settings === null ? (
        <p className="border-t px-4 py-4 text-sm text-muted-foreground sm:px-6">
          Reading the Blueprint settings…
        </p>
      ) : "error" in settings ? (
        <p role="alert" className="border-t px-4 py-4 text-sm sm:px-6">
          The Blueprint settings could not be read: {settings.error}{" "}
          <button
            type="button"
            onClick={() => void reload()}
            className="text-primary underline-offset-4 hover:underline"
          >
            Read them again
          </button>
        </p>
      ) : io ? (
        <div className="divide-y border-t">
          <Packs settings={settings} io={io} onSaved={setSettings} />
          <LaunchBuyer
            settings={settings}
            io={io}
            onSaved={setSettings}
            initialMembers={initial?.members}
          />
          <CloseSwitch settings={settings} io={io} onSaved={setSettings} />
        </div>
      ) : null}
    </section>
  );
}

function Group({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3 px-4 py-4 sm:px-6 sm:py-5">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      </div>
      {children}
    </div>
  );
}

function changedLine(settings: Settings, key: string): string | null {
  const c = settings.changes?.[key];
  // The close switch's first value comes with the migration, not a person.
  if (!c || (key === "close_route" && !c.by)) return null;
  return `Set ${dayShort(c.at)}${c.by ? ` by ${c.by}` : ""}`;
}

function Packs({
  settings,
  io,
  onSaved,
}: {
  settings: Settings;
  io: SettingsIO;
  onSaved: (s: Settings) => void;
}) {
  return (
    <Group
      title="Starter packs"
      hint="One Drive folder per service. Share each folder as Anyone with the link can view. If it is shared any other way, the deck shows an Open the pack button instead of the folder. Until a service has a folder, part 1 asks for the link on the call."
    >
      <ul className="space-y-4">
        {SERVICES.map(s => (
          <PackRow
            key={s.key}
            service={s.key}
            label={s.label}
            value={settings.packs?.[s.key] ?? null}
            changed={changedLine(settings, `pack.${s.key}`)}
            canEdit={settings.can.packs}
            io={io}
            onSaved={onSaved}
          />
        ))}
      </ul>
    </Group>
  );
}

function PackRow({
  service,
  label,
  value,
  changed,
  canEdit,
  io,
  onSaved,
}: {
  service: ServiceKey;
  label: string;
  value: string | null;
  changed: string | null;
  canEdit: boolean;
  io: SettingsIO;
  onSaved: (s: Settings) => void;
}) {
  const [text, setText] = useState(value ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  // A saved pack reads as its link (the folder ID's two ends tell the five
  // apart); Change opens the field.
  const [editing, setEditing] = useState(!value);
  useEffect(() => {
    setText(value ?? "");
    setEditing(!value);
  }, [value]);
  const id = `bp-pack-${service}`;
  const folderId = value?.match(/\/folders\/([A-Za-z0-9_-]+)/)?.[1] ?? "";
  const short =
    folderId.length > 16
      ? `…/folders/${folderId.slice(0, 11)}…${folderId.slice(-4)}`
      : `…/folders/${folderId}`;
  const trimmed = text.trim();
  const dirty = trimmed !== (value ?? "");
  const valid = trimmed === "" || DRIVE_FOLDER.test(trimmed);
  const view = value ? folderView(value) : null;

  async function save() {
    if (!valid) {
      setError(
        "Paste the folder's link from Drive: drive.google.com/drive/folders/…",
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onSaved(await io.set(`pack.${service}`, trimmed || null));
      toast.success(trimmed ? `${label} pack saved` : `${label} pack removed`);
    } catch (e) {
      setError(e instanceof Error ? e.message : problem(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="space-y-1.5">
      <div className="grid gap-x-3 gap-y-1.5 sm:grid-cols-[11rem_minmax(0,1fr)_auto] sm:items-center">
        {value && !editing ? (
          <span className="text-sm font-medium">{label}</span>
        ) : (
          <label htmlFor={id} className="text-sm font-medium">
            {label}
          </label>
        )}
        {value && !editing ? (
          <a
            href={value}
            target="_blank"
            rel="noreferrer"
            title={value}
            aria-describedby={`${id}-line`}
            className="inline-flex min-w-0 items-center gap-1 truncate font-mono text-xs text-primary underline-offset-4 hover:underline"
          >
            {short}
            <span aria-hidden>↗</span>
          </a>
        ) : (
          <Input
            id={id}
            value={text}
            disabled={!canEdit || busy}
            placeholder="https://drive.google.com/drive/folders/…"
            aria-invalid={!valid}
            aria-describedby={`${id}-line`}
            onChange={e => {
              setText(e.target.value);
              setError(null);
            }}
            onKeyDown={e => {
              if (e.key === "Enter" && dirty) void save();
              if (e.key === "Escape" && value) {
                setText(value);
                setEditing(false);
              }
            }}
            className="h-8 font-mono text-xs md:text-xs"
          />
        )}
        <div className="flex items-center gap-2">
          {canEdit && value && !editing ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setEditing(true);
                setTimeout(() => document.getElementById(id)?.focus(), 0);
              }}
            >
              Change
            </Button>
          ) : null}
          {canEdit && editing && dirty ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void save()}
            >
              {busy ? "Saving…" : trimmed || !value ? "Save" : "Remove"}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            disabled={!view}
            aria-expanded={preview}
            aria-controls={`${id}-preview`}
            onClick={() => setPreview(p => !p)}
          >
            {preview ? "Hide" : "Preview"}
          </Button>
        </div>
      </div>
      <p
        id={`${id}-line`}
        className={cn(
          "text-xs sm:pl-[11.75rem]",
          error || !valid ? "txt-bad" : "text-muted-foreground",
        )}
      >
        {error ??
          (!valid
            ? "That is not a Drive folder link."
            : value
              ? (changed ?? "Set")
              : "Not set: part 1 asks for the link on the call.")}
      </p>
      {preview && view ? (
        <div id={`${id}-preview`} className="sm:pl-[11.75rem]">
          <iframe
            title={`${label} starter pack, as Drive shows it`}
            src={view}
            sandbox="allow-scripts allow-same-origin allow-popups"
            loading="lazy"
            className="h-[300px] w-full max-w-[480px] rounded-lg border bg-white"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            A blank or sign-in frame means the folder is not shared as Anyone
            with the link.
          </p>
        </div>
      ) : null}
    </li>
  );
}

function LaunchBuyer({
  settings,
  io,
  onSaved,
  initialMembers,
}: {
  settings: Settings;
  io: SettingsIO;
  onSaved: (s: Settings) => void;
  initialMembers?: { id: string; name: string }[];
}) {
  const current = settings.assignee;
  const [members, setMembers] = useState<
    { id: string; name: string }[] | { error: string } | null
  >(initialMembers ?? null);
  const [pick, setPick] = useState(current?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setPick(current?.id ?? ""), [current?.id]);

  const canEdit = settings.can.packs;
  useEffect(() => {
    if (!canEdit || initialMembers) return;
    let gone = false;
    io.members().then(
      m => !gone && setMembers(m),
      e =>
        !gone &&
        setMembers({ error: e instanceof Error ? e.message : problem(e) }),
    );
    return () => {
      gone = true;
    };
  }, [io, canEdit, initialMembers]);

  const list = Array.isArray(members) ? members : [];
  const options =
    current && !list.some(m => m.id === current.id)
      ? [
          { id: current.id, name: current.label ?? `Member ${current.id}` },
          ...list,
        ]
      : list;

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const m = options.find(x => x.id === pick);
      onSaved(
        await io.set(
          "launch_assignee",
          pick || null,
          pick ? (m?.name ?? null) : null,
        ),
      );
      toast.success(
        pick ? "Launch media buyer saved" : "Launch media buyer cleared",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : problem(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Group
      title="Launch media buyer"
      hint="Send to media assigns the new launch task on Marketing/ADs to this person, which posts it to #client-ads-general and notifies them."
    >
      <div className="flex flex-wrap items-center gap-2">
        <AnimatedSelect
          aria-label="Launch media buyer"
          value={pick}
          disabled={!canEdit || busy || members === null}
          onChange={e => setPick(e.target.value)}
          className="is-compact h-8 min-w-56 rounded-md border bg-transparent px-2 text-xs"
        >
          <option value="">Nobody (unassigned)</option>
          {options.map(m => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </AnimatedSelect>
        {canEdit ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy || pick === (current?.id ?? "")}
            onClick={() => void save()}
          >
            {busy ? "Saving…" : "Save"}
          </Button>
        ) : null}
      </div>
      <p
        className={cn(
          "text-xs",
          error || (!Array.isArray(members) && members)
            ? "txt-bad"
            : "text-muted-foreground",
        )}
      >
        {error ??
          (members && !Array.isArray(members)
            ? `The Marketing/ADs list could not be read: ${members.error}`
            : current
              ? (changedLine(settings, "launch_assignee") ?? "Set")
              : canEdit && members === null
                ? "Reading the Marketing/ADs members…"
                : "Not set: launch tasks go out unassigned, so nobody is pinged.")}
      </p>
    </Group>
  );
}

function CloseSwitch({
  settings,
  io,
  onSaved,
}: {
  settings: Settings;
  io: SettingsIO;
  onSaved: (s: Settings) => void;
}) {
  const [busy, setBusy] = useState<CloseRoute | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canEdit = settings.can.closeRoute;
  const current = settings.closeRoute;

  async function choose(route: CloseRoute) {
    if (!canEdit || route === current) return;
    setBusy(route);
    setError(null);
    try {
      onSaved(await io.set("close_route", route));
      toast.success("Saved what happens after Close the call");
    } catch (e) {
      setError(e instanceof Error ? e.message : problem(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Group
      title="After Close the call"
      hint={
        canEdit
          ? "Who tells the media team, writes the card's last two fields and sends the phase 5 WhatsApp."
          : "Who tells the media team and sends the phase 5 WhatsApp. Only an admin or the CEO changes this."
      }
    >
      {canEdit ? (
        <fieldset className="space-y-2" disabled={busy !== null}>
          <legend className="sr-only">After Close the call</legend>
          {CLOSE_ROUTES.map(r => {
            const on = r.key === current;
            return (
              <label
                key={r.key}
                className={cn(
                  "flex gap-3 rounded-lg border px-3 py-2.5",
                  on
                    ? "border-primary/60 bg-accent/40"
                    : "cursor-pointer hover:bg-muted/40",
                )}
              >
                <input
                  type="radio"
                  name="bp-close-route"
                  value={r.key}
                  checked={on}
                  onChange={() => void choose(r.key)}
                  className="mt-1 size-4 shrink-0 accent-[var(--primary)]"
                />
                <RouteText
                  label={r.label}
                  line={r.line}
                  on={on}
                  busy={busy === r.key}
                />
              </label>
            );
          })}
        </fieldset>
      ) : (
        // Read only for the creative director: the three, the current one marked.
        <ul className="space-y-2" aria-label="After Close the call">
          {CLOSE_ROUTES.map(r => {
            const on = r.key === current;
            return (
              <li
                key={r.key}
                aria-current={on ? "true" : undefined}
                className={cn(
                  "flex gap-3 rounded-lg border px-3 py-2.5",
                  on ? "border-primary/60 bg-accent/40" : "opacity-70",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "mt-1 grid size-4 shrink-0 place-items-center rounded-full border",
                    on ? "border-primary" : "border-muted-foreground/50",
                  )}
                >
                  {on ? (
                    <span className="size-2 rounded-full bg-primary" />
                  ) : null}
                </span>
                <RouteText label={r.label} line={r.line} on={on} busy={false} />
              </li>
            );
          })}
        </ul>
      )}
      {error ? (
        <p role="alert" className="text-xs txt-bad">
          {error}
        </p>
      ) : changedLine(settings, "close_route") ? (
        <p className="text-xs text-muted-foreground">
          {changedLine(settings, "close_route")}
        </p>
      ) : null}
    </Group>
  );
}

function RouteText({
  label,
  line,
  on,
  busy,
}: {
  label: string;
  line: string;
  on: boolean;
  busy: boolean;
}) {
  return (
    <span className="min-w-0">
      <span className="text-sm font-medium">
        {label}
        {on || busy ? (
          <span className="ml-2 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
            {busy ? "Saving…" : "Now"}
          </span>
        ) : null}
      </span>
      <span className="mt-0.5 block text-xs text-muted-foreground">{line}</span>
    </span>
  );
}
