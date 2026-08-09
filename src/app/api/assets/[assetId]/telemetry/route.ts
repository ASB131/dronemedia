import { NextResponse } from "next/server";

import {
  getTelemetryGeoJsonForUser,
  getTelemetrySeriesForUser,
} from "@/lib/assets/telemetry";
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
    const wantSeries = searchParams.get("series") === "1";

    const telemetry = await getTelemetryGeoJsonForUser(
      session.user.id,
      assetId,
    );

    if (!telemetry) {
      return NextResponse.json({
        flightPath: null,
        series: [],
      });
    }

    const series = wantSeries
      ? ((await getTelemetrySeriesForUser(session.user.id, assetId)) ?? [])
      : undefined;

    return NextResponse.json({
      ...telemetry,
      ...(wantSeries ? { series } : {}),
    });
  } catch (error) {
    return jsonError(error);
  }
}
