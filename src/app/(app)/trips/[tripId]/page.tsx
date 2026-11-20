import { TripDetailView } from "@/components/trips/trip-detail-view";

export default async function TripDetailPage({
  params,
}: {
  params: Promise<{ tripId: string }>;
}) {
  const { tripId } = await params;
  return <TripDetailView tripId={tripId} />;
}