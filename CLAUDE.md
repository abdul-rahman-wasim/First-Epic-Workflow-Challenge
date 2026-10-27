# CLAUDE.md — Altair Group Meetups (First Epic Workflow Challenge)

Hiring challenge for a Senior Full-Stack Engineer seat. Build a slice of a dog-owner community app:
**group meetups** on Supabase (Postgres) + a write endpoint layer + a minimal React Native (Expo) app with a map.
Deadline: 72h from receipt. Target effort: 6–8h of AI-piloted work.

Source of truth, in priority order:
1. `altair-feature-spec.html` — the spec. Build to it.
2. `First Epic Workflow Challenge - Senior Full-Stack Engineer (Altair).pdf` — the brief, deliverables, judging.
3. `altair-schema-starter.zip` — required starting schema + README (setup paths).
4. `altair-seed-data.sql` — seed accounts/groups; PART 2 (meetups/RSVPs) is commented out and must be adapted.

If the spec is ambiguous: state the assumption in the note (`NOTE.md`) and proceed. Do not silently invent behavior.

## Non-negotiable rules (these are what is graded)

### Access control — enforced in the database
- RLS on every table. Starter tables (`users`, `groups`, `group_memberships`) have RLS on with **no policies** — add only what the slice needs.
- Anonymous access: denied everywhere. Policies target `authenticated` only.
- Outsider (not in the meetup's group) reads **nothing**: no meetup, no attendees, no map data, no hints in error messages.
- Group member: reads group's meetups (soonest first) and attendee display names.
- Only the creator cancels. Cancel is final (no reopen). Cancelled meetups stay visible, marked cancelled.
- No new RSVP when meetup is cancelled **or** has started. Withdraw is still allowed on a cancelled meetup.
- One RSVP per member per meetup; RSVP twice = idempotent, not a user-visible error.
- Users RSVP / withdraw only for themselves. `created_by` comes from the session, never from the request body.
- Multi-group: a member sees each meetup per their own status in **that** meetup. An RSVP grants nothing for any other meetup.
- Never hide data in the app as an access mechanism. If the client receives it, it is leaked.
- Use `security definer` functions/views only when needed, with `set search_path = ''` and explicit membership checks inside. Prefer `security_invoker` views.

### Home location privacy
- `users.home_lat` / `users.home_lng` must **never** appear in any response, view, function, attendee list, map payload, or error. Never on the map.
- Never `select *` from `users`. Expose display names only through a narrow column set (column grants or a view that omits home columns).
- Build nothing derived from home location (no distance-from-home, no default map center from home).
- Tests must assert home columns are absent/unreadable for every persona.

### Meeting point visibility (open product decision — see NOTE.md)
- Decision is enforced on the server or in the DB, never in the app.
- If approximate area for non-RSVP members: computed server/DB side, radius ≥ 300 m, center **not** the exact point (grid snap or stored per-meetup offset), and **both exact coords and place name withheld** until RSVP (coarse label allowed).
- After RSVP, the member's view updates to exact without sign-out/reinstall.
- Raw meeting-point columns must not be directly selectable by non-attendee members (column privileges / view / RPC — not just client filtering).

### One shared contract (Zod)
- All request/response shapes (create, cancel, list group meetups, my groups, RSVP, withdraw, edit if bonus) live as Zod schemas in **one shared package** imported by both server and app.
- One Zod major version across the repo.
- **Every write** (create, cancel, RSVP, withdraw, edit) goes through server-side code that validates with those schemas. App never writes to tables or calls write RPCs directly. Postgres functions are fine *behind* the endpoint.
- Server rejects invalid input with a clear error, including `starts_at` not strictly in the future on create.
- Validation limits from spec: title 1–80 chars after trim; place name 1–120 chars; lat −90..90, lng −180..180; `starts_at` timestamptz.
- Endpoint calls Supabase **with the caller's JWT** (so RLS still applies). Service role key only in tests/setup, never in the app, never committed.

### Reads
- Reads (my groups, group meetups, detail, attendees, map data) may go direct to Supabase under RLS with the user session, or via endpoints. Visibility rules hold either way.
- Sign-in: Supabase Auth directly from the app (email/password, seed accounts). No sign-up flow.

## Tests (required)
Automated tests proving access for four personas — outsider, member not RSVP'd, member RSVP'd, creator:
- creator-only cancel; no RSVP to cancelled meetup; no RSVP to started meetup (set up as DB owner);
- withdraw works (incl. on cancelled meetup); duplicate RSVP idempotent;
- outsider gets nothing (meetup, attendees, map data);
- multi-group case (Riley Chen: both groups, RSVP'd only to "Saturday morning loop") incl. what map data returns per meetup;
- home location never present in any response;
- past/now `starts_at` rejected by the server.
Tests run against a real Supabase (local), signing in as seed users. Reset DB to a known state before the suite.

## Seed cast (password for all: `altair-fixture-pass`, email `<firstname>@example.test`)
| Persona | Groups | Role |
|---|---|---|
| Avery Lin | Maple | creator "Saturday morning loop" |
| Jordan Price | Maple | RSVP'd Saturday loop; creator "Weeknight short walk" |
| Sam Okafor | Maple | member, no RSVP |
| Riley Chen | Maple + Riverside | RSVP'd Saturday loop only |
| Morgan Ellis | Riverside | creator "Riverside sunrise walk" |
| Casey Moreno | Riverside | RSVP'd Riverside sunrise |
| Quinn Adler | Riverside | member, no RSVP |
| Taylor Brooks | none | outsider |

Keep seed UUIDs exactly as given (`a1…` users, `b2…` groups, `c3…` meetups).

## Repo layout (target)
```
supabase/
  config.toml
  migrations/20261001000000_starter.sql   # starter, verbatim
  migrations/<ts>_meetups_rsvps.sql       # our migrations, timestamped, never edit after commit — add new ones
  seed.sql                                # seed PART 1 + adapted PART 2
packages/shared/                          # Zod schemas + inferred types (the contract)
server/                                   # write endpoints (TS) — imports packages/shared
app/                                      # Expo RN app — imports packages/shared (Metro watchFolders)
tests/                                    # access tests
NOTE.md                                   # reasoning note
README.md                                 # run instructions from clean checkout
```
Endpoint layer choice (Node TS server vs Supabase Edge Function on Deno) to be confirmed; default is a small Node TS server because it shares the Zod module with the app without import-map work.

## App (Expo React Native, one platform)
- Screens: sign-in, group meetup list (loading/empty/error), create meetup (server errors shown), meetup detail (title, time, status, attendees, map, RSVP, creator-only cancel). Withdraw UI optional.
- Group selection: simple picker fed by "my groups" query.
- Map: `react-native-maps` default provider (Expo Go, no keys). Render exactly what the server returns: point or approximate circle. Loading/empty/error states.
- Android emulator reaches local API via `10.0.2.2`; device via LAN IP.
- Plain functional UI. No polish work.

## Out of scope — do not build
Sign-up/account flows, web client, group/membership management, notifications, chat, comments, recurring meetups, invitations, live location (bonus only), profile/home editing.

Bonus (only after required work is done and green): (a) creator-only edit endpoint + RLS + test + screen, re-check future start, no edit when cancelled; (b) Mapbox + Realtime avatars slice.

## Working rules for Claude
- Required scope first. No bonus until Parts 1–3 are done.
- Commit history is graded. Follow the Git workflow below.
- Never commit secrets (`.env`, service role key, map tokens). Provide `.env.example`.
- Every migration is additive and timestamped; `supabase db reset` from clean must work.
- When proposing SQL/RLS, state which persona can do what and how a test proves it.
- Report failures and dead ends honestly — they are part of the log and are graded. Don't paper over a failing test.
- The user explains this build on a recording: keep code readable, avoid clever abstractions, comment the *why* on security-relevant SQL.
- Product decisions (meeting-point visibility, approximation method/radius, refuse-first item, pushback) are the user's call — propose with reasoning, don't decide silently.

## Git workflow
- Branches: `main` (submission-ready) ← `dev` (integration) ← `feat/<name>` (one per feature).
- Start every new feature on a fresh branch cut from latest `dev`: `git switch dev && git switch -c feat/<name>`.
- Finished feature: PR `feat/<name>` → `dev`. Then cut the next feature branch from updated `dev`. Never work directly on `dev` or `main`.
- `dev` → `main` when a milestone is stable (e.g. end of Part 1, Part 2, submission).
- Conventional Commits: `feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`, `build:`, `ci:` with optional scope, e.g. `feat(db): add meetups and rsvps tables with RLS`.
- Keep commits condensed: one logical change per commit, no WIP/noise commits, short imperative subject (≤72 chars), body only when the why isn't obvious.
- Challenge docs (`*.pdf`, `altair-feature-spec.html`, `altair-schema-starter.zip`, `altair-seed-data.sql`) stay local only — gitignored, never committed. Derived files we adapt (starter migration, `supabase/seed.sql`) are committed.

## Deliverables checklist
- [ ] Git repo with history (.git included)
- [ ] Migrations (meetups, rsvps, RLS, helper functions/views) + env setup
- [ ] Write endpoints (create, cancel, RSVP, withdraw) validated with shared Zod
- [ ] Access tests (4 personas, cancel, cancelled RSVP, started RSVP, multi-group, map data, home privacy)
- [ ] RN screens + map following visibility decision, updates after RSVP
- [ ] NOTE.md: what was directed vs reviewed/fixed by hand, product decision + why, refuse-first item, spec pushback
- [ ] README run instructions (DB, seed, endpoints, app, tests from clean)
- [ ] Screen recording 10–15 min (user does this)
- [ ] Exported AI session log (user exports from Claude Code)

## Local environment notes
Node 24, npm 11, pnpm 11, git, Docker 20.10 present. **Supabase CLI and Deno not installed** (use `npx supabase` or install). Windows 10, Git Bash + PowerShell.
