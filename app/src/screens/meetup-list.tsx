import type { MeetupListItem, MyGroup } from '@altair/shared';
import { useQueryClient } from '@tanstack/react-query';
import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/button';
import { EmptyState, ErrorState, Loading } from '@/components/state-view';
import { useAuth } from '@/lib/auth';
import { formatWhen } from '@/lib/format';
import { friendlyError } from '@/lib/messages';
import Ionicons from '@expo/vector-icons/Ionicons';
import { keys, useGroupMeetups, useMyGroups } from '@/lib/queries';

export function MeetupList() {
  const { signOut } = useAuth();
  const groups = useMyGroups();
  const qc = useQueryClient();
  const [picked, setPicked] = useState<string | null>(null);
  const list = groups.data?.groups ?? [];
  // A picked group the user has since left falls back to their first group.
  const groupId = list.some((g) => g.id === picked) ? picked! : list[0]?.id;
  const meetups = useGroupMeetups(groupId);

  // Access can change while away (e.g. removed from a group): refresh on return, not on first mount.
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      void qc.invalidateQueries({ queryKey: keys.groups });
    }, [qc]),
  );

  const header = <Stack.Screen options={{ headerRight: () => <Button tone="plain" label="Sign out" onPress={signOut} /> }} />;

  if (groups.data === undefined) {
    return (
      <>
        {header}
        {groups.error ? <ErrorState message={friendlyError(groups.error)} onRetry={() => groups.refetch()} /> : <Loading />}
      </>
    );
  }
  if (groups.data.groups.length === 0) {
    return (
      <>
        {header}
        <EmptyState
          title="You’re not in a walking group yet"
          message="Meetups belong to groups. Ask a group organiser to add you."
          action={<Button tone="plain" label="Check again" onPress={() => groups.refetch()} busy={groups.isFetching} />}
        />
      </>
    );
  }

  return (
    <View style={styles.screen}>
      {header}
      <GroupPicker groups={groups.data.groups} selected={groupId} onSelect={setPicked} />
      <View style={styles.body}>
        <Meetups query={meetups} />
      </View>
      <View style={styles.footer}>
        <Button label="New meetup" onPress={() => router.push({ pathname: '/meetups/new', params: { groupId } })} />
      </View>
    </View>
  );
}

function GroupPicker({ groups, selected, onSelect }: { groups: MyGroup[]; selected?: string; onSelect: (id: string) => void }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      {groups.map((g) => (
        <Pressable
          key={g.id}
          accessibilityRole="tab"
          accessibilityState={{ selected: g.id === selected }}
          onPress={() => onSelect(g.id)}
          style={[styles.chip, g.id === selected && styles.chipOn]}
        >
          <Text style={[styles.chipText, g.id === selected && styles.chipTextOn]}>{g.name}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function Meetups({ query }: { query: ReturnType<typeof useGroupMeetups> }) {
  if (query.data === undefined) {
    return query.error ? <ErrorState message={friendlyError(query.error)} onRetry={() => query.refetch()} /> : <Loading />;
  }
  return (
    <FlatList
      data={query.data.meetups}
      keyExtractor={(m) => m.id}
      renderItem={({ item }) => <MeetupRow meetup={item} />}
      refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} />}
      ListHeaderComponent={query.error ? <Text style={styles.inlineError}>Couldn't refresh. Showing saved data.</Text> : undefined}
      ListEmptyComponent={<EmptyState title="No meetups yet" message="Nobody has planned a walk in this group. Create the first one." />}
      contentContainerStyle={query.data.meetups.length === 0 && styles.grow}
    />
  );
}

function MeetupRow({ meetup }: { meetup: MeetupListItem }) {
  const cancelled = meetup.status === 'cancelled';
  return (
    <View style={styles.row}>
      <View style={styles.rowTop}>
        <Text style={[styles.rowTitle, cancelled && styles.struck]} numberOfLines={1}>
          {meetup.title}
        </Text>
        {cancelled && <Text style={styles.badge}>Cancelled</Text>}
      </View>
      <Text style={styles.muted}>{formatWhen(meetup.startsAt)}</Text>
      <View style={styles.tags}>
        <Text style={styles.muted}>{meetup.attendeeCount} going</Text>
        {meetup.isCreator && <Tag icon="star" label="Hosting" color="#8a5a00" bg="#fff3d6" />}
        {meetup.hasRsvp && <Tag icon="checkmark-circle" label="Going" color="#1e6b3a" bg="#e3f4e8" />}
      </View>
    </View>
  );
}

function Tag({ icon, label, color, bg }: { icon: 'star' | 'checkmark-circle'; label: string; color: string; bg: string }) {
  return (
    <View style={[styles.tag, { backgroundColor: bg }]} accessibilityLabel={label === 'Hosting' ? 'You are hosting' : 'You are going'}>
      <Ionicons name={icon} size={13} color={color} />
      <Text style={[styles.tagText, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { flex: 1 },
  grow: { flexGrow: 1 },
  chips: { padding: 12, gap: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, borderColor: '#2f5d8a' },
  chipOn: { backgroundColor: '#2f5d8a' },
  chipText: { color: '#2f5d8a', fontWeight: '600' },
  chipTextOn: { color: '#fff' },
  row: { paddingVertical: 14, paddingHorizontal: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: '#ccc', gap: 2 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowTitle: { fontSize: 17, fontWeight: '600', flexShrink: 1 },
  struck: { textDecorationLine: 'line-through', color: '#888' },
  badge: { color: '#b3261e', fontWeight: '700', fontSize: 12, textTransform: 'uppercase' },
  muted: { color: '#666' },
  tags: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 2, paddingHorizontal: 8, borderRadius: 10 },
  tagText: { fontSize: 12, fontWeight: '700' },
  inlineError: { color: '#b3261e', padding: 12 },
  footer: { padding: 16 },
});
