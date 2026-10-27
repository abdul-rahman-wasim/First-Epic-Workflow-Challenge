// Edge Function entry: wires the runtime-agnostic Hono app to Deno.
import postgres from 'postgres';
import { createApp } from '../../../server/src/app.ts';
import { createVerifier } from '../../../server/src/auth.ts';
import { SUPABASE_ROOT_CA } from '../../../server/src/supabase-ca.ts';

// Fail at startup with the variable's name, not later with an opaque 500.
function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

const supabaseUrl = env('SUPABASE_URL');
const projectRef = new URL(supabaseUrl).hostname.split('.')[0];

// Connects as meetup_api (nobypassrls) through the transaction pooler; never as postgres.
const sql = postgres({
  host: env('MEETUP_API_DB_HOST'),
  port: 6543,
  database: 'postgres',
  username: `meetup_api.${projectRef}`,
  password: env('MEETUP_API_DB_PASSWORD'),
  ssl: { ca: SUPABASE_ROOT_CA, rejectUnauthorized: true }, // verify chain + hostname
  prepare: false, // required by transaction-mode pooling
  max: 3,
  idle_timeout: 20,
});

const app = createApp({ sql, verifyToken: createVerifier(supabaseUrl) });

Deno.serve(app.fetch);
