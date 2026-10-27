import Ionicons from '@expo/vector-icons/Ionicons';
import { useRef, useState } from 'react';
import { Animated, KeyboardAvoidingView, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from '@/components/button';
import { friendlyError } from '@/lib/messages';
import { supabase } from '@/lib/supabase';

// Seed accounts only (no sign-up in this slice): <firstname>@example.test / altair-fixture-pass
export function SignIn() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fade = useRef(new Animated.Value(0)).current;
  const shake = useRef(new Animated.Value(0)).current;

  const showError = (message: string) => {
    setError(message);
    fade.setValue(0);
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.sequence(
        [8, -8, 6, -6, 0].map((x) => Animated.timing(shake, { toValue: x, duration: 50, useNativeDriver: true })),
      ),
    ]).start();
  };

  const clearError = () => error && setError(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) showError(friendlyError(error)); // on success the auth listener switches the stack
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.screen}>
      <Animated.View style={[styles.form, { transform: [{ translateX: shake }] }]}>
        <Text style={styles.title}>Altair Meetups</Text>
        <TextInput
          style={styles.input}
          placeholder="Email"
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          value={email}
          onChangeText={(v) => (setEmail(v), clearError())}
        />
        <View style={styles.passwordRow}>
          <TextInput
            style={[styles.input, styles.passwordInput]}
            placeholder="Password"
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoComplete="password"
            value={password}
            onChangeText={(v) => (setPassword(v), clearError())}
            onSubmitEditing={submit}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
            onPress={() => setShowPassword((s) => !s)}
            hitSlop={10}
            style={styles.eye}
          >
            <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={22} color="#555" />
          </Pressable>
        </View>
        {error && (
          <Animated.View style={[styles.banner, { opacity: fade }]} accessibilityLiveRegion="polite">
            <Ionicons name="alert-circle" size={18} color="#b3261e" />
            <Text style={styles.bannerText}>{error}</Text>
          </Animated.View>
        )}
        <Button label="Sign in" onPress={submit} busy={busy} disabled={!email || !password} />
      </Animated.View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', padding: 24 },
  form: { gap: 12 },
  title: { fontSize: 26, fontWeight: '700', marginBottom: 12, textAlign: 'center' },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, fontSize: 16, backgroundColor: '#fff' },
  passwordRow: { justifyContent: 'center' },
  passwordInput: { paddingRight: 44 },
  eye: { position: 'absolute', right: 12 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 8, backgroundColor: '#fdecea' },
  bannerText: { color: '#b3261e', flexShrink: 1 },
});
