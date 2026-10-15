import {
	CLIENT_LIST,
	activeTask,
	bodies,
	classify,
	type Binding,
} from "./core";
import { ProviderError, Transport, type Delivery } from "./transport";
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
		for (const b of bindings) {
			let signal: any = "unknown",
				lastFour: string | null = null,
				error: string | null = null;
			try {
				await t.eligibility(b);
				({ signal, lastFour } = classify(
					await t.meta(b.account_id),
					b.account_id,
				));
			} catch (e) {
				error = e instanceof Error ? e.message : "Source verification failed";
				failures++;
			}
			const copy = bodies(
				signal === "healthy" ? "recovered" : signal,
				lastFour,
			);
			await t.rpc("cockpit_ad_billing_observe", {
				p_lease: lease,
				p_binding: b.id,
				p_revision: b.revision,
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
		return { busy: false, checked, failures };
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
