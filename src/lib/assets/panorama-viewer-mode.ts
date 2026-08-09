import {
  isPanoramaViewerMode,
  type MediaMetadata,
  type PanoramaViewerMode,
} from "@/lib/assets/media-metadata";

export type PanoramaViewerAssetLike = {
  assetType: "photo" | "video" | "sequence";
  sequenceKind?: "hyperlapse" | "panorama" | null;
  mediaMetadata?: MediaMetadata | null;
};

/**
 * Resolve how an asset should be displayed in the detail viewer.
 * Explicit panoramaViewer wins; otherwise derive from sphere flags / sequence kind.
 */
export function effectivePanoramaViewer(
  asset: PanoramaViewerAssetLike,
): PanoramaViewerMode {
  const meta =
    asset.mediaMetadata?.kind === "photo" ? asset.mediaMetadata : null;
  if (meta && isPanoramaViewerMode(meta.panoramaViewer)) {
    return meta.panoramaViewer;
  }

  if (asset.assetType === "sequence" && asset.sequenceKind === "panorama") {
    return meta?.panoramaSphere === false ? "180" : "360";
  }

  if (asset.assetType === "photo" && meta) {
    if (meta.panoramaSphere === true) return "360";
    if (meta.panoramaSphere === false) return "180";
    if (meta.panoramaWidth != null && meta.panoramaHeight != null) {
      const ratio =
        meta.panoramaHeight > 0
          ? meta.panoramaWidth / meta.panoramaHeight
          : null;
      if (ratio != null && ratio >= 1.9 && ratio <= 2.1) return "360";
      if (ratio != null && ratio > 1.2) return "180";
    }
  }

  return "photo";
}

export function isEquirectViewerMode(mode: PanoramaViewerMode): boolean {
  return mode === "180" || mode === "360";
}

export function panoramaViewerBadgeLabel(
  asset: PanoramaViewerAssetLike,
): string | null {
  const mode = effectivePanoramaViewer(asset);
  if (mode === "360") return "360°";
  if (mode === "180") return "180°";
  if (asset.assetType === "sequence" && asset.sequenceKind === "panorama") {
    return "Pano";
  }
  return null;
}
