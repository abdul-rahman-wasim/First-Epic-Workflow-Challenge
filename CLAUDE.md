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
- The API also parses every response through the shared output schema before sending, so no unlisted field (for example a home column) can leave.

### Access model D (decided, see docs/PLAN.md §5)
- **All reads and writes go through the API** (Hono app in a Supabase Edge Function). The app uses supabase-js **only for Auth** (sign-in and session), never `.from()` or `.rpc()`.
- `anon` and `authenticated` get `revoke all` on every slice table, starter tables included. A user token can't touch the data even if the Data API is on.
- The API connects to Postgres **as `meetup_api`** (`nobypassrls`, minimal grants), never as `postgres` or with the service role. Per request it verifies the JWT, then runs `set_config('request.jwt.claims', <verified claims>, true)` inside one transaction. Every DB call goes through one helper that does this.
- All rules are RLS policies `to meetup_api` keyed on `(select private.uid())` (reads `request.jwt.claims ->> 'sub'`; `meetup_api` has no `auth` schema access). Missing claims must give zero rows (fail closed), and a test covers it.
- `meetup_api` password: never in a migration or in git. It's set once by hand and stored as an Edge Function secret or in a local `.env`.
- Service role / secret key: tests and setup only, if at all. Never in the app or the API.
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
API layer: a runtime-agnostic Hono app in `server/`, with config injected, served by `supabase/functions/api/index.ts` (Deno, deployed with `--use-api`) and run in-process on Node for tests. Deno resolves `zod` and `postgres` through the function's `deno.json` import map, pinned to the same versions as the workspace.

## App (Expo React Native, one platform)
- Screens: sign-in, group meetup list (loading/empty/error), create meetup (server errors shown), meetup detail (title, time, status, attendees, map, RSVP, creator-only cancel). Withdraw UI optional.
- Group selection: simple picker fed by "my groups" query.
- Map: `react-native-maps` default provider (Expo Go, no keys). Render exactly what the server returns: point or approximate circle. Loading/empty/error states.
- Target: the user's **Android phone with Expo Go** (no emulator). The API and Auth are hosted, so the phone needs only internet; Metro runs over LAN or `--tunnel`.
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
- Remote: `origin` = https://github.com/abdul-rahman-wasim/First-Epic-Workflow-Challenge (public). Open PRs with `gh pr create --base dev`.
- `gh` acts as `abdul-rahman-wasim` in this project only: `.claude/settings.local.json` sets `GH_CONFIG_DIR` to a separate gh config whose active account is the repo owner (tokens stay in the OS keyring). Global gh account stays `Team1-Sportech` — never `gh auth switch`. If `gh auth status` shows the wrong account, fall back to prefixing `GH_TOKEN=$(gh auth token --user abdul-rahman-wasim)`.
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

## Skills to use
- DB / RLS / migrations / tests of policies: `supabase-postgres-best-practices` (project, `.claude/skills/`) — load before any SQL.
- Supabase CLI, Auth, supabase-js, Edge Functions, RLS debugging: `supabase` (project).
- Expo app (project, `.claude/skills/`): `expo-overview` first, then `expo-project-structure`, `expo-router`, `expo-data-fetching`, `expo-examples` (Supabase / maps samples).
- Running the app/server to verify a change: `run`.
- Before each PR: `security-review` (RLS, endpoints, home-location leaks) and `code-review`.
- Commits: `caveman:caveman-commit` (Conventional Commits).
- That is the full allowed set. Everything else is switched off for this project in `.claude/settings.local.json` (`skillOverrides`, `enabledPlugins`, `syncClaudeAiSkills: false`). Don't re-enable without the user asking.
- `skillOverrides` does not apply to plugin skills (Claude Code returns "on" for `source === "plugin"`). To keep only part of a plugin: disable the plugin per project and vendor the needed skills. That's why the Expo plugin is off and 5 of its skills are copied from `expo@claude-plugins-official` v1.13.9 (MIT, LICENSE in each folder). The caveman plugin stays on whole because its hooks drive the reply style; its extra skills can't be pruned individually.
- Supabase skills are pinned in `skills-lock.json` (restore with `npx skills experimental_install`). The Expo skills are vendored and not in the lock file.

## Local environment notes
Node 24, npm 11, pnpm 11, git. Windows 10, Git Bash + PowerShell. RAM is limited, so **don't use Docker**: the DB is a hosted Supabase project, driven with `npx supabase@2.122.0` (link, `db push --include-seed`, `db reset --linked`, `functions deploy --use-api`). Deno isn't installed or needed. Tests run against the hosted project.
