// Shared contract: imported by the API (Edge Function), the tests and the app.
// Single file, no relative imports, so Deno, Node and Metro resolve it the same way.
import { z } from 'zod';

// ---------- primitives ----------

// Messages are user-facing: the app and the API show the same wording.
const pinMissing = { error: (i: { input: unknown }) => (i.input === undefined ? 'Tap the map to place the meeting point' : 'Invalid meeting point') };
const badPoint = { error: 'Invalid meeting point' };

export const Latitude = z.number(pinMissing).min(-90, badPoint).max(90, badPoint);
export const Longitude = z.number(pinMissing).min(-180, badPoint).max(180, badPoint);
// ISO-8601 with an explicit offset ('Z' or ±hh:mm); a local time without zone is rejected.
export const IsoDateTime = z.iso.datetime({ offset: true, error: 'Pick a start date and time' });
export const MeetupStatus = z.enum(['scheduled', 'cancelled']);

// Product rule: a meetup must be announced this far ahead. The API re-checks it on the DB clock.
export const MIN_LEAD_HOURS = 3;
export const MIN_LEAD_MS = MIN_LEAD_HOURS * 3_600_000;
export const MIN_LEAD_MESSAGE = `Start at least ${MIN_LEAD_HOURS} hours from now, so members have time to see it`;

// ---------- requests ----------

export const GroupIdParam = z.strictObject({ groupId: z.uuid() });
export type GroupIdParam = z.infer<typeof GroupIdParam>;

export const MeetupIdParam = z.strictObject({ meetupId: z.uuid() });
export type MeetupIdParam = z.infer<typeof MeetupIdParam>;

// Field rules shared by create and edit.
const Title = z
  .string({ error: 'Add a title' })
  .trim()
  .min(1, { error: 'Add a title' })
  .max(80, { error: 'Keep the title to 80 characters or fewer' });
// The lead-time rule uses the clock of whoever parses: authoritative on the server.
// An unparseable value already has a format issue; don't add a lead-time message too.
const StartsAt = IsoDateTime.refine((v) => Number.isNaN(Date.parse(v)) || Date.parse(v) > Date.now() + MIN_LEAD_MS, {
  error: MIN_LEAD_MESSAGE,
});
const PlaceName = z
  .string({ error: 'Name the meeting point' })
  .trim()
  .min(1, { error: 'Name the meeting point' })
  .max(120, { error: 'Keep the place name to 120 characters or fewer' });

// Strict: unknown keys (e.g. createdBy, status) are rejected, not ignored.
export const CreateMeetupInput = z.strictObject({
  groupId: z.uuid({ error: 'Pick a group' }),
  title: Title,
  startsAt: StartsAt,
  placeName: PlaceName,
  lat: Latitude,
  lng: Longitude,
});
export type CreateMeetupInput = z.infer<typeof CreateMeetupInput>;

// Bonus edit: send only what changed. Group, creator and status can't be edited (strict).
export const UpdateMeetupInput = z
  .strictObject({
    title: Title.optional(),
    startsAt: StartsAt.optional(),
    placeName: PlaceName.optional(),
    lat: Latitude.optional(),
    lng: Longitude.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { error: 'Change at least one detail' })
  .refine((v) => (v.lat === undefined) === (v.lng === undefined), {
    error: 'Move the pin to change the meeting point',
    path: ['lat'],
  });
export type UpdateMeetupInput = z.infer<typeof UpdateMeetupInput>;

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
