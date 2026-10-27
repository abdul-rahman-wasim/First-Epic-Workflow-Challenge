import { CreateMeetupInput } from '@altair/shared';
import { router } from 'expo-router';
import { useCreateMeetup } from '@/lib/queries';
import { MeetupForm } from './meetup-form';

export function CreateMeetup({ groupId }: { groupId: string }) {
  const create = useCreateMeetup();
  return (
    <MeetupForm
      submitLabel="Create meetup"
      pending={create.isPending}
      onSubmit={(v, report) => {
        const draft = { groupId, title: v.title, startsAt: v.startsAt.toISOString(), placeName: v.placeName, lat: v.point?.lat, lng: v.point?.lng };
        // Same schema the server uses: instant feedback; the server still re-validates.
        const local = CreateMeetupInput.safeParse(draft);
        if (!local.success) return report.zod(local.error);
        create.mutate(local.data, { onSuccess: () => router.back(), onError: report.fail });
      }}
    />
  );
}
