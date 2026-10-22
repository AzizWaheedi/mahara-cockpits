import { clientRefusal, isClient, readClient } from "./clients.ts";
import { calendarFor, ghlTime } from "./dialer.ts";
import { cleanText, type Who } from "./lib.ts";
import { ApiRefusal, type LiveIO } from "./liveio.ts";
import { dayBounds } from "./dayReview.ts";

type Row = Record<string, unknown>;
const enc = encodeURIComponent;
const DAY = 86_400_000;
const at = (v: unknown) => Date.parse(String(v ?? ""));
const obj = (v: unknown): Row =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Row) : {};
const eventOf = (v: Row) => obj(v.appointment ?? v.event ?? v);
const statusOf = (v: Row) =>
  String(v.appointmentStatus ?? v.appoinmentStatus ?? v.status ?? "");
const sameTime = (a: unknown, b: unknown) =>
  Math.abs(ghlTime(a) - at(b)) < 1000;

export function makeDemoHandoffs(d: {
  io: LiveIO;
  locationId: string;
  audit: (
    who: Who,
    action: string,
    entity: string,
    id: string | null,
    before: unknown,
    after: unknown,
    metadata?: Row,
  ) => Promise<void>;
  markAppointment: (
    who: Who,
    id: string,
    status: string,
    opts?: { quiet?: boolean; anyRep?: boolean; note?: string | null },
  ) => Promise<Row>;
}) {
  const { io } = d;
  const setting = async () =>
    obj(
      (await io.db("cockpit_sales_settings?key=eq.calendars&select=value"))[0]
        ?.value,
    );
  async function leadFor(contact: string) {
    const lead = (
      await io.db(`cockpit_sales_leads?contact_id=eq.${enc(contact)}&select=*`)
    )[0];
    if (!lead) throw new ApiRefusal("That lead is not in the cockpit.", 404);
    const facts = await readClient(io.db, contact, lead);
    if (facts.client) throw new ApiRefusal(clientRefusal(facts), 409);
    return lead;
  }
  async function hosts() {
    return await io.db(
      "cockpit_sales_people?active=eq.true&ghl_user_id=not.is.null&select=email,name,role,ghl_user_id&order=name",
    );
  }
  async function plan(who: Who, b: Row) {
    const contact = cleanText(b.contact_id, 80);
    await leadFor(contact);
    const [people, calls, receipts] = await Promise.all([
      hosts(),
      io.db(
        `cockpit_sales_calendar?contact_id=eq.${enc(contact)}&start_at=gte.${enc(new Date(io.now() - 7 * DAY).toISOString())}&call_type=in.(intro,demo)&order=start_at.desc&select=*`,
      ),
      io.db(
        `cockpit_sales_demo_handoffs?contact_id=eq.${enc(contact)}&order=created_at.desc&limit=7&select=*`,
      ),
    ]);
    return { hosts: people, calls, receipts, mine: who.email };
  }
  async function patch(id: string, changes: Row) {
    return (
      await io.db(`cockpit_sales_demo_handoffs?id=eq.${enc(id)}`, {
        method: "PATCH",
        body: { ...changes, updated_at: new Date(io.now()).toISOString() },
        prefer: "return=representation",
      })
    )[0];
  }
  async function events(contact: string): Promise<Row[]> {
    const out = await io.ghl("GET", `/contacts/${enc(contact)}/appointments`);
    if (!Array.isArray(out.events))
      throw new ApiRefusal(
        "HighLevel's calls could not be checked. Try again before recording a demo.",
        503,
      );
    return out.events as Row[];
  }
  async function record(who: Who, b: Row) {
    const contact = cleanText(b.contact_id, 80);
    const id = cleanText(b.request_id, 40);
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id,
      )
    )
      throw new ApiRefusal("Reload the lead before recording this demo.");
    if (!who.ghl_user_id || !who.email)
      throw new ApiRefusal(
        "Link your HighLevel user on the Team page first.",
        409,
      );
    const lead = await leadFor(contact);
    const demoStart = at(b.demo_start),
      demoEnd = at(b.demo_end),
      introStart = at(b.intro_start);
    if (
      ![demoStart, demoEnd, introStart].every(Number.isFinite) ||
      introStart >= demoStart ||
      demoStart >= demoEnd ||
      demoEnd > io.now() + 60_000 ||
      introStart < io.now() - 7 * DAY ||
      demoEnd - demoStart > 4 * 3_600_000
    )
      throw new ApiRefusal(
        "Enter the actual call times, within the last seven days. The demo should end after it starts and by now.",
      );
    const day = new Date(demoStart + 3 * 3_600_000).toISOString().slice(0, 10);
    const team = await hosts();
    const host = team.find(p => p.email === cleanText(b.host_email, 200));
    if (!host)
      throw new ApiRefusal(
        "Choose an active teammate linked to HighLevel.",
        409,
      );
    const sourceId = cleanText(b.intro_id, 80) || null;
    const existingDemo = cleanText(b.demo_id, 80) || null;
    const source = sourceId
      ? (
          await io.db(
            `cockpit_sales_calendar?appointment_id=eq.${enc(sourceId)}&select=*`,
          )
        )[0]
      : null;
    if (
      sourceId &&
      (!source ||
        source.contact_id !== contact ||
        source.call_type !== "intro" ||
        at(source.start_at) > demoStart ||
        at(source.start_at) < io.now() - 7 * DAY)
    )
      throw new ApiRefusal(
        "Choose this lead's intro from the last seven days.",
        409,
      );
    if (
      source &&
      ["noshow", "cancelled", "invalid"].includes(String(source.status))
    )
      throw new ApiRefusal(
        "Correct the intro's outcome to Showed before recording its demo.",
        409,
      );
    if (
      !who.manager &&
      host.email !== who.email &&
      (!source || source.assigned_user_id !== who.ghl_user_id)
    )
      throw new ApiRefusal(
        "Record a demo you took, or hand over an intro assigned to you.",
        403,
      );
    const setter = source
      ? team.find(p => p.ghl_user_id === source.assigned_user_id)
      : team.find(p => p.email === who.email);
    if (!setter)
      throw new ApiRefusal(
        "Link the intro owner's active HighLevel seat before recording this handoff.",
        409,
      );
    let receipt = (
      await io.db(
        `cockpit_sales_demo_handoffs?contact_id=eq.${enc(contact)}&day=eq.${day}&select=*`,
      )
    )[0];
    if (receipt) {
      if (receipt.by_email !== who.email && !who.manager)
        throw new ApiRefusal(
          "A teammate already recorded or started this handoff. Refresh the lead.",
          409,
        );
      if (receipt.state === "recorded") {
        if (
          receipt.host_email !== host.email ||
          receipt.source_intro_id !== sourceId ||
          !sameTime(receipt.demo_start, b.demo_start) ||
          !sameTime(receipt.demo_end, b.demo_end)
        )
          throw new ApiRefusal(
            "This demo was already recorded with different details. Edit its existing call instead.",
            409,
          );
        return { receipt, repeated: true };
      }
      if (receipt.id !== id)
        throw new ApiRefusal(
          "This handoff already has a saved attempt. Use Check saved demo to reconcile it.",
          409,
        );
      if (
        receipt.state === "recording" &&
        io.now() - at(receipt.updated_at) < 90_000
      )
        throw new ApiRefusal(
          "This demo is still being saved. Check it again shortly.",
          409,
        );
      if (
        receipt.host_email !== host.email ||
        receipt.source_intro_id !== sourceId ||
        (!sourceId && !sameTime(receipt.intro_start, b.intro_start)) ||
        !sameTime(receipt.demo_start, b.demo_start) ||
        !sameTime(receipt.demo_end, b.demo_end)
      )
        throw new ApiRefusal(
          "Use the saved handoff's original details while its result is being checked.",
          409,
        );
      // Exactly one reconciler may continue the receipt.
      const claimed = await io.db(
        `cockpit_sales_demo_handoffs?id=eq.${enc(id)}&state=eq.${enc(String(receipt.state))}&updated_at=eq.${enc(String(receipt.updated_at))}`,
        {
          method: "PATCH",
          body: {
            state: "recording",
            updated_at: new Date(io.now()).toISOString(),
          },
          prefer: "return=representation",
        },
      );
      if (!claimed.length)
        throw new ApiRefusal(
          "Another check is running. Refresh in a moment.",
          409,
        );
      receipt = claimed[0];
    } else {
      const liveContact = obj(
        (await io.ghl("GET", `/contacts/${enc(contact)}`)).contact,
      );
      if (String(liveContact.id) !== contact || isClient(liveContact))
        throw new ApiRefusal(
          "This contact is unavailable or is now a client. Refresh the lead.",
          409,
        );
      const calendars = await setting();
      const all = await events(contact);
      const { from, to } = dayBounds(day);
      const demos = all.filter(
        e =>
          obj(calendars[String(e.calendarId)]).type === "demo" &&
          !["cancelled", "noshow"].includes(statusOf(e)) &&
          ghlTime(e.startTime) >= at(from) &&
          ghlTime(e.startTime) < at(to),
      );
      const intros = all.filter(
        e =>
          obj(calendars[String(e.calendarId)]).type === "intro" &&
          !["cancelled", "noshow"].includes(statusOf(e)) &&
          ghlTime(e.startTime) >= at(from) &&
          ghlTime(e.startTime) < at(to),
      );
      if (!sourceId && intros.length)
        throw new ApiRefusal(
          "Select the intro already recorded that day so it is counted once.",
          409,
        );
      if (
        demos.length &&
        (!existingDemo || !demos.some(e => String(e.id) === existingDemo))
      )
        throw new ApiRefusal(
          "This lead already has a demo that day. Select that demo so it is counted once.",
          409,
        );
      if (existingDemo && !demos.some(e => String(e.id) === existingDemo))
        throw new ApiRefusal(
          "That demo changed in HighLevel. Refresh the lead.",
          409,
        );
      try {
        receipt = (
          await io.db("cockpit_sales_demo_handoffs", {
            method: "POST",
            body: {
              id,
              contact_id: contact,
              day,
              source_intro_id: sourceId,
              intro_id: sourceId,
              demo_id: existingDemo,
              setter_email: setter.email,
              host_email: host.email,
              by_email: who.email,
              intro_start: new Date(
                source ? at(source.start_at) : introStart,
              ).toISOString(),
              demo_start: new Date(demoStart).toISOString(),
              demo_end: new Date(demoEnd).toISOString(),
              state: "recording",
              note: cleanText(b.note, 4000) || null,
              before_demo:
                demos.find(e => String(e.id) === existingDemo) ?? null,
            },
            prefer: "return=representation",
          })
        )[0];
      } catch (e) {
        if (/23505|duplicate/.test(String(e)))
          throw new ApiRefusal(
            "This lead already has a handoff for that day. Refresh to see it.",
            409,
          );
        throw e;
      }
    }
    try {
      const calendars = await setting();
      for (const kind of ["intro", "demo"] as const) {
        if (kind === "intro" && String(receipt.phase ?? "").startsWith("demo_"))
          continue;
        const person = kind === "intro" ? setter : host;
        const start = String(receipt[`${kind}_start`]);
        const end =
          kind === "intro"
            ? String(receipt.demo_start)
            : String(receipt.demo_end);
        const field = `${kind}_id`;
        const existing = String(receipt[field] ?? "");
        let appointmentId = existing;
        const calendar = existing
          ? String(
              eventOf(
                await io.ghl(
                  "GET",
                  `/calendars/events/appointments/${enc(existing)}`,
                ),
              ).calendarId ?? "",
            )
          : calendarFor(
              kind,
              String(lead.lead_class ?? ""),
              calendars as Record<string, { type?: string }>,
            );
        if (!calendar || obj(calendars[calendar]).type !== kind)
          throw new ApiRefusal(
            `The ${kind} calendar is unavailable. Ask a manager to check its setup.`,
            409,
          );
        const title = `${kind === "intro" ? "Intro" : "Demo"} recorded [${id}:${kind}]`;
        const body: Row = {
          calendarId: calendar,
          locationId: d.locationId,
          contactId: contact,
          startTime: start,
          endTime: end,
          title,
          appointmentStatus: "showed",
          assignedUserId: person.ghl_user_id,
          toNotify: false,
          ignoreFreeSlotValidation: true,
          ignoreDateRange: true,
        };
        if (kind === "intro" && sourceId) {
          // Preserve its time, owner and original record. Mark only attendance.
          const original = eventOf(
            await io.ghl(
              "GET",
              `/calendars/events/appointments/${enc(sourceId)}`,
            ),
          );
          if (
            String(original.contactId) !== contact ||
            String(original.assignedUserId) !== String(setter.ghl_user_id) ||
            !sameTime(original.startTime, receipt.intro_start)
          )
            throw new ApiRefusal(
              "The intro changed in HighLevel. Ask a manager to check this saved handoff.",
              409,
            );
          const marked = await d.markAppointment(who, sourceId, "showed", {
            quiet: true,
            anyRep: true,
            note: String(receipt.note ?? "") || null,
          });
          const checked = eventOf(
            await io.ghl(
              "GET",
              `/calendars/events/appointments/${enc(sourceId)}`,
            ),
          );
          if (marked.crm === "failed" || statusOf(checked) !== "showed")
            throw new ApiRefusal(
              "The intro outcome is not confirmed in HighLevel yet. Check the saved handoff again.",
              409,
            );
          receipt = await patch(id, { phase: "intro_done" });
          continue;
        }
        if (!existing && receipt.phase === `${kind}_writing`) {
          const found = (await events(contact)).filter(
            e =>
              e.title === title &&
              String(e.contactId) === contact &&
              String(e.calendarId) === calendar &&
              sameTime(e.startTime, start) &&
              String(e.assignedUserId) === String(person.ghl_user_id),
          );
          if (found.length !== 1)
            throw new ApiRefusal(
              "HighLevel's earlier answer is still uncertain. Ask a manager to check the saved attempt before recording another demo.",
              409,
            );
          appointmentId = String(found[0].id);
        } else if (!existing) {
          receipt = await patch(id, { phase: `${kind}_writing` });
          const made = eventOf(
            await io.ghl("POST", "/calendars/events/appointments", body),
          );
          appointmentId = String(made.id ?? "");
          if (!appointmentId)
            throw new Error("HighLevel did not return the appointment id.");
          receipt = await patch(id, { [field]: appointmentId });
        } else if (kind === "demo" && receipt.phase !== "demo_done") {
          const before = eventOf(
            await io.ghl(
              "GET",
              `/calendars/events/appointments/${enc(existing)}`,
            ),
          );
          if (
            String(before.contactId) !== contact ||
            String(before.calendarId) !== calendar
          )
            throw new ApiRefusal(
              "The saved demo belongs to another record. Ask a manager to check it.",
              409,
            );
          receipt = await patch(id, { phase: "demo_writing" });
          // PUT is a desired state, safe to reconcile and repeat for this exact id.
          await io.ghl(
            "PUT",
            `/calendars/events/appointments/${enc(existing)}`,
            body,
          );
        }
        const back = eventOf(
          await io.ghl(
            "GET",
            `/calendars/events/appointments/${enc(appointmentId)}`,
          ),
        );
        if (
          String(back.contactId) !== contact ||
          String(back.calendarId) !== calendar ||
          String(back.assignedUserId) !== String(person.ghl_user_id) ||
          !sameTime(back.startTime, start) ||
          !sameTime(back.endTime, end) ||
          statusOf(back) !== "showed"
        )
          throw new ApiRefusal(
            "HighLevel has not confirmed the demo's time, host and outcome. Check the saved attempt again.",
            409,
          );
        await io.db("cockpit_sales_appointments?on_conflict=appointment_id", {
          method: "POST",
          body: {
            appointment_id: appointmentId,
            contact_id: contact,
            contact_name: lead.name,
            calendar_id: calendar,
            call_type: kind,
            start_at: start,
            booked_at: back.dateAdded ?? new Date(io.now()).toISOString(),
            status: "showed",
            assigned_user_id: person.ghl_user_id,
            assigned_user_name: person.name,
            origin: "ghl",
            mirrored_at: new Date(io.now()).toISOString(),
          },
          prefer: "resolution=merge-duplicates,return=minimal",
        });
        await d.markAppointment(who, appointmentId, "showed", {
          quiet: true,
          anyRep: true,
          note: String(receipt.note ?? "") || null,
        });
        receipt = await patch(id, {
          [field]: appointmentId,
          phase: `${kind}_done`,
        });
      }
      receipt = await patch(id, { state: "recorded", error: null });
      await d.audit(
        who,
        "demo.record",
        "cockpit_sales_demo_handoffs",
        id,
        null,
        receipt,
      );
      return { receipt };
    } catch (e) {
      const error = String((e as Error).message ?? e);
      await patch(id, { state: "uncertain", error: error.slice(0, 1000) });
      throw new ApiRefusal(
        `${error} The attempt is saved. Use Check saved demo before trying a new one.`,
        409,
        { receipt_id: id },
      );
    }
  }
  return { plan, record };
}
