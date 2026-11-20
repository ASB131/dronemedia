import { NextResponse } from "next/server";
import sharp from "sharp";

import { jsonError, requireApprovedSession } from "@/lib/api/auth";
import { getWebDb } from "@/lib/db";
import { trips } from "@/lib/db/schema";
import { getStorageAdapter } from "@/lib/storage";
import { tripCoverStorageKey, tripCoverApiUrl } from "@/lib/trips/cover";
import { getTripForUser, requireTripOwnership } from "@/lib/trips/queries";
import { and, eq } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 8 * 1024 * 1024;

export async function GET(
  _request: Request,
  context: { params: Promise<{ tripId: string }> },
) {
  try {
    const session = await requireApprovedSession();
    const { tripId } = await context.params;
    const trip = await requireTripOwnership(session.user.id, tripId);
    if (!trip.coverImageKey) {
      return new NextResponse(null, { status: 404 });
    }
    const storage = getStorageAdapter();
    const data = await storage.get(trip.coverImageKey, { tier: "app" });
    if (!data) {
      return new NextResponse(null, { status: 404 });
    }
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ tripId: string }> },
) {
  try {
    const session = await requireApprovedSession();
    const { tripId } = await context.params;
    await requireTripOwnership(session.user.id, tripId);

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }
    const raw = Buffer.from(await file.arrayBuffer());
    if (raw.byteLength > MAX_BYTES) {
      return NextResponse.json({ error: "File too large (max 8 MB)" }, { status: 400 });
    }

    const webp = await sharp(raw)
      .rotate()
      .resize(1200, 1200, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();

    const key = tripCoverStorageKey(session.user.id, tripId);
    const storage = getStorageAdapter();
    await storage.put(key, webp, { tier: "app", contentType: "image/webp" });

    const db = getWebDb();
    await db
      .update(trips)
      .set({
        coverImageKey: key,
        coverAssetId: null,
        updatedAt: new Date(),
      })
      .where(and(eq(trips.id, tripId), eq(trips.userId, session.user.id)));

    const trip = await getTripForUser(session.user.id, tripId);
    return NextResponse.json({
      trip,
      coverThumbnailUrl: tripCoverApiUrl(tripId),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ tripId: string }> },
) {
  try {
    const session = await requireApprovedSession();
    const { tripId } = await context.params;
    const trip = await requireTripOwnership(session.user.id, tripId);
    if (trip.coverImageKey) {
      const storage = getStorageAdapter();
      await storage.delete(trip.coverImageKey, { tier: "app" }).catch(() => undefined);
    }
    const db = getWebDb();
    await db
      .update(trips)
      .set({
        coverImageKey: null,
        updatedAt: new Date(),
      })
      .where(and(eq(trips.id, tripId), eq(trips.userId, session.user.id)));

    const refreshed = await getTripForUser(session.user.id, tripId);
    return NextResponse.json({ trip: refreshed });
  } catch (error) {
    return jsonError(error);
  }
}