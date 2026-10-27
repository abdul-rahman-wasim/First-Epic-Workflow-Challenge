// One place that turns any error into plain words for people. Never show raw DB/HTTP text.
import { AuthError } from '@supabase/supabase-js';
import { ApiRequestError } from './api';

const BY_CODE: Record<string, string> = {
  network: 'Can’t reach the server. Check your connection and try again.',
  unauthorized: 'Your session has ended. Please sign in again.',
  forbidden: 'Only the person who created this meetup can do that.',
  not_found: 'This meetup isn’t available. It may have been removed, or you’re no longer in its group.',
  conflict: 'This meetup just changed. Refresh and try again.',
  invalid_input: 'Some details need fixing. Check the highlighted fields.',
  internal: 'Something went wrong on our side. Please try again.',
};

const AUTH: Record<string, string> = {
  invalid_credentials: 'That email and password don’t match. Check them and try again.',
  over_request_rate_limit: 'Too many attempts. Wait a minute, then try again.',
  email_not_confirmed: 'This account isn’t activated yet.',
  user_banned: 'This account can’t sign in.',
};

export function friendlyError(e: unknown): string {
  if (e instanceof ApiRequestError) {
    // The API's own conflict and forbidden messages are written for people; keep them.
    if ((e.code === 'conflict' || e.code === 'forbidden') && e.message) return e.message;
    return BY_CODE[e.code] ?? BY_CODE.internal!;
  }
  if (e instanceof AuthError) {
    if (e.name === 'AuthRetryableFetchError') return BY_CODE.network!;
    return (e.code && AUTH[e.code]) || 'Sign-in didn’t work. Please try again.';
  }
  return BY_CODE.internal!;
}
