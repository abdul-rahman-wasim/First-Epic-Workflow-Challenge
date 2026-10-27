// Place suggestions via Photon (OpenStreetMap data, built for search-as-you-type; free, no key).
// Nominatim's usage policy forbids autocomplete, so it isn't used here.
// No device-location permission; only the typed public place name is sent.
import { z } from 'zod';

const Photon = z.object({
  features: z.array(
    z.object({
      geometry: z.object({ coordinates: z.tuple([z.number(), z.number()]) }),
      properties: z.object({
        name: z.string().optional(),
        street: z.string().optional(),
        city: z.string().optional(),
        county: z.string().optional(),
        state: z.string().optional(),
      }),
    }),
  ),
});

export type Region = { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };
export type Suggestion = { name: string; detail: string; lat: number; lng: number };

export async function suggestPlaces(query: string, near: Region, signal: AbortSignal): Promise<Suggestion[]> {
  // Only places within ~50 km of the map view: a same-named park in another country is a wrong answer.
  const span = Math.max(near.latitudeDelta * 10, 0.5);
  const bbox = [near.longitude - span, near.latitude - span, near.longitude + span, near.latitude + span].join(',');
  const lang = Intl.DateTimeFormat().resolvedOptions().locale.split('-')[0]; // labels in the phone's language
  const url = `https://photon.komoot.io/api/?limit=5&lang=${lang}&bbox=${bbox}&q=${encodeURIComponent(query)}`;

  const res = await fetch(url, { signal, headers: { 'User-Agent': 'AltairMeetups/0.1 (workflow challenge demo)' } });
  if (!res.ok) throw new Error(`search failed (${res.status})`);
  return Photon.parse(await res.json())
    .features.filter((f) => f.properties.name)
    .map((f) => ({
      name: f.properties.name!,
      detail: [f.properties.street, f.properties.city ?? f.properties.county, f.properties.state].filter(Boolean).join(', '),
      lat: f.geometry.coordinates[1],
      lng: f.geometry.coordinates[0],
    }));
}
