/**
 * Tasks the team gives a client in their Mahara OS portal (Aziz, 2026-10-06:
 * "the form that the team fills out to add a task to the client's portal for
 * the client to do should be integrated as well into the client cockpit").
 *
 * The form is ClickUp's own, "Assign a client task | Mahara OS" (form view
 * 2kzmr1ky-7138), and the cockpit opens it as it is: a submission is a task
 * on the Client Portal Tasks list, and the portal publishes it only when the
 * task carries exactly one client tag. ClickUp cannot prefill tags from a
 * link (only hidden custom fields), so the cockpit names the tag to pick and
 * lists the tasks the client already has. No I/O here.
 */

// biome-ignore lint/suspicious/noExplicitAny: ClickUp bodies are untyped
type Any = any;

export const PORTAL_FORM_URL =
  "https://forms.clickup.com/90182518398/f/2kzmr1ky-7138/OFH93R3P8KGRIC1KVE";
/** Client Portal Tasks, in All Assignments, Team - Maharamedia. */
export const PORTAL_LIST_ID = "1100530000000279";
/** The space whose tags are the clients (Team - Maharamedia). */
export const TEAM_SPACE_ID = "901810248115";

const F = {
  requestType: "8e4ad7d7-fabf-4fd2-a08d-13c6ac2bda12",
  publish: "74518115-b491-42f4-bdec-3eec98f1b629",
} as const;

/**
 * A name as ClickUp's tag picker shows it: lower case, single spaces, and
 * Arabic presentation forms folded (a card can say "لﻺ" where the tag says
 * "لإ", and both are the same word).
 */
export function tagKey(name: string): string {
  return String(name ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** The client's tag, as ClickUp spells it, or null when the space has none for them. */
export function tagFor(
  clientName: string,
  tags: { name?: string }[],
): string | null {
  const want = tagKey(clientName);
  if (!want) return null;
  const hit = tags.find(t => tagKey(t.name ?? "") === want);
  return hit?.name ? String(hit.name) : null;
}

export type PortalTask = {
  id: string;
  name: string;
  status: string;
  done: boolean;
  due: string | null;
  requestType: string | null;
  published: boolean;
  url: string | null;
};

/** One task from the list, as the CSM reads it. */
export function portalTask(t: Any): PortalTask {
  const cf = new Map<string, Any>(
    ((t?.custom_fields ?? []) as Any[]).map(f => [String(f.id), f]),
  );
  const rt = cf.get(F.requestType);
  const option = ((rt?.type_config?.options ?? []) as Any[]).find(
    o =>
      rt?.value !== undefined &&
      rt?.value !== null &&
      (Number(o.orderindex) === Number(rt.value) ||
        String(o.id) === String(rt.value)),
  );
  const status = String(t?.status?.status ?? "");
  const published = cf.get(F.publish)?.value;
  return {
    id: String(t?.id ?? ""),
    name: String(t?.name ?? "").trim(),
    status,
    done:
      /^(complete|cancelled|closed)$/i.test(status) ||
      t?.status?.type === "closed",
    due: Number(t?.due_date)
      ? new Date(Number(t.due_date)).toISOString()
      : null,
    requestType: option?.name ? String(option.name) : null,
    published: published === true || published === "true",
    url: t?.url ? String(t.url) : null,
  };
}

/** Open ones first, by due date; finished ones after, newest first. */
export function sortPortalTasks(tasks: PortalTask[]): PortalTask[] {
  return [...tasks].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    const ad = a.due ? Date.parse(a.due) : Number.POSITIVE_INFINITY;
    const bd = b.due ? Date.parse(b.due) : Number.POSITIVE_INFINITY;
    return a.done ? bd - ad : ad - bd;
  });
}
