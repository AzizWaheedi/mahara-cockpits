import { SESSION_HOUR_KUWAIT } from "./webinarSql";

export type ReadinessCheck = {
  key: string;
  label: string;
  status: "ready" | "blocked" | "unknown";
  detail: string;
  action: string;
};
export type WebinarReadiness = {
  checkedAt: number | null;
  fresh: boolean;
  status: "ready" | "blocked" | "unknown";
  checks: ReadinessCheck[];
};

const object = (x: unknown): Record<string, unknown> =>
  x !== null && typeof x === "object" && !Array.isArray(x)
    ? (x as Record<string, unknown>)
    : {};
const timestamp = (x: unknown): number | null => {
  if (typeof x !== "string" || !/T.*(Z|[+-]\d{2}:\d{2})$/.test(x)) return null;
  const n = Date.parse(x);
  return Number.isFinite(n) ? n : null;
};
const boolStatus = (x: unknown): ReadinessCheck["status"] =>
  x === true ? "ready" : x === false ? "blocked" : "unknown";

/** Allowlisted worker evidence only. Missing, malformed and stale data never passes. */
export function webinarReadiness(
  snapshot: unknown,
  now: number,
): WebinarReadiness {
  const s = object(snapshot);
  const checkedAt = timestamp(s.checked_at);
  const fresh =
    checkedAt !== null &&
    now - checkedAt >= 0 &&
    now - checkedAt <= 3 * 3600_000;
  const api = object(s.api);
  const zoom = object(s.zoom);
  const page = object(s.page);
  const checks: ReadinessCheck[] = [];
  const add = (check: ReadinessCheck) =>
    checks.push(
      fresh
        ? check
        : {
            ...check,
            status: "unknown",
            detail: "No recent verification. The worker must check this again.",
          },
    );
  const starts = [zoom.start, api.start, page.start].map(timestamp);
  const complete = starts.every((n): n is number => n !== null);
  const agreed = complete && starts.every(n => n === starts[0]);
  const future = agreed && (starts[0] as number) > now;
  const hour = complete ? new Date((starts[0] as number) + 3 * 3600_000) : null;
  const timeMatches =
    hour?.getUTCHours() === SESSION_HOUR_KUWAIT && hour?.getUTCMinutes() === 0;
  add({
    key: "schedule",
    label: "One future session time",
    status: !complete ? "unknown" : future && timeMatches ? "ready" : "blocked",
    detail: !complete
      ? "Could not read the time from Zoom, the registration API and the landing page."
      : !agreed
        ? "Zoom, registration and the landing page disagree about the start."
        : !future
          ? "The scheduled training date has already passed."
          : !timeMatches
            ? `The live start differs from the ${SESSION_HOUR_KUWAIT}:00 Kuwait fallback used for date-only registrations.`
            : "Zoom, registration and the landing page agree on a future start.",
    action:
      "Choose the next date, then update Zoom, the API, page copy and thank-you calendar together. Date-only registrations currently use 8 p.m. Kuwait.",
  });
  add({
    key: "registration",
    label: "Registration can reach HighLevel",
    status: boolStatus(api.ghl_token_set),
    detail:
      api.ghl_token_set === true
        ? "The registration API reports its HighLevel credential is set. A test registration is still required."
        : api.ghl_token_set === false
          ? "The registration API reports no HighLevel credential."
          : "Registration API health could not be verified.",
    action:
      "Set the credential in the registration API's hosting secrets, then verify one controlled registration end to end.",
  });
  const workflows = object(s.workflows);
  const expected = ["W1", "W2", "W4a", "W4b", "W5", "W6"];
  const states = expected.map(k => workflows[k]);
  const allKnown = states.every(
    x => x === "published" || x === "draft" || x === "missing",
  );
  const incomplete = expected.filter((_, i) => states[i] !== "published");
  add({
    key: "workflows",
    label: "Registration and follow-up workflows",
    status: !allKnown ? "unknown" : incomplete.length ? "blocked" : "ready",
    detail: !allKnown
      ? "Could not verify all six WEBBY workflows."
      : incomplete.length
        ? `${incomplete.join(", ")} are draft or missing.`
        : "All six WEBBY workflows report published. Delivery still needs a controlled test.",
    action:
      "Review each workflow's content and schedule before publishing; this dashboard never activates workflows.",
  });
  add({
    key: "join",
    label: "The join link opens Zoom",
    status: boolStatus(s.join_link_ok),
    detail:
      s.join_link_ok === true
        ? "The public join page points to Zoom."
        : s.join_link_ok === false
          ? "The join page does not point to Zoom."
          : "The join link could not be checked.",
    action:
      "Open the reminder's join link on a phone and verify it reaches the intended meeting.",
  });
  add({
    key: "identity",
    label: "Attendance can be tied to registrants",
    status:
      zoom.registration === true ? "unknown" : boolStatus(zoom.registration),
    detail:
      zoom.registration === false
        ? "Zoom registration is off. Headcount is available, but reliable attendee-to-lead attribution is not."
        : zoom.registration === true
          ? "Zoom registration is on; unique join links and contact matching still need verification."
          : "Zoom registration settings are unavailable.",
    action:
      "Verify the chosen attendee identity path with a test registrant. Never match a person by their displayed name.",
  });
  add({
    key: "recording",
    label: "Chat and pitch analysis",
    status: boolStatus(zoom.cloud_recording),
    detail:
      zoom.cloud_recording === true
        ? "Automatic cloud recording is enabled. Recording access and chat still need a completed-session test."
        : zoom.cloud_recording === false
          ? "Automatic cloud recording is off."
          : "Recording settings could not be verified.",
    action:
      "Keep cloud recording on and confirm chat is available after the test session.",
  });
  return {
    checkedAt,
    fresh,
    status: checks.some(c => c.status === "blocked")
      ? "blocked"
      : checks.some(c => c.status === "unknown")
        ? "unknown"
        : "ready",
    checks,
  };
}
