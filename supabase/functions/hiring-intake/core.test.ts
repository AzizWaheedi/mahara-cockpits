import { expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import {
	deliver,
	normalize,
	signatureMatches,
	SOURCES,
	LOCATION,
	type Provider,
	type Row,
} from "./core";
import { makeHandler } from "./handler";
import { createRequire } from "node:module";
const { PGlite } = createRequire(
	new URL("../../../apps/media-buyer-cockpit/package.json", import.meta.url),
)("@electric-sql/pglite");
import { readFileSync } from "node:fs";
const NOW = Date.parse("2026-10-08T15:00:00Z");
const tally = (form = "9qQR6G"): Row => ({
	eventType: "FORM_RESPONSE",
	data: {
		formId: form,
		submissionId: "synthetic-001",
		createdAt: new Date(NOW).toISOString(),
		fields: [
			{
				key: "name",
				label: "What's your full name?",
				type: "INPUT_TEXT",
				value: "Synthetic Applicant",
			},
			{
				key: "email",
				label: "Email",
				type: "INPUT_EMAIL",
				value: "synthetic@example.test",
			},
			{
				key: "phone",
				label: "Phone Number",
				type: "INPUT_PHONE_NUMBER",
				value: "+1 (202) 555-0100",
			},
			{
				key: "cv",
				label: "FINAL STEP: Upload Your CV",
				type: "FILE_UPLOAD",
				value: [{ url: "https://example.test/cv.pdf" }],
			},
			{
				key: "arabic",
				label: "Voice Recording (Arabic)",
				type: "INPUT_LINK",
				value: "https://example.test/arabic",
			},
			{
				key: "english",
				label: "Voice Recording (English)",
				type: "INPUT_LINK",
				value: "https://example.test/english",
			},
		],
	},
});
const tf = (form = "oW8CWRhi"): Row => ({
	event_type: "form_response",
	form_response: {
		form_id: form,
		token: "synthetic-001",
		submitted_at: new Date(NOW).toISOString(),
		definition: {
			fields: [
				...Object.entries(SOURCES[form].refs!).map(([title, ref]) => ({
					ref,
					title,
				})),
				{ ref: "tools", title: "Email" },
				{ ref: "cv", title: "Upload CV" },
			],
		},
		answers: [
			{
				field: { ref: SOURCES[form].refs!.name },
				type: "text",
				text: "Synthetic Applicant",
			},
			{
				field: { ref: SOURCES[form].refs!.email },
				type: "email",
				email: "synthetic@example.test",
			},
			{
				field: { ref: SOURCES[form].refs!.phone },
				type: "phone_number",
				phone_number: "+12025550100",
			},
			{
				field: { ref: "tools" },
				type: "choice",
				choice: { label: "Email tool" },
			},
			{
				field: { ref: "cv" },
				type: "file_url",
				file_url: "https://example.test/cv.pdf",
			},
		],
	},
});
for (const [form, source] of Object.entries(SOURCES))
	test(`${source.provider} ${form} maps to ${source.role}`, () => {
		const app = normalize(
			source.provider,
			source.provider === "tally" ? tally(form) : tf(form),
		);
		expect(app.role).toBe(source.role);
		expect(app.email).toBe("synthetic@example.test");
		expect(app.portfolio).toContain("https://example.test/cv.pdf");
	});
test("both recordings survive, and phone spacing normalizes", () => {
	const app = normalize("tally", tally("b5VvQZ"));
	expect(app.portfolio).toContain("Voice Recording (Arabic):");
	expect(app.portfolio).toContain("/arabic");
	expect(app.portfolio).toContain("/english");
	expect(app.phone).toBe("+12025550100");
});
test("Typeform partial events and unrelated forms are rejected", () => {
	const b = tf();
	b.event_type = "form_response_partial";
	expect(() => normalize("typeform", b)).toThrow("invalid_event");
	const a = tally("unrelated");
	expect(() => normalize("tally", a)).toThrow("unsupported_form");
});
test("ambiguous, missing and malformed contact fields are rejected", () => {
	const a = tally();
	a.data.fields.push(a.data.fields[1]);
	expect(() => normalize("tally", a)).toThrow("ambiguous");
	for (const [value, code] of [
		["invalid", "invalid_email"],
		["", "missing_identity"],
	]) {
		const b = tally();
		b.data.fields[1].value = value;
		b.data.fields[2].value = "";
		expect(() => normalize("tally", b)).toThrow(code);
	}
	const b = tally();
	b.data.fields[2].value = "5550100";
	expect(() => normalize("tally", b)).toThrow("invalid_phone");
});
for (const provider of ["tally", "typeform"] as Provider[])
	test(`${provider} requires a valid signature of the exact body`, async () => {
		const body = '{"test":true}';
		const sig =
			(provider === "typeform" ? "sha256=" : "") +
			createHmac("sha256", "fixture").update(body).digest("base64");
		expect(await signatureMatches(body, sig, "fixture", provider)).toBe(true);
		expect(await signatureMatches(body + " ", sig, "fixture", provider)).toBe(
			false,
		);
		expect(await signatureMatches(body, sig, "", provider)).toBe(false);
	});
function harness(existing = false, fail = "") {
	const calls: { method: string; path: string; body?: Row }[] = [],
		phases: string[] = [];
	const opportunity = {
		id: "opp-fixture",
		pipelineId: "pipeline",
		pipelineStageId: existing ? "offer" : "application",
		locationId: LOCATION,
		contactId: "contact-fixture",
	};
	const meta = {
		location: LOCATION,
		pipelines: { "sales-closer": "pipeline" },
		stageIdByKey: { "sales-closer": { application: "application" } },
		fields: { role: "role", source: "source", portfolio: "portfolio" },
	};
	const io = {
		ghl: async (method: string, path: string, body?: Row) => {
			calls.push({ method, path, body });
			if (path === fail) throw Error("synthetic timeout");
			if (path.startsWith("/opportunities/pipelines"))
				return {
					pipelines: [
						{
							id: "pipeline",
							name: "Sales closer (B2B)",
							stages: [
								{ id: "application", name: "Application" },
								{ id: "offer", name: "Job offer" },
							],
						},
					],
				};
			if (path === "/contacts/upsert")
				return { contact: { id: "contact-fixture" } };
			if (path.endsWith("/notes")) return method === "GET" ? { notes: [] } : {};
			if (path.startsWith("/opportunities/search"))
				return { opportunities: existing ? [opportunity] : [] };
			if (path === "/opportunities/" || path === "/opportunities/opp-fixture")
				return { opportunity };
			return {};
		},
		checkpoint: async (p: string) => {
			phases.push(p);
		},
		saveApplication: async () => {},
		saveCandidate: async () => {},
	};
	return { calls, phases, meta, io };
}
test("delivery adds tags without replacing them and verifies the new opportunity", async () => {
	const h = harness();
	await deliver(normalize("tally", tally()), h.meta, h.io);
	expect(
		h.calls.find((c) => c.path === "/contacts/upsert")?.body?.tags,
	).toBeUndefined();
	expect(h.calls.find((c) => c.path.endsWith("/tags"))?.body?.tags).toEqual([
		"applicant",
		"sales-closer",
	]);
	expect(h.phases.indexOf("opportunity_create")).toBeGreaterThan(-1);
	expect(
		h.calls.some(
			(c) => c.method === "GET" && c.path === "/opportunities/opp-fixture",
		),
	).toBe(true);
	expect(h.calls.some((c) => /messages|workflow/.test(c.path))).toBe(false);
});
test("reapplication preserves an existing opportunity stage", async () => {
	const h = harness(true);
	await deliver(normalize("tally", tally()), h.meta, h.io);
	expect(h.calls.filter((c) => c.path === "/opportunities/")).toHaveLength(0);
	expect(
		h.calls.filter((c) => c.method === "PUT" || c.method === "PATCH"),
	).toHaveLength(0);
});
test("wrong destination fails before any provider write", async () => {
	const h = harness();
	h.meta.location = "wrong";
	await expect(
		deliver(normalize("tally", tally()), h.meta, h.io),
	).rejects.toThrow("mapping");
	expect(h.calls).toHaveLength(0);
});
test("unknown create result is not retried inside a delivery", async () => {
	const h = harness(false, "/opportunities/");
	await expect(
		deliver(normalize("tally", tally()), h.meta, h.io),
	).rejects.toThrow("timeout");
	expect(h.calls.filter((c) => c.path === "/opportunities/")).toHaveLength(1);
	expect(h.phases.at(-1)).toBe("opportunity_create");
});
function httpFixture(mode = "shadow") {
	const calls: string[] = [],
		receipts: Row[] = [],
		vars: Row = {
			SUPABASE_URL: "https://db.example.test",
			SUPABASE_SERVICE_ROLE_KEY: "fixture-service",
			HIRING_TALLY_SIGNING_SECRET: "fixture",
			HIRING_TYPEFORM_SIGNING_SECRET: "fixture",
			CRON_SECRET: "fixture-cron",
		};
	const handler = makeHandler({
		env: (k) => vars[k] ?? "",
		now: () => NOW,
		fetch: (async (input, init) => {
			const path = String(input).split("/rest/v1/")[1];
			calls.push(path ?? String(input));
			if (path?.startsWith("cockpit_hiring_intake_sources"))
				return Response.json([
					{ role: "sales-closer", mode, accept_since: "2026-10-08T00:00:00Z" },
				]);
			if (path?.startsWith("cockpit_hiring_intake_receipts")) {
				if (init?.method === "POST") {
					const row = JSON.parse(String(init.body));
					if (!receipts.length) receipts.push({ id: 1, ...row });
					return new Response(null, { status: 201 });
				}
				return Response.json(receipts);
			}
			throw Error("Unexpected provider request");
		}) as typeof fetch,
	});
	const request = (body: Row = tally(), signature = true) => {
		const raw = JSON.stringify(body);
		return new Request(
			"https://db.example.test/functions/v1/hiring-intake/tally",
			{
				method: "POST",
				body: raw,
				headers: signature
					? {
							"Tally-Signature": createHmac("sha256", "fixture")
								.update(raw)
								.digest("base64"),
						}
					: {},
			},
		);
	};
	return { handler, request, calls, receipts, vars };
}
test("shadow captures a durable receipt without contacting GHL", async () => {
	const h = httpFixture();
	const r = await h.handler(h.request());
	expect(r.status).toBe(202);
	expect(h.receipts[0].status).toBe("shadow");
	expect(h.calls.every((c) => c.startsWith("cockpit_"))).toBe(true);
});
test("duplicate delivery reuses receipt; changed response is a conflict", async () => {
	const h = httpFixture("live");
	await h.handler(h.request());
	expect((await h.handler(h.request())).status).toBe(202);
	expect(h.receipts).toHaveLength(1);
	const b = tally();
	b.data.fields[0].value = "Changed Applicant";
	expect((await h.handler(h.request(b))).status).toBe(409);
	expect(h.receipts[0].application.name).toBe("Synthetic Applicant");
});
test("bad signature, paused source, missing secret and missing cron auth cannot write", async () => {
	const h = httpFixture();
	expect((await h.handler(h.request(tally(), false))).status).toBe(401);
	expect(h.calls).toHaveLength(0);
	const p = httpFixture("paused");
	expect((await p.handler(p.request())).status).toBe(503);
	expect(p.receipts).toHaveLength(0);
	h.vars.HIRING_TALLY_SIGNING_SECRET = "";
	expect((await h.handler(h.request())).status).toBe(503);
	expect(
		(
			await h.handler(
				new Request("https://db.example.test/drain", { method: "POST" }),
			)
		).status,
	).toBe(401);
});
test("cutover boundary rejects historical replay and future timestamps", async () => {
	const h = httpFixture();
	const old = tally();
	old.data.createdAt = "2020-01-01";
	expect(await (await h.handler(h.request(old))).json()).toEqual({
		ok: true,
		ignored: "before_cutover",
	});
	expect(h.receipts).toHaveLength(0);
	old.data.createdAt = "2030-01-01";
	expect((await h.handler(h.request(old))).status).toBe(400);
});
test("oversized request is rejected before database writes", async () => {
	const h = httpFixture();
	const r = await h.handler(
		new Request("https://db.example.test/tally", {
			method: "POST",
			body: "x".repeat(262145),
		}),
	);
	expect(r.status).toBe(413);
	expect(h.calls).toHaveLength(0);
});
test("private queue grants, dedupe, claim exclusivity and crash quarantine execute in Postgres", async () => {
	const db = new PGlite();
	try {
		await db.exec(
			"CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;",
		);
		await db.exec(
			readFileSync(
				new URL(
					"../../migrations/20261008z_hiring_native_intake.sql",
					import.meta.url,
				),
				"utf8",
			),
		);
		const permits = await db.query(
			"select has_table_privilege('anon','cockpit_hiring_intake_receipts','select') anon,has_function_privilege('authenticated','cockpit_claim_hiring_intake()','execute') auth",
		);
		expect(permits.rows[0]).toEqual({ anon: false, auth: false });
		await db.exec(
			"INSERT INTO cockpit_hiring_intake_receipts(provider,form_id,response_id,payload_hash) VALUES('tally','9qQR6G','one','digest'),('tally','9qQR6G','two','digest');",
		);
		expect(
			(await db.query("select * from cockpit_claim_hiring_intake()")).rows,
		).toHaveLength(0);
		await db.exec(
			"UPDATE cockpit_hiring_intake_sources SET mode='live' WHERE form_id='9qQR6G'",
		);
		expect(
			(await db.query("select * from cockpit_claim_hiring_intake()")).rows,
		).toHaveLength(1);
		expect(
			(await db.query("select * from cockpit_claim_hiring_intake()")).rows,
		).toHaveLength(0);
		await db.exec(
			"UPDATE cockpit_hiring_intake_receipts SET updated_at=now()-interval '11 minutes' WHERE status='processing'",
		);
		expect(
			(await db.query("select * from cockpit_claim_hiring_intake()")).rows,
		).toHaveLength(1);
		expect(
			(
				await db.query(
					"select status from cockpit_hiring_intake_receipts where response_id='one'",
				)
			).rows[0],
		).toEqual({ status: "review" });
		await expect(
			db.exec(
				"INSERT INTO cockpit_hiring_intake_receipts(provider,form_id,response_id,payload_hash) VALUES('tally','9qQR6G','one','digest')",
			),
		).rejects.toThrow();
	} finally {
		await db.close();
	}
}, 30000);
test("failed opportunity lookup cannot become a create", async () => {
	const h = harness();
	const original = h.io.ghl;
	h.io.ghl = async (method, path, body) =>
		path.startsWith("/opportunities/search")
			? Promise.reject(Error("read unavailable"))
			: original(method, path, body);
	await expect(
		deliver(normalize("tally", tally()), h.meta, h.io),
	).rejects.toThrow("read unavailable");
	expect(h.calls.filter((c) => c.path === "/opportunities/")).toHaveLength(0);
});
test("notes are not duplicated when a receipt is reconciled", async () => {
	const h = harness(true),
		app = normalize("tally", tally()),
		original = h.io.ghl;
	h.io.ghl = async (method, path, body) =>
		path.endsWith("/notes") && method === "GET"
			? { notes: [{ body: app.transcript }] }
			: original(method, path, body);
	await deliver(app, h.meta, h.io);
	expect(
		h.calls.filter((c) => c.path.endsWith("/notes") && c.method === "POST"),
	).toHaveLength(0);
});
test("provider readback must match the exact contact, pipeline and location", async () => {
	const h = harness(),
		original = h.io.ghl;
	h.io.ghl = async (method, path, body) =>
		path === "/opportunities/opp-fixture"
			? { opportunity: { id: "opp-fixture", locationId: "other" } }
			: original(method, path, body);
	await expect(
		deliver(normalize("tally", tally()), h.meta, h.io),
	).rejects.toThrow("readback_mismatch");
	expect(h.phases).not.toContain("mirror");
});
test("drain holds an unknown write outcome for review, preserving its phase and hiding private errors", async () => {
	const patches: Row[] = [];
	const app = normalize("tally", tally());
	const vars: Row = {
		SUPABASE_URL: "https://db.example.test",
		SUPABASE_SERVICE_ROLE_KEY: "fixture",
		CRON_SECRET: "fixture-cron",
		GHL_HIRING_PIT: "fixture",
		GHL_HIRING_LOCATION: LOCATION,
	};
	const handler = makeHandler({
		env: (k) => vars[k] ?? "",
		now: () => NOW,
		fetch: (async (input, init) => {
			const url = String(input);
			if (url.endsWith("rpc/cockpit_claim_hiring_intake"))
				return Response.json([{ id: 77, application: app }]);
			if (url.includes("cockpit_hiring_meta"))
				return Response.json([
					{
						value: {
							location: LOCATION,
							pipelines: { "sales-closer": "pipeline" },
							stageIdByKey: { "sales-closer": { application: "stage" } },
							fields: {},
						},
					},
				]);
			if (init?.method === "PATCH") {
				patches.push(JSON.parse(String(init.body)));
				return new Response(null, { status: 204 });
			}
			if (url.includes("/opportunities/pipelines"))
				return Response.json({
					pipelines: [{ id: "pipeline", stages: [{ id: "stage" }] }],
				});
			throw Error("Sensitive provider message synthetic@example.test");
		}) as typeof fetch,
	});
	const result = await handler(
		new Request("https://db.example.test/drain", {
			method: "POST",
			headers: { "x-cron-secret": "fixture-cron" },
		}),
	);
	expect(await result.json()).toEqual({ ok: false, processed: 0, review: 77 });
	expect(patches.some((p) => p.phase === "contact")).toBe(true);
	expect(patches.at(-1)).toMatchObject({
		status: "review",
		error_code: "delivery_interrupted",
	});
	expect(JSON.stringify(patches)).not.toContain("synthetic@example.test");
});
test("missing dedicated hiring credential prevents claims even with cron authentication", async () => {
	const h = httpFixture();
	const r = await h.handler(
		new Request("https://db.example.test/drain", {
			method: "POST",
			headers: { "x-cron-secret": "fixture-cron" },
		}),
	);
	expect(r.status).toBe(503);
	expect(h.calls).toHaveLength(0);
});
