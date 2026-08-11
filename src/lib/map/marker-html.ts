/** Shared Leaflet thumbnail marker HTML for personal + community maps. */

export type MapMarkerAsset = {
  id: string;
  displayName: string;
  assetType: "photo" | "video" | "sequence";
  sequenceKind?: "hyperlapse" | "panorama" | null;
};

function escapeAttr(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function mediaTypeBadge(asset: MapMarkerAsset): string {
  if (asset.assetType === "photo") {
    return `<span class="dm-map-marker-badge dm-map-marker-badge-photo" title="Photo" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
        <circle cx="12" cy="13" r="4"/>
      </svg>
    </span>`;
  }
  if (asset.assetType === "video") {
    return `<span class="dm-map-marker-badge dm-map-marker-badge-video" title="Video" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2" y="6" width="14" height="12" rx="2"/>
        <path d="m16 10 6-3v10l-6-3z"/>
      </svg>
    </span>`;
  }
  if (asset.sequenceKind === "panorama") {
    return `<span class="dm-map-marker-badge dm-map-marker-badge-pano" title="Panorama" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="9"/>
        <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>
      </svg>
    </span>`;
  }
  // Hyperlapse / other sequences
  return `<span class="dm-map-marker-badge dm-map-marker-badge-sequence" title="Sequence" aria-hidden="true">
    <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="5" width="14" height="12" rx="2"/>
      <path d="M7 9h6M7 13h4"/>
      <path d="M19 8v10a2 2 0 0 1-2 2H8"/>
    </svg>
  </span>`;
}

/**
 * Circular thumbnail marker with a corner media-type badge.
 * `thumbUrl` should already be a safe URL for the asset.
 */
export function thumbnailMarkerHtml(
  asset: MapMarkerAsset,
  thumbUrl: string,
): string {
  const title = escapeAttr(asset.displayName);
  return `
    <div class="dm-map-marker-root" title="${title}">
      <div class="dm-map-marker">
        <img src="${escapeAttr(thumbUrl)}" alt="" />
      </div>
      ${mediaTypeBadge(asset)}
    </div>
  `;
}
