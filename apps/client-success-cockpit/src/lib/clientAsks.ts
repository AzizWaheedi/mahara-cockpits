import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

/**
 * Review and referral asks shown in the client's Mahara OS portal
 * (docs/client-asks/PLAN.md, supabase/migrations/20261029170000_client_asks.sql).
 * Three gated RPCs through the signed-in seat's own client; the database
 * checks the client gate, keeps one open ask of each kind and writes every
 * event and audit row. The portal reads the same rows with its server key.
 */

export type AskKind = "review" | "referral";

const text = z.string();
const event = z.object({
  at: text,
  source: z.enum(["cockpit", "portal", "push"]),
  event: z.enum([
    "asked",
    "withdrawn",
    "push",
    "shown",
    "opened",
    "later",
    "no",
    "done",
  ]),
  person: text.nullable(),
  detail: z.record(text, z.unknown()),
});
const ask = z.object({
  id: text,
  kind: z.enum(["review", "referral"]),
  state: z.enum(["open", "done", "withdrawn", "expired"]),
  note: text.nullable(),
  link: text,
  push: z.boolean(),
  pushState: z.enum([
    "off",
    "waiting",
    "sending",
    "sent",
    "no_device",
    "failed",
  ]),
  pushResult: z.record(text, z.unknown()).nullable(),
  pushAt: text.nullable(),
  askedAt: text,
  askedBy: text,
  closedAt: text.nullable(),
  closedBy: text.nullable(),
  events: z.array(event),
});
const view = z.object({
  taskId: text,
  clientName: text,
  workspace: z
    .object({
      locationId: text,
      name: text.nullable(),
      status: text.nullable(),
    })
    .nullable(),
  problem: z
    .enum(["no_workspace", "two_workspaces", "workspace_closed"])
    .nullable(),
  links: z.object({ review: text, referral: text }),
  asks: z.array(ask),
  now: text,
});

export type AskEvent = z.infer<typeof event>;
export type ClientAsk = z.infer<typeof ask>;
export type ClientAsksView = z.infer<typeof view>;

type Rpc = Pick<SupabaseClient, "rpc">;

async function call(
  client: Rpc | null,
  name: string,
  args: Record<string, unknown>,
): Promise<ClientAsksView> {
  if (!client) throw Error("Sign in to the cockpit first.");
  const { data, error } = await client.rpc(name, args);
  if (error) throw Error(error.message);
  const parsed = view.safeParse(data);
  if (!parsed.success)
    throw Error("The asks came back in a shape this screen does not know.");
  return parsed.data;
}

export const readClientAsks = (client: Rpc | null, taskId: string) =>
  call(client, "cockpit_csm_client_asks_read", { p_task_id: taskId });

export const sendClientAsk = (
  client: Rpc | null,
  a: {
    taskId: string;
    kind: AskKind;
    note: string;
    push: boolean;
    requestId: string;
  },
) =>
  call(client, "cockpit_csm_client_ask_send", {
    p_task_id: a.taskId,
    p_kind: a.kind,
    p_note: a.note.trim() || null,
    p_push: a.push,
    p_request_id: a.requestId,
  });

export const withdrawClientAsk = (
  client: Rpc | null,
  taskId: string,
  askId: string,
) =>
  call(client, "cockpit_csm_client_ask_withdraw", {
    p_task_id: taskId,
    p_ask_id: askId,
  });

/** The client's newest ask of a kind, and how many came before it. */
export function latestAsk(
  v: ClientAsksView | null,
  kind: AskKind,
): { ask: ClientAsk | null; earlier: number } {
  const all = (v?.asks ?? []).filter(a => a.kind === kind);
  return { ask: all[0] ?? null, earlier: Math.max(0, all.length - 1) };
}

/** A day in Kuwait, as the team reads it: "29 Oct". */
export function kwDay(at: string | null | undefined): string {
  if (!at || Number.isNaN(Date.parse(at))) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Kuwait",
  }).format(new Date(at));
}

const TARGET: Record<string, string> = {
  google: "opened Google",
  programme: "opened the programme",
  whatsapp: "opened WhatsApp",
  email: "opened an email to us",
};

/** One line per thing a person in the client's team did, newest first. */
export function clientSteps(a: ClientAsk): { key: string; line: string }[] {
  return a.events
    .filter(e => e.source === "portal")
    .map((e, i) => {
      const who = e.person ?? "Someone";
      const what =
        e.event === "shown"
          ? "saw it"
          : e.event === "opened"
            ? (TARGET[String(e.detail.target)] ?? "opened the link")
            : e.event === "later"
              ? "chose Not now"
              : e.event === "no"
                ? "chose No thanks"
                : "said they posted it";
      const via = e.detail.via === "push" ? " from the phone alert" : "";
      return {
        key: `${e.at}-${i}`,
        line: `${who} ${what}${via}, ${kwDay(e.at)}`,
      };
    })
    .reverse();
}

/** The ask's state in one plain line and a tone for its dot. */
export function askStatus(a: ClientAsk): {
  line: string;
  tone: "good" | "warn" | "bad" | "neutral" | "accent";
} {
  const portal = a.events.filter(e => e.source === "portal");
  if (a.state === "done")
    return {
      line: `They said they posted it, ${kwDay(a.closedAt)}`,
      tone: "good",
    };
  if (a.state === "withdrawn")
    return { line: `Withdrawn ${kwDay(a.closedAt)}`, tone: "neutral" };
  if (a.state === "expired")
    return { line: "Closed after 30 days", tone: "neutral" };
  if (portal.some(e => e.event === "opened"))
    return { line: "Opened, waiting on them", tone: "accent" };
  if (portal.some(e => e.event === "shown"))
    return { line: "Seen in their portal", tone: "accent" };
  return { line: "Not seen yet", tone: "warn" };
}

/** What happened to the phone alert, never a bare zero. */
export function pushLine(a: ClientAsk): string {
  const r = a.pushResult ?? {};
  const n = (k: string) => (typeof r[k] === "number" ? (r[k] as number) : 0);
  switch (a.pushState) {
    case "off":
      return r.reason === "ask_closed_first"
        ? "No phone alert: the ask closed before it went out"
        : "No phone alert";
    case "waiting":
    case "sending":
      return "Phone alert going out within 5 minutes";
    case "sent":
      return `Phone alert sent to ${n("accepted")} of ${n("devices")} ${n("devices") === 1 ? "device" : "devices"}`;
    case "no_device":
      return "No phone alert: nobody there has task alerts on";
    case "failed":
      return r.reason === "not_sent_within_a_day"
        ? "Phone alert not sent within a day, so it was dropped"
        : "Phone alert failed";
  }
}
