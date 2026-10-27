import { UpdateMeetupInput, type MeetupDetail } from '@altair/shared';
import { router } from 'expo-router';
import { EmptyState, ErrorState, Loading } from '@/components/state-view';
import { friendlyError } from '@/lib/messages';
import { useMeetup, useUpdateMeetup } from '@/lib/queries';
import { MeetupForm, type FormValues } from './meetup-form';

export function EditMeetup({ id }: { id: string }) {
  const query = useMeetup(id);
  if (query.data === undefined) {
    return query.error ? <ErrorState message={friendlyError(query.error)} onRetry={() => query.refetch()} /> : <Loading />;
  }
  const { meetup } = query.data;
  // UI hint only: the API and RLS refuse edits by anyone else, and on cancelled or started meetups.
  if (!meetup.isCreator || meetup.status !== 'scheduled' || meetup.location.kind !== 'exact') {
    return <EmptyState title="This meetup can’t be edited" message="Only the person hosting a scheduled meetup can edit it." />;
  }
  return <Form meetup={meetup} />;
}

function Form({ meetup }: { meetup: MeetupDetail }) {
  const update = useUpdateMeetup(meetup.id);
  const loc = meetup.location;
  const initial: FormValues = {
    title: meetup.title,
    startsAt: new Date(meetup.startsAt),
    placeName: loc.kind === 'exact' ? loc.placeName : '',
    point: { lat: loc.lat, lng: loc.lng },
  };

  return (
    <MeetupForm
      initial={initial}
      submitLabel="Save changes"
      pending={update.isPending}
      onSubmit={(v, report) => {
        // Send only what changed: an unchanged start isn't re-checked against the lead time.
        const changes = {
          ...(v.title.trim() !== initial.title && { title: v.title }),
          ...(v.startsAt.getTime() !== initial.startsAt.getTime() && { startsAt: v.startsAt.toISOString() }),
          ...(v.placeName.trim() !== initial.placeName && { placeName: v.placeName }),
          ...(v.point && (v.point.lat !== initial.point!.lat || v.point.lng !== initial.point!.lng) && { lat: v.point.lat, lng: v.point.lng }),
        };
        if (Object.keys(changes).length === 0) return report.message('Nothing has changed yet.');
        const local = UpdateMeetupInput.safeParse(changes);
        if (!local.success) return report.zod(local.error);
        update.mutate(local.data, { onSuccess: () => router.back(), onError: report.fail });
      }}
    />
  );
}
