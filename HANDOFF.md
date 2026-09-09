# Mahara Media Cockpits — full handoff

Everything needed to run, host and keep editing the three role cockpits outside Viktor.
Written for another engineer or LLM picking this up cold. Exported 2026-09-08.

---

## 1. What these are

Three private web apps, one per role. Each is a phone-first daily screen with three moments:
start of day (checklist pre-answered from ClickUp, Sheets, Meta, GHL), midday recommendations,
end of day "Plan Tomorrow Today" (brain dump in Arabic or English becomes owned, dated ClickUp tasks).

| App | Folder | Who uses it |
|---|---|---|
| Media buyer cockpit | `apps/media-buyer-cockpit` | Media buyer: accounts, ads, budgets, tracking gaps, onboardings, launches |
| Client success cockpit | `apps/client-success-cockpit` | CSM: hot list, promised items, loose ends, client performance, report docs |
| Creative director cockpit | `apps/creative-director-cockpit` | Creative: tasks, video jobs, content calendar, funnels, winning ads, blueprints |

They are separate apps on separate databases on purpose. They share the same template, the same
design language, and several of the same tables (`checks`, `planItems`, `eodReports`, `decisions`,
`clients`), but they do not talk to each other.

## 2. Stack

Identical for all three:

- **Convex** — database, queries/mutations/actions, scheduled functions (backend lives in `convex/`)
- **Vite + React 19 + React Router 8** — frontend (`src/`)
- **Tailwind v4 + shadcn/ui** (53 components in `src/components/ui`)
- **Convex Auth** (email/password) plus a Viktor-specific SSO layer, see section 6
- **Bun** as package manager, **Biome** for lint/format, **Playwright** for the tests in `scripts/`
- Hosted on **Vercel** (`vercel.json` is included)

Sizes: media buyer ~10k lines of backend, creative ~4.3k, client success ~2.8k, plus frontends.

## 3. Run it locally

```bash
cd apps/media-buyer-cockpit
bun install
bunx convex dev          # creates a NEW Convex deployment under your own account, generates convex/_generated
bun run dev              # frontend on http://localhost:5173
```

`convex/_generated` was stripped from this export because it is machine-generated and tied to the
old deployment. `bunx convex dev` regenerates it on first run. `node_modules`, `dist`, lockfiles
and all secrets were also stripped.

Deploy: `bunx convex deploy` for the backend, then any static host for the Vite build
(`bun run build` → `dist/`). Vercel config is already in the repo.

## 4. Environment variables

`.env.example` in each app lists them. Real values are NOT in this export. What matters:

| Variable | What to do |
|---|---|
| `CONVEX_DEPLOYMENT`, `CONVEX_DEPLOY_KEY`, `VITE_CONVEX_URL`, `VITE_CONVEX_SITE_URL` | Your own new Convex project sets these |
| `JWT_PRIVATE_KEY`, `JWKS` | Convex Auth generates them (`bunx @convex-dev/auth`) |
| `SITE_URL` | Your hosted URL |
| Anything named `VIKTOR_*` or `VITE_VIKTOR_*` | Viktor platform only. Delete these and the code paths that read them (section 6) |

## 5. Where the data comes from

This is the part that matters most. The screens are thin, the data spine is the product.

**Join key rule: join on IDs, never on client names.**

| Source | What it feeds |
|---|---|
| Google Sheet `DATABASE - MAHARA` id `1_0Nv-IFvzhH4NBNh1dxCUm6Ryp414ctM_8EO5QORBF0`, tab `Client Data` | Canonical client table: Status, ClickUp ID, GHL ID, per-client GHL `pit-` token, WhatsApp group ID, report doc, drive, sheet link, Meta/Snap/TikTok ad account, country, city, language, service. Other tabs: `New Leads`, `Appointments`, `appts_last_30days`, `clients_clean`, `tasks_clean`, `unresolved_tasks` |
| Google Sheet `Master Dashboard - Mahara` id `1pBEyClUxPLc4-RdXR8gZ0MxsLkLLFkWJwkiVqVf2rro`, tab `data_fb` | Daily ad-level rows for 18 accounts: cost, leads, CPL, impressions, clicks, CTR, frequency, ad name, effective status, account currency. **Known defect: `Cost (USD)` is unconverted.** Always read `Account currency` and convert (e.g. Mofage is QAR) |
| ClickUp, team `90182518398` | Tasks and comments. 5 department lists under space `901810248115`: Operations/Tech `901816723190`, Marketing/ADs `901816723196`, Call Center `901816723206`, Client Success `901816723211`, Media/Creative `901818016338`. Also Clients `901816559981`, Ads Management `901817774521`. **Never read subtask status as truth**, parents get closed with subtasks left open |
| Meta Marketing API | Live ad/adset/campaign status, spend, creative previews. Aziz's own account `act_746108264865897`, page `587094101153861`, pixel `850580864362564` |
| GoHighLevel | Appointments, opportunities, lost reasons. Agency OAuth 401s on custom values, so **per-client `pit-` tokens** from the Client Data sheet are used instead |
| Typeform | EOD forms: Creative Director `wzm1gzEz`, Video Editors `WH3cPCVq`. Kickoff `tG7dnxBn` and Brand Blueprint `oYZKtogO` have zero responses ever, ignore them |
| Per-client report sheets `{Client} - Report` | Client performance screens |

## 6. The Viktor-specific parts you must replace

These are the only things that will not work outside Viktor. All three apps have them.

1. **`convex/tools.ts` → `callTool()`.** Every integration call goes through a Viktor gateway
   (`VIKTOR_SPACES_API_URL` + a project secret) which proxies to ClickUp, Sheets, Meta, GHL,
   Typeform, Supabase. Replace this single function with direct API clients holding your own
   tokens. Everything downstream keeps working unchanged, the call sites all speak
   `callTool("<tool_name>", {args})`.
2. **Auth SSO shims.** `convex/spaceSessionAuth.ts`, `convex/viktorSpaceAuthConfig.ts`,
   `convex/viktorSpaceAuthEnv.ts`, `convex/viktorTools.ts`, and in `src/components/`:
   `SpaceSessionAutoSignIn.tsx`, `ViktorAutoSignIn.tsx`, `ViktorSignInSection.tsx`,
   `ViktorStatus.tsx`, plus `ViktorOAuthCallbackPage.tsx`. Delete them and keep plain Convex Auth
   email/password, which is already wired in `convex/auth.ts` and the `SignIn`/`SignUp` components.
3. **`convex/phiLogging.ts` / `phiConsoleStatics.ts` and the `phi-*` tests.** Log redaction for the
   Viktor console. Harmless to keep, safe to delete.
4. **`package.json` → `scripts.screenshot`** points at a Viktor internal path. Delete that line.

## 7. The outside-in sync (important)

`viktor-side-scripts/` holds Python that runs OUTSIDE the apps and pushes data in.

- `sync_cockpit.py` (1,588 lines) is the main pull: ClickUp + Sheets + Typeform + Meta, staged into
  the Space database in chunks, then `runSync` is triggered. It exists because the Viktor tool
  endpoint returns 500 platform-side, so fetching moved out of the backend. `runSync` in
  `convex/sync.ts` **prefers staged input and falls back to fetching itself** — so on your own host,
  once `callTool` is replaced with real API clients, you can drop these scripts entirely and let the
  backend fetch. That is the cleaner end state.
- `csm/` (~4.7k lines) is the client success pipeline: daily list, signal scan, client profiles,
  churn history, GHL lost reasons, report docs, EOD export, the app bridge.
- Others: `assist_worker.py`, `collect_market_plays.py`, `transcribe_winners.py`, `cockpit_reply.py`.

These import a Viktor `sdk.tools.*` layer that does not exist outside Viktor. Treat them as
**reference implementations of the business logic**, not runnable code. Every one of them shows
exactly which sheet tabs, ClickUp lists and API fields are read and how they are cleaned.

Scheduling in the apps themselves: `convex/crons.ts`, e.g. the media buyer refreshes at
03:30 UTC (06:30 Kuwait) Saturday to Thursday.

## 8. Product rules baked into the UI (do not break these)

- Every row ends in its own actions: recommended action, one alternative, `Leave it`, overflow.
- **Modify = reroute.** Department picker, assignee, due date, editable title and body. It moves the
  item off the wrong person's screen with the evidence intact.
- **`Leave it` needs a reason and a date.** "Client hasn't approved budget" spawns a CSM touchpoint
  task. "Disagree with the call" is logged separately, and a rule disagreed with three times gets
  changed, not re-shown.
- Nothing reaches a client unapproved. The app drafts, a human sends. See the `outbox` table.
- The `decisions` table is the decision ledger: recommendation → decision → outcome at 7 days. It is
  what makes the system self-correcting. Keep it.

## 9. Security notes on this export

- All `.env.local` files, Convex deploy keys, JWT private keys and Vercel credentials were removed.
- One hardcoded GoHighLevel token in `viktor-side-scripts/csm/csm_app_bridge.py` was replaced with
  `REDACTED_GHL_PIT_TOKEN_SET_VIA_ENV`. Rotate that token if this bundle goes anywhere public, and
  read it from an environment variable in the new home.
- The context docs in `context/` name internal sheet IDs, ClickUp list IDs and ad account IDs. They
  are safe with a vendor you trust, not for a public repo.

## 10. `context/`

- `onboarding_launch_cockpits.md` — the full data spine, access status, ClickUp reality, forms
  reality, cockpit design decisions, locked SOP numbers.
- `csm_daily_workflow.md` — the client success cadence, sources of truth and writeback rules.
- `cockpit_sync_learnings.md` — operational log: what a healthy sync looks like, known non-fatal
  errors, what is expected versus a real anomaly.

Read all three before changing behaviour. Most "bugs" in this system are upstream data defects that
are already documented there.
