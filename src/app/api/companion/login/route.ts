import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";
import { z } from "zod";

import { jsonError } from "@/lib/api/auth";
import { authenticateCredentials } from "@/lib/auth/credential-login";
import { createDbSession } from "@/lib/auth/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  username: z.string().min(1).max(256),
  password: z.string().min(1).max(256),
});

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim() ?? "unknown";
  }
  return request.headers.get("x-real-ip") ?? "unknown";
}

export async function POST(request: Request) {
  try {
    const body = bodySchema.parse(await request.json());
    const user = await authenticateCredentials(
      body.username,
      body.password,
      clientIp(request),
    );
    const sessionToken = randomUUID();
    await createDbSession(user.id, sessionToken, {
      client: "companion",
      userAgent: request.headers.get("user-agent") ?? undefined,
    });
    return NextResponse.json({
      sessionToken,
      username: user.username,
    });
  } catch (error) {
    return jsonError(error);
  }
}
