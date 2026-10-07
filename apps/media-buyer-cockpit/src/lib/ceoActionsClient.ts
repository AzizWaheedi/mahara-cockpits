import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_WORKING_HOURS,
  normalizeWorkingHours,
  workingHoursFromStored,
} from "../types/ceo/workingHours";

const maskText = (s: string, max = 300) =>
  s
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email]")
    .replace(/\+?\d(?: ?\d){7,}/g, "[number]")
    .replace(/\s*[\u2014\u2013]\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
type Row = Record<string, any>;
const roleKeyOf = (role: unknown) =>
  String(role ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
const stamp = (x: unknown) => (x ? Date.parse(String(x)) : null);
const feedback = (r: Row) => ({
  id: Number(r.id),
  kind: r.kind,
  text: r.text,
  status: r.status,
  batch: r.batch ?? null,
  note: r.note ?? null,
  createdAt: stamp(r.created_at),
  dispatchedAt: stamp(r.dispatched_at),
  doneAt: stamp(r.done_at),
});
const template = (t: Row) => ({
  roleKey: t.role_key,
  title: t.title,
  mission: t.mission ?? "",
  items: t.items ?? [],
  competencies: t.competencies ?? [],
  bonus: t.bonus ?? null,
  updatedBy: t.updated_by ?? null,
  updatedAt: t.updated_at ?? null,
});
export function personPageFromRows(raw: Row, args: Row) {
  const personId = Number(args.personId),
    month =
      args.month ??
      new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))
    throw new Error("Choose a valid scorecard month.");
  const profile: Row = { personId };
  for (const [camel, snake] of Object.entries({
    personalGoals: "personal_goals",
    professionalGoals: "professional_goals",
    greenFlags: "green_flags",
    redFlags: "red_flags",
    doThis: "do_this",
    dontDoThis: "dont_do_this",
    notes: "notes",
    gradesNote: "grades_note",
  }))
    profile[camel] = raw.profile?.[snake] ?? "";
  for (const key of ["skill", "will", "culture"])
    profile[key] = raw.profile?.[key] ?? null;
  profile.updatedBy = raw.profile?.updated_by ?? null;
  profile.updatedAt = raw.profile?.updated_at ?? null;
  const cards: Row[] = raw.cards,
    templates: Row[] = raw.templates;
  const saved = cards.find(c => c.month === month),
    roleKey = saved?.role_key ?? roleKeyOf(raw.person?.role);
  const t = templates.find(t => t.role_key === roleKey),
    previous = cards
      .filter(c => c.month < month)
      .sort((a, b) => b.month.localeCompare(a.month))[0];
  let scorecard: Row | null = null;
  if (saved || previous || t) {
    const base = saved ?? previous ?? t;
    scorecard = {
      id: saved ? Number(saved.id) : null,
      personId,
      month,
      roleKey: base.role_key,
      title: base.title ?? roleKey,
      mission: base.mission ?? "",
      items: saved
        ? base.items
        : (base.items ?? []).map((i: Row) => ({
            ...i,
            grade: null,
            comment: "",
          })),
      overall: saved?.overall ?? null,
      summary: saved?.summary ?? "",
      reviewedOn: saved?.reviewed_on ?? null,
      reviewedBy: saved?.reviewed_by ?? null,
      status: saved?.status ?? "draft",
      competencies: t?.competencies ?? [],
      bonus: t?.bonus ?? null,
      fresh: !saved,
      startedFrom: saved ? null : (previous?.month ?? null),
    };
  }
  return {
    person: raw.person,
    profile,
    scorecard,
    files: raw.files.map((f: Row) => ({
      id: Number(f.id),
      kind: f.kind,
      name: f.name,
      sizeBytes: f.size_bytes === null ? null : Number(f.size_bytes),
      mime: f.mime,
      uploadedBy: f.uploaded_by,
      uploadedAt: f.uploaded_at,
    })),
    months: cards.map(c => ({
      month: c.month,
      overall: c.overall ?? null,
      status: c.status,
    })),
    templateRoles: templates.map(t => ({
      roleKey: t.role_key,
      title: t.title,
    })),
  };
}
export async function ceoAction(
  client: SupabaseClient,
  action: string,
  args: Row = {},
): Promise<any> {
  if (
    action === "bankImport.importStatement" ||
    action === "bankPdf.importPdf" ||
    action === "payers.list" ||
    action === "queries.refreshNow"
  ) {
    const { data, error } = await client.functions.invoke("cockpit-ceo-api", {
      body: { operation: action, args, apply: true },
    });
    if (error || data?.error) {
      let detail = data?.error;
      if (
        !detail &&
        error &&
        typeof (error as any).context?.json === "function"
      )
        try {
          detail = (await (error as any).context.json())?.error;
        } catch {}
      throw new Error(
        detail ?? error?.message ?? "The server operation was not confirmed.",
      );
    }
    if (action === "queries.refreshNow") {
      if (typeof data?.id !== "string")
        throw new Error("Finance refresh was not queued.");
      const until = Date.now() + 300000;
      while (Date.now() < until) {
        const { data: state, error: stateError } = await client.rpc(
          "cockpit_finance_refresh_status",
          { p_id: data.id },
        );
        if (stateError) throw new Error(stateError.message);
        if (state.status === "confirmed") return state.result;
        if (state.status === "failed")
          throw new Error(state.error ?? "Finance refresh failed.");
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      throw new Error(
        "Finance refresh is still running. Its previous figures remain visible; check again shortly.",
      );
    }
    if (action === "payers.list") {
      if (!Array.isArray(data?.payers))
        throw new Error("Payer source was not confirmed.");
      return data;
    }
    if (!data?.statementId || !Number.isInteger(data.kept))
      throw new Error("The bank import was not confirmed.");
    return data;
  }
  if (action === "profiles.uploadFile") {
    const bytes = Uint8Array.from(atob(args.base64), c => c.charCodeAt(0));
    if (bytes.length === 0 || bytes.length > 8388608)
      throw new Error("Choose a file up to 8 MB.");
    const reservation = await ceoAction(client, "profiles.reserveFile", {
      personId: args.personId,
      kind: args.kind,
      name: String(args.name).trim().slice(0, 160) || "file",
      mime: args.mime,
      sizeBytes: bytes.length,
    });
    const { error } = await client.storage
      .from("cockpit-people")
      .upload(reservation.path, bytes, {
        contentType: args.mime || "application/octet-stream",
        upsert: false,
      });
    if (error) throw new Error("The file did not upload: " + error.message);
    return ceoAction(client, "profiles.confirmFile", { id: reservation.id });
  }
  if (action === "profiles.fileUrl") {
    const row = await ceoAction(client, "profiles.filePath", args);
    const { data, error } = await client.storage
      .from("cockpit-people")
      .createSignedUrl(row.path, 600);
    if (error || !data?.signedUrl)
      throw new Error(error?.message ?? "The file link was not confirmed.");
    return { url: data.signedUrl };
  }
  if (action === "settings.setWorkingHours")
    args = normalizeWorkingHours(args as any, "settings");
  const { data, error } = await client.rpc("cockpit_ceo_action", {
    p_action: action,
    p_args: args,
  });
  if (error) throw new Error(error.message);
  if (data === null || data === undefined)
    throw new Error("The server did not confirm this action.");
  if (action === "settings.get") {
    const hours = data.row
      ? workingHoursFromStored(data.row.value, stamp(data.row.updated_at))
      : DEFAULT_WORKING_HOURS;
    if (!hours)
      throw new Error(
        "Saved working hours are invalid. Correct the working-hours setting.",
      );
    return { hours, ready: true, problem: null };
  }
  if (action === "settings.setWorkingHours")
    return {
      ok: true,
      hours: workingHoursFromStored(data.row.value, stamp(data.row.updated_at)),
    };
  if (action === "feedback.list") {
    const items = data.map(feedback),
      open = items.filter((i: Row) =>
        ["queued", "dispatched", "in_progress"].includes(i.status),
      );
    return {
      open,
      closed: items
        .filter((i: Row) => ["done", "dismissed"].includes(i.status))
        .slice(0, 40),
      queued: open.filter((i: Row) => i.status === "queued").length,
    };
  }
  if (action === "feedback.add") return feedback(data);
  if (action === "bankImport.overview") {
    const rows = data.statements,
      last = rows.reduce(
        (m: string | null, r: Row) =>
          r.to_day && (!m || r.to_day > m) ? r.to_day : m,
        null,
      ),
      today = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
    const daysSince = last
      ? Math.round((Date.parse(today) - Date.parse(last)) / 86400000)
      : null;
    return {
      statements: rows.map((r: Row) => ({
        id: String(r.id),
        account: r.account,
        accountKind: r.account_kind,
        currency: r.currency,
        fromDay: r.from_day,
        toDay: r.to_day,
        lines: Number(r.lines),
        totalDebit: r.total_debit === null ? null : Number(r.total_debit),
        totalCredit: r.total_credit === null ? null : Number(r.total_credit),
        closingBalance:
          r.closing_balance === null ? null : Number(r.closing_balance),
        fileName: r.file_name,
        importedAt: stamp(r.imported_at),
      })),
      exclusions: data.exclusions.map((r: Row) => ({
        id: Number(r.id),
        kind: r.kind,
        pattern: r.pattern,
        note: r.note,
      })),
      lastStatementTo: last,
      daysSince,
      stale: daysSince === null || daysSince > 7,
    };
  }
  if (action === "teamStatus.list")
    return data.map((r: Row) => ({
      personKey: r.person_key,
      status: r.status,
      since: r.since,
      note: r.note ? maskText(r.note) : null,
      setAt: stamp(r.set_at),
      setBy: "Aziz",
    }));
  if (action === "teamStatus.history")
    return data.map((r: Row) => ({
      action: r.action,
      table: "ceoTeamStatus",
      rowId: r.entity_id,
      what: maskText(
        `Marked ${r.entity_id} as ${r.after?.status} from ${r.after?.since}${r.after?.note ? ". " + r.after.note : ""}`,
        400,
      ),
      by: "Aziz",
      at: stamp(r.created_at),
    }));
  if (action === "teamStatus.set") return null;
  if (action === "profiles.page") return personPageFromRows(data, args);
  if (action === "profiles.templates") return data.map(template);
  return data;
}
