// Public config only (inlined at build time). Never put a secret in an EXPO_PUBLIC_ variable.
function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing ${name}: copy app/.env.example to app/.env and fill it in`);
  return value;
}

export const SUPABASE_URL = required('EXPO_PUBLIC_SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL);
export const SUPABASE_PUBLISHABLE_KEY = required(
  'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
);
export const API_URL = `${SUPABASE_URL}/functions/v1/api`;
