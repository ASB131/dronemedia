/** Media within this distance share a pin and get spread when zoomed in. */
export const COLOCATED_METERS = 15;

/** At this zoom and above, co-located markers fan out automatically. */
export const AUTO_EXPAND_ZOOM = 16;

const RING_CAPACITY = 7;
const RING_RADIUS_PX = 40;

export function distanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function groupColocatedAssets<T extends { lat: number; lng: number }>(
  assets: T[],
  meters = COLOCATED_METERS,
): T[][] {
  const remaining = [...assets];
  const groups: T[][] = [];
  while (remaining.length > 0) {
    const seed = remaining.shift()!;
    const group = [seed];
    for (let i = remaining.length - 1; i >= 0; i--) {
      if (distanceMeters(remaining[i]!, seed) <= meters) {
        group.push(remaining.splice(i, 1)[0]!);
      }
    }
    groups.push(group);
  }
  return groups;
}

type LatLngLike = { lat: number; lng: number };

/**
 * When expand is true, spread co-located assets into rings around their
 * centroid using screen-pixel offsets so each pin is clickable.
 */
export function layoutColocatedPositions<
  T extends { id: string; lat: number; lng: number },
>(
  assets: T[],
  options: {
    expand: boolean;
    project: (latLng: LatLngLike) => { x: number; y: number };
    unproject: (point: { x: number; y: number }) => LatLngLike;
  },
): Map<string, LatLngLike> {
  const out = new Map<string, LatLngLike>();
  if (!options.expand) {
    for (const asset of assets) {
      out.set(asset.id, { lat: asset.lat, lng: asset.lng });
    }
    return out;
  }

  for (const group of groupColocatedAssets(assets)) {
    if (group.length === 1) {
      const only = group[0]!;
      out.set(only.id, { lat: only.lat, lng: only.lng });
      continue;
    }

    const centerLat =
      group.reduce((sum, asset) => sum + asset.lat, 0) / group.length;
    const centerLng =
      group.reduce((sum, asset) => sum + asset.lng, 0) / group.length;
    const center = options.project({ lat: centerLat, lng: centerLng });

    group.forEach((asset, index) => {
      const ring = Math.floor(index / RING_CAPACITY);
      const indexInRing = index % RING_CAPACITY;
      const remaining = group.length - ring * RING_CAPACITY;
      const countInRing = Math.min(RING_CAPACITY, remaining);
      const angle =
        (2 * Math.PI * indexInRing) / countInRing - Math.PI / 2;
      const radius = RING_RADIUS_PX * (1.15 + ring);
      const point = {
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius,
      };
      out.set(asset.id, options.unproject(point));
    });
  }

  return out;
}
