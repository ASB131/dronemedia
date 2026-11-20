export type TripSummaryDto = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  assetCount: number;
  coverAssetId: string | null;
  createdAt: string;
};

export type TripDetailDto = TripSummaryDto & {
  photoCount: number;
  videoCount: number;
  panoramaCount: number;
  locatedCount: number;
};