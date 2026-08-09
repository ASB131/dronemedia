import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { loadConfig } from "@/lib/config";

const execFileAsync = promisify(execFile);

function isBackupFileName(fileName: string) {
  return (
    path.basename(fileName) === fileName &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*\.sql(?:\.gz)?$/.test(fileName)
  );
}

async function getBackupDir() {
  const config = loadConfig();
  const backupDir = path.join(config.storage.appDataPath, "backups");
  await fs.mkdir(backupDir, { recursive: true });
  return { config, backupDir };
}

export async function runDatabaseBackup(): Promise<{
  fileName: string;
  outPath: string;
  pruned: number;
}> {
  const { config, backupDir } = await getBackupDir();

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `drone-media-${stamp}.sql`;
  const outPath = path.join(backupDir, fileName);

  const databaseUrl =
    process.env.DATABASE_URL ??
    `postgresql://${process.env.POSTGRES_USER ?? "drone_media"}:${process.env.POSTGRES_PASSWORD ?? "drone_media"}@${process.env.POSTGRES_HOST ?? "postgres"}:5432/${process.env.POSTGRES_DB ?? "drone_media"}`;

  await execFileAsync(
    "pg_dump",
    ["--no-owner", "--no-acl", "--dbname", databaseUrl, "--file", outPath],
    { timeout: 10 * 60 * 1000 },
  );

  const pruned = await pruneOldBackups(
    backupDir,
    config.backup.retainDays,
  );

  return { fileName, outPath, pruned };
}

export async function getDatabaseBackupFile(fileName: string) {
  if (!isBackupFileName(fileName)) return null;

  const { backupDir } = await getBackupDir();
  const filePath = path.join(backupDir, fileName);
  const resolvedBackupDir = path.resolve(backupDir);
  const resolvedFilePath = path.resolve(filePath);
  if (!resolvedFilePath.startsWith(`${resolvedBackupDir}${path.sep}`)) {
    return null;
  }

  try {
    const stat = await fs.lstat(resolvedFilePath);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    return { filePath: resolvedFilePath, sizeBytes: stat.size };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function pruneOldBackups(backupDir: string, retainDays: number) {
  const cutoff = Date.now() - retainDays * 24 * 60 * 60 * 1000;
  const entries = await fs.readdir(backupDir);
  let pruned = 0;
  for (const name of entries) {
    if (!name.endsWith(".sql") && !name.endsWith(".sql.gz")) continue;
    const full = path.join(backupDir, name);
    const stat = await fs.stat(full);
    if (stat.mtimeMs < cutoff) {
      await fs.unlink(full);
      pruned += 1;
    }
  }
  return pruned;
}

export async function listDatabaseBackups() {
  const { config, backupDir } = await getBackupDir();
  const entries = await fs.readdir(backupDir);
  const files = [];
  for (const name of entries) {
    if (!name.endsWith(".sql") && !name.endsWith(".sql.gz")) continue;
    const stat = await fs.stat(path.join(backupDir, name));
    files.push({
      name,
      sizeBytes: stat.size,
      createdAt: stat.mtime.toISOString(),
    });
  }
  files.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return {
    backupDir,
    mediaPath: config.storage.mediaPath,
    files,
    schedule: config.backup,
  };
}
