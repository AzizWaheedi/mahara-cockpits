# Invoice desk

Turns the invoices asked for on the client success cockpit (Money, Invoices)
into numbered, locked PDFs in the client's Drive folder and rows on the
invoice register (Churn Tracker, `07: Invoice Register`). Approved by
Muhammed on 11 Oct 2026: client success, finance, sales, admin and CEO seats
may ask; the person who asks types every value, what was paid included; the
audit log records who. Nothing is sent to the client.

## How one invoice goes

1. The cockpit calls `cockpit_invoice_request` (migration
   `20261011v_cockpit_invoices.sql`). The database checks the seat, the
   client scope, the amount, and that the payments add up to the total, then
   queues the row and writes the audit row `invoice.request`.
2. Every minute `desk.py run` claims the oldest waiting invoice
   (`cockpit_invoice_claim`, a 5 minute lease, `SKIP LOCKED`).
3. It takes the next number: one above the highest `INV-<year>-###` on the
   register or in `cockpit_invoices`. A number taken meanwhile moves to the next.
   A "Pay online" invoice asked for with "Create a Whop link" (migration
   `20261015a_cockpit_invoice_whop_links.sql`) then gets its own Whop link
   (`desk/whop.py`): a hidden one-time plan for exactly the amount, under the
   Premium Projects product. The worker saves `whopStarted` before it asks
   Whop, and the plan id and link the moment Whop answers. The plan's internal
   notes carry `cockpit-invoice:<id>`, so after an unknown outcome the worker
   finds that plan instead of making a second one. A key that may not create
   plans, or a plan that does not match the invoice, fails the invoice with a
   sentence; Whop down leaves it for the next run.
4. It finds the folder: the one saved for the client, else exactly one Drive
   folder named `Mahara - <client>`, else `<client> - Workspace`. A single exact
   match is saved for next time. None, or two, fails the invoice with a
   sentence; an admin pastes the folder link on the page, then Try again.
5. It fills `template.html` (`desk/build.py`; the cockpit's preview runs the
   same fill in `src/lib/invoiceTemplate.ts`), prints it with Chrome, and
   refuses a PDF that is not one page or lost its fonts. The payment link
   prints as a Pay now button plus one inline "secure checkout page" link,
   never as the raw address.
6. It uploads the PDF (or replaces the same file on a retry), lets anyone
   with the link view it, locks it against edits (the client folders give
   link editors, so the lock is what keeps the PDF as issued), and writes the
   register row. Each step is saved as it lands, so a retry reads it back
   instead of doing it twice.
7. `cockpit_invoice_finish` marks it issued (audit `invoice.issued`) or failed
   with the reason (audit `invoice.failed`). Google down, a 429 or a 5xx leaves
   the lease to run out, so the next run tries again; a worker that died five
   times on one invoice fails it.

Every Google and Whop call goes into `cockpit_invoice_desk_health` (no query
strings, no secrets). Every run writes `cockpit_invoice_desk_status`; the page says so
when the worker is missing, quiet for more than five minutes, or unwell.

## Keys, read by name

| Key | Where | What |
| --- | --- | --- |
| `INVOICE_SUPABASE_URL` / `_KEY` | falls back to `DESK_SUPABASE_*` in `~/.editor-desk/env` | Creative Triage, service role |
| `INVOICE_GOOGLE_KEY_FILE` | `~/.invoice-desk/env` | path to the service account JSON (chmod 600) |
| `INVOICE_REGISTER_SHEET` / `_TAB` | optional | default: the Churn Tracker, `07: Invoice Register` |
| `CHROME_PATH` | `~/.sales-desk/env` | the headless shell; `desk/render.py` also finds the newest Playwright one |
| `INVOICE_WHOP_KEY` | optional | else `WHOP_API_KEY` from `/opt/data/bibi/api-keys.env` only (`INVOICE_WHOP_KEY_FILE` / `_NAME` override). Other key files carry a Whop key that can read but not create plans |
| `INVOICE_WHOP_PRODUCT` | optional | default `prod_UxHKRiFd5kCjI`, Premium Projects Program |

Key files are read in this order: `~/.invoice-desk/env`, `~/.editor-desk/env`,
`~/.sales-desk/env`, `/opt/data/.env`. The service account is the one
`make_invoice.py` uses; it needs edit access to the clients' shared drive and
to the Churn Tracker.

## Install on the VPS

As `hermes`. The worker needs google-auth, which the system Python lacks, so it
runs from its own virtual environment in `~/.invoice-desk/venv`:

```bash
mkdir -p ~/.invoice-desk && chmod 700 ~/.invoice-desk
python3 -m venv ~/.invoice-desk/venv
~/.invoice-desk/venv/bin/python -m pip install -q google-auth requests
# copy the service account JSON to ~/.invoice-desk/service-account.json, then:
chmod 600 ~/.invoice-desk/service-account.json
echo "INVOICE_GOOGLE_KEY_FILE=/home/hermes/.invoice-desk/service-account.json" > ~/.invoice-desk/env
chmod 600 ~/.invoice-desk/env
cd ~/mahara-cockpits/hermes/invoice-desk && ~/.invoice-desk/venv/bin/python desk.py doctor
```

`doctor` changes nothing. It checks the keys, google-auth, the tables and the
Whop link columns, whether the Whop key may create plans (it asks for a plan
under a product that does not exist, so nothing is made, and prints only the
key's fingerprint), the Google sign-in, the register's header, Chrome, and
prints a sample invoice.
It ends with `ready` or names each line to fix.

### Cron

```
* * * * * cd /home/hermes/mahara-cockpits/hermes/invoice-desk && flock -n /tmp/invoice-desk.lock /home/hermes/.invoice-desk/venv/bin/python desk.py run >> /home/hermes/.invoice-desk/run.log 2>&1
```

Edit with `crontab -l > f`, edit `f`, `crontab f`. Never pipe a stale copy.

**Installed 11 Oct 2026** (doctor `ready`) from a copy of this folder in
`~/invoice-desk`, because the branch `claude/cs-invoices` was not on main
yet and a copy inside the shared clone would block every worker's
`git pull`. The cron line points at `/home/hermes/invoice-desk`. Once the
branch is on main and pulled, point the line at the clone as above and
delete `~/invoice-desk`. The crontab before the change is in
`~/.invoice-desk/crontab.before-invoice-desk`.

## Other commands

- `python3 desk.py preview --id <uuid> --out x.pdf` prints one invoice as it
  would be issued. It writes nothing anywhere else.
- `python3 desk.py golden [--write]` checks (or rewrites, after a deliberate
  template change) `tests/golden/cases.json`.

## Tests

```bash
cd hermes/invoice-desk && python3 -m unittest discover -s tests   # includes test_whop.py, no network
cd apps/client-success-cockpit && bun test scripts/invoice-template.test.ts
cd apps/media-buyer-cockpit && bun test scripts/invoices-supabase.test.ts
```

The template lives twice: here, and in the cockpit at
`apps/client-success-cockpit/src/lib/invoice-template.html`. The cockpit test
fails when the two differ or when either fill stops matching the golden
hashes. Change both copies together, then `python3 desk.py golden --write`.
