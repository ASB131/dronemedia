import {
  buildGpx,
  buildKml,
  getTelemetryCsvForUser,
  getTelemetryTrackForUser,
  listChaptersForAsset,
} from "@/lib/assets/exports";
import { getOwnedAsset } from "@/lib/assets/access";
import { jsonError, requireApprovedSession } from "@/lib/api/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ assetId: string }> },
) {
  try {
    const session = await requireApprovedSession();
    const { assetId } = await context.params;
    const { searchParams } = new URL(request.url);
    const format = searchParams.get("format") ?? "csv";

    if (format === "chapters") {
      const chapters = await listChaptersForAsset(session.user.id, assetId);
      return Response.json({ chapters });
    }

    const asset = await getOwnedAsset(session.user.id, assetId);
    if (!asset) {
      return new Response("Not found", { status: 404 });
    }

    if (format === "csv") {
      const csv = await getTelemetryCsvForUser(session.user.id, assetId);
      if (!csv) return new Response("Not found", { status: 404 });
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${asset.displayName}.csv"`,
        },
      });
    }

    const track = await getTelemetryTrackForUser(session.user.id, assetId);
    if (!track || track.length === 0) {
      return new Response("No telemetry", { status: 404 });
    }

    if (format === "gpx") {
      const gpx = buildGpx(asset.displayName, track);
      return new Response(gpx, {
        headers: {
          "Content-Type": "application/gpx+xml",
          "Content-Disposition": `attachment; filename="${asset.displayName}.gpx"`,
        },
      });
    }

    if (format === "kml") {
      const kml = buildKml(asset.displayName, track);
      return new Response(kml, {
        headers: {
          "Content-Type": "application/vnd.google-earth.kml+xml",
          "Content-Disposition": `attachment; filename="${asset.displayName}.kml"`,
        },
      });
    }

    return new Response("Unsupported format", { status: 400 });
  } catch (error) {
    return jsonError(error);
  }
}
