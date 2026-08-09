import { and, desc, eq, sql } from "drizzle-orm";

import { getWebDb } from "@/lib/db";
import { siteNotes } from "@/lib/db/schema";

export type SiteNoteDto = {
  id: string;
  title: string;
  note: string | null;
  lat: number;
  lng: number;
  createdAt: string;
  updatedAt: string;
};

export async function listSiteNotes(userId: string): Promise<SiteNoteDto[]> {
  const db = getWebDb();
  const rows = await db
    .select({
      id: siteNotes.id,
      title: siteNotes.title,
      note: siteNotes.note,
      lat: sql<number>`ST_Y(${siteNotes.location})`,
      lng: sql<number>`ST_X(${siteNotes.location})`,
      createdAt: siteNotes.createdAt,
      updatedAt: siteNotes.updatedAt,
    })
    .from(siteNotes)
    .where(eq(siteNotes.userId, userId))
    .orderBy(desc(siteNotes.updatedAt));

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    note: row.note,
    lat: row.lat,
    lng: row.lng,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function createSiteNote(
  userId: string,
  input: { title: string; note?: string | null; lat: number; lng: number },
) {
  const db = getWebDb();
  const [row] = await db
    .insert(siteNotes)
    .values({
      userId,
      title: input.title.trim(),
      note: input.note?.trim() || null,
      location: sql`ST_SetSRID(ST_MakePoint(${input.lng}, ${input.lat}), 4326)`,
    })
    .returning({ id: siteNotes.id });

  if (!row) return null;
  const notes = await listSiteNotes(userId);
  return notes.find((note) => note.id === row.id) ?? null;
}

export async function updateSiteNote(
  userId: string,
  noteId: string,
  input: Partial<{
    title: string;
    note: string | null;
    lat: number;
    lng: number;
  }>,
) {
  const db = getWebDb();
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (input.title !== undefined) set.title = input.title.trim();
  if (input.note !== undefined) set.note = input.note?.trim() || null;
  if (input.lat !== undefined && input.lng !== undefined) {
    set.location = sql`ST_SetSRID(ST_MakePoint(${input.lng}, ${input.lat}), 4326)`;
  }

  const [row] = await db
    .update(siteNotes)
    .set(set)
    .where(and(eq(siteNotes.id, noteId), eq(siteNotes.userId, userId)))
    .returning({ id: siteNotes.id });

  if (!row) return null;
  const notes = await listSiteNotes(userId);
  return notes.find((note) => note.id === row.id) ?? null;
}

export async function deleteSiteNote(userId: string, noteId: string) {
  const db = getWebDb();
  const [row] = await db
    .delete(siteNotes)
    .where(and(eq(siteNotes.id, noteId), eq(siteNotes.userId, userId)))
    .returning({ id: siteNotes.id });
  return Boolean(row);
}
