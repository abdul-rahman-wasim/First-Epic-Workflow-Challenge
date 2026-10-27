import { useLocalSearchParams } from 'expo-router';
import { CreateMeetup } from '@/screens/create-meetup';

export default function NewMeetupRoute() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  return <CreateMeetup groupId={groupId} />;
}
