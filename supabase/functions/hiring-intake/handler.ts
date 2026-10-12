import {
	deliver,
	hash,
	IntakeError,
	LOCATION,
	normalize,
	signatureMatches,
	type Application,
	type Provider,
	type Row,
} from "./core.ts";
export type Runtime = {
	env: (key: string) => string;
	fetch: typeof fetch;
	now: () => number;
};
const answer = (body: Row, status = 200) =>
	Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const MAX_BYTES = 262144;
async function boundedText(req: Request): Promise<string> {
	if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES)
		throw new IntakeError("body_too_large", 413);
	const reader = req.body?.getReader();
	if (!reader) throw new IntakeError("missing_body");
	let size = 0;
	const chunks: Uint8Array[] = [];
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.length;
		if (size > MAX_BYTES) {
			await reader.cancel();
			throw new IntakeError("body_too_large", 413);
		}
		chunks.push(value);
	}
	const merged = new Uint8Array(size);
	let at = 0;
	for (const c of chunks) {
		merged.set(c, at);
		at += c.length;
	}
	return new TextDecoder().decode(merged);
}
export function makeHandler(runtime: Runtime) {
	const { env } = runtime;
	async function sb(
		path: string,
		method = "GET",
		body?: unknown,
		prefer?: string,
	): Promise<Row[]> {
		if (!env("SUPABASE_URL") || !env("SUPABASE_SERVICE_ROLE_KEY"))
			throw new IntakeError("database_not_configured", 503);
		const response = await runtime.fetch(
			`${env("SUPABASE_URL")}/rest/v1/${path}`,
			{
				method,
				headers: {
					apikey: env("SUPABASE_SERVICE_ROLE_KEY"),
					Authorization: `Bearer ${env("SUPABASE_SERVICE_ROLE_KEY")}`,
					"Content-Type": "application/json",
					...(prefer ? { Prefer: prefer } : {}),
				},
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
				signal: AbortSignal.timeout(12000),
			},
		);
		if (!response.ok) throw new IntakeError("database_operation_failed", 503);
		const text = await response.text();
		return text ? JSON.parse(text) : [];
	}
	async function ghl(method: string, path: string, body?: Row): Promise<Row> {
		if (!env("GHL_HIRING_PIT") || env("GHL_HIRING_LOCATION") !== LOCATION)
			throw new IntakeError("hiring_not_configured", 503);
		const response = await runtime.fetch(
			`https://services.leadconnectorhq.com${path}`,
			{
				method,
				headers: {
					Authorization: `Bearer ${env("GHL_HIRING_PIT")}`,
					Version: "2021-07-28",
					"Content-Type": "application/json",
					"User-Agent": "Mahara Hiring Intake/1.0",
				},
				...(body ? { body: JSON.stringify(body) } : {}),
				signal: AbortSignal.timeout(12000),
			},
		);
		if (!response.ok) throw new IntakeError(`ghl_http_${response.status}`, 502);
		return await response.json();
	}
	async function drain(): Promise<Row> {
		// Do not claim a row until credentials exist. No shared generic GHL token.
		if (!env("GHL_HIRING_PIT") || env("GHL_HIRING_LOCATION") !== LOCATION)
			throw new IntakeError("hiring_not_configured", 503);
		const [receipt] = await sb("rpc/cockpit_claim_hiring_intake", "POST", {});
		if (!receipt) return { ok: true, processed: 0 };
		const patch = (values: Row) =>
			sb(
				`cockpit_hiring_intake_receipts?id=eq.${receipt.id}`,
				"PATCH",
				{ ...values, updated_at: new Date(runtime.now()).toISOString() },
				"return=minimal",
			);
		try {
			const [mapping] = await sb(
				"cockpit_hiring_meta?key=eq.ghl-ids&select=value&limit=1",
			);
			const result = await deliver(
				receipt.application as Application,
				mapping?.value ?? {},
				{
					ghl,
					checkpoint: async (phase, ids) => {
						await patch({ phase, ...ids });
					},
					saveApplication: async (app, contactId) => {
						await sb(
							"cockpit_hiring_applications?on_conflict=contact_id",
							"POST",
							{
								contact_id: contactId,
								role: app.role,
								form: app.title,
								text: app.transcript,
								at: app.submittedAt,
							},
							"resolution=merge-duplicates,return=minimal",
						);
					},
					saveCandidate: async (app, contactId, opportunity) => {
						const meta = mapping.value;
						const stageId =
							opportunity.pipelineStageId ??
							meta.stageIdByKey[app.role].application;
						const stage = meta.stageKeyById[stageId];
						if (!stage) throw new IntakeError("unknown_opportunity_stage", 503);
						await sb(
							"cockpit_hiring_candidates?on_conflict=id",
							"POST",
							{
								id: opportunity.id,
								contact_id: contactId,
								location_id: LOCATION,
								role: app.role,
								role_label: opportunity.pipelineName,
								pipeline_id: meta.pipelines[app.role],
								stage,
								stage_name: opportunity.stageName ?? stage,
								name: app.name,
								source: `${app.provider}: ${app.title}`,
								portfolio_url: app.portfolio,
								applied_at: app.submittedAt,
								stage_since:
									opportunity.lastStageChangeAt ??
									opportunity.createdAt ??
									app.submittedAt,
								synced_at: new Date(runtime.now()).toISOString(),
							},
							"resolution=ignore-duplicates,return=minimal",
						);
					},
				},
			);
			await patch({ status: "complete", phase: "complete", ...result });
			return { ok: true, processed: 1, receipt: receipt.id };
		} catch (error) {
			// Unknown provider outcome is held. A human checks the phase and provider
			// record before replay. Never expose provider text, payloads or signed URLs.
			await patch({
				status: "review",
				error_code:
					error instanceof IntakeError ? error.code : "delivery_interrupted",
			});
			return { ok: false, processed: 0, review: receipt.id };
		}
	}
	return async (req: Request): Promise<Response> => {
		try {
			if (req.method !== "POST") return answer({ error: "post_required" }, 405);
			const route = new URL(req.url).pathname.split("/").pop();
			if (route === "drain") {
				if (!env("CRON_SECRET"))
					throw new IntakeError("cron_not_configured", 503);
				if (req.headers.get("x-cron-secret") !== env("CRON_SECRET"))
					throw new IntakeError("unauthorized", 401);
				return answer(await drain());
			}
			if (route !== "tally" && route !== "typeform")
				throw new IntakeError("unknown_route", 404);
			const provider = route as Provider;
			const secret = env(
				provider === "tally"
					? "HIRING_TALLY_SIGNING_SECRET"
					: "HIRING_TYPEFORM_SIGNING_SECRET",
			);
			if (!secret) throw new IntakeError("signature_not_configured", 503);
			const raw = await boundedText(req);
			if (
				!(await signatureMatches(
					raw,
					req.headers.get(
						provider === "tally" ? "Tally-Signature" : "Typeform-Signature",
					) ?? "",
					secret,
					provider,
				))
			)
				throw new IntakeError("invalid_signature", 401);
			let body: Row;
			try {
				body = JSON.parse(raw);
			} catch {
				throw new IntakeError("invalid_json");
			}
			const app = normalize(provider, body);
			const [source] = await sb(
				`cockpit_hiring_intake_sources?form_id=eq.${app.form}&provider=eq.${provider}&select=role,mode,accept_since&limit=1`,
			);
			if (!source || source.role !== app.role || source.mode === "paused")
				throw new IntakeError("source_not_enabled", 503);
			if (Date.parse(app.submittedAt) < Date.parse(source.accept_since))
				return answer({ ok: true, ignored: "before_cutover" });
			if (Date.parse(app.submittedAt) > runtime.now() + 300000)
				throw new IntakeError("future_submission");
			const digest = await hash(JSON.stringify(app));
			await sb(
				"cockpit_hiring_intake_receipts?on_conflict=provider,form_id,response_id",
				"POST",
				{
					provider,
					form_id: app.form,
					response_id: app.response,
					payload_hash: digest,
					application: app,
					status: source.mode === "live" ? "queued" : "shadow",
				},
				"resolution=ignore-duplicates,return=minimal",
			);
			const [saved] = await sb(
				`cockpit_hiring_intake_receipts?provider=eq.${provider}&form_id=eq.${app.form}&response_id=eq.${encodeURIComponent(app.response)}&select=id,payload_hash,status&limit=1`,
			);
			if (!saved) throw new IntakeError("receipt_missing", 503);
			if (saved.payload_hash !== digest)
				throw new IntakeError("response_conflict", 409);
			return answer({ ok: true, receipt: saved.id, state: saved.status }, 202);
		} catch (error) {
			return answer(
				{ error: error instanceof IntakeError ? error.code : "intake_failed" },
				error instanceof IntakeError ? error.status : 503,
			);
		}
	};
}
