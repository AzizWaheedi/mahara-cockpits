/** Provider adapter, kept independent of Convex so identity and retries are testable. */
export const CHECK_IN_CALENDAR = "SHjlq0UjeR11maltYNyh";
export const CLIENT_ACCOUNT = "wwG426bwruWWv9W3fazQ";

/**
 * Every call the CSM books, one calendar each in the Mahara Media client
 * account (Aziz, 2026-10-06: "book all the types of calls, not just check-in
 * calls"). In journey order. Booking one moves the client's ClickUp stage to
 * `stage` when that is further along than where they are; a check-in moves
 * nothing. Only these calendars can be booked.
 */
export const CALLS = {
  onboarding: {
    calendarId: "z1Ne59rohCCj87KhcXoi",
    label: "Onboarding call",
    stage: "Onboarding Booked",
  },
  blueprint: {
    calendarId: "x84ET6KnA8odlsjYiVLq",
    label: "Brand Blueprint call",
    stage: "Brand Blueprint Booked\u2660\ufe0f",
  },
  launch: {
    calendarId: "5E1EVxLJbGiDM3iYl2kL",
    label: "Launch call",
    stage: "LAUNCH BOOKED",
  },
  checkin: {
    calendarId: CHECK_IN_CALENDAR,
    label: "Check-in call",
    stage: null,
  },
} as const;
export type CallKind = keyof typeof CALLS;
export const CALL_KINDS = Object.keys(CALLS) as CallKind[];

export function callOf(kind: string | undefined): (typeof CALLS)[CallKind] & {
  kind: CallKind;
} {
  const k = (kind ?? "checkin") as CallKind;
  if (!(k in CALLS)) throw new Error("Choose which call to book.");
  return { ...CALLS[k], kind: k };
}

/** The stages before launch, in order. A booking only ever moves a client forward along them. */
const JOURNEY = [
  "Needs Contacting",
  "GHOSTED",
  "DELAY OUT OF OUR CONTROL",
  "Onboarding Booked",
  "Brand Blueprint Booked\u2660\ufe0f",
  "LAUNCH BOOKED",
];

/** The ClickUp stage a booking should move the client to, or null to leave it. */
export function stageAfterBooking(
  current: string | null | undefined,
  kind: CallKind,
): string | null {
  const target = CALLS[kind].stage;
  if (!target) return null;
  const at = JOURNEY.indexOf(String(current ?? ""));
  // Live, paused or stopped clients, and anyone already past the target, stay put.
  if (at < 0 || at >= JOURNEY.indexOf(target)) return null;
  return target;
}

/**
 * The call the journey books next, from the client's ClickUp stage
 * (csmTemplates nextCall): a new signup's onboarding call, the Blueprint once
 * onboarding is booked, the launch call once the Blueprint is, and check-ins
 * for everyone else.
 */
export function suggestedCall(stage: string | null | undefined): CallKind {
  const s = String(stage ?? "");
  if (["Needs Contacting", "GHOSTED", "DELAY OUT OF OUR CONTROL"].includes(s))
    return "onboarding";
  if (/^onboarding booked$/i.test(s)) return "blueprint";
  if (/blueprint/i.test(s)) return "launch";
  return "checkin";
}

/** The client's contact in the Mahara Media client account, opened in HighLevel. */
export function contactUrl(contactId: string): string {
  return `https://app.maharamedia.com/v2/location/${CLIENT_ACCOUNT}/contacts/detail/${encodeURIComponent(contactId)}`;
}
export const CLIENT_ID_FIELD = "Csj6vsVH3wSRseT3OkMU";
export const CHECK_IN_ZONE = "Asia/Kuwait";

type Json = Record<string, any>;
export type GhlRequest = (
  method: string,
  path: string,
  body?: unknown,
) => Promise<Json>;
export class ProviderError extends Error {
  readonly definitive: boolean;
  constructor(message: string, definitive = false) {
    super(message);
    this.definitive = definitive;
  }
}

export function ghlRequest(token: string, location: string): GhlRequest {
  return async (method, path, body) => {
    if (!token || location !== CLIENT_ACCOUNT)
      throw new ProviderError(
        "The Mahara Media client account is not connected for booking.",
        true,
      );
    let res: Response;
    try {
      res = await fetch(`https://services.leadconnectorhq.com${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Version: "2021-04-15",
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new ProviderError(
        "Mahara Media did not return a booking result. Check the calendar before trying again.",
      );
    }
    if (!res.ok) {
      const definitive =
        res.status >= 400 && res.status < 500 && res.status !== 408;
      throw new ProviderError(
        res.status === 409 || res.status === 400
          ? "That time is no longer available. Choose another time."
          : `The calendar service could not complete this request (${res.status}).`,
        definitive,
      );
    }
    try {
      return await res.json();
    } catch {
      throw new ProviderError(
        "The calendar returned an incomplete result. Check the calendar before trying again.",
      );
    }
  };
}

export function validateDay(day: string, now = Date.now()) {
  const start = Date.parse(`${day}T00:00:00+03:00`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
    !Number.isFinite(start) ||
    new Date(start + 3 * 3600_000).toISOString().slice(0, 10) !== day ||
    start + 86400_000 <= now ||
    start > now + 120 * 86400_000
  )
    throw new Error("Choose a day in the next four months.");
  return start;
}

export async function findContact(request: GhlRequest, taskId: string) {
  const result = await request("POST", "/contacts/search", {
    locationId: CLIENT_ACCOUNT,
    page: 1,
    pageLimit: 100,
    filters: [
      {
        field: `customFields.${CLIENT_ID_FIELD}`,
        operator: "eq",
        value: taskId,
      },
    ],
  });
  const contacts: Json[] = result.contacts ?? [];
  // Never accept a provider ignoring the filter, truncating duplicates, or crossing accounts.
  const exact = contacts.filter(
    c =>
      c.locationId === CLIENT_ACCOUNT &&
      c.id &&
      (c.customFields ?? []).some(
        (f: Json) =>
          f.id === CLIENT_ID_FIELD && String(f.value ?? "").trim() === taskId,
      ),
  );
  if (
    contacts.length !== 1 ||
    exact.length !== 1 ||
    Number(result.total ?? contacts.length) !== 1
  )
    throw new Error(
      contacts.length === 0
        ? "No contact has this Client ID in the Mahara Media client account. Add the ID to the client's contact, then try again."
        : "The Client ID does not identify one contact in the Mahara Media client account. Check the contact records before booking.",
    );
  const c = exact[0];
  return {
    id: String(c.id),
    name: String(
      c.contactName ||
        c.name ||
        [c.firstName, c.lastName].filter(Boolean).join(" ") ||
        c.companyName ||
        "Client contact",
    ),
    phone: c.phone ? String(c.phone) : null,
    email: c.email ? String(c.email) : null,
    url: contactUrl(String(c.id)),
  };
}

export async function getCalendar(
  request: GhlRequest,
  kind: CallKind = "checkin",
) {
  const call = callOf(kind);
  const result = await request("GET", `/calendars/${call.calendarId}`);
  const c = result.calendar;
  if (
    !c ||
    c.id !== call.calendarId ||
    c.locationId !== CLIENT_ACCOUNT ||
    c.isActive === false
  )
    throw new Error(
      `The Mahara Media ${call.label.toLowerCase()} calendar is unavailable.`,
    );
  const minutes = Number(c.slotDuration);
  if (
    !Number.isFinite(minutes) ||
    minutes < 1 ||
    minutes > 120 ||
    !["mins", "minutes"].includes(c.slotDurationUnit)
  )
    throw new Error(
      `The ${call.label.toLowerCase()} calendar's call duration needs checking.`,
    );
  return {
    id: call.calendarId,
    name: String(c.name),
    minutes,
    kind: call.kind,
    label: call.label,
  };
}

export async function availableSlots(
  request: GhlRequest,
  day: string,
  now = Date.now(),
  kind: CallKind = "checkin",
) {
  const start = validateDay(day, now);
  const result = await request(
    "GET",
    `/calendars/${callOf(kind).calendarId}/free-slots?${new URLSearchParams({
      startDate: String(start),
      endDate: String(start + 86400_000 - 1),
      timezone: CHECK_IN_ZONE,
    })}`,
  );
  if (result[day] && !Array.isArray(result[day].slots))
    throw new Error("Available times could not be read. Try again.");
  const slots: string[] = result[day]?.slots ?? [];
  return [
    ...new Set(
      slots.filter(
        s =>
          typeof s === "string" &&
          /(?:Z|[+-]\d{2}:\d{2})$/.test(s) &&
          Number.isFinite(Date.parse(s)) &&
          Date.parse(s) > now &&
          new Date(Date.parse(s) + 3 * 3600_000).toISOString().slice(0, 10) ===
            day,
      ),
    ),
  ].sort();
}

export async function prepareCheckIn(
  request: GhlRequest,
  taskId: string,
  day: string,
  now = Date.now(),
  kind: CallKind = "checkin",
) {
  callOf(kind);
  validateDay(day, now);
  const [contact, calendar, slots] = await Promise.all([
    findContact(request, taskId),
    getCalendar(request, kind),
    availableSlots(request, day, now, kind),
  ]);
  return { contact, calendar, slots, day, timezone: CHECK_IN_ZONE, kind };
}

export async function verifySelection(
  request: GhlRequest,
  taskId: string,
  contactId: string,
  startTime: string,
  now = Date.now(),
  kind: CallKind = "checkin",
) {
  const start = Date.parse(startTime);
  if (!Number.isFinite(start)) throw new Error("Choose an available time.");
  const day = new Date(start + 3 * 3600_000).toISOString().slice(0, 10);
  const prepared = await prepareCheckIn(request, taskId, day, now, kind);
  if (prepared.contact.id !== contactId)
    throw new Error("The linked contact changed. Reopen booking to review it.");
  if (!prepared.slots.some(s => Date.parse(s) === start))
    throw new Error("That time is no longer available. Choose another time.");
  return {
    ...prepared,
    startTime: new Date(start).toISOString(),
    endTime: new Date(start + prepared.calendar.minutes * 60_000).toISOString(),
  };
}

export async function createCheckIn(
  request: GhlRequest,
  selection: Awaited<ReturnType<typeof verifySelection>>,
  clientName: string,
) {
  const call = callOf(selection.kind);
  const made = await request("POST", "/calendars/events/appointments", {
    calendarId: call.calendarId,
    locationId: CLIENT_ACCOUNT,
    contactId: selection.contact.id,
    startTime: selection.startTime,
    endTime: selection.endTime,
    title: `${clientName} | ${call.label}`,
    appointmentStatus: "confirmed",
    ignoreFreeSlotValidation: false,
    ignoreDateRange: false,
    toNotify: true,
  });
  const receipt = made.appointment ?? made;
  if (
    !receipt.id ||
    receipt.contactId !== selection.contact.id ||
    receipt.calendarId !== call.calendarId ||
    receipt.locationId !== CLIENT_ACCOUNT ||
    Date.parse(receipt.startTime) !== Date.parse(selection.startTime)
  )
    throw new ProviderError(
      "The booking result needs checking in the calendar before another attempt.",
    );
  return {
    appointmentId: String(receipt.id),
    startTime: selection.startTime,
    endTime: selection.endTime,
  };
}
