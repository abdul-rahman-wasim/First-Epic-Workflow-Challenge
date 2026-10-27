import {
  GroupMeetupsResponse,
  MeetupResponse,
  MyGroupsResponse,
  type CreateMeetupInput,
} from '@altair/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';

export const keys = {
  groups: ['groups'] as const,
  groupMeetups: (groupId: string) => ['groups', groupId, 'meetups'] as const,
  meetup: (id: string) => ['meetups', id] as const,
};

export const useMyGroups = () =>
  useQuery({ queryKey: keys.groups, queryFn: () => api('GET', '/groups', MyGroupsResponse) });

export const useGroupMeetups = (groupId: string | undefined) =>
  useQuery({
    queryKey: keys.groupMeetups(groupId ?? ''),
    queryFn: () => api('GET', `/groups/${groupId}/meetups`, GroupMeetupsResponse),
    enabled: !!groupId,
  });

export function useCreateMeetup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateMeetupInput) => api('POST', '/meetups', MeetupResponse, input),
    onSuccess: ({ meetup }) => {
      qc.setQueryData(keys.meetup(meetup.id), { meetup });
      return qc.invalidateQueries({ queryKey: keys.groupMeetups(meetup.groupId) });
    },
  });
}
