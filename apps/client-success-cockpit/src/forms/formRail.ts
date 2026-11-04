import type { TimelineCall } from "@/lib/csmCalls";
import type { FormEntry, Handover } from "@/lib/onboardingCore";
import { NOT_TIED, tiedByTone, tiedByWords } from "@/lib/saleTie";
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

// --- Check with the client (Stage 4 plan B5) --------------------------------

/** A typed link as a URL, with or without its https://; null for text that is not a link. */
function urlOf(s: string | null | undefined): URL | null {
  const t = s?.trim();
  if (!t || /\s/.test(t)) return null;
  try {
    const u = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(t) ? t : `https://${t}`);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.hostname.includes(".") ? u : null;
  } catch {
    return null;
  }
}

/** A typed link's host, lower case and without "www."; null when it is not a link. */
export function hostOf(s: string | null | undefined): string | null {
  return (
    urlOf(s)
      ?.hostname.toLowerCase()
      .replace(/^www\./, "") ?? null
  );
}

/** The host is one of these domains or a subdomain of one (m.facebook.com). */
const onHost = (h: string | null, domains: readonly string[]) =>
  h !== null && domains.some(d => h === d || h.endsWith(`.${d}`));

const FACEBOOK = ["facebook.com", "fb.com", "fb.me"];
const INSTAGRAM = ["instagram.com", "instagr.am"];
const DRIVE = ["drive.google.com", "docs.google.com"];
const NOT_A_SITE = [...INSTAGRAM, ...FACEBOOK, "linktr.ee"];

/** A Google Maps link: maps.google.*, google.*\/maps, maps.app.goo.gl, goo.gl/maps. */
function isMapsLink(s: string): boolean {
  const u = urlOf(s);
  const h = hostOf(s);
  if (!u || !h) return false;
  if (h === "maps.app.goo.gl" || /^maps\.google\.[a-z.]+$/.test(h)) return true;
  return (
    (h === "goo.gl" || /^google\.[a-z.]+$/.test(h)) &&
    /^\/maps(?:\/|$)/.test(u.pathname)
  );
}

/** Their answer is on Google Drive or Docs. */
export const isDriveLink = (s: string | null) => onHost(hostOf(s), DRIVE);

/** A number as the form's number question stores it ("120000", "120,000"); else null. */
function plainNumber(s: string | null): number | null {
  const t = s?.replace(/[\s,]/g, "");
  if (!t || !/^\d+(?:\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** A name's words, loosely: no marks or hamza seats, lower case, without "and" or "&". */
const nameWords = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(w => w && w !== "and" && w !== "the" && w !== "و");

/**
 * The typed business name and the card's name are the same name: one
 * contains the other, in Latin or Arabic letters (a card may carry both),
 * or every word of one is in the other.
 */
export function sameName(typed: string, card: string): boolean {
  const a = nameWords(typed);
  const b = nameWords(card);
  if (!a.length || !b.length) return true;
  const key = (ws: string[], re: RegExp) => ws.filter(w => re.test(w)).join("");
  const within = (x: string, y: string) =>
    x.length >= 3 && y.length >= 3 && (x.includes(y) || y.includes(x));
  const subset = (x: string[], y: string[]) => x.every(w => y.includes(w));
  return (
    within(key(a, /[a-z\d]/), key(b, /[a-z\d]/)) ||
    within(key(a, /[\u0600-\u06FF]/), key(b, /[\u0600-\u06FF]/)) ||
    subset(a, b) ||
    subset(b, a)
  );
}

/** None-like booking answers beyond EMPTY's: "not yet", "x", "لا يوجد حاليا". */
const NO_SYSTEM = /^(?:not yet|nope|x|لايوجد|لا يوجد حاليا|لا يوجد حالياً)$/i;

/** One thing to check with the client: the question it is about, and a fixed sentence. */
export interface ClientCheck {
  id:
    | "facebook-instagram"
    | "facebook-other"
    | "instagram"
    | "website"
    | "name"
    | "units"
    | "goal"
    | "booking";
  /** The question in their onboarding form it is about. */
  topic: string;
  say: string;
}

/** The fixed sentences: what was checked, then what to ask. Never their typed words. */
export const CHECK_SAYS: Record<ClientCheck["id"], string> = {
  "facebook-instagram":
    "Their Facebook page answer is an Instagram link. Ask for the Facebook page's link.",
  "facebook-other":
    "Their Facebook page answer is not a Facebook link. Ask for the Facebook page's link.",
  instagram:
    "Their Instagram answer is not an Instagram link. Ask for their Instagram link.",
  website:
    "Their website answer is an Instagram, Facebook, Linktree or Google Maps link. Ask if they have a website.",
  name: "The business name they typed is not the card's name. Confirm which name the ads use.",
  units: "Last year's revenue is under 1,000. Check the units.",
  goal: "Their 90-day goal is more than all of last year's revenue. Check both numbers.",
  booking:
    "No booking software given, so there is no system to connect. Ask how they take bookings today.",
};

/**
 * What the onboarding answers say the CSM should check on the call (Stage
 * 4 plan B5): only the flags that hold, each a fixed sentence. A blank
 * answer is never a flag (it is said as missing elsewhere), except the
 * booking software, where none given is the point. Display only: nothing
 * is stored, prefilled or blocked. Pure.
 */
export function clientChecks(
  onb: FormEntry | null,
  cardName: string,
): ClientCheck[] {
  if (!onb) return [];
  const out: ClientCheck[] = [];
  const add = (id: ClientCheck["id"], topic: string) =>
    out.push({ id, topic, say: CHECK_SAYS[id] });

  const facebook = answerOf(onb, ONB.facebook);
  if (facebook) {
    const h = hostOf(facebook);
    if (onHost(h, INSTAGRAM)) add("facebook-instagram", "Facebook page");
    else if (!onHost(h, FACEBOOK)) add("facebook-other", "Facebook page");
  }
  const instagram = answerOf(onb, ONB.instagram);
  if (instagram && !onHost(hostOf(instagram), INSTAGRAM))
    add("instagram", "Instagram");
  const website = answerOf(onb, ONB.website);
  if (website && (onHost(hostOf(website), NOT_A_SITE) || isMapsLink(website)))
    add("website", "Website");

  const typed = answerOf(onb, ONB.businessName);
  if (typed && !sameName(typed, cardName)) add("name", "Business name");

  // Make writes a revenue of 0 as nothing, so 0 is not an answer to check.
  const last = plainNumber(answerOf(onb, ONB.lastRevenue));
  const goal90 = plainNumber(answerOf(onb, ONB.goal90));
  if (last !== null && last > 0 && last < 1000) add("units", "Revenue");
  // Under 1,000 the goal is compared with a number in other units: one flag is enough.
  else if (last !== null && last > 0 && goal90 !== null && goal90 > last)
    add("goal", "Revenue");

  const booking = (answerOf(onb, ONB.booking) ?? "")
    .trim()
    .replace(/[.!؟?]+$/, "");
  if (booking.length <= 2 || EMPTY.test(booking) || NO_SYSTEM.test(booking))
    add("booking", "Booking software");
  return out;
}

/** Under the Content row when their Drive answer is some other link or text. */
export const NOT_DRIVE = "Their answer is not a Drive folder.";

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
  // A kickoff on record (Typeform or the cockpit's own): the card's figure is no longer surely the sale's.
  const kickoffOnRecord = Boolean(row.forms?.kickoff);
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
  // Content: their Drive answer when it is a Drive link; else the card's
  // Drive folder (the field the rest of the cockpit opens first), with a
  // hint when what they gave is something else.
  const drive = answerOf(onb, ONB.drive);
  const theirDrive = isDriveLink(drive);
  const cardFolder = str(row.links?.drive_folder);
  const cardDrive = cardFolder ?? str(row.links?.drive);
  const notDrive = drive !== null && !theirDrive ? NOT_DRIVE : undefined;
  const contentRow: RailRow =
    theirDrive || !cardDrive
      ? {
          id: "content",
          label: "Content",
          value: drive,
          source: fromOnb,
          href: isUrl(drive) ? (drive ?? undefined) : undefined,
          linkLabel: isUrl(drive)
            ? theirDrive
              ? "Their Drive link"
              : "Their link"
            : undefined,
          hint: notDrive,
          missing: NOT_ON_RECORD,
        }
      : {
          id: "content",
          label: "Content",
          value: cardDrive,
          source: `ClickUp card, ${cardFolder ? "Drive Folder" : "Drive Link"}`,
          href: cardDrive,
          linkLabel: "The card's Drive folder",
          hint: notDrive,
          missing: NOT_ON_RECORD,
        };
  const checks = clientChecks(onb, row.client_name);
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
    // The sale's figure (CEO item 5): the kickoff asks the agreed one, which
    // differs on 4 of 5 cards, so this is said as the sale's, never as a
    // prefill. Once a kickoff is on record the card's Daily Budget can be the
    // kickoff's own (card_facts fills it when empty), so it is said as the
    // card's, not the sale's.
    {
      id: "daily-budget",
      label: kickoffOnRecord
        ? "Daily Budget on the card"
        : "Daily budget at the sale",
      value: budget === null ? null : `${dollars(budget)} a day`,
      copyValue: budget === null ? undefined : money(budget),
      source: kickoffOnRecord ? "ClickUp card" : "ClickUp card (the sale)",
      copy: true,
      hint:
        budget !== null && budget >= 1000
          ? "Looks like a month or another currency. Ask the client for the daily amount."
          : budget !== null && kickoffOnRecord
            ? "May be the last kickoff's figure: an empty Daily Budget is filled from the kickoff."
            : undefined,
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
    contentRow,
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

  // --- From the sale (CEO item 6, sale-tie.md 2.10) -------------------------
  // The card's own fields first; the tied New Client Form's answers while
  // they are empty. The stub says how sure the tie is; a card with no tied
  // sale says so, never a blank. While the sale read is not there (not read,
  // its function not applied yet, or a seat it does not serve) or sale ties
  // are off (`off`: nothing can be tied yet) the part keeps the card's rows
  // alone: no stub tells anyone to tie a sale that cannot be tied.
  const saleView = ctx.sale ?? null;
  const tied = saleView?.state === "tied" ? saleView : null;
  const signed = tied?.signedAt ? kuwaitShortDay(tied.signedAt) : "";
  const fromSale = signed ? `New Client Form, ${signed}` : "New Client Form";
  const cardOr = (card: unknown, fromForm: string | null | undefined) => {
    const c = str(card);
    const f = str(fromForm);
    return {
      value: c ?? f,
      source: c ? "ClickUp card" : f ? fromSale : null,
    };
  };
  const stub: RailRow[] = tied
    ? [
        {
          id: "sale-stub",
          label: "Sale",
          value: signed ? `Signed ${signed}` : "Signed, day not recorded",
          source: null,
          chip: {
            label: tiedByWords(tied.tiedBy),
            tone: tiedByTone(tied.tiedBy),
          },
          hint:
            [
              tied.voidedInB2B ? "Voided in B2B." : null,
              tied.otherSales > 0
                ? `${tied.otherSales} earlier ${tied.otherSales === 1 ? "sale" : "sales"} on this card.`
                : null,
            ]
              .filter(Boolean)
              .join(" ") || undefined,
          href: tied.salesCallLink ?? undefined,
          linkLabel: tied.salesCallLink ? "Watch the sales call" : undefined,
        },
      ]
    : saleView?.state === "none"
      ? [
          {
            id: "sale-stub",
            label: "Sale",
            value: null,
            source: null,
            missing: NOT_TIED,
          },
        ]
      : [];
  const goLive = cardOr(h.go_live, tied?.goLive);
  const handoff = cardOr(h.handoff_risks, tied?.handoffProblems);
  const closer = cardOr(h.closer, tied?.closer);
  const sale: RailRow[] = [
    ...stub,
    {
      id: "go-live",
      label: "Go-live expectation",
      ...goLive,
      missing: NOT_ON_RECORD,
    },
    {
      id: "handoff-problems",
      label: "Handoff problems",
      ...handoff,
      missing: NOT_ON_RECORD,
    },
    ...(tied?.expectations
      ? [
          {
            id: "expectations",
            label: "What they believe they're getting",
            value: tied.expectations,
            source: fromSale,
          },
        ]
      : []),
    {
      id: "closer",
      label: "Closer",
      ...closer,
      // Display only: the card's Closer is never written from here.
      hint:
        !str(h.closer) && closer.value
          ? "From the New Client Form. The card's Closer is empty."
          : undefined,
      missing: NOT_ON_RECORD,
    },
    {
      id: "closer-notes",
      label: "Closer's notes",
      value: str(h.closer_notes),
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
  // Display only: drawn as chips and sentences (FormPanel's CheckPart).
  if (checks.length)
    parts.push({
      id: "check",
      title: "Check with the client",
      rows: checks.map(c => ({
        id: `check-${c.id}`,
        label: c.topic,
        value: c.say,
        source: fromOnb,
      })),
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
    problem: ctx.failed.sale
      ? "The sale tied to this card could not be read just now."
      : undefined,
  });
  return parts;
}
