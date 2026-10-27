// Renders exactly what the server sent: a pin for the exact point, or a circle for the
// approximate area. The app never has (or hides) more than that.
import type { MeetupLocation } from '@altair/shared';
import { useRef } from 'react';
import { StyleSheet } from 'react-native';
import MapView, { Circle, Marker, type MapMarker } from 'react-native-maps';

const METERS_PER_DEG = 111_320;

export function MeetupMap({ location }: { location: MeetupLocation }) {
  const pin = useRef<MapMarker>(null);
  const center = { latitude: location.lat, longitude: location.lng };
  // Frame the circle with some margin; zoom in close on an exact pin.
  const span = location.kind === 'approximate' ? (location.radiusM * 3) / METERS_PER_DEG : 0.006;

  return (
    <MapView
      // Remount on kind change so the map re-frames when the circle becomes a pin after RSVP.
      key={location.kind}
      style={styles.map}
      initialRegion={{ ...center, latitudeDelta: span, longitudeDelta: span }}
      // Show the pin's label right away instead of only after tapping the pin.
      onMapReady={() => setTimeout(() => pin.current?.showCallout(), 300)}
      accessibilityLabel={location.kind === 'exact' ? `Meeting point: ${location.placeName}` : location.label}
    >
      {location.kind === 'exact' ? (
        <Marker ref={pin} coordinate={center} title={location.placeName} />
      ) : (
        <Circle center={center} radius={location.radiusM} strokeColor="#2f5d8a" strokeWidth={2} fillColor="rgba(47,93,138,0.18)" />
      )}
    </MapView>
  );
}

const styles = StyleSheet.create({ map: { height: 260, borderRadius: 8 } });
