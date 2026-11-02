# billing-agent

The billing agent's own login into the cockpit (docs/forms/WAVE56-CONTRACT.md 3.4, AG).

- Deploy with `--no-verify-jwt`: the agent authenticates with its own key, `mak_` plus 43 base64url
  characters, sent as `Authorization: Bearer mak_...`. The database keeps only the key's sha256
  (`cockpit_agent_keys`); D-AG sets it with `cockpit_agent_key_put_owner('billing_agent', '<sha256 hex
  of the whole key, mak_ included>', '<note>', '<who>')`, computed on the VPS with
  `printf %s "$MAHARA_AGENT_KEY" | sha256sum` and never printed.
- With no key stored (the state at deploy) every call answers 401 `This key is not known.`
- Writes: `chase`, `invoice`, `note` (billing events of source `maher`, never queued for ClickUp) and
  `payment` (a `cockpit_billing_inbox` row, `check_state` logged; a bank transfer needs its receipt
  link and bank reference). Reads: `accounts`, `ladder`, `balances`, `inbox`, `chases`.
- 60 calls a minute per key (429 after), a repeated `requestId` answers with the first result, and every
  call by a live key is one `cockpit_agent_calls` row plus one `cockpit_csm_provider_health` receipt
  (`billing-agent:<op>`).
- An unknown or revoked key (401) writes no receipt and is refused from memory for a minute with the
  same sentence; a revoked key loses its pass as a key seen working. Above 20 such answers a minute per
  instance, an unseen key is checked against the key list (`cockpit_agent_keys` hashes over REST, read at
  most once a minute): the live key goes on, a revoked one is refused, any other key 429. A random-key
  flood never locks the real agent out of a fresh instance (contract 3.4, 11.7).
- The CEO sees the key's use and revokes it on the Billing tab (`cockpit_agent_keys_read`,
  `cockpit_agent_key_revoke`). No key, hash or body is ever logged.
- The VPS client is `viktor-side-scripts/billing-agent/cockpit_agent.py` (`doctor` checks the key is
  set, the door answers and `read ladder` works).
