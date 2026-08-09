import { NextResponse } from "next/server";
import { z } from "zod";

import { jsonError, requireApprovedSession } from "@/lib/api/auth";
import { listAlbumsForUser } from "@/lib/albums/queries";
import {
  getPortfolioSettings,
  updatePortfolioSettings,
} from "@/lib/profiles/portfolio";
import { listPublicPortfolioAssets } from "@/lib/profiles/queries";
import { findUserById } from "@/lib/auth/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  coverAssetId: z.string().uuid().nullable().optional(),
  featuredAlbumIds: z.array(z.string().uuid()).max(20).optional(),
  showcaseAssetIds: z.array(z.string().uuid()).max(40).optional(),
  theme: z.enum(["default", "cinematic", "minimal"]).optional(),
});

export async function GET() {
  try {
    const session = await requireApprovedSession();
    const user = await findUserById(session.user.id);
    if (!user) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const [portfolio, albums, publicAssets] = await Promise.all([
      getPortfolioSettings(session.user.id),
      listAlbumsForUser(session.user.id),
      listPublicPortfolioAssets(user.username, 200),
    ]);

    return NextResponse.json({
      portfolio,
      albums: albums.map((album) => ({
        id: album.id,
        name: album.name,
        assetCount: album.assetCount,
        coverAssetId: album.coverAssetId,
      })),
      publicAssets: publicAssets.map((asset) => ({
        id: asset.id,
        displayName: asset.displayName,
        assetType: asset.assetType,
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await requireApprovedSession();
    const body = patchSchema.parse(await request.json());
    const portfolio = await updatePortfolioSettings(session.user.id, body);
    if (!portfolio) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ portfolio });
  } catch (error) {
    return jsonError(error);
  }
}