# Team-only seats: call center agents and editors in Team meetings

Aziz, 2026-10-17: "I want the editors to be able to see the team meetings. In
the editor desk, they also have access to it. ... make an option to add call
center agents to the cockpit as well. Obviously, they're not going to have a
cockpit. All they're going to have is team meetings and the client performance
section, or you could add it to the dialer as well somehow. The dialer system:
they can see all the team meetings. When they update, they're in the same one
where it updates the doc, whatever team meetings they're in."

This file is the contract. Names are final; change them here first.

## Decisions

1. **A new seat role `call_center`.** A member whose roles are only
   `call_center` (no admin, no CEO address, no cockpit role) is a
   **team-only seat**. It sees exactly two places: Team meetings and Client
   performance. It has no cockpit, so the portal sends it to `/team`.
2. **Team-only seats see the meetings they are in**: a meeting where
   `team_meeting_people` has a row for the `team_people` person whose `email`
   equals the member's email, with `removed = false`. They read and edit those
   meetings' doc, notes, agenda and run of show (the same rows everyone edits,
   so an edit from them is the same doc). They cannot see other meetings,
   their sittings, notes, recordings or changes. Every other seat keeps
   today's rule (everyone reads all).
3. **Team-only seats see the client performance board for their own
   clients only**: their `cockpit_members.clients` list (client display names
   as `cockpit_client_allowed` matches them). The CEO sets it in Admin; for the
   two agents it is seeded from the dialer's `access:agent:<email>`
   `locationIds` mapped to board client names. An empty list for a team-only
   seat means **no clients** (never all). They can read the board; they cannot
   file levers or set targets.
4. **Team-only seats are kept out of every "any active seat" door** that is
   not Team meetings (own meetings) or the board (own clients): client billing
   (`cockpit_billing_accounts`, `cockpit_billing_events`,
   `cockpit_billing_inbox`), the social calendar (`social_*`), recordings of
   other meetings (`team_recordings`), board writes, and anything else the
   audit finds. One helper decides it: `public.cockpit_is_team_only()`.
5. **Editors**: Team meetings goes back on the editor desk's rail (its foot,
   with Client performance), as `docs/DESIGN.md` says. `cockpit_admin_upsert_member`
   now also keeps `editor_people.via_portal` in step with the `editor` role, so
   an editor added in Admin gets into the desk without waiting for ClickUp.
   Editors keep their normal seat (everyone reads all meetings).
6. **The dialer** (repo `AzizWaheedi/mahara-power-dialer`, dialer.maharamedia.com):
   - accepts a Supabase user whose role is `authenticated` when the dialer
     account is enabled and its `authId` equals the user id (today only
     `mahara_dialer_identity` passes, except configured admins), so the same
     login works in the dialer and the cockpit;
   - shows "Team meetings" in its rail for agents and admins, opening
     `https://cockpit.maharamedia.com/team` in a new tab (same doc, same data:
     there is one Team meetings, in the cockpit). Nothing is embedded (the
     dialer's CSP forbids frames and cross-origin calls, and stays as it is).
7. **Order of go-live** (no one locked out at any point):
   1. Apply the migration and ship the cockpit (role, gates, landing, editor rail).
   2. Deploy the dialer that accepts both roles; verify an agent can still sign in.
   3. Create the seats in Admin as the CEO: Ali and Moaz (`editor`), Daniya and
      Lama (`call_center`, clients from the dialer).
   4. Set Daniya's and Lama's `auth.users.role` to `authenticated` so the
      cockpit accepts their token; the dialer already accepts it.
   5. Verify: an agent token reads only their meetings and clients, and is
      refused billing and social; the dialer still signs them in.

## Database (one migration, `20261017b_team_only_seats.sql`)

House style: `BEGIN; ... COMMIT;`, safe to apply twice, `SECURITY DEFINER SET
search_path=''`, grants to exactly one role, audit rows, loads in PGlite.

- `cockpit_is_team_only() returns boolean`: the caller has an active, linked
  seat; its roles are non-empty and every role is `call_center`; it is not the
  CEO (`cockpit_is_ceo()`) and not admin. Granted to authenticated.
- `cockpit_team_member_of(p_meeting_id text) returns boolean`: true when the
  caller is not team-only, or is team-only and in that meeting (as above).
  Granted to authenticated.
- `cockpit_admin_upsert_member`: allowed roles gain `call_center`; a seat with
  `call_center` plus any other role is refused ("Call center is a seat on its
  own"); when the roles include `editor` it upserts `editor_people` by email
  with `via_portal = true`, and when `editor` is removed it sets
  `via_portal = false` (ClickUp's `via_clickup` is untouched).
- `cockpit_get_my_access`: a team-only seat gets `cockpits = []` and
  `home = '/team'`.
- `cockpit_client_allowed(name)`: a team-only seat with an empty `clients`
  list allows no client.
- Row policies: every `team_*` table that belongs to a meeting
  (`team_meetings` by id, and the rest by `meeting_id`: `team_sittings`,
  `team_agenda`, `team_meeting_blocks`, `team_meeting_people`,
  `team_recordings`, `team_changes`, `team_wheels`, `team_wheel_options`,
  `team_wheel_spins`, `team_creative_rows`, `team_calendar_ops` where they
  exist and have a meeting column) adds `and public.cockpit_team_member_of(<meeting>)`
  to read and write. `team_people` stays readable (names and roles of
  colleagues). Functions in the team area that take a meeting id add the same
  check. The billing and social policies add `and not public.cockpit_is_team_only()`.
  Board functions that write (levers, targets) refuse team-only seats.
- Tests (PGlite): a team-only seat sees only its meetings and edits their doc
  with the normal compare-and-swap; is refused another meeting, billing,
  social, levers; sees only its board clients; lands on `/team` from
  `cockpit_get_my_access`; an editor seat still sees all meetings; Admin
  upsert accepts `call_center` alone, refuses it with another role, and keeps
  `editor_people.via_portal` in step.

## Portal (apps/media-buyer-cockpit) and shared files

- `src/auth/supabaseAccess.ts` (byte-identical in all five apps): `HOME`
  knows `call_center: "/team"`; `COCKPITS` unchanged.
- `src/pages/PortalHome.tsx`: no cockpits and a `home` set: go to `home`
  (never "No cockpit on your account yet" for a team-only seat).
- `src/pages/AdminPage.tsx`: a "Call center" choice ("Team meetings and the
  client performance table, for their own clients"), alone (choosing it clears
  the cockpit roles and the reverse), with the clients picker shown as
  required for it.
- The sidebar, the phone tab bar and search already show only Team meetings
  and Client performance to a seat with no cockpit; check it.

## Editor desk (apps/video-editor-cockpit)

- `src/components/Sidebar.tsx`: "Team meetings" at the foot of the rail
  (`${portalUrl()}/team`), above "Client performance", with the shared icon.
