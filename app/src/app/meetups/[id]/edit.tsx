import { useLocalSearchParams } from 'expo-router';
import { EditMeetup } from '@/screens/edit-meetup';

export default function EditMeetupRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <EditMeetup id={id} />;
}
