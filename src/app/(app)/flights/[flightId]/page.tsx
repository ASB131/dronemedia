import { FlightDetailView } from "@/components/flights/flight-detail-view";

export default async function FlightDetailPage({
  params,
}: {
  params: Promise<{ flightId: string }>;
}) {
  const { flightId } = await params;
  return <FlightDetailView flightId={flightId} />;
}
