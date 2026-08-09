import { createHmac, timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";

function unlockSecret() {
  return process.env.AUTH_SECRET ?? "drone-media-dev-secret";
}

export function shareUnlockCookieName(token: string) {
  return `dm_share_${token.slice(0, 24)}`;
}

export function buildShareUnlockValue(token: string, passwordHash: string) {
  return createHmac("sha256", unlockSecret())
    .update(`${token}:${passwordHash}`)
    .digest("hex");
}

export function verifyShareUnlockValue(
  token: string,
  passwordHash: string,
  value: string | undefined,
) {
  if (!value) return false;
  const expected = buildShareUnlockValue(token, passwordHash);
  const a = Buffer.from(expected);
  const b = Buffer.from(value);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function isShareUnlocked(
  token: string,
  passwordHash: string | null,
) {
  if (!passwordHash) return true;
  const jar = await cookies();
  const value = jar.get(shareUnlockCookieName(token))?.value;
  return verifyShareUnlockValue(token, passwordHash, value);
}
