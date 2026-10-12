/** Pure billing rules. Account status is not evidence of an issuer decline. */
export const CLIENT_LIST = "901816559981";
export const ADS_LIST = "901817774521";
export const CLIENT_STATUS = "9368ca9e-3549-4320-84ff-9abd0a2901cb";
export const ADS_ACCOUNT = "8f9032d4-017c-4634-85d9-7ab046cc142f";
export const SLACK_CHANNEL = "C0AF4SDLWNL";
export const CSM_SLACK_CHANNEL = "C09RZ0GS0V9";
export const BILLING_REVIEW_URL = "https://cockpit.maharamedia.com/client-success/ad-billing";
// Confirmed internal sandbox. Its Active dropdown does not make it a client.
const NON_CLIENT_TASK_IDS = new Set(["86ex08t5v"]);
export type Signal =
	| "healthy"
	| "payment_grace"
	| "unsettled"
	| "restricted"
	| "unknown";
export interface Binding {
	id: string;
	client_task_id: string;
	client_name: string;
	account_id: string;
	ads_task_ids: string[];
	whatsapp_group: string;
	enabled: boolean;
	revision: number;
	sheet_account_ref: string;
	identity_evidence: string;
	identity_verified_at: string;
	manual_cutover_verified: boolean;
}
export interface Task {
	id: string;
	list?: { id: string };
	archived?: boolean;
	custom_fields?: {
		id: string;
		value?: unknown;
		type_config?: {
			options?: { id: string; name?: string; orderindex?: number }[];
		};
	}[];
}
export function accountId(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const raw = value.trim();
	if (/^(?:act_)?\d{5,25}$/.test(raw)) return raw.replace(/^act_/, "");
	try {
		const u = new URL(raw);
		if (
			u.protocol !== "https:" ||
			![
				"adsmanager.facebook.com",
				"business.facebook.com",
				"www.facebook.com",
			].includes(u.hostname)
		)
			return null;
		const id = u.searchParams.get("act");
		return id && /^\d{5,25}$/.test(id) ? id : null;
	} catch {
		return null;
	}
}
export function activeTask(task: Task, expected: string): boolean {
	if (
		task.id !== expected ||
		task.list?.id !== CLIENT_LIST ||
		task.archived ||
		NON_CLIENT_TASK_IDS.has(task.id)
	)
		return false;
	const field = task.custom_fields?.find((f) => f.id === CLIENT_STATUS);
	if (!field || field.value === undefined || field.value === null) return false;
	const option = field.type_config?.options?.find(
		(o) =>
			o.id === field.value ||
			(typeof field.value === "number" && o.orderindex === field.value),
	);
	return option?.name === "Active";
}
export function adsTaskMatches(
	task: Task,
	expected: string,
	account: string,
): boolean {
	return (
		task.id === expected &&
		task.list?.id === ADS_LIST &&
		!task.archived &&
		accountId(task.custom_fields?.find((f) => f.id === ADS_ACCOUNT)?.value) ===
			account
	);
}
export function maskedLastFour(value: unknown): string | null {
	// Never infer a card from account IDs, card type alone, or unmasked PANs.
	if (typeof value !== "string" || /\d{5,}/.test(value)) return null;
	return (
		value.match(/(?:[*•xX·]{2,}\s*|ending\s+(?:in\s+)?)(\d{4})\s*$/i)?.[1] ??
		value.match(
			/^(?:visa|mastercard|master card|amex|american express)\s+\*\s*(\d{4})\s*$/i,
		)?.[1] ??
		null
	);
}
export function classify(
	account: Record<string, unknown>,
	expectedId: string,
): { signal: Signal; lastFour: string | null } {
	if (accountId(account.id) !== expectedId)
		return { signal: "unknown", lastFour: null };
	const status = account.account_status;
	const signal: Signal =
		status === 1
			? "healthy"
			: status === 9
				? "payment_grace"
				: status === 3
					? "unsettled"
					: [2, 7, 8, 100, 101, 201, 202].includes(Number(status))
						? "restricted"
						: "unknown";
	const funding = account.funding_source_details as
		| { display_string?: unknown }
		| undefined;
	return { signal, lastFour: maskedLastFour(funding?.display_string) };
}
export const arabicDigits = (s: string) =>
	s.replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[Number(d)]);
export function clientMessage(
	signal: Signal | "recovered",
	lastFour: string | null,
): string | null {
	const card =
		lastFour && /^\d{4}$/.test(lastFour)
			? `\nوسيلة الدفع الظاهرة حاليًا: البطاقة المنتهية بـ ${arabicDigits(lastFour)}.`
			: "";
	if (signal === "payment_grace")
		return `*⚠️ تنبيه: مراجعة الدفع قبل توقف الإعلانات – حساب Meta الإعلاني*\n\nمرحبًا، ظهر تنبيه دفع في حسابكم الإعلاني على Meta.${card}\nالحساب حاليًا في فترة سماح للدفع، وقد تتوقف الإعلانات إذا لم تُحل المشكلة.\n\nنرجو مراجعة قسم الفوترة في Meta والتأكد من صلاحية وسيلة الدفع وتوفر الرصيد. إذا طُلب تحديث البطاقة، يرجى إدخال بياناتها داخل Meta فقط.\n\nأبلغونا بعد إتمام التحديث حتى نتحقق من حالة الحساب. فريق مهارة معكم للمساعدة.`;
	if (signal === "unsettled")
		return `*⚠️ تنبيه: مبلغ إعلاني غير مسدد – حساب Meta الإعلاني*\n\nمرحبًا، أظهرت Meta مبلغًا غير مسدد في حسابكم الإعلاني، وقد يؤثر ذلك في استمرار الإعلانات.${card}\n\nنرجو مراجعة الرصيد المستحق ووسيلة الدفع في قسم الفوترة على Meta وتسوية المشكلة في أقرب وقت. لا ترسلوا بيانات البطاقة في المحادثة.\n\nأبلغونا بعد المعالجة حتى نتحقق من حالة الحساب ونتابع معكم.`;
	if (signal === "recovered")
		return `*تحديث بخصوص حسابكم الإعلاني*\n\nمرحبًا، لم يعد تنبيه الدفع السابق ظاهرًا في حسابكم على Meta. يتابع فريق مهارة التحقق من تشغيل الحملات.\n\nشكرًا لتعاونكم، ويرجى إبقاء وسيلة الدفع محدثة لتقليل احتمالات توقف الإعلانات.`;
	return null;
}
export function bodies(signal: Signal | "recovered", lastFour: string | null) {
	const label = {
		payment_grace:
			"Meta payment grace period: action needed before interruption",
		unsettled: "Meta reports an unsettled account balance",
		restricted:
			"Meta account restriction: investigate; card decline not confirmed",
		recovered: "Previous Meta billing signal cleared on two checks",
		healthy: "No current Meta billing signal",
		unknown: "Meta billing state unavailable",
	}[signal];
	return {
		client: clientMessage(signal, lastFour),
		internal:
			label +
			(lastFour
				? `\nCurrent payment method ending ${lastFour}.`
				: "\nCard last four unavailable. Do not guess.") +
			"\nOpen Meta Billing to verify the cause. No payment attempt or campaign change was made.",
	};
}
export function sheetIdentity(
	values: unknown[][],
	taskId: string,
): { group: string; account: string | null; reference: string } {
	const head = (values[0] ?? []).map((v) => String(v).trim().toLowerCase());
	const column = (names: string[]) => head.findIndex((v) => names.includes(v));
	const id = column(["clickup id"]),
		group = column(["wa group id"]),
		account = column(["ad account - meta"]);
	if (id < 0 || group < 0 || account < 0)
		throw new Error("Client Data identity columns are missing");
	const rows = values
		.slice(1)
		.filter((r) => String(r[id] ?? "").trim() === taskId);
	if (rows.length !== 1)
		throw new Error("Client Data must have one exact task-ID match");
	const destination = String(rows[0][group] ?? "").trim();
	if (!/^\d+(?:-\d+)?@g\.us$/.test(destination))
		throw new Error("Verified WhatsApp group is missing");
	const reference = String(rows[0][account] ?? "").trim();
	if (!reference) throw new Error("Client Data account reference is missing");
	return { group: destination, account: accountId(reference), reference };
}
export function validateBinding(
	b: Binding,
	client: Task,
	ads: Task[],
	sheet: unknown[][],
): void {
	if (!b.enabled || !activeTask(client, b.client_task_id))
		throw new Error("Client is not currently Active");
	if (
		!/^\d{5,25}$/.test(b.account_id) ||
		!b.identity_evidence ||
		!Number.isFinite(Date.parse(b.identity_verified_at))
	)
		throw new Error("Account identity is unverified");
	const identity = sheetIdentity(sheet, b.client_task_id);
	if (identity.group !== b.whatsapp_group)
		throw new Error("WhatsApp group changed; review the binding");
	if (identity.reference !== b.sheet_account_ref)
		throw new Error(
			"Client Data account reference changed; review the binding",
		);
	// Names cannot establish identity. Until Client Data contains a numeric ID,
	// an operator-approved binding plus exact account URLs on every ads task is required.
	if (identity.account && identity.account !== b.account_id)
		throw new Error("Client Data account changed; review the binding");
	if (
		!b.ads_task_ids.length ||
		new Set(b.ads_task_ids).size !== b.ads_task_ids.length ||
		b.ads_task_ids.includes(b.client_task_id)
	)
		throw new Error("Ads tasks are incomplete or duplicated");
	if (
		ads.length !== b.ads_task_ids.length ||
		!b.ads_task_ids.every((id) =>
			ads.some((t) => adsTaskMatches(t, id, b.account_id)),
		)
	)
		throw new Error("Ads task account identity changed or is missing");
}
