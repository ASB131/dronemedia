/** Chaikin corner-cutting for visually smoother polylines. */
export function smoothPolyline(
  points: Array<[number, number]>,
  iterations = 2,
): Array<[number, number]> {
  if (points.length < 3) return points;

  let current = points;
  for (let iter = 0; iter < iterations; iter += 1) {
    const next: Array<[number, number]> = [current[0]!];
    for (let i = 0; i < current.length - 1; i += 1) {
      const [x0, y0] = current[i]!;
      const [x1, y1] = current[i + 1]!;
      next.push([0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1]);
      next.push([0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1]);
    }
    next.push(current[current.length - 1]!);
    current = next;
  }
  return current;
}

/** Light moving-average pre-filter to reduce GPS jitter before smoothing. */
export function denoisePolyline(
  points: Array<[number, number]>,
  windowSize = 3,
): Array<[number, number]> {
  if (points.length < windowSize) return points;
  const half = Math.floor(windowSize / 2);
  return points.map((_, index) => {
    let sumLng = 0;
    let sumLat = 0;
    let count = 0;
    for (
      let i = Math.max(0, index - half);
      i <= Math.min(points.length - 1, index + half);
      i += 1
    ) {
      sumLng += points[i]![0];
      sumLat += points[i]![1];
      count += 1;
    }
    return [sumLng / count, sumLat / count] as [number, number];
  });
}

export function prepareSmoothPath(
  coordinates: Array<[number, number]>,
): Array<[number, number]> {
  if (coordinates.length < 3) return coordinates;
  return smoothPolyline(denoisePolyline(coordinates, 5), 2);
}

export function nearestPointIndex(
  points: Array<{ lat: number; lng: number }>,
  lat: number,
  lng: number,
): number {
  let best = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < points.length; i += 1) {
    const point = points[i]!;
    const dLat = point.lat - lat;
    const dLng = point.lng - lng;
    const dist = dLat * dLat + dLng * dLng;
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}
