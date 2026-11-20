export function tripCoverStorageKey(userId: string, tripId: string) {
  return `trips/${userId}/${tripId}/cover.webp`;
}

export function tripCoverApiUrl(tripId: string) {
  return `/api/trips/${tripId}/cover`;
}