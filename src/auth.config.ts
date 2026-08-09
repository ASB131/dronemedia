import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe Auth.js config shared by middleware and the full server auth module.
 * Do not import Node-only modules (fs, pg, redis, config.yml loader) here.
 *
 * Session/JWT mapping must live here so middleware can read role / approvalStatus
 * from the JWT (otherwise /admin always redirects non-admins incorrectly).
 */
export const authConfig = {
  trustHost: true,
  secret: process.env.AUTH_SECRET,
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: {
    signIn: "/login",
  },
  providers: [],
  callbacks: {
    jwt({ token }) {
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub!;
        session.user.role = token.role as "admin" | "user";
        session.user.approvalStatus = token.approvalStatus as
          | "pending"
          | "approved"
          | "rejected";
        session.user.username = token.username as string;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
