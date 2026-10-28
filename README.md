# Altair group meetups

A slice of a dog-owner community app: **group meetups** with RSVPs and a map. It has three parts:
- a Supabase (Postgres) database, where row-level security enforces every access rule;
- a Hono API on a Supabase Edge Function, validated with shared Zod schemas;
- an Expo React Native app (Android, Expo Go).

The reasoning, product decision and pushback are in **[NOTE.md](NOTE.md)**; the build plan is in [docs/PLAN.md](docs/PLAN.md).

- **Screen recording:** [walkthrough with voice-over](https://docs.google.com/videos/d/1ylDJkxl9KjrcYTI-Gs-Qcse1QiSZRfd0a7XRooirnb8/play?usp=sharing)
- **AI session log:** [Google Drive folder](https://drive.google.com/drive/folders/1Tm75tn4lJqZtWgGFXE_LuiEsRS2mNRRh), the Claude Code session transcript as stored by the tool (JSONL), plus its subagent transcripts. It's kept out of the repo because it contains the challenge brief and spec.

## How it fits together

```
Expo app ──sign-in──▶ Supabase Auth
   │  (user JWT)
   ▼
Edge Function "api" (Hono)  ── verifies JWT (JWKS), validates with @altair/shared (Zod)
   │  connects as meetup_api (nobypassrls), sets the verified claims per transaction
   ▼
Postgres + RLS  ── every rule is a policy keyed on private.uid(); user roles hold no table privileges
```

| Path | What |
|---|---|
| `supabase/migrations/` | starter schema (verbatim), meetups/RSVPs + RLS, hardening, edit (bonus) |
| `supabase/seed.sql` | provided seed, with PART 2 adapted to this schema |
| `packages/shared/` | the Zod contract, imported by the API, the tests and the app |
| `server/` | the Hono app (runtime-agnostic): routes, JWT verification, queries |
| `supabase/functions/api/` | Edge Function entry that serves the Hono app |
| `tests/` | access tests against the hosted project (Vitest) |
| `app/` | Expo SDK 58 app |

## Run it from a clean start (~30 minutes)

You need: **Node 22+**, **pnpm 11** (`corepack enable`), a free **Supabase** account, and an **Android phone** with **Expo Go** (SDK 58). Docker isn't needed: everything runs against a hosted Supabase project through the Supabase CLI.

### 1. Install

```bash
git clone <this repo> && cd <repo>
pnpm install
```

### 2. Create the Supabase project

Create a free project. In its settings:
- **Automatically expose new tables: off.** The migrations revoke user access anyway.
- **Enable automatic RLS: on.**
- **Data API:** on or off; both are safe.
- *(Optional hardening)* Authentication → disable **"Allow new users to sign up"** (the app uses seed accounts only), and enable **SSL enforcement** under Database settings.

Note these from the dashboard:
- the **project ref** (the subdomain of the project URL);
- the **database password**;
- the **publishable key** (Project Settings → API Keys);
- the **shared pooler host** (Connect → Transaction pooler), e.g. `aws-0-ap-south-1.pooler.supabase.com`.

### 3. Database: migrations and seed

```bash
npx supabase@2.122.0 login
npx supabase@2.122.0 link --project-ref <project-ref>
npx supabase@2.122.0 db push --include-seed --yes
```

This applies the four migrations and loads the seed: the 8 accounts, 2 groups, 3 reference meetups and their RSVPs.

### 4. Give the API role a password (one manual step, never stored in git)

The migrations create the role `meetup_api` without a login. Generate a password in your terminal:

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

In the dashboard **SQL editor**, run:

```sql
alter role meetup_api with login password '<generated password>';
```

### 5. Deploy the API

```bash
npx supabase@2.122.0 secrets set MEETUP_API_DB_PASSWORD=<generated password> MEETUP_API_DB_HOST=<pooler host>
npx supabase@2.122.0 functions deploy api --use-api
```

`--use-api` bundles on Supabase's side, so Docker isn't needed. The API's URL is `https://<project-ref>.supabase.co/functions/v1/api`.

### 6. Run the tests

Copy `.env.example` to `.env` and fill in all five values:

| Key | Value |
|---|---|
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | the publishable key |
| `MEETUP_API_DB_PASSWORD` | the password from step 4 |
| `MEETUP_API_DB_HOST` | the pooler host |
| `SUPABASE_DB_PASSWORD` | the database owner password (test fixtures only) |

```bash
pnpm typecheck      # shared, server, tests
pnpm test:unit      # contract + CA certificate, ~1 s
pnpm test:access    # 95 access tests against the hosted project, ~3 min
```

> ⚠️ `test:access` **resets the meetup data to the seed state before every test** (as the database owner). Run it only against a project made for this slice, and not while you're using the app.

The access suite runs the real Hono app in-process with real persona tokens, and covers:
- **Personas:** the outsider, a member without an RSVP, an attendee and the creator.
- **Multi-group:** Riley's view, including the map data.
- **Rules:** creator-only cancel; no RSVP to a cancelled or started meetup; withdraw; the 3-hour lead time.
- **Database:** RLS checked with raw SQL as `meetup_api` for every persona; a user token sent straight to the Data API reaches nothing; home location appears in no response.
- **Edge cases:** leaving and rejoining a group, a creator who leaves.
- **Edit (bonus):** creator-only editing.

### 7. Run the app on your phone

```bash
cd app
cp .env.example .env    # EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY (public values)
npx expo start --lan
```

Open **Expo Go** on a phone on the same Wi-Fi and scan the QR code, or enter `exp://<laptop-ip>:8081`.
- If the phone can't connect, allow Node.js through the firewall on private networks, or use `npx expo start --tunnel`.
- The first bundle on a cold cache can take several minutes.

Sign in with a seed account. Every password is `altair-fixture-pass`:

| Account | Groups | Role in the reference meetups |
|---|---|---|
| `avery@example.test` | Maple | creator of "Saturday morning loop" |
| `jordan@example.test` | Maple | RSVP'd to Saturday; creator of "Weeknight short walk" |
| `sam@example.test` | Maple | member, no RSVP |
| `riley@example.test` | Maple + Riverside | RSVP'd to Saturday only |
| `morgan@example.test` | Riverside | creator of "Riverside sunrise walk" |
| `casey@example.test` | Riverside | RSVP'd to Riverside |
| `quinn@example.test` | Riverside | member, no RSVP |
| `taylor@example.test` | none | outsider: sees nothing |

**To see the map before and after an RSVP:** sign in as Sam → **Weeknight short walk** shows an approximate circle → **I'm going** → it becomes the exact pin, "Front steps, Elm Avenue Library".

### Reset to the seed state

```bash
npx supabase@2.122.0 db reset --linked --yes
```

The `meetup_api` role and its password survive a reset.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| First API call after setting the password fails, then works | Supavisor caches role credentials; the first login after a change fails once (`28P01`). The API retries automatically. |
| Every API call returns 500 | A function secret is missing: the function logs `Missing required env var …`. Re-run step 5. |
| Tests fail with `Missing env for tests` | `.env` is missing a key from `.env.example`. |
| Phone can't reach Metro | Same Wi-Fi, firewall rule for Node.js, or `--tunnel`. |

## Notes

- **Hosted only.** Running the API against a local `supabase start` stack isn't supported: the function derives the pooler user from the project URL and verifies the hosted pooler's TLS certificate.
- **Secrets stay out of git:** `.env` files are gitignored, the `meetup_api` password is set by hand, and private keys are blocked by `.gitignore`. `server/certs/supabase-ca.crt` is Supabase's *public* root CA.
- **Supabase advisors** report one warning, leaked-password protection, which requires the Pro plan.
