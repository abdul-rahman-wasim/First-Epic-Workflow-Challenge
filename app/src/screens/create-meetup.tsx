import { CreateMeetupInput } from '@altair/shared';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import MapView, { Marker, type MapPressEvent } from 'react-native-maps';
import { Button } from '@/components/button';
import { ApiRequestError } from '@/lib/api';
import { formatWhen } from '@/lib/format';
import { friendlyError } from '@/lib/messages';
import { useCreateMeetup } from '@/lib/queries';

// Fixed starting view over the (fictional) town. Never derived from anyone's home location.
const TOWN = { latitude: 40.0, longitude: -100.0, latitudeDelta: 0.05, longitudeDelta: 0.05 };

type Point = { lat: number; lng: number };

export function CreateMeetup({ groupId }: { groupId: string }) {
  const create = useCreateMeetup();
  const [title, setTitle] = useState('');
  const [placeName, setPlaceName] = useState('');
  const [startsAt, setStartsAt] = useState(() => new Date(Date.now() + 24 * 3_600_000));
  const [point, setPoint] = useState<Point | null>(null);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  // Editing a field clears its error right away instead of waiting for the next submit.
  const clear = (...fields: string[]) =>
    setIssues((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => !fields.includes(k))));
  const edit = <T,>(set: (v: T) => void, ...fields: string[]) => (v: T) => {
    set(v);
    clear(...fields);
  };

  const pickWhen = () => {
    if (Platform.OS !== 'android') return;
    // Android: date first, then time.
    DateTimePickerAndroid.open({
      value: startsAt,
      mode: 'date',
      minimumDate: new Date(),
      onChange: (e, date) => {
        if (e.type !== 'set' || !date) return;
        DateTimePickerAndroid.open({
          value: date,
          mode: 'time',
          onChange: (e2, time) => e2.type === 'set' && time && edit(setStartsAt, 'startsAt')(time),
        });
      },
    });
  };

  const submit = () => {
    setFormError(null);
    const draft = { groupId, title, startsAt: startsAt.toISOString(), placeName, lat: point?.lat, lng: point?.lng };
    // Same schema the server uses: instant feedback; the server still re-validates.
    const local = CreateMeetupInput.safeParse(draft);
    if (!local.success) {
      setIssues(Object.fromEntries(local.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setIssues({});
    create.mutate(local.data, {
      onSuccess: () => router.back(),
      // Keep the draft; show what the server said.
      onError: (e) => {
        if (e instanceof ApiRequestError && e.issues.length) {
          setIssues(Object.fromEntries(e.issues.map((i) => [i.path, i.message])));
        } else setFormError(friendlyError(e));
      },
    });
  };

  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <Field label="Title" error={issues.title}>
        <TextInput style={styles.input} value={title} onChangeText={edit(setTitle, 'title')} maxLength={80} placeholder="Saturday morning loop" />
      </Field>

      <Field label="Starts" error={issues.startsAt}>
        {Platform.OS === 'android' ? (
          <Button tone="plain" label={formatWhen(startsAt.toISOString())} onPress={pickWhen} />
        ) : (
          <DateTimePicker value={startsAt} mode="datetime" minimumDate={new Date()} onChange={(_, d) => d && edit(setStartsAt, 'startsAt')(d)} />
        )}
      </Field>

      <Field label="Meeting point name" error={issues.placeName}>
        <TextInput style={styles.input} value={placeName} onChangeText={edit(setPlaceName, 'placeName')} maxLength={120} placeholder="North gate, Linden Park" />
        <Text style={styles.hint}>Use a public place. Don’t put the spot in the title: members who haven’t RSVP’d only see an approximate area.</Text>
      </Field>

      <Field label="Meeting point on the map" error={issues.lat ?? issues.lng}>
        <MapView
          style={styles.map}
          initialRegion={TOWN}
          onPress={(e: MapPressEvent) =>
            edit(setPoint, 'lat', 'lng')({ lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude })
          }
        >
          {point && <Marker coordinate={{ latitude: point.lat, longitude: point.lng }} />}
        </MapView>
        <Text style={styles.hint}>{point ? `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}` : 'Tap the map to place the meeting point.'}</Text>
      </Field>

      {(formError || issues.groupId) && <Text style={styles.error}>{formError ?? issues.groupId}</Text>}
      <Button label="Create meetup" onPress={submit} busy={create.isPending} />
    </ScrollView>
  );
}

function Field({ label, error, children }: { label: string; error?: string | undefined; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
      {error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 16, gap: 18 },
  field: { gap: 6 },
  label: { fontWeight: '600', fontSize: 15 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, fontSize: 16, backgroundColor: '#fff' },
  map: { height: 260, borderRadius: 8 },
  hint: { color: '#666', fontSize: 13 },
  error: { color: '#b3261e' },
});
