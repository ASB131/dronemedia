import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public handshake so the companion app can verify it reached a Drone Media server. */
export async function GET() {
  return NextResponse.json({
    service: "dronemedia",
    companion: true,
  });
}
