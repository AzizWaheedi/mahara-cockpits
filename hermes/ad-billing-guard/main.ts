import { readFile } from "node:fs/promises";
import {
	ADS_ACCOUNT,
	ADS_LIST,
	CLIENT_LIST,
	activeTask,
	accountId,
	classify,
} from "./core";
import { Transport, type Env } from "./transport";
import { autoMoveMode, poll, dispatchOne, reconcileUnknown } from "./worker";
const args = process.argv.slice(2);
const configIndex = args.indexOf("--config");
const config: Env =
	configIndex >= 0
		? JSON.parse(await readFile(args[configIndex + 1], "utf8"))
		: {};
const env: Env = { ...process.env, ...config };
env.SUPABASE_URL =
	env.AD_BILLING_SUPABASE_URL ?? env.DESK_SUPABASE_URL ?? env.SUPABASE_URL;
env.SUPABASE_SERVICE_ROLE_KEY =
	env.AD_BILLING_SUPABASE_KEY ??
	env.DESK_SUPABASE_KEY ??
	env.SUPABASE_SERVICE_ROLE_KEY;
const t = new Transport(env);
if (args.includes("--doctor")) {
	console.log(
		JSON.stringify({
			configured: Object.fromEntries(
				[
					"SUPABASE_URL",
					"SUPABASE_SERVICE_ROLE_KEY",
					"CLICKUP_API_TOKEN",
					"META_SYSTEM_TOKEN",
					"GOOGLE_APPLICATION_CREDENTIALS",
					"SLACK_BOT_TOKEN",
					"AD_BILLING_WHAPI_TOKEN",
				].map((k) => [k, Boolean(env[k])]),
			),
			apply: env.AD_BILLING_APPLY === "true",
			auto_move: autoMoveMode(env.AD_BILLING_AUTO_MOVE),
		}),
	);
} else if (args.includes("--audit")) {
	// Read-only discovery. Names/tags suggest a review; they NEVER enroll a client.
	const clients = (await t.tasks(CLIENT_LIST)).filter((c) =>
		activeTask(c, c.id),
	);
	const ads = await t.tasks(ADS_LIST);
	const rows = [];
	for (const c of clients) {
		const matches = ads.filter((a) =>
			a.tags?.some(
				(tag) => tag.name.trim().toLowerCase() === c.name.trim().toLowerCase(),
			),
		);
		const ids = [
			...new Set(
				matches
					.map((a) =>
						accountId(
							a.custom_fields?.find((f) => f.id === ADS_ACCOUNT)?.value,
						),
					)
					.filter((x): x is string => Boolean(x)),
			),
		];
		const signals = [];
		for (const id of ids) {
			try {
				const m = await t.meta(id);
				const s = classify(m, id);
				signals.push({
					accountId: id,
					signal: s.signal,
					cardSuffixAvailable: Boolean(s.lastFour),
				});
			} catch {
				signals.push({
					accountId: id,
					signal: "unavailable",
					cardSuffixAvailable: false,
				});
			}
		}
		rows.push({
			clientTaskId: c.id,
			client: c.name,
			candidateAdsTaskIds: matches.map((a) => a.id),
			signals,
			needsIdentityReview: true,
		});
	}
	console.log(
		JSON.stringify(
			{ mode: "read-only audit", activeClients: clients.length, rows },
			null,
			2,
		),
	);
} else if (args.includes("--poll")) {
	console.log(JSON.stringify({ at: new Date().toISOString(), ...(await poll(t)) }));
	await reconcileUnknown(t);
	if (env.AD_BILLING_APPLY === "true")
		for (let count = 0; count < 40 && (await dispatchOne(t)); count++) {}
} else {
	console.error(
		"Use --doctor, --audit, or --poll. --config accepts a private runtime JSON file.",
	);
	process.exitCode = 2;
}
