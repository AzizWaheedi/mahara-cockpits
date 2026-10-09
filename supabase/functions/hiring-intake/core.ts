/** Native adapters for the four hiring sources. No messages or hiring decisions. */
export type Row = Record<string, any>;
export type Provider = "tally" | "typeform";
export const LOCATION = "2FMeC6zxqelIG07OViBj";
export const SOURCES: Record<
	string,
	{
		provider: Provider;
		role: string;
		title: string;
		refs?: Record<string, string>;
	}
> = {
	"9qQR6G": {
		provider: "tally",
		role: "sales-closer",
		title: "High-Ticket Closer Job Application",
	},
	b5VvQZ: {
		provider: "tally",
		role: "call-centre",
		title: "Client Sales Rep Job Application",
	},
	rqv3Fkts: {
		provider: "typeform",
		role: "sales-closer",
		title: "High-Ticket Closer Job Application",
		refs: {
			name: "4d1d6112-81eb-4f7a-8060-8c020d7dd8c8",
			email: "f5bd8d24-9a36-455c-ab55-812d04645af8",
			phone: "254cf9eb-5124-40da-a362-5b50b909b892",
		},
	},
	oW8CWRhi: {
		provider: "typeform",
		role: "csm",
		title: "Client Success Manager Application",
		refs: {
			name: "c8dfedbf-4a6e-41a8-8690-baa92e1bacf1",
			email: "e610df17-4b52-4b6d-8807-55d485859a33",
			phone: "62ad7af1-aa5b-464a-94ac-a296d9b01e3e",
		},
	},
};
export type Answer = { ref: string; title: string; type: string; text: string };
export type Application = {
	provider: Provider;
	form: string;
	response: string;
	role: string;
	title: string;
	submittedAt: string;
	name: string;
	email: string;
	phone: string;
	portfolio: string;
	answers: Answer[];
	transcript: string;
};
export class IntakeError extends Error {
	constructor(
		public code: string,
		public status = 400,
	) {
		super(code);
	}
}
const txt = (v: unknown) => (typeof v === "string" ? v.trim() : "");
function valueText(a: Row): string {
	if (a.value === null || a.value === undefined) return "";
	if (a.type === "FILE_UPLOAD")
		return (Array.isArray(a.value) ? a.value : [])
			.map((f: Row) => txt(f.url))
			.filter(Boolean)
			.join("\n");
	if (Array.isArray(a.value))
		return a.value
			.map(
				(v: unknown) =>
					a.options?.find((o: Row) => o.id === v)?.text ?? String(v),
			)
			.join(", ");
	if (typeof a.value === "object") return JSON.stringify(a.value);
	return String(a.value);
}
function tfText(a: Row): string {
	if (a.type === "choice") return txt(a.choice?.label ?? a.choice?.other);
	if (a.type === "choices")
		return [...(a.choices?.labels ?? []), a.choices?.other]
			.filter(Boolean)
			.join(", ");
	if (a.type === "boolean") return a.boolean ? "Yes" : "No";
	return String(a[a.type] ?? "");
}
function one(answers: Answer[], f: (a: Answer) => boolean): string {
	const found = answers.filter((a) => f(a) && a.text.trim());
	if (found.length > 1) throw new IntakeError("ambiguous_identity_field");
	return found[0]?.text.trim() ?? "";
}
export function normalize(provider: Provider, body: Row): Application {
	const d = provider === "tally" ? body.data : body.form_response;
	if (
		!d ||
		(provider === "tally"
			? body.eventType !== "FORM_RESPONSE"
			: body.event_type !== "form_response")
	)
		throw new IntakeError("invalid_event");
	const form = txt(provider === "tally" ? d.formId : d.form_id),
		source = SOURCES[form];
	if (!source || source.provider !== provider)
		throw new IntakeError("unsupported_form");
	const response = txt(
		provider === "tally" ? (d.submissionId ?? d.responseId) : d.token,
	);
	if (!/^[a-zA-Z0-9_-]{1,150}$/.test(response))
		throw new IntakeError("invalid_response_id");
	const rawDate = provider === "tally" ? d.createdAt : d.submitted_at;
	if (typeof rawDate !== "string" || !Number.isFinite(Date.parse(rawDate)))
		throw new IntakeError("invalid_submission_date");
	const titles = new Map<string, string>();
	const walk = (fields: Row[]) => {
		for (const f of fields ?? []) {
			titles.set(String(f.ref ?? f.id), String(f.title ?? ""));
			walk(f.properties?.fields ?? []);
		}
	};
	if (provider === "typeform") walk(d.definition?.fields ?? []);
	const answers: Answer[] =
		provider === "tally"
			? (d.fields ?? []).map((f: Row) => ({
					ref: txt(f.key),
					title: txt(f.label),
					type: txt(f.type),
					text: valueText(f),
				}))
			: (d.answers ?? []).map((a: Row) => ({
					ref: txt(a.field?.ref ?? a.field?.id),
					title: titles.get(String(a.field?.ref ?? a.field?.id)) ?? "",
					type: txt(a.type),
					text: tfText(a),
				}));
	if (!answers.length || answers.length > 200)
		throw new IntakeError("invalid_answers");
	const name = one(answers, (a) =>
		provider === "typeform"
			? a.ref === source.refs?.name
			: a.type === "INPUT_TEXT" &&
				/^(what[’']?s your full name\??|full name\??|name)$/i.test(a.title),
	);
	const email = one(answers, (a) =>
		provider === "typeform"
			? a.ref === source.refs?.email && a.type === "email"
			: a.type === "INPUT_EMAIL",
	);
	const rawPhone = one(answers, (a) =>
		provider === "typeform"
			? a.ref === source.refs?.phone && a.type === "phone_number"
			: a.type === "INPUT_PHONE_NUMBER",
	);
	const phone = rawPhone.replace(/[\s().-]/g, "");
	if (!name || name.length > 200) throw new IntakeError("invalid_name");
	if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
		throw new IntakeError("invalid_email");
	if (phone && !/^\+[1-9]\d{7,14}$/.test(phone))
		throw new IntakeError("invalid_phone");
	if (!email && !phone) throw new IntakeError("missing_identity");
	const assets = answers.filter(
		(a) =>
			a.type === "FILE_UPLOAD" ||
			a.type === "file_url" ||
			/portfolio|recording|drop a link/i.test(a.title),
	);
	const portfolio = assets
		.map((a) => `${a.title || "Attachment"}: ${a.text}`)
		.filter((x) => x.trim())
		.join("\n");
	const transcript = [
		`Application, ${source.title}`,
		`Source: ${provider}/${form}/${response}`,
		...answers
			.filter((a) => a.text.trim())
			.map((a) => `${a.title || a.ref}\n${a.text}`),
	].join("\n\n");
	if (transcript.length > 60000) throw new IntakeError("application_too_large");
	return {
		provider,
		form,
		response,
		role: source.role,
		title: source.title,
		submittedAt: new Date(rawDate).toISOString(),
		name,
		email,
		phone,
		portfolio,
		answers,
		transcript,
	};
}
export async function signatureMatches(
	raw: string,
	received: string,
	secret: string,
	provider: Provider,
): Promise<boolean> {
	if (!secret || !received) return false;
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const bytes = new Uint8Array(
		await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw)),
	);
	const expected =
		(provider === "typeform" ? "sha256=" : "") +
		btoa(String.fromCharCode(...bytes));
	if (received.length !== expected.length) return false;
	let difference = 0;
	for (let i = 0; i < expected.length; i++)
		difference |= received.charCodeAt(i) ^ expected.charCodeAt(i);
	return difference === 0;
}
export async function hash(raw: string): Promise<string> {
	return Array.from(
		new Uint8Array(
			await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw)),
		),
		(b) => b.toString(16).padStart(2, "0"),
	).join("");
}

export type Dependencies = {
	ghl(method: string, path: string, body?: Row): Promise<Row>;
	saveApplication(app: Application, contactId: string): Promise<void>;
	saveCandidate(
		app: Application,
		contactId: string,
		opportunity: Row,
	): Promise<void>;
	checkpoint(phase: string, ids?: Row): Promise<void>;
};
/** Idempotent writes use provider upsert/add-tags. A new opportunity is never
 * retried automatically after an unknown result; the queue marks it for review. */
export async function deliver(
	app: Application,
	meta: Row,
	io: Dependencies,
): Promise<Row> {
	if (
		meta.location !== LOCATION ||
		!meta.pipelines?.[app.role] ||
		!meta.stageIdByKey?.[app.role]?.application
	)
		throw new IntakeError("hiring_mapping_unavailable", 503);
	const pipelineId = meta.pipelines[app.role],
		stageId = meta.stageIdByKey[app.role].application;
	const catalog = await io.ghl(
		"GET",
		`/opportunities/pipelines?locationId=${LOCATION}`,
	);
	const pipeline = catalog.pipelines?.find((p: Row) => p.id === pipelineId);
	if (!pipeline?.stages?.some((stage: Row) => stage.id === stageId))
		throw new IntakeError("live_pipeline_mapping_mismatch", 503);
	const names = app.name.split(/\s+/),
		roleLabel = (
			{
				csm: "Client success manager",
				"call-centre": "Call centre agent",
				"sales-closer": "Sales rep, B2B setter and closer",
			} as Row
		)[app.role];
	const fields = [
		{ id: meta.fields?.role, value: roleLabel },
		{ id: meta.fields?.source, value: `${app.provider}: ${app.title}` },
		{ id: meta.fields?.portfolio, value: app.portfolio },
	].filter((f) => f.id && f.value);
	await io.checkpoint("contact");
	const upsert = await io.ghl("POST", "/contacts/upsert", {
		locationId: LOCATION,
		firstName: names[0],
		lastName: names.slice(1).join(" "),
		name: app.name,
		...(app.email ? { email: app.email } : {}),
		...(app.phone ? { phone: app.phone } : {}),
		customFields: fields,
	});
	const contactId = txt(upsert.contact?.id ?? upsert.id ?? upsert.contactId);
	if (!contactId) throw new IntakeError("contact_result_missing", 502);
	await io.checkpoint("tags", { contact_id: contactId });
	await io.ghl("POST", `/contacts/${contactId}/tags`, {
		tags: ["applicant", app.role],
	});
	await io.saveApplication(app, contactId);
	await io.checkpoint("note_lookup");
	const notes = await io.ghl("GET", `/contacts/${contactId}/notes`);
	if (!Array.isArray(notes.notes))
		throw new IntakeError("note_lookup_invalid", 502);
	const marker = `Source: ${app.provider}/${app.form}/${app.response}`;
	if (
		!notes.notes.some((note: Row) => String(note.body ?? "").includes(marker))
	) {
		await io.checkpoint("note_create");
		await io.ghl("POST", `/contacts/${contactId}/notes`, {
			body:
				app.transcript.length > 20000
					? `${app.transcript.slice(0, 19500)}\n\nFull questionnaire saved in the hiring cockpit.`
					: app.transcript,
		});
	}
	await io.checkpoint("opportunity_lookup");
	const found = await io.ghl(
		"GET",
		`/opportunities/search?location_id=${LOCATION}&pipeline_id=${pipelineId}&contact_id=${encodeURIComponent(contactId)}&limit=100`,
	);
	if (!Array.isArray(found.opportunities))
		throw new IntakeError("opportunity_lookup_invalid", 502);
	let opportunity = found.opportunities.find(
		(o: Row) => o.contactId === contactId && o.pipelineId === pipelineId,
	);
	if (!opportunity) {
		// Persist this phase BEFORE the create. Crash/timeout must not replay it.
		await io.checkpoint("opportunity_create");
		const created = await io.ghl("POST", "/opportunities/", {
			locationId: LOCATION,
			pipelineId,
			pipelineStageId: stageId,
			name: app.name,
			status: "open",
			contactId,
		});
		opportunity = created.opportunity ?? created;
	}
	if (!opportunity?.id)
		throw new IntakeError("opportunity_result_missing", 502);
	const readback = await io.ghl("GET", `/opportunities/${opportunity.id}`);
	opportunity = readback.opportunity ?? readback;
	if (
		opportunity.contactId !== contactId ||
		opportunity.pipelineId !== pipelineId ||
		opportunity.locationId !== LOCATION
	)
		throw new IntakeError("opportunity_readback_mismatch", 502);
	await io.checkpoint("mirror", { opportunity_id: opportunity.id });
	await io.saveCandidate(app, contactId, {
		...opportunity,
		pipelineName: pipeline.name,
		stageName: pipeline.stages.find(
			(s: Row) => s.id === opportunity.pipelineStageId,
		)?.name,
	});
	// Complete answers live in the private application table and GHL notes.
	// An existing opportunity is never moved backwards by a repeat application.
	return { contact_id: contactId, opportunity_id: opportunity.id };
}
