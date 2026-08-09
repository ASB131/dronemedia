import { NextResponse } from "next/server";

import { jsonError, requireApprovedSession } from "@/lib/api/auth";
import { readLutCubeBytes } from "@/lib/luts/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ lutId: string }> },
) {
  try {
    await requireApprovedSession();
    const { lutId } = await context.params;
    const bytes = await readLutCubeBytes(lutId);
    if (!bytes) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "private, max-age=3600",
        "Content-Disposition": `inline; filename="${lutId}.cube"`,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
