import { loadConfig } from "@/lib/config";
import { getRedis } from "@/lib/redis";

export type RateLimitResult = {
  allowed: boolean;
  retryAfterSeconds?: number;
};

function getSettings() {
  const config = loadConfig();
  return config.auth.login;
}

function lockoutSeconds(attempts: number, baseSeconds: number): number {
  return baseSeconds * Math.pow(2, Math.max(0, attempts - getSettings().maxAttempts));
}

export async function checkLoginRateLimit(
  ip: string,
  username: string,
): Promise<RateLimitResult> {
  const redis = getRedis();
  if (redis.status !== "ready") {
    await redis.connect();
  }

  const settings = getSettings();

  for (const key of [`login:ip:${ip}`, `login:user:${username.toLowerCase()}`]) {
    const attempts = Number((await redis.get(`${key}:attempts`)) ?? 0);
    if (attempts < settings.maxAttempts) {
      continue;
    }

    const ttl = await redis.ttl(`${key}:lockout`);
    if (ttl > 0) {
      return { allowed: false, retryAfterSeconds: ttl };
    }
  }

  return { allowed: true };
}

export async function recordLoginFailure(
  ip: string,
  username: string,
): Promise<void> {
  const redis = getRedis();
  const settings = getSettings();

  for (const key of [`login:ip:${ip}`, `login:user:${username.toLowerCase()}`]) {
    const attemptsKey = `${key}:attempts`;
    const lockoutKey = `${key}:lockout`;
    const attempts = await redis.incr(attemptsKey);

    if (attempts === 1) {
      await redis.expire(attemptsKey, 3600);
    }

    if (attempts >= settings.maxAttempts) {
      const lockSeconds = lockoutSeconds(attempts, settings.lockoutBaseSeconds);
      await redis.set(lockoutKey, "1", "EX", lockSeconds);
    }
  }
}

export async function clearLoginFailures(
  ip: string,
  username: string,
): Promise<void> {
  const redis = getRedis();
  const keys = [
    `login:ip:${ip}:attempts`,
    `login:ip:${ip}:lockout`,
    `login:user:${username.toLowerCase()}:attempts`,
    `login:user:${username.toLowerCase()}:lockout`,
  ];
  await redis.del(...keys);
}

export async function checkShareUnlockRateLimit(
  ip: string,
  token: string,
): Promise<RateLimitResult> {
  const redis = getRedis();
  if (redis.status !== "ready") {
    await redis.connect();
  }
  const settings = getSettings();
  const key = `share:${ip}:${token}`;
  const attempts = Number((await redis.get(`${key}:attempts`)) ?? 0);
  if (attempts < settings.maxAttempts) return { allowed: true };
  const ttl = await redis.ttl(`${key}:lockout`);
  if (ttl > 0) return { allowed: false, retryAfterSeconds: ttl };
  return { allowed: true };
}

export async function recordShareUnlockFailure(
  ip: string,
  token: string,
): Promise<void> {
  const redis = getRedis();
  const settings = getSettings();
  const key = `share:${ip}:${token}`;
  const attemptsKey = `${key}:attempts`;
  const lockoutKey = `${key}:lockout`;
  const attempts = await redis.incr(attemptsKey);
  if (attempts === 1) await redis.expire(attemptsKey, 3600);
  if (attempts >= settings.maxAttempts) {
    const lockSeconds = lockoutSeconds(attempts, settings.lockoutBaseSeconds);
    await redis.set(lockoutKey, "1", "EX", lockSeconds);
  }
}

export async function clearShareUnlockFailures(
  ip: string,
  token: string,
): Promise<void> {
  const redis = getRedis();
  const key = `share:${ip}:${token}`;
  await redis.del(`${key}:attempts`, `${key}:lockout`);
}

const PIN_MAX_ATTEMPTS = 5;
const PIN_LOCKOUT_BASE_SECONDS = 30;
const REGISTER_MAX_ATTEMPTS = 10;
const REGISTER_WINDOW_SECONDS = 3600;

function pinLockoutSeconds(attempts: number): number {
  return PIN_LOCKOUT_BASE_SECONDS * Math.pow(2, Math.max(0, attempts - PIN_MAX_ATTEMPTS));
}

async function ensureRedisReady() {
  const redis = getRedis();
  if (redis.status !== "ready") {
    await redis.connect();
  }
  return redis;
}

export async function checkPinUnlockRateLimit(
  userId: string,
): Promise<RateLimitResult> {
  const redis = await ensureRedisReady();
  const key = `pin:user:${userId}`;
  const attempts = Number((await redis.get(`${key}:attempts`)) ?? 0);
  if (attempts < PIN_MAX_ATTEMPTS) return { allowed: true };
  const ttl = await redis.ttl(`${key}:lockout`);
  if (ttl > 0) return { allowed: false, retryAfterSeconds: ttl };
  return { allowed: true };
}

export async function recordPinUnlockFailure(userId: string): Promise<void> {
  const redis = await ensureRedisReady();
  const key = `pin:user:${userId}`;
  const attemptsKey = `${key}:attempts`;
  const lockoutKey = `${key}:lockout`;
  const attempts = await redis.incr(attemptsKey);
  if (attempts === 1) await redis.expire(attemptsKey, 3600);
  if (attempts >= PIN_MAX_ATTEMPTS) {
    await redis.set(lockoutKey, "1", "EX", pinLockoutSeconds(attempts));
  }
}

export async function clearPinUnlockFailures(userId: string): Promise<void> {
  const redis = await ensureRedisReady();
  const key = `pin:user:${userId}`;
  await redis.del(`${key}:attempts`, `${key}:lockout`);
}

export async function checkRegisterRateLimit(ip: string): Promise<RateLimitResult> {
  const redis = await ensureRedisReady();
  const key = `register:ip:${ip}`;
  const attempts = Number((await redis.get(`${key}:attempts`)) ?? 0);
  if (attempts >= REGISTER_MAX_ATTEMPTS) {
    const ttl = await redis.ttl(`${key}:attempts`);
    return {
      allowed: false,
      retryAfterSeconds: ttl > 0 ? ttl : REGISTER_WINDOW_SECONDS,
    };
  }
  return { allowed: true };
}

export async function recordRegisterAttempt(ip: string): Promise<void> {
  const redis = await ensureRedisReady();
  const key = `register:ip:${ip}:attempts`;
  const attempts = await redis.incr(key);
  if (attempts === 1) await redis.expire(key, REGISTER_WINDOW_SECONDS);
}
