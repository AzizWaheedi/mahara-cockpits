import type { SupabaseClient } from "@supabase/supabase-js";

// biome-ignore lint/suspicious/noExplicitAny: gap payloads
type Any = any;

export type Gap = { gap: string; label: string; fix: string };

function kuwaitToday(): string {
  return new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

export function gapsFor(client: Any, profile: Any | undefined): Gap[] {
  if (Array.isArray(profile?.gaps)) {
    const out: Gap[] = profile.gaps.map((g: Any) => ({
      gap: String(g.gap),
      label: String(g.label),
      fix: String(g.fix),
    }));
    if (!client?.csmAssigned && !client?.csm) {
      out.push({
        gap: "csm",
        label: "No CSM on the card",
        fix: "Set the CSM field on the client task in ClickUp.",
      });
    }
    return out;
  }
  const gaps: Gap[] = [];
  if (!client?.sheetLink) {
    gaps.push({
      gap: "sheet_link",
      label: "No stat sheet on the ClickUp card",
      fix: "Paste the client's stat sheet URL into the Sheet Link field on the client task.",
    });
  } else if (profile?.performance?.error) {
    gaps.push({
      gap: "sheet_access",
      label: "Stat sheet cannot be read",
      fix: `Share the sheet with claude@studied-handler-508106-m5.iam.gserviceaccount.com (viewer). Last error: ${String(profile.performance.error).slice(0, 120)}`,
    });
  }
  if (!profile?.ghlName) {
    gaps.push({
      gap: "ghl",
      label: "GHL sub-account not readable: no token on the Client Data row",
      fix: "In the database sheet, Client Data tab, paste the sub-account's private integration token (pit-…) in the token column of this client's row. The location id is usually already there.",
    });
  } else if (profile?.lost?.error) {
    gaps.push({
      gap: "ghl_error",
      label: "GHL sub-account cannot be read",
      fix: `Check the token on the Client Data tab. Last error: ${String(profile.lost.error).slice(0, 120)}`,
    });
  }
  if (!profile?.calls?.length) {
    gaps.push({
      gap: "call",
      label: "No recorded call in 30 days",
      fix: "Book a check-in and record it with Fathom, or share the recording that exists.",
    });
  }
  if (!client?.csmAssigned && !client?.csm) {
    gaps.push({
      gap: "csm",
      label: "No CSM on the card",
      fix: "Set the CSM field on the client task in ClickUp.",
    });
  }
  return gaps;
}

export async function fetchBacklog(
  client: SupabaseClient,
  allowedClients?: string[] | null,
): Promise<{
  rows: Any[];
  counts: Record<string, number>;
  activeClients: number;
}> {
  const { data: profiles, error: pErr } = await client
    .from("cockpit_client_profiles")
    .select("*")
    .order("client_name", { ascending: true });

  if (pErr) throw pErr;

  const scopeSet =
    allowedClients && allowedClients.length > 0
      ? new Set(allowedClients.map(c => c.toLowerCase()))
      : null;

  const filteredProfiles = (profiles ?? []).filter(
    p => !scopeSet || scopeSet.has((p.client_name || "").toLowerCase()),
  );

  const { data: queuedItems } = await client
    .from("cockpit_plan_items")
    .select("*")
    .eq("role", "csm");

  const queuedSet = new Set(
    (queuedItems ?? []).map(q => `${q.client_name}:${q.text}`),
  );

  const rows = filteredProfiles
    .map(p => {
      const raw = (p.overview as Any) ?? {};
      const c = {
        name: p.client_name,
        taskId: raw.taskId || p.id,
        bucket: p.stage || raw.bucket || "active",
        csmAssigned: raw.csm || raw.csmAssigned || "",
        sheetLink: raw.sheetLink,
      };
      const gaps = gapsFor(c, p).map(g => {
        const isQueued = queuedSet.has(`${c.name}:Fix: ${g.label}`);
        return {
          ...g,
          queued: isQueued,
          sent: false,
          resultUrl: undefined,
          error: undefined,
        };
      });
      return {
        clientName: c.name,
        taskId: c.taskId,
        bucket: c.bucket,
        csm: c.csmAssigned,
        gaps,
      };
    })
    .filter(r => r.gaps.length > 0)
    .sort(
      (a, b) =>
        b.gaps.length - a.gaps.length ||
        a.clientName.localeCompare(b.clientName),
    );

  const counts: Record<string, number> = {};
  for (const r of rows) {
    for (const g of r.gaps) {
      counts[g.gap] = (counts[g.gap] ?? 0) + 1;
    }
  }

  return {
    rows,
    counts,
    activeClients: filteredProfiles.length,
  };
}

export async function queueGap(
  client: SupabaseClient,
  _userEmail: string,
  args: {
    taskId?: string;
    clientName: string;
    label: string;
    fix: string;
  },
): Promise<void> {
  const day = kuwaitToday();
  const { error } = await client.from("cockpit_plan_items").insert({
    role: "csm",
    day,
    text: `Fix: ${args.label}`.slice(0, 140),
    reason: `Backlog gap: ${args.label} - ${args.fix} (task: ${args.taskId || ""})`,
    client_name: args.clientName,
    list_name: "csm",
  });
  if (error) throw error;
}
