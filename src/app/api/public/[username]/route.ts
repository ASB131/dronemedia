import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { jsonError } from "@/lib/api/auth";
import { allowInAppSourceForRequest } from "@/lib/playback/source-access";
import { getPublicPortfolioExtras } from "@/lib/profiles/portfolio";
import {
  getPublicProfile,
  listPublicMapAssetsForUsername,
  listPublicPortfolioAssets,
} from "@/lib/profiles/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ username: string }> },
) {
  try {
    const { username } = await context.params;
    const profile = await getPublicProfile(username);
    if (!profile) {
      return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    }

    const session = await auth();
    const [assets, mapAssets, extras, allowInAppSource] = await Promise.all([
      listPublicPortfolioAssets(username),
      listPublicMapAssetsForUsername(username),
      getPublicPortfolioExtras(username),
      allowInAppSourceForRequest({ userId: session?.user?.id }),
    ]);

    return NextResponse.json({
      profile: {
        ...profile,
        coverAssetId: extras.coverAssetId,
        theme: extras.portfolio.theme,
      },
      assets,
      mapAssets,
      featuredAlbums: extras.featuredAlbums,
      showcase: extras.showcase,
      allowInAppSource,
    });
  } catch (error) {
    return jsonError(error);
  }
}
