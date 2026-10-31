import { ApiError } from "@/lib/api/auth";
import { verifyPassword } from "@/lib/auth/password";
import {
  checkLoginRateLimit,
  clearLoginFailures,
  recordLoginFailure,
} from "@/lib/auth/rate-limit";
import { findUserByUsernameOrEmail } from "@/lib/auth/users";
import { loginSchema } from "@/lib/auth/validators";

export async function authenticateCredentials(
  username: string,
  password: string,
  ip: string,
) {
  const parsed = loginSchema.safeParse({ username, password });
  if (!parsed.success) {
    throw new ApiError(400, "Invalid username or password");
  }

  const rateLimit = await checkLoginRateLimit(ip, parsed.data.username);
  if (!rateLimit.allowed) {
    throw new ApiError(429, "Too many login attempts. Try again later.");
  }

  const user = await findUserByUsernameOrEmail(parsed.data.username);
  if (!user) {
    await recordLoginFailure(ip, parsed.data.username);
    throw new ApiError(401, "Invalid username or password");
  }

  const valid = await verifyPassword(parsed.data.password, user.passwordHash);
  if (!valid) {
    await recordLoginFailure(ip, parsed.data.username);
    throw new ApiError(401, "Invalid username or password");
  }

  if (user.approvalStatus === "rejected") {
    throw new ApiError(403, "Account not approved");
  }

  if (user.approvalStatus !== "approved") {
    throw new ApiError(403, "Account pending approval");
  }

  await clearLoginFailures(ip, parsed.data.username);
  return user;
}
