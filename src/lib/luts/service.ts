import { desc, eq } from "drizzle-orm";

import { ApiError } from "@/lib/api/auth";
import { getWebDb } from "@/lib/db";
import { luts } from "@/lib/db/schema";
import {
  assertCubeFileLimits,
  lutStorageKey,
  validateCubeText,
} from "@/lib/luts/cube-parse";
import {
  LUT_COLOR_PROFILES,
  type LutColorProfile,
} from "@/lib/luts/color-profile";
import { getStorageAdapter } from "@/lib/storage";

export type LutListItem = {
  id: string;
  name: string;
  colorProfile: LutColorProfile;
  sizeBytes: number;
  createdAt: string;
  createdBy: string | null;
};

function assertColorProfile(value: string): LutColorProfile {
  if ((LUT_COLOR_PROFILES as string[]).includes(value)) {
    return value as LutColorProfile;
  }
  throw new Error("colorProfile must be d_log or d_logm");
}

export async function listLuts(filter?: {
  colorProfile?: LutColorProfile | null;
}): Promise<LutListItem[]> {
  const db = getWebDb();
  const rows = await db
    .select({
      id: luts.id,
      name: luts.name,
      colorProfile: luts.colorProfile,
      sizeBytes: luts.sizeBytes,
      createdAt: luts.createdAt,
      createdBy: luts.createdBy,
    })
    .from(luts)
    .orderBy(desc(luts.createdAt), desc(luts.name));

  return rows
    .filter((row) =>
      filter?.colorProfile ? row.colorProfile === filter.colorProfile : true,
    )
    .map((row) => ({
      id: row.id,
      name: row.name,
      colorProfile: row.colorProfile,
      sizeBytes: row.sizeBytes,
      createdAt: row.createdAt.toISOString(),
      createdBy: row.createdBy,
    }));
}

export async function createLutFromUpload(input: {
  fileName: string;
  bytes: Buffer;
  createdBy: string;
  displayName?: string | null;
  colorProfile: string;
}): Promise<LutListItem> {
  assertCubeFileLimits(input.fileName, input.bytes.byteLength);
  const colorProfile = assertColorProfile(input.colorProfile);
  const text = input.bytes.toString("utf8");
  const header = validateCubeText(text);

  const name =
    input.displayName?.trim() ||
    header.title ||
    input.fileName.replace(/\.cube$/i, "") ||
    "Untitled LUT";

  const db = getWebDb();
  const [row] = await db
    .insert(luts)
    .values({
      name,
      colorProfile,
      storageKey: "pending",
      sizeBytes: input.bytes.byteLength,
      createdBy: input.createdBy,
    })
    .returning();

  if (!row) throw new ApiError(500, "Failed to create LUT");

  const storageKey = lutStorageKey(row.id);
  const storage = getStorageAdapter();
  try {
    await storage.put(storageKey, input.bytes, {
      tier: "app",
      contentType: "application/octet-stream",
    });
    const [updated] = await db
      .update(luts)
      .set({ storageKey })
      .where(eq(luts.id, row.id))
      .returning();
    if (!updated) throw new ApiError(500, "Failed to finalize LUT");
    return {
      id: updated.id,
      name: updated.name,
      colorProfile: updated.colorProfile,
      sizeBytes: updated.sizeBytes,
      createdAt: updated.createdAt.toISOString(),
      createdBy: updated.createdBy,
    };
  } catch (error) {
    await db.delete(luts).where(eq(luts.id, row.id));
    throw error;
  }
}

export async function updateLutColorProfile(
  lutId: string,
  colorProfileRaw: string,
): Promise<LutListItem | null> {
  const colorProfile = assertColorProfile(colorProfileRaw);
  const db = getWebDb();
  const [updated] = await db
    .update(luts)
    .set({ colorProfile })
    .where(eq(luts.id, lutId))
    .returning();
  if (!updated) return null;
  return {
    id: updated.id,
    name: updated.name,
    colorProfile: updated.colorProfile,
    sizeBytes: updated.sizeBytes,
    createdAt: updated.createdAt.toISOString(),
    createdBy: updated.createdBy,
  };
}

export async function deleteLut(lutId: string): Promise<boolean> {
  const db = getWebDb();
  const [row] = await db
    .select()
    .from(luts)
    .where(eq(luts.id, lutId))
    .limit(1);
  if (!row) return false;

  const storage = getStorageAdapter();
  await storage.delete(row.storageKey, { tier: "app" });
  await db.delete(luts).where(eq(luts.id, lutId));
  return true;
}

export async function getLutRow(lutId: string) {
  const db = getWebDb();
  const [row] = await db
    .select()
    .from(luts)
    .where(eq(luts.id, lutId))
    .limit(1);
  return row ?? null;
}

export async function readLutCubeBytes(lutId: string): Promise<Buffer | null> {
  const row = await getLutRow(lutId);
  if (!row) return null;
  const storage = getStorageAdapter();
  return storage.get(row.storageKey, { tier: "app" });
}
