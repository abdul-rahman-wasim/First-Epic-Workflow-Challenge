import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';

type Props = { label: string; onPress: () => void; busy?: boolean; disabled?: boolean; tone?: 'primary' | 'danger' | 'plain' };

export function Button({ label, onPress, busy = false, disabled = false, tone = 'primary' }: Props) {
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy }}
      onPress={onPress}
      disabled={off}
      style={({ pressed }) => [styles.base, styles[tone], (pressed || off) && styles.dim]}
    >
      {busy ? <ActivityIndicator color={tone === 'plain' ? '#2f5d8a' : '#fff'} /> : (
        <Text style={[styles.label, tone === 'plain' && styles.plainLabel]}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { paddingVertical: 12, paddingHorizontal: 18, borderRadius: 8, alignItems: 'center', minWidth: 120 },
  primary: { backgroundColor: '#2f5d8a' },
  danger: { backgroundColor: '#b3261e' },
  plain: { backgroundColor: 'transparent' },
  dim: { opacity: 0.6 },
  label: { color: '#fff', fontWeight: '600', fontSize: 16 },
  plainLabel: { color: '#2f5d8a' },
});
