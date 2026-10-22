import type { TimelineCall } from "@/lib/csmCalls";
import type { FormEntry, Handover } from "@/lib/onboardingCore";
import { cleanAnswer, EMPTY, serviceChips } from "@/present/clean";
import {
  isOtherWord,
  KICKOFF_CHOICE,
  MAIN,
  resolveService,
  type ServicePick,
  type ServiceSource,
  serviceRows,
} from "@/present/services";
import type { FormContext, RailPart, RailRow } from "./formConfig";
import { kuwaitDay, kuwaitShortDay, whenSaid } from "./formTime";
import { answerOf, KICKOFF_HIDDEN, ONB, type Prefill } from "./prefill";

/**
 * The kickoff's side panel (KICKOFF.md 3): what the cockpit knows beside
 * each question, in the form's order, each row with its source, and a plain
 * sentence where a fact is missing. Missing is never zero, and nothing here
 * computes a payment or reads the card's Service Advertised field (Make 12
 * never fills it). Pure: scripts/form-rail.test.ts pins it.
 */

const NOT_ON_RECORD = "Not on record.";
const ASK_SERVICE = "Not on record. Ask which of the five they want first.";
const ASK_CONTRACT = "Not on record. Ask on the call.";
const NO_RECORDING =
  "Not in the call store yet. It arrives a few minutes after the call ends. Check again, or paste it from Fathom.";

/** The kickoff's Contract status choices, word for word. */
export const CONTRACT_CHOICES = [
  "Signed",
  "Sent and waiting on client",
  "Adjustments requested by client",
  "Not sent yet",
  "NA - already signed",
] as const;

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;
const list = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string" && Boolean(x.trim()))
    : [];
const isUrl = (s: string | null) => Boolean(s && /^https?:\/\/\S+$/i.test(s));

/** "Onboarding form, 13 Oct". */
export const onboardingSource = (e: FormEntry | null) =>
  e ? `Onboarding form, ${kuwaitShortDay(e.submitted_at)}` : null;

/**
 * The card's contract as one of the form's five choices: Contract Status
 * first, then Contract Signed (Sent reads "Sent and waiting on client").
 */
export function contractChoice(
  h: Pick<Handover, "contract_status" | "contract_signed">,
): string | null {
  const status = str(h.contract_status);
  const exact = CONTRACT_CHOICES.find(
    c => c.toLowerCase() === status?.toLowerCase(),
  );
  if (exact) return exact;
  const signed = str(h.contract_signed) ?? status;
  if (!signed) return null;
  if (/^na\b|already signed/i.test(signed)) return "NA - already signed";
  if (/not sent/i.test(signed)) return "Not sent yet";
  if (/adjust|change/i.test(signed)) return "Adjustments requested by client";
  if (/^signed$/i.test(signed)) return "Signed";
  if (/^sent\b|waiting/i.test(signed)) return "Sent and waiting on client";
  return null;
}

/**
 * The service to suggest, in the onboarding deck's order: slide 4's choice
 * (prep's service_focus with service_chosen_at), prep, then the onboarding
 * form's number-one service and its list of services.
 */
export function suggestedService(ctx: Pick<FormContext, "deck" | "row">): {
  pick: ServicePick;
  services: string[];
  source: string | null;
} {
  const prep = (ctx.deck?.prep?.onboarding?.overrides ?? {}) as Record<
    string,
    unknown
  >;
  const onb = ctx.row.forms?.onboarding ?? null;
  const numberOneRaw = cleanAnswer(answerOf(onb, ONB.serviceFocus) ?? "");
  const numberOne =
    numberOneRaw &&
    !EMPTY.test(numberOneRaw) &&
    numberOneRaw.length <= 44 &&
    numberOneRaw.split(/\s+/).length <= 6
      ? numberOneRaw
      : null;
  const chips = serviceChips(answerOf(onb, ONB.services) ?? "");
  const prepServices = list(prep.services);
  const services = prepServices.length
    ? prepServices
    : [...(numberOne ? [numberOne] : []), ...chips].slice(0, 6);
  const sources: ServiceSource[] = [
    {
      from: str(prep.service_chosen_at) ? "chosen" : "prep",
      text: str(prep.service_focus),
      ar: str(prep.service_focus_ar),
      explicit: true,
    },
    ...[numberOne, ...chips, ...services].map(text => ({
      from: "form" as const,
      text,
      explicit: false,
    })),
  ];
  const pick = resolveService(sources);
  const source =
    pick.from === "chosen"
      ? "Slide 4, onboarding deck"
      : pick.from === "prep"
        ? "Prep, onboarding deck"
        : pick.from === "form"
          ? onboardingSource(onb)
          : null;
  return { pick, services, source };
}

/** The form's label for a pick: one of the five, or "Other". */
export function pickLabel(pick: ServicePick): string | null {
  if (!pick.key) return null;
  return pick.key === "other" ? "Other" : KICKOFF_CHOICE[pick.key];
}

/** Today's onboarding call with a recording in the call store (Kuwait day). */
export function todaysRecording(
  calls: TimelineCall[] | undefined,
  nowIso: string,
): TimelineCall | null {
  const today = kuwaitDay(nowIso);
  return (
    (calls ?? [])
      .filter(
        c =>
          c.kind === "onboarding" &&
          isUrl(c.recordingUrl ?? null) &&
          kuwaitDay(c.startsAt) === today,
      )
      .sort((a, b) =>
        String(b.startsAt ?? "").localeCompare(String(a.startsAt ?? "")),
      )[0] ?? null
  );
}

/** "-Cash collected: 500" lines as the card has them, without the dashes. */
const lines = (s: string | undefined) =>
  (s ?? "")
    .split("\n")
    .map(l => l.replace(/^\s*[-•]\s*/, "").trim())
    .filter(Boolean);

/** A number as the form's number field takes it: digits, no separators. */
const money = (n: number) =>
  Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, "");

/**
 * Daily Budget and Next Payment Amount are ClickUp currency fields in US
 * dollars (their type_config.currency_type is "USD", read 2026-10-22), so
 * the card's currency is the dollar: "$40 a day", "$1,000".
 */
const dollars = (n: number) =>
  `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

/** "KW" as "Kuwait"; a name, or a code no browser knows, as it came. */
export function countryName(code: string | null): string | null {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return code;
  try {
    return (
      new Intl.DisplayNames(["en"], { type: "region" }).of(
        code.toUpperCase(),
      ) ?? code
    );
  } catch {
    return code;
  }
}

/** "Onboarding form, 13 Oct" inside a sentence; a name like "ClickUp" stays. */
const lowerFirst = (s: string) =>
  /^[A-Z][a-z]*\b/.test(s) && !/^[A-Z][a-z]*[A-Z]/.test(s)
    ? s.charAt(0).toLowerCase() + s.slice(1)
    : s;

/** A row that can join its empty neighbours in one "Not on record: …" line. */
const plainEmpty = (r: RailRow, keep: Set<string>) =>
  r.value === null &&
  r.missing === NOT_ON_RECORD &&
  !r.required &&
  !r.recheck &&
  !r.choices &&
  !r.carries &&
  !r.hint &&
  !r.href &&
  !keep.has(r.id);

/**
 * Runs of two or more plain empty rows become one line ("Not on record:
 * Daily budget, Facebook access, Calendar, Content."). A row "Still
 * missing" points to stays its own.
 */
export function foldEmpty(rows: RailRow[], keep: Set<string>): RailRow[] {
  const out: RailRow[] = [];
  let run: RailRow[] = [];
  const flush = () => {
    if (run.length >= 2)
      out.push({
        id: `empty-${run.map(r => r.id).join("-")}`,
        label: "Not on record",
        value: null,
        source: null,
        missing: NOT_ON_RECORD,
        empties: run.map(r => r.label),
      });
    else out.push(...run);
    run = [];
  };
  for (const r of rows) {
    if (plainEmpty(r, keep)) run.push(r);
    else {
      flush();
      out.push(r);
    }
  }
  flush();
  return out;
}

export function kickoffRail(ctx: FormContext, prefill: Prefill): RailPart[] {
  const row = ctx.row;
  const h = row.handover ?? {};
  const onb = prefill.onboarding;
  const fromOnb = onboardingSource(onb);
  const deckFailed = Boolean(ctx.failed.deck);
  // The server's clock at the last read: "today" is Kuwait's day then.
  const nowIso = ctx.now;

  // --- facts ---------------------------------------------------------------
  const service = suggestedService(ctx);
  const picked = pickLabel(service.pick);
  const own = serviceRows(service.services, service.pick);
  // Q10: the five as the form's labels, the suggestion ringed, their own
  // words under each. The only place the five are drawn.
  const serviceRow: RailRow = {
    id: "service",
    label: "Which service are we advertising?",
    value: picked,
    source: service.source,
    required: true,
    missing: ASK_SERVICE,
    hint:
      service.pick.key === "other"
        ? `In their words: ${service.pick.words.en ?? service.pick.words.ar ?? service.pick.text ?? ""}`.trim()
        : undefined,
    choices: {
      options: [
        ...MAIN.map(k => ({
          label: KICKOFF_CHOICE[k],
          own: own.find(r => r.key === k)?.own ?? [],
        })),
        ...(own.some(r => r.key === "other")
          ? [
              {
                label: "Other",
                own: (own.find(r => r.key === "other")?.own ?? []).filter(
                  w => !isOtherWord(w),
                ),
              },
            ]
          : []),
      ],
      picked,
    },
  };

  const contract = contractChoice(h);
  const recording = todaysRecording(ctx.timeline?.calls, nowIso);
  const payment =
    typeof h.next_payment_amount === "number" && h.next_payment_amount > 0
      ? h.next_payment_amount
      : null;
  const budget =
    typeof h.daily_budget === "number" && h.daily_budget > 0
      ? h.daily_budget
      : null;
  const billing = lines(h.billing_notes);
  const paymentHint = [
    billing.length ? `Billing on the card: ${billing.join(" · ")}` : null,
    h.payment_plan ? `Payment plan: ${h.payment_plan}` : null,
  ]
    .filter(Boolean)
    .join(". ");

  // --- Still missing: short pointers; the full sentence is on the row ------
  const missing: RailRow[] = [];
  if (!recording)
    missing.push({
      id: "missing-recording",
      label: "Call recording link",
      value: null,
      source: null,
      required: true,
      missing: ctx.failed.timeline
        ? "The call store could not be read."
        : "Not in the call store yet.",
      anchor: "recording",
    });
  if (!contract)
    missing.push({
      id: "missing-contract",
      label: "Contract status",
      value: null,
      source: null,
      required: true,
      missing: "Ask on the call.",
      anchor: "contract",
    });
  if (!picked)
    missing.push({
      id: "missing-service",
      label: "Service",
      value: null,
      source: null,
      required: true,
      missing: "Ask on the call.",
      anchor: "service",
    });
  if (!onb)
    missing.push({
      id: "missing-onboarding",
      label: "Onboarding answers",
      value: null,
      source: null,
      missing:
        prefill.noOnboarding ??
        `${row.client_name} has not filled the onboarding form.`,
      action: prefill.copy,
    });
  if (!payment)
    missing.push({
      id: "missing-payment",
      label: "Payment amount",
      value: null,
      source: null,
      missing: "Not on the card.",
      anchor: "payment",
    });
  const pointed = new Set(
    missing.map(r => r.anchor).filter((a): a is string => Boolean(a)),
  );

  // --- The client ----------------------------------------------------------
  const offerText = str(ctx.deck?.editor?.offer);
  const offerUrl =
    str(ctx.deck?.editor?.offerUrl) ?? str(row.links?.offer_sheet);
  const offerRow: RailRow = {
    id: "offer",
    label: "Offer",
    value: offerText ?? (offerUrl ? "On the offer cheat sheet." : null),
    source: offerText
      ? "Editor desk, client card"
      : offerUrl
        ? str(ctx.deck?.editor?.offerUrl)
          ? "Editor desk, client card"
          : "ClickUp card"
        : null,
    href: offerUrl ?? undefined,
    linkLabel: offerUrl ? "Offer cheat sheet" : undefined,
    missing: NOT_ON_RECORD,
  };
  const city = str(ctx.deck?.ghl?.city);
  const country = countryName(str(ctx.deck?.ghl?.country));
  const place = [city, country].filter(Boolean).join(", ") || null;
  const areas = answerOf(onb, ONB.areas);
  const areaRow: RailRow = {
    id: "area",
    label: "Area",
    value: place ?? areas,
    source: place ? "HighLevel" : areas ? fromOnb : null,
    hint: place && areas ? `They serve: ${areas}` : undefined,
    missing: NOT_ON_RECORD,
  };

  // --- In the form's order -------------------------------------------------
  const carries = KICKOFF_HIDDEN.filter(s => s.ref).map(s => {
    const value = prefill.values[s.key] ?? null;
    const from = prefill.from[s.key];
    return {
      key: s.key,
      label: s.label,
      value,
      source:
        value === null
          ? null
          : from === "onboarding form"
            ? fromOnb
            : from === "card link"
              ? "Kickoff link on the card"
              : from === "card name"
                ? "ClickUp card name"
                : null,
    };
  });
  const filled = carries.filter(c => c.value !== null).length;
  // The source most values share is said once, in the title.
  const counts = new Map<string, number>();
  for (const c of carries)
    if (c.source) counts.set(c.source, (counts.get(c.source) ?? 0) + 1);
  const carriesFrom =
    [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const booking = answerOf(onb, ONB.booking);
  const length = answerOf(onb, ONB.appointmentLength);
  const drive = answerOf(onb, ONB.drive);
  const order: RailRow[] = [
    serviceRow,
    {
      id: "consultation-types",
      label: "Consultation types",
      value: answerOf(onb, ONB.consultationTypes),
      source: fromOnb,
      suggest: true,
      required: true,
      missing: NOT_ON_RECORD,
    },
    {
      id: "contract",
      label: "Contract status",
      value: contract,
      source: contract ? "ClickUp card" : null,
      required: true,
      missing: ASK_CONTRACT,
    },
    {
      id: "daily-budget",
      label: "Daily budget",
      value: budget === null ? null : `${dollars(budget)} a day`,
      copyValue: budget === null ? undefined : money(budget),
      source: "ClickUp card",
      copy: true,
      missing: NOT_ON_RECORD,
    },
    {
      id: "facebook",
      label: "Facebook access",
      value: answerOf(onb, ONB.facebookAccess),
      source: fromOnb,
      missing: NOT_ON_RECORD,
    },
    {
      id: "calendar",
      label: "Calendar",
      value: booking ?? length,
      source: fromOnb,
      hint: booking && length ? `Appointments: ${length}` : undefined,
      missing: NOT_ON_RECORD,
    },
    {
      id: "content",
      label: "Content",
      value: drive,
      source: fromOnb,
      href: isUrl(drive) ? (drive ?? undefined) : undefined,
      linkLabel: isUrl(drive) ? "Their Drive link" : undefined,
      missing: NOT_ON_RECORD,
    },
    {
      id: "recording",
      label: "Call recording link",
      value: recording?.recordingUrl ?? null,
      source: recording
        ? `${recording.source === "fathom" ? "Fathom" : "Call store"}, ${whenSaid(recording.startsAt, nowIso)}`
        : null,
      href: recording?.recordingUrl ?? undefined,
      linkLabel: recording ? "Open the recording" : undefined,
      copy: true,
      recheck: true,
      required: true,
      missing: ctx.failed.timeline
        ? "The call store could not be read just now. Check again, or paste it from Fathom."
        : NO_RECORDING,
    },
    {
      id: "payment",
      label: "Payment amount",
      value: payment === null ? null : dollars(payment),
      copyValue: payment === null ? undefined : money(payment),
      source: payment ? "ClickUp card, Next Payment Amount" : null,
      copy: true,
      hint: paymentHint || undefined,
      missing: NOT_ON_RECORD,
    },
    // Typeform reads these back itself, so they come last and folded.
    {
      id: "carries",
      label: `What the form carries · ${filled} of ${carries.length}${carriesFrom ? ` · ${lowerFirst(carriesFrom)}` : ""}`,
      value: filled ? String(filled) : null,
      source: null,
      missing: onb ? "The client left it blank." : NOT_ON_RECORD,
      carries,
      carriesFrom,
      blank: onb ? "Left blank" : "Not on record",
    },
  ];

  // --- From the sale -------------------------------------------------------
  const sale: RailRow[] = [
    {
      id: "closer",
      label: "Closer",
      value: str(h.closer),
      source: "ClickUp card",
      missing: NOT_ON_RECORD,
    },
    {
      id: "closer-notes",
      label: "Closer's notes",
      value: str(h.closer_notes),
      source: "ClickUp card",
      missing: NOT_ON_RECORD,
    },
    {
      id: "handoff-risks",
      label: "Handoff risks",
      value: str(h.handoff_risks),
      source: "ClickUp card",
      missing: NOT_ON_RECORD,
    },
  ];

  const parts: RailPart[] = [];
  if (missing.length)
    parts.push({
      id: "missing",
      title: "Still missing",
      rows: missing,
      tone: "warn",
    });
  parts.push({
    id: "client",
    title: "The client",
    rows: foldEmpty([offerRow, areaRow], pointed),
    problem: deckFailed
      ? "The offer and HighLevel details could not be read just now."
      : undefined,
  });
  parts.push({
    id: "order",
    title: "In the form's order",
    rows: foldEmpty(order, pointed),
  });
  parts.push({
    id: "sale",
    title: "From the sale",
    rows: foldEmpty(sale, pointed),
    fold: true,
  });
  return parts;
}
