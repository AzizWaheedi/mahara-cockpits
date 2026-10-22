/**
 * The kickoff prefill, field by field, against production, read-only
 * (docs/csm-forms/KICKOFF.md 7, check 1). For every client in onboarding it
 * reads the record (cockpit_client_onboarding, through the read-only SQL
 * helper), the client's onboarding response from Typeform's API (a GET),
 * and the card's own Make-built kickoff link, builds the hidden object the
 * form panel would send, and prints counts and field names only: never a
 * client's answer, and never the token.
 *
 * It also checks that the kickoff declares every hidden key the build sends
 * (exit 1 if not), and, for a client whose kickoff is on record, compares
 * the build with the hidden values Typeform stored on that submission.
 *
 * Run (the token is read over ssh and never printed):
 *   TYPEFORM_TOKEN=$(ssh 187.77.156.166 'grep -h "^TYPEFORM_API_TOKEN=" /opt/data/bibi/api-keys.env | head -1 | cut -d= -f2- | tr -d "\"'"'"'"') \
 *     bun scripts/kickoff-prefill-check.ts
 *
 * Without TYPEFORM_TOKEN it still compares the build with the mirror and
 * the card link, and says that Typeform was not read.
 */

import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import type { FormContext } from "../src/forms/formConfig";
import { KICKOFF } from "../src/forms/kickoff";
import {
  formLink,
  KICKOFF_HIDDEN,
  parseFormLink,
  sameValue,
} from "../src/forms/prefill";
import {
  answerValue,
  FORMS,
  type OnboardingRow,
} from "../src/lib/onboardingCore";

const cache = join(homedir(), ".cache", "mahara-ship");
const SQL = `select clickup_task_id, client_name, client_status, in_onboarding, links, handover, forms,
  card_updated_at, clickup_status, csm, signup_on, onboarding_call_on, launch_on, sales_transcript, seen_at, synced_at
  from public.cockpit_client_onboarding where in_onboarding order by clickup_task_id`;

function readRows(): OnboardingRow[] {
  const run = spawnSync(
    join(cache, "pybin", "python"),
    [join(cache, "sq.py"), SQL],
    {
      encoding: "utf8",
      env: { ...process.env, SQ_RW: "" },
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (run.status !== 0)
    throw Error(`The read-only SQL helper failed (exit ${run.status}).`);
  return run.stdout
    .split("\n")
    .filter(l => l.trim().startsWith("{"))
    .map(l => JSON.parse(l) as OnboardingRow);
}

async function typeformResponse(
  token: string,
  responseId: string,
  formId: string = FORMS.onboarding,
): Promise<any | null> {
  const url = `https://api.typeform.com/forms/${formId}/responses?included_response_ids=${encodeURIComponent(responseId)}&page_size=1`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok)
    throw Error(`Typeform answered ${res.status} for a response read.`);
  const body = await res.json();
  return body?.items?.[0] ?? null;
}

const token = (process.env.TYPEFORM_TOKEN ?? "").trim();
const rows = readRows();
console.log(
  `${rows.length} clients in onboarding. Typeform ${token ? "is read for each onboarding response" : "is NOT read (no TYPEFORM_TOKEN)"}.`,
);

// 0. The kickoff declares every hidden key the build sends: Typeform drops a
// value whose key the form does not declare, without a word.
if (token) {
  const res = await fetch(`https://api.typeform.com/forms/${FORMS.kickoff}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    console.log(
      `Typeform answered ${res.status} for the kickoff's definition.`,
    );
    process.exitCode = 1;
  } else {
    const def = await res.json();
    const declared: string[] = Array.isArray(def?.hidden) ? def.hidden : [];
    const undeclared = KICKOFF_HIDDEN.map(s => s.key).filter(
      k => !declared.includes(k),
    );
    console.log(
      undeclared.length
        ? `The kickoff form does not declare ${undeclared.length} key(s) the build sends: ${undeclared.join(", ")}.`
        : `The kickoff form declares all ${KICKOFF_HIDDEN.length} keys the build sends.`,
    );
    if (undeclared.length) process.exitCode = 1;
  }
}

let full = 0;
for (const row of rows) {
  const p = KICKOFF.hidden({ row } as FormContext);
  const id = row.clickup_task_id;
  const parts: string[] = [];
  const keys = KICKOFF_HIDDEN.map(s => s.key);
  const onboarding = row.forms?.onboarding;

  // 1. The build against Typeform's own answers (no mirror cut).
  if (!onboarding) {
    parts.push(
      `no onboarding response on record; the form carries ${Object.keys(p.values).length} fields (ID and name)`,
    );
  } else if (token) {
    try {
      const r = await typeformResponse(token, onboarding.response_id);
      if (!r) parts.push("Typeform did not return the onboarding response");
      else {
        const byRef = new Map<string, any>(
          (r.answers ?? []).map((a: any) => [String(a?.field?.ref), a]),
        );
        let match = 0;
        const differ: string[] = [];
        for (const s of KICKOFF_HIDDEN) {
          const expected =
            s.ref === null
              ? id
              : answerValue(byRef.get(s.ref)) ||
                (s.key === "legal_name" ? row.client_name.trim() : "");
          if ((p.values[s.key] ?? "") === expected) match++;
          else differ.push(s.key);
        }
        if (match === keys.length) full++;
        parts.push(
          `${match} of ${keys.length} match the onboarding response${differ.length ? ` (differ: ${differ.join(", ")})` : ""}`,
        );
        if (String(r?.hidden?.onboarding_client_id ?? "") !== id)
          parts.push("the onboarding response carries another client ID");
      }
    } catch (e) {
      parts.push(String((e as Error).message));
    }
  } else {
    const mirrorKeys = KICKOFF_HIDDEN.filter(
      s => s.ref && p.from[s.key] === "onboarding form",
    ).length;
    parts.push(
      `${mirrorKeys + 1} of ${keys.length} built from the record and the mirror`,
    );
  }

  // 2. The build against the card's Make-built link, after normalising.
  const link = parseFormLink(row.links?.kickoff_form);
  if (!link) parts.push("no kickoff link on the card");
  else if (link.formId !== FORMS.kickoff)
    parts.push("the card link is for another form");
  else if (link.hidden.onboarding_client_id !== id)
    parts.push("the card link carries another client ID");
  else {
    // A key the build took from the card name is the designed fallback (Make
    // 10's plain link carries the ID only), not a difference.
    const compared = keys.filter(
      k => k !== "onboarding_client_id" && p.from[k] !== "card name",
    );
    const rawDiffer = compared.filter(
      k => (p.values[k] ?? "") !== (link.hidden[k] ?? ""),
    );
    const differ = compared.filter(
      k => !sameValue(p.values[k], link.hidden[k]),
    );
    parts.push(
      `${rawDiffer.length} differ from the card link as written${rawDiffer.length ? ` (${rawDiffer.join(", ")})` : ""}, ${differ.length} after normalising${differ.length ? ` (${differ.join(", ")})` : ""}`,
    );
    if (p.from.legal_name === "card name")
      parts.push("legal_name added from the card name");
  }

  // 2b. The end-to-end proof: what Typeform stored on a submitted kickoff.
  const sent = row.forms?.kickoff;
  if (token && sent?.response_id) {
    try {
      const r = await typeformResponse(token, sent.response_id, FORMS.kickoff);
      if (!r)
        parts.push(
          sent.form_id === FORMS.kickoff
            ? "Typeform did not return the submitted kickoff"
            : "the kickoff on record is the old form's, so its hidden values are not compared",
        );
      else {
        const hidden = (r.hidden ?? {}) as Record<string, string>;
        const loose: string[] = [];
        const off: string[] = [];
        for (const k of keys) {
          const built = p.values[k] ?? "";
          const stored = hidden[k] ?? "";
          if (built === stored) continue;
          if (sameValue(built, stored)) loose.push(k);
          else off.push(k);
        }
        parts.push(
          !loose.length && !off.length
            ? "the submitted kickoff's hidden values: exact"
            : `the submitted kickoff's hidden values: ${loose.length ? `match only after normalising (${loose.join(", ")})` : ""}${loose.length && off.length ? "; " : ""}${off.length ? `differ (${off.join(", ")})` : ""}`,
        );
      }
    } catch (e) {
      parts.push(String((e as Error).message));
    }
  }

  // 3. Where each value came from, and the link's length.
  const from = Object.values(p.from).reduce<Record<string, number>>((n, f) => {
    n[f] = (n[f] ?? 0) + 1;
    return n;
  }, {});
  parts.push(
    `sources ${Object.entries(from)
      .map(([k, v]) => `${k} ${v}`)
      .join(", ")}`,
  );
  parts.push(
    `link ${formLink(FORMS.kickoff, p.values).length} characters (card link ${row.links?.kickoff_form?.length ?? 0})`,
  );
  if (row.forms?.kickoff)
    parts.push(
      "a kickoff is already on record (the window will hold the form)",
    );
  console.log(`${id}: ${parts.join("; ")}`);
}
if (token)
  console.log(
    `${full} of ${rows.filter(r => r.forms?.onboarding).length} clients with onboarding answers match on every field.`,
  );
