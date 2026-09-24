/**
 * The layout harness: the real cockpit, signed in as a made-up manager and
 * fed by src/dev/fixtures.ts instead of Supabase, so every screen can be
 * checked at phone and laptop widths without a sign-in. Open
 * /sales/harness.html?path=/ (any route: /calendar, /lead/lead-5,
 * /call/lead-5?script=demo, /numbers …) with `bun run dev`.
 *
 * It answers the cockpit's own requests: PostgREST reads (with the filters
 * the cockpit uses), the whoami call, the proposal file and the sales-api
 * function. Nothing leaves the browser. The real scripts are read from
 * tmp/harness/scripts.json when it exists (gitignored); without it the call
 * screen says the script is not imported.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import "../index.css";
import * as F from "./fixtures";

// The Supabase client keeps the fetch it was created with, so the stand-in
// below is installed before the client module is loaded (dynamic imports
// further down), never after.
const SUPABASE_URL = String(import.meta.env.VITE_SUPABASE_URL ?? "");

type Row = Record<string, unknown>;

async function main() {
  let scripts: Record<string, Row> = {};
  try {
    const res = await fetch("/sales/tmp/harness/scripts.json");
    if (res.ok) scripts = await res.json();
  } catch {
    // no scripts staged
  }

  const tables: Record<string, Row[]> = {
    cockpit_sales_leads: F.LEADS,
    cockpit_sales_calendar: F.APPOINTMENTS,
    cockpit_sales_dials: F.DIALS,
    cockpit_sales_deals: F.DEALS,
    cockpit_sales_notes: [],
    cockpit_sales_proposals: F.PROPOSALS,
    cockpit_sales_requests: [],
    cockpit_sales_recordings: [],
    cockpit_sales_scorecards: F.scorecards(),
    cockpit_sales_board: F.board(),
    cockpit_sales_people: F.PEOPLE,
    cockpit_sales_team: F.TEAM_ROWS,
    cockpit_sales_reps: F.REPS,
    cockpit_sales_links: F.LINKS,
    cockpit_sales_settings: F.SETTINGS,
    cockpit_sales_mirror_runs: [F.MIRROR_RUN],
    cockpit_sales_worker_status: [],
    cockpit_sales_inbox: F.INBOX,
    cockpit_sales_scripts: Object.values(scripts).map((doc, i) => ({
      id: `s${i}`,
      key: doc.key,
      lang: doc.lang,
      version: 1,
      title: doc.title,
      doc,
      active: true,
      imported_at: new Date().toISOString(),
    })),
  };

  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    if (!url.href.startsWith(SUPABASE_URL)) return realFetch(input, init);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    const path = url.pathname;
    if (path.endsWith("/rpc/cockpit_sales_whoami")) return json(F.ME);
    if (path.startsWith("/functions/v1/sales-api")) {
      const body = JSON.parse(String(init?.body ?? "{}"));
      if (body.action === "lead.live")
        return json({
          ok: true,
          live: {
            contact: { tags: [], dnd: false, assigned_to: "u-sara" },
            contact_error: null,
            conversations: [
              {
                id: "c1",
                type: "TYPE_PHONE",
                unread: 1,
                inbound_whatsapp_at: new Date(
                  Date.now() - 2 * 3_600_000,
                ).toISOString(),
              },
            ],
            conversations_error: null,
            messages: [
              {
                id: "m1",
                direction: "outbound",
                type: "TYPE_WHATSAPP",
                status: "read",
                at: new Date(Date.now() - 5 * 3_600_000).toISOString(),
                body: "هلا! تأكيد مكالمتنا بكرة الساعة ٦ مساءً.",
                has_attachments: false,
                source: "workflow",
              },
              {
                id: "m2",
                direction: "inbound",
                type: "TYPE_WHATSAPP",
                status: "delivered",
                at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
                body: "تمام، موجود.",
                has_attachments: false,
                source: null,
              },
            ],
            messages_error: null,
            read_at: new Date().toISOString(),
          },
        });
      if (body.action === "dial.queue")
        return json({
          ok: true,
          as: body.as ?? "setter",
          counts: [1, 3, 2, 41],
          open: null,
          queue: F.LEADS.slice(0, 8).map((l, i) => ({
            contact_id: l.contact_id,
            name: l.name,
            phone: l.phone,
            stage: l.stage_name,
            lead_class: l.lead_class,
            tier: i === 0 ? 0 : i < 4 ? 1 : i < 6 ? 2 : 3,
            why: [
              "New lead, call now",
              "Wrote back today",
              "New lead, not reached yet",
              "New lead, never called",
              "Next try is due",
              "Missed the intro, rebook it",
              "Never called",
              "Never called",
            ][i],
            created_at: l.lead_created_at,
            last_dial_at:
              i > 3 ? new Date(Date.now() - 86_400_000).toISOString() : null,
            due_at: null,
          })),
        });
      if (body.action === "dial.call")
        return json({
          ok: true,
          attempt: {
            id: "att-1",
            contact_id: body.contact_id,
            state: "placed",
            started_at: new Date().toISOString(),
            error: null,
          },
          route: { country: "Saudi Arabia", caller: "966115203895" },
        });
      if (body.action === "dial.save" || body.action === "dial.release")
        return json({ ok: true });
      if (body.action === "ghl.users")
        return json({
          ok: true,
          users: [
            { id: "u-sara", name: "Sara Khalil", email: "sara@example.com" },
            { id: "u-omar", name: "Omar Haddad", email: "omar@example.com" },
          ],
        });
      return json({
        ok: true,
        mark: { crm: "written", crm_error: null, status: body.status },
      });
    }
    if (path.startsWith("/storage/v1/object")) {
      return new Response(
        "<!doctype html><html dir='rtl'><body style='font-family:system-ui;padding:40px'><h1>مقترح شراكة</h1><p>مشاريعكم القادمة FILL</p></body></html>",
        { status: 200, headers: { "Content-Type": "text/html" } },
      );
    }
    const m = path.match(/\/rest\/v1\/([a-z_]+)$/);
    if (!m) return json([]);
    let rows = [...(tables[m[1]] ?? [])];
    for (const [k, v] of url.searchParams) {
      if (["select", "order", "limit", "offset", "or"].includes(k)) continue;
      const [op, ...rest] = v.split(".");
      const val = rest.join(".");
      rows = rows.filter(r => {
        const x = r[k];
        if (op === "eq") return String(x) === val;
        if (op === "neq") return String(x) !== val;
        if (op === "gte") return x !== null && String(x) >= val;
        if (op === "gt") return x !== null && String(x) > val;
        if (op === "lt") return x !== null && String(x) < val;
        if (op === "lte") return x !== null && String(x) <= val;
        if (op === "is")
          return val === "null"
            ? x === null || x === undefined
            : String(x) === val;
        if (op === "in")
          return val
            .replace(/[()]/g, "")
            .split(",")
            .map(v => v.replace(/^"|"$/g, ""))
            .includes(String(x));
        if (op === "not" && rest[0] === "is")
          return !(x === null || x === undefined);
        return true;
      });
    }
    const order = url.searchParams.get("order");
    if (order) {
      const [col, dir] = order.split(",")[0].split(".");
      rows.sort((a, b) => {
        const A = String(a[col] ?? "");
        const B = String(b[col] ?? "");
        return dir === "desc" ? B.localeCompare(A) : A.localeCompare(B);
      });
    }
    const wantsOne = (new Headers(init?.headers).get("Accept") ?? "").includes(
      "vnd.pgrst.object",
    );
    if (wantsOne) {
      if (!rows.length)
        return json(
          {
            code: "PGRST116",
            details: "The result contains 0 rows",
            hint: null,
            message: "no rows",
          },
          406,
        );
      return json(rows[0]);
    }
    return json(rows);
  };

  const { supabase } = await import("../lib/supabase");
  // api() asks for a session before calling the function; the harness has one.
  supabase.auth.getSession = (async () => ({
    data: { session: { access_token: "harness" } },
    error: null,
  })) as unknown as typeof supabase.auth.getSession;

  const { Seated } = await import("../App");
  const { useState } = await import("react");
  function Harness() {
    const [drawer, setDrawer] = useState(false);
    return (
      <Seated
        me={F.ME as never}
        name="Aziz Waheedi"
        isAdmin
        drawer={drawer}
        setDrawer={setDrawer}
        banner={null}
      />
    );
  }
  const { Toaster } = await import("../lib/toast");
  const { SessionProvider } = await import("../lib/auth");
  const start = new URLSearchParams(window.location.search).get("path") ?? "/";
  const root = document.getElementById("root");
  if (!root) throw new Error("no #root");
  createRoot(root).render(
    <StrictMode>
      <MemoryRouter initialEntries={[start]}>
        <SessionProvider>
          <Harness />
          <Toaster />
        </SessionProvider>
      </MemoryRouter>
    </StrictMode>,
  );
}

void main();
