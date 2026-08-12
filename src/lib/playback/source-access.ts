import { eq } from "drizzle-orm";

import { loadConfig } from "@/lib/config";
import { getWebDb } from "@/lib/db";
import { users } from "@/lib/db/schema";

export function resolveAllowInAppSource(params: {
  role?: string | null;
  userPreference?: boolean | null;
  globalAllow?: boolean;
}): boolean {
  if (params.role === "admin") return true;
  if (params.userPreference === true) return true;
  if (params.userPreference === false) return false;
  return params.globalAllow ?? true;
}

/** Resolve Source playback permission for a logged-in user. */
export async function allowInAppSourceForUserId(
  userId: string,
): Promise<boolean> {
  const config = loadConfig();
  const globalAllow = config.playback?.allowInAppSource ?? true;
  const db = getWebDb();
  const [row] = await db
    .select({
      role: users.role,
      preferences: users.preferences,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) return globalAllow;
  return resolveAllowInAppSource({
    role: row.role,
    userPreference: row.preferences?.allowInAppSource ?? null,
    globalAllow,
  });
}

/**
 * Anonymous public viewers inherit the global gate only.
 * Logged-in viewers use their own role/override.
 */
export async function allowInAppSourceForRequest(options?: {
  userId?: string | null;
}): Promise<boolean> {
  if (options?.userId) {
    return allowInAppSourceForUserId(options.userId);
  }
  const config = loadConfig();
  return config.playback?.allowInAppSource ?? true;
}
