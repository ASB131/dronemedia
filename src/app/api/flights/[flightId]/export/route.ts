import { NextResponse } from "next/server";

import { jsonError, requireApprovedSession } from "@/lib/api/auth";
import { exportFlightTrack } from "@/lib/flights/export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ flightId: string }> },
) {
  try {
    const session = await requireApprovedSession();
    const { flightId } = await context.params;
    const formatParam = new URL(request.url).searchParams.get("format") ?? "gpx";
    const format = formatParam === "kml" ? "kml" : "gpx";
    const exported = await exportFlightTrack(
      session.user.id,
      flightId,
      format,
    );
    if (!exported) {
      return NextResponse.json(
        { error: "No telemetry track for this flight" },
        { status: 404 },
      );
    }

    const filename = `${exported.name.replace(/[^\w.-]+/g, "_")}.${format}`;
    return new NextResponse(exported.body, {
      headers: {
        "Content-Type":
          format === "gpx" ? "application/gpx+xml" : "application/vnd.google-earth.kml+xml",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
