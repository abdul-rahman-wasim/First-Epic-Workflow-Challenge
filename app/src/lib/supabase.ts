// supabase-js is used for Auth only (sign-in, session refresh). All data goes through our API.
import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './env';
import { secureStorage } from './secure-storage';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { storage: secureStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
});

// Refresh tokens only while the app is in the foreground.
AppState.addEventListener('change', (state) => {
  if (state === 'active') supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});
