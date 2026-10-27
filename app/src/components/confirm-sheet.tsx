// Bottom-sheet confirmation built on React Native's own Modal: no extra dependency.
import Ionicons from '@expo/vector-icons/Ionicons';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from './button';

type Props = {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

export function ConfirmSheet({ visible, title, message, confirmLabel, cancelLabel = 'Keep it', destructive, onConfirm, onClose }: Props) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { paddingBottom: 20 + insets.bottom }]} accessibilityViewIsModal>
        <View style={styles.grabber} />
        <View style={[styles.icon, destructive && styles.iconDanger]}>
          <Ionicons name={destructive ? 'warning' : 'help-circle'} size={28} color={destructive ? '#b3261e' : '#2f5d8a'} />
        </View>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.message}>{message}</Text>
        <View style={styles.actions}>
          <Button
            tone={destructive ? 'danger' : 'primary'}
            label={confirmLabel}
            onPress={() => {
              onClose();
              onConfirm();
            }}
          />
          <Button tone="plain" label={cancelLabel} onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 24,
    paddingTop: 10,
    alignItems: 'center',
    gap: 10,
    elevation: 12,
  },
  grabber: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#ccc', marginBottom: 8 },
  icon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: '#e8eef5' },
  iconDanger: { backgroundColor: '#fdecea' },
  title: { fontSize: 19, fontWeight: '700', color: '#1d232b', textAlign: 'center' },
  message: { fontSize: 15, color: '#555', textAlign: 'center', lineHeight: 21 },
  actions: { alignSelf: 'stretch', gap: 6, marginTop: 8 },
});
