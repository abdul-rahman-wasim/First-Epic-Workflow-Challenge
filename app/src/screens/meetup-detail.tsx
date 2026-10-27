import type { MeetupDetail as Meetup } from '@altair/shared';
import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/button';
import { ConfirmSheet } from '@/components/confirm-sheet';
import { MeetupMap } from '@/components/meetup-map';
import { ErrorState, Loading } from '@/components/state-view';
import { formatWhen } from '@/lib/format';
import { friendlyError } from '@/lib/messages';
import { useCancelMeetup, useMeetup, useRsvp, useWithdraw } from '@/lib/queries';

export function MeetupDetail({ id }: { id: string }) {
  const query = useMeetup(id);

  if (query.data === undefined) {
    return query.error ? (
      <ErrorState message={friendlyError(query.error)} onRetry={() => query.refetch()} />
    ) : (
      <Loading />
    );
  }

  const { meetup } = query.data;
  return (
    <ScrollView
      contentContainerStyle={styles.screen}
      refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} />}
    >
      <Stack.Screen options={{ title: meetup.title }} />
      {query.error && <Text style={styles.error}>Couldn’t refresh. Showing saved details.</Text>}
      <Header meetup={meetup} />
      <Location meetup={meetup} />
      <Attendees meetup={meetup} />
      <Actions meetup={meetup} />
    </ScrollView>
  );
}

function Header({ meetup }: { meetup: Meetup }) {
  return (
    <View style={styles.section}>
      {meetup.status === 'cancelled' && (
        <View style={styles.cancelled}>
          <Ionicons name="close-circle" size={18} color="#b3261e" />
          <Text style={styles.cancelledText}>This meetup was cancelled</Text>
        </View>
      )}
      <Text style={styles.title}>{meetup.title}</Text>
      <Text style={styles.muted}>
        {formatWhen(meetup.startsAt)} · {meetup.groupName}
      </Text>
      {meetup.isCreator && <Text style={styles.muted}>You’re hosting this meetup.</Text>}
    </View>
  );
}

function Location({ meetup }: { meetup: Meetup }) {
  const loc = meetup.location;
  return (
    <View style={styles.section}>
      <Text style={styles.heading}>Where</Text>
      <MeetupMap location={loc} />
      {loc.kind === 'exact' ? (
        <Text style={styles.place}>{loc.placeName}</Text>
      ) : (
        <Text style={styles.muted}>{loc.label}</Text>
      )}
    </View>
  );
}

function Attendees({ meetup }: { meetup: Meetup }) {
  return (
    <View style={styles.section}>
      <Text style={styles.heading}>Going ({meetup.attendeeCount})</Text>
      {meetup.attendees.length === 0 ? (
        <Text style={styles.muted}>No one has RSVP’d yet.</Text>
      ) : (
        meetup.attendees.map((a) => (
          <Text key={a.userId} style={styles.attendee}>
            {a.displayName}
          </Text>
        ))
      )}
    </View>
  );
}

function Actions({ meetup }: { meetup: Meetup }) {
  const rsvp = useRsvp();
  const withdraw = useWithdraw();
  const cancel = useCancelMeetup();
  const busy = rsvp.isPending || withdraw.isPending || cancel.isPending;
  const error = rsvp.error ?? withdraw.error ?? cancel.error;

  const [confirming, setConfirming] = useState(false);

  // UI hints only: the server decides and enforces every one of these rules.
  const scheduled = meetup.status === 'scheduled';
  const started = Date.parse(meetup.startsAt) <= Date.now();
  // Hosting implies going, so the host isn't offered an RSVP.
  const canRsvp = scheduled && !started && !meetup.hasRsvp && !meetup.isCreator;

  return (
    <View style={styles.section}>
      {error && <Text style={styles.error}>{friendlyError(error)}</Text>}
      {canRsvp && <Button label="I’m going" onPress={() => rsvp.mutate(meetup.id)} busy={rsvp.isPending} disabled={busy} />}
      {meetup.hasRsvp && (
        <>
          <Text style={styles.going}>You’re going.</Text>
          <Button tone="plain" label="Withdraw my RSVP" onPress={() => withdraw.mutate(meetup.id)} busy={withdraw.isPending} disabled={busy} />
        </>
      )}
      {/* The cancelled banner already explains cancelled meetups; only "started" needs a note. */}
      {scheduled && started && !meetup.hasRsvp && !meetup.isCreator && (
        <Text style={styles.muted}>This meetup has started, so it isn’t taking RSVPs.</Text>
      )}
      {meetup.isCreator && scheduled && !started && (
        <Button
          label="Edit meetup"
          onPress={() => router.push({ pathname: '/meetups/[id]/edit', params: { id: meetup.id } })}
          disabled={busy}
        />
      )}
      {meetup.isCreator && scheduled && (
        <Button tone="danger" label="Cancel meetup" onPress={() => setConfirming(true)} busy={cancel.isPending} disabled={busy} />
      )}
      <Button tone="plain" label="Back to meetups" onPress={() => router.back()} />
      <ConfirmSheet
        visible={confirming}
        destructive
        title="Cancel this meetup?"
        message="Everyone in the group will see it as cancelled, and it won’t take new RSVPs. This can’t be undone."
        confirmLabel="Cancel meetup"
        onConfirm={() => cancel.mutate(meetup.id)}
        onClose={() => setConfirming(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 16, gap: 22 },
  section: { gap: 8 },
  title: { fontSize: 22, fontWeight: '700' },
  heading: { fontSize: 16, fontWeight: '700' },
  muted: { color: '#666' },
  place: { fontSize: 15, fontWeight: '600' },
  attendee: { fontSize: 15 },
  going: { color: '#1e6b3a', fontWeight: '700' },
  error: { color: '#b3261e' },
  cancelled: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10, borderRadius: 8, backgroundColor: '#fdecea' },
  cancelledText: { color: '#b3261e', fontWeight: '700' },
});
