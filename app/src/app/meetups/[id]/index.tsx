import { useLocalSearchParams } from 'expo-router';
import { MeetupDetail } from '@/screens/meetup-detail';

export default function MeetupRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <MeetupDetail id={id} />;
}
