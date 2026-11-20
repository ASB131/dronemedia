export type TripSummaryDto = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  assetCount: number;
  /** Resolved thumbnail URL for list cards (custom cover, chosen asset, or auto). */
  coverThumbnailUrl: string | null;
  hasCustomCover: boolean;
  coverAssetId: string | null;
  createdAt: string;
};

export type TripDetailDto = TripSummaryDto & {
  photoCount: number;
  videoCount: number;
  panoramaCount: number;
  locatedCount: number;
};