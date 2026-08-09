import { AlbumDetailView } from "@/components/albums/album-detail-view";

export default async function AlbumDetailPage({
  params,
}: {
  params: Promise<{ albumId: string }>;
}) {
  const { albumId } = await params;
  return <AlbumDetailView albumId={albumId} />;
}
