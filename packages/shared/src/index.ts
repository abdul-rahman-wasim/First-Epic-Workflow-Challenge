// Shared contract: imported by the API (Edge Function), the tests and the app.
// Single file, no relative imports, so Deno, Node and Metro resolve it the same way.
import { z } from 'zod';

// ---------- primitives ----------

export const Latitude = z.number().min(-90).max(90);
export const Longitude = z.number().min(-180).max(180);
// ISO-8601 with an explicit offset ('Z' or ±hh:mm); a local time without zone is rejected.
export const IsoDateTime = z.iso.datetime({ offset: true });
export const MeetupStatus = z.enum(['scheduled', 'cancelled']);

// ---------- requests ----------

export const GroupIdParam = z.strictObject({ groupId: z.uuid() });
export type GroupIdParam = z.infer<typeof GroupIdParam>;

export const MeetupIdParam = z.strictObject({ meetupId: z.uuid() });
export type MeetupIdParam = z.infer<typeof MeetupIdParam>;

// Strict: unknown keys (e.g. createdBy, status) are rejected, not ignored.
// The future-start rule uses the clock of whoever parses: authoritative on the server.
export const CreateMeetupInput = z.strictObject({
  groupId: z.uuid(),
  title: z.string().trim().min(1).max(80),
  startsAt: IsoDateTime.refine((v) => Date.parse(v) > Date.now(), {
    message: 'Start time must be in the future',
  }),
  placeName: z.string().trim().min(1).max(120),
  lat: Latitude,
  lng: Longitude,
});
export type CreateMeetupInput = z.infer<typeof CreateMeetupInput>;

// ---------- responses ----------
// Strict on purpose: the API parses every response before sending, so any field
// not listed here (a home location, an exact point) fails instead of leaking.

export const MyGroup = z.strictObject({ id: z.uuid(), name: z.string() });
export type MyGroup = z.infer<typeof MyGroup>;

export const MyGroupsResponse = z.strictObject({ groups: z.array(MyGroup) });
export type MyGroupsResponse = z.infer<typeof MyGroupsResponse>;

export const MeetupListItem = z.strictObject({
  id: z.uuid(),
  groupId: z.uuid(),
  title: z.string(),
  startsAt: IsoDateTime,
  status: MeetupStatus,
  cancelledAt: IsoDateTime.nullable(),
  isCreator: z.boolean(),
  hasRsvp: z.boolean(),
  attendeeCount: z.int().min(0),
});
export type MeetupListItem = z.infer<typeof MeetupListItem>;

export const GroupMeetupsResponse = z.strictObject({ meetups: z.array(MeetupListItem) });
export type GroupMeetupsResponse = z.infer<typeof GroupMeetupsResponse>;

// Creator and attendees get the exact point; other members get the approximate area.
export const ExactLocation = z.strictObject({
  kind: z.literal('exact'),
  placeName: z.string(),
  lat: Latitude,
  lng: Longitude,
});

export const ApproximateLocation = z.strictObject({
  kind: z.literal('approximate'),
  lat: Latitude,
  lng: Longitude,
  radiusM: z.int().min(300),
  label: z.string(),
});

export const MeetupLocation = z.discriminatedUnion('kind', [ExactLocation, ApproximateLocation]);
export type MeetupLocation = z.infer<typeof MeetupLocation>;

export const Attendee = z.strictObject({ userId: z.uuid(), displayName: z.string() });
export type Attendee = z.infer<typeof Attendee>;

export const MeetupDetail = z.strictObject({
  ...MeetupListItem.shape,
  groupName: z.string(),
  attendees: z.array(Attendee),
  location: MeetupLocation,
});
export type MeetupDetail = z.infer<typeof MeetupDetail>;

// Every write (create, cancel, RSVP, withdraw) answers with the caller's updated view.
export const MeetupResponse = z.strictObject({ meetup: MeetupDetail });
export type MeetupResponse = z.infer<typeof MeetupResponse>;

// ---------- errors ----------

export const ErrorCode = z.enum([
  'invalid_input', // 400
  'unauthorized', // 401
  'forbidden', // 403: can see the meetup, but the action isn't theirs (e.g. cancel)
  'not_found', // 404: missing OR not visible; never reveals which
  'conflict', // 409: cancelled, already started
  'internal', // 500
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ApiError = z.strictObject({
  error: z.strictObject({
    code: ErrorCode,
    message: z.string(),
    issues: z.array(z.strictObject({ path: z.string(), message: z.string() })).optional(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;
