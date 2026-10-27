// Loads .env at runtime (values are never logged) and fails fast naming any missing key.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const file = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(file)) process.loadEnvFile(file); // never overrides values already in the environment

const REQUIRED = [
  'SUPABASE_URL', // e.g. https://<ref>.supabase.co (public)
  'SUPABASE_PUBLISHABLE_KEY', // public, used only to sign the personas in
  'MEETUP_API_DB_HOST',
  'MEETUP_API_DB_PASSWORD',
  'SUPABASE_DB_PASSWORD', // DB owner: test fixtures only (allowed by the brief)
] as const;

const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) throw new Error(`Missing env for tests: ${missing.join(', ')} (see .env.example)`);

export const env = Object.fromEntries(REQUIRED.map((k) => [k, process.env[k]!])) as Record<
  (typeof REQUIRED)[number],
  string
>;
export const projectRef = new URL(env.SUPABASE_URL).hostname.split('.')[0]!;
