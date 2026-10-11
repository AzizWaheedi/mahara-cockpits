import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import {
	ADS_LIST,
	CLIENT_LIST,
	SLACK_CHANNEL,
	type Binding,
	type Task,
	validateBinding,
} from "./core";
export type Env = Record<string, string | undefined>;
export interface Delivery {
	id: string;
	binding_id: string;
	revision: number;
	channel: "clickup" | "slack" | "whatsapp";
	destination: string;
	body: string;
	claim: string;
	state: string;
}
export class ProviderError extends Error {
	constructor(
		public provider: string,
		public status: number,
		public uncertain = false,
	) {
		super(`${provider} request failed (${status || "network"}).`);
	}
}
export class Transport {
	private googleToken?: string;
	constructor(
		readonly env: Env,
		readonly fetcher: typeof fetch = fetch,
	) {}
	needed(key: string) {
		const value = this.env[key];
		if (!value) throw new Error(`Missing configuration: ${key}`);
		return value;
	}
	async json(
		provider: string,
		url: string,
		init: RequestInit = {},
		read = false,
	): Promise<any> {
		for (let attempt = 0; attempt < (read ? 3 : 1); attempt++) {
			try {
				const response = await this.fetcher(url, {
					...init,
					signal: AbortSignal.timeout(20_000),
					redirect: "error",
				});
				if (!response.ok) {
					if (
						read &&
						(response.status === 429 || response.status >= 500) &&
						attempt < 2
					) {
						await sleep((attempt + 1) * 1000);
						continue;
					}
					throw new ProviderError(
						provider,
						response.status,
						response.status >= 500 || response.status === 408,
					);
				}
				try {
					return await response.json();
				} catch {
					throw new ProviderError(provider, 0, true);
				}
			} catch (error) {
				if (read && attempt < 2 && !(error instanceof ProviderError)) {
					await sleep((attempt + 1) * 1000);
					continue;
				}
				throw error instanceof ProviderError
					? error
					: new ProviderError(provider, 0, true);
			}
		}
		throw new ProviderError(provider, 0, true);
	}
	async rpc<T = any>(
		name: string,
		args: Record<string, unknown> = {},
	): Promise<T> {
		if (!/^cockpit_ad_billing_[a-z_]+$/.test(name))
			throw new Error("Invalid billing RPC");
		return this.json("Database", `${this.dbUrl()}/rest/v1/rpc/${name}`, {
			method: "POST",
			headers: this.dbHeaders(),
			body: JSON.stringify(args),
		});
	}
	dbUrl() {
		const url = this.needed("SUPABASE_URL").replace(/\/$/, "");
		if (url !== "https://bldgtotkfmhoxmlzowdx.supabase.co")
			throw new Error("Billing requires the Creative Triage database");
		return url;
	}
	dbHeaders() {
		return {
			"Content-Type": "application/json",
			apikey: this.needed("SUPABASE_SERVICE_ROLE_KEY"),
			Authorization: `Bearer ${this.needed("SUPABASE_SERVICE_ROLE_KEY")}`,
		};
	}
	async rows<T = any>(table: string, query = ""): Promise<T[]> {
		if (!/^cockpit_ad_billing_(bindings|deliveries|config)$/.test(table))
			throw new Error("Invalid billing table");
		return this.json(
			"Database",
			`${this.dbUrl()}/rest/v1/${table}?${query}`,
			{ headers: this.dbHeaders() },
			true,
		);
	}
	async task(id: string): Promise<Task> {
		if (!/^[a-zA-Z0-9]+$/.test(id)) throw new Error("Invalid task ID");
		return this.json(
			"ClickUp",
			`https://api.clickup.com/api/v2/task/${id}`,
			{ headers: { Authorization: this.needed("CLICKUP_API_TOKEN") } },
			true,
		);
	}
	async tasks(
		list: string,
	): Promise<(Task & { name: string; tags: { name: string }[] })[]> {
		if (![CLIENT_LIST, ADS_LIST].includes(list))
			throw new Error("Invalid task list");
		const tasks = [];
		for (let page = 0; page < 30; page++) {
			const result = await this.json(
				"ClickUp",
				`https://api.clickup.com/api/v2/list/${list}/task?include_closed=true&subtasks=true&page=${page}`,
				{ headers: { Authorization: this.needed("CLICKUP_API_TOKEN") } },
				true,
			);
			if (!Array.isArray(result.tasks))
				throw new Error("ClickUp task collection is missing");
			tasks.push(...result.tasks);
			if (result.last_page === true || result.tasks.length === 0) return tasks;
		}
		throw new Error(
			"ClickUp pagination limit reached; no partial roster accepted",
		);
	}
	async meta(id: string): Promise<Record<string, unknown>> {
		if (!/^\d{5,25}$/.test(id)) throw new Error("Invalid Meta account ID");
		const base = `https://graph.facebook.com/${this.env.META_GRAPH_VERSION ?? "v21.0"}/act_${id}`;
		const headers = {
			Authorization: `Bearer ${this.needed("META_SYSTEM_TOKEN")}`,
		};
		const core = await this.json(
			"Meta",
			`${base}?fields=id,name,account_status,disable_reason,currency`,
			{ headers },
			true,
		);
		// An unavailable optional card field must not hide the account's payment signal.
		try {
			const extra = await this.json(
				"Meta",
				`${base}?fields=id,funding_source_details`,
				{ headers },
				true,
			);
			core.funding_source_details = extra.funding_source_details;
		} catch {}
		return core;
	}
	async sheet(): Promise<unknown[][]> {
		if (!this.googleToken) {
			const account = JSON.parse(
				await readFile(this.needed("GOOGLE_APPLICATION_CREDENTIALS"), "utf8"),
			);
			const enc = (v: unknown) =>
				Buffer.from(JSON.stringify(v)).toString("base64url");
			const now = Math.floor(Date.now() / 1000);
			const unsigned = `${enc({ alg: "RS256", typ: "JWT" })}.${enc({ iss: account.client_email, scope: "https://www.googleapis.com/auth/spreadsheets.readonly", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
			const signature = createSign("RSA-SHA256")
				.update(unsigned)
				.sign(account.private_key)
				.toString("base64url");
			const token = await this.json(
				"Google",
				"https://oauth2.googleapis.com/token",
				{
					method: "POST",
					headers: { "Content-Type": "application/x-www-form-urlencoded" },
					body: new URLSearchParams({
						grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
						assertion: `${unsigned}.${signature}`,
					}).toString(),
				},
			);
			if (!token.access_token)
				throw new Error("Google returned no read-only credential");
			this.googleToken = token.access_token;
		}
		const result = await this.json(
			"Google",
			"https://sheets.googleapis.com/v4/spreadsheets/1_0Nv-IFvzhH4NBNh1dxCUm6Ryp414ctM_8EO5QORBF0/values/Client%20Data!A:ZZ",
			{ headers: { Authorization: `Bearer ${this.googleToken}` } },
			true,
		);
		if (!Array.isArray(result.values))
			throw new Error("Client Data is unavailable");
		return result.values;
	}
	async eligibility(binding: Binding) {
		const [client, sheet, ads] = await Promise.all([
			this.task(binding.client_task_id),
			this.sheet(),
			Promise.all(binding.ads_task_ids.map((id) => this.task(id))),
		]);
		validateBinding(binding, client, ads, sheet);
	}
	preflight(d: Delivery) {
		if (d.channel === "slack") {
			this.needed("SLACK_BOT_TOKEN");
			if (d.destination !== SLACK_CHANNEL)
				throw new Error("Wrong Slack channel");
		}
		if (d.channel === "clickup") this.needed("CLICKUP_API_TOKEN");
		if (d.channel === "whatsapp") this.needed("AD_BILLING_WHAPI_TOKEN");
	}
	marker(d: Delivery) {
		return `BG-${d.id}`;
	}
	async send(d: Delivery): Promise<string> {
		this.preflight(d);
		const body =
			d.body +
			`\n\n${d.channel === "whatsapp" ? "مرجع المتابعة" : "Reference"}: ${this.marker(d)}`;
		let result: any;
		if (d.channel === "slack") {
			result = await this.json(
				"Slack",
				"https://slack.com/api/chat.postMessage",
				{
					method: "POST",
					headers: {
						Authorization: `Bearer ${this.needed("SLACK_BOT_TOKEN")}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({
						channel: d.destination,
						text: body
							.replace(/&/g, "&amp;")
							.replace(/</g, "&lt;")
							.replace(/>/g, "&gt;"),
						client_msg_id: d.id,
						unfurl_links: false,
						unfurl_media: false,
					}),
				},
			);
			if (result.ok !== true) throw new ProviderError("Slack", 400);
			if (typeof result.ts === "string") return result.ts;
		} else if (d.channel === "clickup") {
			if (!/^[a-zA-Z0-9]+$/.test(d.destination))
				throw new Error("Invalid comment destination");
			result = await this.json(
				"ClickUp",
				`https://api.clickup.com/api/v2/task/${d.destination}/comment`,
				{
					method: "POST",
					headers: {
						Authorization: this.needed("CLICKUP_API_TOKEN"),
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ comment_text: body, notify_all: false }),
				},
			);
			if (result.id && ["string", "number"].includes(typeof result.id))
				return String(result.id);
		} else {
			if (!/^\d+(?:-\d+)?@g\.us$/.test(d.destination))
				throw new Error("Only verified client groups are allowed");
			result = await this.json(
				"Whapi",
				"https://gate.whapi.cloud/messages/text",
				{
					method: "POST",
					headers: {
						Authorization: `Bearer ${this.needed("AD_BILLING_WHAPI_TOKEN")}`,
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ to: d.destination, body }),
				},
			);
			if (result.sent === true && typeof result.message?.id === "string")
				return result.message.id;
		}
		throw new ProviderError(d.channel, 0, true);
	}
	async reconcile(d: Delivery): Promise<string | null> {
		// A missing match is NOT proof that the send failed. Pagination or read lag
		// may hide it. Never automatically requeue an ambiguous notification.
		this.preflight(d);
		let result: any, items: any[];
		if (d.channel === "clickup") {
			result = await this.json(
				"ClickUp",
				`https://api.clickup.com/api/v2/task/${encodeURIComponent(d.destination)}/comment`,
				{ headers: { Authorization: this.needed("CLICKUP_API_TOKEN") } },
				true,
			);
			items = result.comments ?? [];
			return (
				items
					.find((x) => String(x.comment_text ?? "").includes(this.marker(d)))
					?.id?.toString() ?? null
			);
		}
		if (d.channel === "slack") {
			result = await this.json(
				"Slack",
				`https://slack.com/api/conversations.history?channel=${encodeURIComponent(d.destination)}&limit=100`,
				{
					headers: {
						Authorization: `Bearer ${this.needed("SLACK_BOT_TOKEN")}`,
					},
				},
				true,
			);
			if (result.ok !== true) throw new ProviderError("Slack", 400);
			return (
				result.messages?.find(
					(x: any) =>
						x.client_msg_id === d.id ||
						String(x.text ?? "").includes(this.marker(d)),
				)?.ts ?? null
			);
		}
		result = await this.json(
			"Whapi",
			`https://gate.whapi.cloud/messages/list/${encodeURIComponent(d.destination)}?count=100`,
			{
				headers: {
					Authorization: `Bearer ${this.needed("AD_BILLING_WHAPI_TOKEN")}`,
				},
			},
			true,
		);
		return (
			result.messages?.find(
				(x: any) =>
					x.from_me === true &&
					String(x.text?.body ?? "").includes(this.marker(d)),
			)?.id ?? null
		);
	}
}
