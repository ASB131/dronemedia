import { NextResponse } from "next/server";
import { z } from "zod";

import { getUserStorage, jsonError, requireApprovedSession } from "@/lib/api/auth";
import { findUserById } from "@/lib/auth/users";
import { loadConfig } from "@/lib/config";
import {
  DEFAULT_PLAYBACK_RESOLUTION,
  isPlaybackResolution,
} from "@/lib/playback/resolution";
import {
  resolveAllowInAppSource,
} from "@/lib/playback/source-access";
import { updateUserProfile } from "@/lib/profiles/queries";
import { getMediaDiskStats } from "@/lib/storage/disk-stats";
import {
  MAX_UPLOAD_BATCH_BYTES,
  MAX_UPLOAD_BATCH_FILES,
} from "@/lib/upload/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  displayName: z.string().trim().max(80).nullable().optional(),
  bio: z.string().trim().max(500).nullable().optional(),
});

export async function GET() {
  try {
    const session = await requireApprovedSession();
    const [storage, user, disk] = await Promise.all([
      getUserStorage(session.user.id),
      findUserById(session.user.id),
      getMediaDiskStats(),
    ]);
    if (!storage || !user) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const config = loadConfig();
    const storedResolution = user.preferences?.defaultPlaybackResolution;
    const allowInAppSource = resolveAllowInAppSource({
      role: user.role,
      userPreference: user.preferences?.allowInAppSource ?? null,
      globalAllow: config.playback?.allowInAppSource ?? true,
    });
    const preferences = {
      theme: user.preferences?.theme ?? config.theme.default,
      downloadOriginalDefault: user.preferences?.downloadOriginalDefault ?? false,
      zipMultiSelectDefault: user.preferences?.zipMultiSelectDefault ?? true,
      notificationsEnabled: user.preferences?.notificationsEnabled ?? true,
      defaultPlaybackResolution: isPlaybackResolution(storedResolution)
        ? storedResolution
        : DEFAULT_PLAYBACK_RESOLUTION,
      previewLutId: user.preferences?.previewLutId ?? null,
      defaultDLogLutId: user.preferences?.defaultDLogLutId ?? null,
      defaultDLogMLutId: user.preferences?.defaultDLogMLutId ?? null,
      allowInAppSource: user.preferences?.allowInAppSource ?? null,
    };

    return NextResponse.json({
      usedBytes: storage.storageUsedBytes,
      quotaBytes: storage.storageQuotaBytes,
      diskUsedBytes: disk?.diskUsedBytes ?? null,
      diskTotalBytes: disk?.diskTotalBytes ?? null,
      allowInAppSource,
      username: user.username,
      email: user.email,
      role: user.role,
      displayName: user.displayName,
      bio: user.bio,
      pinEnabled: Boolean(user.pinHash),
      preferences,
      profileUrl: `/u/${encodeURIComponent(user.username)}`,
      upload: {
        maxFileSizeBytes: config.upload.maxFileSizeBytes,
        chunkSizeBytes: config.upload.chunkSizeBytes,
        maxBatchFiles: MAX_UPLOAD_BATCH_FILES,
        maxBatchBytes: MAX_UPLOAD_BATCH_BYTES,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await requireApprovedSession();
    const body = patchSchema.parse(await request.json());
    const updated = await updateUserProfile(session.user.id, {
      displayName: body.displayName,
      bio: body.bio,
    });
    if (!updated) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({
      ok: true,
      displayName: updated.displayName,
      bio: updated.bio,
    });
  } catch (error) {
    return jsonError(error);
  }
}
