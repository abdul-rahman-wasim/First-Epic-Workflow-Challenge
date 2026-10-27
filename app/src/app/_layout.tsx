import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ApiRequestError } from '@/lib/api';
import { AuthProvider, useAuth } from '@/lib/auth';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Don't retry what won't change on retry (not found, signed out, bad input).
      retry: (count, e) => !(e instanceof ApiRequestError && e.status >= 400 && e.status < 500) && count < 2,
    },
  },
});

function RootStack() {
  const { session, hydrated } = useAuth();

  // Keep the splash until the stored session is read, so the wrong screen never flashes.
  useEffect(() => {
    if (hydrated) SplashScreen.hideAsync();
  }, [hydrated]);
  if (!hydrated) return null;

  return (
    <Stack>
      <Stack.Protected guard={!session}>
        <Stack.Screen name="sign-in" options={{ title: 'Sign in', headerShown: false }} />
      </Stack.Protected>
      <Stack.Protected guard={!!session}>
        <Stack.Screen name="index" options={{ title: 'Meetups' }} />
        <Stack.Screen name="meetups/new" options={{ title: 'New meetup', presentation: 'modal' }} />
        <Stack.Screen name="meetups/[id]" options={{ title: 'Meetup' }} />
      </Stack.Protected>
    </Stack>
  );
}

// Light theme only (app.json userInterfaceStyle: light): screens use fixed light colours,
// so following a phone's dark mode made text black on black.
export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ThemeProvider value={DefaultTheme}>
          <StatusBar style="dark" />
          <RootStack />
        </ThemeProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
