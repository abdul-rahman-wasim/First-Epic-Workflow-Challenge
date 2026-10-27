import { CreateMeetupInput, MIN_LEAD_HOURS, MIN_LEAD_MS } from '@altair/shared';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import MapView, { Marker, type MapPressEvent } from 'react-native-maps';
import { Button } from '@/components/button';
import { ApiRequestError } from '@/lib/api';
import { formatWhen } from '@/lib/format';
import { suggestPlaces, type Region, type Suggestion } from '@/lib/geocode';
import { friendlyError } from '@/lib/messages';
import { useCreateMeetup } from '@/lib/queries';

// Fixed starting view over the (fictional) town. Never derived from anyone's home location.
const TOWN = { latitude: 40.0, longitude: -100.0, latitudeDelta: 0.05, longitudeDelta: 0.05 };

type Point = { lat: number; lng: number };
const FIELDS = ['title', 'startsAt', 'placeName', 'lat', 'lng'];

export function CreateMeetup({ groupId }: { groupId: string }) {
  const create = useCreateMeetup();
  const [title, setTitle] = useState('');
  const [placeName, setPlaceName] = useState('');
  const [startsAt, setStartsAt] = useState(() => new Date(Date.now() + 24 * 3_600_000));
  const [point, setPoint] = useState<Point | null>(null);
  const map = useRef<MapView>(null);
  const region = useRef<Region>(TOWN);
  const earliest = () => new Date(Date.now() + MIN_LEAD_MS);

  // Suggestions as you type (3+ chars, 400 ms pause, stale requests cancelled).
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [searchNote, setSearchNote] = useState<string | null>(null);
  const picked = useRef<string | null>(null); // don't re-suggest for the name just chosen
  useEffect(() => {
    const q = placeName.trim();
    if (q.length < 3 || q === picked.current) {
      setSuggestions([]);
      setSearchNote(null);
      return;
    }
    const abort = new AbortController();
    const t = setTimeout(async () => {
      try {
        const list = await suggestPlaces(q, region.current, abort.signal);
        setSuggestions(list);
        setSearchNote(list.length ? null : 'No matching places nearby. Tap the map to place the pin.');
      } catch {
        if (!abort.signal.aborted) setSearchNote('Place suggestions aren’t available right now. Tap the map to place the pin.');
      }
    }, 400);
    return () => {
      clearTimeout(t);
      abort.abort();
    };
  }, [placeName]);

  // Choosing a suggestion fills the name, moves the map and drops the pin (still adjustable by tapping).
  const choose = (s: Suggestion) => {
    picked.current = s.name;
    edit(setPlaceName, 'placeName')(s.name);
    edit(setPoint, 'lat', 'lng')({ lat: s.lat, lng: s.lng });
    map.current?.animateToRegion({ latitude: s.lat, longitude: s.lng, latitudeDelta: 0.01, longitudeDelta: 0.01 });
    setSuggestions([]);
  };
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
      minimumDate: earliest(),
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
      showIssues(local.error.issues.map((i) => ({ path: String(i.path[0] ?? ''), message: i.message })));
      return;
    }
    setIssues({});
    create.mutate(local.data, {
      onSuccess: () => router.back(),
      // Keep the draft; show what the server said.
      onError: (e) => {
        if (e instanceof ApiRequestError && e.issues.length) showIssues(e.issues);
        else setFormError(friendlyError(e));
      },
    });
  };

  // First message per field wins; anything not tied to a field goes in the form banner.
  const showIssues = (list: { path: string; message: string }[]) => {
    const byField: Record<string, string> = {};
    const other: string[] = [];
    for (const i of list) {
      const field = i.path.split('.')[0]!;
      if (FIELDS.includes(field)) byField[field] ??= i.message;
      else other.push(i.message);
    }
    setIssues(byField);
    setFormError(other.length ? other.join('\n') : null);
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
          <DateTimePicker value={startsAt} mode="datetime" minimumDate={earliest()} onChange={(_, d) => d && edit(setStartsAt, 'startsAt')(d)} />
        )}
        <Text style={styles.hint}>At least {MIN_LEAD_HOURS} hours from now, so members have time to see it.</Text>
      </Field>

      <Field label="Meeting point name" error={issues.placeName}>
        <TextInput style={styles.input} value={placeName} onChangeText={edit(setPlaceName, 'placeName')} maxLength={120} placeholder="North gate, Linden Park" />
        {suggestions.length > 0 && (
          <View style={styles.suggestions} accessibilityRole="list">
            {suggestions.map((s) => (
              <Pressable
                key={`${s.lat},${s.lng},${s.name}`}
                accessibilityRole="button"
                onPress={() => choose(s)}
                style={({ pressed }) => [styles.suggestion, pressed && styles.pressed]}
              >
                <Text style={styles.suggestionName}>{s.name}</Text>
                {!!s.detail && <Text style={styles.hint}>{s.detail}</Text>}
              </Pressable>
            ))}
          </View>
        )}
        {searchNote && <Text style={styles.hint}>{searchNote}</Text>}
        <Text style={styles.hint}>Use a public place. Don’t put the spot in the title: members who haven’t RSVP’d only see an approximate area.</Text>
      </Field>

      <Field label="Meeting point on the map" error={issues.lat ?? issues.lng}>
        <MapView
          ref={map}
          style={styles.map}
          initialRegion={TOWN}
          onRegionChangeComplete={(r) => (region.current = r)}
          onPress={(e: MapPressEvent) =>
            edit(setPoint, 'lat', 'lng')({ lat: e.nativeEvent.coordinate.latitude, lng: e.nativeEvent.coordinate.longitude })
          }
        >
          {point && <Marker coordinate={{ latitude: point.lat, longitude: point.lng }} />}
        </MapView>
        <Text style={styles.hint}>{point ? `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}` : 'Tap the map to place the meeting point.'}</Text>
      </Field>

      {formError && <Text style={styles.error}>{formError}</Text>}
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
  suggestions: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, backgroundColor: '#fff', overflow: 'hidden' },
  suggestion: { paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#ddd' },
  suggestionName: { fontSize: 15, fontWeight: '600' },
  pressed: { backgroundColor: '#eef3f8' },
});
