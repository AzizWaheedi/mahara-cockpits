/** Explicit operator step. Verify a reviewed private manifest; create disabled bindings only. */
import { readFile } from "node:fs/promises";
import { classify, type Binding } from "./core";
import { Transport, type Env } from "./transport";
const args = process.argv.slice(2);
const path = args[args.indexOf("--manifest") + 1];
if (!args.includes("--manifest") || !path)
	throw new Error(
		"Use --manifest /private/reviewed-bindings.json and optional --save-disabled",
	);
const env: Env = { ...process.env };
if (args.includes("--config"))
	Object.assign(
		env,
		JSON.parse(await readFile(args[args.indexOf("--config") + 1], "utf8")),
	);
env.SUPABASE_URL =
	env.AD_BILLING_SUPABASE_URL ?? env.DESK_SUPABASE_URL ?? env.SUPABASE_URL;
env.SUPABASE_SERVICE_ROLE_KEY =
	env.AD_BILLING_SUPABASE_KEY ??
	env.DESK_SUPABASE_KEY ??
	env.SUPABASE_SERVICE_ROLE_KEY;
const t = new Transport(env);
const entries = JSON.parse(await readFile(path, "utf8"));
if (!Array.isArray(entries) || !entries.length || entries.length > 100)
	throw new Error("A bounded binding array is required");
if (new Set(entries.map((b) => b.account_id)).size !== entries.length)
	throw new Error("An account cannot belong to two bindings");
for (const entry of entries) {
	const b: Binding = {
		...entry,
		id: crypto.randomUUID(),
		enabled: true,
		manual_cutover_verified: false,
		revision: 1,
	};
	if (
		!b.identity_evidence ||
		b.identity_evidence.length < 11 ||
		!b.identity_verified_at
	)
		throw new Error("Human-reviewed identity evidence is required");
	await t.eligibility(b);
	if (classify(await t.meta(b.account_id), b.account_id).signal === "unknown")
		throw new Error("Meta account access is unverified");
	if (args.includes("--save-disabled")) {
		// Explicit column allowlist. No upsert: never overwrite a prior enrollment.
		const row = {
			client_task_id: b.client_task_id,
			client_name: b.client_name,
			account_id: b.account_id,
			ads_task_ids: b.ads_task_ids,
			whatsapp_group: b.whatsapp_group,
			sheet_account_ref: b.sheet_account_ref,
			identity_evidence: b.identity_evidence,
			identity_verified_at: b.identity_verified_at,
			enabled: false,
			manual_cutover_verified: false,
		};
		await t.json(
			"Database",
			`${t.dbUrl()}/rest/v1/cockpit_ad_billing_bindings`,
			{
				method: "POST",
				headers: { ...t.dbHeaders(), Prefer: "return=representation" },
				body: JSON.stringify(row),
			},
		);
	}
	console.log(
		JSON.stringify({
			clientTaskId: b.client_task_id,
			accountId: b.account_id,
			verified: true,
			savedDisabled: args.includes("--save-disabled"),
		}),
	);
}
