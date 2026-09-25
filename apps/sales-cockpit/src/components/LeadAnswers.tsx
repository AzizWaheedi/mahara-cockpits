import { day, isArabic } from "../lib/format";
import type { Lead } from "../lib/types";

/** What the lead answered on the form when they came in. */
const ANSWERS: [keyof Lead, string][] = [
  ["revenue", "Yearly revenue"],
  ["revenue_goal", "Revenue goal"],
  ["readiness", "Ready to invest"],
  ["decision_maker", "Decision maker"],
  ["challenge", "Biggest challenge"],
  ["grade", "Appointment grade"],
  ["setter_name", "Setter"],
];

export function Answers({ lead }: { lead: Lead }) {
  const rows = ANSWERS.map(([k, label]) => [label, lead[k]] as const).filter(
    ([, v]) => v !== null && v !== undefined && String(v).trim() !== "",
  );
  const services =
    lead.services && lead.services.trim() !== "Yes" ? lead.services : null;
  if (!rows.length && !services)
    return (
      <p className="muted text-sm">
        No form answers on this contact. They may have booked without the
        qualification form.
      </p>
    );
  return (
    <dl className="space-y-2.5">
      {rows.map(([label, v]) => (
        <div key={label}>
          <dt className="muted text-xs">{label}</dt>
          <dd
            className={`text-sm ${isArabic(String(v)) ? "ar" : ""}`}
            dir="auto"
          >
            {String(v)}
          </dd>
        </div>
      ))}
      {services ? (
        <div>
          <dt className="muted text-xs">What they do</dt>
          <dd className="text-sm" dir="auto">
            {services}
          </dd>
        </div>
      ) : null}
      {lead.lead_created_at ? (
        <p className="muted pt-1 text-xs">
          Answered when they came in, {day(lead.lead_created_at)}.
        </p>
      ) : null}
    </dl>
  );
}
