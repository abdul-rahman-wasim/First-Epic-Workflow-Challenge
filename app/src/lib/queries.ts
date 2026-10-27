import {
  GroupMeetupsResponse,
  MeetupResponse,
  MyGroupsResponse,
  type CreateMeetupInput,
  type UpdateMeetupInput,
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

export const useMeetup = (id: string) =>
  useQuery({ queryKey: keys.meetup(id), queryFn: () => api('GET', `/meetups/${id}`, MeetupResponse) });

// RSVP, withdraw and cancel answer with the caller's updated view (e.g. exact point after RSVP),
// so the detail updates straight from the response; the group list is refreshed behind it.
function useMeetupWrite(method: 'PUT' | 'DELETE' | 'POST', path: (id: string) => string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(method, path(id), MeetupResponse),
    onSuccess: (body) => {
      qc.setQueryData(keys.meetup(body.meetup.id), body);
      return qc.invalidateQueries({ queryKey: keys.groupMeetups(body.meetup.groupId) });
    },
  });
}

export function useUpdateMeetup(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (changes: UpdateMeetupInput) => api('PATCH', `/meetups/${id}`, MeetupResponse, changes),
    onSuccess: (body) => {
      qc.setQueryData(keys.meetup(id), body);
      return qc.invalidateQueries({ queryKey: keys.groupMeetups(body.meetup.groupId) });
    },
  });
}

export const useRsvp = () => useMeetupWrite('PUT', (id) => `/meetups/${id}/rsvp`);
export const useWithdraw = () => useMeetupWrite('DELETE', (id) => `/meetups/${id}/rsvp`);
export const useCancelMeetup = () => useMeetupWrite('POST', (id) => `/meetups/${id}/cancel`);

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
