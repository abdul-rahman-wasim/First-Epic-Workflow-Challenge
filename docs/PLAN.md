# Build plan — Altair group meetups slice

Status: **v4, decisions resolved 2026-10-27**: approximate area (fixed grid) · access model D (app has no DB privileges; API connects as non-bypass role) · Edge Functions · Android phone with Expo Go · hosted Supabase via CLI.

## 1. What we are building

| Part | Deliverable | Graded on |
|---|---|---|
| 1 | Migrations (meetups, RSVPs, RLS), write endpoints with shared Zod, access tests | DB-enforced access, creator-only cancel, multi-group case, one validated contract, past start time rejected |
| 2 | Expo app: sign-in, group meetup list, create, detail + map + RSVP + creator cancel | Works end to end, loading/empty/error states, map follows the visibility rule enforced on the server |
| 3 | NOTE.md, README run instructions, recording (you), session log (you) | Product call, refuse-first item, pushback, clean-start run |

Out of scope: sign-up, web, group management, notifications, live location, edit (bonus only, after everything is green).

## 2. Stack (versions checked 2026-10-27)

| Layer | Choice | Why |
|---|---|---|
| DB | **Hosted Supabase (free tier), managed with the Supabase CLI 2.122 via `npx`** | No Docker, which saves RAM on the dev machine. The CLI still owns migrations: `link`, `db push --include-seed`, `db reset --linked` |
| Contract | `packages/shared`, Zod 4.6, TS source imported directly (no build step) | One module that both the server and Metro resolve |
| API layer (reads + writes) | Hono 4 app deployed as a **Supabase Edge Function** (`functions deploy --use-api`, no Docker), the same Hono app run in-process on Node for tests | Phone reaches it over the internet (no LAN/firewall setup); reviewer runs no server; tests stay fast. Fallback: run the same Hono app on Node (`@hono/node-server`) |
| App | Expo SDK 58, Expo Router, supabase-js 2.118, TanStack Query, `react-native-maps` | **Runs in Expo Go on your phone.** No emulator, no map key |
| Tests | Vitest 5 against the hosted project | Real RLS, real JWTs, no mocks |
| Workspace | pnpm workspaces (`node-linker=hoisted` for Metro) | One lockfile, shared package linked |

**Phone networking:** with Edge Functions, the phone talks only to Supabase over the internet, for reads and writes alike. Metro (the JS bundle) still comes from the laptop over Wi-Fi; fallback is `npx expo start --tunnel`. In the Node fallback, the API also needs the laptop LAN IP plus a Windows Firewall rule for its port.

**Reviewer path:** the README covers the hosted path (create a free project → link → push → seed). It also covers a local-Docker path with `supabase start` / `db reset`, because the same migrations run unchanged on both.

## 3. Data model

```
meetups
  id uuid pk, group_id → groups, created_by → users
  title text            check length(trim) 1..80
  starts_at timestamptz
  status text           check in ('scheduled','cancelled') default 'scheduled'
  cancelled_at timestamptz
  approx_lat, approx_lng double, approx_radius_m int   -- coarse area, visible to members
  created_at
  index (group_id, starts_at)

meetup_locations      -- exact point lives in its own table so RLS can gate it per row
  meetup_id pk → meetups
  place_name text       check length 1..120
  lat, lng double       check valid ranges

rsvps
  meetup_id → meetups, user_id → users, created_at
  pk (meetup_id, user_id)      -- one RSVP per member; insert ... on conflict do nothing
  index (user_id)
```

## 4. Meeting-point visibility (decided: approximate area)

Recommendation: **approximate area until RSVP, computed by snapping to a fixed grid** (changed from the random offset in v1, see the small-town analysis below).

- **Grid:** cells of about 800 m × 800 m on a fixed lat/lng grid. The approximate center is the cell's center, and the radius is 600 m, which covers the whole cell (half-diagonal ≈ 566 m). The exact point is always inside the circle.
- **Same place, same circle.** Every meetup at North gate lands in the same cell, so collecting many meetups gives an attacker nothing new.
- **Never centered on the exact point:** if a point happens to sit within 50 m of its cell center, we shift the circle by half a cell. It still covers the point.
- **Coarse label instead of the place name:** "Approximate area — RSVP to see the exact spot".
- **After RSVP,** the app refetches and the `meetup_locations` row is now visible, so the map swaps the circle for a pin. **Withdraw removes access again.**

### Small-town threat analysis (why grid, why 600 m)

| Risk | What happens | Mitigation | Remaining gap (goes in NOTE.md) |
|---|---|---|---|
| **Few public places in a sparse town** | A 400 m circle may contain only one park, so "approximate" effectively names the spot | Larger area (600 m radius / 800 m cell). Grid size is one constant, tunable per region | In a very sparse area, any circle may contain only one candidate. Approximation reduces precision; it can't stop inference |
| **Intersection of random offsets** | Weekly meetups at the same spot, each with its own random offset → overlay the circles and the overlap shrinks to the spot. **v1 had this flaw** | Grid snap is deterministic per place, so every meetup there gets the identical circle | — |
| **Repeated reads** | Re-fetching to average the noise | Area is computed once at create time and stored | — |
| **Pattern of life** | Same time + same area + attendee names = "Avery is at Linden Park every Saturday 8 am" | Attendee list and times are member-only (RLS); outsiders see nothing | Members still learn the routine. That's inherent to a group walk, and stated in NOTE.md |
| **Creator writes the place in the title** | "Saturday loop from North gate" defeats the approximation | Create screen hint: "don't put the meeting spot in the title" | Free text can't be policed. Goes in the pushback |
| **RSVP then withdraw** | Member RSVPs, reads the exact spot, withdraws | Access disappears on withdraw | They have already seen it once. RSVP is not a trust signal (pushback) |

### Sparse areas: is a bigger square chosen automatically?

Not with a fixed grid. The grid is the same everywhere, so it is too small in a sparse town and needlessly coarse in a dense city.

- **Proper fix (k-anonymity):** the area must contain at least *k* plausible public meeting spots (say k = 5). This needs a places dataset (parks, libraries, plazas, e.g. from OpenStreetMap). Use a hierarchical grid (400 m → 800 m → 1.6 km → 3.2 km) and pick the smallest level whose cell holds ≥ k places. It's still deterministic per place, so the overlap attack stays closed.
- **Fail-safe variant without external data:** count distinct meeting points already used (all groups) in each cell. Use the largest level unless the smaller cell holds ≥ k of them. A new or sparse town has no history, so it gets the big area (safe by default), and precision grows only as real public spots accumulate.
- **For this slice:** fixed 800 m cell / 600 m radius as one constant. NOTE.md gives k-anonymity as the next step, and the fail-safe variant too if time allows after the required work.

Members learning routines is accepted as normal for a group walk (not a pushback item).

Alternative: exact location for all members. Simpler, but the spec then requires the place name to be shown, which loses the privacy story.

## 5. Access model (decided: Option D, database-enforced)

**Principle:** the app's token has **no database privileges** on our tables. Every read and write goes through our API, which connects as a least-privilege role that **cannot bypass RLS**. All rules live in RLS policies keyed on `auth.uid()`.

### Roles and grants
- `anon`, `authenticated`: `revoke all` on every slice table (starter tables included). Even with the Data API on, or on a local stack with default privileges, a user token reads and writes nothing.
- `meetup_api`: created in a migration as `nologin nobypassrls`. After deploy, one manual step sets its password (`alter role meetup_api login password '…'`), so no secret ever sits in git. The Edge Function connects **as this role** through the Supabase pooler.
  - select: `users (id, display_name)` (column grant, so home columns stay unreadable), `groups`, `group_memberships`, `meetups`, `meetup_locations`, `rsvps`
  - insert: `meetups`, `meetup_locations`, `rsvps` · update `(status, cancelled_at)` on `meetups` · delete: `rsvps`
- Per request, inside one transaction, the API runs `select set_config('request.jwt.claims', <verified claims>, true)`, so `auth.uid()` is the verified user.
- **Fails closed:** if claims are missing, `auth.uid()` is null and every policy returns or permits nothing. A coding mistake can never become a superuser query, because the connection *is* the restricted role.

### RLS policies (`to meetup_api`). Every rule requires *current* membership

| Table | Read when | Write when |
|---|---|---|
| group_memberships | own rows (= "my groups") | — |
| groups | member | — |
| users | self, or shares a group (attendee names) | — |
| meetups | member of `group_id` (cancelled included) | insert: member and `created_by = auth.uid()` · update (cancel): `using (created_by = auth.uid() and member)` `with check (status = 'cancelled')` |
| meetup_locations | member **and** (creator **or** has RSVP) | insert: caller created the parent meetup |
| rsvps | member of the meetup's group | insert: `user_id = auth.uid()`, member, meetup scheduled, `starts_at > now()` · delete: own row |

Helpers `private.is_group_member(group_id)` and `private.can_see_exact(meetup_id)` are security definer, `search_path = ''`, in a schema that is never exposed and never granted to user roles. They avoid RLS recursion and use the `(select auth.uid())` caching pattern.

Triggers cover what policies can't express:
- block reopening and edits of any column other than status/cancelled_at
- compute the grid-snapped approximate area on insert
- delete a member's RSVPs for a group when their membership is removed

Before an RSVP or a cancel, the API takes `select … for share` / `for update` on the meetup row, so concurrent writes serialize.

### Why D (alternatives rejected)
- **A:** write grants to `authenticated`. The app could skip Zod and write directly.
- **B:** secret key plus functions. The service role bypasses RLS, so creator-only cancel would live in function code, not RLS. The key is god mode, and the DB trusts a passed-in actor id.
- **C:** connect as `postgres`, then `set local role`. RLS for writes, but one forgotten `set role` means a query runs as a superuser-level role. It also depends on the Data API grants for reads.
- **Server-minted JWT:** needs a custom signing key imported into the project. A leak forges any user.
- D keeps C's guarantees and removes its failure mode. Security no longer depends on dashboard settings.

### Costs of D
- About 3 read endpoints (about +1h).
- One manual password step for `meetup_api`.
- An extra hop for reads (phone → Edge Function → DB).
- Verify first: the pooler accepts `meetup_api.<project-ref>` logins. If it doesn't, fall back to C.

**Errors:** visibility is checked first. A missing meetup and a hidden one both return `404 Not found`, so outsiders learn nothing. Only callers who can see the meetup get `403 not creator` or `409 cancelled/started`. An RLS denial is a generic error, so the API pre-reads the meetup to choose the precise status.

## 6. Shared contract (`packages/shared`)

- Inputs: `CreateMeetupInput` (groupId uuid, title trimmed 1..80, startsAt ISO-8601 with offset strictly in the future, placeName trimmed 1..120, lat −90..90, lng −180..180, finite), `MeetupIdParam`, `GroupIdParam`.
- Outputs: `MyGroup`, `MeetupListItem`, `MeetupDetail` (with `attendees` and `location` as a discriminated union `{kind:'exact', placeName, lat, lng} | {kind:'approximate', lat, lng, radiusM, label}`), `ApiError`.
- The API validates every request **and** parses every response through the output schema before sending, so unknown fields (like a home column) can't slip out. The app parses every response with the same schemas.

## 7. API (Hono app in a Supabase Edge Function)

| Method | Path | Rule |
|---|---|---|
| GET | /groups | caller's own groups |
| GET | /groups/:id/meetups | member; soonest first; cancelled included |
| GET | /meetups/:id | member; detail + attendees + location (exact or approximate per RLS) |
| POST | /meetups | member of group; start strictly in future (Zod and RLS/trigger) |
| POST | /meetups/:id/cancel | visible → creator → scheduled; final |
| PUT | /meetups/:id/rsvp | visible → scheduled → not started; idempotent |
| DELETE | /meetups/:id/rsvp | visible; own RSVP; allowed on cancelled and after start; idempotent |

Errors are `{ error: { code, message, issues? } }`: 400 Zod, 401 token, 403 not creator, 404 hidden/missing, 409 cancelled/started.

The app uses supabase-js **only for sign-in** and the session. All data goes through these endpoints.

## 8. Tests (`tests/`, Vitest, against the hosted project)

Setup: before the suite, `supabase db reset --linked` (or a fast fixture reset over the direct Postgres connection that restores seed PART 2). Sign in the personas with the publishable key and run the Hono app in-process, connected as `meetup_api`. Owner-only fixtures (a started meetup, removing a membership) run over the direct `postgres` connection (DB password in `tests/.env`).

| Persona / case | Must prove |
|---|---|
| Taylor (outsider) | 0 meetups, attendees, locations, groups; RSVP/cancel on a real meetup → 404 (same as a random id) |
| Sam (member, no RSVP) | sees meetups + attendees; approximate only (no location row); center ≠ exact, radius ≥ 300 m, exact inside circle; cancel → 403 |
| Jordan (RSVP'd) | exact for Saturday loop; withdraw → exact gone |
| Avery (creator) | exact; cancel works; cancelling again → 409; still listed as cancelled |
| Riley (multi-group) | Maple: exact Saturday, approximate Weeknight; Riverside: approximate sunrise; RSVP grants nothing elsewhere |
| Rules | RSVP to cancelled → 409; to started → 409; withdraw on cancelled → ok; double RSVP → one row; past/now start → 400; withdraw with no RSVP → ok |
| Edge cases (§13) | each row marked *test* in §13 |
| Contract / D | a user token calling the Data API directly reads and writes nothing; raw SQL as `meetup_api` with each persona's claims returns exactly the rows the API returns (proves RLS, not server code, enforces access); no claims → zero rows |
| Home privacy | every response scanned for `home_lat/home_lng` keys and the seeded values; `select home_lat` → permission denied for each persona |

## 9. App (`app/`, Expo Router, Expo Go on phone)

```
app/(auth)/sign-in.tsx          email + password → supabase.auth.signInWithPassword
app/(app)/index.tsx             group picker (my groups) + meetup list, soonest first; loading/empty/error; cancelled badge
app/(app)/meetups/new.tsx       title, date/time picker, place name, tap map to set point; server errors shown
app/(app)/meetups/[id].tsx      title, time, status, attendees, map (Circle or Marker), RSVP / Withdraw, Cancel (creator only)
```
- Session in AsyncStorage. `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (sign-in only) and `EXPO_PUBLIC_API_URL` (the Edge Function URL). Never a secret.
- Refetch on screen focus and after every write, so a stale cache never shows data the user lost access to.
- No home location anywhere. The map's initial region comes from the meetup itself.

## 10. Delivery sequence (one branch → one PR into `dev`)

| # | Branch | Contents | Est. |
|---|---|---|---|
| 0 | `docs/plan` | this plan | — |
| 1 | `feat/db-schema` | supabase init + link, verify `meetup_api` pooler login, starter migration verbatim, schema + roles + RLS + triggers, adapted seed PART 2, advisors clean | 2h |
| 2 | `feat/shared-contract` | pnpm workspace, `packages/shared` Zod schemas | 0.5h |
| 3 | `feat/api` | Hono read + write endpoints, JWT verification, claims per transaction, error mapping, Edge deploy | 1.5h |
| 4 | `test/access` | Vitest suite (§8 + §13) | 1.5h |
| — | `dev` → `main` | **Milestone: Part 1** | |
| 5 | `feat/app-core` | Expo scaffold, Metro workspace config, sign-in, list, create | 1.5h |
| 6 | `feat/app-detail-map` | detail, attendees, map before/after RSVP, cancel | 1h |
| — | `dev` → `main` | **Milestone: Part 2** | |
| 7 | `docs/note-readme` | README (hosted + local paths), NOTE.md | 0.5h |
| — | `dev` → `main` | **Submission** | |

Before each PR: `security-review`, `code-review`, green tests, Conventional Commits.

## 11. What you need to do (I can't run browser logins)

1. Create a free Supabase project. Note the project ref and the DB password. Project options:
   - **Enable Data API: OFF.** Nothing uses it; Auth keeps working. D doesn't rely on it being off: user roles have no grants either way.
   - **Automatically expose new tables: OFF.** We grant per table and per column in migrations. With it ON, `users` would be granted on *all* columns, `home_lat/home_lng` included, so once a `users` select policy exists the home columns become readable.
   - **Enable automatic RLS: ON.** A safety net: any table we forget gets RLS (deny by default). Our migrations also enable RLS explicitly.
2. Run `npx supabase login` once in your terminal (browser flow), then `npx supabase link --project-ref <ref>` from the repo root after `feat/db-schema` adds `supabase/config.toml`.
3. Install **Expo Go** on your phone, matching SDK 58 (the current store version), and put the phone on the same Wi-Fi as the laptop.
4. Phone: **Android**, so maps are Google Maps through `react-native-maps` in Expo Go (no key needed in Expo Go).

### Edge Function vs Node Hono

| | Edge Function (recommended) | Node Hono on laptop |
|---|---|---|
| Phone reaches API | over the internet, nothing to configure | LAN IP + firewall rule; breaks on guest/office Wi-Fi |
| Reviewer clean start | `functions deploy` to their project, no server to run | must keep `pnpm server` running |
| Dev loop | edit → deploy (~seconds, `--use-api`); tests run the same Hono app in-process on Node, so no deploy is needed to test | edit → restart |
| Shared Zod | Deno needs `deno.json` import map (`"zod": "npm:zod@4.6.7"`) plus a relative import of `packages/shared` | plain workspace import |
| Risk | does `--use-api` bundle files outside `supabase/functions/`? Spike it first (15 min); fallback is `_shared` re-export or Node | none notable |

We write the endpoints as a plain Hono app with no runtime-specific code, and config is injected. The same code then runs under Deno (Edge) and Node (tests or fallback), so the choice is reversible at any point.

## 12. Risks

- **Shared hosted DB** means tests and manual testing share state. Mitigation: reset fixtures before the suite; don't demo while tests run.
- **Free tier pauses after about a week idle.** Before the reviewer runs it, they use their own project (README).
- **Phone can't reach the laptop:** firewall rule, or tunnel fallback (§2).
- **Metro + pnpm workspace:** fall back to `watchFolders` + hoisted, then npm workspaces.
- **Clock skew:** the server's and the DB's `now()` are authoritative, never the phone's. Both the Zod and the SQL checks run on the server side.

## 13. Edge cases (membership changes and similar)

Group management is out of scope, but memberships can still change (admin action, account deletion). The DB must stay correct when they do.

| # | Case | Expected behaviour | How enforced | Test |
|---|---|---|---|---|
| E1 | **Member RSVPs, sees the exact spot, then leaves the group** | Loses everything for that group immediately: meetup, attendees, exact spot | Every policy checks *current* membership, including `meetup_locations` (an RSVP row alone isn't enough) | test |
| E2 | Same, then rejoins | Their old RSVP must not silently restore exact access | Trigger on membership delete removes the leaver's RSVPs for that group's meetups | test |
| E3 | **Creator leaves the group** | Can't see or cancel the meetup any more; the meetup stays scheduled for the remaining members | Cancel requires creator **and** current member | test; orphaned-cancel goes in the pushback |
| E4 | Leaver was an attendee | Disappears from the attendee list (RSVP deleted by E2) | E2 trigger | test |
| E5 | User account deleted | Their RSVPs and meetups cascade away. Deleting a creator deletes the meetup; flagged in the pushback | FK `on delete cascade` from the starter | — |
| E6 | RSVP and cancel at the same moment | RSVP either lands before the cancel (stays listed) or fails with 409, never both | `select … for update` on the meetup row in both functions | — |
| E7 | RSVP at the exact start second | Rejected when `starts_at <= now()` | SQL check inside the function | test (owner sets `starts_at = now()`) |
| E8 | Outsider probes a real meetup id | 404, identical to a random uuid; no 409 "started" leak | Visibility checked first | test |
| E9 | Member who can see it tries to cancel | 403 (they can see it anyway, so this leaks nothing) | function | test |
| E10 | Cancel a started meetup | Allowed (assumption in NOTE.md) | — | test |
| E11 | Withdraw after the meetup started | Allowed. Only *new* RSVPs are blocked | — | test |
| E12 | Withdraw with no RSVP / double RSVP | Both no-ops, no error | `on conflict do nothing` / delete of 0 rows | test |
| E13 | Creator RSVPs own meetup | Allowed, shown in attendees. The creator isn't auto-RSVP'd (matches seed) | — | — |
| E14 | Riley RSVPs Riverside walk | Exact for that one only; Maple Weeknight stays approximate | per-row RLS | test |
| E15 | Title of whitespace only / 81 chars / NaN coords / start without timezone | 400 with Zod issues; DB checks back this up | Zod + check constraints | test |
| E16 | Create in a group I'm not in (Riley in a third group id) | 404 | function | test |
| E17 | Expired or garbage JWT | 401 | server verifies via Supabase Auth | test |
| E18 | Stale app cache after losing access | Next refetch returns nothing; detail screen shows "not found" | refetch on focus | manual |

## 14. For NOTE.md — candidates, your call

**Refuse to build first** (pick one):
- "Meetups near you", or any default map position from home location. It's the obvious next feature request and it directly breaks the privacy rule; it needs a consent and coarsening design first.
- Live location sharing (the bonus) before the access and privacy layer is proven by tests.

**Spec pushback** (candidates):
- RSVP is not a trust signal: anyone in the group can RSVP, read the exact spot and withdraw. Real protection is membership.
- Small towns: approximation reduces precision but can't stop inference where there are few public places (§4).
- Free-text titles can leak the exact spot. The rule protects the coordinates and place name but not the creator's own words.
- Silent on withdraw/cancel after start, and on a creator who leaves or is deleted (E3, E5, E10, E11).
