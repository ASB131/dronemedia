import NextAuth, { CredentialsSignin, type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { headers } from "next/headers";

import { authConfig } from "@/auth.config";
import { verifyPassword } from "@/lib/auth/password";
import {
  checkLoginRateLimit,
  clearLoginFailures,
  recordLoginFailure,
} from "@/lib/auth/rate-limit";
import {
  createDbSession,
  findUserById,
  findUserByUsernameOrEmail,
  isDbSessionActive,
  revokeDbSession,
} from "@/lib/auth/users";
import { loginSchema } from "@/lib/auth/validators";

/** Re-check DB approval/role/session at most once per minute per JWT. */
const SESSION_REVALIDATE_MS = 60_000;

class RateLimitedSignin extends CredentialsSignin {
  code = "rate_limit";
}

class RejectedAccountSignin extends CredentialsSignin {
  code = "rejected";
}

function getClientIp(headerStore: Headers): string {
  const forwarded = headerStore.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() ?? "unknown";
  }
  return headerStore.get("x-real-ip") ?? "unknown";
}

const fullConfig: NextAuthConfig = {
  ...authConfig,
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) {
          return null;
        }

        const { username, password } = parsed.data;
        const headerStore = await headers();
        const ip = getClientIp(headerStore);
        const rateLimit = await checkLoginRateLimit(ip, username);

        if (!rateLimit.allowed) {
          throw new RateLimitedSignin();
        }

        const user = await findUserByUsernameOrEmail(username);
        if (!user) {
          await recordLoginFailure(ip, username);
          return null;
        }

        const valid = await verifyPassword(password, user.passwordHash);
        if (!valid) {
          await recordLoginFailure(ip, username);
          return null;
        }

        if (user.approvalStatus === "rejected") {
          throw new RejectedAccountSignin();
        }

        await clearLoginFailures(ip, username);

        return {
          id: user.id,
          name: user.username,
          email: user.email,
          role: user.role,
          approvalStatus: user.approvalStatus,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.approvalStatus = user.approvalStatus;
        token.username = user.name ?? undefined;
        token.sessionToken = crypto.randomUUID();
        token.sessionCheckedAt = Date.now();

        await createDbSession(user.id!, token.sessionToken as string, {
          userAgent: (await headers()).get("user-agent") ?? undefined,
        });
        return token;
      }

      if (!token.sub) return token;

      const checkedAt =
        typeof token.sessionCheckedAt === "number" ? token.sessionCheckedAt : 0;
      const stale = Date.now() - checkedAt >= SESSION_REVALIDATE_MS;
      const missingClaims = !token.role || !token.approvalStatus;

      if (!stale && !missingClaims) {
        return token;
      }

      if (typeof token.sessionToken === "string") {
        const active = await isDbSessionActive(token.sessionToken);
        if (!active) {
          return { ...token, sub: undefined, sessionToken: undefined };
        }
      }

      const existing = await findUserById(token.sub);
      if (!existing || existing.approvalStatus === "rejected") {
        return { ...token, sub: undefined, sessionToken: undefined };
      }

      token.role = existing.role;
      token.approvalStatus = existing.approvalStatus;
      token.username = existing.username;
      token.sessionCheckedAt = Date.now();
      return token;
    },
    session({ session, token }) {
      if (!token.sub || !session.user) {
        // JWT invalidated (revoked device / rejected user) → treat as logged out.
        return { expires: session.expires } as typeof session;
      }
      session.user.id = token.sub;
      session.user.role = token.role as "admin" | "user";
      session.user.approvalStatus = token.approvalStatus as
        | "pending"
        | "approved"
        | "rejected";
      session.user.username = token.username as string;
      return session;
    },
  },
  events: {
    async signOut(message) {
      if ("token" in message && typeof message.token?.sessionToken === "string") {
        await revokeDbSession(message.token.sessionToken);
      }
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(fullConfig);
