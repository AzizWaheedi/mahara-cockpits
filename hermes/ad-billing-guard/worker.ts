import {
	ADS_LIST,
	CLIENT_LIST,
	IdentityDrift,
	accountId,
	accountsToRead,
	activeTask,
	bodies,
	classify,
	clientAdsTasks,
	planAccountChange,
	type AccountPlan,
	type Binding,
	type Task,
} from "./core";
import { ProviderError, Transport, type Delivery } from "./transport";
// An account change needed an agent session each time (Marble 17 Oct, ARCWANI 26 Oct 2026). The worker now proves and
// applies it itself. AD_BILLING_AUTO_MOVE "on" applies, "off" skips the check, anything else only logs (dry, the default).
export type AutoMove = "on" | "off" | "dry";
export const autoMoveMode = (value?: string): AutoMove =>
	value === "on" || value === "off" ? value : "dry";
interface MoveRun {
	lease: string;
	mode: AutoMove;
	ads?: Promise<Task[]>;
	taken: Record<string, string>;
	tally: { mode: AutoMove; moved: number; would: number; blocked: number };
}
/** Plans one account change and, in "on" mode, saves it. Returns the binding to check; throws the panel's sentence. */
async function changeAccount(
	t: Transport,
	b: Binding,
	sheet: Promise<unknown[][]>,
	run: MoveRun,
	drift: IdentityDrift,
	hold: { binding: Binding },
): Promise<Binding> {
	const at = () => new Date().toISOString();
	let plan: AccountPlan;
	try {
		const [client, rows, ads] = await Promise.all([
			t.task(b.client_task_id),
			sheet,
			(run.ads ??= t.tasks(ADS_LIST)),
		]);
		const tasks = clientAdsTasks(b, client.name ?? "", ads);
		const names: Record<string, string | null> = {};
		for (const id of accountsToRead(b, tasks)) {
			try {
				const m = await t.meta(id);
				names[id] = accountId(m.id) === id && typeof m.name === "string" ? m.name : null;
			} catch {
				names[id] = null;
			}
		}
		const taken = Object.fromEntries(
			Object.entries(run.taken).filter(([account]) => account !== b.account_id),
		);
		plan = planAccountChange({ binding: b, sheet: rows, tasks, names, taken });
	} catch (e) {
		plan = {
			kind: "blocked",
			hint: `The account change check could not finish (${e instanceof Error ? e.message : "source error"}). The next run tries again.`,
		};
	}
	console.log(
		JSON.stringify({
			at: at(),
			auto_move: run.mode,
			client: b.client_name,
			...(plan.kind === "blocked"
				? { plan: "blocked", hint: plan.hint }
				: { plan: plan.kind, from: b.account_id, to: plan.account, ref: plan.ref, ads_tasks: plan.adsTasks }),
		}),
	);
	const reason = drift.message.replace(/; review the binding$/, "");
	if (plan.kind === "blocked") {
		run.tally.blocked++;
		throw run.mode === "on" ? new Error(`${reason}. ${plan.hint}`) : drift;
	}
	if (run.mode !== "on") {
		run.tally.would++;
		throw drift;
	}
	let result: { ok?: boolean; reason?: string; binding?: Binding } | null;
	try {
		result = await t.rpc("cockpit_ad_billing_move", {
			p_lease: run.lease,
			p_binding: b.id,
			p_revision: b.revision,
			p_kind: plan.kind,
			p_account: plan.account,
			p_ref: plan.ref,
			p_ads_tasks: plan.adsTasks,
			p_evidence: plan.evidence,
		});
	} catch (e) {
		// The save may have landed before the answer was lost. The observe call needs the row's current revision.
		const fresh = (await t.rows<Binding>("cockpit_ad_billing_bindings", `id=eq.${b.id}`).catch(() => []))[0];
		if (fresh) hold.binding = fresh;
		throw e;
	}
	if (!result?.ok || !result.binding) {
		run.tally.blocked++;
		throw new Error(
			`${reason}. The automatic account change was refused: ${result?.reason ?? "no answer"}. The next run checks again.`,
		);
	}
	run.tally.moved++;
	hold.binding = result.binding;
	delete run.taken[b.account_id];
	run.taken[plan.account] = b.client_name;
	try {
		await t.notice(plan.notice);
		console.log(JSON.stringify({ at: at(), auto_move_notice: "sent", client: b.client_name }));
	} catch (e) {
		console.error(
			JSON.stringify({
				at: at(),
				auto_move_notice: "failed",
				client: b.client_name,
				error: e instanceof Error ? e.message : "Slack notice failed",
			}),
		);
	}
	return result.binding;
}
// A run that dies must still free its 10-minute lease, or the next two runs answer busy and check nothing. On
// 14 Oct 2026 one database network error at 10:10 UTC also failed the finish call, so 10:15 and 10:20 were skipped.
// The finish call meets the same short outage, so it is tried again after these waits.
export const FINISH_WAITS_MS = [0, 2000, 5000, 10000];
export async function poll(t: Transport, finishWaits = FINISH_WAITS_MS) {
	const lease = crypto.randomUUID();
	if (!(await t.rpc("cockpit_ad_billing_start", { p_lease: lease })))
		return { busy: true, checked: 0 };
	let checked = 0,
		failures = 0;
	const began = Date.now();
	let slowest: { client: string; eligibility_s: number; meta_s: number } | null = null;
	let moves: MoveRun["tally"] | null = null;
	try {
		const roster = (await t.tasks(CLIENT_LIST))
			.filter((c) => activeTask(c, c.id))
			.map((c) => ({ id: c.id, name: c.name }));
		await t.rpc("cockpit_ad_billing_roster_refresh", {
			p_lease: lease,
			p_rows: roster,
		});
		const bindings = await t.rows<Binding>(
			"cockpit_ad_billing_bindings",
			"enabled=eq.true",
		);
		// One Client Data read per run, not one per client (17 reads became 1, 26 Oct 2026). A failed read still
		// fails each client's check, as before.
		const sheet = t.sheet();
		sheet.catch(() => {});
		const mode = autoMoveMode(t.env.AD_BILLING_AUTO_MOVE);
		const run: MoveRun = {
			lease,
			mode,
			taken: Object.fromEntries(bindings.map((x) => [x.account_id, x.client_name])),
			tally: { mode, moved: 0, would: 0, blocked: 0 },
		};
		moves = run.tally;
		for (const b of bindings) {
			const hold = { binding: b };
			let signal: any = "unknown",
				lastFour: string | null = null,
				error: string | null = null;
			// Slow runs (up to 251 s on 26 Oct 2026) had clients taking 16-20 s instead of 2 s, and nothing recorded
			// which service stalled. The summary line names the slowest client and where its time went.
			const start = Date.now();
			let checkedAt: number | null = null;
			try {
				try {
					await t.eligibility(b, sheet);
				} catch (drift) {
					if (!(drift instanceof IdentityDrift) || mode === "off") throw drift;
					await t.eligibility(await changeAccount(t, b, sheet, run, drift, hold), sheet);
				}
				checkedAt = Date.now();
				const account = hold.binding.account_id;
				({ signal, lastFour } = classify(await t.meta(account), account));
			} catch (e) {
				error = e instanceof Error ? e.message : "Source verification failed";
				failures++;
				// The next run overwrites the binding's error, so this line in cron.log is the only lasting record of
				// which client and which service failed (19 Oct 2026: 3 failures nobody could trace afterwards).
				console.error(
					JSON.stringify({ at: new Date().toISOString(), client: b.client_name, error }),
				);
			}
			const end = Date.now(),
				eligibility_s = ((checkedAt ?? end) - start) / 1000,
				meta_s = checkedAt ? (end - checkedAt) / 1000 : 0;
			if (!slowest || eligibility_s + meta_s > slowest.eligibility_s + slowest.meta_s)
				slowest = { client: b.client_name, eligibility_s, meta_s };
			const copy = bodies(
				signal === "healthy" ? "recovered" : signal,
				lastFour,
			);
			await t.rpc("cockpit_ad_billing_observe", {
				p_lease: lease,
				p_binding: hold.binding.id,
				p_revision: hold.binding.revision,
				p_signal: signal,
				p_last_four: lastFour,
				p_error: error,
				p_client_body: copy.client,
				p_internal_body: copy.internal,
			});
			checked++;
		}
		await t.rpc("cockpit_ad_billing_finish", {
			p_lease: lease,
			p_error: failures
				? `${failures} binding checks failed. Review the billing panel.`
				: null,
		});
		return {
			busy: false,
			checked,
			failures,
			secs: (Date.now() - began) / 1000,
			slowest,
			auto_move: moves,
		};
	} catch (error) {
		for (const wait of finishWaits) {
			if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
			try {
				await t.rpc("cockpit_ad_billing_finish", {
					p_lease: lease,
					p_error: "Monitor did not complete. Check the worker and source access.",
				});
				break;
			} catch {
				/* The lease expires by itself after 10 minutes if every try fails. */
			}
		}
		throw error;
	}
}
export async function dispatchOne(t: Transport): Promise<boolean> {
	if (t.env.AD_BILLING_APPLY !== "true") return false;
	const claim = crypto.randomUUID();
	const d = await t.rpc<Delivery | null>("cockpit_ad_billing_claim", {
		p_claim: claim,
	});
	if (!d) return false;
	let began = false;
	try {
		const b = (
			await t.rows<Binding>(
				"cockpit_ad_billing_bindings",
				`id=eq.${d.binding_id}`,
			)
		)[0];
		if (!b || b.revision !== d.revision || !b.manual_cutover_verified)
			throw new Error(
				"Binding changed or manual workflow cutover is incomplete",
			);
		// No caller-controlled destinations; compare the immutable intent with current binding.
		if (
			(d.channel === "whatsapp" && d.destination !== b.whatsapp_group) ||
			(d.channel === "clickup" &&
				![b.client_task_id, ...b.ads_task_ids].includes(d.destination))
		)
			throw new Error("Notification destination is no longer valid");
		t.preflight(d);
		await t.eligibility(b); // Fresh ClickUp + sheet + task reads before EVERY send.
		const meta = classify(await t.meta(b.account_id), b.account_id);
		const db = (
			await t.rows<any>("cockpit_ad_billing_bindings", `id=eq.${b.id}`)
		)[0];
		if (
			meta.signal === "unknown" ||
			meta.signal !== db?.signal ||
			db.revision !== d.revision ||
			db.error
		)
			throw new Error("Source state changed. Poll again before delivery.");
		if (
			!(await t.rpc("cockpit_ad_billing_begin_send", {
				p_id: d.id,
				p_claim: claim,
			}))
		)
			throw new Error("Delivery gate changed");
		began = true;
		const receipt = await t.send(d);
		// An acknowledgement failure leaves the send intent intact. A later run
		// reconciles by marker, never sends a second copy to obtain another receipt.
		if (
			!(await t.rpc("cockpit_ad_billing_result", {
				p_id: d.id,
				p_claim: claim,
				p_state: "accepted",
				p_provider_id: receipt,
			}))
		)
			throw new Error("Receipt could not be persisted");
	} catch (error) {
		const state = began
			? error instanceof ProviderError && !error.uncertain
				? error.status === 429
					? "retry"
					: "failed"
				: "unknown"
			: "failed";
		await t.rpc("cockpit_ad_billing_result", {
			p_id: d.id,
			p_claim: claim,
			p_state: state,
			p_error:
				error instanceof Error ? error.message : "Notification requires review",
		});
	}
	return true;
}
export async function reconcileUnknown(t: Transport) {
	for (const d of await t.rows<Delivery>(
		"cockpit_ad_billing_deliveries",
		"state=eq.unknown&limit=40",
	)) {
		try {
			const id = await t.reconcile(d);
			if (id)
				await t.rpc("cockpit_ad_billing_result", {
					p_id: d.id,
					p_claim: d.claim,
					p_state: "accepted",
					p_provider_id: id,
				});
		} catch {
			/* Remains visible for human review. No resend. */
		}
	}
}
