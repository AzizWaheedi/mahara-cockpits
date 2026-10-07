// Slack's three kinds of request to the "Mahara Sales" app, read into one
// shape, and the live.press body sales-api receives for each. Pure functions.
//
// - Slash commands (form-encoded): /available, /unavailable (and /away,
//   in case the command was registered under F's first name for it).
// - Interactivity (form-encoded, a JSON `payload`): block_actions only.
// - Events API (JSON): url_verification, and event_callback for
//   app_home_opened only.

import { sha256Hex } from "./sign.ts";
import { stripControl } from "./util.ts";

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj =>
  Boolean(x) && typeof x === "object" && !Array.isArray(x);

function str(x: unknown, max: number): string | undefined {
  if (typeof x !== "string") return undefined;
  const t = stripControl(x).trim();
  return t ? t.slice(0, max) : undefined;
}

const USER = /^[UW][A-Z0-9]{2,30}$/;
const VIEW = /^V[A-Z0-9]{2,30}$/;
const TEAM = /^[TE][A-Z0-9]{2,30}$/;

const userId = (x: unknown) => {
  const s = str(x, 40);
  return s && USER.test(s) ? s : undefined;
};
const teamId = (x: unknown) => {
  const s = str(x, 40);
  return s && TEAM.test(s) ? s : undefined;
};

/** Slack's reply address, only when it is Slack's own host. */
export function safeResponseUrl(x: unknown): string | undefined {
  const s = str(x, 500);
  if (!s) return undefined;
  try {
    const u = new URL(s);
    return u.protocol === "https:" && u.hostname === "hooks.slack.com"
      ? u.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

export const COMMANDS: Record<string, "available" | "away"> = {
  "/available": "available",
  "/unavailable": "away",
  "/away": "away",
};

export type SlackAction = { action_id: string; block_id?: string; value?: string };

export type SlackInbound =
  | { type: "url_verification"; challenge: string }
  | { type: "ssl_check" }
  | {
      type: "command";
      command: "available" | "away" | null;
      raw_command: string;
      user_id?: string;
      team_id?: string;
      response_url?: string;
      trigger_id?: string;
      text?: string;
    }
  | {
      type: "block_actions";
      user_id?: string;
      team_id?: string;
      response_url?: string;
      trigger_id?: string;
      channel_id?: string;
      message_ts?: string;
      /** Where the button was: "message", "view" (App Home or a modal), "ephemeral_message". */
      container_type?: string;
      /** The App Home view the button was on, so live.press can publish it again. */
      view_id?: string;
      actions: SlackAction[];
    }
  | {
      type: "event";
      event_type: string;
      user_id?: string;
      team_id?: string;
      event_id?: string;
      tab?: string;
    }
  | { type: "ignored"; reason: string };

/** Reads a verified Slack body. Never throws. */
export function parseSlack(contentType: string, raw: string): SlackInbound {
  const ct = contentType.toLowerCase();
  if (ct.includes("application/json")) {
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return { type: "ignored", reason: "not JSON" };
    }
    if (!isObj(body)) return { type: "ignored", reason: "not an object" };
    if (body.type === "url_verification") {
      const challenge = str(body.challenge, 200);
      return challenge
        ? { type: "url_verification", challenge }
        : { type: "ignored", reason: "no challenge" };
    }
    if (body.type === "event_callback" && isObj(body.event)) {
      const ev = body.event;
      const eventType = str(ev.type, 60) ?? "";
      if (eventType !== "app_home_opened")
        return { type: "ignored", reason: `event ${eventType || "unknown"}` };
      return {
        type: "event",
        event_type: eventType,
        user_id: userId(ev.user),
        team_id: teamId(body.team_id),
        event_id: str(body.event_id, 60),
        tab: str(ev.tab, 20),
      };
    }
    return { type: "ignored", reason: `type ${String(body.type ?? "unknown")}` };
  }

  const form = new URLSearchParams(raw);
  if (form.get("ssl_check") === "1") return { type: "ssl_check" };
  const payloadText = form.get("payload");
  if (payloadText !== null) {
    let p: unknown;
    try {
      p = JSON.parse(payloadText);
    } catch {
      return { type: "ignored", reason: "payload is not JSON" };
    }
    if (!isObj(p)) return { type: "ignored", reason: "payload is not an object" };
    if (p.type !== "block_actions")
      return { type: "ignored", reason: `interaction ${String(p.type ?? "unknown")}` };
    const user = isObj(p.user) ? p.user : {};
    const team = isObj(p.team) ? p.team : {};
    const channel = isObj(p.channel) ? p.channel : {};
    const message = isObj(p.message) ? p.message : {};
    const container = isObj(p.container) ? p.container : {};
    const view = isObj(p.view) ? p.view : {};
    const containerType = str(container.type, 30);
    const viewId = str(view.id, 40) ?? str(container.view_id, 40);
    const actions: SlackAction[] = (Array.isArray(p.actions) ? p.actions : [])
      .slice(0, 5)
      .filter(isObj)
      .map(a => ({
        action_id: str(a.action_id, 255) ?? "",
        block_id: str(a.block_id, 255),
        value: str(a.value, 2000),
      }))
      .filter(a => a.action_id);
    if (!actions.length) return { type: "ignored", reason: "no actions" };
    return {
      type: "block_actions",
      user_id: userId(user.id),
      team_id: teamId(team.id) ?? teamId(user.team_id),
      response_url: safeResponseUrl(p.response_url),
      trigger_id: str(p.trigger_id, 120),
      channel_id: str(channel.id, 40),
      message_ts: str(message.ts, 40) ?? str(container.message_ts, 40),
      container_type: containerType && /^[a-z_]+$/.test(containerType) ? containerType : undefined,
      view_id: viewId && VIEW.test(viewId) ? viewId : undefined,
      actions,
    };
  }

  const rawCommand = str(form.get("command"), 40);
  if (rawCommand) {
    return {
      type: "command",
      command: COMMANDS[rawCommand.toLowerCase()] ?? null,
      raw_command: rawCommand,
      user_id: userId(form.get("user_id")),
      team_id: teamId(form.get("team_id")),
      response_url: safeResponseUrl(form.get("response_url")),
      trigger_id: str(form.get("trigger_id"), 120),
      text: str(form.get("text"), 200),
    };
  }
  return { type: "ignored", reason: "unknown form" };
}

/** A UUID-shaped id that is the same for every retry of one Slack request. */
export async function stableRequestId(seed: string): Promise<string> {
  const h = await sha256Hex(`slack:${seed}`);
  const variant = ((Number.parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export type Press = Record<string, unknown> & { action: "live.press"; kind: string };

/** The live.press body for a request sales-api should act on, or null. */
export async function pressFor(
  inbound: SlackInbound,
  nowMs: number,
): Promise<Press | null> {
  if (inbound.type === "command") {
    if (!inbound.command || !inbound.user_id) return null;
    return {
      action: "live.press",
      kind: "command",
      command: inbound.command,
      request_id: await stableRequestId(
        inbound.trigger_id ?? `${inbound.user_id}:${inbound.command}:${Math.floor(nowMs / 1000)}`,
      ),
      slack_user_id: inbound.user_id,
      slack_team_id: inbound.team_id ?? null,
      response_url: inbound.response_url ?? null,
      text: inbound.text ?? null,
    };
  }
  if (inbound.type === "block_actions") {
    if (!inbound.user_id) return null;
    return {
      action: "live.press",
      kind: "block_actions",
      request_id: await stableRequestId(
        inbound.trigger_id ?? `${inbound.user_id}:${inbound.message_ts ?? ""}:${inbound.actions[0].action_id}`,
      ),
      slack_user_id: inbound.user_id,
      slack_team_id: inbound.team_id ?? null,
      response_url: inbound.response_url ?? null,
      channel_id: inbound.channel_id ?? null,
      message_ts: inbound.message_ts ?? null,
      container_type: inbound.container_type ?? null,
      view_id: inbound.view_id ?? null,
      actions: inbound.actions,
    };
  }
  if (inbound.type === "event") {
    if (!inbound.user_id) return null;
    return {
      action: "live.press",
      kind: inbound.event_type,
      request_id: await stableRequestId(
        inbound.event_id ?? `${inbound.user_id}:${inbound.event_type}:${Math.floor(nowMs / 1000)}`,
      ),
      slack_user_id: inbound.user_id,
      slack_team_id: inbound.team_id ?? null,
      event_id: inbound.event_id ?? null,
      tab: inbound.tab ?? null,
    };
  }
  return null;
}

/**
 * Who answers a press in Slack (the contract with sales-api's live.press):
 * - live.press posts its own success (through response_url, or for an App
 *   Home press by publishing the Home view again with view_id);
 * - on a refusal it posts nothing and answers 4xx {ok: false, error}; the
 *   door then says that sentence to the person, once;
 * - when sales-api cannot be reached or fails, the door says
 *   SLACK_COPY.didNotGoThrough.
 * A press with no response_url (App Home has none) is answered through a
 * `slack.reply` room event that the VPS Slack poster sends as a DM.
 */

/** What the person sees when their press could not reach sales-api. */
export const SLACK_COPY = {
  unknownCommand:
    "The sales app knows two commands: /available and /unavailable.",
  notSetUp:
    "The sales app is not set up yet. Tell the manager: sales-live is missing CRON_SECRET or its database key.",
  didNotGoThrough:
    "That did not go through. Try again in a minute, or use the cockpit.",
} as const;
