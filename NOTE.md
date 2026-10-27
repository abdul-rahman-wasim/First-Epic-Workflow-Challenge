# Note — Altair group meetups slice

> Draft. Sections marked *(to fill)* are completed as the build progresses.

## Product decision: approximate area until RSVP

Members who haven't RSVP'd see an **approximate area**. Members who have RSVP'd, and the creator, see the **exact point and place name**.

**Why, grounded in the people using the app.** Walking groups meet on a routine: same park, same weekday, same hour. An exact pin shown to every member tells all of them where specific neighbours (and their dogs) will be, and when. Most of those members aren't coming. The people who do plan to attend need the exact spot; everyone else only needs to answer "is this near enough for me?". RSVP is the moment someone says "I'm coming", so that is when the exact spot is revealed.

**How the area is computed (in the database, at create time):**
- The map is divided into a fixed grid of roughly 800 m × 800 m cells. The approximate area is a 600 m circle around the center of the cell containing the meeting point. 600 m exceeds the cell's half-diagonal (~566 m), so the real point is always inside the circle. 600 m is also comfortably above the 300 m minimum.
- The center is the cell center, a fixed grid position, so it matches the exact point only by coincidence. I first planned to shift the circle when a point sat near its cell center, then dropped that: the shifted position would itself tell an observer "the spot is near this cell's center".
- The place name is withheld until RSVP and replaced by a coarse label.
- The area is stored with the meetup, not recomputed per request.

**Why a grid and not a random offset.** My first design gave each meetup its own random offset. That breaks for recurring meetups: four Saturday walks from the same gate produce four differently shifted circles, and overlaying them shrinks the overlap to the gate itself, so the noise cancels out. A grid is deterministic. Every meetup at the same place gets the identical circle, so collecting more meetups reveals nothing new.

**Enforcement.** The exact point and place name live in a separate table, `meetup_locations`. Its row-level security returns a row only to a current group member who is the creator or has an RSVP. A member without an RSVP gets no row at all: the data never leaves the database, and nothing is hidden in the app. After RSVP, the app refetches and the row becomes visible. Withdrawing, or leaving the group, removes access again.

### Known limit: sparse areas, and the proper fix (k-anonymity)

A fixed grid is the same size everywhere. In a dense city, an 800 m cell contains dozens of parks, plazas and library steps, so the circle says little. In a small town, the same cell may contain only one public place, and then "approximate" effectively names the spot. Approximation reduces precision; on its own it can't stop someone from inferring the spot when there are only a few candidates.

**k-anonymity** is the standard way to make that guarantee explicit: *an answer is safe if it can't be narrowed below k equally plausible candidates.* Here the candidates are the public places a group could meet at. Instead of "the circle is 600 m", the rule becomes "the circle always contains at least k public places" (for example k = 5), whatever the town looks like.

How it would work:
1. **A places dataset**: parks, playgrounds, libraries, plazas, trailheads, e.g. imported from OpenStreetMap into a `public_places` table.
2. **A hierarchical grid**: cell sizes 400 m → 800 m → 1.6 km → 3.2 km. Each size nests inside the next.
3. For a new meetup, pick the **smallest cell level whose cell around the meeting point contains at least k public places**. The circle covers that cell.
4. The result is still deterministic per place, so the overlap attack above stays closed. Cells are large where places are scarce and small where they are plentiful.

Example: North gate, Linden Park, in a town with only two parks nearby. At 800 m the cell holds 2 places, fewer than k = 5. At 1.6 km it holds 4, still fewer. At 3.2 km it holds 6, so that becomes the area. The same rule in a dense downtown might settle at 400 m.

**Without an external dataset**, a fail-safe approximation is to count the distinct meeting points already used, across all groups, in each cell. Default to the largest level, and allow a smaller level only once it holds at least k distinct real meeting spots. A new or sparse town starts with the big area (safe by default), and precision improves only as genuine public spots accumulate.

**Why it isn't in this slice.** It needs either a curated places dataset or enough meeting history to be meaningful, and both are outside the provided files. The slice ships the fixed grid, with the cell size as a single constant, and documents k-anonymity as the next step.

### Other limits of this approach

- **RSVP is not a trust signal.** Any member can RSVP, read the exact spot and withdraw. The approximate area stops casual exposure, not a determined group member. The real boundary is group membership.
- **Free-text titles can leak the spot** ("Loop from North gate"). The create screen warns against it, but the rule protects coordinates and place names, not the creator's own words.
- Members learning each other's routines is accepted as normal for a group walk. Outsiders see none of it.

## Architecture choices

**The app's token has no database privileges.** Supabase Auth issues the user's token. The app uses it for exactly one thing: calling our API, a Hono app running as a Supabase Edge Function. Every read and write passes through that API, and the shared Zod schemas validate every request and every response.

**The API can't bypass row-level security.** It connects to Postgres as `meetup_api`, a role created with `nobypassrls` that holds only the grants this slice needs. For each request it verifies the token and puts the verified claims on the transaction, so `private.uid()` (our reader of the verified `sub` claim) is the real user. All access rules are RLS policies on that role, reads and writes alike: membership, creator-only cancel, no RSVP when cancelled or started, exact location only for attendees. If the claims are ever missing, `private.uid()` is null and every policy returns nothing. A bug fails closed instead of becoming a superuser query.

**Security doesn't depend on dashboard settings.** `anon` and `authenticated` have every privilege revoked on the slice tables. Even with the Data API enabled, or on a local stack with Supabase's default grants, a user token calling PostgREST directly reads and writes nothing. A test proves it.

**Alternatives I considered:**
- Granting writes to `authenticated`: the app could skip Zod.
- The service-role key plus functions: it bypasses RLS, so cancel wouldn't be RLS-enforced, and the key is god mode.
- Connecting as `postgres` and switching role per request: one forgotten `set role` means a superuser query.
- A server-minted JWT: it needs a custom signing key, and a leak forges any user.

Each was rejected for the reason given.

**Cost:** three read endpoints the app could otherwise have skipped, one manual step to set the `meetup_api` password (it never goes in git), and an extra network hop for reads.

## What I directed, what I reviewed or fixed by hand

*(being filled during the build)*

**Database phase: what I caught or changed after the AI's first version**
- **Random offset → grid.** The first proposal gave each meetup a random offset. I questioned how it behaves in small towns. That led to the overlap problem with recurring meetups (circles intersect at the real spot) and to the grid design, plus the k-anonymity section above.
- **Leaving the group.** I asked what happens if a member RSVPs and then leaves the group. The first policy draft allowed "creator **or** RSVP", so a leaver kept the exact spot. Every rule now requires *current* membership, and leaving deletes that member's RSVPs, so rejoining doesn't restore access.
- **Write model.** I rejected the service-role design (B) and then the `set role` design (C). That led to D: the API connects as a role that can't bypass RLS, so a coding mistake fails closed instead of running as superuser.
- **Spike: `auth.uid()` unusable.** Hosted Supabase won't let `postgres` grant our role access to the `auth` schema (the grant silently did nothing). Policies use our own `private.uid()`, which reads the verified claims.
- **Spike: pooler auth cache.** After a role is recreated or its password changes, the first pooler login fails once with `28P01` while Supavisor refreshes. The API retries once.
- **Code review of the migration found and fixed** (follow-up migration `harden_meetups_access`):
  - `private.uid()` threw on pooled connections once a previous request had set claims (the setting reverts to `''`, not NULL). That would have turned "no claims → zero rows" into 500 errors. Verified fixed on a real pooled connection.
  - An RSVP could race a concurrent cancel and commit onto a cancelled meetup. A trigger now locks the meetup and membership rows and re-checks. Verified: the RSVP waited for the cancel, then was rejected.
  - Supabase's default privileges would have exposed *future* public tables to user roles. They're revoked now.
  - Smaller items: the creator check now requires membership; one definer function became invoker; the area math wraps at the antimeridian.
- **API phase: the gateway doesn't guard the function.** With this project's asymmetric (ES256) keys, a call with no token passed the Functions gateway with a 200. Token verification in our code (JWKS: signature, issuer, audience, expiry) is therefore the only gate, so it's enforced on every route. Verified live with no token and a garbage token (401); automated in the access test suite. Turning the gateway check off explicitly (`--no-verify-jwt`) was refused by the agent's own safety check, and we kept the default.
- **Hardening the AI had dismissed.** Its security review rated two items "not exploitable" and dropped them. I asked for both anyway:
  - The API now verifies the pooler's TLS certificate against Supabase's root CA (chain + hostname). Before, it encrypted but trusted any certificate. Verified: the connection works with the CA and is rejected without it.
  - JWTs are restricted to `ES256`/`RS256`.
  - I also enabled SSL enforcement on the database, so non-TLS clients are refused server-side.
- **Test phase: a failing test was the fixture's fault.** The first run had 66/67 green. The "withdraw after start" test inserted an RSVP *as the owner* on a started meetup, and the DB refused it: the RSVP lock trigger applies to the owner too. The fixture now follows the real sequence (RSVP before the start, withdraw after), and a separate test asserts that even the owner can't RSVP to a started meetup.
- **App phase: phone testing drove UX changes.** I tested every screen on my Android phone and asked for:
  - plain-language errors everywhere (no Zod/DB wording, now a project rule)
  - a show/hide password toggle and an animated sign-in error
  - Hosting/Going tags
  - a 3-hour minimum lead time for new meetups (the shared contract and the API, on the DB clock)
  - place suggestions as you type, which fill the name and drop the pin
- **Geocoding choice.** Suggestions come from Photon (OpenStreetMap data), not the phone's geocoder: on Android the phone's geocoder needs the location permission, and this feature should never ask where you are. Only the typed public place name is sent.
- **Geocoding catches.** A first "Find on map" button used Nominatim, but Nominatim's usage policy forbids autocomplete, hence Photon. Also checked by hand: an unbounded search for "Linden Park" jumped to Adelaide, Australia, so results are bounded to ~50 km around the map view.
- **Process slip.** One PR (#8) was merged by the agent, not by me: a create-and-merge command executed even though I interrupted it. The changes were already approved commit by commit, and I reviewed the merged PR afterwards. The agent now only opens PRs.
- **Secrets.** The AI generated the `meetup_api` password itself and used it in commands. I had it rotated by hand and made a rule that the AI never reads `.env` values.

## One thing I'd refuse to build first

*(to fill)*

## Spec pushback

*(to fill: see docs/PLAN.md §14 for candidates)*

- **Joining a group has no path.** Group and membership management is out of scope, so a user in no group (Taylor) can only see an empty state. Found in phone testing. A real launch needs an invite or join-request flow, approved by a group member, before the meetup feature is useful to newcomers. The slice's empty state says "ask a group organiser to add you" instead of leaving a dead end.
