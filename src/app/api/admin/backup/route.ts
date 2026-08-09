import { createReadStream } from "node:fs";
import { Readable } from "node:stream";

import { NextResponse } from "next/server";

import {
  getDatabaseBackupFile,
  listDatabaseBackups,
  runDatabaseBackup,
} from "@/lib/admin/backup";
import { jsonError, requireAdminSession } from "@/lib/api/auth";
import { getWebDb } from "@/lib/db";
import { auditLogs } from "@/lib/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    await requireAdminSession();
    const fileName = new URL(request.url).searchParams.get("file");
    if (fileName) {
      const backup = await getDatabaseBackupFile(fileName);
      if (!backup) {
        return NextResponse.json({ error: "Backup not found" }, { status: 404 });
      }

      return new Response(
        Readable.toWeb(createReadStream(backup.filePath)) as ReadableStream,
        {
          headers: {
            "Content-Type": fileName.endsWith(".gz")
              ? "application/gzip"
              : "application/sql",
            "Content-Disposition": `attachment; filename="${fileName}"`,
            "Content-Length": String(backup.sizeBytes),
            "Cache-Control": "private, no-store",
          },
        },
      );
    }

    return NextResponse.json(await listDatabaseBackups());
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST() {
  try {
    const session = await requireAdminSession();
    const result = await runDatabaseBackup();
    const db = getWebDb();
    await db.insert(auditLogs).values({
      actorUserId: session.user.id,
      actionType: "integrity.run",
      targetType: "backup",
      metadata: {
        fileName: result.fileName,
        path: result.outPath,
        pruned: result.pruned,
      },
    });

    return NextResponse.json({
      ok: true,
      fileName: result.fileName,
      note: "Database dump written. Also snapshot/rsync MEDIA_PATH separately; CACHE_PATH is regenerable.",
    });
  } catch (error) {
    return jsonError(error);
  }
}
