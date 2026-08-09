import { and, desc, eq } from "drizzle-orm";

import { getWebDb } from "@/lib/db";
import {
  missionTemplates,
  type MissionChecklistItem,
} from "@/lib/db/schema";

export type MissionTemplateDto = {
  id: string;
  name: string;
  description: string | null;
  checklist: MissionChecklistItem[];
  requireSrt: boolean;
  requireLrf: boolean;
  defaultDroneId: string | null;
  defaultAlbumId: string | null;
  defaultTags: string[];
  createdAt: string;
  updatedAt: string;
};

function toDto(row: typeof missionTemplates.$inferSelect): MissionTemplateDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    checklist: row.checklist ?? [],
    requireSrt: row.requireSrt,
    requireLrf: row.requireLrf,
    defaultDroneId: row.defaultDroneId,
    defaultAlbumId: row.defaultAlbumId,
    defaultTags: row.defaultTags ?? [],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listMissionTemplates(
  userId: string,
): Promise<MissionTemplateDto[]> {
  const db = getWebDb();
  const rows = await db
    .select()
    .from(missionTemplates)
    .where(eq(missionTemplates.userId, userId))
    .orderBy(desc(missionTemplates.updatedAt));
  return rows.map(toDto);
}

export async function getMissionTemplate(userId: string, templateId: string) {
  const db = getWebDb();
  const [row] = await db
    .select()
    .from(missionTemplates)
    .where(
      and(
        eq(missionTemplates.id, templateId),
        eq(missionTemplates.userId, userId),
      ),
    )
    .limit(1);
  return row ? toDto(row) : null;
}

export async function createMissionTemplate(
  userId: string,
  input: {
    name: string;
    description?: string | null;
    checklist?: MissionChecklistItem[];
    requireSrt?: boolean;
    requireLrf?: boolean;
    defaultDroneId?: string | null;
    defaultAlbumId?: string | null;
    defaultTags?: string[];
  },
) {
  const db = getWebDb();
  const [row] = await db
    .insert(missionTemplates)
    .values({
      userId,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      checklist: input.checklist ?? [],
      requireSrt: input.requireSrt ?? false,
      requireLrf: input.requireLrf ?? false,
      defaultDroneId: input.defaultDroneId ?? null,
      defaultAlbumId: input.defaultAlbumId ?? null,
      defaultTags: input.defaultTags ?? [],
    })
    .returning();
  return row ? toDto(row) : null;
}

export async function updateMissionTemplate(
  userId: string,
  templateId: string,
  input: Partial<{
    name: string;
    description: string | null;
    checklist: MissionChecklistItem[];
    requireSrt: boolean;
    requireLrf: boolean;
    defaultDroneId: string | null;
    defaultAlbumId: string | null;
    defaultTags: string[];
  }>,
) {
  const db = getWebDb();
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) set.name = input.name.trim();
  if (input.description !== undefined) {
    set.description = input.description?.trim() || null;
  }
  if (input.checklist !== undefined) set.checklist = input.checklist;
  if (input.requireSrt !== undefined) set.requireSrt = input.requireSrt;
  if (input.requireLrf !== undefined) set.requireLrf = input.requireLrf;
  if (input.defaultDroneId !== undefined) {
    set.defaultDroneId = input.defaultDroneId;
  }
  if (input.defaultAlbumId !== undefined) {
    set.defaultAlbumId = input.defaultAlbumId;
  }
  if (input.defaultTags !== undefined) set.defaultTags = input.defaultTags;

  const [row] = await db
    .update(missionTemplates)
    .set(set)
    .where(
      and(
        eq(missionTemplates.id, templateId),
        eq(missionTemplates.userId, userId),
      ),
    )
    .returning();
  return row ? toDto(row) : null;
}

export async function deleteMissionTemplate(
  userId: string,
  templateId: string,
) {
  const db = getWebDb();
  const [row] = await db
    .delete(missionTemplates)
    .where(
      and(
        eq(missionTemplates.id, templateId),
        eq(missionTemplates.userId, userId),
      ),
    )
    .returning({ id: missionTemplates.id });
  return Boolean(row);
}
