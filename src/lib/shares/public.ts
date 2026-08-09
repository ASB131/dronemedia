import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { getAlbumForUser } from "@/lib/albums/queries";
import { getAssetDetailForUser } from "@/lib/assets/detail";
import { getWebDb } from "@/lib/db";
import { assets, flightTelemetry } from "@/lib/db/schema";
import { getFlightForUser } from "@/lib/flights/queries";
import { isShareUnlocked } from "@/lib/shares/password";
import { fuzzFlightPath } from "@/lib/shares/privacy";
import {
  getActiveShareByToken,
  isShareRecipient,
} from "@/lib/shares/queries";

export async function getShareAccess(
  token: string,
  viewerUserId?: string | null,
) {
  const share = await getActiveShareByToken(token);
  if (!share) return null;

  if (share.shareType === "user") {
    if (!viewerUserId) return null;
    const allowed = await isShareRecipient(share.id, viewerUserId);
    if (!allowed) return null;
  }

  const unlocked = await isShareUnlocked(token, share.passwordHash);
  return { share, unlocked };
}

export async function resolveShareAsset(
  token: string,
  viewerUserId?: string | null,
  assetId?: string,
) {
  const access = await getShareAccess(token, viewerUserId);
  if (!access || !access.unlocked) return null;

  const { share } = access;
  const db = getWebDb();

  let resolvedAssetId = assetId ?? null;
  if (share.targetType === "asset") {
    resolvedAssetId = share.targetId;
  } else if (!resolvedAssetId) {
    return null;
  } else if (share.targetType === "album") {
    const album = await getAlbumForUser(share.ownerUserId, share.targetId);
    if (!album?.assets.some((item) => item.id === resolvedAssetId)) {
      return null;
    }
  } else if (share.targetType === "flight") {
    const flight = await getFlightForUser(share.ownerUserId, share.targetId);
    if (!flight?.assets.some((item) => item.id === resolvedAssetId)) {
      return null;
    }
  }

  if (!resolvedAssetId) return null;

  const [asset] = await db
    .select()
    .from(assets)
    .where(
      and(
        eq(assets.id, resolvedAssetId),
        eq(assets.userId, share.ownerUserId),
        isNull(assets.deletedAt),
      ),
    )
    .limit(1);

  if (!asset) return null;
  return { share, asset };
}

async function getAssetTelemetryForShare(
  ownerUserId: string,
  assetId: string,
  includeExactGps: boolean,
) {
  const db = getWebDb();
  const [row] = await db
    .select({
      pathJson: sql<string | null>`ST_AsGeoJSON(${flightTelemetry.flightPath})`,
    })
    .from(flightTelemetry)
    .innerJoin(assets, eq(assets.id, flightTelemetry.assetId))
    .where(
      and(
        eq(flightTelemetry.assetId, assetId),
        eq(assets.userId, ownerUserId),
        isNull(assets.deletedAt),
      ),
    )
    .limit(1);

  if (!row) return null;

  const path = row.pathJson
    ? (JSON.parse(row.pathJson) as {
        type: "LineString";
        coordinates: Array<[number, number]>;
      })
    : null;

  if (includeExactGps) {
    return { flightPath: path };
  }

  return {
    flightPath:
      path && path.coordinates.length
        ? {
            type: "LineString" as const,
            coordinates: fuzzFlightPath(path.coordinates),
          }
        : null,
  };
}

export async function getPublicSharePayload(
  token: string,
  viewerUserId?: string | null,
) {
  const access = await getShareAccess(token, viewerUserId);
  if (!access) return null;

  const { share, unlocked } = access;
  const baseShare = {
    token: share.token,
    shareType: share.shareType,
    targetType: share.targetType,
    includeExactGps: share.includeExactGps,
    expiresAt: share.expiresAt?.toISOString() ?? null,
    hasPassword: Boolean(share.passwordHash),
  };

  if (!unlocked) {
    return {
      requiresPassword: true as const,
      share: baseShare,
    };
  }

  if (share.targetType === "asset") {
    const asset = await getAssetDetailForUser(
      share.ownerUserId,
      share.targetId,
    );
    if (!asset) return null;
    const telemetry = asset.telemetry?.hasFlightPath
      ? await getAssetTelemetryForShare(
          share.ownerUserId,
          share.targetId,
          share.includeExactGps,
        )
      : null;
    return {
      requiresPassword: false as const,
      share: baseShare,
      targetType: "asset" as const,
      asset: {
        id: asset.id,
        displayName: asset.displayName,
        assetType: asset.assetType,
        capturedLabel: asset.capturedLabel,
        hasTelemetry: Boolean(asset.telemetry?.hasFlightPath),
        hasHls: asset.hasHls,
        hasProxy: asset.hasProxy,
        hasLrf: asset.hasLrf,
        location: share.includeExactGps ? asset.location : null,
        flightPath: telemetry?.flightPath ?? null,
      },
    };
  }

  if (share.targetType === "album") {
    const album = await getAlbumForUser(share.ownerUserId, share.targetId);
    if (!album) return null;
    const playback = await getSharePlaybackFlags(
      share.ownerUserId,
      album.assets.map((item) => ({
        id: item.id,
        assetType: item.assetType,
      })),
    );
    return {
      requiresPassword: false as const,
      share: baseShare,
      targetType: "album" as const,
      album: {
        id: album.id,
        name: album.name,
        description: album.description,
        assets: album.assets.map((item) => ({
          id: item.id,
          displayName: item.displayName,
          assetType: item.assetType,
          ...(playback.get(item.id) ?? {}),
        })),
      },
    };
  }

  const flight = await getFlightForUser(share.ownerUserId, share.targetId);
  if (!flight) return null;

  let combinedPath = flight.combinedPath;
  if (combinedPath && !share.includeExactGps) {
    combinedPath = {
      type: "LineString",
      coordinates: fuzzFlightPath(combinedPath.coordinates),
    };
  }

  const playback = await getSharePlaybackFlags(
    share.ownerUserId,
    flight.assets.map((item) => ({
      id: item.id,
      assetType: item.assetType,
    })),
  );

  return {
    requiresPassword: false as const,
    share: baseShare,
    targetType: "flight" as const,
    flight: {
      id: flight.id,
      title: flight.title,
      assets: flight.assets.map((item) => ({
        id: item.id,
        displayName: item.displayName,
        assetType: item.assetType,
        capturedAt: item.capturedAt,
        ...(playback.get(item.id) ?? {}),
      })),
      combinedPath,
    },
  };
}

async function getSharePlaybackFlags(
  ownerUserId: string,
  items: Array<{ id: string; assetType: "photo" | "video" | "sequence" }>,
) {
  const flags = new Map<
    string,
    { hasHls: boolean; hasProxy: boolean; hasLrf: boolean }
  >();
  const playable = items
    .filter(
      (item) => item.assetType === "video" || item.assetType === "sequence",
    )
    .slice(0, 80);
  if (playable.length === 0) return flags;

  const db = getWebDb();
  const rows = await db
    .select({
      id: assets.id,
      hasLrf: assets.hasLrf,
      hasProxy: assets.hasProxy,
      hasHls: assets.hasHls,
    })
    .from(assets)
    .where(
      and(
        eq(assets.userId, ownerUserId),
        inArray(
          assets.id,
          playable.map((item) => item.id),
        ),
      ),
    );

  for (const row of rows) {
    flags.set(row.id, {
      hasHls: row.hasHls,
      hasProxy: row.hasProxy || row.hasLrf,
      hasLrf: row.hasLrf,
    });
  }

  return flags;
}
