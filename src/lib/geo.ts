export type Coords = { lat: number; lng: number };

export async function getCurrentCoords(): Promise<Coords> {
  if (!("geolocation" in navigator)) {
    throw new Error("Geolocation not supported by this browser");
  }
  return new Promise<Coords>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      err => reject(new Error(err.message)),
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 10_000 }
    );
  });
}

// Haversine distance in meters
export function distMeters(a: Coords, b: Coords): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
