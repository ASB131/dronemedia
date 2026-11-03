import { findUserById } from "@/lib/auth/users";
import { DEFAULT_MAP_STYLE_ID, normalizeMapStyleId } from "@/lib/map/map-styles";

export async function getUserMapStyleId(userId: string): Promise<string> {
  const user = await findUserById(userId);
  return normalizeMapStyleId(user?.preferences?.mapStyleId);
}

export { DEFAULT_MAP_STYLE_ID, normalizeMapStyleId };
