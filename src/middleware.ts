import NextAuth from "next-auth";
import { NextResponse } from "next/server";

import { authConfig } from "@/auth.config";

const { auth } = NextAuth(authConfig);

const PUBLIC_PATHS = new Set([
  "/login",
  "/register",
  "/setup",
  "/pending-approval",
]);

const PUBLIC_PREFIXES = [
  "/api/health",
  "/api/auth",
  "/api/setup",
  "/api/public",
];

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const session = req.auth;

  if (
    PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix)) ||
    pathname.startsWith("/_next") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  if (PUBLIC_PATHS.has(pathname)) {
    if (session?.user?.approvalStatus === "approved") {
      return NextResponse.redirect(new URL("/", req.url));
    }
    return NextResponse.next();
  }

  if (pathname.startsWith("/admin") && session?.user?.role !== "admin") {
    return NextResponse.redirect(new URL("/", req.url));
  }

  if (!session) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (session.user.approvalStatus === "pending" && pathname !== "/pending-approval") {
    return NextResponse.redirect(new URL("/pending-approval", req.url));
  }

  if (session.user.approvalStatus === "approved" && pathname === "/pending-approval") {
    return NextResponse.redirect(new URL("/", req.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
