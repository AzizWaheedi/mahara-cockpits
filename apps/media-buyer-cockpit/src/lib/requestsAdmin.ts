/**
 * Requests settings: wrappers for the editor functions of CONTRACT.md 2.5
 * (types, versions, people, seat links) and the alert rules of 3.3. The
 * database gates every one (cockpit_forms_editor_gate, or the seat's own
 * rules); a refusal comes back as its sentence. Portal only.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { callRequests } from "@/lib/requestsClient";
import type {
  FieldSpec,
  Priority,
  TargetSpec,
  TypeView,
} from "@/lib/requestsCore";

/** The keys cockpit_request_type_save takes (2.5); any other refuses. */
export type TypePatch = Partial<{
  label: string;
  targets: TargetSpec[];
  fields: FieldSpec[];
  sop_steps: string[] | null;
  sop_url: string | null;
  due_days: number;
  priority: Priority;
  set_request_type: boolean;
  enabled: boolean;
}>;

export type TypeVersion = {
  version: number;
  savedAt: string;
  savedByLabel: string;
  note: string | null;
};

export type ClickupPerson = {
  clickupUserId: number;
  label: string;
  seat: { memberId: string; label: string } | null;
};

export type SeatLinkState =
  | "ok"
  | "manual"
  | "not_found"
  | "ambiguous"
  | "cleared";

export type SeatLink = {
  memberId: string;
  label: string;
  roles: string[];
  link: {
    state: SeatLinkState;
    clickupUserId: number | null;
    username: string | null;
    matchedBy: "email" | "editor";
    note: string | null;
    checkedAt: string;
  } | null;
};

export type SeatLinksRead = {
  readAt: string | null;
  seats: SeatLink[];
  members: {
    clickupUserId: number;
    username: string;
    linkedTo: string | null;
  }[];
};

export const ALERT_KINDS = [
  "assigned",
  "due_today",
  "overdue",
  "comment",
  "mention",
  "status",
  "request_done",
  "request_failed",
] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

export type AlertRulesRead = {
  member: { id: string; label: string };
  rules: {
    kinds: AlertKind[];
    shiftStart: string | null;
    shiftEnd: string | null;
    slackDm: boolean;
  };
  shift: {
    source: "rules" | "schedule" | "default";
    start: string | null;
    end: string | null;
    days: string[] | string | null;
  };
  seats?: { memberId: string; label: string }[];
  canEditOthers: boolean;
};

export type AlertRulesPatch = Partial<{
  kinds: AlertKind[];
  shiftStart: string | null;
  shiftEnd: string | null;
}>;

/** Saves a type; refuses when someone saved since `expectedVersion`. */
export const saveRequestType = (
  client: SupabaseClient,
  key: string,
  patch: TypePatch,
  expectedVersion: number,
) =>
  callRequests<TypeView>(client, "cockpit_request_type_save", {
    p_key: key,
    p_patch: patch,
    p_expected_version: expectedVersion,
  });

export const readTypeVersions = (client: SupabaseClient, key: string) =>
  callRequests<{ versions: TypeVersion[] }>(
    client,
    "cockpit_request_type_versions",
    { p_key: key },
  );

/** Writes an older version back as a new one. */
export const restoreRequestType = (
  client: SupabaseClient,
  key: string,
  version: number,
  expectedVersion: number,
) =>
  callRequests<TypeView>(client, "cockpit_request_type_restore", {
    p_key: key,
    p_version: version,
    p_expected_version: expectedVersion,
  });

/** The ClickUp members an editor may name as an owner. */
export const readRequestPeople = (client: SupabaseClient) =>
  callRequests<{ people: ClickupPerson[] }>(client, "cockpit_request_people");

export const readSeatLinks = (client: SupabaseClient) =>
  callRequests<SeatLinksRead>(client, "cockpit_member_clickup_read");

/** Links a seat to a ClickUp user; null clears the link for good. */
export const setSeatLink = (
  client: SupabaseClient,
  memberId: string,
  clickupUserId: number | null,
) =>
  callRequests<SeatLink>(client, "cockpit_member_clickup_set", {
    p_member_id: memberId,
    p_clickup_user_id: clickupUserId,
  });

/** A seat's alert rules: its own, or another seat's for an editor. */
export const readAlertRules = (
  client: SupabaseClient,
  memberId: string | null = null,
) =>
  callRequests<AlertRulesRead>(client, "cockpit_task_alert_rules_read", {
    p_member_id: memberId,
  });

export const setAlertRules = (
  client: SupabaseClient,
  memberId: string,
  patch: AlertRulesPatch,
) =>
  callRequests<AlertRulesRead>(client, "cockpit_task_alert_rules_set", {
    p_member_id: memberId,
    p_patch: patch,
  });

/** The alert kinds in words, in the order the settings list them. */
export const ALERT_KIND_WORDS: Record<
  AlertKind,
  { label: string; hint: string }
> = {
  assigned: {
    label: "A task assigned to you",
    hint: "When a ClickUp task gets your name.",
  },
  due_today: {
    label: "Tasks due today",
    hint: "One alert at the start of your shift.",
  },
  overdue: {
    label: "A task that is late",
    hint: "Once for each late task, at the start of your shift.",
  },
  comment: {
    label: "A comment on your task",
    hint: "When someone else comments on a task assigned to you.",
  },
  mention: {
    label: "A mention",
    hint: "When someone tags you in a comment, on any task.",
  },
  status: {
    label: "Your task moved",
    hint: "When someone else changes its status.",
  },
  request_done: {
    label: "A request of yours is done",
    hint: "When its ClickUp task is complete or closed.",
  },
  request_failed: {
    label: "A failed request",
    hint: "When a request of yours did not reach ClickUp.",
  },
};

/** How a seat's ClickUp link was made, in words (6.4). */
export function linkHow(link: SeatLink["link"]): string {
  if (!link) return "Not checked yet";
  switch (link.state) {
    case "ok":
      return "Matched by email";
    case "manual":
      return "Set by hand";
    case "not_found":
      return "No match by email";
    case "ambiguous":
      return "Two matches by email";
    case "cleared":
      return "Cleared by hand";
  }
  return "Not checked yet";
}

/** The rule picker's words (6.4). */
export const OWNER_RULE_WORDS: Record<TargetSpec["owner_rule"], string> = {
  csm_of_card: "The client's CSM",
  systems_manager: "The systems manager",
  creative_strategist: "The creative strategist",
  media_buyer_of_record: "The media buyer of record",
  person: "A named person",
};
