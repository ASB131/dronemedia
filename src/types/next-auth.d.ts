import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      username: string;
      role: "admin" | "user";
      approvalStatus: "pending" | "approved" | "rejected";
    } & DefaultSession["user"];
  }

  interface User {
    role: "admin" | "user";
    approvalStatus: "pending" | "approved" | "rejected";
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: "admin" | "user";
    approvalStatus?: "pending" | "approved" | "rejected";
    username?: string;
    sessionToken?: string;
  }
}

export {};
