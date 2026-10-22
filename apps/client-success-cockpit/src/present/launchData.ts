import {
  ANY_PROJECT,
  ASK,
  type Band,
  bandFor,
  bookedSlot,
  type Dialect,
  dialectFor,
  familyOf,
  familyOfKey,
  handleOf,
  type Pain,
  PLACE_SAID,
  type Place,
  placesOf,
  type Slots,
  type SlotValue,
  turnsFor,
} from "./callScript";
import type { L, Lang } from "./content";
import { type Creative, creativeOf, creativeOfMeta } from "./creative";
import type { AccessStatus, DeckData, Overrides } from "./deckData";
import { type ServiceKey, type ServicePick, serviceNames } from "./services";
import type { Funnel, LaunchAd, MetaAd } from "./sources";

/**
 * The launch deck's own slots (docs/csm-decks/CONTENT.md, L1 to L10 and
 * Appendix A), worked out from the client's data with every fallback the
 * data map names. Pure, so the fallbacks are tested on the harness's
 * clients (scripts/deck-launch.test.tsx). Nothing here reads leads, cost
 * per lead, spend or budgets: the only money is the fictional customer's
 * band in the example call.
 */

export type PhoneKey = "feed" | "reels" | "facebook";
export const PHONES: PhoneKey[] = ["feed", "reels", "facebook"];

export type QuestionType =
  | "choice"
  | "name"
  | "phone"
  | "email"
  | "city"
  | "other";
export interface FormQuestion {
  label: string;
  options: string[];
  isGate: boolean;
  note: string | null;
  type: QuestionType;
}

export interface LaunchForm {
  /** Where the ad leads: Meta's instant form, a WhatsApp chat, or a page. */
  kind: "form" | "whatsapp" | "website";
  /** Their confirmed form, questions typed in prep, or the drawn example. */
  source: "confirmed" | "prep" | "example";
  headline: string | null;
  questions: FormQuestion[];
  /** Their own thank-you words (prep); null draws the default. */
  thankYou: string | null;
  formName: string | null;
  url: string | null;
}

export interface CallData {
  slots: Slots;
  dialect: Dialect;
  dialectFrom: "prep" | "country" | "areas" | "default";
  pain: Pain;
  painFrom: "prep" | "default";
  band: Band;
  bandFrom: "prep" | "table";
  slot: ReturnType<typeof bookedSlot>;
  place: Place | null;
  turns: ReturnType<typeof turnsFor>;
  guideChecked: boolean;
  /** Each slot that shows a "To give us" chip, for prep and the notes. */
  missing: string[];
}

export interface LaunchData {
  today: string;
  /** The go-live date has passed: "is live" on the cover. */
  live: boolean;
  /** Their uploads in the tray: starter and custom, ready, not hidden. */
  creatives: Creative[];
  /** Their built Meta ads with a still, paused ones included. */
  metaCreatives: Creative[];
  /** What prep put on each phone. */
  phonesPrep: Partial<Record<PhoneKey, string>>;
  pick: string | null;
  /** A custom creative chosen in prep for the cover; never a starter. */
  cover: Creative | null;
  platformsPlanned: string[];
  /** Is Google Calendar connected (the kickoff, then the CSM's tick)? */
  calendar: AccessStatus;
  welcomeVideo: boolean;
  bookingVideo: boolean;
  /** Where they hold consultations, from the onboarding form. */
  places: Place[];
  /** A phone screenshot of their landing page, uploaded in prep. */
  pageShot: Creative | null;
  form: LaunchForm;
  /** No confirmed form and no typed questions: slide 5 is hidden by default. */
  formHidden: boolean;
  funnels: Funnel[];
  redLines: { told: string[]; always: string[]; never: string[] };
  agreedAt: string | null;
  call: CallData;
  goal90: string | null;
  /**
   * A 90-day goal on file but held back (it counts enquiries or
   * appointments): slide 3's pushback names it without saying it.
   */
  goal90Held: boolean;
  checkin: string | null;
  /** The green light's hours card: only when the onboarding deck was never shown. */
  hoursCard: boolean;
  /** Done with you, and Mahara OS approved for this client. */
  dwyOs: boolean;
  /** The advertised service as a label ("Interior design", تصميم داخلي). */
  service: { en: string | null; ar: string | null };
  /** The same inside a sentence ("interior design", التصميم الداخلي). */
  serviceMid: { en: string | null; ar: string | null };
  /** Which of the five main services, or "Other" in their words (DESIGN 22.14). */
  serviceKey: ServiceKey | null;
  /** Where the selling point and the DWY playbook come from (prep and the notes). */
  refs: {
    brandDna: string | null;
    offer: string | null;
    offerText: string | null;
    clickup: string | null;
  };
}

export interface LaunchInput {
  d: Omit<DeckData, "launch">;
  launchPrep: Overrides;
  onboardingPrep: Overrides;
  ads: LaunchAd[];
  metaAds: MetaAd[];
  funnels: Funnel[];
  /** The onboarding form's answers the call reads, raw. */
  answers: {
    engineers: string;
    freeConsult: string;
    consultTypes: string;
    instagram: string;
    hours: string;
    areas: string;
  };
  advertised: string | null;
  /** The launch deck's service: the kickoff's answer first (DESIGN 22.14). */
  service: ServicePick;
  today: string;
  refs?: Partial<LaunchData["refs"]>;
}

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v.trim() : null;
const list = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.filter((x): x is string => typeof x === "string" && Boolean(x.trim()))
    : [];
const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};

/** A slot filled from their own files: drawn in teal (the legend says so). */
const filled = (text: string): SlotValue => ({ text, given: true, ask: null });
/** A slot we work out (the day, the time, the band): plain words. */
const worked = (text: string): SlotValue => ({ text, given: false, ask: null });
const fallback = (text: string | null, ask: L | null): SlotValue => ({
  text,
  given: false,
  ask,
});
const both = (en: SlotValue, ar: SlotValue) => ({ en, ar });

const TYPE: Record<string, QuestionType> = {
  CUSTOM: "choice",
  FULL_NAME: "name",
  PHONE: "phone",
  EMAIL: "email",
  CITY: "city",
};

/** A form question as the phone and the list draw it. */
function question(q: {
  type?: string | null;
  label?: string | null;
  options?: string[] | null;
  isGate?: boolean | null;
  note?: string | null;
}): FormQuestion | null {
  const type = TYPE[String(q.type ?? "CUSTOM").toUpperCase()] ?? "other";
  const label = str(q.label) ?? "";
  if (!label && type === "choice") return null;
  return {
    label,
    options: (q.options ?? []).filter(o => typeof o === "string" && o.trim()),
    isGate: q.isGate === true,
    note: str(q.note),
    type,
  };
}

const funnelKind = (f: Funnel | null): LaunchForm["kind"] => {
  const k = String(f?.kind ?? "").toLowerCase();
  if (/whatsapp/.test(k)) return "whatsapp";
  if (/instant|form/.test(k) || !k) return "form";
  return f?.url ? "website" : "form";
};

/** A short name from the form's "who are the engineers" answer, or null. */
function engineerName(answer: string): string | null {
  const s = answer.trim();
  if (!s || s.length > 40 || /[,،&]| and | و/.test(s)) return null;
  return s;
}

export function launchData(input: LaunchInput): LaunchData {
  const { d, launchPrep: p, onboardingPrep: op, answers, today } = input;
  const lang: Lang = d.lang;
  const twin = (prep: Overrides, key: string, l: Lang) =>
    (l === "ar" ? str(prep[`${key}_ar`]) : null) ?? str(prep[key]);

  // The tray: their own uploads, then their built Meta ads with stills.
  const uploads = input.ads.filter(
    a =>
      (a.kind === "starter" || a.kind === "custom") &&
      a.status === "ready" &&
      !a.hidden,
  );
  const creatives = uploads.map(creativeOf);
  const words = record(p.meta_ad_text);
  const metaCreatives = input.metaAds
    .map(a => creativeOfMeta(a, record(words[a.id])))
    .filter((c): c is Creative => Boolean(c));
  const all = [...creatives, ...metaCreatives];
  const known = (id: unknown) =>
    typeof id === "string" && all.some(c => c.id === id) ? id : null;

  const phonesPrep: Partial<Record<PhoneKey, string>> = {};
  const savedPhones = record(p.phones);
  for (const k of PHONES) {
    const id = known(savedPhones[k]);
    if (id) phonesPrep[k] = id;
  }
  const coverId = str(p.cover_creative);
  const cover =
    creatives.find(
      c => c.id === coverId && !c.starter && c.from === "upload",
    ) ?? null;
  const page = input.ads
    .filter(
      a => a.kind === "page" && a.status === "ready" && !a.hidden && a.url,
    )
    .at(-1);

  // The access row's calendar tick (Mahara OS, or their CRM).
  const osRow = d.access.find(r => r.key === "os" || r.key === "crm");
  const calendar =
    osRow?.ticks.find(t => t.key === "os_calendar")?.status ?? "unchecked";

  // The form: only one the CSM ticked as theirs, then typed questions.
  const confirmedId = str(p.form_confirmed);
  const funnel =
    (confirmedId &&
      input.funnels.find(
        f => f.formId === confirmedId || f.sourceId === confirmedId,
      )) ||
    null;
  const typed = Array.isArray(p.form_questions)
    ? (p.form_questions as Record<string, unknown>[])
        .map(q =>
          question({
            type: "CUSTOM",
            label: str(q.label),
            options: list(q.options),
            isGate: q.isGate === true,
            note: str(q.note),
          }),
        )
        .filter((q): q is FormQuestion => Boolean(q))
    : [];
  const gateNotes = record(
    (lang === "ar" ? p.gate_notes_ar : null) ?? p.gate_notes,
  );
  const fromFunnel = (funnel?.questions ?? [])
    .map(q => question(q))
    .filter((q): q is FormQuestion => Boolean(q))
    .map(q => ({ ...q, note: str(gateNotes[q.label]) ?? q.note }));
  const source: LaunchForm["source"] = typed.length
    ? "prep"
    : funnel
      ? "confirmed"
      : "example";
  const form: LaunchForm = {
    kind: funnelKind(funnel),
    source,
    headline: str(funnel?.headline),
    questions: typed.length ? typed : fromFunnel,
    thankYou: twin(p, "thank_you", lang),
    formName: str(funnel?.formName),
    url: str(funnel?.url) ?? str(funnel?.followUpUrl),
  };

  // Red lines: what they told us on slide 7, then the card's DO and DON'T.
  const hidden = new Set(list(p.dos_donts_hidden));
  const redLines = {
    told: d.redLines,
    always: d.dosDonts.do.filter(x => !hidden.has(x)),
    never: d.dosDonts.dont.filter(x => !hidden.has(x)),
  };

  // The call's slots (CONTENT Appendix A).
  const named = serviceNames(input.service);
  const service = named.name;
  const serviceMid = named.mid;
  const family =
    familyOfKey(input.service.key) ??
    familyOf(service.en) ??
    familyOf(service.ar);
  const dia = dialectFor(p.dialect, d.country, answers.areas);
  const said = (pl: Place) => PLACE_SAID[pl][dia.dialect];
  const places = placesOf(answers.consultTypes);
  const place = places[0] ?? null;
  const freeNo = /^(no|لا)\b|not free|مو مجان|غير مجان|paid|مدفوع/i.test(
    answers.freeConsult.trim(),
  );
  const freeYes =
    !freeNo &&
    /^(yes|yeah|نعم|ايه|إيه|اي|إي|أكيد)\b|free|مجان/i.test(
      answers.freeConsult.trim(),
    );
  const engineer = {
    en: str(p.engineer) ?? engineerName(answers.engineers),
    ar:
      str(p.engineer_ar) ?? str(p.engineer) ?? engineerName(answers.engineers),
  };
  const selling = {
    en: str(p.selling_point),
    ar: str(p.selling_point_ar) ?? str(p.selling_point),
  };
  const project = {
    en: str(p.project) ?? family?.project.en ?? null,
    ar: str(p.project_ar) ?? str(p.project) ?? family?.project.ar ?? null,
  };
  const scale = family?.scale ?? "works";
  const prepBand = record(p.budget_band);
  const prepBandAr = record(p.budget_band_ar);
  const tableBand = bandFor(d.country, scale, dia.dialect);
  const bandText = (k: string, l: Lang) =>
    (l === "ar" ? str(prepBandAr[k]) : null) ??
    (l === "en" ? str(prepBand[k]) : null);
  const band: Band = {
    band: {
      en: bandText("band", "en") ?? tableBand.band.en,
      ar: bandText("band", "ar") ?? tableBand.band.ar,
    },
    answer: {
      en: bandText("answer", "en") ?? tableBand.answer.en,
      ar: bandText("answer", "ar") ?? tableBand.answer.ar,
    },
    note: {
      en: bandText("note", "en") ?? tableBand.note.en,
      ar: bandText("note", "ar") ?? tableBand.note.ar,
    },
  };
  // The example booking lands after go-live when go-live is still ahead
  // (final score round 1: Wed 21 October against a 26 October go-live), as
  // O5's confirmation does; else two working days from today.
  const goLiveDay = d.goLive ? d.goLive.slice(0, 10) : null;
  const slot = bookedSlot(
    goLiveDay && goLiveDay > today ? goLiveDay : today,
    answers.hours,
  );
  const instagram = handleOf(answers.instagram);
  const company = { en: d.nameEn, ar: d.nameAr ?? d.nameEn };
  const slots: Slots = {
    company: both(filled(company.en), filled(company.ar)),
    // Said inside the line ("about interior design", بخصوص التصميم الداخلي).
    service: serviceMid.en
      ? both(filled(serviceMid.en), filled(serviceMid.ar ?? serviceMid.en))
      : both(fallback(null, ASK.service), fallback(null, ASK.service)),
    project:
      str(p.project) || str(p.project_ar)
        ? both(
            filled(project.en ?? ANY_PROJECT.en),
            filled(project.ar ?? project.en ?? ANY_PROJECT.ar),
          )
        : project.en
          ? both(worked(project.en), worked(project.ar ?? project.en))
          : both(worked(ANY_PROJECT.en), worked(ANY_PROJECT.ar)),
    engineer: engineer.en
      ? both(filled(engineer.en), filled(engineer.ar ?? engineer.en))
      : both(
          fallback("our engineer", ASK.engineer),
          fallback("مهندسنا", ASK.engineer),
        ),
    free: freeYes
      ? both(filled("a free consultation"), filled("استشارة مجانية"))
      : freeNo
        ? both(filled("a consultation"), filled("استشارة"))
        : both(
            fallback("a consultation", ASK.free),
            fallback("استشارة", ASK.free),
          ),
    place: place
      ? both(filled(PLACE_SAID[place].en), filled(said(place)))
      : both(fallback(null, ASK.place), fallback(null, ASK.place)),
    selling: selling.en
      ? both(filled(selling.en), filled(selling.ar ?? selling.en))
      : both(fallback(null, ASK.selling), fallback(null, ASK.selling)),
    instagram: instagram
      ? both(filled(instagram), filled(instagram))
      : both(fallback(null, null), fallback(null, null)),
    day: both(worked(slot.day.en), worked(slot.day.ar)),
    time: both(worked(slot.spoken.en), worked(slot.spoken.ar)),
    band: both(worked(band.band.en), worked(band.band.ar)),
    bandAnswer: both(worked(band.answer.en), worked(band.answer.ar)),
  };
  const pain: Pain =
    p.pain === "design" || p.pain === "cost" ? p.pain : "delays";
  const missing: string[] = [];
  if (!service.en)
    missing.push(
      "The launch service isn't chosen. The call shows 'To give us' in its place.",
    );
  if (!engineer.en)
    missing.push(
      "Consultant's name missing. The call shows 'To give us' in its place.",
    );
  if (!freeYes && !freeNo)
    missing.push(
      "Is the first consultation free? The form doesn't say, so the call asks.",
    );
  if (!place)
    missing.push(
      "Where they hold consultations is missing. The call shows 'To give us'.",
    );
  if (!selling.en)
    missing.push(
      "No selling point. Add one line from their Brand DNA, offer or call guide.",
    );
  if (!instagram)
    missing.push("No Instagram handle in the form, so its line is left out.");

  const goal = d.goals.find(g => g.key === "goal90");
  const goal90 = goal?.lines.length && !goal.held ? goal.lines[0] : null;
  const goal90Held = Boolean(goal?.lines.length && goal.held);

  return {
    today,
    live: Boolean(d.goLive && d.goLive < today),
    creatives,
    metaCreatives,
    phonesPrep,
    pick: known(p.their_pick),
    cover,
    platformsPlanned: list(p.platforms_planned),
    calendar,
    welcomeVideo: p.welcome_video === true,
    bookingVideo: p.booking_video === true,
    places,
    pageShot: page ? creativeOf(page) : null,
    form,
    formHidden: source === "example",
    funnels: input.funnels,
    redLines,
    agreedAt: str(p.creative_agreed_at),
    call: {
      slots,
      dialect: dia.dialect,
      dialectFrom: dia.from,
      pain,
      painFrom:
        p.pain === "design" || p.pain === "cost" || p.pain === "delays"
          ? "prep"
          : "default",
      band,
      bandFrom:
        Object.keys(prepBand).length || Object.keys(prepBandAr).length
          ? "prep"
          : "table",
      slot,
      place,
      turns: turnsFor(pain, Boolean(instagram)),
      guideChecked: p.call_guide_checked === true,
      missing,
    },
    goal90,
    goal90Held,
    checkin: d.next.checkin ?? null,
    hoursCard: !d.presentedAt,
    dwyOs: op.dwy_os_approved === true,
    service,
    serviceMid,
    serviceKey: input.service.key,
    refs: {
      brandDna: input.refs?.brandDna ?? null,
      offer: input.refs?.offer ?? null,
      offerText: input.refs?.offerText ?? null,
      clickup: input.refs?.clickup ?? null,
    },
  };
}

/**
 * The phones' creatives before anything is swapped (DESIGN 8.3): prep's
 * choice, else the first creative that suits each phone's shape, keeping
 * the feed and Facebook on different creatives when there are two.
 */
export function defaultPhones(
  creatives: Creative[],
  prep: Partial<Record<PhoneKey, string>>,
): Partial<Record<PhoneKey, string>> {
  const tall = (c: Creative) =>
    c.placement === "reels" || (c.ratio != null && c.ratio < 0.68);
  const flat = creatives.filter(c => !tall(c));
  const out: Partial<Record<PhoneKey, string>> = {};
  out.feed = prep.feed ?? flat[0]?.id ?? creatives[0]?.id;
  out.reels =
    prep.reels ?? creatives.find(tall)?.id ?? out.feed ?? creatives[0]?.id;
  out.facebook =
    prep.facebook ??
    flat.find(c => c.id !== out.feed)?.id ??
    out.feed ??
    creatives[0]?.id;
  for (const k of PHONES) if (!out[k]) delete out[k];
  return out;
}
