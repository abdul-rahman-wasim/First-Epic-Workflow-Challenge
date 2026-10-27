// Typed client for our Edge Function API. Every response is parsed with the shared Zod contract.
import { ApiError, type ErrorCode } from '@altair/shared';
import type { z } from 'zod';
import { API_URL, SUPABASE_PUBLISHABLE_KEY } from './env';
import { supabase } from './supabase';

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'network',
    message: string,
    readonly issues: { path: string; message: string }[] = [],
  ) {
    super(message);
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

export async function api<S extends z.ZodType>(method: Method, path: string, schema: S, body?: unknown): Promise<z.infer<S>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiRequestError(401, 'unauthorized', 'Sign in required');

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${token}`,
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  } catch {
    throw new ApiRequestError(0, 'network', 'Could not reach the server. Check your connection.');
  }

  const json: unknown = await res.json().catch(() => null);
  // The server no longer accepts this session: clear it so the app returns to sign-in.
  if (res.status === 401) await supabase.auth.signOut({ scope: 'local' });
  if (!res.ok) {
    const err = ApiError.safeParse(json);
    if (err.success) throw new ApiRequestError(res.status, err.data.error.code, err.data.error.message, err.data.error.issues);
    throw new ApiRequestError(res.status, 'internal', `Request failed (${res.status})`);
  }
  return schema.parse(json);
}
