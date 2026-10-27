import { describe, expect, it } from 'vitest';
import { CreateMeetupInput, MeetupDetail, UpdateMeetupInput } from './index';

const valid = {
  groupId: 'b2000000-0000-4000-8000-000000000001',
  title: '  Evening loop  ',
  startsAt: new Date(Date.now() + 24 * 3_600_000).toISOString(),
  placeName: 'Fountain plaza, Town Green',
  lat: 39.999134,
  lng: -99.999461,
};

describe('CreateMeetupInput', () => {
  it('accepts a valid meetup and trims text', () => {
    const r = CreateMeetupInput.parse(valid);
    expect(r.title).toBe('Evening loop');
  });

  it.each([
    ['past start', { startsAt: new Date(Date.now() - 60_000).toISOString() }],
    ['start inside the 3-hour lead time', { startsAt: new Date(Date.now() + 2 * 3_600_000).toISOString() }],
    ['start without timezone', { startsAt: '2030-01-01T10:00:00' }],
    ['whitespace-only title', { title: '   ' }],
    ['81-char title', { title: 'x'.repeat(81) }],
    ['121-char place name', { placeName: 'x'.repeat(121) }],
    ['lat out of range', { lat: 90.1 }],
    ['NaN lng', { lng: Number.NaN }],
    ['non-uuid group', { groupId: 'maple' }],
    ['client-supplied creator', { createdBy: 'a1000000-0000-4000-8000-000000000001' }],
  ])('rejects %s', (_, patch) => {
    expect(CreateMeetupInput.safeParse({ ...valid, ...patch }).success).toBe(false);
  });

  it('a malformed start gets one clear message, not "must be in the future" too', () => {
    const r = CreateMeetupInput.safeParse({ ...valid, startsAt: 'tomorrow' });
    expect(r.error!.issues.map((i) => i.message)).toEqual(['Pick a start date and time']);
  });

  it('explains every problem in plain words', () => {
    const r = CreateMeetupInput.safeParse({ groupId: valid.groupId, title: ' ', startsAt: valid.startsAt, placeName: '' });
    const byField = Object.fromEntries(r.error!.issues.map((i) => [String(i.path[0]), i.message]));
    expect(byField).toEqual({
      title: 'Add a title',
      placeName: 'Name the meeting point',
      lat: 'Tap the map to place the meeting point',
      lng: 'Tap the map to place the meeting point',
    });
  });
});

describe('UpdateMeetupInput', () => {
  it('accepts a partial change', () => {
    expect(UpdateMeetupInput.parse({ title: ' New name ' })).toEqual({ title: 'New name' });
  });

  it.each([
    ['an empty change', {}],
    ['a start inside the lead time', { startsAt: new Date(Date.now() + 3_600_000).toISOString() }],
    ['half a coordinate', { lat: 40 }],
    ['a status change', { status: 'scheduled' }],
    ['a group change', { groupId: 'b2000000-0000-4000-8000-000000000002' }],
  ])('rejects %s', (_, body) => {
    expect(UpdateMeetupInput.safeParse(body).success).toBe(false);
  });
});

describe('MeetupDetail', () => {
  const detail = {
    id: 'c3000000-0000-4000-8000-000000000001',
    groupId: 'b2000000-0000-4000-8000-000000000001',
    groupName: 'Maple Street Walkers',
    title: 'Saturday morning loop',
    startsAt: '2030-01-01T08:00:00.000Z',
    status: 'scheduled',
    cancelledAt: null,
    isCreator: false,
    hasRsvp: false,
    attendeeCount: 0,
    attendees: [],
    location: { kind: 'approximate', lat: 40.01, lng: -99.98, radiusM: 600, label: 'Approximate area' },
  };

  it('accepts an approximate view', () => {
    expect(MeetupDetail.safeParse(detail).success).toBe(true);
  });

  it('rejects a place name smuggled into the approximate view', () => {
    const leak = { ...detail, location: { ...detail.location, placeName: 'North gate' } };
    expect(MeetupDetail.safeParse(leak).success).toBe(false);
  });

  it('rejects a home location on an attendee', () => {
    const leak = { ...detail, attendees: [{ userId: detail.id, displayName: 'Sam', homeLat: 40 }] };
    expect(MeetupDetail.safeParse(leak).success).toBe(false);
  });
});
